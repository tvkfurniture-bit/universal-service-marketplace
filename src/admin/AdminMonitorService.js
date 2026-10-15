/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/admin/AdminMonitorService.js
 * 
 * Operational health audit, exception triage, and administrative monitoring subsystem.
 * Scans database tables for dead-letter errors, stuck requirements, open disputes,
 * provider verification flags, and daily Gmail sending quotas.
 * 
 * Generates structured health summaries and formats the daily operational email digest.
 * Compatible with modern V8 runtime.
 */

var AdminMonitorService = (function () {
  'use strict';

  var STUCK_LEAD_THRESHOLD_HOURS = 24; // Threshold to flag leads awaiting response without progress

  /**
   * Generates a comprehensive operational health assessment across the entire platform.
   * Can be queried directly by the Admin Console or executed by the daily maintenance cron job.
   * 
   * @return {Object} System health metrics and categorized operational alerts
   */
  function getSystemHealthSummary() {
    var now = new Date();
    var nowIso = now.toISOString();
    var stuckCutoffIso = new Date(now.getTime() - (STUCK_LEAD_THRESHOLD_HOURS * 3600000)).toISOString();

    // 1. Audit Dead-Letter Errors from SYSTEM_ERRORS
    var openErrors = DAL.find('SYSTEM_ERRORS', function (row) {
      return row.resolution_status === 'OPEN';
    });

    var criticalErrors = openErrors.filter(function (e) {
      return e.severity === 'CRITICAL';
    });

    // 2. Identify Stuck Leads (Awaiting response past threshold window)
    var stuckLeads = DAL.find('LEADS', function (row) {
      return (row.status === 'AWAITING_RESPONSE' || row.status === 'MATCHING') &&
             row.created_at < stuckCutoffIso;
    });

    // 3. Count Providers Pending Verification
    var pendingVerifications = DAL.find('PROVIDERS', function (row) {
      return row.status === 'UNDER_REVIEW' || row.status === 'VERIFICATION_PENDING';
    });

    // 4. Count Open Disputes in COMPLAINTS
    var openComplaints = DAL.find('COMPLAINTS', function (row) {
      return row.status === 'OPEN' || row.status === 'UNDER_REVIEW';
    });

    // 5. Track Daily Gmail Recipient Quota
    var remainingQuota = NotificationService.getRemainingQuota();

    // 6. Marketplace Inventory Metrics
    var activeProviders = DAL.find('PROVIDERS', function (row) {
      return row.status === 'ACTIVE' || row.status === 'VERIFIED';
    }).length;

    var activeLeads = DAL.find('LEADS', function (row) {
      return row.status === 'AWAITING_RESPONSE' || row.status === 'CUSTOMER_CONNECTED';
    }).length;

    var overallStatus = (criticalErrors.length === 0 && stuckLeads.length === 0 && remainingQuota > 15) ? 'HEALTHY' : 'ATTENTION_REQUIRED';

    var alerts = generateActionableAlerts(criticalErrors, stuckLeads, openComplaints, remainingQuota);

    return {
      timestamp: nowIso,
      status: overallStatus,
      quotas: {
        remainingDailyEmails: remainingQuota,
        quotaHealth: remainingQuota > 20 ? 'NORMAL' : 'WARNING_LOW'
      },
      counts: {
        activeProviders: activeProviders,
        activeLeads: activeLeads,
        openErrorsTotal: openErrors.length,
        criticalErrors: criticalErrors.length,
        stuckLeads: stuckLeads.length,
        pendingVerifications: pendingVerifications.length,
        openComplaints: openComplaints.length
      },
      alerts: alerts
    };
  }

  /**
   * Synthesizes prioritized, actionable alerts from raw operational counts.
   */
  function generateActionableAlerts(criticalErrors, stuckLeads, openComplaints, quota) {
    var alerts = [];

    if (quota <= 15) {
      alerts.push({
        severity: 'CRITICAL',
        code: 'EMAIL_QUOTA_DEPLETION',
        message: 'Daily Gmail recipient quota is critically low (' + quota + ' remaining). Consider upgrading to Google Workspace.'
      });
    }

    if (criticalErrors.length > 0) {
      alerts.push({
        severity: 'CRITICAL',
        code: 'DEAD_LETTER_ERRORS',
        message: criticalErrors.length + ' critical error(s) logged in SYSTEM_ERRORS. Immediate operational review required.'
      });
    }

    if (stuckLeads.length > 0) {
      alerts.push({
        severity: 'HIGH',
        code: 'STUCK_LEADS_DETECTED',
        message: stuckLeads.length + ' lead(s) have been awaiting provider response for >' + STUCK_LEAD_THRESHOLD_HOURS + ' hours without resolution.'
      });
    }

    if (openComplaints.length > 0) {
      alerts.push({
        severity: 'MEDIUM',
        code: 'OPEN_DISPUTES',
        message: openComplaints.length + ' customer/provider dispute(s) pending resolution in COMPLAINTS.'
      });
    }

    return alerts;
  }

  /**
   * Daily maintenance task. Formats and dispatches the operational health digest email
   * to the designated administrator address in ScriptProperties.
   */
  function sendDailyAdminDigest() {
    var adminEmail = ConfigService.getNotificationEmail();
    if (!adminEmail) {
      Logger.log('AdminMonitorService.sendDailyAdminDigest: NOTIFICATION_EMAIL is unconfigured. Digest skipped.');
      return;
    }

    var report = getSystemHealthSummary();
    var subject = 'Marketplace Daily Ops Digest: ' + report.status + ' (' + report.counts.activeLeads + ' Active Leads)';

    var alertListHtml = '';
    if (report.alerts.length > 0) {
      alertListHtml = '<div style="background:#FEF2F2;border:1px solid #FECACA;padding:14px;border-radius:8px;margin-bottom:18px;">' +
        '<h3 style="color:#991B1B;font-size:14px;margin:0 0 8px 0;font-weight:700;">Alerts Requiring Attention:</h3><ul style="margin:0;padding-left:18px;font-size:13px;color:#991B1B;line-height:1.5;">';
      report.alerts.forEach(function (a) {
        alertListHtml += '<li><strong>[' + a.severity + ']</strong> ' + a.message + '</li>';
      });
      alertListHtml += '</ul></div>';
    } else {
      alertListHtml = '<div style="background:#ECFDF5;border:1px solid #A7F3D0;padding:12px;border-radius:8px;margin-bottom:18px;font-size:13px;color:#065F46;">' +
        '&#10003; All operational indicators are normal. Zero dead-letter errors, stuck leads, or quota warnings.</div>';
    }

    var content = '<h2 style="font-size:18px;color:#0F172A;margin-bottom:16px;font-weight:800;">Daily Marketplace Health Summary</h2>' +
      alertListHtml +
      '<table width="100%" border="0" cellspacing="0" cellpadding="8" style="font-size:13px;color:#334155;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:16px;">' +
      '<tr style="background:#F8FAFC;"><td><strong>Active Verified Providers:</strong></td><td>' + report.counts.activeProviders + '</td></tr>' +
      '<tr><td><strong>Active Leads in Flight:</strong></td><td>' + report.counts.activeLeads + '</td></tr>' +
      '<tr style="background:#F8FAFC;"><td><strong>Pending Provider Verifications:</strong></td><td>' + report.counts.pendingVerifications + '</td></tr>' +
      '<tr><td><strong>Open Customer Complaints:</strong></td><td>' + report.counts.openComplaints + '</td></tr>' +
      '<tr style="background:#F8FAFC;"><td><strong>Total Open System Errors:</strong></td><td>' + report.counts.openErrorsTotal + ' (' + report.counts.criticalErrors + ' Critical)</td></tr>' +
      '<tr><td><strong>Stuck Leads (>24h):</strong></td><td>' + report.counts.stuckLeads + '</td></tr>' +
      '<tr style="background:#F8FAFC;"><td><strong>Daily Gmail Quota Remaining:</strong></td><td>' + report.quotas.remainingDailyEmails + '</td></tr>' +
      '</table>' +
      '<p style="font-size:12px;color:#64748B;line-height:1.4;">Automated operational telemetry generated by Universal Marketplace Operations Engine.</p>';

    var wrappedEmail = EmailTemplates.wrapInLayout('Daily Operational Digest', content);
    NotificationService.sendEmail(adminEmail, subject, wrappedEmail);
  }

  /**
   * Resolves a dead-letter error record in the SYSTEM_ERRORS sheet.
   * 
   * @param {string} errorId - Error ID (e.g., 'ERR-5B2A91C4')
   * @param {string} [adminNote] - Rationale or remediation note
   * @return {boolean} True if marked resolved successfully
   */
  function resolveSystemError(errorId, adminNote) {
    return SystemErrorHandler.markResolved(errorId, adminNote);
  }

  /**
   * Retrieves full workbench triage data for the Admin Console.
   * Enforces server-side administrator authorization via master admin key.
   * 
   * @param {string} adminKey - Master admin secret key
   * @return {Object} Triage queues payload or error
   */
  function getExceptionWorkbenchData(adminKey) {
    if (!AuthService.authorizeAdmin(adminKey)) {
      return { success: false, error: 'UNAUTHORIZED_ADMIN_ACCESS' };
    }

    var health = getSystemHealthSummary();
    var openErrors = DAL.find('SYSTEM_ERRORS', function (row) { return row.resolution_status === 'OPEN'; });
    var pendingProviders = DAL.find('PROVIDERS', function (row) { return row.status === 'UNDER_REVIEW'; });
    var openComplaints = DAL.find('COMPLAINTS', function (row) { return row.status === 'OPEN'; });
    var recentAudits = DAL.getTable('AUDIT_LOG').slice(-25).reverse();

    return {
      success: true,
      health: health,
      queues: {
        errors: openErrors,
        pendingProviders: pendingProviders,
        complaints: openComplaints,
        recentAudits: recentAudits
      }
    };
  }

  return {
    getSystemHealthSummary: getSystemHealthSummary,
    sendDailyAdminDigest: sendDailyAdminDigest,
    resolveSystemError: resolveSystemError,
    getExceptionWorkbenchData: getExceptionWorkbenchData
  };
})();
