window.TF_ADMIN_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  memberApiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  autoRefreshMs: 30000,
  memberRefreshMs: 30000,
  defaultPageSize: 10
};

// REV319
// - Apps Script cold-start protection (35s transport ceiling)
// - Main dashboard keeps Google Sheet row order instead of alphabetical sorting
// - wiliejonathan1999@gmail.com is always pinned to row #1
// - Member Skill Fusion follows the same Google Sheet order
// - Member list is prefetched/cached after admin login so opening Member Dashboard feels immediate
(() => {
  if (window.__TF_REV319_PATCHED__ || typeof window.fetch !== "function") return;
  window.__TF_REV319_PATCHED__ = true;

  const PRIMARY_ADMIN_EMAIL = "wiliejonathan1999@gmail.com";
  const nativeFetch = window.fetch.bind(window);
  const nativeSort = Array.prototype.sort;
  const MEMBER_CACHE_TTL = 30000;

  let sheetEmailOrder = [];
  let lastAdminKey = "";
  let memberCache = null;
  let memberCacheAt = 0;
  let prefetching = false;

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

  // app.js currently contains an internal alphabetical sort. We only bypass that
  // exact display sort (and the member table's email/date sorts) so row order stays
  // identical to the Google Sheet while other JavaScript sorts remain untouched.
  Array.prototype.sort = function tfRev319StableSheetSort(compareFn) {
    if (typeof compareFn === "function" && Array.isArray(this) && this.length) {
      let src = "";
      try { src = Function.prototype.toString.call(compareFn); } catch (_) {}
      const sample = this[0] || {};
      const looksLikeLicenseUser = sample && typeof sample === "object" && ("licenseId" in sample || "token" in sample) && ("email" in sample);
      const looksLikeMember = sample && typeof sample === "object" && ("memberId" in sample || "photoUrl" in sample || "createdAt" in sample) && ("email" in sample);
      const isMainDashboardDisplaySort = looksLikeLicenseUser && src.includes("adminSortPriority");
      const isMemberEmailSort = looksLikeMember && src.includes("localeCompare") && src.includes("email");
      const isMemberRecentSort = looksLikeMember && src.includes("lastSeenAt") && src.includes("createdAt");

      if (isMainDashboardDisplaySort || isMemberEmailSort || isMemberRecentSort) {
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
    sheetEmailOrder = order;
    window.__TF_SHEET_EMAIL_ORDER__ = order.slice();
  }

  function reorderMembers(members) {
    const list = Array.isArray(members) ? members.slice() : [];
    const orderMap = new Map(sheetEmailOrder.map((email, index) => [email, index]));
    const originalIndex = new Map(list.map((item, index) => [item, index]));

    list.sort((a, b) => {
      const ea = normalizeEmail(a && a.email);
      const eb = normalizeEmail(b && b.email);

      if (ea === PRIMARY_ADMIN_EMAIL && eb !== PRIMARY_ADMIN_EMAIL) return -1;
      if (eb === PRIMARY_ADMIN_EMAIL && ea !== PRIMARY_ADMIN_EMAIL) return 1;

      const ia = orderMap.has(ea) ? orderMap.get(ea) : Number.MAX_SAFE_INTEGER;
      const ib = orderMap.has(eb) ? orderMap.get(eb) : Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;

      // Member-only registrations that are not in Licenses are appended chronologically,
      // matching normal SF_Members append order.
      const ca = Date.parse(a && a.createdAt || "") || 0;
      const cb = Date.parse(b && b.createdAt || "") || 0;
      if (ca !== cb) return ca - cb;

      return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
    });

    return pinPrimaryFirst(list);
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

  async function prefetchMembers(url) {
    if (prefetching || !lastAdminKey || !url) return;
    if (memberCache && (Date.now() - memberCacheAt) < MEMBER_CACHE_TTL) return;
    prefetching = true;
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
      if (response.ok && payload && payload.success !== false && payload.ok !== false) {
        payload.members = reorderMembers(payload.members || []);
        memberCache = payload;
        memberCacheAt = Date.now();
      }
    } catch (_) {
      // Prefetch is best-effort only; a normal foreground request will retry later.
    } finally {
      prefetching = false;
    }
  }

  window.fetch = async function tfRev319Fetch(input, init) {
    const opts = init ? { ...init } : {};
    const url = typeof input === "string"
      ? input
      : String(input && input.url ? input.url : input || "");

    const isAppsScriptWebApp = /^https:\/\/script\.google\.com\/macros\/s\//i.test(url);
    if (!isAppsScriptWebApp) return nativeFetch(input, opts);

    const requestPayload = parseBody(opts.body);
    const action = String(requestPayload && requestPayload.action || "").trim().toLowerCase();
    const command = String(requestPayload && requestPayload.command || "").trim().toLowerCase();

    if (requestPayload && requestPayload.adminKey) lastAdminKey = String(requestPayload.adminKey || "").trim();

    if (action === "member_admin" && command === "list_members" && memberCache && (Date.now() - memberCacheAt) < MEMBER_CACHE_TTL) {
      setTimeout(() => prefetchMembers(url), 0);
      return responseFromPayload(memberCache, null);
    }

    if (action === "member_admin" && command !== "list_members") {
      memberCache = null;
      memberCacheAt = 0;
    }

    const controller = new AbortController();
    const hardTimeoutMs = 35000;
    const timer = setTimeout(() => controller.abort(), hardTimeoutMs);
    opts.signal = controller.signal;

    try {
      const response = await nativeFetch(input, opts);

      if (action === "admin_dashboard" && (command === "login_snapshot" || command === "list_users")) {
        try {
          const payload = JSON.parse(await response.clone().text());
          if (Array.isArray(payload && payload.users)) rememberSheetOrder(payload.users);
          if (lastAdminKey) setTimeout(() => prefetchMembers(String(window.TF_ADMIN_CONFIG.memberApiUrl || url)), 0);
        } catch (_) {}
        return response;
      }

      if (action === "member_admin" && command === "list_members") {
        try {
          const payload = JSON.parse(await response.clone().text());
          if (payload && Array.isArray(payload.members)) {
            payload.members = reorderMembers(payload.members);
            memberCache = payload;
            memberCacheAt = Date.now();
            return responseFromPayload(payload, response);
          }
        } catch (_) {}
      }

      if (action === "member_admin" && command !== "list_members") {
        memberCache = null;
        memberCacheAt = 0;
      }

      return response;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("API_TIMEOUT_35S");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
})();

// Member Skill Fusion modules.
(() => {
  const version = "319";
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
