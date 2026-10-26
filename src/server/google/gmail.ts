import { GoogleOAuthError } from "@/server/google/oauth";

export const GMAIL_QUERIES = {
  important: "is:important newer_than:2d",
  pending: "in:inbox is:unread newer_than:7d",
  action: "is:important is:unread newer_than:7d",
  invoices: "has:attachment filename:pdf newer_than:14d",
} as const;

export type GmailMessageRef = { id: string; threadId: string };

export type GmailMetadata = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
};

export type GmailPdfPart = {
  filename: string;
  attachmentId: string | null;
  data?: Buffer;
};

export type GmailApi = {
  profile(): Promise<{ emailAddress: string }>;
  listMessages(
    query: string,
    pageToken?: string,
  ): Promise<{ messages: GmailMessageRef[]; nextPageToken?: string }>;
  getMetadata(id: string): Promise<GmailMetadata>;
  listPdfAttachments(id: string): Promise<{ threadId: string; attachments: GmailPdfPart[] }>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
};

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string };
  parts?: GmailPart[];
};

const PAGE_SIZE = 20;
const MAX_PAGES = 10;

function gmailRetryable(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "Gmail yanıt vermedi." ||
    /^Gmail isteği başarısız \([45]\d\d\)$/.test(error.message)
  );
}

async function gmailGetOnce(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Gmail yanıt vermedi.");
    }
    throw error;
  }
  if (response.status === 401) {
    throw new GoogleOAuthError("invalid_grant", "Gmail erişimi reddedildi.");
  }
  if (!response.ok) {
    throw new Error(`Gmail isteği başarısız (${response.status}).`);
  }
  return response.json().catch(() => null);
}

async function gmailGet(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
  timeoutMs = 20_000,
): Promise<unknown> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await gmailGetOnce(token, path, fetchImpl, timeoutMs);
    } catch (error) {
      last = error;
      if (!gmailRetryable(error) || attempt === 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  throw last;
}

function headerValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) {
    return "";
  }
  const found = headers.find(
    (header) =>
      header &&
      typeof header === "object" &&
      "name" in header &&
      typeof header.name === "string" &&
      header.name.toLowerCase() === name.toLowerCase() &&
      "value" in header &&
      typeof header.value === "string",
  );
  if (!found || typeof found !== "object" || !("value" in found) || typeof found.value !== "string") {
    return "";
  }
  return found.value.replace(/\s+/g, " ").trim().slice(0, 200);
}

function collectPdfs(parts: GmailPart[] | undefined, out: GmailPdfPart[]) {
  for (const part of parts ?? []) {
    const filename = (part.filename ?? "").slice(0, 120);
    if (filename.toLowerCase().endsWith(".pdf")) {
      if (part.body?.attachmentId) {
        out.push({ filename, attachmentId: part.body.attachmentId });
      } else if (part.body?.data) {
        out.push({
          filename,
          attachmentId: null,
          data: Buffer.from(part.body.data, "base64url"),
        });
      }
    }
    if (part.parts) {
      collectPdfs(part.parts, out);
    }
  }
}

export function createGmailApi(token: string, fetchImpl: typeof fetch = fetch): GmailApi {
  return {
    async profile() {
      const payload = await gmailGet(token, "profile", fetchImpl);
      const email =
        payload && typeof payload === "object" && "emailAddress" in payload
          ? payload.emailAddress
          : "";
      if (typeof email !== "string" || !email.includes("@")) {
        throw new Error("Gmail profili okunamadı.");
      }
      return { emailAddress: email };
    },
    async listMessages(query, pageToken) {
      const params = new URLSearchParams({ q: query, maxResults: String(PAGE_SIZE) });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }
      const payload = await gmailGet(token, `messages?${params.toString()}`, fetchImpl);
      const messages: GmailMessageRef[] = [];
      const raw =
        payload && typeof payload === "object" && "messages" in payload ? payload.messages : [];
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (
            item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string" &&
            "threadId" in item &&
            typeof item.threadId === "string"
          ) {
            messages.push({ id: item.id, threadId: item.threadId });
          }
        }
      }
      const next =
        payload &&
        typeof payload === "object" &&
        "nextPageToken" in payload &&
        typeof payload.nextPageToken === "string"
          ? payload.nextPageToken
          : undefined;
      return { messages, nextPageToken: next };
    },
    async getMetadata(id) {
      const params = new URLSearchParams({ format: "metadata" });
      params.append("metadataHeaders", "From");
      params.append("metadataHeaders", "Subject");
      params.append("metadataHeaders", "Date");
      const payload = await gmailGet(token, `messages/${encodeURIComponent(id)}?${params}`, fetchImpl);
      const headers =
        payload && typeof payload === "object" && "payload" in payload && payload.payload &&
        typeof payload.payload === "object" &&
        "headers" in payload.payload
          ? payload.payload.headers
          : [];
      const threadId =
        payload && typeof payload === "object" && "threadId" in payload && typeof payload.threadId === "string"
          ? payload.threadId
          : "";
      return {
        id,
        threadId,
        from: headerValue(headers, "From"),
        subject: headerValue(headers, "Subject"),
        date: headerValue(headers, "Date"),
      };
    },
    async listPdfAttachments(id) {
      const payload = await gmailGet(
        token,
        `messages/${encodeURIComponent(id)}?format=full`,
        fetchImpl,
        45_000,
      );
      const root =
        payload && typeof payload === "object" && "payload" in payload && payload.payload &&
        typeof payload.payload === "object"
          ? (payload.payload as GmailPart)
          : undefined;
      const attachments: GmailPdfPart[] = [];
      if (root) {
        collectPdfs([root], attachments);
      }
      const threadId =
        payload && typeof payload === "object" && "threadId" in payload && typeof payload.threadId === "string"
          ? payload.threadId
          : "";
      return { threadId, attachments };
    },
    async getAttachment(messageId, attachmentId) {
      const payload = await gmailGet(
        token,
        `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        fetchImpl,
        45_000,
      );
      const data =
        payload && typeof payload === "object" && "data" in payload && typeof payload.data === "string"
          ? payload.data
          : "";
      if (!data) {
        throw new Error("Gmail eki boş.");
      }
      return Buffer.from(data, "base64url");
    },
  };
}

export async function listMessageIds(
  api: Pick<GmailApi, "listMessages">,
  query: string,
  maxMessages: number,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES && ids.length < maxMessages; page += 1) {
    const batch = await api.listMessages(query, pageToken);
    for (const message of batch.messages) {
      ids.push(message.id);
      if (ids.length >= maxMessages) {
        break;
      }
    }
    if (!batch.nextPageToken) {
      break;
    }
    pageToken = batch.nextPageToken;
  }
  return ids;
}
