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

  let workoutsPage = 1;
  let workoutsPagination = null;
  let workoutsCache = new Map();

  let templatesPage = 1;
  let templatesPagination = null;
  let templatesCache = new Map();

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
    const el = $(id);
    if (el) el.textContent = value;
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

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `view-${view}`);
    });
    if (view === "users") loadUsers();
    if (view === "workouts") loadWorkouts();
    if (view === "templates") loadTemplates();
    if (view === "analytics") renderAnalytics();
    if (view === "revenuecat") window.RevenueCatPanel?.load?.(appId);
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
    const name = app.appName || "HomiFit";
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
      "statTotalExercises",
      "statTotalTemplates",
      "statNewUsersToday",
      "statSessionsToday",
      "statTotalSessions",
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function renderDaily(rows) {
    $("dailyBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(String(row.date || "").slice(0, 10) || "—")}</td>
              <td><strong>${formatNumber(row.newUsers)}</strong></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="2" class="user-cell-sub">Henüz hareket yok</td></tr>';
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
      renderInsightCard("Premium dağılımı", "Ücretsiz / premium kullanıcılar", insights.premiumSplit),
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
    setText("statTotalExercises", formatNumber(summary.totalExercises));
    setText("statTotalTemplates", formatNumber(summary.totalTemplates));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statSessionsToday", formatNumber(summary.sessionsToday));
    setText("statTotalSessions", formatNumber(summary.totalSessions));
    setText("analyseHint", `TZ: ${analyseData.timezone || "Europe/Istanbul"}`);
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    const search = $("userSearch").value.trim();
    const premium = $("userPremiumFilter").value;
    if (search) params.set("search", search);
    if (premium) params.set("premium", premium);

    const response = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("usersError").hidden = false;
      $("usersError").textContent = apiMessage(data, "Kullanıcılar alınamadı.");
      $("usersBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "usersMeta",
      usersPagination
        ? `Sayfa ${usersPagination.page}/${usersPagination.totalPages} · ${formatNumber(usersPagination.total)} kullanıcı`
        : `${formatNumber(rows.length)} kullanıcı`
    );

    $("usersBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const extras = row.extras || {};
            return `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.displayName || `#${row.id}`)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(row.email || extras.firebaseUid || "—")}</div>
              </td>
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${formatNumber(extras.planCount)}</td>
              <td>${formatNumber(extras.sessionCount)}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-user-id="${escapeHtml(row.id)}">Düzenle</button></td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kullanıcı yok</td></tr>';

    $("usersBody").querySelectorAll("[data-user-id]").forEach((btn) => {
      btn.addEventListener("click", () => openUserDialog(btn.getAttribute("data-user-id")));
    });
    $("usersPrevBtn").disabled = !usersPagination || usersPagination.page <= 1;
    $("usersNextBtn").disabled =
      !usersPagination || usersPagination.page >= usersPagination.totalPages;
  }

  function openUserDialog(userId) {
    const user = usersCache.get(String(userId));
    if (!user) return;
    $("userEditId").value = user.id;
    $("userDisplayName").value = user.displayName || "";
    $("userIsPremium").checked = Boolean(user.extras?.isPremium);
    $("userIsActive").checked = user.status !== "inactive";
    $("userFormError").hidden = true;
    $("userDialog").showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    if (!canManage) return;
    const userId = $("userEditId").value;
    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: $("userDisplayName").value.trim(),
        isPremium: $("userIsPremium").checked,
        isActive: $("userIsActive").checked,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      $("userFormError").hidden = false;
      $("userFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("userDialog").close();
    showToast("Kullanıcı güncellendi.");
    loadUsers();
    loadAnalyse();
  }

  async function loadWorkouts() {
    $("workoutsError").hidden = true;
    const params = new URLSearchParams({
      page: String(workoutsPage),
      limit: String(pageSize),
    });
    const search = $("workoutSearch").value.trim();
    if (search) params.set("search", search);

    const response = await fetch(`/api/apps/${appId}/proxy/workouts?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("workoutsError").hidden = false;
      $("workoutsError").textContent = apiMessage(data, "Egzersizler alınamadı.");
      $("workoutsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    workoutsPagination = data.bodyJson?.pagination || null;
    workoutsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "workoutsMeta",
      workoutsPagination
        ? `Sayfa ${workoutsPagination.page}/${workoutsPagination.totalPages} · ${formatNumber(workoutsPagination.total)} egzersiz`
        : `${formatNumber(rows.length)} egzersiz`
    );

    $("workoutsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.nameTr || row.nameEn || row.name || `#${row.id}`)}</div>
                <div class="user-cell-sub">${escapeHtml(row.slug || "")}</div>
              </td>
              <td>${escapeHtml(row.primaryMuscle || "—")}</td>
              <td>${escapeHtml(row.difficulty || "—")}</td>
              <td>${row.active ? "Aktif" : "Pasif"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-workout-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-workout-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Egzersiz yok</td></tr>';

    $("workoutsBody").querySelectorAll("[data-workout-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openWorkoutDialog(btn.getAttribute("data-workout-edit")));
    });
    $("workoutsBody").querySelectorAll("[data-workout-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Egzersiz silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(btn.getAttribute("data-workout-del"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) {
          showToast(apiMessage(deleteData, "Silinemedi."));
          return;
        }
        showToast(deleteData.bodyJson?.message || "Egzersiz silindi.");
        loadWorkouts();
        loadAnalyse();
      });
    });

    $("workoutsPrevBtn").disabled = !workoutsPagination || workoutsPagination.page <= 1;
    $("workoutsNextBtn").disabled =
      !workoutsPagination || workoutsPagination.page >= workoutsPagination.totalPages;
  }

  function openWorkoutDialog(id) {
    const row = id ? workoutsCache.get(String(id)) : null;
    $("workoutDialogTitle").textContent = row ? "Egzersiz düzenle" : "Yeni egzersiz";
    $("workoutEditId").value = row?.id || "";
    $("workoutNameEn").value = row?.nameEn || row?.name || "";
    $("workoutNameTr").value = row?.nameTr || "";
    $("workoutSlug").value = row?.slug || "";
    $("workoutMuscle").value = row?.primaryMuscle || "";
    $("workoutDifficulty").value = row?.difficulty || "beginner";
    $("workoutVideoUrl").value = row?.videoUrl || "";
    $("workoutThumb").value = row?.thumbnailPath || "";
    $("workoutActive").checked = row ? Boolean(row.active) : true;
    $("workoutFormError").hidden = true;
    $("workoutDialog").showModal();
  }

  async function saveWorkout(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("workoutEditId").value;
    const payload = {
      nameEn: $("workoutNameEn").value.trim(),
      nameTr: $("workoutNameTr").value.trim(),
      slug: $("workoutSlug").value.trim() || undefined,
      primaryMuscle: $("workoutMuscle").value.trim(),
      difficulty: $("workoutDifficulty").value,
      videoUrl: $("workoutVideoUrl").value.trim(),
      thumbnailPath: $("workoutThumb").value.trim(),
      active: $("workoutActive").checked,
    };
    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/workouts`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("workoutFormError").hidden = false;
      $("workoutFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("workoutDialog").close();
    showToast(id ? "Egzersiz güncellendi." : "Egzersiz eklendi.");
    loadWorkouts();
    loadAnalyse();
  }

  async function loadTemplates() {
    $("templatesError").hidden = true;
    const params = new URLSearchParams({
      page: String(templatesPage),
      limit: String(pageSize),
    });
    const search = $("templateSearch").value.trim();
    if (search) params.set("search", search);

    const response = await fetch(`/api/apps/${appId}/proxy/templates?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("templatesError").hidden = false;
      $("templatesError").textContent = apiMessage(data, "Şablonlar alınamadı.");
      $("templatesBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    templatesPagination = data.bodyJson?.pagination || null;
    templatesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "templatesMeta",
      templatesPagination
        ? `Sayfa ${templatesPagination.page}/${templatesPagination.totalPages} · ${formatNumber(templatesPagination.total)} şablon`
        : `${formatNumber(rows.length)} şablon`
    );

    $("templatesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.titleTr || row.titleEn || row.title || `#${row.id}`)}</div>
                <div class="user-cell-sub">${escapeHtml(row.slug || "")}</div>
              </td>
              <td>${escapeHtml(row.category || "—")}</td>
              <td>${formatNumber(row.durationMin)} dk</td>
              <td>${formatNumber(row.exerciseCount)}</td>
              <td>${row.isPremium ? "Evet" : "Hayır"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-template-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-template-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Şablon yok</td></tr>';

    $("templatesBody").querySelectorAll("[data-template-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openTemplateDialog(btn.getAttribute("data-template-edit")));
    });
    $("templatesBody").querySelectorAll("[data-template-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Şablon silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/templates/${encodeURIComponent(btn.getAttribute("data-template-del"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) {
          showToast(apiMessage(deleteData, "Silinemedi."));
          return;
        }
        showToast("Şablon silindi.");
        loadTemplates();
        loadAnalyse();
      });
    });

    $("templatesPrevBtn").disabled = !templatesPagination || templatesPagination.page <= 1;
    $("templatesNextBtn").disabled =
      !templatesPagination || templatesPagination.page >= templatesPagination.totalPages;
  }

  async function openTemplateDialog(id) {
    let row = id ? templatesCache.get(String(id)) : null;
    let exerciseIds = "";
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/templates/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) {
        row = detailData.bodyJson?.data || row;
        const exercises = row?.exercises || [];
        exerciseIds = exercises.map((item) => item.exerciseId).filter(Boolean).join(", ");
      }
    }
    $("templateDialogTitle").textContent = row ? "Şablon düzenle" : "Yeni şablon";
    $("templateEditId").value = row?.id || "";
    $("templateTitleEn").value = row?.titleEn || row?.title || "";
    $("templateTitleTr").value = row?.titleTr || "";
    $("templateSlug").value = row?.slug || "";
    $("templateCategory").value = row?.category || "";
    $("templateDuration").value = row?.durationMin || 20;
    $("templateLevel").value = row?.level || "all";
    $("templateExerciseIds").value = exerciseIds;
    $("templatePremium").checked = Boolean(row?.isPremium);
    $("templateActive").checked = row ? Boolean(row.active) : true;
    $("templateFormError").hidden = true;
    $("templateDialog").showModal();
  }

  async function saveTemplate(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("templateEditId").value;
    const exerciseIds = $("templateExerciseIds")
      .value.split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
      .map((exerciseId, index) => ({ exerciseId, position: index + 1 }));

    const payload = {
      titleEn: $("templateTitleEn").value.trim(),
      titleTr: $("templateTitleTr").value.trim(),
      slug: $("templateSlug").value.trim() || undefined,
      category: $("templateCategory").value.trim(),
      durationMin: Number($("templateDuration").value) || 20,
      level: $("templateLevel").value,
      isPremium: $("templatePremium").checked,
      active: $("templateActive").checked,
      exercises: exerciseIds,
    };

    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/templates/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/templates`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("templateFormError").hidden = false;
      $("templateFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("templateDialog").close();
    showToast(id ? "Şablon güncellendi." : "Şablon eklendi.");
    loadTemplates();
    loadAnalyse();
  }

  function bindEvents() {
    document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    $("refreshBtn").addEventListener("click", () => refreshAll());
    $("settingsBtn")?.addEventListener("click", () => {
      window.location.href = `/apps/${appId}/edit`;
    });

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
    $("userForm").addEventListener("submit", saveUser);
    $("userCancelBtn").addEventListener("click", () => $("userDialog").close());

    $("workoutCreateBtn")?.addEventListener("click", () => openWorkoutDialog(null));
    $("workoutSearchBtn").addEventListener("click", () => {
      workoutsPage = 1;
      loadWorkouts();
    });
    $("workoutClearBtn").addEventListener("click", () => {
      $("workoutSearch").value = "";
      workoutsPage = 1;
      loadWorkouts();
    });
    $("workoutsPrevBtn").addEventListener("click", () => {
      if (workoutsPage > 1) {
        workoutsPage -= 1;
        loadWorkouts();
      }
    });
    $("workoutsNextBtn").addEventListener("click", () => {
      workoutsPage += 1;
      loadWorkouts();
    });
    $("workoutForm").addEventListener("submit", saveWorkout);
    $("workoutCancelBtn").addEventListener("click", () => $("workoutDialog").close());

    $("templateCreateBtn")?.addEventListener("click", () => openTemplateDialog(null));
    $("templateSearchBtn").addEventListener("click", () => {
      templatesPage = 1;
      loadTemplates();
    });
    $("templateClearBtn").addEventListener("click", () => {
      $("templateSearch").value = "";
      templatesPage = 1;
      loadTemplates();
    });
    $("templatesPrevBtn").addEventListener("click", () => {
      if (templatesPage > 1) {
        templatesPage -= 1;
        loadTemplates();
      }
    });
    $("templatesNextBtn").addEventListener("click", () => {
      templatesPage += 1;
      loadTemplates();
    });
    $("templateForm").addEventListener("submit", saveTemplate);
    $("templateCancelBtn").addEventListener("click", () => $("templateDialog").close());
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "workouts") await loadWorkouts();
    if (currentView === "templates") await loadTemplates();
    if (currentView === "analytics") renderAnalytics();
  }

  window.HomiFitPanel = {
    openUserById(userId) {
      switchView("users");
      $("userSearch").value = String(userId || "");
      usersPage = 1;
      loadUsers().then(() => {
        if (usersCache.get(String(userId))) openUserDialog(userId);
      });
    },
  };

  bindEvents();
  (async function init() {
    if (window.PanelAuth) {
      const session = await window.PanelAuth.fetchSession();
      if (!session) return;
      canManage = window.PanelAuth.isManager(session);
      applyRoleUi();
    } else {
      canManage = true;
      applyRoleUi();
    }
    try {
      await loadAppMeta();
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
    } catch (error) {
      setHealth(false, "Başlatılamadı");
      showToast(error.message || "Panel yüklenemedi.");
    }
  })();
})();
