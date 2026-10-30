(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) return;

  const $ = (id) => document.getElementById(id);
  const pageSize = 20;
  let canManage = false;
  let currentView = "overview";
  let analyseData = null;
  let createMode = false;

  let usersPage = 1;
  let purchasesPage = 1;
  let notificationsPage = 1;
  let usersPagination = null;
  let purchasesPagination = null;
  let notificationsPagination = null;
  let usersCache = new Map();

  const escapeHtml = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const formatNumber = (v) =>
    v == null || Number.isNaN(Number(v)) ? "—" : new Intl.NumberFormat("tr-TR").format(Number(v));
  const formatDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? "—"
      : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  const listFromBody = (d) => {
    const body = d?.bodyJson || {};
    const list = body.data ?? body.users ?? body.items ?? [];
    return Array.isArray(list) ? list : [];
  };
  const apiMessage = (d, f) => d?.bodyJson?.error || d?.bodyJson?.message || d?.error || f;

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  function setHealth(ok, text) {
    const badge = $("healthBadge");
    badge.className = `badge ${ok ? "ok" : "fail"}`;
    badge.innerHTML = `<span class="badge-dot"></span>${escapeHtml(text)}`;
  }

  function renderInsightCard(title, items) {
    const rows = Array.isArray(items) ? items : [];
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3>
      ${
        rows.length
          ? rows
              .map(
                (row) =>
                  `<div class="insight-bar-row"><span class="insight-bar-label">${escapeHtml(
                    row.label || "—"
                  )}</span><span class="insight-bar-meta">${formatNumber(row.count)}</span></div>`
              )
              .join("")
          : '<p class="user-cell-sub">Veri yok</p>'
      }
    </article>`;
  }

  function renderAnalytics() {
    const insights = analyseData?.insights;
    if (!insights) {
      $("analyticsGrid").innerHTML = '<p class="user-cell-sub">Analiz verisi yok</p>';
      return;
    }
    $("analyticsGrid").innerHTML = [
      renderInsightCard("Ürün satışları", insights.topProducts),
      renderInsightCard("Token dağılımı", insights.tokenBuckets),
    ].join("");
  }

  function applyRoleUi() {
    $("viewerBanner").hidden = canManage;
    document.querySelectorAll("[data-manager-only]").forEach((el) => {
      el.hidden = !canManage;
      el.style.display = canManage ? "" : "none";
    });
  }

  async function loadAppMeta() {
    const res = await fetch(`/api/apps/${appId}`);
    if (res.status === 401) return (window.location.href = "/login.html");
    const data = await res.json();
    if (!res.ok) return;
    const app = data.app || {};
    $("appTitle").textContent = app.appName || "Logora";
    $("sidebarAppName").textContent = app.appName || "Logora";
    $("breadcrumbName").textContent = app.appName || "Logora";
    $("apiInfo").textContent = app.apiBaseUrl || "API URL tanımlı değil";
    if (app.iconUrl) {
      $("headerAppIcon").src = app.iconUrl;
      $("headerAppIcon").hidden = false;
      $("headerAppIconFallback").hidden = true;
    }
  }

  async function loadHealth() {
    try {
      const res = await fetch(`/api/apps/${appId}/proxy/health`);
      const data = await res.json();
      setHealth(Boolean(data.ok), data.ok ? "API bağlı" : "API erişilemiyor");
    } catch {
      setHealth(false, "API erişilemiyor");
    }
  }

  async function loadAnalyse() {
    const res = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await res.json();
    if (!data.ok) {
      $("analyseError").hidden = false;
      $("analyseError").textContent = apiMessage(data, "Analiz verisi alınamadı.");
      return;
    }
    $("analyseError").hidden = true;
    analyseData = data.bodyJson || {};
    const s = analyseData.summary || {};
    $("statTotalUsers").textContent = formatNumber(s.totalUsers ?? s.totalDevices);
    $("statTotalTokens").textContent = formatNumber(s.totalTokens);
    $("statTotalPurchases").textContent = formatNumber(s.totalPurchases);
    $("statTokensSold").textContent = formatNumber(s.tokensSold);
    $("statNewUsersToday").textContent = formatNumber(s.newUsersToday);
    $("statPurchasesToday").textContent = formatNumber(s.purchasesToday);
    $("statDevicesWithTokens").textContent = formatNumber(s.devicesWithTokens);
    $("statTotalNotifications").textContent = formatNumber(s.totalNotifications);
    $("analyseHint").textContent = "";

    const daily = Array.isArray(analyseData.daily) ? analyseData.daily : [];
    $("dailyBody").innerHTML = daily.length
      ? daily
          .map(
            (row) =>
              `<tr><td>${escapeHtml(String(row.date || "").slice(0, 10))}</td><td>${formatNumber(
                row.newUsers
              )}</td><td>${formatNumber(row.purchases)}</td></tr>`
          )
          .join("")
      : '<tr><td colspan="3" class="user-cell-sub">Veri yok</td></tr>';
    renderAnalytics();
  }

  async function loadUsers() {
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    if ($("userSearch").value.trim()) params.set("search", $("userSearch").value.trim());
    if ($("userTokensFilter").value) params.set("hasTokens", $("userTokensFilter").value);

    const res = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await res.json();
    if (!data.ok) {
      $("usersError").hidden = false;
      $("usersError").textContent = apiMessage(data, "Cihazlar alınamadı.");
      return;
    }
    $("usersError").hidden = true;
    const rows = listFromBody(data);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache = new Map(rows.map((row) => [String(row.id), row]));
    $("usersMeta").textContent = usersPagination
      ? `Sayfa ${usersPagination.page}/${usersPagination.totalPages} · ${formatNumber(
          usersPagination.total
        )} cihaz`
      : `${formatNumber(rows.length)} cihaz`;
    $("usersBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(row.deviceId || row.id)}</div><div class="user-cell-sub">${escapeHtml(
              String(row.id || "").slice(0, 8)
            )}…</div></td>
          <td>${escapeHtml(row.revenueCatUserId || "—")}</td>
          <td>${formatNumber(row.tokenBalance)}</td>
          <td>${formatNumber(row.purchaseCount)}</td>
          <td>${formatDateTime(row.createdAt)}</td>
          <td><button type="button" class="btn btn-sm" data-user-edit="${escapeHtml(row.id)}" ${
              canManage ? "" : "hidden"
            }>Düzenle</button></td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Cihaz yok</td></tr>';

    $("usersPrevBtn").disabled = !usersPagination || usersPagination.page <= 1;
    $("usersNextBtn").disabled =
      !usersPagination || usersPagination.page >= usersPagination.totalPages;

    $("usersBody").querySelectorAll("[data-user-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openUserDialog(btn.getAttribute("data-user-edit")));
    });
  }

  function openUserDialog(userId) {
    createMode = false;
    const user = usersCache.get(String(userId));
    if (!user) return;
    $("userDialogTitle").textContent = "Cihaz düzenle";
    $("userEditId").value = user.id;
    $("userDeviceId").value = user.deviceId || "";
    $("userDeviceId").disabled = true;
    $("userRcId").value = user.revenueCatUserId || "";
    $("userTokenBalance").value = user.tokenBalance ?? 0;
    $("userFormError").hidden = true;
    $("userDialog").showModal();
  }

  function openCreateDialog() {
    createMode = true;
    $("userDialogTitle").textContent = "Yeni cihaz";
    $("userEditId").value = "";
    $("userDeviceId").value = "";
    $("userDeviceId").disabled = false;
    $("userRcId").value = "";
    $("userTokenBalance").value = 10;
    $("userFormError").hidden = true;
    $("userDialog").showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    const payload = {
      revenueCatUserId: $("userRcId").value.trim() || null,
      tokenBalance: Number($("userTokenBalance").value),
    };

    let res;
    if (createMode) {
      payload.deviceId = $("userDeviceId").value.trim();
      if (!payload.deviceId) {
        $("userFormError").hidden = false;
        $("userFormError").textContent = "Device ID zorunlu.";
        return;
      }
      res = await fetch(`/api/apps/${appId}/proxy/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      const id = $("userEditId").value;
      res = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    const data = await res.json();
    if (!data.ok) {
      $("userFormError").hidden = false;
      $("userFormError").textContent = apiMessage(data, "Kaydedilemedi.");
      return;
    }
    $("userDialog").close();
    showToast(createMode ? "Cihaz oluşturuldu." : "Cihaz güncellendi.");
    await loadUsers();
    await loadAnalyse();
  }

  async function loadPurchases() {
    const params = new URLSearchParams({ page: String(purchasesPage), limit: String(pageSize) });
    if ($("purchaseSearch").value.trim()) params.set("search", $("purchaseSearch").value.trim());
    if ($("purchaseProcessedFilter").value) params.set("processed", $("purchaseProcessedFilter").value);

    const res = await fetch(`/api/apps/${appId}/proxy/purchases?${params}`);
    const data = await res.json();
    if (!data.ok) {
      $("purchasesError").hidden = false;
      $("purchasesError").textContent = apiMessage(data, "Satın alımlar alınamadı.");
      return;
    }
    $("purchasesError").hidden = true;
    const rows = listFromBody(data);
    purchasesPagination = data.bodyJson?.pagination || null;
    $("purchasesMeta").textContent = purchasesPagination
      ? `Sayfa ${purchasesPagination.page}/${purchasesPagination.totalPages} · ${formatNumber(
          purchasesPagination.total
        )} kayıt`
      : `${formatNumber(rows.length)} kayıt`;
    $("purchasesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
          <td>${escapeHtml(row.deviceId || row.deviceDbId || "—")}</td>
          <td>${escapeHtml(row.productId || "—")}</td>
          <td>${formatNumber(row.tokenAmount)}</td>
          <td><div class="user-cell-sub">${escapeHtml(row.transactionId || "—")}</div></td>
          <td>${row.processed ? '<span class="badge ok">İşlendi</span>' : "Bekliyor"}</td>
          <td>${formatDateTime(row.createdAt)}</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kayıt yok</td></tr>';

    $("purchasesPrevBtn").disabled = !purchasesPagination || purchasesPagination.page <= 1;
    $("purchasesNextBtn").disabled =
      !purchasesPagination || purchasesPagination.page >= purchasesPagination.totalPages;
  }

  async function loadNotifications() {
    const params = new URLSearchParams({
      page: String(notificationsPage),
      limit: String(pageSize),
    });
    if ($("notificationSearch").value.trim()) {
      params.set("search", $("notificationSearch").value.trim());
    }
    if ($("notificationReadFilter").value) {
      params.set("isRead", $("notificationReadFilter").value);
    }

    const res = await fetch(`/api/apps/${appId}/proxy/notifications?${params}`);
    const data = await res.json();
    if (!data.ok) {
      $("notificationsError").hidden = false;
      $("notificationsError").textContent = apiMessage(data, "Bildirimler alınamadı.");
      return;
    }
    $("notificationsError").hidden = true;
    const rows = listFromBody(data);
    notificationsPagination = data.bodyJson?.pagination || null;
    $("notificationsMeta").textContent = notificationsPagination
      ? `Sayfa ${notificationsPagination.page}/${notificationsPagination.totalPages} · ${formatNumber(
          notificationsPagination.total
        )} bildirim`
      : `${formatNumber(rows.length)} bildirim`;
    $("notificationsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
          <td>${escapeHtml(row.deviceId || row.deviceDbId || "—")}</td>
          <td>${escapeHtml(row.title || "—")}</td>
          <td><div class="user-cell-sub">${escapeHtml(row.body || "—")}</div></td>
          <td>${row.isRead ? "Okundu" : "Okunmadı"}</td>
          <td>${formatDateTime(row.createdAt)}</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Bildirim yok</td></tr>';

    $("notificationsPrevBtn").disabled =
      !notificationsPagination || notificationsPagination.page <= 1;
    $("notificationsNextBtn").disabled =
      !notificationsPagination ||
      notificationsPagination.page >= notificationsPagination.totalPages;
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `view-${view}`);
    });
    if (view === "users") loadUsers();
    if (view === "purchases") loadPurchases();
    if (view === "notifications") loadNotifications();
    if (view === "analytics") renderAnalytics();
    if (view === "revenuecat" && window.RevenueCatPanel) {
      window.RevenueCatPanel.load(appId);
    }
  }

  async function refreshAll() {
    await loadAppMeta();
    await loadHealth();
    await loadAnalyse();
    if (currentView === "users") await loadUsers();
    if (currentView === "purchases") await loadPurchases();
    if (currentView === "notifications") await loadNotifications();
  }

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
  });
  $("refreshBtn").addEventListener("click", refreshAll);
  $("userSearchBtn").addEventListener("click", () => {
    usersPage = 1;
    loadUsers();
  });
  $("userClearBtn").addEventListener("click", () => {
    $("userSearch").value = "";
    $("userTokensFilter").value = "";
    usersPage = 1;
    loadUsers();
  });
  $("usersPrevBtn").addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });
  $("usersNextBtn").addEventListener("click", () => {
    usersPage += 1;
    loadUsers();
  });
  $("userCreateBtn").addEventListener("click", openCreateDialog);
  $("userCancelBtn").addEventListener("click", () => $("userDialog").close());
  $("userForm").addEventListener("submit", saveUser);

  $("purchaseSearchBtn").addEventListener("click", () => {
    purchasesPage = 1;
    loadPurchases();
  });
  $("purchaseClearBtn").addEventListener("click", () => {
    $("purchaseSearch").value = "";
    $("purchaseProcessedFilter").value = "";
    purchasesPage = 1;
    loadPurchases();
  });
  $("purchasesPrevBtn").addEventListener("click", () => {
    if (purchasesPage > 1) {
      purchasesPage -= 1;
      loadPurchases();
    }
  });
  $("purchasesNextBtn").addEventListener("click", () => {
    purchasesPage += 1;
    loadPurchases();
  });

  $("notificationSearchBtn").addEventListener("click", () => {
    notificationsPage = 1;
    loadNotifications();
  });
  $("notificationClearBtn").addEventListener("click", () => {
    $("notificationSearch").value = "";
    $("notificationReadFilter").value = "";
    notificationsPage = 1;
    loadNotifications();
  });
  $("notificationsPrevBtn").addEventListener("click", () => {
    if (notificationsPage > 1) {
      notificationsPage -= 1;
      loadNotifications();
    }
  });
  $("notificationsNextBtn").addEventListener("click", () => {
    notificationsPage += 1;
    loadNotifications();
  });

  $("settingsBtn")?.addEventListener("click", () => {
    window.location.href = `/apps/${appId}/edit`;
  });

  (async function init() {
    try {
      const me = await window.PanelAuth?.getMe?.();
      canManage = ["super_admin", "admin", "manager"].includes(String(me?.role || "").toLowerCase());
    } catch {
      canManage = false;
    }
    applyRoleUi();
    await refreshAll();
  })();
})();
