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

  let coursesPage = 1;
  let coursesPagination = null;
  let coursesCache = new Map();
  let lessonsPage = 1;
  let lessonsPagination = null;
  let lessonsCache = new Map();
  let phrasesPage = 1;
  let phrasesPagination = null;
  let phrasesCache = new Map();
  let optionsCache = { courses: [] };

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
    if (view === "courses") loadCourses();
    if (view === "lessons") loadLessons();
    if (view === "phrases") loadPhrases();
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
    const name = app.appName || "Lingola Travel";
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
      "statTotalCourses",
      "statTotalLessons",
      "statTotalPhrases",
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
      renderInsightCard("Kurs dilleri", "Hedef dil dağılımı", insights.courseLanguages),
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
    setText("statTotalCourses", formatNumber(summary.totalCourses));
    setText("statTotalLessons", formatNumber(summary.totalLessons));
    setText("statTotalPhrases", formatNumber(summary.totalPhrases));
    setText("statNewUsersToday", formatNumber(summary.newUsersToday));
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
              <td>${extras.isPremium ? "Evet" : "Hayır"}</td>
              <td>${formatNumber(extras.courseProgress)} / ${formatNumber(extras.lessonProgress)}</td>
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

  function fillSelectOptions(selectId, placeholder, values, getLabel) {
    const select = $(selectId);
    if (!select) return;
    const current = select.value;
    const items = (values || []).filter(Boolean);
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items
      .map((value) => {
        const label = getLabel ? getLabel(value) : value;
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
      .join("")}`;
    if (current && items.includes(current)) select.value = current;
  }

  async function loadOptions() {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/options`);
      const data = await response.json();
      if (!data.ok) return;
      optionsCache = data.bodyJson?.data || {};
      const select = $("lessonCourseId");
      if (select) {
        const current = select.value;
        select.innerHTML = `<option value="">Kurs seçin...</option>${(optionsCache.courses || [])
          .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)} (${escapeHtml(c.targetLanguage || "")})</option>`)
          .join("")}`;
        if (current) select.value = current;
      }
      fillSelectOptions("courseLangFilter", "Tüm diller", optionsCache.languages || []);
      fillSelectOptions("courseCategoryFilter", "Tüm kategoriler", optionsCache.courseCategories || []);
    } catch {
      /* optional */
    }
  }

  async function loadCourses() {
    $("coursesError").hidden = true;
    const params = new URLSearchParams({ page: String(coursesPage), limit: String(pageSize) });
    const search = $("courseSearch")?.value.trim();
    const language = $("courseLangFilter")?.value;
    const category = $("courseCategoryFilter")?.value;
    if (search) params.set("search", search);
    if (language) params.set("language", language);
    if (category) params.set("category", category);

    const response = await fetch(`/api/apps/${appId}/proxy/courses?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("coursesError").hidden = false;
      $("coursesError").textContent = apiMessage(data, "Kurslar alınamadı.");
      $("coursesBody").innerHTML = "";
      return;
    }

    const rows = listFromBody(data);
    coursesPagination = data.bodyJson?.pagination || null;
    coursesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText(
      "coursesMeta",
      coursesPagination
        ? `Sayfa ${coursesPagination.page}/${coursesPagination.totalPages} · ${formatNumber(coursesPagination.total)} kurs`
        : `${formatNumber(rows.length)} kurs`
    );

    $("coursesBody").innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td><div class="user-cell-title">${escapeHtml(row.title)}</div></td>
              <td>${escapeHtml(row.category || "—")}</td>
              <td>${escapeHtml(row.targetLanguage || "—")}</td>
              <td>${formatNumber(row.lessonCount)}</td>
              <td>${row.isFree ? "Evet" : "Hayır"}</td>
              <td>
                <button type="button" class="btn btn-sm" data-course-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
                <button type="button" class="btn btn-sm btn-danger" data-course-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
              </td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="user-cell-sub">Kurs yok</td></tr>';

    $("coursesBody").querySelectorAll("[data-course-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openCourseDialog(btn.getAttribute("data-course-edit")));
    });
    $("coursesBody").querySelectorAll("[data-course-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canManage || !window.confirm("Kurs silinsin mi?")) return;
        const responseDelete = await fetch(`/api/apps/${appId}/proxy/courses/${encodeURIComponent(btn.getAttribute("data-course-del"))}`, { method: "DELETE" });
        const deleteData = await responseDelete.json();
        if (!deleteData.ok) return showToast(apiMessage(deleteData, "Silinemedi."));
        showToast("Kurs silindi.");
        loadCourses();
        loadAnalyse();
      });
    });
    $("coursesPrevBtn").disabled = !coursesPagination || coursesPagination.page <= 1;
    $("coursesNextBtn").disabled = !coursesPagination || coursesPagination.page >= coursesPagination.totalPages;
  }

  async function openCourseDialog(id) {
    let row = id ? coursesCache.get(String(id)) : null;
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/courses/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) row = detailData.bodyJson?.data || row;
    }
    $("courseDialogTitle").textContent = row ? "Kurs düzenle" : "Yeni kurs";
    $("courseEditId").value = row?.id || "";
    $("courseTitle").value = row?.title || "";
    $("courseCategory").value = row?.category || "";
    $("courseDescription").value = row?.description || "";
    $("courseImageUrl").value = row?.imageUrl || "";
    $("courseLanguage").value = row?.targetLanguage || "en";
    $("courseOrder").value = row?.displayOrder ?? 0;
    $("courseFree").checked = Boolean(row?.isFree);
    $("courseFormError").hidden = true;
    $("courseDialog").showModal();
  }

  async function saveCourse(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("courseEditId").value;
    const payload = {
      title: $("courseTitle").value.trim(),
      category: $("courseCategory").value.trim(),
      description: $("courseDescription").value.trim(),
      imageUrl: $("courseImageUrl").value.trim(),
      targetLanguage: $("courseLanguage").value.trim() || "en",
      displayOrder: Number($("courseOrder").value) || 0,
      isFree: $("courseFree").checked,
    };
    const response = await fetch(id ? `/api/apps/${appId}/proxy/courses/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/courses`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) {
      $("courseFormError").hidden = false;
      $("courseFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("courseDialog").close();
    showToast(id ? "Kurs güncellendi." : "Kurs eklendi.");
    loadCourses();
    loadOptions();
    loadAnalyse();
  }

  async function loadLessons() {
    $("lessonsError").hidden = true;
    const params = new URLSearchParams({ page: String(lessonsPage), limit: String(pageSize) });
    const search = $("lessonSearch")?.value.trim();
    if (search) params.set("search", search);
    const response = await fetch(`/api/apps/${appId}/proxy/lessons?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("lessonsError").hidden = false;
      $("lessonsError").textContent = apiMessage(data, "Dersler alınamadı.");
      $("lessonsBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    lessonsPagination = data.bodyJson?.pagination || null;
    lessonsCache = new Map(rows.map((row) => [String(row.id), row]));
    setText("lessonsMeta", lessonsPagination ? `Sayfa ${lessonsPagination.page}/${lessonsPagination.totalPages} · ${formatNumber(lessonsPagination.total)} ders` : `${formatNumber(rows.length)} ders`);
    $("lessonsBody").innerHTML = rows.length
      ? rows.map((row) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(row.title)}</div></td>
          <td>${escapeHtml(row.courseTitle || row.courseId || "—")}</td>
          <td>${formatNumber(row.lessonOrder)}</td>
          <td>
            <button type="button" class="btn btn-sm" data-lesson-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
            <button type="button" class="btn btn-sm btn-danger" data-lesson-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
          </td>
        </tr>`).join("")
      : '<tr><td colspan="4" class="user-cell-sub">Ders yok</td></tr>';
    $("lessonsBody").querySelectorAll("[data-lesson-edit]").forEach((btn) => btn.addEventListener("click", () => openLessonDialog(btn.getAttribute("data-lesson-edit"))));
    $("lessonsBody").querySelectorAll("[data-lesson-del]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!canManage || !window.confirm("Ders silinsin mi?")) return;
      const del = await fetch(`/api/apps/${appId}/proxy/lessons/${encodeURIComponent(btn.getAttribute("data-lesson-del"))}`, { method: "DELETE" });
      const delData = await del.json();
      if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
      showToast("Ders silindi.");
      loadLessons();
      loadAnalyse();
    }));
    $("lessonsPrevBtn").disabled = !lessonsPagination || lessonsPagination.page <= 1;
    $("lessonsNextBtn").disabled = !lessonsPagination || lessonsPagination.page >= lessonsPagination.totalPages;
  }

  async function openLessonDialog(id) {
    await loadOptions();
    let row = id ? lessonsCache.get(String(id)) : null;
    if (id) {
      const detailRes = await fetch(`/api/apps/${appId}/proxy/lessons/${encodeURIComponent(id)}`);
      const detailData = await detailRes.json();
      if (detailData.ok) row = detailData.bodyJson?.data || row;
    }
    $("lessonDialogTitle").textContent = row ? "Ders düzenle" : "Yeni ders";
    $("lessonEditId").value = row?.id || "";
    $("lessonCourseId").value = row?.courseId || "";
    $("lessonTitle").value = row?.title || "";
    $("lessonDescription").value = row?.description || "";
    $("lessonOrder").value = row?.lessonOrder ?? 1;
    $("lessonExample").value = row?.exampleSentence || "";
    $("lessonFormError").hidden = true;
    $("lessonDialog").showModal();
  }

  async function saveLesson(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("lessonEditId").value;
    const payload = {
      courseId: $("lessonCourseId").value,
      title: $("lessonTitle").value.trim(),
      description: $("lessonDescription").value.trim(),
      lessonOrder: Number($("lessonOrder").value) || 1,
      exampleSentence: $("lessonExample").value.trim(),
    };
    const response = await fetch(id ? `/api/apps/${appId}/proxy/lessons/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/lessons`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) {
      $("lessonFormError").hidden = false;
      $("lessonFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("lessonDialog").close();
    showToast(id ? "Ders güncellendi." : "Ders eklendi.");
    loadLessons();
    loadAnalyse();
  }

  async function loadPhrases() {
    $("phrasesError").hidden = true;
    const params = new URLSearchParams({ page: String(phrasesPage), limit: String(pageSize) });
    const search = $("phraseSearch")?.value.trim();
    if (search) params.set("search", search);
    const response = await fetch(`/api/apps/${appId}/proxy/phrases?${params}`);
    const data = await response.json();
    if (!data.ok) {
      $("phrasesError").hidden = false;
      $("phrasesError").textContent = apiMessage(data, "İfadeler alınamadı.");
      $("phrasesBody").innerHTML = "";
      return;
    }
    const rows = listFromBody(data);
    phrasesPagination = data.bodyJson?.pagination || null;
    phrasesCache = new Map(rows.map((row) => [String(row.id), row]));
    setText("phrasesMeta", phrasesPagination ? `Sayfa ${phrasesPagination.page}/${phrasesPagination.totalPages} · ${formatNumber(phrasesPagination.total)} ifade` : `${formatNumber(rows.length)} ifade`);
    $("phrasesBody").innerHTML = rows.length
      ? rows.map((row) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(row.englishText)}</div></td>
          <td>${escapeHtml(row.category || "—")}</td>
          <td>${escapeHtml(row.translation || "—")}</td>
          <td>
            <button type="button" class="btn btn-sm" data-phrase-edit="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Düzenle</button>
            <button type="button" class="btn btn-sm btn-danger" data-phrase-del="${escapeHtml(row.id)}" data-manager-only ${canManage ? "" : "hidden"}>Sil</button>
          </td>
        </tr>`).join("")
      : '<tr><td colspan="4" class="user-cell-sub">İfade yok</td></tr>';
    $("phrasesBody").querySelectorAll("[data-phrase-edit]").forEach((btn) => btn.addEventListener("click", () => openPhraseDialog(btn.getAttribute("data-phrase-edit"))));
    $("phrasesBody").querySelectorAll("[data-phrase-del]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!canManage || !window.confirm("İfade silinsin mi?")) return;
      const del = await fetch(`/api/apps/${appId}/proxy/phrases/${encodeURIComponent(btn.getAttribute("data-phrase-del"))}`, { method: "DELETE" });
      const delData = await del.json();
      if (!delData.ok) return showToast(apiMessage(delData, "Silinemedi."));
      showToast("İfade silindi.");
      loadPhrases();
      loadAnalyse();
    }));
    $("phrasesPrevBtn").disabled = !phrasesPagination || phrasesPagination.page <= 1;
    $("phrasesNextBtn").disabled = !phrasesPagination || phrasesPagination.page >= phrasesPagination.totalPages;
  }

  function openPhraseDialog(id) {
    const row = id ? phrasesCache.get(String(id)) : null;
    $("phraseDialogTitle").textContent = row ? "İfade düzenle" : "Yeni ifade";
    $("phraseEditId").value = row?.id || "";
    $("phraseCategory").value = row?.category || "";
    $("phraseEnglish").value = row?.englishText || "";
    $("phraseTranslation").value = row?.translation || "";
    $("phraseType").value = row?.phraseType || "question";
    $("phraseLanguage").value = row?.targetLanguage || "en";
    $("phraseFormError").hidden = true;
    $("phraseDialog").showModal();
  }

  async function savePhrase(event) {
    event.preventDefault();
    if (!canManage) return;
    const id = $("phraseEditId").value;
    const payload = {
      category: $("phraseCategory").value.trim(),
      englishText: $("phraseEnglish").value.trim(),
      translation: $("phraseTranslation").value.trim(),
      phraseType: $("phraseType").value,
      targetLanguage: $("phraseLanguage").value.trim() || "en",
    };
    const response = await fetch(id ? `/api/apps/${appId}/proxy/phrases/${encodeURIComponent(id)}` : `/api/apps/${appId}/proxy/phrases`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) {
      $("phraseFormError").hidden = false;
      $("phraseFormError").textContent = apiMessage(data, "Kayıt başarısız.");
      return;
    }
    $("phraseDialog").close();
    showToast(id ? "İfade güncellendi." : "İfade eklendi.");
    loadPhrases();
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

    $("courseCreateBtn")?.addEventListener("click", () => openCourseDialog(null));
    $("courseSearchBtn")?.addEventListener("click", () => { coursesPage = 1; loadCourses(); });
    $("courseClearBtn")?.addEventListener("click", () => {
      $("courseSearch").value = "";
      $("courseLangFilter").value = "";
      $("courseCategoryFilter").value = "";
      coursesPage = 1;
      loadCourses();
    });
    $("coursesPrevBtn")?.addEventListener("click", () => { if (coursesPage > 1) { coursesPage -= 1; loadCourses(); } });
    $("coursesNextBtn")?.addEventListener("click", () => { coursesPage += 1; loadCourses(); });
    $("courseForm")?.addEventListener("submit", saveCourse);
    $("courseCancelBtn")?.addEventListener("click", () => $("courseDialog").close());

    $("lessonCreateBtn")?.addEventListener("click", () => openLessonDialog(null));
    $("lessonSearchBtn")?.addEventListener("click", () => { lessonsPage = 1; loadLessons(); });
    $("lessonsPrevBtn")?.addEventListener("click", () => { if (lessonsPage > 1) { lessonsPage -= 1; loadLessons(); } });
    $("lessonsNextBtn")?.addEventListener("click", () => { lessonsPage += 1; loadLessons(); });
    $("lessonForm")?.addEventListener("submit", saveLesson);
    $("lessonCancelBtn")?.addEventListener("click", () => $("lessonDialog").close());

    $("phraseCreateBtn")?.addEventListener("click", () => openPhraseDialog(null));
    $("phraseSearchBtn")?.addEventListener("click", () => { phrasesPage = 1; loadPhrases(); });
    $("phrasesPrevBtn")?.addEventListener("click", () => { if (phrasesPage > 1) { phrasesPage -= 1; loadPhrases(); } });
    $("phrasesNextBtn")?.addEventListener("click", () => { phrasesPage += 1; loadPhrases(); });
    $("phraseForm")?.addEventListener("submit", savePhrase);
    $("phraseCancelBtn")?.addEventListener("click", () => $("phraseDialog").close());
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadAnalyse(), loadOptions()]);
    if (currentView === "users") await loadUsers();
    if (currentView === "courses") await loadCourses();
    if (currentView === "lessons") await loadLessons();
    if (currentView === "phrases") await loadPhrases();
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
