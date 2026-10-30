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

  let storiesPage = 1;
  let storiesPagination = null;
  let storiesCache = new Map();

  let sectionsPage = 1;
  let sectionsPagination = null;
  let sectionsCache = new Map();

  let languagesCache = new Map();
  let optionsCache = { categories: [], stories: [] };

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
    if (view === "stories") loadStories();
    if (view === "sections") loadSections();
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
    const name = app.appName || "Lingola Stories Kids";
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
      "statTotalStories",
      "statPopularStories",
      "statNewUsersToday",
      "statTotalSections",
      "statTotalCompletions",
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
      renderInsightCard("Hikaye kategorileri", "Kategori dağılımı", insights.storyCategories),
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
    setText("statTotalStories", formatNumber(summary.totalStories));
    setText("statPopularStories", formatNumber(summary.popularStories));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statTotalSections", formatNumber(summary.totalSections));
    setText("statTotalCompletions", formatNumber(summary.totalCompletions));
    setText("analyseHint", `TZ: ${analyseData.timezone || "Europe/Istanbul"}`);
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  function fillStorySelects() {
    const categories = optionsCache.categories || [];
    const stories = optionsCache.stories || [];

    const categorySelect = $("storyCategoryFilter");
    if (categorySelect) {
      const currentCategory = categorySelect.value;
      categorySelect.innerHTML = `<option value="">Tüm kategoriler</option>${categories
        .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
        .join("")}`;
      if (currentCategory) categorySelect.value = currentCategory;
    }

    const storyFilterOptions = `<option value="">Tüm hikayeler</option>${stories
      .map((story) => `<option value="${escapeHtml(story.id)}">${escapeHtml(story.title)}</option>`)
      .join("")}`;
    const storyDialogOptions = `<option value="">Seçin...</option>${stories
      .map((story) => `<option value="${escapeHtml(story.id)}">${escapeHtml(story.title)}</option>`)
      .join("")}`;

    const sectionStoryFilter = $("sectionStoryFilter");
    if (sectionStoryFilter) {
      const currentFilter = sectionStoryFilter.value;
      sectionStoryFilter.innerHTML = storyFilterOptions;
      if (currentFilter) sectionStoryFilter.value = currentFilter;
    }

    const sectionStoryId = $("sectionStoryId");
    if (sectionStoryId) {
      const currentStory = sectionStoryId.value;
      sectionStoryId.innerHTML = storyDialogOptions;
      if (currentStory) sectionStoryId.value = currentStory;
    }
  }

  async function loadOptions() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await response.json();
      if (!data.ok) return;
      optionsCache = data.bodyJson?.data || { categories: [], stories: [] };
      fillStorySelects();
    } catch {
      /* optional */
    }
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
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(row.email || extras.authProvider || "—")}</div>
              </td>
              <td>${escapeHtml(extras.preferredLanguage || "—")}</td>
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${formatNumber(extras.storiesRead)}</td>
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

  function formatCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) return "—";
    return categories.join(", ");
  }

  function formatRating(row) {
    if (!row.ratingCount) return "—";
    return `${Number(row.rating || 0).toFixed(1)} (${formatNumber(row.ratingCount)})`;
  }

  async function loadStories() {
    $("storiesError").hidden = true;
    const params = new URLSearchParams({ page: String(storiesPage), limit: String(pageSize) });
    const search = $("storySearch").value.trim();
    const category = $("storyCategoryFilter").value;
    const popular = $("storyPopularFilter").value;
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (popular) params.set("popular", popular);

    const response = await fetch(`/api/apps/${appId}/proxy/stories?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("storiesError").hidden = false;
      $("storiesError").textContent = apiMessage(data, "Hikayeler alınamadı.");
      $("storiesBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    storiesPagination = data.bodyJson?.pagination || null;
    storiesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "storiesMeta",
      storiesPagination
        ? `Sayfa ${storiesPagination.page}/${storiesPagination.totalPages} · ${formatNumber(storiesPagination.total)} hikaye`
        : `${formatNumber(rows.length)} hikaye`
    );

    $("storiesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.title || row.id)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}</div>
              </td>
              <td>${escapeHtml(formatCategories(row.categories))}</td>
              <td>${row.isPopular ? "Evet" : "Hayır"}</td>
              <td>${formatNumber(row.totalPages ?? row.sectionCount)}</td>
              <td>${formatRating(row)}</td>
              <td>
                <button type="button" class="btn btn-sm" data-story-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-story-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Hikaye yok</td></tr>';

    $("storiesBody").querySelectorAll("[data-story-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openStoryDialog(btn.getAttribute("data-story-edit")));
    });
    $("storiesBody").querySelectorAll("[data-story-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Hikaye silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/stories/${encodeURIComponent(btn.getAttribute("data-story-del"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) {
          showToast(apiMessage(deleteData, "Silinemedi."));
          return;
        }
        showToast("Hikaye silindi.");
        loadStories();
        loadOptions();
        loadAnalyse();
      });
    });

    $("storiesPrevBtn").disabled = !storiesPagination || storiesPagination.page <= 1;
    $("storiesNextBtn").disabled =
      !storiesPagination || storiesPagination.page >= storiesPagination.totalPages;
  }

  async function openStoryDialog(id) {
    let row = id ? storiesCache.get(String(id)) : null;
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/stories/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) row = detailData.bodyJson?.data || row;
    }
    $("storyDialogTitle").textContent = row ? "Hikaye düzenle" : "Yeni hikaye";
    $("storyEditId").value = row?.id || "";
    $("storyTitle").value = row?.title || "";
    $("storyIntroduction").value = row?.introduction || "";
    $("storyCoverUrl").value = row?.coverImageUrl || "";
    $("storyCategories").value = Array.isArray(row?.categories) ? row.categories.join(", ") : "";
    $("storyPopular").checked = Boolean(row?.isPopular);
    $("storyFormError").hidden = true;
    $("storyDialog").showModal();
  }

  async function saveStory(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("storyEditId").value;
    const payload = {
      title: $("storyTitle").value.trim(),
      introduction: $("storyIntroduction").value.trim(),
      coverImageUrl: $("storyCoverUrl").value.trim(),
      isPopular: $("storyPopular").checked,
      categories: $("storyCategories").value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/stories/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/stories`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("storyFormError").hidden = false;
      $("storyFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("storyDialog").close();
    showToast(id ? "Hikaye güncellendi." : "Hikaye eklendi.");
    loadStories();
    loadOptions();
    loadAnalyse();
  }

  async function loadSections() {
    $("sectionsError").hidden = true;
    const params = new URLSearchParams({ page: String(sectionsPage), limit: String(pageSize) });
    const search = $("sectionSearch").value.trim();
    const storyId = $("sectionStoryFilter").value;
    if (search) params.set("search", search);
    if (storyId) params.set("storyId", storyId);

    const response = await fetch(`/api/apps/${appId}/proxy/sections?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("sectionsError").hidden = false;
      $("sectionsError").textContent = apiMessage(data, "Sayfalar alınamadı.");
      $("sectionsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    sectionsPagination = data.bodyJson?.pagination || null;
    sectionsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "sectionsMeta",
      sectionsPagination
        ? `Sayfa ${sectionsPagination.page}/${sectionsPagination.totalPages} · ${formatNumber(sectionsPagination.total)} kayıt`
        : `${formatNumber(rows.length)} kayıt`
    );

    $("sectionsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.title || "—")}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}</div>
              </td>
              <td>${escapeHtml(row.storyTitle || row.storyId || "—")}</td>
              <td>${formatNumber(row.pageNumber)}</td>
              <td>${row.audioUrl ? "Var" : "—"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-section-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-section-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Sayfa yok</td></tr>';

    $("sectionsBody").querySelectorAll("[data-section-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openSectionDialog(btn.getAttribute("data-section-edit")));
    });
    $("sectionsBody").querySelectorAll("[data-section-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Sayfa silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/sections/${encodeURIComponent(btn.getAttribute("data-section-del"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) return showToast(apiMessage(deleteData, "Silinemedi."));
        showToast("Sayfa silindi.");
        loadSections();
        loadStories();
        loadAnalyse();
      });
    });

    $("sectionsPrevBtn").disabled = !sectionsPagination || sectionsPagination.page <= 1;
    $("sectionsNextBtn").disabled =
      !sectionsPagination || sectionsPagination.page >= sectionsPagination.totalPages;
  }

  async function openSectionDialog(id) {
    await loadOptions();
    const row = id ? sectionsCache.get(String(id)) : null;
    $("sectionDialogTitle").textContent = row ? "Sayfa düzenle" : "Yeni sayfa";
    $("sectionEditId").value = row?.id || "";
    $("sectionStoryId").value = row?.storyId || "";
    $("sectionTitle").value = row?.title || "";
    $("sectionContent").value = row?.content || "";
    $("sectionPageNumber").value = row?.pageNumber ?? "";
    $("sectionAudioUrl").value = row?.audioUrl || "";
    $("sectionFormError").hidden = true;
    $("sectionDialog").showModal();
  }

  async function saveSection(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("sectionEditId").value;
    const payload = {
      storyId: $("sectionStoryId").value,
      title: $("sectionTitle").value.trim(),
      content: $("sectionContent").value.trim(),
      pageNumber: Number($("sectionPageNumber").value) || 0,
      audioUrl: $("sectionAudioUrl").value.trim(),
    };
    const response = await fetch(
      id
        ? `/api/apps/${appId}/proxy/sections/${encodeURIComponent(id)}`
        : `/api/apps/${appId}/proxy/sections`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("sectionFormError").hidden = false;
      $("sectionFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("sectionDialog").close();
    showToast(id ? "Sayfa güncellendi." : "Sayfa eklendi.");
    loadSections();
    loadStories();
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
              <td>${row.isActive ? "Evet" : "Hayır"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-language-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="4" class="user-cell-sub">Dil yok</td></tr>';

    $("languagesBody").querySelectorAll("[data-language-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openLanguageDialog(btn.getAttribute("data-language-edit")));
    });
  }

  function openLanguageDialog(id) {
    const row = id ? languagesCache.get(String(id)) : null;
    if (!row) return;
    $("languageEditId").value = row.id;
    $("languageName").value = row.name || "";
    $("languageActive").checked = Boolean(row.isActive);
    $("languageFormError").hidden = true;
    $("languageDialog").showModal();
  }

  async function saveLanguage(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("languageEditId").value;
    if (!id) return;
    const response = await fetch(`/api/apps/${appId}/proxy/languages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("languageName").value.trim(),
        isActive: $("languageActive").checked,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      $("languageFormError").hidden = false;
      $("languageFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("languageDialog").close();
    showToast("Dil güncellendi.");
    loadLanguages();
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

    $("storyCreateBtn")?.addEventListener("click", () => openStoryDialog(null));
    $("storySearchBtn").addEventListener("click", () => {
      storiesPage = 1;
      loadStories();
    });
    $("storyClearBtn").addEventListener("click", () => {
      $("storySearch").value = "";
      $("storyCategoryFilter").value = "";
      $("storyPopularFilter").value = "";
      storiesPage = 1;
      loadStories();
    });
    $("storiesPrevBtn").addEventListener("click", () => {
      if (storiesPage > 1) {
        storiesPage -= 1;
        loadStories();
      }
    });
    $("storiesNextBtn").addEventListener("click", () => {
      storiesPage += 1;
      loadStories();
    });
    $("storyForm").addEventListener("submit", saveStory);
    $("storyCancelBtn").addEventListener("click", () => $("storyDialog").close());

    $("sectionCreateBtn")?.addEventListener("click", () => openSectionDialog(null));
    $("sectionSearchBtn").addEventListener("click", () => {
      sectionsPage = 1;
      loadSections();
    });
    $("sectionClearBtn").addEventListener("click", () => {
      $("sectionSearch").value = "";
      $("sectionStoryFilter").value = "";
      sectionsPage = 1;
      loadSections();
    });
    $("sectionsPrevBtn").addEventListener("click", () => {
      if (sectionsPage > 1) {
        sectionsPage -= 1;
        loadSections();
      }
    });
    $("sectionsNextBtn").addEventListener("click", () => {
      sectionsPage += 1;
      loadSections();
    });
    $("sectionForm").addEventListener("submit", saveSection);
    $("sectionCancelBtn").addEventListener("click", () => $("sectionDialog").close());

    $("languageForm").addEventListener("submit", saveLanguage);
    $("languageCancelBtn").addEventListener("click", () => $("languageDialog").close());
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse(), loadOptions()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "stories") await loadStories();
    if (currentView === "sections") await loadSections();
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
