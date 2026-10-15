/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/security/SecurityService.js
 * 
 * Cryptographic operations, HMAC-SHA256 signature generation, constant-time verification,
 * formula injection defense, XSS entity escaping, and token-bucket rate limiting.
 * 
 * Defends against timing attacks, CSV/formula injection, and replay exploits.
 * Compatible with modern V8 runtime. Zero external dependencies.
 */

var SecurityService = (function () {
  'use strict';

  /**
   * Generates a 64-character lowercase hexadecimal HMAC-SHA256 signature.
   * Uses native Google Apps Script Utilities.computeHmacSha256Signature.
   * 
   * @param {string} payload - Canonical string of data elements to sign
   * @param {string} secretKey - Secret key used for cryptographic signing
   * @return {string} Hexadecimal signature string
   */
  function generateHmacSha256(payload, secretKey) {
    if (!payload || !secretKey) {
      throw new Error('SecurityService.generateHmacSha256: Payload and secretKey are mandatory.');
    }
    var signatureBytes = Utilities.computeHmacSha256Signature(payload, secretKey);
    return signatureBytes.map(function (byte) {
      var n = (byte < 0 ? byte + 256 : byte).toString(16);
      return n.length === 1 ? '0' + n : n;
    }).join('');
  }

  /**
   * Performs constant-time string comparison to defend against cryptographic timing attacks.
   * Compares all characters regardless of early mismatches.
   * 
   * @param {string} a - First string (e.g., expected signature)
   * @param {string} b - Second string (e.g., received signature)
   * @return {boolean} True if strings are strictly identical in length and content
   */
  function constantTimeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Generates a tamper-proof signed action token for zero-login provider email links.
   * Cryptographically binds the action, lead ID, provider ID, and expiration timestamp.
   * 
   * @param {string} action - 'INTERESTED' or 'NOT_INTERESTED'
   * @param {string} leadId - Unique lead identifier (e.g., 'LEAD-44019283')
   * @param {string} providerId - Unique provider identifier (e.g., 'PROV-7B8A9C12')
   * @param {number} expirationTimestampSec - Unix timestamp in seconds when the link expires
   * @return {string} Hexadecimal HMAC token
   */
  function generateActionToken(action, leadId, providerId, expirationTimestampSec) {
    var secret = ConfigService.getHmacSecret();
    var canonicalPayload = [action, leadId, providerId, String(expirationTimestampSec)].join('|');
    return generateHmacSha256(canonicalPayload, secret);
  }

  /**
   * Verifies an incoming action token against current parameters and expiration bounds.
   * Defends against forged action requests, parameter tampering, and replayed expired links.
   * 
   * @param {string} action - Received action parameter
   * @param {string} leadId - Received lead ID
   * @param {string} providerId - Received provider ID
   * @param {number|string} expirationTimestampSec - Stated expiration timestamp in seconds
   * @param {string} receivedToken - Signature received in URL query parameters
   * @return {Object} Validation outcome: { valid: boolean, error: string|null }
   */
  function verifyActionToken(action, leadId, providerId, expirationTimestampSec, receivedToken) {
    if (!action || !leadId || !providerId || !expirationTimestampSec || !receivedToken) {
      return { valid: false, error: 'MISSING_PARAMETERS' };
    }

    var nowSec = Math.floor(new Date().getTime() / 1000);
    if (nowSec > Number(expirationTimestampSec)) {
      return { valid: false, error: 'TOKEN_EXPIRED' };
    }

    var secret = ConfigService.getHmacSecret();
    var canonicalPayload = [action, leadId, providerId, String(expirationTimestampSec)].join('|');
    var expectedToken = generateHmacSha256(canonicalPayload, secret);

    if (!constantTimeCompare(expectedToken, receivedToken)) {
      return { valid: false, error: 'SIGNATURE_INVALID' };
    }

    return { valid: true, error: null };
  }

  /**
   * Neutralizes spreadsheet formula injection (CSV injection).
   * In Google Sheets, cells beginning with =, +, -, @, \t, or \r can execute
   * arbitrary formulas or exfiltrate data via HYPERLINK.
   * Prepends a single quote (') to force Google Sheets to interpret the value as a literal string.
   * 
   * @param {*} value - Any value to sanitize before writing to Google Sheets
   * @return {*} Sanitized value safe for spreadsheet persistence
   */
  function sanitizeForSheet(value) {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.length === 0) {
      return value;
    }
    var firstChar = value.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' || 
        firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
      return "'" + value;
    }
    return value;
  }

  /**
   * Deep-sanitizes all properties of an object or array prior to Sheet insertion.
   * Preserves Date objects and non-string primitives.
   * 
   * @param {Object|Array|*} item - Structure to sanitize
   * @return {Object|Array|*} Sanitized copy
   */
  function sanitizeRecord(item) {
    if (item === null || item === undefined) {
      return item;
    }
    if (Array.isArray(item)) {
      return item.map(function (element) {
        return sanitizeRecord(element);
      });
    }
    if (typeof item === 'object' && !(item instanceof Date)) {
      var copy = {};
      for (var key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          copy[key] = sanitizeRecord(item[key]);
        }
      }
      return copy;
    }
    return sanitizeForSheet(item);
  }

  /**
   * HTML Entity encoder to defend against Cross-Site Scripting (XSS).
   * Encodes &, <, >, ", and ' characters into safe HTML entities before template interpolation.
   * 
   * @param {string} str - Raw input string
   * @return {string} Escaped string safe for HTML rendering
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') {
      return str;
    }
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Token-bucket rate limiter utilizing Google Apps Script CacheService.
   * Enforces request thresholds per identity key (e.g., client IP hash, customer email).
   * 
   * @param {string} identifier - Unique rate-limiting key
   * @param {number} maxRequestsPerWindow - Allowed requests per time window
   * @param {number} windowSeconds - Duration of window in seconds
   * @return {boolean} True if request is within limits; false if threshold exceeded
   */
  function checkRateLimit(identifier, maxRequestsPerWindow, windowSeconds) {
    if (!identifier) return true;
    var cache = CacheService.getScriptCache();
    var cacheKey = 'RATELIMIT_' + identifier;
    var currentCount = cache.get(cacheKey);

    if (currentCount === null) {
      cache.put(cacheKey, '1', windowSeconds);
      return true;
    }

    var count = Number(currentCount);
    if (count >= maxRequestsPerWindow) {
      return false;
    }

    cache.put(cacheKey, String(count + 1), windowSeconds);
    return true;
  }

  return {
    generateHmacSha256: generateHmacSha256,
    constantTimeCompare: constantTimeCompare,
    generateActionToken: generateActionToken,
    verifyActionToken: verifyActionToken,
    sanitizeForSheet: sanitizeForSheet,
    sanitizeRecord: sanitizeRecord,
    escapeHtml: escapeHtml,
    checkRateLimit: checkRateLimit
  };
})();
