(() => {
  "use strict";

  const cfg = window.TF_ADMIN_CONFIG || {};
  const STORAGE_API = "tf_admin_api_url_v303";
  const MEMBER_API_URL = () => String(cfg.memberApiUrl || localStorage.getItem("sf_member_api_url") || "").trim();
  const DEFAULT_ADMIN_API = () => String(localStorage.getItem(STORAGE_API) || cfg.apiUrl || "").trim();
  const MEMBER_REFRESH_MS = Math.max(10000, Number(cfg.memberRefreshMs || 30000));

  const state = {
    members: [],
    activeView: "dashboard",
    refreshTimer: null,
    loading: false
  };

  const esc = (v) => String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  function adminKey() {
    const input = document.getElementById("adminKeyInput");
    return String(input && input.value || localStorage.getItem("tf_admin_key_v303") || "").trim();
  }

  function memberApiUrl() {
    return MEMBER_API_URL();
  }

  function toast(message, error = false) {
    const el = document.getElementById("toast");
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.toggle("error", !!error);
    el.hidden = false;
    clearTimeout(el.__sfTimer);
    el.__sfTimer = setTimeout(() => { el.hidden = true; }, error ? 5500 : 3000);
  }

  function setBusy(on, text = "Memproses...") {
    const overlay = document.getElementById("busyOverlay");
    const label = document.getElementById("busyText");
    if (label) label.textContent = text;
    if (overlay) overlay.hidden = !on;
  }

  async function callMemberAdmin(command, data = {}) {
    const url = memberApiUrl();
    if (!url) throw new Error("MEMBER_API_URL_NOT_CONFIGURED");
    const key = adminKey();
    if (!key) throw new Error("ADMIN_KEY_REQUIRED");

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 35000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        cache: "no-store",
        redirect: "follow",
        signal: ctrl.signal,
        body: JSON.stringify({ action: "member_admin", command, adminKey: key, ...data })
      });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch (_) { throw new Error("MEMBER_API_INVALID_RESPONSE"); }
      if (!response.ok || payload?.success === false || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || payload?.code || `HTTP_${response.status}`);
      }
      return payload;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("MEMBER_API_TIMEOUT_35S");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  function statusClass(status) {
    const s = String(status || "").toLowerCase();
    return ["active", "pending", "suspended"].includes(s) ? s : "pending";
  }

  function fmt(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" });
  }

  // Only render profile images from Google-hosted sources. PHOTO_URL is populated
  // by the backend only after a verified Google Identity credential is accepted.
  function verifiedGooglePhoto(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const googleHosted = u.protocol === "https:" && (
        host === "googleusercontent.com" ||
        host.endsWith(".googleusercontent.com")
      );
      return googleHosted ? u.href : "";
    } catch (_) {
      return "";
    }
  }

  function avatarHtml(member, size = "normal") {
    const photo = verifiedGooglePhoto(member && member.photoUrl);
    const title = photo
      ? "Foto profil Google Account"
      : "Foto Google belum tersedia — user belum login menggunakan Google Account";
    if (photo) {
      return `<span class="sf-google-avatar ${size === "small" ? "small" : ""}" title="${esc(title)}"><img src="${esc(photo)}" alt="Foto profil Google ${esc(member?.name || member?.email || "member")}" referrerpolicy="no-referrer"></span>`;
    }
    return `<span class="sf-google-avatar sf-google-avatar-empty ${size === "small" ? "small" : ""}" title="${esc(title)}" aria-label="${esc(title)}">?</span>`;
  }

  function injectAvatarStyles() {
    if (document.getElementById("sfMemberAvatarStylesREV317")) return;
    const style = document.createElement("style");
    style.id = "sfMemberAvatarStylesREV317";
    style.textContent = `
      .sf-member-table th:first-child,.sf-member-table td:first-child{width:64px;text-align:center;padding-left:12px;padding-right:12px}
      .sf-google-avatar{width:38px;height:38px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;vertical-align:middle;border:1px solid rgba(73,211,142,.28);background:#09251b;box-shadow:0 0 0 3px rgba(37,204,126,.055)}
      .sf-google-avatar.small{width:34px;height:34px}
      .sf-google-avatar img{width:100%;height:100%;display:block;object-fit:cover}
      .sf-google-avatar-empty{color:#6f8c80;font-size:13px;font-weight:800;border-style:dashed;background:rgba(7,31,24,.72)}
      .sf-member-online-profile{display:flex;align-items:center;gap:10px;min-width:0}
      .sf-member-online-profile>div{min-width:0}
      .sf-member-online-profile strong,.sf-member-online-profile small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function injectNav() {
    const nav = document.querySelector(".side-nav");
    if (!nav || document.getElementById("sfMemberParent")) return;

    const wrap = document.createElement("div");
    wrap.className = "sf-member-nav-wrap";
    wrap.innerHTML = `
      <button id="sfMemberParent" class="sf-member-parent" type="button" aria-expanded="false">
        <span class="nav-icon">◫</span><span>Member Skill Fusion</span><span class="sf-member-chevron">›</span>
      </button>
      <div id="sfMemberSubnav" class="sf-member-subnav" hidden>
        <button type="button" data-sf-member-view="dashboard" class="active"><span>▦</span><span>Dashboard</span></button>
        <button type="button" data-sf-member-view="add-user"><span>＋</span><span>Tambah User</span></button>
        <button type="button" data-sf-member-view="users"><span>☷</span><span>Manajemen User</span></button>
      </div>`;

    const settings = nav.querySelector('[data-nav="settings"]');
    if (settings) settings.insertAdjacentElement("beforebegin", wrap);
    else nav.appendChild(wrap);

    wrap.querySelector("#sfMemberParent").addEventListener("click", () => {
      const parent = wrap.querySelector("#sfMemberParent");
      const sub = wrap.querySelector("#sfMemberSubnav");
      const opening = parent.getAttribute("aria-expanded") !== "true";
      parent.setAttribute("aria-expanded", opening ? "true" : "false");
      sub.hidden = !opening;
      if (opening) openMemberView("dashboard");
    });

    wrap.querySelectorAll("[data-sf-member-view]").forEach(btn => {
      btn.addEventListener("click", () => openMemberView(btn.dataset.sfMemberView));
    });

    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => closeMemberArea(), true);
    });
  }

  function injectSection() {
    const content = document.querySelector("main.content");
    if (!content || document.getElementById("memberSkillFusionSection")) return;

    const section = document.createElement("section");
    section.id = "memberSkillFusionSection";
    section.className = "view-section";
    section.innerHTML = `
      <div id="sfMemberConfigAlert" class="sf-member-alert" hidden></div>

      <div id="sfMemberDashboardView" class="sf-member-view">
        <div class="sf-member-toolbar">
          <div class="sf-member-title-wrap">
            <div class="panel-kicker">MEMBER SKILL FUSION</div>
            <h2>Dashboard Member</h2>
            <p>Kelola akses member Google Account, approval, session, dan status online.</p>
          </div>
          <button id="sfMemberRefreshBtn" class="button button-primary" type="button">↻ Refresh</button>
        </div>
        <div class="sf-member-stat-grid">
          <article class="sf-member-stat"><span>TOTAL USER</span><strong id="sfMemberTotal">0</strong><small>Semua member terdaftar</small></article>
          <article class="sf-member-stat online"><span>USER ONLINE</span><strong id="sfMemberOnline">0</strong><small>Sedang aktif sekarang</small></article>
          <article class="sf-member-stat pending"><span>PENDING</span><strong id="sfMemberPending">0</strong><small>Menunggu persetujuan owner</small></article>
          <article class="sf-member-stat suspended"><span>SUSPENDED</span><strong id="sfMemberSuspended">0</strong><small>Akses sedang diblokir</small></article>
        </div>
        <section class="panel sf-member-panel">
          <div class="sf-member-panel-head"><div><h3>Member Online Sekarang</h3><p>Online dihitung dari heartbeat session aktif.</p></div></div>
          <div id="sfMemberOnlineList" class="sf-member-online-list"></div>
        </section>
        <section class="panel sf-member-panel">
          <div class="sf-member-panel-head"><div><h3>Aktivitas Member Terbaru</h3><p>Foto dan nama berasal dari Google Account setelah user login Google pertama kali.</p></div></div>
          <div class="sf-member-table-wrap">
            <table class="sf-member-table">
              <thead><tr><th>Foto</th><th>Email</th><th>Nama</th><th>Status</th><th>Online</th><th>Last Login</th><th>Last Seen</th></tr></thead>
              <tbody id="sfMemberRecentBody"></tbody>
            </table>
          </div>
        </section>
      </div>

      <div id="sfMemberAddView" class="sf-member-view" hidden>
        <div class="sf-member-toolbar">
          <div class="sf-member-title-wrap"><div class="panel-kicker">MEMBER SKILL FUSION</div><h2>Tambah User</h2><p>Tambah email manual sebagai Pending atau langsung Active. Foto profil tidak bisa diisi manual dan hanya diambil saat Google Login.</p></div>
        </div>
        <section class="panel sf-member-panel">
          <form id="sfMemberAddForm" class="sf-member-form">
            <label><span>Email Google</span><input id="sfMemberAddEmail" type="email" required placeholder="member@gmail.com"></label>
            <label><span>Nama sementara</span><input id="sfMemberAddName" type="text" placeholder="Opsional — akan diperbarui dari Google saat login"></label>
            <label><span>Status awal</span><select id="sfMemberAddStatus"><option value="ACTIVE">ACTIVE</option><option value="PENDING">PENDING</option></select></label>
            <label><span>Catatan</span><input id="sfMemberAddNotes" type="text" placeholder="Opsional"></label>
            <div class="sf-member-form-full"><button class="button button-primary" type="submit">+ Tambah Member</button></div>
          </form>
        </section>
      </div>

      <div id="sfMemberUsersView" class="sf-member-view" hidden>
        <div class="sf-member-toolbar">
          <div class="sf-member-title-wrap"><div class="panel-kicker">MEMBER SKILL FUSION</div><h2>Manajemen User</h2><p>Foto profil hanya ditampilkan dari Google Account terverifikasi.</p></div>
          <input id="sfMemberSearch" class="sf-member-search" type="search" placeholder="Cari email, nama, status...">
        </div>
        <section class="panel sf-member-panel">
          <div class="sf-member-table-wrap">
            <table class="sf-member-table">
              <thead><tr><th>Foto</th><th>Email</th><th>Nama</th><th>Status</th><th>Online</th><th>Terdaftar</th><th>Last Seen</th><th>Aksi</th></tr></thead>
              <tbody id="sfMemberUsersBody"></tbody>
            </table>
          </div>
          <div id="sfMemberEmpty" class="sf-member-empty" hidden>Tidak ada member yang cocok.</div>
        </section>
      </div>`;
    content.appendChild(section);

    document.getElementById("sfMemberRefreshBtn").addEventListener("click", () => loadMembers(false));
    document.getElementById("sfMemberSearch").addEventListener("input", renderManagement);
    document.getElementById("sfMemberAddForm").addEventListener("submit", addMember);
    document.getElementById("sfMemberUsersBody").addEventListener("click", handleAction);
  }

  function hideExistingViews() {
    ["dashboardSection", "addUserSection", "settingsSection"].forEach(id => {
      document.getElementById(id)?.classList.remove("active-section");
    });
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
  }

  function closeMemberArea() {
    document.getElementById("memberSkillFusionSection")?.classList.remove("active-section");
    document.getElementById("sfMemberParent")?.classList.remove("active");
    stopRefresh();
  }

  function openMemberView(view) {
    hideExistingViews();
    const section = document.getElementById("memberSkillFusionSection");
    const parent = document.getElementById("sfMemberParent");
    const sub = document.getElementById("sfMemberSubnav");
    if (!section || !parent || !sub) return;

    parent.classList.add("active");
    parent.setAttribute("aria-expanded", "true");
    sub.hidden = false;
    section.classList.add("active-section");
    state.activeView = view || "dashboard";

    const map = {
      dashboard: "sfMemberDashboardView",
      "add-user": "sfMemberAddView",
      users: "sfMemberUsersView"
    };
    document.querySelectorAll("#memberSkillFusionSection .sf-member-view").forEach(v => { v.hidden = true; });
    const target = document.getElementById(map[state.activeView] || map.dashboard);
    if (target) target.hidden = false;
    sub.querySelectorAll("[data-sf-member-view]").forEach(btn => btn.classList.toggle("active", btn.dataset.sfMemberView === state.activeView));

    updateConfigAlert();
    if (state.activeView === "add-user") {
      setTimeout(() => document.getElementById("sfMemberAddEmail")?.focus(), 30);
    } else {
      loadMembers(true);
    }
    scheduleRefresh();
  }

  function updateConfigAlert(message = "", isError = false) {
    const alert = document.getElementById("sfMemberConfigAlert");
    if (!alert) return;
    const url = memberApiUrl();
    if (!url) {
      alert.hidden = false;
      alert.classList.remove("error");
      alert.innerHTML = `Member API belum dikonfigurasi. Isi <strong>memberApiUrl</strong> di config.js.`;
      return;
    }
    if (message) {
      alert.hidden = false;
      alert.classList.toggle("error", !!isError);
      alert.textContent = message;
    } else {
      alert.hidden = true;
      alert.classList.remove("error");
      alert.textContent = "";
    }
  }

  async function loadMembers(silent = false) {
    if (state.loading || !memberApiUrl()) return;
    state.loading = true;
    if (!silent) setBusy(true, "Mengambil data Member Skill Fusion...");
    try {
      const result = await callMemberAdmin("list_members");
      state.members = Array.isArray(result.members) ? result.members : [];
      renderAll();
      updateConfigAlert();
    } catch (err) {
      updateConfigAlert(`Member API: ${err.message || err}`, true);
      if (!silent) toast(err.message || String(err), true);
    } finally {
      state.loading = false;
      if (!silent) setBusy(false);
    }
  }

  function renderAll() {
    const members = state.members.slice();
    document.getElementById("sfMemberTotal").textContent = members.length;
    document.getElementById("sfMemberOnline").textContent = members.filter(m => m.online).length;
    document.getElementById("sfMemberPending").textContent = members.filter(m => String(m.status).toUpperCase() === "PENDING").length;
    document.getElementById("sfMemberSuspended").textContent = members.filter(m => String(m.status).toUpperCase() === "SUSPENDED").length;
    renderOnline();
    renderRecent();
    renderManagement();
  }

  function renderOnline() {
    const box = document.getElementById("sfMemberOnlineList");
    if (!box) return;
    const online = state.members.filter(m => m.online).sort((a,b) => String(a.email).localeCompare(String(b.email)));
    if (!online.length) {
      box.innerHTML = `<div class="sf-member-empty">Belum ada member online.</div>`;
      return;
    }
    box.innerHTML = online.map(m => `
      <div class="sf-member-online-row">
        <span class="sf-member-online-dot"></span>
        <div class="sf-member-online-profile">
          ${avatarHtml(m, "small")}
          <div><strong>${esc(m.email)}</strong><small>${esc(m.name || "-")}</small></div>
        </div>
        <time>${esc(fmt(m.lastSeenAt))}</time>
      </div>`).join("");
  }

  function renderRecent() {
    const body = document.getElementById("sfMemberRecentBody");
    if (!body) return;
    const rows = state.members.slice()
      .sort((a,b) => new Date(b.lastSeenAt || b.createdAt || 0) - new Date(a.lastSeenAt || a.createdAt || 0))
      .slice(0, 10);
    body.innerHTML = rows.length ? rows.map(m => `
      <tr>
        <td>${avatarHtml(m)}</td>
        <td>${esc(m.email)}</td>
        <td>${esc(m.name || "-")}</td>
        <td><span class="sf-member-status ${statusClass(m.status)}">${esc(m.status)}</span></td>
        <td>${m.online ? "● Online" : "Offline"}</td>
        <td>${esc(fmt(m.lastLoginAt))}</td>
        <td>${esc(fmt(m.lastSeenAt))}</td>
      </tr>`).join("") : `<tr><td colspan="7" class="sf-member-empty">Belum ada member.</td></tr>`;
  }

  function actionHtml(m) {
    const email = encodeURIComponent(m.email || "");
    const status = String(m.status || "").toUpperCase();
    const out = [];
    if (status === "PENDING") out.push(`<button class="sf-member-action" data-member-action="activate" data-email="${email}">Aktifkan</button>`);
    if (status === "ACTIVE") out.push(`<button class="sf-member-action warn" data-member-action="suspend" data-email="${email}">Suspend</button>`);
    if (status === "SUSPENDED") out.push(`<button class="sf-member-action" data-member-action="activate" data-email="${email}">Aktifkan</button>`);
    out.push(`<button class="sf-member-action" data-member-action="resend" data-email="${email}">Email</button>`);
    out.push(`<button class="sf-member-action danger" data-member-action="remove" data-email="${email}">Remove</button>`);
    return out.join("");
  }

  function renderManagement() {
    const body = document.getElementById("sfMemberUsersBody");
    const empty = document.getElementById("sfMemberEmpty");
    const search = String(document.getElementById("sfMemberSearch")?.value || "").trim().toLowerCase();
    if (!body) return;
    const rows = state.members.filter(m => !search || [m.email,m.name,m.status].join(" ").toLowerCase().includes(search));
    body.innerHTML = rows.map(m => `
      <tr>
        <td>${avatarHtml(m)}</td>
        <td>${esc(m.email)}</td>
        <td>${esc(m.name || "-")}</td>
        <td><span class="sf-member-status ${statusClass(m.status)}">${esc(m.status)}</span></td>
        <td>${m.online ? "● Online" : "Offline"}</td>
        <td>${esc(fmt(m.createdAt))}</td>
        <td>${esc(fmt(m.lastSeenAt))}</td>
        <td><div class="sf-member-actions">${actionHtml(m)}</div></td>
      </tr>`).join("");
    if (empty) empty.hidden = rows.length > 0;
  }

  async function addMember(e) {
    e.preventDefault();
    const email = String(document.getElementById("sfMemberAddEmail").value || "").trim();
    const name = String(document.getElementById("sfMemberAddName").value || "").trim();
    const status = String(document.getElementById("sfMemberAddStatus").value || "ACTIVE").trim();
    const notes = String(document.getElementById("sfMemberAddNotes").value || "").trim();
    if (!email) return;
    setBusy(true, "Menambahkan member...");
    try {
      await callMemberAdmin("add_member", { email, name, status, notes });
      e.currentTarget.reset();
      document.getElementById("sfMemberAddStatus").value = "ACTIVE";
      await loadMembers(true);
      toast(`Member ${email} berhasil ditambahkan.`);
      openMemberView("users");
    } catch (err) {
      toast(err.message || String(err), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(e) {
    const btn = e.target.closest("[data-member-action]");
    if (!btn) return;
    const email = decodeURIComponent(btn.dataset.email || "");
    const action = btn.dataset.memberAction;
    if (!email) return;

    if (action === "remove" && !confirm(`Remove member ${email}? Session aktifnya juga akan diputus.`)) return;
    if (action === "suspend" && !confirm(`Suspend ${email}? Login dan session aktif akan diputus.`)) return;

    setBusy(true, "Memproses member...");
    try {
      if (action === "activate") await callMemberAdmin("set_status", { email, status: "ACTIVE", sendEmail: true });
      else if (action === "suspend") await callMemberAdmin("set_status", { email, status: "SUSPENDED" });
      else if (action === "remove") await callMemberAdmin("remove_member", { email });
      else if (action === "resend") await callMemberAdmin("send_status_email", { email });
      await loadMembers(true);
      toast(`${email}: ${action} berhasil.`);
    } catch (err) {
      toast(err.message || String(err), true);
    } finally {
      setBusy(false);
    }
  }

  function stopRefresh() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
  }

  function scheduleRefresh() {
    stopRefresh();
    if (state.activeView === "add-user") return;
    const tick = async () => {
      const section = document.getElementById("memberSkillFusionSection");
      if (!section?.classList.contains("active-section")) return;
      if (!document.hidden) await loadMembers(true);
      state.refreshTimer = setTimeout(tick, MEMBER_REFRESH_MS);
    };
    state.refreshTimer = setTimeout(tick, MEMBER_REFRESH_MS);
  }

  function init() {
    injectAvatarStyles();
    injectNav();
    injectSection();
    updateConfigAlert();

    const app = document.getElementById("appView");
    if (app && window.MutationObserver) {
      new MutationObserver(() => {
        if (app.hidden) closeMemberArea();
      }).observe(app, { attributes: true, attributeFilter: ["hidden"] });
    }

    window.SF_MEMBER_ADMIN = {
      getApiUrl: () => memberApiUrl() || DEFAULT_ADMIN_API(),
      refresh: () => loadMembers(false),
      open: () => openMemberView("dashboard")
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();