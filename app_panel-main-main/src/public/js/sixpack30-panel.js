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

  let workoutsPage = 1;
  const workoutsLimit = 20;
  let workoutsPagination = null;
  let workoutSearch = "";
  let workoutStatus = "";
  const workoutsCache = new Map();

  let sessionsPage = 1;
  const sessionsLimit = 20;
  let sessionsPagination = null;
  let sessionUserId = "";
  let sessionStatus = "";
  const sessionsCache = new Map();

  let currentView = "overview";
  let sessionUser = null;
  let canManage = false;
  let editingWorkout = null;

  const fw = () => window.FitnessWorkoutUi;
  const toast = document.getElementById("toast");

  function $(id) {
    return document.getElementById(id);
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

  function usersFromBody(bodyJson) {
    return bodyJson?.users ?? bodyJson?.data ?? [];
  }

  function workoutsFromBody(bodyJson) {
    return bodyJson?.data ?? bodyJson?.workouts ?? [];
  }

  function workoutFromBody(bodyJson) {
    return bodyJson?.data ?? bodyJson?.workout ?? bodyJson ?? null;
  }

  function sessionsFromBody(bodyJson) {
    return bodyJson?.data ?? bodyJson?.userWorkouts ?? [];
  }

  function workoutSourceLabel(workout) {
    if (workout?.extras?.programDay != null) return `Gün ${workout.extras.programDay}`;
    return workout?.category || "Katalog";
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

  function setStatsLoading(loading) {
    for (const id of ["statTotal", "statWorkoutsToday", "statActiveUsers", "statPublished"]) {
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
    if (view === "workouts") loadWorkouts();
    if (view === "sessions") loadSessions();
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
    const name = app.appName || "Sixpack30";
    $("appTitle").textContent = name;
    $("sidebarAppName").textContent = name;
    $("breadcrumbName").textContent = name;

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
      ["statTotal", "statWorkoutsToday", "statActiveUsers", "statPublished"].forEach((id) => {
        $(id).textContent = "—";
      });
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      $("topWorkoutsSection").hidden = true;
      return;
    }

    const summary = data.bodyJson?.summary || {};
    $("statTotal").textContent = formatNumber(summary.totalUsers);
    $("statWorkoutsToday").textContent = formatNumber(summary.workoutsCompletedToday);
    $("statActiveUsers").textContent = formatNumber(summary.activeWorkoutUsersToday);
    $("statPublished").textContent = formatNumber(summary.publishedWorkouts);

    const version = data.bodyJson?.contractVersion;
    $("analyseHint").textContent = version
      ? `Sözleşme v${version} · Giriş metrikleri updated_at üzerinden yaklaşık değerdir.`
      : "";

    const daily = Array.isArray(data.bodyJson?.daily) ? data.bodyJson.daily.slice().reverse() : [];
    $("dailyBody").innerHTML = daily.length
      ? daily
          .map(
            (row) => `<tr>
              <td>${row.date || "—"}</td>
              <td>${formatNumber(row.logins)}</td>
              <td>${formatNumber(row.newUsers ?? 0)}</td>
              <td>${formatNumber(row.workoutsCompleted ?? 0)}</td>
              <td>${formatNumber(row.workoutMinutes ?? 0)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="user-cell-sub">Veri yok</td></tr>`;

    const top = data.bodyJson?.workoutsSummary?.topWorkoutsByCompletions || [];
    if (top.length) {
      $("topWorkoutsSection").hidden = false;
      $("topWorkoutsBody").innerHTML = top
        .map(
          (w) => `<tr>
            <td>${w.title || w.workoutId}</td>
            <td>${formatNumber(w.completions)}</td>
          </tr>`
        )
        .join("");
    } else {
      $("topWorkoutsSection").hidden = true;
    }
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editLang").value = ex.language || ex.preferredLanguage || "";
    $("editStatus").value = user.status === "inactive" ? "inactive" : "active";

    const meta = [];
    if (ex.firebaseUid) meta.push(`Firebase: ${ex.firebaseUid}`);
    if (ex.isPremium != null) meta.push(ex.isPremium ? "Premium" : "Ücretsiz");
    if (ex.goal) meta.push(`Hedef: ${ex.goal}`);
    if (ex.gender) meta.push(`Cinsiyet: ${ex.gender}`);
    if (ex.trainingDays) meta.push(`Antrenman günü: ${ex.trainingDays}`);
    if (ex.hasQuestionnaire != null) meta.push(ex.hasQuestionnaire ? "Anket tamam" : "Anket yok");
    if (ex.photoUrl) meta.push("Profil fotoğrafı var");
    $("editUserMeta").textContent = meta.length ? meta.join(" · ") : "—";

    $("editUserMessage").hidden = true;
    $("editUserDialog").showModal();
  }

  async function loadUsers() {
    $("usersError").hidden = true;
    $("usersBody").innerHTML = `<tr><td colspan="3" class="user-cell-sub">Yükleniyor...</td></tr>`;

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
      ? `${formatNumber(usersPagination.total)} kullanıcı · ${usersPagination.page}/${usersPagination.totalPages}`
      : `${users.length} kayıt`;

    $("usersBody").innerHTML = users.length
      ? users
          .map((user) => {
            const label = user.displayName || user.email || `ID ${user.id}`;
            const sub = user.displayName && user.email ? user.email : "";
            const premium = user.extras?.isPremium ? " · Premium" : "";
            const status = user.status || "inactive";
            return `<tr data-user-id="${user.id}" style="cursor:pointer">
              <td><div class="user-cell-title">${label}</div>${sub ? `<div class="user-cell-sub">${sub}${premium}</div>` : ""}</td>
              <td><span class="status-pill ${status}">${status}</span></td>
              <td>
                ${
                  canManage
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-user="${user.id}">Düzenle</button>`
                    : ""
                }
                <button type="button" class="btn btn-sm btn-ghost" data-user-sessions="${user.id}">Oturumlar</button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="3"><p class="user-cell-sub">Eşleşen kullanıcı yok</p></td></tr>`;

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function openWorkoutView(workout) {
    if (!workout) return;
    $("workoutViewTitle").textContent = workout.title || workout.id;
    const meta = [
      ["ID", workout.id],
      ["Durum", workout.status],
      ["Süre", workout.durationMinutes != null ? `${workout.durationMinutes} dk` : "—"],
      ["Kategori", workout.category],
      ["Zorluk", workout.difficulty]
    ];
    $("workoutViewBody").innerHTML = `
      <table class="data-table" style="margin-bottom:16px"><tbody>
        ${meta.map(([k, v]) => `<tr><td class="user-cell-sub" style="width:120px">${k}</td><td>${v ?? "—"}</td></tr>`).join("")}
      </tbody></table>
      ${fw()?.renderWorkoutMediaPanel(workout) || ""}`;
    $("workoutViewDialog").showModal();
  }

  function openWorkoutDialog(workout) {
    editingWorkout = workout || null;
    const isEdit = Boolean(workout);
    $("workoutDialogTitle").textContent = isEdit ? "Antrenman düzenle" : "Yeni antrenman";
    $("workoutEditId").value = workout?.id || "";
    if (fw()) fw().fillWorkoutForm($, workout, { includeSixpackFields: true });
    document.querySelectorAll("#workoutForm input, #workoutForm textarea, #workoutForm select").forEach((el) => {
      if (el.id === "workoutEditId") return;
      el.disabled = false;
    });
    const submitBtn = $("workoutSubmitBtn") || document.querySelector("#workoutForm button[type=submit]");
    if (submitBtn) submitBtn.hidden = false;
    $("workoutFormMessage").hidden = true;
    $("workoutDialog").showModal();
  }

  async function loadWorkouts() {
    $("workoutsError").hidden = true;
    $("workoutsBody").innerHTML = `<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: workoutsPage, limit: workoutsLimit });
    if (workoutSearch) params.set("search", workoutSearch);
    if (workoutStatus) params.set("status", workoutStatus);

    const response = await fetch(`/api/apps/${appId}/proxy/workouts?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("workoutsBody").innerHTML = "";
      $("workoutsError").hidden = false;
      $("workoutsError").textContent = apiErrorMessage(data, "Katalog alınamadı.");
      $("workoutsMeta").textContent = "Liste alınamadı";
      $("workoutPrevBtn").disabled = true;
      $("workoutNextBtn").disabled = true;
      return;
    }

    const workouts = workoutsFromBody(data.bodyJson);
    workoutsPagination = data.bodyJson?.pagination || null;
    workoutsCache.clear();
    workouts.forEach((w) => workoutsCache.set(String(w.id), w));

    $("workoutsMeta").textContent = workoutsPagination
      ? `${formatNumber(workoutsPagination.total)} antrenman · ${workoutsPagination.page}/${workoutsPagination.totalPages}`
      : `${workouts.length} kayıt`;

    $("workoutsBody").innerHTML = workouts.length
      ? workouts
          .map((w) => {
            const actions = canManage
              ? `<button type="button" class="btn btn-sm btn-ghost" data-edit-workout="${w.id}">Düzenle</button>
                 <button type="button" class="btn btn-sm btn-ghost" data-delete-workout="${w.id}">Arşivle</button>`
              : "";
            const thumb = fw()?.workoutListThumb(w) || "";
            return `<tr>
              <td>${thumb}</td>
              <td><div class="user-cell-title">${w.title || w.id}</div><div class="user-cell-sub">${w.id}</div></td>
              <td><span class="status-pill">${w.status || "—"}</span></td>
              <td>${w.durationMinutes != null ? `${w.durationMinutes} dk` : "—"}</td>
              <td>${workoutSourceLabel(w)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-ghost" data-view-workout="${w.id}">Medya</button>
                ${actions}
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6"><p class="user-cell-sub">Kayıt yok</p></td></tr>`;

    $("workoutPrevBtn").disabled = workoutsPage <= 1;
    $("workoutNextBtn").disabled = workoutsPage >= (workoutsPagination?.totalPages || 1);
  }

  async function deleteWorkout(workoutId) {
    if (!canManage) return;
    if (!confirm("Bu antrenman arşivlensin mi?")) return;
    const response = await fetch(
      `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(workoutId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showToast(apiErrorMessage(data, "Silinemedi"));
      return;
    }
    showToast("Antrenman arşivlendi");
    loadWorkouts();
  }

  function openSessionDetail(session) {
    const rows = [
      ["ID", session.id],
      ["Kullanıcı", session.userId],
      ["Antrenman", session.workoutTitle || session.workoutId],
      ["Durum", session.status],
      ["Başlangıç", formatDate(session.startedAt)],
      ["Bitiş", formatDate(session.completedAt)],
      ["Süre (dk)", session.durationMinutes],
      ["Kalori", session.caloriesBurned],
      ["İlerleme %", session.progressPercent]
    ];
    $("sessionDetailBody").innerHTML = `
      <table class="data-table"><tbody>
        ${rows.map(([k, v]) => `<tr><td class="user-cell-sub" style="width:140px">${k}</td><td>${v ?? "—"}</td></tr>`).join("")}
      </tbody></table>`;
    $("sessionDetailDialog").showModal();
  }

  async function loadSessions() {
    $("sessionsError").hidden = true;
    $("sessionsBody").innerHTML = `<tr><td colspan="5" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: sessionsPage, limit: sessionsLimit });
    if (sessionUserId) params.set("userId", sessionUserId);
    if (sessionStatus) params.set("status", sessionStatus);

    const response = await fetch(`/api/apps/${appId}/proxy/user-workouts?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("sessionsBody").innerHTML = "";
      $("sessionsError").hidden = false;
      $("sessionsError").textContent = apiErrorMessage(data, "Oturum listesi alınamadı.");
      $("sessionsMeta").textContent = "Liste alınamadı";
      $("sessionPrevBtn").disabled = true;
      $("sessionNextBtn").disabled = true;
      return;
    }

    const sessions = sessionsFromBody(data.bodyJson);
    sessionsPagination = data.bodyJson?.pagination || null;
    sessionsCache.clear();
    sessions.forEach((s) => sessionsCache.set(String(s.id), s));

    $("sessionsMeta").textContent = sessionsPagination
      ? `${formatNumber(sessionsPagination.total)} oturum · ${sessionsPagination.page}/${sessionsPagination.totalPages}`
      : `${sessions.length} kayıt`;

    $("sessionsBody").innerHTML = sessions.length
      ? sessions
          .map((s) => {
            return `<tr data-session-id="${s.id}" style="cursor:pointer">
              <td class="user-cell-sub">ID ${s.userId}</td>
              <td>${s.workoutTitle || s.workoutId}</td>
              <td><span class="status-pill">${s.status}</span></td>
              <td class="user-cell-sub">${formatDate(s.completedAt || s.startedAt)}</td>
              <td><button type="button" class="btn btn-sm btn-ghost" data-view-session="${s.id}">Detay</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5"><p class="user-cell-sub">Kayıt yok</p></td></tr>`;

    $("sessionPrevBtn").disabled = sessionsPage <= 1;
    $("sessionNextBtn").disabled = sessionsPage >= (sessionsPagination?.totalPages || 1);
  }

  async function refreshAll() {
    const btn = $("refreshBtn");
    btn.disabled = true;
    btn.textContent = "Yenileniyor...";
    try {
      await Promise.all([
        loadHealth(),
        loadAnalyse(),
        window.RevenueCatPanel?.load(appId)
      ]);
      if (currentView === "users") await loadUsers();
      if (currentView === "workouts") await loadWorkouts();
      if (currentView === "sessions") await loadSessions();
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

  $("userSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("searchBtn").click();
    }
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

  $("usersBody").addEventListener("click", (e) => {
    const sessionsBtn = e.target.closest("[data-user-sessions]");
    if (sessionsBtn) {
      sessionUserId = sessionsBtn.getAttribute("data-user-sessions");
      $("sessionUserFilter").value = sessionUserId;
      switchView("sessions");
      sessionsPage = 1;
      loadSessions();
      return;
    }
    const editBtn = e.target.closest("[data-edit-user]");
    if (!editBtn || !canManage) return;
    const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
    if (user) openEditUser(user);
  });

  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("userSessionsBtn")?.addEventListener("click", () => {
    const userId = $("editUserId").value;
    $("editUserDialog").close();
    sessionUserId = userId;
    $("sessionUserFilter").value = userId;
    switchView("sessions");
    sessionsPage = 1;
    loadSessions();
  });

  $("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;

    const extras = {};
    const language = $("editLang").value.trim();
    if (language) extras.language = language;

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

  $("newWorkoutBtn")?.addEventListener("click", () => {
    if (!canManage) return;
    openWorkoutDialog(null);
  });

  $("workoutSearchBtn")?.addEventListener("click", () => {
    workoutSearch = $("workoutSearch").value.trim();
    workoutStatus = $("workoutStatusFilter").value;
    workoutsPage = 1;
    loadWorkouts();
  });

  $("workoutPrevBtn")?.addEventListener("click", () => {
    if (workoutsPage > 1) {
      workoutsPage -= 1;
      loadWorkouts();
    }
  });

  $("workoutNextBtn")?.addEventListener("click", () => {
    if (workoutsPage < (workoutsPagination?.totalPages || 1)) {
      workoutsPage += 1;
      loadWorkouts();
    }
  });

  $("workoutsBody")?.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view-workout]");
    if (viewBtn) {
      const w = workoutsCache.get(viewBtn.getAttribute("data-view-workout"));
      if (w) openWorkoutView(w);
      return;
    }
    const editBtn = e.target.closest("[data-edit-workout]");
    if (editBtn) {
      const w = workoutsCache.get(editBtn.getAttribute("data-edit-workout"));
      if (w) openWorkoutDialog(w);
      return;
    }
    const delBtn = e.target.closest("[data-delete-workout]");
    if (delBtn) deleteWorkout(delBtn.getAttribute("data-delete-workout"));
  });

  $("closeWorkoutViewBtn")?.addEventListener("click", () => $("workoutViewDialog").close());

  $("closeWorkoutDialogBtn")?.addEventListener("click", () => $("workoutDialog").close());

  $("workoutForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManage) return;
    $("workoutFormMessage").hidden = true;

    let formData;
    try {
      formData = fw().buildWorkoutFormData($, {
        includeSixpackFields: true,
        existingExtras: editingWorkout?.extras || {}
      });
    } catch (err) {
      $("workoutFormMessage").hidden = false;
      $("workoutFormMessage").textContent = err.message || "Geçersiz egzersiz JSON.";
      return;
    }

    const editId = $("workoutEditId").value.trim();
    const url = editId
      ? `/api/apps/${appId}/proxy/workouts/${encodeURIComponent(editId)}`
      : `/api/apps/${appId}/proxy/workouts`;
    const method = editId ? "PATCH" : "POST";

    const submitBtn = e.submitter;
    submitBtn.disabled = true;
    try {
      const response = await fetch(url, {
        method,
        body: formData
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        $("workoutFormMessage").hidden = false;
        $("workoutFormMessage").textContent = apiErrorMessage(data, "Kayıt başarısız.");
        return;
      }
      $("workoutDialog").close();
      showToast(editId ? "Antrenman güncellendi" : "Antrenman oluşturuldu");
      loadWorkouts();
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("sessionSearchBtn")?.addEventListener("click", () => {
    sessionUserId = $("sessionUserFilter").value.trim();
    sessionStatus = $("sessionStatusFilter").value;
    sessionsPage = 1;
    loadSessions();
  });

  $("sessionClearBtn")?.addEventListener("click", () => {
    sessionUserId = "";
    sessionStatus = "";
    $("sessionUserFilter").value = "";
    $("sessionStatusFilter").value = "";
    sessionsPage = 1;
    loadSessions();
  });

  $("sessionPrevBtn")?.addEventListener("click", () => {
    if (sessionsPage > 1) {
      sessionsPage -= 1;
      loadSessions();
    }
  });

  $("sessionNextBtn")?.addEventListener("click", () => {
    if (sessionsPage < (sessionsPagination?.totalPages || 1)) {
      sessionsPage += 1;
      loadSessions();
    }
  });

  $("sessionsBody")?.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view-session]");
    const id = viewBtn?.getAttribute("data-view-session") || e.target.closest("tr[data-session-id]")?.getAttribute("data-session-id");
    if (!id) return;
    const session = sessionsCache.get(String(id));
    if (session) openSessionDetail(session);
  });

  $("closeSessionDialogBtn")?.addEventListener("click", () => $("sessionDetailDialog").close());

  (async () => {
    if (window.PanelAuth) {
      sessionUser = await PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    fw()?.bindWorkoutFormLivePreview($, () => editingWorkout);

    loadAppMeta()
      .then(() =>
        Promise.all([
          loadHealth(),
          loadAnalyse(),
          window.RevenueCatPanel?.load(appId)
        ])
      )
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();
})();
