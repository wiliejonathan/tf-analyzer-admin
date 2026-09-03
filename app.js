(() => {
  "use strict";

  const cfg = window.TF_ADMIN_CONFIG || {};
  const DEFAULT_API_URL = String(cfg.apiUrl || "").trim();
  const ADMIN_EMAIL = "wiliejonathan1999@gmail.com";
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
    loginView: $("loginView"), appView: $("appView"), loginForm: $("loginForm"), adminKeyInput: $("adminKeyInput"), rememberAdminKey: $("rememberAdminKey"), configWarning: $("configWarning"),
    lockBtn: $("lockBtn"), dashboardSection: $("dashboardSection"), addUserSection: $("addUserSection"), settingsSection: $("settingsSection"), usersSection: $("usersSection"),
    statTotal: $("statTotal"), statActive: $("statActive"), statPc: $("statPc"), statMobile: $("statMobile"), sideTotal: $("sideTotal"), sidePc: $("sidePc"), sideMobile: $("sideMobile"), sideActive: $("sideActive"), sideExpired: $("sideExpired"),
    searchInput: $("searchInput"), searchCount: $("searchCount"), usersBody: $("usersBody"), mobileUsers: $("mobileUsers"), emptyState: $("emptyState"),
    addUserForm: $("addUserForm"), newEmail: $("newEmail"), newPlan: $("newPlan"), newTokenResult: $("newTokenResult"), newTokenValue: $("newTokenValue"), copyNewTokenBtn: $("copyNewTokenBtn"),
    sendAllBtn: $("sendAllBtn"), sendAllUpdateBtn: $("sendAllUpdateBtn"), prevPageBtn: $("prevPageBtn"), nextPageBtn: $("nextPageBtn"), pageButtons: $("pageButtons"), pageSummary: $("pageSummary"), pageSizeSelect: $("pageSizeSelect"),
    customApiUrlInput: $("customApiUrlInput"), saveApiBtn: $("saveApiBtn"), resetApiBtn: $("resetApiBtn"), apiStatusLabel: $("apiStatusLabel"), apiStatusDot: $("apiStatusDot"), apiStatusText: $("apiStatusText"),
    autoRefreshToggle: $("autoRefreshToggle"), autoRefreshInterval: $("autoRefreshInterval"), autoRefreshLabel: $("autoRefreshLabel"), lastRefreshText: $("lastRefreshText"), rememberStatusLabel: $("rememberStatusLabel"), forgetSessionBtn: $("forgetSessionBtn"),
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

  function isAdminUser(user) {
    return String(user?.email || "").trim().toLowerCase() === ADMIN_EMAIL;
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
    return `<button class="action-reset" data-action="reset_pc" data-id="${id}">Reset PC</button>
      <button class="action-reset" data-action="reset_mobile" data-id="${id}">Reset Mobile</button>
      <button class="action-mail" data-action="send_email" data-id="${id}">Email</button>
      <button class="action-update" data-action="send_update_email" data-id="${id}">Update</button>`;
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
      <td>${highlight(user.email || "-", query)}</td>
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
      <div class="user-card-top"><div><h3>${highlight(user.email || "-", query)}</h3><div class="license-id">${highlight(user.licenseId || "-", query)}</div></div><div>${statusDots(user)}</div></div>
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
    users = Array.isArray(list) ? list : [];
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

  function clearRememberedLogin() {
    localStorage.removeItem(STORAGE.remember);
    localStorage.removeItem(STORAGE.adminKey);
    els.rememberAdminKey.checked = false;
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
    els.adminKeyInput.value = "";
    if (clearRemembered) clearRememberedLogin();
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
      if (automatic || /UNAUTHORIZED|ADMIN_/i.test(err.message || "")) clearRememberedLogin();
      showToast(err.message || "Login admin gagal.", true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ensureConfigured()) return;
    await loginWithKey(els.adminKeyInput.value, els.rememberAdminKey.checked, false);
  });

  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => activateNav(btn.dataset.nav)));
  els.lockBtn.addEventListener("click", () => lockDashboard(true));
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

  async function executePlanChange(select) {
    const licenseId = decodeURIComponent(select.dataset.id || "");
    const oldPlan = String(select.dataset.currentPlan || "").trim().toUpperCase();
    const newPlan = String(select.value || "").trim().toUpperCase();
    if (!licenseId || !newPlan || newPlan === oldPlan) return;

    const user = users.find(u => u.licenseId === licenseId);
    const label = user?.email || licenseId;
    const planLabel = PLAN_OPTIONS.find(([value]) => value === newPlan)?.[1] || newPlan;
    const ok = confirm(`Ubah plan ${label} menjadi ${planLabel}?\n\nPlan akan dihitung ulang dari sekarang. TOKEN, LICENSE_ID, dan device tetap dipertahankan.`);
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
    ensureConfigured();
    updateApiSettingsUi();
    updateAutoRefreshUi();
    updateRememberUi();

    const remembered = localStorage.getItem(STORAGE.remember) === "true";
    const savedKey = remembered ? String(localStorage.getItem(STORAGE.adminKey) || "").trim() : "";
    if (savedKey && ensureConfigured()) {
      els.adminKeyInput.value = savedKey;
      els.rememberAdminKey.checked = true;
      loginWithKey(savedKey, true, true);
    }
  }

  boot();
})();
