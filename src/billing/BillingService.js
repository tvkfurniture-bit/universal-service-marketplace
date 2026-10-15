/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/billing/BillingService.js
 * 
 * Monetization subsystem, double-entry credit ledger, and payment gateway integration.
 * Manages prepaid lead packages, Stripe webhook settlement verification,
 * double-entry balance accounting, automated dispute refunds, and financial audit reconciliation.
 * 
 * Guarantees zero raw payment-card data storage (SAQ-A compliant).
 * Compatible with modern V8 runtime.
 */

var BillingService = (function () {
  'use strict';

  // Standardized Prepaid Lead Package Tiers
  var PACKAGES = {
    STARTER_5: { tier: 'STARTER_5', name: 'Starter Pack (5 Leads)', credits: 5, priceCents: 7500, priceUsd: 75.00 },
    PRO_15:    { tier: 'PRO_15',    name: 'Growth Pack (15 Leads)', credits: 15, priceCents: 18000, priceUsd: 180.00 },
    ENT_30:    { tier: 'ENT_30',    name: 'Scale Pack (30 Leads)',  credits: 30, priceCents: 30000, priceUsd: 300.00 }
  };

  /**
   * Resolves the current verified lead credit balance for a provider.
   * Reads from the double-entry LEDGER_ENTITLEMENTS table, falling back to FREE_LEAD_ENTITLEMENTS.
   * 
   * @param {string} providerId - Target provider ID (e.g., 'PROV-7B8A9C12')
   * @return {number} Available credit balance
   */
  function getProviderCreditBalance(providerId) {
    if (!providerId) return 0;

    var entries = DAL.find('LEDGER_ENTITLEMENTS', function (row) {
      return row.provider_id === providerId;
    });

    if (entries.length === 0) {
      // Fallback check against legacy free entitlements
      var legacy = DAL.find('FREE_LEAD_ENTITLEMENTS', function (row) {
        return row.provider_id === providerId;
      });
      return legacy.length > 0 ? Number(legacy[0].remaining_leads) : 0;
    }

    // Sort chronologically descending to obtain the latest committed balance
    entries.sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return Number(entries[0].balance_after);
  }

  /**
   * Processes a verified checkout settlement and credits purchased leads to the provider ledger.
   * Idempotency Guard: Verified against gateway_session_id to prevent duplicate credits.
   * 
   * @param {Object} paymentData - Normalized settlement payload
   * @return {Object} { success: boolean, newBalance: number, error: string|null }
   */
  function creditPurchasedLeads(paymentData) {
    if (!paymentData || !paymentData.providerId || !paymentData.gatewaySessionId || !paymentData.packageTier) {
      return { success: false, newBalance: 0, error: 'MISSING_PAYMENT_PARAMETERS' };
    }

    var tierKey = paymentData.packageTier.toUpperCase();
    var packageDef = PACKAGES[tierKey];
    if (!packageDef) {
      return { success: false, newBalance: 0, error: 'INVALID_PACKAGE_TIER' };
    }

    return DAL.withLock(function () {
      var providerId = paymentData.providerId;
      var sessionId = paymentData.gatewaySessionId;

      // Idempotency Check: Verify if this gateway session was already credited
      var existing = DAL.find('PAYMENTS', function (row) {
        return row.gateway_session_id === sessionId && row.status === 'PAID';
      });

      if (existing.length > 0) {
        return { success: true, newBalance: getProviderCreditBalance(providerId), error: 'ALREADY_PROCESSED' };
      }

      var creditsToGrant = packageDef.credits;
      var currentBalance = getProviderCreditBalance(providerId);
      var newBalance = currentBalance + creditsToGrant;

      var paymentId = IdGenerator.payment();
      var nowIso = new Date().toISOString();

      // 1. Persist Payment Order Record
      DAL.insert('PAYMENTS', {
        payment_id: paymentId,
        provider_id: providerId,
        order_id: 'ORD-' + paymentId.substring(4),
        gateway_name: paymentData.gatewayName || 'STRIPE',
        gateway_session_id: sessionId,
        package_tier: tierKey,
        credits_granted: creditsToGrant,
        amount_cents: packageDef.priceCents,
        currency: 'USD',
        status: 'PAID',
        receipt_url: paymentData.receiptUrl || '',
        created_at: nowIso,
        settled_at: nowIso
      });

      // 2. Commit Double-Entry Transaction to Ledger
      DAL.insert('LEDGER_ENTITLEMENTS', {
        ledger_id: IdGenerator.ledger(),
        provider_id: providerId,
        transaction_type: 'PURCHASE',
        reference_id: paymentId,
        credit_delta: creditsToGrant,
        balance_after: newBalance,
        created_at: nowIso
      });

      // 3. Synchronize legacy entitlement table to ensure backward compatibility
      var legacy = DAL.find('FREE_LEAD_ENTITLEMENTS', function (r) {
        return r.provider_id === providerId;
      });

      if (legacy.length > 0) {
        DAL.update('FREE_LEAD_ENTITLEMENTS', legacy[0].entitlement_id, {
          remaining_leads: newBalance,
          status: 'ACTIVE'
        });
      }

      DAL.logAudit('PAYMENT', paymentId, 'CREDITS_PURCHASED', '', 'PAID', 'SYSTEM', providerId, {
        tier: tierKey,
        creditsGranted: creditsToGrant,
        newBalance: newBalance
      });

      return { success: true, newBalance: newBalance, error: null };
    });
  }

  /**
   * Atomically decrements 1 lead credit from the unified double-entry ledger.
   * Invoked strictly upon confirmed lead connection.
   * 
   * @param {string} providerId - Claiming provider ID
   * @param {string} leadId - Accepted lead ID
   * @return {boolean} True if deducted successfully; false if balance exhausted
   */
  function deductLeadCredit(providerId, leadId) {
    if (!providerId || !leadId) return false;

    return DAL.withLock(function () {
      var currentBalance = getProviderCreditBalance(providerId);
      if (currentBalance <= 0) {
        return false;
      }

      var newBalance = currentBalance - 1;
      var nowIso = new Date().toISOString();

      DAL.insert('LEDGER_ENTITLEMENTS', {
        ledger_id: IdGenerator.ledger(),
        provider_id: providerId,
        transaction_type: 'CONSUMPTION',
        reference_id: leadId,
        credit_delta: -1,
        balance_after: newBalance,
        created_at: nowIso
      });

      // Synchronize legacy table
      var legacy = DAL.find('FREE_LEAD_ENTITLEMENTS', function (r) {
        return r.provider_id === providerId;
      });

      if (legacy.length > 0) {
        DAL.update('FREE_LEAD_ENTITLEMENTS', legacy[0].entitlement_id, {
          consumed_leads: Number(legacy[0].consumed_leads) + 1,
          remaining_leads: newBalance,
          status: newBalance === 0 ? 'EXHAUSTED' : 'ACTIVE',
          last_consumed_at: nowIso
        });
      }

      DAL.logAudit('LEDGER', leadId, 'LEAD_CREDIT_CONSUMED', '', '', 'PROVIDER', providerId, {
        leadId: leadId,
        balanceAfter: newBalance
      });

      return true;
    });
  }

  /**
   * Reverses / refunds 1 consumed credit for a disputed or invalid lead.
   * Restores balance and logs an auditable refund event.
   * 
   * @param {string} providerId - Target provider ID
   * @param {string} leadId - Disputed lead ID
   * @param {string} [reason='DISPUTE_UPHELD'] - Refund justification
   * @return {number} New balance after refund
   */
  function refundDisputedLead(providerId, leadId, reason) {
    if (!providerId || !leadId) return 0;

    return DAL.withLock(function () {
      var currentBalance = getProviderCreditBalance(providerId);
      var newBalance = currentBalance + 1;
      var nowIso = new Date().toISOString();

      DAL.insert('LEDGER_ENTITLEMENTS', {
        ledger_id: IdGenerator.ledger(),
        provider_id: providerId,
        transaction_type: 'REFUND',
        reference_id: leadId,
        credit_delta: 1,
        balance_after: newBalance,
        created_at: nowIso
      });

      // Synchronize legacy table
      var legacy = DAL.find('FREE_LEAD_ENTITLEMENTS', function (r) {
        return r.provider_id === providerId;
      });

      if (legacy.length > 0) {
        DAL.update('FREE_LEAD_ENTITLEMENTS', legacy[0].entitlement_id, {
          consumed_leads: Math.max(0, Number(legacy[0].consumed_leads) - 1),
          remaining_leads: newBalance,
          status: 'ACTIVE'
        });
      }

      DAL.logAudit('LEDGER', leadId, 'LEAD_CREDIT_REFUNDED', '', '', 'ADMIN', providerId, {
        reason: reason || 'DISPUTE_UPHELD',
        balanceAfter: newBalance
      });

      return newBalance;
    });
  }

  /**
   * Verifies incoming Stripe Webhook signatures and settlements.
   * Handles checkout.session.completed events without external Node.js dependencies.
   * 
   * @param {string} rawPayload - Raw JSON payload string received from Stripe
   * @param {string} signatureHeader - Value of Stripe-Signature header
   * @return {Object} { status: number, body: string }
   */
  function handleStripeWebhook(rawPayload, signatureHeader) {
    if (!rawPayload || !signatureHeader) {
      return { status: 400, body: 'Missing payload or signature header.' };
    }

    var webhookSecret = ConfigService.getScriptProperty('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      SystemErrorHandler.logError('BillingService.handleStripeWebhook', 'CRITICAL', 'STRIPE_WEBHOOK_SECRET is unconfigured in properties.', null);
      return { status: 500, body: 'Webhook secret unconfigured.' };
    }

    // 1. Parse Stripe Signature Header (format: t=timestamp,v1=signature)
    var elements = signatureHeader.split(',');
    var timestamp = '';
    var receivedSig = '';

    for (var i = 0; i < elements.length; i++) {
      var item = elements[i].trim();
      if (item.indexOf('t=') === 0) timestamp = item.substring(2);
      if (item.indexOf('v1=') === 0) receivedSig = item.substring(3);
    }

    if (!timestamp || !receivedSig) {
      return { status: 400, body: 'Malformed Stripe signature header.' };
    }

    // 2. Prevent Replay Attacks (Timestamp variance threshold: 300 seconds)
    var nowSec = Math.floor(new Date().getTime() / 1000);
    if (Math.abs(nowSec - Number(timestamp)) > 300) {
      return { status: 400, body: 'Stripe webhook signature timestamp expired.' };
    }

    // 3. Verify HMAC-SHA256 Signature
    var signedPayload = timestamp + '.' + rawPayload;
    var expectedSig = SecurityService.generateHmacSha256(signedPayload, webhookSecret);

    if (!SecurityService.constantTimeCompare(expectedSig, receivedSig)) {
      DAL.logAudit('SECURITY', 'STRIPE_WEBHOOK', 'SIGNATURE_MISMATCH', '', '', 'SYSTEM', 'STRIPE', { received: receivedSig });
      return { status: 400, body: 'Invalid webhook signature.' };
    }

    // 4. Ingest Event Payload
    var eventObj;
    try {
      eventObj = JSON.parse(rawPayload);
    } catch (e) {
      return { status: 400, body: 'Malformed JSON payload.' };
    }

    if (eventObj.type === 'checkout.session.completed') {
      var session = eventObj.data.object;
      var providerId = session.client_reference_id || (session.metadata ? session.metadata.provider_id : null);
      var tier = session.metadata ? session.metadata.package_tier : 'PRO_15';

      if (!providerId) {
        SystemErrorHandler.logError('BillingService.handleStripeWebhook', 'HIGH', 'Stripe checkout completed without provider_id reference.', null, session);
        return { status: 400, body: 'Missing provider_id in session metadata.' };
      }

      var creditResult = creditPurchasedLeads({
        providerId: providerId,
        gatewaySessionId: session.id,
        packageTier: tier,
        gatewayName: 'STRIPE',
        receiptUrl: session.customer_details ? session.customer_details.email : ''
      });

      return { status: 200, body: 'Settlement confirmed. New balance: ' + creditResult.newBalance };
    }

    return { status: 200, body: 'Event received (Ignored type).' };
  }

  /**
   * Performs an automated double-entry audit across all provider ledgers.
   * Verifies that: Balance == SUM(Purchases) + SUM(FreeGrants) - SUM(Consumptions) + SUM(Refunds)
   * 
   * @return {Array<Object>} List of discrepancies (empty if 100% reconciled)
   */
  function runFinancialAuditReport() {
    var providers = DAL.getTable('PROVIDERS');
    var ledgers = DAL.getTable('LEDGER_ENTITLEMENTS');
    var discrepancies = [];

    for (var i = 0; i < providers.length; i++) {
      var pId = providers[i].provider_id;
      var pEntries = ledgers.filter(function (l) { return l.provider_id === pId; });

      if (pEntries.length === 0) continue;

      // Chronological sort
      pEntries.sort(function (a, b) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      var runningBalance = 0;
      for (var j = 0; j < pEntries.length; j++) {
        runningBalance += Number(pEntries[j].credit_delta);
        if (runningBalance !== Number(pEntries[j].balance_after)) {
          discrepancies.push({
            providerId: pId,
            ledgerId: pEntries[j].ledger_id,
            expectedBalance: runningBalance,
            recordedBalance: Number(pEntries[j].balance_after),
            timestamp: pEntries[j].created_at
          });
        }
      }
    }

    return discrepancies;
  }

  return {
    PACKAGES: PACKAGES,
    getProviderCreditBalance: getProviderCreditBalance,
    creditPurchasedLeads: creditPurchasedLeads,
    deductLeadCredit: deductLeadCredit,
    refundDisputedLead: refundDisputedLead,
    handleStripeWebhook: handleStripeWebhook,
    runFinancialAuditReport: runFinancialAuditReport
  };
})();
