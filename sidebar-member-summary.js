(() => {
  "use strict";

  const cfg = window.TF_ADMIN_CONFIG || {};
  const REFRESH_MS = Math.max(10000, Number(cfg.memberRefreshMs || 30000));
  let activePage = "license";
  let refreshTimer = null;
  let loading = false;

  function adminKey() {
    const input = document.getElementById("adminKeyInput");
    return String(input && input.value || localStorage.getItem("tf_admin_key_v303") || "").trim();
  }

  function apiUrl() {
    return String(cfg.memberApiUrl || cfg.apiUrl || localStorage.getItem("sf_member_api_url") || "").trim();
  }

  function injectStyles() {
    if (document.getElementById("sfSidebarSummaryStylesREV318")) return;
    const style = document.createElement("style");
    style.id = "sfSidebarSummaryStylesREV318";
    style.textContent = `
      .daily-summary.sf-summary-carousel{overflow:hidden}
      .sf-summary-head{display:grid;grid-template-columns:30px minmax(0,1fr) 30px;align-items:center;gap:4px;margin-bottom:12px}
      .sf-summary-head h3{margin:0;text-align:left;white-space:normal;line-height:1.25}
      .sf-summary-arrow{width:30px;height:30px;display:grid;place-items:center;border:1px solid rgba(70,130,110,.22);border-radius:8px;background:rgba(7,31,24,.72);color:#a5bbb2;font:800 19px/1 system-ui;cursor:pointer;transition:.16s ease;padding:0}
      .sf-summary-arrow:hover{color:#4be59b;border-color:rgba(75,229,155,.45);background:rgba(17,75,54,.35)}
      .sf-summary-arrow[hidden]{visibility:hidden;display:block!important;pointer-events:none;border-color:transparent;background:transparent}
      .sf-summary-page{animation:sfSummaryIn .18s ease}
      .sf-summary-page[hidden]{display:none!important}
      .sf-summary-page .summary-row{min-height:28px}
      .sf-summary-dot.pending{background:#e6b84e}
      .sf-summary-dot.suspended{background:#ef6c76}
      .sf-summary-loading{opacity:.65}
      @keyframes sfSummaryIn{from{opacity:.2;transform:translateX(5px)}to{opacity:1;transform:none}}
    `;
    document.head.appendChild(style);
  }

  function injectCarousel() {
    const box = document.querySelector(".daily-summary");
    if (!box || box.dataset.sfSummaryCarousel === "1") return false;

    const oldTitle = box.querySelector("h3");
    const oldRows = Array.from(box.querySelectorAll(":scope > .summary-row"));
    if (!oldTitle || !oldRows.length) return false;

    box.dataset.sfSummaryCarousel = "1";
    box.classList.add("sf-summary-carousel");

    const head = document.createElement("div");
    head.className = "sf-summary-head";
    head.innerHTML = `
      <button id="sfSummaryPrev" class="sf-summary-arrow" type="button" title="Previous" aria-label="Previous" hidden>‹</button>
      <h3 id="sfSummaryTitle">Ringkasan Hari Ini</h3>
      <button id="sfSummaryNext" class="sf-summary-arrow" type="button" title="Member Skill Fusion" aria-label="Next">›</button>
    `;

    const licensePage = document.createElement("div");
    licensePage.id = "sfSummaryLicensePage";
    licensePage.className = "sf-summary-page";
    oldRows.forEach(row => licensePage.appendChild(row));

    const memberPage = document.createElement("div");
    memberPage.id = "sfSummaryMemberPage";
    memberPage.className = "sf-summary-page";
    memberPage.hidden = true;
    memberPage.innerHTML = `
      <div class="summary-row"><span><i class="summary-dot active"></i>Total Member</span><strong id="sfSideMemberTotal">-</strong></div>
      <div class="summary-row"><span><i class="summary-dot active"></i>User Online</span><strong id="sfSideMemberOnline">-</strong></div>
      <div class="summary-row"><span><i class="summary-dot active"></i>Active</span><strong id="sfSideMemberActive">-</strong></div>
      <div class="summary-row"><span><i class="summary-dot pending"></i>Pending</span><strong id="sfSideMemberPending">-</strong></div>
      <div class="summary-row"><span><i class="summary-dot suspended"></i>Suspended</span><strong id="sfSideMemberSuspended">-</strong></div>
    `;

    oldTitle.remove();
    box.prepend(memberPage);
    box.prepend(licensePage);
    box.prepend(head);

    document.getElementById("sfSummaryNext")?.addEventListener("click", () => switchPage("member"));
    document.getElementById("sfSummaryPrev")?.addEventListener("click", () => switchPage("license"));
    return true;
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderMemberStats(members) {
    const list = Array.isArray(members) ? members : [];
    const total = list.length;
    const online = list.filter(m => !!m.online).length;
    const active = list.filter(m => String(m.status || "").toUpperCase() === "ACTIVE").length;
    const pending = list.filter(m => String(m.status || "").toUpperCase() === "PENDING").length;
    const suspended = list.filter(m => String(m.status || "").toUpperCase() === "SUSPENDED").length;
    setValue("sfSideMemberTotal", total);
    setValue("sfSideMemberOnline", online);
    setValue("sfSideMemberActive", active);
    setValue("sfSideMemberPending", pending);
    setValue("sfSideMemberSuspended", suspended);
  }

  async function loadMemberStats() {
    if (loading || activePage !== "member") return;
    const url = apiUrl();
    const key = adminKey();
    if (!url || !key) return;

    loading = true;
    const page = document.getElementById("sfSummaryMemberPage");
    page?.classList.add("sf-summary-loading");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        cache: "no-store",
        redirect: "follow",
        body: JSON.stringify({ action: "member_admin", command: "list_members", adminKey: key })
      });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); } catch (_) { throw new Error("INVALID_MEMBER_RESPONSE"); }
      if (!response.ok || payload?.success === false || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || payload?.code || `HTTP_${response.status}`);
      }
      renderMemberStats(payload.members || []);
    } catch (err) {
      console.warn("[REV318] Sidebar Member Skill Fusion summary failed:", err);
    } finally {
      loading = false;
      page?.classList.remove("sf-summary-loading");
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (activePage !== "member") return;
    refreshTimer = setTimeout(async () => {
      if (!document.hidden && activePage === "member") await loadMemberStats();
      scheduleRefresh();
    }, REFRESH_MS);
  }

  function switchPage(page) {
    activePage = page === "member" ? "member" : "license";
    const isMember = activePage === "member";
    const title = document.getElementById("sfSummaryTitle");
    const prev = document.getElementById("sfSummaryPrev");
    const next = document.getElementById("sfSummaryNext");
    const licensePage = document.getElementById("sfSummaryLicensePage");
    const memberPage = document.getElementById("sfSummaryMemberPage");

    if (title) title.textContent = isMember ? "Member Skill Fusion" : "Ringkasan Hari Ini";
    if (prev) prev.hidden = !isMember;
    if (next) next.hidden = isMember;
    if (licensePage) licensePage.hidden = isMember;
    if (memberPage) memberPage.hidden = !isMember;

    clearTimeout(refreshTimer);
    if (isMember) {
      loadMemberStats();
      scheduleRefresh();
    }
  }

  function init() {
    injectStyles();
    if (!injectCarousel()) return;
    switchPage("license");

    window.addEventListener("pagehide", () => clearTimeout(refreshTimer));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && activePage === "member") loadMemberStats();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

// REV320 — Member registrations are self-service from the public Framer widget.
// Remove the old manual "+ Tambah User" submenu/page from the admin UI.
(() => {
  "use strict";

  function removeLegacyMemberAddUser() {
    document.querySelectorAll('[data-sf-member-view="add-user"]').forEach(el => el.remove());
    document.getElementById("sfMemberAddView")?.remove();

    // Defensive: if an older cached module left the removed view selected,
    // return Member Skill Fusion to Dashboard.
    const section = document.getElementById("memberSkillFusionSection");
    if (section?.classList.contains("active-section")) {
      const dashboard = document.getElementById("sfMemberDashboardView");
      const users = document.getElementById("sfMemberUsersView");
      if (dashboard && users && dashboard.hidden && users.hidden) dashboard.hidden = false;
    }
  }

  function startCleanup() {
    removeLegacyMemberAddUser();
    const observer = new MutationObserver(removeLegacyMemberAddUser);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startCleanup, { once: true });
  } else {
    startCleanup();
  }
})();
