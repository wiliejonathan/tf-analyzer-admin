(() => {
  "use strict";

  if (window.__SF_MEMBER_PRESENCE_REV328__) return;
  window.__SF_MEMBER_PRESENCE_REV328__ = true;

  let managementFilter = "ACTIVE";
  let scheduled = false;

  function injectStyles() {
    if (document.getElementById("sfMemberPresenceREV328")) return;

    const style = document.createElement("style");
    style.id = "sfMemberPresenceREV328";
    style.textContent = `
      /* =====================================================
         REV328 — Presence column
         ===================================================== */
      .sf-member-presence-head,
      .sf-member-presence-cell {
        width: 34px !important;
        min-width: 34px !important;
        max-width: 34px !important;
        padding-left: 6px !important;
        padding-right: 6px !important;
        text-align: center !important;
      }

      .sf-member-presence-dot {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        vertical-align: middle;
        background: transparent;
      }

      .sf-member-presence-dot.online {
        background: #28c96f;
        box-shadow: 0 0 11px rgba(40,201,111,.38);
      }

      .sf-member-presence-dot.offline {
        background: transparent;
        box-shadow: none;
      }

      .sf-member-online-text {
        white-space: nowrap;
      }

      /* =====================================================
         REV328 — Active / Not Active filter tabs
         ===================================================== */
      .sf-member-management-filter {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 38px;
        margin: 2px 0 10px;
        padding: 0 2px;
      }

      .sf-member-management-filter button {
        position: relative;
        min-height: 34px;
        padding: 0 13px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #789086;
        font: 800 11px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
        letter-spacing: .01em;
        cursor: pointer;
        transition: color .16s ease, background .16s ease, box-shadow .16s ease;
      }

      .sf-member-management-filter button:hover {
        color: #d6e6df;
        background: rgba(255,255,255,.035);
      }

      .sf-member-management-filter button.active {
        color: #39e997;
        background: rgba(13,119,74,.16);
        box-shadow: inset 0 0 0 1px rgba(43,212,133,.16);
      }

      .sf-member-management-filter button.active::after {
        content: "";
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: -2px;
        height: 2px;
        border-radius: 99px;
        background: #24d884;
        box-shadow: 0 0 9px rgba(36,216,132,.28);
      }

      .sf-member-management-filter .sf-member-filter-divider {
        width: 1px;
        height: 17px;
        background: rgba(130,165,151,.16);
        margin: 0 1px;
      }

      @media (max-width: 700px) {
        .sf-member-management-filter {
          margin-top: 6px;
          margin-bottom: 9px;
        }

        .sf-member-management-filter button {
          min-height: 32px;
          padding: 0 11px;
          font-size: 10px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function patchTable(table, bodyId) {
    if (!table) return;

    const headRow = table.querySelector("thead tr");
    if (headRow && !headRow.querySelector(".sf-member-presence-head")) {
      const headers = Array.from(headRow.children);
      const onlineTh = headers.find(th => String(th.textContent || "").trim().toUpperCase() === "ONLINE");

      if (onlineTh) {
        const dotTh = document.createElement("th");
        dotTh.className = "sf-member-presence-head";
        dotTh.setAttribute("aria-label", "Presence");
        dotTh.textContent = "";
        headRow.insertBefore(dotTh, onlineTh);
      }
    }

    const body = document.getElementById(bodyId);
    if (!body) return;

    body.querySelectorAll("tr").forEach(row => {
      const cells = Array.from(row.children);
      if (!cells.length) return;

      if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
        const current = Number(cells[0].getAttribute("colspan") || 0);
        if (current && !cells[0].dataset.sfPresenceColspan) {
          cells[0].setAttribute("colspan", String(current + 1));
          cells[0].dataset.sfPresenceColspan = "1";
        }
        return;
      }

      if (row.querySelector(".sf-member-presence-cell")) return;

      const onlineIndex = cells.findIndex(td => {
        const txt = String(td.textContent || "").trim().toLowerCase();
        return txt === "offline" || txt === "online" || txt.includes("● online") || txt.includes("• online");
      });

      if (onlineIndex < 0) return;

      const onlineTd = cells[onlineIndex];
      const raw = String(onlineTd.textContent || "").trim().toLowerCase();
      const isOnline = raw.includes("online") && !raw.includes("offline");

      const dotTd = document.createElement("td");
      dotTd.className = "sf-member-presence-cell";
      dotTd.innerHTML = `<span class="sf-member-presence-dot ${isOnline ? "online" : "offline"}" aria-label="${isOnline ? "Online" : "Offline"}"></span>`;
      row.insertBefore(dotTd, onlineTd);

      onlineTd.classList.add("sf-member-online-text");
      onlineTd.textContent = isOnline ? "Online" : "Offline";
    });
  }

  function ensureManagementFilter() {
    const view = document.getElementById("sfMemberUsersView");
    if (!view) return null;

    let bar = document.getElementById("sfMemberManagementFilter");
    if (bar) return bar;

    const toolbar = view.querySelector(":scope > .sf-member-toolbar");
    const panel = view.querySelector(":scope > .sf-member-panel");
    if (!toolbar || !panel) return null;

    bar = document.createElement("nav");
    bar.id = "sfMemberManagementFilter";
    bar.className = "sf-member-management-filter";
    bar.setAttribute("aria-label", "Filter status member");
    bar.innerHTML = `
      <button id="sfMemberFilterActive" class="active" type="button" data-sf-member-filter="ACTIVE" aria-pressed="true">Active</button>
      <span class="sf-member-filter-divider" aria-hidden="true"></span>
      <button id="sfMemberFilterNotActive" type="button" data-sf-member-filter="NOT_ACTIVE" aria-pressed="false">Not Active</button>
    `;

    view.insertBefore(bar, panel);

    bar.addEventListener("click", event => {
      const button = event.target.closest("[data-sf-member-filter]");
      if (!button) return;

      managementFilter = button.dataset.sfMemberFilter === "NOT_ACTIVE" ? "NOT_ACTIVE" : "ACTIVE";
      updateFilterButtons();
      applyManagementFilter();
    });

    return bar;
  }

  function updateFilterButtons() {
    const active = document.getElementById("sfMemberFilterActive");
    const notActive = document.getElementById("sfMemberFilterNotActive");

    if (active) {
      const selected = managementFilter === "ACTIVE";
      active.classList.toggle("active", selected);
      active.setAttribute("aria-pressed", selected ? "true" : "false");
    }

    if (notActive) {
      const selected = managementFilter === "NOT_ACTIVE";
      notActive.classList.toggle("active", selected);
      notActive.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  function statusFromRow(row) {
    if (!row) return "";

    const select = row.querySelector(".sf-member-status-select");
    if (select) {
      return String(
        select.dataset.currentStatus ||
        select.value ||
        ""
      ).trim().toUpperCase();
    }

    const statusNode = row.querySelector(".sf-member-status");
    if (statusNode) {
      return String(statusNode.textContent || "").trim().toUpperCase();
    }

    const cells = Array.from(row.children);
    for (const cell of cells) {
      const text = String(cell.textContent || "").trim().toUpperCase();
      if (["ACTIVE", "PENDING", "SUSPENDED", "SUSPEND", "NOT ACTIVE"].includes(text)) {
        if (text === "SUSPEND") return "SUSPENDED";
        if (text === "NOT ACTIVE") return "PENDING";
        return text;
      }
    }

    return "";
  }

  function applyManagementFilter() {
    ensureManagementFilter();
    updateFilterButtons();

    const body = document.getElementById("sfMemberUsersBody");
    const empty = document.getElementById("sfMemberEmpty");
    if (!body) return;

    const rows = Array.from(body.querySelectorAll(":scope > tr"));
    let visible = 0;

    rows.forEach(row => {
      if (row.children.length === 1 && row.children[0].hasAttribute("colspan")) {
        row.hidden = true;
        return;
      }

      const status = statusFromRow(row);
      if (!status) {
        row.hidden = false;
        visible += 1;
        return;
      }

      const isActive = status === "ACTIVE";
      const show = managementFilter === "ACTIVE" ? isActive : !isActive;
      row.hidden = !show;
      if (show) visible += 1;
    });

    if (empty) {
      const search = String(document.getElementById("sfMemberSearch")?.value || "").trim();
      empty.hidden = visible > 0;

      if (!visible) {
        if (search) {
          empty.textContent = managementFilter === "ACTIVE"
            ? "Tidak ada user Active yang cocok dengan pencarian."
            : "Tidak ada user Not Active yang cocok dengan pencarian.";
        } else {
          empty.textContent = managementFilter === "ACTIVE"
            ? "Belum ada user Active."
            : "Belum ada user Not Active yang menunggu verifikasi.";
        }
      }
    }
  }

  function apply() {
    injectStyles();

    const recentBody = document.getElementById("sfMemberRecentBody");
    patchTable(recentBody?.closest("table"), "sfMemberRecentBody");

    const usersBody = document.getElementById("sfMemberUsersBody");
    patchTable(usersBody?.closest("table"), "sfMemberUsersBody");

    ensureManagementFilter();
    applyManagementFilter();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  function start() {
    apply();

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    document.addEventListener("input", event => {
      if (event.target && event.target.id === "sfMemberSearch") {
        setTimeout(scheduleApply, 0);
      }
    }, true);

    document.addEventListener("change", event => {
      if (event.target?.classList?.contains("sf-member-status-select")) {
        setTimeout(scheduleApply, 0);
        setTimeout(scheduleApply, 400);
        setTimeout(scheduleApply, 1200);
      }
    }, true);

    window.addEventListener("tf-member-snapshot-updated", scheduleApply);
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
