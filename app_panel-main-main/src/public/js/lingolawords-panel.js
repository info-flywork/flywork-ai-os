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
  let optionsCache = { languages: [], tracks: [] };

  let usersPage = 1;
  let usersPagination = null;
  let usersCache = new Map();

  let tracksPage = 1;
  let tracksPagination = null;
  let tracksCache = new Map();

  let wordsPage = 1;
  let wordsPagination = null;
  let wordsCache = new Map();

  let languagesCache = new Map();

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
    if (view === "languages") loadLanguages();
    if (view === "tracks") loadTracks();
    if (view === "words") loadWords();
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
    const name = app.appName || "Lingola Words";
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
      "statTotalTracks",
      "statTotalWords",
      "statTotalLanguages",
      "statNewUsersToday",
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
      renderInsightCard("Track dilleri", "Dil bazlı track sayısı", insights.tracksByLanguage),
      renderInsightCard("Track seviyeleri", "Seviye dağılımı", insights.tracksByLevel),
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
    setText("statTotalTracks", formatNumber(summary.totalTracks));
    setText("statTotalWords", formatNumber(summary.totalWords));
    setText("statTotalLanguages", formatNumber(summary.totalLanguages));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
    setText("analyseHint", `TZ: ${analyseData.timezone || "Europe/Istanbul"}`);
    renderDaily(Array.isArray(analyseData.daily) ? analyseData.daily : []);
    renderAnalytics();
  }

  function fillSelectOptions(selectId, placeholder, items, getValue, getLabel) {
    const select = $(selectId);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${(items || [])
      .map((item) => {
        const value = getValue(item);
        const label = getLabel(item);
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
      .join("")}`;
    if (current) select.value = current;
  }

  async function loadOptions() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await response.json();
      if (!data.ok) return;
      optionsCache = data.bodyJson?.data || { languages: [], tracks: [] };

      fillSelectOptions(
        "trackLangFilter",
        "Tüm diller",
        (optionsCache.languages || []).map((l) => l.code),
        (v) => v,
        (v) => v
      );
      fillSelectOptions(
        "wordTrackFilter",
        "Tüm trackler",
        optionsCache.tracks || [],
        (t) => String(t.id),
        (t) => `#${t.id} · ${t.title} (${t.languageCode})`
      );
      fillSelectOptions(
        "userLearningTrack",
        "— Seçilmedi —",
        optionsCache.tracks || [],
        (t) => String(t.id),
        (t) => `#${t.id} · ${t.title}`
      );
      fillSelectOptions(
        "wordTrackId",
        "Seçin...",
        optionsCache.tracks || [],
        (t) => String(t.id),
        (t) => `#${t.id} · ${t.title}`
      );

      const datalist = $("languageCodeList");
      if (datalist) {
        datalist.innerHTML = (optionsCache.languages || [])
          .map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)}</option>`)
          .join("");
      }
    } catch {
      /* optional */
    }
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
                <div class="user-cell-sub">#${escapeHtml(row.id)} · ${escapeHtml(row.email || "—")}</div>
              </td>
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${escapeHtml(extras.learningTrackId ? `#${extras.learningTrackId}` : "—")}</td>
              <td>${formatDateTime(row.createdAt)}</td>
              <td><button type="button" class="btn btn-sm" data-user-id="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button></td>
            </tr>`;
          })
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Kullanıcı yok</td></tr>';

    $("usersBody").querySelectorAll("[data-user-id]").forEach((btn) => {
      btn.addEventListener("click", () => openUserDialog(btn.getAttribute("data-user-id")));
    });
    $("usersPrevBtn").disabled = !usersPagination || usersPagination.page <= 1;
    $("usersNextBtn").disabled =
      !usersPagination || usersPagination.page >= usersPagination.totalPages;
  }

  async function openUserDialog(userId) {
    await loadOptions();
    const user = usersCache.get(String(userId));
    if (!user) return;
    $("userEditId").value = user.id;
    $("userDisplayName").value = user.displayName || "";
    $("userPremiumStatus").value = user.extras?.isPremium ? "Premium" : "Ücretsiz";
    $("userLearningTrack").value = user.extras?.learningTrackId ? String(user.extras.learningTrackId) : "";
    $("userFormError").hidden = true;
    $("userDialog").showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    if (!canManage) return;
    const userId = $("userEditId").value;
    const trackValue = $("userLearningTrack").value;
    const response = await fetch(`/api/apps/${appId}/proxy/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learningTrackId: trackValue ? Number(trackValue) : null,
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
  }

  async function loadLanguages() {
    $("languagesError").hidden = true;
    const response = await fetch(`/api/apps/${appId}/proxy/languages`);
    const data = await response.json();
    if (!data.ok) {
      $("languagesError").hidden = false;
      $("languagesError").textContent = apiMessage(data, "Diller alınamadı.");
      $("languagesBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    languagesCache = new Map(rows.map((row) => [String(row.code), row]));
    setText("languagesMeta", `${formatNumber(rows.length)} dil`);
    $("languagesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><code>${escapeHtml(row.code)}</code></td>
              <td>${escapeHtml(row.name)}</td>
              <td>${escapeHtml(row.nativeName || "—")}</td>
              <td><button type="button" class="btn btn-sm" data-language-edit="${escapeHtml(row.code)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button></td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="4" class="user-cell-sub">Dil yok</td></tr>';
    $("languagesBody").querySelectorAll("[data-language-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openLanguageDialog(btn.getAttribute("data-language-edit")));
    });
  }

  function openLanguageDialog(code) {
    const row = code ? languagesCache.get(String(code)) : null;
    $("languageDialogTitle").textContent = row ? "Dil düzenle" : "Yeni dil";
    $("languageEditCode").value = row?.code || "";
    $("languageCode").value = row?.code || "";
    $("languageCode").readOnly = Boolean(row);
    $("languageName").value = row?.name || "";
    $("languageNativeName").value = row?.nativeName || "";
    $("languageFormError").hidden = true;
    $("languageDialog").showModal();
  }

  async function saveLanguage(event) {
    event.preventDefault();
    if (!canManage) return;
    const editCode = $("languageEditCode").value;
    const payload = {
      code: $("languageCode").value.trim(),
      name: $("languageName").value.trim(),
      nativeName: $("languageNativeName").value.trim(),
    };
    const response = await fetch(
      editCode
        ? `/api/apps/${appId}/proxy/languages/${encodeURIComponent(editCode)}`
        : `/api/apps/${appId}/proxy/languages`,
      {
        method: editCode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("languageFormError").hidden = false;
      $("languageFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("languageDialog").close();
    showToast(editCode ? "Dil güncellendi." : "Dil eklendi.");
    loadLanguages();
    loadOptions();
    loadAnalyse();
  }

  async function loadTracks() {
    $("tracksError").hidden = true;
    const params = new URLSearchParams({ page: String(tracksPage), limit: String(pageSize) });
    const search = $("trackSearch")?.value.trim();
    const languageCode = $("trackLangFilter")?.value;
    if (search) params.set("search", search);
    if (languageCode) params.set("languageCode", languageCode);

    const response = await fetch(`/api/apps/${appId}/proxy/tracks?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("tracksError").hidden = false;
      $("tracksError").textContent = apiMessage(data, "Trackler alınamadı.");
      $("tracksBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    tracksPagination = data.bodyJson?.pagination || null;
    tracksCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "tracksMeta",
      tracksPagination
        ? `Sayfa ${tracksPagination.page}/${tracksPagination.totalPages} · ${formatNumber(tracksPagination.total)} track`
        : `${formatNumber(rows.length)} track`
    );

    $("tracksBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><div class="user-cell-title">${escapeHtml(row.title)}</div><div class="user-cell-sub">#${escapeHtml(row.id)}</div></td>
              <td>${escapeHtml(row.languageCode || "—")}</td>
              <td>${escapeHtml(row.level || "—")}</td>
              <td>${formatNumber(row.wordCount)}</td>
              <td>
                <button type="button" class="btn btn-sm" data-track-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-track-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Track yok</td></tr>';

    $("tracksBody").querySelectorAll("[data-track-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openTrackDialog(btn.getAttribute("data-track-edit")));
    });
    $("tracksBody").querySelectorAll("[data-track-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Track silinsin mi?")) return;
        const del = await fetch(`/api/apps/${appId}/proxy/tracks/${encodeURIComponent(btn.getAttribute("data-track-del"))}`, {
          method: "DELETE",
        });
        const delData = await del.json();
        if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
        showToast("Track silindi.");
        loadTracks();
        loadOptions();
        loadAnalyse();
      });
    });
    $("tracksPrevBtn").disabled = !tracksPagination || tracksPagination.page <= 1;
    $("tracksNextBtn").disabled =
      !tracksPagination || tracksPagination.page >= tracksPagination.totalPages;
  }

  async function openTrackDialog(id) {
    await loadOptions();
    let row = id ? tracksCache.get(String(id)) : null;
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/tracks/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) row = detailData.bodyJson?.data || row;
    }
    $("trackDialogTitle").textContent = row ? "Track düzenle" : "Yeni track";
    $("trackEditId").value = row?.id || "";
    $("trackLanguageCode").value = row?.languageCode || "";
    $("trackTitle").value = row?.title || "";
    $("trackDescription").value = row?.description || "";
    $("trackLevel").value = row?.level || "";
    $("trackSortOrder").value = row?.sortOrder ?? 0;
    $("trackFormError").hidden = true;
    $("trackDialog").showModal();
  }

  async function saveTrack(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("trackEditId").value;
    const payload = {
      languageCode: $("trackLanguageCode").value.trim(),
      title: $("trackTitle").value.trim(),
      description: $("trackDescription").value.trim(),
      level: $("trackLevel").value.trim(),
      sortOrder: Number($("trackSortOrder").value) || 0,
    };
    const response = await fetch(
      id ? `/api/apps/${appId}/proxy/tracks/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/tracks`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("trackFormError").hidden = false;
      $("trackFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("trackDialog").close();
    showToast(id ? "Track güncellendi." : "Track eklendi.");
    loadTracks();
    loadOptions();
    loadAnalyse();
  }

  async function loadWords() {
    $("wordsError").hidden = true;
    const params = new URLSearchParams({ page: String(wordsPage), limit: String(pageSize) });
    const search = $("wordSearch")?.value.trim();
    const trackId = $("wordTrackFilter")?.value;
    if (search) params.set("search", search);
    if (trackId) params.set("trackId", trackId);

    const response = await fetch(`/api/apps/${appId}/proxy/words?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("wordsError").hidden = false;
      $("wordsError").textContent = apiMessage(data, "Kelimeler alınamadı.");
      $("wordsBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    wordsPagination = data.bodyJson?.pagination || null;
    wordsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "wordsMeta",
      wordsPagination
        ? `Sayfa ${wordsPagination.page}/${wordsPagination.totalPages} · ${formatNumber(wordsPagination.total)} kelime`
        : `${formatNumber(rows.length)} kelime`
    );

    $("wordsBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><div class="user-cell-title">${escapeHtml(row.word)}</div></td>
              <td>${escapeHtml(row.translation || "—")}</td>
              <td>${escapeHtml(row.trackTitle || row.learningTrackId || "—")}</td>
              <td>${escapeHtml(row.level || "—")}</td>
              <td>
                <button type="button" class="btn btn-sm" data-word-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-word-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="user-cell-sub">Kelime yok</td></tr>';

    $("wordsBody").querySelectorAll("[data-word-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openWordDialog(btn.getAttribute("data-word-edit")));
    });
    $("wordsBody").querySelectorAll("[data-word-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Kelime silinsin mi?")) return;
        const del = await fetch(`/api/apps/${appId}/proxy/words/${encodeURIComponent(btn.getAttribute("data-word-del"))}`, {
          method: "DELETE",
        });
        const delData = await del.json();
        if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
        showToast("Kelime silindi.");
        loadWords();
        loadAnalyse();
      });
    });
    $("wordsPrevBtn").disabled = !wordsPagination || wordsPagination.page <= 1;
    $("wordsNextBtn").disabled =
      !wordsPagination || wordsPagination.page >= wordsPagination.totalPages;
  }

  async function openWordDialog(id) {
    await loadOptions();
    let row = id ? wordsCache.get(String(id)) : null;
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/words/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) row = detailData.bodyJson?.data || row;
    }
    $("wordDialogTitle").textContent = row ? "Kelime düzenle" : "Yeni kelime";
    $("wordEditId").value = row?.id || "";
    $("wordTrackId").value = row?.learningTrackId ? String(row.learningTrackId) : "";
    $("wordText").value = row?.word || "";
    $("wordTranslation").value = row?.translation || "";
    $("wordLevel").value = row?.level || "";
    $("wordSortOrder").value = row?.sortOrder ?? 0;
    $("wordFormError").hidden = true;
    $("wordDialog").showModal();
  }

  async function saveWord(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("wordEditId").value;
    const payload = {
      learningTrackId: Number($("wordTrackId").value),
      word: $("wordText").value.trim(),
      translation: $("wordTranslation").value.trim(),
      level: $("wordLevel").value.trim(),
      sortOrder: Number($("wordSortOrder").value) || 0,
    };
    const response = await fetch(
      id ? `/api/apps/${appId}/proxy/words/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/words`,
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!data.ok) {
      $("wordFormError").hidden = false;
      $("wordFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("wordDialog").close();
    showToast(id ? "Kelime güncellendi." : "Kelime eklendi.");
    loadWords();
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

    $("languageCreateBtn")?.addEventListener("click", () => openLanguageDialog(null));
    $("languageForm")?.addEventListener("submit", saveLanguage);
    $("languageCancelBtn")?.addEventListener("click", () => $("languageDialog").close());

    $("trackCreateBtn")?.addEventListener("click", () => openTrackDialog(null));
    $("trackSearchBtn")?.addEventListener("click", () => {
      tracksPage = 1;
      loadTracks();
    });
    $("trackClearBtn")?.addEventListener("click", () => {
      $("trackSearch").value = "";
      $("trackLangFilter").value = "";
      tracksPage = 1;
      loadTracks();
    });
    $("tracksPrevBtn")?.addEventListener("click", () => {
      if (tracksPage > 1) {
        tracksPage -= 1;
        loadTracks();
      }
    });
    $("tracksNextBtn")?.addEventListener("click", () => {
      tracksPage += 1;
      loadTracks();
    });
    $("trackForm")?.addEventListener("submit", saveTrack);
    $("trackCancelBtn")?.addEventListener("click", () => $("trackDialog").close());

    $("wordCreateBtn")?.addEventListener("click", () => openWordDialog(null));
    $("wordSearchBtn")?.addEventListener("click", () => {
      wordsPage = 1;
      loadWords();
    });
    $("wordClearBtn")?.addEventListener("click", () => {
      $("wordSearch").value = "";
      $("wordTrackFilter").value = "";
      wordsPage = 1;
      loadWords();
    });
    $("wordsPrevBtn")?.addEventListener("click", () => {
      if (wordsPage > 1) {
        wordsPage -= 1;
        loadWords();
      }
    });
    $("wordsNextBtn")?.addEventListener("click", () => {
      wordsPage += 1;
      loadWords();
    });
    $("wordForm")?.addEventListener("submit", saveWord);
    $("wordCancelBtn")?.addEventListener("click", () => $("wordDialog").close());
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse(), loadOptions()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "languages") await loadLanguages();
    if (currentView === "tracks") await loadTracks();
    if (currentView === "words") await loadWords();
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
      await Promise.all([loadHealth(), loadAnalyse(), loadOptions(), window.RevenueCatPanel?.load?.(appId)]);
    } catch (error) {
      showToast(error.message || "Panel yüklenemedi.");
    }
  })();
})();
