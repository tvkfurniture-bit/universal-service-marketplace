/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/providers/EntitlementService.js
 * 
 * Free-lead entitlement accounting subsystem.
 * Manages provider free-lead allocations, balance deductions, refunds, and paywall hard-stop enforcement.
 * 
 * Guarantees idempotent credit consumption: deductions occur IF AND ONLY IF a lead connection is confirmed.
 * Compatible with modern V8 runtime.
 */

var EntitlementService = (function () {
  'use strict';

  var DEFAULT_ALLOCATION = 3;

  /**
   * Initializes a free-lead entitlement ledger row for an approved provider.
   * Idempotent: returns existing entitlement if already initialized.
   * 
   * @param {string} providerId - Unique provider ID (e.g., 'PROV-7B8A9C12')
   * @return {Object} The inserted or existing entitlement record
   */
  function initializeEntitlement(providerId) {
    if (!providerId || typeof providerId !== 'string') {
      throw new Error('EntitlementService.initializeEntitlement: Valid providerId is required.');
    }

    return DAL.withLock(function () {
      var existing = DAL.find('FREE_LEAD_ENTITLEMENTS', function (row) {
        return row.provider_id === providerId;
      });

      if (existing.length > 0) {
        return existing[0];
      }

      var defaultGrant = Number(ConfigService.get('FREE_LEADS_PER_PROVIDER')) || DEFAULT_ALLOCATION;
      var entitlementId = IdGenerator.entitlement();

      var record = {
        entitlement_id: entitlementId,
        provider_id: providerId,
        allocated_leads: defaultGrant,
        consumed_leads: 0,
        remaining_leads: defaultGrant,
        status: 'ACTIVE',
        last_consumed_at: ''
      };

      var inserted = DAL.insert('FREE_LEAD_ENTITLEMENTS', record);

      DAL.logAudit('ENTITLEMENT', entitlementId, 'FREE_LEADS_ALLOCATED', '', 'ACTIVE', 'SYSTEM', providerId, {
        allocated: defaultGrant
      });

      return inserted;
    });
  }

  /**
   * Checks whether a provider has remaining lead credits available to claim new opportunities.
   * 
   * @param {string} providerId - Target provider ID
   * @return {boolean} True if remaining_leads > 0 and status is ACTIVE
   */
  function hasRemainingLeads(providerId) {
    if (!providerId) return false;

    var records = DAL.find('FREE_LEAD_ENTITLEMENTS', function (row) {
      return row.provider_id === providerId;
    });

    if (records.length === 0) {
      return false;
    }

    var ent = records[0];
    return ent.status === 'ACTIVE' && Number(ent.remaining_leads) > 0;
  }

  /**
   * Retrieves full entitlement metrics for a provider.
   * 
   * @param {string} providerId - Target provider ID
   * @return {Object|null} Summary { allocated, consumed, remaining, status, lastConsumedAt }
   */
  function getEntitlementSummary(providerId) {
    if (!providerId) return null;

    var records = DAL.find('FREE_LEAD_ENTITLEMENTS', function (row) {
      return row.provider_id === providerId;
    });

    if (records.length === 0) {
      return null;
    }

    var ent = records[0];
    return {
      entitlementId: ent.entitlement_id,
      providerId: ent.provider_id,
      allocatedLeads: Number(ent.allocated_leads),
      consumedLeads: Number(ent.consumed_leads),
      remainingLeads: Number(ent.remaining_leads),
      status: ent.status,
      lastConsumedAt: ent.last_consumed_at || null
    };
  }

  /**
   * Atomically decrements 1 free lead credit upon successful lead connection.
   * Enforces a hard stop when remaining balance reaches zero.
   * 
   * Invariant: Never called on email dispatch. Called ONLY when provider clicks INTERESTED
   * and capacity check is verified by DistributionEngine inside a script lock.
   * 
   * @param {string} providerId - Claiming provider ID
   * @param {string} leadId - Associated lead ID
   * @return {boolean} True if deducted successfully; false if balance exhausted
   */
  function deductLeadCredit(providerId, leadId) {
    if (!providerId || !leadId) {
      return false;
    }

    return DAL.withLock(function () {
      var records = DAL.find('FREE_LEAD_ENTITLEMENTS', function (row) {
        return row.provider_id === providerId;
      });

      if (records.length === 0) {
        return false;
      }

      var ent = records[0];
      var remaining = Number(ent.remaining_leads);
      var consumed = Number(ent.consumed_leads);

      if (remaining <= 0 || ent.status !== 'ACTIVE') {
        return false;
      }

      var newRemaining = remaining - 1;
      var newConsumed = consumed + 1;
      var newStatus = newRemaining === 0 ? 'EXHAUSTED' : 'ACTIVE';
      var nowIso = new Date().toISOString();

      DAL.update('FREE_LEAD_ENTITLEMENTS', ent.entitlement_id, {
        consumed_leads: newConsumed,
        remaining_leads: newRemaining,
        status: newStatus,
        last_consumed_at: nowIso
      });

      DAL.logAudit('ENTITLEMENT', ent.entitlement_id, 'CREDIT_DEDUCTED', ent.status, newStatus, 'PROVIDER', providerId, {
        leadId: leadId,
        consumedBefore: consumed,
        remainingAfter: newRemaining
      });

      return true;
    });
  }

  /**
   * Reverses / refunds 1 consumed credit if a lead is cancelled by the customer
   * or determined to be fraudulent/invalid within the permitted dispute window.
   * 
   * Invariant: Cannot refund consumed leads below zero.
   * 
   * @param {string} providerId - Target provider ID
   * @param {string} leadId - Cancelled or disputed lead ID
   * @param {string} [reason='CUSTOMER_CANCELLED'] - Context rationale for refund
   * @return {boolean} True if refunded successfully; false otherwise
   */
  function refundLeadCredit(providerId, leadId, reason) {
    if (!providerId || !leadId) {
      return false;
    }

    return DAL.withLock(function () {
      var records = DAL.find('FREE_LEAD_ENTITLEMENTS', function (row) {
        return row.provider_id === providerId;
      });

      if (records.length === 0) {
        return false;
      }

      var ent = records[0];
      var remaining = Number(ent.remaining_leads);
      var consumed = Number(ent.consumed_leads);

      if (consumed <= 0) {
        // Invariant: Cannot refund unconsumed credits
        return false;
      }

      var newRemaining = remaining + 1;
      var newConsumed = consumed - 1;
      var oldStatus = ent.status;

      DAL.update('FREE_LEAD_ENTITLEMENTS', ent.entitlement_id, {
        consumed_leads: newConsumed,
        remaining_leads: newRemaining,
        status: 'ACTIVE' // Reactivates provider matching pool
      });

      DAL.logAudit('ENTITLEMENT', ent.entitlement_id, 'CREDIT_REFUNDED', oldStatus, 'ACTIVE', 'SYSTEM', providerId, {
        leadId: leadId,
        refundReason: reason || 'CUSTOMER_CANCELLED',
        remainingAfter: newRemaining
      });

      return true;
    });
  }

  return {
    initializeEntitlement: initializeEntitlement,
    hasRemainingLeads: hasRemainingLeads,
    getEntitlementSummary: getEntitlementSummary,
    deductLeadCredit: deductLeadCredit,
    refundLeadCredit: refundLeadCredit
  };
})();
