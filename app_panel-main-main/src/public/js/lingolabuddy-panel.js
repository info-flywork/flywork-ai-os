(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) {
    document.body.innerHTML =
      '<main class="page-content"><div class="alert alert-error">Geçersiz uygulama.</div></main>';
    return;
  }

  let usersPage = 1;
  const usersLimit = 20;
  let usersPagination = null;
  let usersSearch = "";
  const usersCache = new Map();

  let tutorsPage = 1;
  const tutorsLimit = 20;
  let tutorsPagination = null;
  let tutorsSearch = "";
  let tutorsStatus = "";
  const tutorsCache = new Map();

  let currentView = "overview";
  let canManage = false;
  let editingTutor = null;
  let viewingTutorId = null;
  let voiceOptionsCache = [];
  const voiceById = new Map();
  let lastAudienceInsights = null;
  let lastTopTutorsByConversations = null;

  const lbTutorUi = () => window.LingolaBuddyTutorUi;
  const toast = document.getElementById("toast");

  function $(id) {
    return document.getElementById(id);
  }

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
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(d);
  }

  function authLabelTr(value) {
    const a = String(value || "").toLowerCase();
    if (!a) return "—";
    if (a === "guest") return "Misafir";
    if (a === "apple") return "Apple";
    if (a === "google") return "Google";
    if (a === "email") return "E-posta";
    return a;
  }

  function userStatusLabelTr(status) {
    const map = { active: "Aktif", inactive: "Pasif", banned: "Yasaklı" };
    return map[status] || status || "—";
  }

  function tutorStatusLabelTr(status) {
    const map = { published: "Yayında", draft: "Taslak", archived: "Arşiv" };
    return map[status] || status || "—";
  }

  function tutorCategoryLabelTr(category) {
    const map = { female: "Kadın", male: "Erkek", neutral: "Nötr" };
    return map[category] || category || "—";
  }

  function usersFromBody(bodyJson) {
    if (!bodyJson) return [];
    const raw = bodyJson.users ?? bodyJson.data ?? bodyJson.items ?? [];
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.users)) return raw.users;
    if (raw && Array.isArray(raw.data)) return raw.data;
    return [];
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    const detail = body?.msg || body?.message || data?.error;
    if (detail && data?.statusCode) return `${detail} (HTTP ${data.statusCode})`;
    if (detail) return detail;
    if (data?.statusCode) return `${fallback} (HTTP ${data.statusCode})`;
    return fallback;
  }

  function setHealthBadge(ok, text) {
    const el = $("healthBadge");
    if (!el) return;
    el.className = "badge " + (ok ? "ok" : "fail");
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function setVal(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setStatsLoading(loading) {
    for (const id of [
      "statTotal",
      "statLogins",
      "statNew",
      "statPremiumUsers",
      "statActiveTutors",
      "statConversationsToday",
      "statTotalTutors"
    ]) {
      const el = $(id);
      if (el) el.classList.toggle("loading", loading);
    }
  }

  function applyReadOnlyUi() {
    const banner = $("viewerBanner");
    if (banner) banner.hidden = canManage;
    document.querySelectorAll("[data-manager-only]").forEach((el) => {
      el.hidden = !canManage;
      el.style.display = canManage ? "" : "none";
    });
  }

  function switchView(view) {
    currentView = view;
    if (view !== "tutors") closeTutorDetailPage();
    document.querySelectorAll(".view-panel").forEach((el) => {
      el.classList.toggle("active", el.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    if (view === "users") loadUsers();
    if (view === "tutors") loadTutors();
    if (view === "analytics") renderAnalyticsView();
    if (view === "revenuecat" && window.RevenueCatPanel?.load) window.RevenueCatPanel.load(appId);
  }

  async function loadAppMeta() {
    const response = await fetch(`/api/apps/${appId}`);
    if (response.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const data = await response.json();
    if (!response.ok) return null;

    const app = data.app;
    const name = app.appName || "Lingola Buddy";
    $("appTitle").textContent = name;
    $("sidebarAppName").textContent = name;
    $("breadcrumbName").textContent = name;

    const iconImg = $("headerAppIcon");
    const iconFallback = $("headerAppIconFallback");
    if (app.iconUrl && iconImg) {
      iconImg.src = app.iconUrl;
      iconImg.hidden = false;
      if (iconFallback) iconFallback.hidden = true;
    } else if (iconFallback) {
      iconFallback.textContent = "LB";
      iconFallback.hidden = false;
      if (iconImg) iconImg.hidden = true;
    }

    if (!app.apiBaseUrl) {
      $("apiInfo").textContent = "API URL tanımlı değil — Ayarlardan ekleyin";
    } else if (!app.hasPanelApiKey) {
      $("apiInfo").textContent = `${app.apiBaseUrl} · API anahtarı eksik`;
    } else {
      $("apiInfo").textContent = app.apiBaseUrl;
    }
    return app;
  }

  async function loadHealth() {
    const response = await fetch(`/api/apps/${appId}/proxy/health`);
    const data = await response.json();
    setHealthBadge(data.ok, data.ok ? "API bağlı" : "API erişilemiyor");
  }

  function renderInsightBars(items) {
    if (!items?.length) return '<p class="user-cell-sub">Veri yok</p>';
    const max = Math.max(...items.map((i) => Number(i.count || 0)), 1);
    return `<div class="insight-bar-list">${items
      .slice(0, 12)
      .map((item) => {
        const count = Number(item.count || 0);
        const w = Math.max(Math.round((count / max) * 100), count > 0 ? 6 : 0);
        return `<div class="insight-bar-row">
          <span class="insight-bar-label">${escapeHtml(item.label || item.code || "—")}</span>
          <div class="insight-bar-track"><div class="insight-bar-fill" style="width:${w}%"></div></div>
          <span class="insight-bar-meta">${formatNumber(count)} · %${item.percent ?? 0}</span>
        </div>`;
      })
      .join("")}</div>`;
  }

  function renderInsightCard(title, subtitle, items) {
    return `<article class="card card-padded insight-card">
      <h3>${escapeHtml(title)}</h3>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      ${renderInsightBars(items)}
    </article>`;
  }

  function renderTopTutors(topRows) {
    const section = $("topTutorsSection");
    const body = $("topTutorsBody");
    if (!section || !body) return;
    const rows = Array.isArray(topRows) ? topRows : [];
    if (!rows.length) {
      section.hidden = true;
      body.innerHTML = "";
      return;
    }
    section.hidden = false;
    body.innerHTML = rows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.title || row.tutorId || "—")}</td>
          <td>${formatNumber(row.conversations ?? 0)}</td>
        </tr>`
      )
      .join("");
  }

  function renderAudienceInsights(insights) {
    const grid = $("analyticsGrid");
    if (!grid) return;
    if (!insights) {
      grid.innerHTML = '<p class="user-cell-sub">Analiz verisi yüklenemedi — Yenile\'ye basın.</p>';
      return;
    }

    grid.innerHTML = [
      renderInsightCard("Giriş tipi", "Google / Apple / Misafir dağılımı", insights.authProviders),
      renderInsightCard("Seri dağılımı", "user_learning_stats kayıtları", insights.streakBuckets),
      renderInsightCard(
        "Günlük konuşma ilerlemesi",
        "user_daily_conversation_progress durumları",
        insights.lessonProgressStatuses
      )
    ].join("");

    const totals = insights.totals || {};
    setVal("analyticsStatsUsers", formatNumber(totals.usersWithLearningStats));
    setVal("analyticsPracticeUsers", formatNumber(totals.usersWithPracticeDays));
    setVal("analyticsTotalConversations", formatNumber(totals.totalConversations));
    $("analyticsError").hidden = true;
  }

  function renderAnalyticsView() {
    renderAudienceInsights(lastAudienceInsights);
    renderTopTutors(lastTopTutorsByConversations);
  }

  async function loadAnalyse() {
    $("dailyError").hidden = true;
    setStatsLoading(true);
    const response = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await response.json();
    setStatsLoading(false);

    if (!data.ok) {
      [
        "statTotal",
        "statLogins",
        "statNew",
        "statPremiumUsers",
        "statActiveTutors",
        "statConversationsToday",
        "statTotalTutors",
        "statWeeklyLogins",
        "statWeeklyNewUsers",
        "statWeeklyConversations",
        "statUsersWithStats"
      ].forEach((id) => setVal(id, "—"));
      const chart = $("dailyMiniChart");
      if (chart) chart.innerHTML = "";
      $("dailyBody").innerHTML = "";
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      lastAudienceInsights = null;
      lastTopTutorsByConversations = null;
      if (currentView === "analytics") renderAnalyticsView();
      return;
    }

    const summary = data.bodyJson?.summary || {};
    setVal("statTotal", formatNumber(summary.totalUsers));
    setVal("statLogins", formatNumber(summary.loginsToday));
    setVal("statNew", formatNumber(summary.newUsersToday));
    setVal("statPremiumUsers", formatNumber(summary.premiumUsers));
    setVal("statActiveTutors", formatNumber(summary.activeTutors));
    setVal("statConversationsToday", formatNumber(summary.conversationsToday));
    setVal("statTotalTutors", formatNumber(summary.totalTutors));

    const version = data.bodyJson?.contractVersion;
    const tz = data.bodyJson?.timezone || "Europe/Istanbul";
    const hint = $("analyseHint");
    if (hint) {
      hint.textContent = version
        ? `Sözleşme v${version} · Metrikler ${tz} saat dilimine göre hesaplanır.`
        : `Metrikler ${tz} saat dilimine göre hesaplanır.`;
    }

    const daily = Array.isArray(data.bodyJson?.daily) ? data.bodyJson.daily.slice() : [];
    const last7 = daily.slice(0, 7).slice().reverse();
    const weeklyLogins = last7.reduce((acc, row) => acc + Number(row.logins || 0), 0);
    const weeklyNew = last7.reduce((acc, row) => acc + Number(row.newUsers || 0), 0);
    const weeklyConversations = last7.reduce((acc, row) => acc + Number(row.conversations || 0), 0);
    const maxLogins = Math.max(...last7.map((d) => Number(d.logins || 0)), 1);

    const chart = $("dailyMiniChart");
    if (chart) {
      chart.innerHTML = last7
        .map((row) => {
          const logins = Number(row.logins || 0);
          const conversations = Number(row.conversations || 0);
          const h = Math.max(Math.round((logins / maxLogins) * 80), 6);
          return `<div class="mini-day">
            <div class="mini-bar" style="height:${h}px" title="${row.date}: ${logins} giriş"></div>
            <div class="mini-meta">${conversations}</div>
            <div class="mini-label">${String(row.date || "").slice(5)}</div>
          </div>`;
        })
        .join("");
    }

    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statWeeklyConversations", formatNumber(weeklyConversations));

    lastAudienceInsights = data.bodyJson?.audienceInsights || null;
    setVal(
      "statUsersWithStats",
      formatNumber(lastAudienceInsights?.totals?.usersWithLearningStats)
    );

    const maxDailyLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxDailyNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    const maxDailyConversations = Math.max(...daily.map((d) => Number(d.conversations || 0)), 1);

    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const conversations = Number(row.conversations || 0);
            const loginW = Math.max(Math.round((logins / maxDailyLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxDailyNew) * 100), newUsers > 0 ? 8 : 0);
            const convW = Math.max(
              Math.round((conversations / maxDailyConversations) * 100),
              conversations > 0 ? 8 : 0
            );
            return `<tr>
              <td><div class="daily-date-cell">${row.date || "—"}</div></td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(logins)}</strong>
                  <div class="daily-meter"><span style="width:${loginW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(newUsers)}</strong>
                  <div class="daily-meter daily-meter--new"><span style="width:${newW}%"></span></div>
                </div>
              </td>
              <td>
                <div class="daily-metric-cell">
                  <strong>${formatNumber(conversations)}</strong>
                  <div class="daily-meter"><span style="width:${convW}%"></span></div>
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="user-cell-sub">Veri yok</td></tr>`;

    lastTopTutorsByConversations = data.bodyJson?.tutorsSummary?.topTutorsByConversations || [];
    if (currentView === "analytics") renderAnalyticsView();
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editStatus").value = user.status || "active";

    const meta = [];
    if (ex.authProvider) meta.push(`Giriş: ${authLabelTr(ex.authProvider)}`);
    if (ex.streakDays != null) meta.push(`Seri: ${formatNumber(ex.streakDays)} gün`);
    if (ex.totalPracticeMinutes != null) meta.push(`Pratik: ${formatNumber(ex.totalPracticeMinutes)} dk`);
    if (ex.conversationCount != null) meta.push(`Konuşma: ${formatNumber(ex.conversationCount)}`);
    if (ex.wordsLearnedCount != null) meta.push(`Kelime: ${formatNumber(ex.wordsLearnedCount)}`);
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";

    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
  }

  function renderUserDetailProfile(user) {
    const ex = user.extras || {};
    const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
    const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
    const rows = [
      ["Kimlik", user.id],
      ["Giriş", authLabelTr(ex.authProvider)],
      ["Durum", userStatusLabelTr(user.status)],
      ["Son giriş", formatDateTime(user.lastLoginAt)],
      ["Kayıt", formatDateTime(user.createdAt)]
    ];

    return `
      <div class="user-cell-title">${label}</div>
      ${sub ? `<div class="user-cell-sub">${sub}</div>` : ""}
      <table class="data-table" style="margin-top:12px">
        <tbody>
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td class="user-cell-sub" style="width:130px">${escapeHtml(k)}</td><td>${escapeHtml(v ?? "—")}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  function renderUserLearningStats(user) {
    const ex = user.extras || {};
    const accuracy =
      ex.accuracyPercent == null ? "—" : `%${formatNumber(ex.accuracyPercent)}`;
    return `
      <article class="card stat-card">
        <div class="stat-label">Seri</div>
        <div class="stat-value">${formatNumber(ex.streakDays)}</div>
      </article>
      <article class="card stat-card">
        <div class="stat-label">Pratik dakika</div>
        <div class="stat-value">${formatNumber(ex.totalPracticeMinutes)}</div>
      </article>
      <article class="card stat-card">
        <div class="stat-label">Pratik günü</div>
        <div class="stat-value">${formatNumber(ex.practiceDaysCount)}</div>
      </article>
      <article class="card stat-card">
        <div class="stat-label">Konuşma</div>
        <div class="stat-value">${formatNumber(ex.conversationCount)}</div>
      </article>
      <article class="card stat-card">
        <div class="stat-label">Mesaj</div>
        <div class="stat-value">${formatNumber(ex.messageCount)}</div>
      </article>
      <article class="card stat-card">
        <div class="stat-label">Öğrenilen kelime</div>
        <div class="stat-value">${formatNumber(ex.wordsLearnedCount)}</div>
      </article>
      <article class="card stat-card">
        <div class="stat-label">Doğruluk</div>
        <div class="stat-value">${accuracy}</div>
      </article>`;
  }

  async function openUserDetail(userId) {
    const cached = usersCache.get(String(userId));
    $("userDetailTitle").textContent = "Kullanıcı detay";
    $("userDetailProfile").innerHTML = `<p class="user-cell-sub">Yükleniyor...</p>`;
    $("userDetailStats").innerHTML = `<p class="user-cell-sub">Yükleniyor...</p>`;
    $("userDetailStatsMeta").textContent = "—";
    $("userDetailError").hidden = true;
    $("userDetailDialog").showModal();

    try {
      const userRes = cached
        ? { ok: true, bodyJson: { data: cached } }
        : await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`).then((r) => r.json());

      if (!userRes.ok) {
        throw new Error(apiErrorMessage(userRes, "Kullanıcı bilgisi alınamadı."));
      }

      const user = userRes.bodyJson?.data;
      if (!user) throw new Error("Kullanıcı bulunamadı.");

      usersCache.set(String(user.id), user);
      const title = user.displayName || user.email || `Kullanıcı #${user.id}`;
      $("userDetailTitle").textContent = title;
      $("userDetailProfile").innerHTML = renderUserDetailProfile(user);
      $("userDetailStats").innerHTML = renderUserLearningStats(user);
      $("userDetailStatsMeta").textContent = `${formatNumber(user.extras?.messageCount ?? 0)} mesaj · ${formatNumber(
        user.extras?.conversationCount ?? 0
      )} konuşma`;
    } catch (err) {
      $("userDetailError").hidden = false;
      $("userDetailError").textContent = err.message || "Detay yüklenemedi.";
      $("userDetailProfile").innerHTML = "";
      $("userDetailStats").innerHTML = "";
      $("userDetailStatsMeta").textContent = "—";
    }
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = `<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: usersPage, limit: usersLimit });
    if (usersSearch) params.set("search", usersSearch);

    const response = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("usersBody").innerHTML = "";
      $("usersError").hidden = false;
      $("usersError").textContent = apiErrorMessage(data, "Liste alınamadı.");
      $("usersMeta").textContent = "Liste alınamadı";
      $("prevPageBtn").disabled = true;
      $("nextPageBtn").disabled = true;
      return;
    }

    const users = usersFromBody(data.bodyJson);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache.clear();
    users.forEach((u) => usersCache.set(String(u.id), u));

    $("usersMeta").textContent = usersPagination
      ? `${formatNumber(usersPagination.total)} kullanıcı · sayfa ${usersPagination.page}/${usersPagination.totalPages}`
      : `${users.length} kayıt`;

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const label = escapeHtml(user.displayName || user.email || `ID ${user.id}`);
            const sub = user.displayName && user.email ? escapeHtml(user.email) : "";
            const status = user.status || "inactive";
            const premium = user.extras?.isPremium;
            return `<tr data-user-id="${user.id}" style="cursor:pointer">
              <td>
                <div class="user-cell-title">${label}</div>
                ${sub ? `<div class="user-cell-sub">${sub}</div>` : `<div class="user-cell-sub">${escapeHtml(user.id)}</div>`}
              </td>
              <td>${authLabelTr(user.extras?.authProvider)}</td>
              <td>${premium ? '<span class="badge ok">Premium</span>' : "—"}</td>
              <td><span class="status-pill ${status}">${userStatusLabelTr(status)}</span></td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td>
                <div style="display:flex; gap:6px; justify-content:flex-end">
                  <button type="button" class="btn btn-sm btn-ghost" data-user-detail="${user.id}">Detay</button>
                  ${
                    canManage
                      ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7"><p class="user-cell-sub">Eşleşen kullanıcı yok</p></td></tr>`;

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function getVoiceMeta(voiceId) {
    if (!voiceId) return null;
    return voiceById.get(voiceId) || { voiceId, name: voiceId, previewUrl: null };
  }

  function fillSelect(selectEl, items, { valueKey = "value", labelKey = "label", emptyLabel } = {}) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = emptyLabel ? `<option value="">${emptyLabel}</option>` : "";
    const list = Array.isArray(items) ? items : [];
    for (const item of list) {
      const opt = document.createElement("option");
      if (typeof item === "string") {
        opt.value = item;
        opt.textContent = item;
      } else {
        opt.value = item[valueKey] ?? item.value ?? item.id ?? "";
        opt.textContent = item[labelKey] ?? item.label ?? item.name ?? opt.value;
      }
      selectEl.appendChild(opt);
    }
    if (current) selectEl.value = current;
  }

  function voiceLabel(v) {
    const g = v.gender === "female" ? "Kadın" : v.gender === "male" ? "Erkek" : "Bilinmiyor";
    return `${v.name} (${g})`;
  }

  function getTutorVoiceFilter(tutorOrCategory) {
    const cat =
      typeof tutorOrCategory === "string"
        ? tutorOrCategory
        : String(tutorOrCategory?.category || tutorOrCategory?.extras?.gender || "").toLowerCase();
    if (cat === "female" || cat === "male") return { gender: cat, allowAll: false };
    if (cat === "neutral") return { gender: "", allowAll: true };
    return { gender: "", allowAll: false };
  }

  function renderVoiceSelectOptions(selectEl, { selected = "", gender = "", allowAll = false } = {}) {
    if (!selectEl) return { fallbackUsed: false };
    if (!gender && !allowAll) {
      fillSelect(selectEl, [], { emptyLabel: "Önce kategori seçin" });
      selectEl.disabled = true;
      return { fallbackUsed: false };
    }

    const exact = gender ? voiceOptionsCache.filter((v) => v.gender === gender) : [];
    const list = gender ? (exact.length ? exact : voiceOptionsCache.slice()) : voiceOptionsCache.slice();
    const fallbackUsed = Boolean(gender && !exact.length && list.length);

    fillSelect(
      selectEl,
      list.map((v) => ({ value: v.voiceId, label: voiceLabel(v) })),
      { valueKey: "value", labelKey: "label", emptyLabel: list.length ? "Ses seçin" : "Uygun ses bulunamadı" }
    );
    selectEl.disabled = list.length === 0;

    if (selected) {
      const hasSelected = list.some((v) => v.voiceId === selected);
      if (!hasSelected) {
        const fromAll = voiceOptionsCache.find((v) => v.voiceId === selected);
        if (fromAll) {
          const opt = document.createElement("option");
          opt.value = fromAll.voiceId;
          opt.textContent = `${voiceLabel(fromAll)} (mevcut)`;
          selectEl.appendChild(opt);
        }
      }
      selectEl.value = selected;
    }

    return { fallbackUsed };
  }

  function updateVoicePreviewFor(selectId, previewId) {
    const select = $(selectId);
    const audio = $(previewId);
    if (!select || !audio) return;
    const chosen = voiceOptionsCache.find((v) => v.voiceId === select.value);
    if (!chosen?.previewUrl) {
      audio.hidden = true;
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    audio.hidden = false;
    audio.src = chosen.previewUrl;
    audio.load();
  }

  function syncTutorFormVoiceOptions(selected = "") {
    const { gender, allowAll } = getTutorVoiceFilter($("tutorCategory")?.value || "");
    const { fallbackUsed } = renderVoiceSelectOptions($("tutorVoiceId"), { selected, gender, allowAll });
    updateVoicePreviewFor("tutorVoiceId", "tutorVoicePreview");
    const hint = $("tutorVoiceHint");
    if (!hint) return;
    if (!gender && !allowAll) {
      hint.textContent = "Ses seçimi, kategoriden sonra açılır.";
      return;
    }
    if (allowAll) {
      hint.textContent = "Nötr kategori: tüm sesler listeleniyor.";
      return;
    }
    hint.textContent = fallbackUsed
      ? `${gender === "female" ? "Kadın" : "Erkek"} sesi bulunamadı; tüm sesler listelendi.`
      : `${gender === "female" ? "Kadın" : "Erkek"} sesleri listeleniyor.`;
  }

  function syncTutorDetailVoiceOptions(tutor) {
    const { gender, allowAll } = getTutorVoiceFilter(tutor);
    const { fallbackUsed } = renderVoiceSelectOptions($("tutorDetailVoiceId"), {
      selected: tutor?.extras?.voiceId || "",
      gender,
      allowAll
    });
    updateVoicePreviewFor("tutorDetailVoiceId", "tutorDetailVoicePreview");
    const hint = $("tutorDetailVoiceHint");
    if (!hint) return;
    if (allowAll) {
      hint.textContent = "Nötr kategori: tüm sesler listeleniyor.";
      return;
    }
    if (!gender) {
      hint.textContent = "Kategori tanımlı değil.";
      return;
    }
    hint.textContent = fallbackUsed
      ? `${gender === "female" ? "Kadın" : "Erkek"} sesi bulunamadı; tüm sesler listelendi.`
      : `${gender === "female" ? "Kadın" : "Erkek"} sesleri listeleniyor.`;
  }

  function setTutorDetailVoiceStatus(message, isError = false) {
    const el = $("tutorDetailVoiceStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "var(--danger, #dc2626)" : "";
  }

  async function saveTutorDetailVoice() {
    if (!canManage || !viewingTutorId) return;
    const tutor = tutorsCache.get(viewingTutorId);
    if (!tutor) return;

    const voiceId = $("tutorDetailVoiceId")?.value?.trim() || "";
    const btn = $("tutorDetailSaveVoiceBtn");
    if (btn) btn.disabled = true;
    setTutorDetailVoiceStatus("Kaydediliyor...");

    try {
      const response = await fetch(
        `/api/apps/${appId}/proxy/tutors/${encodeURIComponent(viewingTutorId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extras: { voiceId: voiceId || "" } })
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setTutorDetailVoiceStatus(apiErrorMessage(data, "Ses kaydedilemedi."), true);
        return;
      }

      const updated = data.bodyJson?.data || { ...tutor, extras };
      tutorsCache.set(String(updated.id || viewingTutorId), updated);
      syncTutorDetailVoiceOptions(updated);
      setTutorDetailVoiceStatus("Ses güncellendi.");
      showToast("Ses güncellendi");
      loadTutors();
    } catch (err) {
      setTutorDetailVoiceStatus(err.message || "Ses kaydedilemedi.", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadVoiceCatalog() {
    if (voiceOptionsCache.length) return voiceOptionsCache;
    const response = await fetch(`/api/apps/${appId}/proxy/voices`);
    const data = await response.json();
    if (!data.ok) return [];
    const list = Array.isArray(data.bodyJson?.data) ? data.bodyJson.data : [];
    voiceOptionsCache = list;
    voiceById.clear();
    list.forEach((v) => {
      if (v?.voiceId) voiceById.set(v.voiceId, v);
    });
    return list;
  }

  function renderTutorVoiceCell(voiceId) {
    return lbTutorUi()?.renderVoicePlayer(getVoiceMeta(voiceId), { compact: true }) || escapeHtml(voiceId || "—");
  }

  async function openTutorDialog(tutor) {
    editingTutor = tutor || null;
    $("tutorDialogTitle").textContent = tutor ? "Eğitmen düzenle" : "Yeni eğitmen";
    $("tutorEditId").value = tutor?.id || "";
    await loadVoiceCatalog().catch(() => {});
    lbTutorUi()?.fillTutorForm($, tutor);
    syncTutorFormVoiceOptions(tutor?.extras?.voiceId || "");
    $("tutorFormMessage").hidden = true;
    $("tutorDialog").showModal();
  }

  function closeTutorDetailPage() {
    viewingTutorId = null;
    const page = $("tutorDetailPage");
    const listArea = $("tutorsListArea");
    if (page) page.hidden = true;
    if (listArea) listArea.hidden = false;
    const editBtn = $("editTutorFromDetailBtn");
    if (editBtn) editBtn.hidden = true;
  }

  function setTutorDetailUploadStatus(message, isError = false) {
    const el = $("tutorDetailUploadStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "var(--danger, #dc2626)" : "";
  }

  async function uploadTutorDetailAsset(kind) {
    if (!canManage || !viewingTutorId) return;
    const isPhoto = kind === "photo";
    const input = $(isPhoto ? "tutorDetailPhotoFile" : "tutorDetailRivFile");
    const btn = $(isPhoto ? "tutorDetailUploadPhotoBtn" : "tutorDetailUploadRivBtn");
    const file = input?.files?.[0];
    if (!file) {
      setTutorDetailUploadStatus(
        isPhoto ? "Önce bir fotoğraf seçin." : "Önce bir .riv dosyası seçin.",
        true
      );
      return;
    }

    if (btn) btn.disabled = true;
    setTutorDetailUploadStatus(isPhoto ? "Fotoğraf yükleniyor..." : "RIV yükleniyor...");
    try {
      const updated = await lbTutorUi()?.uploadTutorAsset(appId, viewingTutorId, kind, file);
      if (!updated) throw new Error("Yükleme başarısız.");
      tutorsCache.set(String(updated.id), updated);
      lbTutorUi()?.updateTutorDetailMediaPreview($, updated);
      if (input) input.value = "";
      setTutorDetailUploadStatus(
        isPhoto ? "Fotoğraf CDN'e yüklendi ve kayıt güncellendi." : "RIV CDN'e yüklendi ve kayıt güncellendi."
      );
      showToast(isPhoto ? "Fotoğraf güncellendi" : "RIV güncellendi");
      loadTutors();
    } catch (err) {
      setTutorDetailUploadStatus(err.message || "Yükleme başarısız.", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function openTutorDetailPage(tutor) {
    if (!tutor) return;
    await loadVoiceCatalog();
    viewingTutorId = String(tutor.id);
    const listArea = $("tutorsListArea");
    const page = $("tutorDetailPage");
    if (listArea) listArea.hidden = true;
    if (page) {
      page.hidden = false;
      page.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    $("tutorDetailTitle").textContent = tutor.title || tutor.id;
    const voiceMeta = getVoiceMeta(tutor.extras?.voiceId);
    $("tutorDetailBody").innerHTML =
      lbTutorUi()?.renderTutorDetailPage(tutor, voiceMeta, {
        status: tutorStatusLabelTr(tutor.status),
        category: tutorCategoryLabelTr(tutor.category),
        canManage
      }) || "";
    if (canManage) {
      syncTutorDetailVoiceOptions(tutor);
      setTutorDetailVoiceStatus("—");
    }
    setTutorDetailUploadStatus("—");

    const editBtn = $("editTutorFromDetailBtn");
    if (editBtn) {
      editBtn.hidden = !canManage;
      editBtn.style.display = canManage ? "" : "none";
    }
  }

  async function loadTutors() {
    $("tutorsError").hidden = true;
    $("tutorsBody").innerHTML = `<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>`;
    await loadVoiceCatalog().catch(() => {});
    const params = new URLSearchParams({ page: tutorsPage, limit: tutorsLimit });
    if (tutorsSearch) params.set("search", tutorsSearch);
    if (tutorsStatus) params.set("status", tutorsStatus);

    const response = await fetch(`/api/apps/${appId}/proxy/tutors?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("tutorsBody").innerHTML = "";
      $("tutorsError").hidden = false;
      $("tutorsError").textContent = apiErrorMessage(data, "Eğitmen listesi alınamadı.");
      $("tutorsMeta").textContent = "Liste alınamadı";
      $("tutorPrevBtn").disabled = true;
      $("tutorNextBtn").disabled = true;
      return;
    }

    const tutors = data.bodyJson?.data || [];
    tutorsPagination = data.bodyJson?.pagination || null;
    tutorsCache.clear();
    tutors.forEach((t) => tutorsCache.set(String(t.id), t));
    $("tutorsMeta").textContent = tutorsPagination
      ? `${formatNumber(tutorsPagination.total)} eğitmen · sayfa ${tutorsPagination.page}/${tutorsPagination.totalPages}`
      : `${tutors.length} kayıt`;

    $("tutorsBody").innerHTML = tutors.length
      ? tutors
          .map((tutor) => `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${lbTutorUi()?.tutorListThumb(tutor) || ""}
                  <div>
                    <div class="user-cell-title">${escapeHtml(tutor.title || tutor.id)}</div>
                    <div class="user-cell-sub">${escapeHtml(tutor.id || "—")}</div>
                  </div>
                </div>
              </td>
              <td>${escapeHtml(tutorStatusLabelTr(tutor.status))}</td>
              <td>${escapeHtml(tutorCategoryLabelTr(tutor.category))}</td>
              <td>${renderTutorVoiceCell(tutor.extras?.voiceId)}</td>
              <td class="user-cell-sub">${formatNumber(tutor.extras?.sortOrder)}</td>
              <td>
                <div style="display:flex; gap:6px; justify-content:flex-end">
                  <button type="button" class="btn btn-sm btn-ghost" data-view-tutor="${tutor.id}">Görüntüle</button>
                  ${
                    canManage
                      ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-tutor="${tutor.id}">Düzenle</button>
                         <button type="button" class="btn btn-sm btn-ghost" data-delete-tutor="${tutor.id}">Sil</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>`)
          .join("")
      : `<tr><td colspan="6"><p class="user-cell-sub">Kayıt yok</p></td></tr>`;

    $("tutorPrevBtn").disabled = tutorsPage <= 1;
    $("tutorNextBtn").disabled = tutorsPage >= (tutorsPagination?.totalPages || 1);
  }

  async function deleteTutor(tutorId) {
    if (!canManage) return;
    if (!confirm("Bu eğitmen arşivlensin mi?")) return;
    const response = await fetch(`/api/apps/${appId}/proxy/tutors/${encodeURIComponent(tutorId)}`, {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showToast(apiErrorMessage(data, "Silinemedi"));
      return;
    }
    showToast("Eğitmen silindi");
    loadTutors();
    loadAnalyse();
  }

  async function saveTutorForm(event) {
    event.preventDefault();
    if (!canManage) return;
    $("tutorFormMessage").hidden = true;

    const validationError = lbTutorUi()?.validateTutorForm($);
    if (validationError) {
      $("tutorFormMessage").hidden = false;
      $("tutorFormMessage").textContent = validationError;
      return;
    }

    const payload = lbTutorUi()?.readTutorForm($, { existingExtras: editingTutor?.extras || {} });
    const tutorId = $("tutorEditId").value.trim();
    const url = tutorId
      ? `/api/apps/${appId}/proxy/tutors/${encodeURIComponent(tutorId)}`
      : `/api/apps/${appId}/proxy/tutors`;
    const method = tutorId ? "PATCH" : "POST";

    const submitBtn = event.submitter;
    submitBtn.disabled = true;
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("tutorFormMessage").hidden = false;
        $("tutorFormMessage").textContent = apiErrorMessage(data, "Kayıt başarısız.");
        return;
      }

      const savedTutor = data.bodyJson?.data || null;
      if (savedTutor?.id) {
        try {
          const photoFile = $("tutorPhotoFile")?.files?.[0];
          if (photoFile) {
            const uploaded = await lbTutorUi()?.uploadTutorAsset(appId, savedTutor.id, "photo", photoFile);
            if (uploaded) Object.assign(savedTutor, uploaded);
          }
          const rivFile = $("tutorRivFile")?.files?.[0];
          if (rivFile) {
            const uploaded = await lbTutorUi()?.uploadTutorAsset(appId, savedTutor.id, "riv", rivFile);
            if (uploaded) Object.assign(savedTutor, uploaded);
          }
        } catch (uploadErr) {
          showToast(uploadErr.message || "Dosya yükleme sırasında hata oluştu.");
        }
      }

      $("tutorDialog").close();
      showToast(tutorId ? "Eğitmen güncellendi" : "Eğitmen oluşturuldu");
      loadTutors();
      loadAnalyse();
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function refreshAll() {
    const btn = $("refreshBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Yenileniyor...";
    }
    try {
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
      if (currentView === "users") await loadUsers();
      if (currentView === "tutors") await loadTutors();
      if (currentView === "analytics") renderAnalyticsView();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Yenile";
      }
    }
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  $("settingsBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    window.location.href = `/apps/${appId}/edit`;
  });

  $("refreshBtn")?.addEventListener("click", () => refreshAll().catch(() => {}));
  $("searchBtn")?.addEventListener("click", () => {
    usersSearch = $("userSearch").value.trim();
    usersPage = 1;
    loadUsers();
  });
  $("userSearch")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $("searchBtn")?.click();
  });
  $("userClearFilterBtn")?.addEventListener("click", () => {
    usersSearch = "";
    usersPage = 1;
    $("userSearch").value = "";
    loadUsers();
  });
  $("prevPageBtn")?.addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });
  $("nextPageBtn")?.addEventListener("click", () => {
    if (usersPage < (usersPagination?.totalPages || 1)) {
      usersPage += 1;
      loadUsers();
    }
  });

  $("usersBody")?.addEventListener("click", (e) => {
    const detailBtn = e.target.closest("[data-user-detail]");
    if (detailBtn) {
      openUserDetail(detailBtn.getAttribute("data-user-detail")).catch(() => {});
      return;
    }
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
    if (user) openEditUser(user);
  });

  $("closeUserDetailBtn")?.addEventListener("click", () => $("userDetailDialog").close());
  $("closeUserDialogBtn")?.addEventListener("click", () => $("editUserDialog").close());
  $("editUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;
    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      status: $("editStatus").value
    };
    const submitBtn = event.submitter;
    submitBtn.disabled = true;
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("editUserMessage").hidden = false;
        $("editUserMessage").textContent = apiErrorMessage(data, "Güncelleme başarısız.");
        return;
      }
      $("editUserDialog").close();
      showToast("Kullanıcı güncellendi");
      loadUsers();
      loadAnalyse();
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("newTutorBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    openTutorDialog(null);
  });
  $("tutorSearchBtn")?.addEventListener("click", () => {
    tutorsSearch = $("tutorSearch").value.trim();
    tutorsStatus = $("tutorStatusFilter").value;
    tutorsPage = 1;
    loadTutors();
  });
  $("tutorPrevBtn")?.addEventListener("click", () => {
    if (tutorsPage > 1) {
      tutorsPage -= 1;
      loadTutors();
    }
  });
  $("tutorNextBtn")?.addEventListener("click", () => {
    if (tutorsPage < (tutorsPagination?.totalPages || 1)) {
      tutorsPage += 1;
      loadTutors();
    }
  });

  $("tutorsBody")?.addEventListener("click", async (e) => {
    const viewBtn = e.target.closest("[data-view-tutor]");
    if (viewBtn) {
      const tutorId = viewBtn.getAttribute("data-view-tutor");
      let tutor = tutorsCache.get(tutorId);
      if (tutor) {
        openTutorDetailPage(tutor).catch(() => {});
        return;
      }
      try {
        const response = await fetch(`/api/apps/${appId}/proxy/tutors/${encodeURIComponent(tutorId)}`);
        const data = await response.json();
        tutor = data.bodyJson?.data;
        if (tutor) {
          tutorsCache.set(String(tutor.id), tutor);
          openTutorDetailPage(tutor).catch(() => {});
        }
      } catch {
        showToast("Eğitmen detayı alınamadı");
      }
      return;
    }
    const editBtn = e.target.closest("[data-edit-tutor]");
    if (editBtn) {
      const tutor = tutorsCache.get(editBtn.getAttribute("data-edit-tutor"));
      if (tutor) openTutorDialog(tutor);
      return;
    }
    const delBtn = e.target.closest("[data-delete-tutor]");
    if (delBtn) deleteTutor(delBtn.getAttribute("data-delete-tutor"));
  });

  $("closeTutorDialogBtn")?.addEventListener("click", () => $("tutorDialog").close());
  $("tutorDetailBody")?.addEventListener("click", (e) => {
    if (e.target.closest("#tutorDetailUploadPhotoBtn")) {
      e.preventDefault();
      uploadTutorDetailAsset("photo").catch(() => {});
      return;
    }
    if (e.target.closest("#tutorDetailUploadRivBtn")) {
      e.preventDefault();
      uploadTutorDetailAsset("riv").catch(() => {});
      return;
    }
    if (e.target.closest("#tutorDetailSaveVoiceBtn")) {
      e.preventDefault();
      saveTutorDetailVoice().catch(() => {});
    }
  });
  $("tutorDetailBody")?.addEventListener("change", (e) => {
    if (e.target.id === "tutorDetailVoiceId") {
      updateVoicePreviewFor("tutorDetailVoiceId", "tutorDetailVoicePreview");
    }
  });

  $("tutorCategory")?.addEventListener("change", () => {
    syncTutorFormVoiceOptions($("tutorVoiceId")?.value || "");
  });
  $("tutorVoiceId")?.addEventListener("change", () => {
    updateVoicePreviewFor("tutorVoiceId", "tutorVoicePreview");
  });

  $("closeTutorDetailBtn")?.addEventListener("click", () => closeTutorDetailPage());
  $("editTutorFromDetailBtn")?.addEventListener("click", () => {
    if (!canManage || !viewingTutorId) return;
    const tutor = tutorsCache.get(viewingTutorId);
    if (tutor) openTutorDialog(tutor);
  });
  $("tutorForm")?.addEventListener("submit", saveTutorForm);

  (async function init() {
    if (window.PanelAuth) {
      const sessionUser = await window.PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = window.PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    lbTutorUi()?.bindTutorFormLivePreview($);
    try {
      await loadAppMeta();
      await Promise.all([loadHealth(), loadAnalyse(), window.RevenueCatPanel?.load?.(appId)]);
    } catch {
      setHealthBadge(false, "Yükleme hatası");
    }
  })();

  window.LingolaBuddyPanel = {
    openUserById(userId) {
      switchView("users");
      openUserDetail(String(userId)).catch(() => {});
    }
  };
})();
