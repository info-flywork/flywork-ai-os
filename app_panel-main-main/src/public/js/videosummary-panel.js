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
  let selectedSummaryId = null;

  let usersPage = 1;
  let usersPagination = null;
  let usersCache = new Map();

  let summariesPage = 1;
  let summariesPagination = null;

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
    if (view === "summaries") loadSummaries();
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
    const name = app.appName || "VideoSummary";
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
    ["statTotalUsers", "statActiveUsers", "statTotalSummaries", "statSummariesToday", "statNewUsersToday"].forEach(
      (id) => $(id)?.classList.toggle("loading", loading)
    );
  }

  function renderDaily(rows) {
    $("dailyBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(String(row.date || "").slice(0, 10) || "—")}</td>
              <td><strong>${formatNumber(row.summaries)}</strong></td>
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
      renderInsightCard("Platformlar", "YouTube / TikTok / Instagram", insights.platforms),
      renderInsightCard("Auth sağlayıcıları", "guest / google / apple", insights.authProviders),
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
    setText("statActiveUsers", formatNumber(summary.activeUsers));
    setText("statTotalSummaries", formatNumber(summary.totalSummaries));
    setText("statSummariesToday", formatNumber(summary.summariesToday));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("analyseHint", `TZ: ${analyseData.timezone || "Europe/Istanbul"}`);
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    const search = $("userSearch").value.trim();
    const status = $("userStatusFilter").value;
    if (search) params.set("search", search);
    if (status) params.set("status", status);

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
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(extras.uid || row.authId || "—")}</div>
              </td>
              <td>${escapeHtml(extras.authProvider || "—")}</td>
              <td>${row.status === "inactive" ? "Pasif" : "Aktif"}</td>
              <td>${formatNumber(extras.summaryCount)}</td>
              <td>${formatDateTime(row.lastLoginAt)}</td>
              <td><button type="button" class="btn btn-sm" data-user-id="${escapeHtml(row.id)}">Detay</button></td>
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

  async function openUserDialog(userId) {
    const cached = usersCache.get(String(userId));
    $("userFormError").hidden = true;
    $("userEditId").value = userId;
    $("userDisplayName").value = cached?.displayName || "";
    $("userEmail").value = cached?.email || "";
    $("userIsActive").checked = cached?.status !== "inactive";
    $("userDetailMeta").textContent = "Detay yükleniyor...";
    $("userSummariesMeta").textContent = "Yükleniyor...";
    $("userSummariesBody").innerHTML =
      '<tr><td colspan="4" class="user-cell-sub">Yükleniyor...</td></tr>';
    $("userDialog").showModal();

    try {
      const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`);
      const data = await response.json();
      if (!data.ok) {
        $("userFormError").hidden = false;
        $("userFormError").textContent = apiMessage(data, "Kullanıcı detayı alınamadı.");
        $("userSummariesMeta").textContent = "Liste alınamadı";
        $("userSummariesBody").innerHTML =
          '<tr><td colspan="4" class="user-cell-sub">Özetler yüklenemedi</td></tr>';
        return;
      }

      const user = data.bodyJson?.data || data.bodyJson?.user || {};
      const extras = user.extras || {};
      $("userEditId").value = user.id || userId;
      $("userDisplayName").value = user.displayName || "";
      $("userEmail").value = user.email || "";
      $("userIsActive").checked = user.status !== "inactive";
      $("userDetailMeta").textContent = [
        `#${user.id || userId}`,
        extras.uid || user.authId || null,
        extras.authProvider || null,
        extras.summaryCount != null ? `${formatNumber(extras.summaryCount)} özet` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const summaries = Array.isArray(user.recentSummaries)
        ? user.recentSummaries
        : Array.isArray(user.summaries)
          ? user.summaries
          : [];
      $("userSummariesMeta").textContent = summaries.length
        ? `Son ${formatNumber(summaries.length)} kayıt (en yeni önce)`
        : "Bu kullanıcının gönderdiği video özeti yok";
      $("userSummariesBody").innerHTML = summaries.length
        ? summaries
            .map((row) => {
              const title = row.title || row.videoId || `Özet #${row.id}`;
              const urlPreview = (row.sourceUrl || "").slice(0, 70);
              return `<tr>
                <td>
                  <div class="user-cell-title">${escapeHtml(title)}</div>
                  <div class="user-cell-sub">${escapeHtml(urlPreview || row.channelName || "—")}</div>
                  ${
                    row.summaryText
                      ? `<div class="user-cell-sub" style="margin-top:4px">${escapeHtml(
                          String(row.summaryText).slice(0, 140)
                        )}</div>`
                      : ""
                  }
                </td>
                <td>${escapeHtml(row.platform || "—")}</td>
                <td>${formatDateTime(row.createdAt)}</td>
                <td><button type="button" class="btn btn-sm" data-user-summary-id="${escapeHtml(
                  row.id
                )}">Aç</button></td>
              </tr>`;
            })
            .join("")
        : '<tr><td colspan="4" class="user-cell-sub">Henüz video göndermemiş</td></tr>';

      $("userSummariesBody").querySelectorAll("[data-user-summary-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          openSummaryDetail(btn.getAttribute("data-user-summary-id"));
        });
      });
    } catch {
      $("userFormError").hidden = false;
      $("userFormError").textContent = "Kullanıcı detayı alınamadı.";
      $("userSummariesMeta").textContent = "Liste alınamadı";
      $("userSummariesBody").innerHTML =
        '<tr><td colspan="4" class="user-cell-sub">Özetler yüklenemedi</td></tr>';
    }
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
        email: $("userEmail").value.trim(),
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

  async function loadSummaries() {
    $("summariesError").hidden = true;
    const params = new URLSearchParams({
      page: String(summariesPage),
      limit: String(pageSize),
    });
    const search = $("summarySearch").value.trim();
    const platform = $("summaryPlatformFilter").value;
    if (search) params.set("search", search);
    if (platform) params.set("platform", platform);

    const response = await fetch(`/api/apps/${appId}/proxy/summaries?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("summariesError").hidden = false;
      $("summariesError").textContent = apiMessage(data, "Özetler alınamadı.");
      $("summariesBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    summariesPagination = data.bodyJson?.pagination || null;
    setText(
      "summariesMeta",
      summariesPagination
        ? `Sayfa ${summariesPagination.page}/${summariesPagination.totalPages} · ${formatNumber(summariesPagination.total)} özet`
        : `${formatNumber(rows.length)} özet`
    );

    $("summariesBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const title = row.title || row.videoId || `Özet #${row.id}`;
            const sub = [
              row.channelName || null,
              row.videoId ? `id:${row.videoId}` : null,
              (row.sourceUrl || "").slice(0, 70) || null,
            ]
              .filter(Boolean)
              .join(" · ");
            const preview = row.summaryText
              ? `<div class="user-cell-sub" style="margin-top:4px">${escapeHtml(
                  String(row.summaryText).slice(0, 160)
                )}</div>`
              : '<div class="user-cell-sub" style="margin-top:4px">Özet metni yok / payload boş</div>';
            return `<tr>
              <td>
                <div class="user-cell-title">${escapeHtml(title)}</div>
                <div class="user-cell-sub">${escapeHtml(sub || "—")}</div>
                ${preview}
              </td>
              <td>${escapeHtml(row.userName || row.userUid || "—")}</td>
              <td>${escapeHtml(row.platform || "—")}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-summary-id="${escapeHtml(row.id)}">Detay</button></td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Özet yok</td></tr>';

    $("summariesBody").querySelectorAll("[data-summary-id]").forEach((btn) => {
      btn.addEventListener("click", () => openSummaryDetail(btn.getAttribute("data-summary-id")));
    });
    $("summariesPrevBtn").disabled = !summariesPagination || summariesPagination.page <= 1;
    $("summariesNextBtn").disabled =
      !summariesPagination || summariesPagination.page >= summariesPagination.totalPages;
  }

  async function openSummaryDetail(summaryId) {
    selectedSummaryId = summaryId;
    const response = await fetch(
      `/api/apps/${appId}/proxy/summaries/${encodeURIComponent(summaryId)}`
    );
    const data = await response.json();
    if (!data.ok) {
      showToast(apiMessage(data, "Özet detayı alınamadı."));
      return;
    }
    const item = data.bodyJson?.data || {};
    $("summaryDetailBody").innerHTML = `
      <p><strong>Başlık:</strong> ${escapeHtml(item.title || "—")}</p>
      <p><strong>Platform:</strong> ${escapeHtml(item.platform || "—")}</p>
      <p><strong>Kanal:</strong> ${escapeHtml(item.channelName || "—")}</p>
      <p><strong>Dil:</strong> ${escapeHtml(item.language || "—")}</p>
      <p><strong>Video ID:</strong> ${escapeHtml(item.videoId || "—")}</p>
      <p><strong>Kullanıcı:</strong> ${escapeHtml(item.userName || item.userUid || "—")}</p>
      <p><strong>Kaynak:</strong> ${
        item.sourceUrl
          ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceUrl)}</a>`
          : "—"
      }</p>
      <p><strong>CDN:</strong> ${
        item.cdnUrl
          ? `<a href="${escapeHtml(item.cdnUrl)}" target="_blank" rel="noopener">Aç</a>`
          : "—"
      }</p>
      <p><strong>Tarih:</strong> ${formatDateTime(item.createdAt)}</p>
      ${
        item.summaryText
          ? `<p><strong>Özet:</strong></p><pre style="white-space:pre-wrap;max-height:160px;overflow:auto;font-size:12px">${escapeHtml(
              item.summaryText
            )}</pre>`
          : ""
      }
      <p><strong>Ham payload:</strong></p>
      <pre style="white-space:pre-wrap;max-height:240px;overflow:auto;font-size:12px">${escapeHtml(
        JSON.stringify(item.payload || {}, null, 2)
      )}</pre>
    `;
    $("summaryDialog").showModal();
  }

  async function deleteSelectedSummary() {
    if (!canManage || !selectedSummaryId) return;
    if (!window.confirm("Bu özeti silmek istediğinize emin misiniz?")) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/summaries/${encodeURIComponent(selectedSummaryId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (!data.ok) {
      showToast(apiMessage(data, "Özet silinemedi."));
      return;
    }
    $("summaryDialog").close();
    showToast("Özet silindi.");
    loadSummaries();
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
      $("userStatusFilter").value = "";
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

    $("summarySearchBtn").addEventListener("click", () => {
      summariesPage = 1;
      loadSummaries();
    });
    $("summaryClearBtn").addEventListener("click", () => {
      $("summarySearch").value = "";
      $("summaryPlatformFilter").value = "";
      summariesPage = 1;
      loadSummaries();
    });
    $("summariesPrevBtn").addEventListener("click", () => {
      if (summariesPage > 1) {
        summariesPage -= 1;
        loadSummaries();
      }
    });
    $("summariesNextBtn").addEventListener("click", () => {
      summariesPage += 1;
      loadSummaries();
    });
    $("summaryCloseBtn").addEventListener("click", () => $("summaryDialog").close());
    $("summaryDeleteBtn").addEventListener("click", deleteSelectedSummary);
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "summaries") await loadSummaries();
    if (currentView === "analytics") renderAnalytics();
  }

  window.VideoSummaryPanel = {
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
