import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { GMAIL_QUERIES, listMessageIds, type GmailApi } from "@/server/google/gmail";

type Db = PrismaClient | Prisma.TransactionClient;

export type MailItem = {
  messageId: string;
  from: string;
  subject: string;
  date: string;
};

export type MailAnalysis = {
  connected: boolean;
  readAt: string | null;
  account: string | null;
  important: MailItem[];
  pendingReplies: MailItem[];
  tasks: MailItem[];
  alreadyProcessed: number;
  outbound: "APPROVAL_REQUIRED";
};

const ANALYSIS_LIMIT = 40;

function itemFrom(metadata: { id: string; from: string; subject: string; date: string }): MailItem {
  return {
    messageId: metadata.id,
    from: metadata.from,
    subject: metadata.subject,
    date: metadata.date,
  };
}

export async function analyzeGmail(db: Db, api: GmailApi, account: string, now = new Date()): Promise<MailAnalysis> {
  const [importantIds, pendingIds, actionIds] = await Promise.all([
    listMessageIds(api, GMAIL_QUERIES.important, ANALYSIS_LIMIT),
    listMessageIds(api, GMAIL_QUERIES.pending, ANALYSIS_LIMIT),
    listMessageIds(api, GMAIL_QUERIES.action, ANALYSIS_LIMIT),
  ]);
  const importantSet = new Set(importantIds);
  const pendingSet = new Set(pendingIds);
  const actionSet = new Set(actionIds);
  const ordered = [...new Set([...importantIds, ...pendingIds, ...actionIds])].slice(0, ANALYSIS_LIMIT);
  const important: MailItem[] = [];
  const pendingReplies: MailItem[] = [];
  const tasks: MailItem[] = [];
  let alreadyProcessed = 0;

  for (const messageId of ordered) {
    const seen = await db.gmailProcessedItem.findUnique({
      where: {
        gmailMessageId_attachmentId_purpose: {
          gmailMessageId: messageId,
          attachmentId: "",
          purpose: "ANALYSIS",
        },
      },
    });
    if (seen) {
      alreadyProcessed += 1;
      continue;
    }
    const metadata = await api.getMetadata(messageId);
    const row = itemFrom(metadata);
    if (importantSet.has(messageId)) {
      important.push(row);
    }
    if (pendingSet.has(messageId)) {
      pendingReplies.push(row);
    }
    if (actionSet.has(messageId)) {
      tasks.push(row);
    }
    await db.gmailProcessedItem.create({
      data: {
        gmailMessageId: messageId,
        attachmentId: "",
        purpose: "ANALYSIS",
        threadId: metadata.threadId || null,
        outcome: "REPORTED",
      },
    });
  }

  return {
    connected: true,
    readAt: now.toISOString(),
    account,
    important,
    pendingReplies,
    tasks,
    alreadyProcessed,
    outbound: "APPROVAL_REQUIRED",
  };
}

export function mailSummary(report: MailAnalysis): string {
  if (!report.connected || !report.readAt) {
    return "Gmail bağlantısı yok. Posta okunmadı.";
  }
  return `Önemli ${report.important.length}, yanıt bekleyen ${report.pendingReplies.length}, aksiyon ${report.tasks.length}. Daha önce işlenen ${report.alreadyProcessed}. Posta gövdesi saklanmadı. Gönderme ve silme çalıştırılmadı.`;
}
