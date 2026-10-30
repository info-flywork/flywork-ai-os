(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) {
    document.body.innerHTML =
      '<main class="page-content"><div class="alert alert-error">Geçersiz uygulama.</div></main>';
    return;
  }

  let currentView = "overview";
  let canManage = false;
  let lastAudienceInsights = null;

  let usersPage = 1;
  const usersLimit = 20;
  let usersPagination = null;
  let usersSearch = "";
  const usersCache = new Map();

  let homeworksPage = 1;
  const homeworksLimit = 20;
  let homeworksPagination = null;
  let homeworkSearch = "";
  let chatsPage = 1;
  const chatsLimit = 20;
  let chatsPagination = null;
  let chatSearch = "";
  let chatStatus = "";
  const chatsCache = new Map();

  const toast = document.getElementById("toast");

  function $(id) {
    return document.getElementById(id);
  }

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
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(d);
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    const detail = body?.msg || body?.message || data?.error;
    if (detail && data?.statusCode) return `${detail} (HTTP ${data.statusCode})`;
    if (detail) return detail;
    if (data?.statusCode) return `${fallback} (HTTP ${data.statusCode})`;
    return fallback;
  }

  function authLabelTr(value) {
    const v = String(value || "").toLowerCase();
    const map = {
      guest: "Misafir",
      apple: "Apple",
      google: "Google",
      email: "E-posta",
      password: "Şifre",
      phone: "Telefon"
    };
    return map[v] || (v || "—");
  }

  function userStatusLabelTr(value) {
    const v = String(value || "").toLowerCase();
    const map = { active: "Aktif", inactive: "Pasif", banned: "Yasaklı" };
    return map[v] || (v || "—");
  }

  function chatStatusLabelTr(value) {
    const v = String(value || "").toLowerCase();
    const map = { active: "Aktif", open: "Açık", closed: "Kapalı", archived: "Arşiv" };
    return map[v] || (v || "—");
  }

  function setHealthBadge(ok, text) {
    const el = $("healthBadge");
    if (!el) return;
    el.className = "badge " + (ok ? "ok" : "fail");
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function setVal(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setStatsLoading(loading) {
    [
      "statTotalUsers",
      "statLoginsToday",
      "statNewUsersToday",
      "statTotalHomeworkImages",
      "statTotalChats",
      "statTotalMessages",
      "statHomeworkToday",
      "statChatsToday",
      "statActiveUsers",
      "statPremiumUsers"
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function usersFromBody(bodyJson) {
    if (!bodyJson) return [];
    const raw = bodyJson.users ?? bodyJson.data ?? bodyJson.items ?? [];
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.users)) return raw.users;
    if (raw && Array.isArray(raw.data)) return raw.data;
    return [];
  }

  function rowsFromBody(bodyJson, key) {
    if (!bodyJson) return [];
    const byKey = bodyJson[key];
    if (Array.isArray(byKey)) return byKey;
    if (Array.isArray(bodyJson.data)) return bodyJson.data;
    if (Array.isArray(bodyJson.items)) return bodyJson.items;
    return [];
  }

  function applyReadOnlyUi() {
    const banner = $("viewerBanner");
    if (banner) banner.hidden = canManage;
    document.querySelectorAll("[data-manager-only]").forEach((el) => {
      el.hidden = !canManage;
      el.style.display = canManage ? "" : "none";
    });
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".view-panel").forEach((el) => {
      el.classList.toggle("active", el.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    if (view === "users") loadUsers();
    if (view === "homeworks") loadHomeworkImages();
    if (view === "chats") loadChats();
    if (view === "analytics") renderAnalyticsView();
    if (view === "revenuecat" && window.RevenueCatPanel?.load) window.RevenueCatPanel.load(appId);
  }

  async function loadAppMeta() {
    const response = await fetch(`/api/apps/${appId}`);
    if (response.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const data = await response.json();
    if (!response.ok) return null;

    const app = data.app;
    const name = app.appName || "HomeworkSnap";
    $("appTitle").textContent = name;
    $("sidebarAppName").textContent = name;
    $("breadcrumbName").textContent = name;

    const iconImg = $("headerAppIcon");
    const iconFallback = $("headerAppIconFallback");
    if (app.iconUrl && iconImg) {
      iconImg.src = app.iconUrl;
      iconImg.hidden = false;
      if (iconFallback) iconFallback.hidden = true;
    } else if (iconFallback) {
      iconFallback.textContent = "HS";
      iconFallback.hidden = false;
      if (iconImg) iconImg.hidden = true;
    }

    if (!app.apiBaseUrl) {
      $("apiInfo").textContent = "API URL tanımlı değil — Ayarlardan ekleyin";
    } else if (!app.hasPanelApiKey) {
      $("apiInfo").textContent = `${app.apiBaseUrl} · API anahtarı eksik`;
    } else {
      $("apiInfo").textContent = app.apiBaseUrl;
    }
    return app;
  }

  async function loadHealth() {
    const response = await fetch(`/api/apps/${appId}/proxy/health`);
    const data = await response.json();
    setHealthBadge(data.ok, data.ok ? "API bağlı" : "API erişilemiyor");
  }

  function renderMiniChartCell(logins, newUsers, homeworkUploads, chats) {
    const total = Number(logins || 0) + Number(newUsers || 0) + Number(homeworkUploads || 0) + Number(chats || 0);
    if (total <= 0) return '<span class="user-cell-sub">—</span>';
    const l = Math.round((Number(logins || 0) / total) * 100);
    const n = Math.round((Number(newUsers || 0) / total) * 100);
    const h = Math.round((Number(homeworkUploads || 0) / total) * 100);
    const c = Math.max(0, 100 - l - n - h);
    return `<div class="daily-meter" style="display:flex; height:8px; border-radius:999px; overflow:hidden;">
      <span style="width:${l}%;background:#2563eb"></span>
      <span style="width:${n}%;background:#14b8a6"></span>
      <span style="width:${h}%;background:#f59e0b"></span>
      <span style="width:${c}%;background:#8b5cf6"></span>
    </div>`;
  }

  function renderInsightBars(items, labelMapper) {
    if (!items?.length) return '<p class="user-cell-sub">Veri yok</p>';
    const max = Math.max(...items.map((i) => Number(i.count || 0)), 1);
    return `<div class="insight-bar-list">${items
      .slice(0, 12)
      .map((item) => {
        const count = Number(item.count || 0);
        const w = Math.max(Math.round((count / max) * 100), count > 0 ? 6 : 0);
        const label = labelMapper ? labelMapper(item.label || item.code || "—") : item.label || item.code || "—";
        return `<div class="insight-bar-row">
          <span class="insight-bar-label">${escapeHtml(label)}</span>
          <div class="insight-bar-track"><div class="insight-bar-fill" style="width:${w}%"></div></div>
          <span class="insight-bar-meta">${formatNumber(count)} · %${item.percent ?? 0}</span>
        </div>`;
      })
      .join("")}</div>`;
  }

  function renderInsightCard(title, subtitle, items, labelMapper) {
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      ${renderInsightBars(items, labelMapper)}
    </article>`;
  }

  function renderAnalyticsView() {
    const grid = $("analyticsGrid");
    if (!grid) return;
    if (!lastAudienceInsights) {
      grid.innerHTML = '<p class="user-cell-sub">Analiz verisi yüklenemedi — Yenile\'ye basın.</p>';
      $("analyticsError").hidden = true;
      return;
    }
    grid.innerHTML = [
      renderInsightCard("Giriş sağlayıcıları", "Google / Apple / Misafir dağılımı", lastAudienceInsights.authProviders, authLabelTr),
      renderInsightCard("Sohbet durumları", "Sohbet akışı durum dağılımı", lastAudienceInsights.chatStatuses, chatStatusLabelTr)
    ].join("");
    $("analyticsError").hidden = true;
  }

  async function loadAnalyse() {
    $("dailyError").hidden = true;
    setStatsLoading(true);
    const response = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await response.json();
    setStatsLoading(false);

    if (!data.ok) {
      [
        "statTotalUsers",
        "statLoginsToday",
        "statNewUsersToday",
        "statTotalHomeworkImages",
        "statHomeworkToday",
        "statTotalChats",
        "statChatsToday",
        "statTotalMessages",
        "statActiveUsers",
        "statPremiumUsers",
        "analyticsActiveUsers",
        "analyticsPremiumUsers",
        "analyticsTotalMessages"
      ].forEach((id) => setVal(id, "—"));
      $("dailyBody").innerHTML = "";
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      lastAudienceInsights = null;
      if (currentView === "analytics") renderAnalyticsView();
      return;
    }

    const body = data.bodyJson || {};
    const summary = body.summary || {};

    setVal("statTotalUsers", formatNumber(summary.totalUsers));
    setVal("statLoginsToday", formatNumber(summary.loginsToday));
    setVal("statNewUsersToday", formatNumber(summary.newUsersToday));
    setVal("statTotalHomeworkImages", formatNumber(summary.totalHomeworkImages));
    setVal("statHomeworkToday", formatNumber(summary.homeworkToday));
    setVal("statTotalChats", formatNumber(summary.totalChats));
    setVal("statChatsToday", formatNumber(summary.chatsToday));
    setVal("statTotalMessages", formatNumber(summary.totalMessages));
    setVal("statActiveUsers", formatNumber(summary.activeUsers));
    setVal("statPremiumUsers", formatNumber(summary.premiumUsers));

    setVal("analyticsActiveUsers", formatNumber(summary.activeUsers));
    setVal("analyticsPremiumUsers", formatNumber(summary.premiumUsers));
    setVal("analyticsTotalMessages", formatNumber(summary.totalMessages));

    const version = body.contractVersion;
    const tz = body.timezone || "Europe/Istanbul";
    const hint = $("analyseHint");
    if (hint) {
      hint.textContent = version
        ? `Sözleşme v${version} · Metrikler ${tz} saat dilimine göre hesaplanır.`
        : `Metrikler ${tz} saat dilimine göre hesaplanır.`;
    }

    const daily = Array.isArray(body.daily) ? body.daily.slice() : [];
    const maxLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    const maxHomework = Math.max(...daily.map((d) => Number(d.homeworkUploads || 0)), 1);
    const maxChats = Math.max(...daily.map((d) => Number(d.chats || 0)), 1);

    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const homeworkUploads = Number(row.homeworkUploads || 0);
            const chats = Number(row.chats || 0);
            const loginW = Math.max(Math.round((logins / maxLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxNew) * 100), newUsers > 0 ? 8 : 0);
            const homeworkW = Math.max(Math.round((homeworkUploads / maxHomework) * 100), homeworkUploads > 0 ? 8 : 0);
            const chatW = Math.max(Math.round((chats / maxChats) * 100), chats > 0 ? 8 : 0);
            return `<tr>
              <td><div class="daily-date-cell">${escapeHtml(row.date || "—")}</div></td>
              <td><div class="daily-metric-cell"><strong>${formatNumber(logins)}</strong><div class="daily-meter"><span style="width:${loginW}%"></span></div></div></td>
              <td><div class="daily-metric-cell"><strong>${formatNumber(newUsers)}</strong><div class="daily-meter daily-meter--new"><span style="width:${newW}%"></span></div></div></td>
              <td><div class="daily-metric-cell"><strong>${formatNumber(homeworkUploads)}</strong><div class="daily-meter"><span style="width:${homeworkW}%"></span></div></div></td>
              <td><div class="daily-metric-cell"><strong>${formatNumber(chats)}</strong><div class="daily-meter"><span style="width:${chatW}%"></span></div></div></td>
              <td>${renderMiniChartCell(logins, newUsers, homeworkUploads, chats)}</td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Veri yok</td></tr>';

    lastAudienceInsights = body.audienceInsights || null;
    if (currentView === "analytics") renderAnalyticsView();
  }

  function renderUserDetailProfile(user) {
    const ex = user.extras || {};
    const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
    const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
    const rows = [
      ["Kimlik", user.id],
      ["Giriş", authLabelTr(ex.authProvider)],
      ["Durum", userStatusLabelTr(user.status)],
      ["Son giriş", formatDateTime(user.lastLoginAt)],
      ["Kayıt", formatDateTime(user.createdAt)]
    ];
    return `
      <div class="user-cell-title">${label}</div>
      ${sub ? `<div class="user-cell-sub">${sub}</div>` : ""}
      <table class="data-table" style="margin-top:12px">
        <tbody>
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td class="user-cell-sub" style="width:130px">${escapeHtml(k)}</td><td>${escapeHtml(v ?? "—")}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  function renderUserDetailStats(user) {
    const ex = user.extras || {};
    return `
      <article class="card stat-card"><div class="stat-label">Ödev görseli</div><div class="stat-value">${formatNumber(ex.homeworkImageCount)}</div></article>
      <article class="card stat-card"><div class="stat-label">Sohbet</div><div class="stat-value">${formatNumber(ex.chatCount)}</div></article>
      <article class="card stat-card"><div class="stat-label">Mesaj</div><div class="stat-value">${formatNumber(ex.messageCount)}</div></article>
      <article class="card stat-card"><div class="stat-label">Premium</div><div class="stat-value">${ex.isPremium ? "Evet" : "Hayır"}</div></article>`;
  }

  async function openUserDetail(userId) {
    $("userDetailTitle").textContent = "Kullanıcı detay";
    $("userDetailProfile").innerHTML = '<p class="user-cell-sub">Yükleniyor...</p>';
    $("userDetailStats").innerHTML = '<p class="user-cell-sub">Yükleniyor...</p>';
    $("userDetailError").hidden = true;
    $("userDetailDialog").showModal();

    try {
      const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`);
      const data = await response.json();
      if (!data.ok) throw new Error(apiErrorMessage(data, "Kullanıcı detayı alınamadı."));
      const user = data.bodyJson?.data;
      if (!user) throw new Error("Kullanıcı bulunamadı.");
      usersCache.set(String(user.id), user);
      $("userDetailTitle").textContent = user.displayName || user.email || `Kullanıcı #${user.id}`;
      $("userDetailProfile").innerHTML = renderUserDetailProfile(user);
      $("userDetailStats").innerHTML = renderUserDetailStats(user);
    } catch (err) {
      $("userDetailError").hidden = false;
      $("userDetailError").textContent = err.message || "Detay yüklenemedi.";
      $("userDetailProfile").innerHTML = "";
      $("userDetailStats").innerHTML = "";
    }
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editStatus").value = user.status || "active";
    const meta = [];
    if (ex.authProvider) meta.push(`Giriş: ${authLabelTr(ex.authProvider)}`);
    if (ex.homeworkImageCount != null) meta.push(`Ödev: ${formatNumber(ex.homeworkImageCount)}`);
    if (ex.chatCount != null) meta.push(`Sohbet: ${formatNumber(ex.chatCount)}`);
    if (ex.messageCount != null) meta.push(`Mesaj: ${formatNumber(ex.messageCount)}`);
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";
    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: usersPage, limit: usersLimit });
    if (usersSearch) params.set("search", usersSearch);
    const response = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("usersBody").innerHTML = "";
      $("usersError").hidden = false;
      $("usersError").textContent = apiErrorMessage(data, "Liste alınamadı.");
      $("usersMeta").textContent = "Liste alınamadı";
      $("prevPageBtn").disabled = true;
      $("nextPageBtn").disabled = true;
      return;
    }

    const users = usersFromBody(data.bodyJson);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache.clear();
    users.forEach((u) => usersCache.set(String(u.id), u));

    $("usersMeta").textContent = usersPagination
      ? `${formatNumber(usersPagination.total)} kullanıcı · sayfa ${usersPagination.page}/${usersPagination.totalPages}`
      : `${users.length} kayıt`;

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
            const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
            const status = user.status || "inactive";
            const premium = Boolean(user.extras?.isPremium);
            return `<tr>
              <td>
                <div class="user-cell-title">${label}</div>
                ${sub ? `<div class="user-cell-sub">${sub}</div>` : `<div class="user-cell-sub">${escapeHtml(user.id)}</div>`}
              </td>
              <td>${escapeHtml(authLabelTr(user.extras?.authProvider))}</td>
              <td>${premium ? '<span class="badge ok">Premium</span>' : "—"}</td>
              <td><span class="status-pill ${escapeHtml(status)}">${escapeHtml(userStatusLabelTr(status))}</span></td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(user.lastLoginAt))}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(user.createdAt))}</td>
              <td>
                <div style="display:flex; gap:6px; justify-content:flex-end">
                  <button type="button" class="btn btn-sm btn-ghost" data-user-detail="${escapeHtml(user.id)}">Detay</button>
                  ${
                    canManage
                      ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${escapeHtml(user.id)}">Düzenle</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Eşleşen kullanıcı yok</td></tr>';

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  async function loadHomeworkImages() {
    $("homeworksError").hidden = true;
    $("homeworksBody").innerHTML = '<tr><td colspan="4" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: homeworksPage, limit: homeworksLimit });
    if (homeworkSearch) params.set("search", homeworkSearch);
    const response = await fetch(`/api/apps/${appId}/proxy/homework-images?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("homeworksBody").innerHTML = "";
      $("homeworksError").hidden = false;
      $("homeworksError").textContent = apiErrorMessage(data, "Ödev görselleri alınamadı.");
      $("homeworksMeta").textContent = "Liste alınamadı";
      $("homeworkPrevBtn").disabled = true;
      $("homeworkNextBtn").disabled = true;
      return;
    }

    const rows = rowsFromBody(data.bodyJson, "homeworkImages");
    homeworksPagination = data.bodyJson?.pagination || null;
    $("homeworksMeta").textContent = homeworksPagination
      ? `${formatNumber(homeworksPagination.total)} kayıt · sayfa ${homeworksPagination.page}/${homeworksPagination.totalPages}`
      : `${rows.length} kayıt`;

    $("homeworksBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const preview = row.imageUrl || row.previewUrl || row.url;
            const userLabel = row.userLabel || row.userDisplayName || row.userEmail || row.userId || "—";
            return `<tr>
              <td class="user-cell-sub">${escapeHtml(row.id || "—")}</td>
              <td>${escapeHtml(userLabel)}</td>
              <td>${
                preview
                  ? `<a href="${escapeHtml(preview)}" target="_blank" rel="noopener noreferrer">Önizleme</a>`
                  : "—"
              }</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.createdAt || row.date))}</td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="4" class="user-cell-sub">Kayıt yok</td></tr>';

    $("homeworkPrevBtn").disabled = homeworksPage <= 1;
    $("homeworkNextBtn").disabled = homeworksPage >= (homeworksPagination?.totalPages || 1);
  }

  async function openChatDetail(chatId) {
    $("chatDetailTitle").textContent = "Sohbet detay";
    $("chatDetailMeta").textContent = "Yükleniyor...";
    $("chatDetailBody").innerHTML = '<tr><td colspan="3" class="user-cell-sub">Yükleniyor...</td></tr>';
    $("chatDetailError").hidden = true;
    $("chatDetailDialog").showModal();

    try {
      const response = await fetch(`/api/apps/${appId}/proxy/chats/${encodeURIComponent(chatId)}`);
      const data = await response.json();
      if (!data.ok) throw new Error(apiErrorMessage(data, "Sohbet detayı alınamadı."));
      const chat = data.bodyJson?.data || data.bodyJson?.chat || data.bodyJson;
      if (!chat) throw new Error("Sohbet bulunamadı.");
      chatsCache.set(String(chat.id), chat);
      const userLabel = chat.userLabel || chat.userDisplayName || chat.userEmail || chat.userId || "—";
      $("chatDetailTitle").textContent = chat.title || `Sohbet #${chat.id}`;
      $("chatDetailMeta").textContent = `${userLabel} · ${chatStatusLabelTr(chat.status)} · ${formatDateTime(chat.createdAt || chat.date)}`;
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      $("chatDetailBody").innerHTML = messages.length
        ? messages
            .map((m) => `<tr>
              <td>${escapeHtml(m.role || "—")}</td>
              <td>${escapeHtml(m.content || m.text || "—")}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(m.createdAt || m.date))}</td>
            </tr>`)
            .join("")
        : '<tr><td colspan="3" class="user-cell-sub">Mesaj yok</td></tr>';
    } catch (err) {
      $("chatDetailError").hidden = false;
      $("chatDetailError").textContent = err.message || "Detay yüklenemedi.";
      $("chatDetailMeta").textContent = "—";
      $("chatDetailBody").innerHTML = "";
    }
  }

  async function loadChats() {
    $("chatsError").hidden = true;
    $("chatsBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: chatsPage, limit: chatsLimit });
    if (chatSearch) params.set("search", chatSearch);
    if (chatStatus) params.set("status", chatStatus);
    const response = await fetch(`/api/apps/${appId}/proxy/chats?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("chatsBody").innerHTML = "";
      $("chatsError").hidden = false;
      $("chatsError").textContent = apiErrorMessage(data, "Sohbet listesi alınamadı.");
      $("chatsMeta").textContent = "Liste alınamadı";
      $("chatPrevBtn").disabled = true;
      $("chatNextBtn").disabled = true;
      return;
    }

    const rows = rowsFromBody(data.bodyJson, "chats");
    chatsPagination = data.bodyJson?.pagination || null;
    chatsCache.clear();
    rows.forEach((row) => chatsCache.set(String(row.id), row));

    $("chatsMeta").textContent = chatsPagination
      ? `${formatNumber(chatsPagination.total)} sohbet · sayfa ${chatsPagination.page}/${chatsPagination.totalPages}`
      : `${rows.length} kayıt`;

    $("chatsBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const userLabel = row.userLabel || row.userDisplayName || row.userEmail || row.userId || "—";
            const status = row.status || "";
            return `<tr>
              <td class="user-cell-sub">${escapeHtml(row.id || "—")}</td>
              <td>${escapeHtml(userLabel)}</td>
              <td>${escapeHtml(row.title || "—")}</td>
              <td><span class="status-pill ${escapeHtml(String(status).toLowerCase())}">${escapeHtml(chatStatusLabelTr(status))}</span></td>
              <td>${formatNumber(row.messagesCount ?? row.messageCount ?? 0)}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.createdAt || row.date))}</td>
              <td>
                <button type="button" class="btn btn-sm btn-ghost" data-chat-detail="${escapeHtml(row.id)}">Detay</button>
              </td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Kayıt yok</td></tr>';

    $("chatPrevBtn").disabled = chatsPage <= 1;
    $("chatNextBtn").disabled = chatsPage >= (chatsPagination?.totalPages || 1);
  }

  async function saveUser(event) {
    event.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;
    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      status: $("editStatus").value
    };
    const submitBtn = event.submitter;
    if (submitBtn) submitBtn.disabled = true;
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("editUserMessage").hidden = false;
        $("editUserMessage").textContent = apiErrorMessage(data, "Güncelleme başarısız.");
        return;
      }
      $("editUserDialog").close();
      showToast("Kullanıcı güncellendi");
      loadUsers();
      loadAnalyse();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function refreshAll() {
    const btn = $("refreshBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Yenileniyor...";
    }
    try {
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
      if (currentView === "users") await loadUsers();
      if (currentView === "homeworks") await loadHomeworkImages();
      if (currentView === "chats") await loadChats();
      if (currentView === "analytics") renderAnalyticsView();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Yenile";
      }
    }
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  $("settingsBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    window.location.href = `/apps/${appId}/edit`;
  });
  $("refreshBtn")?.addEventListener("click", () => refreshAll().catch(() => {}));

  $("searchBtn")?.addEventListener("click", () => {
    usersSearch = $("userSearch").value.trim();
    usersPage = 1;
    loadUsers();
  });
  $("userSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("searchBtn")?.click();
  });
  $("userClearFilterBtn")?.addEventListener("click", () => {
    usersSearch = "";
    usersPage = 1;
    $("userSearch").value = "";
    loadUsers();
  });
  $("prevPageBtn")?.addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });
  $("nextPageBtn")?.addEventListener("click", () => {
    if (usersPage < (usersPagination?.totalPages || 1)) {
      usersPage += 1;
      loadUsers();
    }
  });
  $("usersBody")?.addEventListener("click", (e) => {
    const detailBtn = e.target.closest("[data-user-detail]");
    if (detailBtn) {
      openUserDetail(detailBtn.getAttribute("data-user-detail")).catch(() => {});
      return;
    }
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
    if (user) openEditUser(user);
  });

  $("homeworkSearchBtn")?.addEventListener("click", () => {
    homeworkSearch = $("homeworkSearch").value.trim();
    homeworksPage = 1;
    loadHomeworkImages();
  });
  $("homeworkSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("homeworkSearchBtn")?.click();
  });
  $("homeworkPrevBtn")?.addEventListener("click", () => {
    if (homeworksPage > 1) {
      homeworksPage -= 1;
      loadHomeworkImages();
    }
  });
  $("homeworkNextBtn")?.addEventListener("click", () => {
    if (homeworksPage < (homeworksPagination?.totalPages || 1)) {
      homeworksPage += 1;
      loadHomeworkImages();
    }
  });

  $("chatSearchBtn")?.addEventListener("click", () => {
    chatSearch = $("chatSearch").value.trim();
    chatStatus = $("chatStatusFilter").value;
    chatsPage = 1;
    loadChats();
  });
  $("chatSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("chatSearchBtn")?.click();
  });
  $("chatPrevBtn")?.addEventListener("click", () => {
    if (chatsPage > 1) {
      chatsPage -= 1;
      loadChats();
    }
  });
  $("chatNextBtn")?.addEventListener("click", () => {
    if (chatsPage < (chatsPagination?.totalPages || 1)) {
      chatsPage += 1;
      loadChats();
    }
  });
  $("chatsBody")?.addEventListener("click", (e) => {
    const detailBtn = e.target.closest("[data-chat-detail]");
    if (!detailBtn) return;
    openChatDetail(detailBtn.getAttribute("data-chat-detail")).catch(() => {});
  });

  $("closeUserDetailBtn")?.addEventListener("click", () => $("userDetailDialog").close());
  $("closeUserDialogBtn")?.addEventListener("click", () => $("editUserDialog").close());
  $("closeChatDetailBtn")?.addEventListener("click", () => $("chatDetailDialog").close());
  $("editUserForm")?.addEventListener("submit", saveUser);

  (async function init() {
    if (window.PanelAuth) {
      const sessionUser = await window.PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = window.PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    try {
      await loadAppMeta();
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
    } catch {
      setHealthBadge(false, "Yükleme hatası");
    }
  })();

  window.HomeworkSnapPanel = {
    openUserById(userId) {
      switchView("users");
      openUserDetail(String(userId)).catch(() => {});
    }
  };
})();
