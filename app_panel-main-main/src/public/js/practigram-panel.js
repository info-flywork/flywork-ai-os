(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) return;
  const $ = (id) => document.getElementById(id);
  const pageSize = 20;
  let canManage = false;
  let currentView = "overview";
  let usersPage = 1, wordsPage = 1, sessionsPage = 1, chipsPage = 1;
  let usersCache = new Map(), wordsCache = new Map();
  let usersPagination = null, wordsPagination = null, sessionsPagination = null, chipsPagination = null;

  const escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const formatNumber = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : new Intl.NumberFormat("tr-TR").format(Number(v)));
  const formatDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  const apiMessage = (d, f) => d?.bodyJson?.error || d?.bodyJson?.message || d?.error || f;
  const listFromBody = (d) => {
    const b = d?.bodyJson || {};
    const l = b.data ?? b.users ?? b.items ?? [];
    return Array.isArray(l) ? l : [];
  };

  function setHealth(ok, text) {
    const badge = $("healthBadge");
    if (!badge) return;
    badge.className = `badge ${ok ? "ok" : "fail"}`;
    badge.innerHTML = `<span class="badge-dot"></span>${escapeHtml(text)}`;
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
    $("appTitle").textContent = app.appName || "Practigram";
    $("sidebarAppName").textContent = app.appName || "Practigram";
    $("breadcrumbName").textContent = app.appName || "Practigram";
    if (app.iconUrl) {
      $("headerAppIcon").src = app.iconUrl;
      $("headerAppIcon").hidden = false;
      $("headerAppIconFallback").hidden = true;
    }
    $("apiInfo").textContent = app.apiBaseUrl || "API URL tanımlı değil";
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

  async function loadOptions() {
    try {
      const res = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await res.json();
      if (!data.ok) return;
      const opts = data.bodyJson?.data || {};
      const langs = Array.isArray(opts.languages) ? opts.languages : [];
      const difficulties = Array.isArray(opts.difficulties) ? opts.difficulties : [];
      const categories = Array.isArray(opts.categories) ? opts.categories : [];
      $("userLanguageFilter").innerHTML = `<option value="">Tüm diller</option>${langs.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}`;
      $("wordDifficultyFilter").innerHTML = `<option value="">Tüm zorluklar</option>${difficulties.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}`;
      $("wordCategoryFilter").innerHTML = `<option value="">Tüm kategoriler</option>${categories.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}`;
    } catch {}
  }

  function renderAnalytics(data) {
    const insights = data?.insights || {};
    const card = (title, rows) => `<article class="card card-padded insight-card"><h3>${escapeHtml(title)}</h3>${Array.isArray(rows) && rows.length ? rows.map((r) => `<div class="insight-bar-row"><span class="insight-bar-label">${escapeHtml(r.label)}</span><span class="insight-bar-meta">${formatNumber(r.count)}</span></div>`).join("") : '<p class="user-cell-sub">Veri yok</p>'}</article>`;
    $("analyticsGrid").innerHTML = [card("Kelime zorluk dağılımı", insights.wordDifficulties), card("Kullanıcı dilleri", insights.userLanguages)].join("");
  }

  async function loadAnalyse() {
    const res = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await res.json();
    if (!data.ok) {
      $("analyseError").hidden = false;
      $("analyseError").textContent = apiMessage(data, "Analiz alınamadı.");
      return;
    }
    const body = data.bodyJson || {};
    const s = body.summary || {};
    $("statTotalUsers").textContent = formatNumber(s.totalUsers);
    $("statPremiumUsers").textContent = formatNumber(s.premiumUsers);
    $("statTotalWords").textContent = formatNumber(s.totalWords);
    $("statActiveWords").textContent = formatNumber(s.activeWords);
    $("statTotalSessions").textContent = formatNumber(s.totalSessions);
    $("statTotalChipPurchases").textContent = formatNumber(s.totalChipPurchases);
    $("statNewUsersToday").textContent = formatNumber(s.newUsersToday);
    $("statSessionsToday").textContent = formatNumber(s.sessionsToday);
    $("analyseHint").textContent = `Toplam satın alınan chip: ${formatNumber(s.totalChipsPurchased)}`;
    const daily = Array.isArray(body.daily) ? body.daily : [];
    $("dailyBody").innerHTML = daily.length ? daily.map((r) => `<tr><td>${escapeHtml(String(r.date || "").slice(0, 10))}</td><td>${formatNumber(r.newUsers)}</td></tr>`).join("") : '<tr><td colspan="2" class="user-cell-sub">Veri yok</td></tr>';
    renderAnalytics(body);
  }

  async function loadUsers() {
    const params = new URLSearchParams({ page: String(usersPage), limit: String(pageSize) });
    const search = $("userSearch").value.trim();
    const premium = $("userPremiumFilter").value;
    const language = $("userLanguageFilter").value;
    if (search) params.set("search", search);
    if (premium) params.set("premium", premium);
    if (language) params.set("language", language);
    const res = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache = new Map(rows.map((r) => [String(r.id), r]));
    $("usersMeta").textContent = usersPagination ? `Sayfa ${usersPagination.page}/${usersPagination.totalPages} · ${formatNumber(usersPagination.total)} kullanıcı` : `${formatNumber(rows.length)} kullanıcı`;
    $("usersBody").innerHTML = rows.length
      ? rows.map((row) => `<tr><td><div class="user-cell-title">${escapeHtml(row.displayName || `#${row.id}`)}</div><div class="user-cell-sub">${escapeHtml(row.deviceId || "—")}</div></td><td>${escapeHtml(row.extras?.appLanguage || "—")}</td><td>${row.extras?.isPremium ? '<span class="badge ok">Premium</span>' : 'Ücretsiz'}</td><td>${formatNumber(row.extras?.chips)}</td><td>${formatNumber(row.extras?.totalPoints)}</td><td><button type="button" class="btn btn-sm" data-user-id="${row.id}" ${canManage ? "" : "hidden"}>Düzenle</button></td></tr>`).join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kullanıcı yok</td></tr>';
    $("usersBody").querySelectorAll("[data-user-id]").forEach((btn) => btn.addEventListener("click", () => openUserDialog(btn.getAttribute("data-user-id"))));
  }

  function openUserDialog(id) {
    const user = usersCache.get(String(id));
    if (!user) return;
    $("userEditId").value = user.id;
    $("userName").value = user.displayName || "";
    $("userLanguage").value = user.extras?.appLanguage || "tr";
    $("userIsPremium").checked = Boolean(user.extras?.isPremium);
    $("userChips").value = Number(user.extras?.chips || 0);
    $("userDialog").showModal();
  }

  async function saveUser(e) {
    e.preventDefault();
    const id = $("userEditId").value;
    const payload = { username: $("userName").value.trim() || null, appLanguage: $("userLanguage").value.trim() || "tr", isPremium: $("userIsPremium").checked, chips: Number($("userChips").value) || 0 };
    const res = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.ok) return;
    $("userDialog").close();
    loadUsers();
    loadAnalyse();
  }

  async function loadWords() {
    const params = new URLSearchParams({ page: String(wordsPage), limit: String(pageSize) });
    const search = $("wordSearch").value.trim();
    const difficulty = $("wordDifficultyFilter").value;
    const category = $("wordCategoryFilter").value;
    if (search) params.set("search", search);
    if (difficulty) params.set("difficulty", difficulty);
    if (category) params.set("category", category);
    const res = await fetch(`/api/apps/${appId}/proxy/words?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    wordsPagination = data.bodyJson?.pagination || null;
    wordsCache = new Map(rows.map((r) => [String(r.id), r]));
    $("wordsMeta").textContent = wordsPagination ? `Sayfa ${wordsPagination.page}/${wordsPagination.totalPages} · ${formatNumber(wordsPagination.total)} kelime` : `${formatNumber(rows.length)} kelime`;
    $("wordsBody").innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.word)}</td><td>${escapeHtml(row.difficulty)}</td><td>${escapeHtml(row.category || "—")}</td><td>${escapeHtml(row.hints?.en || "—")}</td><td><button type="button" class="btn btn-sm" data-word-edit="${row.id}" ${canManage ? "" : "hidden"}>Düzenle</button><button type="button" class="btn btn-sm btn-danger" data-word-del="${row.id}" ${canManage ? "" : "hidden"}>Sil</button></td></tr>`).join("") : '<tr><td colspan="5" class="user-cell-sub">Kelime yok</td></tr>';
    $("wordsBody").querySelectorAll("[data-word-edit]").forEach((btn) => btn.addEventListener("click", () => openWordDialog(btn.getAttribute("data-word-edit"))));
    $("wordsBody").querySelectorAll("[data-word-del]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!window.confirm("Kelime silinsin mi?")) return;
      const resDel = await fetch(`/api/apps/${appId}/proxy/words/${encodeURIComponent(btn.getAttribute("data-word-del"))}`, { method: "DELETE" });
      const dataDel = await resDel.json();
      if (!dataDel.ok) return;
      loadWords();
      loadAnalyse();
    }));
  }

  function openWordDialog(id) {
    const w = id ? wordsCache.get(String(id)) : null;
    $("wordEditId").value = w?.id || "";
    $("wordText").value = w?.word || "";
    $("wordDifficulty").value = w?.difficulty || "medium";
    $("wordCategory").value = w?.category || "";
    $("wordHintEn").value = w?.hints?.en || "";
    $("wordHintTr").value = w?.hints?.tr || "";
    $("wordIsActive").checked = w ? Boolean(w.isActive) : true;
    $("wordDialog").showModal();
  }

  async function saveWord(e) {
    e.preventDefault();
    const id = $("wordEditId").value;
    const payload = { word: $("wordText").value.trim(), difficulty: $("wordDifficulty").value, category: $("wordCategory").value.trim() || null, isActive: $("wordIsActive").checked, hints: { en: $("wordHintEn").value.trim(), tr: $("wordHintTr").value.trim() } };
    const res = await fetch(id ? `/api/apps/${appId}/proxy/words/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/words`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.ok) return;
    $("wordDialog").close();
    loadWords();
    loadAnalyse();
  }

  async function loadSessions() {
    const params = new URLSearchParams({ page: String(sessionsPage), limit: String(pageSize) });
    const search = $("sessionSearch").value.trim();
    const solved = $("sessionSolvedFilter").value;
    if (search) params.set("search", search);
    if (solved) params.set("solved", solved);
    const res = await fetch(`/api/apps/${appId}/proxy/game-sessions?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    sessionsPagination = data.bodyJson?.pagination || null;
    $("sessionsMeta").textContent = sessionsPagination ? `Sayfa ${sessionsPagination.page}/${sessionsPagination.totalPages} · ${formatNumber(sessionsPagination.total)} oturum` : `${formatNumber(rows.length)} oturum`;
    $("sessionsBody").innerHTML = rows.length ? rows.map((r) => `<tr><td>${escapeHtml(r.username || `#${r.userId}`)}</td><td>${escapeHtml(r.word || `#${r.wordId}`)}</td><td>${r.isSolved ? '<span class="badge ok">Çözüldü</span>' : 'Çözülmedi'}</td><td>${r.timeTakenSeconds ?? "—"}</td><td>${formatNumber(r.pointsEarned)}</td><td>${formatDateTime(r.playedAt)}</td></tr>`).join("") : '<tr><td colspan="6" class="user-cell-sub">Oturum yok</td></tr>';
  }

  async function loadChips() {
    const params = new URLSearchParams({ page: String(chipsPage), limit: String(pageSize) });
    const search = $("chipSearch").value.trim();
    if (search) params.set("search", search);
    const res = await fetch(`/api/apps/${appId}/proxy/chip-purchases?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    const rows = listFromBody(data);
    chipsPagination = data.bodyJson?.pagination || null;
    $("chipsMeta").textContent = chipsPagination ? `Sayfa ${chipsPagination.page}/${chipsPagination.totalPages} · ${formatNumber(chipsPagination.total)} kayıt` : `${formatNumber(rows.length)} kayıt`;
    $("chipsBody").innerHTML = rows.length ? rows.map((r) => `<tr><td>${escapeHtml(r.username || `#${r.userId}`)}</td><td>${escapeHtml(r.productId || "—")}</td><td>${formatNumber(r.chipsAdded)}</td><td>${escapeHtml(r.source || "—")}</td><td>${escapeHtml(r.transactionId || "—")}</td><td>${formatDateTime(r.createdAt)}</td></tr>`).join("") : '<tr><td colspan="6" class="user-cell-sub">Kayıt yok</td></tr>';
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
    document.querySelectorAll(".view-panel").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
    if (view === "users") loadUsers();
    if (view === "words") loadWords();
    if (view === "sessions") loadSessions();
    if (view === "chips") loadChips();
    if (view === "revenuecat") window.RevenueCatPanel?.load?.(appId);
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse(), loadOptions(), window.RevenueCatPanel?.load?.(appId)]);
    if (currentView === "users") await loadUsers();
    if (currentView === "words") await loadWords();
    if (currentView === "sessions") await loadSessions();
    if (currentView === "chips") await loadChips();
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $("settingsBtn").addEventListener("click", () => canManage && (window.location.href = `/apps/${appId}/edit`));
  $("refreshBtn").addEventListener("click", () => refreshAll().catch(() => {}));
  $("userSearchBtn").addEventListener("click", () => { usersPage = 1; loadUsers(); });
  $("userClearBtn").addEventListener("click", () => { $("userSearch").value = ""; $("userPremiumFilter").value = ""; $("userLanguageFilter").value = ""; usersPage = 1; loadUsers(); });
  $("usersPrevBtn").addEventListener("click", () => { if (usersPage > 1) { usersPage -= 1; loadUsers(); } });
  $("usersNextBtn").addEventListener("click", () => { usersPage += 1; loadUsers(); });
  $("userForm").addEventListener("submit", saveUser);
  $("userCancelBtn").addEventListener("click", () => $("userDialog").close());
  $("wordCreateBtn").addEventListener("click", () => openWordDialog(null));
  $("wordSearchBtn").addEventListener("click", () => { wordsPage = 1; loadWords(); });
  $("wordClearBtn").addEventListener("click", () => { $("wordSearch").value = ""; $("wordDifficultyFilter").value = ""; $("wordCategoryFilter").value = ""; wordsPage = 1; loadWords(); });
  $("wordsPrevBtn").addEventListener("click", () => { if (wordsPage > 1) { wordsPage -= 1; loadWords(); } });
  $("wordsNextBtn").addEventListener("click", () => { wordsPage += 1; loadWords(); });
  $("wordForm").addEventListener("submit", saveWord);
  $("wordCancelBtn").addEventListener("click", () => $("wordDialog").close());
  $("sessionSearchBtn").addEventListener("click", () => { sessionsPage = 1; loadSessions(); });
  $("sessionClearBtn").addEventListener("click", () => { $("sessionSearch").value = ""; $("sessionSolvedFilter").value = ""; sessionsPage = 1; loadSessions(); });
  $("sessionsPrevBtn").addEventListener("click", () => { if (sessionsPage > 1) { sessionsPage -= 1; loadSessions(); } });
  $("sessionsNextBtn").addEventListener("click", () => { sessionsPage += 1; loadSessions(); });
  $("chipSearchBtn").addEventListener("click", () => { chipsPage = 1; loadChips(); });
  $("chipClearBtn").addEventListener("click", () => { $("chipSearch").value = ""; chipsPage = 1; loadChips(); });
  $("chipsPrevBtn").addEventListener("click", () => { if (chipsPage > 1) { chipsPage -= 1; loadChips(); } });
  $("chipsNextBtn").addEventListener("click", () => { chipsPage += 1; loadChips(); });

  (async function init() {
    const session = await window.PanelAuth.fetchSession();
    if (!session) return;
    canManage = window.PanelAuth.isManager(session);
    applyRoleUi();
    await loadAppMeta();
    await refreshAll();
  })().catch(() => setHealth(false, "Yükleme hatası"));
})();
