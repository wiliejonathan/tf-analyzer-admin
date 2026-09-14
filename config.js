window.TF_ADMIN_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbzUbx40vGvuCS4hQEOdfs-DeSU_TY-9zWXXPZzOKn3D9h0m5pQQYD6GGNCefufvsrv2eA/exec",
  memberApiUrl: "",
  autoRefreshMs: 30000,
  memberRefreshMs: 30000,
  defaultPageSize: 10
};

// REV312 — Member Skill Fusion is loaded as a separate module so the existing
// TF Analyzer license dashboard remains backward-compatible.
(() => {
  const version = "312";
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
})();
