/**
 * Alpha-order-tracker – weekly Gmail cleanup (separate Google Apps Script project).
 *
 * The weekly email script sends the relay email from Gmail, so a copy stays in Gmail "Sent".
 * Once a week (Thursday ~09:00 Israel time) this script moves those copies to Trash
 * (Gmail empties Trash by itself after 30 days).
 *
 * Why a SEPARATE project: deleting mail needs access to the whole Gmail mailbox.
 * Keeping it here means the order/email script keeps its narrow permissions, and this
 * script does nothing else: no Firestore, no Drive, no sending, no external requests.
 *
 * Safety: only messages that the account itself sent, whose subject starts with "[AOT-RELAY]",
 * and that are older than 1 day. Other messages in the same thread are never touched.
 * Contains no secrets and is safe in a public repo.
 *
 * Functions to run by hand from the Apps Script editor:
 *   - cleanupRelayCopies()     – run now (also what the trigger runs).
 *   - installCleanupTrigger()  – turns on the weekly schedule (run once; re-running replaces it).
 *   - removeCleanupTrigger()   – turns off the schedule.
 */

const RELAY_PREFIX = '[AOT-RELAY]';
const CLEANUP_QUERY = 'in:sent subject:"' + RELAY_PREFIX + '" older_than:1d';
const CLEANUP_TIMEZONE = 'Asia/Jerusalem';

function cleanupRelayCopies() {
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  let trashed = 0;
  // Batches of 100 threads; stops when a pass finds nothing more to trash.
  for (let pass = 0; pass < 20; pass++) {
    const threads = GmailApp.search(CLEANUP_QUERY, 0, 100);
    let trashedThisPass = 0;
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        if (msg.isInTrash()) return;
        if (String(msg.getSubject() || '').indexOf(RELAY_PREFIX) !== 0) return;
        if (String(msg.getFrom() || '').toLowerCase().indexOf(me) === -1) return;
        msg.moveToTrash();
        trashedThisPass++;
      });
    });
    trashed += trashedThisPass;
    if (threads.length < 100 || trashedThisPass === 0) break;
  }
  Logger.log('Moved %s relay copies to Trash.', trashed);
}

/** Run once: every Thursday 09:00–10:00 Israel time (the day after the Wednesday send). */
function installCleanupTrigger() {
  removeCleanupTrigger();
  ScriptApp.newTrigger('cleanupRelayCopies')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY)
    .atHour(9)
    .inTimezone(CLEANUP_TIMEZONE)
    .create();
  Logger.log('Cleanup trigger installed: Thursday 09:00 %s.', CLEANUP_TIMEZONE);
}

function removeCleanupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'cleanupRelayCopies'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
