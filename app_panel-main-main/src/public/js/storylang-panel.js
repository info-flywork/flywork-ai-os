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
    const body = data?.bodyJson;
    if (Array.isArray(body)) return body;
    const obj = body && typeof body === "object" ? body : {};
    const list = obj.data ?? obj.users ?? obj.items ?? obj.stories ?? [];
    return Array.isArray(list) ? list : [];
  }

  function formatTagSlugs(value) {
    if (!value) return "";
    const tags = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
    return tags.length ? tags.join(", ") : "";
  }

  async function fetchProxy(path, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 30000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { ...options, signal: controller.signal });
      const data = await response.json();
      return { response, data };
    } finally {
      clearTimeout(timer);
    }
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
    const name = app.appName || "Lingola Stories";
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
      "statReadyStories",
      "statNewUsersToday",
      "statStoriesToday",
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
      renderInsightCard("Hikaye seviyeleri", "CEFR dağılımı", insights.storyLevels),
      renderInsightCard("Hikaye durumları", "ready / draft / processing", insights.storyStatuses),
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
    setText("statReadyStories", formatNumber(summary.readyStories));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("statStoriesToday", formatNumber(summary.storiesToday));
    setText("statTotalCompletions", formatNumber(summary.totalCompletions));
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
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(row.email || extras.deviceId || "—")}</div>
              </td>
              <td>${escapeHtml(extras.currentLevel || "—")}</td>
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${formatNumber(extras.completionCount)} / ${formatNumber(extras.progressCount)}</td>
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
      body: JSON.stringify({ isPremium: $("userIsPremium").checked }),
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

  async function loadStories() {
    $("storiesError").hidden = true;
    setText("storiesMeta", "Liste yükleniyor...");
    try {
      const params = new URLSearchParams({ page: String(storiesPage), limit: String(pageSize) });
      const search = $("storySearch")?.value?.trim() || "";
      const status = $("storyStatusFilter")?.value || "";
      const level = $("storyLevelFilter")?.value || "";
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (level) params.set("level", level);

      const { response, data } = await fetchProxy(`/api/apps/${appId}/proxy/stories?${params}`);
      const body = data?.bodyJson;
      const bodyObject = body && typeof body === "object" && !Array.isArray(body) ? body : {};

      if (!response.ok || !data.ok || bodyObject.ok === false) {
        $("storiesError").hidden = false;
        $("storiesError").textContent = apiMessage(
          data,
          bodyObject.error || data.error || "Hikayeler alınamadı. Backend çalışıyor mu ve API URL /panel/v1 ile bitiyor mu kontrol edin."
        );
        $("storiesBody").innerHTML = "";
        setText("storiesMeta", "Liste yüklenemedi");
        return;
      }

      const rows = listFromBody(data);
      storiesPagination = bodyObject.pagination || null;
      storiesCache = new Map(rows.map((row) => [String(row.id), row]));
      setText(
        "storiesMeta",
        storiesPagination
          ? `Sayfa ${storiesPagination.page}/${storiesPagination.totalPages} · ${formatNumber(storiesPagination.total)} hikaye`
          : `${formatNumber(rows.length)} hikaye`
      );

      $("storiesBody").innerHTML = rows.length
        ? rows
            .map((row) => {
              const tags = formatTagSlugs(row.tagSlugs);
              return `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(row.title || row.id)}</div>
                <div class="user-cell-sub">#${escapeHtml(row.id)}${tags ? ` · ${escapeHtml(tags)}` : ""}</div>
              </td>
              <td>${escapeHtml(row.level || "—")}</td>
              <td>${escapeHtml(row.status || "—")}</td>
              <td>${formatNumber(row.totalWords)}</td>
              <td>${row.ratingCount ? `${Number(row.averageRating || 0).toFixed(1)} (${row.ratingCount})` : "—"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-story-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-story-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`;
            })
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
          loadAnalyse();
        });
      });

      $("storiesPrevBtn").disabled = !storiesPagination || storiesPagination.page <= 1;
      $("storiesNextBtn").disabled =
        !storiesPagination || storiesPagination.page >= storiesPagination.totalPages;
    } catch (error) {
      $("storiesError").hidden = false;
      const message =
        error?.name === "AbortError"
          ? "İstek zaman aşımına uğradı. lingola-stories-backend (port 3039) çalışıyor mu?"
          : error?.message || "Hikayeler alınamadı.";
      $("storiesError").textContent = message;
      $("storiesBody").innerHTML = "";
      setText("storiesMeta", "Liste yüklenemedi");
    }
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
    const enLoc =
      row?.localizations?.find((loc) => loc.lang === "en") || row?.localizations?.[0] || {};
    $("storyTitle").value = enLoc.title || row?.title || "";
    $("storySummary").value = enLoc.summary || row?.summary || "";
    $("storyText").value = enLoc.text || "";
    $("storyLevel").value = row?.level || "A1";
    $("storyStatus").value = row?.status || "ready";
    $("storyTotalWords").value = row?.totalWords ?? "";
    $("storyLang").value = enLoc.lang || "en";
    $("storyCoverUrl").value = row?.coverUrl || "";
    $("storyTags").value = Array.isArray(row?.tagSlugs)
      ? row.tagSlugs.join(", ")
      : (row?.tags || []).map((t) => t.tag?.slug).filter(Boolean).join(", ");
    $("storyFormError").hidden = true;
    $("storyDialog").showModal();
  }

  async function saveStory(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("storyEditId").value;
    const payload = {
      title: $("storyTitle").value.trim(),
      summary: $("storySummary").value.trim(),
      text: $("storyText").value.trim(),
      level: $("storyLevel").value,
      status: $("storyStatus").value,
      totalWords: Number($("storyTotalWords").value) || 0,
      lang: $("storyLang").value,
      coverUrl: $("storyCoverUrl").value.trim(),
      tagSlugs: $("storyTags").value
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
    $("storySearchBtn")?.addEventListener("click", () => {
      storiesPage = 1;
      loadStories();
    });
    $("storyClearBtn")?.addEventListener("click", () => {
      $("storySearch").value = "";
      $("storyStatusFilter").value = "";
      $("storyLevelFilter").value = "";
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
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "stories") await loadStories();
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
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
    } catch (error) {
      showToast(error.message || "Panel yüklenemedi.");
    }
  })();
})();
