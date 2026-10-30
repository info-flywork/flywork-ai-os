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
  let templateTypes = ["elegant", "classic", "minimal", "modern", "bohemian", "playful"];
  let browseTypes = ["Restaurant", "Cafe", "Bar", "Bakery", "Dessert", "Burger", "Pizza", "Sushi"];

  let templatesPage = 1;
  let templatesPagination = null;
  let templatesCache = new Map();
  let previewBase64 = null;
  let selectedTemplate = null;

  let usersPage = 1;
  let usersPagination = null;
  let usersCache = new Map();
  let selectedUser = null;

  let menusPage = 1;
  let menusPagination = null;
  let menusCache = new Map();

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

  function fillSelect(selectEl, values, { emptyLabel, selected } = {}) {
    if (!selectEl) return;
    selectEl.innerHTML = emptyLabel ? `<option value="">${emptyLabel}</option>` : "";
    for (const value of values) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      selectEl.appendChild(opt);
    }
    if (selected) selectEl.value = selected;
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
    const name = app.appName || "MenuMa";
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

  async function loadOptions() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await response.json();
      if (!data.ok) return;
      const payload = data.bodyJson?.data || {};
      if (Array.isArray(payload.templateTypes) && payload.templateTypes.length) {
        templateTypes = payload.templateTypes;
      }
      if (Array.isArray(payload.browseTypes) && payload.browseTypes.length) {
        browseTypes = payload.browseTypes;
      }
    } catch {
      /* keep defaults */
    }

    fillSelect($("templateTypeFilter"), templateTypes, { emptyLabel: "Tüm stiller" });
    fillSelect($("templateBrowseFilter"), browseTypes, { emptyLabel: "Tüm kategoriler" });
    fillSelect($("templateType"), templateTypes);
    fillSelect($("templateBrowseType"), browseTypes);
  }

  function setOverviewLoading(loading) {
    [
      "statTotalUsers",
      "statPremiumUsers",
      "statTotalMenus",
      "statTotalTemplates",
      "statNewUsersToday",
      "statMenusToday",
      "statReadyMenus",
      "statAiMenus",
    ].forEach((id) => $(id)?.classList.toggle("loading", loading));
  }

  function renderDaily(rows) {
    $("dailyBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(String(row.date || "").slice(0, 10) || "—")}</td>
              <td><strong>${formatNumber(row.menus)}</strong></td>
              <td>${formatNumber(row.aiMenus)}</td>
              <td>${formatNumber(row.activeUsers)}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="4" class="user-cell-sub">Henüz hareket yok</td></tr>';
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
      renderInsightCard("Menü durumları", "Taslak / hazır / arşiv", insights.menuStatuses),
      renderInsightCard("Stil dağılımı", "Menülerde kullanılan vibe", insights.styleVibes),
      renderInsightCard(
        "En çok kullanılan şablonlar",
        "Katalog şablon kullanım sırası",
        insights.topTemplates
      ),
      renderInsightCard("Şablon kategorileri", "Browse type dağılımı", insights.browseTypes),
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
    setText("statTotalMenus", formatNumber(summary.totalMenus));
    setText("statTotalTemplates", formatNumber(summary.totalTemplates));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statMenusToday", formatNumber(summary.menusToday));
    setText("statReadyMenus", formatNumber(summary.readyMenus));
    setText("statAiMenus", formatNumber(summary.aiMenus));
    setText(
      "analyseHint",
      `Sözleşme v${analyseData.contractVersion || 1} · Saat dilimi: ${analyseData.timezone || "Europe/Istanbul"}`
    );
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  function renderTemplatePreview(url, { large = false } = {}) {
    if (!url) {
      return '<p class="user-cell-sub">Önizleme görseli yok</p>';
    }
    const maxWidth = large ? "100%" : "220px";
    const maxHeight = large ? "70vh" : "auto";
    return `<img src="${escapeHtml(url)}" alt="Şablon önizleme" style="max-width:${maxWidth};max-height:${maxHeight};border-radius:12px;display:block;margin:0 auto" />`;
  }

  function updateTemplatePreview(url) {
    const box = $("templatePreviewBox");
    box.innerHTML = renderTemplatePreview(url);
  }

  function renderTemplateDetail(template) {
    const preview = renderTemplatePreview(template.cdnUrl, { large: true });
    return `
      <div class="template-detail-layout">
        <div class="template-detail-preview">${preview}</div>
        <div class="template-detail-meta">
          <table class="data-table">
            <tbody>
              <tr><td class="user-cell-sub">ID</td><td>#${escapeHtml(template.id)}</td></tr>
              <tr><td class="user-cell-sub">Ad</td><td>${escapeHtml(template.name || "—")}</td></tr>
              <tr><td class="user-cell-sub">Stil</td><td>${escapeHtml(template.type || "—")}</td></tr>
              <tr><td class="user-cell-sub">Kategori</td><td>${escapeHtml(template.browseType || "—")}</td></tr>
              <tr><td class="user-cell-sub">Kullanım</td><td>${formatNumber(template.menuCount)} menü</td></tr>
              <tr><td class="user-cell-sub">Oluşturma</td><td>${formatDateTime(template.createdAt)}</td></tr>
              <tr><td class="user-cell-sub">CDN</td><td>${
                template.cdnUrl
                  ? `<a href="${escapeHtml(template.cdnUrl)}" target="_blank" rel="noopener">Görseli aç</a>`
                  : "—"
              }</td></tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function openTemplateDetail(templateId) {
    $("templateDetailTitle").textContent = "Şablon detayı";
    $("templateDetailBody").innerHTML = '<p class="user-cell-sub">Yükleniyor...</p>';
    $("templateDetailDialog").showModal();

    const cached = templatesCache.get(String(templateId));
    if (cached?.cdnUrl) {
      selectedTemplate = cached;
      $("templateDetailTitle").textContent = cached.name || `Şablon #${cached.id}`;
      $("templateDetailBody").innerHTML = renderTemplateDetail(cached);
      return;
    }

    const response = await fetch(
      `/api/apps/${appId}/proxy/templates/${encodeURIComponent(templateId)}`
    );
    const data = await response.json();
    if (!data.ok) {
      $("templateDetailBody").innerHTML = `<div class="alert alert-error">${escapeHtml(
        apiMessage(data, "Şablon detayı alınamadı.")
      )}</div>`;
      return;
    }

    selectedTemplate = data.bodyJson?.data || cached;
    templatesCache.set(String(templateId), selectedTemplate);
    $("templateDetailTitle").textContent = selectedTemplate?.name || `Şablon #${templateId}`;
    $("templateDetailBody").innerHTML = renderTemplateDetail(selectedTemplate);
  }

  function openTemplateDialog(template) {
    $("templateDialogTitle").textContent = template ? "Şablon düzenle" : "Yeni şablon";
    $("templateEditId").value = template?.id || "";
    $("templateName").value = template?.name || "";
    fillSelect($("templateType"), templateTypes, { selected: template?.type || templateTypes[0] });
    fillSelect($("templateBrowseType"), browseTypes, {
      selected: String(template?.browseType || browseTypes[0]).split(",")[0],
    });
    $("templateCdnUrl").value = template?.cdnUrl || "";
    $("templateBrowseTypeImage").value = template?.browseTypeImage || "";
    $("templatePreviewFile").value = "";
    previewBase64 = null;
    updateTemplatePreview(template?.cdnUrl || "");
    $("templateFormError").hidden = true;
    $("templateDialog").showModal();
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadTemplates() {
    $("templatesError").hidden = true;
    $("templatesBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';
    const params = new URLSearchParams({ page: templatesPage, limit: pageSize });
    const search = $("templateSearch").value.trim();
    const type = $("templateTypeFilter").value;
    const browse = $("templateBrowseFilter").value;
    if (search) params.set("search", search);
    if (type) params.set("type", type);
    if (browse) params.set("browse_type", browse);

    const response = await fetch(`/api/apps/${appId}/proxy/templates?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("templatesBody").innerHTML = "";
      $("templatesError").hidden = false;
      $("templatesError").textContent = apiMessage(data, "Şablon listesi alınamadı.");
      return;
    }

    const rows = listFromBody(data);
    templatesPagination = data.bodyJson?.pagination || null;
    templatesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "templatesMeta",
      templatesPagination
        ? `${formatNumber(templatesPagination.total)} şablon · sayfa ${templatesPagination.page}/${templatesPagination.totalPages}`
        : `${rows.length} şablon`
    );

    $("templatesBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const thumb = row.cdnUrl
              ? `<button type="button" class="template-thumb-btn" data-detail-template="${escapeHtml(row.id)}" title="Detayı aç">
                  <img src="${escapeHtml(row.cdnUrl)}" alt="" style="width:56px;height:72px;object-fit:cover;border-radius:8px;display:block" />
                </button>`
              : `<div class="user-cell-sub">Yok</div>`;
            return `<tr>
              <td>${thumb}</td>
              <td>
                <div class="user-cell-title">${escapeHtml(row.name || `#${row.id}`)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}</div>
              </td>
              <td><span class="badge">${escapeHtml(row.type || "—")}</span></td>
              <td>${escapeHtml(row.browseType || "—")}</td>
              <td>${formatNumber(row.menuCount)}</td>
              <td class="user-cell-sub">${formatDateTime(row.createdAt)}</td>
              <td>
                <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
                  <button type="button" class="btn btn-sm btn-ghost" data-detail-template="${escapeHtml(row.id)}">Detay</button>
                  ${
                    canManage
                      ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-template="${escapeHtml(row.id)}">Düzenle</button>
                         <button type="button" class="btn btn-sm btn-ghost" data-delete-template="${escapeHtml(row.id)}">Sil</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Şablon bulunamadı</td></tr>';

    $("templatesPrevBtn").disabled = templatesPage <= 1;
    $("templatesNextBtn").disabled = templatesPage >= (templatesPagination?.totalPages || 1);
  }

  async function saveTemplate(event) {
    event.preventDefault();
    if (!canManage) return;
    $("templateFormError").hidden = true;

    const templateId = $("templateEditId").value.trim();
    const payload = {
      name: $("templateName").value.trim(),
      type: $("templateType").value,
      browseType: $("templateBrowseType").value,
      browseTypeImage: $("templateBrowseTypeImage").value.trim() || null,
      cdnUrl: $("templateCdnUrl").value.trim() || null,
    };
    if (previewBase64) payload.previewBase64 = previewBase64;

    if (!payload.name || !payload.type) {
      $("templateFormError").hidden = false;
      $("templateFormError").textContent = "Ad ve stil zorunlu.";
      return;
    }
    if (!templateId && !payload.cdnUrl && !payload.previewBase64) {
      $("templateFormError").hidden = false;
      $("templateFormError").textContent = "Yeni şablon için CDN URL veya görsel gerekli.";
      return;
    }

    const button = event.submitter;
    button.disabled = true;
    try {
      const response = await fetch(
        templateId
          ? `/api/apps/${appId}/proxy/templates/${encodeURIComponent(templateId)}`
          : `/api/apps/${appId}/proxy/templates`,
        {
          method: templateId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("templateFormError").hidden = false;
        $("templateFormError").textContent = apiMessage(data, "Şablon kaydedilemedi.");
        return;
      }
      $("templateDialog").close();
      showToast(templateId ? "Şablon güncellendi" : "Şablon oluşturuldu");
      await Promise.all([loadTemplates(), loadAnalyse()]);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteTemplate(templateId) {
    if (!canManage) return;
    const template = templatesCache.get(String(templateId));
    const used = Number(template?.menuCount || 0);
    const force = used > 0;
    if (
      !confirm(
        force
          ? `"${template?.name || templateId}" ${used} menüde kullanılıyor. Yine de silinsin mi?`
          : `"${template?.name || templateId}" silinsin mi?`
      )
    ) {
      return;
    }

    const url = `/api/apps/${appId}/proxy/templates/${encodeURIComponent(templateId)}${
      force ? "?force=1" : ""
    }`;
    const response = await fetch(url, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showToast(apiMessage(data, "Şablon silinemedi"));
      return;
    }
    showToast("Şablon silindi");
    await Promise.all([loadTemplates(), loadAnalyse()]);
  }

  function userLabel(user) {
    return user.displayName || user.authId || `Kullanıcı #${user.id}`;
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';
    const params = new URLSearchParams({ page: usersPage, limit: pageSize });
    const search = $("userSearch").value.trim();
    const premium = $("userPremiumFilter").value;
    if (search) params.set("search", search);
    if (premium) params.set("premium", premium);

    const response = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("usersBody").innerHTML = "";
      $("usersError").hidden = false;
      $("usersError").textContent = apiMessage(data, "Kullanıcı listesi alınamadı.");
      return;
    }

    const users = listFromBody(data);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache = new Map(users.map((user) => [String(user.id), user]));
    setText(
      "usersMeta",
      usersPagination
        ? `${formatNumber(usersPagination.total)} kullanıcı · sayfa ${usersPagination.page}/${usersPagination.totalPages}`
        : `${users.length} kullanıcı`
    );

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const extras = user.extras || {};
            return `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(userLabel(user))}</div>
                <div class="user-cell-sub">${escapeHtml(user.authId || `#${user.id}`)}</div>
              </td>
              <td>${escapeHtml(extras.lang || "—")}</td>
              <td>${extras.isPremium ? '<span class="badge ok">Premium</span>' : "Ücretsiz"}</td>
              <td>${formatNumber(extras.menuCount)}</td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-user-id="${escapeHtml(user.id)}">Detay</button></td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Eşleşen kullanıcı yok</td></tr>';

    $("usersPrevBtn").disabled = usersPage <= 1;
    $("usersNextBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function renderUserDetail(user) {
    const extras = user.extras || {};
    const stats = user.menuStats || {};
    return `
      <div class="user-profile-card user-profile-card--compact">
        <div class="user-cell-title">${escapeHtml(userLabel(user))}</div>
        <div class="user-cell-sub">${escapeHtml(user.authId || `#${user.id}`)}</div>
      </div>
      <div class="stat-grid stat-grid--4" style="margin-top:16px">
        <article class="card stat-card"><div class="stat-label">Menü</div><div class="stat-value">${formatNumber(stats.menuCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">Hazır</div><div class="stat-value">${formatNumber(stats.readyCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">Taslak</div><div class="stat-value">${formatNumber(stats.draftCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">AI</div><div class="stat-value">${formatNumber(stats.aiCount)}</div></article>
      </div>
      <table class="data-table" style="margin-top:16px">
        <tbody>
          <tr><td class="user-cell-sub">Auth ID</td><td>${escapeHtml(user.authId || "—")}</td></tr>
          <tr><td class="user-cell-sub">Dil</td><td>${escapeHtml(extras.lang || "—")}</td></tr>
          <tr><td class="user-cell-sub">Plan</td><td>${escapeHtml(extras.subscriptionPlan || "none")}</td></tr>
          <tr><td class="user-cell-sub">Premium</td><td>${extras.isPremium ? "Evet" : "Hayır"}</td></tr>
          <tr><td class="user-cell-sub">Bildirim</td><td>${extras.notificationsEnabled ? "Açık" : "Kapalı"}</td></tr>
          <tr><td class="user-cell-sub">Son menü</td><td>${formatDateTime(stats.lastMenuAt)}</td></tr>
        </tbody>
      </table>`;
  }

  async function openUser(userId) {
    $("userDetailTitle").textContent = "Kullanıcı detayı";
    $("userDetailBody").innerHTML = '<p class="user-cell-sub">Yükleniyor...</p>';
    $("userDetailDialog").showModal();
    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`);
    const data = await response.json();
    if (!data.ok) {
      $("userDetailBody").innerHTML = `<div class="alert alert-error">${escapeHtml(
        apiMessage(data, "Kullanıcı detayı alınamadı.")
      )}</div>`;
      return;
    }
    selectedUser = data.bodyJson?.data || usersCache.get(String(userId));
    $("userDetailTitle").textContent = userLabel(selectedUser);
    $("userDetailBody").innerHTML = renderUserDetail(selectedUser);
  }

  function openEditUser() {
    if (!canManage || !selectedUser) return;
    $("editUserId").value = selectedUser.id;
    $("editDisplayName").value = selectedUser.displayName || "";
    $("editSubscriptionPlan").value = selectedUser.extras?.subscriptionPlan || "none";
    $("editPremium").checked = Boolean(selectedUser.extras?.isPremium);
    $("editNotifications").checked = Boolean(selectedUser.extras?.notificationsEnabled);
    $("editUserError").hidden = true;
    $("userDetailDialog").close();
    $("editUserDialog").showModal();
  }

  async function loadMenus() {
    $("menusError").hidden = true;
    $("menusBody").innerHTML = '<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>';
    const params = new URLSearchParams({ page: menusPage, limit: pageSize });
    const search = $("menuSearch").value.trim();
    const status = $("menuStatusFilter").value;
    const ai = $("menuAiFilter").value;
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (ai) params.set("ai", ai);

    const response = await fetch(`/api/apps/${appId}/proxy/menus?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("menusBody").innerHTML = "";
      $("menusError").hidden = false;
      $("menusError").textContent = apiMessage(data, "Menü listesi alınamadı.");
      return;
    }

    const rows = listFromBody(data);
    menusPagination = data.bodyJson?.pagination || null;
    menusCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "menusMeta",
      menusPagination
        ? `${formatNumber(menusPagination.total)} menü · sayfa ${menusPagination.page}/${menusPagination.totalPages}`
        : `${rows.length} menü`
    );

    $("menusBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.name || `Menü #${row.id}`)}</div>
                <div class="user-cell-sub">${row.aiGenerated ? "AI üretimi" : "Manuel"} · ${escapeHtml(row.styleVibe || "—")}</div>
              </td>
              <td>${escapeHtml(row.userName || `#${row.userId}`)}</td>
              <td>${escapeHtml(row.templateName || row.templateId || "—")}</td>
              <td><span class="badge">${escapeHtml(row.status || "draft")}</span></td>
              <td>${formatNumber(row.sectionCount)} bölüm · ${formatNumber(row.itemCount)} ürün</td>
              <td class="user-cell-sub">${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-menu-id="${escapeHtml(row.id)}">Detay</button></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="user-cell-sub">Eşleşen menü yok</td></tr>';

    $("menusPrevBtn").disabled = menusPage <= 1;
    $("menusNextBtn").disabled = menusPage >= (menusPagination?.totalPages || 1);
  }

  async function openMenu(menuId) {
    $("menuDetailTitle").textContent = "Menü detayı";
    $("menuDetailBody").innerHTML = '<p class="user-cell-sub">Yükleniyor...</p>';
    $("menuDetailDialog").showModal();
    const response = await fetch(`/api/apps/${appId}/proxy/menus/${encodeURIComponent(menuId)}`);
    const data = await response.json();
    if (!data.ok) {
      $("menuDetailBody").innerHTML = `<div class="alert alert-error">${escapeHtml(
        apiMessage(data, "Menü detayı alınamadı.")
      )}</div>`;
      return;
    }

    const menu = data.bodyJson?.data || menusCache.get(String(menuId));
    const sections = Array.isArray(menu.sections) ? menu.sections : [];
    const templatePreviewUrl = menu.templateCdnUrl || null;
    $("menuDetailTitle").textContent = menu.name || `Menü #${menu.id}`;
    $("menuDetailBody").innerHTML = `
      ${
        templatePreviewUrl
          ? `<div style="margin-bottom:16px;text-align:center">${renderTemplatePreview(templatePreviewUrl, { large: true })}</div>`
          : ""
      }
      <div class="stat-grid stat-grid--4">
        <article class="card stat-card"><div class="stat-label">Durum</div><div class="stat-value">${escapeHtml(menu.status || "—")}</div></article>
        <article class="card stat-card"><div class="stat-label">Bölüm</div><div class="stat-value">${formatNumber(menu.sectionCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">Ürün</div><div class="stat-value">${formatNumber(menu.itemCount)}</div></article>
        <article class="card stat-card"><div class="stat-label">AI</div><div class="stat-value">${menu.aiGenerated ? "Evet" : "Hayır"}</div></article>
      </div>
      <table class="data-table" style="margin-top:16px">
        <tbody>
          <tr><td class="user-cell-sub">Kullanıcı</td><td>${escapeHtml(menu.userName || `#${menu.userId}`)}</td></tr>
          <tr><td class="user-cell-sub">Şablon</td><td>${escapeHtml(menu.templateName || menu.templateId || "—")}</td></tr>
          <tr><td class="user-cell-sub">Stil</td><td>${escapeHtml(menu.styleVibe || "—")}</td></tr>
          <tr><td class="user-cell-sub">CDN</td><td>${menu.cdnUrl ? `<a href="${escapeHtml(menu.cdnUrl)}" target="_blank" rel="noopener">Aç</a>` : "—"}</td></tr>
          <tr><td class="user-cell-sub">Oluşturma</td><td>${formatDateTime(menu.createdAt)}</td></tr>
        </tbody>
      </table>
      <h4 style="margin:18px 0 10px">Bölümler</h4>
      ${
        sections.length
          ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Başlık</th><th>Sıra</th><th>Ürün</th></tr></thead><tbody>${sections
              .map(
                (section) => `<tr>
                  <td>${escapeHtml(section.title || "—")}</td>
                  <td>${formatNumber(section.sortOrder)}</td>
                  <td>${formatNumber(section.itemCount)}</td>
                </tr>`
              )
              .join("")}</tbody></table></div>`
          : '<p class="user-cell-sub">Bölüm yok</p>'
      }`;
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".view-panel").forEach((element) => {
      element.classList.toggle("active", element.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((element) => {
      element.classList.toggle("active", element.dataset.view === view);
    });
    if (view === "templates") loadTemplates();
    if (view === "users") loadUsers();
    if (view === "menus") loadMenus();
    if (view === "analytics") renderAnalytics();
    if (view === "revenuecat") window.RevenueCatPanel?.load?.(appId);
  }

  async function refreshAll() {
    const button = $("refreshBtn");
    button.disabled = true;
    button.textContent = "Yenileniyor...";
    try {
      await Promise.all([
        loadHealth(),
        loadAnalyse(),
        loadOptions(),
        window.RevenueCatPanel?.load?.(appId),
      ]);
      if (currentView === "templates") await loadTemplates();
      if (currentView === "users") await loadUsers();
      if (currentView === "menus") await loadMenus();
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

  $("newTemplateBtn").addEventListener("click", () => openTemplateDialog(null));
  $("closeTemplateDialogBtn").addEventListener("click", () => $("templateDialog").close());
  $("templateForm").addEventListener("submit", saveTemplate);
  $("templateCdnUrl").addEventListener("input", (event) => {
    updateTemplatePreview(event.target.value.trim());
  });
  $("templatePreviewFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      previewBase64 = null;
      return;
    }
    previewBase64 = await fileToBase64(file);
    updateTemplatePreview(previewBase64);
  });
  $("templateSearchBtn").addEventListener("click", () => {
    templatesPage = 1;
    loadTemplates();
  });
  $("templateClearBtn").addEventListener("click", () => {
    $("templateSearch").value = "";
    $("templateTypeFilter").value = "";
    $("templateBrowseFilter").value = "";
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
    if (templatesPage < (templatesPagination?.totalPages || 1)) {
      templatesPage += 1;
      loadTemplates();
    }
  });
  $("templatesBody").addEventListener("click", (event) => {
    const detailBtn = event.target.closest("[data-detail-template]");
    if (detailBtn) {
      openTemplateDetail(detailBtn.dataset.detailTemplate);
      return;
    }
    const editBtn = event.target.closest("[data-edit-template]");
    if (editBtn) {
      const template = templatesCache.get(editBtn.dataset.editTemplate);
      if (template) openTemplateDialog(template);
      return;
    }
    const deleteBtn = event.target.closest("[data-delete-template]");
    if (deleteBtn) deleteTemplate(deleteBtn.dataset.deleteTemplate);
  });
  $("closeTemplateDetailBtn").addEventListener("click", () => $("templateDetailDialog").close());
  $("editTemplateFromDetailBtn").addEventListener("click", () => {
    if (!canManage || !selectedTemplate) return;
    $("templateDetailDialog").close();
    openTemplateDialog(selectedTemplate);
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
    if (usersPage < (usersPagination?.totalPages || 1)) {
      usersPage += 1;
      loadUsers();
    }
  });
  $("usersBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-id]");
    if (button) openUser(button.dataset.userId);
  });
  $("closeUserDetailBtn").addEventListener("click", () => $("userDetailDialog").close());
  $("editUserBtn").addEventListener("click", openEditUser);
  $("closeEditUserBtn").addEventListener("click", () => $("editUserDialog").close());
  $("editUserForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("editUserError").hidden = true;
    try {
      const response = await fetch(
        `/api/apps/${appId}/proxy/users/${encodeURIComponent($("editUserId").value)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: $("editDisplayName").value.trim() || null,
            isPremium: $("editPremium").checked,
            notificationsEnabled: $("editNotifications").checked,
            subscriptionPlan: $("editSubscriptionPlan").value,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("editUserError").hidden = false;
        $("editUserError").textContent = apiMessage(data, "Kullanıcı güncellenemedi.");
        return;
      }
      $("editUserDialog").close();
      selectedUser = null;
      showToast("Kullanıcı güncellendi");
      await Promise.all([loadUsers(), loadAnalyse()]);
    } finally {
      button.disabled = false;
    }
  });

  $("menuSearchBtn").addEventListener("click", () => {
    menusPage = 1;
    loadMenus();
  });
  $("menuClearBtn").addEventListener("click", () => {
    $("menuSearch").value = "";
    $("menuStatusFilter").value = "";
    $("menuAiFilter").value = "";
    menusPage = 1;
    loadMenus();
  });
  $("menusPrevBtn").addEventListener("click", () => {
    if (menusPage > 1) {
      menusPage -= 1;
      loadMenus();
    }
  });
  $("menusNextBtn").addEventListener("click", () => {
    if (menusPage < (menusPagination?.totalPages || 1)) {
      menusPage += 1;
      loadMenus();
    }
  });
  $("menusBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-id]");
    if (button) openMenu(button.dataset.menuId);
  });
  $("closeMenuDetailBtn").addEventListener("click", () => $("menuDetailDialog").close());

  (async function init() {
    const session = await window.PanelAuth.fetchSession();
    if (!session) return;
    canManage = window.PanelAuth.isManager(session);
    applyRoleUi();
    try {
      await loadAppMeta();
      await Promise.all([
        loadHealth(),
        loadAnalyse(),
        loadOptions(),
        window.RevenueCatPanel?.load?.(appId),
      ]);
    } catch {
      setHealth(false, "Yükleme hatası");
    }
  })();

  window.MenuMaPanel = {
    openUserById(userId) {
      switchView("users");
      openUser(String(userId));
    },
  };
})();
