window.TF_ADMIN_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  memberApiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  autoRefreshMs: 30000,
  memberRefreshMs: 30000,
  defaultPageSize: 10
};

// REV313 — Apps Script cold-start protection.
// The legacy admin app cancels login_snapshot after 9 seconds. Google Apps Script
// can occasionally need longer on a cold start, which caused API_TIMEOUT_9S even
// though the backend itself was healthy. For Apps Script Web App calls only, use
// a 35-second transport timeout and ignore the shorter caller AbortSignal.
(() => {
  if (window.__TF_REV313_FETCH_PATCHED__ || typeof window.fetch !== "function") return;
  window.__TF_REV313_FETCH_PATCHED__ = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function tfRev313Fetch(input, init) {
    const opts = init ? { ...init } : {};
    const url = typeof input === "string"
      ? input
      : String(input && input.url ? input.url : input || "");

    const isAppsScriptWebApp = /^https:\/\/script\.google\.com\/macros\/s\//i.test(url);
    if (!isAppsScriptWebApp) return nativeFetch(input, opts);

    const controller = new AbortController();
    const hardTimeoutMs = 35000;
    const timer = setTimeout(() => controller.abort(), hardTimeoutMs);
    opts.signal = controller.signal;

    try {
      return await nativeFetch(input, opts);
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("API_TIMEOUT_35S");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
})();

// Member Skill Fusion is loaded as a separate module so the existing
// TF Analyzer license dashboard remains backward-compatible.
(() => {
  const version = "318";
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
