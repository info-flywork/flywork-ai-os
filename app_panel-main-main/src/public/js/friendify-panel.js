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
  let usersSearchDebounceTimer = null;
  let userPremiumFilter = "";
  let userAuthFilter = "";
  let userGenderFilter = "";
  let userLangFilter = "";
  let userCreatedDateFilter = "";
  let userLastLoginDateFilter = "";
  const usersCache = new Map();

  let agentsPage = 1;
  const agentsLimit = 50;
  let agentsPagination = null;
  let agentsSearch = "";
  let agentsTypeFilter = "";
  let agentsOwnerFilter = "";
  let agentGenderFilter = "";
  let agentSortBy = "id_asc";
  let agentSearchDebounceTimer = null;
  let allAgentsLoaded = [];
  const agentsCache = new Map();
  let agentEditMode = "create";
  let pendingDeleteAgentId = null;
  let voiceOptionsCache = [];
  let currentView = "overview";
  let sessionUser = null;
  let canManage = false;

  const toast = document.getElementById("toast");

  function $(id) {
    return document.getElementById(id);
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

  function truncateText(value, max = 25) {
    const s = String(value || "");
    if (s.length <= max) return s;
    return `${s.slice(0, max)}...`;
  }

  function genderLabelTr(value) {
    const g = String(value || "").toLowerCase();
    if (g === "female") return "KADIN";
    if (g === "male") return "ERKEK";
    return "-";
  }

  function authLabelTr(value) {
    const a = String(value || "").toLowerCase();
    if (!a) return "-";
    if (a === "guest") return "MİSAFİR";
    if (a === "apple") return "APPLE";
    if (a === "google") return "GOOGLE";
    if (a === "email") return "E-POSTA";
    return a.toLocaleUpperCase("tr-TR");
  }

  function shortProviderId(value) {
    const v = String(value || "").trim();
    if (!v) return "-";
    if (v.length <= 18) return v;
    return `${v.slice(0, 10)}...${v.slice(-6)}`;
  }

  function toDisplayName(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    return s
      .split(/\s+/)
      .map((p) => p.charAt(0).toLocaleUpperCase("tr-TR") + p.slice(1))
      .join(" ");
  }

  function isoDatePart(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  function listFromBody(bodyJson) {
    if (!bodyJson) return [];
    return bodyJson.data ?? bodyJson.users ?? bodyJson.agents ?? [];
  }

  function entityFromBody(bodyJson) {
    if (!bodyJson) return null;
    return bodyJson.data ?? bodyJson.user ?? bodyJson.agent ?? null;
  }

  function applyUserSearch(items = []) {
    const q = String(usersSearch || "").trim().toLocaleLowerCase("tr-TR");
    if (!q) return Array.isArray(items) ? items : [];
    return (Array.isArray(items) ? items : []).filter((u) => {
      const haystack = [u?.displayName, u?.email, u?.phone, String(u?.id || ""), u?.extras?.providerId]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(q);
    });
  }

  function applyUserFilters(items = []) {
    let list = Array.isArray(items) ? items.slice() : [];
    if (userPremiumFilter) {
      list = list.filter((u) =>
        userPremiumFilter === "yes" ? Boolean(u?.extras?.isPremium) : !u?.extras?.isPremium
      );
    }
    if (userAuthFilter) {
      list = list.filter((u) => String(u?.extras?.credential || "").toLowerCase() === userAuthFilter);
    }
    if (userGenderFilter) {
      list = list.filter((u) => {
        const g = String(u?.extras?.gender || "").toLowerCase();
        if (userGenderFilter === "other") return !(g === "female" || g === "male");
        return g === userGenderFilter;
      });
    }
    if (userLangFilter) {
      const lang = String(userLangFilter).trim().toLowerCase();
      list = list.filter((u) => String(u?.extras?.nativeLang || "").toLowerCase().includes(lang));
    }
    if (userCreatedDateFilter) {
      list = list.filter((u) => isoDatePart(u?.createdAt) === userCreatedDateFilter);
    }
    if (userLastLoginDateFilter) {
      list = list.filter((u) => isoDatePart(u?.lastLoginAt) === userLastLoginDateFilter);
    }
    return list;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    if (body?.code === "PANEL_UNAUTHORIZED") return "Panel API anahtarı hatalı veya eksik.";
    if (body?.code === "PANEL_NOT_CONFIGURED") return "Friendify sunucusunda PANEL_API_KEY tanımlı değil.";
    if (body?.code === "EMAIL_IN_USE") return "Bu e-posta başka kullanıcıda.";
    const detail = body?.msg || body?.message || body?.error || data?.error;
    if (detail && data?.statusCode) return `${detail} (HTTP ${data.statusCode})`;
    if (detail) return detail;
    if (data?.statusCode) return `${fallback} (HTTP ${data.statusCode})`;
    return fallback;
  }

  function setHealthBadge(ok, text) {
    const el = $("healthBadge");
    el.className = "badge " + (ok ? "ok" : "fail");
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function agentTypeLabel(type) {
    const map = { custom: "Kullanıcı", catalog: "Katalog", template: "Şablon" };
    return map[type] || type || "—";
  }

  function ownerLabel(owner) {
    if (!owner) return "—";
    if (owner.isSystemOwner) return "Sistem / katalog";
    return owner.displayName || owner.email || owner.id || "—";
  }

  function setStatsLoading(loading) {
    for (const id of ["statTotal", "statLogins", "statNew", "statAgents"]) {
      $(id).classList.toggle("loading", loading);
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
    document.querySelectorAll(".view-panel").forEach((el) => {
      el.classList.toggle("active", el.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    if (view === "users") loadUsers();
    if (view === "agents") loadAgents();
    if (view === "revenuecat" && window.RevenueCatPanel?.load) {
      window.RevenueCatPanel.load(appId);
    }
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
    const name = app.appName || "Friendify";
    $("appTitle").textContent = name;
    $("sidebarAppName").textContent = name;
    $("breadcrumbName").textContent = name;

    const iconWrap = $("headerAppIconWrap");
    const iconImg = $("headerAppIcon");
    const iconFallback = $("headerAppIconFallback");
    if (app.iconUrl && iconImg) {
      iconImg.src = app.iconUrl;
      iconImg.hidden = false;
      if (iconFallback) iconFallback.hidden = true;
    } else if (iconFallback) {
      iconFallback.textContent = (name.charAt(0) || "F").toUpperCase();
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

  async function loadAnalyse() {
    $("dailyError").hidden = true;
    setStatsLoading(true);
    const response = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await response.json();
    setStatsLoading(false);

    if (!data.ok) {
      ["statTotal", "statLogins", "statNew", "statAgents"].forEach((id) => {
        $(id).textContent = "—";
      });
      const chart = $("dailyMiniChart");
      if (chart) chart.innerHTML = "";
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      return;
    }

    const summary = data.bodyJson?.summary || {};
    const agentsSummary = data.bodyJson?.agentsSummary || {};

    $("statTotal").textContent = formatNumber(summary.totalUsers);
    $("statLogins").textContent = formatNumber(summary.loginsToday);
    $("statNew").textContent = formatNumber(summary.newUsersToday);
    $("statAgents").textContent = formatNumber(agentsSummary.totalAgents);

    const byType = agentsSummary.byType || {};
    const parts = [];
    if (byType.catalog != null) parts.push(`Katalog: ${formatNumber(byType.catalog)}`);
    if (byType.custom != null) parts.push(`Kullanıcı: ${formatNumber(byType.custom)}`);
    if (byType.template != null) parts.push(`Şablon: ${formatNumber(byType.template)}`);
    if (agentsSummary.newAgentsToday != null) {
      parts.push(`Bugün yeni: ${formatNumber(agentsSummary.newAgentsToday)}`);
    }
    const tz = data.bodyJson?.timezone;
    $("agentsTypeHint").textContent = [
      parts.length ? parts.join(" · ") : "",
      tz ? `Metrikler ${tz} saat dilimine göre hesaplanır.` : ""
    ]
      .filter(Boolean)
      .join(" · ");

    const daily = Array.isArray(data.bodyJson?.daily) ? data.bodyJson.daily.slice().reverse() : [];
    const last7 = daily.slice(0, 7).reverse();
    const weeklyLogins = last7.reduce((acc, row) => acc + Number(row.logins || 0), 0);
    const weeklyNew = last7.reduce((acc, row) => acc + Number(row.newUsers || 0), 0);
    const days = Math.max(last7.length, 1);
    const maxLogins = Math.max(...last7.map((d) => Number(d.logins || 0)), 1);
    const chart = $("dailyMiniChart");
    if (chart) {
      chart.innerHTML = last7
        .map((row) => {
          const logins = Number(row.logins || 0);
          const newUsers = Number(row.newUsers || 0);
          const h = Math.max(Math.round((logins / maxLogins) * 80), 6);
          return `<div class="mini-day">
            <div class="mini-bar" style="height:${h}px" title="${row.date}: ${logins} aktivite"></div>
            <div class="mini-meta">${newUsers}</div>
            <div class="mini-label">${String(row.date || "").slice(5)}</div>
          </div>`;
        })
        .join("");
    }
    const setVal = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statDailyAvgLogins", formatNumber(Math.round((weeklyLogins / days) * 10) / 10));
    setVal("statDailyAvgNewUsers", formatNumber(Math.round((weeklyNew / days) * 10) / 10));

    const maxDailyLogins = Math.max(...daily.map((d) => Number(d.logins || 0)), 1);
    const maxDailyNew = Math.max(...daily.map((d) => Number(d.newUsers || 0)), 1);
    $("dailyBody").innerHTML = daily.length
      ? daily
          .map((row) => {
            const logins = Number(row.logins || 0);
            const newUsers = Number(row.newUsers || 0);
            const loginW = Math.max(Math.round((logins / maxDailyLogins) * 100), logins > 0 ? 8 : 0);
            const newW = Math.max(Math.round((newUsers / maxDailyNew) * 100), newUsers > 0 ? 8 : 0);
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
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="user-cell-sub">Veri yok</td></tr>`;
  }

  function openUserInsightsPanel() {
    $("usersListArea").hidden = true;
    $("userInsightsPanel").hidden = false;
    $("userInsightsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeUserInsightsPanel() {
    $("userInsightsPanel").hidden = true;
    $("usersListArea").hidden = false;
  }

  function renderInsightsRows(targetId, rows, renderer, emptyText, colSpan) {
    const body = $(targetId);
    if (!body) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      body.innerHTML = `<tr><td colspan="${colSpan}"><p class="user-cell-sub">${emptyText}</p></td></tr>`;
      return;
    }
    body.innerHTML = rows.map(renderer).join("");
  }

  async function openUserInsights(userId) {
    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}/details`);
    const data = await response.json();
    if (!data.ok) {
      showToast(apiErrorMessage(data, "Kullanıcı detayları alınamadı."));
      return;
    }

    const user = entityFromBody(data.bodyJson);
    const insights = user?.insights || {};
    const summary = insights.summary || {};
    const linkedAgents = Array.isArray(insights.linkedAgents) ? insights.linkedAgents : [];
    const ownedAgents = Array.isArray(insights.ownedAgents) ? insights.ownedAgents : [];

    const titleName = toDisplayName(user?.displayName || "") || user?.email || `ID ${userId}`;
    $("userInsightsTitle").textContent = `Kullanıcı: ${titleName}`;
    $("userStatLinkedAgents").textContent = formatNumber(summary.linkedAgentCount ?? linkedAgents.length);
    $("userStatConversations").textContent = formatNumber(summary.conversationCount ?? 0);
    $("userStatMessages").textContent = formatNumber(summary.messageCount ?? 0);
    $("userStatOwnedAgents").textContent = formatNumber(summary.ownedAgentCount ?? ownedAgents.length);

    renderInsightsRows(
      "userInsightsAgentsBody",
      linkedAgents,
      (agent) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(agent.displayName || `Agent #${agent.agentId}`)}</div><div class="user-cell-sub">ID ${escapeHtml(agent.agentId)}</div></td>
          <td>${escapeHtml(agentTypeLabel(agent.agentType))}</td>
          <td>${formatDateTime(agent.firstChatAt)}</td>
          <td>${formatDateTime(agent.lastMessageAt)}</td>
          <td>${formatNumber(agent.messageCount)}</td>
        </tr>`,
      "Bu kullanıcı henüz agentlarla sohbet etmemiş.",
      5
    );

    renderInsightsRows(
      "userInsightsOwnedBody",
      ownedAgents,
      (agent) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(agent.displayName || `Agent #${agent.agentId}`)}</div><div class="user-cell-sub">ID ${escapeHtml(agent.agentId)}</div></td>
          <td>${escapeHtml(agentTypeLabel(agent.agentType))}</td>
          <td>${formatDateTime(agent.createdAt)}</td>
        </tr>`,
      "Bu kullanıcının oluşturduğu agent yok.",
      3
    );

    await loadUserBillingBlock(userId, user?.extras?.revenuecatCustomerId || null);
    openUserInsightsPanel();
  }

  function formatBillingDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(d);
  }

  async function loadUserBillingBlock(userId, knownRcId) {
    const block = $("userBillingBlock");
    if (!block) return;
    block.innerHTML = `<p class="user-cell-sub">Ödeme kayıtları yükleniyor…</p>`;

    const billingRes = await fetch(
      `/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}/billing`
    );
    const billingData = await billingRes.json();
    const billing = billingData.ok ? billingData.bodyJson : null;
    const memberships = Array.isArray(billing?.memberships) ? billing.memberships : [];
    const rcId = billing?.revenuecatCustomerId || knownRcId || null;

    const membershipRows = memberships.length
      ? memberships
          .map(
            (m) => `<tr>
            <td>${escapeHtml(m.productId || m.type || "—")}</td>
            <td>${m.isActive ? "Aktif" : "Pasif"}</td>
            <td class="user-cell-sub">${escapeHtml(formatBillingDate(m.purchasedAt || m.startDate))}</td>
            <td class="user-cell-sub">${escapeHtml(formatBillingDate(m.endDate))}</td>
          </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="user-cell-sub">Kayıtlı üyelik / fiş yok.</td></tr>`;

    const rcBtn = rcId
      ? `<button type="button" class="btn btn-sm" id="userRcBillingBtn" data-rc-id="${escapeHtml(rcId)}">RevenueCat abonelik ve faturalar</button>`
      : `<span class="user-cell-sub">RevenueCat kimliği henüz kayıtlı değil — kullanıcı uygulamayı açıp premium senkronu yaptığında bağlanır.</span>`;

    block.innerHTML = `
      <div class="user-cell-sub" style="margin-bottom:8px">${escapeHtml(billing?.invoiceNote || "")}</div>
      ${rcId ? `<div class="user-cell-sub" style="margin-bottom:8px">RC müşteri: <code>${escapeHtml(rcId)}</code></div>` : ""}
      <div class="table-wrap" style="margin-bottom:10px">
        <table class="data-table data-table--compact">
          <thead><tr><th>Ürün / tür</th><th>Durum</th><th>Satın alma</th><th>Bitiş</th></tr></thead>
          <tbody>${membershipRows}</tbody>
        </table>
      </div>
      ${rcBtn}
    `;

    block.querySelector("#userRcBillingBtn")?.addEventListener("click", (e) => {
      const rcCustomerId = e.currentTarget.getAttribute("data-rc-id");
      if (rcCustomerId && window.RevenueCatPanel?.openCustomerDetail) {
        window.RevenueCatPanel.openCustomerDetail(rcCustomerId, { productLabel: "Kullanıcı aboneliği" });
      } else {
        showToast("RevenueCat detayı açılamadı.");
      }
    });
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editPhone").value = user.phone || "";
    $("editGender").value = ex.gender || "";
    $("editCountry").value = ex.country || "";
    $("editStatus").value = user.status || "active";
    const meta = [];
    if (ex.credential) meta.push(`Giriş: ${authLabelTr(ex.credential)}`);
    if (ex.isPremium != null) meta.push(ex.isPremium ? "Premium" : "Ücretsiz");
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";
    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = `<tr><td colspan="10" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const effectiveLimit = usersSearch ? 100 : usersLimit;
    const params = new URLSearchParams({ page: usersPage, limit: effectiveLimit });
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

    const users = applyUserFilters(applyUserSearch(listFromBody(data.bodyJson)));
    usersPagination = data.bodyJson?.pagination || null;
    usersCache.clear();
    users.forEach((u) => usersCache.set(String(u.id), u));

    $("usersMeta").textContent = usersPagination
      ? `${formatNumber(usersPagination.total)} kullanıcı · ${usersPagination.page}/${usersPagination.totalPages} (görünen: ${users.length})`
      : `${users.length} kayıt`;

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const labelRaw = user.displayName || user.email || `ID ${user.id}`;
            const label = truncateText(labelRaw, 25);
            const sub = user.email && user.displayName ? user.email : user.phone || "";
            const extras = user.extras || {};
            const premium = extras.isPremium ? "Premium" : "Hayır";
            return `<tr data-user-id="${user.id}" style="cursor:pointer">
              <td><div class="user-cell-title" title="${escapeHtml(labelRaw)}">${escapeHtml(label)}</div>${sub ? `<div class="user-cell-sub">${escapeHtml(sub)}</div>` : ""}</td>
              <td class="user-cell-sub">${extras.age ?? "—"}</td>
              <td class="user-cell-sub">${genderLabelTr(extras.gender)}</td>
              <td class="user-cell-sub">${extras.nativeLang ? String(extras.nativeLang).toLocaleUpperCase("tr-TR") : "-"}</td>
              <td class="user-cell-sub">${authLabelTr(extras.credential)}</td>
              <td class="user-cell-sub" title="${escapeHtml(extras.providerId || "")}">${shortProviderId(extras.providerId)}</td>
              <td class="user-cell-sub">${premium}</td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td>
                ${
                  canManage
                    ? `<div style="display:flex; gap:6px; justify-content:flex-end"><button type="button" class="btn btn-sm btn-ghost" data-user-detail="${user.id}">Detay</button><button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button></div>`
                    : `<button type="button" class="btn btn-sm btn-ghost" data-user-detail="${user.id}">Detay</button>`
                }
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="10"><p class="user-cell-sub">Eşleşen kullanıcı yok</p></td></tr>`;

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openAgentEditor() {
    const editor = $("editAgentDialog");
    const listArea = $("agentsListArea");
    if (!editor) return;
    if (listArea) listArea.hidden = true;
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeAgentEditor() {
    const editor = $("editAgentDialog");
    const listArea = $("agentsListArea");
    if (!editor) return;
    editor.hidden = true;
    if (listArea) listArea.hidden = false;
  }

  function clearAgentFiles() {
    ["agentPhoto1", "agentPhoto2", "agentPhoto3", "agentRiveFile"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
  }

  function countSelectedAgentPhotos() {
    return ["agentPhoto1", "agentPhoto2", "agentPhoto3"].filter((id) => $(id)?.files?.[0]).length;
  }

  function hasAgentUploadFiles() {
    return countSelectedAgentPhotos() > 0 || Boolean($("agentRiveFile")?.files?.[0]);
  }

  function renderAgentExistingMedia(agent) {
    const el = $("agentExistingMedia");
    if (!el) return;
    if (!agent) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const ex = agent.extras || {};
    const photos = ex.photoURLs?.length ? ex.photoURLs : ex.photoURL ? [ex.photoURL] : [];
    const rive = ex.riveAvatar || ex.rive_avatar;
    if (!photos.length && !rive) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const thumbs = photos
      .map(
        (url, i) =>
          `<figure class="agent-media-thumb"><img src="${escapeHtml(url)}" alt="" loading="lazy" /><figcaption>Foto ${i + 1}</figcaption></figure>`
      )
      .join("");
    const riveHtml = rive
      ? `<p class="field-hint">Rive: <a href="${escapeHtml(rive)}" target="_blank" rel="noopener">.riv dosyası</a></p>`
      : "";
    el.innerHTML = `<p class="user-cell-sub">Mevcut medya</p><div class="agent-photo-grid">${thumbs}</div>${riveHtml}`;
    el.hidden = false;
  }

  function updateAgentMediaUi() {
    const type = $("agentType").value;
    const isCatalogLike = type === "catalog" || type === "template";
    const urlBlock = $("agentUrlModeBlock");
    if (urlBlock) urlBlock.style.display = type === "custom" ? "block" : "none";
    $("agentMediaHint").textContent = isCatalogLike
      ? "Katalog/şablon: 3 foto (PNG/JPG, max 8 MB) ve .riv (max 25 MB) zorunlu. Foto güncellerken üçünü birlikte seçin."
      : "Custom agent: 1–3 foto ve Rive opsiyonel; dosya veya CDN URL kullanabilirsiniz.";
  }

  function toggleOwnerField() {
    const type = $("agentType").value;
    $("ownerIdField").style.display = type === "custom" ? "block" : "none";
    updateAgentMediaUi();
  }

  function voiceLabel(v) {
    const g = v.gender === "female" ? "Kadın" : v.gender === "male" ? "Erkek" : "Bilinmiyor";
    return `${v.name || v.voiceId} (${g})`;
  }

  function renderVoiceOptions(voices, selectedId, hint) {
    const select = $("agentVoiceId");
    const hintEl = $("agentVoiceHint");
    if (!select) return;

    const list = Array.isArray(voices) ? voices : [];
    select.innerHTML = "";
    if (!list.length) {
      select.disabled = true;
      select.innerHTML = `<option value="">Uygun ses bulunamadı</option>`;
      if (hintEl) hintEl.textContent = hint || "Bu cinsiyet için ses bulunamadı.";
      updateVoicePreview();
      return;
    }

    select.disabled = false;
    select.appendChild(new Option("Ses seçin", "", true, !selectedId));
    list.forEach((v) => {
      const opt = new Option(voiceLabel(v), v.voiceId || "");
      select.appendChild(opt);
    });

    if (selectedId && !list.some((v) => v.voiceId === selectedId)) {
      select.appendChild(new Option(`Kayıtlı ses (${selectedId.slice(0, 8)}...)`, selectedId));
    }
    if (selectedId) select.value = selectedId;
    if (hintEl) hintEl.textContent = hint || `${list.length} ses listelendi.`;
    updateVoicePreview();
  }

  async function loadVoiceOptions(gender, selectedId = "") {
    if (!gender) {
      renderVoiceOptions([], "", "Önce cinsiyet seçin.");
      return;
    }
    const params = new URLSearchParams({ gender });
    const response = await fetch(`/api/apps/${appId}/proxy/voices?${params}`);
    const data = await response.json();
    if (!data.ok) {
      renderVoiceOptions([], selectedId, "Ses listesi alınamadı.");
      return;
    }
    const voices = listFromBody(data.bodyJson);
    voiceOptionsCache = voices;
    const meta = data.bodyJson?.meta;
    const hint = meta?.fallbackUsed
      ? "Bu cinsiyet etiketiyle ses bulunamadı; tüm sesler listelendi."
      : `${voices.length} ses listelendi.`;
    renderVoiceOptions(voices, selectedId, hint);
  }

  function updateVoicePreview() {
    const select = $("agentVoiceId");
    const audio = $("agentVoicePreview");
    if (!select || !audio) return;
    const voiceId = select.value;
    const voice = voiceOptionsCache.find((v) => v.voiceId === voiceId);
    if (voice?.previewUrl) {
      audio.src = voice.previewUrl;
      audio.hidden = false;
    } else {
      audio.removeAttribute("src");
      audio.hidden = true;
    }
  }

  function applyAgentFiltersAndSort(agents) {
    let list = Array.isArray(agents) ? agents.slice() : [];
    const q = String(agentsSearch || "").trim().toLocaleLowerCase("tr-TR");
    if (q) {
      list = list.filter((a) => {
        const haystack = [a?.name, String(a?.id || ""), a?.extras?.character, a?.owner?.displayName]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("tr-TR");
        return haystack.includes(q);
      });
    }
    if (agentsTypeFilter) {
      list = list.filter((a) => String(a.agentType || "") === agentsTypeFilter);
    }
    if (agentGenderFilter) {
      list = list.filter((a) => String(a.extras?.gender || "").toLowerCase() === agentGenderFilter);
    }
    if (agentSortBy === "id_desc") {
      list.sort((a, b) => Number(b.id) - Number(a.id));
    } else {
      list.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return list;
  }

  function openCreateAgent() {
    if (!canManage) return;
    agentEditMode = "create";
    $("agentDialogTitle").textContent = "Yeni agent";
    $("editAgentId").value = "";
    $("agentName").value = "";
    $("agentType").value = "catalog";
    $("agentOwnerId").value = agentsOwnerFilter || "";
    $("agentVoiceId").value = "";
    $("agentCharacter").value = "";
    $("agentAge").value = "";
    $("agentGender").value = "";
    $("agentCountry").value = "tr";
    $("agentSpeakingStyle").value = "";
    $("agentPhotoURL").value = "";
    $("agentRiveUrl").value = "";
    clearAgentFiles();
    renderAgentExistingMedia(null);
    $("editAgentMessage").hidden = true;
    $("deleteAgentBtn").hidden = true;
    toggleOwnerField();
    loadVoiceOptions("", "");
    openAgentEditor();
  }

  function fillAgentForm(agent) {
    const ex = agent.extras || {};
    $("agentName").value = agent.name || "";
    $("agentType").value = agent.agentType || "catalog";
    $("agentOwnerId").value = ex.creatorId || agent.owner?.id || "";
    $("agentCharacter").value = ex.character || "";
    $("agentAge").value = ex.age ?? "";
    $("agentGender").value = ex.gender || "";
    $("agentCountry").value = ex.country || "";
    $("agentSpeakingStyle").value = ex.speakingStyle || "";
    $("agentPhotoURL").value = ex.photoURL || (ex.photoURLs && ex.photoURLs[0]) || "";
    $("agentRiveUrl").value = ex.riveAvatar || ex.rive_avatar || "";
    clearAgentFiles();
    renderAgentExistingMedia(agent);
    toggleOwnerField();
    loadVoiceOptions(ex.gender || "", ex.voiceId || "");
  }

  function openEditAgent(agent) {
    if (!canManage) return;
    agentEditMode = "edit";
    $("agentDialogTitle").textContent = `Agent: ${agent.name || agent.id}`;
    $("editAgentId").value = agent.id;
    fillAgentForm(agent);
    $("editAgentMessage").hidden = true;
    $("deleteAgentBtn").hidden = false;
    openAgentEditor();
  }

  function validateAgentMedia(isCreate) {
    const agentType = $("agentType").value;
    const isCatalogLike = agentType === "catalog" || agentType === "template";
    const photoCount = countSelectedAgentPhotos();
    const hasRive = Boolean($("agentRiveFile")?.files?.[0]);

    if (isCreate && isCatalogLike && !hasAgentUploadFiles()) {
      return "Katalog/şablon için 3 foto ve .riv dosyası yükleyin.";
    }
    if (isCreate && isCatalogLike) {
      if (photoCount !== 3) return "Katalog/şablon için tam 3 foto seçin.";
      if (!hasRive) return "Katalog/şablon için .riv dosyası zorunlu.";
    }
    if (!isCreate && isCatalogLike && photoCount > 0 && photoCount !== 3) {
      return "Foto güncellerken 3 fotoğrafı birlikte seçin.";
    }
    return null;
  }

  function buildAgentFormData() {
    const agentType = $("agentType").value;
    const fd = new FormData();
    fd.append("name", $("agentName").value.trim());
    fd.append("agentType", agentType);
    fd.append("voiceId", $("agentVoiceId").value.trim());

    const character = $("agentCharacter").value.trim();
    if (character) fd.append("character", character);

    const age = $("agentAge").value.trim();
    if (age) fd.append("age", age);
    const gender = $("agentGender").value.trim();
    if (gender) fd.append("gender", gender);
    const country = $("agentCountry").value.trim();
    if (country) fd.append("country", country);
    const speakingStyle = $("agentSpeakingStyle").value.trim();
    if (speakingStyle) fd.append("speakingStyle", speakingStyle);

    [["agentPhoto1", "photo1"], ["agentPhoto2", "photo2"], ["agentPhoto3", "photo3"]].forEach(([inputId, field]) => {
      const file = $(inputId)?.files?.[0];
      if (file) fd.append(field, file);
    });

    const riveFile = $("agentRiveFile")?.files?.[0];
    if (riveFile) fd.append("riveFile", riveFile);

    if (agentType === "custom") {
      const ownerId = $("agentOwnerId").value.trim();
      if (ownerId) fd.append("ownerId", ownerId);
    }

    return fd;
  }

  function buildAgentJsonPayload() {
    const agentType = $("agentType").value;
    const payload = {
      name: $("agentName").value.trim(),
      agentType,
      voiceId: $("agentVoiceId").value.trim(),
      character: $("agentCharacter").value.trim() || undefined
    };

    const age = $("agentAge").value.trim();
    if (age) payload.age = Number(age);
    const gender = $("agentGender").value.trim();
    if (gender) payload.gender = gender;
    const country = $("agentCountry").value.trim();
    if (country) payload.country = country;
    const speakingStyle = $("agentSpeakingStyle").value.trim();
    if (speakingStyle) payload.speakingStyle = speakingStyle;

    const photoURL = $("agentPhotoURL").value.trim();
    if (photoURL) payload.photoURLs = [photoURL];
    const riveUrl = $("agentRiveUrl").value.trim();
    if (riveUrl) payload.riveAvatar = riveUrl;

    if (agentType === "custom") {
      const ownerId = $("agentOwnerId").value.trim();
      if (ownerId) payload.ownerId = ownerId;
    }

    return payload;
  }

  async function loadAgents() {
    $("agentsError").hidden = true;
    $("agentsBody").innerHTML = `<tr><td colspan="5" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: 1, limit: 100 });
    if (agentsSearch) params.set("search", agentsSearch);
    if (agentsTypeFilter) params.set("agentType", agentsTypeFilter);
    if (agentsOwnerFilter) params.set("ownerId", agentsOwnerFilter);

    const response = await fetch(`/api/apps/${appId}/proxy/agents?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("agentsBody").innerHTML = "";
      $("agentsError").hidden = false;
      $("agentsError").textContent = apiErrorMessage(data, "Agent listesi alınamadı.");
      $("agentsMeta").textContent = "Liste alınamadı";
      $("agentPrevBtn").disabled = true;
      $("agentNextBtn").disabled = true;
      return;
    }

    allAgentsLoaded = listFromBody(data.bodyJson);
    agentsPagination = data.bodyJson?.pagination || null;
    agentsCache.clear();
    allAgentsLoaded.forEach((a) => agentsCache.set(String(a.id), a));

    const filtered = applyAgentFiltersAndSort(allAgentsLoaded);
    const pageSize = agentsLimit;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (agentsPage > totalPages) agentsPage = totalPages;
    const start = (agentsPage - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    $("agentsMeta").textContent = `${formatNumber(filtered.length)} agent · sayfa ${agentsPage}/${totalPages}`;

    $("agentsBody").innerHTML = pageItems.length
      ? pageItems
          .map((agent) => {
            const type = agent.agentType || "custom";
            return `<tr data-agent-id="${agent.id}" style="cursor:pointer">
              <td>
                <div class="user-cell-title">${escapeHtml(agent.name || "—")}</div>
                <div class="user-cell-sub">ID ${agent.id}</div>
              </td>
              <td><span class="agent-type-pill ${type}">${agentTypeLabel(type)}</span></td>
              <td class="user-cell-sub">${genderLabelTr(agent.extras?.gender)}</td>
              <td class="user-cell-sub">${escapeHtml(ownerLabel(agent.owner))}</td>
              <td>
                ${
                  canManage
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-agent="${agent.id}">Düzenle</button>`
                    : ""
                }
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5"><p class="user-cell-sub">Eşleşen agent yok</p></td></tr>`;

    $("agentPrevBtn").disabled = agentsPage <= 1;
    $("agentNextBtn").disabled = agentsPage >= totalPages;
  }

  async function refreshAll() {
    const btn = $("refreshBtn");
    btn.disabled = true;
    btn.textContent = "Yenileniyor...";
    try {
      await Promise.all([loadHealth(), loadAnalyse()]);
      if (currentView === "revenuecat" && window.RevenueCatPanel?.load) {
        await window.RevenueCatPanel.load(appId, { force: true, withFeed: false });
      }
      if (currentView === "users") await loadUsers();
      if (currentView === "agents") await loadAgents();
    } finally {
      btn.disabled = false;
      btn.textContent = "Yenile";
    }
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  $("settingsBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    window.location.href = `/apps/${appId}/edit`;
  });

  $("refreshBtn").addEventListener("click", () => refreshAll().catch(() => {}));

  function triggerUserSearch() {
    usersSearch = $("userSearch").value.trim();
    usersPage = 1;
    loadUsers();
  }

  $("userSearch")?.addEventListener("input", () => {
    clearTimeout(usersSearchDebounceTimer);
    usersSearchDebounceTimer = setTimeout(triggerUserSearch, 300);
  });

  ["userPremiumFilter", "userAuthFilter", "userGenderFilter", "userLangFilter", "userCreatedDateFilter", "userLastLoginDateFilter"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      userPremiumFilter = $("userPremiumFilter")?.value || "";
      userAuthFilter = $("userAuthFilter")?.value || "";
      userGenderFilter = $("userGenderFilter")?.value || "";
      userLangFilter = $("userLangFilter")?.value || "";
      userCreatedDateFilter = $("userCreatedDateFilter")?.value || "";
      userLastLoginDateFilter = $("userLastLoginDateFilter")?.value || "";
      loadUsers();
    });
  });

  $("userClearFilterBtn")?.addEventListener("click", () => {
    usersSearch = "";
    userPremiumFilter = "";
    userAuthFilter = "";
    userGenderFilter = "";
    userLangFilter = "";
    userCreatedDateFilter = "";
    userLastLoginDateFilter = "";
    $("userSearch").value = "";
    if ($("userPremiumFilter")) $("userPremiumFilter").value = "";
    if ($("userAuthFilter")) $("userAuthFilter").value = "";
    if ($("userGenderFilter")) $("userGenderFilter").value = "";
    if ($("userLangFilter")) $("userLangFilter").value = "";
    if ($("userCreatedDateFilter")) $("userCreatedDateFilter").value = "";
    if ($("userLastLoginDateFilter")) $("userLastLoginDateFilter").value = "";
    usersPage = 1;
    loadUsers();
  });

  $("prevPageBtn").addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });

  $("nextPageBtn").addEventListener("click", () => {
    if (usersPage < (usersPagination?.totalPages || 1)) {
      usersPage += 1;
      loadUsers();
    }
  });

  $("closeUserInsightsBtn")?.addEventListener("click", closeUserInsightsPanel);

  $("usersBody").addEventListener("click", (e) => {
    const detailBtn = e.target.closest("[data-user-detail]");
    if (detailBtn) {
      openUserInsights(detailBtn.getAttribute("data-user-detail"));
      return;
    }
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(String(editBtn.getAttribute("data-edit-user")));
    if (user) openEditUser(user);
  });

  $("usersBody").addEventListener("dblclick", (e) => {
    const row = e.target.closest("tr[data-user-id]");
    if (!row) return;
    openUserInsights(row.getAttribute("data-user-id"));
  });

  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("userAgentsBtn").addEventListener("click", () => {
    const userId = $("editUserId").value;
    $("editUserDialog").close();
    agentsOwnerFilter = userId;
    $("agentOwnerFilter").value = userId;
    switchView("agents");
    agentsPage = 1;
    loadAgents();
  });

  $("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;

    const extras = {};
    const gender = $("editGender").value.trim();
    const country = $("editCountry").value.trim();
    if (gender) extras.gender = gender;
    if (country) extras.country = country;

    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      email: $("editEmail").value.trim() || null,
      phone: $("editPhone").value.trim() || null,
      status: $("editStatus").value,
      ...(Object.keys(extras).length ? { extras } : {})
    };

    const submitBtn = e.submitter;
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
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("newAgentBtn")?.addEventListener("click", openCreateAgent);

  $("agentType").addEventListener("change", toggleOwnerField);

  $("agentGender")?.addEventListener("change", () => {
    const gender = $("agentGender").value;
    loadVoiceOptions(gender, $("agentVoiceId").value);
  });

  $("agentVoiceId")?.addEventListener("change", updateVoicePreview);

  function triggerAgentSearch() {
    agentsSearch = $("agentSearch").value.trim();
    agentsTypeFilter = $("agentTypeFilter")?.value || "";
    agentsOwnerFilter = $("agentOwnerFilter")?.value.trim() || "";
    agentGenderFilter = $("agentGenderFilter")?.value || "";
    agentSortBy = $("agentSortBy")?.value || "id_asc";
    agentsPage = 1;
    loadAgents();
  }

  $("agentSearch")?.addEventListener("input", () => {
    clearTimeout(agentSearchDebounceTimer);
    agentSearchDebounceTimer = setTimeout(triggerAgentSearch, 300);
  });

  ["agentTypeFilter", "agentGenderFilter", "agentSortBy", "agentOwnerFilter"].forEach((id) => {
    $(id)?.addEventListener("change", triggerAgentSearch);
  });

  $("agentClearFilterBtn").addEventListener("click", () => {
    agentsSearch = "";
    agentsTypeFilter = "";
    agentsOwnerFilter = "";
    agentGenderFilter = "";
    agentSortBy = "id_asc";
    $("agentSearch").value = "";
    if ($("agentTypeFilter")) $("agentTypeFilter").value = "";
    if ($("agentGenderFilter")) $("agentGenderFilter").value = "";
    if ($("agentOwnerFilter")) $("agentOwnerFilter").value = "";
    if ($("agentSortBy")) $("agentSortBy").value = "id_asc";
    agentsPage = 1;
    loadAgents();
  });

  $("agentPrevBtn").addEventListener("click", () => {
    if (agentsPage > 1) {
      agentsPage -= 1;
      loadAgents();
    }
  });

  $("agentNextBtn").addEventListener("click", () => {
    agentsPage += 1;
    loadAgents();
  });

  $("agentsBody").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-agent]");
    if (!editBtn || !canManage) return;
    const agent = agentsCache.get(String(editBtn.getAttribute("data-edit-agent")));
    if (agent) openEditAgent(agent);
  });

  $("agentsBody").addEventListener("dblclick", (e) => {
    if (!canManage) return;
    const row = e.target.closest("tr[data-agent-id]");
    if (!row) return;
    const agent = agentsCache.get(row.getAttribute("data-agent-id"));
    if (agent) openEditAgent(agent);
  });

  $("closeAgentDialogBtn").addEventListener("click", closeAgentEditor);

  $("deleteAgentBtn").addEventListener("click", () => {
    const id = $("editAgentId").value;
    const agent = agentsCache.get(String(id));
    pendingDeleteAgentId = id;
    $("deleteAgentText").textContent = `"${agent?.name || id}" kalıcı olarak silinecek. Emin misiniz?`;
    $("deleteAgentDialog").showModal();
  });

  $("cancelDeleteAgentBtn").addEventListener("click", () => $("deleteAgentDialog").close());

  $("confirmDeleteAgentBtn").addEventListener("click", async () => {
    if (!pendingDeleteAgentId) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/agents/${encodeURIComponent(pendingDeleteAgentId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    $("deleteAgentDialog").close();
    closeAgentEditor();
    if (!response.ok || !data.ok) {
      showToast(apiErrorMessage(data, "Silinemedi"));
      return;
    }
    showToast("Agent silindi");
    pendingDeleteAgentId = null;
    loadAgents();
    loadAnalyse();
  });

  $("editAgentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("editAgentMessage").hidden = true;

    const name = $("agentName").value.trim();
    const voiceId = $("agentVoiceId").value.trim();
    const agentType = $("agentType").value;
    const ownerId = $("agentOwnerId").value.trim();
    const gender = $("agentGender").value.trim();

    if (!name || !voiceId || !gender) {
      $("editAgentMessage").hidden = false;
      $("editAgentMessage").textContent = "İsim, cinsiyet ve ses seçimi zorunludur.";
      return;
    }
    if (agentType === "custom" && !ownerId) {
      $("editAgentMessage").hidden = false;
      $("editAgentMessage").textContent = "Custom agent için sahip kullanıcı id gerekli.";
      return;
    }

    const isCreate = agentEditMode === "create";
    const useMultipart = hasAgentUploadFiles() || (isCreate && (agentType === "catalog" || agentType === "template"));

    const mediaError = validateAgentMedia(isCreate);
    if (mediaError) {
      $("editAgentMessage").hidden = false;
      $("editAgentMessage").textContent = mediaError;
      return;
    }

    const submitBtn = e.submitter;
    submitBtn.disabled = true;

    try {
      const url = isCreate
        ? `/api/apps/${appId}/proxy/agents`
        : `/api/apps/${appId}/proxy/agents/${encodeURIComponent($("editAgentId").value)}`;
      const fetchOpts = { method: isCreate ? "POST" : "PATCH" };
      if (useMultipart) {
        fetchOpts.body = buildAgentFormData();
      } else {
        fetchOpts.headers = { "Content-Type": "application/json" };
        fetchOpts.body = JSON.stringify(buildAgentJsonPayload());
      }
      const response = await fetch(url, fetchOpts);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("editAgentMessage").hidden = false;
        $("editAgentMessage").textContent = apiErrorMessage(data, "Kayıt başarısız.");
        return;
      }
      const saved = data.bodyJson?.agent;
      if (saved) agentsCache.set(String(saved.id), saved);
      closeAgentEditor();
      showToast(isCreate ? "Agent oluşturuldu" : "Agent güncellendi");
      loadAgents();
      loadAnalyse();
    } finally {
      submitBtn.disabled = false;
    }
  });

  window.FriendifyPanel = {
    openUserById(userId) {
      if (!userId) return;
      switchView("users");
      openUserInsights(String(userId));
    }
  };

  (async () => {
    if (window.PanelAuth) {
      sessionUser = await PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    loadAppMeta()
      .then(() => Promise.all([loadHealth(), loadAnalyse()]))
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();
})();
