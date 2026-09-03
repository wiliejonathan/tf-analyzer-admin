(() => {
  "use strict";

  const cfg = window.TF_ADMIN_CONFIG || {};
  const apiUrl = String(cfg.apiUrl || "").trim();
  let adminKey = "";
  let users = [];
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    loginPanel: $("loginPanel"), dashboard: $("dashboard"), loginForm: $("loginForm"), adminKeyInput: $("adminKeyInput"),
    configWarning: $("configWarning"), refreshBtn: $("refreshBtn"), lockBtn: $("lockBtn"),
    addUserForm: $("addUserForm"), newEmail: $("newEmail"), newPlan: $("newPlan"), addUserBtn: $("addUserBtn"),
    newTokenResult: $("newTokenResult"), newTokenValue: $("newTokenValue"), copyNewTokenBtn: $("copyNewTokenBtn"),
    searchInput: $("searchInput"), searchCount: $("searchCount"), usersBody: $("usersBody"), emptyState: $("emptyState"),
    statTotal: $("statTotal"), statActive: $("statActive"), statPc: $("statPc"), statMobile: $("statMobile"),
    sendAllBtn: $("sendAllBtn"), sendAllUpdateBtn: $("sendAllUpdateBtn"), busyOverlay: $("busyOverlay"), busyText: $("busyText"), toast: $("toast")
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const highlight = (value, query) => {
    const safe = escapeHtml(value);
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
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, error ? 6500 : 3500);
  }

  function ensureConfigured() {
    const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(apiUrl);
    if (!ok) {
      els.configWarning.hidden = false;
      els.configWarning.textContent = "config.js belum berisi URL Apps Script /exec yang valid.";
    }
    return ok;
  }

  async function callApi(command, data = {}) {
    if (!ensureConfigured()) throw new Error("API_URL_NOT_CONFIGURED");
    if (!adminKey) throw new Error("ADMIN_KEY_REQUIRED");

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store",
      redirect: "follow",
      body: JSON.stringify({ action: "admin_dashboard", command, adminKey, ...data })
    });

    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); }
    catch (_) {
      throw new Error(`Server tidak mengembalikan JSON (HTTP ${response.status}). Periksa deployment Apps Script.`);
    }

    if (!response.ok || payload?.success === false || payload?.ok === false) {
      const msg = payload?.message || payload?.error || payload?.code || `HTTP_${response.status}`;
      throw new Error(msg);
    }
    return payload;
  }

  function searchableText(user) {
    return [user.email, user.plan, user.token, user.licenseId, user.status, user.lastSeenPc, user.lastSeenMobile, user.productName, user.expiredAt]
      .join(" ").toLowerCase();
  }

  function renderStats() {
    els.statTotal.textContent = users.length;
    els.statActive.textContent = users.filter(u => u.validNow).length;
    els.statPc.textContent = users.filter(u => u.pcOnline).length;
    els.statMobile.textContent = users.filter(u => u.mobileOnline).length;
  }

  function rowHtml(user, query) {
    const q = query.trim();
    const encodedId = encodeURIComponent(user.licenseId || "");
    const validClass = user.validNow ? "" : " inactive";
    return `
      <tr data-license-id="${escapeHtml(user.licenseId)}">
        <td class="status-cell">
          <span class="status-dot ${user.pcOnline ? "online" : "offline"}" title="PC ${user.pcOnline ? "Online" : "Offline"}"></span>
          <span class="status-dot ${user.mobileOnline ? "online" : "offline"}" title="Mobile ${user.mobileOnline ? "Online" : "Offline"}"></span>
        </td>
        <td class="email-cell">${highlight(user.email, q)}</td>
        <td><span class="plan-pill">${highlight(user.plan, q)}</span></td>
        <td>
          <div class="token-box">
            <span class="token-text" title="${escapeHtml(user.token)}">${highlight(user.token, q)}</span>
            <button class="btn btn-small btn-ghost" data-action="copy" data-token="${escapeHtml(user.token)}">Copy</button>
          </div>
        </td>
        <td>
          <span class="state-pill${validClass}">${highlight(user.status || "-", q)}</span>
          <div style="margin-top:6px;color:#7f968c;font-size:9px">${highlight(user.licenseId, q)}</div>
        </td>
        <td>${highlight(user.lastSeenPc || "—", q)}</td>
        <td>${highlight(user.lastSeenMobile || "—", q)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-small btn-danger" data-action="reset_pc" data-id="${encodedId}">Reset PC</button>
            <button class="btn btn-small btn-danger" data-action="reset_mobile" data-id="${encodedId}">Reset Mobile</button>
            <button class="btn btn-small btn-secondary" data-action="send_email" data-id="${encodedId}">SEND EMAIL</button>
            <button class="btn btn-small btn-primary" data-action="send_update_email" data-id="${encodedId}">SEND UPDATE</button>
          </div>
        </td>
      </tr>`;
  }

  function renderUsers() {
    const query = els.searchInput.value.trim().toLowerCase();
    const visible = query ? users.filter(u => searchableText(u).includes(query)) : users.slice();
    els.usersBody.innerHTML = visible.map(u => rowHtml(u, query)).join("");
    els.emptyState.hidden = visible.length > 0;
    els.searchCount.textContent = query ? `${visible.length}/${users.length}` : `${users.length} user`;
  }

  async function loadUsers(silent = false) {
    if (!silent) setBusy(true, "Mengambil data user...");
    try {
      const result = await callApi("list_users");
      users = Array.isArray(result.users) ? result.users : [];
      renderStats(); renderUsers();
    } catch (err) {
      showToast(err.message || String(err), true);
      if (/UNAUTHORIZED|ADMIN_/i.test(err.message || "")) lockDashboard();
      throw err;
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function unlockDashboard() {
    els.loginPanel.hidden = true;
    els.dashboard.hidden = false;
    els.refreshBtn.disabled = false;
    els.lockBtn.hidden = false;
  }
  function lockDashboard() {
    adminKey = "";
    users = [];
    els.dashboard.hidden = true;
    els.loginPanel.hidden = false;
    els.refreshBtn.disabled = true;
    els.lockBtn.hidden = true;
    els.adminKeyInput.value = "";
    els.adminKeyInput.focus();
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

  els.refreshBtn.addEventListener("click", () => loadUsers().catch(() => {}));
  els.lockBtn.addEventListener("click", lockDashboard);
  els.searchInput.addEventListener("input", renderUsers);

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
    await navigator.clipboard.writeText(token);
    showToast("Token disalin.");
  });

  els.usersBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "copy") {
      await navigator.clipboard.writeText(btn.dataset.token || "");
      showToast("Token disalin.");
      return;
    }

    const licenseId = decodeURIComponent(btn.dataset.id || "");
    if (!licenseId) return;
    const user = users.find(u => u.licenseId === licenseId);
    const label = user?.email || licenseId;
    const confirmations = {
      reset_pc: `Reset slot PC untuk ${label}?`,
      reset_mobile: `Reset slot Mobile untuk ${label}?`,
      send_email: `Kirim email token ke ${label}?`,
      send_update_email: `Kirim email pemberitahuan update ke ${label}?`
    };
    if (!confirm(confirmations[action] || "Lanjutkan aksi ini?")) return;

    setBusy(true, "Menjalankan aksi...");
    try {
      await callApi(action, { licenseId });
      await loadUsers(true);
      showToast("Aksi berhasil dijalankan.");
    } catch (err) { showToast(err.message || String(err), true); }
    finally { setBusy(false); }
  });

  async function bulkEmail(command, update) {
    const text = update
      ? "Kirim EMAIL UPDATE ke SEMUA license yang masih aktif?"
      : "Kirim EMAIL TOKEN ke SEMUA license yang masih aktif?";
    if (!confirm(text + "\n\nPerhatikan kuota email harian Apps Script/Gmail.")) return;
    setBusy(true, update ? "Mengirim email update ke semua user..." : "Mengirim email ke semua user...");
    try {
      const result = await callApi(command);
      showToast(`Selesai. Sent: ${result.sent || 0}, skipped: ${result.skipped || 0}, failed: ${result.failed || 0}.` , (result.failed || 0) > 0);
    } catch (err) { showToast(err.message || String(err), true); }
    finally { setBusy(false); }
  }

  els.sendAllBtn.addEventListener("click", () => bulkEmail("send_email_all", false));
  els.sendAllUpdateBtn.addEventListener("click", () => bulkEmail("send_update_email_all", true));

  ensureConfigured();
})();
