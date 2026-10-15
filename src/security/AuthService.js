/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/security/AuthService.js
 * 
 * Authentication and authorization subsystem.
 * Manages provider session tokens, customer lead tracking tokens, administrative key validation,
 * Insecure Direct Object Reference (IDOR) prevention, and customer PII escrow disclosure gating.
 * 
 * Compatible with modern V8 runtime. Zero external dependencies.
 */

var AuthService = (function () {
  'use strict';

  var PROVIDER_SESSION_TTL_HOURS = 72; // 3-day provider session lifetime
  var CUSTOMER_TRACKING_TTL_DAYS = 14; // 14-day customer request tracking lifetime

  /**
   * Generates a cryptographically signed session token for authenticated providers.
   * Format: PROV_SESSION|<provider_id>|<expiration_sec>|<signature>
   * 
   * @param {string} providerId - Unique provider ID (e.g., 'PROV-7B8A9C12')
   * @return {string} Signed session token string
   */
  function createProviderSession(providerId) {
    if (!providerId || typeof providerId !== 'string') {
      throw new Error('AuthService.createProviderSession: Valid providerId is required.');
    }

    var nowSec = Math.floor(new Date().getTime() / 1000);
    var expSec = nowSec + (PROVIDER_SESSION_TTL_HOURS * 3600);
    var secret = ConfigService.getHmacSecret();
    var payload = ['PROV_SESSION', providerId.trim(), String(expSec)].join('|');
    var signature = SecurityService.generateHmacSha256(payload, secret);

    return payload + '|' + signature;
  }

  /**
   * Validates a provider session token and enforces ownership against the requested resource.
   * Guarantees IDOR defense: Provider A cannot query or mutate Provider B's private data.
   * 
   * @param {string} tokenString - Bearer session token
   * @param {string} [requiredProviderId] - Optional resource owner ID being accessed
   * @return {Object} Authorization outcome { authorized: boolean, providerId: string|null, error: string|null }
   */
  function authorizeProvider(tokenString, requiredProviderId) {
    if (!tokenString || typeof tokenString !== 'string') {
      return { authorized: false, providerId: null, error: 'MISSING_SESSION_TOKEN' };
    }

    var parts = tokenString.split('|');
    if (parts.length !== 4 || parts[0] !== 'PROV_SESSION') {
      return { authorized: false, providerId: null, error: 'MALFORMED_TOKEN' };
    }

    var providerId = parts[1];
    var expSec = Number(parts[2]);
    var receivedSig = parts[3];

    var nowSec = Math.floor(new Date().getTime() / 1000);
    if (nowSec > expSec) {
      return { authorized: false, providerId: null, error: 'SESSION_EXPIRED' };
    }

    var secret = ConfigService.getHmacSecret();
    var canonicalPayload = ['PROV_SESSION', providerId, String(expSec)].join('|');
    var expectedSig = SecurityService.generateHmacSha256(canonicalPayload, secret);

    if (!SecurityService.constantTimeCompare(expectedSig, receivedSig)) {
      return { authorized: false, providerId: null, error: 'SIGNATURE_INVALID' };
    }

    // IDOR Check: Ensure authenticated provider matches requested entity
    if (requiredProviderId && providerId !== requiredProviderId) {
      return { authorized: false, providerId: null, error: 'IDOR_ACCESS_DENIED' };
    }

    return { authorized: true, providerId: providerId, error: null };
  }

  /**
   * Generates a signed tracking token allowing a customer to track their lead status.
   * Format: CUST_TRACK|<lead_id>|<customer_id>|<expiration_sec>|<signature>
   * 
   * @param {string} leadId - Unique lead identifier
   * @param {string} customerId - Unique customer identifier
   * @return {string} Signed customer tracking token string
   */
  function createCustomerTrackingToken(leadId, customerId) {
    if (!leadId || !customerId) {
      throw new Error('AuthService.createCustomerTrackingToken: leadId and customerId are required.');
    }

    var nowSec = Math.floor(new Date().getTime() / 1000);
    var expSec = nowSec + (CUSTOMER_TRACKING_TTL_DAYS * 86400);
    var secret = ConfigService.getHmacSecret();
    var payload = ['CUST_TRACK', leadId.trim(), customerId.trim(), String(expSec)].join('|');
    var signature = SecurityService.generateHmacSha256(payload, secret);

    return payload + '|' + signature;
  }

  /**
   * Validates customer tracking tokens when inspecting lead progress or cancelling requests.
   * 
   * @param {string} tokenString - Token received in query parameters
   * @param {string} leadId - Lead ID being accessed
   * @return {boolean} True if authorized; false otherwise
   */
  function authorizeCustomerLead(tokenString, leadId) {
    if (!tokenString || !leadId || typeof tokenString !== 'string') {
      return false;
    }

    var parts = tokenString.split('|');
    if (parts.length !== 5 || parts[0] !== 'CUST_TRACK') {
      return false;
    }

    var tokenLeadId = parts[1];
    var customerId = parts[2];
    var expSec = Number(parts[3]);
    var receivedSig = parts[4];

    if (tokenLeadId !== leadId) {
      return false;
    }

    var nowSec = Math.floor(new Date().getTime() / 1000);
    if (nowSec > expSec) {
      return false;
    }

    var secret = ConfigService.getHmacSecret();
    var canonicalPayload = ['CUST_TRACK', tokenLeadId, customerId, String(expSec)].join('|');
    var expectedSig = SecurityService.generateHmacSha256(canonicalPayload, secret);

    return SecurityService.constantTimeCompare(expectedSig, receivedSig);
  }

  /**
   * Validates master administrator access.
   * Checks incoming key against the ADMIN_KEY property stored securely in ScriptProperties.
   * Uses constant-time comparison to prevent timing attacks.
   * 
   * @param {string} providedAdminKey - Key supplied in headers or administrative RPC payload
   * @return {boolean} True if authorized as platform administrator
   */
  function authorizeAdmin(providedAdminKey) {
    if (!providedAdminKey || typeof providedAdminKey !== 'string') {
      return false;
    }

    var realAdminKey = ConfigService.getAdminKey();
    if (!realAdminKey || realAdminKey.trim() === '') {
      // If ADMIN_KEY is unconfigured in properties, fail securely
      return false;
    }

    return SecurityService.constantTimeCompare(realAdminKey, providedAdminKey.trim());
  }

  /**
   * PII Escrow Access Gatekeeper.
   * Strict Privacy Guard: Resolves customer contact information (phone, email, full name)
   * ONLY if the requesting provider has a verified ACCEPTED distribution record for that lead.
   * 
   * @param {string} providerId - Requesting provider ID
   * @param {string} leadId - Target lead ID
   * @return {Object|null} { fullName, email, phone } or null if unauthorized
   */
  function getGatedCustomerPII(providerId, leadId) {
    if (!providerId || !leadId) {
      return null;
    }

    // Defensive check: Ensure DAL is available in execution context
    if (typeof DAL === 'undefined' || !DAL.find || !DAL.findById) {
      throw new Error('AuthService.getGatedCustomerPII: DAL module is required for escrow evaluation.');
    }

    // 1. Verify that this provider has an ACCEPTED record in LEAD_DISTRIBUTION
    var distributions = DAL.find('LEAD_DISTRIBUTION', function (row) {
      return row.lead_id === leadId && row.provider_id === providerId && row.status === 'ACCEPTED';
    });

    if (distributions.length === 0) {
      // Access Denied: Provider has not accepted or won this lead
      DAL.logAudit('LEAD', leadId, 'UNAUTHORIZED_PII_ATTEMPT', '', '', 'PROVIDER', providerId, {
        reason: 'GATED_ESCROW_VIOLATION'
      });
      return null;
    }

    // 2. Resolve Master Lead
    var lead = DAL.findById('LEADS', leadId);
    if (!lead || !lead.customer_id) {
      return null;
    }

    // 3. Resolve Customer Record from Escrow
    var customer = DAL.findById('CUSTOMERS', lead.customer_id);
    if (!customer) {
      return null;
    }

    return {
      fullName: customer.full_name,
      email: customer.email,
      phone: customer.phone
    };
  }

  return {
    createProviderSession: createProviderSession,
    authorizeProvider: authorizeProvider,
    createCustomerTrackingToken: createCustomerTrackingToken,
    authorizeCustomerLead: authorizeCustomerLead,
    authorizeAdmin: authorizeAdmin,
    getGatedCustomerPII: getGatedCustomerPII
  };
})();
