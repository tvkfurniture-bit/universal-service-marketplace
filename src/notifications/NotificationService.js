/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/notifications/NotificationService.js
 * 
 * Central email delivery dispatcher and quota surveillance subsystem.
 * Encapsulates Google Apps Script MailApp.sendEmail with defensive quota monitoring,
 * dead-letter error logging, and HTML body delivery.
 * 
 * Compatible with modern V8 runtime. Zero external paid dependencies.
 */

var NotificationService = (function () {
  'use strict';

  var SENDER_NAME = 'Universal Marketplace Operations';
  var CRITICAL_QUOTA_THRESHOLD = 5; // Reserve threshold to preserve emergency alerts

  /**
   * Retrieves the remaining daily outbound email quota for the deploying Google account.
   * Consumer Gmail: 100 recipients/24h. Google Workspace: 1,500 recipients/24h.
   * 
   * @return {number} Remaining email recipient quota count
   */
  function getRemainingQuota() {
    try {
      return MailApp.getRemainingDailyEmails();
    } catch (e) {
      Logger.log('NotificationService.getRemainingQuota: Could not read quota: ' + e.message);
      return 0;
    }
  }

  /**
   * Dispatches a single transactional HTML email with automatic error logging and quota enforcement.
   * Strips HTML tags automatically to provide an accessible plain-text alternative.
   * 
   * @param {string} recipientEmail - Recipient email address
   * @param {string} subject - Email subject line
   * @param {string} htmlBody - Fully styled HTML document string
   * @return {boolean} True if dispatched successfully; false if blocked by quota or network error
   */
  function sendEmail(recipientEmail, subject, htmlBody) {
    if (!recipientEmail || typeof recipientEmail !== 'string' || recipientEmail.trim() === '') {
      SystemErrorHandler.logError('NotificationService.sendEmail', 'MEDIUM', 'Missing recipient email address.', null);
      return false;
    }

    if (!subject || !htmlBody) {
      SystemErrorHandler.logError('NotificationService.sendEmail', 'MEDIUM', 'Missing email subject or body for ' + recipientEmail, null);
      return false;
    }

    var cleanRecipient = recipientEmail.trim().toLowerCase();

    // 1. Quota Enforcement Guard
    var remainingQuota = getRemainingQuota();
    if (remainingQuota <= CRITICAL_QUOTA_THRESHOLD) {
      SystemErrorHandler.logError(
        'NotificationService.sendEmail',
        'CRITICAL',
        'MailApp daily quota exhausted or below critical reserve (' + remainingQuota + ' remaining). Dispatch halted.',
        null,
        { recipient: cleanRecipient, subject: subject }
      );
      return false;
    }

    // 2. Derive Plain-Text Fallback
    var plainTextFallback = htmlBody
      .replace(/<style([\s\S]*?)<\/style>/gi, '')
      .replace(/<script([\s\S]*?)<\/script>/gi, '')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '  * ')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<[^>]+>/gi, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    // 3. Dispatch via MailApp
    try {
      MailApp.sendEmail({
        to: cleanRecipient,
        subject: subject.trim(),
        htmlBody: htmlBody,
        body: plainTextFallback,
        name: SENDER_NAME
      });

      return true;
    } catch (err) {
      SystemErrorHandler.logError(
        'NotificationService.sendEmail',
        'HIGH',
        'MailApp exception during send to ' + cleanRecipient + ': ' + err.message,
        err.stack,
        { recipient: cleanRecipient, subject: subject }
      );
      return false;
    }
  }

  /**
   * Dispatches a batch of lead notification emails sequentially while respecting rate limits.
   * 
   * @param {Array<Object>} notificationList - Array of { recipientEmail, subject, htmlBody }
   * @return {Object} { total: number, dispatched: number, failed: number }
   */
  function sendBatch(notificationList) {
    if (!Array.isArray(notificationList) || notificationList.length === 0) {
      return { total: 0, dispatched: 0, failed: 0 };
    }

    var results = {
      total: notificationList.length,
      dispatched: 0,
      failed: 0
    };

    for (var i = 0; i < notificationList.length; i++) {
      var item = notificationList[i];
      var success = sendEmail(item.recipientEmail, item.subject, item.htmlBody);
      if (success) {
        results.dispatched++;
      } else {
        results.failed++;
      }
    }

    return results;
  }

  return {
    getRemainingQuota: getRemainingQuota,
    sendEmail: sendEmail,
    sendBatch: sendBatch
  };
})();
