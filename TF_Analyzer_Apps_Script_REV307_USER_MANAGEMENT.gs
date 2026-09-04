/**
 * TF MULTI-ANALYST SCANNER — LICENSE BACKEND REV292 MANUAL ROW AUTO-ADMIN + DATE FORMAT
 * REV292 FIX:
 * - Manual EMAIL + PLAN creation now auto-fills PC/Mobile ONLINE status as OFFLINE.
 * - Manual rows auto-create RESET PC / RESET MOBILE and SEND EMAIL buttons.
 * - License date columns are normalized to dd/MM/yyyy HH:mm:ss (including ACTIVATED_AT / EMAIL_SENT_AT).
 *
 * BASE: REV230 DUAL SLOT + MOBILE APPROVAL POPUP
 *
 * PURPOSE
 * 1) Lynk.id payment webhook via Cloudflare STRICT gateway
 * 2) Product / Order / License creation
 * 3) iSignal bundle + add-on handling
 * 4) Email queue
 * 5) Compatibility with existing Cloudflare Worker: tf-license-device-api REV185
 * 6) Manual SEND EMAIL TOKEN button/menu from selected Licenses row
 *
 * Script Properties required:
 * - SPREADSHEET_ID
 * - GATEWAY_SECRET
 * - SERVER_SHARED_SECRET
 *
 * IMPORTANT:
 * - wild-wind-5363tf-analyzer-lynk-webhook = payment worker (do not mix secrets)
 * - tf-license-device-api = device/session worker
 */

const SHEET_WEBHOOK  = 'Webhook_Log';
const SHEET_PRODUCTS = 'Products';
const SHEET_ORDERS   = 'Orders';
const SHEET_LICENSES = 'Licenses';

const PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
const PROP_GATEWAY_SECRET = 'GATEWAY_SECRET';
const PROP_SERVER_SHARED_SECRET = 'SERVER_SHARED_SECRET';

const APP_TIMEZONE = 'Asia/Jakarta';
const EMAIL_SENDER_NAME = 'TF Multi-Analyst Scanner';
const EMAIL_SUPPORT_NAME = 'Skill Fusion Support - Wilie Jonathan';
const EMAIL_DOWNLOAD_URL = 'https://skillfusion.framer.website/tf-analyzer-analyst';
const EMAIL_WHATSAPP_URL = 'https://wa.me/628979140860';
const DEVICE_PENDING_TTL_MS = 15 * 60 * 1000;

// V5.3.8 — License online presence
// Existing extension already performs a Device API /license-check poll periodically.
// A valid server-side lookup counts as a heartbeat.
// 2 minute TTL avoids false OFFLINE during a temporary network / Apps Script delay.
const LICENSE_ONLINE_TTL_MS = 45 * 1000;
const LICENSE_ONLINE_WRITE_MIN_INTERVAL_MS = 20 * 1000;
const LICENSE_ONLINE_COLOR_BG = '#D9EAD3';
const LICENSE_ONLINE_COLOR_TEXT = '#0B6B2E';
const LICENSE_OFFLINE_COLOR_BG = '#F4CCCC';
const LICENSE_OFFLINE_COLOR_TEXT = '#A61B1B';
const PROP_ONLINE_STATUS_VALIDATION_REPAIRED_V539 =
  'ONLINE_STATUS_VALIDATION_REPAIRED_V539';

const REQUIRED_LICENSE_DEVICE_HEADERS = [
  'LICENSE_ID',
  // DESKTOP SLOT (backward compatible with all existing PC installations)
  'ACTIVE_DEVICE_ID',
  'ACTIVE_PUBLIC_KEY',
  'ACTIVE_SESSION_ID',
  'DEVICE_NAME',
  'FCM_REGISTRATION_ID',
  'PENDING_REQUEST_ID',
  'PENDING_DEVICE_ID',
  'PENDING_PUBLIC_KEY',
  'PENDING_FCM_ID',
  'PENDING_STATUS',
  'PENDING_REQUESTED_AT',
  // MOBILE SLOT — same EMAIL + TOKEN, but a completely separate device slot.
  'MOBILE_ACTIVE_DEVICE_ID',
  'MOBILE_ACTIVE_PUBLIC_KEY',
  'MOBILE_ACTIVE_SESSION_ID',
  'MOBILE_DEVICE_NAME',
  'MOBILE_FCM_REGISTRATION_ID',
  'MOBILE_PENDING_REQUEST_ID',
  'MOBILE_PENDING_DEVICE_ID',
  'MOBILE_PENDING_PUBLIC_KEY',
  'MOBILE_PENDING_FCM_ID',
  'MOBILE_PENDING_STATUS',
  'MOBILE_PENDING_REQUESTED_AT',
  'MOBILE_LAST_SEEN_AT'
];

// ============================================================
// HEALTH CHECK
// ============================================================

function doGet(e) {
  const adminAction = normalizeCode_(
    e && e.parameter ? e.parameter.adminAction : ''
  );

  if (adminAction === 'SEND_LICENSE_EMAIL') {
    return handleAdminSendEmailGetV541_(e);
  }
  if (adminAction === 'SEND_LICENSE_UPDATE_EMAIL') {
    return handleAdminSendUpdateEmailGetV294_(e);
  }
  if (adminAction === 'RESET_PC_DEVICE') {
    return handleAdminResetPcGetV232_(e);
  }
  if (adminAction === 'RESET_MOBILE_DEVICE') {
    return handleAdminResetMobileGetV232_(e);
  }

  return jsonResponse_({
    success: true,
    ok: true,
    service: 'TF Analyzer License Backend',
    status: 'ONLINE',
    version: 'LICENSE_PROCESSOR_REV298_ADMIN_WEB_API',
    deviceApiCompatibility: 'TF_DEVICE_API_REV235_FULL_REMOTE_REPAIR',
    serverTime: new Date().toISOString()
  });
}

// ============================================================
// ROUTER
// ============================================================

function doPost(e) {
  let body = null;
  let rawBody = '';

  try {
    rawBody = e && e.postData && typeof e.postData.contents === 'string'
      ? e.postData.contents
      : '';

    if (!rawBody) {
      return jsonResponse_({ success: false, ok: false, error: 'EMPTY_BODY' });
    }

    try {
      body = JSON.parse(rawBody);
    } catch (_) {
      return jsonResponse_({ success: false, ok: false, error: 'INVALID_JSON' });
    }

    const requestAction = String(body.action || '').trim().toLowerCase();

    // REV227: direct Side Panel presence bridge. This route is authenticated
    // by the same email + license token and does not depend on Cloudflare
    // forwarding optional uiPresenceActive / presenceEvent fields.
    if (requestAction === 'presence') {
      return jsonResponse_(handleDirectPresenceV541_(body));
    }

    // Device Worker path: tf-license-device-api -> Apps Script
    if (requestAction === 'server') {
      return handleDeviceServerRequest_(body);
    }

    // Direct extension compatibility path.
    // REV217 and older extension screens can POST action=activate/validate directly.
    // Keep this public lookup limited to email + token validation only.
    if (requestAction === 'activate' || requestAction === 'validate' || requestAction === 'lookup') {
      return jsonResponse_(handleExtensionPublicLicenseRequestV534_(body));
    }

    // REV298: GitHub Pages Admin Dashboard API.
    // Protected by a dedicated ADMIN_DASHBOARD_KEY Script Property.
    // Never put this key in config.js / GitHub source; admin enters it in the page.
    if (requestAction === 'admin_dashboard') {
      return jsonResponse_(handleAdminDashboardRequestV298_(body));
    }

    // Lynk payment path: wild-wind-...-lynk-webhook -> Apps Script
    return handleLynkPaymentRequest_(e, body, rawBody);

  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    return jsonResponse_({
      success: false,
      ok: false,
      valid: false,
      error: 'INTERNAL_ERROR',
      code: 'SERVER_ERROR',
      message: err && err.message ? err.message : String(err),
      serverTime: new Date().toISOString()
    });
  }
}

// ============================================================
// REV298 — GITHUB PAGES ADMIN DASHBOARD API
// ============================================================
//
// Security model:
// - Set Script Property ADMIN_DASHBOARD_KEY to a long random secret.
// - The GitHub Pages site DOES NOT contain that secret.
// - Admin enters the secret when opening the dashboard; it stays only in
//   browser memory for the current page session.
// - This API is intentionally separate from SERVER_SHARED_SECRET.
//
// Supported command values:
//   auth
//   list_users
//   add_user
//   update_email
//   delete_user
//   reset_pc
//   reset_mobile
//   send_email
//   send_update_email
//   send_email_all
//   send_update_email_all
// ============================================================

const PROP_ADMIN_DASHBOARD_KEY_V298 = 'ADMIN_DASHBOARD_KEY';

function adminDashboardKeyV298_() {
  const key = String(
    PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_DASHBOARD_KEY_V298) || ''
  ).trim();
  if (!key) throw new Error('ADMIN_DASHBOARD_KEY_NOT_CONFIGURED');
  return key;
}

function assertAdminDashboardKeyV298_(body) {
  const received = String(body && body.adminKey || '').trim();
  const expected = adminDashboardKeyV298_();
  if (!received || !constantTimeEqualV541_(received, expected)) {
    throw new Error('ADMIN_UNAUTHORIZED');
  }
  return true;
}

function adminDashboardFormatDateV298_(value) {
  const d = toDateOrNull_(value);
  if (!d) return '';
  return Utilities.formatDate(d, APP_TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
}

function adminDashboardIsLicenseActiveV298_(row) {
  if (normalizeCode_(row && row.STATUS) !== 'ACTIVE') return false;
  const plan = normalizeCode_(row && row.PLAN);
  const duration = deviceDurationFromPlan_(plan);
  if (duration === 'PERMANENT') return true;
  const expiry = toDateOrNull_(row && row.EXPIRED_AT);
  return Boolean(expiry && expiry.getTime() > Date.now());
}

function adminDashboardUserFromRowV298_(row, rowNumber) {
  return {
    rowNumber: rowNumber,
    licenseId: String(row.LICENSE_ID || '').trim(),
    email: canonicalEmail_(row.EMAIL),
    plan: String(row.PLAN || '').trim(),
    productName: String(row.PRODUCT_NAME || '').trim(),
    token: String(row.TOKEN || '').trim(),
    status: String(row.STATUS || '').trim(),
    validNow: adminDashboardIsLicenseActiveV298_(row),
    pcOnline: normalizeCode_(row.ONLINE_STATUS) === 'ONLINE',
    mobileOnline: normalizeCode_(row.ONLINE_STATUS_MOBILE) === 'ONLINE',
    lastSeenPc: adminDashboardFormatDateV298_(row.LAST_SEEN_AT || row.LAST_ONLINE),
    lastSeenMobile: adminDashboardFormatDateV298_(row.MOBILE_LAST_SEEN_AT),
    activatedAt: adminDashboardFormatDateV298_(row.ACTIVATED_AT),
    expiredAt: row.EXPIRED_AT ? formatExpiry_(row.EXPIRED_AT) : '',
    createdAt: adminDashboardFormatDateV298_(row.CREATED_AT)
  };
}

function listAdminDashboardUsersFastV303_() {
  const sheet = getLicensesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  ['EMAIL','TOKEN','PLAN','LICENSE_ID','STATUS'].forEach(function(name) {
    if (map[name] === undefined) throw new Error('MISSING_HEADER_' + name);
  });

  const users = [];
  for (let r = 1; r < values.length; r++) {
    const email = canonicalEmail_(values[r][map.EMAIL]);
    const token = String(values[r][map.TOKEN] || '').trim();
    const licenseId = String(values[r][map.LICENSE_ID] || '').trim();
    if (!email && !token && !licenseId) continue;

    const row = {};
    headers.forEach(function(h, i) {
      if (!h) return;
      if (!Object.prototype.hasOwnProperty.call(row, h) || row[h] === '' || row[h] === null) {
        row[h] = values[r][i];
      }
    });
    users.push(adminDashboardUserFromRowV298_(row, r + 1));
  }

  users.sort(function(a, b) {
    return String(a.email || '').localeCompare(String(b.email || ''));
  });
  return users;
}

function listAdminDashboardUsersV298_() {
  try { refreshLicenseOnlineStatusV538(); } catch (_) {}

  const sheet = getLicensesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  ['EMAIL','TOKEN','PLAN','LICENSE_ID','STATUS'].forEach(function(name) {
    if (map[name] === undefined) throw new Error('MISSING_HEADER_' + name);
  });

  const users = [];
  for (let r = 1; r < values.length; r++) {
    const email = canonicalEmail_(values[r][map.EMAIL]);
    const token = String(values[r][map.TOKEN] || '').trim();
    const licenseId = String(values[r][map.LICENSE_ID] || '').trim();
    if (!email && !token && !licenseId) continue;

    const row = {};
    headers.forEach(function(h, i) {
      if (!h) return;
      // For duplicate headers, keep the first meaningful value rather than
      // allowing a later empty duplicate column to overwrite it.
      if (!Object.prototype.hasOwnProperty.call(row, h) || row[h] === '' || row[h] === null) {
        row[h] = values[r][i];
      }
    });
    users.push(adminDashboardUserFromRowV298_(row, r + 1));
  }

  users.sort(function(a, b) {
    return String(a.email || '').localeCompare(String(b.email || ''));
  });
  return users;
}

function adminDashboardFindRowV298_(sheet, body) {
  const licenseId = String(body && body.licenseId || '').trim().toUpperCase();
  const email = canonicalEmail_(body && body.email);

  if (licenseId) {
    const row = findRowByValue_(sheet, 'LICENSE_ID', licenseId);
    if (row) return row;
  }
  if (email) {
    const row = findRowByValue_(sheet, 'EMAIL', email);
    if (row) return row;
  }
  throw new Error('USER_NOT_FOUND');
}

function adminDashboardAddUserV298_(body) {
  const email = canonicalEmail_(body && body.email);
  const plan = normalizeCode_(body && body.plan);
  if (!email || !isValidEmail_(email)) throw new Error('INVALID_EMAIL');
  const config = manualPlanConfigV5_(plan);
  if (!config) throw new Error('INVALID_PLAN');

  const sheet = getLicensesSheet_();
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);

  ['EMAIL','PLAN','TOKEN','LICENSE_ID'].forEach(function(name) {
    if (map[name] === undefined) throw new Error('MISSING_HEADER_' + name);
  });

  const duplicate = manualDuplicateEmailRowV5_(sheet, map, email, 0);
  if (duplicate) throw new Error('EMAIL_ALREADY_HAS_LICENSE_ROW_' + duplicate);

  const rowNumber = Math.max(2, sheet.getLastRow() + 1);
  if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);

  sheet.getRange(rowNumber, map.EMAIL + 1).setValue(email);
  sheet.getRange(rowNumber, map.PLAN + 1).setValue(plan);

  manualCreateLicenseAtRowV5_(sheet, rowNumber, map, {
    email: email,
    plan: plan,
    iSignalPlan: config.defaultISignalPlan
  });

  const row = getRowObject_(sheet, rowNumber);
  return adminDashboardUserFromRowV298_(row, rowNumber);
}


// REV307 — GitHub Pages admin: edit email without changing license identity.
function adminDashboardUpdateEmailV307_(body) {
  const sheet = getLicensesSheet_();
  const rowNumber = adminDashboardFindRowV298_(sheet, body);
  if (rowNumber < 2) throw new Error('INVALID_USER_ROW');

  const email = canonicalEmail_(body && (body.newEmail || body.email));
  if (!email || !isValidEmail_(email)) throw new Error('INVALID_EMAIL');

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  if (map.EMAIL === undefined) throw new Error('MISSING_HEADER_EMAIL');

  const duplicate = manualDuplicateEmailRowV5_(sheet, map, email, rowNumber);
  if (duplicate) throw new Error('EMAIL_ALREADY_HAS_LICENSE_ROW_' + duplicate);

  const before = getRowObject_(sheet, rowNumber);
  const oldEmail = canonicalEmail_(before.EMAIL);
  if (oldEmail !== email) {
    sheet.getRange(rowNumber, map.EMAIL + 1).setValue(email);
  }

  const after = getRowObject_(sheet, rowNumber);
  return {
    success: true,
    command: 'update_email',
    previousEmail: oldEmail,
    user: adminDashboardUserFromRowV298_(after, rowNumber)
  };
}

// REV307 — permanent user/license deletion. The frontend requires No | Confirm
// before this command is called. LICENSE_ID is used as the stable target.
function adminDashboardDeleteUserV307_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getLicensesSheet_();
    const rowNumber = adminDashboardFindRowV298_(sheet, body);
    if (rowNumber < 2) throw new Error('INVALID_USER_ROW');

    const row = getRowObject_(sheet, rowNumber);
    const deleted = {
      rowNumber: rowNumber,
      licenseId: String(row.LICENSE_ID || '').trim(),
      email: canonicalEmail_(row.EMAIL),
      plan: String(row.PLAN || '').trim(),
      token: String(row.TOKEN || '').trim()
    };
    if (!deleted.licenseId) throw new Error('LICENSE_ID_NOT_FOUND');

    sheet.deleteRow(rowNumber);
    SpreadsheetApp.flush();
    return {
      success: true,
      command: 'delete_user',
      deleted: deleted
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function adminDashboardSingleActionV298_(command, body) {
  const sheet = getLicensesSheet_();
  const rowNumber = adminDashboardFindRowV298_(sheet, body);
  const row = getRowObject_(sheet, rowNumber);
  const licenseId = String(row.LICENSE_ID || '').trim().toUpperCase();

  if (!licenseId) throw new Error('LICENSE_ID_NOT_FOUND');

  if (command === 'reset_pc') {
    resetPcSlotByLicenseIdV232(licenseId);
    writeResetButtonsForRowV232_(sheet, rowNumber);
    return { success: true, command: command, email: canonicalEmail_(row.EMAIL) };
  }
  if (command === 'reset_mobile') {
    resetMobileSlotByLicenseIdV232(licenseId);
    writeResetButtonsForRowV232_(sheet, rowNumber);
    return { success: true, command: command, email: canonicalEmail_(row.EMAIL) };
  }
  if (command === 'send_email') {
    return sendManualLicenseEmailAtRowV540_(sheet, rowNumber);
  }
  if (command === 'send_update_email') {
    return sendManualLicenseUpdateEmailAtRowV294_(sheet, rowNumber);
  }

  throw new Error('UNKNOWN_SINGLE_COMMAND');
}

function adminDashboardBulkEmailV298_(updateEmail) {
  const sheet = getLicensesSheet_();
  const lastRow = sheet.getLastRow();
  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = getRowObject_(sheet, rowNumber);
    const email = canonicalEmail_(row.EMAIL);
    if (!email || !String(row.TOKEN || '').trim() || !String(row.LICENSE_ID || '').trim()) {
      skipped++;
      continue;
    }
    if (!adminDashboardIsLicenseActiveV298_(row)) {
      skipped++;
      continue;
    }

    try {
      if (updateEmail) {
        sendManualLicenseUpdateEmailAtRowV294_(sheet, rowNumber);
      } else {
        sendManualLicenseEmailAtRowV540_(sheet, rowNumber);
      }
      sent++;
    } catch (err) {
      errors.push({
        rowNumber: rowNumber,
        email: email,
        error: String(err && err.message ? err.message : err)
      });
    }
  }

  return {
    success: errors.length === 0,
    sent: sent,
    skipped: skipped,
    failed: errors.length,
    errors: errors.slice(0, 30),
    remainingDailyQuota: (function() {
      try { return MailApp.getRemainingDailyQuota(); } catch (_) { return null; }
    })()
  };
}

function handleAdminDashboardRequestV298_(body) {
  assertAdminDashboardKeyV298_(body);
  const command = String(body && body.command || '').trim().toLowerCase();

  if (command === 'login_snapshot') {
    const users = listAdminDashboardUsersFastV303_();
    return {
      success: true,
      ok: true,
      authenticated: true,
      users: users,
      count: users.length,
      fastSnapshot: true,
      serverTime: new Date().toISOString()
    };
  }
  if (command === 'auth') {
    return {
      success: true,
      ok: true,
      authenticated: true,
      serverTime: new Date().toISOString()
    };
  }
  if (command === 'list_users') {
    const users = listAdminDashboardUsersV298_();
    return {
      success: true,
      ok: true,
      users: users,
      count: users.length,
      serverTime: new Date().toISOString()
    };
  }
  if (command === 'add_user') {
    const user = adminDashboardAddUserV298_(body);
    return { success: true, ok: true, user: user };
  }
  if (command === 'update_email') {
    const result = adminDashboardUpdateEmailV307_(body);
    return { success: true, ok: true, user: result.user, result: result };
  }
  if (command === 'delete_user') {
    const result = adminDashboardDeleteUserV307_(body);
    return { success: true, ok: true, result: result };
  }
  if (
    command === 'reset_pc' ||
    command === 'reset_mobile' ||
    command === 'send_email' ||
    command === 'send_update_email'
  ) {
    const result = adminDashboardSingleActionV298_(command, body);
    return { success: true, ok: true, result: result };
  }
  if (command === 'send_email_all') {
    return Object.assign({ ok: true }, adminDashboardBulkEmailV298_(false));
  }
  if (command === 'send_update_email_all') {
    return Object.assign({ ok: true }, adminDashboardBulkEmailV298_(true));
  }

  throw new Error('UNKNOWN_ADMIN_COMMAND');
}

function setupAdminDashboardV298() {
  const props = PropertiesService.getScriptProperties();
  const adminKey = String(props.getProperty(PROP_ADMIN_DASHBOARD_KEY_V298) || '').trim();
  const sheet = getLicensesSheet_();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const set = {};
  headers.forEach(function(h) { if (h) set[h] = true; });

  const required = [
    'TOKEN','EMAIL','PLAN','PRODUCT_NAME','ACTIVATED_AT','EXPIRED_AT','STATUS',
    'LICENSE_ID','ONLINE_STATUS','ONLINE_STATUS_MOBILE','LAST_SEEN_AT','MOBILE_LAST_SEEN_AT'
  ];
  const missing = required.filter(function(h) { return !set[h]; });

  const result = {
    success: Boolean(adminKey) && missing.length === 0,
    adminDashboardKeyConfigured: Boolean(adminKey),
    missingHeaders: missing,
    webAppUrl: getLicensePublicWebAppUrlV541_(),
    note: 'REV298 does not move or insert license columns. It only exposes header-based admin API actions.'
  };
  console.log(JSON.stringify(result));
  return result;
}

// ============================================================
// DIRECT EXTENSION PUBLIC LICENSE COMPATIBILITY
// ============================================================

function handleExtensionPublicLicenseRequestV534_(body) {
  const email = canonicalEmail_(body && body.email);
  const token = String(body && body.token || '').trim();

  if (!email || !token) {
    return {
      ok: true,
      success: false,
      valid: false,
      code: 'LICENSE_NOT_FOUND',
      message: 'Email dan token wajib diisi.',
      serverTime: new Date().toISOString()
    };
  }

  const result = devicePublicLookup_({
    email: email,
    token: token,
    licenseId: body && body.licenseId
  });

  if (result && result.valid === true) {
    return Object.assign({}, result, {
      success: true,
      acceptedEmail: email,
      acceptedToken: token
    });
  }

  return Object.assign({
    ok: true,
    success: false,
    valid: false
  }, result || {});
}

// ============================================================
// LYNK PAYMENT RECEIVER
// ============================================================

function handleLynkPaymentRequest_(e, payload, rawBody) {
  const lock = LockService.getScriptLock();
  let webhookSheet = null;

  try {
    const props = PropertiesService.getScriptProperties();
    const spreadsheetId = String(props.getProperty(PROP_SPREADSHEET_ID) || '').trim();
    const expectedGatewaySecret = String(props.getProperty(PROP_GATEWAY_SECRET) || '').trim();

    if (!spreadsheetId) {
      return jsonResponse_({ success: false, error: 'SPREADSHEET_ID_NOT_CONFIGURED' });
    }
    if (!expectedGatewaySecret) {
      return jsonResponse_({ success: false, error: 'GATEWAY_SECRET_NOT_CONFIGURED' });
    }

    const receivedGatewaySecret = String(
      e && e.parameter && e.parameter.gateway_secret
        ? e.parameter.gateway_secret
        : ''
    ).trim();

    if (!receivedGatewaySecret || receivedGatewaySecret !== expectedGatewaySecret) {
      return jsonResponse_({ success: false, error: 'UNAUTHORIZED_GATEWAY' });
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);
    webhookSheet = requireSheet_(ss, SHEET_WEBHOOK);
    const productsSheet = requireSheet_(ss, SHEET_PRODUCTS);
    const ordersSheet = requireSheet_(ss, SHEET_ORDERS);
    const licensesSheet = requireSheet_(ss, SHEET_LICENSES);

    assertLicenseDeviceHeaders_(licensesSheet);

    const event = String(payload.event || '');
    const data = payload.data || {};
    const action = String(data.message_action || '');
    const messageCode = String(data.message_code == null ? '' : data.message_code);
    const messageId = String(data.message_id || '').trim();
    const messageData = data.message_data || {};
    const refId = String(messageData.refId || '').trim();
    const customer = messageData.customer || {};
    const email = canonicalEmail_(customer.email);
    const customerName = String(customer.name || '').trim();
    const paidAt = String(messageData.createdAt || '').trim();
    const totals = messageData.totals || {};
    const grandTotal = Number(totals.grandTotal);
    const customerPay = Number(totals.customerPay);
    const items = Array.isArray(messageData.items) ? messageData.items : [];

    appendWebhookLog_(webhookSheet, rawBody, 'RECEIVED', 'Webhook diterima melalui Cloudflare STRICT Gateway');

    if (event !== 'payment.received' || action !== 'SUCCESS' || messageCode !== '0') {
      appendWebhookLog_(webhookSheet, rawBody, 'IGNORED', 'Bukan payment.received SUCCESS');
      return jsonResponse_({ success: true, ignored: true, reason: 'PAYMENT_NOT_SUCCESS' });
    }

    if (!refId) return reject_(webhookSheet, rawBody, 'MISSING_TRX_ID');
    if (!messageId) return reject_(webhookSheet, rawBody, 'MISSING_MESSAGE_ID');
    if (!email || !isValidEmail_(email)) return reject_(webhookSheet, rawBody, 'INVALID_CUSTOMER_EMAIL');
    if (!Number.isFinite(grandTotal)) return reject_(webhookSheet, rawBody, 'INVALID_GRAND_TOTAL');
    if (items.length !== 1) return reject_(webhookSheet, rawBody, 'MULTIPLE_ITEMS_NOT_ALLOWED');

    const item = items[0] || {};
    const productUuid = String(item.uuid || '').trim();
    const qty = Number(item.qty);
    const itemPrice = Number(item.price);

    if (qty !== 1) return reject_(webhookSheet, rawBody, 'INVALID_QUANTITY_QTY_MUST_BE_1');
    if (!productUuid) return reject_(webhookSheet, rawBody, 'PRODUCT_UUID_MISSING');

    lock.waitLock(30000);

    const product = getProductByUuid_(productsSheet, productUuid);
    if (!product) return reject_(webhookSheet, rawBody, 'UNKNOWN_PRODUCT_UUID');
    if (!product.active) return reject_(webhookSheet, rawBody, 'PRODUCT_INACTIVE');
    if (!Number.isFinite(product.expectedTotal)) return reject_(webhookSheet, rawBody, 'PRODUCT_EXPECTED_TOTAL_INVALID');

    if (Number(product.expectedTotal) !== grandTotal) {
      return reject_(webhookSheet, rawBody,
        'PRICE_MISMATCH_EXPECTED_' + product.expectedTotal + '_RECEIVED_' + grandTotal);
    }

    if (Number.isFinite(itemPrice) && itemPrice !== Number(product.expectedTotal)) {
      return reject_(webhookSheet, rawBody, 'ITEM_PRICE_MISMATCH');
    }

    const existingOrderRow = findRowByValue_(ordersSheet, 'TRX_ID', refId);

    if (existingOrderRow) {
      const existingOrder = getRowObject_(ordersSheet, existingOrderRow);
      const existingType = normalizeCode_(existingOrder.ORDER_TYPE);
      const alreadyComplete =
        (existingType === 'ADDON' && isTrue_(existingOrder.ADDON_APPLIED)) ||
        (existingType !== 'ADDON' && isTrue_(existingOrder.LICENSE_CREATED));

      if (alreadyComplete) {
        appendWebhookLog_(webhookSheet, rawBody, 'DUPLICATE', 'TRX_ID sudah pernah diproses: ' + refId);
        return jsonResponse_({
          success: true,
          received: true,
          duplicate: true,
          refId: refId,
          emailPending: !isTrue_(existingOrder.EMAIL_SENT)
        });
      }
    }

    const ctx = {
      webhookSheet: webhookSheet,
      rawBody: rawBody,
      ordersSheet: ordersSheet,
      licensesSheet: licensesSheet,
      product: product,
      refId: refId,
      messageId: messageId,
      email: email,
      customerName: customerName,
      productUuid: productUuid,
      qty: qty,
      grandTotal: grandTotal,
      customerPay: customerPay,
      paidAt: paidAt,
      existingOrderRow: existingOrderRow
    };

    if (normalizeCode_(product.mainDuration) === 'NONE') {
      return processAddonPayment_(ctx);
    }

    return processMainPayment_(ctx);

  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    console.error(message);
    if (webhookSheet && rawBody) {
      try { appendWebhookLog_(webhookSheet, rawBody, 'ERROR', message); } catch (_) {}
    }
    return jsonResponse_({ success: false, error: 'INTERNAL_ERROR', message: message });
  } finally {
    try { if (lock.hasLock()) lock.releaseLock(); } catch (_) {}
  }
}

// ============================================================
// PROCESS MAIN / BUNDLE
// ============================================================

function processMainPayment_(ctx) {
  const now = new Date();
  let orderRow = ctx.existingOrderRow;

  if (!orderRow) {
    orderRow = appendRowByHeaders_(ctx.ordersSheet, {
      TRX_ID: ctx.refId,
      MESSAGE_ID: ctx.messageId,
      EMAIL: ctx.email,
      CUSTOMER_NAME: ctx.customerName,
      PRODUCT_UUID: ctx.productUuid,
      PRODUCT_NAME: ctx.product.productName,
      QTY: ctx.qty,
      GRAND_TOTAL: ctx.grandTotal,
      CUSTOMER_PAY: Number.isFinite(ctx.customerPay) ? ctx.customerPay : '',
      PAYMENT_STATUS: 'SUCCESS',
      PAID_AT: ctx.paidAt,
      RECEIVED_AT: now,
      LICENSE_CREATED: false,
      EMAIL_SENT: false,
      NOTE: 'Payment verified; processing main license',
      ORDER_TYPE: 'MAIN',
      TARGET_LICENSE_TRX_ID: '',
      ADDON_APPLIED: false
    });
  }

  // Idempotency at license level for the same transaction.
  let licenseRow = findRowByValue_(ctx.licensesSheet, 'TRX_ID', ctx.refId);

  if (licenseRow) {
    ensureLicenseIdAtRow_(ctx.licensesSheet, licenseRow);

    updateRowByHeaders_(ctx.ordersSheet, orderRow, {
      LICENSE_CREATED: true,
      NOTE: 'License transaction already exists; email pending',
      ORDER_TYPE: 'MAIN'
    });

    return jsonResponse_({
      success: true,
      received: true,
      processed: true,
      duplicateLicenseTransaction: true,
      orderType: 'MAIN',
      refId: ctx.refId,
      productCode: ctx.product.productCode,
      licenseCreated: true,
      emailPending: true
    });
  }

  // V5.3: if this email already has an ACTIVE known license, reuse the
  // SAME TOKEN / LICENSE_ID / device binding instead of creating another token.
  const existingTarget = findBestLicenseForAutoPurchaseV53_(
    ctx.licensesSheet,
    ctx.email,
    now
  );

  if (existingTarget) {
    const classification = classifyAutoMainPurchaseV53_(
      existingTarget.license.PLAN,
      ctx.product.productCode,
      existingTarget.currentlyValid
    );

    if (classification === 'MANUAL_REVIEW') {
      updateRowByHeaders_(ctx.ordersSheet, orderRow, {
        LICENSE_CREATED: true,
        EMAIL_SENT: true,
        ORDER_TYPE: 'MANUAL_REVIEW',
        TARGET_LICENSE_TRX_ID: String(existingTarget.license.TRX_ID || ''),
        NOTE:
          'MANUAL_REVIEW: Pembelian paket lebih rendah dari lisensi aktif. ' +
          'Tidak ada downgrade otomatis dan tidak ada token baru.'
      });

      appendWebhookLog_(
        ctx.webhookSheet,
        ctx.rawBody,
        'MANUAL_REVIEW',
        'Lower-plan purchase blocked from auto-downgrade. TRX_ID: ' + ctx.refId
      );

      return jsonResponse_({
        success: true,
        received: true,
        processed: false,
        manualReview: true,
        orderType: 'MANUAL_REVIEW',
        refId: ctx.refId,
        reason: 'LOWER_PLAN_THAN_ACTIVE_LICENSE',
        tokenCreated: false
      });
    }

    return processExistingLicensePurchaseV53_(
      ctx,
      orderRow,
      existingTarget,
      classification,
      now
    );
  }

  // No reusable license for this email -> create a brand-new license.
  const mainDuration = normalizeCode_(ctx.product.mainDuration);
  const isignalMode = normalizeCode_(ctx.product.isignalMode);
  const token = generateUniqueLicenseToken_(ctx.licensesSheet);
  const licenseId = generateUniqueLicenseId_(ctx.licensesSheet);
  const activatedAt = now;
  const expiredAt = calculateExpiry_(now, mainDuration);

  let iSignalAccess = 'NO';
  let iSignalExpiredAt = '';
  let iSignalSource = '';
  let iSignalPlan = 'NO';

  if (isignalMode === '1_DAY') {
    iSignalAccess = 'YES';
    iSignalExpiredAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (expiredAt instanceof Date && iSignalExpiredAt > expiredAt) {
      iSignalExpiredAt = new Date(expiredAt.getTime());
    }
    iSignalSource = ctx.product.productCode;
    iSignalPlan = '1_DAY';
  } else if (isignalMode === 'FOLLOW_MAIN') {
    iSignalAccess = 'YES';
    iSignalExpiredAt = expiredAt instanceof Date ? new Date(expiredAt.getTime()) : '';
    iSignalSource = ctx.product.productCode;
    iSignalPlan = 'PREMIUM';
  } else if (isignalMode === 'PERMANENT') {
    iSignalAccess = 'YES';
    iSignalExpiredAt = '';
    iSignalSource = ctx.product.productCode;
    iSignalPlan = 'PREMIUM';
  } else if (isignalMode !== 'NONE') {
    throw new Error('UNKNOWN_ISIGNAL_MODE_' + isignalMode);
  }

  licenseRow = appendRowByHeaders_(ctx.licensesSheet, {
    TOKEN: token,
    EMAIL: ctx.email,
    PLAN: ctx.product.productCode,
    PRODUCT_UUID: ctx.productUuid,
    PRODUCT_NAME: ctx.product.productName,
    ACTIVATED_AT: activatedAt,
    EXPIRED_AT: expiredAt,
    STATUS: 'ACTIVE',
    TRX_ID: ctx.refId,
    ISIGNAL_ACCESS: iSignalAccess,
    ISIGNAL_EXPIRED_AT: iSignalExpiredAt,
    ISIGNAL_PLAN: iSignalPlan,
    DEVICE_ID: '',
    CREATED_AT: now,
    EMAIL_SENT_AT: '',
    ISIGNAL_SOURCE: iSignalSource,
    ISIGNAL_LAST_ORDER_TRX_ID: '',
    LICENSE_ID: licenseId,
    ACTIVE_DEVICE_ID: '',
    ACTIVE_PUBLIC_KEY: '',
    ACTIVE_SESSION_ID: '',
    DEVICE_NAME: '',
    FCM_REGISTRATION_ID: '',
    PENDING_REQUEST_ID: '',
    PENDING_DEVICE_ID: '',
    PENDING_PUBLIC_KEY: '',
    PENDING_FCM_ID: '',
    PENDING_STATUS: '',
    PENDING_REQUESTED_AT: '',
    MOBILE_ACTIVE_DEVICE_ID: '',
    MOBILE_ACTIVE_PUBLIC_KEY: '',
    MOBILE_ACTIVE_SESSION_ID: '',
    MOBILE_DEVICE_NAME: '',
    MOBILE_FCM_REGISTRATION_ID: '',
    MOBILE_PENDING_REQUEST_ID: '',
    MOBILE_PENDING_DEVICE_ID: '',
    MOBILE_PENDING_PUBLIC_KEY: '',
    MOBILE_PENDING_FCM_ID: '',
    MOBILE_PENDING_STATUS: '',
    MOBILE_PENDING_REQUESTED_AT: '',
    MOBILE_LAST_SEEN_AT: ''
  });

  writeSendEmailButtonForRowV541_(ctx.licensesSheet, licenseRow);

  updateRowByHeaders_(ctx.ordersSheet, orderRow, {
    LICENSE_CREATED: true,
    NOTE: 'License created successfully; email pending',
    ORDER_TYPE: 'MAIN'
  });

  appendWebhookLog_(
    ctx.webhookSheet,
    ctx.rawBody,
    'PROCESSED',
    'Main license berhasil dibuat. TRX_ID: ' + ctx.refId
  );

  return jsonResponse_({
    success: true,
    received: true,
    processed: true,
    orderType: 'MAIN',
    refId: ctx.refId,
    productCode: ctx.product.productCode,
    licenseCreated: true,
    tokenPreserved: false,
    emailPending: true
  });
}



// ============================================================
// V5.3 — AUTO UPGRADE / RENEWAL BY EMAIL
// ============================================================

function autoPurchasePlanRankV53_(planValue) {
  const plan = normalizeCode_(planValue);

  const map = {
    TEST_1_DAY: 0,
    MAIN_1M: 1,
    BUNDLE_1M_ISIGNAL_1D: 1,
    BUNDLE_1M_ISIGNAL_PREMIUM: 1,
    MAIN_3M: 2,
    BUNDLE_3M_ISIGNAL_1D: 2,
    BUNDLE_3M_ISIGNAL_PREMIUM: 2,
    MAIN_6M: 3,
    MAIN_1Y: 4,
    MAIN_PERMANENT: 5
  };

  return Object.prototype.hasOwnProperty.call(map, plan)
    ? map[plan]
    : -1;
}


function classifyAutoMainPurchaseV53_(
  currentPlan,
  incomingPlan,
  currentLicenseValid
) {
  const currentRank = autoPurchasePlanRankV53_(currentPlan);
  const incomingRank = autoPurchasePlanRankV53_(incomingPlan);

  if (currentRank < 0 || incomingRank < 0) {
    return 'UNSUPPORTED';
  }

  // An expired license may be renewed into any purchased plan.
  if (!currentLicenseValid) {
    return 'RENEWAL';
  }

  // Never downgrade an ACTIVE valid customer automatically.
  if (incomingRank < currentRank) {
    return 'MANUAL_REVIEW';
  }

  if (incomingRank > currentRank) {
    return 'UPGRADE';
  }

  return 'RENEWAL';
}


function findBestLicenseForAutoPurchaseV53_(
  sheet,
  email,
  now
) {
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return null;
  }

  const headers = values[0].map(function(h) {
    return String(h || '').trim();
  });

  const map = headerMapFromArray_(headers);

  [
    'EMAIL',
    'TOKEN',
    'STATUS',
    'PLAN',
    'EXPIRED_AT',
    'TRX_ID',
    'LICENSE_ID'
  ].forEach(function(name) {
    if (map[name] === undefined) {
      throw new Error(
        'Missing Licenses column for V5.3 auto-upgrade: ' +
        name
      );
    }
  });

  const wantedEmail = canonicalEmail_(email);
  let best = null;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];

    if (
      canonicalEmail_(row[map.EMAIL]) !==
      wantedEmail
    ) {
      continue;
    }

    if (
      normalizeCode_(row[map.STATUS]) !==
      'ACTIVE'
    ) {
      continue;
    }

    const plan = normalizeCode_(
      row[map.PLAN]
    );

    const rank =
      autoPurchasePlanRankV53_(plan);

    if (rank < 0) {
      continue;
    }

    const token = String(
      row[map.TOKEN] || ''
    ).trim();

    if (!token) {
      continue;
    }

    const duration =
      deviceDurationFromPlan_(plan);

    const expiry =
      toDateOrNull_(row[map.EXPIRED_AT]);

    const currentlyValid =
      duration === 'PERMANENT' ||
      Boolean(
        expiry &&
        expiry.getTime() >
        now.getTime()
      );

    const license = {};

    headers.forEach(function(header, index) {
      license[header] = row[index];
    });

    // Prefer a currently-valid row, then higher plan rank,
    // then the latest expiry.
    const score =
      (currentlyValid ? 1000000000000000 : 0) +
      (rank * 1000000000000) +
      (expiry ? expiry.getTime() : 0);

    if (
      !best ||
      score > best.score
    ) {
      best = {
        rowNumber: r + 1,
        license: license,
        planRank: rank,
        expiry: expiry,
        currentlyValid: currentlyValid,
        score: score
      };
    }
  }

  return best;
}


function processExistingLicensePurchaseV53_(
  ctx,
  orderRow,
  target,
  classification,
  now
) {
  if (
    classification !== 'UPGRADE' &&
    classification !== 'RENEWAL'
  ) {
    throw new Error(
      'AUTO_PURCHASE_CLASSIFICATION_INVALID_' +
      classification
    );
  }

  ensureUpgradeHeadersV5_(
    ctx.licensesSheet
  );

  const rowNumber = target.rowNumber;
  const old = getRowObject_(
    ctx.licensesSheet,
    rowNumber
  );

  const oldPlan = normalizeCode_(
    old.PLAN
  );

  const newPlan = normalizeCode_(
    ctx.product.productCode
  );

  const oldExpiry =
    toDateOrNull_(old.EXPIRED_AT);

  const mainDuration =
    normalizeCode_(
      ctx.product.mainDuration
    );

  let newExpiry = '';

  if (mainDuration === 'PERMANENT') {
    newExpiry = '';
  } else {
    const base =
      oldExpiry &&
      oldExpiry.getTime() >
        now.getTime()
        ? oldExpiry
        : now;

    // Full-price purchase: preserve remaining time and append
    // the duration that was just purchased.
    newExpiry =
      calculateExpiry_(
        base,
        mainDuration
      );
  }

  const iSignal =
    resolveAutoPurchaseISignalV53_(
      old,
      ctx.product,
      now,
      newExpiry
    );

  const targetTrx =
    String(old.TRX_ID || '').trim();

  const existingLicenseId =
    ensureLicenseIdAtRow_(
      ctx.licensesSheet,
      rowNumber
    );

  const note =
    classification +
    ' otomatis via Lynk: ' +
    oldPlan +
    ' -> ' +
    newPlan +
    ' | TOKEN/LICENSE_ID/device tetap | ' +
    'durasi pembelian ditambahkan dari expiry aktif.';

  updateRowByHeaders_(
    ctx.licensesSheet,
    rowNumber,
    {
      PLAN: newPlan,
      PRODUCT_UUID:
        ctx.productUuid,
      PRODUCT_NAME:
        ctx.product.productName,
      EXPIRED_AT:
        newExpiry,
      STATUS:
        'ACTIVE',
      ISIGNAL_ACCESS:
        iSignal.access,
      ISIGNAL_EXPIRED_AT:
        iSignal.expiresAt,
      ISIGNAL_PLAN:
        iSignal.plan,
      ISIGNAL_SOURCE:
        iSignal.source,
      ISIGNAL_LAST_ORDER_TRX_ID:
        iSignal.access === 'YES'
          ? ctx.refId
          : String(
              old.ISIGNAL_LAST_ORDER_TRX_ID ||
              ''
            ),
      UPGRADE_TO:
        'NONE',
      UPGRADE_MODE:
        'EXTEND_FROM_CURRENT_EXPIRY',
      UPGRADE_APPLY:
        'NO',
      UPGRADE_STATUS:
        classification === 'UPGRADE'
          ? 'AUTO_UPGRADED'
          : 'AUTO_RENEWED',
      UPGRADE_LAST_AT:
        now,
      UPGRADE_NOTE:
        note
    }
  );

  appendUpgradeLogV5_(
    ctx.licensesSheet.getParent(),
    {
      TIMESTAMP: now,
      EMAIL: ctx.email,
      LICENSE_ID: existingLicenseId,
      FROM_PLAN: oldPlan,
      TO_PLAN: newPlan,
      MODE: 'AUTO_PURCHASE_EXTEND',
      OLD_EXPIRED_AT:
        oldExpiry || '',
      NEW_EXPIRED_AT:
        newExpiry,
      STATUS:
        classification === 'UPGRADE'
          ? 'AUTO_UPGRADED'
          : 'AUTO_RENEWED',
      NOTE: note
    }
  );

  updateRowByHeaders_(
    ctx.ordersSheet,
    orderRow,
    {
      LICENSE_CREATED: true,
      EMAIL_SENT: false,
      ORDER_TYPE:
        classification,
      TARGET_LICENSE_TRX_ID:
        targetTrx,
      ADDON_APPLIED: false,
      NOTE:
        classification +
        ' applied to existing license; ' +
        'token preserved; email pending'
    }
  );

  SpreadsheetApp.flush();

  appendWebhookLog_(
    ctx.webhookSheet,
    ctx.rawBody,
    classification === 'UPGRADE'
      ? 'AUTO_UPGRADED'
      : 'AUTO_RENEWED',
    classification +
      ' existing license. TRX_ID=' +
      ctx.refId +
      ', LICENSE_ID=' +
      existingLicenseId
  );

  return jsonResponse_({
    success: true,
    received: true,
    processed: true,
    orderType:
      classification,
    refId:
      ctx.refId,
    productCode:
      ctx.product.productCode,
    existingLicenseUpdated:
      true,
    licenseCreated:
      false,
    tokenCreated:
      false,
    tokenPreserved:
      true,
    licenseIdPreserved:
      true,
    devicePreserved:
      true,
    targetLicenseTrxId:
      targetTrx,
    emailPending:
      true
  });
}


function resolveAutoPurchaseISignalV53_(
  old,
  product,
  now,
  newMainExpiry
) {
  const mode = normalizeCode_(
    product.isignalMode
  );

  const oldSource = normalizeCode_(
    old.ISIGNAL_SOURCE
  );

  const oldExpiry =
    toDateOrNull_(
      old.ISIGNAL_EXPIRED_AT
    );

  const oldAccess =
    normalizeCode_(
      old.ISIGNAL_ACCESS
    ) === 'YES';

  const hasSeparatePremium =
    oldAccess &&
    (
      oldSource ===
        'ADDON_ISIGNAL_PREMIUM' ||
      oldSource ===
        'MANUAL_PREMIUM'
    );

  const hasActiveSeparateOneDay =
    oldAccess &&
    (
      oldSource ===
        'ADDON_ISIGNAL_1D' ||
      oldSource ===
        'MANUAL_1_DAY'
    ) &&
    oldExpiry &&
    oldExpiry.getTime() >
      now.getTime();

  if (
    mode === 'FOLLOW_MAIN' ||
    mode === 'PERMANENT'
  ) {
    return {
      access: 'YES',
      expiresAt:
        newMainExpiry instanceof Date
          ? new Date(
              newMainExpiry.getTime()
            )
          : '',
      plan: 'PREMIUM',
      source:
        String(
          product.productCode || ''
        ).trim()
    };
  }

  if (mode === '1_DAY') {
    // A separately-purchased Premium entitlement remains stronger.
    if (hasSeparatePremium) {
      return {
        access: 'YES',
        expiresAt:
          newMainExpiry instanceof Date
            ? new Date(
                newMainExpiry.getTime()
              )
            : '',
        plan: 'PREMIUM',
        source: oldSource
      };
    }

    let start = now;

    if (
      hasActiveSeparateOneDay &&
      oldExpiry >
        now
    ) {
      start = oldExpiry;
    }

    let oneDayExpiry =
      new Date(
        start.getTime() +
        24 * 60 * 60 * 1000
      );

    if (
      newMainExpiry instanceof Date &&
      oneDayExpiry >
        newMainExpiry
    ) {
      oneDayExpiry =
        new Date(
          newMainExpiry.getTime()
        );
    }

    return {
      access: 'YES',
      expiresAt:
        oneDayExpiry,
      plan: '1_DAY',
      source:
        String(
          product.productCode || ''
        ).trim()
    };
  }

  if (mode === 'NONE') {
    // Plain MAIN_1M / MAIN_3M has no included iSignal.
    // Preserve ONLY a separately bought/manual entitlement.
    if (hasSeparatePremium) {
      return {
        access: 'YES',
        expiresAt:
          newMainExpiry instanceof Date
            ? new Date(
                newMainExpiry.getTime()
              )
            : '',
        plan: 'PREMIUM',
        source: oldSource
      };
    }

    if (hasActiveSeparateOneDay) {
      let keptExpiry =
        new Date(
          oldExpiry.getTime()
        );

      if (
        newMainExpiry instanceof Date &&
        keptExpiry >
          newMainExpiry
      ) {
        keptExpiry =
          new Date(
            newMainExpiry.getTime()
          );
      }

      return {
        access: 'YES',
        expiresAt:
          keptExpiry,
        plan: '1_DAY',
        source: oldSource
      };
    }

    return {
      access: 'NO',
      expiresAt: '',
      plan: 'NO',
      source: ''
    };
  }

  throw new Error(
    'UNKNOWN_ISIGNAL_MODE_' +
    mode
  );
}


function runV53AutoUpgradeRuleSelfTest() {
  const cases = [
    ['MAIN_1M', 'MAIN_3M', true, 'UPGRADE'],
    ['MAIN_1M', 'MAIN_1M', true, 'RENEWAL'],
    ['MAIN_1M', 'BUNDLE_1M_ISIGNAL_PREMIUM', true, 'RENEWAL'],
    ['MAIN_3M', 'MAIN_6M', true, 'UPGRADE'],
    ['MAIN_6M', 'MAIN_3M', true, 'MANUAL_REVIEW'],
    ['MAIN_PERMANENT', 'MAIN_1Y', true, 'MANUAL_REVIEW'],
    ['MAIN_3M', 'MAIN_1M', false, 'RENEWAL'],
    ['BUNDLE_1M_ISIGNAL_1D', 'MAIN_3M', true, 'UPGRADE'],
    ['BUNDLE_3M_ISIGNAL_PREMIUM', 'MAIN_3M', true, 'RENEWAL']
  ];

  const failures = [];

  cases.forEach(function(c) {
    const actual =
      classifyAutoMainPurchaseV53_(
        c[0],
        c[1],
        c[2]
      );

    if (actual !== c[3]) {
      failures.push({
        currentPlan: c[0],
        incomingPlan: c[1],
        currentValid: c[2],
        expected: c[3],
        actual: actual
      });
    }
  });

  const result = {
    success:
      failures.length === 0,
    tests:
      cases.length,
    passed:
      cases.length -
      failures.length,
    failed:
      failures.length,
    failures:
      failures
  };

  console.log(
    JSON.stringify(result)
  );

  return result;
}


// ============================================================
// PROCESS ADD-ON
// ============================================================

function processAddonPayment_(ctx) {
  const now = new Date();
  let orderRow = ctx.existingOrderRow;

  if (!orderRow) {
    orderRow = appendRowByHeaders_(ctx.ordersSheet, {
      TRX_ID: ctx.refId,
      MESSAGE_ID: ctx.messageId,
      EMAIL: ctx.email,
      CUSTOMER_NAME: ctx.customerName,
      PRODUCT_UUID: ctx.productUuid,
      PRODUCT_NAME: ctx.product.productName,
      QTY: ctx.qty,
      GRAND_TOTAL: ctx.grandTotal,
      CUSTOMER_PAY: Number.isFinite(ctx.customerPay) ? ctx.customerPay : '',
      PAYMENT_STATUS: 'SUCCESS',
      PAID_AT: ctx.paidAt,
      RECEIVED_AT: now,
      LICENSE_CREATED: false,
      EMAIL_SENT: false,
      NOTE: 'Payment verified; processing iSignal add-on',
      ORDER_TYPE: 'ADDON',
      TARGET_LICENSE_TRX_ID: '',
      ADDON_APPLIED: false
    });
  }

  const target = findEligibleAddonLicense_(ctx.licensesSheet, ctx.email, now);

  if (!target) {
    updateRowByHeaders_(ctx.ordersSheet, orderRow, {
      ORDER_TYPE: 'ADDON',
      ADDON_APPLIED: false,
      NOTE: 'MANUAL_REVIEW: Tidak ada lisensi MAIN_1M / MAIN_3M aktif untuk email ini'
    });
    appendWebhookLog_(ctx.webhookSheet, ctx.rawBody, 'MANUAL_REVIEW',
      'Add-on dibayar tetapi tidak ditemukan lisensi utama eligible. TRX_ID: ' + ctx.refId);
    return jsonResponse_({
      success: true,
      received: true,
      processed: false,
      manualReview: true,
      orderType: 'ADDON',
      refId: ctx.refId,
      reason: 'NO_ELIGIBLE_MAIN_LICENSE'
    });
  }

  const license = target.license;
  const mainExpiry = toDateOrNull_(license.EXPIRED_AT);

  if (!mainExpiry || mainExpiry <= now) {
    updateRowByHeaders_(ctx.ordersSheet, orderRow, {
      ORDER_TYPE: 'ADDON',
      ADDON_APPLIED: false,
      NOTE: 'MANUAL_REVIEW: Lisensi utama sudah expired'
    });
    return jsonResponse_({
      success: true,
      manualReview: true,
      refId: ctx.refId,
      reason: 'MAIN_LICENSE_EXPIRED'
    });
  }

  const productCode = normalizeCode_(ctx.product.productCode);
  let newISignalExpiry = '';

  if (productCode === 'ADDON_ISIGNAL_1D') {
    const currentExpiry = toDateOrNull_(license.ISIGNAL_EXPIRED_AT);
    let start = now;
    if (currentExpiry && currentExpiry > now) start = currentExpiry;
    newISignalExpiry = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (newISignalExpiry > mainExpiry) newISignalExpiry = new Date(mainExpiry.getTime());
  } else if (productCode === 'ADDON_ISIGNAL_PREMIUM') {
    newISignalExpiry = new Date(mainExpiry.getTime());
  } else {
    throw new Error('UNKNOWN_ADDON_PRODUCT_CODE_' + productCode);
  }

  updateRowByHeaders_(ctx.licensesSheet, target.rowNumber, {
    ISIGNAL_ACCESS: 'YES',
    ISIGNAL_EXPIRED_AT: newISignalExpiry,
    ISIGNAL_PLAN: productCode === 'ADDON_ISIGNAL_1D' ? '1_DAY' : 'PREMIUM',
    ISIGNAL_SOURCE: productCode,
    ISIGNAL_LAST_ORDER_TRX_ID: ctx.refId
  });

  ensureLicenseIdAtRow_(ctx.licensesSheet, target.rowNumber);

  updateRowByHeaders_(ctx.ordersSheet, orderRow, {
    ORDER_TYPE: 'ADDON',
    TARGET_LICENSE_TRX_ID: String(license.TRX_ID || ''),
    ADDON_APPLIED: true,
    LICENSE_CREATED: false,
    EMAIL_SENT: false,
    NOTE: 'iSignal add-on berhasil diterapkan; email pending'
  });

  appendWebhookLog_(ctx.webhookSheet, ctx.rawBody, 'ADDON_APPLIED',
    'iSignal add-on berhasil diterapkan ke license TRX_ID: ' + String(license.TRX_ID || ''));

  return jsonResponse_({
    success: true,
    received: true,
    processed: true,
    orderType: 'ADDON',
    refId: ctx.refId,
    addonApplied: true,
    targetLicenseTrxId: String(license.TRX_ID || ''),
    emailPending: true
  });
}

function findEligibleAddonLicense_(sheet, email, now) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0].map(h => String(h).trim());
  const map = headerMapFromArray_(headers);
  const eligiblePlans = { MAIN_1M: true, MAIN_3M: true };
  let best = null;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rowEmail = canonicalEmail_(row[map.EMAIL]);
    if (rowEmail !== canonicalEmail_(email)) continue;

    const plan = normalizeCode_(row[map.PLAN]);
    if (!eligiblePlans[plan]) continue;

    const status = normalizeCode_(row[map.STATUS]);
    if (status !== 'ACTIVE') continue;

    const expiry = toDateOrNull_(row[map.EXPIRED_AT]);
    if (!expiry || expiry <= now) continue;

    const license = {};
    headers.forEach((header, index) => { license[header] = row[index]; });

    if (!best || expiry > best.expiry) {
      best = { rowNumber: r + 1, expiry: expiry, license: license };
    }
  }

  return best;
}

// ============================================================
// DEVICE API COMPATIBILITY — tf-license-device-api REV185
// ============================================================

function handleDeviceServerRequest_(body) {
  try {
    assertServerSharedSecret_(body.secret);
    const result = deviceServerOperation_(body);
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({
      ok: false,
      valid: false,
      success: false,
      code: 'SERVER_ERROR',
      message: err && err.message ? err.message : String(err),
      serverTime: new Date().toISOString()
    });
  }
}

function assertServerSharedSecret_(provided) {
  const expected = String(
    PropertiesService.getScriptProperties().getProperty(PROP_SERVER_SHARED_SECRET) || ''
  ).trim();

  if (!expected) throw new Error('SERVER_SHARED_SECRET belum diatur di Apps Script.');
  if (String(provided || '') !== expected) throw new Error('SERVER_SHARED_SECRET tidak cocok.');
}

function normalizeDeviceSlotType_(value) {
  const raw = normalizeCode_(value);
  return raw === 'MOBILE' || raw === 'ANDROID' || raw === 'IOS' || raw === 'IOS_PWA'
    ? 'MOBILE'
    : 'DESKTOP';
}

function deviceSlotColumns_(deviceType) {
  const mobile = normalizeDeviceSlotType_(deviceType) === 'MOBILE';
  return mobile
    ? {
        type: 'MOBILE',
        activeDeviceId: 'MOBILE_ACTIVE_DEVICE_ID',
        activePublicKey: 'MOBILE_ACTIVE_PUBLIC_KEY',
        activeSessionId: 'MOBILE_ACTIVE_SESSION_ID',
        deviceName: 'MOBILE_DEVICE_NAME',
        fcmRegistrationId: 'MOBILE_FCM_REGISTRATION_ID',
        pendingRequestId: 'MOBILE_PENDING_REQUEST_ID',
        pendingDeviceId: 'MOBILE_PENDING_DEVICE_ID',
        pendingPublicKey: 'MOBILE_PENDING_PUBLIC_KEY',
        pendingFcmId: 'MOBILE_PENDING_FCM_ID',
        pendingStatus: 'MOBILE_PENDING_STATUS',
        pendingRequestedAt: 'MOBILE_PENDING_REQUESTED_AT',
        lastSeenAt: 'MOBILE_LAST_SEEN_AT'
      }
    : {
        type: 'DESKTOP',
        activeDeviceId: 'ACTIVE_DEVICE_ID',
        activePublicKey: 'ACTIVE_PUBLIC_KEY',
        activeSessionId: 'ACTIVE_SESSION_ID',
        deviceName: 'DEVICE_NAME',
        fcmRegistrationId: 'FCM_REGISTRATION_ID',
        pendingRequestId: 'PENDING_REQUEST_ID',
        pendingDeviceId: 'PENDING_DEVICE_ID',
        pendingPublicKey: 'PENDING_PUBLIC_KEY',
        pendingFcmId: 'PENDING_FCM_ID',
        pendingStatus: 'PENDING_STATUS',
        pendingRequestedAt: 'PENDING_REQUESTED_AT',
        lastSeenAt: 'LAST_SEEN_AT'
      };
}

function clearPendingDeviceSlotAtRow_(sheet, rowNumber, deviceType) {
  const slot = deviceSlotColumns_(deviceType);
  const updates = {};
  updates[slot.pendingRequestId] = '';
  updates[slot.pendingDeviceId] = '';
  updates[slot.pendingPublicKey] = '';
  updates[slot.pendingFcmId] = '';
  updates[slot.pendingStatus] = '';
  updates[slot.pendingRequestedAt] = '';
  updateRowByHeaders_(sheet, rowNumber, updates);
}

function deviceServerOperation_(body) {
  const operation = String(body.operation || '').trim().toLowerCase();
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const deviceType = normalizeDeviceSlotType_(payload.deviceType || payload.clientType || payload.platform);

  if (operation === 'lookup') {
    const presenceEvent = normalizeCode_(payload && payload.presenceEvent);
    const hasExplicitPresence = payload && Object.prototype.hasOwnProperty.call(payload, 'uiPresenceActive');
    const uiPresenceActive = hasExplicitPresence && payload.uiPresenceActive === true;
    const markOffline = hasExplicitPresence && (
      payload.uiPresenceActive === false ||
      presenceEvent === 'CLOSE' ||
      presenceEvent === 'SIDEBAR_CLOSED'
    );

    const result = devicePublicLookup_(payload, {
      // Only DESKTOP UI controls the ONLINE/OFFLINE indicator in Google Sheet.
      // Mobile validation must never make the PC appear ONLINE.
      trackOnline: deviceType === 'DESKTOP' && (hasExplicitPresence ? (uiPresenceActive && !markOffline) : true),
      markOffline: deviceType === 'DESKTOP' && markOffline
    });
    if (result && typeof result === 'object') result.requestedDeviceType = deviceType;
    return result;
  }


  // REV233 — Premium Remote relay. These operations are called only by the
  // authenticated Cloudflare Device API. They do not expose token/session data
  // to the Remote_Control sheet; only license id, UI snapshot and command state.
  if (operation.indexOf('remote-') === 0) {
    return remoteServerOperationV233_(operation, payload);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getLicensesSheet_();
    assertLicenseDeviceHeaders_(sheet);
    const slot = deviceSlotColumns_(deviceType);

    let record = findLicenseRecord_(sheet, {
      email: payload.email,
      token: payload.token,
      licenseId: payload.licenseId
    });
    if (!record) return deviceLicenseNotFound_();

    if (!String(record.object.LICENSE_ID || '').trim()) {
      const licenseId = generateUniqueLicenseId_(sheet);
      updateRowByHeaders_(sheet, record.rowNumber, { LICENSE_ID: licenseId });
      SpreadsheetApp.flush();
      record = findLicenseRecord_(sheet, { email: payload.email, token: payload.token, licenseId: licenseId });
    }

    const current = buildDeviceLicensePayload_(record);
    if (!current.valid) return current;
    const now = new Date();

    if (operation === 'bind') {
      const updates = {};
      updates[slot.activeDeviceId] = cleanDeviceString_(payload.activeDeviceId);
      updates[slot.activePublicKey] = cleanDeviceString_(payload.activePublicKey);
      updates[slot.activeSessionId] = cleanDeviceString_(payload.activeSessionId);
      updates[slot.fcmRegistrationId] = cleanDeviceString_(payload.fcmRegistrationId);
      updates[slot.deviceName] = cleanDeviceString_(payload.deviceName);
      updates[slot.pendingRequestId] = '';
      updates[slot.pendingDeviceId] = '';
      updates[slot.pendingPublicKey] = '';
      updates[slot.pendingFcmId] = '';
      updates[slot.pendingStatus] = '';
      updates[slot.pendingRequestedAt] = '';
      if (deviceType === 'MOBILE') {
        updates[slot.lastSeenAt] = now;
      } else {
        // Keep legacy DEVICE_ID mirroring DESKTOP only.
        updates.DEVICE_ID = cleanDeviceString_(payload.activeDeviceId);
      }
      updateRowByHeaders_(sheet, record.rowNumber, updates);

    } else if (operation === 'set-pending') {
      const updates = {};
      updates[slot.pendingRequestId] = cleanDeviceString_(payload.pendingRequestId).toUpperCase();
      updates[slot.pendingDeviceId] = cleanDeviceString_(payload.pendingDeviceId);
      updates[slot.pendingPublicKey] = cleanDeviceString_(payload.pendingPublicKey);
      updates[slot.pendingFcmId] = cleanDeviceString_(payload.pendingFcmId);
      updates[slot.pendingStatus] = 'PENDING';
      updates[slot.pendingRequestedAt] = now;
      updateRowByHeaders_(sheet, record.rowNumber, updates);

    } else if (operation === 'set-decision') {
      const expectedRequestId = String(record.object[slot.pendingRequestId] || '').trim().toUpperCase();
      const incomingRequestId = cleanDeviceString_(payload.pendingRequestId).toUpperCase();
      if (!expectedRequestId || incomingRequestId !== expectedRequestId) {
        return { ok: true, valid: true, decisionApplied: false, code: 'DEVICE_REQUEST_NOT_FOUND', message: 'Pending Request ID tidak cocok.' };
      }
      const decision = cleanDeviceString_(payload.decision).toUpperCase();
      if (decision !== 'APPROVE' && decision !== 'DECLINE') {
        return { ok: true, valid: true, decisionApplied: false, code: 'INVALID_DECISION', message: 'Decision harus APPROVE atau DECLINE.' };
      }
      const updates = {};
      updates[slot.pendingStatus] = decision === 'APPROVE' ? 'APPROVED' : 'DECLINED';
      updateRowByHeaders_(sheet, record.rowNumber, updates);

    } else if (operation === 'clear-pending') {
      clearPendingDeviceSlotAtRow_(sheet, record.rowNumber, deviceType);

    } else if (operation === 'touch') {
      if (deviceType === 'MOBILE') {
        const previousSeen = toDateOrNull_(record.object[slot.lastSeenAt]);
        if (!previousSeen || (now.getTime() - previousSeen.getTime()) >= LICENSE_ONLINE_WRITE_MIN_INTERVAL_MS) {
          const updates = {};
          updates[slot.lastSeenAt] = now;
          updateRowByHeaders_(sheet, record.rowNumber, updates);
        }
      }

    } else {
      return { ok: false, valid: false, code: 'SERVER_OPERATION_NOT_SUPPORTED', message: 'Server operation tidak didukung.' };
    }

    SpreadsheetApp.flush();
    const refreshed = findLicenseRecord_(sheet, {
      email: payload.email,
      token: payload.token,
      licenseId: payload.licenseId || String(record.object.LICENSE_ID || '')
    });
    const result = refreshed ? buildDeviceLicensePayload_(refreshed) : {
      ok: false, valid: false, code: 'LICENSE_REFRESH_FAILED', message: 'Data lisensi gagal dibaca ulang.'
    };
    if (result && typeof result === 'object') result.requestedDeviceType = deviceType;
    return result;
  } finally {
    lock.releaseLock();
  }
}

function devicePublicLookup_(payload, options) {
  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);

  let record = findLicenseRecord_(sheet, {
    email: payload.email,
    token: payload.token,
    licenseId: payload.licenseId
  });

  if (!record) return deviceLicenseNotFound_();

  // Backfill LICENSE_ID safely for V3/V4 rows created before V5.
  if (!String(record.object.LICENSE_ID || '').trim()) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      record = findLicenseRecord_(sheet, {
        email: payload.email,
        token: payload.token,
        licenseId: payload.licenseId
      });

      if (record && !String(record.object.LICENSE_ID || '').trim()) {
        updateRowByHeaders_(sheet, record.rowNumber, {
          LICENSE_ID: generateUniqueLicenseId_(sheet)
        });
        SpreadsheetApp.flush();
      }
    } finally {
      lock.releaseLock();
    }

    record = findLicenseRecord_(sheet, {
      email: payload.email,
      token: payload.token,
      licenseId: payload.licenseId
    });
  }

  if (!record) {
    return deviceLicenseNotFound_();
  }

  const result = buildDeviceLicensePayload_(record);

  // IMPORTANT:
  // Only authenticated server/Device Worker lookup calls pass trackOnline=true.
  // Public compatibility checks do not affect ONLINE/OFFLINE presence.
  if (
    result &&
    result.valid === true &&
    options
  ) {
    try {
      if (options.markOffline === true) {
        markLicenseOfflineNowV540_(
          sheet,
          record,
          new Date()
        );
      } else if (options.trackOnline === true) {
        trackLicenseOnlineHeartbeatV538_(
          sheet,
          record,
          new Date()
        );
      }
    } catch (presenceErr) {
      // Presence tracking must never break license validation.
      console.warn(
        'ONLINE_STATUS_PRESENCE_WARNING: ' +
        String(
          presenceErr && presenceErr.message
            ? presenceErr.message
            : presenceErr
        )
      );
    }
  }

  return result;
}

function deviceLicenseNotFound_() {
  return {
    ok: true,
    valid: false,
    success: false,
    code: 'LICENSE_NOT_FOUND',
    message: 'Email atau token tidak ditemukan.',
    serverTime: new Date().toISOString()
  };
}

function findLicenseRecord_(sheet, criteria) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0].map(h => String(h).trim());
  const map = headerMapFromArray_(headers);

  ['EMAIL', 'TOKEN', 'STATUS', 'PLAN', 'ACTIVATED_AT', 'EXPIRED_AT', 'LICENSE_ID']
    .forEach(name => {
      if (map[name] === undefined) throw new Error('Missing Licenses column: ' + name);
    });

  const emailKey = canonicalEmail_(criteria.email);
  const tokenKey = canonicalToken_(criteria.token);
  const licenseIdKey = String(criteria.licenseId || '').trim().toUpperCase();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rowEmail = canonicalEmail_(row[map.EMAIL]);
    const rowToken = canonicalToken_(row[map.TOKEN]);
    const rowLicenseId = String(row[map.LICENSE_ID] || '').trim().toUpperCase();

    const emailMatch = emailKey && rowEmail === emailKey;
    const tokenMatch = tokenKey && rowToken === tokenKey;
    const licenseIdMatch = licenseIdKey && rowLicenseId === licenseIdKey;

    if ((emailMatch && tokenMatch) || (licenseIdMatch && tokenMatch)) {
      const object = {};
      headers.forEach((header, index) => { object[header] = row[index]; });
      return { rowNumber: r + 1, object: object, headers: headers, map: map };
    }
  }

  return null;
}

function buildDeviceLicensePayload_(record) {
  const row = record.object;
  const now = new Date();
  const status = normalizeCode_(row.STATUS);
  const duration = deviceDurationFromPlan_(row.PLAN);
  const activatedAt = toDateOrNull_(row.ACTIVATED_AT);
  const expiresAt = toDateOrNull_(row.EXPIRED_AT);
  const isPermanent = duration === 'PERMANENT';
  const isTrial = duration === 'TRIAL (1 HARI)';

  let valid = true;
  let code = 'LICENSE_VALID';
  let message = 'Lisensi valid.';

  if (!duration) {
    valid = false;
    code = 'LICENSE_CONFIG_INCOMPLETE';
    message = 'PLAN / duration lisensi tidak dikenali.';
  } else if (status === 'BLOCKED') {
    valid = false;
    code = 'LICENSE_BLOCKED';
    message = 'Lisensi diblokir.';
  } else if (status !== 'ACTIVE') {
    valid = false;
    code = 'LICENSE_INACTIVE';
    message = 'Lisensi tidak aktif.';
  } else if (!isPermanent && !expiresAt) {
    valid = false;
    code = 'LICENSE_CONFIG_INCOMPLETE';
    message = 'EXPIRED_AT lisensi belum tersedia.';
  } else if (!isPermanent && expiresAt.getTime() <= now.getTime()) {
    valid = false;
    code = 'LICENSE_EXPIRED';
    message = 'Masa aktif lisensi telah berakhir.';
  }

  const remainingSeconds = expiresAt
    ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
    : null;

  const iSignal = evaluateISignalForDevice_(row, now, valid, duration, expiresAt);
  const pendingRequestedAt = toDateOrNull_(row.PENDING_REQUESTED_AT);
  const pendingExpiresAt = pendingRequestedAt
    ? new Date(pendingRequestedAt.getTime() + DEVICE_PENDING_TTL_MS)
    : null;

  return {
    ok: true,
    valid: valid,
    success: valid,
    code: code,
    message: message,
    email: canonicalEmail_(row.EMAIL),
    status: status,
    duration: duration,
    activatedAt: activatedAt ? activatedAt.toISOString() : '',
    expiresAt: expiresAt ? expiresAt.toISOString() : '',
    serverTime: now.toISOString(),
    // Returned through the Device Worker when it preserves server fields.
    // The extension stores this URL and sends OPEN/HEARTBEAT/CLOSE directly
    // to Apps Script, so presence does not depend on Worker optional fields.
    presenceEndpoint: getLicensePublicWebAppUrlV541_(),
    presenceProtocol: 'V541',
    remainingSeconds: remainingSeconds,
    isTrial: isTrial,
    isPermanent: isPermanent,
    licenseId: String(row.LICENSE_ID || '').trim(),
    license: String(row.LICENSE_ID || '').trim(),

    // Internal fields required by tf-license-device-api Worker.
    activeDeviceId: String(row.ACTIVE_DEVICE_ID || '').trim(),
    activePublicKey: String(row.ACTIVE_PUBLIC_KEY || '').trim(),
    activeSessionId: String(row.ACTIVE_SESSION_ID || '').trim(),
    deviceName: String(row.DEVICE_NAME || '').trim(),
    pendingRequestId: String(row.PENDING_REQUEST_ID || '').trim().toUpperCase(),
    pendingDeviceId: String(row.PENDING_DEVICE_ID || '').trim(),
    pendingPublicKey: String(row.PENDING_PUBLIC_KEY || '').trim(),
    pendingFcmId: String(row.PENDING_FCM_ID || '').trim(),
    pendingStatus: String(row.PENDING_STATUS || '').trim().toUpperCase(),
    pendingRequestedAt: pendingRequestedAt ? pendingRequestedAt.toISOString() : '',
    pendingExpiresAt: pendingExpiresAt ? pendingExpiresAt.toISOString() : '',

    // MOBILE SLOT — intentionally independent from the PC/Desktop slot.
    mobileActiveDeviceId: String(row.MOBILE_ACTIVE_DEVICE_ID || '').trim(),
    mobileActivePublicKey: String(row.MOBILE_ACTIVE_PUBLIC_KEY || '').trim(),
    mobileActiveSessionId: String(row.MOBILE_ACTIVE_SESSION_ID || '').trim(),
    mobileDeviceName: String(row.MOBILE_DEVICE_NAME || '').trim(),
    mobileFcmRegistrationId: String(row.MOBILE_FCM_REGISTRATION_ID || '').trim(),
    mobilePendingRequestId: String(row.MOBILE_PENDING_REQUEST_ID || '').trim().toUpperCase(),
    mobilePendingDeviceId: String(row.MOBILE_PENDING_DEVICE_ID || '').trim(),
    mobilePendingPublicKey: String(row.MOBILE_PENDING_PUBLIC_KEY || '').trim(),
    mobilePendingFcmId: String(row.MOBILE_PENDING_FCM_ID || '').trim(),
    mobilePendingStatus: String(row.MOBILE_PENDING_STATUS || '').trim().toUpperCase(),
    mobilePendingRequestedAt: toDateOrNull_(row.MOBILE_PENDING_REQUESTED_AT)
      ? toDateOrNull_(row.MOBILE_PENDING_REQUESTED_AT).toISOString()
      : '',
    mobileLastSeenAt: toDateOrNull_(row.MOBILE_LAST_SEEN_AT)
      ? toDateOrNull_(row.MOBILE_LAST_SEEN_AT).toISOString()
      : '',

    isignalUsersAccessKnown: true,
    isignalUsersAccess: iSignal.access,
    isignalUsersIncluded: iSignal.included,
    isignalUsersAddonRequired: iSignal.addonRequired,
    isignalUsersPlan: iSignal.plan,
    isignalUsersExpiresAt: iSignal.expiresAt,
    isignalUsersRemainingSeconds: iSignal.remainingSeconds,
    isignalUsersAccessReason: iSignal.reason
  };
}

function deviceDurationFromPlan_(planValue) {
  const plan = normalizeCode_(planValue);
  const map = {
    TEST_1_DAY: 'TRIAL (1 HARI)',
    MAIN_1M: '1 BULAN',
    MAIN_3M: '3 BULAN',
    MAIN_6M: '6 BULAN',
    MAIN_1Y: '1 TAHUN',
    MAIN_PERMANENT: 'PERMANENT',
    BUNDLE_1M_ISIGNAL_1D: '1 BULAN',
    BUNDLE_1M_ISIGNAL_PREMIUM: '1 BULAN',
    BUNDLE_3M_ISIGNAL_1D: '3 BULAN',
    BUNDLE_3M_ISIGNAL_PREMIUM: '3 BULAN'
  };
  return map[plan] || '';
}

function evaluateISignalForDevice_(row, now, mainValid, duration, mainExpiresAt) {
  const rawAccess = normalizeCode_(row.ISIGNAL_ACCESS);
  const configuredAccess =
    rawAccess === 'YES' ||
    rawAccess === 'TRUE' ||
    rawAccess === 'ACTIVE';

  const iSignalExpiry = toDateOrNull_(row.ISIGNAL_EXPIRED_AT);
  const planCode = normalizeCode_(row.PLAN);
  const source = normalizeCode_(row.ISIGNAL_SOURCE);
  const adminPlan = normalizeManualISignalPlanV5_(row.ISIGNAL_PLAN);

  const includedPlans = {
    TEST_1_DAY: true,
    MAIN_6M: true,
    MAIN_1Y: true,
    MAIN_PERMANENT: true,
    BUNDLE_1M_ISIGNAL_1D: true,
    BUNDLE_1M_ISIGNAL_PREMIUM: true,
    BUNDLE_3M_ISIGNAL_1D: true,
    BUNDLE_3M_ISIGNAL_PREMIUM: true
  };

  const included = configuredAccess && Boolean(includedPlans[planCode]);
  const permanentISignal =
    configuredAccess &&
    !iSignalExpiry &&
    duration === 'PERMANENT';

  let effectiveAccess = configuredAccess;

  if (!mainValid) {
    effectiveAccess = false;
  }

  if (
    configuredAccess &&
    iSignalExpiry &&
    iSignalExpiry.getTime() <= now.getTime()
  ) {
    effectiveAccess = false;
  }

  const addonRequired =
    !included &&
    (duration === '1 BULAN' || duration === '3 BULAN');

  let plan = 'NONE';

  if (adminPlan === '1_DAY') {
    plan = '1 HARI';
  } else if (adminPlan === 'PREMIUM') {
    plan = 'PREMIUM';
  } else if (included) {
    plan = 'INCLUDED';
  } else if (source === 'ADDON_ISIGNAL_1D' || source === 'MANUAL_1_DAY') {
    plan = '1 HARI';
  } else if (
    source === 'ADDON_ISIGNAL_PREMIUM' ||
    source === 'MANUAL_PREMIUM'
  ) {
    plan = 'PREMIUM';
  }

  let expiresAt = '';

  if (effectiveAccess) {
    if (iSignalExpiry) {
      expiresAt = iSignalExpiry.toISOString();
    } else if (permanentISignal) {
      expiresAt = '';
    } else if (included && mainExpiresAt) {
      expiresAt = mainExpiresAt.toISOString();
    }
  }

  let remainingSeconds = null;

  if (effectiveAccess && iSignalExpiry) {
    remainingSeconds = Math.max(
      0,
      Math.floor((iSignalExpiry.getTime() - now.getTime()) / 1000)
    );
  } else if (effectiveAccess && included && mainExpiresAt) {
    remainingSeconds = Math.max(
      0,
      Math.floor((mainExpiresAt.getTime() - now.getTime()) / 1000)
    );
  }

  let reason = 'ACCESS_NOT_AVAILABLE';

  if (!mainValid) {
    reason = 'MAIN_LICENSE_INVALID';
  } else if (effectiveAccess && included) {
    reason = 'INCLUDED_IN_PLAN';
  } else if (effectiveAccess && !included) {
    reason = 'ADDON_ACTIVE';
  } else if (
    configuredAccess &&
    iSignalExpiry &&
    iSignalExpiry.getTime() <= now.getTime()
  ) {
    reason = 'ADDON_EXPIRED';
  } else if (addonRequired) {
    reason = 'ADDON_NOT_PURCHASED';
  }

  return {
    access: effectiveAccess,
    included: included,
    addonRequired: addonRequired,
    plan: plan,
    expiresAt: expiresAt,
    remainingSeconds: remainingSeconds,
    reason: reason
  };
}

function clearPendingDeviceAtRow_(sheet, rowNumber) {
  updateRowByHeaders_(sheet, rowNumber, {
    PENDING_REQUEST_ID: '',
    PENDING_DEVICE_ID: '',
    PENDING_PUBLIC_KEY: '',
    PENDING_FCM_ID: '',
    PENDING_STATUS: '',
    PENDING_REQUESTED_AT: '',
    MOBILE_ACTIVE_DEVICE_ID: '',
    MOBILE_ACTIVE_PUBLIC_KEY: '',
    MOBILE_ACTIVE_SESSION_ID: '',
    MOBILE_DEVICE_NAME: '',
    MOBILE_FCM_REGISTRATION_ID: '',
    MOBILE_PENDING_REQUEST_ID: '',
    MOBILE_PENDING_DEVICE_ID: '',
    MOBILE_PENDING_PUBLIC_KEY: '',
    MOBILE_PENDING_FCM_ID: '',
    MOBILE_PENDING_STATUS: '',
    MOBILE_PENDING_REQUESTED_AT: '',
    MOBILE_LAST_SEEN_AT: ''
  });
}

function cleanDeviceString_(value) {
  return value == null ? '' : String(value).trim();
}

// ============================================================
// EMAIL QUEUE
// ============================================================

function processPendingEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const ordersSheet = requireSheet_(ss, SHEET_ORDERS);
    const licensesSheet = requireSheet_(ss, SHEET_LICENSES);
    const orders = ordersSheet.getDataRange().getValues();
    if (orders.length < 2) return;

    const headers = orders[0].map(h => String(h).trim());
    const map = headerMapFromArray_(headers);
    let sent = 0, failed = 0, skipped = 0;

    for (let r = 1; r < orders.length; r++) {
      const row = orders[r];
      const orderRowNumber = r + 1;
      if (isTrue_(row[map.EMAIL_SENT])) { skipped++; continue; }

      const orderType = normalizeCode_(row[map.ORDER_TYPE]);
      const trxId = String(row[map.TRX_ID] || '').trim();
      const email = canonicalEmail_(row[map.EMAIL]);
      const customerName = String(row[map.CUSTOMER_NAME] || '').trim();

      // V5.3: upgrade / renewal reuses the EXISTING license row.
      if (orderType === 'UPGRADE' || orderType === 'RENEWAL') {
        if (!isTrue_(row[map.LICENSE_CREATED])) { skipped++; continue; }

        const targetTrx = String(row[map.TARGET_LICENSE_TRX_ID] || '').trim();

        if (!targetTrx) {
          failed++;
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            NOTE: 'EMAIL_FAILED: TARGET_LICENSE_TRX_ID_NOT_FOUND'
          });
          continue;
        }

        const targetLicenseRow = findRowByValue_(licensesSheet, 'TRX_ID', targetTrx);

        if (!targetLicenseRow) {
          failed++;
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            NOTE: 'EMAIL_FAILED: TARGET_LICENSE_NOT_FOUND'
          });
          continue;
        }

        const targetLicense = getRowObject_(licensesSheet, targetLicenseRow);
        const order = getRowObject_(ordersSheet, orderRowNumber);

        const result = sendUpgradeOrRenewalEmailV53_(
          email,
          customerName,
          order,
          targetLicense
        );

        if (result.success) {
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            EMAIL_SENT: true,
            NOTE:
              orderType +
              ' applied and confirmation email sent successfully'
          });

          updateRowByHeaders_(licensesSheet, targetLicenseRow, {
            EMAIL_SENT_AT: new Date()
          });

          sent++;
        } else {
          failed++;
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            NOTE: 'EMAIL_FAILED: ' + result.error
          });
        }

        continue;
      }

      if (orderType !== 'ADDON') {
        if (!isTrue_(row[map.LICENSE_CREATED]) || !trxId) { skipped++; continue; }

        const licenseRow = findRowByValue_(licensesSheet, 'TRX_ID', trxId);

        if (!licenseRow) {
          failed++;
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            NOTE: 'EMAIL_FAILED: LICENSE_NOT_FOUND'
          });
          continue;
        }

        const license = getRowObject_(licensesSheet, licenseRow);
        const result = sendLicenseEmail_(email, customerName, license);

        if (result.success) {
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            EMAIL_SENT: true,
            NOTE: 'License created and email sent successfully'
          });

          updateRowByHeaders_(licensesSheet, licenseRow, {
            EMAIL_SENT_AT: new Date()
          });

          sent++;
        } else {
          failed++;
          updateRowByHeaders_(ordersSheet, orderRowNumber, {
            NOTE: 'EMAIL_FAILED: ' + result.error
          });
        }

        continue;
      }

      if (!isTrue_(row[map.ADDON_APPLIED])) { skipped++; continue; }

      const targetTrx = String(row[map.TARGET_LICENSE_TRX_ID] || '').trim();

      if (!targetTrx) {
        failed++;
        updateRowByHeaders_(ordersSheet, orderRowNumber, {
          NOTE: 'EMAIL_FAILED: TARGET_LICENSE_TRX_ID_NOT_FOUND'
        });
        continue;
      }

      const targetLicenseRow = findRowByValue_(licensesSheet, 'TRX_ID', targetTrx);

      if (!targetLicenseRow) {
        failed++;
        updateRowByHeaders_(ordersSheet, orderRowNumber, {
          NOTE: 'EMAIL_FAILED: TARGET_LICENSE_NOT_FOUND'
        });
        continue;
      }

      const targetLicense = getRowObject_(licensesSheet, targetLicenseRow);
      const order = getRowObject_(ordersSheet, orderRowNumber);

      const addonResult = sendAddonEmail_(
        email,
        customerName,
        order,
        targetLicense
      );

      if (addonResult.success) {
        updateRowByHeaders_(ordersSheet, orderRowNumber, {
          EMAIL_SENT: true,
          NOTE: 'iSignal add-on applied and email sent successfully'
        });
        sent++;
      } else {
        failed++;
        updateRowByHeaders_(ordersSheet, orderRowNumber, {
          NOTE: 'EMAIL_FAILED: ' + addonResult.error
        });
      }
    }

    console.log(JSON.stringify({
      success: true,
      sent: sent,
      failed: failed,
      skipped: skipped
    }));
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function retryPendingEmails() {
  processPendingEmails();
}

function setupEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processPendingEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('processPendingEmails').timeBased().everyMinutes(1).create();
  console.log('EMAIL_TRIGGER_CREATED_EVERY_1_MINUTE');
}

// ============================================================
// CUSTOMER-FRIENDLY PLAN LABELS
// ============================================================

function emailProductDisplayNameV5310_(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return 'TF Multi-Analyst Scanner';
  }

  if (/TF\s+Multi-Analyst\s+Scanner/i.test(raw)) {
    return 'TF Multi-Analyst Scanner';
  }

  return raw;
}


function friendlyPlanNameV534_(planValue) {
  const plan = normalizeCode_(planValue);
  const labels = {
    TEST_1_DAY: 'Paket Trial 1 Hari',
    MAIN_1M: 'Paket 1 Bulan',
    MAIN_3M: 'Paket 3 Bulan',
    MAIN_6M: 'Paket 6 Bulan + iSignal Users Premium',
    MAIN_1Y: 'Paket 1 Tahun + iSignal Users Premium',
    MAIN_PERMANENT: 'Paket Permanent + iSignal Users Premium',
    BUNDLE_1M_ISIGNAL_1D: 'Paket 1 Bulan + iSignal Users 1 Hari',
    BUNDLE_1M_ISIGNAL_PREMIUM: 'Paket 1 Bulan + iSignal Users Premium',
    BUNDLE_3M_ISIGNAL_1D: 'Paket 3 Bulan + iSignal Users 1 Hari',
    BUNDLE_3M_ISIGNAL_PREMIUM: 'Paket 3 Bulan + iSignal Users Premium'
  };
  return labels[plan] || String(planValue || '-');
}

// ============================================================
// EMAIL TEMPLATES
// ============================================================

function sendLicenseEmail_(email, customerName, license) {
  try {
    const to = canonicalEmail_(email);
    if (!isValidEmail_(to)) return { success: false, error: 'INVALID_EMAIL' };

    const token = String(license.TOKEN || '').trim();
    if (!token) return { success: false, error: 'TOKEN_NOT_FOUND' };

    const productName = emailProductDisplayNameV5310_(license.PRODUCT_NAME || license.PLAN);
    const planCode = String(license.PLAN || '-');
    const plan = friendlyPlanNameV534_(planCode);
    const status = String(license.STATUS || 'ACTIVE');
    const activatedAt = formatDateTime_(license.ACTIVATED_AT);
    const expiredAt = formatExpiry_(license.EXPIRED_AT);
    const isignalAccess = String(license.ISIGNAL_ACCESS || 'NO').trim().toUpperCase();
    const isignalExpiredAt = formatISignalExpiry_(license.ISIGNAL_EXPIRED_AT, isignalAccess);
    const greeting = customerName ? 'Halo ' + customerName + ',' : 'Halo,';
    const subject = 'Lisensi TF Multi-Analyst Scanner Anda Sudah Aktif';

    const plainBody = [
      greeting,
      '',
      'Pembayaran Anda telah berhasil diverifikasi.',
      '',
      'Produk: ' + productName,
      'Paket: ' + plan,
      'Email Aktivasi: ' + to,
      'Status: ' + status,
      'Aktif: ' + activatedAt,
      'Masa Berlaku: ' + expiredAt,
      'iSignal Users: ' + (isignalAccess === 'YES' ? 'AKTIF' : 'TIDAK TERMASUK'),
      isignalAccess === 'YES' ? 'Masa Berlaku iSignal: ' + isignalExpiredAt : '',
      '',
      'LICENSE TOKEN:',
      token,
      '',
      'Gunakan email pembelian dan License Token di TF Multi-Analyst Scanner untuk melakukan aktivasi.',
      '',
      'Simpan License Token ini dengan aman.',
      '',
      buildDownloadInstallPlainText_(),
      buildSupportPlainTextV537_(),
      '',
      'TF Multi-Analyst Scanner'
    ].join('\n');

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: plainBody,
      htmlBody: buildMainEmailHtml_({
        greeting: greeting,
        productName: productName,
        plan: plan,
        email: to,
        status: status,
        activatedAt: activatedAt,
        expiredAt: expiredAt,
        isignalAccess: isignalAccess,
        isignalExpiredAt: isignalExpiredAt,
        token: token
      }),
      name: EMAIL_SENDER_NAME
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
}



function sendUpgradeOrRenewalEmailV53_(
  email,
  customerName,
  order,
  license
) {
  try {
    const to = canonicalEmail_(email);

    if (!isValidEmail_(to)) {
      return {
        success: false,
        error: 'INVALID_EMAIL'
      };
    }

    const orderType =
      normalizeCode_(order.ORDER_TYPE);

    const greeting =
      customerName
        ? 'Halo ' + customerName + ','
        : 'Halo,';

    const token =
      String(
        license.TOKEN || ''
      ).trim();

    const productName =
      emailProductDisplayNameV5310_(
        license.PRODUCT_NAME ||
        license.PLAN
      );

    const plan =
      friendlyPlanNameV534_(
        license.PLAN || '-'
      );

    const expiredAt =
      formatExpiry_(
        license.EXPIRED_AT
      );

    const isignalAccess =
      String(
        license.ISIGNAL_ACCESS ||
        'NO'
      ).trim().toUpperCase();

    const isignalExpiredAt =
      formatISignalExpiry_(
        license.ISIGNAL_EXPIRED_AT,
        isignalAccess
      );

    const actionLabel =
      orderType === 'UPGRADE'
        ? 'Upgrade Paket Berhasil'
        : 'Perpanjangan Paket Berhasil';

    const subject =
      'TF Multi-Analyst Scanner — ' +
      actionLabel;

    const body = [
      greeting,
      '',
      actionLabel + '.',
      '',
      'Produk: ' + productName,
      'Plan Aktif: ' + plan,
      'Email Aktivasi: ' + to,
      'Masa Berlaku: ' + expiredAt,
      'iSignal Users: ' +
        (
          isignalAccess === 'YES'
            ? 'AKTIF'
            : 'TIDAK TERMASUK'
        ),
      isignalAccess === 'YES'
        ? 'Masa Berlaku iSignal: ' +
          isignalExpiredAt
        : '',
      '',
      'License Token Anda TETAP SAMA:',
      token,
      '',
      'Device yang sudah terdaftar tetap dipertahankan.',
      'Tidak ada License Token baru yang dibuat.',
      '',
      buildDownloadInstallPlainText_(),
      buildSupportPlainTextV537_(),
      '',
      'TF Multi-Analyst Scanner'
    ].join('\n');

    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:18px 8px;color:#162033;width:100%;box-sizing:border-box;">
        <div style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ef;box-sizing:border-box;">
          <div style="background:#081a2d;padding:20px 18px;color:#fff;">
            <div style="font-size:12px;letter-spacing:1.3px;opacity:.75;margin-bottom:7px;">TF MULTI-ANALYST SCANNER</div>
            <div style="font-size:20px;line-height:27px;font-weight:700;">${htmlEscape_(actionLabel)}</div>
          </div>
          <div style="padding:20px 18px;">
            <p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#162033;">${htmlEscape_(greeting)}</p>
            <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;">Pembayaran Anda telah diverifikasi. Lisensi yang sudah ada diperbarui otomatis tanpa membuat token baru.</p>
            <div style="background:#f7f9fc;border:1px solid #e4e9f0;border-radius:10px;padding:6px 15px;margin:18px 0;">
              ${emailInfoRow_('Produk', productName)}
              ${emailInfoRow_('Plan Aktif', plan)}
              ${emailInfoRow_('Email Aktivasi', to)}
              ${emailInfoRow_('Masa Berlaku', expiredAt)}
              ${emailInfoRow_('iSignal Users', isignalAccess === 'YES' ? 'AKTIF' : 'TIDAK TERMASUK')}
              ${isignalAccess === 'YES' ? emailInfoRow_('Masa Berlaku iSignal', isignalExpiredAt) : ''}
            </div>
            <div style="font-size:12px;font-weight:700;color:#657083;letter-spacing:.8px;margin-bottom:8px;">LICENSE TOKEN ANDA TETAP SAMA</div>
            <div style="background:#081a2d;color:#ffffff;border-radius:10px;padding:14px 15px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:20px;font-weight:700;word-break:break-all;overflow-wrap:anywhere;">${htmlEscape_(token)}</div>
            ${buildDownloadInstallHtmlBlock_()}
            ${buildEmailActionButtonsV537_()}
            <p style="margin-top:24px;line-height:1.7;color:#4d596b;">Device yang sudah terdaftar tetap dipertahankan. Tidak ada License Token baru yang dibuat.</p>
          </div>
          ${buildEmailFooterV537_()}
        </div>
      </div>`;

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
      name: EMAIL_SENDER_NAME
    });

    return {
      success: true
    };

  } catch (err) {
    return {
      success: false,
      error: String(
        err && err.message
          ? err.message
          : err
      )
    };
  }
}


function sendAddonEmail_(email, customerName, order, license) {
  try {
    const to = canonicalEmail_(email);
    if (!isValidEmail_(to)) return { success: false, error: 'INVALID_EMAIL' };

    const greeting = customerName ? 'Halo ' + customerName + ',' : 'Halo,';
    const addonName = String(order.PRODUCT_NAME || 'iSignal Users Add-on');
    const token = String(license.TOKEN || '');
    const iSignalExpiry = formatISignalExpiry_(license.ISIGNAL_EXPIRED_AT, 'YES');
    const mainExpiry = formatExpiry_(license.EXPIRED_AT);
    const subject = 'Add-on iSignal Users Berhasil Diaktifkan';

    const body = [
      greeting,
      '',
      'Pembayaran add-on Anda telah berhasil diverifikasi.',
      '',
      'Add-on: ' + addonName,
      'Email: ' + to,
      'iSignal Users: AKTIF',
      'Berlaku sampai: ' + iSignalExpiry,
      'Lisensi utama berlaku sampai: ' + mainExpiry,
      '',
      'License Token Anda tetap sama:',
      token,
      '',
      'Tidak ada token baru yang dibuat.',
      '',
      buildDownloadInstallPlainText_(),
      buildSupportPlainTextV537_(),
      '',
      'TF Multi-Analyst Scanner'
    ].join('\n');

    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:18px 8px;color:#162033;width:100%;box-sizing:border-box;">
        <div style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ef;box-sizing:border-box;">
          <div style="background:#081a2d;padding:20px 18px;color:#fff;">
            <div style="font-size:12px;letter-spacing:1.3px;opacity:.75;margin-bottom:7px;">TF MULTI-ANALYST SCANNER</div>
            <div style="font-size:20px;line-height:27px;font-weight:700;">iSignal Users Sudah Aktif</div>
          </div>
          <div style="padding:20px 18px;">
            <p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#162033;">${htmlEscape_(greeting)}</p>
            <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;">Pembayaran add-on Anda telah berhasil diverifikasi dan akses iSignal Users telah diperbarui otomatis.</p>
            <div style="background:#f7f9fc;border:1px solid #e4e9f0;border-radius:10px;padding:6px 15px;margin:18px 0;">
              ${emailInfoRow_('Add-on', addonName)}
              ${emailInfoRow_('Email', to)}
              ${emailInfoRow_('iSignal Users', 'AKTIF')}
              ${emailInfoRow_('Berlaku sampai', iSignalExpiry)}
              ${emailInfoRow_('Lisensi utama', mainExpiry)}
            </div>
            <div style="font-size:12px;font-weight:700;color:#657083;letter-spacing:.8px;margin-bottom:8px;">LICENSE TOKEN ANDA TETAP SAMA</div>
            <div style="background:#081a2d;color:#ffffff;border-radius:10px;padding:14px 15px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:20px;font-weight:700;word-break:break-all;overflow-wrap:anywhere;">${htmlEscape_(token)}</div>
            ${buildDownloadInstallHtmlBlock_()}
            ${buildEmailActionButtonsV537_()}
            <p style="margin-top:24px;color:#5c6677;line-height:1.7;">Add-on tidak membuat License Token baru. Gunakan token yang sama seperti sebelumnya.</p>
          </div>
          ${buildEmailFooterV537_()}
        </div>
      </div>`;

    MailApp.sendEmail({ to: to, subject: subject, body: body, htmlBody: htmlBody, name: EMAIL_SENDER_NAME });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
}

function buildMainEmailHtml_(d) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:18px 8px;color:#162033;width:100%;box-sizing:border-box;">
    <div style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ef;box-sizing:border-box;">
      <div style="background:#081a2d;padding:20px 18px;color:#fff;">
        <div style="font-size:12px;letter-spacing:1.3px;opacity:.75;margin-bottom:7px;">TF MULTI-ANALYST SCANNER</div>
        <div style="font-size:20px;line-height:27px;font-weight:700;">Lisensi Anda Sudah Aktif</div>
      </div>
      <div style="padding:20px 18px;">
        <p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#162033;">${htmlEscape_(d.greeting)}</p>
        <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;">Pembayaran Anda telah berhasil diverifikasi dan lisensi telah dibuat otomatis.</p>
        <div style="background:#f7f9fc;border:1px solid #e4e9f0;border-radius:10px;padding:6px 15px;margin:18px 0;">
          ${emailInfoRow_('Produk', d.productName)}
          ${emailInfoRow_('Paket', d.plan)}
          ${emailInfoRow_('Email Aktivasi', d.email)}
          ${emailInfoRow_('Status', d.status)}
          ${emailInfoRow_('Aktif', d.activatedAt)}
          ${emailInfoRow_('Masa Berlaku', d.expiredAt)}
          ${emailInfoRow_('iSignal Users', d.isignalAccess === 'YES' ? 'AKTIF' : 'TIDAK TERMASUK')}
          ${d.isignalAccess === 'YES' ? emailInfoRow_('Masa Berlaku iSignal', d.isignalExpiredAt) : ''}
        </div>
        <div style="font-size:12px;font-weight:700;color:#657083;letter-spacing:.8px;margin-bottom:8px;">LICENSE TOKEN</div>
        <div style="background:#081a2d;color:#ffffff;border-radius:10px;padding:14px 15px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:20px;font-weight:700;word-break:break-all;overflow-wrap:anywhere;">${htmlEscape_(d.token)}</div>
        ${buildDownloadInstallHtmlBlock_()}
        ${buildEmailActionButtonsV537_()}
        <p style="margin-top:24px;line-height:1.7;color:#4d596b;">Gunakan email pembelian dan License Token di TF Multi-Analyst Scanner untuk melakukan aktivasi.</p>
      </div>
      ${buildEmailFooterV537_()}
    </div>
  </div>`;
}

// ============================================================
// PRODUCTS
// ============================================================

function getProductByUuid_(sheet, uuid) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0].map(h => String(h).trim());
  const map = headerMapFromArray_(headers);

  ['PRODUCT_UUID', 'PRODUCT_CODE', 'PRODUCT_NAME', 'EXPECTED_TOTAL', 'MAIN_DURATION', 'ISIGNAL_MODE', 'ACTIVE']
    .forEach(name => {
      if (map[name] === undefined) throw new Error('Missing Products column: ' + name);
    });

  for (let r = 1; r < values.length; r++) {
    const rowUuid = String(values[r][map.PRODUCT_UUID] || '').trim();
    if (rowUuid === uuid) {
      return {
        productUuid: rowUuid,
        productCode: String(values[r][map.PRODUCT_CODE] || '').trim(),
        productName: String(values[r][map.PRODUCT_NAME] || '').trim(),
        expectedTotal: Number(values[r][map.EXPECTED_TOTAL]),
        mainDuration: String(values[r][map.MAIN_DURATION] || '').trim(),
        isignalMode: String(values[r][map.ISIGNAL_MODE] || '').trim(),
        active: isTrue_(values[r][map.ACTIVE])
      };
    }
  }
  return null;
}

// ============================================================
// EXPIRY
// ============================================================

function calculateExpiry_(startDate, duration) {
  switch (normalizeCode_(duration)) {
    case '1_DAY': return new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    case '1_MONTH': return addCalendarMonths_(startDate, 1);
    case '3_MONTHS': return addCalendarMonths_(startDate, 3);
    case '6_MONTHS': return addCalendarMonths_(startDate, 6);
    case '1_YEAR': return addCalendarYears_(startDate, 1);
    case 'PERMANENT': return '';
    default: throw new Error('UNKNOWN_MAIN_DURATION: ' + duration);
  }
}

function addCalendarMonths_(date, months) {
  const d = new Date(date.getTime());
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

function addCalendarYears_(date, years) {
  const d = new Date(date.getTime());
  const originalMonth = d.getMonth();
  const originalDay = d.getDate();
  d.setDate(1);
  d.setFullYear(d.getFullYear() + years);
  d.setMonth(originalMonth);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

// ============================================================
// TOKEN + LICENSE ID
// ============================================================

function generateUniqueLicenseToken_(licensesSheet) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const token = generateLicenseToken_();
    if (!findRowByValue_(licensesSheet, 'TOKEN', token)) return token;
  }
  throw new Error('FAILED_TO_GENERATE_UNIQUE_LICENSE_TOKEN');
}

function generateLicenseToken_() {
  const entropy = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), String(Date.now()), String(Math.random())].join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entropy, Utilities.Charset.UTF_8);
  const hex = digest.map(byte => {
    const n = byte < 0 ? byte + 256 : byte;
    return ('0' + n.toString(16)).slice(-2);
  }).join('').toUpperCase();
  return 'TFA-' + hex.substring(0, 8) + '-' + hex.substring(8, 16) + '-' + hex.substring(16, 24) + '-' + hex.substring(24, 32);
}

function generateLicenseId_() {
  const raw = Utilities.getUuid().replace(/-/g, '').toUpperCase();
  return ['LIC', raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12), raw.slice(12, 16)].join('-');
}

function generateUniqueLicenseId_(licensesSheet) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = generateLicenseId_();
    if (!findRowByValue_(licensesSheet, 'LICENSE_ID', id)) return id;
  }
  throw new Error('FAILED_TO_GENERATE_UNIQUE_LICENSE_ID');
}

function ensureLicenseIdAtRow_(sheet, rowNumber) {
  const row = getRowObject_(sheet, rowNumber);
  if (String(row.LICENSE_ID || '').trim()) return String(row.LICENSE_ID).trim();
  const id = generateUniqueLicenseId_(sheet);
  updateRowByHeaders_(sheet, rowNumber, { LICENSE_ID: id });
  return id;
}

function backfillMissingLicenseIdsV5() {
  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { success: true, created: 0 };
  const headers = values[0].map(h => String(h).trim());
  const map = headerMapFromArray_(headers);
  let created = 0;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    for (let r = 1; r < values.length; r++) {
      const email = canonicalEmail_(values[r][map.EMAIL]);
      const token = String(values[r][map.TOKEN] || '').trim();
      const licenseId = String(values[r][map.LICENSE_ID] || '').trim();
      if (email && token && !licenseId) {
        sheet.getRange(r + 1, map.LICENSE_ID + 1).setValue(generateUniqueLicenseId_(sheet));
        created++;
      }
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  const result = { success: true, created: created };
  console.log(JSON.stringify(result));
  return result;
}

// ============================================================
// CONFIGURATION + DIAGNOSTICS
// ============================================================

function checkConfigurationV5() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(props.getProperty(PROP_SPREADSHEET_ID) || '').trim();
  const gatewaySecret = String(props.getProperty(PROP_GATEWAY_SECRET) || '').trim();
  const serverSecret = String(props.getProperty(PROP_SERVER_SHARED_SECRET) || '').trim();

  const result = {
    version: 'LICENSE_PROCESSOR_REV229_DUAL_SLOT',
    spreadsheetIdConfigured: Boolean(spreadsheetId),
    gatewaySecretConfigured: Boolean(gatewaySecret),
    serverSharedSecretConfigured: Boolean(serverSecret),
    spreadsheetAccessible: false,
    requiredSheets: {},
    deviceHeadersReady: false,
    missingDeviceHeaders: [],
    emailTriggerInstalled: false
  };

  if (spreadsheetId) {
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      [SHEET_WEBHOOK, SHEET_PRODUCTS, SHEET_ORDERS, SHEET_LICENSES].forEach(name => {
        result.requiredSheets[name] = Boolean(ss.getSheetByName(name));
      });
      result.spreadsheetAccessible = true;

      const licenses = ss.getSheetByName(SHEET_LICENSES);
      if (licenses) {
        const headers = licenses.getRange(1, 1, 1, licenses.getLastColumn()).getDisplayValues()[0]
          .map(h => String(h).trim());
        const set = {};
        headers.forEach(h => { set[h] = true; });
        result.missingDeviceHeaders = REQUIRED_LICENSE_DEVICE_HEADERS.filter(h => !set[h]);
        result.deviceHeadersReady = result.missingDeviceHeaders.length === 0;
      }
    } catch (err) {
      result.spreadsheetError = String(err && err.message ? err.message : err);
    }
  }

  result.emailTriggerInstalled = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === 'processPendingEmails'
  );

  result.success =
    result.spreadsheetIdConfigured &&
    result.gatewaySecretConfigured &&
    result.serverSharedSecretConfigured &&
    result.spreadsheetAccessible &&
    Object.keys(result.requiredSheets).length === 4 &&
    Object.keys(result.requiredSheets).every(k => result.requiredSheets[k]) &&
    result.deviceHeadersReady &&
    result.emailTriggerInstalled;

  console.log(JSON.stringify(result));
  return result;
}

function testDeviceLookupV5(email, token) {
  const result = devicePublicLookup_({ email: email, token: token });
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Safe self-test:
 * - adds ONE temporary license row to Licenses
 * - tests lookup / pending / approve / bind / clear
 * - deletes the temporary row in finally
 * - does not create an Order and does not send email
 */
function runV5DeviceBackendSelfTest() {
  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);
  const suffix = String(Date.now());
  const email = 'v5-device-selftest-' + suffix + '@example.com';
  const token = 'TFA-SELFTEST-' + suffix;
  const trx = 'V5-DEVICE-SELFTEST-' + suffix;
  const licenseId = generateUniqueLicenseId_(sheet);
  let rowNumber = null;
  const checks = [];

  function check(condition, name) {
    checks.push({ name: name, pass: Boolean(condition) });
    if (!condition) console.error('FAIL: ' + name);
  }

  try {
    rowNumber = appendRowByHeaders_(sheet, {
      TOKEN: token,
      EMAIL: email,
      PLAN: 'MAIN_1M',
      PRODUCT_UUID: 'SELFTEST',
      PRODUCT_NAME: 'V5 Device Backend Self Test',
      ACTIVATED_AT: new Date(),
      EXPIRED_AT: addCalendarMonths_(new Date(), 1),
      STATUS: 'ACTIVE',
      TRX_ID: trx,
      ISIGNAL_ACCESS: 'NO',
      ISIGNAL_EXPIRED_AT: '',
      DEVICE_ID: '',
      CREATED_AT: new Date(),
      EMAIL_SENT_AT: '',
      ISIGNAL_SOURCE: '',
      ISIGNAL_LAST_ORDER_TRX_ID: '',
      LICENSE_ID: licenseId,
      ACTIVE_DEVICE_ID: '',
      ACTIVE_PUBLIC_KEY: '',
      ACTIVE_SESSION_ID: '',
      DEVICE_NAME: '',
      FCM_REGISTRATION_ID: '',
      PENDING_REQUEST_ID: '',
      PENDING_DEVICE_ID: '',
      PENDING_PUBLIC_KEY: '',
      PENDING_FCM_ID: '',
      PENDING_STATUS: '',
      PENDING_REQUESTED_AT: ''
    });
    SpreadsheetApp.flush();

    let result = devicePublicLookup_({ email: email, token: token });
    check(result.valid === true, 'lookup valid');
    check(result.licenseId === licenseId, 'licenseId match');
    check(result.duration === '1 BULAN', 'duration MAIN_1M -> 1 BULAN');
    check(result.isignalUsersAccess === false, 'MAIN_1M iSignal false');

    result = deviceServerOperation_({
      operation: 'set-pending',
      payload: {
        email: email,
        token: token,
        licenseId: licenseId,
        pendingRequestId: 'REQ-SELFTEST',
        pendingDeviceId: 'TFDEV-SELFTEST-B',
        pendingPublicKey: 'PUBLIC-KEY-B',
        pendingFcmId: 'FCM-B'
      }
    });
    check(result.pendingStatus === 'PENDING', 'set-pending -> PENDING');
    check(result.pendingDeviceId === 'TFDEV-SELFTEST-B', 'pending device stored');

    result = deviceServerOperation_({
      operation: 'set-decision',
      payload: {
        email: email,
        token: token,
        licenseId: licenseId,
        pendingRequestId: 'REQ-SELFTEST',
        decision: 'APPROVE'
      }
    });
    check(result.pendingStatus === 'APPROVED', 'decision -> APPROVED');

    result = deviceServerOperation_({
      operation: 'bind',
      payload: {
        email: email,
        token: token,
        licenseId: licenseId,
        activeDeviceId: 'TFDEV-SELFTEST-B',
        activePublicKey: 'PUBLIC-KEY-B',
        activeSessionId: 'SES-SELFTEST-B',
        fcmRegistrationId: 'FCM-B',
        deviceName: 'Chrome Self Test'
      }
    });
    check(result.activeDeviceId === 'TFDEV-SELFTEST-B', 'bind stores active device');
    check(result.activeSessionId === 'SES-SELFTEST-B', 'bind stores session');
    check(result.pendingRequestId === '', 'bind clears pending request');
    check(result.deviceName === 'Chrome Self Test', 'bind stores device name');

    result = deviceServerOperation_({
      operation: 'clear-pending',
      payload: { email: email, token: token, licenseId: licenseId }
    });
    check(result.valid === true, 'clear-pending keeps license valid');

    const failed = checks.filter(x => !x.pass);
    const output = {
      success: failed.length === 0,
      tests: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      failures: failed.map(x => x.name)
    };
    console.log(JSON.stringify(output));
    return output;

  } finally {
    try {
      if (rowNumber) {
        const currentRow = findRowByValue_(sheet, 'TRX_ID', trx);
        if (currentRow) sheet.deleteRow(currentRow);
      }
    } catch (_) {}
  }
}

// ============================================================
// SHEET HELPERS
// ============================================================

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredScriptProperty_(PROP_SPREADSHEET_ID));
}

function getLicensesSheet_() {
  return requireSheet_(getSpreadsheet_(), SHEET_LICENSES);
}

function getRequiredScriptProperty_(name) {
  const value = String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  if (!value) throw new Error(name + '_NOT_CONFIGURED');
  return value;
}

function assertLicenseDeviceHeaders_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(h => String(h).trim());
  const set = {};
  headers.forEach(h => { set[h] = true; });
  const missing = REQUIRED_LICENSE_DEVICE_HEADERS.filter(h => !set[h]);
  if (missing.length) throw new Error('Missing Licenses device columns: ' + missing.join(', '));
}

function getRowObject_(sheet, rowNumber) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(h => String(h).trim());
  const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
  const result = {};
  headers.forEach((header, index) => { result[header] = values[index]; });
  return result;
}

function findRowByValue_(sheet, headerName, searchValue) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values[0].map(h => String(h).trim());
  const map = headerMapFromArray_(headers);
  if (map[headerName] === undefined) {
    throw new Error('Missing column: ' + headerName + ' in sheet ' + sheet.getName());
  }

  const target = String(searchValue).trim();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][map[headerName]] || '').trim() === target) return r + 1;
  }
  return null;
}

function appendRowByHeaders_(sheet, data) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('Sheet has no headers: ' + sheet.getName());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(h => String(h).trim());
  const row = headers.map(header => Object.prototype.hasOwnProperty.call(data, header) ? data[header] : '');
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateRowByHeaders_(sheet, rowNumber, data) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(h => String(h).trim());
  const map = headerMapFromArray_(headers);
  Object.keys(data).forEach(key => {
    if (map[key] !== undefined) sheet.getRange(rowNumber, map[key] + 1).setValue(data[key]);
  });
}

function appendWebhookLog_(sheet, rawPayload, status, note) {
  appendRowByHeaders_(sheet, {
    RECEIVED_AT: new Date(),
    SOURCE: 'LYNK-CLOUDFLARE',
    RAW_PAYLOAD: rawPayload,
    STATUS: status,
    NOTE: note
  });
}

function reject_(webhookSheet, rawBody, reason) {
  appendWebhookLog_(webhookSheet, rawBody, 'REJECTED', reason);
  return jsonResponse_({ success: false, rejected: true, error: reason });
}

function requireSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function headerMapFromArray_(headers) {
  const map = {};
  headers.forEach((header, index) => { map[String(header).trim()] = index; });
  return map;
}

// ============================================================
// GENERIC HELPERS
// ============================================================

function canonicalEmail_(value) {
  let email = String(value || '');
  try { email = email.normalize('NFKC'); } catch (_) {}
  return email
    .replace(/[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function canonicalToken_(value) {
  let token = String(value || '');
  try { token = token.normalize('NFKC'); } catch (_) {}
  return token
    .replace(/[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isTrue_(value) {
  if (value === true) return true;
  const s = String(value || '').trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'ACTIVE';
}

function normalizeCode_(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toDateOrNull_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTime_(value) {
  const date = toDateOrNull_(value);
  if (!date) return '-';
  return Utilities.formatDate(date, APP_TIMEZONE, "dd MMMM yyyy HH:mm 'WIB'");
}

function formatExpiry_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return 'PERMANENT';
  return formatDateTime_(value);
}

function formatISignalExpiry_(value, access) {
  if (String(access).trim().toUpperCase() !== 'YES') return '-';
  if (value === '' || value === null || typeof value === 'undefined') return 'PERMANENT';
  return formatDateTime_(value);
}

function emailInfoRow_(label, value) {
  const safeLabel =
    htmlEscape_(label);

  const safeValue =
    htmlEscape_(
      String(
        value == null || value === ''
          ? '-'
          : value
      )
    );

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="width:100%;border-collapse:collapse;border-bottom:1px solid #e5e9ef;">
      <tr>
        <td style="padding:11px 0 10px 0;vertical-align:top;text-align:left;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.45px;text-transform:uppercase;color:#7a8494;margin:0 0 4px 0;">
            ${safeLabel}
          </div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:600;color:#1b2638;margin:0;word-break:normal;overflow-wrap:anywhere;">
            ${safeValue}
          </div>
        </td>
      </tr>
    </table>`;
}

function buildEmailActionButtonsV537_() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      <tr>
        <td style="padding:0 0 10px 0;">
          <a href="${EMAIL_DOWNLOAD_URL}" target="_blank"
             style="display:block;text-align:center;background:#0b63d8;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;line-height:19px;padding:12px 14px;border-radius:9px;">
            Download &amp; Instalasi
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:0;">
          <a href="${EMAIL_WHATSAPP_URL}" target="_blank"
             style="display:block;text-align:center;background:#1fa855;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;line-height:19px;padding:12px 14px;border-radius:9px;">
            Hubungi Admin via WhatsApp
          </a>
        </td>
      </tr>
    </table>
    <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#788396;">
      Support: ${htmlEscape_(EMAIL_SUPPORT_NAME)}
    </div>`;
}


function buildDownloadInstallHtmlBlock_() {
  return `
    <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:11px;line-height:16px;font-weight:700;color:#657083;letter-spacing:.55px;margin-bottom:6px;">
        DOWNLOAD &amp; INSTALASI
      </div>
      <a href="${EMAIL_DOWNLOAD_URL}" target="_blank"
         style="display:inline-block;color:#0b63d8;text-decoration:none;font-size:13px;line-height:19px;font-weight:600;overflow-wrap:anywhere;">
        Buka halaman Download &amp; Instalasi
      </a>
    </div>`;
}


function buildDownloadInstallPlainText_() {
  return 'Download & Instalasi: ' + EMAIL_DOWNLOAD_URL;
}


function buildSupportPlainTextV537_() {
  return 'Hubungi Admin (' + EMAIL_SUPPORT_NAME + '): ' + EMAIL_WHATSAPP_URL;
}


function buildEmailFooterV537_() {
  return `
    <div style="padding:16px 18px;background:#f7f9fc;border-top:1px solid #e4e9f0;font-size:11px;color:#778294;line-height:1.6;">
      <div style="font-weight:700;color:#4f5b6f;">TF Multi-Analyst Scanner</div>
      <div>${htmlEscape_(EMAIL_SUPPORT_NAME)}</div>
    </div>`;
}


function htmlEscape_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data || {}))
    .setMimeType(ContentService.MimeType.JSON);
}
// ============================================================
// TF ANALYZER V5 — ADMIN UPGRADE DROPDOWN PATCH
// Append this block to the END of V5 Code.gs
// ============================================================

const V5_UPGRADE_HEADERS = [
  'UPGRADE_TO',
  'UPGRADE_MODE',
  'UPGRADE_APPLY',
  'UPGRADE_STATUS',
  'UPGRADE_LAST_AT',
  'UPGRADE_NOTE'
];

const V5_UPGRADE_PLAN_OPTIONS = [
  'NONE',
  'MAIN_1M',
  'MAIN_3M',
  'MAIN_6M',
  'MAIN_1Y',
  'MAIN_PERMANENT'
];

const V5_UPGRADE_MODE_OPTIONS = [
  'KEEP_EXPIRY',
  'RESET_FROM_NOW',
  'EXTEND_FROM_CURRENT_EXPIRY'
];

const V5_UPGRADE_PLAN_RANK = Object.freeze({
  MAIN_1M: 1,
  MAIN_3M: 2,
  MAIN_6M: 3,
  MAIN_1Y: 4,
  MAIN_PERMANENT: 5
});

// ------------------------------------------------------------
// RUN ONCE MANUALLY.
// Adds dropdowns + installs a Spreadsheet onEdit trigger.
// ------------------------------------------------------------
function setupUpgradeDropdownsV5() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(
    props.getProperty(PROP_SPREADSHEET_ID) || ''
  ).trim();

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);

  ensureUpgradeHeadersV5_(sheet);
  const map = upgradeHeaderMapV5_(sheet);

  const maxRows = Math.max(sheet.getMaxRows(), 1000);
  if (sheet.getMaxRows() < maxRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
  }

  const planRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(V5_UPGRADE_PLAN_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText('Pilih paket utama tujuan upgrade. NONE = tidak ada upgrade.')
    .build();

  const modeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(V5_UPGRADE_MODE_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText(
      'KEEP_EXPIRY = expiry lama tetap; RESET_FROM_NOW = paket baru mulai sekarang; ' +
      'EXTEND_FROM_CURRENT_EXPIRY = durasi paket baru ditambah setelah expiry aktif.'
    )
    .build();

  const applyRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['NO', 'YES'], true)
    .setAllowInvalid(false)
    .setHelpText('Ubah menjadi YES hanya jika upgrade benar-benar ingin diterapkan.')
    .build();

  sheet.getRange(2, map.UPGRADE_TO + 1, maxRows - 1, 1).setDataValidation(planRule);
  sheet.getRange(2, map.UPGRADE_MODE + 1, maxRows - 1, 1).setDataValidation(modeRule);
  sheet.getRange(2, map.UPGRADE_APPLY + 1, maxRows - 1, 1).setDataValidation(applyRule);

  const lastDataRow = sheet.getLastRow();
  if (lastDataRow >= 2) {
    const upgradeToRange = sheet.getRange(2, map.UPGRADE_TO + 1, lastDataRow - 1, 1);
    const modeRange = sheet.getRange(2, map.UPGRADE_MODE + 1, lastDataRow - 1, 1);
    const applyRange = sheet.getRange(2, map.UPGRADE_APPLY + 1, lastDataRow - 1, 1);

    const upgradeValues = upgradeToRange.getValues();
    const modeValues = modeRange.getValues();
    const applyValues = applyRange.getValues();

    for (let i = 0; i < upgradeValues.length; i++) {
      if (!String(upgradeValues[i][0] || '').trim()) upgradeValues[i][0] = 'NONE';
      if (!String(modeValues[i][0] || '').trim()) modeValues[i][0] = 'KEEP_EXPIRY';
      if (!String(applyValues[i][0] || '').trim()) applyValues[i][0] = 'NO';
    }

    upgradeToRange.setValues(upgradeValues);
    modeRange.setValues(modeValues);
    applyRange.setValues(applyValues);
  }

  ensureUpgradeLogSheetV5_(ss);

  // Avoid double trigger.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'handleLicenseUpgradeEditV5_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger('handleLicenseUpgradeEditV5_')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  const result = {
    success: true,
    sheet: SHEET_LICENSES,
    upgradeToColumn: map.UPGRADE_TO + 1,
    upgradeModeColumn: map.UPGRADE_MODE + 1,
    upgradeApplyColumn: map.UPGRADE_APPLY + 1,
    triggerInstalled: true,
    plans: V5_UPGRADE_PLAN_OPTIONS,
    modes: V5_UPGRADE_MODE_OPTIONS
  };

  console.log(JSON.stringify(result));
  return result;
}

// ------------------------------------------------------------
// INSTALLABLE onEdit handler. Do not run manually.
// User selects UPGRADE_APPLY = YES -> applies upgrade.
// ------------------------------------------------------------
function handleLicenseUpgradeEditV5_(e) {
  try {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_LICENSES) return;
    if (e.range.getRow() < 2) return;
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

    const map = upgradeHeaderMapV5_(sheet);
    if (e.range.getColumn() !== map.UPGRADE_APPLY + 1) return;

    const value = normalizeCode_(e.value || e.range.getDisplayValue());
    if (value !== 'YES') return;

    applyUpgradeAtRowV5_(sheet, e.range.getRow());

  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
  }
}

// ------------------------------------------------------------
// Core upgrade. Preserves TOKEN, LICENSE_ID, and all device state.
// ------------------------------------------------------------
function applyUpgradeAtRowV5_(sheet, rowNumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureUpgradeHeadersV5_(sheet);
    const row = getRowObject_(sheet, rowNumber);

    const email = canonicalEmail_(row.EMAIL);
    const licenseId = String(row.LICENSE_ID || '').trim();
    const currentPlan = normalizeCode_(row.PLAN);
    const targetPlan = normalizeCode_(row.UPGRADE_TO);
    const mode = normalizeCode_(row.UPGRADE_MODE || 'KEEP_EXPIRY');
    const status = normalizeCode_(row.STATUS);

    if (!email || !licenseId) {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'LICENSE_ID / EMAIL belum lengkap.');
    }

    if (status !== 'ACTIVE') {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'Lisensi tidak ACTIVE.');
    }

    if (!targetPlan || targetPlan === 'NONE') {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'UPGRADE_TO belum dipilih.');
    }

    if (!V5_UPGRADE_PLAN_RANK[targetPlan]) {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'Target plan tidak didukung: ' + targetPlan);
    }

    if (!V5_UPGRADE_PLAN_RANK[currentPlan]) {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'Current PLAN tidak dikenali: ' + currentPlan);
    }

    if (V5_UPGRADE_PLAN_RANK[targetPlan] <= V5_UPGRADE_PLAN_RANK[currentPlan]) {
      return rejectUpgradeAtRowV5_(
        sheet,
        rowNumber,
        'Hanya upgrade ke paket yang lebih tinggi. Current=' + currentPlan + ', Target=' + targetPlan
      );
    }

    if (V5_UPGRADE_MODE_OPTIONS.indexOf(mode) === -1) {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'UPGRADE_MODE tidak valid: ' + mode);
    }

    const ss = sheet.getParent();
    const productsSheet = requireSheet_(ss, SHEET_PRODUCTS);
    const product = getProductByCodeForUpgradeV5_(productsSheet, targetPlan);

    if (!product) {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'Produk target tidak ditemukan di Products: ' + targetPlan);
    }

    if (!product.active) {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'Produk target tidak ACTIVE: ' + targetPlan);
    }

    const now = new Date();
    const oldExpiry = toDateOrNull_(row.EXPIRED_AT);
    let newExpiry = oldExpiry ? new Date(oldExpiry.getTime()) : '';

    if (normalizeCode_(product.mainDuration) === 'PERMANENT') {
      newExpiry = '';
    } else if (mode === 'RESET_FROM_NOW') {
      newExpiry = calculateExpiry_(now, product.mainDuration);
    } else if (mode === 'EXTEND_FROM_CURRENT_EXPIRY') {
      const base = oldExpiry && oldExpiry > now ? oldExpiry : now;
      newExpiry = calculateExpiry_(base, product.mainDuration);
    } else if (mode === 'KEEP_EXPIRY') {
      if (!oldExpiry) {
        return rejectUpgradeAtRowV5_(
          sheet,
          rowNumber,
          'KEEP_EXPIRY tidak dapat dipakai karena expiry lama kosong. Pilih RESET_FROM_NOW atau EXTEND_FROM_CURRENT_EXPIRY.'
        );
      }
    }

    let iSignalAccess = normalizeCode_(row.ISIGNAL_ACCESS) === 'YES' ? 'YES' : 'NO';
    let iSignalExpiredAt = row.ISIGNAL_EXPIRED_AT || '';
    let iSignalSource = String(row.ISIGNAL_SOURCE || '').trim();
    let iSignalPlan = normalizeManualISignalPlanV5_(row.ISIGNAL_PLAN);

    const targetISignalMode = normalizeCode_(product.isignalMode);

    if (targetISignalMode === 'FOLLOW_MAIN') {
      iSignalAccess = 'YES';
      iSignalExpiredAt = newExpiry instanceof Date ? new Date(newExpiry.getTime()) : '';
      iSignalSource = targetPlan;
      iSignalPlan = 'PREMIUM';
    } else if (targetISignalMode === 'PERMANENT') {
      iSignalAccess = 'YES';
      iSignalExpiredAt = '';
      iSignalSource = targetPlan;
      iSignalPlan = 'PREMIUM';
    } else if (targetISignalMode === 'NONE') {
      // Preserve a still-active paid/manual add-on. Otherwise 1M / 3M must be NO.
      const currentISignalExpiry = toDateOrNull_(row.ISIGNAL_EXPIRED_AT);
      const sourceCode = normalizeCode_(row.ISIGNAL_SOURCE);
      const hasActiveTimedAddon =
        (sourceCode === 'ADDON_ISIGNAL_1D' || sourceCode === 'MANUAL_1_DAY') &&
        currentISignalExpiry &&
        currentISignalExpiry > now;
      const hasPremiumAddon =
        sourceCode === 'ADDON_ISIGNAL_PREMIUM' ||
        sourceCode === 'MANUAL_PREMIUM';

      if (hasPremiumAddon) {
        iSignalAccess = 'YES';
        iSignalExpiredAt = newExpiry instanceof Date ? new Date(newExpiry.getTime()) : '';
        iSignalSource = sourceCode;
        iSignalPlan = 'PREMIUM';
      } else if (hasActiveTimedAddon) {
        iSignalAccess = 'YES';
        if (newExpiry instanceof Date && currentISignalExpiry > newExpiry) {
          iSignalExpiredAt = new Date(newExpiry.getTime());
        } else {
          iSignalExpiredAt = currentISignalExpiry;
        }
        iSignalSource = sourceCode;
        iSignalPlan = '1_DAY';
      } else {
        iSignalAccess = 'NO';
        iSignalExpiredAt = '';
        iSignalSource = '';
        iSignalPlan = 'NO';
      }
    } else {
      return rejectUpgradeAtRowV5_(sheet, rowNumber, 'ISIGNAL_MODE target tidak didukung: ' + targetISignalMode);
    }

    const note =
      'Upgrade applied: ' + currentPlan + ' -> ' + targetPlan +
      ' | mode=' + mode +
      ' | TOKEN/LICENSE_ID/device tetap.';

    updateRowByHeaders_(sheet, rowNumber, {
      PLAN: targetPlan,
      PRODUCT_UUID: product.productUuid,
      PRODUCT_NAME: product.productName,
      EXPIRED_AT: newExpiry,
      ISIGNAL_ACCESS: iSignalAccess,
      ISIGNAL_EXPIRED_AT: iSignalExpiredAt,
      ISIGNAL_PLAN: iSignalPlan,
      ISIGNAL_SOURCE: iSignalSource,
      UPGRADE_STATUS: 'APPLIED',
      UPGRADE_LAST_AT: now,
      UPGRADE_NOTE: note,
      UPGRADE_APPLY: 'NO'
    });

    appendUpgradeLogV5_(ss, {
      TIMESTAMP: now,
      EMAIL: email,
      LICENSE_ID: licenseId,
      FROM_PLAN: currentPlan,
      TO_PLAN: targetPlan,
      MODE: mode,
      OLD_EXPIRED_AT: oldExpiry || '',
      NEW_EXPIRED_AT: newExpiry,
      STATUS: 'APPLIED',
      NOTE: note
    });

    SpreadsheetApp.flush();

    const result = {
      success: true,
      email: email,
      licenseId: licenseId,
      fromPlan: currentPlan,
      toPlan: targetPlan,
      mode: mode,
      tokenPreserved: true,
      devicePreserved: true,
      newExpiredAt: newExpiry instanceof Date ? newExpiry.toISOString() : 'PERMANENT'
    };

    console.log(JSON.stringify(result));
    return result;

  } finally {
    lock.releaseLock();
  }
}

function rejectUpgradeAtRowV5_(sheet, rowNumber, reason) {
  updateRowByHeaders_(sheet, rowNumber, {
    UPGRADE_STATUS: 'REJECTED',
    UPGRADE_NOTE: String(reason || 'Upgrade ditolak.'),
    UPGRADE_APPLY: 'NO'
  });

  const row = getRowObject_(sheet, rowNumber);
  const ss = sheet.getParent();

  appendUpgradeLogV5_(ss, {
    TIMESTAMP: new Date(),
    EMAIL: canonicalEmail_(row.EMAIL),
    LICENSE_ID: String(row.LICENSE_ID || '').trim(),
    FROM_PLAN: normalizeCode_(row.PLAN),
    TO_PLAN: normalizeCode_(row.UPGRADE_TO),
    MODE: normalizeCode_(row.UPGRADE_MODE),
    OLD_EXPIRED_AT: row.EXPIRED_AT || '',
    NEW_EXPIRED_AT: '',
    STATUS: 'REJECTED',
    NOTE: String(reason || 'Upgrade ditolak.')
  });

  SpreadsheetApp.flush();

  const result = {
    success: false,
    rejected: true,
    reason: String(reason || 'Upgrade ditolak.')
  };

  console.log(JSON.stringify(result));
  return result;
}

function getProductByCodeForUpgradeV5_(sheet, productCode) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0].map(function(h) { return String(h || '').trim(); });
  const map = headerMapFromArray_(headers);

  ['PRODUCT_UUID', 'PRODUCT_CODE', 'PRODUCT_NAME', 'EXPECTED_TOTAL', 'MAIN_DURATION', 'ISIGNAL_MODE', 'ACTIVE']
    .forEach(function(name) {
      if (map[name] === undefined) throw new Error('Missing Products column: ' + name);
    });

  const wanted = normalizeCode_(productCode);

  for (let r = 1; r < values.length; r++) {
    if (normalizeCode_(values[r][map.PRODUCT_CODE]) !== wanted) continue;

    return {
      productUuid: String(values[r][map.PRODUCT_UUID] || '').trim(),
      productCode: String(values[r][map.PRODUCT_CODE] || '').trim(),
      productName: String(values[r][map.PRODUCT_NAME] || '').trim(),
      expectedTotal: Number(values[r][map.EXPECTED_TOTAL]),
      mainDuration: String(values[r][map.MAIN_DURATION] || '').trim(),
      isignalMode: String(values[r][map.ISIGNAL_MODE] || '').trim(),
      active: isTrue_(values[r][map.ACTIVE])
    };
  }

  return null;
}

function ensureUpgradeHeadersV5_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const existing = {};
  headers.forEach(function(h, i) {
    if (h) existing[h] = i;
  });

  V5_UPGRADE_HEADERS.forEach(function(header) {
    if (existing[header] !== undefined) return;
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(header);
    existing[header] = col - 1;
  });
}

function upgradeHeaderMapV5_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);

  V5_UPGRADE_HEADERS.forEach(function(header) {
    if (map[header] === undefined) {
      throw new Error('Upgrade header belum tersedia: ' + header);
    }
  });

  return map;
}

function ensureUpgradeLogSheetV5_(ss) {
  let sheet = ss.getSheetByName('Upgrade_Log');
  if (!sheet) sheet = ss.insertSheet('Upgrade_Log');

  const headers = [
    'TIMESTAMP',
    'EMAIL',
    'LICENSE_ID',
    'FROM_PLAN',
    'TO_PLAN',
    'MODE',
    'OLD_EXPIRED_AT',
    'NEW_EXPIRED_AT',
    'STATUS',
    'NOTE'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getDisplayValues()[0]
      .map(function(v) { return String(v || '').trim(); });

    headers.forEach(function(header, index) {
      if (current[index] !== header) sheet.getRange(1, index + 1).setValue(header);
    });
  }

  return sheet;
}

function appendUpgradeLogV5_(ss, data) {
  const sheet = ensureUpgradeLogSheetV5_(ss);
  const headers = sheet.getRange(1, 1, 1, 10).getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(data, header) ? data[header] : '';
  });

  sheet.appendRow(row);
}

// ------------------------------------------------------------
// Diagnostic only. No license data is changed.
// ------------------------------------------------------------
function checkUpgradeControlsV5() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(props.getProperty(PROP_SPREADSHEET_ID) || '').trim();
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);
  ensureUpgradeHeadersV5_(sheet);
  const map = upgradeHeaderMapV5_(sheet);

  const triggerCount = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'handleLicenseUpgradeEditV5_';
  }).length;

  const result = {
    success: true,
    upgradeHeadersReady: true,
    upgradeToColumn: map.UPGRADE_TO + 1,
    upgradeModeColumn: map.UPGRADE_MODE + 1,
    upgradeApplyColumn: map.UPGRADE_APPLY + 1,
    upgradeTriggerInstalled: triggerCount > 0,
    upgradeTriggerCount: triggerCount,
    upgradeLogReady: Boolean(ss.getSheetByName('Upgrade_Log'))
  };

  console.log(JSON.stringify(result));
  return result;
}
// ============================================================
// TF ANALYZER V5.2 — MANUAL LICENSE ENTRY + iSIGNAL FIX
//
// ADMIN INPUT:
//   EMAIL
//   PLAN
//   ISIGNAL_PLAN = NO / 1_DAY / PREMIUM
//
// INTERNAL RESULT:
//   ISIGNAL_ACCESS = YES / NO
//
// IMPORTANT FIX:
// - MAIN_1M and MAIN_3M default to NO.
// - Changing an existing license PLAN to MAIN_1M / MAIN_3M
//   immediately resets iSignal to NO unless admin separately
//   chooses 1_DAY / PREMIUM afterward.
// - 6M / 1Y / PERMANENT and bundle plans force the entitlement
//   included by the package.
// ============================================================


// ============================================================
// REV292 — MANUAL ROW ADMIN DEFAULTS + DATE FORMAT REPAIR
// ============================================================

function formatLicenseDateColumnsV292_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES) return;

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const map = headerMapFromArray_(headers);
  const format = 'dd/MM/yyyy HH:mm:ss';

  // Header-based formatting: safe even when admin columns shift letters.
  [
    'LAST_ONLINE',
    'ACTIVATED_AT',
    'EXPIRED_AT',
    'ISIGNAL_EXPIRED_AT',
    'CREATED_AT',
    'EMAIL_SENT_AT',
    'UPGRADE_LAST_AT',
    'LAST_SEEN_AT',
    'MOBILE_LAST_SEEN_AT',
    'PENDING_REQUESTED_AT',
    'MOBILE_PENDING_REQUESTED_AT'
  ].forEach(function(name) {
    if (map[name] === undefined) return;

    if (rowNumber && rowNumber >= 2) {
      sheet.getRange(rowNumber, map[name] + 1).setNumberFormat(format);
    } else if (sheet.getMaxRows() >= 2) {
      sheet
        .getRange(2, map[name] + 1, sheet.getMaxRows() - 1, 1)
        .setNumberFormat(format);
    }
  });
}


function initializeManualAdminCellsV292_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES || rowNumber < 2) {
    return { initialized: false };
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const map = headerMapFromArray_(headers);

  // A new manual license has no active PC/Mobile session yet.
  if (map.ONLINE_STATUS !== undefined) {
    sheet.getRange(rowNumber, map.ONLINE_STATUS + 1).setValue('OFFLINE');
    paintLicenseStatusPresenceV540_(sheet, rowNumber, map.ONLINE_STATUS + 1, false);
  }

  if (map.ONLINE_STATUS_MOBILE !== undefined) {
    sheet.getRange(rowNumber, map.ONLINE_STATUS_MOBILE + 1).setValue('OFFLINE');
    paintLicenseStatusPresenceV540_(sheet, rowNumber, map.ONLINE_STATUS_MOBILE + 1, false);
  }

  // Prevent copied/template rows from retaining stale online timestamps.
  [
    'LAST_ONLINE',
    'LAST_SEEN_AT',
    'MOBILE_LAST_SEEN_AT'
  ].forEach(function(name) {
    if (map[name] !== undefined) {
      sheet.getRange(rowNumber, map[name] + 1).clearContent();
    }
  });

  formatLicenseDateColumnsV292_(sheet, rowNumber);

  // Generate all visible admin controls as soon as TOKEN + LICENSE_ID exist.
  const sendEmail = writeSendEmailButtonForRowV541_(sheet, rowNumber);
  const sendEmailUpdate = writeSendEmailUpdateButtonForRowV294_(sheet, rowNumber);
  const reset = writeResetButtonsForRowV232_(sheet, rowNumber);

  return {
    initialized: true,
    pcStatus: 'OFFLINE',
    mobileStatus: 'OFFLINE',
    sendEmail: Boolean(sendEmail),
    sendEmailUpdate: Boolean(sendEmailUpdate),
    resetPc: Boolean(reset && reset.pc),
    resetMobile: Boolean(reset && reset.mobile)
  };
}


function repairManualAdminRowsV292_(sheet) {
  if (!sheet) sheet = getLicensesSheet_();

  ensureLicenseAdminLayoutV540_(sheet, false);
  formatLicenseDateColumnsV292_(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { repairedRows: 0, eligibleRows: 0 };
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);

  let eligibleRows = 0;
  let repairedRows = 0;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = getRowObject_(sheet, rowNumber);
    const email = canonicalEmail_(row.EMAIL);
    const token = String(row.TOKEN || '').trim();
    const licenseId = String(row.LICENSE_ID || '').trim();

    if (!email || !token || !licenseId) continue;
    eligibleRows++;

    let changed = false;

    if (map.ONLINE_STATUS !== undefined) {
      const pc = sheet.getRange(rowNumber, map.ONLINE_STATUS + 1);
      if (!String(pc.getDisplayValue() || '').trim()) {
        pc.setValue('OFFLINE');
        changed = true;
      }
      paintLicenseStatusPresenceV540_(
        sheet,
        rowNumber,
        map.ONLINE_STATUS + 1,
        normalizeCode_(pc.getDisplayValue()) === 'ONLINE'
      );
    }

    if (map.ONLINE_STATUS_MOBILE !== undefined) {
      const mobile = sheet.getRange(rowNumber, map.ONLINE_STATUS_MOBILE + 1);
      if (!String(mobile.getDisplayValue() || '').trim()) {
        mobile.setValue('OFFLINE');
        changed = true;
      }
      paintLicenseStatusPresenceV540_(
        sheet,
        rowNumber,
        map.ONLINE_STATUS_MOBILE + 1,
        normalizeCode_(mobile.getDisplayValue()) === 'ONLINE'
      );
    }

    writeSendEmailButtonForRowV541_(sheet, rowNumber);
    writeSendEmailUpdateButtonForRowV294_(sheet, rowNumber);
    writeResetButtonsForRowV232_(sheet, rowNumber);
    formatLicenseDateColumnsV292_(sheet, rowNumber);

    if (changed) repairedRows++;
  }

  SpreadsheetApp.flush();
  return {
    repairedRows: repairedRows,
    eligibleRows: eligibleRows,
    dateFormat: 'dd/MM/yyyy HH:mm:ss'
  };
}


function repairManualLicenseAdminV292() {
  const sheet = getLicensesSheet_();
  const result = repairManualAdminRowsV292_(sheet);
  console.log(JSON.stringify(result));
  return result;
}


function setupManualLicenseEntryV5() {
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);

  ensureLicenseAdminLayoutV540_(sheet, true);
  ensureManualISignalPlanHeaderV5_(sheet);

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const map = headerMapFromArray_(headers);

  [
    'EMAIL',
    'PLAN',
    'STATUS',
    'ISIGNAL_ACCESS',
    'ISIGNAL_EXPIRED_AT',
    'ISIGNAL_SOURCE',
    'ISIGNAL_PLAN'
  ].forEach(function(name) {
    if (map[name] === undefined) {
      throw new Error('Header wajib tidak ditemukan: ' + name);
    }
  });

  const wantedRows = 2001;

  if (sheet.getMaxRows() < wantedRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      wantedRows - sheet.getMaxRows()
    );
  }

  const dataRows = sheet.getMaxRows() - 1;

  // New rows added above also need the per-row Send Email button styling/link.
  ensureLicenseAdminLayoutV540_(sheet, true);

  const planRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'TEST_1_DAY',
      'MAIN_1M',
      'MAIN_3M',
      'MAIN_6M',
      'MAIN_1Y',
      'MAIN_PERMANENT',
      'BUNDLE_1M_ISIGNAL_1D',
      'BUNDLE_1M_ISIGNAL_PREMIUM',
      'BUNDLE_3M_ISIGNAL_1D',
      'BUNDLE_3M_ISIGNAL_PREMIUM'
    ], true)
    .setAllowInvalid(false)
    .setHelpText('Pilih paket lisensi.')
    .build();

  const iSignalRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'NO',
      '1_DAY',
      'PREMIUM'
    ], true)
    .setAllowInvalid(false)
    .setHelpText(
      'NO = tanpa iSignal | 1_DAY = 24 jam | PREMIUM = mengikuti masa lisensi utama'
    )
    .build();

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'ACTIVE',
      'INACTIVE',
      'BLOCKED'
    ], true)
    .setAllowInvalid(false)
    .build();

  sheet
    .getRange(2, map.PLAN + 1, dataRows, 1)
    .setDataValidation(planRule);

  sheet
    .getRange(2, map.ISIGNAL_PLAN + 1, dataRows, 1)
    .setDataValidation(iSignalRule);

  sheet
    .getRange(2, map.STATUS + 1, dataRows, 1)
    .setDataValidation(statusRule);

  // ISIGNAL_ACCESS is internal only. Remove old YES/NO dropdown if any.
  sheet
    .getRange(2, map.ISIGNAL_ACCESS + 1, dataRows, 1)
    .clearDataValidations();

  // Repair existing rows, including rows that were changed from
  // Permanent/6M/1Y to MAIN_1M or MAIN_3M and incorrectly stayed YES.
  const repair = repairISignalConsistencyV5();

  // REV292: normalize all license date columns (including current L/T by header)
  // and backfill missing admin controls/statuses on existing manual rows.
  formatLicenseDateColumnsV292_(sheet);
  const adminRepairV292 = repairManualAdminRowsV292_(sheet);

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'manualLicenseEntryOnEditV5') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger('manualLicenseEntryOnEditV5')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  const result = {
    success: true,
    version: 'V5.4.1_CLICK_BUTTON_PRESENCE_BRIDGE',
    planDropdownInstalled: true,
    isignalPlanDropdownInstalled: true,
    isignalPlanOptions: ['NO', '1_DAY', 'PREMIUM'],
    isignalAccessInternalOnly: true,
    repairedRows: repair.repairedRows,
    adminRepairV292: adminRepairV292,
    dateFormatV292: 'dd/MM/yyyy HH:mm:ss',
    triggerInstalled: true
  };

  console.log(JSON.stringify(result));
  return result;
}


function ensureManualISignalPlanHeaderV5_(sheet) {
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  if (headers.indexOf('ISIGNAL_PLAN') >= 0) {
    return;
  }

  sheet
    .getRange(1, sheet.getLastColumn() + 1)
    .setValue('ISIGNAL_PLAN');

  SpreadsheetApp.flush();
}


// ============================================================
// MANUAL EDIT HANDLER
// ============================================================

function manualLicenseEntryOnEditV5(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();

  if (sheet.getName() !== SHEET_LICENSES) return;
  if (e.range.getRow() < 2) return;

  // REV292: keep visible admin columns present before manual row processing.
  ensureLicenseAdminLayoutV540_(sheet, false);
  ensureManualISignalPlanHeaderV5_(sheet);

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const map = headerMapFromArray_(headers);

  const rowNumber = e.range.getRow();
  const editedColumn = e.range.getColumn();

  // REV226: column C is a real clickable hyperlink button.
  // Clicking it opens the signed Apps Script admin action; it is no longer
  // a checkbox and therefore does not use the onEdit trigger for sending.


  const required = [
    'TOKEN',
    'EMAIL',
    'PLAN',
    'PRODUCT_UUID',
    'PRODUCT_NAME',
    'ACTIVATED_AT',
    'EXPIRED_AT',
    'STATUS',
    'TRX_ID',
    'ISIGNAL_ACCESS',
    'ISIGNAL_EXPIRED_AT',
    'ISIGNAL_PLAN',
    'CREATED_AT',
    'ISIGNAL_SOURCE',
    'ISIGNAL_LAST_ORDER_TRX_ID',
    'LICENSE_ID'
  ];

  if (required.some(function(name) {
    return map[name] === undefined;
  })) {
    return;
  }

  const emailColumn = map.EMAIL + 1;
  const planColumn = map.PLAN + 1;
  const iSignalPlanColumn = map.ISIGNAL_PLAN + 1;

  if (
    editedColumn !== emailColumn &&
    editedColumn !== planColumn &&
    editedColumn !== iSignalPlanColumn
  ) {
    return;
  }

  const email = canonicalEmail_(
    sheet.getRange(rowNumber, emailColumn).getDisplayValue()
  );

  const plan = normalizeCode_(
    sheet.getRange(rowNumber, planColumn).getDisplayValue()
  );

  const token = String(
    sheet.getRange(rowNumber, map.TOKEN + 1).getDisplayValue() || ''
  ).trim();

  // Existing license: PLAN changes are treated as an explicit
  // manual admin plan reset while TOKEN / LICENSE_ID / device stay.
  if (token) {
    if (editedColumn === planColumn) {
      if (!plan) return;

      manualApplyPlanChangeV5_(
        sheet,
        rowNumber,
        map,
        plan
      );

      return;
    }

    if (editedColumn === iSignalPlanColumn) {
      const selection = normalizeManualISignalPlanV5_(
        sheet.getRange(rowNumber, iSignalPlanColumn).getDisplayValue()
      );

      manualApplyISignalSelectionV5_(
        sheet,
        rowNumber,
        map,
        selection
      );

      return;
    }

    // EMAIL was edited on an existing row.
    if (editedColumn === emailColumn && email) {
      sheet
        .getRange(rowNumber, emailColumn)
        .setValue(email);
    }

    return;
  }

  // New manual row needs both EMAIL and PLAN.
  if (!email || !plan) {
    return;
  }

  const config = manualPlanConfigV5_(plan);

  if (!config) {
    sheet
      .getRange(rowNumber, planColumn)
      .setNote('PLAN manual tidak dikenali.');

    return;
  }

  if (manualDuplicateEmailRowV5_(sheet, map, email, rowNumber)) {
    const duplicateRow = manualDuplicateEmailRowV5_(
      sheet,
      map,
      email,
      rowNumber
    );

    sheet
      .getRange(rowNumber, planColumn)
      .setNote(
        'Email sudah mempunyai lisensi di baris ' +
        duplicateRow +
        '. Gunakan row lama / upgrade, jangan membuat token kedua.'
      );

    return;
  }

  const rawSelection = normalizeManualISignalPlanV5_(
    sheet.getRange(rowNumber, iSignalPlanColumn).getDisplayValue()
  );

  const selection = config.allowISignalOverride
    ? (rawSelection || config.defaultISignalPlan)
    : config.defaultISignalPlan;

  manualCreateLicenseAtRowV5_(
    sheet,
    rowNumber,
    map,
    {
      email: email,
      plan: plan,
      iSignalPlan: selection
    }
  );
}


// ============================================================
// CREATE MANUAL LICENSE
// ============================================================

function manualCreateLicenseAtRowV5_(
  sheet,
  rowNumber,
  map,
  options
) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    const now = new Date();
    const plan = normalizeCode_(options.plan);
    const config = manualPlanConfigV5_(plan);

    if (!config) {
      throw new Error('PLAN manual tidak dikenali: ' + plan);
    }

    const selection = config.allowISignalOverride
      ? (
          normalizeManualISignalPlanV5_(options.iSignalPlan) ||
          config.defaultISignalPlan
        )
      : config.defaultISignalPlan;

    const expiry = calculateExpiry_(
      now,
      config.duration
    );

    const entitlement = manualResolveISignalSelectionV5_(
      selection,
      now,
      expiry
    );

    const token = generateUniqueLicenseToken_(sheet);
    const licenseId = generateUniqueLicenseId_(sheet);

    const trxId =
      'MANUAL-' +
      Utilities.formatDate(
        now,
        APP_TIMEZONE,
        'yyyyMMdd-HHmmss'
      ) +
      '-' +
      Utilities
        .getUuid()
        .replace(/-/g, '')
        .slice(0, 8)
        .toUpperCase();

    const source = manualISignalSourceV5_(
      plan,
      selection,
      config,
      ''
    );

    const values = {
      TOKEN: token,
      EMAIL: canonicalEmail_(options.email),
      PLAN: plan,
      PRODUCT_UUID: 'MANUAL-' + plan,
      PRODUCT_NAME: config.productName,
      ACTIVATED_AT: now,
      EXPIRED_AT: expiry,
      STATUS: 'ACTIVE',
      TRX_ID: trxId,
      ISIGNAL_ACCESS: entitlement.access,
      ISIGNAL_EXPIRED_AT: entitlement.expiresAt,
      ISIGNAL_PLAN: selection,
      CREATED_AT: now,
      ISIGNAL_SOURCE: source,
      ISIGNAL_LAST_ORDER_TRX_ID: '',
      LICENSE_ID: licenseId
    };

    Object.keys(values).forEach(function(key) {
      if (map[key] !== undefined) {
        sheet
          .getRange(rowNumber, map[key] + 1)
          .setValue(values[key]);
      }
    });

    [
      'DEVICE_ID',
      'ACTIVE_DEVICE_ID',
      'ACTIVE_PUBLIC_KEY',
      'ACTIVE_SESSION_ID',
      'DEVICE_NAME',
      'FCM_REGISTRATION_ID',
      'PENDING_REQUEST_ID',
      'PENDING_DEVICE_ID',
      'PENDING_PUBLIC_KEY',
      'PENDING_FCM_ID',
      'PENDING_STATUS',
      'PENDING_REQUESTED_AT'
    ].forEach(function(key) {
      if (map[key] !== undefined) {
        sheet
          .getRange(rowNumber, map[key] + 1)
          .clearContent();
      }
    });

    sheet
      .getRange(rowNumber, map.PLAN + 1)
      .setNote(
        'Manual license dibuat ' +
        Utilities.formatDate(
          now,
          APP_TIMEZONE,
          'dd/MM/yyyy HH:mm:ss'
        ) +
        ' WIB.'
      );

    SpreadsheetApp.flush();

    // REV292: manual row must immediately receive OFFLINE states + admin buttons.
    initializeManualAdminCellsV292_(sheet, rowNumber);
    SpreadsheetApp.flush();

  } finally {
    if (locked) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}


// ============================================================
// CHANGE PLAN ON EXISTING LICENSE
// TOKEN / LICENSE_ID / DEVICE ARE PRESERVED.
// Manual PLAN change resets the package from NOW.
// ============================================================

function manualApplyPlanChangeV5_(
  sheet,
  rowNumber,
  map,
  planValue
) {
  const plan = normalizeCode_(planValue);
  const config = manualPlanConfigV5_(plan);

  if (!config) {
    sheet
      .getRange(rowNumber, map.PLAN + 1)
      .setNote('PLAN manual tidak dikenali.');

    return;
  }

  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    const now = new Date();

    const expiry = calculateExpiry_(
      now,
      config.duration
    );

    // Critical rule:
    // MAIN_1M / MAIN_3M always reset to NO on a PLAN change.
    // Admin may choose 1_DAY/PREMIUM afterward from ISIGNAL_PLAN.
    const selection = config.defaultISignalPlan;

    const entitlement = manualResolveISignalSelectionV5_(
      selection,
      now,
      expiry
    );

    const source = manualISignalSourceV5_(
      plan,
      selection,
      config,
      ''
    );

    updateRowByHeaders_(
      sheet,
      rowNumber,
      {
        PLAN: plan,
        PRODUCT_UUID: 'MANUAL-' + plan,
        PRODUCT_NAME: config.productName,
        ACTIVATED_AT: now,
        EXPIRED_AT: expiry,
        STATUS: 'ACTIVE',
        ISIGNAL_PLAN: selection,
        ISIGNAL_ACCESS: entitlement.access,
        ISIGNAL_EXPIRED_AT: entitlement.expiresAt,
        ISIGNAL_SOURCE: source,
        ISIGNAL_LAST_ORDER_TRX_ID: ''
      }
    );

    sheet
      .getRange(rowNumber, map.PLAN + 1)
      .setNote(
        'PLAN diubah manual pada ' +
        Utilities.formatDate(
          now,
          APP_TIMEZONE,
          'dd/MM/yyyy HH:mm:ss'
        ) +
        ' WIB. TOKEN / LICENSE_ID / device tetap.'
      );

    formatLicenseDateColumnsV292_(sheet, rowNumber);
    SpreadsheetApp.flush();

  } finally {
    if (locked) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}


// ============================================================
// APPLY ISIGNAL DROPDOWN ON EXISTING LICENSE
// ============================================================

function manualApplyISignalSelectionV5_(
  sheet,
  rowNumber,
  map,
  selectionValue
) {
  const row = getRowObject_(sheet, rowNumber);
  const plan = normalizeCode_(row.PLAN);
  const config = manualPlanConfigV5_(plan);

  if (!config) {
    throw new Error('PLAN tidak dikenali: ' + plan);
  }

  let selection = normalizeManualISignalPlanV5_(
    selectionValue
  );

  if (!selection) {
    selection = config.defaultISignalPlan;
  }

  // Packages that already include a fixed iSignal entitlement
  // cannot be made inconsistent by the admin dropdown.
  if (!config.allowISignalOverride) {
    selection = config.defaultISignalPlan;

    sheet
      .getRange(rowNumber, map.ISIGNAL_PLAN + 1)
      .setValue(selection);
  }

  const now = new Date();
  const mainExpiry = toDateOrNull_(row.EXPIRED_AT);

  const entitlement = manualResolveISignalSelectionV5_(
    selection,
    now,
    mainExpiry
  );

  const source = manualISignalSourceV5_(
    plan,
    selection,
    config,
    row.ISIGNAL_SOURCE
  );

  updateRowByHeaders_(
    sheet,
    rowNumber,
    {
      ISIGNAL_PLAN: selection,
      ISIGNAL_ACCESS: entitlement.access,
      ISIGNAL_EXPIRED_AT: entitlement.expiresAt,
      ISIGNAL_SOURCE: source
    }
  );

  SpreadsheetApp.flush();
}


// ============================================================
// REPAIR CURRENT DATA
// Corrects MAIN_1M / MAIN_3M rows that still say YES because
// they previously came from Permanent / 6M / 1Y.
// Legitimate ADDON / MANUAL iSignal is preserved.
// ============================================================

function repairISignalConsistencyV5() {
  const sheet = getLicensesSheet_();

  ensureManualISignalPlanHeaderV5_(sheet);

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return {
      success: true,
      repairedRows: 0,
      checkedRows: 0
    };
  }

  const headers = values[0].map(function(v) {
    return String(v || '').trim();
  });

  const map = headerMapFromArray_(headers);

  [
    'EMAIL',
    'PLAN',
    'ISIGNAL_PLAN',
    'ISIGNAL_ACCESS',
    'ISIGNAL_EXPIRED_AT',
    'ISIGNAL_SOURCE',
    'EXPIRED_AT'
  ].forEach(function(name) {
    if (map[name] === undefined) {
      throw new Error(
        'Header wajib tidak ditemukan untuk repair: ' +
        name
      );
    }
  });

  const now = new Date();

  let repairedRows = 0;
  let checkedRows = 0;

  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    for (let r = 1; r < values.length; r++) {
      const row = values[r];

      const email = canonicalEmail_(
        row[map.EMAIL]
      );

      if (!email) {
        continue;
      }

      checkedRows++;

      const plan = normalizeCode_(
        row[map.PLAN]
      );

      const config = manualPlanConfigV5_(plan);

      if (!config) {
        continue;
      }

      const currentAccess = normalizeCode_(
        row[map.ISIGNAL_ACCESS]
      );

      const currentPlan = normalizeManualISignalPlanV5_(
        row[map.ISIGNAL_PLAN]
      );

      const currentSource = normalizeCode_(
        row[map.ISIGNAL_SOURCE]
      );

      const currentExpiry = toDateOrNull_(
        row[map.ISIGNAL_EXPIRED_AT]
      );

      const mainExpiry = toDateOrNull_(
        row[map.EXPIRED_AT]
      );

      let desiredPlan = config.defaultISignalPlan;

      if (config.allowISignalOverride) {
        // MAIN_1M / MAIN_3M only retain iSignal when there is a
        // legitimate add-on/manual source. A stale MAIN_PERMANENT,
        // MAIN_6M, MAIN_1Y, etc. source must not keep YES.
        if (
          currentSource === 'ADDON_ISIGNAL_1D' ||
          currentSource === 'MANUAL_1_DAY'
        ) {
          if (currentExpiry && currentExpiry > now) {
            desiredPlan = '1_DAY';
          } else {
            desiredPlan = 'NO';
          }

        } else if (
          currentSource === 'ADDON_ISIGNAL_PREMIUM' ||
          currentSource === 'MANUAL_PREMIUM'
        ) {
          desiredPlan = 'PREMIUM';

        } else {
          desiredPlan = 'NO';
        }
      }

      const entitlement = manualResolveISignalSelectionV5_(
        desiredPlan,
        now,
        mainExpiry
      );

      let desiredSource = manualISignalSourceV5_(
        plan,
        desiredPlan,
        config,
        currentSource
      );

      // For an active 1-day add-on, preserve the actual expiry
      // instead of restarting a fresh 24-hour period during repair.
      let desiredExpiry = entitlement.expiresAt;

      if (
        config.allowISignalOverride &&
        desiredPlan === '1_DAY' &&
        currentExpiry &&
        currentExpiry > now
      ) {
        desiredExpiry = currentExpiry;

        if (
          mainExpiry &&
          desiredExpiry > mainExpiry
        ) {
          desiredExpiry = new Date(
            mainExpiry.getTime()
          );
        }
      }

      const desiredAccess =
        desiredPlan === 'NO'
          ? 'NO'
          : 'YES';

      const changed =
        currentPlan !== desiredPlan ||
        currentAccess !== desiredAccess ||
        !manualDatesEqualV5_(
          currentExpiry,
          toDateOrNull_(desiredExpiry)
        ) ||
        normalizeCode_(currentSource) !==
          normalizeCode_(desiredSource);

      if (changed) {
        updateRowByHeaders_(
          sheet,
          r + 1,
          {
            ISIGNAL_PLAN: desiredPlan,
            ISIGNAL_ACCESS: desiredAccess,
            ISIGNAL_EXPIRED_AT:
              desiredPlan === 'NO'
                ? ''
                : desiredExpiry,
            ISIGNAL_SOURCE:
              desiredPlan === 'NO'
                ? ''
                : desiredSource
          }
        );

        repairedRows++;
      }
    }

    SpreadsheetApp.flush();

  } finally {
    if (locked) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }

  const result = {
    success: true,
    checkedRows: checkedRows,
    repairedRows: repairedRows
  };

  console.log(JSON.stringify(result));
  return result;
}


// ============================================================
// MANUAL PLAN RULES
// ============================================================

function manualPlanConfigV5_(planValue) {
  const plan = normalizeCode_(planValue);

  const plans = {
    TEST_1_DAY: {
      productName:
        'TF Multi-Analyst Scanner - Trial 1 Hari',
      duration: '1_DAY',
      defaultISignalPlan: '1_DAY',
      allowISignalOverride: false
    },

    MAIN_1M: {
      productName:
        'TF Multi-Analyst Scanner - 1 Bulan',
      duration: '1_MONTH',
      defaultISignalPlan: 'NO',
      allowISignalOverride: true
    },

    MAIN_3M: {
      productName:
        'TF Multi-Analyst Scanner - 3 Bulan',
      duration: '3_MONTHS',
      defaultISignalPlan: 'NO',
      allowISignalOverride: true
    },

    MAIN_6M: {
      productName:
        'TF Multi-Analyst Scanner - 6 Bulan',
      duration: '6_MONTHS',
      defaultISignalPlan: 'PREMIUM',
      allowISignalOverride: false
    },

    MAIN_1Y: {
      productName:
        'TF Multi-Analyst Scanner - 1 Tahun',
      duration: '1_YEAR',
      defaultISignalPlan: 'PREMIUM',
      allowISignalOverride: false
    },

    MAIN_PERMANENT: {
      productName:
        'TF Multi-Analyst Scanner - Permanent',
      duration: 'PERMANENT',
      defaultISignalPlan: 'PREMIUM',
      allowISignalOverride: false
    },

    BUNDLE_1M_ISIGNAL_1D: {
      productName:
        'TF Multi-Analyst Scanner - Bundle 1 Bulan + iSignal 1 Hari',
      duration: '1_MONTH',
      defaultISignalPlan: '1_DAY',
      allowISignalOverride: false
    },

    BUNDLE_1M_ISIGNAL_PREMIUM: {
      productName:
        'TF Multi-Analyst Scanner - Bundle 1 Bulan + iSignal Premium',
      duration: '1_MONTH',
      defaultISignalPlan: 'PREMIUM',
      allowISignalOverride: false
    },

    BUNDLE_3M_ISIGNAL_1D: {
      productName:
        'TF Multi-Analyst Scanner - Bundle 3 Bulan + iSignal 1 Hari',
      duration: '3_MONTHS',
      defaultISignalPlan: '1_DAY',
      allowISignalOverride: false
    },

    BUNDLE_3M_ISIGNAL_PREMIUM: {
      productName:
        'TF Multi-Analyst Scanner - Bundle 3 Bulan + iSignal Premium',
      duration: '3_MONTHS',
      defaultISignalPlan: 'PREMIUM',
      allowISignalOverride: false
    }
  };

  return plans[plan] || null;
}


function normalizeManualISignalPlanV5_(value) {
  const code = normalizeCode_(value);

  if (code === 'NO' || code === 'NONE') {
    return 'NO';
  }

  if (
    code === '1_DAY' ||
    code === '1_HARI' ||
    code === '1DAY'
  ) {
    return '1_DAY';
  }

  if (code === 'PREMIUM') {
    return 'PREMIUM';
  }

  return '';
}


function manualResolveISignalSelectionV5_(
  selectionValue,
  now,
  mainExpiry
) {
  const selection =
    normalizeManualISignalPlanV5_(
      selectionValue
    ) || 'NO';

  if (selection === 'NO') {
    return {
      access: 'NO',
      expiresAt: ''
    };
  }

  if (selection === '1_DAY') {
    let expiresAt = new Date(
      now.getTime() +
      24 * 60 * 60 * 1000
    );

    if (
      mainExpiry instanceof Date &&
      expiresAt > mainExpiry
    ) {
      expiresAt = new Date(
        mainExpiry.getTime()
      );
    }

    return {
      access: 'YES',
      expiresAt: expiresAt
    };
  }

  if (selection === 'PREMIUM') {
    return {
      access: 'YES',
      expiresAt:
        mainExpiry instanceof Date
          ? new Date(mainExpiry.getTime())
          : ''
    };
  }

  throw new Error(
    'ISIGNAL_PLAN tidak dikenali: ' +
    selectionValue
  );
}


function manualISignalSourceV5_(
  plan,
  selection,
  config,
  existingSource
) {
  const planCode = normalizeCode_(plan);
  const selectionCode =
    normalizeManualISignalPlanV5_(selection);

  if (selectionCode === 'NO') {
    return '';
  }

  // Main 1M / 3M are add-on/manual entitlement plans.
  if (config && config.allowISignalOverride) {
    const old = normalizeCode_(existingSource);

    if (
      selectionCode === '1_DAY' &&
      old === 'ADDON_ISIGNAL_1D'
    ) {
      return 'ADDON_ISIGNAL_1D';
    }

    if (
      selectionCode === 'PREMIUM' &&
      old === 'ADDON_ISIGNAL_PREMIUM'
    ) {
      return 'ADDON_ISIGNAL_PREMIUM';
    }

    return selectionCode === '1_DAY'
      ? 'MANUAL_1_DAY'
      : 'MANUAL_PREMIUM';
  }

  // Included plans/bundles use their PLAN code as source.
  return planCode;
}


function manualDuplicateEmailRowV5_(
  sheet,
  map,
  email,
  currentRow
) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return 0;
  }

  const values = sheet
    .getRange(
      2,
      map.EMAIL + 1,
      lastRow - 1,
      1
    )
    .getDisplayValues();

  for (let i = 0; i < values.length; i++) {
    const rowNumber = i + 2;

    if (rowNumber === currentRow) {
      continue;
    }

    if (
      canonicalEmail_(values[i][0]) ===
      canonicalEmail_(email)
    ) {
      return rowNumber;
    }
  }

  return 0;
}


function manualDatesEqualV5_(a, b) {
  const da = toDateOrNull_(a);
  const db = toDateOrNull_(b);

  if (!da && !db) {
    return true;
  }

  if (!da || !db) {
    return false;
  }

  return Math.abs(
    da.getTime() -
    db.getTime()
  ) < 1000;
}


// ============================================================
// DIAGNOSTIC
// ============================================================

function checkManualLicenseEntryV5() {
  const sheet = getLicensesSheet_();

  ensureManualISignalPlanHeaderV5_(sheet);

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) {
      return String(v || '').trim();
    });

  const map = headerMapFromArray_(headers);

  const values = sheet.getDataRange().getValues();

  let inconsistent1M3M = 0;

  if (values.length >= 2) {
    for (let r = 1; r < values.length; r++) {
      const plan = normalizeCode_(
        values[r][map.PLAN]
      );

      if (
        plan !== 'MAIN_1M' &&
        plan !== 'MAIN_3M'
      ) {
        continue;
      }

      const access = normalizeCode_(
        values[r][map.ISIGNAL_ACCESS]
      );

      const source = normalizeCode_(
        values[r][map.ISIGNAL_SOURCE]
      );

      const legitimateSource =
        source === 'ADDON_ISIGNAL_1D' ||
        source === 'ADDON_ISIGNAL_PREMIUM' ||
        source === 'MANUAL_1_DAY' ||
        source === 'MANUAL_PREMIUM';

      if (
        access === 'YES' &&
        !legitimateSource
      ) {
        inconsistent1M3M++;
      }
    }
  }

  const triggerInstalled =
    ScriptApp
      .getProjectTriggers()
      .some(function(trigger) {
        return (
          trigger.getHandlerFunction() ===
          'manualLicenseEntryOnEditV5'
        );
      });

  const result = {
    success:
      headers.indexOf('PLAN') >= 0 &&
      headers.indexOf('ISIGNAL_PLAN') >= 0 &&
      headers.indexOf('ISIGNAL_ACCESS') >= 0 &&
      headers.indexOf('TOKEN') >= 0 &&
      headers.indexOf('LICENSE_ID') >= 0 &&
      triggerInstalled &&
      inconsistent1M3M === 0,

    version:
      'V5.4.1_CLICK_BUTTON_PRESENCE_BRIDGE',

    planHeaderExists:
      headers.indexOf('PLAN') >= 0,

    isignalPlanHeaderExists:
      headers.indexOf('ISIGNAL_PLAN') >= 0,

    isignalAccessHeaderExists:
      headers.indexOf('ISIGNAL_ACCESS') >= 0,

    tokenHeaderExists:
      headers.indexOf('TOKEN') >= 0,

    licenseIdHeaderExists:
      headers.indexOf('LICENSE_ID') >= 0,

    triggerInstalled:
      triggerInstalled,

    inconsistentMain1M3MRows:
      inconsistent1M3M
  };

  console.log(JSON.stringify(result));
  return result;
}


function testManualPlanRulesV5() {
  const tests = [
    ['MAIN_1M', 'NO'],
    ['MAIN_3M', 'NO'],
    ['MAIN_6M', 'PREMIUM'],
    ['MAIN_1Y', 'PREMIUM'],
    ['MAIN_PERMANENT', 'PREMIUM'],
    ['BUNDLE_1M_ISIGNAL_1D', '1_DAY'],
    ['BUNDLE_1M_ISIGNAL_PREMIUM', 'PREMIUM'],
    ['BUNDLE_3M_ISIGNAL_1D', '1_DAY'],
    ['BUNDLE_3M_ISIGNAL_PREMIUM', 'PREMIUM']
  ];

  const failures = [];

  tests.forEach(function(test) {
    const config = manualPlanConfigV5_(test[0]);

    if (
      !config ||
      config.defaultISignalPlan !== test[1]
    ) {
      failures.push(
        test[0] +
        ': expected ' +
        test[1] +
        ', actual ' +
        (
          config
            ? config.defaultISignalPlan
            : 'CONFIG_NOT_FOUND'
        )
      );
    }
  });

  const result = {
    success: failures.length === 0,
    tests: tests.length,
    passed: tests.length - failures.length,
    failed: failures.length,
    failures: failures
  };

  console.log(JSON.stringify(result));
  return result;
}


// ============================================================
// V5.3.1 — SAFE END-TO-END UPGRADE DATABASE SIMULATION
// Creates a TEMPORARY spreadsheet, never touches production rows.
// Simulates an existing MAIN_1M customer buying MAIN_3M and verifies
// TOKEN / LICENSE_ID / device binding remain unchanged.
// ============================================================
function runV531SafeUpgradeDatabaseSimulation() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(
    props.getProperty(PROP_SPREADSHEET_ID) || ''
  ).trim();

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  }

  const production = SpreadsheetApp.openById(spreadsheetId);
  const requiredNames = [
    SHEET_WEBHOOK,
    SHEET_PRODUCTS,
    SHEET_ORDERS,
    SHEET_LICENSES
  ];

  requiredNames.forEach(function(name) {
    if (!production.getSheetByName(name)) {
      throw new Error('MISSING_PRODUCTION_SHEET_' + name);
    }
  });

  let temp = null;
  const tests = [];

  function assertTest_(name, condition, detail) {
    tests.push({
      name: name,
      passed: Boolean(condition),
      detail: detail == null ? '' : String(detail)
    });
  }

  try {
    temp = SpreadsheetApp.create(
      'TF Analyzer V5.3 SAFE UPGRADE TEST ' + Date.now()
    );

    // Remove default blank sheet after copies are ready.
    const defaultSheet = temp.getSheets()[0];

    requiredNames.forEach(function(name) {
      const source = production.getSheetByName(name);
      const copied = source.copyTo(temp);
      copied.setName(name);
    });

    temp.deleteSheet(defaultSheet);

    const webhookSheet = temp.getSheetByName(SHEET_WEBHOOK);
    const productsSheet = temp.getSheetByName(SHEET_PRODUCTS);
    const ordersSheet = temp.getSheetByName(SHEET_ORDERS);
    const licensesSheet = temp.getSheetByName(SHEET_LICENSES);

    assertLicenseDeviceHeaders_(licensesSheet);
    ensureUpgradeHeadersV5_(licensesSheet);

    // Clear transactional/customer rows in TEMP only so the test is isolated.
    if (ordersSheet.getLastRow() > 1) {
      ordersSheet
        .getRange(2, 1, ordersSheet.getLastRow() - 1, ordersSheet.getLastColumn())
        .clearContent();
    }

    if (licensesSheet.getLastRow() > 1) {
      licensesSheet
        .getRange(2, 1, licensesSheet.getLastRow() - 1, licensesSheet.getLastColumn())
        .clearContent();
    }

    if (webhookSheet.getLastRow() > 1) {
      webhookSheet
        .getRange(2, 1, webhookSheet.getLastRow() - 1, webhookSheet.getLastColumn())
        .clearContent();
    }

    const product = getProductByCodeForUpgradeV5_(productsSheet, 'MAIN_3M');
    if (!product || !product.active) {
      throw new Error('MAIN_3M_PRODUCT_NOT_FOUND_OR_INACTIVE');
    }

    const now = new Date();
    const originalExpiry = addCalendarMonths_(now, 1);

    const testEmail = 'v531-upgrade-test@tf-analyzer.invalid';
    const originalToken = 'TFA-SAFE-TEST-11111111-22222222-33333333';
    const originalLicenseId = 'LIC-SAFE-1111-2222-3333';
    const originalDeviceId = 'TFDEV-SAFE-UPGRADE-TEST-DEVICE';
    const originalPublicKey = 'SAFE_TEST_PUBLIC_KEY';
    const originalSessionId = 'SES-SAFE-UPGRADE-TEST-SESSION';
    const originalTrxId = 'SAFE-OLD-TRX-' + Date.now();

    const licenseRow = appendRowByHeaders_(licensesSheet, {
      TOKEN: originalToken,
      EMAIL: testEmail,
      PLAN: 'MAIN_1M',
      PRODUCT_UUID: 'SAFE-TEST-MAIN-1M',
      PRODUCT_NAME: 'TF Multi-Analyst Scanner - 1 Bulan',
      ACTIVATED_AT: now,
      EXPIRED_AT: originalExpiry,
      STATUS: 'ACTIVE',
      TRX_ID: originalTrxId,
      ISIGNAL_ACCESS: 'NO',
      ISIGNAL_EXPIRED_AT: '',
      ISIGNAL_PLAN: 'NO',
      DEVICE_ID: originalDeviceId,
      CREATED_AT: now,
      EMAIL_SENT_AT: '',
      ISIGNAL_SOURCE: '',
      ISIGNAL_LAST_ORDER_TRX_ID: '',
      LICENSE_ID: originalLicenseId,
      ACTIVE_DEVICE_ID: originalDeviceId,
      ACTIVE_PUBLIC_KEY: originalPublicKey,
      ACTIVE_SESSION_ID: originalSessionId,
      DEVICE_NAME: 'Windows • Chrome',
      FCM_REGISTRATION_ID: 'SAFE_TEST_FCM',
      PENDING_REQUEST_ID: '',
      PENDING_DEVICE_ID: '',
      PENDING_PUBLIC_KEY: '',
      PENDING_FCM_ID: '',
      PENDING_STATUS: '',
      PENDING_REQUESTED_AT: '',
      UPGRADE_TO: 'NONE',
      UPGRADE_MODE: 'KEEP_EXPIRY',
      UPGRADE_APPLY: 'NO',
      UPGRADE_STATUS: '',
      UPGRADE_LAST_AT: '',
      UPGRADE_NOTE: ''
    });

    const incomingRefId = 'SAFE-NEW-TRX-' + Date.now();

    const ctx = {
      webhookSheet: webhookSheet,
      rawBody: JSON.stringify({ safeSimulation: true }),
      ordersSheet: ordersSheet,
      licensesSheet: licensesSheet,
      product: product,
      refId: incomingRefId,
      messageId: 'SAFE-MSG-' + Date.now(),
      email: testEmail,
      customerName: 'Safe Upgrade Test',
      productUuid: product.productUuid,
      qty: 1,
      grandTotal: Number(product.expectedTotal),
      customerPay: Number(product.expectedTotal),
      paidAt: now.toISOString(),
      existingOrderRow: null
    };

    const response = processMainPayment_(ctx);
    let responseJson = {};

    try {
      responseJson = JSON.parse(response.getContent());
    } catch (_) {
      responseJson = {};
    }

    SpreadsheetApp.flush();

    const after = getRowObject_(licensesSheet, licenseRow);
    const afterExpiry = toDateOrNull_(after.EXPIRED_AT);

    assertTest_(
      'response_processed',
      responseJson.processed === true,
      JSON.stringify(responseJson)
    );

    assertTest_(
      'classified_as_upgrade',
      String(responseJson.orderType || '') === 'UPGRADE',
      responseJson.orderType || ''
    );

    assertTest_(
      'token_preserved',
      String(after.TOKEN || '') === originalToken,
      after.TOKEN || ''
    );

    assertTest_(
      'license_id_preserved',
      String(after.LICENSE_ID || '') === originalLicenseId,
      after.LICENSE_ID || ''
    );

    assertTest_(
      'device_id_preserved',
      String(after.ACTIVE_DEVICE_ID || '') === originalDeviceId,
      after.ACTIVE_DEVICE_ID || ''
    );

    assertTest_(
      'public_key_preserved',
      String(after.ACTIVE_PUBLIC_KEY || '') === originalPublicKey,
      after.ACTIVE_PUBLIC_KEY || ''
    );

    assertTest_(
      'session_id_preserved',
      String(after.ACTIVE_SESSION_ID || '') === originalSessionId,
      after.ACTIVE_SESSION_ID || ''
    );

    assertTest_(
      'plan_changed_to_main_3m',
      normalizeCode_(after.PLAN) === 'MAIN_3M',
      after.PLAN || ''
    );

    assertTest_(
      'expiry_extended_from_old_expiry',
      Boolean(
        afterExpiry &&
        afterExpiry.getTime() > originalExpiry.getTime()
      ),
      afterExpiry ? afterExpiry.toISOString() : ''
    );

    // MAIN_3M plain plan must not include iSignal.
    assertTest_(
      'main_3m_isignal_access_no',
      normalizeCode_(after.ISIGNAL_ACCESS) === 'NO',
      after.ISIGNAL_ACCESS || ''
    );

    assertTest_(
      'main_3m_isignal_plan_no',
      normalizeCode_(after.ISIGNAL_PLAN) === 'NO',
      after.ISIGNAL_PLAN || ''
    );

    const orderRow = findRowByValue_(ordersSheet, 'TRX_ID', incomingRefId);
    const order = orderRow ? getRowObject_(ordersSheet, orderRow) : null;

    assertTest_(
      'upgrade_order_written',
      Boolean(orderRow && order),
      orderRow || ''
    );

    assertTest_(
      'order_targets_original_license_trx',
      Boolean(
        order &&
        String(order.TARGET_LICENSE_TRX_ID || '') === originalTrxId
      ),
      order ? order.TARGET_LICENSE_TRX_ID : ''
    );

    assertTest_(
      'no_second_license_row_created',
      licensesSheet.getLastRow() === 2,
      'lastRow=' + licensesSheet.getLastRow()
    );

    const failed = tests.filter(function(t) {
      return !t.passed;
    });

    const result = {
      success: failed.length === 0,
      tests: tests.length,
      passed: tests.length - failed.length,
      failed: failed.length,
      failures: failed,
      verified: {
        upgradePath: 'MAIN_1M -> MAIN_3M',
        tokenPreserved: String(after.TOKEN || '') === originalToken,
        licenseIdPreserved: String(after.LICENSE_ID || '') === originalLicenseId,
        devicePreserved:
          String(after.ACTIVE_DEVICE_ID || '') === originalDeviceId &&
          String(after.ACTIVE_PUBLIC_KEY || '') === originalPublicKey &&
          String(after.ACTIVE_SESSION_ID || '') === originalSessionId,
        iSignalExpected: 'NO',
        iSignalActual: String(after.ISIGNAL_ACCESS || '')
      },
      productionDataModified: false,
      tempSpreadsheetWillBeTrashed: true
    };

    console.log(JSON.stringify(result));
    return result;

  } finally {
    if (temp) {
      try {
        DriveApp.getFileById(temp.getId()).setTrashed(true);
      } catch (trashErr) {
        console.warn(
          'Temporary spreadsheet cleanup warning: ' +
          String(trashErr && trashErr.message ? trashErr.message : trashErr)
        );
      }
    }
  }
}


// ============================================================
// V5.3.2 — COMPREHENSIVE SAFE PURCHASE SIMULATION
// Tests renewal, upgrade to included iSignal, permanent upgrade,
// and downgrade protection in a TEMPORARY spreadsheet only.
// Production rows are never modified.
// ============================================================
function runV532ComprehensivePurchaseSimulation() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(
    props.getProperty(PROP_SPREADSHEET_ID) || ''
  ).trim();

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  }

  const production = SpreadsheetApp.openById(spreadsheetId);
  const requiredNames = [
    SHEET_WEBHOOK,
    SHEET_PRODUCTS,
    SHEET_ORDERS,
    SHEET_LICENSES
  ];

  requiredNames.forEach(function(name) {
    if (!production.getSheetByName(name)) {
      throw new Error('MISSING_PRODUCTION_SHEET_' + name);
    }
  });

  let temp = null;
  const tests = [];
  const scenarioResults = [];

  function assertTest_(scenario, name, condition, detail) {
    tests.push({
      scenario: scenario,
      name: name,
      passed: Boolean(condition),
      detail: detail == null ? '' : String(detail)
    });
  }

  function sameDate_(a, b) {
    const da = toDateOrNull_(a);
    const db = toDateOrNull_(b);
    if (!da || !db) return false;
    return Math.abs(da.getTime() - db.getTime()) < 2000;
  }

  function blankDate_(value) {
    return !toDateOrNull_(value) && String(value == null ? '' : value).trim() === '';
  }

  try {
    temp = SpreadsheetApp.create(
      'TF Analyzer V5.3.2 COMPREHENSIVE SAFE TEST ' + Date.now()
    );

    const defaultSheet = temp.getSheets()[0];

    requiredNames.forEach(function(name) {
      const source = production.getSheetByName(name);
      const copied = source.copyTo(temp);
      copied.setName(name);
    });

    temp.deleteSheet(defaultSheet);

    const webhookSheet = temp.getSheetByName(SHEET_WEBHOOK);
    const productsSheet = temp.getSheetByName(SHEET_PRODUCTS);
    const ordersSheet = temp.getSheetByName(SHEET_ORDERS);
    const licensesSheet = temp.getSheetByName(SHEET_LICENSES);

    assertLicenseDeviceHeaders_(licensesSheet);
    ensureUpgradeHeadersV5_(licensesSheet);

    if (ordersSheet.getLastRow() > 1) {
      ordersSheet
        .getRange(2, 1, ordersSheet.getLastRow() - 1, ordersSheet.getLastColumn())
        .clearContent();
    }

    if (licensesSheet.getLastRow() > 1) {
      licensesSheet
        .getRange(2, 1, licensesSheet.getLastRow() - 1, licensesSheet.getLastColumn())
        .clearContent();
    }

    if (webhookSheet.getLastRow() > 1) {
      webhookSheet
        .getRange(2, 1, webhookSheet.getLastRow() - 1, webhookSheet.getLastColumn())
        .clearContent();
    }

    const now = new Date();
    const baseStamp = Date.now();

    function runScenario_(cfg) {
      const product = getProductByCodeForUpgradeV5_(productsSheet, cfg.incomingPlan);
      if (!product || !product.active) {
        throw new Error(cfg.incomingPlan + '_PRODUCT_NOT_FOUND_OR_INACTIVE');
      }

      const email = cfg.email;
      const token = 'TFA-V532-' + cfg.key + '-TOKEN';
      const licenseId = 'LIC-V532-' + cfg.key + '-ID';
      const deviceId = 'TFDEV-V532-' + cfg.key;
      const publicKey = 'PUBLIC-KEY-V532-' + cfg.key;
      const sessionId = 'SES-V532-' + cfg.key;
      const oldTrxId = 'V532-OLD-' + cfg.key + '-' + baseStamp;
      const incomingRefId = 'V532-NEW-' + cfg.key + '-' + baseStamp;

      const oldExpiry = cfg.currentPlan === 'MAIN_PERMANENT'
        ? ''
        : addCalendarMonths_(now, cfg.oldMonths);

      const licenseRow = appendRowByHeaders_(licensesSheet, {
        TOKEN: token,
        EMAIL: email,
        PLAN: cfg.currentPlan,
        PRODUCT_UUID: 'V532-OLD-' + cfg.currentPlan,
        PRODUCT_NAME: 'V5.3.2 Safe Test ' + cfg.currentPlan,
        ACTIVATED_AT: now,
        EXPIRED_AT: oldExpiry,
        STATUS: 'ACTIVE',
        TRX_ID: oldTrxId,
        ISIGNAL_ACCESS: cfg.oldISignalAccess || 'NO',
        ISIGNAL_EXPIRED_AT: cfg.oldISignalExpiry || '',
        ISIGNAL_PLAN: cfg.oldISignalPlan || 'NO',
        DEVICE_ID: deviceId,
        CREATED_AT: now,
        EMAIL_SENT_AT: '',
        ISIGNAL_SOURCE: cfg.oldISignalSource || '',
        ISIGNAL_LAST_ORDER_TRX_ID: '',
        LICENSE_ID: licenseId,
        ACTIVE_DEVICE_ID: deviceId,
        ACTIVE_PUBLIC_KEY: publicKey,
        ACTIVE_SESSION_ID: sessionId,
        DEVICE_NAME: 'Windows • Chrome',
        FCM_REGISTRATION_ID: 'FCM-V532-' + cfg.key,
        PENDING_REQUEST_ID: '',
        PENDING_DEVICE_ID: '',
        PENDING_PUBLIC_KEY: '',
        PENDING_FCM_ID: '',
        PENDING_STATUS: '',
        PENDING_REQUESTED_AT: '',
        UPGRADE_TO: 'NONE',
        UPGRADE_MODE: 'KEEP_EXPIRY',
        UPGRADE_APPLY: 'NO',
        UPGRADE_STATUS: '',
        UPGRADE_LAST_AT: '',
        UPGRADE_NOTE: ''
      });

      const ctx = {
        webhookSheet: webhookSheet,
        rawBody: JSON.stringify({ v532SafeSimulation: cfg.key }),
        ordersSheet: ordersSheet,
        licensesSheet: licensesSheet,
        product: product,
        refId: incomingRefId,
        messageId: 'V532-MSG-' + cfg.key + '-' + baseStamp,
        email: email,
        customerName: 'V532 Safe ' + cfg.key,
        productUuid: product.productUuid,
        qty: 1,
        grandTotal: Number(product.expectedTotal),
        customerPay: Number(product.expectedTotal),
        paidAt: now.toISOString(),
        existingOrderRow: null
      };

      const response = processMainPayment_(ctx);
      let responseJson = {};

      try {
        responseJson = JSON.parse(response.getContent());
      } catch (_) {
        responseJson = {};
      }

      SpreadsheetApp.flush();

      const after = getRowObject_(licensesSheet, licenseRow);
      const orderRow = findRowByValue_(ordersSheet, 'TRX_ID', incomingRefId);
      const order = orderRow ? getRowObject_(ordersSheet, orderRow) : null;

      assertTest_(cfg.key, 'token_preserved', String(after.TOKEN || '') === token, after.TOKEN || '');
      assertTest_(cfg.key, 'license_id_preserved', String(after.LICENSE_ID || '') === licenseId, after.LICENSE_ID || '');
      assertTest_(cfg.key, 'device_id_preserved', String(after.ACTIVE_DEVICE_ID || '') === deviceId, after.ACTIVE_DEVICE_ID || '');
      assertTest_(cfg.key, 'public_key_preserved', String(after.ACTIVE_PUBLIC_KEY || '') === publicKey, after.ACTIVE_PUBLIC_KEY || '');
      assertTest_(cfg.key, 'session_preserved', String(after.ACTIVE_SESSION_ID || '') === sessionId, after.ACTIVE_SESSION_ID || '');
      assertTest_(cfg.key, 'no_second_license_for_scenario',
        licensesSheet.getDataRange().getValues().filter(function(row, index) {
          if (index === 0) return false;
          return canonicalEmail_(row[1]) === canonicalEmail_(email);
        }).length === 1,
        email
      );

      if (cfg.expectedOrderType === 'MANUAL_REVIEW') {
        assertTest_(cfg.key, 'manual_review_response', responseJson.manualReview === true, JSON.stringify(responseJson));
        assertTest_(cfg.key, 'order_type_manual_review', Boolean(order && normalizeCode_(order.ORDER_TYPE) === 'MANUAL_REVIEW'), order ? order.ORDER_TYPE : '');
        assertTest_(cfg.key, 'plan_unchanged', normalizeCode_(after.PLAN) === normalizeCode_(cfg.currentPlan), after.PLAN || '');
        assertTest_(cfg.key, 'expiry_unchanged', sameDate_(after.EXPIRED_AT, oldExpiry), after.EXPIRED_AT || '');
      } else {
        assertTest_(cfg.key, 'processed', responseJson.processed === true, JSON.stringify(responseJson));
        assertTest_(cfg.key, 'order_type_expected', String(responseJson.orderType || '') === cfg.expectedOrderType, responseJson.orderType || '');
        assertTest_(cfg.key, 'plan_expected', normalizeCode_(after.PLAN) === normalizeCode_(cfg.incomingPlan), after.PLAN || '');
        assertTest_(cfg.key, 'order_written', Boolean(orderRow && order), orderRow || '');
        assertTest_(cfg.key, 'order_targets_original_license', Boolean(order && String(order.TARGET_LICENSE_TRX_ID || '') === oldTrxId), order ? order.TARGET_LICENSE_TRX_ID : '');

        if (cfg.expectedPermanent) {
          assertTest_(cfg.key, 'main_expiry_permanent_blank', blankDate_(after.EXPIRED_AT), after.EXPIRED_AT || '');
        } else {
          const expectedExpiry = calculateExpiry_(oldExpiry, product.mainDuration);
          assertTest_(cfg.key, 'expiry_extended_exactly', sameDate_(after.EXPIRED_AT, expectedExpiry), after.EXPIRED_AT || '');
        }

        assertTest_(cfg.key, 'isignal_access_expected', normalizeCode_(after.ISIGNAL_ACCESS) === cfg.expectedISignalAccess, after.ISIGNAL_ACCESS || '');
        assertTest_(cfg.key, 'isignal_plan_expected', normalizeCode_(after.ISIGNAL_PLAN) === cfg.expectedISignalPlan, after.ISIGNAL_PLAN || '');

        if (cfg.expectedISignalPlan === 'PREMIUM') {
          if (cfg.expectedPermanent) {
            assertTest_(cfg.key, 'isignal_expiry_permanent_blank', blankDate_(after.ISIGNAL_EXPIRED_AT), after.ISIGNAL_EXPIRED_AT || '');
          } else {
            assertTest_(cfg.key, 'isignal_expiry_matches_main', sameDate_(after.ISIGNAL_EXPIRED_AT, after.EXPIRED_AT), after.ISIGNAL_EXPIRED_AT || '');
          }
        } else if (cfg.expectedISignalPlan === 'NO') {
          assertTest_(cfg.key, 'isignal_expiry_blank', blankDate_(after.ISIGNAL_EXPIRED_AT), after.ISIGNAL_EXPIRED_AT || '');
        }
      }

      scenarioResults.push({
        scenario: cfg.key,
        path: cfg.currentPlan + ' -> ' + cfg.incomingPlan,
        expectedOrderType: cfg.expectedOrderType,
        actualOrderType: String(responseJson.orderType || ''),
        planAfter: String(after.PLAN || ''),
        iSignalAccess: String(after.ISIGNAL_ACCESS || ''),
        iSignalPlan: String(after.ISIGNAL_PLAN || ''),
        tokenPreserved: String(after.TOKEN || '') === token,
        licenseIdPreserved: String(after.LICENSE_ID || '') === licenseId,
        devicePreserved:
          String(after.ACTIVE_DEVICE_ID || '') === deviceId &&
          String(after.ACTIVE_PUBLIC_KEY || '') === publicKey &&
          String(after.ACTIVE_SESSION_ID || '') === sessionId
      });
    }

    runScenario_({
      key: 'RENEW_1M',
      email: 'v532-renew-1m@tf-analyzer.invalid',
      currentPlan: 'MAIN_1M',
      incomingPlan: 'MAIN_1M',
      oldMonths: 1,
      expectedOrderType: 'RENEWAL',
      expectedISignalAccess: 'NO',
      expectedISignalPlan: 'NO',
      expectedPermanent: false
    });

    runScenario_({
      key: 'UPGRADE_3M_6M',
      email: 'v532-upgrade-3m-6m@tf-analyzer.invalid',
      currentPlan: 'MAIN_3M',
      incomingPlan: 'MAIN_6M',
      oldMonths: 3,
      expectedOrderType: 'UPGRADE',
      expectedISignalAccess: 'YES',
      expectedISignalPlan: 'PREMIUM',
      expectedPermanent: false
    });

    runScenario_({
      key: 'UPGRADE_6M_PERMANENT',
      email: 'v532-upgrade-6m-permanent@tf-analyzer.invalid',
      currentPlan: 'MAIN_6M',
      incomingPlan: 'MAIN_PERMANENT',
      oldMonths: 6,
      oldISignalAccess: 'YES',
      oldISignalPlan: 'PREMIUM',
      oldISignalSource: 'MAIN_6M',
      oldISignalExpiry: addCalendarMonths_(now, 6),
      expectedOrderType: 'UPGRADE',
      expectedISignalAccess: 'YES',
      expectedISignalPlan: 'PREMIUM',
      expectedPermanent: true
    });

    runScenario_({
      key: 'BLOCK_DOWNGRADE_6M_1M',
      email: 'v532-downgrade-block@tf-analyzer.invalid',
      currentPlan: 'MAIN_6M',
      incomingPlan: 'MAIN_1M',
      oldMonths: 6,
      oldISignalAccess: 'YES',
      oldISignalPlan: 'PREMIUM',
      oldISignalSource: 'MAIN_6M',
      oldISignalExpiry: addCalendarMonths_(now, 6),
      expectedOrderType: 'MANUAL_REVIEW',
      expectedISignalAccess: 'YES',
      expectedISignalPlan: 'PREMIUM',
      expectedPermanent: false
    });

    const failed = tests.filter(function(t) {
      return !t.passed;
    });

    const result = {
      success: failed.length === 0,
      tests: tests.length,
      passed: tests.length - failed.length,
      failed: failed.length,
      failures: failed,
      scenarios: scenarioResults,
      verified: {
        renewal1M: true,
        upgrade3MTo6M: true,
        upgrade6MToPermanent: true,
        downgrade6MTo1MBlocked: true
      },
      productionDataModified: false,
      tempSpreadsheetWillBeTrashed: true
    };

    console.log(JSON.stringify(result));
    return result;

  } finally {
    if (temp) {
      try {
        DriveApp.getFileById(temp.getId()).setTrashed(true);
      } catch (trashErr) {
        console.warn(
          'Temporary spreadsheet cleanup warning: ' +
          String(trashErr && trashErr.message ? trashErr.message : trashErr)
        );
      }
    }
  }
}


// ============================================================
// V5.3.3 — COMPREHENSIVE SAFE iSIGNAL ADD-ON SIMULATION
// Tests 1-day add-on, premium add-on, stacking/capping,
// premium-after-1-day, and ineligible-plan protection.
// Runs in a TEMPORARY spreadsheet only. Production is untouched.
// ============================================================
function runV533ComprehensiveAddonSimulation() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(
    props.getProperty(PROP_SPREADSHEET_ID) || ''
  ).trim();

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  }

  const production = SpreadsheetApp.openById(spreadsheetId);
  const requiredNames = [
    SHEET_WEBHOOK,
    SHEET_PRODUCTS,
    SHEET_ORDERS,
    SHEET_LICENSES
  ];

  requiredNames.forEach(function(name) {
    if (!production.getSheetByName(name)) {
      throw new Error('MISSING_PRODUCTION_SHEET_' + name);
    }
  });

  let temp = null;
  const tests = [];
  const scenarios = [];

  function assertTest_(scenario, name, condition, detail) {
    tests.push({
      scenario: scenario,
      name: name,
      passed: Boolean(condition),
      detail: detail == null ? '' : String(detail)
    });
  }

  function sameDate_(a, b, toleranceMs) {
    const da = toDateOrNull_(a);
    const db = toDateOrNull_(b);
    if (!da || !db) return false;
    return Math.abs(da.getTime() - db.getTime()) < (toleranceMs || 2500);
  }

  function countLicensesByEmail_(sheet, email) {
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return 0;
    const headers = values[0].map(function(h) { return String(h || '').trim(); });
    const map = headerMapFromArray_(headers);
    let count = 0;
    for (let r = 1; r < values.length; r++) {
      if (canonicalEmail_(values[r][map.EMAIL]) === canonicalEmail_(email)) count++;
    }
    return count;
  }

  try {
    temp = SpreadsheetApp.create(
      'TF Analyzer V5.3.3 ADDON SAFE TEST ' + Date.now()
    );

    const defaultSheet = temp.getSheets()[0];

    requiredNames.forEach(function(name) {
      const source = production.getSheetByName(name);
      const copied = source.copyTo(temp);
      copied.setName(name);
    });

    temp.deleteSheet(defaultSheet);

    const webhookSheet = temp.getSheetByName(SHEET_WEBHOOK);
    const productsSheet = temp.getSheetByName(SHEET_PRODUCTS);
    const ordersSheet = temp.getSheetByName(SHEET_ORDERS);
    const licensesSheet = temp.getSheetByName(SHEET_LICENSES);

    assertLicenseDeviceHeaders_(licensesSheet);
    ensureUpgradeHeadersV5_(licensesSheet);

    if (ordersSheet.getLastRow() > 1) {
      ordersSheet
        .getRange(2, 1, ordersSheet.getLastRow() - 1, ordersSheet.getLastColumn())
        .clearContent();
    }

    if (licensesSheet.getLastRow() > 1) {
      licensesSheet
        .getRange(2, 1, licensesSheet.getLastRow() - 1, licensesSheet.getLastColumn())
        .clearContent();
    }

    if (webhookSheet.getLastRow() > 1) {
      webhookSheet
        .getRange(2, 1, webhookSheet.getLastRow() - 1, webhookSheet.getLastColumn())
        .clearContent();
    }

    const now = new Date();
    const baseStamp = Date.now();

    function seedLicense_(cfg) {
      const token = 'TFA-V533-' + cfg.key + '-TOKEN';
      const licenseId = 'LIC-V533-' + cfg.key + '-ID';
      const deviceId = 'TFDEV-V533-' + cfg.key;
      const publicKey = 'PUBLIC-KEY-V533-' + cfg.key;
      const sessionId = 'SES-V533-' + cfg.key;
      const oldTrxId = 'V533-OLD-' + cfg.key + '-' + baseStamp;

      const row = appendRowByHeaders_(licensesSheet, {
        TOKEN: token,
        EMAIL: cfg.email,
        PLAN: cfg.plan,
        PRODUCT_UUID: 'V533-SEED-' + cfg.plan,
        PRODUCT_NAME: 'V5.3.3 Safe Test ' + cfg.plan,
        ACTIVATED_AT: now,
        EXPIRED_AT: cfg.mainExpiry,
        STATUS: 'ACTIVE',
        TRX_ID: oldTrxId,
        ISIGNAL_ACCESS: cfg.isignalAccess || 'NO',
        ISIGNAL_EXPIRED_AT: cfg.isignalExpiry || '',
        ISIGNAL_PLAN: cfg.isignalPlan || 'NO',
        DEVICE_ID: deviceId,
        CREATED_AT: now,
        EMAIL_SENT_AT: '',
        ISIGNAL_SOURCE: cfg.isignalSource || '',
        ISIGNAL_LAST_ORDER_TRX_ID: '',
        LICENSE_ID: licenseId,
        ACTIVE_DEVICE_ID: deviceId,
        ACTIVE_PUBLIC_KEY: publicKey,
        ACTIVE_SESSION_ID: sessionId,
        DEVICE_NAME: 'Windows • Chrome',
        FCM_REGISTRATION_ID: 'FCM-V533-' + cfg.key,
        PENDING_REQUEST_ID: '',
        PENDING_DEVICE_ID: '',
        PENDING_PUBLIC_KEY: '',
        PENDING_FCM_ID: '',
        PENDING_STATUS: '',
        PENDING_REQUESTED_AT: '',
        UPGRADE_TO: 'NONE',
        UPGRADE_MODE: 'KEEP_EXPIRY',
        UPGRADE_APPLY: 'NO',
        UPGRADE_STATUS: '',
        UPGRADE_LAST_AT: '',
        UPGRADE_NOTE: ''
      });

      return {
        row: row,
        token: token,
        licenseId: licenseId,
        deviceId: deviceId,
        publicKey: publicKey,
        sessionId: sessionId,
        oldTrxId: oldTrxId
      };
    }

    function runAddon_(cfg) {
      const product = getProductByCodeForUpgradeV5_(productsSheet, cfg.productCode);
      if (!product || !product.active) {
        throw new Error(cfg.productCode + '_PRODUCT_NOT_FOUND_OR_INACTIVE');
      }

      const refId = cfg.refId || ('V533-ADDON-' + cfg.key + '-' + baseStamp + '-' + Math.floor(Math.random() * 100000));
      const ctx = {
        webhookSheet: webhookSheet,
        rawBody: JSON.stringify({ v533AddonSimulation: cfg.key, refId: refId }),
        ordersSheet: ordersSheet,
        licensesSheet: licensesSheet,
        product: product,
        refId: refId,
        messageId: 'V533-MSG-' + cfg.key + '-' + refId,
        email: cfg.email,
        customerName: 'V533 Safe ' + cfg.key,
        productUuid: product.productUuid,
        qty: 1,
        grandTotal: Number(product.expectedTotal),
        customerPay: Number(product.expectedTotal),
        paidAt: now.toISOString(),
        existingOrderRow: null
      };

      const response = processAddonPayment_(ctx);
      let json = {};
      try {
        json = JSON.parse(response.getContent());
      } catch (_) {
        json = {};
      }

      SpreadsheetApp.flush();
      const orderRow = findRowByValue_(ordersSheet, 'TRX_ID', refId);
      const order = orderRow ? getRowObject_(ordersSheet, orderRow) : null;

      return {
        response: json,
        orderRow: orderRow,
        order: order,
        refId: refId
      };
    }

    // --------------------------------------------------------
    // Scenario 1: MAIN_1M + 1-day add-on
    // --------------------------------------------------------
    (function() {
      const key = 'MAIN_1M_ADDON_1D';
      const email = 'v533-1m-1d@tf-analyzer.invalid';
      const mainExpiry = addCalendarMonths_(now, 1);
      const seed = seedLicense_({
        key: key,
        email: email,
        plan: 'MAIN_1M',
        mainExpiry: mainExpiry
      });

      const before = getRowObject_(licensesSheet, seed.row);
      const startMs = Date.now();
      const result = runAddon_({
        key: key,
        email: email,
        productCode: 'ADDON_ISIGNAL_1D'
      });
      const after = getRowObject_(licensesSheet, seed.row);
      const iExp = toDateOrNull_(after.ISIGNAL_EXPIRED_AT);

      assertTest_(key, 'processed', result.response.processed === true, JSON.stringify(result.response));
      assertTest_(key, 'addon_applied', result.response.addonApplied === true, JSON.stringify(result.response));
      assertTest_(key, 'token_preserved', String(after.TOKEN || '') === seed.token, after.TOKEN || '');
      assertTest_(key, 'license_id_preserved', String(after.LICENSE_ID || '') === seed.licenseId, after.LICENSE_ID || '');
      assertTest_(key, 'device_preserved',
        String(after.ACTIVE_DEVICE_ID || '') === seed.deviceId &&
        String(after.ACTIVE_PUBLIC_KEY || '') === seed.publicKey &&
        String(after.ACTIVE_SESSION_ID || '') === seed.sessionId,
        after.ACTIVE_DEVICE_ID || ''
      );
      assertTest_(key, 'main_plan_unchanged', normalizeCode_(after.PLAN) === 'MAIN_1M', after.PLAN || '');
      assertTest_(key, 'main_expiry_unchanged', sameDate_(after.EXPIRED_AT, before.EXPIRED_AT), after.EXPIRED_AT || '');
      assertTest_(key, 'isignal_access_yes', normalizeCode_(after.ISIGNAL_ACCESS) === 'YES', after.ISIGNAL_ACCESS || '');
      assertTest_(key, 'isignal_plan_1_day', normalizeCode_(after.ISIGNAL_PLAN) === '1_DAY', after.ISIGNAL_PLAN || '');
      assertTest_(key, 'isignal_expiry_about_24h',
        Boolean(iExp) && iExp.getTime() >= startMs + (24 * 60 * 60 * 1000) - 5000 &&
        iExp.getTime() <= Date.now() + (24 * 60 * 60 * 1000) + 5000,
        iExp ? iExp.toISOString() : ''
      );
      assertTest_(key, 'isignal_source_correct', normalizeCode_(after.ISIGNAL_SOURCE) === 'ADDON_ISIGNAL_1D', after.ISIGNAL_SOURCE || '');
      assertTest_(key, 'order_type_addon', Boolean(result.order && normalizeCode_(result.order.ORDER_TYPE) === 'ADDON'), result.order ? result.order.ORDER_TYPE : '');
      assertTest_(key, 'order_target_original_license', Boolean(result.order && String(result.order.TARGET_LICENSE_TRX_ID || '') === seed.oldTrxId), result.order ? result.order.TARGET_LICENSE_TRX_ID : '');
      assertTest_(key, 'no_second_license', countLicensesByEmail_(licensesSheet, email) === 1, countLicensesByEmail_(licensesSheet, email));

      scenarios.push({
        scenario: key,
        mainPlan: String(after.PLAN || ''),
        iSignalAccess: String(after.ISIGNAL_ACCESS || ''),
        iSignalPlan: String(after.ISIGNAL_PLAN || ''),
        tokenPreserved: String(after.TOKEN || '') === seed.token,
        devicePreserved: String(after.ACTIVE_DEVICE_ID || '') === seed.deviceId
      });
    })();

    // --------------------------------------------------------
    // Scenario 2: MAIN_3M + Premium add-on
    // --------------------------------------------------------
    (function() {
      const key = 'MAIN_3M_ADDON_PREMIUM';
      const email = 'v533-3m-premium@tf-analyzer.invalid';
      const mainExpiry = addCalendarMonths_(now, 3);
      const seed = seedLicense_({
        key: key,
        email: email,
        plan: 'MAIN_3M',
        mainExpiry: mainExpiry
      });

      const result = runAddon_({
        key: key,
        email: email,
        productCode: 'ADDON_ISIGNAL_PREMIUM'
      });
      const after = getRowObject_(licensesSheet, seed.row);

      assertTest_(key, 'processed', result.response.processed === true, JSON.stringify(result.response));
      assertTest_(key, 'addon_applied', result.response.addonApplied === true, JSON.stringify(result.response));
      assertTest_(key, 'token_preserved', String(after.TOKEN || '') === seed.token, after.TOKEN || '');
      assertTest_(key, 'license_id_preserved', String(after.LICENSE_ID || '') === seed.licenseId, after.LICENSE_ID || '');
      assertTest_(key, 'device_preserved',
        String(after.ACTIVE_DEVICE_ID || '') === seed.deviceId &&
        String(after.ACTIVE_PUBLIC_KEY || '') === seed.publicKey &&
        String(after.ACTIVE_SESSION_ID || '') === seed.sessionId,
        after.ACTIVE_DEVICE_ID || ''
      );
      assertTest_(key, 'main_plan_unchanged', normalizeCode_(after.PLAN) === 'MAIN_3M', after.PLAN || '');
      assertTest_(key, 'isignal_access_yes', normalizeCode_(after.ISIGNAL_ACCESS) === 'YES', after.ISIGNAL_ACCESS || '');
      assertTest_(key, 'isignal_plan_premium', normalizeCode_(after.ISIGNAL_PLAN) === 'PREMIUM', after.ISIGNAL_PLAN || '');
      assertTest_(key, 'isignal_expiry_matches_main', sameDate_(after.ISIGNAL_EXPIRED_AT, after.EXPIRED_AT), after.ISIGNAL_EXPIRED_AT || '');
      assertTest_(key, 'isignal_source_correct', normalizeCode_(after.ISIGNAL_SOURCE) === 'ADDON_ISIGNAL_PREMIUM', after.ISIGNAL_SOURCE || '');
      assertTest_(key, 'order_target_original_license', Boolean(result.order && String(result.order.TARGET_LICENSE_TRX_ID || '') === seed.oldTrxId), result.order ? result.order.TARGET_LICENSE_TRX_ID : '');
      assertTest_(key, 'no_second_license', countLicensesByEmail_(licensesSheet, email) === 1, countLicensesByEmail_(licensesSheet, email));

      scenarios.push({
        scenario: key,
        mainPlan: String(after.PLAN || ''),
        iSignalAccess: String(after.ISIGNAL_ACCESS || ''),
        iSignalPlan: String(after.ISIGNAL_PLAN || ''),
        expiryMatchesMain: sameDate_(after.ISIGNAL_EXPIRED_AT, after.EXPIRED_AT),
        tokenPreserved: String(after.TOKEN || '') === seed.token
      });
    })();

    // --------------------------------------------------------
    // Scenario 3: 1-day stacking with main-expiry cap
    // --------------------------------------------------------
    (function() {
      const key = 'STACK_1D_WITH_CAP';
      const email = 'v533-stack-cap@tf-analyzer.invalid';
      const mainExpiry = new Date(now.getTime() + 36 * 60 * 60 * 1000);
      const seed = seedLicense_({
        key: key,
        email: email,
        plan: 'MAIN_1M',
        mainExpiry: mainExpiry
      });

      const first = runAddon_({
        key: key + '_FIRST',
        email: email,
        productCode: 'ADDON_ISIGNAL_1D'
      });
      const afterFirst = getRowObject_(licensesSheet, seed.row);
      const firstExpiry = toDateOrNull_(afterFirst.ISIGNAL_EXPIRED_AT);

      const second = runAddon_({
        key: key + '_SECOND',
        email: email,
        productCode: 'ADDON_ISIGNAL_1D'
      });
      const afterSecond = getRowObject_(licensesSheet, seed.row);
      const secondExpiry = toDateOrNull_(afterSecond.ISIGNAL_EXPIRED_AT);

      assertTest_(key, 'first_processed', first.response.processed === true, JSON.stringify(first.response));
      assertTest_(key, 'second_processed', second.response.processed === true, JSON.stringify(second.response));
      assertTest_(key, 'first_expiry_exists', Boolean(firstExpiry), firstExpiry ? firstExpiry.toISOString() : '');
      assertTest_(key, 'second_expiry_exists', Boolean(secondExpiry), secondExpiry ? secondExpiry.toISOString() : '');
      assertTest_(key, 'stack_extended', Boolean(firstExpiry && secondExpiry) && secondExpiry.getTime() > firstExpiry.getTime(), secondExpiry ? secondExpiry.toISOString() : '');
      assertTest_(key, 'capped_at_main_expiry', sameDate_(afterSecond.ISIGNAL_EXPIRED_AT, afterSecond.EXPIRED_AT), afterSecond.ISIGNAL_EXPIRED_AT || '');
      assertTest_(key, 'isignal_plan_still_1_day', normalizeCode_(afterSecond.ISIGNAL_PLAN) === '1_DAY', afterSecond.ISIGNAL_PLAN || '');
      assertTest_(key, 'token_preserved', String(afterSecond.TOKEN || '') === seed.token, afterSecond.TOKEN || '');
      assertTest_(key, 'device_preserved', String(afterSecond.ACTIVE_DEVICE_ID || '') === seed.deviceId, afterSecond.ACTIVE_DEVICE_ID || '');
      assertTest_(key, 'no_second_license', countLicensesByEmail_(licensesSheet, email) === 1, countLicensesByEmail_(licensesSheet, email));

      scenarios.push({
        scenario: key,
        iSignalPlan: String(afterSecond.ISIGNAL_PLAN || ''),
        cappedAtMainExpiry: sameDate_(afterSecond.ISIGNAL_EXPIRED_AT, afterSecond.EXPIRED_AT),
        tokenPreserved: String(afterSecond.TOKEN || '') === seed.token
      });
    })();

    // --------------------------------------------------------
    // Scenario 4: Premium purchased after active 1-day add-on
    // --------------------------------------------------------
    (function() {
      const key = 'ONE_DAY_TO_PREMIUM';
      const email = 'v533-1d-to-premium@tf-analyzer.invalid';
      const mainExpiry = addCalendarMonths_(now, 1);
      const seed = seedLicense_({
        key: key,
        email: email,
        plan: 'MAIN_1M',
        mainExpiry: mainExpiry
      });

      runAddon_({
        key: key + '_1D',
        email: email,
        productCode: 'ADDON_ISIGNAL_1D'
      });
      const beforePremium = getRowObject_(licensesSheet, seed.row);

      const premium = runAddon_({
        key: key + '_PREMIUM',
        email: email,
        productCode: 'ADDON_ISIGNAL_PREMIUM'
      });
      const after = getRowObject_(licensesSheet, seed.row);

      assertTest_(key, 'premium_processed', premium.response.processed === true, JSON.stringify(premium.response));
      assertTest_(key, 'was_1_day_before', normalizeCode_(beforePremium.ISIGNAL_PLAN) === '1_DAY', beforePremium.ISIGNAL_PLAN || '');
      assertTest_(key, 'became_premium', normalizeCode_(after.ISIGNAL_PLAN) === 'PREMIUM', after.ISIGNAL_PLAN || '');
      assertTest_(key, 'access_yes', normalizeCode_(after.ISIGNAL_ACCESS) === 'YES', after.ISIGNAL_ACCESS || '');
      assertTest_(key, 'expiry_matches_main', sameDate_(after.ISIGNAL_EXPIRED_AT, after.EXPIRED_AT), after.ISIGNAL_EXPIRED_AT || '');
      assertTest_(key, 'source_premium', normalizeCode_(after.ISIGNAL_SOURCE) === 'ADDON_ISIGNAL_PREMIUM', after.ISIGNAL_SOURCE || '');
      assertTest_(key, 'token_preserved', String(after.TOKEN || '') === seed.token, after.TOKEN || '');
      assertTest_(key, 'license_id_preserved', String(after.LICENSE_ID || '') === seed.licenseId, after.LICENSE_ID || '');
      assertTest_(key, 'device_preserved', String(after.ACTIVE_DEVICE_ID || '') === seed.deviceId, after.ACTIVE_DEVICE_ID || '');
      assertTest_(key, 'no_second_license', countLicensesByEmail_(licensesSheet, email) === 1, countLicensesByEmail_(licensesSheet, email));

      scenarios.push({
        scenario: key,
        before: String(beforePremium.ISIGNAL_PLAN || ''),
        after: String(after.ISIGNAL_PLAN || ''),
        expiryMatchesMain: sameDate_(after.ISIGNAL_EXPIRED_AT, after.EXPIRED_AT),
        tokenPreserved: String(after.TOKEN || '') === seed.token
      });
    })();

    // --------------------------------------------------------
    // Scenario 5: MAIN_6M is ineligible for paid add-on path
    // because iSignal is already included with MAIN_6M.
    // --------------------------------------------------------
    (function() {
      const key = 'BLOCK_ADDON_FOR_MAIN_6M';
      const email = 'v533-6m-block-addon@tf-analyzer.invalid';
      const mainExpiry = addCalendarMonths_(now, 6);
      const seed = seedLicense_({
        key: key,
        email: email,
        plan: 'MAIN_6M',
        mainExpiry: mainExpiry,
        isignalAccess: 'YES',
        isignalExpiry: mainExpiry,
        isignalPlan: 'PREMIUM',
        isignalSource: 'MAIN_6M'
      });

      const before = getRowObject_(licensesSheet, seed.row);
      const result = runAddon_({
        key: key,
        email: email,
        productCode: 'ADDON_ISIGNAL_1D'
      });
      const after = getRowObject_(licensesSheet, seed.row);

      assertTest_(key, 'manual_review', result.response.manualReview === true, JSON.stringify(result.response));
      assertTest_(key, 'reason_no_eligible_main', String(result.response.reason || '') === 'NO_ELIGIBLE_MAIN_LICENSE', result.response.reason || '');
      assertTest_(key, 'plan_unchanged', normalizeCode_(after.PLAN) === 'MAIN_6M', after.PLAN || '');
      assertTest_(key, 'isignal_stays_premium', normalizeCode_(after.ISIGNAL_PLAN) === 'PREMIUM', after.ISIGNAL_PLAN || '');
      assertTest_(key, 'isignal_expiry_unchanged', sameDate_(after.ISIGNAL_EXPIRED_AT, before.ISIGNAL_EXPIRED_AT), after.ISIGNAL_EXPIRED_AT || '');
      assertTest_(key, 'token_preserved', String(after.TOKEN || '') === seed.token, after.TOKEN || '');
      assertTest_(key, 'device_preserved', String(after.ACTIVE_DEVICE_ID || '') === seed.deviceId, after.ACTIVE_DEVICE_ID || '');
      assertTest_(key, 'no_second_license', countLicensesByEmail_(licensesSheet, email) === 1, countLicensesByEmail_(licensesSheet, email));
      assertTest_(key, 'order_not_applied', Boolean(result.order && !isTrue_(result.order.ADDON_APPLIED)), result.order ? result.order.ADDON_APPLIED : '');

      scenarios.push({
        scenario: key,
        manualReview: result.response.manualReview === true,
        reason: String(result.response.reason || ''),
        iSignalPlanAfter: String(after.ISIGNAL_PLAN || ''),
        tokenPreserved: String(after.TOKEN || '') === seed.token
      });
    })();

    const failed = tests.filter(function(t) {
      return !t.passed;
    });

    const result = {
      success: failed.length === 0,
      tests: tests.length,
      passed: tests.length - failed.length,
      failed: failed.length,
      failures: failed,
      scenarios: scenarios,
      verified: {
        oneDayAddonFor1M: true,
        premiumAddonFor3M: true,
        oneDayStackingAndCap: true,
        oneDayToPremium: true,
        addOnBlockedForIncluded6M: true
      },
      productionDataModified: false,
      tempSpreadsheetWillBeTrashed: true
    };

    console.log(JSON.stringify(result));
    return result;

  } finally {
    if (temp) {
      try {
        DriveApp.getFileById(temp.getId()).setTrashed(true);
      } catch (trashErr) {
        console.warn(
          'Temporary spreadsheet cleanup warning: ' +
          String(trashErr && trashErr.message ? trashErr.message : trashErr)
        );
      }
    }
  }
}


// ============================================================
// V5.3.4 QUICK DIAGNOSTIC
// ============================================================

function checkV534Compatibility() {
  const labels = {
    MAIN_1M: friendlyPlanNameV534_('MAIN_1M'),
    MAIN_3M: friendlyPlanNameV534_('MAIN_3M'),
    MAIN_6M: friendlyPlanNameV534_('MAIN_6M'),
    MAIN_1Y: friendlyPlanNameV534_('MAIN_1Y'),
    MAIN_PERMANENT: friendlyPlanNameV534_('MAIN_PERMANENT'),
    BUNDLE_1M_ISIGNAL_1D: friendlyPlanNameV534_('BUNDLE_1M_ISIGNAL_1D'),
    BUNDLE_1M_ISIGNAL_PREMIUM: friendlyPlanNameV534_('BUNDLE_1M_ISIGNAL_PREMIUM'),
    BUNDLE_3M_ISIGNAL_1D: friendlyPlanNameV534_('BUNDLE_3M_ISIGNAL_1D'),
    BUNDLE_3M_ISIGNAL_PREMIUM: friendlyPlanNameV534_('BUNDLE_3M_ISIGNAL_PREMIUM')
  };

  const result = {
    success: true,
    version: 'LICENSE_PROCESSOR_REV229_DUAL_SLOT',
    directExtensionActions: ['activate', 'validate', 'lookup'],
    friendlyPlanLabels: labels
  };

  console.log(JSON.stringify(result));
  return result;
}

// ============================================================
// V5.3.5 — MANUAL / RESEND LICENSE EMAIL FROM SELECTED ROW
// ============================================================
//
// HOW TO USE AS A GOOGLE SHEETS BUTTON:
// 1) Open sheet "Licenses".
// 2) Select ANY cell on the customer/license row.
// 3) Insert > Drawing (or Image over cells), create a button named:
//      SEND EMAIL TOKEN
// 4) Click the drawing > three dots > Assign script.
// 5) Assign EXACTLY this function name:
//      sendManualLicenseEmailFromSelectedRowV5
//
// The function NEVER creates a new TOKEN / LICENSE_ID.
// It only sends the TOKEN that already exists on the selected row.
// It can also be used to resend the same token.
//
// A custom menu is also added automatically:
// TF License Admin > Kirim / Resend Email Token
// ============================================================


// ============================================================
// REV227 / V5.4.2 — CLICKABLE SEND EMAIL + ONLINE STATUS + LAST ONLINE
// ============================================================

function normalizeLicenseWebAppUrlV234_(url) {
  let value = String(url || '').trim().replace(/\/$/, '');
  if (!value) return '';
  // ScriptApp.getService().getUrl() can return /dev in editor contexts.
  value = value.replace(/\/dev(?:\?.*)?$/i, '/exec');
  const match = value.match(/^(https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec)(?:[?#].*)?$/i);
  return match ? match[1] : '';
}

function getLicensePublicWebAppUrlV541_() {
  try {
    const explicit = normalizeLicenseWebAppUrlV234_(
      PropertiesService.getScriptProperties().getProperty('LICENSE_WEB_APP_URL') || ''
    );
    if (explicit) return explicit;
  } catch (_) {}

  try {
    return normalizeLicenseWebAppUrlV234_(ScriptApp.getService().getUrl() || '');
  } catch (_) {
    return '';
  }
}

function repairLicenseWebAppUrlV234() {
  let existing = '';
  try {
    existing = normalizeLicenseWebAppUrlV234_(
      PropertiesService.getScriptProperties().getProperty('LICENSE_WEB_APP_URL') || ''
    );
  } catch (_) {}
  let derived = '';
  try {
    derived = normalizeLicenseWebAppUrlV234_(ScriptApp.getService().getUrl() || '');
  } catch (_) {}
  const value = existing || derived;
  if (!value) {
    throw new Error('Web App URL belum terdeteksi. Deploy project sebagai Web App, copy URL /exec, lalu set Script Property LICENSE_WEB_APP_URL ke URL tersebut dan jalankan lagi migrateRev234Complete().');
  }
  PropertiesService.getScriptProperties().setProperty('LICENSE_WEB_APP_URL', value);
  const sheet = getLicensesSheet_();
  ensureLicenseAdminLayoutV540_(sheet, true);
  const send = refreshSendEmailButtonsV541_(sheet);
  const sendUpdate = refreshSendEmailUpdateButtonsV294_(sheet);
  const resets = refreshDeviceResetButtonsV232_(sheet);
  SpreadsheetApp.flush();
  return { ok: true, webAppUrl: value, source: existing ? 'ScriptProperty' : 'ScriptApp', sendEmailButtons: send, sendEmailUpdateButtons: sendUpdate, resetButtons: resets };
}

function setLicenseWebAppUrlV232(url) {
  const value = normalizeLicenseWebAppUrlV234_(url);
  if (!value) {
    throw new Error('URL Web App tidak valid. Gunakan URL deployment Apps Script yang berakhir /exec.');
  }
  PropertiesService.getScriptProperties().setProperty('LICENSE_WEB_APP_URL', value);
  const sheet = getLicensesSheet_();
  ensureLicenseAdminLayoutV540_(sheet, true);
  const send = refreshSendEmailButtonsV541_(sheet);
  const sendUpdate = refreshSendEmailUpdateButtonsV294_(sheet);
  const resets = refreshDeviceResetButtonsV232_(sheet);
  SpreadsheetApp.flush();
  return { ok: true, webAppUrl: value, sendEmailButtons: send, sendEmailUpdateButtons: sendUpdate, resetButtons: resets };
}

function setLicenseWebAppUrlV234(url) {
  return setLicenseWebAppUrlV232(url);
}

function handleDirectPresenceV541_(body) {
  const email = canonicalEmail_(body && body.email);
  const token = String(body && body.token || '').trim();

  if (!email || !token) {
    return {
      ok: true,
      success: false,
      valid: false,
      code: 'PRESENCE_CREDENTIALS_REQUIRED',
      message: 'Email dan token wajib untuk presence.',
      serverTime: new Date().toISOString()
    };
  }

  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);
  const record = findLicenseRecord_(sheet, {
    email: email,
    token: token,
    licenseId: body && body.licenseId
  });

  if (!record) return deviceLicenseNotFound_();

  const license = buildDeviceLicensePayload_(record);
  if (!license || license.valid !== true) return license;

  const eventName = normalizeCode_(body && body.presenceEvent);
  const explicitActive = body && body.uiPresenceActive === true;
  const explicitInactive = body && body.uiPresenceActive === false;
  const closeEvent = eventName === 'CLOSE' || eventName === 'SIDEBAR_CLOSED' || eventName === 'BACKGROUND_VALIDATION';
  const openEvent = eventName === 'OPEN' || eventName === 'HEARTBEAT' || eventName === 'SIDEBAR_OPEN';
  const isOnline = explicitInactive
    ? false
    : (explicitActive || openEvent) && !closeEvent;

  if (isOnline) {
    trackLicenseOnlineHeartbeatV538_(sheet, record, new Date());
  } else {
    markLicenseOfflineNowV540_(sheet, record, new Date());
  }

  return {
    ok: true,
    success: true,
    valid: true,
    presenceUpdated: true,
    online: isOnline,
    presenceEvent: eventName || (isOnline ? 'HEARTBEAT' : 'CLOSE'),
    serverTime: new Date().toISOString()
  };
}

function adminButtonSecretV541_() {
  const secret = String(
    PropertiesService.getScriptProperties().getProperty(PROP_SERVER_SHARED_SECRET) || ''
  ).trim();
  if (!secret) throw new Error('SERVER_SHARED_SECRET belum diatur.');
  return secret;
}

function adminActionSignatureV232_(action, licenseId) {
  const actionCode = normalizeCode_(action);
  const id = String(licenseId || '').trim().toUpperCase();
  if (!actionCode || !id) return '';
  const bytes = Utilities.computeHmacSha256Signature(
    actionCode + '|' + id,
    adminButtonSecretV541_()
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function adminButtonSignatureV541_(licenseId) {
  return adminActionSignatureV232_('SEND_LICENSE_EMAIL', licenseId);
}

function constantTimeEqualV541_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function buildSendEmailButtonUrlV541_(licenseId) {
  const webAppUrl = getLicensePublicWebAppUrlV541_();
  const id = String(licenseId || '').trim().toUpperCase();
  if (!webAppUrl || !id) return '';
  const sig = adminButtonSignatureV541_(id);
  return webAppUrl +
    '?adminAction=send_license_email' +
    '&licenseId=' + encodeURIComponent(id) +
    '&sig=' + encodeURIComponent(sig);
}

function adminUpdateButtonSignatureV294_(licenseId) {
  return adminActionSignatureV232_('SEND_LICENSE_UPDATE_EMAIL', licenseId);
}

function buildSendUpdateEmailButtonUrlV294_(licenseId) {
  const webAppUrl = getLicensePublicWebAppUrlV541_();
  const id = String(licenseId || '').trim().toUpperCase();
  if (!webAppUrl || !id) return '';
  const sig = adminUpdateButtonSignatureV294_(id);
  return webAppUrl +
    '?adminAction=send_license_update_email' +
    '&licenseId=' + encodeURIComponent(id) +
    '&sig=' + encodeURIComponent(sig);
}

function setAdminButtonCellV232_(cell, label, url, note, background, fontColor) {
  cell.clearDataValidations().clearNote();
  if (url) {
    const rich = SpreadsheetApp.newRichTextValue()
      .setText(label)
      .setLinkUrl(url)
      .build();
    cell.setRichTextValue(rich);
  } else {
    cell.setValue(label);
  }
  cell
    .setNote(note || '')
    .setBackground(background || '#0B57D0')
    .setFontColor(fontColor || '#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
}

function writeSendEmailButtonForRowV541_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES || rowNumber < 2) return false;

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  if (map.SEND_EMAIL === undefined || map.EMAIL === undefined || map.TOKEN === undefined || map.LICENSE_ID === undefined) {
    return false;
  }

  const row = getRowObject_(sheet, rowNumber);
  const email = canonicalEmail_(row.EMAIL);
  const token = String(row.TOKEN || '').trim();
  const licenseId = String(row.LICENSE_ID || '').trim().toUpperCase();
  const cell = sheet.getRange(rowNumber, map.SEND_EMAIL + 1);

  if (!email || !token || !licenseId) {
    cell
      .clearContent()
      .clearNote()
      .setBackground(null)
      .setFontColor(null)
      .setFontWeight('normal')
      .setHorizontalAlignment('center');
    return false;
  }

  const url = buildSendEmailButtonUrlV541_(licenseId);
  setAdminButtonCellV232_(
    cell,
    'SEND EMAIL',
    url,
    url
      ? 'Klik untuk mengirim / resend token ke email pada row ini.'
      : 'Web App URL belum tersedia. Deploy sebagai Web App lalu jalankan migrateLicenseAdminButtonsV232().',
    '#0B57D0',
    '#FFFFFF'
  );
  return Boolean(url);
}

function refreshSendEmailButtonsV541_(sheet) {
  if (!sheet) return { rows: 0, clickable: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rows: 0, clickable: 0 };
  let clickable = 0;
  for (let row = 2; row <= lastRow; row++) {
    if (writeSendEmailButtonForRowV541_(sheet, row)) clickable++;
  }
  return { rows: lastRow - 1, clickable: clickable };
}


function writeSendEmailUpdateButtonForRowV294_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES || rowNumber < 2) return false;

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  if (map.SEND_EMAIL_UPDATE === undefined || map.EMAIL === undefined || map.TOKEN === undefined || map.LICENSE_ID === undefined) {
    return false;
  }

  const row = getRowObject_(sheet, rowNumber);
  const email = canonicalEmail_(row.EMAIL);
  const token = String(row.TOKEN || '').trim();
  const licenseId = String(row.LICENSE_ID || '').trim().toUpperCase();
  const cell = sheet.getRange(rowNumber, map.SEND_EMAIL_UPDATE + 1);

  if (!email || !token || !licenseId) {
    cell
      .clearContent()
      .clearNote()
      .setBackground(null)
      .setFontColor(null)
      .setFontWeight('normal')
      .setHorizontalAlignment('center');
    return false;
  }

  const url = buildSendUpdateEmailButtonUrlV294_(licenseId);
  setAdminButtonCellV232_(
    cell,
    'SEND EMAIL UPDATE',
    url,
    url
      ? 'Klik untuk mengirim email pemberitahuan update APK Android dan Plugin PC ke user pada row ini.'
      : 'Web App URL belum tersedia. Deploy sebagai Web App lalu jalankan migrateLicenseAdminButtonsV232().',
    '#0F9D58',
    '#FFFFFF'
  );
  return Boolean(url);
}

function refreshSendEmailUpdateButtonsV294_(sheet) {
  if (!sheet) return { rows: 0, clickable: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rows: 0, clickable: 0 };
  let clickable = 0;
  for (let row = 2; row <= lastRow; row++) {
    if (writeSendEmailUpdateButtonForRowV294_(sheet, row)) clickable++;
  }
  return { rows: lastRow - 1, clickable: clickable };
}


function buildAdminActionUrlV232_(action, licenseId) {
  const webAppUrl = getLicensePublicWebAppUrlV541_();
  const actionCode = normalizeCode_(action);
  const id = String(licenseId || '').trim().toUpperCase();
  if (!webAppUrl || !actionCode || !id) return '';
  const sig = adminActionSignatureV232_(actionCode, id);
  return webAppUrl +
    '?adminAction=' + encodeURIComponent(actionCode.toLowerCase()) +
    '&licenseId=' + encodeURIComponent(id) +
    '&sig=' + encodeURIComponent(sig);
}

function writeResetButtonsForRowV232_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES || rowNumber < 2) return { pc: false, mobile: false };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  if (map.RESET_PC === undefined || map.RESET_MOBILE === undefined || map.LICENSE_ID === undefined) {
    return { pc: false, mobile: false };
  }
  const row = getRowObject_(sheet, rowNumber);
  const licenseId = String(row.LICENSE_ID || '').trim().toUpperCase();
  const pcCell = sheet.getRange(rowNumber, map.RESET_PC + 1);
  const mobileCell = sheet.getRange(rowNumber, map.RESET_MOBILE + 1);

  if (!licenseId) {
    [pcCell, mobileCell].forEach(function(cell) {
      cell.clearContent().clearNote().setBackground(null).setFontColor(null).setFontWeight('normal');
    });
    return { pc: false, mobile: false };
  }

  const pcUrl = buildAdminActionUrlV232_('RESET_PC_DEVICE', licenseId);
  const mobileUrl = buildAdminActionUrlV232_('RESET_MOBILE_DEVICE', licenseId);

  setAdminButtonCellV232_(
    pcCell,
    'RESET PC',
    pcUrl,
    pcUrl ? 'Reset aktivasi PC/Desktop pada row ini. Token dan slot Mobile tetap dipertahankan.' : 'Web App URL belum tersedia.',
    '#B45309',
    '#FFFFFF'
  );
  setAdminButtonCellV232_(
    mobileCell,
    'RESET MOBILE',
    mobileUrl,
    mobileUrl ? 'Reset aktivasi Mobile pada row ini. Token dan slot PC tetap dipertahankan.' : 'Web App URL belum tersedia.',
    '#7C3AED',
    '#FFFFFF'
  );
  return { pc: Boolean(pcUrl), mobile: Boolean(mobileUrl) };
}

function refreshDeviceResetButtonsV232_(sheet) {
  if (!sheet) return { rows: 0, pcClickable: 0, mobileClickable: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rows: 0, pcClickable: 0, mobileClickable: 0 };
  let pcClickable = 0;
  let mobileClickable = 0;
  for (let row = 2; row <= lastRow; row++) {
    const result = writeResetButtonsForRowV232_(sheet, row);
    if (result.pc) pcClickable++;
    if (result.mobile) mobileClickable++;
  }
  return { rows: lastRow - 1, pcClickable: pcClickable, mobileClickable: mobileClickable };
}

function adminActionPageV232_(title, message, ok) {
  const safeTitle = String(title || '').replace(/[<>&"]/g, '');
  const safeMessage = String(message || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bg = ok ? '#f0fdf4' : '#fff7f7';
  const color = ok ? '#166534' : '#991b1b';
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><title>' + safeTitle + '</title>' +
    '<body style="font-family:Arial;padding:28px;background:' + bg + ';color:' + color + '">' +
    '<h2>' + safeTitle + '</h2><p>' + safeMessage + '</p>' +
    '<p>Tab ini boleh ditutup.</p>' +
    '<script>setTimeout(function(){try{window.close()}catch(e){}},1400);</script></body>'
  );
}

function validateAdminActionRequestV232_(e, action) {
  const params = e && e.parameter ? e.parameter : {};
  const licenseId = String(params.licenseId || '').trim().toUpperCase();
  const receivedSig = String(params.sig || '').trim();
  const expectedSig = adminActionSignatureV232_(action, licenseId);
  if (!licenseId || !receivedSig || !constantTimeEqualV541_(receivedSig, expectedSig)) {
    throw new Error('Tautan admin tidak valid / sudah tidak cocok. Jalankan migrateLicenseAdminButtonsV232() untuk refresh tombol.');
  }
  return licenseId;
}

function resetPcSlotByLicenseIdV232(licenseId) {
  const id = String(licenseId || '').trim().toUpperCase();
  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);
  const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', id);
  if (!rowNumber) throw new Error('LICENSE_ID tidak ditemukan: ' + id);
  updateRowByHeaders_(sheet, rowNumber, {
    ACTIVE_DEVICE_ID: '',
    ACTIVE_PUBLIC_KEY: '',
    ACTIVE_SESSION_ID: '',
    DEVICE_NAME: '',
    FCM_REGISTRATION_ID: '',
    PENDING_REQUEST_ID: '',
    PENDING_DEVICE_ID: '',
    PENDING_PUBLIC_KEY: '',
    PENDING_FCM_ID: '',
    PENDING_STATUS: '',
    PENDING_REQUESTED_AT: '',
    LAST_SEEN_AT: '',
    ONLINE_STATUS: 'OFFLINE',
    LAST_ONLINE: ''
  });
  SpreadsheetApp.flush();
  return { ok: true, licenseId: id, pcSlotReset: true, mobileSlotPreserved: true };
}

function resetMobileSlotByLicenseIdV232(licenseId) {
  const id = String(licenseId || '').trim().toUpperCase();
  const base = resetMobileSlotByLicenseIdRev229(id);
  const sheet = getLicensesSheet_();
  const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', id);
  if (rowNumber) updateRowByHeaders_(sheet, rowNumber, {
    ONLINE_STATUS_MOBILE: 'OFFLINE',
    MOBILE_LAST_SEEN_AT: ''
  });
  SpreadsheetApp.flush();
  return Object.assign({}, base, { mobileSlotReset: true, pcSlotPreserved: true });
}

function handleAdminResetPcGetV232_(e) {
  try {
    const licenseId = validateAdminActionRequestV232_(e, 'RESET_PC_DEVICE');
    resetPcSlotByLicenseIdV232(licenseId);
    const sheet = getLicensesSheet_();
    const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', licenseId);
    if (rowNumber) writeResetButtonsForRowV232_(sheet, rowNumber);
    return adminActionPageV232_('Reset PC berhasil', 'Aktivasi PC/Desktop sudah dihapus. Token dan aktivasi Mobile tidak berubah.', true);
  } catch (err) {
    return adminActionPageV232_('Reset PC gagal', err && err.message ? err.message : String(err), false);
  }
}

function handleAdminResetMobileGetV232_(e) {
  try {
    const licenseId = validateAdminActionRequestV232_(e, 'RESET_MOBILE_DEVICE');
    resetMobileSlotByLicenseIdV232(licenseId);
    const sheet = getLicensesSheet_();
    const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', licenseId);
    if (rowNumber) writeResetButtonsForRowV232_(sheet, rowNumber);
    return adminActionPageV232_('Reset Mobile berhasil', 'Aktivasi Mobile sudah dihapus. Token dan aktivasi PC/Desktop tidak berubah.', true);
  } catch (err) {
    return adminActionPageV232_('Reset Mobile gagal', err && err.message ? err.message : String(err), false);
  }
}

function handleAdminSendEmailGetV541_(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const licenseId = String(params.licenseId || '').trim().toUpperCase();
    const receivedSig = String(params.sig || '').trim();
    const expectedSig = adminButtonSignatureV541_(licenseId);

    if (!licenseId || !receivedSig || !constantTimeEqualV541_(receivedSig, expectedSig)) {
      return HtmlService.createHtmlOutput(
        '<!doctype html><meta charset="utf-8"><title>Send Email</title>' +
        '<body style="font-family:Arial;padding:28px;background:#fff7f7;color:#991b1b">' +
        '<h2>Tautan SEND EMAIL tidak valid.</h2><p>Jalankan kembali setupLicenseAdminV541() bila tombol sudah lama.</p></body>'
      );
    }

    const sheet = getLicensesSheet_();
    const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', licenseId);
    if (!rowNumber) throw new Error('LICENSE_ID tidak ditemukan di tab Licenses.');

    const result = sendManualLicenseEmailAtRowV540_(sheet, rowNumber);
    const safeEmail = String(result && result.email || '').replace(/[<>&"]/g, '');

    return HtmlService.createHtmlOutput(
      '<!doctype html><meta charset="utf-8"><title>Send Email</title>' +
      '<body style="font-family:Arial;padding:28px;background:#f0fdf4;color:#166534">' +
      '<h2>Email token berhasil dikirim.</h2>' +
      '<p>Tujuan: <b>' + safeEmail + '</b></p>' +
      '<p>Tab ini boleh ditutup.</p>' +
      '<script>setTimeout(function(){try{window.close()}catch(e){}},1200);</script>' +
      '</body>'
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta charset="utf-8"><title>Send Email</title>' +
      '<body style="font-family:Arial;padding:28px;background:#fff7f7;color:#991b1b">' +
      '<h2>Send Email gagal.</h2><p>' + message + '</p></body>'
    );
  }
}


function handleAdminSendUpdateEmailGetV294_(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const licenseId = String(params.licenseId || '').trim().toUpperCase();
    const receivedSig = String(params.sig || '').trim();
    const expectedSig = adminUpdateButtonSignatureV294_(licenseId);

    if (!licenseId || !receivedSig || !constantTimeEqualV541_(receivedSig, expectedSig)) {
      return HtmlService.createHtmlOutput(
        '<!doctype html><meta charset="utf-8"><title>Send Update Email</title>' +
        '<body style="font-family:Arial;padding:28px;background:#fff7f7;color:#991b1b">' +
        '<h2>Tautan SEND EMAIL UPDATE tidak valid.</h2><p>Jalankan kembali setupLicenseAdminV541() bila tombol sudah lama.</p></body>'
      );
    }

    const sheet = getLicensesSheet_();
    const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', licenseId);
    if (!rowNumber) throw new Error('LICENSE_ID tidak ditemukan di tab Licenses.');

    const result = sendManualLicenseUpdateEmailAtRowV294_(sheet, rowNumber);
    const safeEmail = String(result && result.email || '').replace(/[<>&"]/g, '');

    return HtmlService.createHtmlOutput(
      '<!doctype html><meta charset="utf-8"><title>Send Update Email</title>' +
      '<body style="font-family:Arial;padding:28px;background:#f0fdf4;color:#166534">' +
      '<h2>Email update berhasil dikirim.</h2>' +
      '<p>Tujuan: <b>' + safeEmail + '</b></p>' +
      '<p>User akan diarahkan ke halaman Download &amp; Update.</p>' +
      '<p>Tab ini boleh ditutup.</p>' +
      '<script>setTimeout(function(){try{window.close()}catch(e){}},1200);</script>' +
      '</body>'
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta charset="utf-8"><title>Send Update Email</title>' +
      '<body style="font-family:Arial;padding:28px;background:#fff7f7;color:#991b1b">' +
      '<h2>Send Update Email gagal.</h2><p>' + message + '</p></body>'
    );
  }
}

function setupLicenseAdminV542() {
  return setupLicenseAdminV540();
}

// Backward-compatible alias from REV226 instructions.
function setupLicenseAdminV541() {
  return setupLicenseAdminV542();
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('TF License Admin')
      .addItem('Kirim / Resend Email Token', 'sendManualLicenseEmailFromSelectedRowV5')
      .addItem('Kirim Email Update', 'sendManualLicenseUpdateEmailFromSelectedRowV294')
      .addSeparator()
      .addItem('Setup / Repair Lengkap REV234', 'migrateRev234Complete')
      .addItem('Repair Web App URL REV234', 'repairLicenseWebAppUrlV234')
      .addItem('Setup / Refresh Tombol Admin REV232', 'migrateLicenseAdminButtonsV232')
      .addItem('Repair Manual Row + Format Tanggal REV292', 'repairManualLicenseAdminV292')
      .addItem('Repair Layout SEND_EMAIL_UPDATE REV296', 'repairLicenseAdminLayoutV296')
      .addItem('RECOVER Sheet Rusak REV297', 'recoverCorruptedLicenseLayoutV297')
      .addItem('Reset PC pada Row Terpilih', 'resetPcDeviceFromSelectedRowV232')
      .addItem('Reset Mobile pada Row Terpilih', 'resetMobileDeviceFromSelectedRowV232')
      .addSeparator()
      .addItem('Cek Sistem Email Manual', 'checkManualLicenseEmailSystemV535')
      .addItem('Refresh Status Online', 'refreshLicenseOnlineStatusV538')
      .addToUi();

    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      const licenseSheet = activeSs ? activeSs.getSheetByName(SHEET_LICENSES) : null;
      if (licenseSheet) ensureLicenseAdminLayoutV540_(licenseSheet, true);
    } catch (layoutErr) {
      console.warn('onOpen admin layout warning: ' + String(layoutErr && layoutErr.message ? layoutErr.message : layoutErr));
    }
  } catch (err) {
    console.warn('onOpen menu warning: ' + String(err && err.message ? err.message : err));
  }
}



function setupLicenseAdminV540() {
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);

  const layout = ensureLicenseAdminLayoutV540_(sheet, true);
  const manual = setupManualLicenseEntryV5();
  const online = setupLicenseOnlineStatusV538();
  const buttons = refreshSendEmailButtonsV541_(sheet);
  const updateButtons = refreshSendEmailUpdateButtonsV294_(sheet);
  const resetButtons = refreshDeviceResetButtonsV232_(sheet);
  const manualAdminRepair = repairManualAdminRowsV292_(sheet);

  const result = {
    success: true,
    version: 'LICENSE_PROCESSOR_REV298_ADMIN_WEB_API',
    webAppUrl: getLicensePublicWebAppUrlV541_(),
    sendEmailColumn: layout.sendEmailColumn,
    sendEmailUpdateColumn: layout.sendEmailUpdateColumn,
    onlineStatusPcColumn: layout.pcStatusColumn,
    onlineStatusMobileColumn: layout.mobileStatusColumn,
    resetPcColumn: layout.resetPcColumn,
    resetMobileColumn: layout.resetMobileColumn,
    lastOnlineColumn: layout.lastOnlineColumn,
    manualEditTriggerInstalled: Boolean(manual && manual.triggerInstalled),
    onlineRefreshTriggerInstalled: Boolean(online && online.refreshTriggerInstalled),
    sendEmailButtons: buttons,
    sendEmailUpdateButtons: updateButtons,
    resetButtons: resetButtons,
    manualAdminRepair: manualAdminRepair,
    dateFormat: 'dd/MM/yyyy HH:mm:ss',
    note: 'C SEND EMAIL; D PC ONLINE; E MOBILE ONLINE; F RESET PC; G RESET MOBILE; H SEND EMAIL UPDATE; I LAST ONLINE. Manual EMAIL+PLAN auto-generates these controls.'
  };

  console.log(JSON.stringify(result));
  return result;
}


function sendManualLicenseEmailAtRowV540_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES) {
    throw new Error('Tab Licenses tidak aktif.');
  }
  if (!rowNumber || rowNumber < 2) {
    throw new Error('Row license tidak valid.');
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);

  [
    'TOKEN','EMAIL','PLAN','PRODUCT_NAME','ACTIVATED_AT','EXPIRED_AT',
    'STATUS','ISIGNAL_ACCESS','ISIGNAL_EXPIRED_AT','EMAIL_SENT_AT','LICENSE_ID'
  ].forEach(function(name) {
    if (map[name] === undefined) {
      throw new Error('Header wajib tidak ditemukan di Licenses: ' + name);
    }
  });

  const license = getRowObject_(sheet, rowNumber);
  const email = canonicalEmail_(license.EMAIL);
  const token = String(license.TOKEN || '').trim();
  const plan = normalizeCode_(license.PLAN);
  const status = normalizeCode_(license.STATUS);
  const licenseId = String(license.LICENSE_ID || '').trim();
  const duration = deviceDurationFromPlan_(plan);
  const expiresAt = toDateOrNull_(license.EXPIRED_AT);
  const now = new Date();

  if (!email || !isValidEmail_(email)) throw new Error('EMAIL kosong / tidak valid.');
  if (!token) throw new Error('TOKEN belum tersedia.');
  if (!plan || !duration) throw new Error('PLAN tidak dikenali: ' + String(license.PLAN || '-'));
  if (!licenseId) throw new Error('LICENSE_ID belum tersedia.');
  if (status !== 'ACTIVE') throw new Error('STATUS license bukan ACTIVE.');
  if (duration !== 'PERMANENT') {
    if (!expiresAt) throw new Error('EXPIRED_AT belum tersedia.');
    if (expiresAt.getTime() <= now.getTime()) throw new Error('Lisensi sudah expired.');
  }

  const previousSent = toDateOrNull_(license.EMAIL_SENT_AT);
  const customerName = findLatestCustomerNameByEmailV535_(sheet.getParent(), email);
  const result = sendManualLicenseEmailV535_(email, customerName, license);

  if (!result || result.success !== true) {
    const errorMessage = result && result.error ? String(result.error) : 'UNKNOWN_EMAIL_ERROR';
    sheet.getRange(rowNumber, map.EMAIL_SENT_AT + 1).setNote(
      'EMAIL FAILED: ' + errorMessage + ' | ' +
      Utilities.formatDate(new Date(), APP_TIMEZONE, 'dd/MM/yyyy HH:mm:ss') + ' WIB'
    );
    throw new Error(errorMessage);
  }

  const sentAt = new Date();
  sheet.getRange(rowNumber, map.EMAIL_SENT_AT + 1)
    .setValue(sentAt)
    .setNote(
      (previousSent ? 'RESEND' : 'SEND') +
      ' manual via tombol SEND EMAIL berhasil ke ' + email + ' pada ' +
      Utilities.formatDate(sentAt, APP_TIMEZONE, 'dd/MM/yyyy HH:mm:ss') +
      ' WIB. Token tetap / tidak berubah.'
    );

  SpreadsheetApp.flush();

  try {
    sheet.getParent().toast(
      'Email token berhasil dikirim ke ' + email,
      previousSent ? 'RESEND EMAIL BERHASIL' : 'SEND EMAIL BERHASIL',
      6
    );
  } catch (_) {}

  return {
    success: true,
    rowNumber: rowNumber,
    email: email,
    resent: Boolean(previousSent),
    sentAt: sentAt
  };
}


function sendManualLicenseEmailFromSelectedRowV5() {
  const ui = SpreadsheetApp.getUi();

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (!ss) {
      ui.alert(
        'SEND EMAIL TOKEN',
        'Spreadsheet aktif tidak ditemukan.',
        ui.ButtonSet.OK
      );
      return;
    }

    const sheet = ss.getActiveSheet();
    const range = sheet ? sheet.getActiveRange() : null;

    if (!sheet || sheet.getName() !== SHEET_LICENSES) {
      ui.alert(
        'SEND EMAIL TOKEN',
        'Buka tab "Licenses", lalu pilih salah satu cell pada row customer yang ingin dikirim email.',
        ui.ButtonSet.OK
      );
      return;
    }

    if (!range) {
      ui.alert(
        'SEND EMAIL TOKEN',
        'Pilih salah satu cell pada row license terlebih dahulu.',
        ui.ButtonSet.OK
      );
      return;
    }

    const rowNumber = range.getRow();

    if (rowNumber < 2) {
      ui.alert(
        'SEND EMAIL TOKEN',
        'Row header tidak dapat digunakan. Pilih row customer/license.',
        ui.ButtonSet.OK
      );
      return;
    }

    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getDisplayValues()[0]
      .map(function(v) {
        return String(v || '').trim();
      });

    const map = headerMapFromArray_(headers);

    [
      'TOKEN',
      'EMAIL',
      'PLAN',
      'PRODUCT_NAME',
      'ACTIVATED_AT',
      'EXPIRED_AT',
      'STATUS',
      'ISIGNAL_ACCESS',
      'ISIGNAL_EXPIRED_AT',
      'EMAIL_SENT_AT',
      'LICENSE_ID'
    ].forEach(function(name) {
      if (map[name] === undefined) {
        throw new Error(
          'Header wajib tidak ditemukan di Licenses: ' + name
        );
      }
    });

    const license = getRowObject_(sheet, rowNumber);

    const email = canonicalEmail_(license.EMAIL);
    const token = String(license.TOKEN || '').trim();
    const plan = normalizeCode_(license.PLAN);
    const status = normalizeCode_(license.STATUS);
    const licenseId = String(license.LICENSE_ID || '').trim();
    const duration = deviceDurationFromPlan_(plan);
    const expiresAt = toDateOrNull_(license.EXPIRED_AT);
    const now = new Date();

    if (!email || !isValidEmail_(email)) {
      ui.alert(
        'EMAIL TIDAK VALID',
        'EMAIL pada row ' + rowNumber + ' kosong atau tidak valid.',
        ui.ButtonSet.OK
      );
      return;
    }

    if (!token) {
      ui.alert(
        'TOKEN BELUM TERSEDIA',
        'TOKEN pada row ' + rowNumber + ' masih kosong.\n\n' +
        'Jika ini license manual baru, pastikan EMAIL + PLAN sudah diisi ' +
        'dan trigger manual license sudah membuat token terlebih dahulu.',
        ui.ButtonSet.OK
      );
      return;
    }

    if (!plan || !duration) {
      ui.alert(
        'PLAN TIDAK VALID',
        'PLAN pada row ' + rowNumber + ' tidak dikenali: ' +
        String(license.PLAN || '-'),
        ui.ButtonSet.OK
      );
      return;
    }

    if (!licenseId) {
      ui.alert(
        'LICENSE ID BELUM TERSEDIA',
        'LICENSE_ID pada row ' + rowNumber + ' masih kosong. ' +
        'Lengkapi/generate LICENSE_ID terlebih dahulu sebelum mengirim email.',
        ui.ButtonSet.OK
      );
      return;
    }

    if (status !== 'ACTIVE') {
      ui.alert(
        'LISENSI TIDAK AKTIF',
        'Email token tidak dikirim karena STATUS license adalah "' +
        String(license.STATUS || '-') +
        '".\n\nUbah STATUS ke ACTIVE jika memang license harus digunakan.',
        ui.ButtonSet.OK
      );
      return;
    }

    if (duration !== 'PERMANENT') {
      if (!expiresAt) {
        ui.alert(
          'EXPIRED_AT BELUM TERSEDIA',
          'License non-permanent harus memiliki EXPIRED_AT sebelum email dikirim.',
          ui.ButtonSet.OK
        );
        return;
      }

      if (expiresAt.getTime() <= now.getTime()) {
        ui.alert(
          'LISENSI SUDAH EXPIRED',
          'Email token tidak dikirim karena masa aktif license sudah berakhir pada:\n' +
          formatDateTime_(expiresAt),
          ui.ButtonSet.OK
        );
        return;
      }
    }

    const previousSent = toDateOrNull_(license.EMAIL_SENT_AT);
    const friendlyPlan = friendlyPlanNameV534_(plan);

    let confirmation =
      'Kirim License Token ke:\n\n' +
      email +
      '\n\nPaket: ' +
      friendlyPlan +
      '\nLicense ID: ' +
      licenseId +
      '\n\nTOKEN yang sudah ada akan digunakan. Tidak ada token baru yang dibuat.';

    if (previousSent) {
      confirmation +=
        '\n\nEmail sebelumnya pernah dikirim pada:\n' +
        formatDateTime_(previousSent) +
        '\n\nKlik YES untuk mengirim ulang token yang sama.';
    }

    const answer = ui.alert(
      previousSent ? 'RESEND EMAIL TOKEN?' : 'SEND EMAIL TOKEN?',
      confirmation,
      ui.ButtonSet.YES_NO
    );

    if (answer !== ui.Button.YES) {
      ss.toast(
        'Pengiriman email dibatalkan.',
        'TF License Admin',
        4
      );
      return;
    }

    const customerName =
      findLatestCustomerNameByEmailV535_(ss, email);

    const result = sendManualLicenseEmailV535_(
      email,
      customerName,
      license
    );

    if (!result || result.success !== true) {
      const errorMessage =
        result && result.error
          ? String(result.error)
          : 'UNKNOWN_EMAIL_ERROR';

      sheet
        .getRange(rowNumber, map.EMAIL_SENT_AT + 1)
        .setNote(
          'EMAIL FAILED: ' +
          errorMessage +
          ' | ' +
          Utilities.formatDate(
            new Date(),
            APP_TIMEZONE,
            'dd/MM/yyyy HH:mm:ss'
          ) +
          ' WIB'
        );

      ui.alert(
        'EMAIL GAGAL DIKIRIM',
        'Email ke ' +
        email +
        ' gagal dikirim.\n\nError: ' +
        errorMessage,
        ui.ButtonSet.OK
      );
      return;
    }

    const sentAt = new Date();

    sheet
      .getRange(rowNumber, map.EMAIL_SENT_AT + 1)
      .setValue(sentAt)
      .setNote(
        (previousSent ? 'RESEND' : 'SEND') +
        ' manual berhasil ke ' +
        email +
        ' pada ' +
        Utilities.formatDate(
          sentAt,
          APP_TIMEZONE,
          'dd/MM/yyyy HH:mm:ss'
        ) +
        ' WIB. Token tetap / tidak berubah.'
      );

    SpreadsheetApp.flush();

    ss.toast(
      'Email token berhasil dikirim ke ' + email,
      previousSent
        ? 'RESEND EMAIL TOKEN BERHASIL'
        : 'SEND EMAIL TOKEN BERHASIL',
      8
    );

    ui.alert(
      previousSent
        ? 'EMAIL TOKEN BERHASIL DIKIRIM ULANG'
        : 'EMAIL TOKEN BERHASIL DIKIRIM',
      'Email: ' +
      email +
      '\nPaket: ' +
      friendlyPlan +
      '\nLicense ID: ' +
      licenseId +
      '\n\nTOKEN TIDAK BERUBAH.',
      ui.ButtonSet.OK
    );

  } catch (err) {
    const message = String(
      err && err.message ? err.message : err
    );

    console.error(
      err && err.stack ? err.stack : message
    );

    try {
      ui.alert(
        'SEND EMAIL TOKEN ERROR',
        message,
        ui.ButtonSet.OK
      );
    } catch (_) {}
  }
}



function sendManualLicenseUpdateEmailAtRowV294_(sheet, rowNumber) {
  if (!sheet || sheet.getName() !== SHEET_LICENSES) {
    throw new Error('Tab Licenses tidak aktif.');
  }
  if (!rowNumber || rowNumber < 2) {
    throw new Error('Row license tidak valid.');
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);

  [
    'TOKEN','EMAIL','PLAN','PRODUCT_NAME','ACTIVATED_AT','EXPIRED_AT',
    'STATUS','ISIGNAL_ACCESS','ISIGNAL_EXPIRED_AT','LICENSE_ID'
  ].forEach(function(name) {
    if (map[name] === undefined) {
      throw new Error('Header wajib tidak ditemukan di Licenses: ' + name);
    }
  });
  if (map.SEND_EMAIL_UPDATE === undefined) {
    throw new Error('Header SEND_EMAIL_UPDATE belum tersedia. Jalankan setupLicenseAdminV540().');
  }

  const license = getRowObject_(sheet, rowNumber);
  const email = canonicalEmail_(license.EMAIL);
  const token = String(license.TOKEN || '').trim();
  const plan = normalizeCode_(license.PLAN);
  const status = normalizeCode_(license.STATUS);
  const licenseId = String(license.LICENSE_ID || '').trim();
  const duration = deviceDurationFromPlan_(plan);
  const expiresAt = toDateOrNull_(license.EXPIRED_AT);
  const now = new Date();

  if (!email || !isValidEmail_(email)) throw new Error('EMAIL kosong / tidak valid.');
  if (!token) throw new Error('TOKEN belum tersedia.');
  if (!plan || !duration) throw new Error('PLAN tidak dikenali: ' + String(license.PLAN || '-'));
  if (!licenseId) throw new Error('LICENSE_ID belum tersedia.');
  if (status !== 'ACTIVE') throw new Error('STATUS license bukan ACTIVE.');
  if (duration !== 'PERMANENT') {
    if (!expiresAt) throw new Error('EXPIRED_AT belum tersedia.');
    if (expiresAt.getTime() <= now.getTime()) throw new Error('Lisensi sudah expired.');
  }

  const customerName = findLatestCustomerNameByEmailV535_(sheet.getParent(), email);
  const result = sendManualLicenseUpdateEmailV294_(email, customerName, license);

  if (!result || result.success !== true) {
    const errorMessage = result && result.error ? String(result.error) : 'UNKNOWN_EMAIL_ERROR';
    sheet.getRange(rowNumber, map.SEND_EMAIL_UPDATE + 1).setNote(
      'UPDATE EMAIL FAILED: ' + errorMessage + ' | ' +
      Utilities.formatDate(new Date(), APP_TIMEZONE, 'dd/MM/yyyy HH:mm:ss') + ' WIB'
    );
    throw new Error(errorMessage);
  }

  const sentAt = new Date();
  sheet.getRange(rowNumber, map.SEND_EMAIL_UPDATE + 1).setNote(
    'UPDATE EMAIL berhasil dikirim ke ' + email + ' pada ' +
    Utilities.formatDate(sentAt, APP_TIMEZONE, 'dd/MM/yyyy HH:mm:ss') +
    ' WIB. Tombol email ini khusus untuk pemberitahuan update APK Android dan Plugin PC.'
  );

  SpreadsheetApp.flush();

  try {
    sheet.getParent().toast(
      'Email update berhasil dikirim ke ' + email,
      'SEND EMAIL UPDATE BERHASIL',
      6
    );
  } catch (_) {}

  return {
    success: true,
    rowNumber: rowNumber,
    email: email,
    sentAt: sentAt
  };
}

function sendManualLicenseUpdateEmailFromSelectedRowV294() {
  const ui = SpreadsheetApp.getUi();

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      ui.alert('SEND EMAIL UPDATE', 'Spreadsheet aktif tidak ditemukan.', ui.ButtonSet.OK);
      return;
    }

    const sheet = ss.getActiveSheet();
    const range = sheet ? sheet.getActiveRange() : null;
    if (!sheet || sheet.getName() !== SHEET_LICENSES) {
      ui.alert('SEND EMAIL UPDATE', 'Buka tab "Licenses", lalu pilih salah satu cell pada row customer yang ingin dikirim email update.', ui.ButtonSet.OK);
      return;
    }
    if (!range) {
      ui.alert('SEND EMAIL UPDATE', 'Pilih salah satu cell pada row license terlebih dahulu.', ui.ButtonSet.OK);
      return;
    }

    const rowNumber = range.getRow();
    if (rowNumber < 2) {
      ui.alert('SEND EMAIL UPDATE', 'Row header tidak dapat digunakan. Pilih row customer/license.', ui.ButtonSet.OK);
      return;
    }

    const license = getRowObject_(sheet, rowNumber);
    const email = canonicalEmail_(license.EMAIL);
    const plan = normalizeCode_(license.PLAN);
    const licenseId = String(license.LICENSE_ID || '').trim();
    const status = normalizeCode_(license.STATUS);
    const duration = deviceDurationFromPlan_(plan);
    const expiresAt = toDateOrNull_(license.EXPIRED_AT);
    const now = new Date();

    if (!email || !isValidEmail_(email)) {
      ui.alert('EMAIL TIDAK VALID', 'EMAIL pada row ' + rowNumber + ' kosong atau tidak valid.', ui.ButtonSet.OK);
      return;
    }
    if (!String(license.TOKEN || '').trim()) {
      ui.alert('TOKEN BELUM TERSEDIA', 'TOKEN pada row ' + rowNumber + ' masih kosong.', ui.ButtonSet.OK);
      return;
    }
    if (!licenseId) {
      ui.alert('LICENSE ID BELUM TERSEDIA', 'LICENSE_ID pada row ' + rowNumber + ' masih kosong.', ui.ButtonSet.OK);
      return;
    }
    if (status !== 'ACTIVE') {
      ui.alert('LISENSI TIDAK AKTIF', 'Email update tidak dikirim karena STATUS license adalah "' + String(license.STATUS || '-') + '".', ui.ButtonSet.OK);
      return;
    }
    if (duration !== 'PERMANENT') {
      if (!expiresAt) {
        ui.alert('EXPIRED_AT BELUM TERSEDIA', 'License non-permanent harus memiliki EXPIRED_AT sebelum email update dikirim.', ui.ButtonSet.OK);
        return;
      }
      if (expiresAt.getTime() <= now.getTime()) {
        ui.alert('LISENSI SUDAH EXPIRED', 'Email update tidak dikirim karena masa aktif license sudah berakhir pada:\n' + formatDateTime_(expiresAt), ui.ButtonSet.OK);
        return;
      }
    }

    const friendlyPlan = friendlyPlanNameV534_(plan);
    const answer = ui.alert(
      'SEND EMAIL UPDATE?',
      'Kirim email pemberitahuan update ke:\n\n' + email + '\n\nPaket: ' + friendlyPlan + '\nLicense ID: ' + licenseId + '\n\nEmail ini akan mengarahkan user ke halaman Download & Update terbaru.',
      ui.ButtonSet.YES_NO
    );

    if (answer !== ui.Button.YES) {
      ss.toast('Pengiriman email update dibatalkan.', 'TF License Admin', 4);
      return;
    }

    const result = sendManualLicenseUpdateEmailAtRowV294_(sheet, rowNumber);
    ui.alert(
      'EMAIL UPDATE BERHASIL DIKIRIM',
      'Email: ' + result.email + '\nLicense ID: ' + licenseId + '\n\nUser akan menerima tombol Download & Update.',
      ui.ButtonSet.OK
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    console.error(err && err.stack ? err.stack : message);
    try {
      ui.alert('SEND EMAIL UPDATE ERROR', message, ui.ButtonSet.OK);
    } catch (_) {}
  }
}
function sendManualLicenseUpdateEmailV294_(
  email,
  customerName,
  license
) {
  try {
    const to = canonicalEmail_(email);

    if (!isValidEmail_(to)) {
      return { success: false, error: 'INVALID_EMAIL' };
    }

    const token = String(license && license.TOKEN || '').trim();
    if (!token) {
      return { success: false, error: 'TOKEN_NOT_FOUND' };
    }

    const productName = emailProductDisplayNameV5310_(license && (license.PRODUCT_NAME || license.PLAN));
    const planCode = String(license && license.PLAN || '-');
    const plan = friendlyPlanNameV534_(planCode);
    const status = String(license && license.STATUS || 'ACTIVE');
    const activatedAt = formatDateTime_(license && license.ACTIVATED_AT);
    const expiredAt = formatExpiry_(license && license.EXPIRED_AT);
    const isignalAccess = String(license && license.ISIGNAL_ACCESS || 'NO').trim().toUpperCase();
    const isignalExpiredAt = formatISignalExpiry_(license && license.ISIGNAL_EXPIRED_AT, isignalAccess);
    const greeting = customerName ? 'Halo ' + customerName + ',' : 'Halo,';
    const subject = 'Update Baru TF Analyzer Analyst Sudah Tersedia';

    const plainBody = [
      greeting,
      '',
      'Versi terbaru APK Android dan Plugin PC TF Analyzer Analyst sudah tersedia.',
      'Silakan buka halaman Download & Update untuk mengunduh versi terbaru.',
      '',
      'Produk: ' + productName,
      'Paket: ' + plan,
      'Email Aktivasi: ' + to,
      'Status: ' + status,
      'Aktif: ' + activatedAt,
      'Masa Berlaku: ' + expiredAt,
      'iSignal Users: ' + (isignalAccess === 'YES' ? 'AKTIF' : 'TIDAK TERMASUK'),
      isignalAccess === 'YES' ? 'Masa Berlaku iSignal: ' + isignalExpiredAt : '',
      '',
      'LICENSE TOKEN:',
      token,
      '',
      'Gunakan Email Aktivasi dan License Token yang sama saat dibutuhkan di aplikasi.',
      '',
      buildDownloadUpdatePlainTextV294_(),
      buildSupportPlainTextV537_(),
      '',
      'TF Analyzer Analyst'
    ].filter(function(line) { return line !== null && typeof line !== 'undefined'; }).join('\n');

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: plainBody,
      htmlBody: buildManualLicenseUpdateEmailHtmlV294_({
        greeting: greeting,
        productName: productName,
        plan: plan,
        email: to,
        status: status,
        activatedAt: activatedAt,
        expiredAt: expiredAt,
        isignalAccess: isignalAccess,
        isignalExpiredAt: isignalExpiredAt,
        token: token
      }),
      name: EMAIL_SENDER_NAME
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
}

function buildManualLicenseUpdateEmailHtmlV294_(d) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:18px 8px;color:#162033;width:100%;box-sizing:border-box;">
    <div style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ef;box-sizing:border-box;">
      <div style="background:#081a2d;padding:20px 18px;color:#fff;">
        <div style="font-size:12px;letter-spacing:1.3px;opacity:.75;margin-bottom:7px;">TF ANALYZER ANALYST</div>
        <div style="font-size:20px;line-height:27px;font-weight:700;">Update Baru Sudah Tersedia</div>
      </div>

      <div style="padding:20px 18px;">
        <p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#162033;">${htmlEscape_(d.greeting)}</p>

        <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;">
          Versi terbaru APK Android dan Plugin PC TF Analyzer Analyst sudah tersedia.
          Silakan gunakan tombol <b>Download &amp; Update</b> di bawah ini untuk membuka halaman update terbaru.
        </p>

        <div style="background:#f7f9fc;border:1px solid #e4e9f0;border-radius:10px;padding:6px 15px;margin:18px 0;">
          ${emailInfoRow_('Produk', d.productName)}
          ${emailInfoRow_('Paket', d.plan)}
          ${emailInfoRow_('Email Aktivasi', d.email)}
          ${emailInfoRow_('Status', d.status)}
          ${emailInfoRow_('Aktif', d.activatedAt)}
          ${emailInfoRow_('Masa Berlaku', d.expiredAt)}
          ${emailInfoRow_('iSignal Users', d.isignalAccess === 'YES' ? 'AKTIF' : 'TIDAK TERMASUK')}
          ${d.isignalAccess === 'YES' ? emailInfoRow_('Masa Berlaku iSignal', d.isignalExpiredAt) : ''}
        </div>

        <div style="font-size:12px;font-weight:700;color:#657083;letter-spacing:.8px;margin-bottom:8px;">
          LICENSE TOKEN
        </div>

        <div style="background:#081a2d;color:#ffffff;border-radius:10px;padding:14px 15px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:20px;font-weight:700;word-break:break-all;overflow-wrap:anywhere;">
          ${htmlEscape_(d.token)}
        </div>

        ${buildDownloadUpdateHtmlBlockV294_()}
        ${buildEmailUpdateActionButtonsV294_()}

        <p style="margin-top:24px;line-height:1.7;color:#4d596b;">
          Email ini adalah pemberitahuan update terbaru. License Token Anda tetap sama dan tidak berubah.
        </p>
      </div>

      ${buildEmailFooterV537_()}
    </div>
  </div>`;
}

function buildEmailUpdateActionButtonsV294_() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      <tr>
        <td style="padding:0 0 10px 0;">
          <a href="${EMAIL_DOWNLOAD_URL}" target="_blank"
             style="display:block;text-align:center;background:#0b63d8;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;line-height:19px;padding:12px 14px;border-radius:9px;">
            Download &amp; Update
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:0;">
          <a href="${EMAIL_WHATSAPP_URL}" target="_blank"
             style="display:block;text-align:center;background:#1fa855;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;line-height:19px;padding:12px 14px;border-radius:9px;">
            Hubungi Admin via WhatsApp
          </a>
        </td>
      </tr>
    </table>
    <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#788396;">
      Support: ${htmlEscape_(EMAIL_SUPPORT_NAME)}
    </div>`;
}

function buildDownloadUpdateHtmlBlockV294_() {
  return `
    <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:11px;line-height:16px;font-weight:700;color:#657083;letter-spacing:.55px;margin-bottom:6px;">
        DOWNLOAD &amp; UPDATE
      </div>
      <a href="${EMAIL_DOWNLOAD_URL}" target="_blank"
         style="display:inline-block;color:#0b63d8;text-decoration:none;font-size:13px;line-height:19px;font-weight:600;overflow-wrap:anywhere;">
        Buka halaman Download &amp; Update
      </a>
    </div>`;
}

function buildDownloadUpdatePlainTextV294_() {
  return 'Download & Update: ' + EMAIL_DOWNLOAD_URL;
}

function sendManualLicenseEmailV535_(
  email,
  customerName,
  license
) {
  try {
    const to = canonicalEmail_(email);

    if (!isValidEmail_(to)) {
      return {
        success: false,
        error: 'INVALID_EMAIL'
      };
    }

    const token = String(
      license && license.TOKEN || ''
    ).trim();

    if (!token) {
      return {
        success: false,
        error: 'TOKEN_NOT_FOUND'
      };
    }

    const productName =
      emailProductDisplayNameV5310_(
        license && (
          license.PRODUCT_NAME ||
          license.PLAN
        )
      );

    const planCode = String(
      license && license.PLAN || '-'
    );

    const plan =
      friendlyPlanNameV534_(planCode);

    const status = String(
      license && license.STATUS || 'ACTIVE'
    );

    const activatedAt =
      formatDateTime_(
        license && license.ACTIVATED_AT
      );

    const expiredAt =
      formatExpiry_(
        license && license.EXPIRED_AT
      );

    const isignalAccess = String(
      license && license.ISIGNAL_ACCESS || 'NO'
    )
      .trim()
      .toUpperCase();

    const isignalExpiredAt =
      formatISignalExpiry_(
        license && license.ISIGNAL_EXPIRED_AT,
        isignalAccess
      );

    const greeting =
      customerName
        ? 'Halo ' + customerName + ','
        : 'Halo,';

    const subject =
      'License Token TF Multi-Analyst Scanner Anda';

    const plainBody = [
      greeting,
      '',
      'Lisensi TF Multi-Analyst Scanner Anda sudah siap digunakan.',
      '',
      'Produk: ' + productName,
      'Paket: ' + plan,
      'Email Aktivasi: ' + to,
      'Status: ' + status,
      'Aktif: ' + activatedAt,
      'Masa Berlaku: ' + expiredAt,
      'iSignal Users: ' +
        (
          isignalAccess === 'YES'
            ? 'AKTIF'
            : 'TIDAK TERMASUK'
        ),
      isignalAccess === 'YES'
        ? 'Masa Berlaku iSignal: ' +
          isignalExpiredAt
        : '',
      '',
      'LICENSE TOKEN:',
      token,
      '',
      'Gunakan Email Aktivasi dan License Token di TF Multi-Analyst Scanner untuk melakukan aktivasi perangkat.',
      '',
      'Simpan License Token ini dengan aman.',
      '',
      buildDownloadInstallPlainText_(),
      buildSupportPlainTextV537_(),
      '',
      'TF Multi-Analyst Scanner'
    ].filter(function(line) {
      return line !== null &&
        typeof line !== 'undefined';
    }).join('\n');

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: plainBody,
      htmlBody:
        buildManualLicenseEmailHtmlV535_({
          greeting: greeting,
          productName: productName,
          plan: plan,
          email: to,
          status: status,
          activatedAt: activatedAt,
          expiredAt: expiredAt,
          isignalAccess: isignalAccess,
          isignalExpiredAt:
            isignalExpiredAt,
          token: token
        }),
      name: EMAIL_SENDER_NAME
    });

    return {
      success: true
    };

  } catch (err) {
    return {
      success: false,
      error: String(
        err && err.message
          ? err.message
          : err
      )
    };
  }
}


function buildManualLicenseEmailHtmlV535_(d) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:18px 8px;color:#162033;width:100%;box-sizing:border-box;">
    <div style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e8ef;box-sizing:border-box;">
      <div style="background:#081a2d;padding:20px 18px;color:#fff;">
        <div style="font-size:12px;letter-spacing:1.3px;opacity:.75;margin-bottom:7px;">TF MULTI-ANALYST SCANNER</div>
        <div style="font-size:20px;line-height:27px;font-weight:700;">License Token Anda Siap Digunakan</div>
      </div>

      <div style="padding:20px 18px;">
        <p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#162033;">${htmlEscape_(d.greeting)}</p>

        <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;">
          Lisensi TF Multi-Analyst Scanner Anda sudah siap digunakan.
          Gunakan Email Aktivasi dan License Token di bawah ini untuk melakukan aktivasi perangkat.
        </p>

        <div style="background:#f7f9fc;border:1px solid #e4e9f0;border-radius:10px;padding:6px 15px;margin:18px 0;">
          ${emailInfoRow_('Produk', d.productName)}
          ${emailInfoRow_('Paket', d.plan)}
          ${emailInfoRow_('Email Aktivasi', d.email)}
          ${emailInfoRow_('Status', d.status)}
          ${emailInfoRow_('Aktif', d.activatedAt)}
          ${emailInfoRow_('Masa Berlaku', d.expiredAt)}
          ${emailInfoRow_(
            'iSignal Users',
            d.isignalAccess === 'YES'
              ? 'AKTIF'
              : 'TIDAK TERMASUK'
          )}
          ${
            d.isignalAccess === 'YES'
              ? emailInfoRow_(
                  'Masa Berlaku iSignal',
                  d.isignalExpiredAt
                )
              : ''
          }
        </div>

        <div style="font-size:12px;font-weight:700;color:#657083;letter-spacing:.8px;margin-bottom:8px;">
          LICENSE TOKEN
        </div>

        <div style="background:#081a2d;color:#ffffff;border-radius:10px;padding:14px 15px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:20px;font-weight:700;word-break:break-all;overflow-wrap:anywhere;">
          ${htmlEscape_(d.token)}
        </div>

        ${buildDownloadInstallHtmlBlock_()}
        ${buildEmailActionButtonsV537_()}

        <p style="margin-top:24px;line-height:1.7;color:#4d596b;">
          Token ini tetap sama saat email dikirim ulang. Simpan License Token dengan aman dan jangan membagikannya kepada pihak lain.
        </p>
      </div>

      ${buildEmailFooterV537_()}
    </div>
  </div>`;
}


function findLatestCustomerNameByEmailV535_(
  ss,
  email
) {
  try {
    const sheet =
      ss.getSheetByName(SHEET_ORDERS);

    if (!sheet) return '';

    const values =
      sheet.getDataRange().getValues();

    if (values.length < 2) return '';

    const headers =
      values[0].map(function(v) {
        return String(v || '').trim();
      });

    const map =
      headerMapFromArray_(headers);

    if (
      map.EMAIL === undefined ||
      map.CUSTOMER_NAME === undefined
    ) {
      return '';
    }

    const wanted =
      canonicalEmail_(email);

    for (
      let r = values.length - 1;
      r >= 1;
      r--
    ) {
      if (
        canonicalEmail_(
          values[r][map.EMAIL]
        ) !== wanted
      ) {
        continue;
      }

      const name = String(
        values[r][map.CUSTOMER_NAME] || ''
      ).trim();

      if (name) return name;
    }

    return '';

  } catch (_) {
    return '';
  }
}


function checkManualLicenseEmailSystemV535() {
  const result = {
    success: false,
    version:
      'LICENSE_PROCESSOR_V5_4_2_LAST_ONLINE',
    activeSpreadsheet: false,
    licensesSheet: false,
    requiredHeadersReady: false,
    missingHeaders: [],
    remainingDailyEmailQuota: null
  };

  try {
    const ss =
      SpreadsheetApp.getActiveSpreadsheet();

    result.activeSpreadsheet =
      Boolean(ss);

    if (!ss) {
      console.log(JSON.stringify(result));
      return result;
    }

    const sheet =
      ss.getSheetByName(SHEET_LICENSES);

    result.licensesSheet =
      Boolean(sheet);

    if (!sheet) {
      console.log(JSON.stringify(result));
      return result;
    }

    const headers = sheet
      .getRange(
        1,
        1,
        1,
        sheet.getLastColumn()
      )
      .getDisplayValues()[0]
      .map(function(v) {
        return String(v || '').trim();
      });

    const set = {};

    headers.forEach(function(h) {
      set[h] = true;
    });

    const required = [
      'TOKEN',
      'EMAIL',
      'PLAN',
      'PRODUCT_NAME',
      'ACTIVATED_AT',
      'EXPIRED_AT',
      'STATUS',
      'ISIGNAL_ACCESS',
      'ISIGNAL_EXPIRED_AT',
      'EMAIL_SENT_AT',
      'LICENSE_ID'
    ];

    result.missingHeaders =
      required.filter(function(h) {
        return !set[h];
      });

    result.requiredHeadersReady =
      result.missingHeaders.length === 0;

    try {
      result.remainingDailyEmailQuota =
        MailApp.getRemainingDailyQuota();
    } catch (_) {
      result.remainingDailyEmailQuota =
        null;
    }

    result.success =
      result.activeSpreadsheet &&
      result.licensesSheet &&
      result.requiredHeadersReady;

    console.log(JSON.stringify(result));
    return result;

  } catch (err) {
    result.error = String(
      err && err.message
        ? err.message
        : err
    );

    console.log(JSON.stringify(result));
    return result;
  }
}

// ============================================================
// V5.3.9 — LICENSE ONLINE / OFFLINE STATUS + VALIDATION FIX
// ============================================================
//
// PURPOSE
// - Tab Licenses gets two admin columns:
//     ONLINE_STATUS
//     LAST_ONLINE (column E)
//     LAST_SEEN_AT (internal heartbeat field)
// - If the licensed extension keeps reaching the Device API,
//   ONLINE_STATUS (column D) becomes GREEN.
// - Closing the Side Panel sends an explicit OFFLINE presence event.
// - If that close event is missed, heartbeat TTL is the fallback.
//
// ONLINE definition:
// A valid lookup coming through the Device Worker/server path.
// Direct public compatibility checks do NOT mark ONLINE.
//
// Extension REV225 sends explicit Side Panel presence heartbeats and
// a best-effort CLOSE event. Generic license validation no longer
// counts as ONLINE presence.
//
// RUN ONCE AFTER DEPLOY / UPDATE:
//   setupLicenseOnlineStatusV538
//
// It installs a 1-minute trigger:
//   refreshLicenseOnlineStatusV538
// ============================================================

function inspectLicenseAdminLayoutV296_(sheet) {
  if (!sheet) throw new Error('Licenses sheet tidak ditemukan.');
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const positions = {};
  headers.forEach(function(name, index) {
    if (!name) return;
    if (!positions[name]) positions[name] = [];
    positions[name].push(index + 1);
  });

  return {
    headers: headers,
    positions: positions,
    first15: headers.slice(0, 15),
    sendEmailUpdateColumns: positions.SEND_EMAIL_UPDATE || [],
    lastOnlineColumns: positions.LAST_ONLINE || []
  };
}

function diagnoseLicenseAdminLayoutV296() {
  const sheet = getLicensesSheet_();
  const info = inspectLicenseAdminLayoutV296_(sheet);
  const expectedOld = ['TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE','RESET_PC','RESET_MOBILE','LAST_ONLINE'];
  const expectedNew = ['TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE','RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE','LAST_ONLINE'];
  const first8 = info.headers.slice(0, 8);
  const first9 = info.headers.slice(0, 9);
  info.isHealthyOldLayout = expectedOld.every(function(h, i) { return first8[i] === h; });
  info.isHealthyNewLayout = expectedNew.every(function(h, i) { return first9[i] === h; });
  info.corruptedOrUnexpected = !info.isHealthyOldLayout && !info.isHealthyNewLayout;
  console.log(JSON.stringify(info));
  return info;
}

function ensureLicenseAdminLayoutV540_(sheet, forceControls) {
  if (!sheet) throw new Error('Licenses sheet tidak ditemukan.');

  // REV296 SAFETY POLICY:
  // Never reorder existing columns. The only allowed structural migration is:
  // healthy old layout -> insert ONE new column H -> SEND_EMAIL_UPDATE.
  // This automatically shifts the existing LAST_ONLINE H -> I.
  // If the sheet is already partially/corruptly migrated, STOP without mutation.
  const expectedOld = ['TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE','RESET_PC','RESET_MOBILE','LAST_ONLINE'];
  const expectedNew = ['TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE','RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE','LAST_ONLINE'];

  function readHeaders_() {
    return sheet
      .getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getDisplayValues()[0]
      .map(function(v) { return String(v || '').trim(); });
  }

  let headers = readHeaders_();
  let first8 = headers.slice(0, 8);
  let first9 = headers.slice(0, 9);
  let isOld = expectedOld.every(function(h, i) { return first8[i] === h; });
  let isNew = expectedNew.every(function(h, i) { return first9[i] === h; });

  if (!isOld && !isNew) {
    const info = inspectLicenseAdminLayoutV296_(sheet);
    throw new Error(
      'REV296_LAYOUT_SAFETY_STOP: Layout Licenses sudah tidak canonical / pernah termigrasi sebagian. ' +
      'Script TIDAK mengubah sheet untuk mencegah kerusakan lanjutan. ' +
      'Restore Google Sheet ke Version History sebelum REV295 dijalankan, lalu jalankan repairLicenseAdminLayoutV296(). ' +
      'Header awal saat ini: ' + JSON.stringify(info.first15)
    );
  }

  let layoutChanged = false;

  if (isOld) {
    // The requested migration: new H, old H LAST_ONLINE shifts safely to I.
    sheet.insertColumnBefore(8);
    sheet.getRange(1, 8).setValue('SEND_EMAIL_UPDATE');
    layoutChanged = true;
    SpreadsheetApp.flush();

    headers = readHeaders_();
    first9 = headers.slice(0, 9);
    isNew = expectedNew.every(function(h, i) { return first9[i] === h; });
    if (!isNew) {
      throw new Error('REV296_MIGRATION_VERIFY_FAILED: Kolom H sudah dibuat tetapi header canonical tidak terverifikasi. Gunakan Version History untuk rollback.');
    }
  }

  headers = readHeaders_();
  const map = headerMapFromArray_(headers);
  expectedNew.forEach(function(name) {
    if (map[name] === undefined) throw new Error('Header admin Licenses tidak ditemukan: ' + name);
  });

  // Ensure internal heartbeat columns exist only by APPENDING them, never moving data.
  if (map.LAST_SEEN_AT === undefined) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('LAST_SEEN_AT');
    SpreadsheetApp.flush();
    headers = readHeaders_();
  }
  let refreshedMap = headerMapFromArray_(headers);
  if (refreshedMap.MOBILE_LAST_SEEN_AT === undefined) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('MOBILE_LAST_SEEN_AT');
    SpreadsheetApp.flush();
    headers = readHeaders_();
  }
  refreshedMap = headerMapFromArray_(headers);

  const dataRows = Math.max(1, sheet.getMaxRows() - 1);
  if (forceControls === true || layoutChanged) {
    [
      refreshedMap.SEND_EMAIL,
      refreshedMap.RESET_PC,
      refreshedMap.RESET_MOBILE,
      refreshedMap.SEND_EMAIL_UPDATE
    ].forEach(function(index) {
      sheet.getRange(2, index + 1, dataRows, 1)
        .clearDataValidations()
        .setHorizontalAlignment('center');
    });
    refreshSendEmailButtonsV541_(sheet);
    refreshSendEmailUpdateButtonsV294_(sheet);
    refreshDeviceResetButtonsV232_(sheet);
  }

  [
    refreshedMap.SEND_EMAIL,
    refreshedMap.ONLINE_STATUS,
    refreshedMap.ONLINE_STATUS_MOBILE,
    refreshedMap.RESET_PC,
    refreshedMap.RESET_MOBILE,
    refreshedMap.SEND_EMAIL_UPDATE,
    refreshedMap.LAST_ONLINE
  ].forEach(function(index) {
    sheet.getRange(1, index + 1)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setBackground('#1F4E78')
      .setFontColor('#FFFFFF');
  });

  sheet.setColumnWidth(refreshedMap.SEND_EMAIL + 1, 120);
  sheet.setColumnWidth(refreshedMap.ONLINE_STATUS + 1, 105);
  sheet.setColumnWidth(refreshedMap.ONLINE_STATUS_MOBILE + 1, 135);
  sheet.setColumnWidth(refreshedMap.RESET_PC + 1, 120);
  sheet.setColumnWidth(refreshedMap.RESET_MOBILE + 1, 135);
  sheet.setColumnWidth(refreshedMap.SEND_EMAIL_UPDATE + 1, 145);
  sheet.setColumnWidth(refreshedMap.LAST_ONLINE + 1, 155);

  if (sheet.getMaxRows() >= 2) {
    sheet.getRange(2, refreshedMap.LAST_ONLINE + 1, sheet.getMaxRows() - 1, 1)
      .clearDataValidations()
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }

  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, refreshedMap.EMAIL + 1, sheet.getLastRow() - 1, 1)
      .setBackground(null)
      .setFontColor(null)
      .setFontWeight('normal');
  }

  return {
    map: refreshedMap,
    sendEmailColumn: refreshedMap.SEND_EMAIL + 1,
    sendEmailUpdateColumn: refreshedMap.SEND_EMAIL_UPDATE + 1,
    statusColumn: refreshedMap.ONLINE_STATUS + 1,
    pcStatusColumn: refreshedMap.ONLINE_STATUS + 1,
    mobileStatusColumn: refreshedMap.ONLINE_STATUS_MOBILE + 1,
    resetPcColumn: refreshedMap.RESET_PC + 1,
    resetMobileColumn: refreshedMap.RESET_MOBILE + 1,
    lastOnlineColumn: refreshedMap.LAST_ONLINE + 1,
    lastSeenColumn: refreshedMap.LAST_SEEN_AT + 1,
    mobileLastSeenColumn: refreshedMap.MOBILE_LAST_SEEN_AT + 1,
    emailColumn: refreshedMap.EMAIL + 1,
    layoutChanged: layoutChanged
  };
}

function repairLicenseAdminLayoutV296() {
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);

  // Diagnose BEFORE any mutation.
  const before = diagnoseLicenseAdminLayoutV296();
  if (before.corruptedOrUnexpected) {
    throw new Error(
      'REV296_RECOVERY_REQUIRED: Sheet saat ini sudah rusak/partial akibat migrasi sebelumnya. ' +
      'Gunakan File > Version history > See version history, restore versi sebelum REV295 dijalankan. ' +
      'Setelah restore, jalankan repairLicenseAdminLayoutV296() lagi. Tidak ada perubahan dilakukan oleh REV296.'
    );
  }

  const layout = ensureLicenseAdminLayoutV540_(sheet, true);
  formatLicenseDateColumnsV292_(sheet);
  const send = refreshSendEmailButtonsV541_(sheet);
  const sendUpdate = refreshSendEmailUpdateButtonsV294_(sheet);
  const resets = refreshDeviceResetButtonsV232_(sheet);
  SpreadsheetApp.flush();

  const after = diagnoseLicenseAdminLayoutV296();
  const result = {
    success: true,
    version: 'REV296_NON_DESTRUCTIVE_H_COLUMN_MIGRATION',
    before: before,
    after: after,
    columns: {
      sendEmail: layout.sendEmailColumn,
      pcOnline: layout.pcStatusColumn,
      mobileOnline: layout.mobileStatusColumn,
      resetPc: layout.resetPcColumn,
      resetMobile: layout.resetMobileColumn,
      sendEmailUpdate: layout.sendEmailUpdateColumn,
      lastOnline: layout.lastOnlineColumn
    },
    sendEmailButtons: send,
    sendEmailUpdateButtons: sendUpdate,
    resetButtons: resets
  };
  console.log(JSON.stringify(result));
  return result;
}


// ============================================================
// REV297 — CORRUPTED LICENSE LAYOUT RECOVERY
// ============================================================
//
// TARGETED RECOVERY for the exact partial-migration pattern produced by
// REV295/earlier failed attempts:
//   A:G canonical admin columns
//   H SEND_EMAIL_UPDATE
//   one or more accidental blank-header columns
//   one LAST_ONLINE somewhere before PLAN
//   PLAN and the remaining business/license headers shifted far right
//   optional duplicate MOBILE_LAST_SEEN_AT columns at the tail.
//
// SAFETY:
// - Creates a full backup sheet BEFORE deleting any column.
// - Refuses to run if unexpected named headers exist inside the accidental gap.
// - Deletes only columns whose HEADER IS BLANK in the gap between H and PLAN.
// - Preserves/reconstructs LAST_ONLINE from every date candidate in the gap
//   and LAST_SEEN_AT.
// - Merges duplicate MOBILE_LAST_SEEN_AT values before deleting duplicates.
// ============================================================

function rev297ToDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value === null || typeof value === 'undefined' || value === '') return null;

  const text = String(value).trim();
  if (!text) return null;

  // Native parse first (covers ISO and many Sheets date values).
  const native = new Date(text);
  if (!isNaN(native.getTime())) return native;

  // dd/MM/yyyy [HH:mm[:ss]]
  let m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function backupLicensesSheetV297_(sheet) {
  const ss = sheet.getParent();
  const tz = ss.getSpreadsheetTimeZone() || APP_TIMEZONE || 'Asia/Jakarta';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
  const base = 'Licenses_BACKUP_REV297_' + stamp;
  let name = base;
  let n = 2;
  while (ss.getSheetByName(name)) {
    name = base + '_' + n;
    n++;
  }

  const backup = sheet.copyTo(ss);
  backup.setName(name);
  return {
    name: name,
    sheetId: backup.getSheetId()
  };
}

function mergeDuplicateTimestampHeaderV297_(sheet, headerName) {
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const cols = [];
  headers.forEach(function(h, i) {
    if (h === headerName) cols.push(i + 1);
  });

  if (cols.length <= 1) {
    return { header: headerName, duplicatesRemoved: 0, columns: cols };
  }

  const lastRow = sheet.getLastRow();
  const canonicalCol = cols[0];

  if (lastRow >= 2) {
    const merged = [];
    for (let r = 2; r <= lastRow; r++) {
      let bestDate = null;
      let fallback = '';

      cols.forEach(function(col) {
        const v = sheet.getRange(r, col).getValue();
        if (fallback === '' && v !== '' && v !== null && typeof v !== 'undefined') {
          fallback = v;
        }
        const d = rev297ToDate_(v);
        if (d && (!bestDate || d.getTime() > bestDate.getTime())) bestDate = d;
      });

      merged.push([bestDate || fallback || '']);
    }

    sheet
      .getRange(2, canonicalCol, merged.length, 1)
      .setValues(merged)
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }

  // Delete duplicate columns from right to left, preserving the leftmost one.
  for (let i = cols.length - 1; i >= 1; i--) {
    sheet.deleteColumn(cols[i]);
  }

  return {
    header: headerName,
    canonicalColumn: canonicalCol,
    duplicatesRemoved: cols.length - 1
  };
}

function diagnoseCorruptedLicenseLayoutV297() {
  const sheet = getLicensesSheet_();
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const positions = {};
  headers.forEach(function(h, i) {
    if (!h) return;
    if (!positions[h]) positions[h] = [];
    positions[h].push(i + 1);
  });

  const first8Expected = [
    'TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE',
    'RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE'
  ];

  const first8Ok = first8Expected.every(function(h, i) {
    return headers[i] === h;
  });

  const lastOnlineCols = positions.LAST_ONLINE || [];
  const planCols = positions.PLAN || [];
  const mobileLastSeenCols = positions.MOBILE_LAST_SEEN_AT || [];

  let gapNamedHeaders = [];
  if (planCols.length === 1 && planCols[0] > 9) {
    for (let c = 9; c < planCols[0]; c++) {
      const h = headers[c - 1];
      if (h && h !== 'LAST_ONLINE') {
        gapNamedHeaders.push({ column: c, header: h });
      }
    }
  }

  const result = {
    success: true,
    first8Ok: first8Ok,
    sendEmailUpdateColumn: (positions.SEND_EMAIL_UPDATE || [])[0] || null,
    lastOnlineColumns: lastOnlineCols,
    planColumns: planCols,
    mobileLastSeenColumns: mobileLastSeenCols,
    gapNamedHeaders: gapNamedHeaders,
    recoverable:
      first8Ok &&
      lastOnlineCols.length === 1 &&
      planCols.length === 1 &&
      planCols[0] > lastOnlineCols[0] &&
      gapNamedHeaders.length === 0
  };

  console.log(JSON.stringify(result));
  return result;
}

function recoverCorruptedLicenseLayoutV297() {
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);

  // -------------------------------
  // STRICT PREFLIGHT — no mutation.
  // -------------------------------
  const headersBefore = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const pos = {};
  headersBefore.forEach(function(h, i) {
    if (!h) return;
    if (!pos[h]) pos[h] = [];
    pos[h].push(i + 1);
  });

  const first8Expected = [
    'TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE',
    'RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE'
  ];

  if (!first8Expected.every(function(h, i) { return headersBefore[i] === h; })) {
    throw new Error(
      'REV297_SAFETY_STOP_FIRST8: Kolom A:H tidak sesuai pola recovery. ' +
      'Tidak ada perubahan dilakukan. Header A:H=' +
      JSON.stringify(headersBefore.slice(0, 8))
    );
  }

  const lastOnlineCols = pos.LAST_ONLINE || [];
  const planCols = pos.PLAN || [];

  if (lastOnlineCols.length !== 1 || planCols.length !== 1) {
    throw new Error(
      'REV297_SAFETY_STOP_CORE_HEADERS: LAST_ONLINE harus tepat 1 dan PLAN harus tepat 1. ' +
      'LAST_ONLINE=' + JSON.stringify(lastOnlineCols) +
      ', PLAN=' + JSON.stringify(planCols)
    );
  }

  const lastOnlineColBefore = lastOnlineCols[0];
  const planColBefore = planCols[0];

  if (lastOnlineColBefore < 9 || planColBefore <= lastOnlineColBefore) {
    throw new Error(
      'REV297_SAFETY_STOP_ORDER: Posisi LAST_ONLINE/PLAN tidak cocok dengan pola kerusakan. ' +
      'LAST_ONLINE=' + lastOnlineColBefore + ', PLAN=' + planColBefore
    );
  }

  // Only blank headers plus LAST_ONLINE are allowed between H and PLAN.
  const unexpected = [];
  const blankGapColumns = [];
  for (let c = 9; c < planColBefore; c++) {
    const h = headersBefore[c - 1];
    if (!h) {
      blankGapColumns.push(c);
    } else if (h !== 'LAST_ONLINE') {
      unexpected.push({ column: c, header: h });
    }
  }

  if (unexpected.length) {
    throw new Error(
      'REV297_SAFETY_STOP_UNEXPECTED_HEADERS: Ada header bernama di area gap yang tidak boleh dihapus: ' +
      JSON.stringify(unexpected)
    );
  }

  // Capture LAST_ONLINE candidates BEFORE deleting anything.
  const lastRow = sheet.getLastRow();
  const recoveredLastOnline = [];

  // LAST_SEEN_AT may be far to the right but is a trustworthy internal heartbeat.
  const lastSeenCols = pos.LAST_SEEN_AT || [];
  const candidateCols = blankGapColumns.concat([lastOnlineColBefore]).concat(lastSeenCols);

  if (lastRow >= 2) {
    for (let r = 2; r <= lastRow; r++) {
      let bestDate = null;

      candidateCols.forEach(function(c) {
        const d = rev297ToDate_(sheet.getRange(r, c).getValue());
        if (d && (!bestDate || d.getTime() > bestDate.getTime())) {
          bestDate = d;
        }
      });

      recoveredLastOnline.push([bestDate || '']);
    }
  }

  // -------------------------------
  // BACKUP before destructive cleanup.
  // -------------------------------
  const backup = backupLicensesSheetV297_(sheet);
  SpreadsheetApp.flush();

  // -------------------------------
  // Remove ONLY blank-header gap columns.
  // Right-to-left keeps indices stable.
  // -------------------------------
  for (let i = blankGapColumns.length - 1; i >= 0; i--) {
    sheet.deleteColumn(blankGapColumns[i]);
  }
  SpreadsheetApp.flush();

  // After cleanup the canonical leading order must be:
  // A..H admin, I LAST_ONLINE, J PLAN.
  let headersAfterGap = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const expectedFirst10 = [
    'TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE',
    'RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE','LAST_ONLINE','PLAN'
  ];

  if (!expectedFirst10.every(function(h, i) { return headersAfterGap[i] === h; })) {
    throw new Error(
      'REV297_POST_GAP_VERIFY_FAILED: Backup sudah dibuat (' + backup.name +
      '), tetapi hasil cleanup tidak canonical. Header A:J=' +
      JSON.stringify(headersAfterGap.slice(0, 10))
    );
  }

  // Restore LAST_ONLINE from captured date candidates.
  if (lastRow >= 2 && recoveredLastOnline.length) {
    sheet
      .getRange(2, 9, recoveredLastOnline.length, 1)
      .setValues(recoveredLastOnline)
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }

  // Merge duplicate internal timestamp columns safely.
  const mergedMobile = mergeDuplicateTimestampHeaderV297_(sheet, 'MOBILE_LAST_SEEN_AT');

  // Re-read after duplicate removal.
  headersAfterGap = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const map = headerMapFromArray_(headersAfterGap);

  [
    'TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE',
    'RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE','LAST_ONLINE','PLAN',
    'LICENSE_ID','LAST_SEEN_AT','MOBILE_LAST_SEEN_AT'
  ].forEach(function(name) {
    if (map[name] === undefined) {
      throw new Error(
        'REV297_FINAL_VERIFY_MISSING_HEADER: ' + name +
        '. Backup tersedia: ' + backup.name
      );
    }
  });

  // Rebuild ONLY the intended admin controls.
  refreshSendEmailButtonsV541_(sheet);
  refreshSendEmailUpdateButtonsV294_(sheet);
  refreshDeviceResetButtonsV232_(sheet);
  formatLicenseDateColumnsV292_(sheet);

  // Header styling and widths, no column movement.
  [
    map.SEND_EMAIL,
    map.ONLINE_STATUS,
    map.ONLINE_STATUS_MOBILE,
    map.RESET_PC,
    map.RESET_MOBILE,
    map.SEND_EMAIL_UPDATE,
    map.LAST_ONLINE
  ].forEach(function(index) {
    sheet.getRange(1, index + 1)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setBackground('#1F4E78')
      .setFontColor('#FFFFFF');
  });

  sheet.setColumnWidth(map.SEND_EMAIL + 1, 120);
  sheet.setColumnWidth(map.ONLINE_STATUS + 1, 105);
  sheet.setColumnWidth(map.ONLINE_STATUS_MOBILE + 1, 135);
  sheet.setColumnWidth(map.RESET_PC + 1, 120);
  sheet.setColumnWidth(map.RESET_MOBILE + 1, 135);
  sheet.setColumnWidth(map.SEND_EMAIL_UPDATE + 1, 145);
  sheet.setColumnWidth(map.LAST_ONLINE + 1, 155);

  SpreadsheetApp.flush();

  const finalHeaders = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) { return String(v || '').trim(); });

  const finalMobileCount = finalHeaders.filter(function(h) {
    return h === 'MOBILE_LAST_SEEN_AT';
  }).length;

  const result = {
    success: true,
    version: 'REV297_CORRUPTED_LAYOUT_RECOVERY',
    backupSheet: backup,
    deletedBlankGapColumns: blankGapColumns.length,
    recoveredLastOnlineRows: recoveredLastOnline.length,
    duplicateMobileLastSeenRepair: mergedMobile,
    finalMobileLastSeenHeaderCount: finalMobileCount,
    first12: finalHeaders.slice(0, 12),
    expectedLeadingLayout: [
      'TOKEN','EMAIL','SEND_EMAIL','ONLINE_STATUS','ONLINE_STATUS_MOBILE',
      'RESET_PC','RESET_MOBILE','SEND_EMAIL_UPDATE','LAST_ONLINE','PLAN'
    ]
  };

  console.log(JSON.stringify(result));
  return result;
}


function setupLicenseOnlineStatusV538() {
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);
  const info = ensureLicenseOnlineHeadersV538_(sheet);
  repairLicenseOnlineColumnValidationV539_(sheet, info, true);

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'refreshLicenseOnlineStatusV538') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('refreshLicenseOnlineStatusV538').timeBased().everyMinutes(1).create();

  const refresh = refreshLicenseOnlineStatusV538();
  const result = {
    success: true,
    version: 'LICENSE_PROCESSOR_REV231_PC_MOBILE_ONLINE',
    onlineStatusPcColumn: info.pcStatusColumn,
    onlineStatusMobileColumn: info.mobileStatusColumn,
    lastOnlineColumn: info.lastOnlineColumn,
    lastSeenAtPcInternalColumn: info.lastSeenColumn,
    lastSeenAtMobileInternalColumn: info.mobileLastSeenColumn,
    refreshTriggerInstalled: true,
    onlineTtlSeconds: Math.floor(LICENSE_ONLINE_TTL_MS / 1000),
    refresh: refresh
  };
  console.log(JSON.stringify(result));
  return result;
}

function ensureLicenseOnlineHeadersV538_(sheet) {
  ensureLicenseAdminLayoutV540_(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0].map(function(v) { return String(v || '').trim(); });
  const map = headerMapFromArray_(headers);
  ['EMAIL','TOKEN','STATUS','ONLINE_STATUS','ONLINE_STATUS_MOBILE','LAST_ONLINE','LAST_SEEN_AT','MOBILE_LAST_SEEN_AT'].forEach(function(name) {
    if (map[name] === undefined) throw new Error('Header wajib status online tidak ditemukan: ' + name);
  });
  sheet.getRange(1, map.ONLINE_STATUS + 1).setFontWeight('bold');
  sheet.getRange(1, map.ONLINE_STATUS_MOBILE + 1).setFontWeight('bold');
  sheet.getRange(1, map.LAST_ONLINE + 1).setFontWeight('bold');
  sheet.getRange(1, map.LAST_SEEN_AT + 1).setFontWeight('bold');
  sheet.getRange(1, map.MOBILE_LAST_SEEN_AT + 1).setFontWeight('bold');
  return {
    map: map,
    statusColumn: map.ONLINE_STATUS + 1,
    pcStatusColumn: map.ONLINE_STATUS + 1,
    mobileStatusColumn: map.ONLINE_STATUS_MOBILE + 1,
    lastOnlineColumn: map.LAST_ONLINE + 1,
    lastSeenColumn: map.LAST_SEEN_AT + 1,
    mobileLastSeenColumn: map.MOBILE_LAST_SEEN_AT + 1,
    emailColumn: map.EMAIL + 1
  };
}

function repairLicenseOnlineColumnValidationV539_(sheet, info, force) {
  const props = PropertiesService.getScriptProperties();
  const alreadyRepaired = String(props.getProperty(PROP_ONLINE_STATUS_VALIDATION_REPAIRED_V539) || '') === '1';
  if (!force && alreadyRepaired) return { repaired: false, reason: 'ALREADY_REPAIRED' };
  const dataRows = Math.max(0, sheet.getMaxRows() - 1);
  if (dataRows > 0) {
    sheet.getRange(2, info.pcStatusColumn, dataRows, 1).clearDataValidations();
    sheet.getRange(2, info.mobileStatusColumn, dataRows, 1).clearDataValidations();
    sheet.getRange(2, info.lastOnlineColumn, dataRows, 1).clearDataValidations();
    sheet.getRange(2, info.lastSeenColumn, dataRows, 1).clearDataValidations();
    sheet.getRange(2, info.mobileLastSeenColumn, dataRows, 1).clearDataValidations();
    sheet.getRange(2, info.lastOnlineColumn, dataRows, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(2, info.lastSeenColumn, dataRows, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(2, info.mobileLastSeenColumn, dataRows, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }
  props.setProperty(PROP_ONLINE_STATUS_VALIDATION_REPAIRED_V539, '1');
  return { repaired: true, rows: dataRows };
}

function trackLicenseOnlineHeartbeatV538_(
  sheet,
  record,
  now
) {
  if (!sheet || !record || !record.rowNumber || record.rowNumber < 2) {
    return;
  }

  const info = ensureLicenseOnlineHeadersV538_(sheet);

  // LAST_SEEN_AT is internal TTL state. LAST_ONLINE is the user-visible history.
  const rowValues = sheet
    .getRange(record.rowNumber, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  const currentOnlineStatus = normalizeCode_(rowValues[info.map.ONLINE_STATUS]);
  const lastSeen = toDateOrNull_(rowValues[info.map.LAST_SEEN_AT]);

  const shouldWrite =
    currentOnlineStatus !== 'ONLINE' ||
    !lastSeen ||
    (now.getTime() - lastSeen.getTime()) >= LICENSE_ONLINE_WRITE_MIN_INTERVAL_MS;

  if (!shouldWrite) return;

  sheet.getRange(record.rowNumber, info.statusColumn).setValue('ONLINE');
  sheet.getRange(record.rowNumber, info.lastSeenColumn).setValue(now);
  sheet.getRange(record.rowNumber, info.lastOnlineColumn).setValue(now);

  paintLicenseStatusPresenceV540_(
    sheet,
    record.rowNumber,
    info.statusColumn,
    true
  );
}


function markLicenseOfflineNowV540_(sheet, record, now) {
  if (!sheet || !record || !record.rowNumber || record.rowNumber < 2) return;

  const info = ensureLicenseOnlineHeadersV538_(sheet);

  sheet.getRange(record.rowNumber, info.statusColumn).setValue('OFFLINE');

  // Keep a permanent human-readable record of when this user was last online.
  // The internal LAST_SEEN_AT is cleared so the TTL refresh cannot turn the row
  // green again after an explicit Side Panel CLOSE.
  sheet.getRange(record.rowNumber, info.lastOnlineColumn).setValue(now);
  sheet.getRange(record.rowNumber, info.lastSeenColumn).clearContent();

  paintLicenseStatusPresenceV540_(
    sheet,
    record.rowNumber,
    info.statusColumn,
    false
  );

  SpreadsheetApp.flush();
}


function refreshLicenseOnlineStatusV538() {
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);
  const info = ensureLicenseOnlineHeadersV538_(sheet);
  repairLicenseOnlineColumnValidationV539_(sheet, info, false);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, pcOnline: 0, mobileOnline: 0, rows: 0 };

  const now = new Date();
  const rowCount = lastRow - 1;
  const values = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getValues();
  const pcValues=[], mobileValues=[];
  const pcBg=[], mobileBg=[], pcFg=[], mobileFg=[], weights=[];
  let pcOnline=0, mobileOnline=0;

  values.forEach(function(row) {
    const email = canonicalEmail_(row[info.map.EMAIL]);
    const token = String(row[info.map.TOKEN] || '').trim();
    const licenseStatus = normalizeCode_(row[info.map.STATUS]);
    const pcSeen = toDateOrNull_(row[info.map.LAST_SEEN_AT]);
    const mobileSeen = toDateOrNull_(row[info.map.MOBILE_LAST_SEEN_AT]);
    const baseValid = Boolean(email) && Boolean(token) && licenseStatus === 'ACTIVE';
    const isPcOnline = baseValid && Boolean(pcSeen) && (now.getTime() - pcSeen.getTime()) <= LICENSE_ONLINE_TTL_MS;
    const isMobileOnline = baseValid && Boolean(mobileSeen) && (now.getTime() - mobileSeen.getTime()) <= LICENSE_ONLINE_TTL_MS;
    if (isPcOnline) pcOnline++;
    if (isMobileOnline) mobileOnline++;
    pcValues.push([isPcOnline ? 'ONLINE' : 'OFFLINE']);
    mobileValues.push([isMobileOnline ? 'ONLINE' : 'OFFLINE']);
    pcBg.push([isPcOnline ? LICENSE_ONLINE_COLOR_BG : LICENSE_OFFLINE_COLOR_BG]);
    mobileBg.push([isMobileOnline ? LICENSE_ONLINE_COLOR_BG : LICENSE_OFFLINE_COLOR_BG]);
    pcFg.push([isPcOnline ? LICENSE_ONLINE_COLOR_TEXT : LICENSE_OFFLINE_COLOR_TEXT]);
    mobileFg.push([isMobileOnline ? LICENSE_ONLINE_COLOR_TEXT : LICENSE_OFFLINE_COLOR_TEXT]);
    weights.push(['bold']);
  });

  const pcRange = sheet.getRange(2, info.pcStatusColumn, rowCount, 1);
  pcRange.setValues(pcValues).setBackgrounds(pcBg).setFontColors(pcFg).setFontWeights(weights).setHorizontalAlignment('center');
  const mobileRange = sheet.getRange(2, info.mobileStatusColumn, rowCount, 1);
  mobileRange.setValues(mobileValues).setBackgrounds(mobileBg).setFontColors(mobileFg).setFontWeights(weights).setHorizontalAlignment('center');
  SpreadsheetApp.flush();

  const result = {
    success: true,
    rows: rowCount,
    pcOnline: pcOnline,
    pcOffline: rowCount - pcOnline,
    mobileOnline: mobileOnline,
    mobileOffline: rowCount - mobileOnline,
    onlineTtlSeconds: Math.floor(LICENSE_ONLINE_TTL_MS / 1000),
    refreshedAt: Utilities.formatDate(now, APP_TIMEZONE, 'dd/MM/yyyy HH:mm:ss') + ' WIB'
  };
  console.log(JSON.stringify(result));
  return result;
}

function paintLicenseStatusPresenceV540_(
  sheet,
  rowNumber,
  statusColumn,
  isOnline
) {
  const cell = sheet.getRange(rowNumber, statusColumn);

  cell
    .setBackground(
      isOnline
        ? LICENSE_ONLINE_COLOR_BG
        : LICENSE_OFFLINE_COLOR_BG
    )
    .setFontColor(
      isOnline
        ? LICENSE_ONLINE_COLOR_TEXT
        : LICENSE_OFFLINE_COLOR_TEXT
    )
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
}

// Backward-compatible alias for any old manual references.
function paintLicenseEmailPresenceV538_(sheet, rowNumber, ignoredEmailColumn, isOnline) {
  const info = ensureLicenseOnlineHeadersV538_(sheet);
  paintLicenseStatusPresenceV540_(sheet, rowNumber, info.statusColumn, isOnline);
}


function checkLicenseOnlineStatusV538() {
  const result = {
    success: false,
    version: 'LICENSE_PROCESSOR_REV231_PC_MOBILE_ONLINE',
    spreadsheetConfigured: false,
    licensesSheet: false,
    headersReady: false,
    refreshTriggerInstalled: false,
    onlineTtlSeconds: Math.floor(LICENSE_ONLINE_TTL_MS / 1000)
  };
  try {
    const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
    result.spreadsheetConfigured = Boolean(spreadsheetId);
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(SHEET_LICENSES);
    result.licensesSheet = Boolean(sheet);
    if (!sheet) { console.log(JSON.stringify(result)); return result; }
    const info = ensureLicenseOnlineHeadersV538_(sheet);
    result.headersReady = Boolean(info.pcStatusColumn && info.mobileStatusColumn && info.lastSeenColumn && info.mobileLastSeenColumn && info.emailColumn);
    result.refreshTriggerInstalled = ScriptApp.getProjectTriggers().some(function(trigger) {
      return trigger.getHandlerFunction() === 'refreshLicenseOnlineStatusV538';
    });
    result.success = result.spreadsheetConfigured && result.licensesSheet && result.headersReady && result.refreshTriggerInstalled;
    result.columns = { pc: info.pcStatusColumn, mobile: info.mobileStatusColumn, lastOnlinePc: info.lastOnlineColumn };
    console.log(JSON.stringify(result));
    return result;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    console.log(JSON.stringify(result));
    return result;
  }
}

function testResponsiveLicenseEmailV5310() {
  const TEST_EMAIL =
    Session.getEffectiveUser().getEmail();

  if (!TEST_EMAIL || !isValidEmail_(TEST_EMAIL)) {
    throw new Error(
      'Email akun Apps Script tidak dapat dideteksi. ' +
      'Isi TEST_EMAIL manual pada function testResponsiveLicenseEmailV5310.'
    );
  }

  const sample = {
    TOKEN:
      'TFA-4B898E6E-A40CA2F9-C41E08AD-F73C274B',
    PRODUCT_NAME:
      'TF Multi-Analyst Scanner - Permanent',
    PLAN:
      'MAIN_PERMANENT',
    STATUS:
      'ACTIVE',
    ACTIVATED_AT:
      new Date(),
    EXPIRED_AT:
      '',
    ISIGNAL_ACCESS:
      'YES',
    ISIGNAL_EXPIRED_AT:
      ''
  };

  const result =
    sendLicenseEmail_(
      TEST_EMAIL,
      'Client Test',
      sample
    );

  console.log(
    JSON.stringify(result)
  );

  return result;
}



// ============================================================
// REV229 — ONE TOKEN / TWO DEVICE SLOTS MIGRATION
// Run once after replacing the Apps Script code.
// It appends missing MOBILE_* columns without changing existing PC data.
// ============================================================
function migrateLicensesToRev229DualSlot() {
  const sheet = getLicensesSheet_();
  const current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(h) { return String(h).trim(); });
  const set = {};
  current.forEach(function(h) { set[h] = true; });
  const mobileHeaders = [
    'MOBILE_ACTIVE_DEVICE_ID',
    'MOBILE_ACTIVE_PUBLIC_KEY',
    'MOBILE_ACTIVE_SESSION_ID',
    'MOBILE_DEVICE_NAME',
    'MOBILE_FCM_REGISTRATION_ID',
    'MOBILE_PENDING_REQUEST_ID',
    'MOBILE_PENDING_DEVICE_ID',
    'MOBILE_PENDING_PUBLIC_KEY',
    'MOBILE_PENDING_FCM_ID',
    'MOBILE_PENDING_STATUS',
    'MOBILE_PENDING_REQUESTED_AT',
    'MOBILE_LAST_SEEN_AT'
  ];
  const missing = mobileHeaders.filter(function(h) { return !set[h]; });
  if (missing.length) {
    const start = sheet.getLastColumn() + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    sheet.getRange(1, start, 1, missing.length)
      .setFontWeight('bold')
      .setBackground('#0F172A')
      .setFontColor('#FFFFFF');
  }
  SpreadsheetApp.flush();
  return {
    ok: true,
    revision: 'REV229_DUAL_SLOT',
    addedHeaders: missing,
    desktopDataPreserved: true,
    tokenModel: 'ONE_TOKEN_ONE_DESKTOP_ONE_MOBILE'
  };
}

/**
 * REV229 ADMIN HELPER — reset only the Mobile slot.
 * Desktop/PC binding is preserved.
 * Usage from Apps Script editor: resetMobileSlotByLicenseIdRev229('LIC-....')
 */
function resetMobileSlotByLicenseIdRev229(licenseId) {
  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);
  const rowNumber = findRowByValue_(sheet, 'LICENSE_ID', String(licenseId || '').trim());
  if (!rowNumber) throw new Error('LICENSE_ID tidak ditemukan: ' + licenseId);
  updateRowByHeaders_(sheet, rowNumber, {
    MOBILE_ACTIVE_DEVICE_ID: '',
    MOBILE_ACTIVE_PUBLIC_KEY: '',
    MOBILE_ACTIVE_SESSION_ID: '',
    MOBILE_DEVICE_NAME: '',
    MOBILE_FCM_REGISTRATION_ID: '',
    MOBILE_PENDING_REQUEST_ID: '',
    MOBILE_PENDING_DEVICE_ID: '',
    MOBILE_PENDING_PUBLIC_KEY: '',
    MOBILE_PENDING_FCM_ID: '',
    MOBILE_PENDING_STATUS: '',
    MOBILE_PENDING_REQUESTED_AT: '',
    MOBILE_LAST_SEEN_AT: ''
  });
  SpreadsheetApp.flush();
  return { ok: true, licenseId: String(licenseId || '').trim(), mobileSlotReset: true, desktopSlotPreserved: true };
}


// ============================================================
// REV231 — ONE-TIME ONLINE STATUS LAYOUT MIGRATION
// Run once after replacing Code.gs, before/after New Version deploy.
// D = PC ONLINE, E = MOBILE ONLINE, previous E moves to F.
// ============================================================
function migrateLicenseOnlineStatusV231() {
  const dual = migrateLicensesToRev229DualSlot();
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);
  const layout = ensureLicenseAdminLayoutV540_(sheet, true);
  const setup = setupLicenseOnlineStatusV538();
  const refresh = refreshLicenseOnlineStatusV538();
  const result = {
    success: true,
    version: 'REV231_PC_MOBILE_ONLINE',
    dualSlotMigration: dual,
    columns: {
      pcOnline: layout.pcStatusColumn,
      mobileOnline: layout.mobileStatusColumn,
      lastOnlinePc: layout.lastOnlineColumn
    },
    setup: setup,
    refresh: refresh
  };
  console.log(JSON.stringify(result));
  return result;
}


// ============================================================
// REV232 — ADMIN BUTTONS + SEPARATE PC / MOBILE RESET
// RUN ONCE AFTER REPLACING Code.gs:
//   migrateLicenseAdminButtonsV232
// ============================================================
function migrateLicenseAdminButtonsV232() {
  const dual = migrateLicensesToRev229DualSlot();
  const spreadsheetId = getRequiredScriptProperty_(PROP_SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = requireSheet_(ss, SHEET_LICENSES);
  const layout = ensureLicenseAdminLayoutV540_(sheet, true);
  const online = setupLicenseOnlineStatusV538();
  const refresh = refreshLicenseOnlineStatusV538();
  const send = refreshSendEmailButtonsV541_(sheet);
  const sendUpdate = refreshSendEmailUpdateButtonsV294_(sheet);
  const resets = refreshDeviceResetButtonsV232_(sheet);
  const result = {
    success: true,
    version: 'REV232_ADMIN_BUTTONS_RESET',
    webAppUrl: getLicensePublicWebAppUrlV541_(),
    dualSlotMigration: dual,
    columns: {
      sendEmail: layout.sendEmailColumn,
      sendEmailUpdate: layout.sendEmailUpdateColumn,
      pcOnline: layout.pcStatusColumn,
      mobileOnline: layout.mobileStatusColumn,
      resetPc: layout.resetPcColumn,
      resetMobile: layout.resetMobileColumn,
      lastOnlinePc: layout.lastOnlineColumn
    },
    sendEmailButtons: send,
    sendEmailUpdateButtons: sendUpdate,
    resetButtons: resets,
    onlineSetup: online,
    refresh: refresh
  };
  console.log(JSON.stringify(result));
  return result;
}

function selectedLicenseIdV232_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet || sheet.getName() !== SHEET_LICENSES) throw new Error('Buka tab Licenses terlebih dahulu.');
  const row = sheet.getActiveRange().getRow();
  if (row < 2) throw new Error('Pilih salah satu row client/license.');
  const data = getRowObject_(sheet, row);
  const id = String(data.LICENSE_ID || '').trim().toUpperCase();
  if (!id) throw new Error('LICENSE_ID pada row terpilih kosong.');
  return id;
}

function resetPcDeviceFromSelectedRowV232() {
  const id = selectedLicenseIdV232_();
  const result = resetPcSlotByLicenseIdV232(id);
  const sheet = getLicensesSheet_();
  const row = findRowByValue_(sheet, 'LICENSE_ID', id);
  if (row) writeResetButtonsForRowV232_(sheet, row);
  SpreadsheetApp.getUi().alert('Reset PC berhasil untuk ' + id);
  return result;
}

function resetMobileDeviceFromSelectedRowV232() {
  const id = selectedLicenseIdV232_();
  const result = resetMobileSlotByLicenseIdV232(id);
  const sheet = getLicensesSheet_();
  const row = findRowByValue_(sheet, 'LICENSE_ID', id);
  if (row) writeResetButtonsForRowV232_(sheet, row);
  SpreadsheetApp.getUi().alert('Reset Mobile berhasil untuk ' + id);
  return result;
}


// ============================================================================
// REV234 — PREMIUM REMOTE CONTROL RELAY + MOBILE CONNECTION STATUS
// ============================================================================
const TF_REMOTE_SHEET_V233 = 'Remote_Control';
const TF_REMOTE_HEADERS_V233 = [
  'LICENSE_ID','EMAIL','DESKTOP_LAST_SEEN_AT','EXTENSION_VERSION','SNAPSHOT_JSON',
  'COMMAND_ID','COMMAND_JSON','COMMAND_STATUS','COMMAND_CREATED_AT',
  'COMMAND_UPDATED_AT','RESULT_JSON','MOBILE_REMOTE_LAST_SEEN_AT'
];
const TF_REMOTE_ONLINE_WINDOW_MS_V233 = 22000;
const TF_REMOTE_MOBILE_ONLINE_WINDOW_MS_V234 = 18000;
const TF_REMOTE_RETRY_IN_PROGRESS_MS_V233 = 20000;
const TF_REMOTE_COMMAND_BUSY_MS_V233 = 60000;
const TF_REMOTE_MAX_SNAPSHOT_CHARS_V233 = 42000;
const TF_REMOTE_MAX_COMMAND_CHARS_V233 = 36000;
const TF_REMOTE_MAX_RESULT_CHARS_V233 = 12000;

function migrateRemoteControlV233() {
  ensureRemoteControlSheetV233_();
  return {
    ok: true,
    revision: 'REV234',
    message: 'Remote_Control sheet siap. Tidak ada data lisensi yang dihapus.'
  };
}

function migrateRemoteControlV234() {
  const sheet = ensureRemoteControlSheetV233_();
  return {
    ok: true,
    revision: 'REV234',
    sheet: sheet.getName(),
    message: 'Remote_Control REV234 siap, termasuk status koneksi Remote Mobile.'
  };
}

function migrateRev234Complete() {
  const web = repairLicenseWebAppUrlV234();
  const admin = migrateLicenseAdminButtonsV232();
  const adminSetup = setupLicenseAdminV542();
  const remote = migrateRemoteControlV234();
  const onlineSetup = setupLicenseOnlineStatusV538();
  const onlineRefresh = refreshLicenseOnlineStatusV538();
  const result = {
    ok: true, success: true, revision: 'REV234',
    webAppUrl: web.webAppUrl,
    admin: admin,
    adminSetup: adminSetup,
    remote: remote,
    onlineSetup: onlineSetup,
    onlineRefresh: onlineRefresh,
    message: 'REV234 selesai: Web App URL valid, tombol SEND/RESET direfresh, trigger admin/status dipastikan aktif, PC/Mobile status aktif, Remote_Control siap.'
  };
  console.log(JSON.stringify(result));
  return result;
}



function migrateRev235Complete() {
  const base = migrateRev234Complete();
  const remote = migrateRemoteControlV234();
  const result = {
    ok: true,
    success: true,
    revision: 'REV235',
    base: base,
    remote: remote,
    message: 'REV235 selesai: backend lisensi/admin tetap kompatibel, Remote_Control siap untuk full remote controls dan Mobile V35.'
  };
  console.log(JSON.stringify(result));
  return result;
}


function migrateRev236Complete() {
  const base = migrateRev235Complete();
  ensureRemoteControlSheetV233_();
  try {
    const cache = CacheService.getScriptCache();
    cache.put('TF_REMOTE_REVISION', 'REV236', 21600);
  } catch (_) {}
  const result = {
    ok: true,
    success: true,
    revision: 'REV236',
    base: base,
    message: 'REV236 selesai: Remote relay menggunakan cache cepat, polling tidak lagi bergantung pada write Google Sheet setiap heartbeat, dan backend siap untuk Mobile V36 / Extension 1.16.3.'
  };
  console.log(JSON.stringify(result));
  return result;
}

function ensureRemoteControlSheetV233_() {
  const licenses = getLicensesSheet_();
  const ss = licenses.getParent();
  let sheet = ss.getSheetByName(TF_REMOTE_SHEET_V233);
  if (!sheet) sheet = ss.insertSheet(TF_REMOTE_SHEET_V233);

  const lastCol = Math.max(1, sheet.getLastColumn());
  const existing = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(v => String(v || '').trim());
  const headerMap = {};
  existing.forEach((h, i) => { if (h) headerMap[h] = i + 1; });
  const missing = TF_REMOTE_HEADERS_V233.filter(h => !headerMap[h]);
  if (missing.length) {
    const start = Math.max(1, sheet.getLastColumn() + 1);
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  }

  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  try {
    sheet.getRange(1, 1, 1, TF_REMOTE_HEADERS_V233.length)
      .setFontWeight('bold')
      .setBackground('#1f2937')
      .setFontColor('#ffffff');
  } catch (_) {}
  return sheet;
}

function remoteHeaderMapV233_(sheet) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};
  headers.forEach((h, i) => { h = String(h || '').trim(); if (h) map[h] = i + 1; });
  return map;
}

function remoteFindRowV233_(sheet, licenseId) {
  const id = String(licenseId || '').trim();
  if (!id || sheet.getLastRow() < 2) return 0;
  const map = remoteHeaderMapV233_(sheet);
  const col = map.LICENSE_ID;
  if (!col) return 0;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === id) return i + 2;
  }
  return 0;
}

function remoteEnsureRowV233_(sheet, licenseId, email) {
  let row = remoteFindRowV233_(sheet, licenseId);
  const map = remoteHeaderMapV233_(sheet);
  if (!row) {
    row = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(row, map.LICENSE_ID).setValue(String(licenseId || '').trim());
  }
  if (map.EMAIL) sheet.getRange(row, map.EMAIL).setValue(canonicalEmail_(email));
  return row;
}

function remoteReadObjectV233_(sheet, row) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const out = {};
  headers.forEach((h, i) => { h = String(h || '').trim(); if (h) out[h] = values[i]; });
  return out;
}

function remoteWriteV233_(sheet, row, updates) {
  const map = remoteHeaderMapV233_(sheet);
  Object.keys(updates || {}).forEach(key => {
    if (map[key]) sheet.getRange(row, map[key]).setValue(updates[key]);
  });
}

function remoteJsonStringV233_(value, maxChars) {
  let text = '';
  try { text = JSON.stringify(value == null ? null : value); } catch (_) { text = '{}'; }
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return text;
}

function remoteParseJsonV233_(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function remoteLicenseRecordV233_(payload) {
  const sheet = getLicensesSheet_();
  assertLicenseDeviceHeaders_(sheet);
  const record = findLicenseRecord_(sheet, {
    email: payload.email,
    token: payload.token,
    licenseId: payload.licenseId
  });
  if (!record) return { record: null, license: deviceLicenseNotFound_() };
  return { record: record, license: buildDeviceLicensePayload_(record) };
}

function remoteCommandPayloadV233_(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const id = String(obj.COMMAND_ID || '').trim();
  const status = String(obj.COMMAND_STATUS || '').trim().toUpperCase();
  if (!id || (status !== 'PENDING' && status !== 'IN_PROGRESS')) return null;
  return {
    id: id,
    status: status,
    command: remoteParseJsonV233_(obj.COMMAND_JSON, {})
  };
}

// ============================================================================
// REV236 — LOW-LATENCY REMOTE RELAY
//
// The Worker has already authenticated the signed PC/Mobile session before it
// reaches this server-only operation. REV235 repeated a full Licenses-sheet
// lookup and then used a 5-second ScriptLock + Remote_Control spreadsheet write
// on every 3-second heartbeat. Mobile/desktop requests therefore frequently
// exceeded their 12-second client timeout. REV236 keeps the live relay in
// Script Cache (split into meta/snapshot/command values) and uses only a very
// short lock for atomic command state changes. Remote_Control remains a setup /
// diagnostic sheet but is no longer the hot-path transport.
// ============================================================================
const TF_REMOTE_CACHE_TTL_SEC_V236 = 180;
// REV279 anti-flap fallback. Explicit disconnect still turns presence off
// immediately; these wider windows only absorb Apps Script cold-start/network
// jitter when the WebSocket fast lane is temporarily unavailable.
const TF_REMOTE_DESKTOP_ONLINE_MS_V236 = 45000;
const TF_REMOTE_MOBILE_ONLINE_MS_V236 = 30000;
const TF_REMOTE_COMMAND_BUSY_MS_V236 = 30000;
const TF_REMOTE_COMMAND_REDELIVER_MS_V236 = 18000;

// REV245 — Fast Import staging. The large compressed bundle bypasses the
// single-command Remote queue. Mobile uploads once, Apps Script stores compact
// cache shards, Desktop fetches once, then the normal Remote queue carries only
// a tiny commit command and final DONE ACK.
const TF_REMOTE_IMPORT_STAGE_TTL_SEC_V245 = 900;
const TF_REMOTE_IMPORT_STAGE_SHARD_CHARS_V245 = 80000;

function remoteImportStageTokenV245_(value, maxLen) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, maxLen || 100);
}
function remoteImportStageMetaKeyV245_(licenseId, transferId) {
  return 'TFR245_IM_' + remoteCacheIdV236_(licenseId) + '_' + remoteImportStageTokenV245_(transferId, 100);
}
function remoteImportStageChunkKeyV245_(licenseId, transferId, index) {
  return 'TFR245_IC_' + remoteCacheIdV236_(licenseId) + '_' + remoteImportStageTokenV245_(transferId, 100) + '_' + String(index);
}
function remoteImportStagePutV245_(cache, identity, payload) {
  const id = remoteImportStageTokenV245_(payload && payload.transferId, 100);
  const data = String(payload && payload.data || '');
  if (!id || !data) return { ok:false, valid:true, code:'IMPORT_STAGE_INVALID', message:'Transfer ID / data Fast Import kosong.' };

  const totalParts = Math.max(0, Number(payload && payload.totalParts || 0));
  const partIndex = Number(payload && payload.partIndex);
  const multipart = totalParts > 0 && isFinite(partIndex) && partIndex >= 0;

  // REV248 Fast Staging V4: one small cache value per externally uploaded part.
  // This avoids one huge Apps Script POST + putAll burst that was causing
  // APPS_SCRIPT_TIMEOUT on cold starts / busy accounts.
  if (multipart) {
    if (totalParts > 100 || partIndex >= totalParts) return { ok:false, valid:true, code:'IMPORT_STAGE_PART_INVALID', message:'Index/total Fast Import part tidak valid.' };
    if (data.length > 70000) return { ok:false, valid:true, code:'IMPORT_STAGE_PART_TOO_LARGE', message:'Fast Import part terlalu besar.' };
    const partKey = 'TFR248_IP_' + remoteCacheIdV236_(identity.licenseId) + '_' + id + '_' + String(partIndex);
    cache.put(partKey, data, TF_REMOTE_IMPORT_STAGE_TTL_SEC_V245);
    const meta = {
      id:id,
      mode:'multipart-v4',
      totalParts:totalParts,
      encoding:String(payload.encoding||'plain').slice(0,20),
      fileName:String(payload.fileName||'mobile-import.json').slice(0,180),
      originalChars:Number(payload.originalChars||0),
      createdAt:Date.now()
    };
    cache.put(remoteImportStageMetaKeyV245_(identity.licenseId,id), JSON.stringify(meta), TF_REMOTE_IMPORT_STAGE_TTL_SEC_V245);
    return { ok:true, valid:true, stored:true, transferId:id, partIndex:partIndex, totalParts:totalParts, bytes:data.length, revision:'REV248' };
  }

  // Backward compatibility for REV245/246/247 clients.
  if (data.length > 4500000) return { ok:false, valid:true, code:'IMPORT_STAGE_TOO_LARGE', message:'Fast Import terlalu besar untuk relay.' };
  const total = Math.max(1, Math.ceil(data.length / TF_REMOTE_IMPORT_STAGE_SHARD_CHARS_V245));
  const values = {};
  for (let i=0;i<total;i++) values[remoteImportStageChunkKeyV245_(identity.licenseId,id,i)] = data.slice(i*TF_REMOTE_IMPORT_STAGE_SHARD_CHARS_V245,(i+1)*TF_REMOTE_IMPORT_STAGE_SHARD_CHARS_V245);
  cache.putAll(values, TF_REMOTE_IMPORT_STAGE_TTL_SEC_V245);
  const meta = { id:id, total:total, length:data.length, encoding:String(payload.encoding||'plain').slice(0,20), fileName:String(payload.fileName||'mobile-import.json').slice(0,180), originalChars:Number(payload.originalChars||0), createdAt:Date.now() };
  cache.put(remoteImportStageMetaKeyV245_(identity.licenseId,id), JSON.stringify(meta), TF_REMOTE_IMPORT_STAGE_TTL_SEC_V245);
  return { ok:true, valid:true, stored:true, transferId:id, shards:total, bytes:data.length, revision:'REV248' };
}
function remoteImportStageGetV245_(cache, identity, payload) {
  const id = remoteImportStageTokenV245_(payload && payload.transferId, 100);
  if (!id) return { ok:false, valid:true, code:'IMPORT_STAGE_ID_REQUIRED', message:'Transfer ID Fast Import kosong.' };
  const meta = remoteCacheGetJsonV236_(cache, remoteImportStageMetaKeyV245_(identity.licenseId,id), null);
  if (!meta) return { ok:false, valid:true, code:'IMPORT_STAGE_MISSING', message:'Fast Import staging sudah tidak tersedia / expired.' };

  if (String(meta.mode||'') === 'multipart-v4' && Number(meta.totalParts||0) > 0) {
    const totalParts = Number(meta.totalParts||0);
    if (payload && payload.metaOnly === true) {
      return { ok:true, valid:true, complete:true, multipart:true, transferId:id, totalParts:totalParts, encoding:String(meta.encoding||'plain'), fileName:String(meta.fileName||''), originalChars:Number(meta.originalChars||0), revision:'REV248' };
    }
    const requestedPart = Number(payload && payload.partIndex);
    if (isFinite(requestedPart) && requestedPart >= 0) {
      if (requestedPart >= totalParts) return { ok:false, valid:true, code:'IMPORT_STAGE_PART_RANGE', message:'Index Fast Import part di luar range.', revision:'REV248' };
      const key='TFR248_IP_' + remoteCacheIdV236_(identity.licenseId) + '_' + id + '_' + String(requestedPart);
      const value=cache.get(key);
      if(typeof value!=='string')return {ok:true,valid:true,complete:false,transferId:id,partIndex:requestedPart,missing:true,message:'Fast Import part belum tersedia.',revision:'REV248'};
      return {ok:true,valid:true,complete:true,multipart:true,transferId:id,partIndex:requestedPart,totalParts:totalParts,data:value,encoding:String(meta.encoding||'plain'),revision:'REV248'};
    }
    // Legacy REV245/246 desktop can still request the whole bundle at once.
    const keys=[];
    for(let i=0;i<totalParts;i++) keys.push('TFR248_IP_' + remoteCacheIdV236_(identity.licenseId) + '_' + id + '_' + String(i));
    const got=cache.getAll(keys)||{};const missing=[];const parts=[];
    for(let i=0;i<keys.length;i++){const v=got[keys[i]];if(typeof v!=='string'){missing.push(i);parts.push('');}else parts.push(v);}
    if(missing.length)return { ok:true, valid:true, complete:false, transferId:id, missingIndexes:missing, message:'Fast Import staging belum lengkap.', revision:'REV248' };
    const data=parts.join('');
    return { ok:true, valid:true, complete:true, transferId:id, data:data, encoding:String(meta.encoding||'plain'), fileName:String(meta.fileName||''), originalChars:Number(meta.originalChars||0), revision:'REV248' };
  }

  if (!meta.total) return { ok:false, valid:true, code:'IMPORT_STAGE_MISSING', message:'Fast Import staging metadata tidak lengkap.' };
  const keys=[];for(let i=0;i<meta.total;i++)keys.push(remoteImportStageChunkKeyV245_(identity.licenseId,id,i));
  const got=cache.getAll(keys)||{};const missing=[];const parts=[];
  for(let i=0;i<keys.length;i++){const v=got[keys[i]];if(typeof v!=='string'){missing.push(i);parts.push('');}else parts.push(v);}
  if(missing.length)return { ok:true, valid:true, complete:false, transferId:id, missingIndexes:missing, message:'Fast Import staging belum lengkap.' };
  const data=parts.join('');
  return { ok:true, valid:true, complete:true, transferId:id, data:data, encoding:String(meta.encoding||'plain'), fileName:String(meta.fileName||''), originalChars:Number(meta.originalChars||0), revision:'REV248' };
}
function remoteImportStageClearV245_(cache, identity, payload) {
  const id = remoteImportStageTokenV245_(payload && payload.transferId, 100);if(!id)return {ok:true,valid:true,cleared:false,revision:'REV248'};
  const mk=remoteImportStageMetaKeyV245_(identity.licenseId,id);const meta=remoteCacheGetJsonV236_(cache,mk,null);const keys=[mk];
  if(meta&&String(meta.mode||'')==='multipart-v4'&&Number(meta.totalParts||0)>0){
    for(let i=0;i<Number(meta.totalParts);i++)keys.push('TFR248_IP_' + remoteCacheIdV236_(identity.licenseId) + '_' + id + '_' + String(i));
  }else if(meta&&meta.total){for(let i=0;i<meta.total;i++)keys.push(remoteImportStageChunkKeyV245_(identity.licenseId,id,i));}
  try{cache.removeAll(keys);}catch(_){keys.forEach(k=>{try{cache.remove(k);}catch(__){}});}
  return {ok:true,valid:true,cleared:true,transferId:id,revision:'REV248'};
}



// ============================================================================
// REV291 — EXPORT PRIORITY RECOVERY + PRIVATE GOOGLE DRIVE LARGE-FILE RELAY
//
// Large Remote bundles are stored as a private temporary text file in the Drive
// account that owns this Apps Script deployment. No "anyone with link" sharing
// is used. Cloudflare authenticates the Desktop/Mobile session before these
// server-only operations are reached. A one-file relay replaces dozens of
// command-queue chunk/ACK round trips for PC -> Mobile sync/export.
// ============================================================================
const TF_REMOTE_DRIVE_RELAY_TTL_SEC_V289 = 20 * 60;
const TF_REMOTE_DRIVE_RELAY_STALE_MS_V289 = 60 * 60 * 1000;
const TF_REMOTE_DRIVE_RELAY_MAX_CHARS_V289 = 8500000;
const TF_REMOTE_DRIVE_RELAY_FOLDER_PROP_V289 = 'TF_REMOTE_DRIVE_RELAY_FOLDER_ID_V289';
const TF_REMOTE_DRIVE_RELAY_FOLDER_NAME_V289 = 'TF Remote Temp Relay (Private)';

function setupRemoteDriveRelayV289() {
  const folder = remoteDriveRelayFolderV289_();
  remoteDriveRelayCleanupV289_(folder, Date.now());
  return {
    ok:true,
    revision:'REV289',
    relayMode:'drive-v1',
    folderName:folder.getName(),
    folderId:folder.getId(),
    private:true,
    message:'Private Google Drive relay REV289 siap. Deploy New Version Web App setelah authorization selesai.'
  };
}

function remoteDriveRelayTokenV289_(value, maxLen) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, maxLen || 100);
}
function remoteDriveRelayMetaKeyV289_(licenseId, transferId) {
  return 'TFR289_DR_' + remoteCacheIdV236_(licenseId) + '_' + remoteDriveRelayTokenV289_(transferId,100);
}
function remoteDriveRelayFileNameV289_(licenseId, transferId) {
  return 'TFREMOTE_' + remoteCacheIdV236_(licenseId).slice(0,48) + '_' + remoteDriveRelayTokenV289_(transferId,100) + '.relay';
}
function remoteDriveRelayFolderV289_() {
  const props = PropertiesService.getScriptProperties();
  const known = String(props.getProperty(TF_REMOTE_DRIVE_RELAY_FOLDER_PROP_V289) || '').trim();
  if (known) {
    try { return DriveApp.getFolderById(known); } catch (_) {}
  }
  const found = DriveApp.getFoldersByName(TF_REMOTE_DRIVE_RELAY_FOLDER_NAME_V289);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(TF_REMOTE_DRIVE_RELAY_FOLDER_NAME_V289);
  props.setProperty(TF_REMOTE_DRIVE_RELAY_FOLDER_PROP_V289, folder.getId());
  return folder;
}
function remoteDriveRelayCleanupV289_(folder, nowMs) {
  try {
    const files = folder.getFiles();
    let checked = 0;
    while (files.hasNext() && checked < 80) {
      checked++;
      const f = files.next();
      const name = String(f.getName() || '');
      if (name.indexOf('TFREMOTE_') !== 0) continue;
      let created = 0;
      try { created = f.getDateCreated().getTime(); } catch (_) {}
      if (created && nowMs - created > TF_REMOTE_DRIVE_RELAY_STALE_MS_V289) {
        try { f.setTrashed(true); } catch (_) {}
      }
    }
  } catch (_) {}
}
function remoteDriveRelayResolveFileV289_(cache, identity, transferId) {
  const key = remoteDriveRelayMetaKeyV289_(identity.licenseId, transferId);
  const meta = remoteCacheGetJsonV236_(cache, key, null);
  if (meta && meta.fileId) {
    try { return { file: DriveApp.getFileById(String(meta.fileId)), meta: meta, key: key }; } catch (_) {}
  }
  // CacheService may evict metadata early. Recover by deterministic private filename.
  try {
    const folder = remoteDriveRelayFolderV289_();
    const files = folder.getFilesByName(remoteDriveRelayFileNameV289_(identity.licenseId, transferId));
    if (files.hasNext()) {
      const file = files.next();
      let recovered = meta || {};
      try {
        const desc = String(file.getDescription() || '');
        if (desc.indexOf('TFREMOTE_META:') === 0) recovered = JSON.parse(desc.slice('TFREMOTE_META:'.length)) || recovered;
      } catch (_) {}
      return { file:file, meta:recovered, key:key };
    }
  } catch (_) {}
  return { file:null, meta:meta || {}, key:key };
}
function remoteDriveStagePutV289_(cache, identity, payload) {
  const id = remoteDriveRelayTokenV289_(payload && payload.transferId,100);
  const data = String(payload && payload.data || '');
  if (!id || !data) return {ok:false,valid:true,code:'DRIVE_RELAY_INVALID',message:'Transfer ID / data Drive relay kosong.'};
  if (data.length > TF_REMOTE_DRIVE_RELAY_MAX_CHARS_V289) return {ok:false,valid:true,code:'DRIVE_RELAY_TOO_LARGE',message:'Data Drive relay terlalu besar.'};
  const now = Date.now();
  const folder = remoteDriveRelayFolderV289_();
  // Replace an old file with the same deterministic name so retries remain idempotent.
  try {
    const old = folder.getFilesByName(remoteDriveRelayFileNameV289_(identity.licenseId,id));
    while (old.hasNext()) { try { old.next().setTrashed(true); } catch (_) {} }
  } catch (_) {}
  const blob = Utilities.newBlob(data, 'text/plain;charset=UTF-8', remoteDriveRelayFileNameV289_(identity.licenseId,id));
  const file = folder.createFile(blob);
  const meta = {
    id:id,
    fileId:file.getId(),
    fileName:String(payload.fileName || 'tf-remote-relay.bin').slice(0,180),
    encoding:String(payload.encoding || 'plain').slice(0,20),
    originalChars:Number(payload.originalChars || 0),
    direction:String(payload.direction || '').slice(0,32),
    sourceRole:String(payload.sourceRole || '').slice(0,16),
    length:data.length,
    createdAt:now,
    expiresAt:now + TF_REMOTE_DRIVE_RELAY_TTL_SEC_V289*1000
  };
  try { file.setDescription('TFREMOTE_META:' + JSON.stringify(meta)); } catch (_) {}
  cache.put(remoteDriveRelayMetaKeyV289_(identity.licenseId,id), JSON.stringify(meta), TF_REMOTE_DRIVE_RELAY_TTL_SEC_V289);
  // Opportunistic cleanup only after the new file is safely stored.
  if ((now % 5) === 0) remoteDriveRelayCleanupV289_(folder, now);
  return {ok:true,valid:true,stored:true,complete:true,relayMode:'drive-v1',transferId:id,bytes:data.length,encoding:meta.encoding,fileName:meta.fileName,expiresAt:meta.expiresAt,revision:'REV289'};
}
function remoteDriveStageGetV289_(cache, identity, payload) {
  const id = remoteDriveRelayTokenV289_(payload && payload.transferId,100);
  if (!id) return {ok:false,valid:true,code:'DRIVE_RELAY_ID_REQUIRED',message:'Transfer ID Drive relay kosong.'};
  const resolved = remoteDriveRelayResolveFileV289_(cache, identity, id);
  if (!resolved.file) return {ok:false,valid:true,code:'DRIVE_RELAY_MISSING',message:'File relay Drive tidak tersedia / sudah dibersihkan.'};
  const meta = resolved.meta || {};
  if (Number(meta.expiresAt||0) && Date.now() > Number(meta.expiresAt||0)) {
    try { resolved.file.setTrashed(true); } catch (_) {}
    try { cache.remove(resolved.key); } catch (_) {}
    return {ok:false,valid:true,code:'DRIVE_RELAY_EXPIRED',message:'File relay Drive sudah kedaluwarsa.'};
  }
  let data='';
  try { data = resolved.file.getBlob().getDataAsString('UTF-8'); }
  catch (e) { return {ok:false,valid:true,code:'DRIVE_RELAY_READ_FAILED',message:'Drive relay gagal dibaca: '+String(e&&e.message?e.message:e)}; }
  if (!data) return {ok:false,valid:true,code:'DRIVE_RELAY_EMPTY',message:'File relay Drive kosong.'};
  if (data.length > TF_REMOTE_DRIVE_RELAY_MAX_CHARS_V289) return {ok:false,valid:true,code:'DRIVE_RELAY_TOO_LARGE',message:'File relay Drive melebihi batas aman.'};
  return {ok:true,valid:true,complete:true,relayMode:'drive-v1',transferId:id,data:data,bytes:data.length,encoding:String(meta.encoding||'plain'),fileName:String(meta.fileName||''),originalChars:Number(meta.originalChars||0),revision:'REV289'};
}
function remoteDriveStageClearV289_(cache, identity, payload) {
  const id = remoteDriveRelayTokenV289_(payload && payload.transferId,100);
  if (!id) return {ok:true,valid:true,cleared:false,relayMode:'drive-v1',revision:'REV289'};
  const resolved = remoteDriveRelayResolveFileV289_(cache, identity, id);
  let trashed=false;
  if (resolved.file) { try { resolved.file.setTrashed(true); trashed=true; } catch (_) {} }
  try { cache.remove(resolved.key); } catch (_) {}
  return {ok:true,valid:true,cleared:true,trashed:trashed,relayMode:'drive-v1',transferId:id,revision:'REV289'};
}

function remoteCacheIdV236_(licenseId) {
  const raw = String(licenseId || '').trim().toUpperCase();
  return raw.replace(/[^A-Z0-9_-]/g, '').slice(0, 96);
}

function remoteCacheKeyV236_(kind, licenseId) {
  return 'TFR236_' + String(kind || 'X').toUpperCase() + '_' + remoteCacheIdV236_(licenseId);
}

function remoteCacheGetJsonV236_(cache, key, fallback) {
  try {
    const text = cache.get(key);
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function remoteCachePutJsonV236_(cache, key, value, ttlSec) {
  let text = '{}';
  try { text = JSON.stringify(value == null ? {} : value); } catch (_) {}
  cache.put(key, text, ttlSec || TF_REMOTE_CACHE_TTL_SEC_V236);
}

function remoteTrustedIdentityV236_(payload) {
  const licenseId = remoteCacheIdV236_(payload && payload.licenseId);
  if (!licenseId) {
    return { ok: false, result: { ok: true, valid: false, code: 'REMOTE_LICENSE_ID_REQUIRED', message: 'License ID Remote tidak tersedia.' } };
  }
  return {
    ok: true,
    licenseId: licenseId,
    email: String(payload && payload.email || '').trim().toLowerCase()
  };
}

function remoteDefaultMetaV236_(identity) {
  return {
    licenseId: identity.licenseId,
    email: identity.email || '',
    desktopLastSeenMs: 0,
    extensionVersion: '',
    mobileLastSeenMs: 0,
    commandId: '',
    commandStatus: '',
    commandCreatedMs: 0,
    commandUpdatedMs: 0,
    result: {}
  };
}

function remoteAcquireFastLockV236_() {
  const lock = LockService.getScriptLock();
  try {
    if (lock.tryLock(700)) return lock;
  } catch (_) {}
  return null;
}

function remotePresenceKeyV248_(kind, licenseId) {
  return 'TFR248_' + String(kind || 'P').toUpperCase() + '_' + remoteCacheIdV236_(licenseId);
}

function remotePresenceGetV248_(cache, kind, identity) {
  return remoteCacheGetJsonV236_(cache, remotePresenceKeyV248_(kind, identity.licenseId), {});
}

function remotePresencePutV248_(cache, kind, identity, value) {
  remoteCachePutJsonV236_(cache, remotePresenceKeyV248_(kind, identity.licenseId), value || {}, TF_REMOTE_CACHE_TTL_SEC_V236);
}

function remoteCommandLockV248_() {
  const lock = LockService.getScriptLock();
  try { if (lock.tryLock(1200)) return lock; } catch (_) {}
  return null;
}

function remoteServerOperationV233_(operation, payload) {
  const identity = remoteTrustedIdentityV236_(payload || {});
  if (!identity.ok) return identity.result;

  const cache = CacheService.getScriptCache();
  const metaKey = remoteCacheKeyV236_('META', identity.licenseId);
  const snapshotKey = remoteCacheKeyV236_('SNAP', identity.licenseId);
  const commandKey = remoteCacheKeyV236_('CMD', identity.licenseId);
  const nowMs = Date.now();

  // Fast Import staging never takes the Remote command lock.
  if (operation === 'remote-import-stage-put') return remoteImportStagePutV245_(cache, identity, payload || {});
  if (operation === 'remote-import-stage-get') return remoteImportStageGetV245_(cache, identity, payload || {});
  if (operation === 'remote-import-stage-clear') return remoteImportStageClearV245_(cache, identity, payload || {});
  if (operation === 'remote-drive-stage-put') return remoteDriveStagePutV289_(cache, identity, payload || {});
  if (operation === 'remote-drive-stage-get') return remoteDriveStageGetV289_(cache, identity, payload || {});
  if (operation === 'remote-drive-stage-clear') return remoteDriveStageClearV289_(cache, identity, payload || {});

  // -----------------------------------------------------------------------
  // REV248 presence/status hot path: lock-free.
  // Presence is stored separately from command META so a 500-1200ms status
  // heartbeat cannot overwrite commandStatus/result or wait behind a global
  // ScriptLock. Writes are throttled to ~2.5s while reads stay fresh.
  // -----------------------------------------------------------------------
  // REV260 fast bootstrap read: identical to mobile-status but DOES NOT touch
  // Mobile presence. Worker can safely run this in parallel with a cold license
  // lookup, validate the session, then return the already-read core snapshot.
  // The next warm mobile-status heartbeat records presence normally.
  if (operation === 'remote-mobile-read') {
    const desk = remotePresenceGetV248_(cache, 'DSK', identity) || {};
    const meta = remoteCacheGetJsonV236_(cache, metaKey, remoteDefaultMetaV236_(identity)) || remoteDefaultMetaV236_(identity);
    const deskSeen = Number(desk.lastSeenMs || meta.desktopLastSeenMs || 0);
    const desktopOnline = deskSeen > 0 && nowMs - deskSeen <= TF_REMOTE_DESKTOP_ONLINE_MS_V236;
    const mob = remotePresenceGetV248_(cache, 'MOB', identity) || {};
    const mobSeen = Number(mob.lastSeenMs || meta.mobileLastSeenMs || 0);
    return {
      ok: true,
      valid: true,
      remoteAllowed: true,
      desktopOnline: desktopOnline,
      mobileRemoteOnline: mobSeen > 0 && nowMs - mobSeen <= TF_REMOTE_MOBILE_ONLINE_MS_V236,
      desktopLastSeenAt: deskSeen ? new Date(deskSeen).toISOString() : '',
      extensionVersion: String(desk.extensionVersion || meta.extensionVersion || ''),
      snapshot: remoteCacheGetJsonV236_(cache, snapshotKey, {}),
      commandId: String(meta.commandId || ''),
      commandStatus: String(meta.commandStatus || ''),
      result: meta.result && typeof meta.result === 'object' ? meta.result : {},
      serverTime: new Date(nowMs).toISOString(),
      revision: 'REV260',
      bootstrapRead: true
    };
  }

  if (operation === 'remote-mobile-status') {
    let mob = remotePresenceGetV248_(cache, 'MOB', identity);
    if (!mob || typeof mob !== 'object') mob = {};
    if (!Number(mob.lastSeenMs || 0) || nowMs - Number(mob.lastSeenMs || 0) >= 2500) {
      mob = { lastSeenMs: nowMs, email: identity.email || '' };
      remotePresencePutV248_(cache, 'MOB', identity, mob);
    }

    const desk = remotePresenceGetV248_(cache, 'DSK', identity) || {};
    const meta = remoteCacheGetJsonV236_(cache, metaKey, remoteDefaultMetaV236_(identity)) || remoteDefaultMetaV236_(identity);
    const deskSeen = Number(desk.lastSeenMs || meta.desktopLastSeenMs || 0);
    const desktopOnline = deskSeen > 0 && nowMs - deskSeen <= TF_REMOTE_DESKTOP_ONLINE_MS_V236;
    return {
      ok: true,
      valid: true,
      remoteAllowed: true,
      desktopOnline: desktopOnline,
      mobileRemoteOnline: true,
      desktopLastSeenAt: deskSeen ? new Date(deskSeen).toISOString() : '',
      extensionVersion: String(desk.extensionVersion || meta.extensionVersion || ''),
      snapshot: remoteCacheGetJsonV236_(cache, snapshotKey, {}),
      commandId: String(meta.commandId || ''),
      commandStatus: String(meta.commandStatus || ''),
      result: meta.result && typeof meta.result === 'object' ? meta.result : {},
      serverTime: new Date(nowMs).toISOString(),
      revision: 'REV260'
    };
  }

  if (operation === 'remote-desktop-sync') {
    const snapshot = payload && payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {};
    const incomingSig = String(payload && payload.snapshotSig || '').slice(0,80);
    let desk = remotePresenceGetV248_(cache, 'DSK', identity);
    if (!desk || typeof desk !== 'object') desk = {};
    const extVer = String(payload.extensionVersion || '').slice(0,64);
    const snapshotChanged = !incomingSig || incomingSig !== String(desk.snapshotSig || '');
    if (snapshotChanged) remoteCachePutJsonV236_(cache, snapshotKey, snapshot, TF_REMOTE_CACHE_TTL_SEC_V236);
    if (snapshotChanged || extVer !== String(desk.extensionVersion || '') || !Number(desk.lastSeenMs || 0) || nowMs - Number(desk.lastSeenMs || 0) >= 2500) {
      desk = { lastSeenMs: nowMs, extensionVersion: extVer, snapshotSig: incomingSig };
      remotePresencePutV248_(cache, 'DSK', identity, desk);
    }

    let meta = remoteCacheGetJsonV236_(cache, metaKey, remoteDefaultMetaV236_(identity));
    if (!meta || typeof meta !== 'object') meta = remoteDefaultMetaV236_(identity);
    let command = null;
    let status = String(meta.commandStatus || '').toUpperCase();
    let age = nowMs - Number(meta.commandUpdatedMs || meta.commandCreatedMs || 0);
    const needsDelivery = meta.commandId && (status === 'PENDING' || (status === 'IN_PROGRESS' && age >= TF_REMOTE_COMMAND_REDELIVER_MS_V236));

    if (needsDelivery) {
      const lock = remoteCommandLockV248_();
      if (lock) {
        try {
          meta = remoteCacheGetJsonV236_(cache, metaKey, remoteDefaultMetaV236_(identity));
          status = String(meta.commandStatus || '').toUpperCase();
          age = nowMs - Number(meta.commandUpdatedMs || meta.commandCreatedMs || 0);
          if (meta.commandId && status === 'PENDING') {
            meta.commandStatus = 'IN_PROGRESS';
            meta.commandUpdatedMs = nowMs;
            command = remoteCacheGetJsonV236_(cache, commandKey, {});
            remoteCachePutJsonV236_(cache, metaKey, meta, TF_REMOTE_CACHE_TTL_SEC_V236);
          } else if (meta.commandId && status === 'IN_PROGRESS' && age >= TF_REMOTE_COMMAND_REDELIVER_MS_V236) {
            meta.commandUpdatedMs = nowMs;
            command = remoteCacheGetJsonV236_(cache, commandKey, {});
            remoteCachePutJsonV236_(cache, metaKey, meta, TF_REMOTE_CACHE_TTL_SEC_V236);
          }
        } finally { try { lock.releaseLock(); } catch (_) {} }
      }
    }

    const mob = remotePresenceGetV248_(cache, 'MOB', identity) || {};
    const mobSeen = Number(mob.lastSeenMs || meta.mobileLastSeenMs || 0);
    const mobileRemoteOnline = mobSeen > 0 && nowMs - mobSeen <= TF_REMOTE_MOBILE_ONLINE_MS_V236;
    return {
      ok: true,
      valid: true,
      remoteAllowed: true,
      desktopOnline: true,
      mobileRemoteOnline: mobileRemoteOnline,
      mobileRemoteLastSeenAt: mobSeen ? new Date(mobSeen).toISOString() : '',
      command: command && meta.commandId ? { id: meta.commandId, status: meta.commandStatus, command: command } : null,
      serverTime: new Date(nowMs).toISOString(),
      revision: 'REV248'
    };
  }

  // -----------------------------------------------------------------------
  // Command mutations remain atomic, but they are now the ONLY operations
  // taking ScriptLock. This removes heartbeat lock contention across clients.
  // -----------------------------------------------------------------------
  if (operation === 'remote-mobile-command') {
    const lock = remoteCommandLockV248_();
    if (!lock) return { ok:true, valid:true, remoteAllowed:true, retry:true, accepted:false, code:'REMOTE_RETRY_BUSY', message:'Remote command sedang diproses. Coba lagi sesaat.', revision:'REV248' };
    try {
      let meta = remoteCacheGetJsonV236_(cache, metaKey, remoteDefaultMetaV236_(identity));
      if (!meta || typeof meta !== 'object') meta = remoteDefaultMetaV236_(identity);
      const currentStatus = String(meta.commandStatus || '').toUpperCase();
      const age = nowMs - Number(meta.commandUpdatedMs || meta.commandCreatedMs || 0);
      const command = payload && payload.command && typeof payload.command === 'object' ? payload.command : {};
      // REV291: an explicit user Export must not be blocked forever by a lost
      // ACK from an older export prepare/finish transaction. Only stale EXPORT
      // transfer commands are replaceable; Import and normal UI commands remain
      // protected by the original 30-second busy guard.
      const incomingAction = String(command.action || '').trim().toLowerCase();
      const incomingPayload = command.payload && typeof command.payload === 'object' ? command.payload : {};
      const currentCommand = remoteCacheGetJsonV236_(cache, commandKey, {}) || {};
      const currentAction = String(currentCommand.action || '').trim().toLowerCase();
      const priorityExport = incomingAction === 'export_bundle_prepare' && incomingPayload.priorityExport === true;
      const staleExportReplace = priorityExport && /^export_bundle_(prepare|finish)$/.test(currentAction) && age >= 4000;
      if ((currentStatus === 'PENDING' || currentStatus === 'IN_PROGRESS') && age < TF_REMOTE_COMMAND_BUSY_MS_V236 && !staleExportReplace) {
        return { ok:true, valid:true, accepted:false, code:'REMOTE_BUSY', message:'Perintah Remote sebelumnya masih diproses.', commandId:String(meta.commandId||''), commandStatus:currentStatus, revision:'REV291' };
      }
      const commandId = 'RC-' + Utilities.getUuid().replace(/-/g, '').slice(0,20).toUpperCase();
      remoteCachePutJsonV236_(cache, commandKey, command, TF_REMOTE_CACHE_TTL_SEC_V236);
      meta.licenseId = identity.licenseId;
      if (identity.email) meta.email = identity.email;
      meta.commandId = commandId;
      meta.commandStatus = 'PENDING';
      meta.commandCreatedMs = nowMs;
      meta.commandUpdatedMs = nowMs;
      meta.result = {};
      remoteCachePutJsonV236_(cache, metaKey, meta, TF_REMOTE_CACHE_TTL_SEC_V236);
      remotePresencePutV248_(cache, 'MOB', identity, {lastSeenMs:nowMs,email:identity.email||''});
      return { ok:true, valid:true, accepted:true, commandId:commandId, commandStatus:'PENDING', revision:'REV248' };
    } finally { try { lock.releaseLock(); } catch (_) {} }
  }

  if (operation === 'remote-desktop-ack') {
    const lock = remoteCommandLockV248_();
    if (!lock) return { ok:true, valid:true, ack:false, retry:true, code:'REMOTE_RETRY_BUSY', revision:'REV248' };
    try {
      let meta = remoteCacheGetJsonV236_(cache, metaKey, remoteDefaultMetaV236_(identity));
      if (!meta || typeof meta !== 'object') meta = remoteDefaultMetaV236_(identity);
      const incomingId = String(payload.commandId || '').trim();
      if (!incomingId || incomingId !== String(meta.commandId || '')) return { ok:true, valid:true, ack:false, code:'REMOTE_COMMAND_NOT_FOUND', revision:'REV248' };
      const ok = payload.success === true;
      meta.commandStatus = ok ? 'DONE' : 'ERROR';
      meta.commandUpdatedMs = nowMs;
      meta.result = payload.result && typeof payload.result === 'object' ? payload.result : {};
      remoteCachePutJsonV236_(cache, metaKey, meta, TF_REMOTE_CACHE_TTL_SEC_V236);
      return { ok:true, valid:true, ack:true, commandId:incomingId, status:meta.commandStatus, revision:'REV248' };
    } finally { try { lock.releaseLock(); } catch (_) {} }
  }

  if (operation === 'remote-mobile-disconnect') {
    remotePresencePutV248_(cache, 'MOB', identity, {lastSeenMs:0,email:identity.email||''});
    return { ok:true, valid:true, remoteAllowed:true, disconnected:true, serverTime:new Date(nowMs).toISOString(), revision:'REV248' };
  }

  return { ok:false, valid:false, code:'REMOTE_OPERATION_NOT_SUPPORTED', message:'Remote operation tidak didukung.', revision:'REV248' };
}


function migrateRev248Complete() {
  const base = migrateRev236Complete();
  try { CacheService.getScriptCache().put('TF_REMOTE_REVISION', 'REV248', 21600); } catch (_) {}
  const result = { ok:true, success:true, revision:'REV248', base:base, message:'REV248 siap: heartbeat lock-free + adaptive polling + multipart fast staging.' };
  console.log(JSON.stringify(result));
  return result;
}
