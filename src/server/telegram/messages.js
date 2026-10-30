const LEAVE_LABELS = {
  ANNUAL: "Yıllık izin",
  SICK: "Rapor",
  EXCUSE: "Mazeret",
  UNPAID: "Ücretsiz izin",
};

 










export function formatMealCloseMessage(date, rows, absent = 0) {
  const away = absent > 0 ? [`Ofiste olmayan: ${absent}`] : [];
  if (rows.length === 0) {
    return [`${date} yemek kapanışı`, "İptal edilmeyen sipariş yok.", ...away].join("\n");
  }
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return [
    `${date} yemek kapanışı`,
    ...rows.map((row) => `${row.name}: ${row.count}`),
    ...away,
    `Toplam: ${total}`,
  ].join("\n");
}

function leaveLine(item, dates) {
  const label = LEAVE_LABELS[item.type] ?? item.type;
  const start = dates === "tr" ? turkishDate(item.startDate) : item.startDate;
  const end = dates === "tr" ? turkishDate(item.endDate) : item.endDate;
  const span = item.startDate === item.endDate ? start : `${start} – ${end}`;
  return `${item.employeeName} · ${label} · ${span} · ${item.dayCount} gün`;
}

export function formatPendingLeaves(items) {
  if (items.length === 0) {
    return "Bekleyen izin talebi yok.";
  }
  return ["Bekleyen izin talepleri", ...items.map((item) => leaveLine(item, "iso"))].join("\n");
}

export function formatPendingLeaveApprovals(items) {
  if (items.length === 0) {
    return "Bekleyen izin onayı yok.";
  }
  return ["Bekleyen izin onayları", ...items.map((item) => leaveLine(item, "tr"))].join("\n");
}

export function leaveApprovalButtons(items) {
  return items.map((item) => {
    const name = item.employeeName.length > 22 ? `${item.employeeName.slice(0, 21)}…` : item.employeeName;
    return [
      { text: `Onayla · ${name}`, data: leaveCallback("APPROVED", item.id) },
      { text: `Reddet · ${name}`, data: leaveCallback("REJECTED", item.id) },
    ];
  });
}

function moneyLabel(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return [amount, currency].filter(Boolean).join(" ") || "Tutar yok";
  }
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted} ${currency === "TRY" ? "TL" : currency || ""}`.trim();
}

export function formatInvoiceProcessed(input






) {
  const lines = [
    input.driveFailed ? "Fatura kayda geçti, dosya Drive'a yüklenemedi" : "Fatura işlendi",
    input.vendor.trim() || "Tedarikçi yok",
    input.number.trim() || "Numara yok",
    moneyLabel(input.amount, input.currency),
    input.issuedOn ? turkishDate(input.issuedOn) : "Tarih yok",
  ];
  return lines.join("\n");
}

export function formatInvoiceQuestion(input






) {
  return [
    "Bu belge fatura mı?",
    input.vendor.trim() || input.fileName,
    input.number.trim() || "Numara yok",
    input.amount ? moneyLabel(input.amount, input.currency) : "Tutar belirsiz",
    input.reason,
    "Onayla, Reddet ya da Evet fatura yaz.",
  ].join("\n");
}

export function invoiceDecisionButtons(reviewId) {
  return [[
    { text: "Onayla", data: `yi:${reviewId}` },
    { text: "Reddet", data: `yn:${reviewId}` },
  ]];
}

export function workReplyCallback(taskId) {
  return `wc:${taskId}`;
}

export function parseWorkReplyCallback(data) {
  const match = data.match(/^wc:([a-z0-9]{8,32})$/i);
  if (!match) {
    return null;
  }
  return { taskId: match[1] };
}

export function formatWorkReplyPrompt(title, names) {
  const clean = title.replace(/\s+/g, " ").trim();
  const short = clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
  return [
    "Cevabını yaz.",
    short,
    "Etiket için @ ve adı olduğu gibi yaz.",
    ...names.slice(0, 20).map((name) => `@${name}`),
    "Vazgeçmek için /vazgec yaz.",
  ].join("\n");
}

export function parseInvoiceReply(text) {
  const value = text.trim().toLocaleLowerCase("tr").replace(/[,.!;]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^evet(\s+fatura)?$/.test(value) || /^onay(la|lıyorum)?$/.test(value)) {
    return "approve";
  }
  if (/^(hayır|hayir|reddet)$/.test(value) || /^fatura\s+(değil|degil)$/.test(value)) {
    return "reject";
  }
  return null;
}

export function parseInvoiceCallback(data) {
  const match = data.match(/^y([in]):([a-z0-9]{8,32})$/i);
  if (!match) {
    return null;
  }
  return {
    decision: match[1].toLowerCase() === "i" ? "approve" : "reject",
    reviewId: match[2],
  };
}

export function formatInvoiceReviewNotice(input) {
  const vendor = input.vendor?.trim() || "Tedarikçi eksik";
  const number = input.number?.trim() || input.fileName;
  return `Yeni fatura incelemesi\n${vendor} · ${number}`;
}

function senderName(from) {
  const name = from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return name || "Gönderen yok";
}

export function formatMailSummary(
  slot,
  report



,
  dateLabel,
) {
  const lines = [`${dateLabel ? `${dateLabel} ` : ""}${slot} posta özeti`];
  const sections = [
    ["Önemli", report.important],
    ["Yanıt bekleyen", report.pendingReplies],
    ["Aksiyon", report.tasks],
  ];
  let any = false;
  for (const [title, rows] of sections) {
    if (rows.length === 0) {
      continue;
    }
    any = true;
    lines.push(title);
    for (const row of rows.slice(0, 8)) {
      lines.push(`${senderName(row.from)} · ${row.subject.trim() || "Konu yok"}`);
    }
    if (rows.length > 8) {
      lines.push(`+${rows.length - 8} tane daha`);
    }
  }
  if (!any) {
    lines.push("Yeni posta yok.");
  }
  lines.push("Posta değiştirilmedi.");
  return lines.join("\n");
}

export function formatMealReminder(name, dayLabel, closesAt) {
  return [
    `Merhaba ${name},`,
    `${dayLabel} için yemek siparişiniz henüz tamamlanmadı.`,
    "Yemek siparişinizi verin ve seçiminizi tamamlayın.",
    `Siparişler saat ${closesAt}'da kapanır.`,
  ].join("\n");
}

export function formatAutomationFailure(input) {
  return `Otomasyon hatası\n${input.jobName}\n${input.detail}`;
}

function turkishDate(iso) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) {
    return iso;
  }
  return `${day}.${month}.${year}`;
}

export function formatLeaveRequestNotice(input) {
  const span = input.startDate === input.endDate ? turkishDate(input.startDate) : `${turkishDate(input.startDate)} – ${turkishDate(input.endDate)}`;
  const label = LEAVE_LABELS[input.type] ?? input.type;
  const lines = ["Yeni izin talebi", input.employeeName, `${label} · ${span}${input.time ? ` · ${input.time}` : ""} · ${input.dayCount} gün`];
  const reason = input.reason?.trim();
  if (reason) {
    lines.push(reason);
  }
  return lines.join("\n");
}

export function formatLeaveDecisionNotice(input




) {
  const span = input.startDate === input.endDate ? turkishDate(input.startDate) : `${turkishDate(input.startDate)} – ${turkishDate(input.endDate)}`;
  const title = input.decision === "APPROVED" ? "İzin talebiniz onaylandı." : "İzin talebiniz reddedildi.";
  return `${title}\n${span} · ${input.dayCount} gün`;
}

export function formatFeedbackNotice(input



) {
  const title = input.kind === "COMPLAINT" ? "Şikayet" : "Öneri";
  return [title, input.authorName, input.body.trim()].join("\n");
}

export function formatRenewalReminder(input) {
  return `Yenileyin\n${input.name}\nBitiş: ${turkishDate(input.dueOn)}\n${input.days} gün kaldı`;
}

export function formatRenewalNotice(input) {
  const title = input.overdue ? "Geciken abonelik" : "Yaklaşan abonelik";
  return `${title}\n${input.name} · ${input.renewsOn}`;
}

export function leaveCallback(decision, requestId) {
  return `${decision === "APPROVED" ? "a" : "r"}:${requestId}`;
}

export function emailLinkCallback(decision, requestId) {
  return `${decision === "APPROVED" ? "eo" : "er"}:${requestId}`;
}

export function parseEmailLinkCallback(data) {
  const match = data.match(/^e([or]):([a-z0-9]{8,32})$/i);
  if (!match) {
    return null;
  }
  return {
    decision: match[1].toLowerCase() === "o" ? "APPROVED" : "REJECTED",
    requestId: match[2],
  };
}

export function parseLeaveCallback(data) {
  const match = data.match(/^([ar]):([a-z0-9]{8,32})$/i);
  if (!match) {
    return null;
  }
  return {
    decision: match[1].toLowerCase() === "a" ? "APPROVED" : "REJECTED",
    requestId: match[2],
  };
}

export function parseTelegramCommand(text) {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s+(\S+))?$/i);
  if (!match) {
    return null;
  }
  return { name: match[1].toLowerCase(), argument: match[2] ?? "" };
}

export function leaveDecisionButtons(items) {
  return items.map((item) => [
    { text: "Onayla", data: leaveCallback("APPROVED", item.id) },
    { text: "Reddet", data: leaveCallback("REJECTED", item.id) },
  ]);
}
