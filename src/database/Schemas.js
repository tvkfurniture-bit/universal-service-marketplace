/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/database/Schemas.js
 * 
 * Formal definitions for all normalized database tables, primary keys,
 * foreign key relationships, required field constraints, default seed rows,
 * and the non-destructive auto-initialization/migration engine.
 * 
 * Safe for repeated executions. Never truncates, overwrites, or alters existing records.
 * Compatible with modern V8 runtime.
 */

var Schemas = (function () {
  'use strict';

  // Master relational table definitions across the platform
  var DEFINITIONS = {
    CONFIG: {
      primaryKey: 'config_key',
      columns: ['config_key', 'config_value', 'data_type', 'description', 'updated_at'],
      required: ['config_key', 'config_value', 'data_type']
    },
    SERVICE_CATEGORIES: {
      primaryKey: 'category_id',
      columns: ['category_id', 'category_name', 'category_slug', 'is_active', 'display_order'],
      required: ['category_id', 'category_name', 'category_slug', 'is_active']
    },
    SERVICE_SUBCATEGORIES: {
      primaryKey: 'subcategory_id',
      columns: ['subcategory_id', 'category_id', 'subcategory_name', 'subcategory_slug', 'keywords', 'is_active'],
      required: ['subcategory_id', 'category_id', 'subcategory_name', 'subcategory_slug', 'is_active'],
      foreignKeys: { category_id: 'SERVICE_CATEGORIES' }
    },
    PROVIDERS: {
      primaryKey: 'provider_id',
      columns: [
        'provider_id', 'provider_type', 'display_name', 'legal_name', 'email', 'phone',
        'website_url', 'bio', 'profile_slug', 'status', 'verification_level',
        'trust_score', 'rating_average', 'rating_count', 'response_rate_pct',
        'created_at', 'updated_at'
      ],
      required: ['provider_id', 'provider_type', 'display_name', 'email', 'status', 'trust_score']
    },
    PROVIDER_SERVICES: {
      primaryKey: 'provider_service_id',
      columns: ['provider_service_id', 'provider_id', 'subcategory_id', 'custom_skills', 'base_rate', 'rate_unit', 'experience_years'],
      required: ['provider_service_id', 'provider_id', 'subcategory_id'],
      foreignKeys: { provider_id: 'PROVIDERS', subcategory_id: 'SERVICE_SUBCATEGORIES' }
    },
    PROVIDER_LOCATIONS: {
      primaryKey: 'location_id',
      columns: ['location_id', 'provider_id', 'service_mode', 'base_address', 'base_latitude', 'base_longitude', 'radius_km', 'locality', 'postal_code'],
      required: ['location_id', 'provider_id', 'service_mode', 'base_latitude', 'base_longitude', 'radius_km'],
      foreignKeys: { provider_id: 'PROVIDERS' }
    },
    CUSTOMERS: {
      primaryKey: 'customer_id',
      columns: ['customer_id', 'full_name', 'email', 'phone', 'created_at'],
      required: ['customer_id', 'full_name', 'email', 'phone', 'created_at']
    },
    LEADS: {
      primaryKey: 'lead_id',
      columns: [
        'lead_id', 'customer_id', 'status', 'raw_description', 'derived_subcategory_id',
        'urgency', 'budget_amount', 'target_locality', 'target_latitude', 'target_longitude',
        'direct_provider_id', 'dispatched_count', 'accepted_count', 'max_acceptances',
        'created_at', 'expires_at'
      ],
      required: ['lead_id', 'customer_id', 'status', 'raw_description', 'derived_subcategory_id', 'urgency', 'target_latitude', 'target_longitude'],
      foreignKeys: { customer_id: 'CUSTOMERS', derived_subcategory_id: 'SERVICE_SUBCATEGORIES' }
    },
    LEAD_DISTRIBUTION: {
      primaryKey: 'distribution_id',
      columns: [
        'distribution_id', 'lead_id', 'provider_id', 'wave_number', 'match_score',
        'status', 'action_nonce', 'dispatched_at', 'timeout_deadline', 'responded_at'
      ],
      required: ['distribution_id', 'lead_id', 'provider_id', 'wave_number', 'status', 'action_nonce', 'dispatched_at', 'timeout_deadline'],
      foreignKeys: { lead_id: 'LEADS', provider_id: 'PROVIDERS' }
    },
    FREE_LEAD_ENTITLEMENTS: {
      primaryKey: 'entitlement_id',
      columns: ['entitlement_id', 'provider_id', 'allocated_leads', 'consumed_leads', 'remaining_leads', 'status', 'last_consumed_at'],
      required: ['entitlement_id', 'provider_id', 'allocated_leads', 'consumed_leads', 'remaining_leads', 'status'],
      foreignKeys: { provider_id: 'PROVIDERS' }
    },
    PROVIDER_VERIFICATION: {
      primaryKey: 'verification_id',
      columns: ['verification_id', 'provider_id', 'check_type', 'target_input', 'finding_status', 'finding_summary', 'reviewed_by', 'created_at', 'recheck_due_at'],
      required: ['verification_id', 'provider_id', 'check_type', 'finding_status', 'created_at'],
      foreignKeys: { provider_id: 'PROVIDERS' }
    },
    AUDIT_LOG: {
      primaryKey: 'event_id',
      columns: ['event_id', 'timestamp', 'entity_type', 'entity_id', 'action', 'old_status', 'new_status', 'actor_type', 'actor_id', 'details_json'],
      required: ['event_id', 'timestamp', 'entity_type', 'entity_id', 'action', 'actor_type', 'actor_id']
    },
    SYSTEM_ERRORS: {
      primaryKey: 'error_id',
      columns: ['error_id', 'timestamp', 'function_name', 'severity', 'error_message', 'stack_trace', 'retry_count', 'resolution_status'],
      required: ['error_id', 'timestamp', 'function_name', 'severity', 'error_message', 'retry_count', 'resolution_status']
    },
    COMPLAINTS: {
      primaryKey: 'complaint_id',
      columns: ['complaint_id', 'lead_id', 'complainant_type', 'target_provider_id', 'issue_category', 'description', 'status', 'created_at'],
      required: ['complaint_id', 'lead_id', 'complainant_type', 'target_provider_id', 'issue_category', 'description', 'status', 'created_at'],
      foreignKeys: { lead_id: 'LEADS', target_provider_id: 'PROVIDERS' }
    },
    PAYMENTS: {
      primaryKey: 'payment_id',
      columns: ['payment_id', 'provider_id', 'order_id', 'gateway_name', 'gateway_session_id', 'package_tier', 'credits_granted', 'amount_cents', 'currency', 'status', 'receipt_url', 'created_at', 'settled_at'],
      required: ['payment_id', 'provider_id', 'order_id', 'gateway_session_id', 'package_tier', 'credits_granted', 'amount_cents', 'status'],
      foreignKeys: { provider_id: 'PROVIDERS' }
    },
    LEDGER_ENTITLEMENTS: {
      primaryKey: 'ledger_id',
      columns: ['ledger_id', 'provider_id', 'transaction_type', 'reference_id', 'credit_delta', 'balance_after', 'created_at'],
      required: ['ledger_id', 'provider_id', 'transaction_type', 'reference_id', 'credit_delta', 'balance_after', 'created_at'],
      foreignKeys: { provider_id: 'PROVIDERS' }
    }
  };

  // Seed configuration rows populated on first initialization
  var DEFAULT_CONFIG_ROWS = [
    { config_key: 'INITIAL_PROVIDER_COUNT', config_value: '3', data_type: 'INTEGER', description: 'Wave 1 dispatch size ceiling' },
    { config_key: 'MAX_PROVIDER_COUNT', config_value: '5', data_type: 'INTEGER', description: 'Ceiling for maximum candidates in cascade' },
    { config_key: 'LEAD_RESPONSE_TIMEOUT_MINUTES', config_value: '120', data_type: 'INTEGER', description: 'Provider claim window before cascading' },
    { config_key: 'MAX_REPLACEMENT_ATTEMPTS', config_value: '3', data_type: 'INTEGER', description: 'Maximum replacement waves per lead' },
    { config_key: 'FREE_LEADS_PER_PROVIDER', config_value: '3', data_type: 'INTEGER', description: 'Free lead credits allocated upon verification' },
    { config_key: 'VERIFICATION_RECHECK_DAYS', config_value: '90', data_type: 'INTEGER', description: 'Periodic reverification cycle' },
    { config_key: 'MIN_MATCH_SCORE_THRESHOLD', config_value: '40.0', data_type: 'FLOAT', description: 'Minimum score threshold to qualify for dispatch' },
    { config_key: 'MAX_SERVICE_RADIUS_KM', config_value: '100.0', data_type: 'FLOAT', description: 'Maximum geographic radius ceiling' },
    { config_key: 'WEIGHT_CAPABILITY', config_value: '0.30', data_type: 'FLOAT', description: 'Matching engine weight: Capability alignment' },
    { config_key: 'WEIGHT_DISTANCE', config_value: '0.20', data_type: 'FLOAT', description: 'Matching engine weight: Geographic proximity' },
    { config_key: 'WEIGHT_TRUST', config_value: '0.15', data_type: 'FLOAT', description: 'Matching engine weight: Verification & trust score' },
    { config_key: 'WEIGHT_RATING', config_value: '0.10', data_type: 'FLOAT', description: 'Matching engine weight: Bayesian damped reviews' },
    { config_key: 'WEIGHT_AVAILABILITY', config_value: '0.10', data_type: 'FLOAT', description: 'Matching engine weight: Provider schedule' },
    { config_key: 'WEIGHT_RESPONSE_RATE', config_value: '0.05', data_type: 'FLOAT', description: 'Matching engine weight: Historical response velocity' },
    { config_key: 'WEIGHT_LEAD_PERFORMANCE', config_value: '0.05', data_type: 'FLOAT', description: 'Matching engine weight: Historical acceptance ratio' },
    { config_key: 'WEIGHT_PROFILE_COMPLETENESS', config_value: '0.05', data_type: 'FLOAT', description: 'Matching engine weight: Completeness of profile' },
    { config_key: 'MONETIZATION_MODE', config_value: 'FREE_TRIAL_HARD_STOP', data_type: 'STRING', description: 'Operational monetization behavior' }
  ];

  // Universal top-level categories seeded on initialization
  var DEFAULT_CATEGORIES = [
    { category_id: 'CAT-HOME', category_name: 'Home Services & Trades', category_slug: 'home-services', is_active: 'TRUE', display_order: '1' },
    { category_id: 'CAT-PROF', category_name: 'Professional & Business Services', category_slug: 'professional-services', is_active: 'TRUE', display_order: '2' },
    { category_id: 'CAT-EDU', category_name: 'Tutoring & Education', category_slug: 'education', is_active: 'TRUE', display_order: '3' },
    { category_id: 'CAT-EVENT', category_name: 'Events & Creative Services', category_slug: 'events-creative', is_active: 'TRUE', display_order: '4' }
  ];

  // Universal subcategories seeded on initialization
  var DEFAULT_SUBCATEGORIES = [
    { subcategory_id: 'SUBCAT-CARP', category_id: 'CAT-HOME', subcategory_name: 'Carpentry & Woodwork', subcategory_slug: 'carpentry', keywords: 'carpenter,wood,cabinet,deck,furniture,framing,door', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-PLUMB', category_id: 'CAT-HOME', subcategory_name: 'Plumbing & Drainage', subcategory_slug: 'plumbing', keywords: 'plumber,pipe,leak,drain,sink,toilet,heater,faucet', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-ELEC', category_id: 'CAT-HOME', subcategory_name: 'Electrical Services', subcategory_slug: 'electrical', keywords: 'electrician,wiring,switch,fuse,breaker,lighting,outlet', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-GARD', category_id: 'CAT-HOME', subcategory_name: 'Gardening & Landscaping', subcategory_slug: 'gardening', keywords: 'gardener,lawn,mowing,landscaping,plants,pruning,tree', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-LEGAL', category_id: 'CAT-PROF', subcategory_name: 'Legal Services', subcategory_slug: 'legal', keywords: 'lawyer,attorney,legal,contract,notary,consultation', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-ACCT', category_id: 'CAT-PROF', subcategory_name: 'Accounting & Bookkeeping', subcategory_slug: 'accounting', keywords: 'accountant,tax,bookkeeper,audit,payroll,cpa', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-TUTOR', category_id: 'CAT-EDU', subcategory_name: 'Academic Tutoring', subcategory_slug: 'tutoring', keywords: 'tutor,teacher,math,physics,science,english,exam,cbSE', is_active: 'TRUE' },
    { subcategory_id: 'SUBCAT-PHOTO', category_id: 'CAT-EVENT', subcategory_name: 'Photography & Videography', subcategory_slug: 'photography', keywords: 'photographer,photo,video,wedding,portrait,event', is_active: 'TRUE' }
  ];

  /**
   * Initializes the Google Spreadsheet database non-destructively.
   * - Creates missing sheets with frozen header rows.
   * - Performs column schema migrations: detects missing headers in existing sheets and appends them.
   * - Seeds initial default parameters and categories only if sheets are empty.
   * 
   * @return {Object} Report { createdSheets: Array, updatedSheets: Array, seededTables: Array }
   */
  function initializeDatabase() {
    var ssId = ConfigService.getSpreadsheetId();
    var ss = SpreadsheetApp.openById(ssId);
    var report = { createdSheets: [], updatedSheets: [], seededTables: [] };

    for (var sheetName in DEFINITIONS) {
      if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, sheetName)) continue;

      var schema = DEFINITIONS[sheetName];
      var sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        // Create new sheet
        sheet = ss.insertSheet(sheetName);
        sheet.getRange(1, 1, 1, schema.columns.length).setValues([schema.columns]);
        sheet.setFrozenRows(1);
        report.createdSheets.push(sheetName);
      } else {
        // Non-destructive schema migration: check for missing columns
        var lastCol = sheet.getLastColumn();
        if (lastCol > 0) {
          var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
          var missingCols = [];
          for (var c = 0; c < schema.columns.length; c++) {
            if (existingHeaders.indexOf(schema.columns[c]) === -1) {
              missingCols.push(schema.columns[c]);
            }
          }
          if (missingCols.length > 0) {
            sheet.getRange(1, lastCol + 1, 1, missingCols.length).setValues([missingCols]);
            report.updatedSheets.push(sheetName + ' (appended: ' + missingCols.join(', ') + ')');
          }
        } else {
          sheet.getRange(1, 1, 1, schema.columns.length).setValues([schema.columns]);
          sheet.setFrozenRows(1);
          report.updatedSheets.push(sheetName + ' (initialized headers)');
        }
      }
    }

    // Seed CONFIG table if empty
    var configSheet = ss.getSheetByName('CONFIG');
    if (configSheet && configSheet.getLastRow() === 1) {
      var configRows = DEFAULT_CONFIG_ROWS.map(function (row) {
        return [row.config_key, row.config_value, row.data_type, row.description, new Date().toISOString()];
      });
      configSheet.getRange(2, 1, configRows.length, 5).setValues(configRows);
      report.seededTables.push('CONFIG');
    }

    // Seed SERVICE_CATEGORIES table if empty
    var catSheet = ss.getSheetByName('SERVICE_CATEGORIES');
    if (catSheet && catSheet.getLastRow() === 1) {
      var catRows = DEFAULT_CATEGORIES.map(function (row) {
        return [row.category_id, row.category_name, row.category_slug, row.is_active, row.display_order];
      });
      catSheet.getRange(2, 1, catRows.length, 5).setValues(catRows);
      report.seededTables.push('SERVICE_CATEGORIES');
    }

    // Seed SERVICE_SUBCATEGORIES table if empty
    var subcatSheet = ss.getSheetByName('SERVICE_SUBCATEGORIES');
    if (subcatSheet && subcatSheet.getLastRow() === 1) {
      var subcatRows = DEFAULT_SUBCATEGORIES.map(function (row) {
        return [row.subcategory_id, row.category_id, row.subcategory_name, row.subcategory_slug, row.keywords, row.is_active];
      });
      subcatSheet.getRange(2, 1, subcatRows.length, 6).setValues(subcatRows);
      report.seededTables.push('SERVICE_SUBCATEGORIES');
    }

    // Clean up empty default "Sheet1" if newly created spreadsheet
    var defaultSheet1 = ss.getSheetByName('Sheet1');
    if (defaultSheet1 && ss.getSheets().length > 1 && defaultSheet1.getLastRow() === 0) {
      try {
        ss.deleteSheet(defaultSheet1);
      } catch (e) {
        // Ignore if unable to delete Sheet1
      }
    }

    return report;
  }

  return {
    DEFINITIONS: DEFINITIONS,
    initializeDatabase: initializeDatabase
  };
})();
