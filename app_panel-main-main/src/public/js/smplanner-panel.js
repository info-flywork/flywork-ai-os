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
  let selectedProjectId = null;

  let usersPage = 1;
  let usersPagination = null;
  let usersCache = new Map();

  let projectsPage = 1;
  let projectsPagination = null;

  let brandsPage = 1;
  let brandsPagination = null;

  let postsPage = 1;
  let postsPagination = null;

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
    const element = $(id);
    if (element) element.textContent = value;
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
    if (view === "projects") loadProjects();
    if (view === "brands") loadBrands();
    if (view === "posts") loadPosts();
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
    const name = app.appName || "SM Planner";
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
      "statTotalProjects",
      "statTotalBrands",
      "statNewUsersToday",
      "statProjectsToday",
      "statScheduledPosts",
      "statTrialUsers",
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function renderDaily(rows) {
    $("dailyBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(String(row.date || "").slice(0, 10) || "—")}</td>
              <td><strong>${formatNumber(row.projects)}</strong></td>
              <td>${formatNumber(row.activeUsers)}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="3" class="user-cell-sub">Henüz hareket yok</td></tr>';
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
      renderInsightCard("Abonelik planları", "Kullanıcı plan dağılımı", insights.subscriptionPlans),
      renderInsightCard("Proje formatları", "post / reels / story", insights.projectFormats),
      renderInsightCard("Gönderi platformları", "Instagram, TikTok vb.", insights.postPlatforms),
      renderInsightCard("Gönderi durumları", "draft / scheduled / published", insights.postStatuses),
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
    setText("statTotalProjects", formatNumber(summary.totalProjects));
    setText("statTotalBrands", formatNumber(summary.totalBrands));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statProjectsToday", formatNumber(summary.projectsToday));
    setText("statScheduledPosts", formatNumber(summary.scheduledPosts));
    setText("statTrialUsers", formatNumber(summary.trialUsers));
    setText(
      "analyseHint",
      `AI mesaj: ${formatNumber(summary.totalMessages)} · Bugün mesaj: ${formatNumber(summary.messagesToday)} · TZ: ${analyseData.timezone || "Europe/Istanbul"}`
    );
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    const search = $("userSearch").value.trim();
    const premium = $("userPremiumFilter").value;
    const plan = $("userPlanFilter").value;
    if (search) params.set("search", search);
    if (premium) params.set("premium", premium);
    if (plan) params.set("plan", plan);

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
              <td>${escapeHtml(extras.authType || "—")}</td>
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${escapeHtml(extras.subscriptionPlan || "none")}</td>
              <td>${formatNumber(extras.projectCount)}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-user-id="${escapeHtml(row.id)}">Düzenle</button></td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Kullanıcı yok</td></tr>';

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
    const extras = user.extras || {};
    $("userEditId").value = user.id;
    $("userDisplayName").value = user.displayName || "";
    $("userEmail").value = user.email || "";
    $("userLanguage").value = extras.language || "";
    $("userPlan").value = extras.subscriptionPlan || "none";
    $("userIsPremium").checked = Boolean(extras.isPremium);
    $("userPremiumExpire").value = extras.premiumExpireDate
      ? String(extras.premiumExpireDate).replace("T", " ").slice(0, 19)
      : "";
    $("userFormError").hidden = true;
    $("userDialog").showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    if (!canManage) return;
    const userId = $("userEditId").value;
    const payload = {
      displayName: $("userDisplayName").value.trim(),
      email: $("userEmail").value.trim(),
      language: $("userLanguage").value.trim(),
      subscriptionPlan: $("userPlan").value,
      isPremium: $("userIsPremium").checked,
      premiumExpireDate: $("userPremiumExpire").value.trim() || null,
    };

    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`, {
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

  async function loadProjects() {
    $("projectsError").hidden = true;
    const params = new URLSearchParams({ page: String(projectsPage), limit: String(pageSize) });
    const search = $("projectSearch").value.trim();
    const format = $("projectFormatFilter").value;
    if (search) params.set("search", search);
    if (format) params.set("format", format);

    const response = await fetch(`/api/apps/${appId}/proxy/projects?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("projectsError").hidden = false;
      $("projectsError").textContent = apiMessage(data, "Projeler alınamadı.");
      $("projectsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    projectsPagination = data.bodyJson?.pagination || null;
    setText(
      "projectsMeta",
      projectsPagination
        ? `Sayfa ${projectsPagination.page}/${projectsPagination.totalPages} · ${formatNumber(projectsPagination.total)} proje`
        : `${formatNumber(rows.length)} proje`
    );

    $("projectsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.name || `Proje #${row.id}`)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}</div>
              </td>
              <td>${escapeHtml(row.userName || `#${row.userId}`)}</td>
              <td>${escapeHtml(row.format || "—")}</td>
              <td>${formatNumber(row.itemCount)}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-project-id="${escapeHtml(row.id)}">Detay</button></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Proje yok</td></tr>';

    $("projectsBody").querySelectorAll("[data-project-id]").forEach((btn) => {
      btn.addEventListener("click", () => openProjectDetail(btn.getAttribute("data-project-id")));
    });

    $("projectsPrevBtn").disabled = !projectsPagination || projectsPagination.page <= 1;
    $("projectsNextBtn").disabled =
      !projectsPagination || projectsPagination.page >= projectsPagination.totalPages;
  }

  async function openProjectDetail(projectId) {
    selectedProjectId = projectId;
    const response = await fetch(
      `/api/apps/${appId}/proxy/projects/${encodeURIComponent(projectId)}`
    );
    const data = await response.json();
    if (!data.ok) {
      showToast(apiMessage(data, "Proje detayı alınamadı."));
      return;
    }
    const item = data.bodyJson?.data || {};
    const items = Array.isArray(item.items) ? item.items : [];
    $("projectDetailBody").innerHTML = `
      <p><strong>Ad:</strong> ${escapeHtml(item.name || "—")}</p>
      <p><strong>Kullanıcı:</strong> ${escapeHtml(item.userName || item.userId || "—")}</p>
      <p><strong>Format:</strong> ${escapeHtml(item.format || "—")}</p>
      <p><strong>Caption:</strong> ${escapeHtml(item.caption || "—")}</p>
      <p><strong>Görsel:</strong> ${
        item.imageUrl
          ? `<a href="${escapeHtml(item.imageUrl)}" target="_blank" rel="noopener">Aç</a>`
          : "—"
      }</p>
      <h3 style="margin-top:16px">Öğeler (${formatNumber(items.length)})</h3>
      ${
        items.length
          ? `<ul>${items
              .slice(0, 20)
              .map(
                (entry) =>
                  `<li>${escapeHtml(entry.format || "item")} · ${escapeHtml(entry.source || "")} · ${
                    entry.mediaUrl
                      ? `<a href="${escapeHtml(entry.mediaUrl)}" target="_blank" rel="noopener">medya</a>`
                      : "—"
                  }</li>`
              )
              .join("")}</ul>`
          : '<p class="user-cell-sub">Öğe yok</p>'
      }
    `;
    $("projectDialog").showModal();
  }

  async function deleteSelectedProject() {
    if (!canManage || !selectedProjectId) return;
    if (!window.confirm("Bu projeyi silmek istediğinize emin misiniz?")) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/projects/${encodeURIComponent(selectedProjectId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (!data.ok) {
      showToast(apiMessage(data, "Proje silinemedi."));
      return;
    }
    $("projectDialog").close();
    showToast("Proje silindi.");
    loadProjects();
    loadAnalyse();
  }

  async function loadBrands() {
    $("brandsError").hidden = true;
    const params = new URLSearchParams({ page: String(brandsPage), limit: String(pageSize) });
    const search = $("brandSearch").value.trim();
    if (search) params.set("search", search);

    const response = await fetch(`/api/apps/${appId}/proxy/brands?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("brandsError").hidden = false;
      $("brandsError").textContent = apiMessage(data, "Marka kitleri alınamadı.");
      $("brandsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    brandsPagination = data.bodyJson?.pagination || null;
    setText(
      "brandsMeta",
      brandsPagination
        ? `Sayfa ${brandsPagination.page}/${brandsPagination.totalPages} · ${formatNumber(brandsPagination.total)} marka`
        : `${formatNumber(rows.length)} marka`
    );

    $("brandsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.brandName || `#${row.id}`)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}</div>
              </td>
              <td>${escapeHtml(row.userName || `#${row.userId}`)}</td>
              <td>${escapeHtml(row.sector || "—")}</td>
              <td>${escapeHtml(row.targetAudience || "—")}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-danger" data-brand-id="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>
                  Sil
                </button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Marka kiti yok</td></tr>';

    $("brandsBody").querySelectorAll("[data-brand-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Marka kiti silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/brands/${encodeURIComponent(btn.getAttribute("data-brand-id"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) {
          showToast(apiMessage(deleteData, "Silinemedi."));
          return;
        }
        showToast("Marka kiti silindi.");
        loadBrands();
        loadAnalyse();
      });
    });

    $("brandsPrevBtn").disabled = !brandsPagination || brandsPagination.page <= 1;
    $("brandsNextBtn").disabled =
      !brandsPagination || brandsPagination.page >= brandsPagination.totalPages;
  }

  async function loadPosts() {
    $("postsError").hidden = true;
    const params = new URLSearchParams({ page: String(postsPage), limit: String(pageSize) });
    const search = $("postSearch").value.trim();
    const status = $("postStatusFilter").value;
    const platform = $("postPlatformFilter").value;
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (platform) params.set("platform", platform);

    const response = await fetch(`/api/apps/${appId}/proxy/posts?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("postsError").hidden = false;
      $("postsError").textContent = apiMessage(data, "Gönderiler alınamadı.");
      $("postsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    postsPagination = data.bodyJson?.pagination || null;
    setText(
      "postsMeta",
      postsPagination
        ? `Sayfa ${postsPagination.page}/${postsPagination.totalPages} · ${formatNumber(postsPagination.total)} gönderi`
        : `${formatNumber(rows.length)} gönderi`
    );

    $("postsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml((row.caption || "").slice(0, 60) || `Gönderi #${row.id}`)}</div>
                <div class="user-cell-sub">${escapeHtml(row.accountHandle || "—")}</div>
              </td>
              <td>${escapeHtml(row.userName || `#${row.userId}`)}</td>
              <td>${escapeHtml(row.platform || "—")}</td>
              <td>${escapeHtml(row.status || "—")}</td>
              <td>${formatDateTime(row.scheduledDate || row.createdAt)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-danger" data-post-id="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>
                  Sil
                </button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Gönderi yok</td></tr>';

    $("postsBody").querySelectorAll("[data-post-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Gönderi silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/posts/${encodeURIComponent(btn.getAttribute("data-post-id"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) {
          showToast(apiMessage(deleteData, "Silinemedi."));
          return;
        }
        showToast("Gönderi silindi.");
        loadPosts();
        loadAnalyse();
      });
    });

    $("postsPrevBtn").disabled = !postsPagination || postsPagination.page <= 1;
    $("postsNextBtn").disabled =
      !postsPagination || postsPagination.page >= postsPagination.totalPages;
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
      $("userPlanFilter").value = "";
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

    $("projectSearchBtn").addEventListener("click", () => {
      projectsPage = 1;
      loadProjects();
    });
    $("projectClearBtn").addEventListener("click", () => {
      $("projectSearch").value = "";
      $("projectFormatFilter").value = "";
      projectsPage = 1;
      loadProjects();
    });
    $("projectsPrevBtn").addEventListener("click", () => {
      if (projectsPage > 1) {
        projectsPage -= 1;
        loadProjects();
      }
    });
    $("projectsNextBtn").addEventListener("click", () => {
      projectsPage += 1;
      loadProjects();
    });
    $("projectCloseBtn").addEventListener("click", () => $("projectDialog").close());
    $("projectDeleteBtn").addEventListener("click", deleteSelectedProject);

    $("brandSearchBtn").addEventListener("click", () => {
      brandsPage = 1;
      loadBrands();
    });
    $("brandClearBtn").addEventListener("click", () => {
      $("brandSearch").value = "";
      brandsPage = 1;
      loadBrands();
    });
    $("brandsPrevBtn").addEventListener("click", () => {
      if (brandsPage > 1) {
        brandsPage -= 1;
        loadBrands();
      }
    });
    $("brandsNextBtn").addEventListener("click", () => {
      brandsPage += 1;
      loadBrands();
    });

    $("postSearchBtn").addEventListener("click", () => {
      postsPage = 1;
      loadPosts();
    });
    $("postClearBtn").addEventListener("click", () => {
      $("postSearch").value = "";
      $("postStatusFilter").value = "";
      $("postPlatformFilter").value = "";
      postsPage = 1;
      loadPosts();
    });
    $("postsPrevBtn").addEventListener("click", () => {
      if (postsPage > 1) {
        postsPage -= 1;
        loadPosts();
      }
    });
    $("postsNextBtn").addEventListener("click", () => {
      postsPage += 1;
      loadPosts();
    });
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "projects") await loadProjects();
    if (currentView === "brands") await loadBrands();
    if (currentView === "posts") await loadPosts();
    if (currentView === "analytics") renderAnalytics();
  }

  window.SmPlannerPanel = {
    openUserById(userId) {
      switchView("users");
      $("userSearch").value = String(userId || "");
      usersPage = 1;
      loadUsers().then(() => {
        const cached = usersCache.get(String(userId));
        if (cached) openUserDialog(userId);
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
