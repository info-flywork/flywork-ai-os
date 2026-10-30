import { describe, expect, it } from "vitest";

import { alertSignature, applyAlertReads, buildAlerts, nextIsoDate } from "@/lib/alertFeed";
import { matchesAutoApprove } from "@/server/finance/autoRule";

const today = "2026-10-30";

function task(partial) {
  return {
    id: "kart-1",
    title: "Kart",
    column: "POOL",
    dueOn: null,
    revisionCount: 0,
    createdById: "yonetici",
    assigneeIds: ["calisan"],
    assignedRecent: true,
    reviewHours: 0,
    ...partial,
  };
}

describe("bildirim seviyeleri", () => {
  it("çok sayıda faturayı tek aksiyon bildiriminde toplar", () => {
    const alerts = buildAlerts({
      role: "ADMIN",
      userId: "yonetici",
      today,
      reviews: [
        { id: "a", vendor: "A", number: "1", fileName: "a.pdf" },
        { id: "b", vendor: "B", number: "2", fileName: "b.pdf" },
      ],
      leaves: [],
      renewals: [],
      failures: [],
      success: { id: "run", name: "Günlük fatura taraması", detail: "tamam" },
      drafts: [],
      autoInvoices: [{ id: "auto", body: "Ornek · FW-1" }],
      tasks: [],
    });
    const invoice = alerts.find((alert) => alert.key === "invoice.review:group");
    expect(invoice).toMatchObject({
      level: "action",
      title: "2 fatura inceleme bekliyor",
      href: "/otomasyon/inceleme",
    });
    expect(alerts.find((alert) => alert.key === "automation.ok:run")?.level).toBe("info");
    expect(alerts.find((alert) => alert.key.startsWith("invoice.auto:"))?.level).toBe("info");
  });

  it("çalışana atama, revize ve 24 saat kala kartını açar", () => {
    const alerts = buildAlerts({
      role: "EMPLOYEE",
      userId: "calisan",
      today,
      reviews: [{ id: "a", vendor: "A", number: "1", fileName: "a.pdf" }],
      leaves: [{ id: "izin", body: "talep" }],
      renewals: [{ id: "abo", name: "Cursor", renewsOn: "2026-11-02", overdue: false }],
      failures: [{ id: "run", name: "Tarama", detail: "hata" }],
      success: { id: "ok", name: "Tarama", detail: "tamam" },
      drafts: [{ id: "taslak", body: "hizmet" }],
      autoInvoices: [{ id: "auto", body: "Ornek" }],
      tasks: [
        task({ id: "atama" }),
        task({ id: "revize", column: "REVISION", revisionCount: 2, assignedRecent: false }),
        task({ id: "yakin", dueOn: nextIsoDate(today), column: "DOING", assignedRecent: false }),
      ],
    });
    expect(alerts.find((alert) => alert.key === "work.assigned:atama:calisan")).toMatchObject({
      level: "action",
      href: "/is-takibi?kart=atama",
    });
    expect(alerts.find((alert) => alert.key === "work.revision:revize:2")?.href).toBe("/is-takibi?kart=revize");
    expect(alerts.find((alert) => alert.key === `work.due24:yakin:${nextIsoDate(today)}`)?.level).toBe("action");
    expect(alerts.every((alert) => alert.category === "İş")).toBe(true);
  });

  it("yöneticiye kontrol, gecikme ve 24 saati aşan kontrolü gösterir", () => {
    const alerts = buildAlerts({
      role: "ADMIN",
      userId: "yonetici",
      today,
      reviews: [],
      leaves: [],
      renewals: [{ id: "abo", name: "Cursor", renewsOn: "2026-11-02", overdue: false }],
      failures: [],
      success: null,
      drafts: [],
      autoInvoices: [],
      tasks: [
        task({ id: "kontrol", column: "REVIEW", reviewHours: 30, dueOn: "2026-10-28" }),
      ],
    });
    expect(alerts.find((alert) => alert.key === "work.review:kontrol")?.href).toBe("/is-takibi?kart=kontrol");
    expect(alerts.find((alert) => alert.key === "work.review.late:kontrol")?.level).toBe("action");
    expect(alerts.find((alert) => alert.key === "work.overdue:kontrol:2026-10-28")?.href).toBe("/is-takibi?kart=kontrol");
    expect(alerts.find((alert) => alert.key.startsWith("subscription.renewal"))?.level).toBe("info");
  });

  it("silinen bildirimi gizler, metni değişince geri getirir", () => {
    const current = { key: "work.review:group", title: "1 kart kontrol bekliyor", body: "Arcon", level: "action" };
    const signature = alertSignature(current);
    const hidden = applyAlertReads([current], [{ dedupeKey: current.key, dismissed: true, signature }]);
    expect(hidden).toEqual([]);
    const changed = { ...current, title: "2 kart kontrol bekliyor", body: "Arcon · Veylo" };
    const shown = applyAlertReads([changed], [{ dedupeKey: current.key, dismissed: true, signature }]);
    expect(shown).toEqual([{ ...changed, read: false }]);
  });

  it("otomatik onay kuralı kapalıyken ve sınırın üstünde onaylamaz", () => {
    const draft = {
      vendor: "Ornek Ltd",
      number: "FW-1",
      issuedOn: "2026-10-01",
      amount: "100.00",
      currency: "TRY",
      tax: "20.00",
      documentType: "INVOICE",
    };
    const rule = { enabled: false, maxAmount: "500", currency: "TRY", vendors: ["Ornek Ltd"] };
    expect(matchesAutoApprove(rule, draft, [], [])).toBe(false);
    expect(matchesAutoApprove({ ...rule, enabled: true }, draft, [], [])).toBe(true);
    expect(matchesAutoApprove({ ...rule, enabled: true, maxAmount: "100" }, draft, [], [])).toBe(false);
    expect(matchesAutoApprove({ ...rule, enabled: true, vendors: [] }, draft, [], [])).toBe(false);
  });
});
