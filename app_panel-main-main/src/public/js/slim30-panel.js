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
  let canManage = false;
  let editingWorkout = null;

  const fw = () => window.FitnessWorkoutUi;
  const toast = document.getElementById("toast");

  function $(id) {
    return document.getElementById(id);
  }

  function formatNumber(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat("tr-TR").format(Number(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function userStatusLabelTr(status) {
    const map = { active: "Aktif", inactive: "Pasif" };
    return map[status] || status || "—";
  }

  function workoutStatusLabelTr(status) {
    const map = { published: "Yayında", draft: "Taslak", archived: "Arşiv" };
    return map[status] || status || "—";
  }

  function difficultyLabelTr(value) {
    return fw()?.difficultyLabelTr(value) || value || "—";
  }

  function categoryLabelTr(value) {
    return fw()?.categoryLabelTr(value) || value || "—";
  }

  function setVal(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
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

  function isCustomWorkout(id) {
    return String(id || "").startsWith("custom-");
  }

  function workoutSourceLabel(workout) {
    const src = workout?.extras?.source;
    if (src === "builtin" || String(workout?.id || "").startsWith("program-")) return "Program";
    return "Özel";
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
    const name = app.appName || "Slim30";
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
      iconFallback.textContent = (name.charAt(0) || "S").toUpperCase();
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
    $("editLang").value = ex.language || ex.preferredLanguage || "";
    $("editStatus").value = user.status === "inactive" ? "inactive" : "active";

    const meta = [];
    if (ex.firebaseUid) meta.push(`Firebase: ${ex.firebaseUid}`);
    if (ex.isPremium != null) meta.push(ex.isPremium ? "Premium" : "Ücretsiz");
    if (ex.premiumExpiresAt) meta.push(`Premium bitiş: ${formatDate(ex.premiumExpiresAt)}`);
    if (ex.trialUsed) meta.push("Deneme kullanıldı");
    if (ex.activeSubscription?.plan_type) meta.push(`Plan: ${ex.activeSubscription.plan_type}`);
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
            const ex = user.extras || {};
            const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
            const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
            const status = user.status || "inactive";
            const lang = ex.language || ex.preferredLanguage || "—";
            const premium = ex.isPremium;
            return `<tr data-user-id="${user.id}" style="cursor:pointer">
              <td>
                <div class="user-cell-title">${label}</div>
                ${sub ? `<div class="user-cell-sub">${sub}</div>` : `<div class="user-cell-sub">${escapeHtml(user.id)}</div>`}
              </td>
              <td class="user-cell-sub">${escapeHtml(lang)}</td>
              <td>${premium ? '<span class="badge ok">Premium</span>' : "—"}</td>
              <td><span class="status-pill ${status}">${userStatusLabelTr(status)}</span></td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td>
                ${
                  canManage
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button>`
                    : "—"
                }
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
    $("workoutViewTitle").textContent = workout.title || workout.id;
    const ex = workout.extras || {};
    const meta = [
      ["Kimlik", workout.id],
      ["Durum", workoutStatusLabelTr(workout.status)],
      ["Süre", workout.durationMinutes != null ? `${workout.durationMinutes} dk` : "—"],
      ["Kategori", categoryLabelTr(workout.category)],
      ["Zorluk", difficultyLabelTr(workout.difficulty)],
      ["Egzersizler", fw()?.formatExercisesSummary(ex.exercises) || "—"]
    ];
    $("workoutViewBody").innerHTML = `
      <table class="data-table" style="margin-bottom:16px"><tbody>
        ${meta.map(([k, v]) => `<tr><td class="user-cell-sub" style="width:120px">${k}</td><td>${escapeHtml(v ?? "—")}</td></tr>`).join("")}
      </tbody></table>
      ${fw()?.renderWorkoutMediaPanel(workout) || ""}`;
    $("workoutViewDialog").showModal();
  }

  function openWorkoutDialog(workout) {
    editingWorkout = workout || null;
    const isEdit = Boolean(workout);
    const readonly = isEdit && !isCustomWorkout(workout.id);
    $("workoutDialogTitle").textContent = readonly
      ? "Antrenman (salt okunur medya)"
      : isEdit
        ? "Antrenman düzenle"
        : "Yeni özel antrenman";
    $("workoutEditId").value = workout?.id || "";
    if (fw()) {
      fw().fillWorkoutForm($, workout, { includeSixpackFields: false });
    }
    document.querySelectorAll("#workoutForm input, #workoutForm textarea, #workoutForm select").forEach((el) => {
      if (el.id === "workoutEditId") return;
      el.disabled = readonly;
    });
    const submitBtn = $("workoutSubmitBtn") || document.querySelector("#workoutForm button[type=submit]");
    if (submitBtn) submitBtn.hidden = readonly;
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
      ? `${formatNumber(workoutsPagination.total)} antrenman · ${workoutsPagination.page}/${workoutsPagination.totalPages}`
      : `${workouts.length} kayıt`;

    $("workoutsBody").innerHTML = workouts.length
      ? workouts
          .map((w) => {
            const custom = isCustomWorkout(w.id);
            const actions = custom && canManage
              ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-workout="${w.id}">Düzenle</button>
                 <button type="button" class="btn btn-sm btn-ghost" data-delete-workout="${w.id}">Sil</button>`
              : `<span class="user-cell-sub">Salt okunur</span>`;
            const thumb = fw()?.workoutListThumb(w) || "";
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
              <td><span class="status-pill ${w.status || ""}">${workoutStatusLabelTr(w.status)}</span></td>
              <td class="user-cell-sub">${difficultyLabelTr(w.difficulty)}</td>
              <td>${w.durationMinutes != null ? `${w.durationMinutes} dk` : "—"}</td>
              <td class="user-cell-sub">${workoutSourceLabel(w)}</td>
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
    if (!canManage || !isCustomWorkout(workoutId)) return;
    if (!confirm("Bu özel antrenman arşivlensin mi?")) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(workoutId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showToast(apiErrorMessage(data, "Silinemedi"));
      return;
    }
    showToast("Antrenman arşivlendi");
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
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
    if (user) openEditUser(user);
  });

  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;

    const extras = {};
    const language = $("editLang").value.trim();
    if (language) extras.language = language;

    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      email: $("editEmail").value.trim() || null,
      status: $("editStatus").value,
      ...(Object.keys(extras).length ? { extras } : {})
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

  $("workoutForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManage) return;
    $("workoutFormMessage").hidden = true;

    let formData;
    try {
      formData = fw().buildWorkoutFormData($, {
        includeSixpackFields: false,
        existingExtras: editingWorkout?.extras || {}
      });
    } catch (err) {
      $("workoutFormMessage").hidden = false;
      $("workoutFormMessage").textContent = err.message || "Geçersiz egzersiz JSON.";
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
        body: formData
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("workoutFormMessage").hidden = false;
        $("workoutFormMessage").textContent = apiErrorMessage(data, "Kayıt başarısız.");
        return;
      }
      $("workoutDialog").close();
      showToast(editId ? "Antrenman güncellendi" : "Antrenman oluşturuldu");
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

    fw()?.bindWorkoutFormLivePreview($, () => editingWorkout);

    loadAppMeta()
      .then(() =>
        Promise.all([
          loadHealth(),
          loadAnalyse(),
          window.RevenueCatPanel?.load(appId)
        ])
      )
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();
})();
