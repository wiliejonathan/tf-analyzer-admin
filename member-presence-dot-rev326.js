(() => {
  "use strict";

  if (window.__SF_MEMBER_PRESENCE_REV326__) return;
  window.__SF_MEMBER_PRESENCE_REV326__ = true;

  function injectStyles() {
    if (document.getElementById("sfMemberPresenceREV326")) return;
    const style = document.createElement("style");
    style.id = "sfMemberPresenceREV326";
    style.textContent = `
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

  function apply() {
    injectStyles();

    const recentBody = document.getElementById("sfMemberRecentBody");
    patchTable(recentBody?.closest("table"), "sfMemberRecentBody");

    const usersBody = document.getElementById("sfMemberUsersBody");
    patchTable(usersBody?.closest("table"), "sfMemberUsersBody");
  }

  function start() {
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    window.addEventListener("tf-member-snapshot-updated", apply);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
