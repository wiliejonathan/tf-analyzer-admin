(() => {
  "use strict";

  const cfg = window.TF_ADMIN_CONFIG || {};
  const apiUrl = String(cfg.apiUrl || "").trim();
  const autoRefreshMs = Math.max(10000, Number(cfg.autoRefreshMs || 30000));
  let pageSize = Number(cfg.defaultPageSize || 10);
  let currentPage = 1;
  let adminKey = "";
  let users = [];
  let toastTimer = null;
  let autoRefreshTimer = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    loginView: $("loginView"), appView: $("appView"), loginForm: $("loginForm"), adminKeyInput: $("adminKeyInput"), configWarning: $("configWarning"),
    lockBtn: $("lockBtn"), dashboardSection: $("dashboardSection"), addUserSection: $("addUserSection"), settingsSection: $("settingsSection"), usersSection: $("usersSection"),
    statTotal: $("statTotal"), statActive: $("statActive"), statPc: $("statPc"), statMobile: $("statMobile"), sideTotal: $("sideTotal"), sidePc: $("sidePc"), sideMobile: $("sideMobile"), sideActive: $("sideActive"), sideExpired: $("sideExpired"),
    searchInput: $("searchInput"), searchCount: $("searchCount"), usersBody: $("usersBody"), mobileUsers: $("mobileUsers"), emptyState: $("emptyState"),
    addUserForm: $("addUserForm"), newEmail: $("newEmail"), newPlan: $("newPlan"), newTokenResult: $("newTokenResult"), newTokenValue: $("newTokenValue"), copyNewTokenBtn: $("copyNewTokenBtn"),
    sendAllBtn: $("sendAllBtn"), sendAllUpdateBtn: $("sendAllUpdateBtn"), prevPageBtn: $("prevPageBtn"), nextPageBtn: $("nextPageBtn"), pageButtons: $("pageButtons"), pageSummary: $("pageSummary"), pageSizeSelect: $("pageSizeSelect"),
    busyOverlay: $("busyOverlay"), busyText: $("busyText"), toast: $("toast")
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

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

  function ensureConfigured() {
    const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(apiUrl);
    els.configWarning.hidden = ok;
    if (!ok) els.configWarning.textContent = "Backend Apps Script /exec belum valid.";
    return ok;
  }

  async function callApi(command, data = {}) {
    if (!ensureConfigured()) throw new Error("API_URL_NOT_CONFIGURED");
    if (!adminKey) throw new Error("ADMIN_KEY_REQUIRED");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(apiUrl, {
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
      if (err && err.name === "AbortError") throw new Error("API_TIMEOUT_20S — Apps Script tidak merespons.");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  function searchableText(user) {
    return [user.email, user.plan, user.token, user.licenseId, user.status, user.lastSeenPc, user.lastSeenMobile, user.productName, user.expiredAt]
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

  function tableRow(user, query) {
    const validClass = user.validNow ? "" : " inactive";
    return `<tr>
      <td class="status-cell">${statusDots(user)}</td>
      <td>${highlight(user.email || "-", query)}</td>
      <td><span class="plan-pill">${highlight(user.plan || "-", query)}</span></td>
      <td><div class="token-box"><span class="token-text" title="${escapeHtml(user.token || "")}">${highlight(user.token || "-", query)}</span><button class="action-mail" data-action="copy" data-token="${escapeHtml(user.token || "")}">Copy</button></div></td>
      <td><span class="state-pill${validClass}">${highlight(user.status || "-", query)}</span><div style="margin-top:4px;color:#63766f;font-size:8px">${highlight(user.licenseId || "", query)}</div></td>
      <td>${highlight(user.lastSeenPc || "-", query)}</td>
      <td>${highlight(user.lastSeenMobile || "-", query)}</td>
      <td><div class="actions">${actionButtons(user)}</div></td>
    </tr>`;
  }

  function mobileCard(user, query) {
    const validClass = user.validNow ? "" : " inactive";
    return `<article class="user-card">
      <div class="user-card-top"><div><h3>${highlight(user.email || "-", query)}</h3><div class="license-id">${highlight(user.licenseId || "-", query)}</div></div><div>${statusDots(user)}</div></div>
      <div class="user-fields">
        <div class="user-field"><span>Plan</span><strong>${highlight(user.plan || "-", query)}</strong></div>
        <div class="user-field"><span>Status</span><strong><span class="state-pill${validClass}">${highlight(user.status || "-", query)}</span></strong></div>
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

  async function loadUsers(silent = false) {
    if (!silent) setBusy(true, "Mengambil data user...");
    try {
      const result = await callApi("list_users");
      users = Array.isArray(result.users) ? result.users : [];
      updateStats();
      renderUsers();
    } catch (err) {
      showToast(err.message || String(err), true);
      if (/UNAUTHORIZED|ADMIN_/i.test(err.message || "")) lockDashboard();
      throw err;
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (!adminKey || els.appView.hidden) return;
      loadUsers(true).catch(() => {});
    }, autoRefreshMs);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  function unlockDashboard() {
    els.loginView.hidden = true;
    els.appView.hidden = false;
    startAutoRefresh();
  }

  function lockDashboard() {
    adminKey = "";
    users = [];
    currentPage = 1;
    stopAutoRefresh();
    els.appView.hidden = true;
    els.loginView.hidden = false;
    els.adminKeyInput.value = "";
    els.adminKeyInput.focus();
  }

  function activateNav(target) {
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === target));
    els.dashboardSection.classList.remove("active-section");
    els.addUserSection.classList.remove("active-section");
    els.settingsSection.classList.remove("active-section");

    if (target === "add-user") {
      els.addUserSection.classList.add("active-section");
      setTimeout(() => els.newEmail.focus(), 50);
    } else if (target === "settings") {
      els.settingsSection.classList.add("active-section");
    } else {
      els.dashboardSection.classList.add("active-section");
      if (target === "users") setTimeout(() => els.usersSection.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    }
  }

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ensureConfigured()) return;
    adminKey = els.adminKeyInput.value.trim();
    if (!adminKey) return;
    setBusy(true, "Memverifikasi admin key...");
    try {
      await callApi("auth");
      unlockDashboard();
      await loadUsers(true);
      showToast("Dashboard terhubung.");
    } catch (err) {
      adminKey = "";
      showToast(err.message || "Login admin gagal.", true);
    } finally { setBusy(false); }
  });

  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => activateNav(btn.dataset.nav)));
  els.lockBtn.addEventListener("click", lockDashboard);
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

  function delegatedAction(e) {
    const btn = e.target.closest("button[data-action]");
    if (btn) executeUserAction(btn);
  }
  els.usersBody.addEventListener("click", delegatedAction);
  els.mobileUsers.addEventListener("click", delegatedAction);

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

  ensureConfigured();
})();
