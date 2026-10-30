(function () {
  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("tr-TR");
    } catch {
      return iso;
    }
  }

  function formatMoney(price, currency) {
    if (price == null || Number.isNaN(Number(price))) return "—";
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currency || "USD"
      }).format(Number(price));
    } catch {
      return `${price} ${currency || ""}`.trim();
    }
  }

  function formatNumber(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat("tr-TR").format(Number(value));
  }

  function statusClass(status) {
    const s = String(status || "").toLowerCase();
    if (["active", "trialing", "granted"].includes(s)) return "ok";
    if (["expired", "cancelled", "canceled", "refunded"].includes(s)) return "fail";
    return "warn";
  }

  window.RcPurchasesPanel = {
    appId: null,
    cursor: null,
    cursorStack: [],
    search: "",
    environment: "auto",
    rowsCache: new Map(),
    onViewChange: null,

    init(appId, options = {}) {
      this.appId = appId;
      this.onViewChange = options.onViewChange || null;
      if (!document.getElementById("view-purchases")) return;

      const searchBtn = document.getElementById("purchaseSearchBtn");
      const clearBtn = document.getElementById("purchaseClearBtn");
      const prevBtn = document.getElementById("purchasePrevBtn");
      const nextBtn = document.getElementById("purchaseNextBtn");
      const body = document.getElementById("purchasesBody");
      const closeDlg = document.getElementById("closePurchaseDialogBtn");

      searchBtn?.addEventListener("click", () => {
        this.search =
          document.getElementById("purchaseEmailFilter")?.value.trim() ||
          document.getElementById("purchaseUserFilter")?.value.trim() ||
          "";
        this.environment = document.getElementById("purchaseEnvFilter")?.value || "auto";
        this.cursor = null;
        this.cursorStack = [];
        this.load();
      });

      clearBtn?.addEventListener("click", () => {
        const emailEl = document.getElementById("purchaseEmailFilter");
        const userEl = document.getElementById("purchaseUserFilter");
        const envEl = document.getElementById("purchaseEnvFilter");
        if (emailEl) emailEl.value = "";
        if (userEl) userEl.value = "";
        if (envEl) envEl.value = "auto";
        this.search = "";
        this.environment = "auto";
        this.cursor = null;
        this.cursorStack = [];
        this.load();
      });

      prevBtn?.addEventListener("click", () => {
        if (this.cursorStack.length > 0) {
          this.cursorStack.pop();
          this.cursor = this.cursorStack[this.cursorStack.length - 1] || null;
          this.load();
        }
      });

      nextBtn?.addEventListener("click", () => {
        if (this.nextCursor) {
          if (this.cursor) this.cursorStack.push(this.cursor);
          this.cursor = this.nextCursor;
          this.load();
        }
      });

      body?.addEventListener("click", (e) => {
        const id =
          e.target.closest("[data-view-purchase]")?.getAttribute("data-view-purchase") ||
          e.target.closest("tr[data-purchase-id]")?.getAttribute("data-purchase-id");
        if (!id) return;
        const row = this.rowsCache.get(String(id));
        if (row) this.openDetail(row);
      });

      closeDlg?.addEventListener("click", () => {
        document.getElementById("purchaseDetailDialog")?.close();
      });
    },

    openDetail(row) {
      const dlg = document.getElementById("purchaseDetailDialog");
      const body = document.getElementById("purchaseDetailBody");
      if (!dlg || !body) return;

      const pairs = [
        ["Kayıt", row.recordType],
        ["Müşteri (RC)", row.customerId],
        ["Ürün", row.productId],
        ["Durum", row.status],
        ["Erişim", row.givesAccess ? "Evet" : "Hayır"],
        ["Mağaza", row.store],
        ["Ortam", row.environment],
        ["Başlangıç", formatDate(row.purchasedAt)],
        ["Bitiş", formatDate(row.expiresAt)],
        ["Tutar", formatMoney(row.price, row.currency)],
        ["Yenileme", row.autoRenewalStatus]
      ];

      body.innerHTML = `<table class="data-table"><tbody>${pairs
        .map(
          ([k, v]) =>
            `<tr><td class="user-cell-sub" style="width:140px">${k}</td><td>${v ?? "—"}</td></tr>`
        )
        .join("")}</tbody></table>`;
      dlg.showModal();
    },

    async load() {
      const meta = document.getElementById("purchasesMeta");
      const err = document.getElementById("purchasesError");
      const body = document.getElementById("purchasesBody");
      if (!body) return;

      if (err) err.hidden = true;
      body.innerHTML = `<tr><td colspan="6" class="user-cell-sub">Yükleniyor...</td></tr>`;
      if (meta) meta.textContent = "RevenueCat yükleniyor...";
      window.RcSummaryUi?.setRevenuePeriodLoading();
      for (const id of ["rcSumMrr", "rcSumArr", "rcSumActive"]) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.add("loading");
          el.textContent = "—";
        }
      }

      const params = new URLSearchParams({
        limit: "20",
        environment: this.environment,
        skipMetrics: "1",
        scanPages: "1"
      });
      if (this.cursor) params.set("starting_after", this.cursor);
      if (this.search) params.set("search", this.search);

      const url = `/api/apps/${this.appId}/revenuecat/subscriptions-feed?${params}`;
      console.info("[RcPurchases] istek", url);

      const [response, summaryResponse] = await Promise.all([
        fetch(url),
        fetch(`/api/apps/${this.appId}/revenuecat/summary`)
      ]);
      const data = await response.json();
      const summaryData = await summaryResponse.json();

      console.info("[RcPurchases] yanit", {
        httpStatus: response.status,
        ok: data.ok,
        error: data.error,
        rows: data.bodyJson?.rows?.length,
        customersFetched: data.bodyJson?.customersFetched,
        stats: data.bodyJson?.stats,
        environmentNote: data.bodyJson?.environmentNote,
        debug: data.bodyJson?.debug
      });

      if (summaryData.ok && summaryData.bodyJson) {
        window.RcSummaryUi?.renderKpiSummary(summaryData.bodyJson);
      } else if (!data.ok) {
        window.RcSummaryUi?.setRevenuePeriodLoading();
      }

      if (!data.ok) {
        body.innerHTML = "";
        if (err) {
          err.hidden = false;
          let msg = data.error || data.bodyJson?.message || "RevenueCat listesi alınamadı.";
          if (data.debug?.length) {
            const last = data.debug[data.debug.length - 1];
            if (last?.error) msg += ` · ${last.error}`;
          }
          err.textContent = msg;
        }
        if (meta) meta.textContent = "Liste alınamadı";
        document.getElementById("purchasePrevBtn").disabled = true;
        document.getElementById("purchaseNextBtn").disabled = true;
        return;
      }

      const rows = data.bodyJson?.rows || [];
      const pag = data.bodyJson?.pagination || {};
      const stats = data.bodyJson?.stats || {};
      const environmentNote = data.bodyJson?.environmentNote;
      this.nextCursor = pag.nextStartingAfter || null;

      this.rowsCache.clear();
      rows.forEach((r) => this.rowsCache.set(String(r.id), r));

      const debugEl = document.getElementById("purchasesDebug");
      if (debugEl) {
        const lines = [];
        if (environmentNote) lines.push(environmentNote);
        if (stats.subsErrors || stats.purchaseErrors) {
          lines.push(
            `RC hata: ${stats.subsErrors || 0} abonelik, ${stats.purchaseErrors || 0} satın alım isteği başarısız (izin veya ortam).`
          );
        }
        if (Array.isArray(data.bodyJson?.debug) && data.bodyJson.debug.length) {
          const summary = data.bodyJson.debug.find((d) => d.step === "summary");
          if (summary) {
            lines.push(
              `Özet: ${summary.totalRows ?? 0} satır, ${summary.subscriptionRows ?? 0} abonelik, ${summary.purchaseRows ?? 0} tek seferlik.`
            );
          }
        }
        debugEl.textContent = lines.join(" ");
        debugEl.hidden = lines.length === 0;
      }

      if (meta) {
        const cf = data.bodyJson?.customersFetched ?? pag.customersFetched ?? 0;
        const eff = data.bodyJson?.environment || this.environment;
        meta.textContent = `${formatNumber(rows.length)} kayıt · ${formatNumber(cf)} müşteri · ${eff}`;
      }

      body.innerHTML = rows.length
        ? rows
            .map((r) => {
              const typeLabel = r.recordType === "purchase" ? "Tek seferlik" : "Abonelik";
              return `<tr data-purchase-id="${r.id}" style="cursor:pointer">
                <td class="user-cell-sub">${formatDate(r.purchasedAt)}</td>
                <td><div class="user-cell-title">${r.customerLabel || r.customerId}</div><div class="user-cell-sub">${typeLabel}</div></td>
                <td class="user-cell-sub">${r.productId || "—"}</td>
                <td>${formatMoney(r.price, r.currency)}</td>
                <td><span class="status-pill ${statusClass(r.status)}">${r.status || "—"}</span></td>
                <td><button type="button" class="btn btn-sm btn-ghost" data-view-purchase="${r.id}">Detay</button></td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="6"><p class="user-cell-sub">Bu taramada satır yok. Üstteki MRR/gelir doluysa ödemeler başka müşteri sayfasındadır — <strong>Sonraki</strong> veya e-posta ile arayın.</p></td></tr>`;

      document.getElementById("purchasePrevBtn").disabled = this.cursorStack.length === 0;
      document.getElementById("purchaseNextBtn").disabled = !this.nextCursor;
    }
  };
})();
