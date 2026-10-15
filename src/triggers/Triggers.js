/**
 * Universal Service Demand-to-Supply Matching Engine
 * File: src/triggers/Triggers.js
 * 
 * Scheduled background tasks, automated cron workers, and trigger management.
 * Manages the 10-minute timeout sweeper, nightly automated database backups,
 * and daily administrative operational health digests.
 * 
 * Safe for repeated execution: automatically deduplicates triggers upon re-installation.
 * Compatible with modern V8 runtime.
 */

/**
 * Scheduled Worker 1: 10-Minute Timeout Sweeper.
 * Sweeps expired distributions in LEAD_DISTRIBUTION, marks status as TIMEOUT,
 * and advances replacement cascades automatically.
 */
function scheduledTimeoutSweepWorker() {
  try {
    var processedCount = DistributionEngine.sweepTimeouts();
    if (processedCount > 0) {
      Logger.log('scheduledTimeoutSweepWorker: Successfully processed ' + processedCount + ' timed-out distributions.');
    }
  } catch (err) {
    SystemErrorHandler.logError('Triggers.scheduledTimeoutSweepWorker', 'HIGH', err.message, err.stack);
  }
}

/**
 * Scheduled Worker 2: Daily Maintenance & Backup Task.
 * 1. Creates an automated timestamped backup copy of the master Google Sheet in Google Drive.
 * 2. Dispatches the daily operational health digest to the platform owner.
 * Executed once every 24 hours (scheduled at 08:00 UTC).
 */
function scheduledDailyMaintenanceWorker() {
  try {
    // 1. Create Automated Database Snapshot Backup in Drive
    var backupUrl = DAL.createDatabaseBackup();
    Logger.log('scheduledDailyMaintenanceWorker: Database backup created successfully: ' + backupUrl);

    // 2. Dispatch Daily Administrative Operations Digest
    if (typeof AdminMonitorService !== 'undefined' && AdminMonitorService.sendDailyAdminDigest) {
      AdminMonitorService.sendDailyAdminDigest();
      Logger.log('scheduledDailyMaintenanceWorker: Daily admin digest sent successfully.');
    }
  } catch (err) {
    SystemErrorHandler.logError('Triggers.scheduledDailyMaintenanceWorker', 'HIGH', err.message, err.stack);
  }
}

/**
 * Programmatically installs all required time-driven background triggers.
 * Idempotent: checks for existing triggers with the same handler names, removes duplicates,
 * and sets up clean scheduled intervals.
 * 
 * @return {Object} Status report of installed triggers
 */
function installPlatformTriggers() {
  var installed = [];
  var removedCount = 0;

  var existingTriggers = ScriptApp.getProjectTriggers();
  var targetHandlers = ['scheduledTimeoutSweepWorker', 'scheduledDailyMaintenanceWorker'];

  // 1. Clear existing triggers for managed handlers to avoid duplicate execution
  for (var i = 0; i < existingTriggers.length; i++) {
    var trigger = existingTriggers[i];
    var handlerName = trigger.getHandlerFunction();

    if (targetHandlers.indexOf(handlerName) !== -1) {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  }

  // 2. Install Recurring 10-Minute Timeout Sweeper Trigger
  var sweepTrigger = ScriptApp.newTrigger('scheduledTimeoutSweepWorker')
    .timeBased()
    .everyMinutes(10)
    .create();

  installed.push({
    handler: 'scheduledTimeoutSweepWorker',
    interval: 'Every 10 Minutes',
    triggerId: sweepTrigger.getUniqueId()
  });

  // 3. Install Daily 24-Hour Maintenance & Backup Trigger (08:00 UTC)
  var dailyTrigger = ScriptApp.newTrigger('scheduledDailyMaintenanceWorker')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Etc/UTC')
    .create();

  installed.push({
    handler: 'scheduledDailyMaintenanceWorker',
    interval: 'Daily at 08:00 UTC',
    triggerId: dailyTrigger.getUniqueId()
  });

  Logger.log('installPlatformTriggers: Removed ' + removedCount + ' old triggers. Installed ' + installed.length + ' active triggers.');
  return {
    removedCount: removedCount,
    installed: installed
  };
}

/**
 * Programmatically removes all platform background triggers.
 * Useful when placing the marketplace into a temporary maintenance pause.
 * 
 * @return {number} Count of triggers removed
 */
function uninstallPlatformTriggers() {
  var existingTriggers = ScriptApp.getProjectTriggers();
  var targetHandlers = ['scheduledTimeoutSweepWorker', 'scheduledDailyMaintenanceWorker'];
  var removed = 0;

  for (var i = 0; i < existingTriggers.length; i++) {
    var trigger = existingTriggers[i];
    if (targetHandlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }

  Logger.log('uninstallPlatformTriggers: Removed ' + removed + ' platform triggers.');
  return removed;
}

/**
 * Returns an operational audit report of all triggers currently installed in the project.
 * 
 * @return {Array<Object>} List of installed trigger descriptions
 */
function getTriggerStatusReport() {
  var triggers = ScriptApp.getProjectTriggers();
  var report = [];

  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    report.push({
      triggerId: t.getUniqueId(),
      handlerFunction: t.getHandlerFunction(),
      eventType: String(t.getEventType()),
      triggerSource: String(t.getTriggerSource())
    });
  }

  return report;
}
