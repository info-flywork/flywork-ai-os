(function () {
  const METRIC_LABELS = {
    active_trials: "Aktif denemeler",
    active_subscriptions: "Aktif abonelikler",
    mrr: "MRR",
    arr: "ARR",
    revenue: "Gelir",
    new_customers: "Yeni müşteriler",
    active_users: "Aktif kullanıcılar",
    churned_subscribers: "Ayrılan aboneler",
    trial_conversion_rate: "Deneme dönüşümü"
  };

  const FEED_COLS = 10;
  const METRICS_TTL_MS = 2 * 60 * 1000;
  const FEED_TTL_MS = 90 * 1000;

  let activeAppId = null;
  let detailDialogEl = null;
  let metricsLoadedAt = 0;
  let feedLoadedAt = 0;
  let metricsLoadPromise = null;
  let feedLoadPromise = null;
  let appMetaCache = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatMetricValue(metric) {
    const value = metric?.value;
    if (value == null || Number.isNaN(Number(value))) return "—";
    const unit = metric?.unit || "";
    const num = Number(value);

    if (unit === "$" || unit === "USD") {
      return window.RcSummaryUi?.formatMoney(num, "USD") || String(num);
    }
    if (unit === "%") {
      return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(num)}%`;
    }
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(num);
  }

  function metricLabel(metric) {
    return METRIC_LABELS[metric?.id] || metric?.name || metric?.id || "Metrik";
  }

  function formatRcDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(d);
  }

  function formatRcAmount(row) {
    if (row?.price == null || Number.isNaN(Number(row.price))) return "—";
    const num = Number(row.price);
    const cur = row?.currency || "USD";
    try {
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(num);
    } catch {
      return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(num)} ${cur}`;
    }
  }

  function statusLabel(status) {
    const s = String(status || "").toLowerCase();
    if (s === "active") return "AKTİF";
    if (s === "trialing") return "DENEME";
    if (s === "cancelled" || s === "canceled") return "İPTAL";
    if (s === "expired") return "SÜRESİ BİTTİ";
    if (s === "billing_issue") return "ÖDEME SORUNU";
    return s ? s.toLocaleUpperCase("tr-TR") : "—";
  }

  function countryLabel(code) {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return "—";
    if (c === "TR") return "Türkiye";
    if (c === "US") return "ABD";
    return c;
  }

  function formatSpent(row) {
    if (row?.totalSpent != null && !Number.isNaN(Number(row.totalSpent))) {
      return formatRcAmount({ price: row.totalSpent, currency: row.currency });
    }
    return formatRcAmount(row);
  }

  function showFeedIdleState() {
    const body = document.getElementById("rcFeedBody");
    const status = document.getElementById("rcFeedStatus");
    if (body) {
      body.innerHTML = `<tr><td colspan="${FEED_COLS}" class="user-cell-sub">Abone listesi otomatik yüklenmez — RevenueCat’e ağır istek gitmesin diye <strong>Listeyi yükle</strong> ile getirin.</td></tr>`;
    }
    if (status) {
      status.textContent = "Liste yüklenmedi · Listeyi yükle ile getirin";
    }
  }

  async function fetchAppMeta(appId, force = false) {
    if (!force && appMetaCache?.appId === appId) return appMetaCache.app;
    const metaRes = await fetch(`/api/apps/${appId}`);
    if (metaRes.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const metaJson = await metaRes.json();
    const app = metaJson?.app || null;
    appMetaCache = { appId, app };
    return app;
  }

  function ensureDetailDialog() {
    if (detailDialogEl) return detailDialogEl;
    const dialog = document.createElement("dialog");
    dialog.id = "rcCustomerDetailDialog";
    dialog.className = "shell-dialog dialog-wide";
    dialog.innerHTML = `
      <div class="dialog-header">
        <h3 id="rcDetailTitle">Abonelik detayı</h3>
      </div>
      <div class="dialog-body" id="rcDetailBody">
        <p class="user-cell-sub">Yükleniyor…</p>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn btn-ghost" id="rcDetailCloseBtn">Kapat</button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector("#rcDetailCloseBtn")?.addEventListener("click", () => dialog.close());
    detailDialogEl = dialog;
    return dialog;
  }

  function renderAppUserBlock(appUser) {
    if (!appUser?.matched || !appUser?.user) {
      return `<p class="user-cell-sub">Uygulama kullanıcısı eşleşmedi. Çoğu abonelik anonim RC kimliğindedir; kullanıcı uygulamayı açınca veya <code>sync-memberships</code> sonrası eşleşme gelir. Veritabanında <code>users.revenuecat_customer_id</code> kolonu ve uygulamada RevenueCat <code>logIn</code> gerekir.</p>`;
    }
    const u = appUser.user;
    const d =
      appUser.details?.user ||
      appUser.details?.bodyJson?.user ||
      appUser.details ||
      {};
    const name = u.displayName || u.username || d.username || "—";
    const email = u.email || d.email || "—";
    const premium = u.isPremium || d.isPremium ? "Premium" : "Ücretsiz";
    return `
      <div class="rc-detail-app-user">
        <div class="user-cell-title">${escapeHtml(name)} <span class="status-pill">${escapeHtml(premium)}</span></div>
        <div class="user-cell-sub">ID: ${escapeHtml(String(u.id))} · ${escapeHtml(email)}</div>
        ${
          u.providerId
            ? `<div class="user-cell-sub">Apple kimliği: ${escapeHtml(String(u.providerId))}</div>`
            : ""
        }
        <button type="button" class="btn btn-sm btn-ghost rc-open-app-user" data-user-id="${escapeHtml(String(u.id))}">Kullanıcılar sekmesinde aç</button>
      </div>
    `;
  }

  function renderExternalActions(subs, invoices, rowMeta = {}) {
    const pdfUrl =
      rowMeta.invoicePdfUrl ||
      (subs || []).map((s) => s.invoicePdfUrl).find(Boolean) ||
      (invoices || []).map((i) => i.invoiceUrl).find(Boolean) ||
      null;
    const managementUrl =
      rowMeta.managementUrl ||
      (subs || []).map((s) => s.managementUrl).find(Boolean) ||
      null;

    if (!pdfUrl && !managementUrl) {
      return `<section class="rc-detail-block rc-detail-external">
        <h4>Mağaza ve fatura</h4>
        <p class="user-cell-sub">Harici link yok. Apple aboneliklerinde fiş, kullanıcının App Store satın alma geçmişinde veya Apple’dan gelen e-postada görünür.</p>
      </section>`;
    }

    const links = [];
    if (managementUrl) {
      links.push(
        `<a class="btn btn-sm" href="${escapeHtml(managementUrl)}" target="_blank" rel="noopener noreferrer">App Store aboneliği</a>`
      );
    }
    if (pdfUrl) {
      links.push(
        `<a class="btn btn-sm btn-ghost" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer">Fatura PDF</a>`
      );
    }

    return `<section class="rc-detail-block rc-detail-external">
      <h4>Mağaza ve fatura</h4>
      <p class="field-hint" style="margin:0 0 8px">Mağaza linki abonelik yönetimi içindir; e-fatura değildir.</p>
      <div class="rc-feed-actions">${links.join(" ")}</div>
    </section>`;
  }

  function renderDetailContent(data, rowMeta = {}) {
    const appUser = data.appUser;
    const subs = Array.isArray(data.subscriptions) ? data.subscriptions : [];
    const invoices = Array.isArray(data.invoices) ? data.invoices : [];
    const purchases = Array.isArray(data.purchases) ? data.purchases : [];
    const attrs = data.attributes || {};

    const subsHtml = subs.length
      ? subs
          .map(
            (s) => `<tr>
            <td>${escapeHtml(s.productLabel || s.productId || "—")}</td>
            <td><span class="status-pill ${escapeHtml(String(s.status || "").toLowerCase())}">${escapeHtml(statusLabel(s.status))}</span></td>
            <td class="user-cell-sub">${escapeHtml(s.storeLabel || "—")}</td>
            <td class="user-cell-sub">${escapeHtml(formatRcDate(s.purchasedAt))}</td>
            <td class="user-cell-sub">${escapeHtml(formatRcDate(s.expiresAt))}</td>
            <td class="user-cell-sub">${escapeHtml(formatSpent(s))}</td>
          </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="user-cell-sub">Abonelik kaydı yok.</td></tr>`;

    const invHtml = invoices.length
      ? invoices
          .map((inv) => {
            const link = inv.invoiceUrl
              ? `<a href="${escapeHtml(inv.invoiceUrl)}" target="_blank" rel="noopener noreferrer">Fatura PDF</a>`
              : "—";
            return `<tr>
            <td class="user-cell-sub">${escapeHtml(inv.productLabel || inv.id || "—")}</td>
            <td class="user-cell-sub">${escapeHtml(formatRcDate(inv.issuedAt))}</td>
            <td class="user-cell-sub">${escapeHtml(formatRcAmount({ price: inv.amount, currency: inv.currency }))}</td>
            <td>${link}</td>
          </tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="user-cell-sub">RevenueCat’te fatura kaydı yok. Apple satın alımlarında fiş genelde kullanıcının Apple hesabı / e-postasında görünür.</td></tr>`;

    const externalActions = renderExternalActions(subs, invoices, rowMeta);

    const attrLines = Object.entries(attrs)
      .filter(([k]) => !k.startsWith("$") || k === "$email" || k === "$displayName")
      .map(([k, v]) => `<div class="user-cell-sub">${escapeHtml(k)}: ${escapeHtml(String(v))}</div>`)
      .join("");

    return `
      ${externalActions}
      <section class="rc-detail-block">
        <h4>RevenueCat müşteri</h4>
        <div class="user-cell-title">${escapeHtml(data.customerLabel || data.customerId)}</div>
        <div class="user-cell-sub">${escapeHtml(data.customerId)}</div>
        ${
          data.customer?.country
            ? `<div class="user-cell-sub">Ülke: ${escapeHtml(countryLabel(data.customer.country))} · Platform: ${escapeHtml(data.customer.platform || "—")}</div>`
            : ""
        }
        ${attrLines}
        ${
          (data.aliasIds || []).length
            ? `<div class="user-cell-sub">Bağlı kimlikler: ${escapeHtml((data.aliasIds || []).join(", "))}</div>`
            : ""
        }
      </section>
      <section class="rc-detail-block">
        <h4>Uygulama kullanıcısı</h4>
        ${renderAppUserBlock(appUser)}
      </section>
      <section class="rc-detail-block">
        <h4>Abonelikler</h4>
        <div class="table-wrap">
          <table class="data-table data-table--compact">
            <thead><tr><th>Ürün</th><th>Durum</th><th>Mağaza</th><th>Başlangıç</th><th>Bitiş</th><th>Tutar</th></tr></thead>
            <tbody>${subsHtml}</tbody>
          </table>
        </div>
      </section>
      <section class="rc-detail-block">
        <h4>Faturalar (RevenueCat)</h4>
        <div class="table-wrap">
          <table class="data-table data-table--compact">
            <thead><tr><th>Ürün</th><th>Tarih</th><th>Tutar</th><th>Link</th></tr></thead>
            <tbody>${invHtml}</tbody>
          </table>
        </div>
      </section>
      ${
        purchases.length
          ? `<section class="rc-detail-block"><h4>Satın alımlar</h4><p class="user-cell-sub">${purchases.length} kayıt</p></section>`
          : ""
      }
    `;
  }

  async function openCustomerDetail(customerId, rowMeta = {}) {
    if (!activeAppId || !customerId) return;
    const dialog = ensureDetailDialog();
    const body = document.getElementById("rcDetailBody");
    const title = document.getElementById("rcDetailTitle");
    if (title) {
      title.textContent = rowMeta.productLabel
        ? `${rowMeta.productLabel} · detay`
        : "Abonelik detayı";
    }
    if (body) body.innerHTML = `<p class="user-cell-sub">RevenueCat ve kullanıcı bilgileri yükleniyor…</p>`;
    dialog.showModal();

    const qs = new URLSearchParams({ environment: "production" });
    const res = await fetch(
      `/api/apps/${activeAppId}/revenuecat/customers/${encodeURIComponent(customerId)}/details?${qs}`
    );
    const payload = await res.json();
    if (!payload.ok || !body) {
      body.innerHTML = `<p class="user-cell-sub">${escapeHtml(payload.error || "Detay alınamadı.")}</p>`;
      return;
    }

    body.innerHTML = renderDetailContent(payload.bodyJson, rowMeta);
    body.querySelector(".rc-open-app-user")?.addEventListener("click", (e) => {
      const userId = e.currentTarget.getAttribute("data-user-id");
      dialog.close();
      if (userId && window.FriendifyPanel?.openUserById) {
        window.FriendifyPanel.openUserById(userId);
        return;
      }
      if (userId && window.MindcoachPanel?.openUserById) {
        window.MindcoachPanel.openUserById(userId);
        return;
      }
      if (userId && window.ChatfacePanel?.openUserById) {
        window.ChatfacePanel.openUserById(userId);
        return;
      }
      if (userId && window.YogifacePanel?.openUserById) {
        window.YogifacePanel.openUserById(userId);
        return;
      }
      if (userId && window.LingolaBuddyPanel?.openUserById) {
        window.LingolaBuddyPanel.openUserById(userId);
        return;
      }
      if (userId && window.LiveLingolaPanel?.openUserById) {
        window.LiveLingolaPanel.openUserById(userId);
        return;
      }
      if (userId && window.HomeworkSnapPanel?.openUserById) {
        window.HomeworkSnapPanel.openUserById(userId);
        return;
      }
      if (userId && window.AulixPanel?.openUserById) {
        window.AulixPanel.openUserById(userId);
        return;
      }
      if (userId && window.NightflowPanel?.openUserById) {
        window.NightflowPanel.openUserById(userId);
        return;
      }
      if (userId && window.MenuMaPanel?.openUserById) {
        window.MenuMaPanel.openUserById(userId);
        return;
      }
      if (userId && window.SlidifyPanel?.openUserById) {
        window.SlidifyPanel.openUserById(userId);
        return;
      }
      if (userId && window.SmPlannerPanel?.openUserById) {
        window.SmPlannerPanel.openUserById(userId);
        return;
      }
      if (userId && window.FileTranslatePanel?.openUserById) {
        window.FileTranslatePanel.openUserById(userId);
        return;
      }
      if (userId && window.VideoSummaryPanel?.openUserById) {
        window.VideoSummaryPanel.openUserById(userId);
        return;
      }
      if (userId && window.FileChatPanel?.openUserById) {
        window.FileChatPanel.openUserById(userId);
        return;
      }
      if (userId && window.HomiFitPanel?.openUserById) {
        window.HomiFitPanel.openUserById(userId);
        return;
      }
      if (userId && window.FitGymPanel?.openUserById) {
        window.FitGymPanel.openUserById(userId);
        return;
      }
      const usersNav = document.querySelector('[data-view="users"]');
      usersNav?.click();
    });
  }

  function appUserCell(row) {
    if (row.appUserIdHint) {
      return `<div class="user-cell-title">#${escapeHtml(row.appUserIdHint)}</div><div class="user-cell-sub">RC = kullanıcı ID</div>`;
    }
    if (String(row.customerIdRaw || "").startsWith("$RCAnonymousID:")) {
      return `<div class="user-cell-sub">Anonim · detayda eşle</div>`;
    }
    return `<div class="user-cell-sub">Detayda gör</div>`;
  }

  function bindFeedActions() {
    document.querySelectorAll(".rc-detail-btn").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const customerId = btn.getAttribute("data-customer-id");
        openCustomerDetail(customerId, {
          productLabel: btn.getAttribute("data-product-label") || "",
          invoicePdfUrl: btn.getAttribute("data-invoice-pdf") || "",
          managementUrl: btn.getAttribute("data-management-url") || ""
        }).catch(() => {});
      });
    });
  }

  function bindFeedControls(appId) {
    const refreshBtn = document.getElementById("rcFeedRefreshBtn");
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = "1";
      refreshBtn.addEventListener("click", () => {
        loadPremiumFeed(appId, { force: true }).catch(() => {});
      });
    }
    const searchEl = document.getElementById("rcFeedSearch");
    if (searchEl && !searchEl.dataset.bound) {
      searchEl.dataset.bound = "1";
      let t = null;
      searchEl.addEventListener("input", () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => loadPremiumFeed(appId, { force: true }).catch(() => {}), 600);
      });
    }
  }

  async function loadMetrics(appId, { force = false } = {}) {
    if (!force && metricsLoadedAt && Date.now() - metricsLoadedAt < METRICS_TTL_MS) {
      return true;
    }
    if (!force && metricsLoadPromise) return metricsLoadPromise;

    const run = (async () => {
      const section = document.getElementById("revenuecatSection");
      if (!section) return false;

      const grid = document.getElementById("rcMetricsGrid");
      const statusEl = document.getElementById("rcStatus");
      const errorEl = document.getElementById("rcError");

      if (errorEl) errorEl.hidden = true;
      if (statusEl) statusEl.textContent = "RevenueCat özeti yükleniyor…";
      window.RcSummaryUi?.setRevenuePeriodLoading();
      if (grid) {
        grid.innerHTML = Array.from({ length: 4 }, () =>
          '<article class="card stat-card"><div class="stat-label">…</div><div class="stat-value loading">—</div></article>'
        ).join("");
      }

      const app = await fetchAppMeta(appId, force);
      if (!app) return false;

      if (!app.hasRevenueCat) {
        if (statusEl) {
          statusEl.textContent =
            "RevenueCat bağlı değil — .env dosyasına REVENUECAT_API_KEY ve uygulama project id ekleyin.";
        }
        if (grid) grid.innerHTML = "";
        window.RcSummaryUi?.setRevenuePeriodLoading();
        return false;
      }

      const [summaryRes, overviewRes] = await Promise.all([
        fetch(`/api/apps/${appId}/revenuecat/summary`),
        fetch(`/api/apps/${appId}/revenuecat/overview`)
      ]);
      const summaryPayload = await summaryRes.json();
      const overview = await overviewRes.json();

      if (!summaryPayload.ok) {
        if (statusEl) statusEl.textContent = "";
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent =
            summaryPayload.error ||
            summaryPayload.bodyJson?.message ||
            "RevenueCat özeti alınamadı.";
        }
        if (grid) grid.innerHTML = "";
        return false;
      }

      if (statusEl) {
        statusEl.textContent = "RevenueCat · gelir: son 1 ay, 6 ay ve toplam (tüm zamanlar)";
      }

      window.RcSummaryUi?.renderRevenuePeriods(summaryPayload.bodyJson);

      const metrics = overview.ok && Array.isArray(overview.bodyJson?.metrics)
        ? overview.bodyJson.metrics
        : [];

      const pick = [
        "revenue",
        "mrr",
        "active_subscriptions",
        "active_trials",
        "arr",
        "new_customers",
        "trial_conversion_rate",
        "churned_subscribers"
      ];
      const byId = new Map(metrics.map((m) => [m.id, m]));
      const shown = [];
      for (const id of pick) {
        if (byId.has(id)) shown.push(byId.get(id));
      }
      for (const m of metrics) {
        if (!shown.includes(m) && shown.length < 6) shown.push(m);
      }

      if (grid) {
        grid.className = "stat-grid stat-grid--3 rc-metrics-grid";
        grid.innerHTML = shown.length
          ? shown
              .map(
                (m) => `<article class="card stat-card">
              <div class="stat-label">${metricLabel(m)}</div>
              <div class="stat-value">${formatMetricValue(m)}</div>
            </article>`
              )
              .join("")
          : `<p class="field-hint">Özet metrik döndürülmedi.</p>`;
      }

      metricsLoadedAt = Date.now();
      return true;
    })();

    metricsLoadPromise = run;
    try {
      return await run;
    } finally {
      metricsLoadPromise = null;
    }
  }

  async function fetchPremiumCustomerIds(appId) {
    try {
      const direct = await fetch(`/api/apps/${appId}/proxy/users/premium-ids`);
      const directData = await direct.json();
      if (direct.ok && directData.ok && Array.isArray(directData.bodyJson?.data)) {
        return [...new Set(directData.bodyJson.data.map(String))];
      }
    } catch {
      /* fallback */
    }

    const ids = [];
    let page = 1;
    const maxPages = 10;

    while (page <= maxPages) {
      const params = new URLSearchParams({
        premium: "1",
        limit: "100",
        page: String(page)
      });
      const res = await fetch(`/api/apps/${appId}/proxy/users?${params}`);
      const data = await res.json();
      if (!data.ok) break;

      const users = Array.isArray(data.bodyJson?.data) ? data.bodyJson.data : [];
      users.forEach((user) => {
        if (user?.id != null) ids.push(String(user.id));
      });

      const pagination = data.bodyJson?.pagination;
      if (!pagination?.hasNext) break;
      page += 1;
    }

    return [...new Set(ids)];
  }

  async function loadPremiumFeed(appId, { force = false, scanPages = 6 } = {}) {
    if (!force && feedLoadedAt && Date.now() - feedLoadedAt < FEED_TTL_MS) {
      return;
    }
    if (!force && feedLoadPromise) return feedLoadPromise;

    const run = (async () => {
      activeAppId = appId;
      const body = document.getElementById("rcFeedBody");
      const status = document.getElementById("rcFeedStatus");
      const search = document.getElementById("rcFeedSearch")?.value?.trim() || "";
      if (!body) return;

      body.innerHTML = `<tr><td colspan="${FEED_COLS}" class="user-cell-sub">Aboneler getiriliyor…</td></tr>`;
      if (status) status.textContent = "RevenueCat abone listesi yükleniyor…";

      const premiumIds = search ? [] : await fetchPremiumCustomerIds(appId);

      const qs = new URLSearchParams({
        limit: "20",
        environment: "auto",
        scanAll: "1"
      });
      if (premiumIds.length) {
        qs.set("customerIds", premiumIds.join(","));
      }
      if (search) qs.set("search", search);

      const res = await fetch(`/api/apps/${appId}/revenuecat/subscriptions-feed?${qs.toString()}`);
      const payload = await res.json();
      if (!payload.ok) {
        body.innerHTML = `<tr><td colspan="${FEED_COLS}" class="user-cell-sub">Kayıt alınamadı.</td></tr>`;
        if (status) status.textContent = payload.error || "Premium feed alınamadı.";
        return;
      }

      const rows = Array.isArray(payload.bodyJson?.rows) ? payload.bodyJson.rows : [];
      if (status) {
        const note = payload.bodyJson?.environmentNote ? ` · ${payload.bodyJson.environmentNote}` : "";
        const scanned = payload.bodyJson?.customersFetched;
        const scannedLabel =
          scanned != null ? `${scanned} müşteri kontrol edildi` : "liste güncellendi";
        status.textContent = `${rows.length} kayıt · ${scannedLabel}${note}`;
      }
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="${FEED_COLS}" class="user-cell-sub">Eşleşen premium/fatura kaydı bulunamadı.</td></tr>`;
        feedLoadedAt = Date.now();
        return;
      }

      body.innerHTML = rows
        .map((row) => {
          const customerId = row.customerIdRaw || row.customerId;
          return `<tr>
          <td>
            <div class="user-cell-title">${escapeHtml(row.customerLabel || "—")}</div>
            <div class="user-cell-sub">${escapeHtml(row.customerIdRaw || "")}</div>
          </td>
          <td>${appUserCell(row)}</td>
          <td class="user-cell-sub">${escapeHtml(countryLabel(row.country))}</td>
          <td class="user-cell-sub">${escapeHtml(row.productLabel || row.productId || "—")}</td>
          <td class="user-cell-sub">${escapeHtml(row.storeLabel || "—")}</td>
          <td class="user-cell-sub"><span class="status-pill ${escapeHtml(String(row.status || "").toLowerCase())}">${escapeHtml(statusLabel(row.status))}</span></td>
          <td class="user-cell-sub">${escapeHtml(formatSpent(row))}</td>
          <td class="user-cell-sub">${escapeHtml(formatRcDate(row.purchasedAt))}</td>
          <td class="user-cell-sub">${escapeHtml(formatRcDate(row.expiresAt))}</td>
          <td class="user-cell-sub rc-feed-actions">
            <button type="button" class="btn btn-sm rc-detail-btn" data-customer-id="${escapeHtml(customerId)}" data-product-label="${escapeHtml(row.productLabel || "")}" data-invoice-pdf="${escapeHtml(row.invoicePdfUrl || "")}" data-management-url="${escapeHtml(row.managementUrl || "")}">Detay</button>
          </td>
        </tr>`;
        })
        .join("");

      bindFeedActions();
      feedLoadedAt = Date.now();
    })();

    feedLoadPromise = run;
    try {
      await run;
    } finally {
      feedLoadPromise = null;
    }
  }

  window.RevenueCatPanel = {
    openCustomerDetail,
    async load(appId, options = {}) {
      const section = document.getElementById("revenuecatSection");
      if (!section) return;

      activeAppId = appId;
      const force = options.force === true;
      const withFeed = options.withFeed === true;

      bindFeedControls(appId);

      await loadMetrics(appId, { force });

      if (withFeed) {
        await loadPremiumFeed(appId, { force });
      } else if (!feedLoadedAt) {
        showFeedIdleState();
      }
    },
    loadPremiumFeed
  };
})();
