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

  let sessionsPage = 1;
  const sessionsLimit = 20;
  let sessionsPagination = null;
  let sessionUserId = "";
  let sessionStatus = "";
  const sessionsCache = new Map();

  let currentView = "overview";
  let sessionUser = null;
  let canManage = false;
  let editingWorkout = null;

  const bp = () => window.BreathPathWorkoutUi;
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

  function sessionStatusLabelTr(status) {
    const map = { completed: "Tamamlandı", started: "Başladı" };
    return map[status] || status || "—";
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

  function sessionsFromBody(bodyJson) {
    return bodyJson?.data ?? bodyJson?.userWorkouts ?? [];
  }

  function workoutCategoryLabel(workout) {
    return bp()?.formatCategoryLabel(workout) || "—";
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
      "statWorkoutsToday",
      "statActiveUsers",
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
    if (view === "sessions") loadSessions();
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
    const name = app.appName || "BreathPath";
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
        "statWorkoutsToday",
        "statActiveUsers",
        "statPublished",
        "statTotalWorkouts",
        "statWeeklyLogins",
        "statWeeklyNewUsers",
        "statWeeklyCompletions",
        "statDailyAvgCompletions"
      ].forEach((id) => setVal(id, "—"));
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
    setVal("statWorkoutsToday", formatNumber(summary.workoutsCompletedToday));
    setVal("statActiveUsers", formatNumber(summary.activeWorkoutUsersToday));
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
    const weeklyCompletions = last7.reduce((acc, row) => acc + Number(row.workoutsCompleted || 0), 0);
    const days = Math.max(last7.length, 1);
    const maxLogins = Math.max(...last7.map((d) => Number(d.logins || 0)), 1);

    const chart = $("dailyMiniChart");
    if (chart) {
      chart.innerHTML = last7
        .map((row) => {
          const logins = Number(row.logins || 0);
          const completions = Number(row.workoutsCompleted || 0);
          const h = Math.max(Math.round((logins / maxLogins) * 80), 6);
          return `<div class="mini-day">
            <div class="mini-bar" style="height:${h}px" title="${row.date}: ${logins} giriş"></div>
            <div class="mini-meta">${completions}</div>
            <div class="mini-label">${String(row.date || "").slice(5)}</div>
          </div>`;
        })
        .join("");
    }

    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statWeeklyCompletions", formatNumber(weeklyCompletions));
    setVal("statDailyAvgCompletions", formatNumber(Math.round((weeklyCompletions / days) * 10) / 10));

    const maxDailyLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxDailyNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    const maxDailyCompletions = Math.max(...daily.map((d) => Number(d.workoutsCompleted || 0)), 1);
    const maxDailyMinutes = Math.max(...daily.map((d) => Number(d.workoutMinutes || 0)), 1);

    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const completions = Number(row.workoutsCompleted || 0);
            const minutes = Number(row.workoutMinutes || 0);
            const loginW = Math.max(Math.round((logins / maxDailyLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxDailyNew) * 100), newUsers > 0 ? 8 : 0);
            const compW = Math.max(Math.round((completions / maxDailyCompletions) * 100), completions > 0 ? 8 : 0);
            const minW = Math.max(Math.round((minutes / maxDailyMinutes) * 100), minutes > 0 ? 8 : 0);
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
                  <strong>${formatNumber(completions)}</strong>
                  <div class="daily-meter"><span style="width:${compW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(minutes)}</strong>
                  <div class="daily-meter daily-meter--new"><span style="width:${minW}%"></span></div>
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="user-cell-sub">Veri yok</td></tr>`;

    const top = data.bodyJson?.workoutsSummary?.topWorkoutsByCompletions || [];
    if (top.length) {
      $("topWorkoutsSection").hidden = false;
      $("topWorkoutsBody").innerHTML = top
        .map(
          (w) => `<tr>
            <td>${escapeHtml(w.title || w.workoutId)}</td>
            <td>${formatNumber(w.completions)}</td>
          </tr>`
        )
        .join("");
    } else {
      $("topWorkoutsSection").hidden = true;
    }
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
    if (ex.completedExercisesCount != null) meta.push(`Tamamlanan: ${ex.completedExercisesCount}`);
    if (ex.totalExerciseTimeSeconds != null) {
      meta.push(`Toplam süre: ${Math.round(ex.totalExerciseTimeSeconds / 60)} dk`);
    }
    if (ex.favoritesExercises?.length) meta.push(`Favori egzersiz: ${ex.favoritesExercises.length}`);
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";

    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
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
                ${
                  canManage
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button>`
                    : ""
                }
                <button type="button" class="btn btn-sm btn-ghost" data-user-sessions="${user.id}">Tamamlamalar</button>
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
      ["Kategori", workoutCategoryLabel(workout)],
      ["Seviye", difficultyLabelTr(workout.difficulty)],
      ["Premium", ex.isPremium ? "Evet" : "Hayır"],
      ["Adımlar", bp()?.formatStepsSummary(ex.steps) || "—"]
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
      ${bp()?.renderWorkoutMediaPanel(workout) || ""}`;
    $("workoutViewDialog").showModal();
  }

  async function uploadBreathpathMedia(kind, file) {
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
      bp()?.setUploadStatus($, isVideo ? "video" : "cover", "Önce dosya seçin.", true);
      return;
    }
    const btn = isVideo ? $("uploadVideoBtn") : $("uploadCoverBtn");
    bp()?.setUploadStatus($, isVideo ? "video" : "cover", "Yükleniyor…");
    if (btn) btn.disabled = true;
    try {
      const url = await uploadBreathpathMedia(isVideo ? "video" : "image", file);
      if (isVideo) $("workoutVideoUrl").value = url;
      else $("workoutCoverUrl").value = url;
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      bp()?.setUploadStatus($, isVideo ? "video" : "cover", `Yüklendi (${mb} MB)`);
      bp()?.updateWorkoutMediaPreview($);
      showToast(isVideo ? "Video yüklendi" : "Kapak görseli yüklendi");
    } catch (err) {
      bp()?.setUploadStatus($, isVideo ? "video" : "cover", err.message || "Hata", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openWorkoutDialog(workout) {
    editingWorkout = workout || null;
    const isEdit = Boolean(workout);
    $("workoutDialogTitle").textContent = isEdit ? "Egzersiz düzenle" : "Yeni egzersiz";
    $("workoutEditId").value = workout?.id || "";
    if (bp()) bp().fillWorkoutForm($, workout);
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
            const thumb = bp()?.workoutListThumb(w) || "";
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
              <td>${difficultyLabelTr(w.difficulty)}</td>
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

  function openSessionDetail(session) {
    const rows = [
      ["Kimlik", session.id],
      ["Kullanıcı", session.userId],
      ["Egzersiz", session.workoutTitle || session.workoutId],
      ["Durum", sessionStatusLabelTr(session.status)],
      ["Başlangıç", formatDate(session.startedAt)],
      ["Bitiş", formatDate(session.completedAt)],
      ["Süre (dk)", session.durationMinutes],
      ["İlerleme", session.progressPercent != null ? `%${session.progressPercent}` : "—"]
    ];
    $("sessionDetailBody").innerHTML = `
      <table class="data-table"><tbody>
        ${rows.map(([k, v]) => `<tr><td class="user-cell-sub" style="width:140px">${k}</td><td>${escapeHtml(v ?? "—")}</td></tr>`).join("")}
      </tbody></table>`;
    $("sessionDetailDialog").showModal();
  }

  async function loadSessions() {
    $("sessionsError").hidden = true;
    $("sessionsBody").innerHTML = `<tr><td colspan="5" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: sessionsPage, limit: sessionsLimit });
    if (sessionUserId) params.set("userId", sessionUserId);
    if (sessionStatus) params.set("status", sessionStatus);

    const response = await fetch(`/api/apps/${appId}/proxy/user-workouts?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("sessionsBody").innerHTML = "";
      $("sessionsError").hidden = false;
      $("sessionsError").textContent = apiErrorMessage(data, "Tamamlama listesi alınamadı.");
      $("sessionsMeta").textContent = "Liste alınamadı";
      $("sessionPrevBtn").disabled = true;
      $("sessionNextBtn").disabled = true;
      return;
    }

    const sessions = sessionsFromBody(data.bodyJson);
    sessionsPagination = data.bodyJson?.pagination || null;
    sessionsCache.clear();
    sessions.forEach((s) => sessionsCache.set(String(s.id), s));

    $("sessionsMeta").textContent = sessionsPagination
      ? `${formatNumber(sessionsPagination.total)} tamamlama · sayfa ${sessionsPagination.page}/${sessionsPagination.totalPages}`
      : `${sessions.length} kayıt`;

    $("sessionsBody").innerHTML = sessions.length
      ? sessions
          .map((s) => {
            return `<tr data-session-id="${s.id}" style="cursor:pointer">
              <td class="user-cell-sub">${escapeHtml(s.userId)}</td>
              <td>${escapeHtml(s.workoutTitle || s.workoutId)}</td>
              <td><span class="status-pill">${sessionStatusLabelTr(s.status)}</span></td>
              <td class="user-cell-sub">${formatDateTime(s.completedAt || s.startedAt)}</td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-view-session="${s.id}">Detay</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5"><p class="user-cell-sub">Kayıt yok</p></td></tr>`;

    $("sessionPrevBtn").disabled = sessionsPage <= 1;
    $("sessionNextBtn").disabled = sessionsPage >= (sessionsPagination?.totalPages || 1);
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
      if (currentView === "sessions") await loadSessions();
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
    const sessionsBtn = e.target.closest("[data-user-sessions]");
    if (sessionsBtn) {
      sessionUserId = sessionsBtn.getAttribute("data-user-sessions");
      $("sessionUserFilter").value = sessionUserId;
      switchView("sessions");
      sessionsPage = 1;
      loadSessions();
      return;
    }
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
    if (user) openEditUser(user);
  });

  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("userSessionsBtn")?.addEventListener("click", () => {
    const userId = $("editUserId").value;
    $("editUserDialog").close();
    sessionUserId = userId;
    $("sessionUserFilter").value = userId;
    switchView("sessions");
    sessionsPage = 1;
    loadSessions();
  });

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
      payload = bp().readWorkoutForm($, { existingExtras: editingWorkout?.extras || {} });
    } catch (err) {
      $("workoutFormMessage").hidden = false;
      $("workoutFormMessage").textContent = err.message || "Geçersiz adım bilgisi.";
      return;
    }
    const validationError = bp().validateWorkoutForm($);
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

  $("sessionSearchBtn")?.addEventListener("click", () => {
    sessionUserId = $("sessionUserFilter").value.trim();
    sessionStatus = $("sessionStatusFilter").value;
    sessionsPage = 1;
    loadSessions();
  });

  $("sessionClearBtn")?.addEventListener("click", () => {
    sessionUserId = "";
    sessionStatus = "";
    $("sessionUserFilter").value = "";
    $("sessionStatusFilter").value = "";
    sessionsPage = 1;
    loadSessions();
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

  $("sessionsBody")?.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view-session]");
    const id = viewBtn?.getAttribute("data-view-session") || e.target.closest("tr[data-session-id]")?.getAttribute("data-session-id");
    if (!id) return;
    const session = sessionsCache.get(String(id));
    if (session) openSessionDetail(session);
  });

  $("closeSessionDialogBtn")?.addEventListener("click", () => $("sessionDetailDialog").close());

  (async () => {
    if (window.PanelAuth) {
      sessionUser = await PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    bp()?.bindWorkoutFormLivePreview($);

    loadAppMeta()
      .then(async () => {
        await bp()?.loadCategoryMetadata(appId);
        await Promise.all([
          loadHealth(),
          loadAnalyse(),
          window.RevenueCatPanel?.load(appId)
        ]);
      })
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();
})();
