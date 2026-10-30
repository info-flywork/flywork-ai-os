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

  let lessonsPage = 1;
  let lessonsPagination = null;
  let lessonsCache = new Map();

  let activitiesPage = 1;
  let activitiesPagination = null;
  let activitiesCache = new Map();

  let itemsPage = 1;
  let itemsPagination = null;
  let itemsCache = new Map();

  let languagesCache = new Map();
  let optionsCache = { lessons: [] };

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

  function authProviderLabel(extras) {
    if (extras?.isGuest) return "Misafir";
    const provider = extras?.authProvider;
    if (!provider) return "—";
    const labels = {
      google: "Google",
      apple: "Apple",
      email: "E-posta",
      guest: "Misafir",
    };
    return labels[provider] || provider;
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
    if (view === "lessons") loadLessons();
    if (view === "activities") loadActivities();
    if (view === "items") loadItems();
    if (view === "languages") loadLanguages();
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
    const name = app.appName || "Lingola Kids";
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
      "statTotalLessons",
      "statTotalActivities",
      "statNewUsersToday",
      "statTotalItems",
      "statTotalVoices",
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
      renderInsightCard("Giriş yöntemleri", "Kimlik doğrulama sağlayıcıları", insights.authProviders),
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
    setText("statTotalLessons", formatNumber(summary.totalLessons));
    setText("statTotalActivities", formatNumber(summary.totalActivities));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statTotalItems", formatNumber(summary.totalItems));
    setText("statTotalVoices", formatNumber(summary.totalVoices));
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
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(row.email || "—")}</div>
              </td>
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${escapeHtml(authProviderLabel(extras))}</td>
              <td>${escapeHtml(extras.preferredLanguage || "—")}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-user-id="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button></td>
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

  function fillLessonSelects() {
    const lessons = optionsCache.lessons || [];
    const optionsHtml = `<option value="">Tüm kategoriler</option>${lessons
      .map((lesson) => `<option value="${escapeHtml(lesson.id)}">${escapeHtml(lesson.title)}</option>`)
      .join("")}`;
    const dialogOptionsHtml = `<option value="">Seçin...</option>${lessons
      .map((lesson) => `<option value="${escapeHtml(lesson.id)}">${escapeHtml(lesson.title)}</option>`)
      .join("")}`;

    ["activityLessonFilter", "itemLessonFilter"].forEach((selectId) => {
      const select = $(selectId);
      if (!select) return;
      const current = select.value;
      select.innerHTML = optionsHtml;
      if (current) select.value = current;
    });

    ["activityLessonId", "itemLessonId"].forEach((selectId) => {
      const select = $(selectId);
      if (!select) return;
      const current = select.value;
      select.innerHTML = dialogOptionsHtml;
      if (current) select.value = current;
    });
  }

  async function loadOptions() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await response.json();
      if (!data.ok) return;
      optionsCache = data.bodyJson?.data || { lessons: [] };
      fillLessonSelects();
    } catch {
      /* optional */
    }
  }

  async function loadLessons() {
    $("lessonsError").hidden = true;
    const params = new URLSearchParams({ page: String(lessonsPage), limit: String(pageSize) });
    const search = $("lessonSearch")?.value.trim();
    if (search) params.set("search", search);

    const response = await fetch(`/api/apps/${appId}/proxy/lessons?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("lessonsError").hidden = false;
      $("lessonsError").textContent = apiMessage(data, "Ders kategorileri alınamadı.");
      $("lessonsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    lessonsPagination = data.bodyJson?.pagination || null;
    lessonsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "lessonsMeta",
      lessonsPagination
        ? `Sayfa ${lessonsPagination.page}/${lessonsPagination.totalPages} · ${formatNumber(lessonsPagination.total)} kategori`
        : `${formatNumber(rows.length)} kategori`
    );

    $("lessonsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><div class="user-cell-title">${escapeHtml(row.title)}</div></td>
              <td>${escapeHtml(row.slug || "—")}</td>
              <td>${formatNumber(row.activityCount)}</td>
              <td>${formatNumber(row.itemCount)}</td>
              <td>${row.isActive ? "Evet" : "Hayır"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-lesson-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-lesson-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kategori yok</td></tr>';

    $("lessonsBody").querySelectorAll("[data-lesson-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openLessonDialog(btn.getAttribute("data-lesson-edit")));
    });
    $("lessonsBody").querySelectorAll("[data-lesson-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Kategori silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/lessons/${encodeURIComponent(btn.getAttribute("data-lesson-del"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) return showToast(apiMessage(deleteData, "Silinemedi."));
        showToast("Kategori silindi.");
        loadLessons();
        loadOptions();
        loadAnalyse();
      });
    });
    $("lessonsPrevBtn").disabled = !lessonsPagination || lessonsPagination.page <= 1;
    $("lessonsNextBtn").disabled =
      !lessonsPagination || lessonsPagination.page >= lessonsPagination.totalPages;
  }

  async function openLessonDialog(id) {
    let row = id ? lessonsCache.get(String(id)) : null;
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/lessons/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) row = detailData.bodyJson?.data || row;
    }
    $("lessonDialogTitle").textContent = row ? "Kategori düzenle" : "Yeni kategori";
    $("lessonEditId").value = row?.id || "";
    $("lessonTitle").value = row?.title || "";
    $("lessonSlug").value = row?.slug || "";
    $("lessonAssetKey").value = row?.assetKey || "";
    $("lessonOrder").value = row?.sortOrder ?? 0;
    $("lessonActive").checked = row ? Boolean(row.isActive) : true;
    $("lessonFormError").hidden = true;
    $("lessonDialog").showModal();
  }

  async function saveLesson(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("lessonEditId").value;
    const payload = {
      title: $("lessonTitle").value.trim(),
      slug: $("lessonSlug").value.trim(),
      assetKey: $("lessonAssetKey").value.trim(),
      sortOrder: Number($("lessonOrder").value) || 0,
      isActive: $("lessonActive").checked,
    };
    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/lessons/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/lessons`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("lessonFormError").hidden = false;
      $("lessonFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("lessonDialog").close();
    showToast(id ? "Kategori güncellendi." : "Kategori eklendi.");
    loadLessons();
    loadOptions();
    loadAnalyse();
  }

  async function loadActivities() {
    $("activitiesError").hidden = true;
    const params = new URLSearchParams({ page: String(activitiesPage), limit: String(pageSize) });
    const search = $("activitySearch")?.value.trim();
    const lessonId = $("activityLessonFilter")?.value;
    if (search) params.set("search", search);
    if (lessonId) params.set("lessonId", lessonId);

    const response = await fetch(`/api/apps/${appId}/proxy/activities?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("activitiesError").hidden = false;
      $("activitiesError").textContent = apiMessage(data, "Aktiviteler alınamadı.");
      $("activitiesBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    activitiesPagination = data.bodyJson?.pagination || null;
    activitiesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "activitiesMeta",
      activitiesPagination
        ? `Sayfa ${activitiesPagination.page}/${activitiesPagination.totalPages} · ${formatNumber(activitiesPagination.total)} aktivite`
        : `${formatNumber(rows.length)} aktivite`
    );

    $("activitiesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><div class="user-cell-title">${escapeHtml(row.title)}</div></td>
              <td>${escapeHtml(row.lessonTitle || row.lessonId || "—")}</td>
              <td>${escapeHtml(row.activityType || "—")}</td>
              <td>${escapeHtml(row.routeName || "—")}</td>
              <td>
                <button type="button" class="btn btn-sm" data-activity-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-activity-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Aktivite yok</td></tr>';

    $("activitiesBody").querySelectorAll("[data-activity-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openActivityDialog(btn.getAttribute("data-activity-edit")));
    });
    $("activitiesBody").querySelectorAll("[data-activity-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Aktivite silinsin mi?")) return;
        const del = await fetch(
          `/api/apps/${appId}/proxy/activities/${encodeURIComponent(btn.getAttribute("data-activity-del"))}`,
          { method: "DELETE" }
        );
        const delData = await del.json();
        if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
        showToast("Aktivite silindi.");
        loadActivities();
        loadAnalyse();
      });
    });
    $("activitiesPrevBtn").disabled = !activitiesPagination || activitiesPagination.page <= 1;
    $("activitiesNextBtn").disabled =
      !activitiesPagination || activitiesPagination.page >= activitiesPagination.totalPages;
  }

  async function openActivityDialog(id) {
    await loadOptions();
    const row = id ? activitiesCache.get(String(id)) : null;
    $("activityDialogTitle").textContent = row ? "Aktivite düzenle" : "Yeni aktivite";
    $("activityEditId").value = row?.id || "";
    $("activityLessonId").value = row?.lessonId || "";
    $("activityTitle").value = row?.title || "";
    $("activitySlug").value = row?.slug || "";
    $("activityType").value = row?.activityType || "";
    $("activityRoute").value = row?.routeName || "";
    $("activityOrder").value = row?.sortOrder ?? 0;
    $("activityActive").checked = row ? Boolean(row.isActive) : true;
    $("activityFormError").hidden = true;
    $("activityDialog").showModal();
  }

  async function saveActivity(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("activityEditId").value;
    const payload = {
      lessonId: $("activityLessonId").value,
      title: $("activityTitle").value.trim(),
      slug: $("activitySlug").value.trim(),
      activityType: $("activityType").value.trim(),
      routeName: $("activityRoute").value.trim(),
      sortOrder: Number($("activityOrder").value) || 0,
      isActive: $("activityActive").checked,
    };
    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/activities/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/activities`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("activityFormError").hidden = false;
      $("activityFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("activityDialog").close();
    showToast(id ? "Aktivite güncellendi." : "Aktivite eklendi.");
    loadActivities();
    loadAnalyse();
  }

  async function loadItems() {
    $("itemsError").hidden = true;
    const params = new URLSearchParams({ page: String(itemsPage), limit: String(pageSize) });
    const search = $("itemSearch")?.value.trim();
    const lessonId = $("itemLessonFilter")?.value;
    if (search) params.set("search", search);
    if (lessonId) params.set("lessonId", lessonId);

    const response = await fetch(`/api/apps/${appId}/proxy/items?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("itemsError").hidden = false;
      $("itemsError").textContent = apiMessage(data, "Öğeler alınamadı.");
      $("itemsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    itemsPagination = data.bodyJson?.pagination || null;
    itemsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "itemsMeta",
      itemsPagination
        ? `Sayfa ${itemsPagination.page}/${itemsPagination.totalPages} · ${formatNumber(itemsPagination.total)} öğe`
        : `${formatNumber(rows.length)} öğe`
    );

    $("itemsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.label)}</div>
                <div class="user-cell-sub">${escapeHtml(row.itemKey || "—")}</div>
              </td>
              <td>${escapeHtml(row.lessonTitle || row.lessonId || "—")}</td>
              <td>${escapeHtml(row.assetKey || "—")}</td>
              <td>${formatNumber(row.sortOrder)}</td>
              <td>
                <button type="button" class="btn btn-sm" data-item-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-item-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Öğe yok</td></tr>';

    $("itemsBody").querySelectorAll("[data-item-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openItemDialog(btn.getAttribute("data-item-edit")));
    });
    $("itemsBody").querySelectorAll("[data-item-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Öğe silinsin mi?")) return;
        const del = await fetch(
          `/api/apps/${appId}/proxy/items/${encodeURIComponent(btn.getAttribute("data-item-del"))}`,
          { method: "DELETE" }
        );
        const delData = await del.json();
        if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
        showToast("Öğe silindi.");
        loadItems();
        loadAnalyse();
      });
    });
    $("itemsPrevBtn").disabled = !itemsPagination || itemsPagination.page <= 1;
    $("itemsNextBtn").disabled =
      !itemsPagination || itemsPagination.page >= itemsPagination.totalPages;
  }

  async function openItemDialog(id) {
    await loadOptions();
    const row = id ? itemsCache.get(String(id)) : null;
    $("itemDialogTitle").textContent = row ? "Öğe düzenle" : "Yeni öğe";
    $("itemEditId").value = row?.id || "";
    $("itemLessonId").value = row?.lessonId || "";
    $("itemKey").value = row?.itemKey || "";
    $("itemLabel").value = row?.label || "";
    $("itemAssetKey").value = row?.assetKey || "";
    $("itemDrawAssetKey").value = row?.drawAssetKey || "";
    $("itemOrder").value = row?.sortOrder ?? 0;
    $("itemFormError").hidden = true;
    $("itemDialog").showModal();
  }

  async function saveItem(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("itemEditId").value;
    const payload = {
      lessonId: $("itemLessonId").value,
      itemKey: $("itemKey").value.trim(),
      label: $("itemLabel").value.trim(),
      assetKey: $("itemAssetKey").value.trim(),
      drawAssetKey: $("itemDrawAssetKey").value.trim(),
      sortOrder: Number($("itemOrder").value) || 0,
    };
    const response = await fetch(
      id ? `/api/apps/${appId}/proxy/items/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/items`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("itemFormError").hidden = false;
      $("itemFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("itemDialog").close();
    showToast(id ? "Öğe güncellendi." : "Öğe eklendi.");
    loadItems();
    loadAnalyse();
  }

  async function loadLanguages() {
    $("languagesError").hidden = true;
    const response = await fetch(`/api/apps/${appId}/proxy/languages`);
    const data = await response.json();
    if (!data.ok) {
      $("languagesError").hidden = false;
      $("languagesError").textContent = apiMessage(data, "Diller alınamadı.");
      $("languagesBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    languagesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText("languagesMeta", `${formatNumber(rows.length)} dil`);

    $("languagesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(row.code || "—")}</td>
              <td>${escapeHtml(row.name || "—")}</td>
              <td>${formatNumber(row.sortOrder)}</td>
              <td>${row.isActive ? "Evet" : "Hayır"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-language-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Dil yok</td></tr>';

    $("languagesBody").querySelectorAll("[data-language-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openLanguageDialog(btn.getAttribute("data-language-edit")));
    });
  }

  function openLanguageDialog(id) {
    const row = id ? languagesCache.get(String(id)) : null;
    $("languageDialogTitle").textContent = row ? "Dil düzenle" : "Yeni dil";
    $("languageEditId").value = row?.id || "";
    $("languageCode").value = row?.code || "";
    $("languageName").value = row?.name || "";
    $("languageOrder").value = row?.sortOrder ?? 0;
    $("languageActive").checked = row ? Boolean(row.isActive) : true;
    $("languageCode").readOnly = Boolean(row);
    $("languageFormError").hidden = true;
    $("languageDialog").showModal();
  }

  async function saveLanguage(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("languageEditId").value;
    const payload = {
      code: $("languageCode").value.trim(),
      name: $("languageName").value.trim(),
      sortOrder: Number($("languageOrder").value) || 0,
      isActive: $("languageActive").checked,
    };
    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/languages/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/languages`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("languageFormError").hidden = false;
      $("languageFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("languageDialog").close();
    showToast(id ? "Dil güncellendi." : "Dil eklendi.");
    loadLanguages();
    loadOptions();
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

    $("lessonCreateBtn")?.addEventListener("click", () => openLessonDialog(null));
    $("lessonSearchBtn")?.addEventListener("click", () => {
      lessonsPage = 1;
      loadLessons();
    });
    $("lessonClearBtn")?.addEventListener("click", () => {
      $("lessonSearch").value = "";
      lessonsPage = 1;
      loadLessons();
    });
    $("lessonsPrevBtn")?.addEventListener("click", () => {
      if (lessonsPage > 1) {
        lessonsPage -= 1;
        loadLessons();
      }
    });
    $("lessonsNextBtn")?.addEventListener("click", () => {
      lessonsPage += 1;
      loadLessons();
    });
    $("lessonForm")?.addEventListener("submit", saveLesson);
    $("lessonCancelBtn")?.addEventListener("click", () => $("lessonDialog").close());

    $("activityCreateBtn")?.addEventListener("click", () => openActivityDialog(null));
    $("activitySearchBtn")?.addEventListener("click", () => {
      activitiesPage = 1;
      loadActivities();
    });
    $("activityClearBtn")?.addEventListener("click", () => {
      $("activitySearch").value = "";
      $("activityLessonFilter").value = "";
      activitiesPage = 1;
      loadActivities();
    });
    $("activitiesPrevBtn")?.addEventListener("click", () => {
      if (activitiesPage > 1) {
        activitiesPage -= 1;
        loadActivities();
      }
    });
    $("activitiesNextBtn")?.addEventListener("click", () => {
      activitiesPage += 1;
      loadActivities();
    });
    $("activityForm")?.addEventListener("submit", saveActivity);
    $("activityCancelBtn")?.addEventListener("click", () => $("activityDialog").close());

    $("itemCreateBtn")?.addEventListener("click", () => openItemDialog(null));
    $("itemSearchBtn")?.addEventListener("click", () => {
      itemsPage = 1;
      loadItems();
    });
    $("itemClearBtn")?.addEventListener("click", () => {
      $("itemSearch").value = "";
      $("itemLessonFilter").value = "";
      itemsPage = 1;
      loadItems();
    });
    $("itemsPrevBtn")?.addEventListener("click", () => {
      if (itemsPage > 1) {
        itemsPage -= 1;
        loadItems();
      }
    });
    $("itemsNextBtn")?.addEventListener("click", () => {
      itemsPage += 1;
      loadItems();
    });
    $("itemForm")?.addEventListener("submit", saveItem);
    $("itemCancelBtn")?.addEventListener("click", () => $("itemDialog").close());

    $("languageCreateBtn")?.addEventListener("click", () => openLanguageDialog(null));
    $("languageForm")?.addEventListener("submit", saveLanguage);
    $("languageCancelBtn")?.addEventListener("click", () => $("languageDialog").close());
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse(), loadOptions()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "lessons") await loadLessons();
    if (currentView === "activities") await loadActivities();
    if (currentView === "items") await loadItems();
    if (currentView === "languages") await loadLanguages();
    if (currentView === "analytics") renderAnalytics();
  }

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
      await Promise.all([loadHealth(), loadAnalyse(), loadOptions(), window.RevenueCatPanel?.load?.(appId)]);
    } catch (error) {
      showToast(error.message || "Panel yüklenemedi.");
    }
  })();
})();
