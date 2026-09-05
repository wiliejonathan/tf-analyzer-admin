(() => {
  "use strict";

  const cfg = window.TF_ADMIN_CONFIG || {};
  const DEFAULT_API_URL = String(cfg.apiUrl || "").trim();
  const PRIMARY_ADMIN_EMAIL = "wiliejonathan@gmail.com";
  const ADMIN_EMAILS = new Set([
    PRIMARY_ADMIN_EMAIL,
    "wiliejonathan1999@gmail.com"
  ]);
  const PLAN_OPTIONS = [
    ["TEST_1_DAY", "Trial 1 Hari"],
    ["MAIN_1M", "1 Bulan"],
    ["MAIN_3M", "3 Bulan"],
    ["MAIN_6M", "6 Bulan"],
    ["MAIN_1Y", "1 Tahun"],
    ["MAIN_PERMANENT", "Permanent"],
    ["BUNDLE_1M_ISIGNAL_1D", "1 Bulan + iSignal 1 Hari"],
    ["BUNDLE_1M_ISIGNAL_PREMIUM", "1 Bulan + iSignal Premium"],
    ["BUNDLE_3M_ISIGNAL_1D", "3 Bulan + iSignal 1 Hari"],
    ["BUNDLE_3M_ISIGNAL_PREMIUM", "3 Bulan + iSignal Premium"]
  ];
  const STORAGE = {
    remember: "tf_admin_remember_v303",
    adminKey: "tf_admin_key_v303",
    apiUrl: "tf_admin_api_url_v303",
    autoEnabled: "tf_admin_auto_enabled_v303",
    autoMs: "tf_admin_auto_ms_v303"
  };

  let activeApiUrl = String(localStorage.getItem(STORAGE.apiUrl) || DEFAULT_API_URL || "").trim();
  let autoRefreshEnabled = localStorage.getItem(STORAGE.autoEnabled) !== "false";
  let autoRefreshMs = Math.max(10000, Number(localStorage.getItem(STORAGE.autoMs) || cfg.autoRefreshMs || 30000));
  let pageSize = Number(cfg.defaultPageSize || 10);
  let currentPage = 1;
  let adminKey = "";
  let users = [];
  let toastTimer = null;
  let autoRefreshTimer = null;
  let autoRefreshRunning = false;
  let emptyResponseStreak = 0;
  let managementMode = false;

  const $ = (id) => document.getElementById(id);
  const els = {
    loginView: $("loginView"), appView: $("appView"), loginForm: $("loginForm"), adminKeyInput: $("adminKeyInput"), toggleAdminKeyVisibility: $("toggleAdminKeyVisibility"), rememberAdminKey: $("rememberAdminKey"), configWarning: $("configWarning"),
    lockBtn: $("lockBtn"), dashboardSection: $("dashboardSection"), addUserSection: $("addUserSection"), settingsSection: $("settingsSection"), usersSection: $("usersSection"),
    statTotal: $("statTotal"), statActive: $("statActive"), statPc: $("statPc"), statMobile: $("statMobile"), sideTotal: $("sideTotal"), sidePc: $("sidePc"), sideMobile: $("sideMobile"), sideActive: $("sideActive"), sideExpired: $("sideExpired"),
    searchInput: $("searchInput"), searchCount: $("searchCount"), usersBody: $("usersBody"), mobileUsers: $("mobileUsers"), emptyState: $("emptyState"),
    addUserForm: $("addUserForm"), newEmail: $("newEmail"), newPlan: $("newPlan"), newTokenResult: $("newTokenResult"), newTokenValue: $("newTokenValue"), copyNewTokenBtn: $("copyNewTokenBtn"),
    resetAllBtn: $("resetAllBtn"), sendAllBtn: $("sendAllBtn"), sendAllUpdateBtn: $("sendAllUpdateBtn"), prevPageBtn: $("prevPageBtn"), nextPageBtn: $("nextPageBtn"), pageButtons: $("pageButtons"), pageSummary: $("pageSummary"), pageSizeSelect: $("pageSizeSelect"),
    customApiUrlInput: $("customApiUrlInput"), saveApiBtn: $("saveApiBtn"), resetApiBtn: $("resetApiBtn"), apiStatusLabel: $("apiStatusLabel"), apiStatusDot: $("apiStatusDot"), apiStatusText: $("apiStatusText"),
    autoRefreshToggle: $("autoRefreshToggle"), autoRefreshInterval: $("autoRefreshInterval"), autoRefreshLabel: $("autoRefreshLabel"), lastRefreshText: $("lastRefreshText"), rememberStatusLabel: $("rememberStatusLabel"), forgetSessionBtn: $("forgetSessionBtn"),
    planConfirmModal: $("planConfirmModal"), planConfirmText: $("planConfirmText"), planConfirmSummary: $("planConfirmSummary"), planConfirmCancel: $("planConfirmCancel"), planConfirmOk: $("planConfirmOk"),
    emailEditModal: $("emailEditModal"), emailEditForm: $("emailEditForm"), emailEditCurrent: $("emailEditCurrent"), emailEditInput: $("emailEditInput"), emailEditCancel: $("emailEditCancel"),
    deleteUserModal: $("deleteUserModal"), deleteUserText: $("deleteUserText"), deleteUserSummary: $("deleteUserSummary"), deleteUserNo: $("deleteUserNo"), deleteUserConfirm: $("deleteUserConfirm"),
    resetAllModal: $("resetAllModal"), resetAllNo: $("resetAllNo"), resetAllConfirm: $("resetAllConfirm"),
    busyOverlay: $("busyOverlay"), busyText: $("busyText"), toast: $("toast")
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const highlight = (value, query) => {
    const safe = escapeHtml(value ?? "");
    if (!query) return safe;
    const q = String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!q) return safe;
    return safe.replace(new RegExp(`(${q})`, "ig"), "<mark>$1</mark>");
  };

  function setBusy(on, message = "Memproses...") {
    els.busyText.textContent = message;
    els.busyOverlay.hidden = !on;
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle("error", !!error);
    els.toast.hidden = false;
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, error ? 6500 : 3200);
  }

  function isValidApiUrl(value = activeApiUrl) {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(String(value || "").trim());
  }

  function ensureConfigured() {
    const ok = isValidApiUrl(activeApiUrl);
    els.configWarning.hidden = ok;
    if (!ok) els.configWarning.textContent = "Backend Apps Script /exec belum valid. Gunakan URL Web App yang berakhiran /exec.";
    updateApiSettingsUi(ok);
    return ok;
  }

  function updateApiSettingsUi(ok = isValidApiUrl(activeApiUrl), message = "") {
    if (!els.customApiUrlInput) return;
    if (document.activeElement !== els.customApiUrlInput) els.customApiUrlInput.value = activeApiUrl;
    els.apiStatusLabel.textContent = ok ? "Configured" : "Invalid";
    els.apiStatusDot.classList.toggle("ok", ok);
    els.apiStatusDot.classList.toggle("bad", !ok);
    els.apiStatusText.textContent = message || (ok
      ? (activeApiUrl === DEFAULT_API_URL ? "Menggunakan API default dari config.js." : "Menggunakan Custom API tersimpan di browser ini.")
      : "URL API belum valid.");
  }

  function updateRememberUi() {
    const remembered = localStorage.getItem(STORAGE.remember) === "true" && !!localStorage.getItem(STORAGE.adminKey);
    els.rememberStatusLabel.textContent = remembered ? "Remember Aktif" : "Tidak Disimpan";
  }

  function updateAutoRefreshUi() {
    els.autoRefreshToggle.checked = !!autoRefreshEnabled;
    const allowed = [10000, 15000, 30000, 60000, 120000];
    if (!allowed.includes(autoRefreshMs)) autoRefreshMs = 30000;
    els.autoRefreshInterval.value = String(autoRefreshMs);
    els.autoRefreshLabel.textContent = autoRefreshEnabled ? `Aktif • ${Math.round(autoRefreshMs / 1000)}s` : "Nonaktif";
  }

  async function callApi(command, data = {}, options = {}) {
    if (!ensureConfigured()) throw new Error("API_URL_NOT_CONFIGURED");
    if (!adminKey) throw new Error("ADMIN_KEY_REQUIRED");

    const timeoutMs = Math.max(6000, Number(options.timeoutMs || 14000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(activeApiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({ action: "admin_dashboard", command, adminKey, ...data })
      });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch (_) { throw new Error(`Server tidak mengembalikan JSON (HTTP ${response.status}). Periksa deployment Apps Script.`); }
      if (!response.ok || payload?.success === false || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || payload?.code || `HTTP_${response.status}`);
      }
      return payload;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error(`API_TIMEOUT_${Math.round(timeoutMs / 1000)}S`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchUsersWithRecovery() {
    let result;
    try {
      // REV303 backend: authenticates + reads users without the heavier online-status refresh.
      result = await callApi("login_snapshot", {}, { timeoutMs: 9000 });
    } catch (err) {
      // Backward compatible with REV298 backend while user is redeploying Apps Script.
      if (/UNKNOWN_ADMIN_COMMAND/i.test(err.message || "")) {
        result = await callApi("list_users");
      } else {
        throw err;
      }
    }
    let list = Array.isArray(result.users) ? result.users : [];

    if (list.length === 0 && Number(result.count || 0) === 0) {
      await delay(300);
      const retry = await callApi("list_users", {}, { timeoutMs: 12000 });
      const retryList = Array.isArray(retry.users) ? retry.users : [];
      if (retryList.length > 0) {
        result = retry;
        list = retryList;
      }
    }
    return { result, list };
  }

  function normalizedEmail(user) {
    return String(user?.email || "").trim().toLowerCase();
  }

  function isAdminUser(user) {
    return ADMIN_EMAILS.has(normalizedEmail(user));
  }

  function adminSortPriority(user) {
    const email = normalizedEmail(user);
    if (email === PRIMARY_ADMIN_EMAIL) return 0;
    if (ADMIN_EMAILS.has(email)) return 1;
    return 2;
  }

  function sortUsersForDisplay(list) {
    return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
      const priority = adminSortPriority(a) - adminSortPriority(b);
      if (priority !== 0) return priority;
      return String(a?.email || "").localeCompare(String(b?.email || ""), "id", { sensitivity: "base" });
    });
  }

  function displayStatus(user) {
    return isAdminUser(user) ? "ADMIN" : (user?.status || "-");
  }

  function searchableText(user) {
    return [user.email, user.plan, user.token, user.licenseId, displayStatus(user), user.lastSeenPc, user.lastSeenMobile, user.productName, user.expiredAt]
      .join(" ").toLowerCase();
  }

  function filteredUsers() {
    const q = els.searchInput.value.trim().toLowerCase();
    return q ? users.filter(u => searchableText(u).includes(q)) : users.slice();
  }

  function updateStats() {
    const total = users.length;
    const active = users.filter(u => u.validNow).length;
    const pc = users.filter(u => u.pcOnline).length;
    const mobile = users.filter(u => u.mobileOnline).length;
    const expired = Math.max(0, total - active);
    els.statTotal.textContent = total;
    els.statActive.textContent = active;
    els.statPc.textContent = pc;
    els.statMobile.textContent = mobile;
    els.sideTotal.textContent = total;
    els.sideActive.textContent = active;
    els.sidePc.textContent = pc;
    els.sideMobile.textContent = mobile;
    els.sideExpired.textContent = expired;
  }

  function statusDots(user) {
    return `<span class="status-dot ${user.pcOnline ? "online" : "offline"}" title="PC ${user.pcOnline ? "Online" : "Offline"}"></span><span class="status-dot ${user.mobileOnline ? "online" : "offline"}" title="Mobile ${user.mobileOnline ? "Online" : "Offline"}"></span>`;
  }

  function actionButtons(user) {
    const id = encodeURIComponent(user.licenseId || "");
    const deleteButton = managementMode
      ? `<button class="action-delete" data-action="delete_user" data-id="${id}" title="Delete User" aria-label="Delete user ${escapeHtml(user.email || "")}">×</button>`
      : "";
    return `<button class="action-reset" data-action="reset_pc" data-id="${id}">Reset PC</button>
      <button class="action-reset" data-action="reset_mobile" data-id="${id}">Reset Mobile</button>
      <button class="action-mail" data-action="send_email" data-id="${id}">Email</button>
      <button class="action-update" data-action="send_update_email" data-id="${id}">Update</button>${deleteButton}`;
  }

  function editableEmailHtml(user, query, compact = false) {
    const email = user.email || "-";
    if (!managementMode) return highlight(email, query);
    const id = encodeURIComponent(user.licenseId || "");
    return `<div class="email-manage${compact ? " compact" : ""}">
      <button class="email-edit-button" type="button" data-action="edit_email" data-id="${id}" title="Edit email" aria-label="Edit email ${escapeHtml(email)}">✎</button>
      <span class="email-value">${highlight(email, query)}</span>
    </div>`;
  }

  function statusPill(user, query) {
    const label = displayStatus(user);
    if (isAdminUser(user)) return `<span class="state-pill admin">${highlight(label, query)}</span>`;
    const validClass = user.validNow ? "" : " inactive";
    return `<span class="state-pill${validClass}">${highlight(label, query)}</span>`;
  }

  function editablePlanHtml(user, compact = false) {
    if (!managementMode) return `<span class="plan-pill">${escapeHtml(user.plan || "-")}</span>`;
    const current = String(user.plan || "").trim().toUpperCase();
    const options = PLAN_OPTIONS.map(([value, label]) =>
      `<option value="${value}" ${value === current ? "selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");
    return `<select class="plan-edit-select${compact ? " compact" : ""}" data-action="change_plan" data-id="${encodeURIComponent(user.licenseId || "")}" data-current-plan="${escapeHtml(current)}" aria-label="Ubah plan ${escapeHtml(user.email || "user")}">${options}</select>`;
  }

  function tableRow(user, query) {
    return `<tr>
      <td class="status-cell">${statusDots(user)}</td>
      <td>${editableEmailHtml(user, query)}</td>
      <td>${managementMode ? editablePlanHtml(user) : `<span class="plan-pill">${highlight(user.plan || "-", query)}</span>`}</td>
      <td><div class="token-box"><span class="token-text" title="${escapeHtml(user.token || "")}">${highlight(user.token || "-", query)}</span><button class="action-mail" data-action="copy" data-token="${escapeHtml(user.token || "")}">Copy</button></div></td>
      <td>${statusPill(user, query)}<div style="margin-top:4px;color:#63766f;font-size:8px">${highlight(user.licenseId || "", query)}</div></td>
      <td>${highlight(user.lastSeenPc || "-", query)}</td>
      <td>${highlight(user.lastSeenMobile || "-", query)}</td>
      <td><div class="actions">${actionButtons(user)}</div></td>
    </tr>`;
  }

  function mobileCard(user, query) {
    return `<article class="user-card">
      <div class="user-card-top"><div><h3>${editableEmailHtml(user, query, true)}</h3><div class="license-id">${highlight(user.licenseId || "-", query)}</div></div><div>${statusDots(user)}</div></div>
      <div class="user-fields">
        <div class="user-field"><span>Plan</span><strong>${managementMode ? editablePlanHtml(user, true) : highlight(user.plan || "-", query)}</strong></div>
        <div class="user-field"><span>Status</span><strong>${statusPill(user, query)}</strong></div>
        <div class="user-field"><span>Token</span><strong>${highlight(user.token || "-", query)}</strong></div>
        <div class="user-field"><span>Last Seen PC</span><strong>${highlight(user.lastSeenPc || "-", query)}</strong></div>
        <div class="user-field"><span>Last Seen Mobile</span><strong>${highlight(user.lastSeenMobile || "-", query)}</strong></div>
      </div>
      <div class="user-card-actions"><button class="action-mail" data-action="copy" data-token="${escapeHtml(user.token || "")}">Copy Token</button>${actionButtons(user)}</div>
    </article>`;
  }

  function paginationNumbers(totalPages) {
    const values = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) values.push(i);
      return values;
    }
    values.push(1);
    if (currentPage > 4) values.push("...");
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) values.push(i);
    if (currentPage < totalPages - 3) values.push("...");
    values.push(totalPages);
    return values;
  }

  function renderUsers() {
    const query = els.searchInput.value.trim();
    const visible = filteredUsers();
    const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * pageSize;
    const pageItems = visible.slice(startIndex, startIndex + pageSize);

    els.usersBody.innerHTML = pageItems.map(u => tableRow(u, query)).join("");
    els.mobileUsers.innerHTML = pageItems.map(u => mobileCard(u, query)).join("");
    els.emptyState.hidden = visible.length > 0;
    els.searchCount.textContent = query ? `${visible.length}/${users.length}` : `${users.length} user`;

    const from = visible.length ? startIndex + 1 : 0;
    const to = Math.min(startIndex + pageSize, visible.length);
    els.pageSummary.textContent = `Menampilkan ${from} - ${to} dari ${visible.length} data`;
    els.prevPageBtn.disabled = currentPage <= 1;
    els.nextPageBtn.disabled = currentPage >= totalPages;

    els.pageButtons.innerHTML = paginationNumbers(totalPages).map(value => {
      if (value === "...") return `<span style="display:grid;place-items:center;width:22px;color:#71847d">…</span>`;
      return `<button class="page-button ${value === currentPage ? "active" : ""}" data-page="${value}" type="button">${value}</button>`;
    }).join("");
  }

  function applyUsers(list) {
    users = sortUsersForDisplay(list);
    updateStats();
    renderUsers();
    const time = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    els.lastRefreshText.textContent = `Data terakhir diperbarui ${time}.`;
  }

  async function loadUsers(silent = false) {
    if (autoRefreshRunning && silent) return;
    if (!silent) setBusy(true, "Mengambil data user...");
    if (silent) autoRefreshRunning = true;
    try {
      const result = await callApi("list_users");
      const nextUsers = Array.isArray(result.users) ? result.users : [];
      // Do not wipe a populated dashboard because of one transient empty Apps Script response.
      if (nextUsers.length === 0 && users.length > 0) {
        emptyResponseStreak += 1;
        if (emptyResponseStreak < 2) {
          els.lastRefreshText.textContent = "Menerima respons kosong sementara; data lama dipertahankan dan akan dicek ulang.";
          return;
        }
      } else {
        emptyResponseStreak = 0;
      }
      applyUsers(nextUsers);
    } catch (err) {
      if (!silent) showToast(err.message || String(err), true);
      els.lastRefreshText.textContent = silent ? `Auto refresh gagal: ${err.message || String(err)}` : els.lastRefreshText.textContent;
      if (/UNAUTHORIZED|ADMIN_/i.test(err.message || "")) lockDashboard(true);
      throw err;
    } finally {
      autoRefreshRunning = false;
      if (!silent) setBusy(false);
    }
  }

  function scheduleAutoRefresh() {
    stopAutoRefresh();
    updateAutoRefreshUi();
    if (!autoRefreshEnabled || !adminKey || els.appView.hidden) return;

    const run = async () => {
      if (!autoRefreshEnabled || !adminKey || els.appView.hidden) return;
      if (!document.hidden) {
        try { await loadUsers(true); } catch (_) {}
      }
      if (autoRefreshEnabled && adminKey && !els.appView.hidden) {
        autoRefreshTimer = setTimeout(run, autoRefreshMs);
      }
    };
    autoRefreshTimer = setTimeout(run, autoRefreshMs);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  function unlockDashboard() {
    els.loginView.hidden = true;
    els.appView.hidden = false;
    scheduleAutoRefresh();
  }

  function getSavedAdminKey() {
    return String(localStorage.getItem(STORAGE.adminKey) || "").trim();
  }

  function isDefinitiveAdminAuthError(error) {
    const message = String(error && error.message || error || "").toUpperCase();
    return /(^|\b)(ADMIN_UNAUTHORIZED|UNAUTHORIZED_GATEWAY|INVALID_ADMIN_KEY|ADMIN_KEY_INVALID)(\b|$)/.test(message);
  }

  function setAdminKeyVisibility(show) {
    const visible = !!show;
    if (!els.adminKeyInput || !els.toggleAdminKeyVisibility) return;
    els.adminKeyInput.type = visible ? "text" : "password";
    els.toggleAdminKeyVisibility.classList.toggle("is-visible", visible);
    els.toggleAdminKeyVisibility.setAttribute("aria-pressed", visible ? "true" : "false");
    els.toggleAdminKeyVisibility.setAttribute("aria-label", visible ? "Sembunyikan Admin Key" : "Tampilkan Admin Key");
    els.toggleAdminKeyVisibility.title = visible ? "Sembunyikan Admin Key" : "Tampilkan Admin Key";

    // REV311: force icon state inline as well as via CSS. This avoids stale/cached CSS
    // or browser default styles turning the eye button into a grey box.
    const eyeOpen = els.toggleAdminKeyVisibility.querySelector(".eye-open");
    const eyeClosed = els.toggleAdminKeyVisibility.querySelector(".eye-closed");
    if (eyeOpen) eyeOpen.style.display = visible ? "none" : "block";
    if (eyeClosed) eyeClosed.style.display = visible ? "block" : "none";
  }

  function clearRememberedLogin() {
    localStorage.removeItem(STORAGE.remember);
    localStorage.removeItem(STORAGE.adminKey);
    els.rememberAdminKey.checked = false;
    els.adminKeyInput.value = "";
    updateRememberUi();
  }

  function persistLoginIfRequested() {
    if (els.rememberAdminKey.checked) {
      localStorage.setItem(STORAGE.remember, "true");
      localStorage.setItem(STORAGE.adminKey, adminKey);
    } else {
      clearRememberedLogin();
    }
    updateRememberUi();
  }

  function lockDashboard(clearRemembered = false) {
    adminKey = "";
    users = [];
    currentPage = 1;
    stopAutoRefresh();
    els.appView.hidden = true;
    els.loginView.hidden = false;
    if (clearRemembered) clearRememberedLogin();
    const savedKey = getSavedAdminKey();
    els.adminKeyInput.value = savedKey;
    els.rememberAdminKey.checked = !!savedKey && localStorage.getItem(STORAGE.remember) === "true";
    updateRememberUi();
    els.adminKeyInput.focus();
  }

  function activateNav(target) {
    managementMode = target === "users";
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === target));
    els.dashboardSection.classList.remove("active-section");
    els.addUserSection.classList.remove("active-section");
    els.settingsSection.classList.remove("active-section");

    if (target === "add-user") {
      els.addUserSection.classList.add("active-section");
      setTimeout(() => els.newEmail.focus(), 50);
    } else if (target === "settings") {
      els.settingsSection.classList.add("active-section");
      updateApiSettingsUi();
      updateAutoRefreshUi();
      updateRememberUi();
    } else {
      els.dashboardSection.classList.add("active-section");
      renderUsers();
      if (target === "users") setTimeout(() => els.usersSection.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    }
  }

  async function loginWithKey(key, remember, automatic = false) {
    adminKey = String(key || "").trim();
    if (!adminKey) return false;
    els.rememberAdminKey.checked = !!remember;
    setBusy(true, automatic ? "Memulihkan sesi admin..." : "Memverifikasi admin key...");
    try {
      // OPTIMIZED: list_users itself authenticates. This removes the old auth + list_users double request.
      const { list } = await fetchUsersWithRecovery();
      applyUsers(list);
      persistLoginIfRequested();
      unlockDashboard();
      showToast(automatic ? "Sesi admin dipulihkan." : "Dashboard terhubung.");
      // Refresh online status in background after the dashboard is already usable.
      setTimeout(() => loadUsers(true).catch(() => {}), 700);
      return true;
    } catch (err) {
      adminKey = "";
      // REV310: jangan hapus Remember hanya karena reload/auto-login mengalami timeout,
      // network error, Apps Script belum siap, atau error command sementara.
      // Saved key hanya dihapus jika backend secara eksplisit menyatakan key tidak sah.
      if (isDefinitiveAdminAuthError(err)) {
        clearRememberedLogin();
      } else {
        const savedKey = getSavedAdminKey();
        if (savedKey) {
          els.adminKeyInput.value = savedKey;
          els.rememberAdminKey.checked = localStorage.getItem(STORAGE.remember) === "true";
          updateRememberUi();
        }
      }
      showToast(err.message || "Login admin gagal.", true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  els.toggleAdminKeyVisibility?.addEventListener("click", () => {
    setAdminKeyVisibility(els.adminKeyInput.type === "password");
    els.adminKeyInput.focus({ preventScroll: true });
    const len = els.adminKeyInput.value.length;
    try { els.adminKeyInput.setSelectionRange(len, len); } catch (_) {}
  });

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ensureConfigured()) return;
    await loginWithKey(els.adminKeyInput.value, els.rememberAdminKey.checked, false);
  });

  els.rememberAdminKey.addEventListener("change", () => {
    if (!els.rememberAdminKey.checked) {
      localStorage.removeItem(STORAGE.remember);
      localStorage.removeItem(STORAGE.adminKey);
      updateRememberUi();
    }
  });

  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => activateNav(btn.dataset.nav)));
  els.lockBtn.addEventListener("click", () => lockDashboard(false));
  els.searchInput.addEventListener("input", () => { currentPage = 1; renderUsers(); });
  els.pageSizeSelect.value = String(pageSize);
  els.pageSizeSelect.addEventListener("change", () => { pageSize = Number(els.pageSizeSelect.value || 10); currentPage = 1; renderUsers(); });
  els.prevPageBtn.addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderUsers(); } });
  els.nextPageBtn.addEventListener("click", () => { const pages = Math.max(1, Math.ceil(filteredUsers().length / pageSize)); if (currentPage < pages) { currentPage++; renderUsers(); } });
  els.pageButtons.addEventListener("click", (e) => { const btn = e.target.closest("button[data-page]"); if (!btn) return; currentPage = Number(btn.dataset.page); renderUsers(); });

  els.addUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = els.newEmail.value.trim();
    const plan = els.newPlan.value;
    if (!email || !plan) return;
    setBusy(true, "Membuat license baru...");
    try {
      const result = await callApi("add_user", { email, plan });
      const token = result?.user?.token || "";
      els.newTokenValue.textContent = token;
      els.newTokenResult.hidden = !token;
      els.addUserForm.reset();
      await loadUsers(true);
      showToast(`User ${result?.user?.email || email} berhasil ditambahkan.`);
    } catch (err) { showToast(err.message || String(err), true); }
    finally { setBusy(false); }
  });

  els.copyNewTokenBtn.addEventListener("click", async () => {
    const token = els.newTokenValue.textContent || "";
    if (!token) return;
    try { await navigator.clipboard.writeText(token); showToast("Token disalin."); }
    catch (_) { showToast("Gagal menyalin token.", true); }
  });

  let emailEditLicenseId = "";
  let deleteUserResolver = null;

  function openEmailEditModal(user) {
    if (!user || !els.emailEditModal) return;
    emailEditLicenseId = String(user.licenseId || "");
    els.emailEditCurrent.textContent = user.email || "-";
    els.emailEditInput.value = user.email || "";
    els.emailEditModal.hidden = false;
    els.emailEditModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => {
      els.emailEditInput.focus();
      els.emailEditInput.select();
    }, 30);
  }

  function closeEmailEditModal() {
    if (!els.emailEditModal || els.emailEditModal.hidden) return;
    els.emailEditModal.hidden = true;
    els.emailEditModal.setAttribute("aria-hidden", "true");
    emailEditLicenseId = "";
    if (!els.planConfirmModal || els.planConfirmModal.hidden) {
      if (!els.deleteUserModal || els.deleteUserModal.hidden) document.body.classList.remove("modal-open");
    }
  }

  els.emailEditCancel.addEventListener("click", closeEmailEditModal);
  els.emailEditModal.addEventListener("click", (e) => {
    if (e.target?.dataset?.modalDismiss === "true") closeEmailEditModal();
  });
  els.emailEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const licenseId = emailEditLicenseId;
    const email = String(els.emailEditInput.value || "").trim().toLowerCase();
    const user = users.find(u => u.licenseId === licenseId);
    if (!licenseId || !user) return closeEmailEditModal();
    if (!email || !els.emailEditInput.checkValidity()) {
      els.emailEditInput.reportValidity();
      return;
    }
    if (email === normalizedEmail(user)) {
      closeEmailEditModal();
      return;
    }

    const previousEmail = user.email || "";
    setBusy(true, "Mengubah email user...");
    try {
      const result = await callApi("update_email", { licenseId, email });
      const updated = result?.user || result?.result?.user || null;
      if (updated) {
        const index = users.findIndex(u => u.licenseId === licenseId);
        if (index >= 0) users[index] = updated;
        users = sortUsersForDisplay(users);
        updateStats();
        renderUsers();
      } else {
        await loadUsers(true);
      }
      closeEmailEditModal();
      showToast(`Email ${previousEmail} berhasil diubah menjadi ${email}.`);
    } catch (err) {
      showToast(err.message || String(err), true);
    } finally {
      setBusy(false);
    }
  });

  function closeDeleteUserModal(result) {
    if (!els.deleteUserModal || els.deleteUserModal.hidden) return;
    els.deleteUserModal.hidden = true;
    els.deleteUserModal.setAttribute("aria-hidden", "true");
    if (!els.planConfirmModal || els.planConfirmModal.hidden) {
      if (!els.emailEditModal || els.emailEditModal.hidden) document.body.classList.remove("modal-open");
    }
    const resolve = deleteUserResolver;
    deleteUserResolver = null;
    if (resolve) resolve(!!result);
  }

  function confirmDeleteUser(user) {
    els.deleteUserText.textContent = `User ${user?.email || user?.licenseId || "ini"} akan dihapus permanen dari Licenses.`;
    els.deleteUserSummary.innerHTML = `
      <div><span>Email</span><strong>${escapeHtml(user?.email || "-")}</strong></div>
      <div><span>License ID</span><strong>${escapeHtml(user?.licenseId || "-")}</strong></div>
      <small>Setelah Confirm, user tidak lagi terdaftar dan token/license tersebut tidak dapat digunakan. Aksi ini tidak dijalankan jika Anda memilih No.</small>`;
    els.deleteUserModal.hidden = false;
    els.deleteUserModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => els.deleteUserNo.focus(), 30);
    return new Promise(resolve => { deleteUserResolver = resolve; });
  }

  els.deleteUserNo.addEventListener("click", () => closeDeleteUserModal(false));
  els.deleteUserConfirm.addEventListener("click", () => closeDeleteUserModal(true));
  els.deleteUserModal.addEventListener("click", (e) => {
    if (e.target?.dataset?.modalDismiss === "true") closeDeleteUserModal(false);
  });

  async function executeDeleteUser(user) {
    if (!user?.licenseId) return;
    const ok = await confirmDeleteUser(user);
    if (!ok) return;
    setBusy(true, "Menghapus user...");
    try {
      await callApi("delete_user", { licenseId: user.licenseId });
      users = users.filter(u => u.licenseId !== user.licenseId);
      updateStats();
      renderUsers();
      showToast(`User ${user.email || user.licenseId} berhasil dihapus.`);
      loadUsers(true).catch(() => {});
    } catch (err) {
      showToast(err.message || String(err), true);
    } finally {
      setBusy(false);
    }
  }

  async function executeUserAction(btn) {
    const action = btn.dataset.action;
    if (action === "copy") {
      try { await navigator.clipboard.writeText(btn.dataset.token || ""); showToast("Token disalin."); }
      catch (_) { showToast("Gagal menyalin token.", true); }
      return;
    }
    const licenseId = decodeURIComponent(btn.dataset.id || "");
    if (!licenseId) return;
    const user = users.find(u => u.licenseId === licenseId);
    if (action === "edit_email") {
      openEmailEditModal(user);
      return;
    }
    if (action === "delete_user") {
      await executeDeleteUser(user);
      return;
    }
    const label = user?.email || licenseId;
    const messages = {
      reset_pc: `Reset slot PC untuk ${label}?`,
      reset_mobile: `Reset slot Mobile untuk ${label}?`,
      send_email: `Kirim email token ke ${label}?`,
      send_update_email: `Kirim email pemberitahuan update ke ${label}?`
    };
    if (!confirm(messages[action] || "Lanjutkan aksi ini?")) return;
    setBusy(true, "Menjalankan aksi...");
    try {
      await callApi(action, { licenseId });
      await loadUsers(true);
      showToast("Aksi berhasil dijalankan.");
    } catch (err) { showToast(err.message || String(err), true); }
    finally { setBusy(false); }
  }

  let planConfirmResolver = null;

  function closePlanConfirmModal(result) {
    if (!els.planConfirmModal || els.planConfirmModal.hidden) return;
    els.planConfirmModal.hidden = true;
    els.planConfirmModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    const resolve = planConfirmResolver;
    planConfirmResolver = null;
    if (resolve) resolve(!!result);
  }

  function confirmPlanChange(user, oldPlan, newPlan) {
    const oldLabel = PLAN_OPTIONS.find(([value]) => value === oldPlan)?.[1] || oldPlan || "-";
    const newLabel = PLAN_OPTIONS.find(([value]) => value === newPlan)?.[1] || newPlan || "-";
    els.planConfirmText.textContent = `Anda akan mengubah plan untuk ${user?.email || user?.licenseId || "user ini"}.`;
    els.planConfirmSummary.innerHTML = `
      <div><span>Plan sekarang</span><strong>${escapeHtml(oldLabel)}</strong></div>
      <div class="confirm-arrow">→</div>
      <div><span>Plan baru</span><strong>${escapeHtml(newLabel)}</strong></div>
      <small>Plan akan dihitung ulang dari sekarang. TOKEN, LICENSE_ID, dan device tetap dipertahankan.</small>`;
    els.planConfirmModal.hidden = false;
    els.planConfirmModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => els.planConfirmOk.focus(), 30);
    return new Promise(resolve => { planConfirmResolver = resolve; });
  }

  els.planConfirmCancel.addEventListener("click", () => closePlanConfirmModal(false));
  els.planConfirmOk.addEventListener("click", () => closePlanConfirmModal(true));
  els.planConfirmModal.addEventListener("click", (e) => {
    if (e.target?.dataset?.modalDismiss === "true") closePlanConfirmModal(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.planConfirmModal && !els.planConfirmModal.hidden) return closePlanConfirmModal(false);
    if (els.emailEditModal && !els.emailEditModal.hidden) return closeEmailEditModal();
    if (els.resetAllModal && !els.resetAllModal.hidden) return closeResetAllModal(false);
    if (els.deleteUserModal && !els.deleteUserModal.hidden) return closeDeleteUserModal(false);
  });

  async function executePlanChange(select) {
    const licenseId = decodeURIComponent(select.dataset.id || "");
    const oldPlan = String(select.dataset.currentPlan || "").trim().toUpperCase();
    const newPlan = String(select.value || "").trim().toUpperCase();
    if (!licenseId || !newPlan || newPlan === oldPlan) return;

    const user = users.find(u => u.licenseId === licenseId);
    const label = user?.email || licenseId;
    const planLabel = PLAN_OPTIONS.find(([value]) => value === newPlan)?.[1] || newPlan;
    const ok = await confirmPlanChange(user, oldPlan, newPlan);
    if (!ok) {
      select.value = oldPlan;
      return;
    }

    select.disabled = true;
    setBusy(true, "Mengubah plan user...");
    try {
      const result = await callApi("update_plan", { licenseId, plan: newPlan });
      const updated = result?.user || result?.result?.user || null;
      if (updated) {
        const index = users.findIndex(u => u.licenseId === licenseId);
        if (index >= 0) users[index] = updated;
        updateStats();
        renderUsers();
      } else {
        await loadUsers(true);
      }
      showToast(`Plan ${label} berhasil diubah menjadi ${planLabel}.`);
    } catch (err) {
      select.value = oldPlan;
      showToast(err.message || String(err), true);
    } finally {
      setBusy(false);
      select.disabled = false;
    }
  }

  function delegatedAction(e) {
    const btn = e.target.closest("button[data-action]");
    if (btn) executeUserAction(btn);
  }
  els.usersBody.addEventListener("click", delegatedAction);
  els.mobileUsers.addEventListener("click", delegatedAction);
  els.usersBody.addEventListener("change", (e) => {
    const select = e.target.closest('select[data-action="change_plan"]');
    if (select) executePlanChange(select);
  });
  els.mobileUsers.addEventListener("change", (e) => {
    const select = e.target.closest('select[data-action="change_plan"]');
    if (select) executePlanChange(select);
  });


  let resetAllResolver = null;

  function closeResetAllModal(result) {
    if (!els.resetAllModal || els.resetAllModal.hidden) return;
    els.resetAllModal.hidden = true;
    els.resetAllModal.setAttribute("aria-hidden", "true");
    if (!els.deleteUserModal || els.deleteUserModal.hidden) {
      if (!els.planConfirmModal || els.planConfirmModal.hidden) {
        if (!els.emailEditModal || els.emailEditModal.hidden) document.body.classList.remove("modal-open");
      }
    }
    const resolve = resetAllResolver;
    resetAllResolver = null;
    if (resolve) resolve(!!result);
  }

  function confirmResetAll() {
    if (!els.resetAllModal) return Promise.resolve(false);
    els.resetAllModal.hidden = false;
    els.resetAllModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => els.resetAllNo?.focus(), 30);
    return new Promise(resolve => { resetAllResolver = resolve; });
  }

  if (els.resetAllNo) els.resetAllNo.addEventListener("click", () => closeResetAllModal(false));
  if (els.resetAllConfirm) els.resetAllConfirm.addEventListener("click", () => closeResetAllModal(true));
  if (els.resetAllModal) els.resetAllModal.addEventListener("click", (e) => {
    if (e.target?.dataset?.resetAllDismiss === "true") closeResetAllModal(false);
  });

  // REV309 compatibility fallback:
  // Older deployed Apps Script revisions do not know the bulk `reset_all` command,
  // but they already support per-user `reset_pc` and `reset_mobile`. If the
  // active /exec answers UNKNOWN_ADMIN_COMMAND, reset every license through
  // those proven legacy commands instead of failing the whole action.
  async function resetAllViaLegacyCommandsV309() {
    const snapshot = await fetchUsersWithRecovery();
    const targets = (Array.isArray(snapshot.list) ? snapshot.list : [])
      .map(user => ({
        licenseId: String(user?.licenseId || "").trim(),
        label: String(user?.email || user?.licenseId || "user").trim()
      }))
      .filter(item => !!item.licenseId);

    if (!targets.length) {
      return {
        compatibilityFallback: true,
        attempted: 0,
        resetCount: 0,
        pcResetCount: 0,
        mobileResetCount: 0,
        failures: []
      };
    }

    let cursor = 0;
    let processed = 0;
    let pcResetCount = 0;
    let mobileResetCount = 0;
    const failures = [];
    const workerCount = Math.min(2, targets.length);

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= targets.length) return;
        const target = targets[index];
        const number = index + 1;
        setBusy(true, `Mode kompatibilitas RESET ALL • ${number}/${targets.length} • ${target.label}`);

        let pcOk = false;
        let mobileOk = false;

        try {
          await callApi("reset_pc", { licenseId: target.licenseId }, { timeoutMs: 22000 });
          pcOk = true;
          pcResetCount++;
        } catch (err) {
          failures.push({
            licenseId: target.licenseId,
            label: target.label,
            device: "PC",
            error: err?.message || String(err)
          });
        }

        try {
          await callApi("reset_mobile", { licenseId: target.licenseId }, { timeoutMs: 22000 });
          mobileOk = true;
          mobileResetCount++;
        } catch (err) {
          failures.push({
            licenseId: target.licenseId,
            label: target.label,
            device: "Mobile",
            error: err?.message || String(err)
          });
        }

        if (pcOk && mobileOk) processed++;
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return {
      compatibilityFallback: true,
      attempted: targets.length,
      resetCount: processed,
      pcResetCount,
      mobileResetCount,
      failures
    };
  }

  async function executeResetAll() {
    const ok = await confirmResetAll();
    if (!ok) return;
    setBusy(true, "Mereset PC + Mobile untuk semua user...");
    try {
      let result;
      let usedCompatibilityFallback = false;

      try {
        // Fast path for REV308+ backend.
        result = await callApi("reset_all", {}, { timeoutMs: 30000 });
      } catch (err) {
        if (!/UNKNOWN_ADMIN_COMMAND/i.test(err?.message || "")) throw err;
        usedCompatibilityFallback = true;
        setBusy(true, "Backend lama terdeteksi. Menjalankan RESET ALL via Reset PC + Reset Mobile...");
        result = await resetAllViaLegacyCommandsV309();
      }

      await loadUsers(true);

      const count = Number(result?.resetCount ?? result?.result?.resetCount ?? 0);
      const pcCount = Number(result?.pcResetCount ?? result?.result?.pcResetCount ?? count);
      const mobileCount = Number(result?.mobileResetCount ?? result?.result?.mobileResetCount ?? count);
      const failures = Array.isArray(result?.failures) ? result.failures : [];

      if (failures.length) {
        const first = failures[0];
        showToast(
          `RESET ALL selesai sebagian. PC: ${pcCount}, Mobile: ${mobileCount}. Gagal: ${failures.length} aksi. Pertama: ${first.label} (${first.device}) — ${first.error}`,
          true
        );
        return;
      }

      showToast(
        usedCompatibilityFallback
          ? `Reset ALL berhasil via mode kompatibilitas. PC ${pcCount} + Mobile ${mobileCount} slot sudah direset dan dibuat OFFLINE.`
          : `Reset ALL berhasil. PC + Mobile ${count} user sudah direset dan dibuat OFFLINE.`
      );
    } catch (err) {
      showToast(err.message || String(err), true);
    } finally {
      setBusy(false);
    }
  }

  async function bulkEmail(command, update) {
    const text = update ? "Kirim EMAIL UPDATE ke SEMUA license yang masih aktif?" : "Kirim EMAIL TOKEN ke SEMUA license yang masih aktif?";
    if (!confirm(text + "\n\nPerhatikan kuota email harian Apps Script/Gmail.")) return;
    setBusy(true, update ? "Mengirim email update ke semua user..." : "Mengirim email ke semua user...");
    try {
      const result = await callApi(command);
      showToast(`Selesai. Sent: ${result.sent || 0}, skipped: ${result.skipped || 0}, failed: ${result.failed || 0}.`, (result.failed || 0) > 0);
    } catch (err) { showToast(err.message || String(err), true); }
    finally { setBusy(false); }
  }

  if (els.resetAllBtn) els.resetAllBtn.addEventListener("click", executeResetAll);
  els.sendAllBtn.addEventListener("click", () => bulkEmail("send_email_all", false));
  els.sendAllUpdateBtn.addEventListener("click", () => bulkEmail("send_update_email_all", true));

  els.autoRefreshToggle.addEventListener("change", () => {
    autoRefreshEnabled = els.autoRefreshToggle.checked;
    localStorage.setItem(STORAGE.autoEnabled, autoRefreshEnabled ? "true" : "false");
    updateAutoRefreshUi();
    scheduleAutoRefresh();
    showToast(autoRefreshEnabled ? "Auto refresh diaktifkan." : "Auto refresh dinonaktifkan.");
  });

  els.autoRefreshInterval.addEventListener("change", () => {
    autoRefreshMs = Math.max(10000, Number(els.autoRefreshInterval.value || 30000));
    localStorage.setItem(STORAGE.autoMs, String(autoRefreshMs));
    updateAutoRefreshUi();
    scheduleAutoRefresh();
    showToast(`Interval auto refresh: ${Math.round(autoRefreshMs / 1000)} detik.`);
  });

  els.saveApiBtn.addEventListener("click", async () => {
    const candidate = String(els.customApiUrlInput.value || "").trim();
    if (!isValidApiUrl(candidate)) {
      updateApiSettingsUi(false, "Custom API tidak valid. URL harus Apps Script Web App /exec.");
      showToast("Custom API URL tidak valid.", true);
      return;
    }

    const previous = activeApiUrl;
    activeApiUrl = candidate;
    setBusy(true, "Menguji Custom API...");
    try {
      await callApi("auth", {}, { timeoutMs: 10000 });
      localStorage.setItem(STORAGE.apiUrl, activeApiUrl);
      updateApiSettingsUi(true, "Custom API berhasil diverifikasi dan disimpan.");
      scheduleAutoRefresh();
      showToast("Custom API berhasil disimpan.");
    } catch (err) {
      activeApiUrl = previous;
      updateApiSettingsUi(false, `Test API gagal: ${err.message || String(err)}`);
      els.customApiUrlInput.value = candidate;
      showToast(`Test API gagal: ${err.message || String(err)}`, true);
    } finally {
      setBusy(false);
    }
  });

  els.resetApiBtn.addEventListener("click", () => {
    activeApiUrl = DEFAULT_API_URL;
    localStorage.removeItem(STORAGE.apiUrl);
    updateApiSettingsUi(isValidApiUrl(activeApiUrl), "API dikembalikan ke default config.js.");
    scheduleAutoRefresh();
    showToast("API dikembalikan ke default.");
  });

  els.forgetSessionBtn.addEventListener("click", () => {
    clearRememberedLogin();
    showToast("Remembered login dihapus. Session aktif tetap berjalan sampai Lock/close.");
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && adminKey && !els.appView.hidden && autoRefreshEnabled) {
      loadUsers(true).catch(() => {});
      scheduleAutoRefresh();
    }
  });

  function boot() {
    setAdminKeyVisibility(false);
    ensureConfigured();
    updateApiSettingsUi();
    updateAutoRefreshUi();
    updateRememberUi();

    const remembered = localStorage.getItem(STORAGE.remember) === "true";
    const savedKey = remembered ? getSavedAdminKey() : "";
    if (savedKey) {
      els.adminKeyInput.value = savedKey;
      els.rememberAdminKey.checked = true;
      if (ensureConfigured()) loginWithKey(savedKey, true, true);
    }
  }

  boot();
})();
