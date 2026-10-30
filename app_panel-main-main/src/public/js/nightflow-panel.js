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

  let sessionsPage = 1;
  const sessionsLimit = 20;
  let sessionsPagination = null;
  let sessionSearch = "";

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

  function formatDuration(seconds) {
    if (seconds == null || Number.isNaN(Number(seconds))) return "—";
    const total = Math.max(0, Math.round(Number(seconds)));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return `${h} sa ${m} dk`;
    return `${m} dk`;
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
      unknown: "Bilinmiyor"
    };
    return map[v] || (v || "—");
  }

  function genderLabelTr(value) {
    const v = String(value || "").toLowerCase();
    const map = {
      male: "Erkek",
      female: "Kadın",
      other: "Diğer",
      unknown: "Belirtilmemiş"
    };
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
      "statTotalSleepSessions",
      "statCompletedSessions",
      "statPremiumUsers",
      "statActiveSleepUsersToday",
      "statSessionsCompletedToday"
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
    if (view === "sessions") loadSessions();
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
    const name = app.appName || "NightFlow";
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
      iconFallback.textContent = "NF";
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
      renderInsightCard("Giriş sağlayıcıları", "Google / Apple / Misafir dağılımı", lastAudienceInsights.providers, authLabelTr),
      renderInsightCard("Cinsiyet dağılımı", "Kullanıcı profil dağılımı", lastAudienceInsights.genders, genderLabelTr)
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
        "statTotalSleepSessions",
        "statCompletedSessions",
        "statPremiumUsers",
        "statActiveSleepUsersToday",
        "statSessionsCompletedToday"
      ].forEach((id) => setVal(id, "—"));
      ["statWeeklyLogins", "statWeeklyNewUsers", "statWeeklySessions", "statWeeklyAvgSleep"].forEach((id) =>
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
    setVal("statTotalSleepSessions", formatNumber(summary.totalSleepSessions));
    setVal("statCompletedSessions", formatNumber(summary.completedSessions));
    setVal("statPremiumUsers", formatNumber(summary.premiumUsers));
    setVal("statActiveSleepUsersToday", formatNumber(summary.activeSleepUsersToday));
    setVal("statSessionsCompletedToday", formatNumber(summary.sessionsCompletedToday));

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
    const weeklySessions = last7.reduce((acc, row) => acc + Number(row.sleepSessionsCompleted || 0), 0);
    const avgSleepDays = last7.filter((row) => Number(row.avgSleepMinutes || 0) > 0);
    const weeklyAvgSleep =
      avgSleepDays.length > 0
        ? avgSleepDays.reduce((acc, row) => acc + Number(row.avgSleepMinutes || 0), 0) / avgSleepDays.length
        : 0;
    const maxLogins = Math.max(...last7.map((d) => Number(d.logins || 0)), 1);

    const chart = $("dailyMiniChart");
    if (chart) {
      chart.innerHTML = last7
        .map((row) => {
          const logins = Number(row.logins || 0);
          const sessions = Number(row.sleepSessionsCompleted || 0);
          const h = Math.max(Math.round((logins / maxLogins) * 80), logins > 0 ? 6 : 0);
          return `<div class="mini-day">
            <div class="mini-bar" style="height:${h}px" title="${escapeHtml(row.date || "")}: ${logins} aktivite"></div>
            <div class="mini-meta">${formatNumber(sessions)}</div>
            <div class="mini-label">${escapeHtml(String(row.date || "").slice(5))}</div>
          </div>`;
        })
        .join("");
    }

    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statWeeklySessions", formatNumber(weeklySessions));
    setVal("statWeeklyAvgSleep", weeklyAvgSleep > 0 ? formatNumber(Math.round(weeklyAvgSleep * 10) / 10) : "—");

    const maxDailyLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxDailyNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    const maxDailySessions = Math.max(...daily.map((d) => Number(d.sleepSessionsCompleted || 0)), 1);
    const maxDailyAvgSleep = Math.max(...daily.map((d) => Number(d.avgSleepMinutes || 0)), 1);

    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const sessions = Number(row.sleepSessionsCompleted || 0);
            const avgSleep = Number(row.avgSleepMinutes || 0);
            const loginW = Math.max(Math.round((logins / maxDailyLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxDailyNew) * 100), newUsers > 0 ? 8 : 0);
            const sessionW = Math.max(Math.round((sessions / maxDailySessions) * 100), sessions > 0 ? 8 : 0);
            const sleepW = Math.max(Math.round((avgSleep / maxDailyAvgSleep) * 100), avgSleep > 0 ? 8 : 0);
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
                  <strong>${formatNumber(sessions)}</strong>
                  <div class="daily-meter"><span style="width:${sessionW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${avgSleep > 0 ? formatNumber(avgSleep) : "—"}</strong>
                  <div class="daily-meter daily-meter--new"><span style="width:${sleepW}%"></span></div>
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
      ["Giriş", authLabelTr(ex.provider)],
      ["Premium", ex.isPremium ? "Evet" : "Hayır"],
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
      <article class="card stat-card"><div class="stat-label">Uyku oturumu</div><div class="stat-value">${formatNumber(ex.sessionCount)}</div></article>
      <article class="card stat-card"><div class="stat-label">Premium</div><div class="stat-value">${ex.isPremium ? "Evet" : "Hayır"}</div></article>
      <article class="card stat-card"><div class="stat-label">Cinsiyet</div><div class="stat-value">${escapeHtml(genderLabelTr(ex.gender))}</div></article>
      <article class="card stat-card"><div class="stat-label">Doğum yılı</div><div class="stat-value">${ex.birthYear || "—"}</div></article>`;
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
    $("editPremium").value = user.extras?.isPremium ? "1" : "0";
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
              <td>${escapeHtml(authLabelTr(ex.provider))}</td>
              <td>${ex.isPremium ? "Evet" : "Hayır"}</td>
              <td>${formatNumber(ex.sessionCount)}</td>
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

  async function loadSessions() {
    $("sessionsError").hidden = true;
    $("sessionsBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';

    const params = new URLSearchParams({ page: sessionsPage, limit: sessionsLimit });
    if (sessionSearch) params.set("search", sessionSearch);
    const response = await fetch(`/api/apps/${appId}/proxy/sleep-sessions?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("sessionsBody").innerHTML = "";
      $("sessionsError").hidden = false;
      $("sessionsError").textContent = apiErrorMessage(data, "Uyku oturumları alınamadı.");
      $("sessionsMeta").textContent = "Liste alınamadı";
      $("sessionPrevBtn").disabled = true;
      $("sessionNextBtn").disabled = true;
      return;
    }

    const rows = rowsFromBody(data.bodyJson, "sleepSessions");
    sessionsPagination = data.bodyJson?.pagination || null;
    $("sessionsMeta").textContent = sessionsPagination
      ? `${formatNumber(sessionsPagination.total)} oturum · sayfa ${sessionsPagination.page}/${sessionsPagination.totalPages}`
      : `${rows.length} kayıt`;

    $("sessionsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td class="user-cell-sub">${escapeHtml(row.id || "—")}</td>
              <td>${escapeHtml(row.userLabel || row.userId || "—")}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.startedAt))}</td>
              <td class="user-cell-sub">${escapeHtml(formatDateTime(row.endedAt))}</td>
              <td>${escapeHtml(formatDuration(row.sleepDurationSeconds ?? row.durationSeconds))}</td>
              <td>${row.deepPercent != null ? `${formatNumber(row.deepPercent)}%` : "—"}</td>
              <td>${row.remPercent != null ? `${formatNumber(row.remPercent)}%` : "—"}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Kayıt yok</td></tr>';

    $("sessionPrevBtn").disabled = sessionsPage <= 1;
    $("sessionNextBtn").disabled = sessionsPage >= (sessionsPagination?.totalPages || 1);
  }

  async function saveUser(event) {
    event.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;
    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      extras: { isPremium: $("editPremium").value === "1" }
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
      if (currentView === "sessions") await loadSessions();
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

  $("sessionSearchBtn")?.addEventListener("click", () => {
    sessionSearch = $("sessionSearch").value.trim();
    sessionsPage = 1;
    loadSessions();
  });
  $("sessionSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("sessionSearchBtn")?.click();
  });
  $("sessionPrevBtn")?.addEventListener("click", () => {
    if (sessionsPage > 1) {
      sessionsPage -= 1;
      loadSessions();
    }
  });
  $("sessionNextBtn")?.addEventListener("click", () => {
    if (sessionsPage < (sessionsPagination?.totalPages || 1)) {
      sessionsPage += 1;
      loadSessions();
    }
  });

  $("closeUserDetailBtn")?.addEventListener("click", () => $("userDetailDialog").close());
  $("closeUserDialogBtn")?.addEventListener("click", () => $("editUserDialog").close());
  $("editUserForm")?.addEventListener("submit", saveUser);

  window.NightflowPanel = {
    openUserById(userId) {
      switchView("users");
      openUserDetail(String(userId)).catch(() => {});
    }
  };

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
