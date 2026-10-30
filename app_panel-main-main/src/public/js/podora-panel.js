(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) return;

  const $ = (id) => document.getElementById(id);
  const pageSize = 20;
  let canManage = false;
  let currentView = "overview";
  let analyseData = null;

  let usersPage = 1, podcastsPage = 1, episodesPage = 1, livePage = 1;
  let usersPagination = null, podcastsPagination = null, episodesPagination = null, livePagination = null;
  let usersCache = new Map(), podcastsCache = new Map();

  const escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const formatNumber = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : new Intl.NumberFormat("tr-TR").format(Number(v)));
  const formatDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  const listFromBody = (d) => {
    const body = d?.bodyJson || {};
    const list = body.data ?? body.users ?? body.items ?? [];
    return Array.isArray(list) ? list : [];
  };
  const apiMessage = (d, f) => d?.bodyJson?.error || d?.bodyJson?.message || d?.error || f;

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  function setHealth(ok, text) {
    const badge = $("healthBadge");
    badge.className = `badge ${ok ? "ok" : "fail"}`;
    badge.innerHTML = `<span class="badge-dot"></span>${escapeHtml(text)}`;
  }

  function renderInsightCard(title, items) {
    const rows = Array.isArray(items) ? items : [];
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3>
      ${rows.length ? rows.map((row) => `<div class="insight-bar-row"><span class="insight-bar-label">${escapeHtml(row.label || "—")}</span><span class="insight-bar-meta">${formatNumber(row.count)}</span></div>`).join("") : '<p class="user-cell-sub">Veri yok</p>'}
    </article>`;
  }

  function renderAnalytics() {
    const insights = analyseData?.insights;
    if (!insights) return ($("analyticsGrid").innerHTML = '<p class="user-cell-sub">Analiz verisi yok</p>');
    $("analyticsGrid").innerHTML = [
      renderInsightCard("Podcast statüleri", insights.podcastStatuses),
      renderInsightCard("Podcast kategorileri", insights.podcastCategories),
    ].join("");
  }

  function applyRoleUi() {
    $("viewerBanner").hidden = canManage;
    document.querySelectorAll("[data-manager-only]").forEach((el) => {
      el.hidden = !canManage;
      el.style.display = canManage ? "" : "none";
    });
  }

  async function loadAppMeta() {
    const res = await fetch(`/api/apps/${appId}`);
    if (res.status === 401) return (window.location.href = "/login.html");
    const data = await res.json();
    if (!res.ok) return;
    const app = data.app || {};
    $("appTitle").textContent = app.appName || "Podora";
    $("sidebarAppName").textContent = app.appName || "Podora";
    $("breadcrumbName").textContent = app.appName || "Podora";
    $("apiInfo").textContent = app.apiBaseUrl || "API URL tanımlı değil";
    if (app.iconUrl) {
      $("headerAppIcon").src = app.iconUrl;
      $("headerAppIcon").hidden = false;
      $("headerAppIconFallback").hidden = true;
    }
  }

  async function loadHealth() {
    try {
      const res = await fetch(`/api/apps/${appId}/proxy/health`);
      const data = await res.json();
      setHealth(Boolean(data.ok), data.ok ? "API bağlı" : "API erişilemiyor");
    } catch {
      setHealth(false, "API erişilemiyor");
    }
  }

  async function loadAnalyse() {
    const res = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await res.json();
    if (!data.ok) {
      $("analyseError").hidden = false;
      $("analyseError").textContent = apiMessage(data, "Analiz verisi alınamadı.");
      return;
    }
    analyseData = data.bodyJson || {};
    const s = analyseData.summary || {};
    $("statTotalUsers").textContent = formatNumber(s.totalUsers);
    $("statAdminUsers").textContent = formatNumber(s.adminUsers);
    $("statProUsers").textContent = formatNumber(s.proUsers);
    $("statTotalPodcasts").textContent = formatNumber(s.totalPodcasts);
    $("statReadyPodcasts").textContent = formatNumber(s.readyPodcasts);
    $("statTotalEpisodes").textContent = formatNumber(s.totalEpisodes);
    $("statLiveSessions").textContent = formatNumber(s.liveSessions);
    $("statNewUsersToday").textContent = formatNumber(s.newUsersToday);
    $("analyseHint").textContent = `Bugün yeni podcast: ${formatNumber(s.newPodcastsToday)}`;

    const daily = Array.isArray(analyseData.daily) ? analyseData.daily : [];
    $("dailyBody").innerHTML = daily.length
      ? daily.map((row) => `<tr><td>${escapeHtml(String(row.date || "").slice(0, 10))}</td><td>${formatNumber(row.newUsers)}</td></tr>`).join("")
      : '<tr><td colspan="2" class="user-cell-sub">Veri yok</td></tr>';
    renderAnalytics();
  }

  async function loadUsers() {
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    if ($("userSearch").value.trim()) params.set("search", $("userSearch").value.trim());
    if ($("userStatusFilter").value) params.set("status", $("userStatusFilter").value);
    if ($("userRoleFilter").value) params.set("role", $("userRoleFilter").value);

    const res = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache = new Map(rows.map((row) => [String(row.id), row]));
    $("usersMeta").textContent = usersPagination
      ? `Sayfa ${usersPagination.page}/${usersPagination.totalPages} · ${formatNumber(usersPagination.total)} kullanıcı`
      : `${formatNumber(rows.length)} kullanıcı`;
    $("usersBody").innerHTML = rows.length
      ? rows.map((row) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(`${row.first_name || ""} ${row.last_name || ""}`.trim() || `#${row.id}`)}</div><div class="user-cell-sub">${escapeHtml(row.email || row.phone || "—")}</div></td>
          <td>${escapeHtml(row.status || "—")}</td>
          <td>${escapeHtml(row.role || "user")}</td>
          <td>${row.is_pro ? '<span class="badge ok">Pro</span>' : "Free"}</td>
          <td>${formatNumber(row.podcast_count || 0)}</td>
          <td><button type="button" class="btn btn-sm" data-user-edit="${escapeHtml(row.id)}" ${canManage ? "" : "hidden"}>Düzenle</button></td>
        </tr>`).join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kullanıcı yok</td></tr>';

    $("usersBody").querySelectorAll("[data-user-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openUserDialog(btn.getAttribute("data-user-edit")));
    });
  }

  function openUserDialog(userId) {
    const user = usersCache.get(String(userId));
    if (!user) return;
    $("userEditId").value = user.id;
    $("userEditStatus").value = user.status || "active";
    $("userEditRole").value = user.role || "user";
    $("userEditLanguage").value = user.language || "tr";
    $("userEditIsPro").checked = Boolean(user.is_pro);
    $("userDialog").showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    const id = $("userEditId").value;
    const payload = {
      status: $("userEditStatus").value,
      role: $("userEditRole").value,
      language: $("userEditLanguage").value.trim() || "tr",
      isPro: $("userEditIsPro").checked,
    };
    const res = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) return showToast(apiMessage(data, "Kullanıcı güncellenemedi."));
    $("userDialog").close();
    showToast("Kullanıcı güncellendi.");
    loadUsers();
    loadAnalyse();
  }

  async function loadPodcasts() {
    const params = new URLSearchParams({ page: String(podcastsPage), limit: String(pageSize) });
    if ($("podcastSearch").value.trim()) params.set("search", $("podcastSearch").value.trim());
    if ($("podcastStatusFilter").value) params.set("status", $("podcastStatusFilter").value);
    const res = await fetch(`/api/apps/${appId}/proxy/podcasts?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    podcastsPagination = data.bodyJson?.pagination || null;
    podcastsCache = new Map(rows.map((row) => [String(row.id), row]));
    $("podcastsMeta").textContent = podcastsPagination
      ? `Sayfa ${podcastsPagination.page}/${podcastsPagination.totalPages} · ${formatNumber(podcastsPagination.total)} podcast`
      : `${formatNumber(rows.length)} podcast`;
    $("podcastsBody").innerHTML = rows.length
      ? rows.map((row) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(row.title || `#${row.id}`)}</div><div class="user-cell-sub">${escapeHtml(row.description || "—")}</div></td>
          <td>${escapeHtml(`${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email || "—")}</td>
          <td>${escapeHtml(row.category || "—")}</td>
          <td>${escapeHtml(row.status || "—")}</td>
          <td>
            <button type="button" class="btn btn-sm" data-podcast-edit="${escapeHtml(row.id)}" ${canManage ? "" : "hidden"}>Düzenle</button>
            <button type="button" class="btn btn-sm btn-danger" data-podcast-del="${escapeHtml(row.id)}" ${canManage ? "" : "hidden"}>Sil</button>
          </td>
        </tr>`).join("")
      : '<tr><td colspan="5" class="user-cell-sub">Podcast yok</td></tr>';

    $("podcastsBody").querySelectorAll("[data-podcast-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openPodcastDialog(btn.getAttribute("data-podcast-edit")));
    });
    $("podcastsBody").querySelectorAll("[data-podcast-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Podcast silinsin mi?")) return;
        const del = await fetch(`/api/apps/${appId}/proxy/podcasts/${encodeURIComponent(btn.getAttribute("data-podcast-del"))}`, { method: "DELETE" });
        const delData = await del.json();
        if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
        showToast("Podcast silindi.");
        loadPodcasts();
        loadAnalyse();
      });
    });
  }

  function openPodcastDialog(id) {
    const row = podcastsCache.get(String(id));
    if (!row) return;
    $("podcastEditId").value = row.id;
    $("podcastEditTitle").value = row.title || "";
    $("podcastEditDescription").value = row.description || "";
    $("podcastEditCategory").value = row.category || "";
    $("podcastEditStatus").value = row.status || "processing";
    $("podcastEditVoiceId").value = row.voice_id || "aria";
    $("podcastDialog").showModal();
  }

  async function savePodcast(event) {
    event.preventDefault();
    const id = $("podcastEditId").value;
    const payload = {
      title: $("podcastEditTitle").value.trim(),
      description: $("podcastEditDescription").value.trim() || null,
      category: $("podcastEditCategory").value.trim() || "diger",
      status: $("podcastEditStatus").value,
      voiceId: $("podcastEditVoiceId").value.trim() || "aria",
    };
    const res = await fetch(`/api/apps/${appId}/proxy/podcasts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) return showToast(apiMessage(data, "Podcast güncellenemedi."));
    $("podcastDialog").close();
    showToast("Podcast güncellendi.");
    loadPodcasts();
    loadAnalyse();
  }

  async function loadEpisodes() {
    const params = new URLSearchParams({ page: String(episodesPage), limit: String(pageSize) });
    if ($("episodeSearch").value.trim()) params.set("search", $("episodeSearch").value.trim());
    if ($("episodeStatusFilter").value) params.set("status", $("episodeStatusFilter").value);
    const res = await fetch(`/api/apps/${appId}/proxy/episodes?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    episodesPagination = data.bodyJson?.pagination || null;
    $("episodesMeta").textContent = episodesPagination
      ? `Sayfa ${episodesPagination.page}/${episodesPagination.totalPages} · ${formatNumber(episodesPagination.total)} bölüm`
      : `${formatNumber(rows.length)} bölüm`;
    $("episodesBody").innerHTML = rows.length
      ? rows.map((row) => `<tr><td>${escapeHtml(row.title || `#${row.id}`)}</td><td>${escapeHtml(row.podcast_title || `#${row.podcast_id}`)}</td><td>${escapeHtml(row.status || "—")}</td><td>${row.duration_seconds ? `${formatNumber(row.duration_seconds)} sn` : "—"}</td><td>${formatDateTime(row.created_at)}</td></tr>`).join("")
      : '<tr><td colspan="5" class="user-cell-sub">Bölüm yok</td></tr>';
  }

  async function loadLiveSessions() {
    const params = new URLSearchParams({ page: String(livePage), limit: String(pageSize) });
    if ($("liveSearch").value.trim()) params.set("search", $("liveSearch").value.trim());
    if ($("liveStatusFilter").value) params.set("status", $("liveStatusFilter").value);
    const res = await fetch(`/api/apps/${appId}/proxy/live-sessions?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    livePagination = data.bodyJson?.pagination || null;
    $("liveMeta").textContent = livePagination
      ? `Sayfa ${livePagination.page}/${livePagination.totalPages} · ${formatNumber(livePagination.total)} oturum`
      : `${formatNumber(rows.length)} oturum`;
    $("liveBody").innerHTML = rows.length
      ? rows.map((row) => `<tr><td>${escapeHtml(row.title || `#${row.id}`)}</td><td>${escapeHtml(row.podcast_title || `#${row.podcast_id}`)}</td><td>${escapeHtml(`${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email || "—")}</td><td>${escapeHtml(row.status || "—")}</td><td>${formatDateTime(row.started_at || row.scheduled_at || row.created_at)}</td></tr>`).join("")
      : '<tr><td colspan="5" class="user-cell-sub">Oturum yok</td></tr>';
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
    document.querySelectorAll(".view-panel").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
    if (view === "users") loadUsers();
    if (view === "podcasts") loadPodcasts();
    if (view === "episodes") loadEpisodes();
    if (view === "livesessions") loadLiveSessions();
    if (view === "analytics") renderAnalytics();
    if (view === "revenuecat") window.RevenueCatPanel?.load?.(appId);
  }

  async function refreshAll() {
    const btn = $("refreshBtn");
    btn.disabled = true;
    btn.textContent = "Yenileniyor...";
    try {
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
      if (currentView === "users") await loadUsers();
      if (currentView === "podcasts") await loadPodcasts();
      if (currentView === "episodes") await loadEpisodes();
      if (currentView === "livesessions") await loadLiveSessions();
    } finally {
      btn.disabled = false;
      btn.textContent = "Yenile";
    }
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $("refreshBtn").addEventListener("click", () => refreshAll().catch(() => {}));
  $("settingsBtn").addEventListener("click", () => canManage && (window.location.href = `/apps/${appId}/edit`));
  $("userSearchBtn").addEventListener("click", () => { usersPage = 1; loadUsers(); });
  $("userClearBtn").addEventListener("click", () => { $("userSearch").value = ""; $("userStatusFilter").value = ""; $("userRoleFilter").value = ""; usersPage = 1; loadUsers(); });
  $("usersPrevBtn").addEventListener("click", () => { if (usersPage > 1) { usersPage -= 1; loadUsers(); } });
  $("usersNextBtn").addEventListener("click", () => { usersPage += 1; loadUsers(); });
  $("podcastSearchBtn").addEventListener("click", () => { podcastsPage = 1; loadPodcasts(); });
  $("podcastClearBtn").addEventListener("click", () => { $("podcastSearch").value = ""; $("podcastStatusFilter").value = ""; podcastsPage = 1; loadPodcasts(); });
  $("podcastsPrevBtn").addEventListener("click", () => { if (podcastsPage > 1) { podcastsPage -= 1; loadPodcasts(); } });
  $("podcastsNextBtn").addEventListener("click", () => { podcastsPage += 1; loadPodcasts(); });
  $("episodeSearchBtn").addEventListener("click", () => { episodesPage = 1; loadEpisodes(); });
  $("episodeClearBtn").addEventListener("click", () => { $("episodeSearch").value = ""; $("episodeStatusFilter").value = ""; episodesPage = 1; loadEpisodes(); });
  $("episodesPrevBtn").addEventListener("click", () => { if (episodesPage > 1) { episodesPage -= 1; loadEpisodes(); } });
  $("episodesNextBtn").addEventListener("click", () => { episodesPage += 1; loadEpisodes(); });
  $("liveSearchBtn").addEventListener("click", () => { livePage = 1; loadLiveSessions(); });
  $("liveClearBtn").addEventListener("click", () => { $("liveSearch").value = ""; $("liveStatusFilter").value = ""; livePage = 1; loadLiveSessions(); });
  $("livePrevBtn").addEventListener("click", () => { if (livePage > 1) { livePage -= 1; loadLiveSessions(); } });
  $("liveNextBtn").addEventListener("click", () => { livePage += 1; loadLiveSessions(); });
  $("userForm").addEventListener("submit", saveUser);
  $("userCancelBtn").addEventListener("click", () => $("userDialog").close());
  $("podcastForm").addEventListener("submit", savePodcast);
  $("podcastCancelBtn").addEventListener("click", () => $("podcastDialog").close());

  (async function init() {
    const session = await window.PanelAuth.fetchSession();
    if (!session) return;
    canManage = window.PanelAuth.isManager(session);
    applyRoleUi();
    await loadAppMeta();
    await refreshAll();
  })().catch(() => setHealth(false, "Yükleme hatası"));
})();
