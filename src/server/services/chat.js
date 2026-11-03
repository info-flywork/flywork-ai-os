import "server-only";
import { randomBytes } from "node:crypto";
import { assertCan } from "@/server/auth/permissions";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { istanbulToday } from "@/server/dates";
import { COMMENT_EMOJIS, groupCommentReactions } from "@/lib/commentReactions";
import { inspectWorkFile, inspectWorkImage, safeFileName } from "@/server/work/images";
import { readChatFile, removeChatFile, writeChatFile } from "@/server/chat/store";

const GENERAL_TOPIC = "Flywork ekibinin genel iletişim kanalı. Duyurular, güncellemeler ve günlük koordinasyon.";
const ONLINE_MS = 2 * 60 * 1000;

function guard(actor) {
  assertNotMealOnly(actor);
  assertCan(actor, "chat:use");
}

function istanbulIso(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDay(iso, days) {
  const date = new Date(`${iso}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return istanbulIso(date);
}

function clock(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function listTime(date, today) {
  const iso = istanbulIso(date);
  if (iso === today) return clock(date);
  if (iso === shiftDay(today, -1)) return "Dün";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short" }).format(date);
}

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function previewOf(message) {
  if (!message) return "Henüz mesaj yok";
  if (message.deletedAt) return "Bu mesaj silindi";
  const text = message.body.trim();
  if (text) return text.replace(/\s+/g, " ").slice(0, 90);
  const file = message.attachments?.[0];
  if (!file) return "Mesaj";
  if (String(file.contentType).startsWith("image/")) return "Görsel";
  return file.fileName || "Dosya";
}

function directKey(left, right) {
  return [left, right].sort().join(":");
}

function userPhoto(user) {
  if (!user?.photoKey) return "";
  return `/api/sohbet-profil/kisi/${user.id}?v=${user.updatedAt.getTime()}`;
}

function groupPhoto(thread) {
  if (!thread?.photoKey) return "";
  return `/api/sohbet-profil/grup/${thread.id}?v=${thread.updatedAt.getTime()}`;
}

async function staff(db) {
  return db.user.findMany({
    where: { active: true, mealOnly: false, hidden: false },
    select: { id: true, name: true, role: true, bio: true, photoKey: true, updatedAt: true, hidden: true },
    orderBy: { name: "asc" },
  });
}

function visibleChatMembers(members) {
  return members.filter((member) => !member.user?.hidden);
}

async function ensureGeneral(db, actor, knownPeople) {
  const people = [...(knownPeople ?? await staff(db))];
  if (actor?.id && !people.some((person) => person.id === actor.id)) {
    people.push(actor);
  }
  let thread = await db.chatThread.findUnique({ where: { systemKey: "genel" } });
  if (!thread) {
    try {
      thread = await db.chatThread.create({
        data: {
          kind: "GROUP",
          title: "Genel Ekip",
          topic: GENERAL_TOPIC,
          systemKey: "genel",
          createdById: actor.id,
          members: {
            create: people.map((person) => ({
              userId: person.id,
              admin: person.role === "ADMIN",
            })),
          },
        },
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      thread = await db.chatThread.findUnique({ where: { systemKey: "genel" } });
    }
  }
  if (!thread) throw new AppError("Genel ekip sohbeti açılamadı.", "DATABASE_UNAVAILABLE", 503);
  const existing = await db.chatMember.findMany({
    where: { threadId: thread.id },
    select: { id: true, userId: true, leftAt: true },
  });
  const byUser = new Map(existing.map((row) => [row.userId, row]));
  for (const person of people) {
    const row = byUser.get(person.id);
    if (!row) {
      await db.chatMember.create({
        data: { threadId: thread.id, userId: person.id, admin: person.role === "ADMIN" },
      }).catch((error) => {
        if (error?.code !== "P2002") throw error;
      });
    } else if (row.leftAt) {
      await db.chatMember.update({ where: { id: row.id }, data: { leftAt: null, admin: person.role === "ADMIN" } });
    }
  }
  return thread.id;
}

async function membership(db, actorId, threadId) {
  const member = await db.chatMember.findUnique({
    where: { threadId_userId: { threadId, userId: actorId } },
  });
  if (!member || member.leftAt) throw new AppError("Bu sohbete erişimin yok.", "FORBIDDEN", 403);
  return member;
}

function mentionIds(body, members, actorId) {
  const others = members.filter((member) => member.userId !== actorId);
  const haystack = body.toLocaleLowerCase("tr");
  if (/(?:^|\s)@herkes(?=\s|$|[.,!?;:])/.test(haystack)) return others.map((member) => member.userId);
  const ranked = [...others].sort((left, right) => right.name.length - left.name.length);
  const found = [];
  for (const member of ranked) {
    if (haystack.includes(`@${member.name}`.toLocaleLowerCase("tr"))) found.push(member.userId);
  }
  return [...new Set(found)];
}

function mapMessage(message, actorId, othersReadAt) {
  const deleted = Boolean(message.deletedAt);
  const read = message.authorId === actorId && othersReadAt.length > 0 && othersReadAt.every((stamp) => stamp >= message.createdAt);
  return {
    id: message.id,
    authorId: message.authorId,
    authorName: message.author.name,
    mine: message.authorId === actorId,
    body: deleted ? "" : message.body,
    deleted,
    edited: Boolean(message.editedAt),
    time: clock(message.createdAt),
    dayKey: istanbulIso(message.createdAt),
    reply: message.replyTo
      ? {
          id: message.replyTo.id,
          authorName: message.replyTo.author.name,
          body: message.replyTo.deletedAt ? "Bu mesaj silindi" : message.replyTo.body.replace(/\s+/g, " ").slice(0, 120),
        }
      : null,
    attachments: deleted
      ? []
      : message.attachments.map((file) => ({
          id: file.id,
          contentType: file.contentType,
          fileName: file.fileName,
          size: sizeLabel(file.byteSize),
        })),
    reactions: groupCommentReactions(
      message.reactions.map((reaction) => ({ emoji: reaction.emoji, userId: reaction.userId, userName: reaction.user.name })),
      actorId,
    ),
    mentions: message.mentions.map((mention) => ({ userId: mention.userId, name: mention.user.name })),
    read,
  };
}

const messageInclude = {
  author: { select: { name: true } },
  replyTo: { select: { id: true, body: true, deletedAt: true, author: { select: { name: true } } } },
  attachments: { select: { id: true, contentType: true, fileName: true, byteSize: true } },
  reactions: { select: { emoji: true, userId: true, user: { select: { name: true } } } },
  mentions: { select: { userId: true, user: { select: { name: true } } } },
};

async function loadOpen(db, actor, threadId, now, markRead = true) {
  const mine = await membership(db, actor.id, threadId);
  if (markRead) await db.chatMember.update({ where: { id: mine.id }, data: { lastReadAt: now } });
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    include: {
      members: {
        where: { leftAt: null },
        include: { user: { select: { id: true, name: true, role: true, bio: true, photoKey: true, updatedAt: true, hidden: true } } },
      },
      pins: {
        orderBy: { createdAt: "desc" },
        include: { message: { include: { author: { select: { name: true } } } } },
      },
    },
  });
  if (!thread) throw new AppError("Sohbet bulunamadı.", "NOT_FOUND", 404);
  const messages = await db.chatMessage.findMany({
    where: { threadId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: messageInclude,
  });
  messages.reverse();
  const members = visibleChatMembers(thread.members);
  const others = members.filter((member) => member.userId !== actor.id);
  const title = thread.kind === "DIRECT"
    ? (others[0]?.user.name ?? "Sohbet")
    : thread.title;
  const online = members.filter((member) => now.getTime() - member.lastReadAt.getTime() <= ONLINE_MS).length;
  const media = [];
  for (const message of [...messages].reverse()) {
    if (message.deletedAt) continue;
    for (const file of message.attachments) {
      media.push({ id: file.id, contentType: file.contentType, fileName: file.fileName, size: sizeLabel(file.byteSize) });
      if (media.length >= 12) break;
    }
    if (media.length >= 12) break;
  }
  return {
    id: thread.id,
    kind: thread.kind,
    title,
    topic: thread.topic ?? "",
    image: thread.kind === "DIRECT" ? userPhoto(others[0]?.user) : groupPhoto(thread),
    bio: thread.kind === "DIRECT" ? (others[0]?.user.bio ?? "") : "",
    system: thread.systemKey === "genel",
    admin: mine.admin || actor.role === "ADMIN",
    muted: mine.muted,
    pinned: mine.pinned,
    memberCount: members.length,
    online,
    messages: messages.map((message) => mapMessage(message, actor.id, others.map((member) => member.lastReadAt))),
    pins: thread.pins
      .filter((pin) => !pin.message.deletedAt)
      .map((pin) => ({
        id: pin.message.id,
        authorName: pin.message.author.name,
        body: pin.message.body.replace(/\s+/g, " ").slice(0, 140),
        time: clock(pin.message.createdAt),
      })),
    media,
    members: members
      .map((member) => ({
        userId: member.userId,
        name: member.user.name,
        image: userPhoto(member.user),
        bio: member.user.bio ?? "",
        admin: member.admin,
        roleLabel: member.admin ? "Yönetici" : member.user.role === "ADMIN" ? "Yönetici" : "Üye",
        online: now.getTime() - member.lastReadAt.getTime() <= ONLINE_MS,
      }))
      .sort((left, right) => Number(right.admin) - Number(left.admin) || left.name.localeCompare(right.name, "tr")),
  };
}

export async function loadChatThread(actor, threadId, markRead = true) {
  guard(actor);
  return withDatabase(async (db) => loadOpen(db, actor, threadId, new Date(), markRead));
}

export async function getChatBoard(actor, threadId) {
  guard(actor);
  return withDatabase(async (db) => {
    const now = new Date();
    const today = istanbulToday(now);
    const peoplePromise = staff(db);
    const [people, generalId, unreadRows, memberships, latestRows, recentMessages] = await Promise.all([
      peoplePromise,
      peoplePromise.then((list) => ensureGeneral(db, actor, list)),
      db.$queryRaw`
        SELECT msg.threadId AS threadId, COUNT(*) AS total
        FROM ChatMessage msg
        INNER JOIN ChatMember mem
          ON mem.threadId = msg.threadId
         AND mem.userId = ${actor.id}
         AND mem.leftAt IS NULL
        WHERE msg.deletedAt IS NULL
          AND msg.authorId <> ${actor.id}
          AND msg.createdAt > mem.lastReadAt
        GROUP BY msg.threadId
      `,
      db.chatMember.findMany({
        where: { userId: actor.id, leftAt: null },
        select: {
          pinned: true,
          muted: true,
          admin: true,
          thread: {
            select: {
              id: true,
              kind: true,
              title: true,
              topic: true,
              systemKey: true,
              photoKey: true,
              updatedAt: true,
              members: {
                where: { leftAt: null },
                select: {
                  userId: true,
                  user: { select: { id: true, name: true, photoKey: true, updatedAt: true, hidden: true } },
                },
              },
            },
          },
        },
      }),
      db.$queryRaw`
        SELECT m.threadId AS threadId, m.body AS body, m.createdAt AS createdAt,
          (SELECT a.contentType FROM ChatAttachment a WHERE a.messageId = m.id LIMIT 1) AS contentType,
          (SELECT a.fileName FROM ChatAttachment a WHERE a.messageId = m.id LIMIT 1) AS fileName
        FROM ChatMessage m
        INNER JOIN (
          SELECT msg.threadId AS threadId, MAX(msg.createdAt) AS createdAt
          FROM ChatMessage msg
          INNER JOIN ChatMember mem
            ON mem.threadId = msg.threadId
           AND mem.userId = ${actor.id}
           AND mem.leftAt IS NULL
          WHERE msg.deletedAt IS NULL
          GROUP BY msg.threadId
        ) latest ON latest.threadId = m.threadId AND latest.createdAt = m.createdAt
        WHERE m.deletedAt IS NULL
      `,
      db.chatMessage.findMany({
        where: threadId
          ? { threadId, deletedAt: null }
          : { deletedAt: null, thread: { systemKey: "genel" } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          body: true,
          createdAt: true,
          authorId: true,
          author: { select: { name: true } },
          attachments: { select: { id: true, fileName: true, contentType: true } },
        },
      }),
    ]);
    const chosen = threadId || generalId;
    const column = (row, name) => row[name] ?? row[name.toLowerCase()];
    const unreadByThread = new Map(unreadRows.map((row) => [column(row, "threadId"), Number(column(row, "total"))]));
    const latestByThread = new Map(latestRows.map((row) => [column(row, "threadId"), {
      body: column(row, "body") ?? "",
      createdAt: new Date(column(row, "createdAt")),
      attachments: column(row, "contentType")
        ? [{ contentType: column(row, "contentType"), fileName: column(row, "fileName") }]
        : [],
    }]));
    const threads = [];
    for (const membership of memberships) {
      const thread = membership.thread;
      const latest = latestByThread.get(thread.id) ?? null;
      const unread = unreadByThread.get(thread.id) ?? 0;
      const members = visibleChatMembers(thread.members);
      const others = members.filter((member) => member.userId !== actor.id);
      threads.push({
        id: thread.id,
        kind: thread.kind,
        title: thread.kind === "DIRECT" ? (others[0]?.user.name ?? "Sohbet") : thread.title,
        preview: previewOf(latest),
        time: latest ? listTime(latest.createdAt, today) : "",
        stamp: (latest?.createdAt ?? thread.updatedAt).getTime(),
        unread: membership.muted ? 0 : unread,
        pinned: membership.pinned,
        muted: membership.muted,
        topic: thread.topic ?? "",
        image: thread.kind === "DIRECT" ? userPhoto(others[0]?.user) : groupPhoto(thread),
        canRename: thread.kind === "GROUP" && (membership.admin || actor.role === "ADMIN"),
        canDelete: thread.kind === "DIRECT" || membership.admin || actor.role === "ADMIN",
        system: thread.systemKey === "genel",
        memberCount: members.length,
        names: members.map((member) => member.user.name),
        snippets: thread.id === chosen ? recentMessages.map((message) => message.body).join("\n") : (latest?.body ?? ""),
        recent: thread.id === chosen ? [...recentMessages].reverse().map((message) => ({
            id: message.id,
            authorId: message.authorId,
            authorName: message.author?.name ?? "",
            mine: message.authorId === actor.id,
            body: message.body,
            deleted: false,
            edited: false,
            time: clock(message.createdAt),
            dayKey: istanbulIso(message.createdAt),
            reply: null,
            attachments: (message.attachments ?? []).map((file) => ({
              id: file.id ?? "",
              contentType: file.contentType,
              fileName: file.fileName,
              size: "",
            })),
            reactions: [],
            mentions: [],
            read: false,
          }))
          : [],
      });
    }
    threads.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.stamp - left.stamp);
    const directory = people
      .filter((person) => person.id !== actor.id)
      .map((person) => ({ id: person.id, name: person.name, image: userPhoto(person) }));
    const me = people.find((person) => person.id === actor.id) ?? null;
    const chosenThread = threads.find((thread) => thread.id === chosen) ?? null;
    const open = chosenThread ? {
      id: chosenThread.id,
      kind: chosenThread.kind,
      title: chosenThread.title,
      topic: chosenThread.topic,
      image: chosenThread.image,
      bio: "",
      system: chosenThread.system,
      admin: chosenThread.canRename || actor.role === "ADMIN",
      muted: chosenThread.muted,
      pinned: chosenThread.pinned,
      memberCount: chosenThread.memberCount,
      online: 0,
      messages: chosenThread.recent,
      pins: [],
      media: [],
      members: [],
      partial: true,
    } : null;
    return {
      viewerId: actor.id,
      profile: { name: me?.name ?? actor.name, bio: me?.bio ?? "", image: userPhoto(me) },
      threads: threads.map(({ snippets, stamp, ...thread }) => ({ ...thread, unread: thread.id === chosen ? 0 : thread.unread })),
      searchText: Object.fromEntries(threads.map((thread) => [thread.id, `${thread.title}\n${thread.names.join("\n")}\n${thread.snippets}`])),
      people: directory,
      open,
      today,
    };
  });
}

export async function countChatUnread(actor) {
  guard(actor);
  return withDatabase(async (db) => {
    await ensureGeneral(db, actor);
    const rows = await db.$queryRaw`
      SELECT COUNT(*) AS total
      FROM ChatMessage msg
      INNER JOIN ChatMember mem
        ON mem.threadId = msg.threadId
       AND mem.userId = ${actor.id}
       AND mem.leftAt IS NULL
       AND mem.muted = 0
      WHERE msg.deletedAt IS NULL
        AND msg.authorId <> ${actor.id}
        AND msg.createdAt > mem.lastReadAt
    `;
    const row = rows[0] ?? {};
    return Number(row.total ?? row.TOTAL ?? 0);
  });
}

async function touch(db, threadId) {
  await db.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
}

export async function openDirectChat(actor, userId) {
  guard(actor);
  if (!userId || userId === actor.id) throw new AppError("Bir ekip arkadaşı seç.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const other = await db.user.findFirst({ where: { id: userId, active: true, mealOnly: false, hidden: false }, select: { id: true } });
    if (!other) throw new AppError("Bu kişiyle sohbet açılamaz.", "NOT_FOUND", 404);
    const key = directKey(actor.id, other.id);
    const existing = await db.chatThread.findUnique({ where: { directKey: key } });
    if (existing) {
      await db.chatMember.updateMany({ where: { threadId: existing.id, userId: { in: [actor.id, other.id] } }, data: { leftAt: null } });
      return { id: existing.id };
    }
    const created = await db.chatThread.create({
      data: {
        kind: "DIRECT",
        directKey: key,
        createdById: actor.id,
        members: { create: [{ userId: actor.id }, { userId: other.id }] },
      },
    });
    return { id: created.id };
  });
}

export async function createGroupChat(actor, input) {
  guard(actor);
  const title = String(input?.title ?? "").trim();
  const topic = String(input?.topic ?? "").trim();
  const memberIds = [...new Set((input?.memberIds ?? []).filter((id) => id && id !== actor.id))];
  if (title.length < 2 || title.length > 80) throw new AppError("Grup adı 2 ile 80 karakter arasında olmalı.", "VALIDATION", 400);
  if (topic.length > 280) throw new AppError("Grup açıklaması 280 karakteri aşamaz.", "VALIDATION", 400);
  if (memberIds.length === 0) throw new AppError("Gruba en az bir kişi ekle.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const people = await db.user.findMany({
      where: { id: { in: memberIds }, active: true, mealOnly: false, hidden: false },
      select: { id: true },
    });
    if (people.length !== memberIds.length) throw new AppError("Gruba eklenecek kişiler ekipte olmalı.", "VALIDATION", 400);
    const created = await db.chatThread.create({
      data: {
        kind: "GROUP",
        title,
        topic: topic || null,
        createdById: actor.id,
        members: {
          create: [
            { userId: actor.id, admin: true },
            ...people.map((person) => ({ userId: person.id })),
          ],
        },
      },
    });
    return { id: created.id };
  });
}

export async function updateGroupChat(actor, input) {
  guard(actor);
  const title = String(input?.title ?? "").trim();
  const topic = String(input?.topic ?? "").trim();
  if (title.length < 2 || title.length > 80) throw new AppError("Grup adı 2 ile 80 karakter arasında olmalı.", "VALIDATION", 400);
  if (topic.length > 280) throw new AppError("Grup açıklaması 280 karakteri aşamaz.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const mine = await membership(db, actor.id, input.threadId);
    const thread = await db.chatThread.findUnique({ where: { id: input.threadId }, select: { kind: true } });
    if (!thread || thread.kind !== "GROUP") throw new AppError("Yalnızca grup adı düzenlenir.", "VALIDATION", 400);
    if (!mine.admin && actor.role !== "ADMIN") throw new AppError("Grup adını yöneticiler düzenler.", "FORBIDDEN", 403);
    await db.chatThread.update({ where: { id: input.threadId }, data: { title, topic: topic || null } });
  });
}

export async function addChatMembers(actor, input) {
  guard(actor);
  const memberIds = [...new Set((input?.memberIds ?? []).filter(Boolean))];
  if (memberIds.length === 0) throw new AppError("Eklenecek kişiyi seç.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const mine = await membership(db, actor.id, input.threadId);
    const thread = await db.chatThread.findUnique({ where: { id: input.threadId }, select: { kind: true } });
    if (!thread || thread.kind !== "GROUP") throw new AppError("Kişi eklemek grup sohbetlerinde olur.", "VALIDATION", 400);
    if (!mine.admin && actor.role !== "ADMIN") throw new AppError("Üye eklemeyi grup yöneticisi yapar.", "FORBIDDEN", 403);
    const people = await db.user.findMany({
      where: { id: { in: memberIds }, active: true, mealOnly: false, hidden: false },
      select: { id: true },
    });
    if (people.length !== memberIds.length) throw new AppError("Eklenecek kişiler ekipte olmalı.", "VALIDATION", 400);
    for (const person of people) {
      const existing = await db.chatMember.findUnique({ where: { threadId_userId: { threadId: input.threadId, userId: person.id } } });
      if (!existing) {
        await db.chatMember.create({ data: { threadId: input.threadId, userId: person.id } });
      } else if (existing.leftAt) {
        await db.chatMember.update({ where: { id: existing.id }, data: { leftAt: null } });
      }
    }
    await touch(db, input.threadId);
  });
}

export async function leaveChat(actor, threadId) {
  guard(actor);
  return withDatabase(async (db) => {
    const mine = await membership(db, actor.id, threadId);
    const thread = await db.chatThread.findUnique({ where: { id: threadId }, select: { kind: true, systemKey: true } });
    if (!thread || thread.kind !== "GROUP" || thread.systemKey === "genel") {
      throw new AppError("Genel ekipten ayrılınamaz. Sohbeti sessize alabilirsin.", "VALIDATION", 400);
    }
    await db.chatMember.update({ where: { id: mine.id }, data: { leftAt: new Date(), pinned: false } });
  });
}

export async function setChatFlags(actor, input) {
  guard(actor);
  return withDatabase(async (db) => {
    const mine = await membership(db, actor.id, input.threadId);
    const data = {};
    if (typeof input.pinned === "boolean") data.pinned = input.pinned;
    if (typeof input.muted === "boolean") data.muted = input.muted;
    if (Object.keys(data).length === 0) return;
    await db.chatMember.update({ where: { id: mine.id }, data });
  });
}

function preparedFiles(files) {
  const prepared = [];
  for (const file of files ?? []) {
    const bytes = Buffer.from(file.bytes);
    const inspected = file.kind === "file" ? inspectWorkFile(bytes, file.fileName) : inspectWorkImage(bytes);
    prepared.push({
      bytes: inspected.bytes,
      contentType: inspected.contentType,
      fileName: inspected.fileName || safeFileName(file.fileName || "gorsel"),
    });
  }
  if (prepared.length > 6) throw new AppError("Bir mesaja en fazla 6 dosya eklenebilir.", "VALIDATION", 400);
  return prepared;
}

export async function sendChatMessage(actor, input) {
  guard(actor);
  const body = String(input?.body ?? "").trim();
  const files = preparedFiles(input?.files);
  if (!body && files.length === 0) throw new AppError("Mesaj veya dosya yaz.", "VALIDATION", 400);
  if (body.length > 4000) throw new AppError("Mesaj 4000 karakteri aşamaz.", "VALIDATION", 400);
  const stored = [];
  try {
    return await withDatabase(async (db) => {
      await membership(db, actor.id, input.threadId);
      const members = await db.chatMember.findMany({
        where: { threadId: input.threadId, leftAt: null },
        include: { user: { select: { id: true, name: true, hidden: true } } },
      });
      let replyToId = null;
      if (input.replyToId) {
        const reply = await db.chatMessage.findFirst({ where: { id: input.replyToId, threadId: input.threadId }, select: { id: true } });
        if (!reply) throw new AppError("Yanıtlanan mesaj bu sohbette değil.", "VALIDATION", 400);
        replyToId = reply.id;
      }
      const message = await db.chatMessage.create({
        data: {
          threadId: input.threadId,
          authorId: actor.id,
          body,
          replyToId,
          mentions: { create: mentionIds(body, visibleChatMembers(members).map((member) => ({ userId: member.user.id, name: member.user.name })), actor.id).map((userId) => ({ userId })) },
        },
      });
      for (const file of files) {
        const storageKey = randomBytes(16).toString("hex");
        await writeChatFile(storageKey, file.bytes);
        stored.push(storageKey);
        await db.chatAttachment.create({
          data: {
            messageId: message.id,
            storageKey,
            contentType: file.contentType,
            fileName: file.fileName,
            byteSize: file.bytes.length,
          },
        });
      }
      await db.chatMember.update({
        where: { threadId_userId: { threadId: input.threadId, userId: actor.id } },
        data: { lastReadAt: new Date() },
      });
      await touch(db, input.threadId);
      return { id: message.id };
    });
  } catch (error) {
    await Promise.all(stored.map((key) => removeChatFile(key)));
    throw error;
  }
}

export async function editChatMessage(actor, input) {
  guard(actor);
  const body = String(input?.body ?? "").trim();
  if (!body || body.length > 4000) throw new AppError("Mesaj 1 ile 4000 karakter arasında olmalı.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const message = await db.chatMessage.findUnique({ where: { id: input.messageId }, select: { id: true, threadId: true, authorId: true, deletedAt: true } });
    if (!message || message.deletedAt) throw new AppError("Mesaj bulunamadı.", "NOT_FOUND", 404);
    await membership(db, actor.id, message.threadId);
    if (message.authorId !== actor.id) throw new AppError("Yalnızca kendi mesajını düzenleyebilirsin.", "FORBIDDEN", 403);
    const members = await db.chatMember.findMany({
      where: { threadId: message.threadId, leftAt: null },
      include: { user: { select: { id: true, name: true, hidden: true } } },
    });
    await db.chatMention.deleteMany({ where: { messageId: message.id } });
    await db.chatMessage.update({
      where: { id: message.id },
      data: {
        body,
        editedAt: new Date(),
        mentions: { create: mentionIds(body, visibleChatMembers(members).map((member) => ({ userId: member.user.id, name: member.user.name })), actor.id).map((userId) => ({ userId })) },
      },
    });
  });
}

export async function deleteChatMessage(actor, messageId) {
  guard(actor);
  return withDatabase(async (db) => {
    const message = await db.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, threadId: true, authorId: true, deletedAt: true, attachments: { select: { storageKey: true } } },
    });
    if (!message || message.deletedAt) throw new AppError("Mesaj bulunamadı.", "NOT_FOUND", 404);
    await membership(db, actor.id, message.threadId);
    if (message.authorId !== actor.id && actor.role !== "ADMIN") throw new AppError("Yalnızca kendi mesajını silebilirsin.", "FORBIDDEN", 403);
    await db.chatPinnedMessage.deleteMany({ where: { messageId } });
    await db.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: "" } });
    for (const file of message.attachments) await removeChatFile(file.storageKey);
    await db.chatAttachment.deleteMany({ where: { messageId } });
  });
}

export async function toggleChatReaction(actor, input) {
  guard(actor);
  if (!COMMENT_EMOJIS.includes(input?.emoji)) throw new AppError("Bu emoji kullanılamaz.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const message = await db.chatMessage.findUnique({ where: { id: input.messageId }, select: { id: true, threadId: true, deletedAt: true } });
    if (!message || message.deletedAt) throw new AppError("Mesaj bulunamadı.", "NOT_FOUND", 404);
    await membership(db, actor.id, message.threadId);
    const existing = await db.chatReaction.findUnique({
      where: { messageId_userId_emoji: { messageId: message.id, userId: actor.id, emoji: input.emoji } },
    });
    if (existing) await db.chatReaction.delete({ where: { id: existing.id } });
    else await db.chatReaction.create({ data: { messageId: message.id, userId: actor.id, emoji: input.emoji } });
  });
}

export async function togglePinnedChatMessage(actor, messageId) {
  guard(actor);
  return withDatabase(async (db) => {
    const message = await db.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, threadId: true, deletedAt: true } });
    if (!message || message.deletedAt) throw new AppError("Mesaj bulunamadı.", "NOT_FOUND", 404);
    const mine = await membership(db, actor.id, message.threadId);
    const thread = await db.chatThread.findUnique({ where: { id: message.threadId }, select: { kind: true } });
    if (thread?.kind === "GROUP" && !mine.admin && actor.role !== "ADMIN") throw new AppError("Mesajı grup yöneticisi sabitler.", "FORBIDDEN", 403);
    const existing = await db.chatPinnedMessage.findUnique({ where: { messageId } });
    if (existing) {
      await db.chatPinnedMessage.delete({ where: { id: existing.id } });
      return;
    }
    const count = await db.chatPinnedMessage.count({ where: { threadId: message.threadId } });
    if (count >= 5) throw new AppError("Bir sohbette en fazla 5 sabit mesaj olur.", "VALIDATION", 400);
    await db.chatPinnedMessage.create({ data: { threadId: message.threadId, messageId, userId: actor.id } });
  });
}

export async function deleteChatThread(actor, threadId) {
  guard(actor);
  const keys = await withDatabase(async (db) => {
    const mine = await membership(db, actor.id, threadId);
    const thread = await db.chatThread.findUnique({ where: { id: threadId }, select: { kind: true, systemKey: true } });
    if (!thread) throw new AppError("Sohbet bulunamadı.", "NOT_FOUND", 404);
    const allowed = thread.kind === "DIRECT" || mine.admin || actor.role === "ADMIN";
    if (!allowed) throw new AppError("Bu sohbeti yöneticisi silebilir.", "FORBIDDEN", 403);
    const files = await db.chatAttachment.findMany({
      where: { message: { threadId } },
      select: { storageKey: true },
    });
    if (thread.systemKey === "genel") {
      await db.chatMessage.deleteMany({ where: { threadId } });
    } else {
      await db.chatThread.delete({ where: { id: threadId } });
    }
    return files.map((file) => file.storageKey);
  });
  await Promise.all(keys.map((key) => removeChatFile(key)));
}

async function storePhoto(bytes) {
  const inspected = inspectWorkImage(Buffer.from(bytes));
  const storageKey = randomBytes(16).toString("hex");
  await writeChatFile(storageKey, inspected.bytes);
  return { storageKey, contentType: inspected.contentType };
}

export async function setOwnProfile(actor, input) {
  guard(actor);
  const bio = String(input?.bio ?? "").trim();
  if (bio.length > 160) throw new AppError("Biyografi 160 karakteri aşamaz.", "VALIDATION", 400);
  let createdKey = "";
  try {
    const previous = await withDatabase(async (db) => {
      const current = await db.user.findUnique({ where: { id: actor.id }, select: { photoKey: true } });
      let photoKey = current?.photoKey ?? null;
      if (input?.removePhoto) photoKey = null;
      if (input?.photo) {
        const stored = await storePhoto(input.photo);
        createdKey = stored.storageKey;
        photoKey = stored.storageKey;
      }
      await db.user.update({ where: { id: actor.id }, data: { bio: bio || null, photoKey } });
      return current?.photoKey && current.photoKey !== photoKey ? current.photoKey : "";
    });
    if (previous) await removeChatFile(previous);
  } catch (error) {
    if (createdKey) await removeChatFile(createdKey);
    throw error;
  }
}

export async function setGroupPhoto(actor, input) {
  guard(actor);
  let createdKey = "";
  try {
    const previous = await withDatabase(async (db) => {
      const mine = await membership(db, actor.id, input.threadId);
      const thread = await db.chatThread.findUnique({ where: { id: input.threadId }, select: { kind: true, photoKey: true } });
      if (!thread || thread.kind !== "GROUP") throw new AppError("Fotoğraf grup sohbetine eklenir.", "VALIDATION", 400);
      if (!mine.admin && actor.role !== "ADMIN") throw new AppError("Grup fotoğrafını yönetici değiştirir.", "FORBIDDEN", 403);
      let photoKey = thread.photoKey;
      if (input?.removePhoto) photoKey = null;
      if (input?.photo) {
        const stored = await storePhoto(input.photo);
        createdKey = stored.storageKey;
        photoKey = stored.storageKey;
      }
      await db.chatThread.update({ where: { id: input.threadId }, data: { photoKey } });
      return thread.photoKey && thread.photoKey !== photoKey ? thread.photoKey : "";
    });
    if (previous) await removeChatFile(previous);
  } catch (error) {
    if (createdKey) await removeChatFile(createdKey);
    throw error;
  }
}

export async function openChatProfilePhoto(actor, kind, id) {
  guard(actor);
  return withDatabase(async (db) => {
    if (kind === "grup") {
      const thread = await db.chatThread.findUnique({ where: { id }, select: { id: true, photoKey: true } });
      if (!thread?.photoKey) throw new AppError("Fotoğraf bulunamadı.", "NOT_FOUND", 404);
      await membership(db, actor.id, thread.id);
      const bytes = await readChatFile(thread.photoKey);
      return { bytes, contentType: inspectWorkImage(bytes).contentType };
    }
    const person = await db.user.findFirst({
      where: { id, active: true, mealOnly: false, hidden: false },
      select: { photoKey: true },
    });
    if (!person?.photoKey) throw new AppError("Fotoğraf bulunamadı.", "NOT_FOUND", 404);
    const bytes = await readChatFile(person.photoKey);
    return { bytes, contentType: inspectWorkImage(bytes).contentType };
  });
}

export async function openChatAttachment(actor, id) {
  guard(actor);
  return withDatabase(async (db) => {
    const file = await db.chatAttachment.findUnique({
      where: { id },
      select: { storageKey: true, contentType: true, fileName: true, message: { select: { threadId: true, deletedAt: true } } },
    });
    if (!file || file.message.deletedAt) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
    await membership(db, actor.id, file.message.threadId);
    return {
      bytes: await readChatFile(file.storageKey),
      contentType: file.contentType,
      fileName: file.fileName,
    };
  });
}
