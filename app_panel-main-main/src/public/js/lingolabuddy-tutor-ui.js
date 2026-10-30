/**
 * Lingola Buddy — Tutor form/render helpers
 */
window.LingolaBuddyTutorUi = (function () {
  const SUPPORTED_LOCALES = ["tr", "en", "de", "fr", "es", "it", "pt", "ru", "ja", "ko", "hi", "zh"];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isImageUrl(url) {
    if (!url) return false;
    return /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url) || /image|cdn|b-cdn/i.test(url);
  }

  function renderTutorMediaPanel(tutor) {
    const photoUrl = tutor?.coverImageUrl || tutor?.extras?.photoUrl || "";
    const rivUrl = tutor?.extras?.rivUrl || "";
    const parts = [];

    if (photoUrl) {
      parts.push(
        isImageUrl(photoUrl)
          ? `<div class="workout-media-block">
              <span class="user-cell-sub">Fotoğraf</span>
              <img class="workout-media-preview" src="${escapeHtml(photoUrl)}" alt="" loading="lazy" />
              <a class="field-hint" href="${escapeHtml(photoUrl)}" target="_blank" rel="noopener">Görseli aç</a>
            </div>`
          : `<div class="workout-media-block">
              <span class="user-cell-sub">Fotoğraf</span>
              <a href="${escapeHtml(photoUrl)}" target="_blank" rel="noopener">${escapeHtml(photoUrl)}</a>
            </div>`
      );
    }

    if (rivUrl) {
      parts.push(`<div class="workout-media-block">
          <span class="user-cell-sub">Rive (.riv)</span>
          <a href="${escapeHtml(rivUrl)}" target="_blank" rel="noopener">${escapeHtml(rivUrl)}</a>
        </div>`);
    }

    if (!parts.length) return '<p class="user-cell-sub">Medya yok.</p>';
    return `<div class="workout-media-grid">${parts.join("")}</div>`;
  }

  function firstNonEmpty(values) {
    for (const item of values) {
      const s = String(item || "").trim();
      if (s) return s;
    }
    return "";
  }

  function readLocalizedMap($, prefix) {
    const map = {};
    for (const locale of SUPPORTED_LOCALES) {
      const id = `${prefix}${locale.toUpperCase()}`;
      const value = $(id)?.value?.trim();
      if (value) map[locale] = value;
    }
    return Object.keys(map).length ? map : undefined;
  }

  function fillLocalizedMap($, prefix, values) {
    for (const locale of SUPPORTED_LOCALES) {
      const id = `${prefix}${locale.toUpperCase()}`;
      if ($(id)) $(id).value = values?.[locale] || "";
    }
  }

  function fillTutorForm($, tutor) {
    const ex = tutor?.extras || {};
    const localizedTitles = ex.localizedTitles || ex.translations || {};
    const localizedDescriptions = ex.localizedDescriptions || {};
    const localizedTaglines = ex.localizedTaglines || {};

    $("tutorTitle").value =
      tutor?.title || firstNonEmpty([localizedTitles.tr, localizedTitles.en, localizedTitles.de]) || "";
    $("tutorDescription").value =
      tutor?.description || firstNonEmpty([localizedDescriptions.tr, localizedDescriptions.en]) || "";
    $("tutorStatus").value = tutor?.status || "published";
    $("tutorCategory").value = tutor?.category || ex.gender || "female";
    $("tutorVoiceId").value = ex.voiceId || "";
    $("tutorNativeLang").value = ex.nativeLang || "";
    $("tutorSortOrder").value = ex.sortOrder ?? "";
    $("tutorTagline").value = ex.tagline || firstNonEmpty([localizedTaglines.tr, localizedTaglines.en]) || "";
    $("tutorPhotoUrl").value = tutor?.coverImageUrl || ex.photoUrl || "";
    $("tutorRivUrl").value = ex.rivUrl || "";
    if ($("tutorPhotoFile")) $("tutorPhotoFile").value = "";
    if ($("tutorRivFile")) $("tutorRivFile").value = "";

    fillLocalizedMap($, "tutorTitle", localizedTitles);
    fillLocalizedMap($, "tutorDesc", localizedDescriptions);
    fillLocalizedMap($, "tutorTagline", localizedTaglines);
    updateTutorMediaPreview($);
  }

  function readTutorForm($, options = {}) {
    const existingExtras = options.existingExtras || {};
    const localizedTitles = readLocalizedMap($, "tutorTitle");
    const localizedDescriptions = readLocalizedMap($, "tutorDesc");
    const localizedTaglines = readLocalizedMap($, "tutorTagline");

    const payload = {
      title: $("tutorTitle").value.trim() || firstNonEmpty([localizedTitles?.tr, localizedTitles?.en]) || "",
      description: $("tutorDescription").value.trim() || null,
      status: $("tutorStatus").value,
      category: $("tutorCategory").value,
      coverImageUrl: $("tutorPhotoUrl").value.trim() || null
    };

    const extras = { ...existingExtras };
    const voiceId = $("tutorVoiceId").value.trim();
    const nativeLang = $("tutorNativeLang").value.trim();
    const tagline = $("tutorTagline").value.trim();
    const rivUrl = $("tutorRivUrl").value.trim();
    const sortOrderRaw = $("tutorSortOrder").value.trim();
    const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : null;

    if (voiceId) extras.voiceId = voiceId;
    else delete extras.voiceId;
    if (nativeLang) extras.nativeLang = nativeLang;
    else delete extras.nativeLang;
    if (tagline) extras.tagline = tagline;
    else delete extras.tagline;
    if (rivUrl) extras.rivUrl = rivUrl;
    else delete extras.rivUrl;
    if (Number.isFinite(sortOrder)) extras.sortOrder = sortOrder;
    else delete extras.sortOrder;
    if (localizedTitles) extras.localizedTitles = localizedTitles;
    else delete extras.localizedTitles;
    if (localizedDescriptions) extras.localizedDescriptions = localizedDescriptions;
    else delete extras.localizedDescriptions;
    if (localizedTaglines) extras.localizedTaglines = localizedTaglines;
    else delete extras.localizedTaglines;

    if (Object.keys(extras).length) payload.extras = extras;
    return payload;
  }

  function validateTutorForm($) {
    const category = $("tutorCategory")?.value?.trim();
    const title = $("tutorTitle")?.value?.trim();
    const localizedTitles = readLocalizedMap($, "tutorTitle");
    const hasTitle = Boolean(title || localizedTitles?.tr || localizedTitles?.en);
    if (!hasTitle) return "Tutor adı zorunludur (en az TR veya EN).";
    if (!category) return "Tutor kategorisi/cinsiyeti zorunludur.";
    return null;
  }

  function updateTutorMediaPreview($) {
    const panel = $("tutorMediaPreview");
    if (!panel) return;
    panel.innerHTML = renderTutorMediaPanel({
      coverImageUrl: $("tutorPhotoUrl")?.value?.trim() || null,
      extras: { rivUrl: $("tutorRivUrl")?.value?.trim() || null }
    });
  }

  function bindTutorFormLivePreview($) {
    ["tutorPhotoUrl", "tutorRivUrl"].forEach((id) => {
      $(id)?.addEventListener("input", () => updateTutorMediaPreview($));
    });
  }

  async function uploadTutorAsset(appId, tutorId, kind, file) {
    const field = kind === "photo" ? "photo" : "riv";
    const fd = new FormData();
    fd.append(field, file);
    const response = await fetch(
      `/api/apps/${appId}/proxy/tutors/${encodeURIComponent(String(tutorId))}/${kind}`,
      { method: "POST", body: fd }
    );
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      const msg = data?.bodyJson?.message || data?.bodyJson?.msg || data?.error || "Yükleme başarısız.";
      throw new Error(msg);
    }
    return data?.bodyJson?.data || null;
  }

  function tutorListThumb(tutor) {
    const url = tutor?.coverImageUrl || tutor?.extras?.photoUrl;
    if (!url) return '<span class="workout-thumb workout-thumb--empty">LB</span>';
    return `<img class="workout-thumb" src="${escapeHtml(url)}" alt="" loading="lazy" />`;
  }

  function renderVoicePlayer(voiceMeta, options = {}) {
    const voiceId = voiceMeta?.voiceId || voiceMeta?.id || "";
    const previewUrl = voiceMeta?.previewUrl || "";
    const name = voiceMeta?.name || voiceId || "—";
    if (!voiceId) return '<span class="user-cell-sub">—</span>';

    const compact = options.compact ? " tutor-voice-audio--compact" : "";
    if (previewUrl) {
      return `<div class="tutor-voice-cell">
        <div class="user-cell-sub" style="margin-bottom:4px">${escapeHtml(name)}</div>
        <audio class="tutor-voice-audio${compact}" controls preload="none" src="${escapeHtml(previewUrl)}"></audio>
      </div>`;
    }

    return `<div class="tutor-voice-cell">
      <div class="user-cell-sub">${escapeHtml(name)}</div>
      <div class="user-cell-sub">${escapeHtml(voiceId)}</div>
    </div>`;
  }

  function renderLocalizedReadonlyGrid(title, map) {
    const entries = Object.entries(map || {}).filter(([, value]) => String(value || "").trim());
    if (!entries.length) return "";
    return `<div class="user-detail-section" style="margin-top:16px">
      <h4 class="user-detail-section__title">${escapeHtml(title)}</h4>
      <div class="form-grid-2">
        ${entries
          .map(
            ([locale, value]) => `<div class="field">
              <label>${escapeHtml(locale.toUpperCase())}</label>
              <div class="input" style="height:auto;min-height:38px;white-space:pre-wrap">${escapeHtml(value)}</div>
            </div>`
          )
          .join("")}
      </div>
    </div>`;
  }

  function renderTutorDetailMediaSection(tutor, options = {}) {
    const canManage = Boolean(options.canManage);
    return `<div class="user-detail-section">
      <h4 class="user-detail-section__title">Medya</h4>
      <div id="tutorDetailMediaPreview">${renderTutorMediaPanel(tutor)}</div>
      ${
        canManage
          ? `<div class="media-upload-section" style="margin-top: 14px">
        <p class="field-hint media-upload-lead">
          Yeni fotoğraf veya Rive dosyası yükleyin; CDN'e kaydedilir ve eğitmen kaydı güncellenir.
        </p>
        <div class="form-grid-2">
          <div class="field">
            <label for="tutorDetailPhotoFile">Fotoğraf yükle</label>
            <input class="input file-input" id="tutorDetailPhotoFile" type="file" accept="image/jpeg,image/png,image/webp" />
            <button type="button" class="btn btn-sm btn-primary" id="tutorDetailUploadPhotoBtn" style="margin-top: 8px">
              Fotoğrafı yükle
            </button>
          </div>
          <div class="field">
            <label for="tutorDetailRivFile">Rive dosyası (.riv)</label>
            <input class="input file-input" id="tutorDetailRivFile" type="file" accept=".riv" />
            <button type="button" class="btn btn-sm btn-primary" id="tutorDetailUploadRivBtn" style="margin-top: 8px">
              RIV yükle
            </button>
          </div>
        </div>
        <p class="field-hint" id="tutorDetailUploadStatus">—</p>
      </div>`
          : ""
      }
    </div>`;
  }

  function renderTutorDetailVoiceSection(tutor, voiceMeta, labels = {}) {
    const ex = tutor?.extras || {};
    if (labels.canManage) {
      return `<div class="user-detail-section">
        <h4 class="user-detail-section__title">Ses seçimi</h4>
        <div class="field">
          <label for="tutorDetailVoiceId">Ses</label>
          <select class="select" id="tutorDetailVoiceId">
            <option value="">Yükleniyor...</option>
          </select>
          <p class="field-hint" id="tutorDetailVoiceHint">Kategoriye uygun sesler listelenir.</p>
          <audio id="tutorDetailVoicePreview" class="tutor-voice-audio" controls preload="none" hidden style="margin-top:8px;width:100%"></audio>
          <button type="button" class="btn btn-sm btn-primary" id="tutorDetailSaveVoiceBtn" style="margin-top:10px">Sesi kaydet</button>
          <p class="field-hint" id="tutorDetailVoiceStatus">—</p>
        </div>
      </div>`;
    }

    return `<div class="user-detail-section">
      <h4 class="user-detail-section__title">Ses önizleme</h4>
      ${renderVoicePlayer(
        { voiceId: ex.voiceId, name: voiceMeta?.name, previewUrl: voiceMeta?.previewUrl },
        { compact: false }
      )}
    </div>`;
  }

  function renderTutorDetailPage(tutor, voiceMeta, labels = {}) {
    const ex = tutor?.extras || {};
    const titles = ex.localizedTitles || {};
    const descriptions = ex.localizedDescriptions || {};
    const taglines = ex.localizedTaglines || {};

    return `
      <table class="data-table" style="margin-bottom:8px">
        <tbody>
          <tr><td class="user-cell-sub" style="width:150px">Tutor ID</td><td>${escapeHtml(tutor.id || "—")}</td></tr>
          <tr><td class="user-cell-sub">İsim</td><td>${escapeHtml(tutor.title || "—")}</td></tr>
          <tr><td class="user-cell-sub">Durum</td><td>${escapeHtml(labels.status || tutor.status || "—")}</td></tr>
          <tr><td class="user-cell-sub">Kategori</td><td>${escapeHtml(labels.category || tutor.category || "—")}</td></tr>
          <tr><td class="user-cell-sub">Ana dil</td><td>${escapeHtml(ex.nativeLang || "—")}</td></tr>
          <tr><td class="user-cell-sub">Sıralama</td><td>${escapeHtml(String(ex.sortOrder ?? "—"))}</td></tr>
          <tr><td class="user-cell-sub">Tagline</td><td>${escapeHtml(ex.tagline || "—")}</td></tr>
        </tbody>
      </table>
      ${renderTutorDetailVoiceSection(tutor, voiceMeta, labels)}
      <div class="user-detail-section">
        <h4 class="user-detail-section__title">Açıklama</h4>
        <p>${escapeHtml(tutor.description || "—")}</p>
      </div>
      ${renderLocalizedReadonlyGrid("Çok dilli adlar", titles)}
      ${renderLocalizedReadonlyGrid("Çok dilli açıklamalar", descriptions)}
      ${renderLocalizedReadonlyGrid("Çok dilli tagline", taglines)}
      ${renderTutorDetailMediaSection(tutor, { canManage: labels.canManage })}`;
  }

  function updateTutorDetailMediaPreview($, tutor) {
    const panel = $("tutorDetailMediaPreview");
    if (panel) panel.innerHTML = renderTutorMediaPanel(tutor);
  }

  return {
    SUPPORTED_LOCALES,
    renderTutorMediaPanel,
    renderVoicePlayer,
    renderTutorDetailPage,
    renderTutorDetailVoiceSection,
    renderTutorDetailMediaSection,
    updateTutorDetailMediaPreview,
    fillTutorForm,
    readTutorForm,
    validateTutorForm,
    bindTutorFormLivePreview,
    updateTutorMediaPreview,
    uploadTutorAsset,
    tutorListThumb
  };
})();
