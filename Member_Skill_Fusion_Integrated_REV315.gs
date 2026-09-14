/**
 * SKILL FUSION MEMBER — INTEGRATED MODULE REV327
 *
 * DROP-IN REPLACEMENT for the previous MemberSkillFusionREV315.gs file.
 * Existing Code.gs routes DO NOT need to change:
 *
 *   if (requestAction === 'member_auth') {
 *     return jsonResponse_(sfiHandleMemberAuthREV315_(body));
 *   }
 *   if (requestAction === 'member_admin') {
 *     return jsonResponse_(sfiHandleMemberAdminREV315_(body));
 *   }
 *
 * REV327:
 * - One-click owner approval link sent by Gmail for new PENDING registrations.
 * - Approval links are random, hashed, one-time use, and expire after 72 hours.
 * - Clicking the approval link activates the account and emails the customer.
 * - Customer status email now links to /Loginpage.
 * - Member list no longer re-syncs the full license database on every open.
 * - Google profile name/photo remain sourced from verified Google credentials only.
 */

const SFI_REV327 = 'REV327';
const SFI_MEMBER_SHEET = 'SF_Members';
const SFI_SESSION_SHEET = 'SF_Sessions';
const SFI_AUDIT_SHEET = 'SF_Audit';
const SFI_BLOCKED_SHEET = 'SF_Blocked';
const SFI_APPROVAL_SHEET = 'SF_Approvals';
const SFI_LICENSE_SHEET = 'Licenses';

const SFI_IDLE_MS = 10 * 60 * 1000;
const SFI_ONLINE_MS = 90 * 1000;
const SFI_APPROVAL_TTL_MS = 72 * 60 * 60 * 1000;

const SFI_GOOGLE_CLIENT_ID_DEFAULT = '115969098046-alnc03479m380nhjk9n0fqtqhboa0081.apps.googleusercontent.com';
const SFI_OWNER_EMAIL_DEFAULT = 'wiliejonathan1999@gmail.com';
const SFI_REDIRECT_DEFAULT = 'https://skillfusion.framer.website/Memberarea';
const SFI_LOGIN_DEFAULT = 'https://skillfusion.framer.website/Loginpage';
const SFI_ADMIN_DEFAULT = 'https://wiliejonathan.github.io/tf-analyzer-admin/';
const SFI_APPROVAL_PAGE_DEFAULT = 'https://wiliejonathan.github.io/tf-analyzer-admin/member-approve.html';

const SFI_MEMBER_HEADERS = [
  'MEMBER_ID','EMAIL','NAME','PHOTO_URL','STATUS','ROLE','CREATED_AT','APPROVED_AT',
  'APPROVED_BY','LAST_LOGIN_AT','LAST_SEEN_AT','LAST_LOGOUT_AT','NOTES'
];
const SFI_SESSION_HEADERS = [
  'SESSION_HASH','EMAIL','CREATED_AT','LAST_ACTIVITY_AT','EXPIRES_AT','ACTIVE','USER_AGENT'
];
const SFI_AUDIT_HEADERS = ['TIMESTAMP','ACTOR','ACTION','TARGET','DETAILS'];
const SFI_BLOCKED_HEADERS = ['EMAIL','BLOCKED_AT','BLOCKED_BY','REASON'];
const SFI_APPROVAL_HEADERS = ['TOKEN_HASH','EMAIL','CREATED_AT','EXPIRES_AT','USED_AT','USED_BY'];

/* --------------------------------------------------------------------------
   COMPATIBILITY ENTRY POINTS — Code.gs can stay unchanged
   -------------------------------------------------------------------------- */

function setupMemberSkillFusionREV315() {
  return setupMemberSkillFusionREV327();
}

function sfiHandleMemberAuthREV315_(body) {
  return sfiHandleMemberAuthREV327_(body);
}

function sfiHandleMemberAdminREV315_(body) {
  return sfiHandleMemberAdminREV327_(body);
}

/* --------------------------------------------------------------------------
   SETUP
   -------------------------------------------------------------------------- */

function setupMemberSkillFusionREV327() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');

  const ss = SpreadsheetApp.openById(spreadsheetId);
  sfiEnsureSheetREV327_(ss, SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  sfiEnsureSheetREV327_(ss, SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  sfiEnsureSheetREV327_(ss, SFI_AUDIT_SHEET, SFI_AUDIT_HEADERS);
  sfiEnsureSheetREV327_(ss, SFI_BLOCKED_SHEET, SFI_BLOCKED_HEADERS);
  sfiEnsureSheetREV327_(ss, SFI_APPROVAL_SHEET, SFI_APPROVAL_HEADERS);

  if (!props.getProperty('SF_GOOGLE_CLIENT_ID')) props.setProperty('SF_GOOGLE_CLIENT_ID', SFI_GOOGLE_CLIENT_ID_DEFAULT);
  if (!props.getProperty('SF_OWNER_EMAIL')) props.setProperty('SF_OWNER_EMAIL', SFI_OWNER_EMAIL_DEFAULT);
  if (!props.getProperty('SF_MEMBER_REDIRECT_URL')) props.setProperty('SF_MEMBER_REDIRECT_URL', SFI_REDIRECT_DEFAULT);
  if (!props.getProperty('SF_ADMIN_DASHBOARD_URL')) props.setProperty('SF_ADMIN_DASHBOARD_URL', SFI_ADMIN_DEFAULT);
  if (!props.getProperty('SF_APPROVAL_PAGE_URL')) props.setProperty('SF_APPROVAL_PAGE_URL', SFI_APPROVAL_PAGE_DEFAULT);

  // Force the correct public login page even if an older setup saved the site root.
  props.setProperty('SF_LOGIN_PAGE_URL', SFI_LOGIN_DEFAULT);

  const sync = sfiSyncLicenseMembersREV327_();
  const result = {
    success:true,
    ok:true,
    version:SFI_REV327,
    spreadsheetId:spreadsheetId,
    spreadsheetUrl:ss.getUrl(),
    autoActivatedFromLicenseDb:sync.activated,
    alreadyActive:sync.alreadyActive,
    suspendedPreserved:sync.suspendedPreserved,
    blockedSkipped:sync.blockedSkipped,
    licenseEmailsFound:sync.licenseEmailsFound,
    loginUrl:SFI_LOGIN_DEFAULT,
    approvalPage:sfiPropREV327_('SF_APPROVAL_PAGE_URL', SFI_APPROVAL_PAGE_DEFAULT)
  };
  console.log(JSON.stringify(result));
  return result;
}

// Run once if UrlFetchApp permission has not yet been granted.
function authorizeMemberUrlFetchREV327() {
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=TEST', {
    method:'get', muteHttpExceptions:true, followRedirects:true
  });
  console.log('UrlFetch authorization OK. HTTP=' + response.getResponseCode());
  return true;
}

/* --------------------------------------------------------------------------
   ROUTERS
   -------------------------------------------------------------------------- */

function sfiHandleMemberAuthREV327_(body) {
  const command = String(body && body.command || '').trim().toLowerCase();
  if (command === 'register') return sfiRegisterREV327_(body);
  if (command === 'google_login') return sfiGoogleLoginREV327_(body);
  if (command === 'validate_session') return sfiValidateSessionResponseREV327_(body, false);
  if (command === 'heartbeat') return sfiValidateSessionResponseREV327_(body, true);
  if (command === 'logout') return sfiLogoutREV327_(body);
  if (command === 'approve_registration') return sfiApproveRegistrationREV327_(body);
  throw new Error('UNKNOWN_MEMBER_AUTH_COMMAND');
}

function sfiHandleMemberAdminREV327_(body) {
  sfiAssertAdminREV327_(body);
  const command = String(body && body.command || '').trim().toLowerCase();
  if (command === 'list_members') return sfiAdminListMembersREV327_();
  if (command === 'add_member') return sfiAdminAddMemberREV327_(body);
  if (command === 'set_status') return sfiAdminSetStatusREV327_(body);
  if (command === 'remove_member') return sfiAdminRemoveMemberREV327_(body);
  if (command === 'send_status_email') return sfiAdminSendStatusEmailREV327_(body);
  if (command === 'sync_license_members') return Object.assign({success:true,ok:true}, sfiSyncLicenseMembersREV327_());
  throw new Error('UNKNOWN_MEMBER_ADMIN_COMMAND');
}

/* --------------------------------------------------------------------------
   PUBLIC REGISTER / LOGIN
   -------------------------------------------------------------------------- */

function sfiRegisterREV327_(body) {
  const google = sfiVerifyGoogleCredentialREV327_(body && body.credential);
  const email = google.email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (sfiIsBlockedREV327_(email)) {
      return {success:false,ok:false,code:'MEMBER_REMOVED',status:'REMOVED',message:'Akses member untuk email ini telah dihapus oleh owner.'};
    }

    const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
    let found = sfiFindMemberREV327_(memberSheet, email);
    const license = sfiFindLicenseREV327_(email);
    const now = new Date();

    if (found) {
      let status = String(found.member.STATUS || 'PENDING').toUpperCase();

      // Always refresh only verified Google identity fields.
      sfiPatchMemberREV327_(memberSheet, found.rowNumber, {
        NAME:google.name || found.member.NAME || '',
        PHOTO_URL:google.picture || found.member.PHOTO_URL || ''
      });

      if (status === 'SUSPENDED') {
        return {success:true,ok:true,registered:true,status:'SUSPENDED',message:'Akun sedang disuspend.'};
      }

      if (license && status !== 'ACTIVE') {
        sfiPatchMemberREV327_(memberSheet, found.rowNumber, {
          STATUS:'ACTIVE', APPROVED_AT:now, APPROVED_BY:'AUTO:TF_LICENSE_DB',
          NOTES:sfiMergeNoteREV327_(found.member.NOTES, 'Auto-active: TF Analyzer License Database')
        });
        status = 'ACTIVE';
        sfiAuditREV327_('AUTO:TF_LICENSE_DB','AUTO_ACTIVATE_EXISTING',email,sfiLicenseDetailREV327_(license));
      }

      return {
        success:true,ok:true,registered:true,status:status,
        autoActivated:Boolean(license && status === 'ACTIVE'),
        message:sfiStatusMessageREV327_(status)
      };
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
      sfiAuditREV327_('AUTO:TF_LICENSE_DB','REGISTER_AUTO_ACTIVE',email,sfiLicenseDetailREV327_(license));
    } else {
      sfiAuditREV327_('PUBLIC:' + email,'REGISTER_PENDING',email,'Awaiting owner approval');
      sfiSendOwnerRegistrationEmailREV327_(email, google.name || '');
    }

    return {
      success:true,ok:true,registered:true,status:status,autoActivated:Boolean(license),
      message:license
        ? 'Email ditemukan di TF Analyzer License Database. Akun Skill Fusion otomatis aktif.'
        : 'Google Account berhasil diverifikasi. Akun sedang menunggu persetujuan admin.'
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function sfiGoogleLoginREV327_(body) {
  const google = sfiVerifyGoogleCredentialREV327_(body && body.credential);
  const email = google.email;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (sfiIsBlockedREV327_(email)) {
      return {success:false,ok:false,code:'MEMBER_REMOVED',status:'REMOVED',message:'Akses member untuk email ini telah dihapus oleh owner.'};
    }

    const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
    let found = sfiFindMemberREV327_(memberSheet, email);
    const license = sfiFindLicenseREV327_(email);
    const now = new Date();

    if (!found && license) {
      memberSheet.appendRow([
        'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(),
        email, google.name || '', google.picture || '', 'ACTIVE', 'MEMBER', now,
        now, 'AUTO:TF_LICENSE_DB', '', '', '', 'Auto-active: TF Analyzer License Database'
      ]);
      SpreadsheetApp.flush();
      found = sfiFindMemberREV327_(memberSheet, email);
      sfiAuditREV327_('AUTO:TF_LICENSE_DB','LOGIN_AUTO_PROVISION',email,sfiLicenseDetailREV327_(license));
    }

    if (!found) {
      return {success:false,ok:false,code:'NOT_REGISTERED',status:'NOT_REGISTERED',message:'Email belum terdaftar. Silakan Register terlebih dahulu.'};
    }

    let status = String(found.member.STATUS || '').toUpperCase();

    if (status === 'SUSPENDED') {
      return {success:false,ok:false,code:'ACCOUNT_SUSPENDED',status:'SUSPENDED',message:'Akun sedang disuspend. Hubungi admin Skill Fusion.'};
    }

    if (status === 'PENDING' && license) {
      sfiPatchMemberREV327_(memberSheet, found.rowNumber, {
        STATUS:'ACTIVE', APPROVED_AT:now, APPROVED_BY:'AUTO:TF_LICENSE_DB',
        NAME:google.name || found.member.NAME || '', PHOTO_URL:google.picture || found.member.PHOTO_URL || '',
        NOTES:sfiMergeNoteREV327_(found.member.NOTES, 'Auto-active: TF Analyzer License Database')
      });
      status = 'ACTIVE';
      found = sfiFindMemberREV327_(memberSheet, email);
      sfiAuditREV327_('AUTO:TF_LICENSE_DB','PENDING_AUTO_ACTIVATE_ON_LOGIN',email,sfiLicenseDetailREV327_(license));
    }

    if (status === 'PENDING') {
      return {success:false,ok:false,code:'PENDING_APPROVAL',status:'PENDING',message:'Google Account sudah terverifikasi. Akun masih menunggu persetujuan admin.'};
    }

    if (status !== 'ACTIVE') {
      return {success:false,ok:false,code:'ACCOUNT_INACTIVE',status:status || 'INACTIVE',message:'Akun tidak aktif.'};
    }

    const rawToken = sfiNewTokenREV327_();
    const hash = sfiHashREV327_(rawToken);
    const expires = new Date(now.getTime() + SFI_IDLE_MS);
    const sessionSheet = sfiSheetREV327_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
    sfiInvalidateSessionsREV327_(sessionSheet, email);
    sessionSheet.appendRow([hash,email,now,now,expires,true,String(body && body.userAgent || '').slice(0,500)]);

    sfiPatchMemberREV327_(memberSheet, found.rowNumber, {
      NAME:google.name || found.member.NAME || '',
      PHOTO_URL:google.picture || found.member.PHOTO_URL || '',
      LAST_LOGIN_AT:now,
      LAST_SEEN_AT:now
    });
    SpreadsheetApp.flush();
    sfiAuditREV327_('PUBLIC:' + email,'LOGIN',email,license ? 'TF license client' : 'Approved member');

    return {
      success:true,ok:true,authenticated:true,
      sessionToken:rawToken,
      expiresAt:expires.toISOString(),
      idleTimeoutSeconds:Math.floor(SFI_IDLE_MS / 1000),
      redirectUrl:sfiPropREV327_('SF_MEMBER_REDIRECT_URL', SFI_REDIRECT_DEFAULT),
      autoActivatedFromLicenseDb:Boolean(license),
      member:{email:email,name:google.name || found.member.NAME || '',photoUrl:google.picture || found.member.PHOTO_URL || '',status:'ACTIVE'}
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* --------------------------------------------------------------------------
   ONE-CLICK EMAIL APPROVAL
   -------------------------------------------------------------------------- */

function sfiCreateApprovalTokenREV327_(email) {
  const sheet = sfiSheetREV327_(SFI_APPROVAL_SHEET, SFI_APPROVAL_HEADERS);
  const now = new Date();
  const expires = new Date(now.getTime() + SFI_APPROVAL_TTL_MS);
  const raw = sfiNewTokenREV327_();
  const hash = sfiHashREV327_(raw);

  // Invalidate any older unused approval links for this email.
  const data = sheet.getDataRange().getValues();
  if (data.length >= 2) {
    const map = sfiHeaderMapREV327_(data[0]);
    for (let r = 1; r < data.length; r++) {
      if (sfiEmailREV327_(data[r][map.EMAIL]) !== email) continue;
      if (data[r][map.USED_AT]) continue;
      sheet.getRange(r + 1, map.USED_AT + 1).setValue(now);
      sheet.getRange(r + 1, map.USED_BY + 1).setValue('SUPERSEDED');
    }
  }

  sheet.appendRow([hash,email,now,expires,'','']);
  SpreadsheetApp.flush();
  return raw;
}

function sfiApproveRegistrationREV327_(body) {
  const rawToken = String(body && body.approvalToken || '').trim();
  if (!rawToken) return {success:false,ok:false,code:'APPROVAL_TOKEN_REQUIRED',message:'Token approval tidak ditemukan.'};

  const approvalSheet = sfiSheetREV327_(SFI_APPROVAL_SHEET, SFI_APPROVAL_HEADERS);
  const data = approvalSheet.getDataRange().getValues();
  if (data.length < 2) return {success:false,ok:false,code:'APPROVAL_INVALID',message:'Link approval tidak valid.'};

  const map = sfiHeaderMapREV327_(data[0]);
  const hash = sfiHashREV327_(rawToken);
  let row = -1;
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][map.TOKEN_HASH] || '') === hash) { row = r; break; }
  }
  if (row < 1) return {success:false,ok:false,code:'APPROVAL_INVALID',message:'Link approval tidak valid.'};

  const email = sfiEmailREV327_(data[row][map.EMAIL]);
  const usedAt = sfiDateREV327_(data[row][map.USED_AT]);
  const expiresAt = sfiDateREV327_(data[row][map.EXPIRES_AT]);
  const now = new Date();

  const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const found = sfiFindMemberREV327_(memberSheet, email);

  if (!found) return {success:false,ok:false,code:'MEMBER_NOT_FOUND',message:'Member tidak ditemukan.'};

  const currentStatus = String(found.member.STATUS || '').toUpperCase();

  if (usedAt) {
    if (currentStatus === 'ACTIVE') {
      return {success:true,ok:true,alreadyActive:true,email:email,status:'ACTIVE',message:'Akun ini sudah aktif. Tidak ada perubahan tambahan.'};
    }
    return {success:false,ok:false,code:'APPROVAL_ALREADY_USED',message:'Link approval ini sudah pernah digunakan.'};
  }

  if (!expiresAt || expiresAt.getTime() < now.getTime()) {
    return {success:false,ok:false,code:'APPROVAL_EXPIRED',message:'Link approval sudah kedaluwarsa. Minta user melakukan registrasi ulang.'};
  }

  if (currentStatus === 'SUSPENDED') {
    return {success:false,ok:false,code:'ACCOUNT_SUSPENDED',message:'Akun sedang disuspend dan tidak dapat diaktifkan lewat link approval.'};
  }

  sfiPatchMemberREV327_(memberSheet, found.rowNumber, {
    STATUS:'ACTIVE',
    APPROVED_AT:now,
    APPROVED_BY:'EMAIL_LINK:' + sfiOwnerEmailREV327_()
  });
  approvalSheet.getRange(row + 1, map.USED_AT + 1).setValue(now);
  approvalSheet.getRange(row + 1, map.USED_BY + 1).setValue(sfiOwnerEmailREV327_());
  SpreadsheetApp.flush();

  sfiAuditREV327_('EMAIL_LINK:' + sfiOwnerEmailREV327_(),'APPROVE_MEMBER',email,'one-click owner approval');
  sfiSafeStatusEmailREV327_(email, String(found.member.NAME || ''), 'ACTIVE');

  return {
    success:true,ok:true,email:email,status:'ACTIVE',
    message:'Akun ' + email + ' berhasil diaktifkan. Email konfirmasi sudah dikirim ke user.'
  };
}

function sfiSendOwnerRegistrationEmailREV327_(email, name) {
  const owner = sfiOwnerEmailREV327_();
  const approvalToken = sfiCreateApprovalTokenREV327_(email);
  const approvalPage = sfiPropREV327_('SF_APPROVAL_PAGE_URL', SFI_APPROVAL_PAGE_DEFAULT);
  const approveUrl = approvalPage + '?token=' + encodeURIComponent(approvalToken);
  const adminUrl = sfiPropREV327_('SF_ADMIN_DASHBOARD_URL', SFI_ADMIN_DEFAULT);

  const subject = '[Skill Fusion] Verifikasi member baru: ' + email;
  const textBody = [
    'Skill Fusion — Verifikasi Member Baru',
    '',
    'Nama: ' + (name || '-'),
    'Email: ' + email,
    'Status: PENDING',
    '',
    'Google Account user sudah berhasil diverifikasi.',
    'Klik link berikut untuk mengaktifkan akun:',
    approveUrl,
    '',
    'Link hanya dapat digunakan satu kali dan berlaku 72 jam.',
    '',
    'Admin Dashboard: ' + adminUrl
  ].join('\n');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;background:#071b14;color:#eef8f3;padding:28px;border-radius:16px;border:1px solid #174936">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#19d97b">SKILL FUSION</div>
      <h2 style="margin:8px 0 8px;color:#fff">Verifikasi Member Baru</h2>
      <p style="color:#9db2a9;line-height:1.6">Google Account user sudah berhasil diverifikasi dan sekarang menunggu approval admin.</p>
      <div style="margin:20px 0;padding:15px;border-radius:10px;background:#0a261c;border:1px solid #174936">
        <div><b>Nama:</b> ${sfiHtmlREV327_(name || '-')}</div>
        <div style="margin-top:7px"><b>Email:</b> ${sfiHtmlREV327_(email)}</div>
        <div style="margin-top:7px"><b>Status:</b> <span style="color:#f0bf54">PENDING</span></div>
      </div>
      <a href="${sfiHtmlREV327_(approveUrl)}" style="display:block;text-align:center;background:#16d778;color:#04170d;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:9px">Verifikasi & Aktifkan Member</a>
      <p style="font-size:11px;color:#71877e;line-height:1.6;margin-top:16px">Link approval hanya dapat digunakan satu kali dan berlaku selama 72 jam.</p>
      <p style="font-size:11px;color:#71877e"><a href="${sfiHtmlREV327_(adminUrl)}" style="color:#64d9a0">Buka Admin Dashboard</a></p>
    </div>`;

  MailApp.sendEmail({
    to:owner,
    subject:subject,
    body:textBody,
    htmlBody:htmlBody,
    name:'Skill Fusion Member System'
  });
}

/* --------------------------------------------------------------------------
   SESSION
   -------------------------------------------------------------------------- */

function sfiValidateSessionResponseREV327_(body, extend) {
  const token = String(body && body.sessionToken || '').trim();
  if (!token) return {success:false,ok:false,valid:false,code:'SESSION_REQUIRED'};
  const result = sfiValidateSessionREV327_(token, Boolean(extend), String(body && body.userAgent || ''));
  if (!result.valid) return {success:false,ok:false,valid:false,code:result.code,message:result.message};
  return {
    success:true,ok:true,valid:true,
    expiresAt:result.expiresAt.toISOString(),
    idleTimeoutSeconds:Math.floor(SFI_IDLE_MS / 1000),
    member:result.member,
    redirectUrl:sfiPropREV327_('SF_MEMBER_REDIRECT_URL', SFI_REDIRECT_DEFAULT)
  };
}

function sfiValidateSessionREV327_(rawToken, extend, userAgent) {
  const sessionSheet = sfiSheetREV327_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  const found = sfiFindSessionREV327_(sessionSheet, sfiHashREV327_(rawToken));
  if (!found) return {valid:false,code:'SESSION_NOT_FOUND',message:'Sesi tidak ditemukan.'};

  const now = new Date();
  const expiresAt = sfiDateREV327_(found.session.EXPIRES_AT);
  if (!sfiBoolREV327_(found.session.ACTIVE) || !expiresAt || expiresAt.getTime() <= now.getTime()) {
    sfiPatchRowREV327_(sessionSheet, found.rowNumber, found.headers, {ACTIVE:false});
    return {valid:false,code:'SESSION_EXPIRED',message:'Sesi berakhir. Silakan login kembali.'};
  }

  const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const memberFound = sfiFindMemberREV327_(memberSheet, found.session.EMAIL);
  if (!memberFound || String(memberFound.member.STATUS || '').toUpperCase() !== 'ACTIVE') {
    sfiPatchRowREV327_(sessionSheet, found.rowNumber, found.headers, {ACTIVE:false,EXPIRES_AT:now});
    return {valid:false,code:'ACCOUNT_NOT_ACTIVE',message:'Akun tidak aktif.'};
  }

  let nextExpiry = expiresAt;
  if (extend) {
    nextExpiry = new Date(now.getTime() + SFI_IDLE_MS);
    sfiPatchRowREV327_(sessionSheet, found.rowNumber, found.headers, {
      LAST_ACTIVITY_AT:now,
      EXPIRES_AT:nextExpiry,
      USER_AGENT:userAgent ? userAgent.slice(0,500) : found.session.USER_AGENT
    });
    sfiPatchMemberREV327_(memberSheet, memberFound.rowNumber, {LAST_SEEN_AT:now});
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

function sfiLogoutREV327_(body) {
  const token = String(body && body.sessionToken || '').trim();
  if (!token) return {success:true,ok:true,loggedOut:true};
  const sessionSheet = sfiSheetREV327_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS);
  const found = sfiFindSessionREV327_(sessionSheet, sfiHashREV327_(token));
  if (found) {
    const now = new Date();
    sfiPatchRowREV327_(sessionSheet, found.rowNumber, found.headers, {ACTIVE:false,EXPIRES_AT:now,LAST_ACTIVITY_AT:now});
    const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
    const member = sfiFindMemberREV327_(memberSheet, found.session.EMAIL);
    if (member) sfiPatchMemberREV327_(memberSheet, member.rowNumber, {LAST_LOGOUT_AT:now,LAST_SEEN_AT:now});
    sfiAuditREV327_('PUBLIC:' + found.session.EMAIL,'LOGOUT',found.session.EMAIL,'User logout');
  }
  return {success:true,ok:true,loggedOut:true};
}

/* --------------------------------------------------------------------------
   ADMIN
   -------------------------------------------------------------------------- */

function sfiAdminListMembersREV327_() {
  sfiExpireSessionsREV327_();
  const members = sfiRowsREV327_(sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS));
  const sessions = sfiRowsREV327_(sfiSheetREV327_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS));
  const now = Date.now();
  const online = {};

  sessions.forEach(function(s) {
    if (!sfiBoolREV327_(s.ACTIVE)) return;
    const exp = sfiDateREV327_(s.EXPIRES_AT);
    const last = sfiDateREV327_(s.LAST_ACTIVITY_AT);
    if (!exp || exp.getTime() <= now || !last || now - last.getTime() > SFI_ONLINE_MS) return;
    online[String(s.EMAIL || '').trim().toLowerCase()] = true;
  });

  let out = members.map(function(m) {
    const email = String(m.EMAIL || '').trim().toLowerCase();
    return {
      memberId:String(m.MEMBER_ID || ''),
      email:email,
      name:String(m.NAME || ''),
      photoUrl:String(m.PHOTO_URL || ''),
      status:String(m.STATUS || '').toUpperCase(),
      role:String(m.ROLE || 'MEMBER'),
      online:Boolean(online[email]),
      createdAt:sfiIsoREV327_(m.CREATED_AT),
      approvedAt:sfiIsoREV327_(m.APPROVED_AT),
      approvedBy:String(m.APPROVED_BY || ''),
      lastLoginAt:sfiIsoREV327_(m.LAST_LOGIN_AT),
      lastSeenAt:sfiIsoREV327_(m.LAST_SEEN_AT),
      lastLogoutAt:sfiIsoREV327_(m.LAST_LOGOUT_AT),
      notes:String(m.NOTES || '')
    };
  });

  // Preserve sheet row order, but always pin owner first.
  const owner = sfiOwnerEmailREV327_();
  const ownerIndex = out.findIndex(function(m){ return m.email === owner; });
  if (ownerIndex > 0) out.unshift(out.splice(ownerIndex,1)[0]);

  return {
    success:true,ok:true,version:SFI_REV327,members:out,count:out.length,
    onlineCount:out.filter(function(m){ return m.online; }).length,
    serverTime:new Date().toISOString(),
    performanceMode:'FAST_MEMBER_LIST'
  };
}

function sfiAdminAddMemberREV327_(body) {
  const email = sfiEmailREV327_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const status = sfiAllowedStatusREV327_(body && body.status || 'ACTIVE');
  const name = String(body && body.name || '').trim();
  const notes = String(body && body.notes || '').trim();
  const owner = sfiOwnerEmailREV327_();
  const sheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  if (sfiFindMemberREV327_(sheet, email)) throw new Error('MEMBER_ALREADY_EXISTS');
  sfiUnblockREV327_(email);
  const now = new Date();
  sheet.appendRow([
    'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(),email,name,'',status,'MEMBER',now,
    status === 'ACTIVE' ? now : '',status === 'ACTIVE' ? owner : '','','','',notes
  ]);
  SpreadsheetApp.flush();
  sfiAuditREV327_('ADMIN:' + owner,'ADD_MEMBER',email,'status=' + status);
  if (status === 'ACTIVE') sfiSafeStatusEmailREV327_(email,name,status);
  return {success:true,ok:true,email:email,status:status};
}

function sfiAdminSetStatusREV327_(body) {
  const email = sfiEmailREV327_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const status = sfiAllowedStatusREV327_(body && body.status);
  const owner = sfiOwnerEmailREV327_();
  const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const found = sfiFindMemberREV327_(memberSheet, email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');

  const now = new Date();
  const patch = {STATUS:status};
  if (status === 'ACTIVE') {
    patch.APPROVED_AT = now;
    patch.APPROVED_BY = owner;
    sfiUnblockREV327_(email);
  }

  sfiPatchMemberREV327_(memberSheet, found.rowNumber, patch);
  if (status !== 'ACTIVE') sfiInvalidateSessionsREV327_(sfiSheetREV327_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS), email);
  sfiAuditREV327_('ADMIN:' + owner,'SET_STATUS',email,status);
  if (body && (body.sendEmail === true || status === 'ACTIVE')) sfiSafeStatusEmailREV327_(email,String(found.member.NAME || ''),status);
  return {success:true,ok:true,email:email,status:status};
}

function sfiAdminRemoveMemberREV327_(body) {
  const email = sfiEmailREV327_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const owner = sfiOwnerEmailREV327_();
  const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET, SFI_MEMBER_HEADERS);
  const found = sfiFindMemberREV327_(memberSheet, email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  sfiInvalidateSessionsREV327_(sfiSheetREV327_(SFI_SESSION_SHEET, SFI_SESSION_HEADERS),email);
  sfiBlockREV327_(email,owner,'Removed from Member Skill Fusion');
  memberSheet.deleteRow(found.rowNumber);
  SpreadsheetApp.flush();
  sfiAuditREV327_('ADMIN:' + owner,'REMOVE_MEMBER',email,'Deleted + auto-sync blocked');
  return {success:true,ok:true,removed:true,email:email};
}

function sfiAdminSendStatusEmailREV327_(body) {
  const email = sfiEmailREV327_(body && body.email);
  if (!email) throw new Error('INVALID_EMAIL');
  const found = sfiFindMemberREV327_(sfiSheetREV327_(SFI_MEMBER_SHEET,SFI_MEMBER_HEADERS),email);
  if (!found) throw new Error('MEMBER_NOT_FOUND');
  sfiSendMemberStatusEmailREV327_(email,String(found.member.NAME || ''),String(found.member.STATUS || 'PENDING').toUpperCase());
  sfiAuditREV327_('ADMIN:' + sfiOwnerEmailREV327_(),'SEND_STATUS_EMAIL',email,String(found.member.STATUS || ''));
  return {success:true,ok:true,sent:true,email:email};
}

/* --------------------------------------------------------------------------
   LICENSE SYNC
   -------------------------------------------------------------------------- */

function sfiSyncLicenseMembersREV327_() {
  const ss = sfiMainSpreadsheetREV327_();
  const licenseSheet = ss.getSheetByName(SFI_LICENSE_SHEET);
  if (!licenseSheet) throw new Error('LICENSE_SHEET_NOT_FOUND');
  const data = licenseSheet.getDataRange().getValues();
  if (data.length < 2) return {licenseEmailsFound:0,activated:0,alreadyActive:0,suspendedPreserved:0,blockedSkipped:0};

  const headers = data[0].map(function(v){ return String(v || '').trim().toUpperCase(); });
  const emailCol = headers.indexOf('EMAIL');
  if (emailCol < 0) throw new Error('LICENSE_EMAIL_HEADER_NOT_FOUND');

  const memberSheet = sfiSheetREV327_(SFI_MEMBER_SHEET,SFI_MEMBER_HEADERS);
  const now = new Date();
  const seen = {};
  let activated = 0, alreadyActive = 0, suspendedPreserved = 0, blockedSkipped = 0;

  for (let r = 1; r < data.length; r++) {
    const email = sfiEmailREV327_(data[r][emailCol]);
    if (!email || seen[email]) continue;
    seen[email] = true;
    if (sfiIsBlockedREV327_(email)) { blockedSkipped++; continue; }

    const found = sfiFindMemberREV327_(memberSheet,email);
    if (!found) {
      memberSheet.appendRow([
        'SFM-' + Utilities.getUuid().replace(/-/g,'').slice(0,18).toUpperCase(),email,'','','ACTIVE','MEMBER',now,
        now,'AUTO:TF_LICENSE_DB','','','','Auto-active: TF Analyzer License Database'
      ]);
      activated++;
      continue;
    }

    const status = String(found.member.STATUS || '').toUpperCase();
    if (status === 'SUSPENDED') { suspendedPreserved++; continue; }
    if (status === 'ACTIVE') { alreadyActive++; continue; }

    sfiPatchMemberREV327_(memberSheet,found.rowNumber,{
      STATUS:'ACTIVE',APPROVED_AT:now,APPROVED_BY:'AUTO:TF_LICENSE_DB',
      NOTES:sfiMergeNoteREV327_(found.member.NOTES,'Auto-active: TF Analyzer License Database')
    });
    activated++;
  }

  SpreadsheetApp.flush();
  if (activated > 0) sfiAuditREV327_('AUTO:TF_LICENSE_DB','SYNC_LICENSE_MEMBERS','*','activated=' + activated);
  return {
    licenseEmailsFound:Object.keys(seen).length,
    activated:activated,
    alreadyActive:alreadyActive,
    suspendedPreserved:suspendedPreserved,
    blockedSkipped:blockedSkipped
  };
}

function sfiFindLicenseREV327_(email) {
  const ss = sfiMainSpreadsheetREV327_();
  const sheet = ss.getSheetByName(SFI_LICENSE_SHEET);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim().toUpperCase(); });
  const map = {};
  headers.forEach(function(h,i){ if (h && map[h] === undefined) map[h] = i; });
  if (map.EMAIL === undefined) return null;
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV327_(data[r][map.EMAIL]) === email) {
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

/* --------------------------------------------------------------------------
   GOOGLE CREDENTIAL
   -------------------------------------------------------------------------- */

function sfiVerifyGoogleCredentialREV327_(credential) {
  const token = String(credential || '').trim();
  if (!token) throw new Error('GOOGLE_CREDENTIAL_REQUIRED');
  const clientId = sfiPropREV327_('SF_GOOGLE_CLIENT_ID',SFI_GOOGLE_CLIENT_ID_DEFAULT);
  const cacheKey = 'sfi327_google_' + sfiHashREV327_(token).slice(0,24);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {
    method:'get',muteHttpExceptions:true,followRedirects:true
  });
  if (response.getResponseCode() !== 200) throw new Error('GOOGLE_TOKEN_INVALID');
  const data = JSON.parse(response.getContentText() || '{}');
  if (String(data.aud || '') !== clientId) throw new Error('GOOGLE_TOKEN_AUDIENCE_MISMATCH');
  if (String(data.email_verified || '').toLowerCase() !== 'true') throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  const iss = String(data.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') throw new Error('GOOGLE_TOKEN_ISSUER_INVALID');
  const email = sfiEmailREV327_(data.email);
  if (!email) throw new Error('GOOGLE_EMAIL_INVALID');
  const out = {email:email,name:String(data.name || ''),picture:String(data.picture || ''),sub:String(data.sub || '')};
  cache.put(cacheKey,JSON.stringify(out),300);
  return out;
}

/* --------------------------------------------------------------------------
   EMAILS
   -------------------------------------------------------------------------- */

function sfiSendMemberStatusEmailREV327_(email, name, status) {
  // REV327: always point to the actual Framer login page.
  const loginUrl = SFI_LOGIN_DEFAULT;
  let subject = '[Skill Fusion] Status akun member';
  let message = 'Status akun Anda: ' + status;

  if (status === 'ACTIVE') {
    subject = '[Skill Fusion] Akun Anda berhasil diverifikasi';
    message = 'Akun Skill Fusion Anda sudah berhasil diverifikasi dan diaktifkan. Silakan login menggunakan Google Account yang sama.';
  } else if (status === 'SUSPENDED') {
    subject = '[Skill Fusion] Akses akun disuspend';
    message = 'Akses akun Skill Fusion Anda sedang disuspend. Hubungi admin jika membutuhkan bantuan.';
  } else if (status === 'PENDING') {
    subject = '[Skill Fusion] Verifikasi akun sedang diproses';
    message = 'Google Account Anda sudah terverifikasi. Aktivasi Member Skill Fusion masih menunggu persetujuan admin.';
  }

  const textBody = [
    'Halo ' + (name || 'Member') + ',',
    '',
    message,
    '',
    'Login: ' + loginUrl,
    '',
    'Skill Fusion'
  ].join('\n');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;background:#071b14;color:#eef8f3;padding:28px;border-radius:16px;border:1px solid #174936">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#19d97b">SKILL FUSION</div>
      <h2 style="margin:8px 0 12px;color:#fff">${status === 'ACTIVE' ? 'Akun Berhasil Diverifikasi' : 'Status Member Skill Fusion'}</h2>
      <p style="color:#a2b6ad;line-height:1.65">Halo ${sfiHtmlREV327_(name || 'Member')},</p>
      <p style="color:#a2b6ad;line-height:1.65">${sfiHtmlREV327_(message)}</p>
      ${status === 'ACTIVE' ? `<a href="${SFI_LOGIN_DEFAULT}" style="display:block;margin-top:20px;text-align:center;background:#16d778;color:#04170d;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:9px">Login Member Skill Fusion</a>` : ''}
      <p style="font-size:11px;color:#71877e;margin-top:20px">Skill Fusion Member System</p>
    </div>`;

  MailApp.sendEmail({
    to:email,
    subject:subject,
    body:textBody,
    htmlBody:htmlBody,
    name:'Skill Fusion'
  });
}

function sfiSafeStatusEmailREV327_(email, name, status) {
  try { sfiSendMemberStatusEmailREV327_(email,name,status); }
  catch (err) { console.error('STATUS_EMAIL_FAIL ' + String(err)); }
}

/* --------------------------------------------------------------------------
   BLOCK / SECURITY / HELPERS
   -------------------------------------------------------------------------- */

function sfiAssertAdminREV327_(body) {
  const expected = sfiPropREV327_('ADMIN_DASHBOARD_KEY','');
  const received = String(body && body.adminKey || '').trim();
  if (!expected) throw new Error('ADMIN_DASHBOARD_KEY_NOT_CONFIGURED');
  if (!received || !sfiConstantTimeEqualREV327_(received,expected)) throw new Error('ADMIN_UNAUTHORIZED');
  return true;
}

function sfiBlockREV327_(email, actor, reason) {
  const sheet = sfiSheetREV327_(SFI_BLOCKED_SHEET,SFI_BLOCKED_HEADERS);
  const data = sheet.getDataRange().getValues();
  const map = data.length ? sfiHeaderMapREV327_(data[0]) : {};
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV327_(data[r][map.EMAIL]) === email) {
      sheet.getRange(r + 1,map.BLOCKED_AT + 1).setValue(new Date());
      sheet.getRange(r + 1,map.BLOCKED_BY + 1).setValue(actor || 'ADMIN');
      sheet.getRange(r + 1,map.REASON + 1).setValue(reason || 'Removed');
      return;
    }
  }
  sheet.appendRow([email,new Date(),actor || 'ADMIN',reason || 'Removed']);
}

function sfiUnblockREV327_(email) {
  const sheet = sfiSheetREV327_(SFI_BLOCKED_SHEET,SFI_BLOCKED_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const map = sfiHeaderMapREV327_(data[0]);
  for (let r = data.length - 1; r >= 1; r--) {
    if (sfiEmailREV327_(data[r][map.EMAIL]) === email) sheet.deleteRow(r + 1);
  }
}

function sfiIsBlockedREV327_(email) {
  const sheet = sfiSheetREV327_(SFI_BLOCKED_SHEET,SFI_BLOCKED_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;
  const map = sfiHeaderMapREV327_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV327_(data[r][map.EMAIL]) === email) return true;
  }
  return false;
}

function sfiOwnerEmailREV327_() {
  return sfiPropREV327_('SF_OWNER_EMAIL',SFI_OWNER_EMAIL_DEFAULT);
}

function sfiStatusMessageREV327_(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'ACTIVE') return 'Akun sudah aktif. Silakan Login.';
  if (s === 'SUSPENDED') return 'Akun sedang disuspend.';
  if (s === 'REMOVED') return 'Akses member telah dihapus oleh owner.';
  return 'Google Account berhasil diverifikasi. Akun menunggu persetujuan admin.';
}

function sfiLicenseDetailREV327_(license) {
  if (!license) return '';
  return ['licenseId=' + (license.licenseId || '-'),'plan=' + (license.plan || '-'),'status=' + (license.status || '-')].join(', ');
}

function sfiMergeNoteREV327_(oldValue, addition) {
  const oldText = String(oldValue || '').trim();
  if (!oldText) return addition;
  if (oldText.indexOf(addition) >= 0) return oldText;
  return oldText + ' | ' + addition;
}

function sfiExpireSessionsREV327_() {
  const sheet = sfiSheetREV327_(SFI_SESSION_SHEET,SFI_SESSION_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const map = sfiHeaderMapREV327_(data[0]);
  const now = Date.now();
  for (let r = 1; r < data.length; r++) {
    if (!sfiBoolREV327_(data[r][map.ACTIVE])) continue;
    const exp = sfiDateREV327_(data[r][map.EXPIRES_AT]);
    if (!exp || exp.getTime() <= now) sheet.getRange(r + 1,map.ACTIVE + 1).setValue(false);
  }
}

function sfiInvalidateSessionsREV327_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const map = sfiHeaderMapREV327_(data[0]);
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV327_(data[r][map.EMAIL]) === email) sheet.getRange(r + 1,map.ACTIVE + 1).setValue(false);
  }
}

function sfiFindSessionREV327_(sheet, hash) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfiHeaderMapREV327_(headers);
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][map.SESSION_HASH] || '') === hash) {
      return {rowNumber:r + 1,headers:headers,session:sfiObjectREV327_(headers,data[r])};
    }
  }
  return null;
}

function sfiFindMemberREV327_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const map = sfiHeaderMapREV327_(headers);
  for (let r = 1; r < data.length; r++) {
    if (sfiEmailREV327_(data[r][map.EMAIL]) === email) {
      return {rowNumber:r + 1,headers:headers,member:sfiObjectREV327_(headers,data[r])};
    }
  }
  return null;
}

function sfiPatchMemberREV327_(sheet, rowNumber, patch) {
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  sfiPatchRowREV327_(sheet,rowNumber,headers,patch);
}

function sfiPatchRowREV327_(sheet, rowNumber, headers, patch) {
  const map = sfiHeaderMapREV327_(headers);
  Object.keys(patch || {}).forEach(function(key){
    if (map[key] === undefined) return;
    sheet.getRange(rowNumber,map[key] + 1).setValue(patch[key]);
  });
}

function sfiRowsREV327_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(function(v){ return String(v || '').trim(); });
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const obj = sfiObjectREV327_(headers,data[r]);
    if (Object.keys(obj).some(function(k){ return String(obj[k] == null ? '' : obj[k]).trim() !== ''; })) out.push(obj);
  }
  return out;
}

function sfiObjectREV327_(headers, row) {
  const obj = {};
  headers.forEach(function(h,i){ if (h) obj[String(h).trim()] = row[i]; });
  return obj;
}

function sfiMainSpreadsheetREV327_() {
  const id = sfiPropREV327_('SPREADSHEET_ID','');
  if (!id) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  return SpreadsheetApp.openById(id);
}

function sfiSheetREV327_(name, headers) {
  return sfiEnsureSheetREV327_(sfiMainSpreadsheetREV327_(),name,headers);
}

function sfiEnsureSheetREV327_(ss, name, headers) {
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

function sfiAuditREV327_(actor, action, target, details) {
  try {
    sfiSheetREV327_(SFI_AUDIT_SHEET,SFI_AUDIT_HEADERS).appendRow([new Date(),actor,action,target,details || '']);
  } catch (err) {
    console.error('SFI_AUDIT_FAIL ' + String(err));
  }
}

function sfiNewTokenREV327_() {
  return [Utilities.getUuid(),Utilities.getUuid(),Date.now().toString(36)].join('.').replace(/-/g,'');
}

function sfiHashREV327_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value || ''),Utilities.Charset.UTF_8);
  return digest.map(function(b){ const n = (b + 256) % 256; return ('0' + n.toString(16)).slice(-2); }).join('');
}

function sfiConstantTimeEqualREV327_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  const max = Math.max(a.length,b.length);
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function sfiHeaderMapREV327_(headers) {
  const map = {};
  (headers || []).forEach(function(h,i){
    const key = String(h || '').trim();
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

function sfiEmailREV327_(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sfiAllowedStatusREV327_(value) {
  const s = String(value || '').trim().toUpperCase();
  if (['PENDING','ACTIVE','SUSPENDED'].indexOf(s) < 0) throw new Error('INVALID_MEMBER_STATUS');
  return s;
}

function sfiBoolREV327_(value) {
  if (value === true) return true;
  const s = String(value || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'active';
}

function sfiDateREV327_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function sfiIsoREV327_(value) {
  const d = sfiDateREV327_(value);
  return d ? d.toISOString() : '';
}

function sfiPropREV327_(name, fallback) {
  const value = String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  return value || String(fallback || '');
}

function sfiHtmlREV327_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
