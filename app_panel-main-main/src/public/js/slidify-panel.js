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
  let projectsCache = new Map();

  let reviewsPage = 1;
  let reviewsPagination = null;

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

    if (view === "templates") loadTemplates();
    if (view === "users") loadUsers();
    if (view === "projects") loadProjects();
    if (view === "reviews") loadReviews();
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
    const name = app.appName || "Slidify";
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
      "statTotalTemplates",
      "statNewUsersToday",
      "statProjectsToday",
      "statCompletedProjects",
      "statFailedProjects",
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function renderDaily(rows) {
    $("dailyBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(String(row.date || "").slice(0, 10) || "—")}</td>
              <td><strong>${formatNumber(row.projects)}</strong></td>
              <td>${formatNumber(row.completed)}</td>
              <td>${formatNumber(row.failed)}</td>
              <td>${formatNumber(row.activeUsers)}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Henüz hareket yok</td></tr>';
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
      renderInsightCard("Sunum durumları", "pending / processing / completed / failed", insights.projectStatuses),
      renderInsightCard("En çok kullanılan şablonlar", "Presenton / katalog id", insights.topTemplates),
      renderInsightCard("Abonelik planları", "Kullanıcı plan dağılımı", insights.subscriptionPlans),
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
    setText("statTotalTemplates", formatNumber(summary.totalTemplates));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statProjectsToday", formatNumber(summary.projectsToday));
    setText("statCompletedProjects", formatNumber(summary.completedProjects));
    setText("statFailedProjects", formatNumber(summary.failedProjects));
    setText(
      "analyseHint",
      `Ortalama şablon puanı: ${summary.avgRating ?? "—"} · Yorum: ${formatNumber(summary.totalReviews)} · TZ: ${analyseData.timezone || "Europe/Istanbul"}`
    );
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  async function loadTemplates() {
    $("templatesError").hidden = true;
    const params = new URLSearchParams();
    const search = $("templateSearch").value.trim();
    const category = $("templateCategoryFilter").value;
    if (search) params.set("search", search);
    if (category) params.set("category", category);

    const response = await fetch(`/api/apps/${appId}/proxy/templates?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("templatesError").hidden = false;
      $("templatesError").textContent = apiMessage(data, "Şablonlar alınamadı.");
      $("templatesBody").innerHTML = "";
      setText("templatesMeta", "Hata");
      return;
    }

    const rows = listFromBody(data);
    const categories = [...new Set(rows.map((row) => row.category).filter(Boolean))].sort();
    const select = $("templateCategoryFilter");
    const selected = select.value;
    select.innerHTML = '<option value="">Tüm kategoriler</option>';
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
    if (selected) select.value = selected;

    setText("templatesMeta", `${formatNumber(rows.length)} şablon`);
    $("templatesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.title || row.id)}</div>
                <div class="user-cell-sub">${escapeHtml(row.id)}</div>
              </td>
              <td>${escapeHtml(row.category || "—")}</td>
              <td>${escapeHtml(row.presentonId || "—")}</td>
              <td>${formatNumber(row.projectCount)}</td>
              <td>${formatNumber(row.completedCount)}</td>
              <td>${row.avgRating != null ? escapeHtml(String(row.avgRating)) : "—"} <span class="user-cell-sub">(${formatNumber(row.reviewCount)})</span></td>
              <td><button type="button" class="btn btn-sm" data-template-id="${escapeHtml(row.id)}">Detay</button></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Şablon yok</td></tr>';

    $("templatesBody").querySelectorAll("[data-template-id]").forEach((btn) => {
      btn.addEventListener("click", () => openTemplateDetail(btn.getAttribute("data-template-id")));
    });
  }

  async function openTemplateDetail(templateId) {
    const response = await fetch(
      `/api/apps/${appId}/proxy/templates/${encodeURIComponent(templateId)}`
    );
    const data = await response.json();
    if (!data.ok) {
      showToast(apiMessage(data, "Şablon detayı alınamadı."));
      return;
    }
    const item = data.bodyJson?.data || {};
    const reviews = Array.isArray(item.reviews) ? item.reviews : [];
    $("templateDialogTitle").textContent = item.title || item.id || "Şablon";
    $("templateDetailBody").innerHTML = `
      <p><strong>ID:</strong> ${escapeHtml(item.id)}</p>
      <p><strong>Presenton:</strong> ${escapeHtml(item.presentonId || "—")}</p>
      <p><strong>Kategori:</strong> ${escapeHtml(item.category || "—")}</p>
      <p><strong>Açıklama:</strong> ${escapeHtml(item.description || "—")}</p>
      <p><strong>Kullanım:</strong> ${formatNumber(item.projectCount)} · tamamlanan ${formatNumber(item.completedCount)}</p>
      <h3 style="margin-top:16px">Son yorumlar</h3>
      ${
        reviews.length
          ? `<ul>${reviews
              .slice(0, 8)
              .map(
                (review) =>
                  `<li><strong>${escapeHtml(String(review.rating))}/5</strong> ${escapeHtml(review.userName || "—")} — ${escapeHtml(review.comment || "")}</li>`
              )
              .join("")}</ul>`
          : '<p class="user-cell-sub">Yorum yok</p>'
      }
    `;
    $("templateDialog").showModal();
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
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(extras.deviceId || row.authId || "—")}</div>
              </td>
              <td>${escapeHtml(extras.language || "—")}</td>
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
    $("userLanguage").value = extras.language || "";
    $("userPlan").value = extras.subscriptionPlan || "none";
    $("userIsPremium").checked = Boolean(extras.isPremium);
    $("userFirstTemplate").checked = Boolean(extras.firstTemplateCreated);
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
      language: $("userLanguage").value.trim(),
      subscriptionPlan: $("userPlan").value,
      isPremium: $("userIsPremium").checked,
      firstTemplateCreated: $("userFirstTemplate").checked,
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
    const status = $("projectStatusFilter").value;
    if (search) params.set("search", search);
    if (status) params.set("status", status);

    const response = await fetch(`/api/apps/${appId}/proxy/projects?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("projectsError").hidden = false;
      $("projectsError").textContent = apiMessage(data, "Sunumlar alınamadı.");
      $("projectsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    projectsPagination = data.bodyJson?.pagination || null;
    projectsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "projectsMeta",
      projectsPagination
        ? `Sayfa ${projectsPagination.page}/${projectsPagination.totalPages} · ${formatNumber(projectsPagination.total)} sunum`
        : `${formatNumber(rows.length)} sunum`
    );

    $("projectsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.title || `Sunum #${row.id}`)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}</div>
              </td>
              <td>${escapeHtml(row.userName || `#${row.userId}`)}</td>
              <td>${escapeHtml(row.status || "—")}</td>
              <td>${escapeHtml(row.presentonTemplate || row.templateId || "—")}</td>
              <td>${formatNumber(row.slideCount)}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-project-id="${escapeHtml(row.id)}">Detay</button></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Sunum yok</td></tr>';

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
      showToast(apiMessage(data, "Sunum detayı alınamadı."));
      return;
    }
    const item = data.bodyJson?.data || {};
    const slides = Array.isArray(item.slides) ? item.slides : [];
    $("projectDetailBody").innerHTML = `
      <p><strong>Başlık:</strong> ${escapeHtml(item.title || "—")}</p>
      <p><strong>Kullanıcı:</strong> ${escapeHtml(item.userName || item.userId || "—")}</p>
      <p><strong>Durum:</strong> ${escapeHtml(item.status || "—")}</p>
      <p><strong>Şablon:</strong> ${escapeHtml(item.presentonTemplate || item.templateId || "—")}</p>
      <p><strong>Dosya:</strong> ${
        item.fileUrl
          ? `<a href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noopener">İndir / aç</a>`
          : "—"
      }</p>
      <p><strong>Prompt:</strong> ${escapeHtml(item.aiPrompt || "—")}</p>
      <h3 style="margin-top:16px">Slaytlar (${formatNumber(slides.length)})</h3>
      ${
        slides.length
          ? `<ol>${slides
              .slice(0, 20)
              .map((slide) => `<li>${escapeHtml(slide.title || `Slayt ${slide.order || ""}`)}</li>`)
              .join("")}</ol>`
          : '<p class="user-cell-sub">Slayt kaydı yok</p>'
      }
    `;
    $("projectDialog").showModal();
  }

  async function deleteSelectedProject() {
    if (!canManage || !selectedProjectId) return;
    if (!window.confirm("Bu sunumu silmek istediğinize emin misiniz?")) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/projects/${encodeURIComponent(selectedProjectId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (!data.ok) {
      showToast(apiMessage(data, "Sunum silinemedi."));
      return;
    }
    $("projectDialog").close();
    showToast("Sunum silindi.");
    loadProjects();
    loadAnalyse();
  }

  async function loadReviews() {
    $("reviewsError").hidden = true;
    const params = new URLSearchParams({ page: String(reviewsPage), limit: String(pageSize) });
    const search = $("reviewSearch").value.trim();
    if (search) params.set("search", search);

    const response = await fetch(`/api/apps/${appId}/proxy/reviews?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("reviewsError").hidden = false;
      $("reviewsError").textContent = apiMessage(data, "Yorumlar alınamadı.");
      $("reviewsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    const paginationInfo = data.bodyJson?.pagination || null;
    setText(
      "reviewsMeta",
      paginationInfo
        ? `Sayfa ${paginationInfo.page}/${paginationInfo.totalPages} · ${formatNumber(paginationInfo.total)} yorum`
        : `${formatNumber(rows.length)} yorum`
    );

    $("reviewsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(row.templateId || "—")}</td>
              <td>${escapeHtml(row.userName || `#${row.userId}`)}</td>
              <td>${formatNumber(row.rating)}</td>
              <td>${escapeHtml(row.comment || "—")}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-danger" data-review-id="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>
                  Sil
                </button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Yorum yok</td></tr>';

    $("reviewsBody").querySelectorAll("[data-review-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage) return;
        if (!window.confirm("Yorum silinsin mi?")) return;
        const responseDelete = await fetch(
          `/api/apps/${appId}/proxy/reviews/${encodeURIComponent(btn.getAttribute("data-review-id"))}`,
          { method: "DELETE" }
        );
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) {
          showToast(apiMessage(deleteData, "Yorum silinemedi."));
          return;
        }
        showToast("Yorum silindi.");
        loadReviews();
        loadAnalyse();
      });
    });

    $("reviewsPrevBtn").disabled = !paginationInfo || paginationInfo.page <= 1;
    $("reviewsNextBtn").disabled = !paginationInfo || paginationInfo.page >= paginationInfo.totalPages;
    reviewsPagination = paginationInfo;
  }

  function bindEvents() {
    document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    $("refreshBtn").addEventListener("click", () => refreshAll());
    $("settingsBtn")?.addEventListener("click", () => {
      window.location.href = `/apps/${appId}/edit`;
    });

    $("templateSearchBtn").addEventListener("click", () => loadTemplates());
    $("templateClearBtn").addEventListener("click", () => {
      $("templateSearch").value = "";
      $("templateCategoryFilter").value = "";
      loadTemplates();
    });
    $("templateCloseBtn").addEventListener("click", () => $("templateDialog").close());

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

    $("projectSearchBtn").addEventListener("click", () => {
      projectsPage = 1;
      loadProjects();
    });
    $("projectClearBtn").addEventListener("click", () => {
      $("projectSearch").value = "";
      $("projectStatusFilter").value = "";
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

    $("reviewSearchBtn").addEventListener("click", () => {
      reviewsPage = 1;
      loadReviews();
    });
    $("reviewClearBtn").addEventListener("click", () => {
      $("reviewSearch").value = "";
      reviewsPage = 1;
      loadReviews();
    });
    $("reviewsPrevBtn").addEventListener("click", () => {
      if (reviewsPage > 1) {
        reviewsPage -= 1;
        loadReviews();
      }
    });
    $("reviewsNextBtn").addEventListener("click", () => {
      reviewsPage += 1;
      loadReviews();
    });
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse()]);
    if (currentView === "templates") await loadTemplates();
    if (currentView === "users") await loadUsers();
    if (currentView === "projects") await loadProjects();
    if (currentView === "reviews") await loadReviews();
    if (currentView === "analytics") renderAnalytics();
  }

  window.SlidifyPanel = {
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
