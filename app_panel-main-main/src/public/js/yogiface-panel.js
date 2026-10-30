(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) {
    document.body.innerHTML =
      '<main class="page-content"><div class="alert alert-error">Geçersiz uygulama.</div></main>';
    return;
  }

  let usersPage = 1;
  const usersLimit = 20;
  let usersPagination = null;
  let usersSearch = "";
  const usersCache = new Map();

  let workoutsPage = 1;
  const workoutsLimit = 20;
  let workoutsPagination = null;
  let workoutSearch = "";
  let workoutStatus = "";
  const workoutsCache = new Map();

  let currentView = "overview";
  let sessionUser = null;
  let lastAudienceInsights = null;
  let lastTopFavoritedWorkouts = null;
  let canManage = false;
  let editingWorkout = null;

  const yf = () => window.YogiFaceWorkoutUi;
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

  function formatMoney(price, currency) {
    if (price == null || Number.isNaN(Number(price))) return "—";
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currency || "TRY"
      }).format(Number(price));
    } catch {
      return `${price} ${currency || ""}`.trim();
    }
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("tr-TR");
    } catch {
      return iso;
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

  function authLabelTr(value) {
    const a = String(value || "").toLowerCase();
    if (!a) return "—";
    if (a === "guest") return "Misafir";
    if (a === "apple") return "Apple";
    if (a === "google") return "Google";
    if (a === "email") return "E-posta";
    return a;
  }

  function userStatusLabelTr(status) {
    const map = { active: "Aktif", inactive: "Pasif", banned: "Yasaklı" };
    return map[status] || status || "—";
  }

  function workoutStatusLabelTr(status) {
    const map = { published: "Yayında", draft: "Taslak", archived: "Arşiv" };
    return map[status] || status || "—";
  }

  function difficultyLabelTr(value) {
    const map = { start: "Başlangıç", easy: "Kolay", medium: "Orta", hard: "Zor" };
    return map[value] || value || "—";
  }

  function usersFromBody(bodyJson) {
    return bodyJson?.users ?? bodyJson?.data ?? [];
  }

  function workoutsFromBody(bodyJson) {
    return bodyJson?.data ?? bodyJson?.workouts ?? [];
  }

  function workoutFromBody(bodyJson) {
    return bodyJson?.data ?? bodyJson?.workout ?? bodyJson ?? null;
  }

  function workoutCategoryLabel(workout) {
    return yf()?.formatCategoryLabel(workout) || "—";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    const detail = body?.msg || body?.message || data?.error;
    if (detail && data?.statusCode) {
      return `${detail} (HTTP ${data.statusCode})`;
    }
    if (detail) return detail;
    if (data?.statusCode) return `${fallback} (HTTP ${data.statusCode})`;
    return fallback;
  }

  function setHealthBadge(ok, text) {
    const el = $("healthBadge");
    el.className = "badge " + (ok ? "ok" : "fail");
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function setVal(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setStatsLoading(loading) {
    for (const id of [
      "statTotal",
      "statLogins",
      "statNew",
      "statTotalFavorites",
      "statPersonalPrograms",
      "statPublished",
      "statTotalWorkouts"
    ]) {
      const el = $(id);
      if (el) el.classList.toggle("loading", loading);
    }
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
    if (view === "workouts") loadWorkouts();
    if (view === "analytics") renderAnalyticsView();
    if (view === "revenuecat" && window.RevenueCatPanel?.load) {
      window.RevenueCatPanel.load(appId);
    }
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
    const name = app.appName || "YogiFace";
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
      iconFallback.textContent = (name.charAt(0) || "B").toUpperCase();
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

  function renderInsightBars(items) {
    if (!items?.length) return '<p class="user-cell-sub">Veri yok</p>';
    const max = Math.max(...items.map((i) => i.count), 1);
    return `<div class="insight-bar-list">${items
      .slice(0, 12)
      .map((item) => {
        const w = Math.max(Math.round((item.count / max) * 100), item.count > 0 ? 6 : 0);
        return `<div class="insight-bar-row">
          <span class="insight-bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
          <div class="insight-bar-track"><div class="insight-bar-fill" style="width:${w}%"></div></div>
          <span class="insight-bar-meta">${formatNumber(item.count)} · %${item.percent}</span>
        </div>`;
      })
      .join("")}</div>`;
  }

  function renderInsightCard(title, subtitle, items) {
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      ${renderInsightBars(items)}
    </article>`;
  }

  function renderTopFavoritedWorkouts(top) {
    const section = $("topWorkoutsSection");
    const body = $("topWorkoutsBody");
    if (!section || !body) return;

    const rows = Array.isArray(top) ? top : [];
    if (!rows.length) {
      section.hidden = true;
      body.innerHTML = "";
      return;
    }

    section.hidden = false;
    body.innerHTML = rows
      .map(
        (w) => `<tr>
          <td>${escapeHtml(w.title || w.workoutId)}</td>
          <td>${formatNumber(w.favorites ?? w.completions)}</td>
        </tr>`
      )
      .join("");
  }

  function renderAnalyticsView() {
    renderTopFavoritedWorkouts(lastTopFavoritedWorkouts);
    renderAudienceInsights(lastAudienceInsights);
  }

  function renderAudienceInsights(insights) {
    const grid = $("analyticsGrid");
    if (!grid) return;
    if (!insights) {
      grid.innerHTML = '<p class="user-cell-sub">Analiz verisi yüklenemedi — Yenile\'ye basın.</p>';
      return;
    }

    const pp = insights.personalProgram || {};
    const prof = insights.profiles || {};
    grid.innerHTML = [
      renderInsightCard("Ana hedefler", "Onboarding hedef dağılımı", insights.objectives),
      renderInsightCard("İyileştirme bölgeleri", "Odaklanılan yüz alanları", insights.improvementAreas),
      renderInsightCard("Cilt endişeleri", "Kullanıcıların bildirdiği cilt sorunları", insights.skinConcerns),
      renderInsightCard("Yüz ifadesi kaygısı", "Kişisel program — ana endişe", pp.primaryConcerns),
      renderInsightCard("Hedeflenen his", "Kişisel program — nasıl hissetmek istiyorlar", pp.desiredFeelings),
      renderInsightCard("Tercih edilen zaman", "Egzersiz için uygun zaman", pp.preferredTimes),
      renderInsightCard("Günlük hedef süresi", "Dakika bazında program hedefi", pp.dailyGoals),
      renderInsightCard("Cinsiyet", "Profil dağılımı", prof.genders),
      renderInsightCard("Cilt tipi", "Profil dağılımı", prof.skinTypes),
      renderInsightCard("Hedef yüz şekli", "Profil dağılımı", prof.faceShapes),
      renderInsightCard("Makyaj sıklığı", "Profil dağılımı", prof.makeupFrequency)
    ].join("");

    const t = insights.totals || {};
    setVal("analyticsFavUsers", formatNumber(t.usersWithFavorites));
    setVal("analyticsObjectiveUsers", formatNumber(t.usersWithObjectives));
    setVal("analyticsProfileUsers", formatNumber(t.usersWithProfiles));
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
        "statTotal",
        "statLogins",
        "statNew",
        "statTotalFavorites",
        "statPersonalPrograms",
        "statPublished",
        "statTotalWorkouts",
        "statWeeklyLogins",
        "statWeeklyNewUsers",
        "statWeeklyFavorites",
        "statOnboardingDone"
      ].forEach((id) => setVal(id, "—"));
      lastAudienceInsights = null;
      lastTopFavoritedWorkouts = null;
      if (currentView === "analytics") renderAnalyticsView();
      const chart = $("dailyMiniChart");
      if (chart) chart.innerHTML = "";
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      $("topWorkoutsSection").hidden = true;
      return;
    }

    const summary = data.bodyJson?.summary || {};
    setVal("statTotal", formatNumber(summary.totalUsers));
    setVal("statLogins", formatNumber(summary.loginsToday));
    setVal("statNew", formatNumber(summary.newUsersToday));
    setVal("statTotalFavorites", formatNumber(summary.totalFavorites));
    setVal("statPersonalPrograms", formatNumber(summary.usersWithPersonalPreferences));
    setVal("statPublished", formatNumber(summary.publishedWorkouts));
    setVal("statTotalWorkouts", formatNumber(summary.totalWorkouts));

    const version = data.bodyJson?.contractVersion;
    const tz = data.bodyJson?.timezone || "Europe/Istanbul";
    $("analyseHint").textContent = version
      ? `Sözleşme v${version} · Metrikler ${tz} saat dilimine göre hesaplanır.`
      : `Metrikler ${tz} saat dilimine göre hesaplanır.`;

    const daily = Array.isArray(data.bodyJson?.daily) ? data.bodyJson.daily.slice().reverse() : [];
    const last7 = daily.slice(0, 7).reverse();
    const weeklyLogins = last7.reduce((acc, row) => acc + Number(row.logins || 0), 0);
    const weeklyNew = last7.reduce((acc, row) => acc + Number(row.newUsers || 0), 0);
    const weeklyFavorites = last7.reduce((acc, row) => acc + Number(row.favoritesAdded || 0), 0);
    const maxLogins = Math.max(...last7.map((d) => Number(d.logins || 0)), 1);

    const chart = $("dailyMiniChart");
    if (chart) {
      chart.innerHTML = last7
        .map((row) => {
          const logins = Number(row.logins || 0);
          const favorites = Number(row.favoritesAdded || 0);
          const h = Math.max(Math.round((logins / maxLogins) * 80), 6);
          return `<div class="mini-day">
            <div class="mini-bar" style="height:${h}px" title="${row.date}: ${logins} giriş"></div>
            <div class="mini-meta">${favorites}</div>
            <div class="mini-label">${String(row.date || "").slice(5)}</div>
          </div>`;
        })
        .join("");
    }

    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statWeeklyFavorites", formatNumber(weeklyFavorites));
    setVal("statOnboardingDone", formatNumber(summary.onboardingCompletedUsers));

    const maxDailyLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxDailyNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    const maxDailyFavorites = Math.max(...daily.map((d) => Number(d.favoritesAdded || 0)), 1);

    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const favorites = Number(row.favoritesAdded || 0);
            const loginW = Math.max(Math.round((logins / maxDailyLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxDailyNew) * 100), newUsers > 0 ? 8 : 0);
            const favW = Math.max(Math.round((favorites / maxDailyFavorites) * 100), favorites > 0 ? 8 : 0);
            return `<tr>
              <td><div class="daily-date-cell">${row.date || "—"}</div></td>
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
                  <strong>${formatNumber(favorites)}</strong>
                  <div class="daily-meter"><span style="width:${favW}%"></span></div>
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="user-cell-sub">Veri yok</td></tr>`;

    lastAudienceInsights = data.bodyJson?.audienceInsights || null;
    lastTopFavoritedWorkouts =
      data.bodyJson?.workoutsSummary?.topWorkoutsByFavorites ||
      data.bodyJson?.workoutsSummary?.topWorkoutsByCompletions ||
      [];
    if (currentView === "analytics") renderAnalyticsView();
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editStatus").value = user.status || "active";
    if ($("editIsPremium")) $("editIsPremium").checked = Boolean(ex.isPremium);

    const meta = [];
    if (ex.authProvider) meta.push(`Giriş: ${authLabelTr(ex.authProvider)}`);
    if (ex.currentStreak != null) meta.push(`Seri: ${ex.currentStreak} gün`);
    if (ex.totalExercises != null) meta.push(`Toplam egzersiz: ${ex.totalExercises}`);
    if (ex.favoritesCount != null) meta.push(`Favori: ${ex.favoritesCount}`);
    if (ex.preferredLanguage) meta.push(`Dil: ${ex.preferredLanguage}`);
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";

    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
  }

  function renderUserDetailProfile(user) {
    const ex = user.extras || {};
    const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
    const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
    const rows = [
      ["Kimlik", user.id],
      ["Giriş", authLabelTr(ex.authProvider)],
      ["Premium", ex.isPremium ? "Evet" : "Hayır"],
      ["Durum", userStatusLabelTr(user.status)],
      ["Favori sayısı", formatNumber(ex.favoritesCount ?? 0)],
      ["Dil", ex.preferredLanguage || "—"],
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

  async function openUserDetail(userId) {
    const cached = usersCache.get(String(userId));
    $("userDetailTitle").textContent = "Kullanıcı detay";
    $("userDetailProfile").innerHTML = `<p class="user-cell-sub">Yükleniyor...</p>`;
    $("userDetailFavorites").innerHTML = `<p class="user-cell-sub">Yükleniyor...</p>`;
    $("userDetailFavoritesMeta").textContent = "—";
    $("userDetailError").hidden = true;
    $("userDetailDialog").showModal();

    try {
      const userPromise = cached
        ? Promise.resolve({ ok: true, bodyJson: { data: cached } })
        : fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`).then((r) => r.json());
      const favPromise = fetch(
        `/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}/favorites`
      ).then((r) => r.json());

      const [userRes, favRes] = await Promise.all([userPromise, favPromise]);

      if (!userRes.ok) {
        throw new Error(apiErrorMessage(userRes, "Kullanıcı bilgisi alınamadı."));
      }
      if (!favRes.ok) {
        throw new Error(apiErrorMessage(favRes, "Favori listesi alınamadı."));
      }

      const user = userRes.bodyJson?.data;
      const favorites = favRes.bodyJson?.data || [];

      if (user) {
        usersCache.set(String(user.id), user);
        const title = user.displayName || user.email || `Kullanıcı #${user.id}`;
        $("userDetailTitle").textContent = title;
        $("userDetailProfile").innerHTML = renderUserDetailProfile(user);
      }

      $("userDetailFavoritesMeta").textContent =
        favorites.length === 0
          ? "Bu kullanıcının favori egzersizi yok."
          : `${formatNumber(favorites.length)} favori egzersiz`;

      $("userDetailFavorites").innerHTML = favorites.length
        ? favorites.map((w) => yf()?.renderFavoriteWorkoutCard(w) || "").join("")
        : `<p class="user-cell-sub">Henüz favori eklenmemiş.</p>`;
    } catch (err) {
      $("userDetailError").hidden = false;
      $("userDetailError").textContent = err.message || "Detay yüklenemedi.";
      $("userDetailProfile").innerHTML = "";
      $("userDetailFavorites").innerHTML = "";
    }
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = `<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>`;

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
            const premium = user.extras?.isPremium;
            return `<tr data-user-id="${user.id}" style="cursor:pointer">
              <td>
                <div class="user-cell-title">${label}</div>
                ${sub ? `<div class="user-cell-sub">${sub}</div>` : `<div class="user-cell-sub">${escapeHtml(user.id)}</div>`}
              </td>
              <td>${authLabelTr(user.extras?.authProvider)}</td>
              <td>${premium ? '<span class="badge ok">Premium</span>' : "—"}</td>
              <td><span class="status-pill ${status}">${userStatusLabelTr(status)}</span></td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td>
                <div style="display:flex; gap:6px; justify-content:flex-end">
                  <button type="button" class="btn btn-sm btn-ghost" data-user-detail="${user.id}">Detay</button>
                  ${
                    canManage
                      ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7"><p class="user-cell-sub">Eşleşen kullanıcı yok</p></td></tr>`;

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function openWorkoutView(workout) {
    if (!workout) return;
    const ex = workout.extras || {};
    $("workoutViewTitle").textContent = workout.title || workout.id;
    const meta = [
      ["Kimlik", workout.id],
      ["Durum", workoutStatusLabelTr(workout.status)],
      ["Süre", workout.durationMinutes != null ? `${workout.durationMinutes} dk` : "—"],
      ["Bölge", workoutCategoryLabel(workout)],
      ["Slug", ex.slug || "—"]
    ];
    const titles = ex.localizedTitles || {};
    const titleRows = Object.entries(titles)
      .map(([lang, t]) => `<tr><td class="user-cell-sub">Başlık (${lang.toUpperCase()})</td><td>${escapeHtml(t)}</td></tr>`)
      .join("");
    $("workoutViewBody").innerHTML = `
      <table class="data-table" style="margin-bottom:16px"><tbody>
        ${meta.map(([k, v]) => `<tr><td class="user-cell-sub" style="width:120px">${k}</td><td>${escapeHtml(v ?? "—")}</td></tr>`).join("")}
        ${titleRows}
      </tbody></table>
      ${yf()?.renderWorkoutMediaPanel(workout) || ""}`;
    $("workoutViewDialog").showModal();
  }

  async function uploadYogifaceMedia(kind, file) {
    const isVideo = kind === "video";
    const path = isVideo ? "media/video" : "media/image";
    const fieldName = isVideo ? "video" : "image";
    const fd = new FormData();
    fd.append(fieldName, file);
    const response = await fetch(`/api/apps/${appId}/proxy/${path}`, { method: "POST", body: fd });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(apiErrorMessage(data, "Medya yüklenemedi."));
    }
    const url = data.bodyJson?.data?.url;
    if (!url) throw new Error("API CDN adresi döndürmedi.");
    return url;
  }

  async function handleMediaUpload(kind) {
    if (!canManage) return;
    const isVideo = kind === "video";
    const fileInput = isVideo ? $("workoutVideoFile") : $("workoutCoverFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      yf()?.setUploadStatus($, isVideo ? "video" : "cover", "Önce dosya seçin.", true);
      return;
    }
    const btn = isVideo ? $("uploadVideoBtn") : $("uploadCoverBtn");
    yf()?.setUploadStatus($, isVideo ? "video" : "cover", "Yükleniyor…");
    if (btn) btn.disabled = true;
    try {
      const url = await uploadYogifaceMedia(isVideo ? "video" : "image", file);
      if (isVideo) $("workoutVideoUrl").value = url;
      else $("workoutCoverUrl").value = url;
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      yf()?.setUploadStatus($, isVideo ? "video" : "cover", `Yüklendi (${mb} MB)`);
      yf()?.updateWorkoutMediaPreview($);
      showToast(isVideo ? "Video yüklendi" : "Kapak görseli yüklendi");
    } catch (err) {
      yf()?.setUploadStatus($, isVideo ? "video" : "cover", err.message || "Hata", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openWorkoutDialog(workout) {
    editingWorkout = workout || null;
    const isEdit = Boolean(workout);
    $("workoutDialogTitle").textContent = isEdit ? "Egzersiz düzenle" : "Yeni egzersiz";
    $("workoutEditId").value = workout?.id || "";
    if (yf()) yf().fillWorkoutForm($, workout);
    document.querySelectorAll("#workoutForm input, #workoutForm textarea, #workoutForm select").forEach((el) => {
      if (el.id === "workoutEditId") return;
      el.disabled = false;
    });
    const submitBtn = $("workoutSubmitBtn") || document.querySelector("#workoutForm button[type=submit]");
    if (submitBtn) submitBtn.hidden = false;
    $("workoutFormMessage").hidden = true;
    $("workoutDialog").showModal();
  }

  async function loadWorkouts() {
    $("workoutsError").hidden = true;
    $("workoutsBody").innerHTML = `<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: workoutsPage, limit: workoutsLimit });
    if (workoutSearch) params.set("search", workoutSearch);
    if (workoutStatus) params.set("status", workoutStatus);

    const response = await fetch(`/api/apps/${appId}/proxy/workouts?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("workoutsBody").innerHTML = "";
      $("workoutsError").hidden = false;
      $("workoutsError").textContent = apiErrorMessage(data, "Katalog alınamadı.");
      $("workoutsMeta").textContent = "Liste alınamadı";
      $("workoutPrevBtn").disabled = true;
      $("workoutNextBtn").disabled = true;
      return;
    }

    const workouts = workoutsFromBody(data.bodyJson);
    workoutsPagination = data.bodyJson?.pagination || null;
    workoutsCache.clear();
    workouts.forEach((w) => workoutsCache.set(String(w.id), w));

    $("workoutsMeta").textContent = workoutsPagination
      ? `${formatNumber(workoutsPagination.total)} egzersiz · sayfa ${workoutsPagination.page}/${workoutsPagination.totalPages}`
      : `${workouts.length} kayıt`;

    $("workoutsBody").innerHTML = workouts.length
      ? workouts
          .map((w) => {
            const actions = canManage
              ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-workout="${w.id}">Düzenle</button>
                 <button type="button" class="btn btn-sm btn-ghost" data-delete-workout="${w.id}">Arşivle</button>`
              : "";
            const thumb = yf()?.workoutListThumb(w) || "";
            return `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${thumb}
                  <div>
                    <div class="user-cell-title">${escapeHtml(w.title || w.id)}</div>
                    <div class="user-cell-sub">${escapeHtml(w.id)}</div>
                  </div>
                </div>
              </td>
              <td><span class="status-pill">${workoutStatusLabelTr(w.status)}</span></td>
              <td>${w.durationMinutes != null ? `${w.durationMinutes} dk` : "—"}</td>
              <td class="user-cell-sub">${escapeHtml(workoutCategoryLabel(w))}</td>
              <td>
                <button type="button" class="btn btn-sm btn-ghost" data-view-workout="${w.id}">Medya</button>
                ${actions}
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6"><p class="user-cell-sub">Kayıt yok</p></td></tr>`;

    $("workoutPrevBtn").disabled = workoutsPage <= 1;
    $("workoutNextBtn").disabled = workoutsPage >= (workoutsPagination?.totalPages || 1);
  }

  async function deleteWorkout(workoutId) {
    if (!canManage) return;
    if (!confirm("Bu egzersiz arşivlensin mi?")) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(workoutId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showToast(apiErrorMessage(data, "Silinemedi"));
      return;
    }
    showToast("Egzersiz arşivlendi");
    loadWorkouts();
  }

  async function refreshAll() {
    const btn = $("refreshBtn");
    btn.disabled = true;
    btn.textContent = "Yenileniyor...";
    try {
      await Promise.all([
        loadHealth(),
        loadAnalyse(),
        window.RevenueCatPanel?.load(appId)
      ]);
      if (currentView === "users") await loadUsers();
      if (currentView === "workouts") await loadWorkouts();
      if (currentView === "analytics") renderAnalyticsView();
    } finally {
      btn.disabled = false;
      btn.textContent = "Yenile";
    }
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  $("settingsBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    window.location.href = `/apps/${appId}/edit`;
  });

  $("refreshBtn").addEventListener("click", () => refreshAll().catch(() => {}));

  $("searchBtn").addEventListener("click", () => {
    usersSearch = $("userSearch").value.trim();
    usersPage = 1;
    loadUsers();
  });

  $("userClearFilterBtn")?.addEventListener("click", () => {
    usersSearch = "";
    $("userSearch").value = "";
    usersPage = 1;
    loadUsers();
  });

  $("userSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("searchBtn").click();
    }
  });

  $("prevPageBtn").addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });

  $("nextPageBtn").addEventListener("click", () => {
    if (usersPage < (usersPagination?.totalPages || 1)) {
      usersPage += 1;
      loadUsers();
    }
  });

  $("usersBody").addEventListener("click", (e) => {
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

  $("closeUserDetailBtn")?.addEventListener("click", () => $("userDetailDialog").close());
  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;

    const extras = { isPremium: Boolean($("editIsPremium")?.checked) };

    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      email: $("editEmail").value.trim() || null,
      status: $("editStatus").value,
      extras
    };

    const submitBtn = e.submitter;
    submitBtn.disabled = true;
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
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("newWorkoutBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    openWorkoutDialog(null);
  });

  $("workoutSearchBtn")?.addEventListener("click", () => {
    workoutSearch = $("workoutSearch").value.trim();
    workoutStatus = $("workoutStatusFilter").value;
    workoutsPage = 1;
    loadWorkouts();
  });

  $("workoutPrevBtn")?.addEventListener("click", () => {
    if (workoutsPage > 1) {
      workoutsPage -= 1;
      loadWorkouts();
    }
  });

  $("workoutNextBtn")?.addEventListener("click", () => {
    if (workoutsPage < (workoutsPagination?.totalPages || 1)) {
      workoutsPage += 1;
      loadWorkouts();
    }
  });

  $("workoutsBody")?.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view-workout]");
    if (viewBtn) {
      const w = workoutsCache.get(viewBtn.getAttribute("data-view-workout"));
      if (w) openWorkoutView(w);
      return;
    }
    const editBtn = e.target.closest("[data-edit-workout]");
    if (editBtn) {
      const w = workoutsCache.get(editBtn.getAttribute("data-edit-workout"));
      if (w) openWorkoutDialog(w);
      return;
    }
    const delBtn = e.target.closest("[data-delete-workout]");
    if (delBtn) deleteWorkout(delBtn.getAttribute("data-delete-workout"));
  });

  $("closeWorkoutViewBtn")?.addEventListener("click", () => $("workoutViewDialog").close());

  $("closeWorkoutDialogBtn")?.addEventListener("click", () => $("workoutDialog").close());

  $("uploadCoverBtn")?.addEventListener("click", () => handleMediaUpload("cover"));
  $("uploadVideoBtn")?.addEventListener("click", () => handleMediaUpload("video"));

  $("workoutForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManage) return;
    $("workoutFormMessage").hidden = true;

    let payload;
    try {
      payload = yf().readWorkoutForm($, { existingExtras: editingWorkout?.extras || {} });
    } catch (err) {
      $("workoutFormMessage").hidden = false;
      $("workoutFormMessage").textContent = err.message || "Geçersiz adım bilgisi.";
      return;
    }
    const validationError = yf().validateWorkoutForm($);
    if (validationError) {
      $("workoutFormMessage").hidden = false;
      $("workoutFormMessage").textContent = validationError;
      return;
    }

    const editId = $("workoutEditId").value.trim();
    const url = editId
      ? `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(editId)}`
      : `/api/apps/${appId}/proxy/workouts`;
    const method = editId ? "PATCH" : "POST";

    const submitBtn = e.submitter;
    submitBtn.disabled = true;
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("workoutFormMessage").hidden = false;
        $("workoutFormMessage").textContent = apiErrorMessage(data, "Kayıt başarısız.");
        return;
      }
      $("workoutDialog").close();
      showToast(editId ? "Egzersiz güncellendi" : "Egzersiz oluşturuldu");
      loadWorkouts();
    } finally {
      submitBtn.disabled = false;
    }
  });

  (async () => {
    if (window.PanelAuth) {
      sessionUser = await PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    yf()?.bindWorkoutFormLivePreview($);

    loadAppMeta()
      .then(async () => {
        await yf()?.loadCategoryMetadata(appId);
        await Promise.all([
          loadHealth(),
          loadAnalyse(),
          window.RevenueCatPanel?.load(appId)
        ]);
      })
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();

  window.YogifacePanel = {
    openUserById(userId) {
      switchView("users");
      openUserDetail(String(userId)).catch(() => {});
    }
  };
})();
