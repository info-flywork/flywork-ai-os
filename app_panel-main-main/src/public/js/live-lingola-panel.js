(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) {
    document.body.innerHTML =
      '<main class="page-content"><div class="alert alert-error">Geçersiz uygulama.</div></main>';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const pageSize = 20;
  let currentView = "overview";
  let canManage = false;
  let analyseData = null;
  let usersPage = 1;
  let usersPagination = null;
  let usersCache = new Map();
  let selectedUser = null;
  let translationsPage = 1;
  let translationsPagination = null;
  let translationsCache = new Map();
  let logsPage = 1;
  let logsPagination = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNumber(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat("tr-TR").format(Number(value));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function apiMessage(data, fallback) {
    return data?.bodyJson?.error || data?.bodyJson?.message || data?.error || fallback;
  }

  function listFromBody(data) {
    const body = data?.bodyJson || {};
    const list = body.data ?? body.users ?? body.items ?? [];
    return Array.isArray(list) ? list : [];
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function setHealth(ok, text) {
    const badge = $("healthBadge");
    badge.className = `badge ${ok ? "ok" : "fail"}`;
    badge.innerHTML = `<span class="badge-dot"></span>${escapeHtml(text)}`;
  }

  function applyRoleUi() {
    $("viewerBanner").hidden = canManage;
    document.querySelectorAll("[data-manager-only]").forEach((element) => {
      element.hidden = !canManage;
      element.style.display = canManage ? "" : "none";
    });
  }

  async function loadAppMeta() {
    const response = await fetch(`/api/apps/${appId}`);
    if (response.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Uygulama bilgisi alınamadı.");

    const app = data.app;
    const name = app.appName || "Live Lingola";
    setText("appTitle", name);
    setText("sidebarAppName", name);
    setText("breadcrumbName", name);
    if (app.iconUrl) {
      $("headerAppIcon").src = app.iconUrl;
      $("headerAppIcon").hidden = false;
      $("headerAppIconFallback").hidden = true;
    }
    setText(
      "apiInfo",
      !app.apiBaseUrl
        ? "API URL tanımlı değil — Ayarlardan ekleyin"
        : app.hasPanelApiKey
          ? app.apiBaseUrl
          : `${app.apiBaseUrl} · API anahtarı eksik`
    );
    return app;
  }

  async function loadHealth() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/health`);
      const data = await response.json();
      setHealth(Boolean(data.ok), data.ok ? "API bağlı" : "API erişilemiyor");
    } catch {
      setHealth(false, "API erişilemiyor");
    }
  }

  function setOverviewLoading(loading) {
    [
      "statTotalUsers",
      "statPremiumUsers",
      "statTotalTranslations",
      "statFavorites",
      "statNewUsersToday",
      "statActiveUsersToday",
      "statTranslationsToday",
      "statUsersWithTranslations",
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function renderDaily(rows) {
    $("dailyBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(String(row.date || "").slice(0, 10) || "—")}</td>
              <td>${formatNumber(row.newUsers)}</td>
              <td>${formatNumber(row.activeUsers)}</td>
              <td><strong>${formatNumber(row.translations)}</strong></td>
              <td>${formatNumber(row.photoTranslations)}</td>
              <td>${formatNumber(row.favorites)}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Henüz hareket yok</td></tr>';
  }

  function renderInsightCard(title, subtitle, items) {
    const rows = Array.isArray(items) ? items : [];
    const max = Math.max(...rows.map((item) => Number(item.count || 0)), 1);
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(subtitle)}</p>
      ${
        rows.length
          ? `<div class="insight-bar-list">${rows
              .map((item) => {
                const count = Number(item.count || 0);
                const width = Math.max(Math.round((count / max) * 100), count ? 5 : 0);
                return `<div class="insight-bar-row">
                  <span class="insight-bar-label">${escapeHtml(item.label || "—")}</span>
                  <div class="insight-bar-track"><div class="insight-bar-fill" style="width:${width}%"></div></div>
                  <span class="insight-bar-meta">${formatNumber(count)}</span>
                </div>`;
              })
              .join("")}</div>`
          : '<p class="user-cell-sub">Veri yok</p>'
      }
    </article>`;
  }

  function renderAnalytics() {
    const insights = analyseData?.insights;
    if (!insights) {
      $("analyticsGrid").innerHTML =
        '<p class="user-cell-sub">Analiz verisi yüklenemedi. Yenile düğmesini kullanın.</p>';
      return;
    }
    $("analyticsGrid").innerHTML = [
      renderInsightCard("Çeviri türleri", "Metin, fotoğraf ve ses dağılımı", insights.translationTypes),
      renderInsightCard("En çok kullanılan dil çiftleri", "Kaynak ve hedef dil", insights.languagePairs),
      renderInsightCard("Giriş sağlayıcıları", "Kullanıcı hesap dağılımı", insights.authProviders),
      renderInsightCard("Uzman modları", "Çevirilerde kullanılan uzman seçimi", insights.experts),
    ].join("");
  }

  async function loadAnalyse() {
    setOverviewLoading(true);
    $("analyseError").hidden = true;
    const response = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await response.json();
    setOverviewLoading(false);
    if (!data.ok) {
      $("analyseError").hidden = false;
      $("analyseError").textContent = apiMessage(data, "Analiz verisi alınamadı.");
      analyseData = null;
      renderDaily([]);
      renderAnalytics();
      return;
    }

    analyseData = data.bodyJson || {};
    const summary = analyseData.summary || {};
    setText("statTotalUsers", formatNumber(summary.totalUsers));
    setText("statPremiumUsers", formatNumber(summary.premiumUsers));
    setText("statTotalTranslations", formatNumber(summary.totalTranslations));
    setText("statFavorites", formatNumber(summary.totalFavorites));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statActiveUsersToday", formatNumber(summary.updatedUsersToday));
    setText("statTranslationsToday", formatNumber(summary.translationsToday));
    setText("statUsersWithTranslations", formatNumber(summary.usersWithTranslations));
    setText(
      "analyseHint",
      `Sözleşme v${analyseData.contractVersion || 1} · Saat dilimi: ${analyseData.timezone || "Europe/Istanbul"}`
    );
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  function userLabel(user) {
    return user.displayName || user.email || user.firebaseUid || `Kullanıcı #${user.id}`;
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';
    const params = new URLSearchParams({ page: usersPage, limit: pageSize });
    const search = $("userSearch").value.trim();
    const premium = $("userPremiumFilter").value;
    if (search) params.set("search", search);
    if (premium) params.set("premium", premium);

    const response = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("usersBody").innerHTML = "";
      $("usersError").hidden = false;
      $("usersError").textContent = apiMessage(data, "Kullanıcı listesi alınamadı.");
      return;
    }

    const users = listFromBody(data);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache = new Map(users.map((user) => [String(user.id), user]));
    setText(
      "usersMeta",
      usersPagination
        ? `${formatNumber(usersPagination.total)} kullanıcı · sayfa ${usersPagination.page}/${usersPagination.totalPages}`
        : `${users.length} kullanıcı`
    );
    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const extras = user.extras || {};
            const secondary = user.displayName && user.email ? user.email : user.firebaseUid;
            return `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(userLabel(user))}</div>
                <div class="user-cell-sub">${escapeHtml(secondary || `#${user.id}`)}</div>
              </td>
              <td>${escapeHtml(extras.authProvider || "—")}</td>
              <td>${escapeHtml(extras.fromLanguage || "—")} → ${escapeHtml(extras.toLanguage || "—")}</td>
              <td>${extras.isPremium ? '<span class="badge ok">Premium</span>' : "Ücretsiz"}</td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-user-id="${escapeHtml(user.id)}">Detay</button></td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Eşleşen kullanıcı yok</td></tr>';
    $("usersPrevBtn").disabled = usersPage <= 1;
    $("usersNextBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function renderUserDetail(user) {
    const extras = user.extras || {};
    const stats = user.translationStats || {};
    return `
      <div class="user-profile-card user-profile-card--compact">
        <div class="user-cell-title">${escapeHtml(userLabel(user))}</div>
        <div class="user-cell-sub">${escapeHtml(user.email || user.firebaseUid || `#${user.id}`)}</div>
      </div>
      <div class="stat-grid stat-grid--4" style="margin-top:16px">
        <article class="card stat-card"><div class="stat-label">Çeviri</div><div class="stat-value">${formatNumber(stats.translationCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">Favori</div><div class="stat-value">${formatNumber(stats.favoriteCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">Fotoğraf</div><div class="stat-value">${formatNumber(stats.photoCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">Üyelik</div><div class="stat-value">${extras.isPremium ? "Pro" : "Free"}</div></article>
      </div>
      <table class="data-table" style="margin-top:16px">
        <tbody>
          <tr><td class="user-cell-sub">Firebase UID</td><td>${escapeHtml(user.firebaseUid || "—")}</td></tr>
          <tr><td class="user-cell-sub">Giriş sağlayıcısı</td><td>${escapeHtml(extras.authProvider || "—")}</td></tr>
          <tr><td class="user-cell-sub">Dil çifti</td><td>${escapeHtml(extras.fromLanguage || "—")} → ${escapeHtml(extras.toLanguage || "—")}</td></tr>
          <tr><td class="user-cell-sub">Kullanım amacı</td><td>${escapeHtml(extras.usagePurpose || "—")}</td></tr>
          <tr><td class="user-cell-sub">İstenen özellik</td><td>${escapeHtml(extras.desiredFeature || "—")}</td></tr>
          <tr><td class="user-cell-sub">Bildirim</td><td>${extras.notificationsEnabled ? "Açık" : "Kapalı"}</td></tr>
          <tr><td class="user-cell-sub">Son çeviri</td><td>${formatDateTime(stats.lastTranslationAt)}</td></tr>
        </tbody>
      </table>`;
  }

  async function openUser(userId) {
    $("userDetailTitle").textContent = "Kullanıcı detayı";
    $("userDetailBody").innerHTML = '<p class="user-cell-sub">Yükleniyor...</p>';
    $("userDetailDialog").showModal();
    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`);
    const data = await response.json();
    if (!data.ok) {
      $("userDetailBody").innerHTML = `<div class="alert alert-error">${escapeHtml(
        apiMessage(data, "Kullanıcı detayı alınamadı.")
      )}</div>`;
      return;
    }
    selectedUser = data.bodyJson?.data || usersCache.get(String(userId));
    $("userDetailTitle").textContent = userLabel(selectedUser);
    $("userDetailBody").innerHTML = renderUserDetail(selectedUser);
  }

  function openEditUser() {
    if (!canManage || !selectedUser) return;
    $("editUserId").value = selectedUser.id;
    $("editDisplayName").value = selectedUser.displayName || "";
    $("editPremium").checked = Boolean(selectedUser.extras?.isPremium);
    $("editNotifications").checked = Boolean(selectedUser.extras?.notificationsEnabled);
    $("editUserError").hidden = true;
    $("userDetailDialog").close();
    $("editUserDialog").showModal();
  }

  async function loadTranslations() {
    $("translationsError").hidden = true;
    $("translationsBody").innerHTML = '<tr><td colspan="8" class="user-cell-sub">Yükleniyor...</td></tr>';
    const params = new URLSearchParams({ page: translationsPage, limit: pageSize });
    const search = $("translationSearch").value.trim();
    const type = $("translationTypeFilter").value;
    const favorite = $("translationFavoriteFilter").value;
    if (search) params.set("search", search);
    if (type) params.set("type", type);
    if (favorite) params.set("favorite", favorite);

    const response = await fetch(`/api/apps/${appId}/proxy/translations?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("translationsBody").innerHTML = "";
      $("translationsError").hidden = false;
      $("translationsError").textContent = apiMessage(data, "Çeviri listesi alınamadı.");
      return;
    }

    const rows = listFromBody(data);
    translationsPagination = data.bodyJson?.pagination || null;
    translationsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "translationsMeta",
      translationsPagination
        ? `${formatNumber(translationsPagination.total)} çeviri · sayfa ${translationsPagination.page}/${translationsPagination.totalPages}`
        : `${rows.length} çeviri`
    );
    $("translationsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.userName || row.userEmail || `#${row.userId}`)}</div>
                <div class="user-cell-sub">${escapeHtml(row.userEmail || row.firebaseUid || "")}</div>
              </td>
              <td><span class="badge">${escapeHtml(row.type || "text")}</span></td>
              <td>${escapeHtml(row.sourceLanguage || "—")} → ${escapeHtml(row.targetLanguage || "—")}</td>
              <td title="${escapeHtml(row.sourceText)}">${escapeHtml(String(row.sourceText || "—").slice(0, 70))}</td>
              <td title="${escapeHtml(row.translatedText || "")}">${escapeHtml(
                row.translatedText
                  ? String(row.translatedText).slice(0, 70)
                  : "Eski kayıtta metin yok"
              )}</td>
              <td>${row.isFavorite ? "★" : "—"}</td>
              <td class="user-cell-sub">${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-translation-id="${escapeHtml(row.id)}">Detay</button></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="8" class="user-cell-sub">Eşleşen çeviri yok</td></tr>';
    $("translationsPrevBtn").disabled = translationsPage <= 1;
    $("translationsNextBtn").disabled =
      translationsPage >= (translationsPagination?.totalPages || 1);
  }

  function openTranslation(id) {
    const row = translationsCache.get(String(id));
    if (!row) return;
    $("translationDetailTitle").textContent = `Çeviri #${row.id}`;
    $("translationDetailBody").innerHTML = `
      <div class="stat-grid stat-grid--3">
        <article class="card stat-card"><div class="stat-label">Tür</div><div class="stat-value">${escapeHtml(row.type || "text")}</div></article>
        <article class="card stat-card"><div class="stat-label">Dil çifti</div><div class="stat-value">${escapeHtml(row.sourceLanguage || "—")} → ${escapeHtml(row.targetLanguage || "—")}</div></article>
        <article class="card stat-card"><div class="stat-label">Uzman</div><div class="stat-value">${escapeHtml(row.expert || "General")}</div></article>
      </div>
      <div class="field" style="margin-top:16px"><label>Kaynak metin</label><div class="card card-padded">${escapeHtml(row.sourceText || "—")}</div></div>
      <div class="field"><label>Çeviri</label><div class="card card-padded">${escapeHtml(
        row.translatedText || "Eski kayıtta çeviri metni bulunmuyor."
      )}</div></div>
      <p class="field-hint">${escapeHtml(row.userName || row.userEmail || `Kullanıcı #${row.userId}`)} · ${formatDateTime(row.createdAt)} ${row.isFavorite ? "· Favori" : ""}</p>`;
    $("translationDialog").showModal();
  }

  async function loadLogs() {
    $("logsError").hidden = true;
    $("logsBody").innerHTML = '<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>';
    const params = new URLSearchParams({ page: logsPage, limit: 30 });
    const search = $("logSearch").value.trim();
    const level = $("logLevelFilter").value;
    if (search) params.set("search", search);
    if (level) params.set("level", level);
    const response = await fetch(`/api/apps/${appId}/proxy/logs?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("logsBody").innerHTML = "";
      $("logsError").hidden = false;
      $("logsError").textContent = apiMessage(data, "Log listesi alınamadı.");
      return;
    }
    const rows = listFromBody(data);
    logsPagination = data.bodyJson?.pagination || null;
    setText(
      "logsMeta",
      logsPagination
        ? `${formatNumber(logsPagination.total)} kayıt · sayfa ${logsPagination.page}/${logsPagination.totalPages}`
        : `${rows.length} kayıt`
    );
    $("logsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><span class="badge ${row.level === "critical" || row.level === "error" ? "fail" : row.level === "warning" ? "warn" : ""}">${escapeHtml(row.level || "—")}</span></td>
              <td>${escapeHtml(row.type || "—")}</td>
              <td title="${escapeHtml(row.stack || row.message)}">${escapeHtml(String(row.message || "—").slice(0, 120))}</td>
              <td class="user-cell-sub">${escapeHtml(row.endpoint || "—")}</td>
              <td>${escapeHtml(row.platform || row.source || "—")}</td>
              <td class="user-cell-sub">${formatDateTime(row.created_at || row.createdAt)}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kayıt yok</td></tr>';
    $("logsPrevBtn").disabled = logsPage <= 1;
    $("logsNextBtn").disabled = logsPage >= (logsPagination?.totalPages || 1);
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".view-panel").forEach((element) => {
      element.classList.toggle("active", element.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((element) => {
      element.classList.toggle("active", element.dataset.view === view);
    });
    if (view === "users") loadUsers();
    if (view === "translations") loadTranslations();
    if (view === "analytics") renderAnalytics();
    if (view === "logs") loadLogs();
    if (view === "revenuecat") window.RevenueCatPanel?.load?.(appId);
  }

  async function refreshAll() {
    const button = $("refreshBtn");
    button.disabled = true;
    button.textContent = "Yenileniyor...";
    try {
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
      if (currentView === "users") await loadUsers();
      if (currentView === "translations") await loadTranslations();
      if (currentView === "logs") await loadLogs();
    } finally {
      button.disabled = false;
      button.textContent = "Yenile";
    }
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("settingsBtn").addEventListener("click", () => {
    if (canManage) window.location.href = `/apps/${appId}/edit`;
  });
  $("refreshBtn").addEventListener("click", () => refreshAll().catch(() => {}));

  $("userSearchBtn").addEventListener("click", () => {
    usersPage = 1;
    loadUsers();
  });
  $("userClearBtn").addEventListener("click", () => {
    $("userSearch").value = "";
    $("userPremiumFilter").value = "";
    usersPage = 1;
    loadUsers();
  });
  $("userSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("userSearchBtn").click();
  });
  $("usersPrevBtn").addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });
  $("usersNextBtn").addEventListener("click", () => {
    if (usersPage < (usersPagination?.totalPages || 1)) {
      usersPage += 1;
      loadUsers();
    }
  });
  $("usersBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-id]");
    if (button) openUser(button.dataset.userId);
  });

  $("closeUserDetailBtn").addEventListener("click", () => $("userDetailDialog").close());
  $("editUserBtn").addEventListener("click", openEditUser);
  $("closeEditUserBtn").addEventListener("click", () => $("editUserDialog").close());
  $("editUserForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("editUserError").hidden = true;
    try {
      const response = await fetch(
        `/api/apps/${appId}/proxy/users/${encodeURIComponent($("editUserId").value)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: $("editDisplayName").value.trim() || null,
            isPremium: $("editPremium").checked,
            notificationsEnabled: $("editNotifications").checked,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("editUserError").hidden = false;
        $("editUserError").textContent = apiMessage(data, "Kullanıcı güncellenemedi.");
        return;
      }
      $("editUserDialog").close();
      selectedUser = null;
      showToast("Kullanıcı güncellendi");
      await Promise.all([loadUsers(), loadAnalyse()]);
    } finally {
      button.disabled = false;
    }
  });

  $("translationSearchBtn").addEventListener("click", () => {
    translationsPage = 1;
    loadTranslations();
  });
  $("translationClearBtn").addEventListener("click", () => {
    $("translationSearch").value = "";
    $("translationTypeFilter").value = "";
    $("translationFavoriteFilter").value = "";
    translationsPage = 1;
    loadTranslations();
  });
  $("translationSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("translationSearchBtn").click();
  });
  $("translationsPrevBtn").addEventListener("click", () => {
    if (translationsPage > 1) {
      translationsPage -= 1;
      loadTranslations();
    }
  });
  $("translationsNextBtn").addEventListener("click", () => {
    if (translationsPage < (translationsPagination?.totalPages || 1)) {
      translationsPage += 1;
      loadTranslations();
    }
  });
  $("translationsBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-translation-id]");
    if (button) openTranslation(button.dataset.translationId);
  });
  $("closeTranslationBtn").addEventListener("click", () => $("translationDialog").close());

  $("logSearchBtn").addEventListener("click", () => {
    logsPage = 1;
    loadLogs();
  });
  $("logsPrevBtn").addEventListener("click", () => {
    if (logsPage > 1) {
      logsPage -= 1;
      loadLogs();
    }
  });
  $("logsNextBtn").addEventListener("click", () => {
    if (logsPage < (logsPagination?.totalPages || 1)) {
      logsPage += 1;
      loadLogs();
    }
  });

  (async function init() {
    const session = await window.PanelAuth.fetchSession();
    if (!session) return;
    canManage = window.PanelAuth.isManager(session);
    applyRoleUi();
    try {
      await loadAppMeta();
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
    } catch {
      setHealth(false, "Yükleme hatası");
    }
  })();

  window.LiveLingolaPanel = {
    openUserById(userId) {
      switchView("users");
      openUser(String(userId));
    },
  };
})();
