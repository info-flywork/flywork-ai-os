(function () {
  function formatMoney(value, currency) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0
      }).format(Number(value));
    } catch {
      return `${value} ${currency || ""}`.trim();
    }
  }

  function formatSummaryMetric(metric) {
    if (!metric || metric.value == null || Number.isNaN(Number(metric.value))) return "—";
    const num = Number(metric.value);
    const unit = metric.unit || "";
    if (unit === "$" || unit === "USD") {
      return formatMoney(num, "USD");
    }
    if (unit === "%") {
      return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(num)}%`;
    }
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(num);
  }

  function setRevenuePeriodLoading() {
    for (const id of ["rcRevenue1m", "rcRevenue6m", "rcRevenueAll", "rcSumRevenue1m", "rcSumRevenue6m", "rcSumRevenueAll"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList?.add("loading");
      el.textContent = "—";
    }
  }

  function renderRevenuePeriods(summary) {
    const periods = summary?.revenuePeriods;
    const currency = summary?.currency || "USD";

    const map = [
      ["rcRevenue1m", "rcSumRevenue1m", periods?.["1m"]],
      ["rcRevenue6m", "rcSumRevenue6m", periods?.["6m"]],
      ["rcRevenueAll", "rcSumRevenueAll", periods?.all]
    ];

    for (const [overviewId, purchasesId, period] of map) {
      const text =
        period?.value != null ? formatMoney(period.value, period.currency || currency) : "—";
      for (const id of [overviewId, purchasesId]) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.classList?.remove("loading");
        el.textContent = text;
      }
    }

    const legacy = document.getElementById("rcSumRevenue30");
    if (legacy && summary?.revenue1m) {
      legacy.classList.remove("loading");
      legacy.textContent = formatMoney(summary.revenue1m.value, summary.revenue1m.currency || currency);
    }
    const legacyOverview = document.getElementById("rcRevenueTotal");
    if (legacyOverview && summary?.revenue1m) {
      legacyOverview.textContent = formatMoney(
        summary.revenue1m.value,
        summary.revenue1m.currency || currency
      );
    }
  }

  function renderKpiSummary(summary) {
    const pairs = [
      ["rcSumMrr", summary?.mrr],
      ["rcSumArr", summary?.arr],
      ["rcSumActive", summary?.activeSubscriptions]
    ];
    for (const [id, metric] of pairs) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove("loading");
      el.textContent = formatSummaryMetric(metric);
    }
    renderRevenuePeriods(summary);
  }

  window.RcSummaryUi = {
    formatMoney,
    formatSummaryMetric,
    setRevenuePeriodLoading,
    renderRevenuePeriods,
    renderKpiSummary
  };
})();
