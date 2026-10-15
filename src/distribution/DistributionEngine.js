/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/distribution/DistributionEngine.js
 * 
 * Staged wave lead distribution, zero-login provider interaction,
 * replacement cascading, and timeout expiration orchestration.
 * 
 * Enforces atomic concurrency locking, race-condition claims (M=1),
 * PII escrow disclosure, and automatic replacement of declined/timed-out candidates.
 * Compatible with modern V8 runtime.
 */

var DistributionEngine = (function () {
  'use strict';

  /**
   * Dispatches Wave 1 lead opportunity notifications to the top N matched providers.
   * Generates single-use cryptographic HMAC action links and records allocations in LEAD_DISTRIBUTION.
   * 
   * @param {string} leadId - Validated lead ID
   * @return {number} Count of providers successfully notified in Wave 1
   */
  function dispatchInitialWave(leadId) {
    if (!leadId) {
      throw new Error('DistributionEngine.dispatchInitialWave: leadId is mandatory.');
    }

    var lead = DAL.findById('LEADS', leadId);
    if (!lead || (lead.status !== 'VALIDATED' && lead.status !== 'MATCHING')) {
      return 0;
    }

    // 1. Query ranked candidates from MatchingEngine
    var candidates = MatchingEngine.findMatchesForLead(leadId);

    if (candidates.length === 0) {
      DAL.update('LEADS', leadId, { status: 'NO_PROVIDER_AVAILABLE' });
      DAL.logAudit('LEAD', leadId, 'MATCHING_FAILED', lead.status, 'NO_PROVIDER_AVAILABLE', 'SYSTEM', 'DISTRIBUTION_ENGINE', {
        reason: 'ZERO_ELIGIBLE_PROVIDERS_WITHIN_RADIUS'
      });
      return 0;
    }

    // 2. Select initial cohort (N=3 by default)
    var waveSize = Number(ConfigService.get('INITIAL_PROVIDER_COUNT')) || 3;
    var selected = candidates.slice(0, waveSize);
    var timeoutMins = Number(ConfigService.get('LEAD_RESPONSE_TIMEOUT_MINUTES')) || 120;
    var deadlineIso = new Date(new Date().getTime() + (timeoutMins * 60000)).toISOString();
    var expSec = Math.floor(new Date(deadlineIso).getTime() / 1000);

    var baseUrl = ScriptApp.getService().getUrl();
    var dispatchedCount = 0;

    for (var i = 0; i < selected.length; i++) {
      var candidate = selected[i];
      var distId = IdGenerator.distribution();
      var nonce = SecurityService.generateHmacSha256(distId + leadId + candidate.providerId, ConfigService.getHmacSecret());

      // Insert tracking row in LEAD_DISTRIBUTION
      DAL.insert('LEAD_DISTRIBUTION', {
        distribution_id: distId,
        lead_id: leadId,
        provider_id: candidate.providerId,
        wave_number: 1,
        match_score: candidate.compositeScore,
        status: 'DISPATCHED',
        action_nonce: nonce,
        dispatched_at: new Date().toISOString(),
        timeout_deadline: deadlineIso,
        responded_at: ''
      });

      // Construct HMAC action links
      var tokenInterested = SecurityService.generateActionToken('INTERESTED', leadId, candidate.providerId, expSec);
      var tokenDecline = SecurityService.generateActionToken('NOT_INTERESTED', leadId, candidate.providerId, expSec);

      var interestedUrl = baseUrl + '?action=PROVIDER_LEAD_RESPONSE&decision=INTERESTED&lead_id=' + leadId + '&provider_id=' + candidate.providerId + '&t=' + expSec + '&sig=' + tokenInterested;
      var declineUrl = baseUrl + '?action=PROVIDER_LEAD_RESPONSE&decision=NOT_INTERESTED&lead_id=' + leadId + '&provider_id=' + candidate.providerId + '&t=' + expSec + '&sig=' + tokenDecline;

      // Deliver lead opportunity email
      var emailHtml = EmailTemplates.leadOpportunity(lead, candidate, interestedUrl, declineUrl, timeoutMins);
      var sent = NotificationService.sendEmail(
        candidate.email,
        'New Service Opportunity: ' + lead.derived_subcategory_id + ' in ' + lead.target_locality,
        emailHtml
      );

      if (sent) {
        dispatchedCount++;
      }
    }

    // 3. Update master lead status to AWAITING_RESPONSE
    DAL.update('LEADS', leadId, {
      status: 'AWAITING_RESPONSE',
      dispatched_count: dispatchedCount
    });

    DAL.logAudit('LEAD', leadId, 'LEAD_DISTRIBUTED', 'VALIDATED', 'AWAITING_RESPONSE', 'SYSTEM', 'DISTRIBUTION_ENGINE', {
      wave: 1,
      dispatchedCount: dispatchedCount,
      deadline: deadlineIso
    });

    return dispatchedCount;
  }

  /**
   * Processes a provider's zero-login claim or pass decision from an email link.
   * Concurrency-locked via DAL.withLock to guarantee that simultaneous clicks cannot over-allocate leads.
   * 
   * @param {string} decision - 'INTERESTED' or 'NOT_INTERESTED'
   * @param {string} leadId - Master lead identifier
   * @param {string} providerId - Responding provider identifier
   * @param {number|string} timestampSec - Link expiration parameter
   * @param {string} signature - HMAC-SHA256 signature
   * @return {Object} Status response { success: boolean, code: string, message: string }
   */
  function handleProviderResponse(decision, leadId, providerId, timestampSec, signature) {
    // 1. Verify cryptographic signature and expiration window
    var sigCheck = SecurityService.verifyActionToken(decision, leadId, providerId, timestampSec, signature);
    if (!sigCheck.valid) {
      return { success: false, code: sigCheck.error, message: 'Invalid or expired action link. Please check your dashboard.' };
    }

    // 2. Execute decision inside transactional script lock
    return DAL.withLock(function () {
      var lead = DAL.findById('LEADS', leadId);
      if (!lead) {
        return { success: false, code: 'LEAD_NOT_FOUND', message: 'This service requirement is no longer available.' };
      }

      var distributions = DAL.find('LEAD_DISTRIBUTION', function (row) {
        return row.lead_id === leadId && row.provider_id === providerId;
      });

      if (distributions.length === 0) {
        return { success: false, code: 'NOT_DISTRIBUTED', message: 'You were not assigned to this lead opportunity.' };
      }

      var dist = distributions[0];

      // Idempotency: Verify whether the provider has already acted on this opportunity
      if (dist.status !== 'DISPATCHED') {
        if (dist.status === 'ACCEPTED') {
          return { success: true, code: 'ALREADY_ACCEPTED', message: 'You have already accepted this lead. Customer contact details were delivered to your email.' };
        }
        return { success: false, code: 'ALREADY_RESOLVED', message: 'You have already responded to this opportunity (' + dist.status + ').' };
      }

      // Check if lead was cancelled in flight
      if (lead.status === 'CANCELLED' || lead.status === 'COMPLETED') {
        return { success: false, code: 'LEAD_CLOSED', message: 'This requirement was cancelled by the customer.' };
      }

      var nowIso = new Date().toISOString();

      // ==========================================
      // BRANCH A: Provider Declines ("NOT_INTERESTED")
      // ==========================================
      if (decision === 'NOT_INTERESTED') {
        DAL.update('LEAD_DISTRIBUTION', dist.distribution_id, {
          status: 'DECLINED',
          responded_at: nowIso
        });

        DAL.logAudit('DISTRIBUTION', dist.distribution_id, 'LEAD_DECLINED', 'DISPATCHED', 'DECLINED', 'PROVIDER', providerId, {
          leadId: leadId
        });

        // Trigger instant replacement cascade to maintain active wave count
        triggerReplacementCascade(leadId);

        return {
          success: true,
          code: 'DECLINED_CONFIRMED',
          message: 'You have passed on this opportunity. Thank you for your prompt response.'
        };
      }

      // ==========================================
      // BRANCH B: Provider Accepts ("INTERESTED")
      // ==========================================
      if (decision === 'INTERESTED') {
        // Race Condition Guard: Has another provider already claimed this lead?
        if (Number(lead.accepted_count) >= Number(lead.max_acceptances)) {
          DAL.update('LEAD_DISTRIBUTION', dist.distribution_id, {
            status: 'SUPERCEDED',
            responded_at: nowIso
          });

          return {
            success: false,
            code: 'CAPACITY_REACHED',
            message: 'Another professional accepted this lead first. Your lead credit balance was not charged.'
          };
        }

        // Entitlement Check: Verify that the provider has available lead credits
        var availableBalance = BillingService.getProviderCreditBalance(providerId);
        if (availableBalance <= 0) {
          return {
            success: false,
            code: 'INSUFFICIENT_CREDITS',
            message: 'You have exhausted your available lead credits. Please purchase a lead package to accept new opportunities.'
          };
        }

        // Atomically Deduct 1 Lead Credit from Unified Ledger
        var deducted = BillingService.deductLeadCredit(providerId, leadId);
        if (!deducted) {
          return {
            success: false,
            code: 'DEDUCTION_FAILED',
            message: 'Credit accounting failed. Please contact platform administration.'
          };
        }

        // Commit Acceptance
        DAL.update('LEAD_DISTRIBUTION', dist.distribution_id, {
          status: 'ACCEPTED',
          responded_at: nowIso
        });

        var newAcceptedCount = Number(lead.accepted_count) + 1;
        var newLeadStatus = newAcceptedCount >= Number(lead.max_acceptances) ? 'CUSTOMER_CONNECTED' : lead.status;

        DAL.update('LEADS', leadId, {
          accepted_count: newAcceptedCount,
          status: newLeadStatus
        });

        DAL.logAudit('LEAD', leadId, 'LEAD_ACCEPTED', lead.status, newLeadStatus, 'PROVIDER', providerId, {
          acceptedCount: newAcceptedCount
        });

        // Supercede all other pending distributions for this lead
        var pendingDists = DAL.find('LEAD_DISTRIBUTION', function (r) {
          return r.lead_id === leadId && r.distribution_id !== dist.distribution_id && r.status === 'DISPATCHED';
        });

        for (var p = 0; p < pendingDists.length; p++) {
          DAL.update('LEAD_DISTRIBUTION', pendingDists[p].distribution_id, { status: 'SUPERCEDED' });
        }

        // Exchange Contact Details (Escrow Reveal)
        var customer = DAL.findById('CUSTOMERS', lead.customer_id);
        var provider = DAL.findById('PROVIDERS', providerId);

        if (customer && provider) {
          // Send Customer Details to Winning Provider
          NotificationService.sendEmail(
            provider.email,
            'Lead Connection Confirmed: Customer Contact Unlocked #' + leadId,
            EmailTemplates.providerLeadWon(lead, customer)
          );

          // Send Provider Credentials to Customer
          NotificationService.sendEmail(
            customer.email,
            'Professional Connected: ' + provider.display_name,
            EmailTemplates.customerProviderConnected(lead, provider)
          );
        }

        // If provider exhausted their final credit with this claim, dispatch notification
        var balanceAfter = BillingService.getProviderCreditBalance(providerId);
        if (balanceAfter === 0 && provider) {
          NotificationService.sendEmail(
            provider.email,
            'Free Trial Completed: Choose a Lead Package',
            EmailTemplates.freeLeadsExhaustedNotice(provider)
          );
        }

        return {
          success: true,
          code: 'ACCEPTED_SUCCESS',
          message: 'Lead accepted! Full customer contact details have been unlocked and sent to your email.'
        };
      }

      return { success: false, code: 'UNKNOWN_DECISION', message: 'Unrecognized decision parameter.' };
    });
  }

  /**
   * Evaluates the candidate vector and dispatches the next ranked provider
   * when an active wave candidate declines or times out.
   * 
   * @param {string} leadId - Master lead identifier
   */
  function triggerReplacementCascade(leadId) {
    var lead = DAL.findById('LEADS', leadId);
    if (!lead || lead.status !== 'AWAITING_RESPONSE') {
      return;
    }

    var existingDists = DAL.find('LEAD_DISTRIBUTION', function (row) {
      return row.lead_id === leadId;
    });

    var contactedProviderIds = existingDists.map(function (d) { return d.provider_id; });
    var maxWaves = Number(ConfigService.get('MAX_REPLACEMENT_ATTEMPTS')) || 3;

    var currentMaxWave = 1;
    for (var w = 0; w < existingDists.length; w++) {
      if (existingDists[w].wave_number > currentMaxWave) {
        currentMaxWave = existingDists[w].wave_number;
      }
    }

    // Cascade Limit Guard
    if (currentMaxWave >= maxWaves + 1) {
      return;
    }

    var candidates = MatchingEngine.findMatchesForLead(leadId);
    var nextCandidate = null;

    for (var c = 0; c < candidates.length; c++) {
      if (contactedProviderIds.indexOf(candidates[c].providerId) === -1) {
        nextCandidate = candidates[c];
        break;
      }
    }

    if (!nextCandidate) {
      // Candidate pool exhausted
      return;
    }

    // Dispatch replacement candidate
    var distId = IdGenerator.distribution();
    var timeoutMins = Number(ConfigService.get('LEAD_RESPONSE_TIMEOUT_MINUTES')) || 120;
    var deadlineIso = new Date(new Date().getTime() + (timeoutMins * 60000)).toISOString();
    var expSec = Math.floor(new Date(deadlineIso).getTime() / 1000);
    var nonce = SecurityService.generateHmacSha256(distId + leadId + nextCandidate.providerId, ConfigService.getHmacSecret());

    DAL.insert('LEAD_DISTRIBUTION', {
      distribution_id: distId,
      lead_id: leadId,
      provider_id: nextCandidate.providerId,
      wave_number: currentMaxWave + 1,
      match_score: nextCandidate.compositeScore,
      status: 'DISPATCHED',
      action_nonce: nonce,
      dispatched_at: new Date().toISOString(),
      timeout_deadline: deadlineIso,
      responded_at: ''
    });

    var tokenInterested = SecurityService.generateActionToken('INTERESTED', leadId, nextCandidate.providerId, expSec);
    var tokenDecline = SecurityService.generateActionToken('NOT_INTERESTED', leadId, nextCandidate.providerId, expSec);

    var baseUrl = ScriptApp.getService().getUrl();
    var interestedUrl = baseUrl + '?action=PROVIDER_LEAD_RESPONSE&decision=INTERESTED&lead_id=' + leadId + '&provider_id=' + nextCandidate.providerId + '&t=' + expSec + '&sig=' + tokenInterested;
    var declineUrl = baseUrl + '?action=PROVIDER_LEAD_RESPONSE&decision=NOT_INTERESTED&lead_id=' + leadId + '&provider_id=' + nextCandidate.providerId + '&t=' + expSec + '&sig=' + tokenDecline;

    var emailHtml = EmailTemplates.leadOpportunity(lead, nextCandidate, interestedUrl, declineUrl, timeoutMins);
    NotificationService.sendEmail(
      nextCandidate.email,
      'New Service Opportunity: ' + lead.derived_subcategory_id + ' in ' + lead.target_locality,
      emailHtml
    );

    DAL.logAudit('LEAD', leadId, 'REPLACEMENT_DISPATCHED', 'AWAITING_RESPONSE', 'AWAITING_RESPONSE', 'SYSTEM', 'DISTRIBUTION_ENGINE', {
      wave: currentMaxWave + 1,
      replacementProviderId: nextCandidate.providerId
    });
  }

  /**
   * Sweeps expired distributions where providers failed to respond before their deadline.
   * Marks status as TIMEOUT and advances replacement cascades automatically.
   * 
   * @return {number} Count of timed-out distributions processed
   */
  function sweepTimeouts() {
    var nowIso = new Date().toISOString();
    var timedOutRows = DAL.find('LEAD_DISTRIBUTION', function (row) {
      return row.status === 'DISPATCHED' && row.timeout_deadline !== '' && row.timeout_deadline < nowIso;
    });

    var processed = 0;
    for (var i = 0; i < timedOutRows.length; i++) {
      var dist = timedOutRows[i];

      DAL.withLock(function () {
        DAL.update('LEAD_DISTRIBUTION', dist.distribution_id, {
          status: 'TIMEOUT',
          responded_at: nowIso
        });

        DAL.logAudit('DISTRIBUTION', dist.distribution_id, 'LEAD_TIMEOUT', 'DISPATCHED', 'TIMEOUT', 'SYSTEM', 'TIMEOUT_SWEEPER', {
          leadId: dist.lead_id,
          providerId: dist.provider_id
        });

        // Cascade to the next eligible provider
        triggerReplacementCascade(dist.lead_id);
        processed++;
      });
    }

    return processed;
  }

  return {
    dispatchInitialWave: dispatchInitialWave,
    handleProviderResponse: handleProviderResponse,
    triggerReplacementCascade: triggerReplacementCascade,
    sweepTimeouts: sweepTimeouts
  };
})();
