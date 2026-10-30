(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) {
    document.body.innerHTML =
      '<main class="page-content"><div class="alert alert-error">Geçersiz uygulama.</div></main>';
    return;
  }

  const CATEGORY_LABELS = {
    chair_yoga: "Sandalye Yogası",
    lose_weight: "Kilo Verme",
    classic_yoga: "Klasik Yoga",
    back_pain_relief: "Bel Ağrısı Rahatlatma",
    pilates: "Pilates",
    meditation: "Meditasyon",
    flexibility: "Esneklik",
    build_strength: "Güçlenme",
    relieve_stress: "Stres Azaltma",
    body_posture: "Duruş Düzeltme"
  };

  const CATEGORY_NAME_TR = {
    "chair yoga": "Sandalye Yogası",
    "lose weight": "Kilo Verme",
    "classic yoga": "Klasik Yoga",
    "back pain relief": "Bel Ağrısı Rahatlatma",
    pilates: "Pilates",
    meditasyon: "Meditasyon",
    meditation: "Meditasyon",
    flexibility: "Esneklik",
    "build strength": "Güçlenme",
    "relieve stress": "Stres Azaltma",
    "body posture": "Duruş Düzeltme"
  };

  const GOAL_LABELS = {
    none: "Belirtilmemiş",
    weight_loss: "Kilo Verme",
    toning: "Sıkılaşma & Toparlanma",
    relaxation: "Rahatlamak & Yenilenmek",
    learn_yoga: "Yoga Becerilerini Öğrenme"
  };

  const PLAN_LABELS = {
    male: "Erkek planı",
    female: "Kadın planı"
  };

  const NOTIFICATION_LABELS = {
    every2Hours: "2 saatte bir",
    every4Hours: "4 saatte bir",
    every8Hours: "8 saatte bir",
    every24Hours: "24 saatte bir"
  };

  let currentView = "overview";
  let canManage = false;
  let categoriesCache = [];
  let selectedCategoryId = "";
  let usersPage = 1;
  const usersLimit = 20;
  let usersPagination = null;
  let usersSearch = "";

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

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
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
    ["statTotalUsers", "statTotalCategories", "statTotalVideos"].forEach((id) =>
      $(id)?.classList.toggle("loading", loading)
    );
  }

  function applyReadOnlyUi() {
    const banner = $("viewerBanner");
    if (banner) banner.hidden = canManage;
    document.querySelectorAll("[data-manager-only]").forEach((el) => {
      el.hidden = !canManage;
      el.style.display = canManage ? "" : "none";
    });
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || "").trim());
  }

  function labelFromMap(map, value, fallback = "—") {
    if (value == null || value === "") return fallback;
    const key = String(value).trim();
    return map[key] || map[key.toLowerCase()] || key;
  }

  function categoryLabel(category) {
    if (!category) return "—";
    if (CATEGORY_LABELS[category.id]) return CATEGORY_LABELS[category.id];
    const byName = CATEGORY_NAME_TR[String(category.name || "").trim().toLowerCase()];
    if (byName) return byName;
    return category.name || category.id || "—";
  }

  function humanTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return "—";
    const paren = raw.match(/\(([^)]+)\)\s*$/);
    if (paren?.[1]) return paren[1].trim();
    return raw;
  }

  function goalLabel(user) {
    const goal = user?.main_goal;
    if (goal && goal !== "none") return labelFromMap(GOAL_LABELS, goal);
    if (user?.plan_type) return labelFromMap(PLAN_LABELS, user.plan_type);
    return "Belirtilmemiş";
  }

  function notificationLabel(user) {
    if (user?.notifications_enabled === false) return "Kapalı";
    if (user?.notification_frequency) {
      return labelFromMap(NOTIFICATION_LABELS, user.notification_frequency);
    }
    return user?.notifications_enabled ? "Açık" : "Kapalı";
  }

  function renderImageThumb(src, alt = "") {
    if (!isHttpUrl(src)) {
      return `<div class="yogify-thumb yogify-thumb--empty">Görsel yok</div>`;
    }
    return `<img class="yogify-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(
      alt
    )}" loading="lazy" referrerpolicy="no-referrer" />`;
  }

  function renderVideoPreview(src) {
    if (!isHttpUrl(src)) {
      return `<div class="yogify-video-empty">Video yok</div>`;
    }
    return `<video class="yogify-video" src="${escapeHtml(
      src
    )}" controls preload="metadata" playsinline></video>`;
  }

  function updateDialogPreviews() {
    const catPreview = $("categoryImagePreview");
    if (catPreview) {
      catPreview.innerHTML = renderImageThumb($("categoryImagePath")?.value, "Kategori görseli");
    }
    const coverPreview = $("videoImagePreview");
    if (coverPreview) {
      coverPreview.innerHTML = renderImageThumb($("videoImagePath")?.value, "Kapak");
    }
    const videoPreview = $("videoUrlPreview");
    if (videoPreview) {
      videoPreview.innerHTML = renderVideoPreview($("videoUrl")?.value);
    }
  }

  function api(path, options = {}) {
    return fetch(`/api/apps/${appId}/yogify${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    }).then(async (response) => {
      if (response.status === 401) {
        window.location.href = "/login.html";
        return { ok: false, status: 401 };
      }
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
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
    if (view === "categories") loadCategories();
    if (view === "videos") loadVideosView();
    if (view === "users") loadUsers();
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
    const name = app.appName || "Yogify";
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
      iconFallback.textContent = "YG";
      iconFallback.hidden = false;
      if (iconImg) iconImg.hidden = true;
    }

    $("apiInfo").textContent = "Veriler Firebase üzerinden yönetiliyor";
    return app;
  }

  async function loadHealth() {
    const result = await api("/health");
    if (result.ok) {
      setHealthBadge(true, "Bağlı");
      $("apiInfo").textContent = "Veriler Firebase üzerinden yönetiliyor";
    } else {
      setHealthBadge(false, "Bağlantı yok");
      $("apiInfo").textContent = result.data?.message || "Firebase bağlantısı kurulamadı";
    }
  }

  async function loadOverview() {
    setStatsLoading(true);
    const result = await api("/overview");
    setStatsLoading(false);
    if (!result.ok) {
      setVal("statTotalUsers", "—");
      setVal("statTotalCategories", "—");
      setVal("statTotalVideos", "—");
      $("recentUsersBody").innerHTML = `<tr><td colspan="4">${escapeHtml(
        result.data?.message || "Özet yüklenemedi"
      )}</td></tr>`;
      return;
    }

    const totals = result.data.totals || {};
    setVal("statTotalUsers", formatNumber(totals.users));
    setVal("statTotalCategories", formatNumber(totals.categories));
    setVal("statTotalVideos", formatNumber(totals.videos));

    const recent = Array.isArray(result.data.recentUsers) ? result.data.recentUsers : [];
    if (!recent.length) {
      $("recentUsersBody").innerHTML = '<tr><td colspan="4">Kullanıcı yok</td></tr>';
      return;
    }
    $("recentUsersBody").innerHTML = recent
      .map(
        (u) => `<tr>
        <td>${escapeHtml(u.full_name || "İsimsiz")}</td>
        <td>${escapeHtml(u.email || "—")}</td>
        <td>${escapeHtml(goalLabel(u))}</td>
        <td>${escapeHtml(formatDateTime(u.createdAt))}</td>
      </tr>`
      )
      .join("");
  }

  function openCategoryDialog(category) {
    $("categoryDialogTitle").textContent = category ? "Kategori düzenle" : "Yeni kategori";
    $("categoryId").value = category?.id || "";
    $("categoryName").value = category ? categoryLabel(category) : "";
    $("categoryImagePath").value = category?.imagePath || "";
    $("categoryOrder").value = category?.order ?? 0;
    updateDialogPreviews();
    $("categoryDialog").hidden = false;
    $("categoryDialog").classList.remove("hidden");
  }

  function closeCategoryDialog() {
    $("categoryDialog").hidden = true;
    $("categoryDialog").classList.add("hidden");
  }

  function openVideoDialog(video) {
    $("videoDialogTitle").textContent = video ? "Video düzenle" : "Yeni video";
    $("videoId").value = video?.id || "";
    $("videoTitle").value = video?.title || "";
    $("videoDescription").value = video?.description || "";
    $("videoUrl").value = video?.video_url || video?.videoUrl || "";
    $("videoImagePath").value = video?.imagePath || "";
    $("videoDuration").value = video?.duration || "00:00";
    $("videoOrder").value = video?.order ?? 0;
    updateDialogPreviews();
    $("videoDialog").hidden = false;
    $("videoDialog").classList.remove("hidden");
  }

  function closeVideoDialog() {
    $("videoDialog").hidden = true;
    $("videoDialog").classList.add("hidden");
  }

  async function loadCategories() {
    const result = await api("/categories");
    if (!result.ok) {
      $("categoriesBody").innerHTML = `<tr><td colspan="4">${escapeHtml(
        result.data?.message || "Yüklenemedi"
      )}</td></tr>`;
      return;
    }
    categoriesCache = Array.isArray(result.data.categories) ? result.data.categories : [];
    if (!categoriesCache.length) {
      $("categoriesBody").innerHTML = '<tr><td colspan="4">Kategori yok</td></tr>';
      return;
    }
    $("categoriesBody").innerHTML = categoriesCache
      .map(
        (c) => `<tr>
        <td>${escapeHtml(c.order ?? 0)}</td>
        <td>${renderImageThumb(c.imagePath, categoryLabel(c))}</td>
        <td><strong>${escapeHtml(categoryLabel(c))}</strong></td>
        <td style="text-align:right;white-space:nowrap">
          <button type="button" class="btn btn-sm btn-ghost" data-open-videos="${escapeHtml(c.id)}">Videolar</button>
          ${
            canManage
              ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-category="${escapeHtml(c.id)}">Düzenle</button>
                 <button type="button" class="btn btn-sm btn-ghost" data-delete-category="${escapeHtml(c.id)}">Sil</button>`
              : ""
          }
        </td>
      </tr>`
      )
      .join("");
  }

  function fillCategorySelect() {
    const select = $("videoCategorySelect");
    if (!select) return;
    const current = selectedCategoryId || select.value;
    select.innerHTML = categoriesCache
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}" ${c.id === current ? "selected" : ""}>${escapeHtml(
            categoryLabel(c)
          )}</option>`
      )
      .join("");
    if (!select.value && categoriesCache[0]) {
      select.value = categoriesCache[0].id;
    }
    selectedCategoryId = select.value || "";
  }

  async function loadVideosView() {
    if (!categoriesCache.length) {
      const result = await api("/categories");
      if (result.ok) {
        categoriesCache = Array.isArray(result.data.categories) ? result.data.categories : [];
      }
    }
    fillCategorySelect();
    await loadVideos();
  }

  async function loadVideos() {
    const categoryId = $("videoCategorySelect")?.value || selectedCategoryId;
    selectedCategoryId = categoryId;
    if (!categoryId) {
      $("videosBody").innerHTML = '<tr><td colspan="6">Önce kategori ekleyin</td></tr>';
      return;
    }
    const result = await api(`/categories/${encodeURIComponent(categoryId)}/videos`);
    if (!result.ok) {
      $("videosBody").innerHTML = `<tr><td colspan="6">${escapeHtml(
        result.data?.message || "Yüklenemedi"
      )}</td></tr>`;
      return;
    }
    const videos = Array.isArray(result.data.videos) ? result.data.videos : [];
    if (!videos.length) {
      $("videosBody").innerHTML = '<tr><td colspan="6">Bu kategoride video yok</td></tr>';
      return;
    }
    $("videosBody").innerHTML = videos
      .map((v) => {
        const url = v.video_url || v.videoUrl || "";
        const duration =
          !v.duration || v.duration === "00:00" ? "Belirtilmemiş" : v.duration;
        return `<tr>
        <td>${escapeHtml(v.order ?? 0)}</td>
        <td>${renderImageThumb(v.imagePath, humanTitle(v.title))}</td>
        <td>
          <strong>${escapeHtml(humanTitle(v.title))}</strong>
          <div class="user-cell-sub">${escapeHtml(v.description || "")}</div>
        </td>
        <td>${escapeHtml(duration)}</td>
        <td>${renderVideoPreview(url)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${
            canManage
              ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-video="${escapeHtml(v.id)}">Düzenle</button>
                 <button type="button" class="btn btn-sm btn-ghost" data-delete-video="${escapeHtml(v.id)}">Sil</button>`
              : ""
          }
        </td>
      </tr>`;
      })
      .join("");

    $("videosBody").dataset.videos = JSON.stringify(videos);
  }

  async function loadUsers() {
    const qs = new URLSearchParams({
      page: String(usersPage),
      limit: String(usersLimit)
    });
    if (usersSearch) qs.set("search", usersSearch);

    const result = await api(`/users?${qs.toString()}`);
    if (!result.ok) {
      $("usersBody").innerHTML = `<tr><td colspan="5">${escapeHtml(
        result.data?.message || "Yüklenemedi"
      )}</td></tr>`;
      return;
    }

    usersPagination = result.data.pagination || null;
    const users = Array.isArray(result.data.users) ? result.data.users : [];
    if (!users.length) {
      $("usersBody").innerHTML = '<tr><td colspan="5">Kullanıcı bulunamadı</td></tr>';
    } else {
      $("usersBody").innerHTML = users
        .map(
          (u) => `<tr>
          <td>
            <strong>${escapeHtml(u.full_name || "İsimsiz")}</strong>
            <div class="user-cell-sub">${escapeHtml(u.email || "—")}</div>
          </td>
          <td>${escapeHtml(goalLabel(u))}</td>
          <td>${u.isOnboardingCompleted ? "Tamamlandı" : "Eksik"}</td>
          <td>${escapeHtml(notificationLabel(u))}</td>
          <td style="text-align:right">
            <button type="button" class="btn btn-sm btn-ghost" data-user-detail="${escapeHtml(u.id)}">Detay</button>
          </td>
        </tr>`
        )
        .join("");
    }

    const info = $("usersPageInfo");
    if (usersPagination) {
      info.textContent = `Sayfa ${usersPagination.page} / ${usersPagination.totalPages} · ${formatNumber(
        usersPagination.total
      )} kullanıcı`;
      $("usersPrevBtn").disabled = usersPagination.page <= 1;
      $("usersNextBtn").disabled = usersPagination.page >= usersPagination.totalPages;
    }
  }

  function detailRow(label, value) {
    return `<div class="yogify-detail-row">
      <span class="yogify-detail-label">${escapeHtml(label)}</span>
      <span class="yogify-detail-value">${escapeHtml(value ?? "—")}</span>
    </div>`;
  }

  async function openUserDetail(uid) {
    const result = await api(`/users/${encodeURIComponent(uid)}`);
    if (!result.ok) {
      showToast(result.data?.message || "Detay yüklenemedi");
      return;
    }
    const u = result.data.user || {};
    const notifications = Array.isArray(result.data.notifications)
      ? result.data.notifications
      : [];

    $("userDetailCard").hidden = false;
    $("userDetailSubtitle").textContent = u.full_name || u.email || "Kullanıcı";
    $("userDetailBody").innerHTML = [
      detailRow("Ad", u.full_name || "İsimsiz"),
      detailRow("E-posta", u.email || "—"),
      detailRow("Cinsiyet", labelFromMap({ male: "Erkek", female: "Kadın", other: "Diğer" }, u.gender)),
      detailRow("Yaş", u.age ?? "—"),
      detailRow("Ana hedef", goalLabel(u)),
      detailRow("Plan", labelFromMap(PLAN_LABELS, u.plan_type)),
      detailRow("Boy (cm)", u.height_cm ?? "—"),
      detailRow("Kilo (kg)", u.weight_kg ?? "—"),
      detailRow("Hedef kilo", u.target_weight_kg ?? "—"),
      detailRow("Kurulum", u.isOnboardingCompleted ? "Tamamlandı" : "Eksik"),
      detailRow("Bildirim", notificationLabel(u)),
      detailRow("Son aktif", formatDateTime(u.last_active_time)),
      detailRow("Kayıt", formatDateTime(u.createdAt)),
      detailRow("Bildirim kutusu", `${notifications.length} kayıt`)
    ].join("");
  }

  async function refreshAll() {
    await loadHealth();
    if (currentView === "overview") await loadOverview();
    if (currentView === "categories") await loadCategories();
    if (currentView === "videos") await loadVideosView();
    if (currentView === "users") await loadUsers();
  }

  document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => {
    el.addEventListener("click", () => switchView(el.dataset.view));
  });

  $("refreshBtn")?.addEventListener("click", () => refreshAll());
  $("settingsBtn")?.addEventListener("click", () => {
    window.location.href = `/apps/${appId}/edit`;
  });

  $("newCategoryBtn")?.addEventListener("click", () => openCategoryDialog(null));
  $("categoryCancelBtn")?.addEventListener("click", closeCategoryDialog);
  $("categoryImagePath")?.addEventListener("input", updateDialogPreviews);
  $("videoUrl")?.addEventListener("input", updateDialogPreviews);
  $("videoImagePath")?.addEventListener("input", updateDialogPreviews);

  $("categoryForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("categoryId").value;
    const body = {
      name: $("categoryName").value.trim(),
      imagePath: $("categoryImagePath").value.trim(),
      order: Number($("categoryOrder").value || 0)
    };
    const result = id
      ? await api(`/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        })
      : await api("/categories", { method: "POST", body: JSON.stringify(body) });
    if (!result.ok) {
      showToast(result.data?.message || "Kaydedilemedi");
      return;
    }
    closeCategoryDialog();
    showToast("Kategori kaydedildi");
    await loadCategories();
    await loadOverview();
  });

  $("categoriesBody")?.addEventListener("click", async (e) => {
    const editId = e.target.closest("[data-edit-category]")?.dataset.editCategory;
    const deleteId = e.target.closest("[data-delete-category]")?.dataset.deleteCategory;
    const openVideos = e.target.closest("[data-open-videos]")?.dataset.openVideos;

    if (openVideos) {
      selectedCategoryId = openVideos;
      switchView("videos");
      return;
    }
    if (editId) {
      const category = categoriesCache.find((c) => c.id === editId);
      if (category) openCategoryDialog(category);
      return;
    }
    if (deleteId) {
      if (!confirm("Kategori ve içindeki tüm videolar silinecek. Emin misiniz?")) return;
      const result = await api(`/categories/${encodeURIComponent(deleteId)}`, {
        method: "DELETE"
      });
      if (!result.ok) {
        showToast(result.data?.message || "Silinemedi");
        return;
      }
      showToast("Kategori silindi");
      await loadCategories();
      await loadOverview();
    }
  });

  $("newVideoBtn")?.addEventListener("click", () => {
    if (!$("videoCategorySelect")?.value) {
      showToast("Önce kategori seçin");
      return;
    }
    openVideoDialog(null);
  });
  $("videoCancelBtn")?.addEventListener("click", closeVideoDialog);
  $("videoCategorySelect")?.addEventListener("change", () => {
    selectedCategoryId = $("videoCategorySelect").value;
    loadVideos();
  });
  $("videoForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const categoryId = $("videoCategorySelect")?.value;
    if (!categoryId) return;
    const id = $("videoId").value;
    const body = {
      title: $("videoTitle").value.trim(),
      description: $("videoDescription").value.trim(),
      videoUrl: $("videoUrl").value.trim(),
      imagePath: $("videoImagePath").value.trim(),
      duration: $("videoDuration").value.trim() || "00:00",
      order: Number($("videoOrder").value || 0)
    };
    const result = id
      ? await api(`/categories/${encodeURIComponent(categoryId)}/videos/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        })
      : await api(`/categories/${encodeURIComponent(categoryId)}/videos`, {
          method: "POST",
          body: JSON.stringify(body)
        });
    if (!result.ok) {
      showToast(result.data?.message || "Kaydedilemedi");
      return;
    }
    closeVideoDialog();
    showToast("Video kaydedildi");
    await loadVideos();
    await loadOverview();
  });

  $("videosBody")?.addEventListener("click", async (e) => {
    const editId = e.target.closest("[data-edit-video]")?.dataset.editVideo;
    const deleteId = e.target.closest("[data-delete-video]")?.dataset.deleteVideo;
    const categoryId = $("videoCategorySelect")?.value;
    let videos = [];
    try {
      videos = JSON.parse($("videosBody").dataset.videos || "[]");
    } catch {
      videos = [];
    }

    if (editId) {
      const video = videos.find((v) => v.id === editId);
      if (video) openVideoDialog(video);
      return;
    }
    if (deleteId && categoryId) {
      if (!confirm("Video silinsin mi?")) return;
      const result = await api(
        `/categories/${encodeURIComponent(categoryId)}/videos/${encodeURIComponent(deleteId)}`,
        { method: "DELETE" }
      );
      if (!result.ok) {
        showToast(result.data?.message || "Silinemedi");
        return;
      }
      showToast("Video silindi");
      await loadVideos();
      await loadOverview();
    }
  });

  let searchTimer = null;
  $("userSearchInput")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      usersSearch = e.target.value.trim();
      usersPage = 1;
      loadUsers();
    }, 300);
  });
  $("userClearFilterBtn")?.addEventListener("click", () => {
    $("userSearchInput").value = "";
    usersSearch = "";
    usersPage = 1;
    loadUsers();
  });
  $("usersPrevBtn")?.addEventListener("click", () => {
    if (usersPage > 1) {
      usersPage -= 1;
      loadUsers();
    }
  });
  $("usersNextBtn")?.addEventListener("click", () => {
    if (usersPagination && usersPage < usersPagination.totalPages) {
      usersPage += 1;
      loadUsers();
    }
  });
  $("usersBody")?.addEventListener("click", (e) => {
    const uid = e.target.closest("[data-user-detail]")?.dataset.userDetail;
    if (uid) openUserDetail(uid);
  });
  $("closeUserDetailBtn")?.addEventListener("click", () => {
    $("userDetailCard").hidden = true;
  });

  (async () => {
    const sessionUser = await PanelAuth.fetchSession();
    if (!sessionUser) return;
    canManage = PanelAuth.isManager(sessionUser);
    applyReadOnlyUi();
    await loadAppMeta();
    await loadHealth();
    await loadOverview();
  })();
})();
