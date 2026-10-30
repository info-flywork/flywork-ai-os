/**
 * YogiFace — yüz yogası egzersiz formu (medya: /panel/media/* → CDN URL)
 */
window.YogiFaceWorkoutUi = (function () {
  let categoryMetadata = { categories: {} };

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
      /* fallback */
    }
    return categoryMetadata;
  }

  function categoryLabel(code) {
    if (!code) return "—";
    const entry = categoryMetadata.categories[code];
    return entry?.tr || entry?.en || humanizeCode(code);
  }

  function formatCategoryLabel(workout) {
    return categoryLabel(workout?.category);
  }

  function populateCategorySelects($, selectedCategory) {
    const el = $("workoutCategory");
    if (!el) return;

    const entries = Object.entries(categoryMetadata.categories);
    el.innerHTML =
      `<option value="">Seçin...</option>` +
      (entries.length
        ? entries
            .map(([code, names]) => {
              const label = names.tr || names.en || humanizeCode(code);
              const selected = code === selectedCategory ? " selected" : "";
              return `<option value="${escapeHtml(code)}"${selected}>${escapeHtml(label)}</option>`;
            })
            .join("")
        : "");

    if (selectedCategory && !categoryMetadata.categories[selectedCategory]) {
      el.innerHTML += `<option value="${escapeHtml(selectedCategory)}" selected>${escapeHtml(humanizeCode(selectedCategory))}</option>`;
    }
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
    if (ex.videoUrl) blocks.push(mediaPreviewHtml(ex.videoUrl, "Egzersiz videosu"));
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
    const title = $("workoutTitle")?.value?.trim();
    const lt = readLocalizedTitles($);
    const hasTitle = Boolean(title || lt?.tr || lt?.en);

    if (!category) return "Bölge / kategori zorunludur.";
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
      durationMinutes: $("workoutDuration").value ? Number($("workoutDuration").value) : null,
      category: $("workoutCategory").value.trim() || null,
      coverImageUrl: $("workoutCoverUrl").value.trim() || null
    };

    const extras = { ...existingExtras };
    const videoUrl = $("workoutVideoUrl").value.trim();
    if (videoUrl) extras.videoUrl = videoUrl;
    else delete extras.videoUrl;

    const slug = $("workoutSlug")?.value?.trim();
    if (slug) extras.slug = slug;
    else delete extras.slug;

    if (localizedTitles) extras.localizedTitles = localizedTitles;
    else delete extras.localizedTitles;

    const localizedBenefits = readLocalizedBenefits($);
    if (localizedBenefits) extras.localizedBenefits = localizedBenefits;
    else delete extras.localizedBenefits;

    const localizedExplain = readLocalizedMap($, "workoutExplain");
    if (localizedExplain) extras.localizedExplain = localizedExplain;
    else delete extras.localizedExplain;

    if (Object.keys(extras).length) payload.extras = extras;
    return payload;
  }

  function fillWorkoutForm($, workout) {
    const ex = workout?.extras || {};
    const lt = ex.localizedTitles || {};
    const lb = ex.localizedBenefits || {};
    const le = ex.localizedExplain || {};

    $("workoutTitle").value = workout?.title || lt.tr || lt.en || "";
    $("workoutDescription").value = workout?.description || le.tr || le.en || "";
    $("workoutStatus").value = workout?.status || "published";
    $("workoutDuration").value = workout?.durationMinutes ?? "";
    $("workoutCoverUrl").value = workout?.coverImageUrl || "";
    $("workoutVideoUrl").value = ex.videoUrl || "";
    if ($("workoutSlug")) $("workoutSlug").value = ex.slug || "";

    populateCategorySelects($, workout?.category || "");

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

  function formatDateTimeTr(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function renderFavoriteWorkoutCard(workout) {
    if (!workout) return "";
    const ex = workout.extras || {};
    const title = escapeHtml(workout.title || workout.id);
    const category = escapeHtml(formatCategoryLabel(workout));
    const duration =
      workout.durationMinutes != null ? `${workout.durationMinutes} dk` : "—";
    const status = workout.status === "archived" ? " · Arşiv" : "";
    const favoritedAt = ex.favoritedAt
      ? ` · Favorilendi: ${escapeHtml(formatDateTimeTr(ex.favoritedAt))}`
      : "";
    const meta = `${category} · ${duration}${status}${favoritedAt}`;

    return `<article class="favorite-workout-card">
      <div class="favorite-workout-card__head">
        <h4>${title}</h4>
        <p class="user-cell-sub">${meta}</p>
      </div>
      ${renderWorkoutMediaPanel(workout)}
    </article>`;
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
    ["workoutCoverUrl", "workoutVideoUrl"].forEach((id) => {
      $(id)?.addEventListener("input", () => updateWorkoutMediaPreview($));
    });
  }

  return {
    escapeHtml,
    renderWorkoutMediaPanel,
    renderFavoriteWorkoutCard,
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
    populateCategorySelects
  };
})();
