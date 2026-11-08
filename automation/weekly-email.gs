/**
 * Alpha-order-tracker – weekly email automation (Google Apps Script).
 *
 * Every Sunday and Wednesday ~08:00 (Asia/Jerusalem):
 *   1. Reads the settings from Firestore: settings/automation (edited on the site, admin only).
 *   2. Counts non-archived orders whose status is "ראשוני".
 *   3. If the count >= minItems: emails an Excel file (same 5 columns as the site export)
 *      and moves those orders to status "נשלחה לשגיא".
 *   4. Writes the result to settings/automation.lastRun (shown on the site).
 *
 * Runs as the Google account that owns the Firebase project, so no keys or passwords
 * are needed or stored here. This file contains no secrets and is safe in a public repo.
 *
 * Outlook relay (optional, settings.relayEmail): instead of mailing the recipients directly
 * from Gmail, the script mails the relay inbox (your Outlook) with the routing in the subject:
 *   [AOT-RELAY] <subject> ||to=a@x;b@y||cc=c@z||key=<RELAY_TOKEN>
 * A Power Automate flow in Outlook checks the sender and the key, then sends a clean new
 * email from Outlook. RELAY_TOKEN lives only in Script Properties (never in the repo).
 *
 * Setup: see SPEC.md, section "אוטומציה – מייל שבועי".
 * Functions to run by hand from the Apps Script editor:
 *   - createRelayToken()      – creates the secret code for the Outlook relay (run once).
 *   - testSendToMe()          – sends the current list to YOU only (via the relay if set), changes nothing.
 *   - installWeeklyTrigger()  – turns on the schedule, Sunday + Wednesday (run once; re-running replaces it).
 *   - removeWeeklyTrigger()   – turns off the weekly schedule.
 */

const PROJECT_ID = 'alpha-order-tracker';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
const TIMEZONE = 'Asia/Jerusalem';

const SOURCE_STATUS = 'ראשוני';
const TARGET_STATUS = 'נשלחה לשגיא';
const SENDER_NAME = 'מערכת מעקב הזמנות';
// Relay mode: the email text sits between these markers; Power Automate keeps only what is between them.
const BODY_START = '[[AOT-START]]';
const BODY_END = '[[AOT-END]]';

const DEFAULTS = {
  enabled: false,
  recipientEmail: '',
  ccEmail: '',
  replyTo: '',
  relayEmail: '',
  minItems: 2,
  subject: 'פריטים להזמנה – {תאריך} ({כמות} פריטים)',
  body: 'שלום,\n\nמצורף קובץ אקסל עם {כמות} פריטים שממתינים להזמנה.\n\nתודה,\nמערכת מעקב הזמנות'
};

// ===================== Entry points =====================

/** Called by the weekly trigger. */
function weeklyCheck() {
  let settings = DEFAULTS;
  try {
    settings = loadSettings_();

    if (!settings.enabled) {
      writeLastRun_({ result: 'disabled' });
      return;
    }
    const to = cleanEmails_(settings.recipientEmail);
    if (!to) {
      writeLastRun_({ result: 'no-recipient' });
      return;
    }

    const items = loadPendingItems_();
    const minItems = Math.max(1, parseInt(settings.minItems, 10) || DEFAULTS.minItems);
    if (items.length < minItems) {
      writeLastRun_({ result: 'below-threshold', itemCount: items.length });
      return;
    }

    sendReport_(settings, items, { to: to, cc: cleanEmails_(settings.ccEmail), test: false });

    try {
      updateStatuses_(items, TARGET_STATUS);
      writeLastRun_({ result: 'sent', itemCount: items.length });
    } catch (e) {
      writeLastRun_({ result: 'sent', itemCount: items.length,
        message: 'המייל נשלח, אך עדכון הסטטוסים נכשל: ' + e.message });
      throw e;
    }
  } catch (e) {
    try { writeLastRun_({ result: 'error', message: String(e.message || e).slice(0, 300) }); } catch (ignored) {}
    throw e; // Google emails the script owner about failed trigger runs.
  }
}

/**
 * Manual test. Changes no statuses.
 * With an Outlook relay: goes through the full path (Gmail → Outlook → Power Automate) back to the relay inbox.
 * Without a relay: sent from Gmail to the script owner.
 */
function testSendToMe() {
  const settings = loadSettings_();
  const items = loadPendingItems_();
  const relay = cleanEmails_(settings.relayEmail);
  const me = relay || Session.getEffectiveUser().getEmail();
  sendReport_(settings, items, { to: me, cc: '', test: true });
  writeLastRun_({ result: 'test', itemCount: items.length,
    message: 'נשלח לבדיקה אל ' + me + (relay ? ' (דרך Outlook)' : '') });
  Logger.log('Test email sent to %s with %s items.', me, items.length);
}

/** Run once: creates the secret code for the Outlook relay and shows it in the log. */
function createRelayToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('RELAY_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('RELAY_TOKEN', token);
  }
  Logger.log('Relay code (paste into the Power Automate condition): %s', token);
}

/** Days the check runs (08:00–09:00 Israel time). */
const RUN_DAYS = [ScriptApp.WeekDay.SUNDAY, ScriptApp.WeekDay.WEDNESDAY];

/** Run once to turn on the schedule (Sunday and Wednesday, 08:00–09:00 Israel time). */
function installWeeklyTrigger() {
  removeWeeklyTrigger();
  RUN_DAYS.forEach(function (day) {
    ScriptApp.newTrigger('weeklyCheck')
      .timeBased()
      .onWeekDay(day)
      .atHour(8)
      .inTimezone(TIMEZONE)
      .create();
  });
  Logger.log('Triggers installed: %s at 08:00 %s.', RUN_DAYS.join(', '), TIMEZONE);
}

/** Turns off the weekly schedule. */
function removeWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'weeklyCheck'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

// ===================== Firestore (REST) =====================

function firestoreFetch_(path, method, payload) {
  const options = {
    method: method || 'get',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      // Bill/quota the call to the Firebase project (the script's own project has Firestore disabled).
      'x-goog-user-project': PROJECT_ID
    }
  };
  if (payload) options.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(FIRESTORE_BASE + path, options);
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText() || '{}');
}

function loadSettings_() {
  const doc = firestoreFetch_('/settings/automation', 'get');
  const data = doc ? fromFields_(doc.fields || {}) : {};
  const merged = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    merged[k] = (data[k] === undefined || data[k] === null) ? DEFAULTS[k] : data[k];
  });
  return merged;
}

function loadPendingItems_() {
  const rows = firestoreFetch_(':runQuery', 'post', {
    structuredQuery: {
      from: [{ collectionId: 'orders' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: SOURCE_STATUS }
        }
      }
    }
  }) || [];

  return rows
    .filter(function (r) { return r.document; })
    .map(function (r) {
      const o = fromFields_(r.document.fields || {});
      o._name = r.document.name;
      return o;
    })
    .filter(function (o) { return !o.isArchived; })
    .sort(function (a, b) { return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0); });
}

function updateStatuses_(items, status) {
  for (let i = 0; i < items.length; i += 400) {
    const writes = items.slice(i, i + 400).map(function (o) {
      return {
        update: { name: o._name, fields: { status: { stringValue: status } } },
        updateMask: { fieldPaths: ['status'] },
        currentDocument: { exists: true }
      };
    });
    firestoreFetch_(':commit', 'post', { writes: writes });
  }
}

function writeLastRun_(info) {
  const fields = {
    at: { integerValue: String(Date.now()) },
    result: { stringValue: info.result }
  };
  if (typeof info.itemCount === 'number') fields.itemCount = { integerValue: String(info.itemCount) };
  if (info.message) fields.message = { stringValue: info.message };

  firestoreFetch_(':commit', 'post', {
    writes: [{
      update: {
        name: 'projects/' + PROJECT_ID + '/databases/(default)/documents/settings/automation',
        fields: { lastRun: { mapValue: { fields: fields } } }
      },
      updateMask: { fieldPaths: ['lastRun'] }
    }]
  });
}

function fromFields_(fields) {
  const out = {};
  Object.keys(fields).forEach(function (k) { out[k] = fromValue_(fields[k]); });
  return out;
}

function fromValue_(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  return null;
}

// ===================== Email + Excel =====================

function sendReport_(settings, items, opts) {
  const dateStr = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy');
  const fill = function (s) {
    return String(s || '').split('{כמות}').join(String(items.length)).split('{תאריך}').join(dateStr);
  };

  const subject = (opts.test ? '[בדיקה] ' : '') + fill(settings.subject || DEFAULTS.subject);
  let body = fill(settings.body || DEFAULTS.body);
  if (opts.test) {
    body = 'זהו מייל בדיקה. הוא נשלח רק אליך, והסטטוסים לא שונו.\n\n' + body;
  }

  const relay = cleanEmails_(settings.relayEmail);
  // Explicit <br> line breaks (Outlook drops "white-space: pre-wrap").
  const bodyHtml = escapeHtml_(body).replace(/\r?\n/g, '<br>');
  // In relay mode, markers let Power Automate cut out only our text. Outlook adds
  // its own banners (e.g. "You don't often get email from…") to incoming mail.
  const htmlInner = relay ? BODY_START + bodyHtml + BODY_END : bodyHtml;

  const mail = {
    to: opts.to,
    subject: subject,
    body: body,
    htmlBody: '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px">' + htmlInner + '</div>',
    name: SENDER_NAME
  };

  if (relay) {
    // Outlook relay: mail only the relay inbox; Power Automate reads the routing from the subject.
    const token = PropertiesService.getScriptProperties().getProperty('RELAY_TOKEN');
    if (!token) throw new Error('Outlook relay is set but RELAY_TOKEN is missing. Run createRelayToken().');
    mail.to = relay;
    mail.subject = '[AOT-RELAY] ' + subject +
      ' ||to=' + opts.to.split(',').join(';') +
      '||cc=' + String(opts.cc || '').split(',').filter(Boolean).join(';') +
      '||key=' + token;
  } else {
    if (opts.cc) mail.cc = opts.cc;
    const replyTo = cleanEmails_(settings.replyTo).split(',')[0];
    if (replyTo) mail.replyTo = replyTo.trim();
  }
  if (items.length > 0) mail.attachments = [buildExcel_(items)];

  MailApp.sendEmail(mail);
}

/** Same 5 columns as the site's "ייצוא לאקסל": no orderer column. */
function buildExcel_(items) {
  const headers = ['שם הפריט', 'כמות', 'פרויקט', 'קישור', 'הערות'];
  const ss = SpreadsheetApp.create('tmp-order-report-' + Date.now());
  const fileId = ss.getId();
  try {
    const sheet = ss.getSheets()[0];
    sheet.setName('הזמנות');
    sheet.setRightToLeft(true);

    const values = [headers].concat(items.map(function (o) {
      return [o.itemName || '', Number(o.quantity) || 1, o.project || '', o.url ? 'קישור' : '', o.notes || ''];
    }));
    const all = sheet.getRange(1, 1, values.length, headers.length);
    all.setValues(values)
      .setFontFamily('Arial').setFontSize(10)
      .setHorizontalAlignment('right').setVerticalAlignment('middle');

    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#D1FAE5').setFontColor('#065F46').setFontWeight('bold').setFontSize(11);

    // Clickable links in the "קישור" column.
    items.forEach(function (o, i) {
      if (!o.url) return;
      const url = formatUrl_(o.url);
      const rich = SpreadsheetApp.newRichTextValue().setText('קישור').setLinkUrl(url).build();
      sheet.getRange(i + 2, 4).setRichTextValue(rich).setFontColor('#2563EB');
    });

    [210, 60, 130, 85, 245].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
    SpreadsheetApp.flush();

    const res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Excel export failed: ' + res.getResponseCode());
    }
    const fileDate = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    return res.getBlob().setName('דוח_הזמנות_' + fileDate + '.xlsx');
  } finally {
    DriveApp.getFileById(fileId).setTrashed(true);
  }
}

function formatUrl_(url) {
  const t = String(url || '').trim();
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
}

function cleanEmails_(s) {
  return String(s || '').split(/[,;\s]+/).filter(Boolean).join(',');
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
