import { addIsoDays, istanbulClock } from "@/server/meals/schedule";
import { formatWorkDuration } from "@/lib/workTime";
import { formatIstanbulDateTime } from "@/server/dates";
import { sendSmtpMail, smtpReport } from "@/server/mail/smtp";
import { aiDocumentEnv, aiDocumentModel, OPENAI_RESPONSES_URL } from "@/server/finance/documentAi";

export const WORK_WEEKLY_REPORT_RECIPIENTS = [
  "anilcan@semengineer.com",
  "tunahan@fly-work.com",
];

const DAY_LABELS = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

function isoDay(ms) {
  return formatIstanbulDateTime(new Date(ms)).slice(0, 10);
}

function clock(ms) {
  return formatIstanbulDateTime(new Date(ms)).slice(11, 16);
}

function mondayOf(isoDate) {
  const weekday = istanbulClock(new Date(`${isoDate}T12:00:00+03:00`)).weekday;
  const back = weekday === 7 ? 6 : weekday - 1;
  return addIsoDays(isoDate, -back);
}

export function workWeekBounds(now = new Date()) {
  const today = istanbulClock(now).date;
  const monday = mondayOf(today);
  const friday = addIsoDays(monday, 4);
  return {
    monday,
    friday,
    startAt: new Date(`${monday}T00:00:00.000+03:00`),
    endAt: new Date(`${friday}T23:59:59.999+03:00`),
  };
}

function formatLongDay(iso) {
  const weekday = istanbulClock(new Date(`${iso}T12:00:00+03:00`)).weekday;
  const [year, month, day] = iso.split("-").map(Number);
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  return `${day} ${months[month - 1]} ${year} ${DAY_LABELS[weekday]}`;
}

function formatShortRange(monday, friday) {
  const start = formatLongDay(monday).replace(/ \d{4} .*$/, "");
  const end = formatLongDay(friday);
  return `${start} — ${end}`;
}

function workedEnd(session, now) {
  const cap = session.endedAt?.getTime() ?? session.pausedAt?.getTime() ?? now.getTime();
  return Math.max(session.startedAt.getTime(), cap - (session.pausedMs || 0));
}

function splitSessionStints(session, weekStart, weekEnd, now) {
  const start = Math.max(session.startedAt.getTime(), weekStart.getTime());
  const end = Math.min(workedEnd(session, now), weekEnd.getTime());
  if (!(end > start)) return [];
  const stints = [];
  let cursor = start;
  while (cursor < end) {
    const day = isoDay(cursor);
    const nextMidnight = Date.parse(`${addIsoDays(day, 1)}T00:00:00.000+03:00`);
    const pieceEnd = Math.min(end, nextMidnight);
    if (pieceEnd > cursor) {
      stints.push({
        userId: session.userId,
        userName: session.user?.name ?? "",
        taskId: session.taskId,
        title: session.task?.title || session.taskTitle,
        appName: String(session.task?.appName ?? "").trim() || "Uygulama seçilmedi",
        day,
        from: clock(cursor),
        to: clock(pieceEnd),
        minutes: (pieceEnd - cursor) / 60_000,
        done: Boolean(session.done),
        running: !session.endedAt && !session.pausedAt && pieceEnd === end,
      });
    }
    cursor = pieceEnd;
  }
  return stints;
}

export async function collectWeeklyWorkReport(db, now = new Date()) {
  const bounds = workWeekBounds(now);
  const people = await db.user.findMany({
    where: { active: true, mealOnly: false, role: "EMPLOYEE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const sessions = await db.workSession.findMany({
    where: {
      startedAt: { lt: bounds.endAt },
      OR: [
        { endedAt: null },
        { endedAt: { gt: bounds.startAt } },
        { pausedAt: { gt: bounds.startAt } },
      ],
    },
    include: {
      user: { select: { name: true } },
      task: { select: { title: true, appName: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  const stints = sessions.flatMap((session) => splitSessionStints(session, bounds.startAt, bounds.endAt, now));
  const byPerson = new Map();
  const byApp = new Map();
  const byDay = new Map();
  const byJob = new Map();
  const taskIds = new Set();

  for (const stint of stints) {
    const jobKey = stint.taskId || `title:${stint.title}`;
    if (stint.taskId) taskIds.add(stint.taskId);
    const person = byPerson.get(stint.userId) ?? {
      userId: stint.userId,
      name: stint.userName,
      minutes: 0,
      jobs: new Map(),
    };
    person.minutes += stint.minutes;
    const job = person.jobs.get(jobKey) ?? {
      taskId: stint.taskId,
      title: stint.title,
      appName: stint.appName,
      minutes: 0,
      days: [],
      comments: [],
    };
    job.minutes += stint.minutes;
    job.days.push({ day: stint.day, from: stint.from, to: stint.to, minutes: stint.minutes });
    person.jobs.set(jobKey, job);
    byPerson.set(stint.userId, person);

    const app = byApp.get(stint.appName) ?? { name: stint.appName, minutes: 0, cards: new Set() };
    app.minutes += stint.minutes;
    app.cards.add(jobKey);
    byApp.set(stint.appName, app);

    const day = byDay.get(stint.day) ?? { day: stint.day, minutes: 0, people: new Set(), rows: [] };
    day.minutes += stint.minutes;
    day.people.add(stint.userId);
    day.rows.push(stint);
    byDay.set(stint.day, day);

    const shared = byJob.get(jobKey) ?? {
      taskId: stint.taskId,
      title: stint.title,
      appName: stint.appName,
      minutes: 0,
      people: new Map(),
      comments: [],
    };
    shared.minutes += stint.minutes;
    shared.people.set(stint.userId, {
      userId: stint.userId,
      name: stint.userName,
      minutes: (shared.people.get(stint.userId)?.minutes ?? 0) + stint.minutes,
    });
    byJob.set(jobKey, shared);
  }

  const comments = taskIds.size === 0
    ? []
    : await db.workTaskComment.findMany({
      where: {
        taskId: { in: [...taskIds] },
        createdAt: { gte: bounds.startAt, lte: bounds.endAt },
        body: { not: "" },
      },
      select: {
        id: true,
        taskId: true,
        body: true,
        createdAt: true,
        author: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

  const commentsByTask = new Map();
  for (const comment of comments) {
    const body = String(comment.body ?? "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    const item = {
      id: comment.id,
      authorName: comment.author?.name ?? "",
      body: body.slice(0, 500),
      at: formatIstanbulDateTime(comment.createdAt).replace(" ", " · "),
    };
    const list = commentsByTask.get(comment.taskId) ?? [];
    list.push(item);
    commentsByTask.set(comment.taskId, list);
  }

  for (const [jobKey, job] of byJob) {
    if (!job.taskId) continue;
    job.comments = commentsByTask.get(job.taskId) ?? [];
  }
  for (const person of byPerson.values()) {
    for (const job of person.jobs.values()) {
      job.comments = job.taskId ? (commentsByTask.get(job.taskId) ?? []) : [];
    }
  }

  const peopleRows = [...byPerson.values()]
    .map((person) => ({
      userId: person.userId,
      name: person.name,
      minutes: person.minutes,
      jobs: [...person.jobs.values()]
        .map((job) => ({ ...job, days: job.days.sort((a, b) => a.day.localeCompare(b.day) || a.from.localeCompare(b.from)) }))
        .sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title, "tr")),
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "tr"));

  const jobs = [...byJob.values()]
    .map((job) => ({
      taskId: job.taskId,
      title: job.title,
      appName: job.appName,
      minutes: job.minutes,
      people: [...job.people.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "tr")),
      comments: job.comments,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title, "tr"));

  const apps = [...byApp.values()]
    .map((app) => ({ name: app.name, minutes: app.minutes, cardCount: app.cards.size }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "tr"));

  const days = [];
  for (let offset = 0; offset <= 4; offset += 1) {
    const day = addIsoDays(bounds.monday, offset);
    const row = byDay.get(day);
    days.push({
      day,
      label: formatLongDay(day),
      minutes: row?.minutes ?? 0,
      peopleCount: row?.people.size ?? 0,
      rows: (row?.rows ?? []).sort((a, b) => a.from.localeCompare(b.from) || a.userName.localeCompare(b.userName, "tr")),
    });
  }

  const totalMinutes = peopleRows.reduce((sum, person) => sum + person.minutes, 0);
  return {
    monday: bounds.monday,
    friday: bounds.friday,
    rangeLabel: formatShortRange(bounds.monday, bounds.friday),
    generatedAt: formatIstanbulDateTime(now).replace(" ", " · "),
    peopleCount: peopleRows.filter((person) => person.minutes > 0).length,
    totalMinutes,
    cardCount: byJob.size,
    commentCount: comments.length,
    appCount: apps.filter((app) => app.name !== "Uygulama seçilmedi").length,
    people: peopleRows,
    jobs,
    apps,
    days,
    rosterSize: people.length,
  };
}

function commentDigest(comments, limit = 4) {
  return (comments ?? [])
    .slice(0, limit)
    .map((comment) => `"${comment.body}" (${comment.authorName})`)
    .join(" | ");
}

async function openAiWeekEvaluation(report) {
  const env = aiDocumentEnv();
  const key = (process.env.AI_DOCUMENT_API_KEY ?? "").trim();
  if (!env.configured || env.provider !== "openai" || !key) return null;

  const digest = [
    `Dönem: ${report.rangeLabel}`,
    `Toplam: ${formatWorkDuration(report.totalMinutes)} · ${report.peopleCount} kişi · ${report.cardCount} kart · ${report.commentCount} yorum`,
    "",
    "Kişi bazlı (süre + işler + kart yorumları):",
    ...report.people.filter((person) => person.minutes > 0).flatMap((person) => {
      const lines = [`- ${person.name}: ${formatWorkDuration(person.minutes)}`];
      for (const job of person.jobs.slice(0, 10)) {
        lines.push(`  · ${job.title} [${job.appName}] ${formatWorkDuration(job.minutes)}`);
        const notes = commentDigest(job.comments, 3);
        if (notes) lines.push(`    yorumlar: ${notes}`);
      }
      return lines;
    }),
    "",
    "İş bazlı (ne yapıldı):",
    ...report.jobs.slice(0, 20).flatMap((job) => {
      const who = job.people.map((person) => `${person.name} ${formatWorkDuration(person.minutes)}`).join(", ");
      const lines = [`- ${job.title} [${job.appName}] ${formatWorkDuration(job.minutes)} · ${who}`];
      const notes = commentDigest(job.comments, 5);
      if (notes) lines.push(`  yorumlar: ${notes}`);
      else lines.push("  yorumlar: yok");
      return lines;
    }),
    "",
    "Uygulama bazlı:",
    ...report.apps.slice(0, 15).map((app) => `- ${app.name}: ${formatWorkDuration(app.minutes)} · ${app.cardCount} kart`),
  ].join("\n");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: aiDocumentModel(),
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Sen bir yazılım ekibi operasyon asistanısın. Türkçe, kısa ve net yaz. Önce kart yorumlarından bu hafta gerçekte ne yapıldığını çıkar; süreleri de dikkate al. 5-8 cümlelik genel değerlendirme ver: kişi bazlı çıktılar, iş bazlı ilerleme, güçlü yönler, riskler (yorumu zayıf ama süresi yüksek işler, tek kişiye yığılma, uygulama seçilmemiş süre) ve sonraki hafta için 1-2 öneri. Madde işaretleri kullanabilirsin. Yorumda olmayan işi uydurma; sayı uydurma.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: digest }],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI değerlendirme başarısız (${response.status}).`);
  }
  const payload = await response.json();
  const chunks = [];
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) chunks.push(part.text);
    }
  }
  const text = chunks.join("\n").trim();
  return text || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCommentsHtml(comments) {
  if (!comments?.length) {
    return '<p style="margin:6px 0 0;font-size:12px;color:#94a3b8;">Bu hafta yorum yok.</p>';
  }
  return `<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;line-height:1.55;color:#475569;">${comments
    .map((comment) => `<li><strong>${escapeHtml(comment.authorName)}</strong> · ${escapeHtml(comment.at)} — ${escapeHtml(comment.body)}</li>`)
    .join("")}</ul>`;
}

export function renderWeeklyWorkReportHtml(report, evaluation) {
  const peopleHtml = report.people
    .filter((person) => person.minutes > 0)
    .map((person) => {
      const jobs = person.jobs
        .map((job) => `
          <div style="margin:10px 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">
            <p style="margin:0;font-size:13px;color:#0f172a;"><strong>${escapeHtml(job.title)}</strong></p>
            <p style="margin:4px 0 0;font-size:12px;color:#64748b;">${escapeHtml(job.appName)} · ${escapeHtml(formatWorkDuration(job.minutes))}</p>
            ${renderCommentsHtml(job.comments)}
          </div>`)
        .join("");
      return `
        <h3 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">${escapeHtml(person.name)} · ${escapeHtml(formatWorkDuration(person.minutes))}</h3>
        ${jobs}`;
    })
    .join("");

  const jobsHtml = (report.jobs ?? [])
    .map((job) => {
      const who = job.people.map((person) => `${escapeHtml(person.name)} ${escapeHtml(formatWorkDuration(person.minutes))}`).join(" · ");
      return `
        <div style="margin:12px 0;padding:12px;border:1px solid #e2e8f0;border-radius:12px;">
          <p style="margin:0;font-size:14px;color:#0f172a;"><strong>${escapeHtml(job.title)}</strong></p>
          <p style="margin:4px 0 0;font-size:12px;color:#64748b;">${escapeHtml(job.appName)} · ${escapeHtml(formatWorkDuration(job.minutes))} · ${who}</p>
          ${renderCommentsHtml(job.comments)}
        </div>`;
    })
    .join("");

  const appsHtml = report.apps
    .map((app) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(app.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${app.cardCount}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(formatWorkDuration(app.minutes))}</td>
      </tr>`)
    .join("");

  const daysHtml = report.days
    .map((day) => {
      if (day.minutes <= 0) {
        return `<p style="margin:8px 0;font-size:13px;color:#64748b;"><strong>${escapeHtml(day.label)}</strong> — kayıt yok</p>`;
      }
      const rows = day.rows
        .map((row) => `${escapeHtml(row.userName)} · ${escapeHtml(row.title)} · ${escapeHtml(row.appName)} · ${escapeHtml(row.from)}–${escapeHtml(row.to)} (${escapeHtml(formatWorkDuration(row.minutes))})`)
        .join("<br/>");
      return `
        <p style="margin:12px 0 4px;font-size:13px;color:#0f172a;"><strong>${escapeHtml(day.label)}</strong> · ${day.peopleCount} kişi · ${escapeHtml(formatWorkDuration(day.minutes))}</p>
        <p style="margin:0;font-size:12px;line-height:1.55;color:#475569;">${rows}</p>`;
    })
    .join("");

  const evaluationHtml = evaluation
    ? `<h2 style="margin:28px 0 8px;font-size:16px;color:#0f172a;">Genel değerlendirme</h2>
       <div style="padding:12px 14px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;font-size:13px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(evaluation)}</div>`
    : `<h2 style="margin:28px 0 8px;font-size:16px;color:#0f172a;">Genel değerlendirme</h2>
       <p style="font-size:13px;color:#64748b;">OpenAI anahtarı yok veya değerlendirme üretilemedi.</p>`;

  return `<!doctype html>
<html lang="tr">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#03624c;">Flywork · Haftalık Çalışma</p>
      <h1 style="margin:8px 0 4px;font-size:22px;color:#0f172a;">Haftalık Çalışma Raporu</h1>
      <p style="margin:0;font-size:14px;color:#475569;">Dönem: <strong>${escapeHtml(report.rangeLabel)}</strong></p>
      <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">Oluşturulma: ${escapeHtml(report.generatedAt)} (Europe/Istanbul)</p>

      <h2 style="margin:24px 0 8px;font-size:16px;color:#0f172a;">Özet</h2>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#334155;line-height:1.7;">
        <li>Kişi: ${report.peopleCount}</li>
        <li>Toplam süre: ${escapeHtml(formatWorkDuration(report.totalMinutes))}</li>
        <li>Kart / iş: ${report.cardCount}</li>
        <li>Yorum: ${report.commentCount ?? 0}</li>
        <li>Uygulama: ${report.appCount}</li>
      </ul>

      <h2 style="margin:24px 0 0;font-size:16px;color:#0f172a;">Kişi bazlı</h2>
      ${peopleHtml || '<p style="font-size:13px;color:#64748b;">Bu hafta çalışma kaydı yok.</p>'}

      <h2 style="margin:28px 0 8px;font-size:16px;color:#0f172a;">İş bazlı</h2>
      ${jobsHtml || '<p style="font-size:13px;color:#64748b;">Bu hafta iş kaydı yok.</p>'}

      <h2 style="margin:28px 0 8px;font-size:16px;color:#0f172a;">Uygulama bazlı</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155;">
        <thead>
          <tr style="background:#f8fafc;text-align:left;">
            <th style="padding:6px 8px;">Uygulama</th>
            <th style="padding:6px 8px;">Kart</th>
            <th style="padding:6px 8px;">Süre</th>
          </tr>
        </thead>
        <tbody>${appsHtml || '<tr><td colspan="3" style="padding:8px;color:#64748b;">Kayıt yok</td></tr>'}</tbody>
      </table>

      <h2 style="margin:28px 0 8px;font-size:16px;color:#0f172a;">Gün gün</h2>
      ${daysHtml}

      ${evaluationHtml}
    </div>
  </div>
</body>
</html>`;
}

export function renderWeeklyWorkReportText(report, evaluation) {
  const lines = [
    "Flywork · Haftalık Çalışma Raporu",
    `Dönem: ${report.rangeLabel}`,
    `Oluşturulma: ${report.generatedAt} (Europe/Istanbul)`,
    "",
    "Özet",
    `- Kişi: ${report.peopleCount}`,
    `- Toplam süre: ${formatWorkDuration(report.totalMinutes)}`,
    `- Kart / iş: ${report.cardCount}`,
    `- Yorum: ${report.commentCount ?? 0}`,
    `- Uygulama: ${report.appCount}`,
    "",
    "Kişi bazlı",
  ];
  for (const person of report.people.filter((item) => item.minutes > 0)) {
    lines.push(`\n${person.name} · ${formatWorkDuration(person.minutes)}`);
    for (const job of person.jobs) {
      lines.push(`  - ${job.title} · ${job.appName} · ${formatWorkDuration(job.minutes)}`);
      for (const comment of job.comments ?? []) {
        lines.push(`    · ${comment.authorName}: ${comment.body}`);
      }
    }
  }
  lines.push("", "İş bazlı");
  for (const job of report.jobs ?? []) {
    const who = job.people.map((person) => `${person.name} ${formatWorkDuration(person.minutes)}`).join(", ");
    lines.push(`\n${job.title} · ${job.appName} · ${formatWorkDuration(job.minutes)}`);
    lines.push(`  kişiler: ${who}`);
    if ((job.comments ?? []).length === 0) lines.push("  yorum: yok");
    for (const comment of job.comments ?? []) {
      lines.push(`  · ${comment.authorName}: ${comment.body}`);
    }
  }
  lines.push("", "Uygulama bazlı");
  for (const app of report.apps) {
    lines.push(`- ${app.name}: ${app.cardCount} kart · ${formatWorkDuration(app.minutes)}`);
  }
  lines.push("", "Gün gün");
  for (const day of report.days) {
    lines.push(`${day.label} · ${day.peopleCount} kişi · ${formatWorkDuration(day.minutes)}`);
  }
  lines.push("", "Genel değerlendirme");
  lines.push(evaluation || "OpenAI anahtarı yok veya değerlendirme üretilemedi.");
  return lines.join("\n");
}

export async function sendWeeklyWorkReport(db, now = new Date(), options = {}) {
  const recipients = Array.isArray(options.to) && options.to.length > 0
    ? options.to
    : WORK_WEEKLY_REPORT_RECIPIENTS;
  const mail = smtpReport();
  if (!mail.connected) {
    return {
      state: "WAITING_CONNECTION",
      summary: `SMTP bağlı değil. Eksik: ${mail.missing.join(", ")}`,
    };
  }
  const report = await collectWeeklyWorkReport(db, now);
  let evaluation = null;
  try {
    evaluation = await openAiWeekEvaluation(report);
  } catch (error) {
    evaluation = null;
    report.evaluationError = error instanceof Error ? error.message : "Değerlendirme alınamadı.";
  }
  const subject = `Flywork Haftalık Çalışma Raporu · ${report.rangeLabel}`;
  const html = renderWeeklyWorkReportHtml(report, evaluation);
  const text = renderWeeklyWorkReportText(report, evaluation);
  const sent = await sendSmtpMail({
    to: recipients,
    subject,
    text,
    html,
  });
  return {
    state: "SUCCEEDED",
    summary: `${report.rangeLabel} raporu gönderildi (${report.peopleCount} kişi, ${formatWorkDuration(report.totalMinutes)}). Alıcı: ${recipients.join(", ")}.`,
    report: {
      monday: report.monday,
      friday: report.friday,
      peopleCount: report.peopleCount,
      totalMinutes: report.totalMinutes,
      cardCount: report.cardCount,
      evaluation: Boolean(evaluation),
      messageId: sent.messageId,
    },
  };
}
