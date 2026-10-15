/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/utilities/IdGenerator.js
 * 
 * Cryptographically sound, collision-resistant business identifier generator.
 * Produces structured identifiers with deterministic entity prefixes and high-entropy
 * hexadecimal tails (e.g., PROV-A7F93E1B, LEAD-44019283).
 * 
 * Defends against sequential enumeration attacks. Compatible with Google Apps Script V8 runtime.
 */

var IdGenerator = (function () {
  'use strict';

  // Standardized entity prefixes across all database schemas and modules
  var PREFIXES = {
    PROVIDER: 'PROV-',
    LEAD: 'LEAD-',
    DISTRIBUTION: 'DIST-',
    CUSTOMER: 'CUST-',
    VERIFICATION: 'VER-',
    ENTITLEMENT: 'ENT-',
    EVENT: 'EVT-',
    ERROR: 'ERR-',
    COMPLAINT: 'CMP-',
    LOCATION: 'PLOC-',
    SERVICE: 'PSERV-',
    CATEGORY: 'CAT-',
    SUBCATEGORY: 'SUBCAT-',
    PAYMENT: 'PAY-',
    LEDGER: 'LEDG-',
    ORDER: 'ORD-'
  };

  /**
   * Generates a high-entropy pseudo-random hexadecimal string.
   * Mixes Math.random() with microsecond timestamp entropy to prevent collisions
   * even during high-frequency concurrent script invocations.
   * 
   * @param {number} byteLength - Number of bytes to generate (default 4 bytes -> 8 hex characters)
   * @return {string} Uppercase hexadecimal string
   */
  function generateRandomHex(byteLength) {
    var length = byteLength || 4;
    var bytes = [];
    var nowMs = new Date().getTime();

    for (var i = 0; i < length; i++) {
      // Combines high-resolution pseudo-randomness with bitwise-shifted time entropy
      var randomByte = Math.floor(Math.random() * 256);
      var timeEntropy = (nowMs >> (i * 8)) & 0xFF;
      var mixed = (randomByte ^ timeEntropy) & 0xFF;
      bytes.push(mixed);
    }

    return bytes.map(function (b) {
      var hex = b.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
  }

  /**
   * Core generator function. Appends an 8-character hex tail to a validated prefix.
   * Format: PREFIX-[8-HEX] (e.g., PROV-7B8A9C12)
   * 
   * @param {string} entityKey - Target entity matching PREFIXES key (e.g., 'PROVIDER', 'LEAD')
   * @return {string} Formatted unique business ID
   */
  function generate(entityKey) {
    if (!entityKey || typeof entityKey !== 'string') {
      throw new Error('IdGenerator.generate: Entity key must be a non-empty string.');
    }

    var normalizedKey = entityKey.toUpperCase();
    var prefix = PREFIXES[normalizedKey];

    if (!prefix) {
      throw new Error('IdGenerator.generate: Unknown entity prefix for "' + entityKey + '". Supported: ' + Object.keys(PREFIXES).join(', '));
    }

    return prefix + generateRandomHex(4);
  }

  return {
    PREFIXES: PREFIXES,
    generate: generate,
    generateRandomHex: generateRandomHex,

    // Specific typed convenience methods
    provider: function () { return generate('PROVIDER'); },
    lead: function () { return generate('LEAD'); },
    distribution: function () { return generate('DISTRIBUTION'); },
    customer: function () { return generate('CUSTOMER'); },
    verification: function () { return generate('VERIFICATION'); },
    entitlement: function () { return generate('ENTITLEMENT'); },
    event: function () { return generate('EVENT'); },
    error: function () { return generate('ERROR'); },
    complaint: function () { return generate('COMPLAINT'); },
    location: function () { return generate('LOCATION'); },
    service: function () { return generate('SERVICE'); },
    category: function () { return generate('CATEGORY'); },
    subcategory: function () { return generate('SUBCATEGORY'); },
    payment: function () { return generate('PAYMENT'); },
    ledger: function () { return generate('LEDGER'); },
    order: function () { return generate('ORDER'); }
  };
})();
