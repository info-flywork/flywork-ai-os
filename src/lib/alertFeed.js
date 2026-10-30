import { createHash } from "node:crypto";

export function nextIsoDate(today) {
  const [year, month, day] = today.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export function reviewWaitHours(createdAt, now) {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    return 0;
  }
  const wall = createdAt.toISOString().slice(0, 16);
  const instant = new Date(`${wall}:00+03:00`);
  if (Number.isNaN(instant.getTime())) {
    return 0;
  }
  return (now.getTime() - instant.getTime()) / 3_600_000;
}

function pushGroup(alerts, items, group) {
  if (items.length === 0) {
    return;
  }
  if (items.length === 1) {
    alerts.push({ ...items[0], level: group.level, category: group.category });
    return;
  }
  alerts.push({
    key: group.key,
    title: group.title(items.length),
    body: items.map((item) => item.body).join(" · "),
    href: group.href,
    level: group.level,
    category: group.category,
  });
}

export function alertSignature(alert) {
  return createHash("sha256").update(`${alert.key}\n${alert.title}\n${alert.body}`).digest("hex").slice(0, 64);
}

export function applyAlertReads(alerts, reads) {
  const byKey = new Map(reads.map((row) => [row.dedupeKey, row]));
  return alerts
    .filter((item) => {
      const row = byKey.get(item.key);
      return !(row?.dismissed && row.signature === alertSignature(item));
    })
    .map((item) => {
      const row = byKey.get(item.key);
      return { ...item, read: Boolean(row) && !row.dismissed };
    })
    .sort((left, right) => Number(left.read) - Number(right.read));
}

function cardHref(taskId) {
  return `/is-takibi?kart=${taskId}`;
}

export function buildAlerts(input) {
  const alerts = [];
  const today = input.today;
  const tomorrow = nextIsoDate(today);
  const admin = input.role === "ADMIN";

  if (admin) {
  pushGroup(alerts, input.reviews.map((review) => ({
    key: `invoice.review:${review.id}`,
    title: "İnceleme bekleyen fatura",
    body: `${review.vendor || "Tedarikçi eksik"} · ${review.number || review.fileName}`,
    href: `/otomasyon/inceleme/${review.id}`,
  })), {
    key: "invoice.review:group",
    title: (count) => `${count} fatura inceleme bekliyor`,
    href: "/otomasyon/inceleme",
    level: "action",
    category: "Fatura",
  });

  pushGroup(alerts, input.leaves.map((request) => ({
    key: `leave.request:${request.id}`,
    title: "Onay bekleyen izin",
    body: request.body,
    href: "/izin",
  })), {
    key: "leave.request:group",
    title: (count) => `${count} izin onay bekliyor`,
    href: "/izin",
    level: "action",
    category: "İzin",
  });

  pushGroup(alerts, input.renewals.map((item) => ({
    key: `subscription.renewal:${item.id}:${item.renewsOn}`,
    title: item.overdue ? "Geciken abonelik yenilemesi" : "Yaklaşan abonelik yenilemesi",
    body: `${item.name} · ${item.renewsOn}`,
    href: `/teknoloji?kayit=${item.id}`,
  })), {
    key: "subscription.renewal:group",
    title: (count) => `${count} abonelik yenilemesi yaklaşıyor`,
    href: "/teknoloji",
    level: "info",
    category: "Yenileme",
  });

  for (const run of input.failures) {
    alerts.push({
      key: `automation.failed:${run.id}`,
      title: "Başarısız otomasyon",
      body: `${run.name} · ${run.detail}`,
      href: "/otomasyon",
      level: "action",
      category: "Otomasyon",
    });
  }

  if (input.success) {
    alerts.push({
      key: `automation.ok:${input.success.id}`,
      title: "Otomasyon tamamlandı",
      body: `${input.success.name} · ${input.success.detail}`,
      href: "/otomasyon",
      level: "info",
      category: "Otomasyon",
    });
  }

  pushGroup(alerts, input.drafts.map((draft) => ({
    key: `technology.draft:${draft.id}`,
    title: "Onay bekleyen hizmet taslağı",
    body: draft.body,
    href: `/teknoloji?taslak=${draft.id}`,
  })), {
    key: "technology.draft:group",
    title: (count) => `${count} hizmet taslağı onay bekliyor`,
    href: "/teknoloji",
    level: "action",
    category: "Taslak",
  });

  pushGroup(alerts, input.autoInvoices.map((item) => ({
    key: `invoice.auto:${item.id}`,
    title: "Fatura otomatik işlendi",
    body: item.body,
    href: "/harcama",
  })), {
    key: `invoice.auto:group:${input.autoInvoices[0]?.id ?? "none"}`,
    title: (count) => `${count} fatura otomatik onaylandı`,
    href: "/harcama",
    level: "info",
    category: "Fatura",
  });
  }

  const mine = input.tasks.filter((task) => task.assigneeIds.includes(input.userId) && task.createdById !== input.userId);
  if (!admin) {
    pushGroup(alerts, mine.filter((task) => task.assignedRecent).map((task) => ({
      key: `work.assigned:${task.id}:${input.userId}`,
      title: "Sana kart atandı",
      body: task.title,
      href: cardHref(task.id),
    })), {
      key: "work.assigned:group",
      title: (count) => `${count} kart sana atandı`,
      href: "/is-takibi",
      level: "action",
      category: "İş",
    });
    pushGroup(alerts, mine.filter((task) => task.column === "REVISION").map((task) => ({
      key: `work.revision:${task.id}:${task.revisionCount}`,
      title: "Kartın revizeye alındı",
      body: task.title,
      href: cardHref(task.id),
    })), {
      key: "work.revision:group",
      title: (count) => `${count} kartın revizede`,
      href: "/is-takibi?filtre=revize",
      level: "action",
      category: "İş",
    });
    pushGroup(alerts, mine.filter((task) => task.dueOn === tomorrow).map((task) => ({
      key: `work.due24:${task.id}:${task.dueOn}`,
      title: "Teslimine 24 saat kalan kart",
      body: task.title,
      href: cardHref(task.id),
    })), {
      key: "work.due24:group",
      title: (count) => `${count} kartın teslimine 24 saat kaldı`,
      href: "/is-takibi",
      level: "action",
      category: "İş",
    });
  }

  if (admin) {
    const reviewing = input.tasks.filter((task) => task.column === "REVIEW");
    pushGroup(alerts, reviewing.map((task) => ({
      key: `work.review:${task.id}`,
      title: "Kontrol bekleyen kart",
      body: task.title,
      href: cardHref(task.id),
    })), {
      key: "work.review:group",
      title: (count) => `${count} kart kontrol bekliyor`,
      href: "/is-takibi?filtre=kontrol",
      level: "action",
      category: "İş",
    });
    pushGroup(alerts, reviewing.filter((task) => task.reviewHours >= 24).map((task) => ({
      key: `work.review.late:${task.id}`,
      title: "Kontrol 24 saati aştı",
      body: task.title,
      href: cardHref(task.id),
    })), {
      key: "work.review.late:group",
      title: (count) => `${count} kart 24 saatten uzun süredir kontrolde`,
      href: "/is-takibi?filtre=kontrol",
      level: "action",
      category: "İş",
    });
    pushGroup(alerts, input.tasks.filter((task) => task.dueOn && task.dueOn < today).map((task) => ({
      key: `work.overdue:${task.id}:${task.dueOn}`,
      title: "Teslim tarihi geçen kart",
      body: task.title,
      href: cardHref(task.id),
    })), {
      key: "work.overdue:group",
      title: (count) => `${count} kartın teslim tarihi geçti`,
      href: "/is-takibi?filtre=geciken",
      level: "action",
      category: "İş",
    });
  }

  return alerts;
}
