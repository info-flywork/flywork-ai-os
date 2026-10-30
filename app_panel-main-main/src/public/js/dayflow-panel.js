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
  let optionsCache = { routineCategories: [], languages: [] };

  let usersPage = 1;
  let usersPagination = null;
  let usersCache = new Map();
  let tasksPage = 1;
  let tasksPagination = null;
  let routinesPage = 1;
  let routinesPagination = null;
  let routinesCache = new Map();
  let eventsPage = 1;
  let eventsPagination = null;
  let moodsPage = 1;
  let moodsPagination = null;

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
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
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

  function renderInsightCard(title, subtitle, items) {
    const rows = Array.isArray(items) ? items : [];
    const max = Math.max(...rows.map((item) => Number(item.count || 0)), 1);
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p>
      ${
        rows.length
          ? `<div class="insight-bar-list">${rows
              .map((item) => {
                const count = Number(item.count || 0);
                const width = Math.max(Math.round((count / max) * 100), count ? 5 : 0);
                return `<div class="insight-bar-row"><span class="insight-bar-label">${escapeHtml(
                  item.label || "—"
                )}</span><div class="insight-bar-track"><div class="insight-bar-fill" style="width:${width}%"></div></div><span class="insight-bar-meta">${formatNumber(
                  count
                )}</span></div>`;
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
      renderInsightCard("Mood dağılımı", "Kullanıcı mood kayıtları", insights.moodDistribution),
      renderInsightCard("Rutin kategorileri", "Kategori bazlı rutin sayısı", insights.routineCategories),
    ].join("");
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

  async function loadAppMeta() {
    const response = await fetch(`/api/apps/${appId}`);
    if (response.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Uygulama bilgisi alınamadı.");
    const app = data.app;
    const name = app.appName || "DayFlow";
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
      !app.apiBaseUrl ? "API URL tanımlı değil — Ayarlardan ekleyin" : app.hasPanelApiKey ? app.apiBaseUrl : `${app.apiBaseUrl} · API anahtarı eksik`
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

  async function loadOptions() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await response.json();
      if (!data.ok) return;
      optionsCache = data.bodyJson?.data || { routineCategories: [], languages: [] };
      const languageSelect = $("userLanguageFilter");
      const categorySelect = $("routineCategoryFilter");
      const datalist = $("routineCategoryList");
      languageSelect.innerHTML = `<option value="">Tüm diller</option>${(optionsCache.languages || [])
        .map((lang) => `<option value="${escapeHtml(lang)}">${escapeHtml(lang)}</option>`)
        .join("")}`;
      categorySelect.innerHTML = `<option value="">Tüm kategoriler</option>${(optionsCache.routineCategories || [])
        .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
        .join("")}`;
      datalist.innerHTML = (optionsCache.routineCategories || [])
        .map((cat) => `<option value="${escapeHtml(cat)}"></option>`)
        .join("");
    } catch {
      /* ignore */
    }
  }

  async function loadAnalyse() {
    [
      "statTotalUsers","statPremiumUsers","statTotalTasks","statTotalRoutines",
      "statTotalEvents","statTotalMoods","statNewUsersToday","statTasksToday"
    ].forEach((id) => $(id)?.classList.add("loading"));
    const response = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await response.json();
    [
      "statTotalUsers","statPremiumUsers","statTotalTasks","statTotalRoutines",
      "statTotalEvents","statTotalMoods","statNewUsersToday","statTasksToday"
    ].forEach((id) => $(id)?.classList.remove("loading"));
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
    setText("statTotalTasks", formatNumber(summary.totalTasks));
    setText("statTotalRoutines", formatNumber(summary.totalRoutines));
    setText("statTotalEvents", formatNumber(summary.totalEvents));
    setText("statTotalMoods", formatNumber(summary.totalMoods));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statTasksToday", formatNumber(summary.tasksToday));
    setText("analyseHint", `TZ: ${analyseData.timezone || "Europe/Istanbul"}`);
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    const search = $("userSearch").value.trim();
    const premium = $("userPremiumFilter").value;
    const language = $("userLanguageFilter").value;
    if (search) params.set("search", search);
    if (premium) params.set("premium", premium);
    if (language) params.set("language", language);
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
      usersPagination ? `Sayfa ${usersPagination.page}/${usersPagination.totalPages} · ${formatNumber(usersPagination.total)} kullanıcı` : `${formatNumber(rows.length)} kullanıcı`
    );
    $("usersBody").innerHTML = rows.length
      ? rows
          .map((row) => `<tr>
            <td><div class="user-cell-title">${escapeHtml(row.displayName || `#${row.id}`)}</div><div class="user-cell-sub">${escapeHtml(row.email || row.authId || "—")}</div></td>
            <td>${escapeHtml(row.extras?.language || "—")}</td>
            <td>${row.extras?.isPremium ? '<span class="badge ok">Premium</span>' : "Ücretsiz"}</td>
            <td>${formatNumber(row.extras?.taskCount)}</td>
            <td>${formatNumber(row.extras?.routineCount)}</td>
            <td><button type="button" class="btn btn-sm" data-user-id="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button></td>
          </tr>`)
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kullanıcı yok</td></tr>';
    $("usersBody").querySelectorAll("[data-user-id]").forEach((btn) => {
      btn.addEventListener("click", () => openUserDialog(btn.getAttribute("data-user-id")));
    });
    $("usersPrevBtn").disabled = !usersPagination || usersPagination.page <= 1;
    $("usersNextBtn").disabled = !usersPagination || usersPagination.page >= usersPagination.totalPages;
  }

  function openUserDialog(userId) {
    const user = usersCache.get(String(userId));
    if (!user) return;
    $("userEditId").value = user.id;
    $("userName").value = user.displayName || "";
    $("userLanguage").value = user.extras?.language || "tr";
    $("userIsPremium").checked = Boolean(user.extras?.isPremium);
    $("userTrialUsed").checked = Boolean(user.extras?.trialUsed);
    const raw = user.extras?.premiumExpiresAt;
    $("userPremiumExpiresAt").value = raw ? String(raw).replace(" ", "T").slice(0, 16) : "";
    $("userFormError").hidden = true;
    $("userDialog").showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("userEditId").value;
    const payload = {
      name: $("userName").value.trim() || null,
      language: $("userLanguage").value.trim() || "tr",
      isPremium: $("userIsPremium").checked,
      trialUsed: $("userTrialUsed").checked,
      premiumExpiresAt: $("userPremiumExpiresAt").value ? `${$("userPremiumExpiresAt").value}:00` : null,
    };
    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

  async function loadTasks() {
    $("tasksError").hidden = true;
    const params = new URLSearchParams({ page: String(tasksPage), limit: String(pageSize) });
    const search = $("taskSearch").value.trim();
    const completed = $("taskCompletedFilter").value;
    if (search) params.set("search", search);
    if (completed) params.set("completed", completed);
    const response = await fetch(`/api/apps/${appId}/proxy/tasks?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("tasksError").hidden = false;
      $("tasksError").textContent = apiMessage(data, "Görevler alınamadı.");
      $("tasksBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    tasksPagination = data.bodyJson?.pagination || null;
    setText("tasksMeta", tasksPagination ? `Sayfa ${tasksPagination.page}/${tasksPagination.totalPages} · ${formatNumber(tasksPagination.total)} görev` : `${formatNumber(rows.length)} görev`);
    $("tasksBody").innerHTML = rows.length
      ? rows
          .map((row) => `<tr>
            <td><div class="user-cell-title">${escapeHtml(row.title)}</div><div class="user-cell-sub">${escapeHtml(row.iconName || "")}</div></td>
            <td>${escapeHtml(row.userName || row.userEmail || `#${row.userId}`)}</td>
            <td>${escapeHtml((row.dates || []).slice(0, 3).join(", ") || "—")}</td>
            <td>${row.isCompleted ? '<span class="badge ok">Tamamlandı</span>' : '<span class="badge">Açık</span>'}</td>
            <td class="user-cell-sub">${formatDateTime(row.createdAt)}</td>
          </tr>`)
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Görev yok</td></tr>';
    $("tasksPrevBtn").disabled = !tasksPagination || tasksPagination.page <= 1;
    $("tasksNextBtn").disabled = !tasksPagination || tasksPagination.page >= tasksPagination.totalPages;
  }

  function openRoutineDialog(id) {
    const row = id ? routinesCache.get(String(id)) : null;
    $("routineDialogTitle").textContent = row ? "Rutin düzenle" : "Yeni rutin";
    $("routineEditId").value = row?.id || "";
    $("routineTitle").value = row?.title || "";
    $("routineCategory").value = row?.category || "";
    $("routineIconName").value = row?.iconName || "";
    $("routineColorHex").value = row?.colorHex || "";
    $("routineDescription").value = row?.description || "";
    $("routineSortOrder").value = row?.sortOrder ?? 0;
    $("routineIsPremium").checked = Boolean(row?.isPremium);
    $("routineFormError").hidden = true;
    $("routineDialog").showModal();
  }

  async function saveRoutine(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("routineEditId").value;
    const payload = {
      title: $("routineTitle").value.trim(),
      category: $("routineCategory").value.trim(),
      iconName: $("routineIconName").value.trim() || "sparkles",
      colorHex: $("routineColorHex").value.trim() || "#E8EDFF",
      description: $("routineDescription").value.trim() || null,
      sortOrder: Number($("routineSortOrder").value) || 0,
      isPremium: $("routineIsPremium").checked,
    };
    const response = await fetch(
      id ? `/api/apps/${appId}/proxy/routines/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/routines`,
      { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    const data = await response.json();
    if (!data.ok) {
      $("routineFormError").hidden = false;
      $("routineFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("routineDialog").close();
    showToast(id ? "Rutin güncellendi." : "Rutin eklendi.");
    loadRoutines();
    loadOptions();
    loadAnalyse();
  }

  async function loadRoutines() {
    $("routinesError").hidden = true;
    const params = new URLSearchParams({ page: String(routinesPage), limit: String(pageSize) });
    const search = $("routineSearch").value.trim();
    const category = $("routineCategoryFilter").value;
    const premium = $("routinePremiumFilter").value;
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (premium) params.set("premium", premium);
    const response = await fetch(`/api/apps/${appId}/proxy/routines?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("routinesError").hidden = false;
      $("routinesError").textContent = apiMessage(data, "Rutinler alınamadı.");
      $("routinesBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    routinesPagination = data.bodyJson?.pagination || null;
    routinesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText("routinesMeta", routinesPagination ? `Sayfa ${routinesPagination.page}/${routinesPagination.totalPages} · ${formatNumber(routinesPagination.total)} rutin` : `${formatNumber(rows.length)} rutin`);
    $("routinesBody").innerHTML = rows.length
      ? rows
          .map((row) => `<tr>
            <td><div class="user-cell-title">${escapeHtml(row.title)}</div><div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(row.iconName || "")}</div></td>
            <td>${escapeHtml(row.category || "—")}</td>
            <td>${row.isPremium ? '<span class="badge ok">Premium</span>' : "Ücretsiz"}</td>
            <td>${formatNumber(row.activeUserCount)}</td>
            <td>
              <button type="button" class="btn btn-sm" data-routine-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
              <button type="button" class="btn btn-sm btn-danger" data-routine-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
            </td>
          </tr>`)
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Rutin yok</td></tr>';

    $("routinesBody").querySelectorAll("[data-routine-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openRoutineDialog(btn.getAttribute("data-routine-edit")));
    });
    $("routinesBody").querySelectorAll("[data-routine-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Rutin silinsin mi?")) return;
        const id = btn.getAttribute("data-routine-del");
        const del = await fetch(`/api/apps/${appId}/proxy/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
        let data = await del.json();
        if (!data.ok && del.status === 409) {
          if (!window.confirm("Rutin aktif kullanıcılar tarafından kullanılıyor. Zorla silinsin mi?")) return;
          const forced = await fetch(`/api/apps/${appId}/proxy/routines/${encodeURIComponent(id)}?force=1`, { method: "DELETE" });
          data = await forced.json();
        }
        if (!data.ok) return showToast(apiMessage(data, "Silinemedi."));
        showToast("Rutin silindi.");
        loadRoutines();
        loadOptions();
        loadAnalyse();
      });
    });
    $("routinesPrevBtn").disabled = !routinesPagination || routinesPagination.page <= 1;
    $("routinesNextBtn").disabled = !routinesPagination || routinesPagination.page >= routinesPagination.totalPages;
  }

  async function loadEvents() {
    $("eventsError").hidden = true;
    const params = new URLSearchParams({ page: String(eventsPage), limit: String(pageSize) });
    const response = await fetch(`/api/apps/${appId}/proxy/events?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("eventsError").hidden = false;
      $("eventsError").textContent = apiMessage(data, "Etkinlikler alınamadı.");
      $("eventsBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    eventsPagination = data.bodyJson?.pagination || null;
    setText("eventsMeta", eventsPagination ? `Sayfa ${eventsPagination.page}/${eventsPagination.totalPages} · ${formatNumber(eventsPagination.total)} etkinlik` : `${formatNumber(rows.length)} etkinlik`);
    $("eventsBody").innerHTML = rows.length
      ? rows
          .map((row) => `<tr><td>${escapeHtml(row.title || "—")}</td><td>${escapeHtml(row.user_name || `#${row.user_id}`)}</td><td>${escapeHtml(row.start_date || "—")} ${row.end_date ? `→ ${escapeHtml(row.end_date)}` : ""}</td><td>${escapeHtml(row.repeat_type || "none")}</td></tr>`)
          .join("")
      : '<tr><td colspan="4" class="user-cell-sub">Etkinlik yok</td></tr>';
    $("eventsPrevBtn").disabled = !eventsPagination || eventsPagination.page <= 1;
    $("eventsNextBtn").disabled = !eventsPagination || eventsPagination.page >= eventsPagination.totalPages;
  }

  async function loadMoods() {
    $("moodsError").hidden = true;
    const params = new URLSearchParams({ page: String(moodsPage), limit: String(pageSize) });
    const response = await fetch(`/api/apps/${appId}/proxy/moods?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("moodsError").hidden = false;
      $("moodsError").textContent = apiMessage(data, "Mood kayıtları alınamadı.");
      $("moodsBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    moodsPagination = data.bodyJson?.pagination || null;
    const moodMap = ["Üzgün", "Kaygılı", "Yorgun", "Heyecanlı", "Mutlu", "Enerjik"];
    setText("moodsMeta", moodsPagination ? `Sayfa ${moodsPagination.page}/${moodsPagination.totalPages} · ${formatNumber(moodsPagination.total)} kayıt` : `${formatNumber(rows.length)} kayıt`);
    $("moodsBody").innerHTML = rows.length
      ? rows
          .map((row) => `<tr><td>${escapeHtml(row.user_name || `#${row.user_id}`)}</td><td>${escapeHtml(moodMap[row.mood_index] || `Mood #${row.mood_index}`)}</td><td>${escapeHtml(row.date || "—")}</td><td class="user-cell-sub">${formatDateTime(row.created_at)}</td></tr>`)
          .join("")
      : '<tr><td colspan="4" class="user-cell-sub">Kayıt yok</td></tr>';
    $("moodsPrevBtn").disabled = !moodsPagination || moodsPagination.page <= 1;
    $("moodsNextBtn").disabled = !moodsPagination || moodsPagination.page >= moodsPagination.totalPages;
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((element) => {
      element.classList.toggle("active", element.dataset.view === view);
    });
    document.querySelectorAll(".view-panel").forEach((element) => {
      element.classList.toggle("active", element.id === `view-${view}`);
    });
    if (view === "users") loadUsers();
    if (view === "tasks") loadTasks();
    if (view === "routines") loadRoutines();
    if (view === "events") loadEvents();
    if (view === "moods") loadMoods();
    if (view === "analytics") renderAnalytics();
    if (view === "revenuecat") window.RevenueCatPanel?.load?.(appId);
  }

  async function refreshAll() {
    const button = $("refreshBtn");
    button.disabled = true;
    button.textContent = "Yenileniyor...";
    try {
      await Promise.all([loadHealth(), loadAnalyse(), loadOptions(), window.RevenueCatPanel?.load?.(appId)]);
      if (currentView === "users") await loadUsers();
      if (currentView === "tasks") await loadTasks();
      if (currentView === "routines") await loadRoutines();
      if (currentView === "events") await loadEvents();
      if (currentView === "moods") await loadMoods();
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

  $("userSearchBtn").addEventListener("click", () => { usersPage = 1; loadUsers(); });
  $("userClearBtn").addEventListener("click", () => {
    $("userSearch").value = "";
    $("userPremiumFilter").value = "";
    $("userLanguageFilter").value = "";
    usersPage = 1;
    loadUsers();
  });
  $("usersPrevBtn").addEventListener("click", () => { if (usersPage > 1) { usersPage -= 1; loadUsers(); } });
  $("usersNextBtn").addEventListener("click", () => { usersPage += 1; loadUsers(); });
  $("userForm").addEventListener("submit", saveUser);
  $("userCancelBtn").addEventListener("click", () => $("userDialog").close());

  $("taskSearchBtn").addEventListener("click", () => { tasksPage = 1; loadTasks(); });
  $("taskClearBtn").addEventListener("click", () => {
    $("taskSearch").value = "";
    $("taskCompletedFilter").value = "";
    tasksPage = 1;
    loadTasks();
  });
  $("tasksPrevBtn").addEventListener("click", () => { if (tasksPage > 1) { tasksPage -= 1; loadTasks(); } });
  $("tasksNextBtn").addEventListener("click", () => { tasksPage += 1; loadTasks(); });

  $("routineCreateBtn").addEventListener("click", () => openRoutineDialog(null));
  $("routineSearchBtn").addEventListener("click", () => { routinesPage = 1; loadRoutines(); });
  $("routineClearBtn").addEventListener("click", () => {
    $("routineSearch").value = "";
    $("routineCategoryFilter").value = "";
    $("routinePremiumFilter").value = "";
    routinesPage = 1;
    loadRoutines();
  });
  $("routinesPrevBtn").addEventListener("click", () => { if (routinesPage > 1) { routinesPage -= 1; loadRoutines(); } });
  $("routinesNextBtn").addEventListener("click", () => { routinesPage += 1; loadRoutines(); });
  $("routineForm").addEventListener("submit", saveRoutine);
  $("routineCancelBtn").addEventListener("click", () => $("routineDialog").close());

  $("eventsPrevBtn").addEventListener("click", () => { if (eventsPage > 1) { eventsPage -= 1; loadEvents(); } });
  $("eventsNextBtn").addEventListener("click", () => { eventsPage += 1; loadEvents(); });
  $("moodsPrevBtn").addEventListener("click", () => { if (moodsPage > 1) { moodsPage -= 1; loadMoods(); } });
  $("moodsNextBtn").addEventListener("click", () => { moodsPage += 1; loadMoods(); });

  (async function init() {
    const session = await window.PanelAuth.fetchSession();
    if (!session) return;
    canManage = window.PanelAuth.isManager(session);
    applyRoleUi();
    try {
      await loadAppMeta();
      await Promise.all([loadHealth(), loadAnalyse(), loadOptions(), window.RevenueCatPanel?.load?.(appId)]);
    } catch {
      setHealth(false, "Yükleme hatası");
    }
  })();
})();
