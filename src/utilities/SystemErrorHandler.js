/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/utilities/SystemErrorHandler.js
 * 
 * Dead-letter queue logger, exception triage manager, and retry handler.
 * Persists unhandled errors and failed transactions directly to the SYSTEM_ERRORS sheet.
 * 
 * Prevents silent failures, protects against infinite recursive error loops,
 * and alerts the administrator upon critical service interruptions.
 * Compatible with modern V8 runtime.
 */

var SystemErrorHandler = (function () {
  'use strict';

  var VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  /**
   * Logs an exception to the SYSTEM_ERRORS sheet.
   * Defensively wraps sheet insertion in a try/catch to ensure that logging failures
   * never crash the primary execution thread.
   * 
   * @param {string} functionName - Calling module and function identifier (e.g., 'DistributionEngine.dispatchInitialWave')
   * @param {string} severity - Severity level: 'LOW', 'MEDIUM', 'HIGH', or 'CRITICAL'
   * @param {string} message - Error description or exception message
   * @param {string} [stackTrace] - Execution stack trace string
   * @param {Object} [context] - Structured JSON context for debugging
   * @return {string} Unique error identifier (ERR-XXXXXXXX)
   */
  function logError(functionName, severity, message, stackTrace, context) {
    var errorId = IdGenerator.error();
    var nowIso = new Date().toISOString();
    var cleanSeverity = (severity || 'MEDIUM').toUpperCase();

    if (VALID_SEVERITIES.indexOf(cleanSeverity) === -1) {
      cleanSeverity = 'MEDIUM';
    }

    var errorPayload = {
      error_id: errorId,
      timestamp: nowIso,
      function_name: String(functionName || 'UnknownFunction').substring(0, 100),
      severity: cleanSeverity,
      error_message: String(message || 'Unspecified error occurred').substring(0, 1000),
      stack_trace: String(stackTrace || '').substring(0, 3000),
      retry_count: 0,
      resolution_status: 'OPEN'
    };

    // Primary persistence path: write to SYSTEM_ERRORS via DAL
    var persisted = false;
    try {
      if (typeof DAL !== 'undefined' && DAL.insert) {
        DAL.insert('SYSTEM_ERRORS', errorPayload);
        persisted = true;
      }
    } catch (dalErr) {
      Logger.log('[CRITICAL_DAL_LOGGING_FAILURE] Could not write to SYSTEM_ERRORS: ' + dalErr.message);
    }

    // Fallback persistence path: Standard Apps Script Logger
    if (!persisted) {
      Logger.log('[DEAD_LETTER_FALLBACK] ' + JSON.stringify(errorPayload));
    }

    // Critical Alert: Send immediate administrative notification if severity is CRITICAL
    if (cleanSeverity === 'CRITICAL') {
      dispatchCriticalAlertEmail(errorPayload, context);
    }

    return errorId;
  }

  /**
   * Dispatches an emergency operational alert email to the platform administrator.
   * Safeguarded against quota exhaustion and recursive logging loops.
   * 
   * @param {Object} errorPayload - Sanitized error record
   * @param {Object} [context] - Debugging context
   */
  function dispatchCriticalAlertEmail(errorPayload, context) {
    try {
      var adminEmail = ConfigService.getNotificationEmail();
      if (!adminEmail) {
        return;
      }

      // Check remaining email quota before attempting send
      if (MailApp.getRemainingDailyEmails() <= 0) {
        Logger.log('[QUOTA_BLOCKED] Cannot send critical error alert email: Daily quota exhausted.');
        return;
      }

      var subject = 'CRITICAL ALERT: System Error in ' + errorPayload.function_name;
      var body = 'CRITICAL SYSTEM ERROR DETECTED\n\n' +
        'Error ID: ' + errorPayload.error_id + '\n' +
        'Timestamp: ' + errorPayload.timestamp + '\n' +
        'Function: ' + errorPayload.function_name + '\n' +
        'Severity: ' + errorPayload.severity + '\n' +
        'Message: ' + errorPayload.error_message + '\n\n' +
        'Stack Trace:\n' + errorPayload.stack_trace + '\n\n' +
        (context ? 'Context:\n' + JSON.stringify(context, null, 2) + '\n\n' : '') +
        'Immediate administrative inspection required in master database sheet: SYSTEM_ERRORS.';

      MailApp.sendEmail({
        to: adminEmail,
        subject: subject,
        body: body
      });
    } catch (mailErr) {
      Logger.log('[CRITICAL_ALERT_DISPATCH_FAILURE] Could not send admin alert: ' + mailErr.message);
    }
  }

  /**
   * Marks an open error record as resolved in the SYSTEM_ERRORS sheet.
   * 
   * @param {string} errorId - Unique error identifier
   * @param {string} [resolutionNote] - Reason or description of fix
   * @return {boolean} True if updated successfully; false otherwise
   */
  function markResolved(errorId, resolutionNote) {
    if (!errorId || typeof DAL === 'undefined' || !DAL.update) {
      return false;
    }

    try {
      DAL.update('SYSTEM_ERRORS', errorId, {
        resolution_status: 'RESOLVED'
      });

      DAL.logAudit('ERROR', errorId, 'ERROR_RESOLVED', 'OPEN', 'RESOLVED', 'ADMIN', 'SYSTEM', {
        note: resolutionNote || 'Marked resolved by operator'
      });

      return true;
    } catch (e) {
      Logger.log('SystemErrorHandler.markResolved: Update failed: ' + e.message);
      return false;
    }
  }

  /**
   * Executes a risky operation with automatic retry logic and exponential backoff.
   * 
   * @param {Function} operationFn - Synchronous function to execute
   * @param {number} [maxAttempts=3] - Maximum retry attempts
   * @param {number} [baseDelayMs=500] - Base delay between retries
   * @param {string} [operationName='AnonymousOperation'] - Identifier for logging
   * @return {*} Return value of operationFn
   */
  function executeWithRetry(operationFn, maxAttempts, baseDelayMs, operationName) {
    var attempts = maxAttempts || 3;
    var delay = baseDelayMs || 500;
    var opName = operationName || 'AnonymousOperation';

    for (var i = 1; i <= attempts; i++) {
      try {
        return operationFn();
      } catch (err) {
        if (i === attempts) {
          logError(opName, 'HIGH', 'Operation failed after ' + attempts + ' attempts: ' + err.message, err.stack);
          throw err;
        }
        Utilities.sleep(delay * Math.pow(2, i - 1));
      }
    }
  }

  return {
    logError: logError,
    markResolved: markResolved,
    executeWithRetry: executeWithRetry
  };
})();
