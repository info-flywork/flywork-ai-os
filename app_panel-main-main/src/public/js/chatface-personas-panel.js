(function () {
  const appId = Number(window.location.pathname.split("/")[2]);
  if (!Number.isInteger(appId) || appId < 1) return;

  let personasPage = 1;
  const personasLimit = 20;
  let personasPagination = null;
  let personasSearch = "";
  let personaGenderFilter = "";
  let personaActiveFilter = "";
  let personaOptions = null;
  let personaEditMode = "create";
  const personasCache = new Map();
  let canManage = false;

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

  function genderLabel(g) {
    if (g === "female") return "Kadın";
    if (g === "male") return "Erkek";
    return "—";
  }

  function firstAvatarFilename(persona) {
    const raw = String(persona?.avatarKey || "").trim();
    if (!raw) return null;
    return raw.split(",")[0].trim() || null;
  }

  /** Bunny hotlink koruması: görseller panel üzerinden proxy ile sunulur. */
  function personaImageProxyUrl(personaOrFilename) {
    const file =
      typeof personaOrFilename === "string"
        ? personaOrFilename
        : firstAvatarFilename(personaOrFilename);
    if (!file) return null;
    return `/api/apps/${appId}/proxy/cdn/personas/images/${encodeURIComponent(file)}`;
  }

  function personaPreviewUrls(persona) {
    const raw = String(persona?.avatarKey || "").trim();
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((file) => personaImageProxyUrl(file));
  }

  function personasFromBody(bodyJson) {
    return bodyJson?.personas ?? bodyJson?.data ?? [];
  }

  function personaFromBody(bodyJson) {
    return bodyJson?.persona ?? bodyJson?.data ?? null;
  }

  function apiErrorMessage(data, fallback) {
    const body = data?.bodyJson;
    const detail = body?.message || body?.msg || data?.error;
    if (detail && data?.statusCode) return `${detail} (HTTP ${data.statusCode})`;
    if (detail) return detail;
    return fallback;
  }

  function showToast(message) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2800);
  }

  function openEditorPanel() {
    $("personasListArea").hidden = true;
    $("personaEditorPanel").hidden = false;
    $("personaEditorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditorPanel() {
    $("personaEditorPanel").hidden = true;
    $("personasListArea").hidden = false;
  }

  function fillLanguageSelect() {
    const select = $("personaDefaultLang");
    if (!select || !personaOptions?.languages) return;
    select.innerHTML = personaOptions.languages
      .map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.label)} (${l.code})</option>`)
      .join("");
  }

  function fillVoiceSuggestions() {
    const list = $("personaVoiceSuggestions");
    if (!list || !personaOptions?.sampleVoices) return;
    list.innerHTML = personaOptions.sampleVoices
      .map((v) => `<option value="${escapeHtml(v.elevenlabsVoiceId)}">${escapeHtml(v.languageCode)} · ${escapeHtml(v.timbre || "")}</option>`)
      .join("");
  }

  async function ensureOptions() {
    if (personaOptions) return personaOptions;
    const res = await fetch(`/api/apps/${appId}/proxy/personas/options`);
    const data = await res.json();
    if (!data.ok) return null;
    personaOptions = data.bodyJson;
    fillLanguageSelect();
    fillVoiceSuggestions();
    const hint = $("personaMediaHint");
    if (hint) hint.textContent = personaOptions.mediaHint || "";
    return personaOptions;
  }

  function resetEditorForm() {
    $("personaEditId").value = "";
    $("personaName").value = "";
    $("personaAge").value = "";
    $("personaGender").value = "female";
    $("personaSortOrder").value = "999";
    $("personaJobTitle").value = "";
    $("personaShortDescription").value = "";
    $("personaDescription").value = "";
    $("personaPrompt").value = "";
    $("personaDefaultLang").value = "en";
    $("personaActive").value = "true";
    $("personaVoiceId").value = "";
    $("personaVoiceTimbre").value = "seductive";
    $("personaVoiceStability").value = "0.63";
    $("personaVoiceStyle").value = "0.45";
    $("personaAvatar1").value = "";
    $("personaAvatar2").value = "";
    $("personaAvatar3").value = "";
    $("personaRiveFile").value = "";
    $("personaEditorMessage").hidden = true;
    const preview = $("personaMediaPreview");
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
  }

  function personaInitials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    return parts
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  function personaThumbHtml(persona) {
    const url = personaImageProxyUrl(persona) || persona?.avatarPreviewUrl;
    const initials = personaInitials(persona?.name);
    if (!url) {
      return `<span class="persona-thumb-fallback" aria-hidden="true">${escapeHtml(initials)}</span>`;
    }
    return `<span class="persona-thumb-wrap">
      <img class="persona-thumb-img" src="${escapeHtml(url)}" alt="" width="40" height="40" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false" />
      <span class="persona-thumb-fallback" hidden aria-hidden="true">${escapeHtml(initials)}</span>
    </span>`;
  }

  function showMediaPreview(persona) {
    const preview = $("personaMediaPreview");
    if (!preview) return;
    const urls = personaPreviewUrls(persona);
    const bust = persona?.id ? `?v=${encodeURIComponent(persona.id)}` : "";
    if (!urls.length && !persona?.riveAsset) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    preview.hidden = false;
    const imgs = urls
      .map(
        (u, i) =>
          `<img src="${escapeHtml(u)}${bust}" alt="Fotoğraf ${i + 1}" referrerpolicy="no-referrer" />`
      )
      .join("");
    preview.innerHTML = `
      <div class="persona-media-preview-images">${imgs || '<p class="user-cell-sub">Henüz fotoğraf yok — aşağıdan yükleyin.</p>'}</div>
      <p class="user-cell-sub">Rive: ${escapeHtml(persona.riveAsset || "—")}</p>`;
  }

  function hasAllMediaFiles() {
    return Boolean(
      $("personaAvatar1")?.files?.[0] &&
        $("personaAvatar2")?.files?.[0] &&
        $("personaAvatar3")?.files?.[0] &&
        $("personaRiveFile")?.files?.[0]
    );
  }

  function hasAnyMediaFile() {
    return Boolean(
      $("personaAvatar1")?.files?.[0] ||
        $("personaAvatar2")?.files?.[0] ||
        $("personaAvatar3")?.files?.[0] ||
        $("personaRiveFile")?.files?.[0]
    );
  }

  function validateMediaBeforeSubmit(isCreate) {
    if (isCreate) {
      if (!hasAllMediaFiles()) {
        return "Yeni karakter için 3 fotoğraf ve 1 Rive (.riv) dosyası seçmelisiniz.";
      }
      return null;
    }
    if (hasAnyMediaFile() && !hasAllMediaFiles()) {
      return "Medya güncellemek için 3 fotoğraf ve 1 Rive dosyasının tamamını seçin.";
    }
    return null;
  }

  function openCreatePersona() {
    if (!canManage) return;
    personaEditMode = "create";
    resetEditorForm();
    $("personaEditorTitle").textContent = "Yeni karakter";
    $("deactivatePersonaBtn").hidden = true;
    openEditorPanel();
    ensureOptions();
  }

  async function openEditPersona(personaId) {
    await ensureOptions();
    let persona = personasCache.get(String(personaId));
    if (!persona) {
      const res = await fetch(`/api/apps/${appId}/proxy/personas/${encodeURIComponent(personaId)}`);
      const data = await res.json();
      if (!data.ok) {
        showToast(apiErrorMessage(data, "Karakter yüklenemedi"));
        return;
      }
      persona = personaFromBody(data.bodyJson);
    }
    if (!persona) return;

    personaEditMode = "edit";
    $("personaEditorTitle").textContent = `Düzenle: ${persona.name}`;
    $("deactivatePersonaBtn").hidden = !canManage;
    $("personaEditId").value = persona.id;
    $("personaName").value = persona.name || "";
    $("personaAge").value = persona.age ?? "";
    $("personaGender").value = persona.gender || "female";
    $("personaSortOrder").value = persona.sortOrder ?? 0;
    $("personaJobTitle").value = persona.jobTitle || "";
    $("personaShortDescription").value = persona.shortDescription || "";
    $("personaDescription").value = persona.description || "";
    $("personaPrompt").value = persona.promptTemplate || "";
    $("personaDefaultLang").value = persona.defaultLanguage || "en";
    $("personaActive").value = persona.active ? "true" : "false";
    const voice = Array.isArray(persona.voices) ? persona.voices[0] : null;
    if (voice) {
      $("personaVoiceId").value = voice.elevenlabsVoiceId || "";
      $("personaVoiceTimbre").value = voice.timbre || "";
      $("personaVoiceStability").value = voice.stability ?? "0.63";
      $("personaVoiceStyle").value = voice.style ?? "0.45";
    }
    showMediaPreview(persona);
    $("personaEditorMessage").hidden = true;
    openEditorPanel();
  }

  function appendFile(formData, inputId, fieldName) {
    const input = $(inputId);
    if (input?.files?.[0]) {
      formData.append(fieldName, input.files[0]);
    }
  }

  function buildPersonaFormData() {
    const formData = new FormData();
    const fields = {
      name: $("personaName").value.trim(),
      age: $("personaAge").value.trim(),
      gender: $("personaGender").value,
      sortOrder: $("personaSortOrder").value.trim(),
      jobTitle: $("personaJobTitle").value.trim(),
      shortDescription: $("personaShortDescription").value.trim(),
      description: $("personaDescription").value.trim(),
      promptTemplate: $("personaPrompt").value.trim(),
      defaultLanguage: $("personaDefaultLang").value,
      active: $("personaActive").value,
      elevenlabsVoiceId: $("personaVoiceId").value.trim(),
      voiceTimbre: $("personaVoiceTimbre").value.trim(),
      voiceStability: $("personaVoiceStability").value.trim(),
      voiceStyle: $("personaVoiceStyle").value.trim()
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== "") formData.append(key, value);
    }
    appendFile(formData, "personaAvatar1", "avatar1");
    appendFile(formData, "personaAvatar2", "avatar2");
    appendFile(formData, "personaAvatar3", "avatar3");
    appendFile(formData, "personaRiveFile", "riveFile");
    return formData;
  }

  async function loadPersonas() {
    $("personasError").hidden = true;
    $("personasBody").innerHTML = `<tr><td colspan="7" class="user-cell-sub">Yükleniyor...</td></tr>`;

    const params = new URLSearchParams({ page: personasPage, limit: personasLimit });
    if (personasSearch) params.set("search", personasSearch);
    if (personaGenderFilter) params.set("gender", personaGenderFilter);
    if (personaActiveFilter) params.set("active", personaActiveFilter);

    const res = await fetch(`/api/apps/${appId}/proxy/personas?${params}`);
    const data = await res.json();

    if (!data.ok) {
      $("personasBody").innerHTML = "";
      $("personasError").hidden = false;
      $("personasError").textContent = apiErrorMessage(data, "Karakter listesi alınamadı.");
      $("personasMeta").textContent = "Liste alınamadı";
      return;
    }

    const personas = personasFromBody(data.bodyJson);
    personasPagination = data.bodyJson?.pagination || null;
    personasCache.clear();
    personas.forEach((p) => personasCache.set(String(p.id), p));

    $("personasMeta").textContent = personasPagination
      ? `${formatNumber(personasPagination.total)} karakter · sayfa ${personasPagination.page}/${personasPagination.totalPages}`
      : `${personas.length} kayıt`;

    $("personasBody").innerHTML = personas.length
      ? personas
          .map((p) => {
            const usage = p.usage || {};
            const thumb = personaThumbHtml(p);
            return `<tr data-persona-id="${escapeHtml(p.id)}">
              <td>
                <div class="persona-list-cell">${thumb}
                  <div><div class="user-cell-title">${escapeHtml(p.name)}</div>
                  <div class="user-cell-sub">${escapeHtml(p.id)} · ${escapeHtml(p.jobTitle || "—")}</div></div>
                </div>
              </td>
              <td>${genderLabel(p.gender)}</td>
              <td><span class="status-pill ${p.active ? "ok" : ""}">${p.active ? "Aktif" : "Pasif"}</span></td>
              <td>${formatNumber(usage.sessionCount)}</td>
              <td>${formatNumber(usage.followerCount)}</td>
              <td>${formatNumber(p.sortOrder)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-ghost" data-edit-persona="${escapeHtml(p.id)}">Düzenle</button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7"><p class="user-cell-sub">Karakter bulunamadı</p></td></tr>`;

    $("personaPrevBtn").disabled = personasPage <= 1;
    $("personaNextBtn").disabled = personasPage >= (personasPagination?.totalPages || 1);
  }

  function bindEvents() {
    $("newPersonaBtn")?.addEventListener("click", openCreatePersona);
    $("closePersonaEditorBtn")?.addEventListener("click", closeEditorPanel);
    $("personaSearchBtn")?.addEventListener("click", () => {
      personasSearch = $("personaSearch").value.trim();
      personasPage = 1;
      loadPersonas();
    });
    $("personaPrevBtn")?.addEventListener("click", () => {
      if (personasPage > 1) {
        personasPage -= 1;
        loadPersonas();
      }
    });
    $("personaNextBtn")?.addEventListener("click", () => {
      if (personasPage < (personasPagination?.totalPages || 1)) {
        personasPage += 1;
        loadPersonas();
      }
    });
    $("personasBody")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-edit-persona]");
      const id = btn?.getAttribute("data-edit-persona") || e.target.closest("tr[data-persona-id]")?.getAttribute("data-persona-id");
      if (id) openEditPersona(id);
    });
    $("personaEditorForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!canManage) return;
      $("personaEditorMessage").hidden = true;
      const isCreate = personaEditMode === "create";
      const mediaError = validateMediaBeforeSubmit(isCreate);
      if (mediaError) {
        $("personaEditorMessage").hidden = false;
        $("personaEditorMessage").textContent = mediaError;
        return;
      }
      const formData = buildPersonaFormData();
      const personaId = $("personaEditId").value;
      const url = isCreate
        ? `/api/apps/${appId}/proxy/personas`
        : `/api/apps/${appId}/proxy/personas/${encodeURIComponent(personaId)}`;
      const submitBtn = e.submitter;
      submitBtn.disabled = true;
      try {
        const res = await fetch(url, {
          method: isCreate ? "POST" : "PATCH",
          body: formData
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          $("personaEditorMessage").hidden = false;
          $("personaEditorMessage").textContent = apiErrorMessage(data, "Kayıt başarısız.");
          return;
        }
        showToast(isCreate ? "Karakter oluşturuldu" : "Karakter güncellendi");
        closeEditorPanel();
        personasPage = 1;
        loadPersonas();
      } finally {
        submitBtn.disabled = false;
      }
    });
    $("deactivatePersonaBtn")?.addEventListener("click", async () => {
      if (!canManage) return;
      const personaId = $("personaEditId").value;
      if (!personaId || !confirm("Bu karakteri pasife almak istediğinize emin misiniz? Uygulamada görünmez.")) return;
      const res = await fetch(`/api/apps/${appId}/proxy/personas/${encodeURIComponent(personaId)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!data.ok) {
        showToast(apiErrorMessage(data, "Pasife alınamadı"));
        return;
      }
      showToast("Karakter pasife alındı");
      closeEditorPanel();
      loadPersonas();
    });
  }

  window.ChatfacePersonasPanel = {
    load: loadPersonas,
    setCanManage(value) {
      canManage = Boolean(value);
      document.querySelectorAll("#view-personas [data-manager-only]").forEach((el) => {
        el.hidden = !canManage;
        el.style.display = canManage ? "" : "none";
      });
    }
  };

  bindEvents();

  document.addEventListener("chatface-panel-ready", (e) => {
    window.ChatfacePersonasPanel.setCanManage(Boolean(e.detail?.canManage));
  });

  if (window.PanelAuth) {
    PanelAuth.fetchSession().then((user) => {
      if (user) window.ChatfacePersonasPanel.setCanManage(PanelAuth.isManager(user));
    });
  } else {
    window.ChatfacePersonasPanel.setCanManage(true);
  }
})();
