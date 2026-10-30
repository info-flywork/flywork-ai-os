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
  const usersCache = new Map();

  let purchasesPage = 1;
  const purchasesLimit = 20;
  let purchasesPagination = null;
  let purchaseUserId = "";
  let purchaseEventType = "";
  let purchasePremiumGranted = "";
  const purchasesCache = new Map();

  let currentView = "overview";
  let sessionUser = null;
  let canManage = false;

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

  function formatMoney(price, currency) {
    if (price == null || Number.isNaN(Number(price))) return "—";
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currency || "TRY"
      }).format(Number(price));
    } catch {
      return `${price} ${currency || ""}`.trim();
    }
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("tr-TR");
    } catch {
      return iso;
    }
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

  function formatBillingDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(d);
  }

  function genderLabelTr(value) {
    const g = String(value || "").toLowerCase();
    if (g === "female") return "Kadın";
    if (g === "male") return "Erkek";
    return "—";
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

  function purchaseStatusLabelTr(status) {
    const map = { granted: "Verildi", expired: "Süresi doldu", logged: "Kayıtlı" };
    return map[status] || status || "—";
  }

  function eventTypeLabelTr(eventType) {
    const map = {
      INITIAL_PURCHASE: "İlk satın alma",
      RENEWAL: "Yenileme",
      EXPIRATION: "Süre dolumu",
      CANCELLATION: "İptal",
      BILLING_ISSUE: "Ödeme sorunu",
      PRODUCT_CHANGE: "Ürün değişimi",
      UNCANCELLATION: "İptal geri alındı",
      SUBSCRIPTION_PAUSED: "Abonelik duraklatıldı",
      TRANSFER: "Transfer"
    };
    return map[eventType] || eventType || "—";
  }

  function usersFromBody(bodyJson) {
    return bodyJson?.users ?? bodyJson?.data ?? [];
  }

  function purchasesFromBody(bodyJson) {
    return bodyJson?.purchases ?? bodyJson?.data ?? [];
  }

  function entityFromBody(bodyJson) {
    if (!bodyJson) return null;
    return bodyJson.user ?? bodyJson.data ?? bodyJson.purchase ?? null;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    const detail = body?.msg || body?.message || data?.error;
    if (detail && data?.statusCode) {
      return `${detail} (HTTP ${data.statusCode})`;
    }
    if (detail) return detail;
    if (data?.statusCode) return `${fallback} (HTTP ${data.statusCode})`;
    return fallback;
  }

  function setHealthBadge(ok, text) {
    const el = $("healthBadge");
    el.className = "badge " + (ok ? "ok" : "fail");
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function purchaseStatusClass(status) {
    if (status === "granted") return "ok";
    if (status === "expired") return "fail";
    return "warn";
  }

  function applyUserFilters(items = []) {
    let list = Array.isArray(items) ? items.slice() : [];
    if (userPremiumFilter) {
      list = list.filter((u) =>
        userPremiumFilter === "yes" ? Boolean(u?.extras?.isPremium) : !u?.extras?.isPremium
      );
    }
    if (userAuthFilter) {
      list = list.filter((u) => String(u?.extras?.authProvider || "").toLowerCase() === userAuthFilter);
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
      list = list.filter((u) =>
        String(u?.extras?.preferredLanguage || "").toLowerCase().includes(lang)
      );
    }
    return list;
  }

  function activityKindLabelTr(kind) {
    const map = {
      purchase: "Satın alım",
      session: "AI oturumu",
      notification: "Bildirim",
      report: "Şikayet"
    };
    return map[kind] || kind || "—";
  }

  function notificationStatusTr(status) {
    const map = { sent: "Gönderildi", failed: "Başarısız", pending: "Bekliyor" };
    return map[String(status || "").toLowerCase()] || status || "—";
  }

  function reportStatusTr(status) {
    const map = { open: "Açık", reviewed: "İncelendi", dismissed: "Reddedildi" };
    return map[String(status || "").toLowerCase()] || status || "—";
  }

  function setStatsLoading(loading) {
    for (const id of [
      "statTotal",
      "statLogins",
      "statNew",
      "statPremium",
      "statAiSessions",
      "statTotalMessages",
      "statMessagesToday"
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
    document.querySelectorAll(".view-panel").forEach((el) => {
      el.classList.toggle("active", el.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    if (view === "users") loadUsers();
    if (view === "personas" && window.ChatfacePersonasPanel?.load) {
      window.ChatfacePersonasPanel.load();
    }
    if (view === "purchases") loadPurchases();
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
    const name = app.appName || "ChatFace";
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
      iconFallback.textContent = (name.charAt(0) || "C").toUpperCase();
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
      [
        "statTotal",
        "statLogins",
        "statNew",
        "statPremium",
        "statAiSessions",
        "statTotalMessages",
        "statMessagesToday"
      ].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = "—";
      });
      ["statWeeklyLogins", "statWeeklyNewUsers", "statDailyAvgLogins", "statSubscriptionEvents"].forEach(
        (id) => {
          const el = $(id);
          if (el) el.textContent = "—";
        }
      );
      const chart = $("dailyMiniChart");
      if (chart) chart.innerHTML = "";
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      return;
    }

    const summary = data.bodyJson?.summary || {};
    $("statTotal").textContent = formatNumber(summary.totalUsers);
    $("statLogins").textContent = formatNumber(summary.loginsToday);
    $("statNew").textContent = formatNumber(summary.newUsersToday);
    $("statPremium").textContent = formatNumber(summary.premiumUsers);
    const setVal = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    setVal("statAiSessions", formatNumber(summary.totalAiSessions));
    setVal("statTotalMessages", formatNumber(summary.totalMessages));
    setVal("statMessagesToday", formatNumber(summary.messagesToday));
    setVal("statTotalPersonas", formatNumber(summary.totalPersonas));
    setVal("statActivePersonas", formatNumber(summary.activePersonas));

    const version = data.bodyJson?.contractVersion;
    $("analyseHint").textContent = version
      ? `Sözleşme v${version} · Giriş metrikleri last_login_at üzerinden hesaplanır (Europe/Istanbul).`
      : "Giriş metrikleri last_login_at üzerinden hesaplanır.";

    setVal("statSubscriptionEvents", formatNumber(summary.subscriptionEventsTotal));

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
            <div class="mini-bar" style="height:${h}px" title="${row.date}: ${logins} giriş"></div>
            <div class="mini-meta">${newUsers}</div>
            <div class="mini-label">${String(row.date || "").slice(5)}</div>
          </div>`;
        })
        .join("");
    }
    setVal("statWeeklyLogins", formatNumber(weeklyLogins));
    setVal("statWeeklyNewUsers", formatNumber(weeklyNew));
    setVal("statDailyAvgLogins", formatNumber(Math.round((weeklyLogins / days) * 10) / 10));

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
    const rcId = billing?.revenuecatCustomerId || knownRcId || String(userId);

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
      : `<tr><td colspan="4" class="user-cell-sub">Kayıtlı üyelik yok.</td></tr>`;

    const rcBtn = rcId
      ? `<button type="button" class="btn btn-sm" id="userRcBillingBtn" data-rc-id="${escapeHtml(rcId)}">RevenueCat abonelik detayı</button>`
      : `<span class="user-cell-sub">RevenueCat kimliği henüz bağlı değil.</span>`;

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
        switchView("revenuecat");
        window.RevenueCatPanel.openCustomerDetail(rcCustomerId, { productLabel: "Kullanıcı aboneliği" });
      } else {
        showToast("RevenueCat detayı açılamadı.");
      }
    });
  }

  function renderUserProfileCard(user, profile) {
    const card = $("userProfileCard");
    if (!card) return;
    const ex = user?.extras || {};
    const p = profile || {};
    const rows = [
      ["E-posta", user?.email],
      ["Görünen ad", user?.displayName],
      ["Durum", userStatusLabelTr(user?.status)],
      ["Giriş", authLabelTr(ex.authProvider)],
      ["Misafir", ex.isGuest ? "Evet" : "Hayır"],
      ["Premium", ex.isPremium ? `Evet · ${formatDateTime(ex.premiumEndtime)}` : "Hayır"],
      ["Onboarding", ex.onboardingCompleted ? "Tamamlandı" : "Eksik"],
      ["Ülke / dil", [ex.country, ex.preferredLanguage].filter(Boolean).join(" · ") || "—"],
      ["Yaş / cinsiyet", [p.age, genderLabelTr(ex.gender)].filter((v) => v && v !== "—").join(" · ") || "—"],
      ["Davet kodu", p.invitationCode],
      ["Kullandığı davet", p.usedReferralCode],
      ["Davet sayısı", formatNumber(p.referralCount)],
      ["RC müşteri", ex.revenuecatCustomerId || user?.id],
      ["Cihaz (misafir)", p.guestDeviceId ? `${String(p.guestDeviceId).slice(0, 24)}…` : "—"],
      ["Provider ID", p.providerId ? `${String(p.providerId).slice(0, 20)}…` : "—"],
      ["AI veri onayı", p.aiDataConsentAt ? formatDateTime(p.aiDataConsentAt) : "—"],
      ["Kayıt", formatDateTime(p.accountCreatedAt || user?.createdAt)],
      ["Son giriş", formatDateTime(p.lastLoginAt || user?.lastLoginAt)]
    ];
    card.innerHTML = `
      <div class="user-profile-grid">
        ${rows
          .map(
            ([label, value]) =>
              `<div class="user-profile-item"><span class="user-profile-label">${escapeHtml(label)}</span><span class="user-profile-value">${escapeHtml(value ?? "—")}</span></div>`
          )
          .join("")}
      </div>`;
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
    const recentPurchases = Array.isArray(insights.recentPurchases) ? insights.recentPurchases : [];
    const activity = Array.isArray(insights.activityTimeline) ? insights.activityTimeline : [];
    const sessions = Array.isArray(insights.recentSessions) ? insights.recentSessions : [];
    const follows = Array.isArray(insights.followedPersonas) ? insights.followedPersonas : [];
    const notifications = Array.isArray(insights.recentNotifications) ? insights.recentNotifications : [];
    const reports = Array.isArray(insights.messageReports) ? insights.messageReports : [];

    const titleName = user?.displayName || user?.email || `ID ${userId}`;
    $("userInsightsTitle").textContent = `Kullanıcı: ${titleName}`;

    renderUserProfileCard(user, insights.adminProfile);

    $("userStatSessions").textContent = formatNumber(summary.sessionCount ?? 0);
    $("userStatMessages").textContent = formatNumber(summary.messageCount ?? 0);
    $("userStatCalls").textContent = formatNumber(summary.callSessionCount ?? 0);
    $("userStatFollows").textContent = formatNumber(summary.followedPersonaCount ?? 0);
    $("userStatPurchases").textContent = formatNumber(summary.purchaseEventCount ?? 0);
    $("userStatTokens").textContent = `${formatNumber(summary.llmTokensIn ?? 0)} / ${formatNumber(summary.llmTokensOut ?? 0)}`;
    $("userStatTts").textContent = formatNumber(summary.ttsChars ?? 0);
    $("userStatLastSession").textContent = formatDateTime(summary.lastSessionAt);

    renderInsightsRows(
      "userActivityBody",
      activity,
      (item) => `<tr>
          <td class="user-cell-sub">${formatDateTime(item.at)}</td>
          <td>${escapeHtml(activityKindLabelTr(item.kind))}</td>
          <td>${escapeHtml(item.kind === "purchase" ? eventTypeLabelTr(item.title) : item.title || "—")}</td>
          <td class="user-cell-sub">${escapeHtml(item.detail || "—")}</td>
        </tr>`,
      "Henüz kayıtlı aktivite yok.",
      4
    );

    renderInsightsRows(
      "userSessionsBody",
      sessions,
      (s) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(s.personaName || s.personaId || "—")}</div><div class="user-cell-sub">${escapeHtml(s.sessionId?.slice?.(0, 8) || s.sessionId || "")}</div></td>
          <td>${escapeHtml(s.mode)}</td>
          <td class="user-cell-sub">${escapeHtml(s.languageCode || "—")}</td>
          <td>${formatNumber(s.messageCount)}</td>
          <td>${s.hadCall ? "Evet" : "Hayır"}</td>
          <td class="user-cell-sub">${formatDateTime(s.lastMessageAt || s.lastSeenAt)}</td>
        </tr>`,
      "AI oturumu yok.",
      6
    );

    renderInsightsRows(
      "userFollowsBody",
      follows,
      (f) => `<tr>
          <td>${escapeHtml(f.personaName || f.personaId || "—")}</td>
          <td class="user-cell-sub">${formatDateTime(f.followedAt)}</td>
        </tr>`,
      "Takip edilen karakter yok.",
      2
    );

    renderInsightsRows(
      "userNotificationsBody",
      notifications,
      (n) => `<tr>
          <td class="user-cell-sub">${formatDateTime(n.sentAt)}</td>
          <td class="user-cell-sub">${escapeHtml(n.type || "—")}</td>
          <td>${escapeHtml(n.title || "—")}</td>
          <td>${escapeHtml(notificationStatusTr(n.status))}${n.isRead ? " · Okundu" : ""}</td>
        </tr>`,
      "Bildirim kaydı yok.",
      4
    );

    renderInsightsRows(
      "userReportsBody",
      reports,
      (r) => `<tr>
          <td class="user-cell-sub">${formatDateTime(r.createdAt)}</td>
          <td>${escapeHtml(r.reason || "—")}</td>
          <td>${escapeHtml(reportStatusTr(r.status))}</td>
          <td class="user-cell-sub">${escapeHtml(r.sessionId?.slice?.(0, 12) || r.sessionId || "—")}</td>
        </tr>`,
      "Şikayet kaydı yok.",
      4
    );

    renderInsightsRows(
      "userInsightsPurchasesBody",
      recentPurchases,
      (p) => `<tr>
          <td class="user-cell-sub">${formatDateTime(p.createdAt)}</td>
          <td>${escapeHtml(eventTypeLabelTr(p.eventType))}</td>
          <td class="user-cell-sub">${escapeHtml(p.productId || "—")}</td>
          <td>${formatMoney(p.price, p.currency)}</td>
          <td><span class="status-pill ${purchaseStatusClass(p.status)}">${escapeHtml(purchaseStatusLabelTr(p.status))}</span></td>
        </tr>`,
      "Bu kullanıcı için kayıtlı satın alım olayı yok.",
      5
    );

    await loadUserBillingBlock(userId, user?.extras?.revenuecatCustomerId || null);
    openUserInsightsPanel();
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editCountry").value = ex.country || "";
    $("editLang").value = ex.preferredLanguage || "";
    $("editGender").value = ex.gender || "";
    $("editAbout").value = ex.aboutMe || "";
    $("editStatus").value = user.status === "inactive" ? "inactive" : "active";

    const meta = [];
    if (ex.authProvider) meta.push(`Giriş: ${authLabelTr(ex.authProvider)}`);
    if (ex.isGuest) meta.push("Misafir");
    if (ex.isPremium != null) meta.push(ex.isPremium ? "Premium" : "Ücretsiz");
    if (ex.premiumEndtime) meta.push(`Premium bitiş: ${formatDate(ex.premiumEndtime)}`);
    if (ex.invitationCode) meta.push(`Davet: ${ex.invitationCode}`);
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";

    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = `<tr><td colspan="8" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const hasClientFilters = userPremiumFilter || userAuthFilter || userGenderFilter || userLangFilter;
    const effectiveLimit = usersSearch || hasClientFilters ? 100 : usersLimit;
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

    let users = usersFromBody(data.bodyJson);
    users = applyUserFilters(users);
    usersPagination = data.bodyJson?.pagination || null;
    usersCache.clear();
    users.forEach((u) => usersCache.set(String(u.id), u));

    $("usersMeta").textContent = usersPagination
      ? `${formatNumber(usersPagination.total)} kullanıcı · sayfa ${usersPagination.page}/${usersPagination.totalPages}`
      : `${users.length} kayıt`;

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const label = user.displayName || user.email || `ID ${user.id}`;
            const sub = user.displayName && user.email ? user.email : "";
            const ex = user.extras || {};
            const premium = ex.isPremium ? "Premium" : "Ücretsiz";
            const onboarding = ex.onboardingCompleted ? "" : " · Onboarding eksik";
            return `<tr data-user-id="${user.id}">
              <td><div class="user-cell-title">${escapeHtml(label)}</div>${sub ? `<div class="user-cell-sub">${escapeHtml(sub)}${onboarding}</div>` : ""}</td>
              <td>${escapeHtml(genderLabelTr(ex.gender))}</td>
              <td class="user-cell-sub">${escapeHtml(ex.preferredLanguage || "—")}</td>
              <td>${escapeHtml(authLabelTr(ex.authProvider))}${ex.isGuest ? " · Misafir" : ""}</td>
              <td><span class="status-pill ${ex.isPremium ? "ok" : ""}">${premium}</span></td>
              <td class="user-cell-sub">${formatDateTime(user.lastLoginAt)}</td>
              <td class="user-cell-sub">${formatDateTime(user.createdAt)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-ghost" data-user-detail="${user.id}">Detay</button>
                ${
                  canManage
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button>`
                    : ""
                }
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8"><p class="user-cell-sub">Eşleşen kullanıcı yok</p></td></tr>`;

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function openPurchaseDetail(purchase) {
    const rows = [
      ["ID", purchase.id],
      ["Kullanıcı", purchase.userDisplayName || purchase.userEmail || purchase.userId],
      ["Olay", eventTypeLabelTr(purchase.eventType)],
      ["Kaynak", purchase.source],
      ["Ürün", purchase.productId],
      ["Mağaza", purchase.store],
      ["Dönem", purchase.periodType],
      ["Satın alma", formatDate(purchase.purchasedAt)],
      ["Bitiş", formatDate(purchase.expiresAt)],
      ["Tutar", formatMoney(purchase.price, purchase.currency)],
      ["Premium", purchase.premiumGranted ? "Evet" : "Hayır"],
      ["Durum", purchaseStatusLabelTr(purchase.status)],
      ["Kayıt", formatDate(purchase.createdAt)]
    ];

    $("purchaseDetailBody").innerHTML = `
      <table class="data-table">
        <tbody>
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td class="user-cell-sub" style="width:140px">${k}</td><td>${escapeHtml(v ?? "—")}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
    $("purchaseDetailDialog").showModal();
  }

  async function loadPurchases() {
    $("purchasesError").hidden = true;
    $("purchasesBody").innerHTML = `<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: purchasesPage, limit: purchasesLimit });
    if (purchaseUserId) params.set("userId", purchaseUserId);
    if (purchaseEventType) params.set("eventType", purchaseEventType);
    if (purchasePremiumGranted) params.set("premiumGranted", purchasePremiumGranted);

    const response = await fetch(`/api/apps/${appId}/proxy/purchases?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("purchasesBody").innerHTML = "";
      $("purchasesError").hidden = false;
      $("purchasesError").textContent = apiErrorMessage(data, "Satın alım listesi alınamadı.");
      $("purchasesMeta").textContent = "Liste alınamadı";
      $("purchasePrevBtn").disabled = true;
      $("purchaseNextBtn").disabled = true;
      return;
    }

    const purchases = purchasesFromBody(data.bodyJson);
    purchasesPagination = data.bodyJson?.pagination || null;
    purchasesCache.clear();
    purchases.forEach((p) => purchasesCache.set(String(p.id), p));

    $("purchasesMeta").textContent = purchasesPagination
      ? `${formatNumber(purchasesPagination.total)} kayıt · sayfa ${purchasesPagination.page}/${purchasesPagination.totalPages}`
      : `${purchases.length} kayıt`;

    $("purchasesBody").innerHTML = purchases.length
      ? purchases
          .map((p) => {
            const userLabel = p.userDisplayName || p.userEmail || `ID ${p.userId}`;
            const status = p.status || "logged";
            return `<tr data-purchase-id="${p.id}">
              <td class="user-cell-sub">${formatDateTime(p.createdAt)}</td>
              <td><div class="user-cell-title">${escapeHtml(userLabel)}</div><div class="user-cell-sub">${escapeHtml(eventTypeLabelTr(p.eventType))}</div></td>
              <td class="user-cell-sub">${escapeHtml(p.productId || "—")}</td>
              <td>${formatMoney(p.price, p.currency)}</td>
              <td><span class="status-pill ${purchaseStatusClass(status)}">${escapeHtml(purchaseStatusLabelTr(status))}</span></td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-view-purchase="${p.id}">Detay</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6"><p class="user-cell-sub">Kayıt bulunamadı</p></td></tr>`;

    $("purchasePrevBtn").disabled = purchasesPage <= 1;
    $("purchaseNextBtn").disabled = purchasesPage >= (purchasesPagination?.totalPages || 1);
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
      if (currentView === "personas" && window.ChatfacePersonasPanel?.load) {
        await window.ChatfacePersonasPanel.load();
      }
      if (currentView === "purchases") await loadPurchases();
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

  $("searchBtn").addEventListener("click", () => {
    usersSearch = $("userSearch").value.trim();
    usersPage = 1;
    loadUsers();
  });

  $("userSearch").addEventListener("input", () => {
    clearTimeout(usersSearchDebounceTimer);
    usersSearchDebounceTimer = setTimeout(() => {
      usersSearch = $("userSearch").value.trim();
      usersPage = 1;
      loadUsers();
    }, 400);
  });

  $("userSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("searchBtn").click();
    }
  });

  ["userPremiumFilter", "userAuthFilter", "userGenderFilter"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      userPremiumFilter = $("userPremiumFilter")?.value || "";
      userAuthFilter = $("userAuthFilter")?.value || "";
      userGenderFilter = $("userGenderFilter")?.value || "";
      usersPage = 1;
      loadUsers();
    });
  });

  $("userLangFilter")?.addEventListener("input", () => {
    clearTimeout(usersSearchDebounceTimer);
    usersSearchDebounceTimer = setTimeout(() => {
      userLangFilter = $("userLangFilter").value.trim();
      usersPage = 1;
      loadUsers();
    }, 400);
  });

  $("userClearFilterBtn")?.addEventListener("click", () => {
    usersSearch = "";
    userPremiumFilter = "";
    userAuthFilter = "";
    userGenderFilter = "";
    userLangFilter = "";
    $("userSearch").value = "";
    $("userPremiumFilter").value = "";
    $("userAuthFilter").value = "";
    $("userGenderFilter").value = "";
    $("userLangFilter").value = "";
    usersPage = 1;
    loadUsers();
  });

  $("closeUserInsightsBtn")?.addEventListener("click", closeUserInsightsPanel);

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

  $("usersBody").addEventListener("click", (e) => {
    const detailBtn = e.target.closest("[data-user-detail]");
    if (detailBtn) {
      openUserInsights(detailBtn.getAttribute("data-user-detail"));
      return;
    }
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
    if (user) openEditUser(user);
  });

  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("userPurchasesBtn").addEventListener("click", () => {
    const userId = $("editUserId").value;
    $("editUserDialog").close();
    purchaseUserId = userId;
    $("purchaseUserFilter").value = userId;
    switchView("purchases");
    purchasesPage = 1;
    loadPurchases();
  });

  $("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;

    const extras = {};
    const country = $("editCountry").value.trim();
    const preferredLanguage = $("editLang").value.trim();
    const gender = $("editGender").value.trim();
    const aboutMe = $("editAbout").value.trim();
    if (country) extras.country = country;
    if (preferredLanguage) extras.preferredLanguage = preferredLanguage;
    if (gender) extras.gender = gender;
    if (aboutMe) extras.aboutMe = aboutMe;

    const payload = {
      displayName: $("editDisplayName").value.trim() || null,
      email: $("editEmail").value.trim() || null,
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

  $("purchaseSearchBtn").addEventListener("click", () => {
    purchaseUserId = $("purchaseUserFilter").value.trim();
    purchaseEventType = $("purchaseEventFilter").value;
    purchasePremiumGranted = $("purchasePremiumFilter").value;
    purchasesPage = 1;
    loadPurchases();
  });

  $("purchaseClearBtn").addEventListener("click", () => {
    purchaseUserId = "";
    purchaseEventType = "";
    purchasePremiumGranted = "";
    $("purchaseUserFilter").value = "";
    $("purchaseEventFilter").value = "";
    $("purchasePremiumFilter").value = "";
    purchasesPage = 1;
    loadPurchases();
  });

  $("purchasePrevBtn").addEventListener("click", () => {
    if (purchasesPage > 1) {
      purchasesPage -= 1;
      loadPurchases();
    }
  });

  $("purchaseNextBtn").addEventListener("click", () => {
    if (purchasesPage < (purchasesPagination?.totalPages || 1)) {
      purchasesPage += 1;
      loadPurchases();
    }
  });

  $("purchasesBody").addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view-purchase]");
    const id =
      viewBtn?.getAttribute("data-view-purchase") ||
      e.target.closest("tr[data-purchase-id]")?.getAttribute("data-purchase-id");
    if (!id) return;
    const purchase = purchasesCache.get(String(id));
    if (purchase) openPurchaseDetail(purchase);
  });

  $("closePurchaseDialogBtn").addEventListener("click", () => $("purchaseDetailDialog").close());

  window.ChatfacePanel = {
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
      .then(() => {
        document.dispatchEvent(
          new CustomEvent("chatface-panel-ready", { detail: { canManage } })
        );
        return Promise.all([loadHealth(), loadAnalyse()]);
      })
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();
})();
