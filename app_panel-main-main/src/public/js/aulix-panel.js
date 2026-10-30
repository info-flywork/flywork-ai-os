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

  let tracksPage = 1;
  const tracksLimit = 20;
  let tracksPagination = null;
  let trackSearch = "";

  let artistsPage = 1;
  const artistsLimit = 20;
  let artistsPagination = null;
  let artistSearch = "";

  let subscriptionsPage = 1;
  const subscriptionsLimit = 20;
  let subscriptionsPagination = null;
  let subscriptionSearch = "";

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

  function formatMoney(value, currency) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currency || "USD"
      }).format(Number(value));
    } catch {
      return `${formatNumber(value)} ${currency || ""}`.trim();
    }
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

  function platformLabelTr(value) {
    const v = String(value || "").toLowerCase();
    const map = { ios: "iOS", android: "Android" };
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
      "statTotalTracks",
      "statTotalPlays",
      "statTotalArtists",
      "statTotalSubscriptions",
      "statTracksToday",
      "statArtistsToday",
      "statSubscriptionsToday"
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function usersFromBody(bodyJson) {
    if (!bodyJson) return [];
    const raw = bodyJson.users ?? bodyJson.data ?? bodyJson.items ?? [];
    return Array.isArray(raw) ? raw : [];
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
    if (view === "tracks") loadTracks();
    if (view === "artists") loadArtists();
    if (view === "subscriptions") loadSubscriptions();
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
    const name = app.appName || "Aulix";
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
      iconFallback.textContent = "AX";
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
      renderInsightCard("Platform dağılımı", "Satın alımların mağaza kırılımı", lastAudienceInsights.platforms, platformLabelTr),
      renderInsightCard("Ürün dağılımı", "En çok satılan ürünler", lastAudienceInsights.products, (v) => v)
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
        "statTotalTracks",
        "statTotalPlays",
        "statTotalArtists",
        "statTotalSubscriptions",
        "statTracksToday",
        "statArtistsToday",
        "statSubscriptionsToday"
      ].forEach((id) => setVal(id, "—"));
      ["statWeeklyLogins", "statWeeklyNewUsers", "statWeeklyTracks", "statWeeklySubscriptions"].forEach((id) =>
        setVal(id, "—")
      );
      const chart = $("dailyMiniChart");
      if (chart) chart.innerHTML = "";
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
    setVal("statTotalTracks", formatNumber(summary.totalTracks));
    setVal("statTotalPlays", formatNumber(summary.totalPlays));
    setVal("statTotalArtists", formatNumber(summary.totalArtists));
    setVal("statTotalSubscriptions", formatNumber(summary.totalSubscriptions));
    setVal("statTracksToday", formatNumber(summary.tracksToday));
    setVal("statArtistsToday", formatNumber(summary.artistsToday));
    setVal("statSubscriptionsToday", formatNumber(summary.subscriptionsToday));

    const version = body.contractVersion;
    const tz = body.timezone || "Europe/Istanbul";
    const hint = $("analyseHint");
    if (hint) {
      hint.textContent = version
        ? `Sözleşme v${version} · Metrikler ${tz} saat dilimine göre hesaplanır.`
        : `Metrikler ${tz} saat dilimine göre hesaplanır.`;
    }

    const daily = Array.isArray(body.daily) ? body.daily.slice() : [];
    const last7 = daily.slice(0, 7).reverse();
    const weeklyLogins = last7.reduce((acc, row) => acc + Number(row.logins || 0), 0);
    const weeklyNew = last7.reduce((acc, row) => acc + Number(row.newUsers || 0), 0);
    const weeklyTracks = last7.reduce((acc, row) => acc + Number(row.tracks || 0), 0);
    const weeklySubscriptions = last7.reduce((acc, row) => acc + Number(row.subscriptions || 0), 0);
    const maxLogins = Math.max(...last7.map((d) => Number(d.logins || 0)), 1);

    const chart = $("dailyMiniChart");
    if (chart) {
      chart.innerHTML = last7
        .map((row) => {
          const logins = Number(row.logins || 0);
          const tracks = Number(row.tracks || 0);
          const h = Math.max(Math.round((logins / maxLogins) * 80), logins > 0 ? 6 : 0);
          return `<div class="mini-day">
            <div class="mini-bar" style="height:${h}px" title="${escapeHtml(row.date || "")}: ${logins} aktivite"></div>
            <div class="mini-meta">${formatNumber(tracks)}</div>
            <div class="mini-label">${escapeHtml(String(row.date || "").slice(5))}</div>
          </div>`;
        })
        .join("");
    }

    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statWeeklyTracks", formatNumber(weeklyTracks));
    setVal("statWeeklySubscriptions", formatNumber(weeklySubscriptions));

    const maxDailyLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxDailyNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    const maxDailyTracks = Math.max(...daily.map((d) => Number(d.tracks || 0)), 1);
    const maxDailySubscriptions = Math.max(...daily.map((d) => Number(d.subscriptions || 0)), 1);

    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const tracks = Number(row.tracks || 0);
            const subscriptions = Number(row.subscriptions || 0);
            const loginW = Math.max(Math.round((logins / maxDailyLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxDailyNew) * 100), newUsers > 0 ? 8 : 0);
            const trackW = Math.max(Math.round((tracks / maxDailyTracks) * 100), tracks > 0 ? 8 : 0);
            const subW = Math.max(Math.round((subscriptions / maxDailySubscriptions) * 100), subscriptions > 0 ? 8 : 0);
            return `<tr>
              <td><div class="daily-date-cell">${escapeHtml(row.date || "—")}</div></td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(logins)}</strong>
                  <div class="daily-meter"><span style="width:${loginW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(newUsers)}</strong>
                  <div class="daily-meter daily-meter--new"><span style="width:${newW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(tracks)}</strong>
                  <div class="daily-meter"><span style="width:${trackW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(subscriptions)}</strong>
                  <div class="daily-meter daily-meter--new"><span style="width:${subW}%"></span></div>
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Veri yok</td></tr>';

    lastAudienceInsights = body.audienceInsights || null;
    if (currentView === "analytics") renderAnalyticsView();
  }

  function renderUserDetailProfile(user) {
    const ex = user.extras || {};
    const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
    const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
    const rows = [
      ["Kimlik", user.id],
      ["Kredi", formatNumber(ex.credits)],
      ["Son aktivite", formatDateTime(user.lastLoginAt)],
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
      <article class="card stat-card"><div class="stat-label">Parça</div><div class="stat-value">${formatNumber(ex.trackCount)}</div></article>
      <article class="card stat-card"><div class="stat-label">Sanatçı</div><div class="stat-value">${formatNumber(ex.artistCount)}</div></article>
      <article class="card stat-card"><div class="stat-label">Kredi</div><div class="stat-value">${formatNumber(ex.credits)}</div></article>
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
      const user = data.bodyJson?.data || data.bodyJson;
      if (!user) throw new Error("Kullanıcı bulunamadı.");
      usersCache.set(String(user.id), user);
      $("userDetailTitle").textContent = user.displayName || user.email || `Kullanıcı ${user.id}`;
      $("userDetailProfile").innerHTML = renderUserDetailProfile(user);
      $("userDetailStats").innerHTML = renderUserDetailStats(user);
    } catch (error) {
      $("userDetailError").hidden = false;
      $("userDetailError").textContent = error.message;
    }
  }

  function openEditUser(user) {
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editCredits").value = user.extras?.credits ?? 0;
    $("editUserMeta").textContent = `Kayıt: ${formatDateTime(user.createdAt)} · Son aktivite: ${formatDateTime(user.lastLoginAt)}`;
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
      $("usersError").textContent = apiErrorMessage(data, "Kullanıcılar alınamadı.");
      $("usersMeta").textContent = "Liste alınamadı";
      $("prevPageBtn").disabled = true;
      $("nextPageBtn").disabled = true;
      return;
    }

    const users = usersFromBody(data.bodyJson);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache.clear();
    users.forEach((user) => usersCache.set(String(user.id), user));

    $("usersMeta").textContent = usersPagination
      ? `${formatNumber(usersPagination.total)} kullanıcı · sayfa ${usersPagination.page}/${usersPagination.totalPages}`
      : `${users.length} kayıt`;

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const ex = user.extras || {};
            const label = user.displayName || user.email || user.id;
            const sub = user.displayName && user.email ? user.email : user.id;
            return `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(label)}</div>
                <div class="user-cell-sub">${escapeHtml(sub)}</div>
              </td>
              <td>${formatNumber(ex.credits)}</td>
              <td>${formatNumber(ex.trackCount)}</td>
              <td>${formatNumber(ex.artistCount)}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(user.lastLoginAt))}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(user.createdAt))}</td>
              <td>
                <div class="table-actions">
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

  async function loadTracks() {
    $("tracksError").hidden = true;
    $("tracksBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: tracksPage, limit: tracksLimit });
    if (trackSearch) params.set("search", trackSearch);
    const response = await fetch(`/api/apps/${appId}/proxy/tracks?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("tracksBody").innerHTML = "";
      $("tracksError").hidden = false;
      $("tracksError").textContent = apiErrorMessage(data, "Parçalar alınamadı.");
      $("tracksMeta").textContent = "Liste alınamadı";
      $("trackPrevBtn").disabled = true;
      $("trackNextBtn").disabled = true;
      return;
    }

    const rows = rowsFromBody(data.bodyJson, "tracks");
    tracksPagination = data.bodyJson?.pagination || null;
    $("tracksMeta").textContent = tracksPagination
      ? `${formatNumber(tracksPagination.total)} parça · sayfa ${tracksPagination.page}/${tracksPagination.totalPages}`
      : `${rows.length} kayıt`;

    $("tracksBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const preview = row.audioUrl || row.imageUrl;
            return `<tr>
              <td class="user-cell-sub">${escapeHtml(row.id || "—")}</td>
              <td>${escapeHtml(row.title || "—")}</td>
              <td>${escapeHtml(row.userLabel || row.userId || "—")}</td>
              <td>${escapeHtml(row.style || "—")}</td>
              <td>${formatNumber(row.playCount)}</td>
              <td>${
                preview
                  ? `<a href="${escapeHtml(preview)}" target="_blank" rel="noopener noreferrer">Aç</a>`
                  : "—"
              }</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.createdAt))}</td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Kayıt yok</td></tr>';

    $("trackPrevBtn").disabled = tracksPage <= 1;
    $("trackNextBtn").disabled = tracksPage >= (tracksPagination?.totalPages || 1);
  }

  async function loadArtists() {
    $("artistsError").hidden = true;
    $("artistsBody").innerHTML = '<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: artistsPage, limit: artistsLimit });
    if (artistSearch) params.set("search", artistSearch);
    const response = await fetch(`/api/apps/${appId}/proxy/artists?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("artistsBody").innerHTML = "";
      $("artistsError").hidden = false;
      $("artistsError").textContent = apiErrorMessage(data, "Sanatçılar alınamadı.");
      $("artistsMeta").textContent = "Liste alınamadı";
      $("artistPrevBtn").disabled = true;
      $("artistNextBtn").disabled = true;
      return;
    }

    const rows = rowsFromBody(data.bodyJson, "artists");
    artistsPagination = data.bodyJson?.pagination || null;
    $("artistsMeta").textContent = artistsPagination
      ? `${formatNumber(artistsPagination.total)} sanatçı · sayfa ${artistsPagination.page}/${artistsPagination.totalPages}`
      : `${rows.length} kayıt`;

    $("artistsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td class="user-cell-sub">${escapeHtml(row.id || "—")}</td>
              <td>${escapeHtml(row.name || "—")}</td>
              <td>${escapeHtml(row.userLabel || row.userId || "—")}</td>
              <td>${escapeHtml(row.gender || "—")}</td>
              <td>${
                row.imageUrl
                  ? `<a href="${escapeHtml(row.imageUrl)}" target="_blank" rel="noopener noreferrer">Görsel</a>`
                  : "—"
              }</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.createdAt))}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kayıt yok</td></tr>';

    $("artistPrevBtn").disabled = artistsPage <= 1;
    $("artistNextBtn").disabled = artistsPage >= (artistsPagination?.totalPages || 1);
  }

  async function loadSubscriptions() {
    $("subscriptionsError").hidden = true;
    $("subscriptionsBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: subscriptionsPage, limit: subscriptionsLimit });
    if (subscriptionSearch) params.set("search", subscriptionSearch);
    const response = await fetch(`/api/apps/${appId}/proxy/subscriptions?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("subscriptionsBody").innerHTML = "";
      $("subscriptionsError").hidden = false;
      $("subscriptionsError").textContent = apiErrorMessage(data, "Satın alımlar alınamadı.");
      $("subscriptionsMeta").textContent = "Liste alınamadı";
      $("subscriptionPrevBtn").disabled = true;
      $("subscriptionNextBtn").disabled = true;
      return;
    }

    const rows = rowsFromBody(data.bodyJson, "subscriptions");
    subscriptionsPagination = data.bodyJson?.pagination || null;
    $("subscriptionsMeta").textContent = subscriptionsPagination
      ? `${formatNumber(subscriptionsPagination.total)} kayıt · sayfa ${subscriptionsPagination.page}/${subscriptionsPagination.totalPages}`
      : `${rows.length} kayıt`;

    $("subscriptionsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td class="user-cell-sub">${escapeHtml(row.id || "—")}</td>
              <td>${escapeHtml(row.userLabel || row.userId || "—")}</td>
              <td>${escapeHtml(row.productTitle || row.productId || "—")}</td>
              <td>${escapeHtml(platformLabelTr(row.platform))}</td>
              <td>${escapeHtml(formatMoney(row.price, row.currency))}</td>
              <td>${escapeHtml(row.status || "—")}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.createdAt || row.purchaseDate))}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Kayıt yok</td></tr>';

    $("subscriptionPrevBtn").disabled = subscriptionsPage <= 1;
    $("subscriptionNextBtn").disabled = subscriptionsPage >= (subscriptionsPagination?.totalPages || 1);
  }

  async function saveUser(event) {
    event.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;
    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      extras: { credits: Number($("editCredits").value) || 0 }
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
      if (currentView === "tracks") await loadTracks();
      if (currentView === "artists") await loadArtists();
      if (currentView === "subscriptions") await loadSubscriptions();
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

  $("trackSearchBtn")?.addEventListener("click", () => {
    trackSearch = $("trackSearch").value.trim();
    tracksPage = 1;
    loadTracks();
  });
  $("trackSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("trackSearchBtn")?.click();
  });
  $("trackPrevBtn")?.addEventListener("click", () => {
    if (tracksPage > 1) {
      tracksPage -= 1;
      loadTracks();
    }
  });
  $("trackNextBtn")?.addEventListener("click", () => {
    if (tracksPage < (tracksPagination?.totalPages || 1)) {
      tracksPage += 1;
      loadTracks();
    }
  });

  $("artistSearchBtn")?.addEventListener("click", () => {
    artistSearch = $("artistSearch").value.trim();
    artistsPage = 1;
    loadArtists();
  });
  $("artistSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("artistSearchBtn")?.click();
  });
  $("artistPrevBtn")?.addEventListener("click", () => {
    if (artistsPage > 1) {
      artistsPage -= 1;
      loadArtists();
    }
  });
  $("artistNextBtn")?.addEventListener("click", () => {
    if (artistsPage < (artistsPagination?.totalPages || 1)) {
      artistsPage += 1;
      loadArtists();
    }
  });

  $("subscriptionSearchBtn")?.addEventListener("click", () => {
    subscriptionSearch = $("subscriptionSearch").value.trim();
    subscriptionsPage = 1;
    loadSubscriptions();
  });
  $("subscriptionSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("subscriptionSearchBtn")?.click();
  });
  $("subscriptionPrevBtn")?.addEventListener("click", () => {
    if (subscriptionsPage > 1) {
      subscriptionsPage -= 1;
      loadSubscriptions();
    }
  });
  $("subscriptionNextBtn")?.addEventListener("click", () => {
    if (subscriptionsPage < (subscriptionsPagination?.totalPages || 1)) {
      subscriptionsPage += 1;
      loadSubscriptions();
    }
  });

  $("closeUserDetailBtn")?.addEventListener("click", () => $("userDetailDialog").close());
  $("closeUserDialogBtn")?.addEventListener("click", () => $("editUserDialog").close());
  $("editUserForm")?.addEventListener("submit", saveUser);

  window.AulixPanel = { openUserById: openUserDetail };

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
      await refreshAll();
    } catch {
      setHealthBadge(false, "Yükleme hatası");
    }
  })();
})();
