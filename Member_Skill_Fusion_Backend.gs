/**
 * SKILL FUSION — MEMBER AUTH BACKEND REV312
 * Standalone Google Apps Script Web App.
 *
 * Public actions (POST JSON/text):
 *   {action:'member_auth', command:'register'|'google_login'|'validate_session'|'heartbeat'|'logout', ...}
 * Admin actions:
 *   {action:'member_admin', command:'list_members'|'add_member'|'set_status'|'remove_member'|'send_status_email', adminKey:'...'}
 *
 * Run setupMemberSkillFusion() once. It creates the Google Sheet automatically
 * when SF_SPREADSHEET_ID is not yet configured.
 */

const SF_REV = 'REV312';
const SF_TZ = 'Asia/Jakarta';
const SF_MEMBER_SHEET = 'SF_Members';
const SF_SESSION_SHEET = 'SF_Sessions';
const SF_AUDIT_SHEET = 'SF_Audit';
const SF_SESSION_IDLE_MS = 10 * 60 * 1000; // requested: 10 minutes inactivity
const SF_ONLINE_MS = 90 * 1000;
const SF_OWNER_EMAIL_DEFAULT = 'wiliejonathan1999@gmail.com';
const SF_REDIRECT_DEFAULT = 'https://skillfusion.framer.website/Memberarea';
const SF_ADMIN_DEFAULT = 'https://wiliejonathan.github.io/tf-analyzer-admin/';

const SF_MEMBER_HEADERS = [
  'MEMBER_ID','EMAIL','NAME','PHOTO_URL','STATUS','ROLE','CREATED_AT','APPROVED_AT',
  'APPROVED_BY','LAST_LOGIN_AT','LAST_SEEN_AT','LAST_LOGOUT_AT','NOTES'
];
const SF_SESSION_HEADERS = [
  'SESSION_HASH','EMAIL','CREATED_AT','LAST_ACTIVITY_AT','EXPIRES_AT','ACTIVE','USER_AGENT'
];
const SF_AUDIT_HEADERS = ['TIMESTAMP','ACTOR','ACTION','TARGET','DETAILS'];

function doGet() {
  return sfJson_({
    success: true,
    ok: true,
    service: 'Skill Fusion Member Auth',
    version: SF_REV,
    serverTime: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw) return sfJson_({ success:false, ok:false, error:'EMPTY_BODY' });
    let body;
    try { body = JSON.parse(raw); }
    catch (_) { return sfJson_({ success:false, ok:false, error:'INVALID_JSON' }); }

    const action = String(body.action || '').trim().toLowerCase();
    if (action === 'member_auth') return sfJson_(sfHandleMemberAuth_(body));
    if (action === 'member_admin') return sfJson_(sfHandleMemberAdmin_(body));
    return sfJson_({ success:false, ok:false, error:'UNKNOWN_ACTION' });
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    return sfJson_({
      success:false, ok:false, error:'SERVER_ERROR',
      message: err && err.message ? err.message : String(err),
      serverTime:new Date().toISOString()
    });
  }
}

function setupMemberSkillFusion() {
  const props = PropertiesService.getScriptProperties();
  let ssId = String(props.getProperty('SF_SPREADSHEET_ID') || '').trim();
  let ss;

  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('Skill Fusion Members');
    ssId = ss.getId();
    props.setProperty('SF_SPREADSHEET_ID', ssId);
  }

  sfEnsureSheet_(ss, SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
  sfEnsureSheet_(ss, SF_SESSION_SHEET, SF_SESSION_HEADERS);
  sfEnsureSheet_(ss, SF_AUDIT_SHEET, SF_AUDIT_HEADERS);

  if (!props.getProperty('SF_OWNER_EMAIL')) props.setProperty('SF_OWNER_EMAIL', SF_OWNER_EMAIL_DEFAULT);
  if (!props.getProperty('SF_MEMBER_REDIRECT_URL')) props.setProperty('SF_MEMBER_REDIRECT_URL', SF_REDIRECT_DEFAULT);
  if (!props.getProperty('SF_ADMIN_DASHBOARD_URL')) props.setProperty('SF_ADMIN_DASHBOARD_URL', SF_ADMIN_DEFAULT);
  if (!props.getProperty('SF_LOGIN_PAGE_URL')) props.setProperty('SF_LOGIN_PAGE_URL', 'https://skillfusion.framer.website/');

  const result = {
    success: true,
    spreadsheetId: ssId,
    spreadsheetUrl: ss.getUrl(),
    requiredProperties: ['ADMIN_DASHBOARD_KEY','SF_GOOGLE_CLIENT_ID'],
    optionalProperties: ['SF_OWNER_EMAIL','SF_MEMBER_REDIRECT_URL','SF_ADMIN_DASHBOARD_URL','SF_LOGIN_PAGE_URL']
  };
  console.log(JSON.stringify(result));
  return result;
}

function sfHandleMemberAuth_(body) {
  const command = String(body.command || '').trim().toLowerCase();
  if (command === 'register') return sfRegister_(body);
  if (command === 'google_login') return sfGoogleLogin_(body);
  if (command === 'validate_session') return sfValidateSessionResponse_(body, false);
  if (command === 'heartbeat') return sfValidateSessionResponse_(body, true);
  if (command === 'logout') return sfLogout_(body);
  throw new Error('UNKNOWN_MEMBER_AUTH_COMMAND');
}

function sfHandleMemberAdmin_(body) {
  sfAssertAdmin_(body);
  const command = String(body.command || '').trim().toLowerCase();
  if (command === 'list_members') return sfAdminListMembers_();
  if (command === 'add_member') return sfAdminAddMember_(body);
  if (command === 'set_status') return sfAdminSetStatus_(body);
  if (command === 'remove_member') return sfAdminRemoveMember_(body);
  if (command === 'send_status_email') return sfAdminSendStatusEmail_(body);
  throw new Error('UNKNOWN_MEMBER_ADMIN_COMMAND');
}

function sfRegister_(body) {
  const google = sfVerifyGoogleCredential_(body.credential);
  const email = google.email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
    const found = sfFindMember_(sheet, email);
    if (found) {
      sfAudit_('PUBLIC:' + email, 'REGISTER_EXISTING', email, 'status=' + found.member.STATUS);
      return {
        success:true, ok:true, registered:true,
        status:String(found.member.STATUS || 'PENDING').toUpperCase(),
        message:sfStatusMessage_(found.member.STATUS)
      };
    }

    const now = new Date();
    const memberId = 'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase();
    const row = [
      memberId, email, google.name || '', google.picture || '', 'PENDING', 'MEMBER', now,
      '', '', '', '', '', String(body.notes || '').trim()
    ];
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    sfAudit_('PUBLIC:' + email, 'REGISTER', email, 'PENDING');
    sfSendOwnerRegistrationEmail_(email, google.name || '');
    return {
      success:true, ok:true, registered:true, status:'PENDING',
      message:'Registrasi berhasil. Akun menunggu persetujuan owner.'
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function sfGoogleLogin_(body) {
  const google = sfVerifyGoogleCredential_(body.credential);
  const email = google.email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const memberSheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
    const found = sfFindMember_(memberSheet, email);
    if (!found) {
      return { success:false, ok:false, code:'NOT_REGISTERED', status:'NOT_REGISTERED', message:'Email belum terdaftar. Silakan Register terlebih dahulu.' };
    }

    const status = String(found.member.STATUS || '').toUpperCase();
    if (status === 'PENDING') return { success:false, ok:false, code:'PENDING_APPROVAL', status:'PENDING', message:'Akun masih menunggu persetujuan owner.' };
    if (status === 'SUSPENDED') return { success:false, ok:false, code:'ACCOUNT_SUSPENDED', status:'SUSPENDED', message:'Akun sedang disuspend. Hubungi admin Skill Fusion.' };
    if (status !== 'ACTIVE') return { success:false, ok:false, code:'ACCOUNT_INACTIVE', status:status || 'INACTIVE', message:'Akun tidak aktif.' };

    const rawToken = sfNewToken_();
    const hash = sfHash_(rawToken);
    const now = new Date();
    const expires = new Date(now.getTime() + SF_SESSION_IDLE_MS);
    const sessionSheet = sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS);
    sfInvalidateSessionsForEmail_(sessionSheet, email);
    sessionSheet.appendRow([hash, email, now, now, expires, true, String(body.userAgent || '').slice(0,500)]);

    sfPatchMemberRow_(memberSheet, found.rowNumber, {
      NAME: google.name || found.member.NAME || '',
      PHOTO_URL: google.picture || found.member.PHOTO_URL || '',
      LAST_LOGIN_AT: now,
      LAST_SEEN_AT: now
    });
    SpreadsheetApp.flush();
    sfAudit_('PUBLIC:' + email, 'LOGIN', email, 'Google login');

    return {
      success:true, ok:true, authenticated:true,
      sessionToken:rawToken,
      expiresAt:expires.toISOString(),
      idleTimeoutSeconds:Math.floor(SF_SESSION_IDLE_MS / 1000),
      redirectUrl:sfProp_('SF_MEMBER_REDIRECT_URL', SF_REDIRECT_DEFAULT),
      member:{ email:email, name:google.name || found.member.NAME || '', photoUrl:google.picture || found.member.PHOTO_URL || '', status:'ACTIVE' }
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function sfValidateSessionResponse_(body, extend) {
  const token = String(body.sessionToken || '').trim();
  if (!token) return { success:false, ok:false, valid:false, code:'SESSION_REQUIRED' };
  const result = sfValidateSession_(token, Boolean(extend), String(body.userAgent || ''));
  if (!result.valid) return { success:false, ok:false, valid:false, code:result.code, message:result.message };
  return {
    success:true, ok:true, valid:true,
    expiresAt:result.expiresAt.toISOString(),
    idleTimeoutSeconds:Math.floor(SF_SESSION_IDLE_MS / 1000),
    member:result.member,
    redirectUrl:sfProp_('SF_MEMBER_REDIRECT_URL', SF_REDIRECT_DEFAULT)
  };
}

function sfLogout_(body) {
  const token = String(body.sessionToken || '').trim();
  if (!token) return { success:true, ok:true, loggedOut:true };
  const hash = sfHash_(token);
  const sessionSheet = sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS);
  const found = sfFindSession_(sessionSheet, hash);
  if (found) {
    const now = new Date();
    sfPatchRow_(sessionSheet, found.rowNumber, found.headers, { ACTIVE:false, EXPIRES_AT:now, LAST_ACTIVITY_AT:now });
    const memberSheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
    const member = sfFindMember_(memberSheet, found.session.EMAIL);
    if (member) sfPatchMemberRow_(memberSheet, member.rowNumber, { LAST_LOGOUT_AT:now, LAST_SEEN_AT:now });
    sfAudit_('PUBLIC:' + found.session.EMAIL, 'LOGOUT', found.session.EMAIL, 'User logout');
  }
  return { success:true, ok:true, loggedOut:true };
}

function sfValidateSession_(rawToken, extend, userAgent) {
  const hash = sfHash_(rawToken);
  const sessionSheet = sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS);
  const found = sfFindSession_(sessionSheet, hash);
  if (!found) return { valid:false, code:'SESSION_NOT_FOUND', message:'Sesi tidak ditemukan.' };

  const active = sfBool_(found.session.ACTIVE);
  const expiresAt = sfDate_(found.session.EXPIRES_AT);
  const now = new Date();
  if (!active || !expiresAt || expiresAt.getTime() <= now.getTime()) {
    if (active) sfPatchRow_(sessionSheet, found.rowNumber, found.headers, { ACTIVE:false });
    return { valid:false, code:'SESSION_EXPIRED', message:'Sesi berakhir. Silakan login kembali.' };
  }

  const memberSheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
  const memberFound = sfFindMember_(memberSheet, found.session.EMAIL);
  if (!memberFound || String(memberFound.member.STATUS || '').toUpperCase() !== 'ACTIVE') {
    sfPatchRow_(sessionSheet, found.rowNumber, found.headers, { ACTIVE:false, EXPIRES_AT:now });
    return { valid:false, code:'ACCOUNT_NOT_ACTIVE', message:'Akun tidak aktif.' };
  }

  let nextExpiry = expiresAt;
  if (extend) {
    nextExpiry = new Date(now.getTime() + SF_SESSION_IDLE_MS);
    sfPatchRow_(sessionSheet, found.rowNumber, found.headers, {
      LAST_ACTIVITY_AT:now,
      EXPIRES_AT:nextExpiry,
      USER_AGENT:userAgent ? userAgent.slice(0,500) : found.session.USER_AGENT
    });
    sfPatchMemberRow_(memberSheet, memberFound.rowNumber, { LAST_SEEN_AT:now });
  }

  return {
    valid:true,
    expiresAt:nextExpiry,
    member:{
      email:String(memberFound.member.EMAIL || ''),
      name:String(memberFound.member.NAME || ''),
      photoUrl:String(memberFound.member.PHOTO_URL || ''),
      status:'ACTIVE'
    }
  };
}

function sfAdminListMembers_() {
  sfExpireOldSessions_();
  const memberSheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
  const members = sfRows_(memberSheet);
  const sessionSheet = sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS);
  const sessions = sfRows_(sessionSheet);
  const now = Date.now();

  const online = {};
  sessions.forEach(function(s) {
    if (!sfBool_(s.ACTIVE)) return;
    const expires = sfDate_(s.EXPIRES_AT);
    const last = sfDate_(s.LAST_ACTIVITY_AT);
    if (!expires || expires.getTime() <= now || !last || now - last.getTime() > SF_ONLINE_MS) return;
    online[String(s.EMAIL || '').trim().toLowerCase()] = true;
  });

  const out = members.map(function(m) {
    const email = String(m.EMAIL || '').trim().toLowerCase();
    return {
      memberId:String(m.MEMBER_ID || ''), email:email, name:String(m.NAME || ''), photoUrl:String(m.PHOTO_URL || ''),
      status:String(m.STATUS || '').toUpperCase(), role:String(m.ROLE || 'MEMBER'), online:Boolean(online[email]),
      createdAt:sfIso_(m.CREATED_AT), approvedAt:sfIso_(m.APPROVED_AT), approvedBy:String(m.APPROVED_BY || ''),
      lastLoginAt:sfIso_(m.LAST_LOGIN_AT), lastSeenAt:sfIso_(m.LAST_SEEN_AT), lastLogoutAt:sfIso_(m.LAST_LOGOUT_AT),
      notes:String(m.NOTES || '')
    };
  }).sort(function(a,b) { return String(a.email).localeCompare(String(b.email)); });

  return { success:true, ok:true, members:out, count:out.length, onlineCount:out.filter(function(m){return m.online;}).length, serverTime:new Date().toISOString() };
}

function sfAdminAddMember_(body) {
  const email = sfEmail_(body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const status = sfAllowedStatus_(body.status || 'ACTIVE');
  const name = String(body.name || '').trim();
  const notes = String(body.notes || '').trim();
  const owner = sfOwnerEmail_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
    if (sfFindMember_(sheet, email)) throw new Error('MEMBER_ALREADY_EXISTS');
    const now = new Date();
    sheet.appendRow([
      'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(), email, name, '', status, 'MEMBER', now,
      status === 'ACTIVE' ? now : '', status === 'ACTIVE' ? owner : '', '', '', '', notes
    ]);
    SpreadsheetApp.flush();
    sfAudit_('ADMIN:' + owner, 'ADD_MEMBER', email, 'status=' + status);
    if (status === 'ACTIVE') sfSendMemberStatusEmail_(email, name, 'ACTIVE');
    return { success:true, ok:true, email:email, status:status };
  } finally { try { lock.releaseLock(); } catch (_) {} }
}

function sfAdminSetStatus_(body) {
  const email = sfEmail_(body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const status = sfAllowedStatus_(body.status);
  const owner = sfOwnerEmail_();
  const memberSheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
  const found = sfFindMember_(memberSheet, email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  const now = new Date();
  const patch = { STATUS:status };
  if (status === 'ACTIVE') { patch.APPROVED_AT = now; patch.APPROVED_BY = owner; }
  sfPatchMemberRow_(memberSheet, found.rowNumber, patch);
  if (status !== 'ACTIVE') sfInvalidateSessionsForEmail_(sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS), email);
  sfAudit_('ADMIN:' + owner, 'SET_STATUS', email, status);
  if (body.sendEmail === true || status === 'ACTIVE') sfSendMemberStatusEmail_(email, String(found.member.NAME || ''), status);
  return { success:true, ok:true, email:email, status:status };
}

function sfAdminRemoveMember_(body) {
  const email = sfEmail_(body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const owner = sfOwnerEmail_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const memberSheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
    const found = sfFindMember_(memberSheet, email);
    if (!found) throw new Error('MEMBER_NOT_FOUND');
    sfInvalidateSessionsForEmail_(sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS), email);
    memberSheet.deleteRow(found.rowNumber);
    SpreadsheetApp.flush();
    sfAudit_('ADMIN:' + owner, 'REMOVE_MEMBER', email, 'Deleted');
    return { success:true, ok:true, removed:true, email:email };
  } finally { try { lock.releaseLock(); } catch (_) {} }
}

function sfAdminSendStatusEmail_(body) {
  const email = sfEmail_(body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const sheet = sfSheet_(SF_MEMBER_SHEET, SF_MEMBER_HEADERS);
  const found = sfFindMember_(sheet, email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  sfSendMemberStatusEmail_(email, String(found.member.NAME || ''), String(found.member.STATUS || 'PENDING').toUpperCase());
  sfAudit_('ADMIN:' + sfOwnerEmail_(), 'SEND_STATUS_EMAIL', email, String(found.member.STATUS || ''));
  return { success:true, ok:true, sent:true, email:email };
}

function sfVerifyGoogleCredential_(credential) {
  const token = String(credential || '').trim();
  if (!token) throw new Error('GOOGLE_CREDENTIAL_REQUIRED');
  const clientId = sfProp_('SF_GOOGLE_CLIENT_ID', '');
  if (!clientId) throw new Error('SF_GOOGLE_CLIENT_ID_NOT_CONFIGURED');

  const cacheKey = 'sf_google_' + sfHash_(token).slice(0,24);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {
    method:'get', muteHttpExceptions:true, followRedirects:true
  });
  if (response.getResponseCode() !== 200) throw new Error('GOOGLE_TOKEN_INVALID');
  const data = JSON.parse(response.getContentText() || '{}');
  if (String(data.aud || '') !== clientId) throw new Error('GOOGLE_TOKEN_AUDIENCE_MISMATCH');
  if (String(data.email_verified || '').toLowerCase() !== 'true') throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  const iss = String(data.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') throw new Error('GOOGLE_TOKEN_ISSUER_INVALID');
  const email = sfEmail_(data.email);
  if (!email) throw new Error('GOOGLE_EMAIL_INVALID');
  const out = { email:email, name:String(data.name || ''), picture:String(data.picture || ''), sub:String(data.sub || '') };
  cache.put(cacheKey, JSON.stringify(out), 300);
  return out;
}

function sfAssertAdmin_(body) {
  const expected = sfProp_('ADMIN_DASHBOARD_KEY', '');
  const received = String(body && body.adminKey || '').trim();
  if (!expected) throw new Error('ADMIN_DASHBOARD_KEY_NOT_CONFIGURED');
  if (!received || !sfConstantTimeEqual_(received, expected)) throw new Error('ADMIN_UNAUTHORIZED');
  return true;
}

function sfOwnerEmail_() { return sfProp_('SF_OWNER_EMAIL', SF_OWNER_EMAIL_DEFAULT); }

function sfSendOwnerRegistrationEmail_(email, name) {
  const owner = sfOwnerEmail_();
  const adminUrl = sfProp_('SF_ADMIN_DASHBOARD_URL', SF_ADMIN_DEFAULT);
  const subject = '[Skill Fusion] Registrasi member baru menunggu approval';
  const body = [
    'Registrasi member baru:', '',
    'Nama: ' + (name || '-'),
    'Email: ' + email,
    'Status: PENDING', '',
    'Buka dashboard untuk Aktifkan / Suspend / Remove:', adminUrl
  ].join('\n');
  MailApp.sendEmail({ to:owner, subject:subject, body:body, name:'Skill Fusion Member System' });
}

function sfSendMemberStatusEmail_(email, name, status) {
  const loginUrl = sfProp_('SF_LOGIN_PAGE_URL', 'https://skillfusion.framer.website/');
  let subject = '[Skill Fusion] Status akun member';
  let message = 'Status akun Anda: ' + status;
  if (status === 'ACTIVE') {
    subject = '[Skill Fusion] Akun Anda sudah aktif';
    message = 'Akun Skill Fusion Anda sudah diaktifkan. Silakan login menggunakan Google Account yang sama.';
  } else if (status === 'SUSPENDED') {
    subject = '[Skill Fusion] Akses akun disuspend';
    message = 'Akses akun Skill Fusion Anda sedang disuspend. Hubungi admin jika membutuhkan bantuan.';
  } else if (status === 'PENDING') {
    message = 'Registrasi Anda masih menunggu persetujuan owner.';
  }
  const body = ['Halo ' + (name || 'Member') + ',', '', message, '', 'Login: ' + loginUrl, '', 'Skill Fusion'].join('\n');
  MailApp.sendEmail({ to:email, subject:subject, body:body, name:'Skill Fusion' });
}

function sfStatusMessage_(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'ACTIVE') return 'Akun sudah aktif. Silakan Login.';
  if (s === 'SUSPENDED') return 'Akun sedang disuspend.';
  return 'Akun menunggu persetujuan owner.';
}

function sfExpireOldSessions_() {
  const sheet = sfSheet_(SF_SESSION_SHEET, SF_SESSION_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfHeaderMap_(headers);
  const now = Date.now();
  for (let r = 1; r < data.length; r++) {
    if (!sfBool_(data[r][map.ACTIVE])) continue;
    const exp = sfDate_(data[r][map.EXPIRES_AT]);
    if (!exp || exp.getTime() <= now) sheet.getRange(r + 1, map.ACTIVE + 1).setValue(false);
  }
}

function sfInvalidateSessionsForEmail_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfHeaderMap_(headers);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][map.EMAIL] || '').trim().toLowerCase() === email) {
      sheet.getRange(r + 1, map.ACTIVE + 1).setValue(false);
    }
  }
}

function sfFindSession_(sheet, hash) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfHeaderMap_(headers);
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][map.SESSION_HASH] || '') === hash) {
      return { rowNumber:r + 1, headers:headers, session:sfObjectFromRow_(headers, data[r]) };
    }
  }
  return null;
}

function sfFindMember_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfHeaderMap_(headers);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][map.EMAIL] || '').trim().toLowerCase() === email) {
      return { rowNumber:r + 1, headers:headers, member:sfObjectFromRow_(headers, data[r]) };
    }
  }
  return null;
}

function sfPatchMemberRow_(sheet, rowNumber, patch) {
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(function(v){ return String(v || '').trim(); });
  sfPatchRow_(sheet, rowNumber, headers, patch);
}

function sfPatchRow_(sheet, rowNumber, headers, patch) {
  const map = sfHeaderMap_(headers);
  Object.keys(patch || {}).forEach(function(key) {
    if (map[key] === undefined) return;
    sheet.getRange(rowNumber, map[key] + 1).setValue(patch[key]);
  });
}

function sfRows_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const obj = sfObjectFromRow_(headers, data[r]);
    if (Object.keys(obj).some(function(k){ return String(obj[k] == null ? '' : obj[k]).trim() !== ''; })) out.push(obj);
  }
  return out;
}

function sfObjectFromRow_(headers, row) {
  const obj = {};
  headers.forEach(function(h,i){ if (h) obj[h] = row[i]; });
  return obj;
}

function sfSheet_(name, headers) {
  const id = sfProp_('SF_SPREADSHEET_ID', '');
  if (!id) throw new Error('SF_SPREADSHEET_ID_NOT_CONFIGURED_RUN_SETUP');
  const ss = SpreadsheetApp.openById(id);
  return sfEnsureSheet_(ss, name, headers);
}

function sfEnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,headers.length).setFontWeight('bold');
  } else {
    const current = sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getDisplayValues()[0].map(function(v){ return String(v || '').trim(); });
    const existing = {};
    current.forEach(function(h){ if(h) existing[h] = true; });
    headers.forEach(function(h){
      if (!existing[h]) {
        const col = sheet.getLastColumn() + 1;
        sheet.getRange(1,col).setValue(h).setFontWeight('bold');
        existing[h] = true;
      }
    });
  }
  return sheet;
}

function sfAudit_(actor, action, target, details) {
  try {
    const sheet = sfSheet_(SF_AUDIT_SHEET, SF_AUDIT_HEADERS);
    sheet.appendRow([new Date(), actor, action, target, details || '']);
  } catch (err) { console.error('AUDIT_FAIL ' + err); }
}

function sfNewToken_() {
  return [Utilities.getUuid(), Utilities.getUuid(), Date.now().toString(36)].join('.').replace(/-/g,'');
}

function sfHash_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return digest.map(function(b){ const n = (b + 256) % 256; return ('0' + n.toString(16)).slice(-2); }).join('');
}

function sfConstantTimeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function sfHeaderMap_(headers) {
  const map = {};
  headers.forEach(function(h,i){ if (h && map[h] === undefined) map[h] = i; });
  return map;
}

function sfEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sfAllowedStatus_(value) {
  const s = String(value || '').trim().toUpperCase();
  if (['PENDING','ACTIVE','SUSPENDED'].indexOf(s) < 0) throw new Error('INVALID_MEMBER_STATUS');
  return s;
}

function sfBool_(value) {
  if (value === true) return true;
  const s = String(value || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'active';
}

function sfDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function sfIso_(value) {
  const d = sfDate_(value);
  return d ? d.toISOString() : '';
}

function sfProp_(name, fallback) {
  const value = String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  return value || String(fallback || '');
}

function sfJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
