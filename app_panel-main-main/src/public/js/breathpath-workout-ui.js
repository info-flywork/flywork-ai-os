/**
 * BreathPath — egzersiz formu (medya: /panel/media/* → CDN URL, kayıt: JSON)
 */
window.BreathPathWorkoutUi = (function () {
  const STEP_ACTIONS = [
    { value: "in", label: "Nefes al" },
    { value: "hold", label: "Tut" },
    { value: "out", label: "Nefes ver" }
  ];

  let categoryMetadata = { tabCategories: {}, categories: {} };
  let stepsEditorBound = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function humanizeCode(code) {
    if (!code) return "—";
    return String(code)
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function setCategoryMetadata(data) {
    categoryMetadata = {
      tabCategories: data?.tabCategories || {},
      categories: data?.categories || {}
    };
  }

  async function loadCategoryMetadata(appId) {
    try {
      const response = await fetch(`/api/apps/${appId}/proxy/metadata/categories`);
      const data = await response.json();
      if (response.ok && data.ok !== false) {
        const body = data.bodyJson || data;
        setCategoryMetadata(body.data || body);
      }
    } catch {
      /* fallback: humanize codes */
    }
    return categoryMetadata;
  }

  function tabCategoryLabel(code) {
    if (!code) return "—";
    const entry = categoryMetadata.tabCategories[code];
    return entry?.tr || entry?.en || humanizeCode(code);
  }

  function categoryLabel(code) {
    if (!code) return "—";
    const entry = categoryMetadata.categories[code];
    return entry?.tr || entry?.en || humanizeCode(code);
  }

  function formatCategoryLabel(workout) {
    const tabCode = workout?.extras?.tabCategory;
    const groupCode = workout?.category;
    if (tabCode && groupCode) {
      return `${categoryLabel(tabCode)} · ${tabCategoryLabel(groupCode)}`;
    }
    if (tabCode) return categoryLabel(tabCode);
    if (groupCode) return tabCategoryLabel(groupCode);
    return "—";
  }

  function stepActionLabel(act) {
    const found = STEP_ACTIONS.find((a) => a.value === act);
    return found?.label || act || "—";
  }

  function formatStepsSummary(steps) {
    if (!Array.isArray(steps) || !steps.length) return "—";
    return steps
      .map((s) => `${stepActionLabel(s.act)} ${s.sec || s.seconds || 0} sn`)
      .join(" → ");
  }

  function populateCategorySelects($, selectedGroup, selectedCategory) {
    const groupEl = $("workoutCategory");
    const catEl = $("workoutTabCategory");
    if (!groupEl || !catEl) return;

    const tabEntries = Object.entries(categoryMetadata.tabCategories);
    groupEl.innerHTML =
      `<option value="">Seçin...</option>` +
      (tabEntries.length
        ? tabEntries
            .map(([code, names]) => {
              const label = names.tr || names.en || humanizeCode(code);
              const selected = code === selectedGroup ? " selected" : "";
              return `<option value="${escapeHtml(code)}"${selected}>${escapeHtml(label)}</option>`;
            })
            .join("")
        : "");

    if (selectedGroup && !categoryMetadata.tabCategories[selectedGroup]) {
      groupEl.innerHTML += `<option value="${escapeHtml(selectedGroup)}" selected>${escapeHtml(humanizeCode(selectedGroup))}</option>`;
    }

    refreshSubCategorySelect($, selectedGroup, selectedCategory);
  }

  function refreshSubCategorySelect($, groupCode, selectedCategory) {
    const catEl = $("workoutTabCategory");
    if (!catEl) return;

    const matches = Object.entries(categoryMetadata.categories).filter(([, meta]) => {
      if (!groupCode) return true;
      return meta.tabCategory === groupCode;
    });

    if (!groupCode) {
      catEl.innerHTML = `<option value="">Önce ana kategori seçin</option>`;
      catEl.disabled = true;
      return;
    }

    catEl.disabled = false;
    catEl.innerHTML =
      `<option value="">Seçin...</option>` +
      (matches.length
        ? matches
            .map(([code, names]) => {
              const label = names.tr || names.en || humanizeCode(code);
              const selected = code === selectedCategory ? " selected" : "";
              return `<option value="${escapeHtml(code)}"${selected}>${escapeHtml(label)}</option>`;
            })
            .join("")
        : "");

    if (selectedCategory && !matches.some(([code]) => code === selectedCategory)) {
      catEl.innerHTML += `<option value="${escapeHtml(selectedCategory)}" selected>${escapeHtml(categoryLabel(selectedCategory))}</option>`;
    }
  }

  function bindCategorySelects($) {
    $("workoutCategory")?.addEventListener("change", () => {
      refreshSubCategorySelect($, $("workoutCategory").value, "");
    });
  }

  function stepRowHtml(step, index) {
    const act = step?.act || "in";
    const sec = step?.sec ?? step?.seconds ?? 4;
    const options = STEP_ACTIONS.map(
      (a) => `<option value="${a.value}"${a.value === act ? " selected" : ""}>${a.label}</option>`
    ).join("");
    return `<div class="bp-step-row" data-step-index="${index}">
      <select class="select bp-step-act" aria-label="Eylem">${options}</select>
      <input class="input bp-step-sec" type="number" min="1" max="120" value="${Number(sec) || 4}" aria-label="Süre" />
      <button type="button" class="btn btn-sm btn-ghost bp-step-remove" title="Adımı sil">Sil</button>
    </div>`;
  }

  function renderStepsEditor($, steps) {
    const list = $("workoutStepsList");
    if (!list) return;
    const items = Array.isArray(steps) && steps.length ? steps : [{ act: "in", sec: 4 }];
    list.innerHTML = items.map((step, i) => stepRowHtml(step, i)).join("");
  }

  function readStepsFromEditor($) {
    const list = $("workoutStepsList");
    if (!list) return undefined;
    const rows = list.querySelectorAll(".bp-step-row");
    const steps = [];
    rows.forEach((row) => {
      const act = row.querySelector(".bp-step-act")?.value;
      const sec = Number(row.querySelector(".bp-step-sec")?.value);
      if (act && Number.isFinite(sec) && sec > 0) {
        steps.push({ act, sec: Math.round(sec) });
      }
    });
    return steps.length ? steps : undefined;
  }

  function bindStepsEditor($) {
    if (stepsEditorBound) return;
    stepsEditorBound = true;

    $("workoutAddStepBtn")?.addEventListener("click", () => {
      const list = $("workoutStepsList");
      if (!list) return;
      const index = list.querySelectorAll(".bp-step-row").length;
      list.insertAdjacentHTML("beforeend", stepRowHtml({ act: "in", sec: 4 }, index));
    });

    $("workoutStepsList")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".bp-step-remove");
      if (!btn) return;
      const row = btn.closest(".bp-step-row");
      const list = $("workoutStepsList");
      const rows = list?.querySelectorAll(".bp-step-row") || [];
      if (rows.length <= 1) {
        row.querySelector(".bp-step-act").value = "in";
        row.querySelector(".bp-step-sec").value = "4";
        return;
      }
      row.remove();
    });
  }

  function isImageUrl(url) {
    if (!url) return false;
    return /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url) || url.includes("b-cdn.net");
  }

  function isVideoUrl(url) {
    if (!url) return false;
    return /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url) || /video|stream/i.test(url);
  }

  function mediaPreviewHtml(url, label) {
    if (!url) return "";
    const safe = escapeHtml(url);
    if (isVideoUrl(url)) {
      return `<div class="workout-media-block">
        <span class="user-cell-sub">${escapeHtml(label)}</span>
        <video class="workout-media-preview" src="${safe}" controls preload="metadata"></video>
        <a class="field-hint" href="${safe}" target="_blank" rel="noopener">Videoyu aç</a>
      </div>`;
    }
    if (isImageUrl(url)) {
      return `<div class="workout-media-block">
        <span class="user-cell-sub">${escapeHtml(label)}</span>
        <img class="workout-media-preview" src="${safe}" alt="" loading="lazy" />
        <a class="field-hint" href="${safe}" target="_blank" rel="noopener">Görseli aç</a>
      </div>`;
    }
    return `<div class="workout-media-block">
      <span class="user-cell-sub">${escapeHtml(label)}</span>
      <a href="${safe}" target="_blank" rel="noopener">${safe}</a>
    </div>`;
  }

  function renderWorkoutMediaPanel(workout) {
    if (!workout) return "<p class=\"user-cell-sub\">—</p>";
    const ex = workout.extras || {};
    const blocks = [];
    if (workout.coverImageUrl) blocks.push(mediaPreviewHtml(workout.coverImageUrl, "Kapak görseli"));
    const videoUrl = ex.videoUrl || ex.introVideoUrl;
    if (videoUrl) blocks.push(mediaPreviewHtml(videoUrl, "Egzersiz videosu"));
    return blocks.length
      ? `<div class="workout-media-grid">${blocks.join("")}</div>`
      : "<p class=\"user-cell-sub\">Medya yok — dosya yükleyin veya URL girin</p>";
  }

  function linesToStringArray(raw) {
    const lines = String(raw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length ? lines : undefined;
  }

  function arrayToLines(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return arr.map((s) => String(s)).join("\n");
  }

  function readLocalizedMap($, prefix) {
    const tr = $(`${prefix}Tr`)?.value?.trim();
    const en = $(`${prefix}En`)?.value?.trim();
    const ru = $(`${prefix}Ru`)?.value?.trim();
    const zh = $(`${prefix}Zh`)?.value?.trim();
    const map = {};
    if (tr) map.tr = tr;
    if (en) map.en = en;
    if (ru) map.ru = ru;
    if (zh) map.zh = zh;
    return Object.keys(map).length ? map : undefined;
  }

  function readLocalizedBenefits($) {
    const tr = linesToStringArray($("workoutBenefitsTr")?.value);
    const en = linesToStringArray($("workoutBenefitsEn")?.value);
    const ru = linesToStringArray($("workoutBenefitsRu")?.value);
    const zh = linesToStringArray($("workoutBenefitsZh")?.value);
    const map = {};
    if (tr) map.tr = tr;
    if (en) map.en = en;
    if (ru) map.ru = ru;
    if (zh) map.zh = zh;
    return Object.keys(map).length ? map : undefined;
  }

  function readLocalizedTitles($) {
    const tr = $("workoutTitleTr")?.value?.trim();
    const en = $("workoutTitleEn")?.value?.trim();
    const ru = $("workoutTitleRu")?.value?.trim();
    const zh = $("workoutTitleZh")?.value?.trim();
    const titles = {};
    if (tr) titles.tr = tr;
    if (en) titles.en = en;
    if (ru) titles.ru = ru;
    if (zh) titles.zh = zh;
    return Object.keys(titles).length ? titles : undefined;
  }

  function validateWorkoutForm($) {
    const category = $("workoutCategory")?.value?.trim();
    const tabCategory = $("workoutTabCategory")?.value?.trim();
    const level = $("workoutDifficulty")?.value?.trim();
    const title = $("workoutTitle")?.value?.trim();
    const lt = readLocalizedTitles($);
    const hasTitle = Boolean(title || lt?.tr || lt?.en);

    if (!category) return "Ana kategori zorunludur.";
    if (!tabCategory) return "Alt kategori zorunludur.";
    if (!level) return "Seviye zorunludur.";
    if (!hasTitle) return "Başlık veya Türkçe/İngilizce başlık zorunludur.";
    return null;
  }

  function readWorkoutForm($, options = {}) {
    const { existingExtras = {} } = options;
    const localizedTitles = readLocalizedTitles($);
    const payload = {
      title: $("workoutTitle").value.trim() || localizedTitles?.en || localizedTitles?.tr || "",
      description: $("workoutDescription").value.trim() || null,
      status: $("workoutStatus").value,
      difficulty: $("workoutDifficulty").value || null,
      durationMinutes: $("workoutDuration").value ? Number($("workoutDuration").value) : null,
      category: $("workoutCategory").value.trim() || null,
      coverImageUrl: $("workoutCoverUrl").value.trim() || null
    };

    const extras = { ...existingExtras };
    const videoUrl = $("workoutVideoUrl").value.trim();
    if (videoUrl) extras.videoUrl = videoUrl;
    else delete extras.videoUrl;

    const tabCategory = $("workoutTabCategory")?.value?.trim();
    if (tabCategory) extras.tabCategory = tabCategory;
    else delete extras.tabCategory;

    const subCategory = $("workoutSubCategory")?.value?.trim();
    if (subCategory) extras.subCategory = subCategory;
    else delete extras.subCategory;

    if ($("workoutIsPremium")?.checked) extras.isPremium = true;
    else delete extras.isPremium;

    if (localizedTitles) extras.localizedTitles = localizedTitles;
    else delete extras.localizedTitles;

    const localizedBenefits = readLocalizedBenefits($);
    if (localizedBenefits) extras.localizedBenefits = localizedBenefits;
    else delete extras.localizedBenefits;

    const localizedExplain = readLocalizedMap($, "workoutExplain");
    if (localizedExplain) extras.localizedExplain = localizedExplain;
    else delete extras.localizedExplain;

    const steps = readStepsFromEditor($);
    if (steps) extras.steps = steps;
    else delete extras.steps;

    if (Object.keys(extras).length) payload.extras = extras;
    return payload;
  }

  function fillWorkoutForm($, workout) {
    const ex = workout?.extras || {};
    const lt = ex.localizedTitles || {};
    const lb = ex.localizedBenefits || {};
    const le = ex.localizedExplain || {};

    $("workoutTitle").value = workout?.title || lt.en || lt.tr || "";
    $("workoutDescription").value = workout?.description || le.en || le.tr || "";
    $("workoutStatus").value = workout?.status || "draft";
    $("workoutDifficulty").value = workout?.difficulty || "start";
    $("workoutDuration").value = workout?.durationMinutes ?? "";
    $("workoutCoverUrl").value = workout?.coverImageUrl || "";
    $("workoutVideoUrl").value = ex.videoUrl || "";

    populateCategorySelects($, workout?.category || "", ex.tabCategory || "");
    if ($("workoutSubCategory")) $("workoutSubCategory").value = ex.subCategory || "";

    if ($("workoutTitleTr")) $("workoutTitleTr").value = lt.tr || "";
    if ($("workoutTitleEn")) $("workoutTitleEn").value = lt.en || "";
    if ($("workoutTitleRu")) $("workoutTitleRu").value = lt.ru || "";
    if ($("workoutTitleZh")) $("workoutTitleZh").value = lt.zh || "";
    if ($("workoutBenefitsTr")) $("workoutBenefitsTr").value = arrayToLines(lb.tr);
    if ($("workoutBenefitsEn")) $("workoutBenefitsEn").value = arrayToLines(lb.en);
    if ($("workoutBenefitsRu")) $("workoutBenefitsRu").value = arrayToLines(lb.ru);
    if ($("workoutBenefitsZh")) $("workoutBenefitsZh").value = arrayToLines(lb.zh);
    if ($("workoutExplainTr")) $("workoutExplainTr").value = le.tr || "";
    if ($("workoutExplainEn")) $("workoutExplainEn").value = le.en || "";
    if ($("workoutExplainRu")) $("workoutExplainRu").value = le.ru || "";
    if ($("workoutExplainZh")) $("workoutExplainZh").value = le.zh || "";
    if ($("workoutIsPremium")) $("workoutIsPremium").checked = Boolean(ex.isPremium);

    renderStepsEditor($, ex.steps);

    if ($("workoutCoverFile")) $("workoutCoverFile").value = "";
    if ($("workoutVideoFile")) $("workoutVideoFile").value = "";
    setUploadStatus($, "cover", "");
    setUploadStatus($, "video", "");
    updateWorkoutMediaPreview($);
  }

  function setUploadStatus($, kind, text, isError) {
    const el = kind === "cover" ? $("coverUploadStatus") : $("videoUploadStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = "field-hint upload-status" + (isError ? " upload-status--error" : text ? " upload-status--ok" : "");
  }

  function updateWorkoutMediaPreview($) {
    const el = $("workoutMediaPreview");
    if (!el) return;
    const draft = {
      coverImageUrl: $("workoutCoverUrl").value.trim() || null,
      extras: { videoUrl: $("workoutVideoUrl").value.trim() || undefined }
    };
    el.innerHTML = renderWorkoutMediaPanel(draft);
  }

  function workoutListThumb(workout) {
    const url = workout?.coverImageUrl;
    if (!url) return '<span class="workout-thumb workout-thumb--empty">—</span>';
    if (isImageUrl(url)) {
      return `<img class="workout-thumb" src="${escapeHtml(url)}" alt="" loading="lazy" />`;
    }
    return '<span class="workout-thumb workout-thumb--link" title="Medya">▶</span>';
  }

  function bindWorkoutFormLivePreview($) {
    bindCategorySelects($);
    bindStepsEditor($);
    ["workoutCoverUrl", "workoutVideoUrl"].forEach((id) => {
      $(id)?.addEventListener("input", () => updateWorkoutMediaPreview($));
    });
  }

  return {
    escapeHtml,
    renderWorkoutMediaPanel,
    readWorkoutForm,
    validateWorkoutForm,
    fillWorkoutForm,
    updateWorkoutMediaPreview,
    setUploadStatus,
    workoutListThumb,
    bindWorkoutFormLivePreview,
    loadCategoryMetadata,
    setCategoryMetadata,
    formatCategoryLabel,
    formatStepsSummary,
    stepActionLabel,
    populateCategorySelects,
    renderStepsEditor
  };
})();
