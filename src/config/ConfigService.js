/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/config/ConfigService.js
 * 
 * Central configuration engine. Bridges Google Apps Script ScriptProperties (secrets),
 * manages in-memory caching to eliminate redundant database reads, enforces dynamic
 * type casting, and provides default configuration parameters.
 * 
 * Compatible with modern V8 runtime. Zero external dependencies.
 */

var ConfigService = (function () {
  'use strict';

  // System defaults applied when database rows are not yet initialized
  var SYSTEM_DEFAULTS = {
    INITIAL_PROVIDER_COUNT: 3,
    MAX_PROVIDER_COUNT: 5,
    LEAD_RESPONSE_TIMEOUT_MINUTES: 120,
    MAX_REPLACEMENT_ATTEMPTS: 3,
    FREE_LEADS_PER_PROVIDER: 3,
    VERIFICATION_RECHECK_DAYS: 90,
    MIN_MATCH_SCORE_THRESHOLD: 40.0,
    MAX_SERVICE_RADIUS_KM: 100.0,
    WEIGHT_CAPABILITY: 0.30,
    WEIGHT_DISTANCE: 0.20,
    WEIGHT_TRUST: 0.15,
    WEIGHT_RATING: 0.10,
    WEIGHT_AVAILABILITY: 0.10,
    WEIGHT_RESPONSE_RATE: 0.05,
    WEIGHT_LEAD_PERFORMANCE: 0.05,
    WEIGHT_PROFILE_COMPLETENESS: 0.05,
    EMAIL_BATCH_LIMIT: 20,
    MONETIZATION_MODE: 'FREE_TRIAL_HARD_STOP'
  };

  // In-memory cache to prevent repeated spreadsheet reads during high-frequency execution
  var inMemoryCache = {};
  var cacheTimestamp = 0;
  var CACHE_TTL_MS = 300000; // 5 minutes TTL

  /**
   * Retrieves a Script Property value stored in the secure environment.
   * @param {string} key - Property key (e.g., 'SPREADSHEET_ID', 'HMAC_SECRET')
   * @return {string} Stored secret value or null if not found
   */
  function getScriptProperty(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('ConfigService.getScriptProperty: Invalid or missing property key.');
    }
    var properties = PropertiesService.getScriptProperties();
    return properties.getProperty(key);
  }

  /**
   * Sets or updates a Script Property value in the secure environment.
   * @param {string} key - Property key
   * @param {string} value - Secret value to persist
   */
  function setScriptProperty(key, value) {
    if (!key || typeof key !== 'string' || value === undefined || value === null) {
      throw new Error('ConfigService.setScriptProperty: Invalid key or value provided.');
    }
    var properties = PropertiesService.getScriptProperties();
    properties.setProperty(key, String(value));
  }

  /**
   * Retrieves the configured Spreadsheet ID.
   * Throws an explicit, actionable error if the property has not been initialized.
   * @return {string} The master Google Spreadsheet ID
   */
  function getSpreadsheetId() {
    var sheetId = getScriptProperty('SPREADSHEET_ID');
    if (!sheetId || sheetId.trim() === '') {
      throw new Error('ConfigService.getSpreadsheetId: SPREADSHEET_ID is missing from Script Properties. Please configure it in Project Settings.');
    }
    return sheetId.trim();
  }

  /**
   * Retrieves the HMAC secret key used for action link signatures.
   * Throws an explicit error if unconfigured.
   * @return {string} Cryptographic secret key
   */
  function getHmacSecret() {
    var secret = getScriptProperty('HMAC_SECRET');
    if (!secret || secret.trim() === '') {
      throw new Error('ConfigService.getHmacSecret: HMAC_SECRET is missing from Script Properties. Please configure a 64-char secret key in Project Settings.');
    }
    return secret.trim();
  }

  /**
   * Retrieves the master administrator key.
   * Returns empty string if unconfigured (fails closed securely).
   * @return {string} Master admin secret key
   */
  function getAdminKey() {
    var adminKey = getScriptProperty('ADMIN_KEY');
    return adminKey ? adminKey.trim() : '';
  }

  /**
   * Retrieves the designated operational alert recipient email.
   * Defaults to empty string if unconfigured.
   * @return {string} Notification email address
   */
  function getNotificationEmail() {
    var email = getScriptProperty('NOTIFICATION_EMAIL');
    return email ? email.trim() : '';
  }

  /**
   * Converts a string value from the CONFIG sheet into its strongly typed JavaScript representation.
   * @param {string} rawValue - String value stored in sheet
   * @param {string} dataType - Declared type ('INTEGER', 'FLOAT', 'BOOLEAN', 'JSON', 'STRING')
   * @return {number|boolean|string|Object} Strongly typed value
   */
  function castValue(rawValue, dataType) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return null;
    }
    var type = (dataType || 'STRING').toUpperCase();
    switch (type) {
      case 'INTEGER':
        var parsedInt = parseInt(rawValue, 10);
        return isNaN(parsedInt) ? 0 : parsedInt;
      case 'FLOAT':
        var parsedFloat = parseFloat(rawValue);
        return isNaN(parsedFloat) ? 0.0 : parsedFloat;
      case 'BOOLEAN':
        return String(rawValue).toUpperCase() === 'TRUE';
      case 'JSON':
        try {
          return JSON.parse(rawValue);
        } catch (e) {
          return null;
        }
      case 'STRING':
      default:
        return String(rawValue);
    }
  }

  /**
   * Retrieves a typed configuration parameter.
   * 1. Checks in-memory cache (valid for 5 minutes).
   * 2. Falls back to hardcoded system defaults.
   * 
   * @param {string} key - Configuration key (e.g., 'INITIAL_PROVIDER_COUNT')
   * @return {number|string|boolean|Object} Configuration value
   */
  function get(key) {
    var now = new Date().getTime();

    // 1. Check in-memory cache
    if (inMemoryCache[key] !== undefined && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return inMemoryCache[key];
    }

    // 2. Fall back to hardcoded constant
    if (SYSTEM_DEFAULTS[key] !== undefined) {
      return SYSTEM_DEFAULTS[key];
    }

    return null;
  }

  /**
   * Ingests a key-value dictionary loaded from the database CONFIG sheet into memory.
   * Applies type casting based on each row's declared data_type.
   * 
   * @param {Array<Object>} configRows - Array of { config_key, config_value, data_type } objects
   */
  function hydrateCache(configRows) {
    if (!Array.isArray(configRows)) {
      return;
    }
    for (var i = 0; i < configRows.length; i++) {
      var row = configRows[i];
      if (row && row.config_key) {
        var typedVal = castValue(row.config_value, row.data_type);
        inMemoryCache[row.config_key] = typedVal;
      }
    }
    cacheTimestamp = new Date().getTime();
  }

  /**
   * Forces an immediate invalidation of the in-memory cache.
   * Useful when an administrator updates configuration parameters in the sheet.
   */
  function clearCache() {
    inMemoryCache = {};
    cacheTimestamp = 0;
  }

  /**
   * Returns a clean copy of all default system constants.
   * @return {Object} Default settings key-value map
   */
  function getAllDefaults() {
    var copy = {};
    for (var prop in SYSTEM_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(SYSTEM_DEFAULTS, prop)) {
        copy[prop] = SYSTEM_DEFAULTS[prop];
      }
    }
    return copy;
  }

  return {
    getScriptProperty: getScriptProperty,
    setScriptProperty: setScriptProperty,
    getSpreadsheetId: getSpreadsheetId,
    getHmacSecret: getHmacSecret,
    getAdminKey: getAdminKey,
    getNotificationEmail: getNotificationEmail,
    castValue: castValue,
    get: get,
    hydrateCache: hydrateCache,
    clearCache: clearCache,
    getAllDefaults: getAllDefaults
  };
})();
