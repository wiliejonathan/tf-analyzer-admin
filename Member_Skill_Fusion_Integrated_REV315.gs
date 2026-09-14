/**
 * SKILL FUSION MEMBER — INTEGRATED MODULE REV315
 *
 * Designed to be added as a NEW .gs file inside the EXISTING TF Analyzer
 * Apps Script project. It intentionally DOES NOT declare doGet()/doPost().
 * The existing /exec URL stays the same.
 *
 * Add these 2 routes inside the existing doPost(), after requestAction is read:
 *
 *   if (requestAction === 'member_auth') {
 *     return jsonResponse_(sfiHandleMemberAuthREV315_(body));
 *   }
 *   if (requestAction === 'member_admin') {
 *     return jsonResponse_(sfiHandleMemberAdminREV315_(body));
 *   }
 *
 * Then run setupMemberSkillFusionREV315() once and update/redeploy the Web App.
 *
 * AUTO-ACTIVE RULE:
 * - Any Google email that EXISTS in the existing Licenses sheet is automatically
 *   provisioned/activated as a Skill Fusion member.
 * - Manual SUSPENDED always wins and is NEVER auto-reactivated.
 * - Manual Remove adds the email to SF_Blocked so auto-sync cannot recreate it.
 */

const SFI_REV315 = 'REV315';
const SFI_MEMBER_SHEET = 'SF_Members';
const SFI_SESSION_SHEET = 'SF_Sessions';
const SFI_AUDIT_SHEET = 'SF_Audit';
const SFI_BLOCKED_SHEET = 'SF_Blocked';
const SFI_LICENSE_SHEET = 'Licenses';
const SFI_IDLE_MS = 10 * 60 * 1000;
const SFI_ONLINE_MS = 90 * 1000;
const SFI_GOOGLE_CLIENT_ID_DEFAULT = '115969098046-alnc03479m380nhjk9n0fqtqhboa0081.apps.googleusercontent.com';
const SFI_OWNER_EMAIL_DEFAULT = 'wiliejonathan1999@gmail.com';
const SFI_REDIRECT_DEFAULT = 'https://skillfusion.framer.website/Memberarea';
const SFI_ADMIN_DEFAULT = 'https://wiliejonathan.github.io/tf-analyzer-admin/';

const SFI_MEMBER_HEADERS = [
  'MEMBER_ID','EMAIL','NAME','PHOTO_URL','STATUS','ROLE','CREATED_AT','APPROVED_AT',
  'APPROVED_BY','LAST_LOGIN_AT','LAST_SEEN_AT','LAST_LOGOUT_AT','NOTES'
];
const SFI_SESSION_HEADERS = [
  'SESSION_HASH','EMAIL','CREATED_AT','LAST_ACTIVITY_AT','EXPIRES_AT','ACTIVE','USER_AGENT'
];
const SFI_AUDIT_HEADERS = ['TIMESTAMP','ACTOR','ACTION','TARGET','DETAILS'];
const SFI_BLOCKED_HEADERS = ['EMAIL','BLOCKED_AT','BLOCKED_BY','REASON'];

function setupMemberSkillFusionREV315() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');

  const ss = SpreadsheetApp.openById(spreadsheetId);
  sfiEnsureSheetREV315_(ss, SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  sfiEnsureSheetREV315_(ss, SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  sfiEnsureSheetREV315_(ss, SFI_AUDIT_SHEET, SFI_AUDIT_HEADERS);
  sfiEnsureSheetREV315_(ss, SFI_BLOCKED_SHEET, SFI_BLOCKED_HEADERS);

  if (!props.getProperty('SF_GOOGLE_CLIENT_ID')) {
    props.setProperty('SF_GOOGLE_CLIENT_ID', SFI_GOOGLE_CLIENT_ID_DEFAULT);
  }
  if (!props.getProperty('SF_OWNER_EMAIL')) {
    props.setProperty('SF_OWNER_EMAIL', SFI_OWNER_EMAIL_DEFAULT);
  }
  if (!props.getProperty('SF_MEMBER_REDIRECT_URL')) {
    props.setProperty('SF_MEMBER_REDIRECT_URL', SFI_REDIRECT_DEFAULT);
  }
  if (!props.getProperty('SF_ADMIN_DASHBOARD_URL')) {
    props.setProperty('SF_ADMIN_DASHBOARD_URL', SFI_ADMIN_DEFAULT);
  }
  if (!props.getProperty('SF_LOGIN_PAGE_URL')) {
    props.setProperty('SF_LOGIN_PAGE_URL', 'https://skillfusion.framer.website/');
  }

  const sync = sfiSyncLicenseMembersREV315_();
  const result = {
    success: true,
    ok: true,
    version: SFI_REV315,
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: ss.getUrl(),
    autoActivatedFromLicenseDb: sync.activated,
    alreadyActive: sync.alreadyActive,
    suspendedPreserved: sync.suspendedPreserved,
    blockedSkipped: sync.blockedSkipped,
    licenseEmailsFound: sync.licenseEmailsFound
  };
  console.log(JSON.stringify(result));
  return result;
}

function sfiHandleMemberAuthREV315_(body) {
  const command = String(body && body.command || '').trim().toLowerCase();
  if (command === 'register') return sfiRegisterREV315_(body);
  if (command === 'google_login') return sfiGoogleLoginREV315_(body);
  if (command === 'validate_session') return sfiValidateSessionResponseREV315_(body, false);
  if (command === 'heartbeat') return sfiValidateSessionResponseREV315_(body, true);
  if (command === 'logout') return sfiLogoutREV315_(body);
  throw new Error('UNKNOWN_MEMBER_AUTH_COMMAND');
}

function sfiHandleMemberAdminREV315_(body) {
  sfiAssertAdminREV315_(body);
  const command = String(body && body.command || '').trim().toLowerCase();
  if (command === 'list_members') return sfiAdminListMembersREV315_();
  if (command === 'add_member') return sfiAdminAddMemberREV315_(body);
  if (command === 'set_status') return sfiAdminSetStatusREV315_(body);
  if (command === 'remove_member') return sfiAdminRemoveMemberREV315_(body);
  if (command === 'send_status_email') return sfiAdminSendStatusEmailREV315_(body);
  if (command === 'sync_license_members') return Object.assign({ success:true, ok:true }, sfiSyncLicenseMembersREV315_());
  throw new Error('UNKNOWN_MEMBER_ADMIN_COMMAND');
}

function sfiRegisterREV315_(body) {
  const google = sfiVerifyGoogleCredentialREV315_(body && body.credential);
  const email = google.email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (sfiIsBlockedREV315_(email)) {
      return { success:false, ok:false, code:'MEMBER_REMOVED', status:'REMOVED', message:'Akses member untuk email ini telah dihapus oleh owner.' };
    }

    const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
    let found = sfiFindMemberREV315_(memberSheet, email);
    const license = sfiFindLicenseREV315_(email);
    const now = new Date();

    if (found) {
      let status = String(found.member.STATUS || 'PENDING').toUpperCase();
      if (status === 'SUSPENDED') {
        return { success:true, ok:true, registered:true, status:'SUSPENDED', message:'Akun sedang disuspend.' };
      }
      if (license && status !== 'ACTIVE') {
        sfiPatchMemberREV315_(memberSheet, found.rowNumber, {
          STATUS:'ACTIVE', APPROVED_AT:now, APPROVED_BY:'AUTO:TF_LICENSE_DB',
          NAME:google.name || found.member.NAME || '', PHOTO_URL:google.picture || found.member.PHOTO_URL || '',
          NOTES:sfiMergeNoteREV315_(found.member.NOTES, 'Auto-active: TF Analyzer License Database')
        });
        status = 'ACTIVE';
        sfiAuditREV315_('AUTO:TF_LICENSE_DB', 'AUTO_ACTIVATE_EXISTING', email, sfiLicenseDetailREV315_(license));
      }
      return { success:true, ok:true, registered:true, status:status, autoActivated:Boolean(license && status === 'ACTIVE'), message:sfiStatusMessageREV315_(status) };
    }

    const status = license ? 'ACTIVE' : 'PENDING';
    memberSheet.appendRow([
      'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(),
      email, google.name || '', google.picture || '', status, 'MEMBER', now,
      status === 'ACTIVE' ? now : '', status === 'ACTIVE' ? 'AUTO:TF_LICENSE_DB' : '',
      '', '', '',
      license ? 'Auto-active: TF Analyzer License Database' : String(body && body.notes || '').trim()
    ]);
    SpreadsheetApp.flush();

    if (license) {
      sfiAuditREV315_('AUTO:TF_LICENSE_DB', 'REGISTER_AUTO_ACTIVE', email, sfiLicenseDetailREV315_(license));
    } else {
      sfiAuditREV315_('PUBLIC:' + email, 'REGISTER_PENDING', email, 'Not found in TF license database');
      sfiSendOwnerRegistrationEmailREV315_(email, google.name || '');
    }

    return {
      success:true, ok:true, registered:true, status:status, autoActivated:Boolean(license),
      message:license ? 'Email ditemukan di TF Analyzer License Database. Akun Skill Fusion otomatis aktif.' : 'Registrasi berhasil. Akun menunggu persetujuan owner.'
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function sfiGoogleLoginREV315_(body) {
  const google = sfiVerifyGoogleCredentialREV315_(body && body.credential);
  const email = google.email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (sfiIsBlockedREV315_(email)) {
      return { success:false, ok:false, code:'MEMBER_REMOVED', status:'REMOVED', message:'Akses member untuk email ini telah dihapus oleh owner.' };
    }

    const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
    let found = sfiFindMemberREV315_(memberSheet, email);
    const license = sfiFindLicenseREV315_(email);
    const now = new Date();

    if (!found && license) {
      memberSheet.appendRow([
        'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(),
        email, google.name || '', google.picture || '', 'ACTIVE', 'MEMBER', now,
        now, 'AUTO:TF_LICENSE_DB', '', '', '', 'Auto-active: TF Analyzer License Database'
      ]);
      SpreadsheetApp.flush();
      found = sfiFindMemberREV315_(memberSheet, email);
      sfiAuditREV315_('AUTO:TF_LICENSE_DB', 'LOGIN_AUTO_PROVISION', email, sfiLicenseDetailREV315_(license));
    }

    if (!found) {
      return { success:false, ok:false, code:'NOT_REGISTERED', status:'NOT_REGISTERED', message:'Email belum terdaftar. Silakan Register terlebih dahulu.' };
    }

    let status = String(found.member.STATUS || '').toUpperCase();
    if (status === 'SUSPENDED') {
      return { success:false, ok:false, code:'ACCOUNT_SUSPENDED', status:'SUSPENDED', message:'Akun sedang disuspend. Hubungi admin Skill Fusion.' };
    }

    if (status === 'PENDING' && license) {
      sfiPatchMemberREV315_(memberSheet, found.rowNumber, {
        STATUS:'ACTIVE', APPROVED_AT:now, APPROVED_BY:'AUTO:TF_LICENSE_DB',
        NAME:google.name || found.member.NAME || '', PHOTO_URL:google.picture || found.member.PHOTO_URL || '',
        NOTES:sfiMergeNoteREV315_(found.member.NOTES, 'Auto-active: TF Analyzer License Database')
      });
      status = 'ACTIVE';
      found = sfiFindMemberREV315_(memberSheet, email);
      sfiAuditREV315_('AUTO:TF_LICENSE_DB', 'PENDING_AUTO_ACTIVATE_ON_LOGIN', email, sfiLicenseDetailREV315_(license));
    }

    if (status === 'PENDING') {
      return { success:false, ok:false, code:'PENDING_APPROVAL', status:'PENDING', message:'Akun masih menunggu persetujuan owner.' };
    }
    if (status !== 'ACTIVE') {
      return { success:false, ok:false, code:'ACCOUNT_INACTIVE', status:status || 'INACTIVE', message:'Akun tidak aktif.' };
    }

    const rawToken = sfiNewTokenREV315_();
    const hash = sfiHashREV315_(rawToken);
    const expires = new Date(now.getTime() + SFI_IDLE_MS);
    const sessionSheet = sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
    sfiInvalidateSessionsREV315_(sessionSheet, email);
    sessionSheet.appendRow([hash, email, now, now, expires, true, String(body && body.userAgent || '').slice(0,500)]);

    sfiPatchMemberREV315_(memberSheet, found.rowNumber, {
      NAME:google.name || found.member.NAME || '',
      PHOTO_URL:google.picture || found.member.PHOTO_URL || '',
      LAST_LOGIN_AT:now,
      LAST_SEEN_AT:now
    });
    SpreadsheetApp.flush();
    sfiAuditREV315_('PUBLIC:' + email, 'LOGIN', email, license ? 'TF license client' : 'Approved member');

    return {
      success:true, ok:true, authenticated:true,
      sessionToken:rawToken,
      expiresAt:expires.toISOString(),
      idleTimeoutSeconds:Math.floor(SFI_IDLE_MS / 1000),
      redirectUrl:sfiPropREV315_('SF_MEMBER_REDIRECT_URL', SFI_REDIRECT_DEFAULT),
      autoActivatedFromLicenseDb:Boolean(license),
      member:{ email:email, name:google.name || found.member.NAME || '', photoUrl:google.picture || found.member.PHOTO_URL || '', status:'ACTIVE' }
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function sfiValidateSessionResponseREV315_(body, extend) {
  const token = String(body && body.sessionToken || '').trim();
  if (!token) return { success:false, ok:false, valid:false, code:'SESSION_REQUIRED' };
  const result = sfiValidateSessionREV315_(token, Boolean(extend), String(body && body.userAgent || ''));
  if (!result.valid) return { success:false, ok:false, valid:false, code:result.code, message:result.message };
  return {
    success:true, ok:true, valid:true,
    expiresAt:result.expiresAt.toISOString(),
    idleTimeoutSeconds:Math.floor(SFI_IDLE_MS / 1000),
    member:result.member,
    redirectUrl:sfiPropREV315_('SF_MEMBER_REDIRECT_URL', SFI_REDIRECT_DEFAULT)
  };
}

function sfiValidateSessionREV315_(rawToken, extend, userAgent) {
  const sessionSheet = sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  const found = sfiFindSessionREV315_(sessionSheet, sfiHashREV315_(rawToken));
  if (!found) return { valid:false, code:'SESSION_NOT_FOUND', message:'Sesi tidak ditemukan.' };

  const now = new Date();
  const expiresAt = sfiDateREV315_(found.session.EXPIRES_AT);
  if (!sfiBoolREV315_(found.session.ACTIVE) || !expiresAt || expiresAt.getTime() <= now.getTime()) {
    sfiPatchRowREV315_(sessionSheet, found.rowNumber, found.headers, { ACTIVE:false });
    return { valid:false, code:'SESSION_EXPIRED', message:'Sesi berakhir. Silakan login kembali.' };
  }

  const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const memberFound = sfiFindMemberREV315_(memberSheet, found.session.EMAIL);
  if (!memberFound || String(memberFound.member.STATUS || '').toUpperCase() !== 'ACTIVE') {
    sfiPatchRowREV315_(sessionSheet, found.rowNumber, found.headers, { ACTIVE:false, EXPIRES_AT:now });
    return { valid:false, code:'ACCOUNT_NOT_ACTIVE', message:'Akun tidak aktif.' };
  }

  let nextExpiry = expiresAt;
  if (extend) {
    nextExpiry = new Date(now.getTime() + SFI_IDLE_MS);
    sfiPatchRowREV315_(sessionSheet, found.rowNumber, found.headers, {
      LAST_ACTIVITY_AT:now, EXPIRES_AT:nextExpiry,
      USER_AGENT:userAgent ? userAgent.slice(0,500) : found.session.USER_AGENT
    });
    sfiPatchMemberREV315_(memberSheet, memberFound.rowNumber, { LAST_SEEN_AT:now });
  }

  return {
    valid:true,
    expiresAt:nextExpiry,
    member:{
      email:String(memberFound.member.EMAIL || ''), name:String(memberFound.member.NAME || ''),
      photoUrl:String(memberFound.member.PHOTO_URL || ''), status:'ACTIVE'
    }
  };
}

function sfiLogoutREV315_(body) {
  const token = String(body && body.sessionToken || '').trim();
  if (!token) return { success:true, ok:true, loggedOut:true };
  const sessionSheet = sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  const found = sfiFindSessionREV315_(sessionSheet, sfiHashREV315_(token));
  if (found) {
    const now = new Date();
    sfiPatchRowREV315_(sessionSheet, found.rowNumber, found.headers, { ACTIVE:false, EXPIRES_AT:now, LAST_ACTIVITY_AT:now });
    const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
    const member = sfiFindMemberREV315_(memberSheet, found.session.EMAIL);
    if (member) sfiPatchMemberREV315_(memberSheet, member.rowNumber, { LAST_LOGOUT_AT:now, LAST_SEEN_AT:now });
    sfiAuditREV315_('PUBLIC:' + found.session.EMAIL, 'LOGOUT', found.session.EMAIL, 'User logout');
  }
  return { success:true, ok:true, loggedOut:true };
}

function sfiAdminListMembersREV315_() {
  const sync = sfiSyncLicenseMembersREV315_();
  sfiExpireSessionsREV315_();
  const members = sfiRowsREV315_(sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS));
  const sessions = sfiRowsREV315_(sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS));
  const now = Date.now();
  const online = {};

  sessions.forEach(function(s) {
    if (!sfiBoolREV315_(s.ACTIVE)) return;
    const exp = sfiDateREV315_(s.EXPIRES_AT);
    const last = sfiDateREV315_(s.LAST_ACTIVITY_AT);
    if (!exp || exp.getTime() <= now || !last || now - last.getTime() > SFI_ONLINE_MS) return;
    online[String(s.EMAIL || '').trim().toLowerCase()] = true;
  });

  const out = members.map(function(m) {
    const email = String(m.EMAIL || '').trim().toLowerCase();
    return {
      memberId:String(m.MEMBER_ID || ''), email:email, name:String(m.NAME || ''), photoUrl:String(m.PHOTO_URL || ''),
      status:String(m.STATUS || '').toUpperCase(), role:String(m.ROLE || 'MEMBER'), online:Boolean(online[email]),
      createdAt:sfiIsoREV315_(m.CREATED_AT), approvedAt:sfiIsoREV315_(m.APPROVED_AT), approvedBy:String(m.APPROVED_BY || ''),
      lastLoginAt:sfiIsoREV315_(m.LAST_LOGIN_AT), lastSeenAt:sfiIsoREV315_(m.LAST_SEEN_AT), lastLogoutAt:sfiIsoREV315_(m.LAST_LOGOUT_AT),
      notes:String(m.NOTES || '')
    };
  }).sort(function(a,b){ return String(a.email).localeCompare(String(b.email)); });

  return {
    success:true, ok:true, members:out, count:out.length,
    onlineCount:out.filter(function(m){ return m.online; }).length,
    licenseSync:sync,
    serverTime:new Date().toISOString()
  };
}

function sfiAdminAddMemberREV315_(body) {
  const email = sfiEmailREV315_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const status = sfiAllowedStatusREV315_(body && body.status || 'ACTIVE');
  const name = String(body && body.name || '').trim();
  const notes = String(body && body.notes || '').trim();
  const owner = sfiOwnerEmailREV315_();
  const sheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  if (sfiFindMemberREV315_(sheet, email)) throw new Error('MEMBER_ALREADY_EXISTS');
  sfiUnblockREV315_(email);
  const now = new Date();
  sheet.appendRow([
    'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(), email, name, '', status, 'MEMBER', now,
    status === 'ACTIVE' ? now : '', status === 'ACTIVE' ? owner : '', '', '', '', notes
  ]);
  SpreadsheetApp.flush();
  sfiAuditREV315_('ADMIN:' + owner, 'ADD_MEMBER', email, 'status=' + status);
  if (status === 'ACTIVE') sfiSafeStatusEmailREV315_(email, name, status);
  return { success:true, ok:true, email:email, status:status };
}

function sfiAdminSetStatusREV315_(body) {
  const email = sfiEmailREV315_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const status = sfiAllowedStatusREV315_(body && body.status);
  const owner = sfiOwnerEmailREV315_();
  const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const found = sfiFindMemberREV315_(memberSheet, email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  const now = new Date();
  const patch = { STATUS:status };
  if (status === 'ACTIVE') {
    patch.APPROVED_AT = now;
    patch.APPROVED_BY = owner;
    sfiUnblockREV315_(email);
  }
  sfiPatchMemberREV315_(memberSheet, found.rowNumber, patch);
  if (status !== 'ACTIVE') sfiInvalidateSessionsREV315_(sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS), email);
  sfiAuditREV315_('ADMIN:' + owner, 'SET_STATUS', email, status);
  if (body && (body.sendEmail === true || status === 'ACTIVE')) sfiSafeStatusEmailREV315_(email, String(found.member.NAME || ''), status);
  return { success:true, ok:true, email:email, status:status };
}

function sfiAdminRemoveMemberREV315_(body) {
  const email = sfiEmailREV315_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const owner = sfiOwnerEmailREV315_();
  const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const found = sfiFindMemberREV315_(memberSheet, email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  sfiInvalidateSessionsREV315_(sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS), email);
  sfiBlockREV315_(email, owner, 'Removed from Member Skill Fusion');
  memberSheet.deleteRow(found.rowNumber);
  SpreadsheetApp.flush();
  sfiAuditREV315_('ADMIN:' + owner, 'REMOVE_MEMBER', email, 'Deleted + auto-sync blocked');
  return { success:true, ok:true, removed:true, email:email };
}

function sfiAdminSendStatusEmailREV315_(body) {
  const email = sfiEmailREV315_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const found = sfiFindMemberREV315_(sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS), email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  sfiSendMemberStatusEmailREV315_(email, String(found.member.NAME || ''), String(found.member.STATUS || 'PENDING').toUpperCase());
  sfiAuditREV315_('ADMIN:' + sfiOwnerEmailREV315_(), 'SEND_STATUS_EMAIL', email, String(found.member.STATUS || ''));
  return { success:true, ok:true, sent:true, email:email };
}

function sfiSyncLicenseMembersREV315_() {
  const ss = sfiMainSpreadsheetREV315_();
  const licenseSheet = ss.getSheetByName(SFI_LICENSE_SHEET);
  if (!licenseSheet) throw new Error('LICENSE_SHEET_NOT_FOUND');
  const data = licenseSheet.getDataRange().getValues();
  if (data.length < 2) return { licenseEmailsFound:0, activated:0, alreadyActive:0, suspendedPreserved:0, blockedSkipped:0 };

  const headers = data[0].map(function(v){ return String(v || '').trim().toUpperCase(); });
  const emailCol = headers.indexOf('EMAIL');
  if (emailCol < 0) throw new Error('LICENSE_EMAIL_HEADER_NOT_FOUND');

  const memberSheet = sfiSheetREV315_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const now = new Date();
  const seen = {};
  let activated = 0, alreadyActive = 0, suspendedPreserved = 0, blockedSkipped = 0;

  for (let r = 1; r < data.length; r++) {
    const email = sfiEmailREV315_(data[r][emailCol]);
    if (!email || seen[email]) continue;
    seen[email] = true;
    if (sfiIsBlockedREV315_(email)) { blockedSkipped++; continue; }

    const found = sfiFindMemberREV315_(memberSheet, email);
    if (!found) {
      memberSheet.appendRow([
        'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(), email, '', '', 'ACTIVE', 'MEMBER', now,
        now, 'AUTO:TF_LICENSE_DB', '', '', '', 'Auto-active: TF Analyzer License Database'
      ]);
      activated++;
      continue;
    }

    const status = String(found.member.STATUS || '').toUpperCase();
    if (status === 'SUSPENDED') { suspendedPreserved++; continue; }
    if (status === 'ACTIVE') { alreadyActive++; continue; }

    sfiPatchMemberREV315_(memberSheet, found.rowNumber, {
      STATUS:'ACTIVE', APPROVED_AT:now, APPROVED_BY:'AUTO:TF_LICENSE_DB',
      NOTES:sfiMergeNoteREV315_(found.member.NOTES, 'Auto-active: TF Analyzer License Database')
    });
    activated++;
  }

  SpreadsheetApp.flush();
  if (activated > 0) sfiAuditREV315_('AUTO:TF_LICENSE_DB', 'SYNC_LICENSE_MEMBERS', '*', 'activated=' + activated);
  return {
    licenseEmailsFound:Object.keys(seen).length,
    activated:activated,
    alreadyActive:alreadyActive,
    suspendedPreserved:suspendedPreserved,
    blockedSkipped:blockedSkipped
  };
}

function sfiFindLicenseREV315_(email) {
  const ss = sfiMainSpreadsheetREV315_();
  const sheet = ss.getSheetByName(SFI_LICENSE_SHEET);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim().toUpperCase(); });
  const map = {};
  headers.forEach(function(h,i){ if (h && map[h] === undefined) map[h] = i; });
  if (map.EMAIL === undefined) return null;
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV315_(data[r][map.EMAIL]) === email) {
      return {
        rowNumber:r + 1,
        email:email,
        licenseId:map.LICENSE_ID === undefined ? '' : String(data[r][map.LICENSE_ID] || '').trim(),
        plan:map.PLAN === undefined ? '' : String(data[r][map.PLAN] || '').trim(),
        status:map.STATUS === undefined ? '' : String(data[r][map.STATUS] || '').trim()
      };
    }
  }
  return null;
}

function sfiVerifyGoogleCredentialREV315_(credential) {
  const token = String(credential || '').trim();
  if (!token) throw new Error('GOOGLE_CREDENTIAL_REQUIRED');
  const clientId = sfiPropREV315_('SF_GOOGLE_CLIENT_ID', SFI_GOOGLE_CLIENT_ID_DEFAULT);
  const cacheKey = 'sfi315_google_' + sfiHashREV315_(token).slice(0,24);
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
  const email = sfiEmailREV315_(data.email);
  if (!email) throw new Error('GOOGLE_EMAIL_INVALID');
  const out = { email:email, name:String(data.name || ''), picture:String(data.picture || ''), sub:String(data.sub || '') };
  cache.put(cacheKey, JSON.stringify(out), 300);
  return out;
}

function sfiAssertAdminREV315_(body) {
  const expected = sfiPropREV315_('ADMIN_DASHBOARD_KEY', '');
  const received = String(body && body.adminKey || '').trim();
  if (!expected) throw new Error('ADMIN_DASHBOARD_KEY_NOT_CONFIGURED');
  if (!received || !sfiConstantTimeEqualREV315_(received, expected)) throw new Error('ADMIN_UNAUTHORIZED');
  return true;
}

function sfiBlockREV315_(email, actor, reason) {
  const sheet = sfiSheetREV315_(SFI_BLOCKED_SHEET, SFI_BLOCKED_HEADERS);
  const data = sheet.getDataRange().getValues();
  const map = data.length ? sfiHeaderMapREV315_(data[0]) : {};
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV315_(data[r][map.EMAIL]) === email) {
      sheet.getRange(r + 1, map.BLOCKED_AT + 1).setValue(new Date());
      sheet.getRange(r + 1, map.BLOCKED_BY + 1).setValue(actor || 'ADMIN');
      sheet.getRange(r + 1, map.REASON + 1).setValue(reason || 'Removed');
      return;
    }
  }
  sheet.appendRow([email, new Date(), actor || 'ADMIN', reason || 'Removed']);
}

function sfiUnblockREV315_(email) {
  const sheet = sfiSheetREV315_(SFI_BLOCKED_SHEET, SFI_BLOCKED_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const map = sfiHeaderMapREV315_(data[0]);
  for (let r = data.length - 1; r >= 1; r--) {
    if (sfiEmailREV315_(data[r][map.EMAIL]) === email) sheet.deleteRow(r + 1);
  }
}

function sfiIsBlockedREV315_(email) {
  const sheet = sfiSheetREV315_(SFI_BLOCKED_SHEET, SFI_BLOCKED_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;
  const map = sfiHeaderMapREV315_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV315_(data[r][map.EMAIL]) === email) return true;
  }
  return false;
}

function sfiSendOwnerRegistrationEmailREV315_(email, name) {
  const owner = sfiOwnerEmailREV315_();
  const adminUrl = sfiPropREV315_('SF_ADMIN_DASHBOARD_URL', SFI_ADMIN_DEFAULT);
  const body = [
    'Registrasi member baru:', '', 'Nama: ' + (name || '-'), 'Email: ' + email,
    'Status: PENDING', '', 'Email ini tidak ditemukan di TF Analyzer License Database.',
    'Buka dashboard untuk Aktifkan / Suspend / Remove:', adminUrl
  ].join('\n');
  MailApp.sendEmail({ to:owner, subject:'[Skill Fusion] Registrasi member baru menunggu approval', body:body, name:'Skill Fusion Member System' });
}

function sfiSendMemberStatusEmailREV315_(email, name, status) {
  const loginUrl = sfiPropREV315_('SF_LOGIN_PAGE_URL', 'https://skillfusion.framer.website/');
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
  MailApp.sendEmail({
    to:email, subject:subject,
    body:['Halo ' + (name || 'Member') + ',', '', message, '', 'Login: ' + loginUrl, '', 'Skill Fusion'].join('\n'),
    name:'Skill Fusion'
  });
}

function sfiSafeStatusEmailREV315_(email, name, status) {
  try { sfiSendMemberStatusEmailREV315_(email, name, status); }
  catch (err) { console.error('STATUS_EMAIL_FAIL ' + String(err)); }
}

function sfiOwnerEmailREV315_() { return sfiPropREV315_('SF_OWNER_EMAIL', SFI_OWNER_EMAIL_DEFAULT); }

function sfiStatusMessageREV315_(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'ACTIVE') return 'Akun sudah aktif. Silakan Login.';
  if (s === 'SUSPENDED') return 'Akun sedang disuspend.';
  if (s === 'REMOVED') return 'Akses member telah dihapus oleh owner.';
  return 'Akun menunggu persetujuan owner.';
}

function sfiLicenseDetailREV315_(license) {
  if (!license) return '';
  return ['licenseId=' + (license.licenseId || '-'), 'plan=' + (license.plan || '-'), 'status=' + (license.status || '-')].join(', ');
}

function sfiMergeNoteREV315_(oldValue, addition) {
  const oldText = String(oldValue || '').trim();
  if (!oldText) return addition;
  if (oldText.indexOf(addition) >= 0) return oldText;
  return oldText + ' | ' + addition;
}

function sfiExpireSessionsREV315_() {
  const sheet = sfiSheetREV315_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const map = sfiHeaderMapREV315_(data[0]);
  const now = Date.now();
  for (let r = 1; r < data.length; r++) {
    if (!sfiBoolREV315_(data[r][map.ACTIVE])) continue;
    const exp = sfiDateREV315_(data[r][map.EXPIRES_AT]);
    if (!exp || exp.getTime() <= now) sheet.getRange(r + 1, map.ACTIVE + 1).setValue(false);
  }
}

function sfiInvalidateSessionsREV315_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const map = sfiHeaderMapREV315_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV315_(data[r][map.EMAIL]) === email) sheet.getRange(r + 1, map.ACTIVE + 1).setValue(false);
  }
}

function sfiFindSessionREV315_(sheet, hash) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfiHeaderMapREV315_(headers);
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][map.SESSION_HASH] || '') === hash) {
      return { rowNumber:r + 1, headers:headers, session:sfiObjectREV315_(headers, data[r]) };
    }
  }
  return null;
}

function sfiFindMemberREV315_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfiHeaderMapREV315_(headers);
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV315_(data[r][map.EMAIL]) === email) {
      return { rowNumber:r + 1, headers:headers, member:sfiObjectREV315_(headers, data[r]) };
    }
  }
  return null;
}

function sfiPatchMemberREV315_(sheet, rowNumber, patch) {
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  sfiPatchRowREV315_(sheet, rowNumber, headers, patch);
}

function sfiPatchRowREV315_(sheet, rowNumber, headers, patch) {
  const map = sfiHeaderMapREV315_(headers);
  Object.keys(patch || {}).forEach(function(key) {
    if (map[key] === undefined) return;
    sheet.getRange(rowNumber, map[key] + 1).setValue(patch[key]);
  });
}

function sfiRowsREV315_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const obj = sfiObjectREV315_(headers, data[r]);
    if (Object.keys(obj).some(function(k){ return String(obj[k] == null ? '' : obj[k]).trim() !== ''; })) out.push(obj);
  }
  return out;
}

function sfiObjectREV315_(headers, row) {
  const obj = {};
  headers.forEach(function(h,i){ if (h) obj[String(h).trim()] = row[i]; });
  return obj;
}

function sfiMainSpreadsheetREV315_() {
  const id = sfiPropREV315_('SPREADSHEET_ID', '');
  if (!id) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  return SpreadsheetApp.openById(id);
}

function sfiSheetREV315_(name, headers) {
  return sfiEnsureSheetREV315_(sfiMainSpreadsheetREV315_(), name, headers);
}

function sfiEnsureSheetREV315_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,headers.length).setFontWeight('bold');
  } else {
    const current = sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getDisplayValues()[0].map(function(v){ return String(v || '').trim(); });
    const existing = {};
    current.forEach(function(h){ if (h) existing[h] = true; });
    headers.forEach(function(h) {
      if (!existing[h]) {
        const col = sheet.getLastColumn() + 1;
        sheet.getRange(1,col).setValue(h).setFontWeight('bold');
        existing[h] = true;
      }
    });
  }
  return sheet;
}

function sfiAuditREV315_(actor, action, target, details) {
  try {
    sfiSheetREV315_(SFI_AUDIT_SHEET, SFI_AUDIT_HEADERS).appendRow([new Date(), actor, action, target, details || '']);
  } catch (err) { console.error('SFI_AUDIT_FAIL ' + String(err)); }
}

function sfiNewTokenREV315_() {
  return [Utilities.getUuid(), Utilities.getUuid(), Date.now().toString(36)].join('.').replace(/-/g,'');
}

function sfiHashREV315_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return digest.map(function(b){ const n = (b + 256) % 256; return ('0' + n.toString(16)).slice(-2); }).join('');
}

function sfiConstantTimeEqualREV315_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function sfiHeaderMapREV315_(headers) {
  const map = {};
  (headers || []).forEach(function(h,i) {
    const key = String(h || '').trim();
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

function sfiEmailREV315_(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sfiAllowedStatusREV315_(value) {
  const s = String(value || '').trim().toUpperCase();
  if (['PENDING','ACTIVE','SUSPENDED'].indexOf(s) < 0) throw new Error('INVALID_MEMBER_STATUS');
  return s;
}

function sfiBoolREV315_(value) {
  if (value === true) return true;
  const s = String(value || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'active';
}

function sfiDateREV315_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function sfiIsoREV315_(value) {
  const d = sfiDateREV315_(value);
  return d ? d.toISOString() : '';
}

function sfiPropREV315_(name, fallback) {
  const value = String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  return value || String(fallback || '');
}
