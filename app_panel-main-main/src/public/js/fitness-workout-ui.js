/**
 * Slim30 / Sixpack30 — antrenman medya ve form (multipart)
 */
window.FitnessWorkoutUi = (function () {
  const CATEGORY_LABELS = {
    cardio: "Kardiyo",
    strength: "Güç",
    hiit: "HIIT",
    flexibility: "Esneklik",
    full_body: "Tüm vücut",
    workout: "Antrenman",
    rest: "Dinlenme"
  };

  let exercisesEditorBound = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function categoryLabelTr(value) {
    if (!value) return "—";
    return CATEGORY_LABELS[value] || value;
  }

  function difficultyLabelTr(value) {
    const map = { beginner: "Başlangıç", intermediate: "Orta", advanced: "İleri" };
    return map[value] || value || "—";
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

  function collectExerciseMedia(exercises) {
    if (!Array.isArray(exercises)) return [];
    return exercises.flatMap((ex, i) => {
      const items = [];
      const name = ex?.name || ex?.title || `Egzersiz ${i + 1}`;
      if (ex?.videoUrl || ex?.video_url) items.push({ label: `${name} — video`, url: ex.videoUrl || ex.video_url });
      if (ex?.imageUrl || ex?.image_url || ex?.thumbnailUrl) {
        items.push({ label: `${name} — görsel`, url: ex.imageUrl || ex.image_url || ex.thumbnailUrl });
      }
      return items;
    });
  }

  function renderWorkoutMediaPanel(workout) {
    if (!workout) return "<p class=\"user-cell-sub\">—</p>";
    const ex = workout.extras || {};
    const blocks = [];
    if (workout.coverImageUrl) blocks.push(mediaPreviewHtml(workout.coverImageUrl, "Kapak görseli"));
    const videoUrl = ex.videoUrl || ex.introVideoUrl || ex.video_url;
    if (videoUrl) blocks.push(mediaPreviewHtml(videoUrl, "Antrenman videosu"));
    collectExerciseMedia(ex.exercises).forEach((item) => blocks.push(mediaPreviewHtml(item.url, item.label)));
    return blocks.length ? `<div class="workout-media-grid">${blocks.join("")}</div>` : "<p class=\"user-cell-sub\">Henüz medya yok</p>";
  }

  function normalizeExercise(ex) {
    return {
      name: ex?.name || ex?.title || "",
      imageUrl: ex?.imageUrl || ex?.image_url || ex?.thumbnailUrl || "",
      videoUrl: ex?.videoUrl || ex?.video_url || ""
    };
  }

  function exerciseRowHtml(exercise, index) {
    const ex = normalizeExercise(exercise);
    return `<div class="fw-exercise-row" data-exercise-index="${index}">
      <input class="input fw-exercise-name" type="text" value="${escapeHtml(ex.name)}" placeholder="Egzersiz adı" aria-label="Ad" />
      <input class="input fw-exercise-image" type="url" value="${escapeHtml(ex.imageUrl)}" placeholder="Görsel URL" aria-label="Görsel" />
      <input class="input fw-exercise-video" type="url" value="${escapeHtml(ex.videoUrl)}" placeholder="Video URL" aria-label="Video" />
      <button type="button" class="btn btn-sm btn-ghost fw-exercise-remove" title="Sil">Sil</button>
    </div>`;
  }

  function renderExercisesEditor($, exercises) {
    const list = $("workoutExercisesList");
    if (!list) return;
    const items = Array.isArray(exercises) && exercises.length ? exercises : [{ name: "", imageUrl: "", videoUrl: "" }];
    list.innerHTML = items.map((ex, i) => exerciseRowHtml(ex, i)).join("");
  }

  function readExercisesFromEditor($) {
    const list = $("workoutExercisesList");
    if (!list) return undefined;
    const rows = list.querySelectorAll(".fw-exercise-row");
    const exercises = [];
    rows.forEach((row) => {
      const name = row.querySelector(".fw-exercise-name")?.value?.trim();
      const imageUrl = row.querySelector(".fw-exercise-image")?.value?.trim();
      const videoUrl = row.querySelector(".fw-exercise-video")?.value?.trim();
      if (name || imageUrl || videoUrl) {
        const item = { name: name || "Egzersiz" };
        if (imageUrl) item.imageUrl = imageUrl;
        if (videoUrl) item.videoUrl = videoUrl;
        exercises.push(item);
      }
    });
    return exercises.length ? exercises : undefined;
  }

  function bindExercisesEditor($, onChange) {
    if (exercisesEditorBound) return;
    exercisesEditorBound = true;

    $("workoutAddExerciseBtn")?.addEventListener("click", () => {
      const list = $("workoutExercisesList");
      if (!list) return;
      const index = list.querySelectorAll(".fw-exercise-row").length;
      list.insertAdjacentHTML("beforeend", exerciseRowHtml({ name: "", imageUrl: "", videoUrl: "" }, index));
      onChange?.();
    });

    $("workoutExercisesList")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".fw-exercise-remove");
      if (!btn) return;
      const row = btn.closest(".fw-exercise-row");
      const list = $("workoutExercisesList");
      const rows = list?.querySelectorAll(".fw-exercise-row") || [];
      if (rows.length <= 1) {
        row.querySelector(".fw-exercise-name").value = "";
        row.querySelector(".fw-exercise-image").value = "";
        row.querySelector(".fw-exercise-video").value = "";
        onChange?.();
        return;
      }
      row.remove();
      onChange?.();
    });

    $("workoutExercisesList")?.addEventListener("input", () => onChange?.());
  }

  function buildExtras($, options = {}) {
    const { includeSixpackFields = false, existingExtras = {} } = options;
    const extras = { ...existingExtras };
    delete extras.videoUrl;
    delete extras.introVideoUrl;
    delete extras.video_url;

    const exercises = readExercisesFromEditor($);
    if (exercises) extras.exercises = exercises;
    else delete extras.exercises;

    const locale = $("workoutLocale")?.value?.trim();
    if (locale) extras.locale = locale;
    else delete extras.locale;

    if (includeSixpackFields) {
      const titleEn = $("workoutTitleEn")?.value?.trim();
      if (titleEn) extras.title_en = titleEn;
      else delete extras.title_en;
      delete extras.isPremium;
    }

    return extras;
  }

  function buildWorkoutFormData($, options = {}) {
    const { includeSixpackFields = false, existingExtras = {} } = options;
    const fd = new FormData();

    fd.append("title", $("workoutTitle").value.trim());
    const description = $("workoutDescription").value.trim();
    if (description) fd.append("description", description);
    fd.append("status", $("workoutStatus").value);

    const difficulty = $("workoutDifficulty").value;
    if (difficulty) fd.append("difficulty", difficulty);

    const duration = $("workoutDuration").value;
    if (duration) fd.append("durationMinutes", duration);

    const category = $("workoutCategory").value.trim();
    if (category) fd.append("category", category);

    if (includeSixpackFields) {
      fd.append("isPremium", $("workoutIsPremium")?.checked ? "true" : "false");
    }

    const extras = buildExtras($, { includeSixpackFields, existingExtras });
    if (Object.keys(extras).length) {
      fd.append("extras", JSON.stringify(extras));
    }

    const coverFile = $("workoutCoverFile")?.files?.[0];
    if (coverFile) fd.append("coverImage", coverFile);

    const videoFile = $("workoutVideoFile")?.files?.[0];
    if (videoFile) fd.append("video", videoFile);

    return fd;
  }

  function clearWorkoutFiles($) {
    const cover = $("workoutCoverFile");
    const video = $("workoutVideoFile");
    if (cover) cover.value = "";
    if (video) video.value = "";
    revokeFilePreviews($);
  }

  const filePreviewUrls = new WeakMap();

  function revokeFilePreviews($) {
    const prev = filePreviewUrls.get($);
    if (prev) {
      prev.forEach((u) => URL.revokeObjectURL(u));
      filePreviewUrls.delete($);
    }
  }

  function fillWorkoutForm($, workout, options = {}) {
    const { includeSixpackFields = false } = options;
    const ex = workout?.extras || {};
    $("workoutTitle").value = workout?.title || "";
    $("workoutDescription").value = workout?.description || "";
    $("workoutStatus").value = workout?.status || "draft";
    $("workoutDifficulty").value = workout?.difficulty || "";
    $("workoutDuration").value = workout?.durationMinutes ?? "";
    if ($("workoutCategory")) {
      const cat = workout?.category || "";
      $("workoutCategory").value = CATEGORY_LABELS[cat] ? cat : cat;
    }
    renderExercisesEditor($, ex.exercises);
    if ($("workoutLocale")) $("workoutLocale").value = ex.locale || "";
    if (includeSixpackFields) {
      if ($("workoutTitleEn")) $("workoutTitleEn").value = ex.title_en || "";
      if ($("workoutIsPremium")) $("workoutIsPremium").checked = Boolean(ex.isPremium);
    }
    clearWorkoutFiles($);
    updateWorkoutMediaPreview($, workout);
  }

  function updateWorkoutMediaPreview($, workout) {
    const el = $("workoutMediaPreview");
    if (!el) return;

    revokeFilePreviews($);
    const urls = [];

    const coverFile = $("workoutCoverFile")?.files?.[0];
    const videoFile = $("workoutVideoFile")?.files?.[0];

    const draft = {
      coverImageUrl: workout?.coverImageUrl || null,
      extras: { ...(workout?.extras || {}) }
    };

    if (coverFile) {
      const u = URL.createObjectURL(coverFile);
      urls.push(u);
      draft.coverImageUrl = u;
    }
    if (videoFile) {
      const u = URL.createObjectURL(videoFile);
      urls.push(u);
      draft.extras.videoUrl = u;
    }

    if (urls.length) filePreviewUrls.set($, urls);

    const exercises = readExercisesFromEditor($);
    if (exercises) draft.extras.exercises = exercises;

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

  function bindWorkoutFormLivePreview($, getWorkout) {
    bindExercisesEditor($, () => updateWorkoutMediaPreview($, getWorkout?.()));
    $("workoutLocale")?.addEventListener("input", () => updateWorkoutMediaPreview($, getWorkout?.()));
    $("workoutCoverFile")?.addEventListener("change", () => updateWorkoutMediaPreview($, getWorkout?.()));
    $("workoutVideoFile")?.addEventListener("change", () => updateWorkoutMediaPreview($, getWorkout?.()));
  }

  function formatExercisesSummary(exercises) {
    if (!Array.isArray(exercises) || !exercises.length) return "—";
    return exercises.map((ex) => ex.name || ex.title || "Egzersiz").join(" · ");
  }

  return {
    escapeHtml,
    categoryLabelTr,
    difficultyLabelTr,
    renderWorkoutMediaPanel,
    buildWorkoutFormData,
    fillWorkoutForm,
    clearWorkoutFiles,
    updateWorkoutMediaPreview,
    workoutListThumb,
    bindWorkoutFormLivePreview,
    renderExercisesEditor,
    formatExercisesSummary
  };
})();
