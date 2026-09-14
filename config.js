window.TF_ADMIN_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  memberApiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  autoRefreshMs: 30000,
  memberRefreshMs: 30000,
  defaultPageSize: 10
};

// REV321
// - Member Skill Fusion list renders immediately from last-known snapshot.
// - Fresh Apps Script data is fetched in the background, never blocking the member UI.
// - Duplicate list_members calls are deduplicated.
// - Google Sheet row order is preserved and wiliejonathan1999@gmail.com stays #1.
// - Idle auto-refresh arrow is static instead of spinning forever.
(() => {
  "use strict";

  if (window.__TF_REV321_PATCHED__ || typeof window.fetch !== "function") return;
  window.__TF_REV321_PATCHED__ = true;

  const PRIMARY_ADMIN_EMAIL = "wiliejonathan1999@gmail.com";
  const nativeFetch = window.fetch.bind(window);
  const nativeSort = Array.prototype.sort;
  const MEMBER_FRESH_MS = 30000;
  const MEMBER_STALE_MAX_MS = 6 * 60 * 60 * 1000;
  const MEMBER_STORAGE_KEY = "tf_member_snapshot_rev321";

  // Initial snapshot comes from the current SF_Members sheet so the first open is instant.
  // It is replaced automatically by the live backend response in the background.
  const BOOTSTRAP_MEMBERS = [
    {memberId:"SFM-F3B5FE432E1E434FA8",email:"wiliejonathan1999@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-777336F1C05B4492B4",email:"winatabickson@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-21EDE02E631241D590",email:"vincentzzz75@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-847AFAD5647F418689",email:"arliyan@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-D8D59036FECC479E98",email:"dendyanto.wu290196@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-451CE3B98FF3443FBA",email:"kristan.tradersfamily@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-5DE379319CC4499591",email:"kessynaftalia@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-9DE621CE6F22414B81",email:"willydawson10boy@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-AB46FC419C984D198D",email:"adamyosipratama@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"},
    {memberId:"SFM-CAEDAC5FACC34582A1",email:"rahmatsyahsiregar7@gmail.com",name:"",photoUrl:"",status:"ACTIVE",role:"MEMBER",online:false,createdAt:"2026-09-15T00:19:41+07:00",approvedAt:"2026-09-15T00:19:41+07:00",approvedBy:"AUTO:TF_LICENSE_DB",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:"Auto-active: TF Analyzer License Database"}
  ];

  let sheetEmailOrder = BOOTSTRAP_MEMBERS.map(m => m.email);
  let lastAdminKey = "";
  let memberCache = null;
  let memberCacheAt = 0;
  let memberFetchPromise = null;

  const normalizeEmail = value => String(value || "").trim().toLowerCase();

  function pinPrimaryFirst(list) {
    const out = Array.isArray(list) ? list.slice() : [];
    const index = out.findIndex(item => normalizeEmail(item && item.email) === PRIMARY_ADMIN_EMAIL);
    if (index > 0) {
      const [admin] = out.splice(index, 1);
      out.unshift(admin);
    }
    return out;
  }

  // app.js/member module contain their own sorts. Only neutralize those display sorts.
  Array.prototype.sort = function tfRev321StableSheetSort(compareFn) {
    if (typeof compareFn === "function" && Array.isArray(this) && this.length) {
      let src = "";
      try { src = Function.prototype.toString.call(compareFn); } catch (_) {}
      const sample = this[0] || {};
      const looksLikeLicenseUser = sample && typeof sample === "object" && ("licenseId" in sample || "token" in sample) && ("email" in sample);
      const looksLikeMember = sample && typeof sample === "object" && ("memberId" in sample || "photoUrl" in sample || "createdAt" in sample) && ("email" in sample);
      const mainDisplaySort = looksLikeLicenseUser && src.includes("adminSortPriority");
      const memberEmailSort = looksLikeMember && src.includes("localeCompare") && src.includes("email");
      const memberRecentSort = looksLikeMember && src.includes("lastSeenAt") && src.includes("createdAt");
      if (mainDisplaySort || memberEmailSort || memberRecentSort) {
        const ordered = pinPrimaryFirst(Array.from(this));
        for (let i = 0; i < ordered.length; i++) this[i] = ordered[i];
        return this;
      }
    }
    return nativeSort.call(this, compareFn);
  };

  function rememberSheetOrder(users) {
    const order = [];
    const seen = new Set();
    (Array.isArray(users) ? users : []).forEach(user => {
      const email = normalizeEmail(user && user.email);
      if (!email || seen.has(email)) return;
      seen.add(email);
      order.push(email);
    });
    if (order.length) sheetEmailOrder = order;
    window.__TF_SHEET_EMAIL_ORDER__ = sheetEmailOrder.slice();
  }

  function reorderMembers(members) {
    const list = Array.isArray(members) ? members.slice() : [];
    const orderMap = new Map(sheetEmailOrder.map((email, index) => [normalizeEmail(email), index]));
    const originalIndex = new Map(list.map((item, index) => [item, index]));
    nativeSort.call(list, (a, b) => {
      const ea = normalizeEmail(a && a.email);
      const eb = normalizeEmail(b && b.email);
      if (ea === PRIMARY_ADMIN_EMAIL && eb !== PRIMARY_ADMIN_EMAIL) return -1;
      if (eb === PRIMARY_ADMIN_EMAIL && ea !== PRIMARY_ADMIN_EMAIL) return 1;
      const ia = orderMap.has(ea) ? orderMap.get(ea) : Number.MAX_SAFE_INTEGER;
      const ib = orderMap.has(eb) ? orderMap.get(eb) : Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      const ca = Date.parse(a && a.createdAt || "") || 0;
      const cb = Date.parse(b && b.createdAt || "") || 0;
      if (ca !== cb) return ca - cb;
      return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    });
    return pinPrimaryFirst(list);
  }

  function memberPayload(members, extra = {}) {
    const list = reorderMembers(members || []);
    return {
      success: true,
      ok: true,
      members: list,
      count: list.length,
      onlineCount: list.filter(m => !!m.online).length,
      serverTime: new Date().toISOString(),
      ...extra
    };
  }

  function persistMemberCache(payload) {
    if (!payload || !Array.isArray(payload.members)) return;
    memberCache = { ...payload, members: reorderMembers(payload.members) };
    memberCacheAt = Date.now();
    window.__TF_MEMBER_SNAPSHOT__ = memberCache;
    try {
      localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify({ at: memberCacheAt, payload: memberCache }));
    } catch (_) {}
  }

  function hydrateMemberCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMBER_STORAGE_KEY) || "null");
      if (saved && saved.payload && Array.isArray(saved.payload.members) && saved.payload.members.length && Date.now() - Number(saved.at || 0) <= MEMBER_STALE_MAX_MS) {
        memberCache = saved.payload;
        memberCacheAt = Number(saved.at || Date.now());
      }
    } catch (_) {}
    if (!memberCache) {
      memberCache = memberPayload(BOOTSTRAP_MEMBERS, { bootstrap: true });
      memberCacheAt = 0;
    }
    window.__TF_MEMBER_SNAPSHOT__ = memberCache;
  }

  function responseFromPayload(payload, sourceResponse) {
    const headers = new Headers(sourceResponse && sourceResponse.headers || undefined);
    headers.set("content-type", "application/json;charset=utf-8");
    return new Response(JSON.stringify(payload), {
      status: sourceResponse ? sourceResponse.status : 200,
      statusText: sourceResponse ? sourceResponse.statusText : "OK",
      headers
    });
  }

  function parseBody(body) {
    if (typeof body !== "string") return null;
    try { return JSON.parse(body); } catch (_) { return null; }
  }

  function patchCachedMemberFromMutation(command, requestPayload) {
    if (!memberCache || !Array.isArray(memberCache.members)) return;
    const email = normalizeEmail(requestPayload && requestPayload.email);
    if (!email) return;
    let list = memberCache.members.slice();
    if (command === "set_status") {
      const status = String(requestPayload.status || "").trim().toUpperCase();
      list = list.map(m => normalizeEmail(m.email) === email ? { ...m, status, online: status === "ACTIVE" ? !!m.online : false } : m);
    } else if (command === "remove_member") {
      list = list.filter(m => normalizeEmail(m.email) !== email);
    } else if (command === "add_member" && !list.some(m => normalizeEmail(m.email) === email)) {
      list.push({memberId:"",email,name:String(requestPayload.name||""),photoUrl:"",status:String(requestPayload.status||"ACTIVE").toUpperCase(),role:"MEMBER",online:false,createdAt:new Date().toISOString(),approvedAt:"",approvedBy:"",lastLoginAt:"",lastSeenAt:"",lastLogoutAt:"",notes:String(requestPayload.notes||"")});
    }
    persistMemberCache(memberPayload(list));
  }

  async function fetchMembersInBackground(url, force = false) {
    if (!lastAdminKey || !url) return memberCache;
    if (!force && memberCacheAt && Date.now() - memberCacheAt < MEMBER_FRESH_MS) return memberCache;
    if (memberFetchPromise) return memberFetchPromise;

    memberFetchPromise = (async () => {
      try {
        const response = await nativeFetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          cache: "no-store",
          redirect: "follow",
          body: JSON.stringify({ action: "member_admin", command: "list_members", adminKey: lastAdminKey })
        });
        const raw = await response.text();
        const payload = JSON.parse(raw || "{}");
        if (response.ok && payload && payload.success !== false && payload.ok !== false && Array.isArray(payload.members)) {
          persistMemberCache(payload);
          window.dispatchEvent(new CustomEvent("tf-member-snapshot-updated", { detail: memberCache }));
        }
      } catch (_) {
        // Keep last-known snapshot. The visible Member UI remains usable.
      } finally {
        memberFetchPromise = null;
      }
      return memberCache;
    })();

    return memberFetchPromise;
  }

  hydrateMemberCache();

  window.fetch = async function tfRev321Fetch(input, init) {
    const opts = init ? { ...init } : {};
    const url = typeof input === "string" ? input : String(input && input.url ? input.url : input || "");
    const isAppsScriptWebApp = /^https:\/\/script\.google\.com\/macros\/s\//i.test(url);
    if (!isAppsScriptWebApp) return nativeFetch(input, opts);

    const requestPayload = parseBody(opts.body);
    const action = String(requestPayload && requestPayload.action || "").trim().toLowerCase();
    const command = String(requestPayload && requestPayload.command || "").trim().toLowerCase();
    if (requestPayload && requestPayload.adminKey) lastAdminKey = String(requestPayload.adminKey || "").trim();

    // Never block the Member Skill Fusion table on Apps Script.
    if (action === "member_admin" && command === "list_members") {
      const immediate = memberCache || memberPayload(BOOTSTRAP_MEMBERS, { bootstrap: true });
      setTimeout(() => fetchMembersInBackground(url, false), 0);
      return responseFromPayload(immediate, null);
    }

    // Keep the instant snapshot aligned with management actions.
    if (action === "member_admin" && command !== "list_members") {
      patchCachedMemberFromMutation(command, requestPayload || {});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    opts.signal = controller.signal;

    try {
      const response = await nativeFetch(input, opts);

      if (action === "admin_dashboard" && (command === "login_snapshot" || command === "list_users")) {
        try {
          const payload = JSON.parse(await response.clone().text());
          if (Array.isArray(payload && payload.users)) rememberSheetOrder(payload.users);
          if (lastAdminKey) setTimeout(() => fetchMembersInBackground(String(window.TF_ADMIN_CONFIG.memberApiUrl || url), true), 0);
        } catch (_) {}
      }

      if (action === "member_admin" && command !== "list_members") {
        setTimeout(() => fetchMembersInBackground(String(window.TF_ADMIN_CONFIG.memberApiUrl || url), true), 0);
      }

      return response;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("API_TIMEOUT_35S");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  // Stop the small idle auto-refresh arrow from spinning continuously.
  function installIdleRefreshSpinnerFix() {
    if (!document.getElementById("tfIdleRefreshSpinnerFixREV321")) {
      const style = document.createElement("style");
      style.id = "tfIdleRefreshSpinnerFixREV321";
      style.textContent = `
        .tf-idle-refresh-static,
        .tf-idle-refresh-static *,
        .tf-idle-refresh-static::before,
        .tf-idle-refresh-static::after {
          animation: none !important;
          animation-play-state: paused !important;
        }
        .tf-idle-refresh-static svg,
        .tf-idle-refresh-static i,
        .tf-idle-refresh-static span { transform: none !important; }
      `;
      document.head.appendChild(style);
    }

    const scan = () => {
      document.querySelectorAll("button,[role='button']").forEach(el => {
        const text = String(el.textContent || "").trim();
        const parentText = String(el.parentElement?.textContent || el.closest("div")?.textContent || "");
        const looksRefresh = /[↻⟳⟲⭮⭯]/.test(text) || /refresh/i.test(el.getAttribute("aria-label") || "") || /refresh/i.test(el.getAttribute("title") || "");
        const inAutoRefreshRow = /auto\s*refresh/i.test(parentText);
        if (looksRefresh && inAutoRefreshRow) el.classList.add("tf-idle-refresh-static");
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installIdleRefreshSpinnerFix, { once: true });
  } else {
    installIdleRefreshSpinnerFix();
  }
})();

// Member Skill Fusion modules.
(() => {
  const version = "321";
  const head = document.head || document.getElementsByTagName("head")[0];

  if (!document.querySelector('link[data-sf-member-module]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `member-skill-fusion.css?v=${version}`;
    link.dataset.sfMemberModule = "style";
    head.appendChild(link);
  }

  if (!document.querySelector('script[data-sf-member-module]')) {
    const script = document.createElement("script");
    script.src = `member-skill-fusion.js?v=${version}`;
    script.defer = true;
    script.dataset.sfMemberModule = "script";
    document.body.appendChild(script);
  }

  if (!document.querySelector('script[data-sf-summary-carousel]')) {
    const summaryScript = document.createElement("script");
    summaryScript.src = `sidebar-member-summary.js?v=${version}`;
    summaryScript.defer = true;
    summaryScript.dataset.sfSummaryCarousel = "script";
    document.body.appendChild(summaryScript);
  }
})();
