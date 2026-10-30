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
  const agentsLimit = 20;
  let agentsPagination = null;
  let agentsSearch = "";
  let agentSortBy = "id_asc";
  let agentJobFilter = "";
  let agentRoleFilter = "";
  let agentSearchDebounceTimer = null;
  const agentsCache = new Map();
  let agentEditMode = "create";
  let agentOptions = null;
  let explanationTextsByKey = {};
  let agentFeatureOptions = [];
  let agentRoleOptions = [];
  let voiceOptionsCache = [];
  let selectedFeatures = [];
  let selectedRoles = [];
  let currentView = "overview";
  let sessionUser = null;
  let canManage = false;

  const toast = document.getElementById("toast");
  const NAME_LANGS = [
    { code: "tr", label: "Türkçe (TR)" },
    { code: "en", label: "İngilizce (EN)" },
    { code: "de", label: "Almanca (DE)" },
    { code: "es", label: "İspanyolca (ES)" },
    { code: "fr", label: "Fransızca (FR)" },
    { code: "it", label: "İtalyanca (IT)" },
    { code: "pt", label: "Portekizce (PT)" },
    { code: "ko", label: "Korece (KO)" },
    { code: "zh", label: "Çince (ZH)" },
    { code: "ru", label: "Rusça (RU)" },
    { code: "ja", label: "Japonca (JA)" },
    { code: "hi", label: "Hintçe (HI)" }
  ];
  const JOB_LABELS_TR = {
    family_assistant: "Aile asistanı",
    thought_and_habit_guide: "Düşünce ve alışkanlık rehberi",
    adult: "Yetişkin",
    child: "Çocuk",
    teenage: "Ergen",
    personal: "Kişisel gelişim",
    exam_anxiety: "Sınav kaygısı",
    emotional_balance: "Duygusal denge",
    difficult_experiences: "Zor deneyimler",
    resilience_empowerment: "Dayanıklılık ve güçlenme"
  };
  const FEATURE_LABELS_TR = {
    family_conflicts: "Aile içi çatışmalar",
    parenting: "Ebeveynlik",
    communication: "İletişim",
    boundaries: "Sınır koyma",
    relationship_repair: "İlişki onarma",
    divorce_support: "Boşanma desteği",
    child_behavior: "Çocuk davranışları",
    family_harmony: "Aile uyumu",
    stress_management: "Stres yönetimi",
    self_confidence: "Özgüven",
    life_balance: "Yaşam dengesi",
    emotional_regulation: "Duygu düzenleme",
    decision_making: "Karar verme",
    motivation: "Motivasyon",
    personal_growth: "Kişisel gelişim",
    overthinking: "Aşırı düşünme",
    career_guidance: "Kariyer rehberliği",
    emotional_awareness: "Duygusal farkındalık",
    social_skills: "Sosyal beceriler",
    school_adaptation: "Okula uyum",
    self_expression: "Kendini ifade",
    fear_management: "Korku yönetimi",
    friendship_building: "Arkadaşlık kurma",
    focus_attention: "Odak ve dikkat",
    behavioral_support: "Davranış desteği",
    identity_development: "Kimlik gelişimi",
    peer_pressure: "Akran baskısı",
    academic_stress: "Akademik stres",
    self_esteem: "Özsaygı",
    digital_wellbeing: "Dijital iyi oluş",
    anger_management: "Öfke yönetimi",
    future_planning: "Gelecek planlama",
    parent_communication: "Ebeveyn iletişimi",
    loneliness: "Yalnızlık",
    anxiety_support: "Kaygı desteği",
    grief_processing: "Yas süreci",
    mindfulness: "Farkındalık (mindfulness)",
    sleep_improvement: "Uyku iyileştirme",
    self_discovery: "Kendini keşfetme",
    emotional_healing: "Duygusal iyileşme",
    test_anxiety: "Sınav kaygısı",
    study_techniques: "Çalışma teknikleri",
    time_management: "Zaman yönetimi",
    performance_pressure: "Performans baskısı",
    concentration: "Konsantrasyon",
    relaxation_methods: "Rahatlama yöntemleri",
    exam_preparation: "Sınava hazırlık",
    confidence_building: "Kendine güven geliştirme"
  };
  const ROLE_LABELS_TR = {
    female: "Kadın",
    male: "Erkek"
  };

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

  function statusLabelTr(status) {
    const s = String(status || "").toLowerCase();
    if (s === "active") return "AKTİF";
    if (s === "inactive") return "PASİF";
    if (s === "banned") return "YASAKLI";
    return s ? s.toLocaleUpperCase("tr-TR") : "-";
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

  function listFromBody(bodyJson) {
    if (!bodyJson) return [];
    return bodyJson.data ?? bodyJson.users ?? bodyJson.agents ?? [];
  }

  function applyUserSearch(items = []) {
    const q = String(usersSearch || "").trim().toLocaleLowerCase("tr-TR");
    if (!q) return Array.isArray(items) ? items : [];
    const list = Array.isArray(items) ? items : [];
    return list.filter((u) => {
      const haystack = [
        u?.displayName,
        u?.email,
        String(u?.id || ""),
        u?.extras?.providerId,
        u?.extras?.credential
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(q);
    });
  }

  function isoDatePart(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  function applyUserFilters(items = []) {
    let list = Array.isArray(items) ? items.slice() : [];

    if (userPremiumFilter) {
      list = list.filter((u) =>
        userPremiumFilter === "yes" ? Boolean(u?.extras?.isPremium) : !u?.extras?.isPremium
      );
    }

    if (userAuthFilter) {
      list = list.filter(
        (u) => String(u?.extras?.credential || "").toLowerCase() === userAuthFilter
      );
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
        String(u?.extras?.nativeLang || "").toLowerCase().includes(lang)
      );
    }

    if (userCreatedDateFilter) {
      list = list.filter((u) => isoDatePart(u?.createdAt) === userCreatedDateFilter);
    }

    if (userLastLoginDateFilter) {
      list = list.filter((u) => isoDatePart(u?.lastLoginAt) === userLastLoginDateFilter);
    }

    return list;
  }

  function entityFromBody(bodyJson) {
    if (!bodyJson) return null;
    return bodyJson.data ?? bodyJson.user ?? bodyJson.agent ?? null;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    if (body?.code === "PANEL_UNAUTHORIZED") {
      return "Panel API anahtarı hatalı veya eksik.";
    }
    if (body?.code === "PANEL_NOT_CONFIGURED") {
      return "MindCoach sunucusunda PANEL_API_KEY tanımlı değil.";
    }
    if (body?.code === "EMAIL_IN_USE") return "Bu e-posta başka kullanıcıda.";

    const validationDetail = Array.isArray(body?.validationErrors)
      ? body.validationErrors.filter(Boolean).join("; ")
      : "";
    const detail =
      validationDetail ||
      body?.msg ||
      body?.message ||
      body?.error ||
      data?.error;
    if (detail && data?.statusCode) {
      return `${detail} (HTTP ${data.statusCode})`;
    }
    if (detail) return detail;
    if (data?.statusCode) return `${fallback} (HTTP ${data.statusCode})`;
    return fallback;
  }

  function showAgentFormError(message) {
    const el = $("editAgentMessage");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setHealthBadge(ok, text) {
    const el = $("healthBadge");
    el.className = "badge " + (ok ? "ok" : "fail");
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function agentDisplayName(agent) {
    return (
      agent.displayName ||
      agent.names?.tr ||
      agent.names?.en ||
      `ID ${agent.id}`
    );
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function prettifyKey(key) {
    return String(key || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function jobLabel(value) {
    return JOB_LABELS_TR[value] || prettifyKey(value);
  }

  function featureLabel(value) {
    return FEATURE_LABELS_TR[value] || prettifyKey(value);
  }

  function roleLabel(value) {
    return ROLE_LABELS_TR[value] || prettifyKey(value);
  }

  function explanationVariantNumber(key) {
    const match = String(key || "").match(/_(\d+)$/);
    return match ? match[1] : "?";
  }

  function explanationTextForKey(key) {
    const raw = String(key || "");
    return explanationTextsByKey[raw] || "";
  }

  function renderExplanationPicker(selectedJob, selectedKey = "") {
    const picker = $("agentExplanationPicker");
    const hidden = $("agentExplanation");
    if (!picker || !hidden) return;

    const withTextByJob = agentOptions?.explanationsWithTextByJob || {};
    const keysByJob = agentOptions?.explanationsByJob || {};
    let items = withTextByJob[selectedJob];
    if (!Array.isArray(items) || !items.length) {
      const keys = keysByJob[selectedJob] || [];
      items = keys.map((key) => ({ key, text: explanationTextForKey(key) }));
    }

    if (!selectedJob) {
      picker.innerHTML = `<p class="field-hint">Önce meslek seçin.</p>`;
      hidden.value = "";
      return;
    }

    if (!items.length) {
      picker.innerHTML = `<p class="field-hint">Bu meslek için açıklama şablonu bulunamadı.</p>`;
      hidden.value = "";
      return;
    }

    const effectiveKey =
      selectedKey && items.some((i) => i.key === selectedKey) ? selectedKey : items[0].key;

    picker.innerHTML = items
      .map(({ key, text }) => {
        const num = explanationVariantNumber(key);
        const body = text || `Şablon ${num} (metin yüklenemedi)`;
        const selected = key === effectiveKey ? " selected" : "";
        return `<button type="button" class="explanation-option${selected}" data-explanation-key="${escapeHtml(key)}">
          <span class="explanation-option-num">Şablon ${num}</span>
          <span class="explanation-option-text">${escapeHtml(body)}</span>
        </button>`;
      })
      .join("");

    hidden.value = effectiveKey;
  }

  function setMultiState(type, values) {
    const safeValues = Array.isArray(values) ? values.filter(Boolean) : [];
    if (type === "features") selectedFeatures = safeValues;
    if (type === "roles") selectedRoles = safeValues;
    renderMultiSelect(type);
    if (type === "roles") {
      updateAgentMediaPathHint();
      loadVoiceOptions({ selected: $("agentVoiceId")?.value || "" }).catch(() => {});
    }
  }

  function toggleMultiValue(type, value) {
    if (type === "roles") {
      const current = selectedRoles[0];
      setMultiState("roles", current === value ? [] : [value]);
      return;
    }
    const current = type === "features" ? selectedFeatures : selectedRoles;
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setMultiState(type, Array.from(set));
  }

  function renderMultiSelect(type) {
    const options = type === "features" ? agentFeatureOptions : agentRoleOptions;
    const selected = type === "features" ? selectedFeatures : selectedRoles;
    const trigger = $(type === "features" ? "agentFeaturesTrigger" : "agentRolesTrigger");
    const menu = $(type === "features" ? "agentFeaturesMenu" : "agentRolesMenu");
    const chips = $(type === "features" ? "agentFeaturesChips" : "agentRolesChips");
    const labelFn = type === "features" ? featureLabel : roleLabel;

    if (trigger) {
      trigger.textContent = selected.length
        ? `${selected.length} seçim`
        : type === "features"
          ? "Özellik seçin"
          : "Cinsiyet seçin";
    }
    if (menu) {
      menu.innerHTML = options.length
        ? options
            .map(
              (value) => `<label class="multi-select-item">
              <input type="checkbox" data-multi="${type}" value="${value}" ${
                selected.includes(value) ? "checked" : ""
              } />
              <span>${labelFn(value)}</span>
            </label>`
            )
            .join("")
        : `<div class="field-hint">Önce meslek seçin.</div>`;
    }
    if (chips) {
      chips.innerHTML = selected.length
        ? selected
            .map(
              (value) => `<button type="button" class="multi-chip" data-chip-remove="${type}" data-value="${value}">
              ${labelFn(value)} <span>×</span>
            </button>`
            )
            .join("")
        : `<span class="field-hint">Henüz seçim yok.</span>`;
    }
  }

  function renderNameInputs() {
    const grid = $("agentNamesGrid");
    if (!grid) return;
    grid.innerHTML = NAME_LANGS.map(
      (lang) => `<div class="field">
        <label for="agentName_${lang.code}">Ad (${lang.label}) *</label>
        <input class="input" id="agentName_${lang.code}" type="text" />
      </div>`
    ).join("");
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
    if (view === "agents") closeAgentEditor();
    if (view !== "agents") closeAgentEditor();
    if (view !== "users") closeUserInsightsPanel();
    if (view === "users") closeUserInsightsPanel();
    document.querySelectorAll(".view-panel").forEach((el) => {
      el.classList.toggle("active", el.id === `view-${view}`);
    });
    document.querySelectorAll(".sidebar .nav-link[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    if (view === "users") loadUsers();
    if (view === "agents") loadAgents();
    if (view === "revenuecat") window.RevenueCatPanel?.load(appId);
  }

  function fillSelect(selectEl, items, { valueKey = "id", labelKey = "label", emptyLabel } = {}) {
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

  function applyAgentFiltersAndSort(items = []) {
    let list = Array.isArray(items) ? items.slice() : [];
    const q = String(agentsSearch || "")
      .trim()
      .toLocaleLowerCase("tr-TR");
    if (q) {
      list = list.filter((a) => {
        const names = a?.names && typeof a.names === "object" ? Object.values(a.names) : [];
        const haystack = [
          a?.displayName,
          ...names,
          a?.job,
          String(a?.id || "")
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("tr-TR");
        return haystack.includes(q);
      });
    }
    if (agentJobFilter) {
      list = list.filter((a) => String(a.job || "") === agentJobFilter);
    }
    if (agentRoleFilter) {
      list = list.filter((a) =>
        Array.isArray(a?.extras?.roles) ? a.extras.roles.includes(agentRoleFilter) : false
      );
    }
    list.sort((a, b) => {
      const aid = Number(a?.id || 0);
      const bid = Number(b?.id || 0);
      return agentSortBy === "id_desc" ? bid - aid : aid - bid;
    });
    return list;
  }

  function triggerAgentSearch() {
    agentsSearch = $("agentSearch").value.trim();
    agentsPage = 1;
    loadAgents();
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
    const upcoming = Array.isArray(insights.upcomingAppointments) ? insights.upcomingAppointments : [];
    const past = Array.isArray(insights.pastAppointments) ? insights.pastAppointments : [];

    const titleName = toDisplayName(user?.displayName || "") || user?.email || `ID ${userId}`;
    $("userInsightsTitle").textContent = `Kullanıcı: ${titleName}`;
    $("userStatLinkedAgents").textContent = formatNumber(summary.linkedAgentCount ?? linkedAgents.length);
    $("userStatAppointments").textContent = formatNumber(summary.appointmentCount ?? (upcoming.length + past.length));
    $("userStatUpcoming").textContent = formatNumber(summary.upcomingCount ?? upcoming.length);
    $("userStatPast").textContent = formatNumber(summary.pastCount ?? past.length);

    renderInsightsRows(
      "userInsightsAgentsBody",
      linkedAgents,
      (agent) => `<tr>
          <td><div class="user-cell-title">${escapeHtml(agent.displayName || `Rehber #${agent.agentId}`)}</div><div class="user-cell-sub">ID ${escapeHtml(agent.agentId)}</div></td>
          <td>${escapeHtml(jobLabel(agent.job || ""))}</td>
          <td>${formatDateTime(agent.firstChatAt)}</td>
          <td>${formatDateTime(agent.lastMessageAt)}</td>
        </tr>`,
      "Bu kullanıcı henüz rehberlerle sohbet etmemiş.",
      4
    );

    const appointmentRow = (a) => `<tr>
        <td>${formatDateTime(a.appointmentDate)}</td>
        <td>${escapeHtml(a.consultantName || `Rehber #${a.consultantId}`)}</td>
        <td><span class="status-pill ${escapeHtml((a.status || "pending").toLowerCase())}">${escapeHtml(a.status || "pending")}</span></td>
      </tr>`;
    renderInsightsRows("userInsightsUpcomingBody", upcoming, appointmentRow, "Gelecek randevu yok.", 3);
    renderInsightsRows("userInsightsPastBody", past, appointmentRow, "Geçmiş randevu yok.", 3);

    openUserInsightsPanel();
  }

  function roleGenderValue() {
    if (selectedRoles.includes("female")) return "female";
    if (selectedRoles.includes("male")) return "male";
    return "";
  }

  function voiceLabel(v) {
    const g = v.gender === "female" ? "Kadın" : v.gender === "male" ? "Erkek" : "Bilinmiyor";
    return `${v.name} (${g})`;
  }

  function updateVoicePreview() {
    const select = $("agentVoiceId");
    const audio = $("agentVoicePreview");
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

  function renderVoiceOptions({ selected = "" } = {}) {
    const select = $("agentVoiceId");
    if (!select) return;
    const gender = roleGenderValue();
    if (!gender) {
      fillSelect(select, [], { valueKey: "value", labelKey: "label", emptyLabel: "Önce cinsiyet seçin" });
      select.disabled = true;
      const hintNoGender = $("agentVoiceHint");
      if (hintNoGender) {
        hintNoGender.textContent = "Ses seçimi, cinsiyet seçiminden sonra açılır.";
      }
      return;
    }

    const exact = voiceOptionsCache.filter((v) => v.gender === gender);
    const list = exact.length ? exact : voiceOptionsCache.slice();
    fillSelect(
      select,
      list.map((v) => ({ value: v.voiceId, label: voiceLabel(v) })),
      { valueKey: "value", labelKey: "label", emptyLabel: list.length ? "Ses seçin" : "Uygun ses bulunamadı" }
    );
    select.disabled = list.length === 0;
    if (selected) {
      const hasSelected = list.some((v) => v.voiceId === selected);
      if (!hasSelected) {
        const fromAll = voiceOptionsCache.find((v) => v.voiceId === selected);
        if (fromAll) {
          const opt = document.createElement("option");
          opt.value = fromAll.voiceId;
          opt.textContent = `${voiceLabel(fromAll)} (mevcut)`;
          select.appendChild(opt);
        }
      }
      select.value = selected;
    }
    const hint = $("agentVoiceHint");
    if (hint) {
      hint.textContent = exact.length
        ? `${gender === "female" ? "Kadın" : "Erkek"} sesleri listeleniyor.`
        : "Bu cinsiyet etiketiyle ses bulunamadı; tüm sesler listelendi.";
    }
    updateVoicePreview();
  }

  async function loadVoiceOptions({ selected = "" } = {}) {
    const response = await fetch(`/api/apps/${appId}/proxy/voices`);
    const data = await response.json();
    if (!data.ok) {
      voiceOptionsCache = [];
      renderVoiceOptions({ selected: "" });
      return;
    }
    const list = data.bodyJson?.data ?? data.bodyJson ?? [];
    voiceOptionsCache = Array.isArray(list) ? list.filter((v) => v && v.voiceId) : [];
    renderVoiceOptions({ selected });
  }

  function syncAgentDependentOptions({ preserve = true } = {}) {
    if (!agentOptions) return;
    const selectedJob = $("agentJob").value;
    const explanationsByJob = agentOptions?.explanationsByJob || {};
    const featuresByJob = agentOptions?.featuresByJob || {};
    const roleOptions = agentOptions?.roles || [];

    const explanationCurrent = preserve ? $("agentExplanation").value : "";
    renderExplanationPicker(selectedJob, explanationCurrent);

    const featureCurrent = preserve ? selectedFeatures : [];
    const roleCurrent = preserve ? selectedRoles : [];
    agentFeatureOptions = featuresByJob[selectedJob] || [];
    agentRoleOptions = roleOptions;
    setMultiState("features", featureCurrent.filter((v) => agentFeatureOptions.includes(v)));
    setMultiState("roles", roleCurrent.filter((v) => agentRoleOptions.includes(v)));
  }

  async function loadAgentOptions() {
    const response = await fetch(`/api/apps/${appId}/proxy/agents/options`);
    const data = await response.json();
    if (!data.ok) return;

    agentOptions = data.bodyJson?.data ?? data.bodyJson ?? null;
    explanationTextsByKey = agentOptions?.explanationTextsByKey || {};
    if (!Object.keys(explanationTextsByKey).length && agentOptions?.explanationsWithTextByJob) {
      for (const list of Object.values(agentOptions.explanationsWithTextByJob)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (item?.key && item?.text) explanationTextsByKey[item.key] = item.text;
        }
      }
    }
    fillSelect(
      $("agentJob"),
      (agentOptions?.jobs || agentOptions?.job || []).map((value) => ({
        value,
        label: jobLabel(value)
      })),
      { emptyLabel: "Meslek seçin" }
    );
    fillSelect(
      $("agentJobFilter"),
      (agentOptions?.jobs || agentOptions?.job || []).map((value) => ({
        value,
        label: jobLabel(value)
      })),
      { valueKey: "value", labelKey: "label", emptyLabel: "Tüm meslekler" }
    );
    syncAgentDependentOptions({ preserve: false });
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
    const name = app.appName || "MindCoach";
    $("appTitle").textContent = name;
    $("sidebarAppName").textContent = name;
    $("breadcrumbName").textContent = name;
    const iconEl = $("headerAppIcon");
    const iconFallback = $("headerAppIconFallback");
    const iconUrl = String(app.iconUrl || "").trim();
    if (iconEl && iconFallback) {
      if (iconUrl) {
        iconEl.hidden = false;
        iconFallback.hidden = true;
        iconEl.src = iconUrl;
        iconEl.onerror = () => {
          iconEl.hidden = true;
          iconFallback.hidden = false;
        };
      } else {
        iconEl.hidden = true;
        iconFallback.hidden = false;
      }
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

  async function loadAgentCount() {
    const response = await fetch(`/api/apps/${appId}/proxy/agents?page=1&limit=1`);
    const data = await response.json();
    if (!data.ok) {
      $("statAgents").textContent = "—";
      return;
    }
    const pag = data.bodyJson?.pagination;
    $("statAgents").textContent = formatNumber(pag?.total ?? listFromBody(data.bodyJson).length);
  }

  async function loadAnalyse() {
    $("dailyError").hidden = true;
    setStatsLoading(true);
    const response = await fetch(`/api/apps/${appId}/proxy/analyse`);
    const data = await response.json();
    setStatsLoading(false);

    if (!data.ok) {
      ["statTotal", "statLogins", "statNew"].forEach((id) => {
        $(id).textContent = "—";
      });
      ["statWeeklyLogins", "statWeeklyNewUsers", "statDailyAvgLogins", "statDailyAvgNewUsers"].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = "—";
      });
      const chart = $("dailyMiniChart");
      if (chart) chart.innerHTML = "";
      $("dailyError").hidden = false;
      $("dailyError").textContent = apiErrorMessage(data, "Analiz alınamadı.");
      await loadAgentCount();
      return;
    }

    const summary = data.bodyJson?.summary || {};
    $("statTotal").textContent = formatNumber(summary.totalUsers);
    $("statLogins").textContent = formatNumber(summary.loginsToday);
    $("statNew").textContent = formatNumber(summary.newUsersToday);

    const tz = data.bodyJson?.timezone;
    $("agentsTypeHint").textContent = tz
      ? `Metrikler ${tz} saat dilimine göre hesaplanır.`
      : "";

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
            <div class="mini-bar" style="height:${h}px" title="${row.date}: ${logins} oturum"></div>
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
          .map(
            (row) => {
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
            </tr>`
            }
          )
          .join("")
      : `<tr><td colspan="3" class="user-cell-sub">Veri yok</td></tr>`;

    await loadAgentCount();
  }

  function openEditUser(user) {
    if (!canManage) return;
    const ex = user.extras || {};
    $("editUserId").value = user.id;
    $("editDisplayName").value = user.displayName || "";
    $("editEmail").value = user.email || "";
    $("editAge").value = ex.age ?? "";
    $("editGender").value = ex.gender || "";
    $("editNativeLang").value = ex.nativeLang || "";
    $("editStatus").value = user.status || "active";
    const meta = [];
    if (ex.credential) meta.push(`Giriş: ${ex.credential}`);
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
            const sub = user.email && user.displayName ? user.email : "";
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
                    : ""
                }
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="10"><p class="user-cell-sub">Eşleşen kullanıcı yok</p></td></tr>`;

    $("prevPageBtn").disabled = usersPage <= 1;
    $("nextPageBtn").disabled = usersPage >= (usersPagination?.totalPages || 1);
  }

  function openCreateAgent() {
    if (!canManage) return;
    agentEditMode = "create";
    $("agentDialogTitle").textContent = "Yeni rehber";
    $("editAgentId").value = "";
    NAME_LANGS.forEach((lang) => {
      const input = $(`agentName_${lang.code}`);
      if (input) input.value = "";
    });
    $("agentJob").value = "";
    syncAgentDependentOptions({ preserve: false });
    $("agentVoiceId").value = "";
    updateVoicePreview();
    $("agentMainPrompt").value = "";
    $("agentMediaCode").value = "";
    clearAgentMediaFiles();
    updateAgentMediaPathHint();
    $("agentMediaCurrentUrls").hidden = true;
    if ($("agentVoiceHint")) {
      $("agentVoiceHint").textContent = "Cinsiyet seçimine göre uygun sesler listelenir.";
    }
    setMultiState("features", []);
    setMultiState("roles", []);
    loadVoiceOptions({ selected: "" }).catch(() => {});
    $("agentRating").value = "0";
    $("linkedUsersHint").hidden = true;
    $("editAgentMessage").hidden = true;
    openAgentEditor();
  }

  function fillAgentForm(agent) {
    const ex = agent.extras || {};
    NAME_LANGS.forEach((lang) => {
      const input = $(`agentName_${lang.code}`);
      if (input) {
        input.value =
          agent.names?.[lang.code] || (lang.code === "tr" ? agent.displayName || "" : "");
      }
    });
    $("agentJob").value = agent.job || "";
    syncAgentDependentOptions({ preserve: false });
    renderExplanationPicker($("agentJob").value, ex.explanation || "");
    $("agentVoiceId").value = ex.voiceId || "";
    updateVoicePreview();
    $("agentMainPrompt").value = ex.mainPrompt || "";
    $("agentMediaCode").value =
      mediaCodeFromPhotoUrl(ex.photoURL || "") ||
      mediaCodeFromRiveUrl(ex.url3d || "") ||
      "";
    clearAgentMediaFiles();
    updateAgentMediaPathHint();
    updateAgentMediaCurrentUrls(ex);
    setMultiState("features", Array.isArray(ex.features) ? ex.features : []);
    setMultiState("roles", Array.isArray(ex.roles) ? ex.roles : []);
    loadVoiceOptions({ selected: ex.voiceId || "" }).catch(() => {});
    $("agentRating").value = ex.rating ?? "";
  }

  async function loadAgentDetail(agentId) {
    const response = await fetch(
      `/api/apps/${appId}/proxy/agents/${encodeURIComponent(agentId)}`
    );
    const data = await response.json();
    if (!data.ok) return null;
    return entityFromBody(data.bodyJson);
  }

  async function openEditAgent(agent) {
    if (!canManage) return;
    agentEditMode = "edit";
    $("agentDialogTitle").textContent = `Rehber: ${agentDisplayName(agent)}`;
    $("editAgentId").value = agent.id;
    fillAgentForm(agent);
    $("editAgentMessage").hidden = true;
    $("linkedUsersHint").hidden = true;

    const detail = await loadAgentDetail(agent.id);
    if (detail) {
      agentsCache.set(String(detail.id), detail);
      fillAgentForm(detail);
      const linked = detail.linkedUsers;
      if (Array.isArray(linked) && linked.length) {
        $("linkedUsersHint").hidden = false;
        $("linkedUsersHint").textContent = `${linked.length} bağlı kullanıcı (sohbet geçmişi)`;
      }
    }

    openAgentEditor();
  }

  function normalizeMediaCodeInput(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (!s) return "";
    return s
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function mediaCodeFromPhotoUrl(photoURL) {
    if (!photoURL) return "";
    const m = String(photoURL).match(/\/c_([a-z0-9_]+)\.png$/i);
    return m ? m[1] : "";
  }

  function mediaCodeFromRiveUrl(url3d) {
    if (!url3d) return "";
    const m = String(url3d).match(/\/([a-z0-9_]+)\.riv$/i);
    return m ? m[1] : "";
  }

  function deriveDetailPhotoUrl(photoURL) {
    if (!photoURL) return "";
    const original = String(photoURL);
    const dotIndex = original.lastIndexOf(".");
    if (dotIndex <= 0) return "";
    return `${original.slice(0, dotIndex)}_detail${original.slice(dotIndex)}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resolveRiveFolderLabel() {
    if (selectedRoles.includes("female")) return "Female Riv";
    if (selectedRoles.includes("male")) return "Male Riv";
    return "Female Riv / Male Riv";
  }

  function updateAgentMediaPathHint() {
    const code = normalizeMediaCodeInput($("agentMediaCode")?.value || "") || "kod";
    const rivDir = resolveRiveFolderLabel();
    const hint = $("agentMediaPathHint");
    if (!hint) return;
    hint.innerHTML = `Ana: <code>images/c_${code}.png</code> · Detay: <code>images/c_${code}_detail.png</code> · Rive: <code>${rivDir}/${code}.riv</code>`;
  }

  function updateAgentMediaCurrentUrls(ex = {}) {
    const el = $("agentMediaCurrentUrls");
    const preview = $("agentExistingMedia");
    if (!el) return;
    const parts = [];
    if (ex.photoURL) parts.push(`Kayıtlı ana foto: ${ex.photoURL}`);
    if (ex.url3d) parts.push(`Kayıtlı Rive: ${ex.url3d}`);
    if (parts.length) {
      el.hidden = false;
      el.textContent = parts.join(" · ");
    } else {
      el.hidden = true;
      el.textContent = "";
    }

    if (!preview) return;
    const cards = [];
    if (ex.photoURL) {
      const safeMain = escapeHtml(ex.photoURL);
      cards.push(
        `<figure class="agent-media-thumb"><img src="${safeMain}" alt="Ana fotoğraf" loading="lazy" /><figcaption>Ana fotoğraf</figcaption></figure>`
      );
      const detailUrl = deriveDetailPhotoUrl(ex.photoURL);
      if (detailUrl) {
        const safeDetail = escapeHtml(detailUrl);
        cards.push(
          `<figure class="agent-media-thumb"><img src="${safeDetail}" alt="Detay fotoğraf" loading="lazy" /><figcaption>Detay fotoğraf</figcaption></figure>`
        );
      }
    }
    if (ex.url3d) {
      const safeRiv = escapeHtml(ex.url3d);
      cards.push(
        `<figure class="agent-media-thumb"><div class="agent-riv-chip">Rive dosyası hazır</div><figcaption><a href="${safeRiv}" target="_blank" rel="noopener noreferrer">.riv dosyasını aç</a></figcaption></figure>`
      );
    }

    if (!cards.length) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    preview.hidden = false;
    preview.innerHTML = `<div class="agent-photo-grid">${cards.join("")}</div>`;
  }

  function clearAgentMediaFiles() {
    ["agentMainPhoto", "agentDetailPhoto", "agentRiveFile"].forEach((id) => {
      const input = $(id);
      if (input) input.value = "";
    });
  }

  function agentFormHasMediaFiles() {
    return Boolean(
      $("agentMainPhoto")?.files?.[0] ||
        $("agentDetailPhoto")?.files?.[0] ||
        $("agentRiveFile")?.files?.[0]
    );
  }

  function validateAgentPayload(payload, { hasMediaFiles, mediaCode, rawMediaCode }) {
    const missingLangs = NAME_LANGS.filter((lang) => !payload.names?.[lang.code]).map(
      (lang) => lang.code
    );
    if (missingLangs.length) {
      return `İsim alanında tüm diller zorunlu: ${missingLangs.join(", ")}`;
    }
    if (!payload.job) return "Meslek seçimi zorunludur.";
    if (!payload.explanation) return "Açıklama şablonu seçin.";
    if (!payload.features?.length) return "En az bir özellik seçin.";
    if (!payload.roles?.length) return "Cinsiyet / rol seçimi zorunludur.";
    if (!payload.voiceId) {
      return "Ses seçimi zorunludur. Önce cinsiyet seçin, ardından listeden bir ses seçin.";
    }
    if (!payload.mainPrompt) return "Sistem promptu oluşturulamadı. Meslek ve şablon seçimini kontrol edin.";
    if (rawMediaCode && !mediaCode) {
      return "CDN medya kodu yalnızca küçük harf, rakam ve alt çizgi içerebilir (ör. air).";
    }
    if (hasMediaFiles && !mediaCode) {
      return "Dosya yüklerken CDN medya kodu zorunludur (ör. air → c_air.png).";
    }
    if (hasMediaFiles && $("agentRiveFile")?.files?.[0] && payload.roles.length === 0) {
      return "Rive yüklemek için cinsiyet (male/female) seçin.";
    }
    return "";
  }

  function buildAgentFormData(payload) {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    const code = normalizeMediaCodeInput($("agentMediaCode").value);
    if (code) fd.append("mediaCode", code);
    const main = $("agentMainPhoto")?.files?.[0];
    if (main) fd.append("mainPhoto", main);
    const detail = $("agentDetailPhoto")?.files?.[0];
    if (detail) fd.append("detailPhoto", detail);
    const rive = $("agentRiveFile")?.files?.[0];
    if (rive) fd.append("riveFile", rive);
    return fd;
  }

  function buildAutoMainPrompt(payload) {
    const trName = payload.names?.tr || payload.names?.en || "rehber";
    const jobLabelText = jobLabel(payload.job);
    const featureLabels = (payload.features || [])
      .slice(0, 5)
      .map((f) => featureLabel(f));
    const roleLabelText = (payload.roles || []).map((r) => roleLabel(r)).join(", ");
    const explanationText = explanationTextsByKey[payload.explanation] || payload.explanation || "";

    const parts = [
      `Sen ${trName} adında bir MindCoach rehberisin.`,
      jobLabelText ? `Uzmanlık alanın: ${jobLabelText}.` : "",
      roleLabelText ? `Profil/cinsiyet: ${roleLabelText}.` : "",
      featureLabels.length ? `Odaklandığın konular: ${featureLabels.join(", ")}.` : "",
      explanationText ? `Yönlendirme çerçeven: ${explanationText}` : ""
    ].filter(Boolean);

    return parts.join(" ").trim();
  }

  function buildAgentPayload() {
    const names = {};
    for (const lang of NAME_LANGS) {
      const val = $(`agentName_${lang.code}`)?.value.trim() || "";
      if (val) names[lang.code] = val;
    }
    const payload = {
      names,
      job: $("agentJob").value,
      voiceId: $("agentVoiceId").value.trim(),
      features: selectedFeatures.slice(),
      roles: selectedRoles.slice()
    };

    const explanation = $("agentExplanation").value.trim();
    if (explanation) payload.explanation = explanation;

    const rating = $("agentRating").value.trim().replace(",", ".");
    if (rating !== "") payload.rating = Number(Number(rating).toFixed(2));

    const autoPrompt = buildAutoMainPrompt(payload);
    payload.mainPrompt = autoPrompt;
    $("agentMainPrompt").value = autoPrompt;

    return payload;
  }

  async function loadAgents() {
    $("agentsError").hidden = true;
    $("agentsBody").innerHTML = `<tr><td colspan="4" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: agentsPage, limit: agentsLimit });
    if (agentsSearch) params.set("search", agentsSearch);

    const response = await fetch(`/api/apps/${appId}/proxy/agents?${params}`);
    const data = await response.json();

    if (!data.ok) {
      $("agentsBody").innerHTML = "";
      $("agentsError").hidden = false;
      $("agentsError").textContent = apiErrorMessage(data, "Rehber listesi alınamadı.");
      $("agentsMeta").textContent = "Liste alınamadı";
      $("agentPrevBtn").disabled = true;
      $("agentNextBtn").disabled = true;
      return;
    }

    const agents = applyAgentFiltersAndSort(listFromBody(data.bodyJson));
    agentsPagination = data.bodyJson?.pagination || null;
    agentsCache.clear();
    agents.forEach((a) => agentsCache.set(String(a.id), a));

    $("agentsMeta").textContent = agentsPagination
      ? `${formatNumber(agentsPagination.total)} rehber · ${agentsPagination.page}/${agentsPagination.totalPages} (görünen: ${agents.length})`
      : `${agents.length} kayıt`;

    $("agentsBody").innerHTML = agents.length
      ? agents
          .map((agent) => {
            const usage = agent.usage || {};
            return `<tr data-agent-id="${agent.id}" style="cursor:pointer">
              <td>
                <div class="user-cell-title">${agentDisplayName(agent)}</div>
                <div class="user-cell-sub">ID ${agent.id}</div>
              </td>
              <td class="user-cell-sub">${agent.job ? jobLabel(agent.job) : "—"}</td>
              <td>${formatNumber(usage.linkedUserCount)}</td>
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
      : `<tr><td colspan="4"><p class="user-cell-sub">Eşleşen rehber yok</p></td></tr>`;

    $("agentPrevBtn").disabled = agentsPage <= 1;
    $("agentNextBtn").disabled = agentsPage >= (agentsPagination?.totalPages || 1);
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

  $("searchBtn").addEventListener("click", () => {
    usersSearch = $("userSearch").value.trim();
    usersPage = 1;
    loadUsers();
  });

  $("userPremiumFilter").addEventListener("change", () => {
    userPremiumFilter = $("userPremiumFilter").value || "";
    usersPage = 1;
    loadUsers();
  });
  $("userAuthFilter").addEventListener("change", () => {
    userAuthFilter = $("userAuthFilter").value || "";
    usersPage = 1;
    loadUsers();
  });
  $("userGenderFilter").addEventListener("change", () => {
    userGenderFilter = $("userGenderFilter").value || "";
    usersPage = 1;
    loadUsers();
  });
  $("userLangFilter").addEventListener("input", () => {
    userLangFilter = $("userLangFilter").value || "";
    usersPage = 1;
    loadUsers();
  });
  $("userCreatedDateFilter").addEventListener("change", () => {
    userCreatedDateFilter = $("userCreatedDateFilter").value || "";
    usersPage = 1;
    loadUsers();
  });
  $("userLastLoginDateFilter").addEventListener("change", () => {
    userLastLoginDateFilter = $("userLastLoginDateFilter").value || "";
    usersPage = 1;
    loadUsers();
  });

  $("userSearch").addEventListener("input", () => {
    if (usersSearchDebounceTimer) clearTimeout(usersSearchDebounceTimer);
    usersSearchDebounceTimer = setTimeout(() => {
      usersSearch = $("userSearch").value.trim();
      usersPage = 1;
      loadUsers();
    }, 300);
  });

  $("userSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (usersSearchDebounceTimer) clearTimeout(usersSearchDebounceTimer);
      $("searchBtn").click();
    }
  });

  $("userClearFilterBtn").addEventListener("click", () => {
    usersSearch = "";
    userPremiumFilter = "";
    userAuthFilter = "";
    userGenderFilter = "";
    userLangFilter = "";
    userCreatedDateFilter = "";
    userLastLoginDateFilter = "";
    $("userSearch").value = "";
    $("userPremiumFilter").value = "";
    $("userAuthFilter").value = "";
    $("userGenderFilter").value = "";
    $("userLangFilter").value = "";
    $("userCreatedDateFilter").value = "";
    $("userLastLoginDateFilter").value = "";
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

  $("usersBody").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-user]");
    if (editBtn) {
      if (!canManage) return;
      const user = usersCache.get(editBtn.getAttribute("data-edit-user"));
      if (user) openEditUser(user);
      return;
    }
    const detailBtn = e.target.closest("[data-user-detail]");
    if (detailBtn) {
      openUserInsights(detailBtn.getAttribute("data-user-detail")).catch(() => {
        showToast("Kullanıcı detayı açılamadı");
      });
      return;
    }
    const row = e.target.closest("tr[data-user-id]");
    if (!row) return;
    openUserInsights(row.getAttribute("data-user-id")).catch(() => {
      showToast("Kullanıcı detayı açılamadı");
    });
  });

  $("closeUserInsightsBtn").addEventListener("click", closeUserInsightsPanel);

  $("closeUserDialogBtn").addEventListener("click", () => $("editUserDialog").close());

  $("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("editUserId").value;
    $("editUserMessage").hidden = true;

    const extras = {};
    const age = $("editAge").value.trim();
    const gender = $("editGender").value.trim();
    const nativeLang = $("editNativeLang").value.trim();
    if (age) extras.age = Number(age);
    if (gender) extras.gender = gender;
    if (nativeLang) extras.nativeLang = nativeLang;

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

  $("newAgentBtn")?.addEventListener("click", openCreateAgent);
  $("agentJob").addEventListener("change", () => syncAgentDependentOptions({ preserve: false }));
  $("agentExplanationPicker").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-explanation-key]");
    if (!btn) return;
    const key = btn.getAttribute("data-explanation-key");
    $("agentExplanation").value = key;
    $("agentExplanationPicker")
      .querySelectorAll(".explanation-option")
      .forEach((el) => el.classList.toggle("selected", el === btn));
  });

  ["agentFeaturesTrigger", "agentRolesTrigger"].forEach((id) => {
    $(id).addEventListener("click", (e) => {
      e.preventDefault();
      const isFeatures = id === "agentFeaturesTrigger";
      const menu = $(isFeatures ? "agentFeaturesMenu" : "agentRolesMenu");
      const other = $(isFeatures ? "agentRolesMenu" : "agentFeaturesMenu");
      if (other) other.hidden = true;
      menu.hidden = !menu.hidden;
    });
  });

  document.addEventListener("click", (e) => {
    if (!$("agentFeaturesMulti").contains(e.target)) $("agentFeaturesMenu").hidden = true;
    if (!$("agentRolesMulti").contains(e.target)) $("agentRolesMenu").hidden = true;
  });

  $("agentFeaturesMenu").addEventListener("change", (e) => {
    const cb = e.target.closest('input[data-multi="features"]');
    if (!cb) return;
    toggleMultiValue("features", cb.value);
  });

  $("agentRolesMenu").addEventListener("change", (e) => {
    const cb = e.target.closest('input[data-multi="roles"]');
    if (!cb) return;
    toggleMultiValue("roles", cb.value);
  });

  $("agentFeaturesChips").addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-chip-remove="features"]');
    if (!btn) return;
    toggleMultiValue("features", btn.getAttribute("data-value"));
  });

  $("agentRolesChips").addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-chip-remove="roles"]');
    if (!btn) return;
    toggleMultiValue("roles", btn.getAttribute("data-value"));
  });

  $("agentSearchBtn").addEventListener("click", () => {
    triggerAgentSearch();
  });

  $("agentSearch").addEventListener("input", () => {
    if (agentSearchDebounceTimer) clearTimeout(agentSearchDebounceTimer);
    agentSearchDebounceTimer = setTimeout(() => {
      triggerAgentSearch();
    }, 300);
  });

  $("agentSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (agentSearchDebounceTimer) clearTimeout(agentSearchDebounceTimer);
    triggerAgentSearch();
  });

  $("agentSortBy").addEventListener("change", () => {
    agentSortBy = $("agentSortBy").value || "id_asc";
    loadAgents();
  });

  $("agentJobFilter").addEventListener("change", () => {
    agentJobFilter = $("agentJobFilter").value || "";
    loadAgents();
  });

  $("agentRoleFilter").addEventListener("change", () => {
    agentRoleFilter = $("agentRoleFilter").value || "";
    loadAgents();
  });

  $("agentClearFilterBtn").addEventListener("click", () => {
    agentsSearch = "";
    agentSortBy = "id_asc";
    agentJobFilter = "";
    agentRoleFilter = "";
    $("agentSearch").value = "";
    $("agentSortBy").value = "id_asc";
    $("agentJobFilter").value = "";
    $("agentRoleFilter").value = "";
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
    if (agentsPage < (agentsPagination?.totalPages || 1)) {
      agentsPage += 1;
      loadAgents();
    }
  });

  $("agentsBody").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-agent]");
    if (!editBtn || !canManage) return;
    const agent = agentsCache.get(editBtn.getAttribute("data-edit-agent"));
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
  $("agentVoiceId").addEventListener("change", updateVoicePreview);

  $("agentMediaCode")?.addEventListener("input", updateAgentMediaPathHint);
  $("agentMediaCode")?.addEventListener("blur", (e) => {
    const normalized = normalizeMediaCodeInput(e.target.value);
    if (normalized !== e.target.value.trim()) {
      e.target.value = normalized;
      updateAgentMediaPathHint();
    }
  });

  $("editAgentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("editAgentMessage").hidden = true;

    const payload = buildAgentPayload();
    const hasMediaFiles = agentFormHasMediaFiles();
    const rawMediaCode = $("agentMediaCode").value.trim();
    const mediaCode = normalizeMediaCodeInput(rawMediaCode);
    const validationError = validateAgentPayload(payload, {
      hasMediaFiles,
      mediaCode,
      rawMediaCode
    });
    if (validationError) {
      showAgentFormError(validationError);
      return;
    }

    const submitBtn = e.submitter;
    submitBtn.disabled = true;

    try {
      const isCreate = agentEditMode === "create";
      const url = isCreate
        ? `/api/apps/${appId}/proxy/agents`
        : `/api/apps/${appId}/proxy/agents/${encodeURIComponent($("editAgentId").value)}`;
      const fetchOpts = { method: isCreate ? "POST" : "PATCH" };
      if (hasMediaFiles) {
        fetchOpts.body = buildAgentFormData(payload);
      } else {
        fetchOpts.headers = { "Content-Type": "application/json" };
        fetchOpts.body = JSON.stringify(payload);
      }
      const response = await fetch(url, fetchOpts);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        showAgentFormError(apiErrorMessage(data, "Kayıt başarısız."));
        return;
      }
      const saved = entityFromBody(data.bodyJson);
      if (saved) agentsCache.set(String(saved.id), saved);
      closeAgentEditor();
      showToast(isCreate ? "Rehber oluşturuldu" : "Rehber güncellendi");
      loadAgents();
      loadAnalyse();
    } finally {
      submitBtn.disabled = false;
    }
  });

  (async () => {
    renderNameInputs();
    if (window.PanelAuth) {
      sessionUser = await PanelAuth.fetchSession();
      if (!sessionUser) return;
      canManage = PanelAuth.isManager(sessionUser);
      applyReadOnlyUi();
    } else {
      canManage = true;
    }

    loadAppMeta()
      .then(() =>
        Promise.all([loadAgentOptions(), loadHealth(), loadAnalyse()]).catch(() => {})
      )
      .catch(() => setHealthBadge(false, "Yükleme hatası"));
  })();
})();
