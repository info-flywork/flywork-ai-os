"use client";

import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { refreshQuiet } from "@/client/refreshQuiet";
import { useRouter } from "next/navigation";
import { CheckCheck, ChevronDown, FileText, ListFilter, MessageCircle, Mic, MoreVertical, Paperclip, Search, Send, Smile, Star, Users, X } from "lucide-react";
import { COMMENT_EMOJIS } from "@/lib/commentReactions";
import {
  addMembersAction,
  createGroupAction,
  deleteChatAction,
  deleteThreadAction,
  editChatAction,
  leaveChatAction,
  loadThreadAction,
  openDirectAction,
  pinMessageAction,
  reactChatAction,
  saveGroupPhotoAction,
  saveProfileAction,
  sendChatAction,
  setChatFlagsAction,
  setTypingAction,
  updateGroupAction,
} from "@/app/(panel)/flywork-chat/actions";
import {
  AttachDrawer,
  ContactCard,
  JumpDown,
  Lightbox,
  ListFilterMenu,
  MessageMenu,
  MuteBadge,
  PinBadge,
  ReactBar,
  StarBadge,
  ThreadActionsMenu,
  ThreadSearchPanel,
  Toast,
  VoiceBubble,
  VoiceComposer,
} from "@/components/chat/waParts";

const WA_SHADOW = "shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]";
const CONTACT_PREFIX = "📇 Kişi: ";

function prefsKey(viewerId, name) {
  return `flywork-chat:${viewerId || "anon"}:${name}`;
}

function readSet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function writeSet(key, value) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

function readMap(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function writeMap(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function parseContact(body) {
  if (!body?.startsWith(CONTACT_PREFIX)) return null;
  return body.slice(CONTACT_PREFIX.length).trim();
}

function dayHeading(dayKey, today) {
  if (dayKey === today) return "Bugün";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long" }).format(new Date(`${dayKey}T12:00:00+03:00`));
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toLocaleUpperCase("tr");
}

function colorOf(name) {
  const colors = ["#03624c", "#0f766e", "#b45309", "#7c3aed", "#be123c", "#1d4ed8", "#0e7490"];
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % colors.length;
  return colors[hash];
}

function Avatar({ name, src = "", size = "h-10 w-10", online = false }) {
  return (
    <span className={`relative inline-grid shrink-0 ${size}`}>
      {src ? (
        <img src={src} alt="" className={`h-full w-full rounded-full object-cover`} />
      ) : (
        <span className="grid h-full w-full place-items-center rounded-full text-xs font-semibold text-white" style={{ background: colorOf(name || "?") }}>
          {initials(name || "?")}
        </span>
      )}
      {online ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" /> : null}
    </span>
  );
}

function DayDivider({ label }) {
  return (
    <div className="flex justify-center py-3">
      <span className={`rounded-lg bg-[#e9edef]/90 px-3 py-1.5 text-[12px] font-medium text-slate-600 ${WA_SHADOW}`}>{label}</span>
    </div>
  );
}

function fileKind(file) {
  const name = file.name.toLocaleLowerCase("tr");
  const type = String(file.type || "");
  if (type.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|webm|mov)$/.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(webm|ogg|mp3|mpeg)$/.test(name)) return "audio";
  if (/\.(pdf|docx?|xlsx?|xlsm|pptx?|txt|csv|zip)$/.test(name)) return "file";
  return "";
}

function mentionAt(value, caret) {
  const upto = value.slice(0, caret);
  const match = upto.match(/(^|\s)@([^\n@]*)$/);
  if (!match) return null;
  return { query: match[2], start: upto.length - match[2].length - 1 };
}

function localClock() {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

function shellThread(row, id) {
  return {
    id,
    kind: row?.kind ?? "GROUP",
    title: row?.title ?? "",
    topic: row?.topic ?? "",
    image: row?.image ?? "",
    bio: "",
    system: Boolean(row?.system),
    admin: Boolean(row?.canRename || row?.canDelete),
    muted: Boolean(row?.muted),
    pinned: Boolean(row?.pinned),
    memberCount: row?.memberCount ?? 0,
    online: 0,
    messages: row?.recent ?? [],
    pins: [],
    media: [],
    members: [],
    typing: [],
  };
}

function toggleGrouped(reactions, emoji, viewerName) {
  const next = reactions.map((item) => ({ ...item, names: [...item.names] }));
  const found = next.find((item) => item.emoji === emoji);
  if (found?.mine) {
    found.count -= 1;
    found.mine = false;
    found.names = found.names.filter((name) => name !== viewerName);
    return next.filter((item) => item.count > 0);
  }
  for (const item of next) {
    if (!item.mine) continue;
    item.count -= 1;
    item.mine = false;
    item.names = item.names.filter((name) => name !== viewerName);
  }
  const cleaned = next.filter((item) => item.count > 0);
  const target = cleaned.find((item) => item.emoji === emoji);
  if (target) {
    target.count += 1;
    target.mine = true;
    target.names.push(viewerName);
    return cleaned;
  }
  return [...cleaned, { emoji, count: 1, mine: true, names: [viewerName] }];
}

function highlight(body, names, mine = false) {
  const links = body.split(/(https?:\/\/[^\s]+)/g);
  const ranked = [...new Set(["Herkes", ...names])].sort((left, right) => right.length - left.length);
  return links.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer" className={`font-semibold underline ${mine ? "text-white" : ""}`}>{part}</a>;
    }
    if (ranked.length === 0) return <span key={index}>{part}</span>;
    const pattern = new RegExp(`(${ranked.map((name) => `@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).join("|")})`, "gi");
    const bits = part.split(pattern);
    return bits.map((bit, bitIndex) => (
      ranked.some((name) => bit.toLocaleLowerCase("tr") === `@${name}`.toLocaleLowerCase("tr"))
        ? <span key={`${index}-${bitIndex}`} className={`font-semibold ${mine ? "text-emerald-100" : "text-[#03624c]"}`}>{bit}</span>
        : <span key={`${index}-${bitIndex}`}>{bit}</span>
    ));
  });
}

export default function FlyworkChat({ data }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [threadMenuFor, setThreadMenuFor] = useState(null);
  const [query, setQuery] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [reply, setReply] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [reactFor, setReactFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState(null);
  const [renameId, setRenameId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupTopic, setGroupTopic] = useState("");
  const [picked, setPicked] = useState([]);
  const pending = false;
  const [profileView, setProfileView] = useState(null);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [profileFile, setProfileFile] = useState(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [dropPhoto, setDropPhoto] = useState(false);
  const [info, setInfo] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [starred, setStarred] = useState(() => new Set());
  const [hiddenMsgs, setHiddenMsgs] = useState(() => new Set());
  const [archived, setArchived] = useState(() => new Set());
  const [muteUntil, setMuteUntil] = useState({});
  const [away, setAway] = useState(false);
  const [missed, setMissed] = useState(0);
  const [typing, setTyping] = useState([]);
  const [recording, setRecording] = useState(null);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const imageRef = useRef(null);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const composerRef = useRef(null);
  const scroller = useRef(null);
  const messageRefs = useRef(new Map());
  const stick = useRef(true);
  const dragDepth = useRef(0);
  const cacheRef = useRef(new Map(data.open ? [[data.open.id, data.open]] : []));
  const pullSeq = useRef(0);
  const hold = useRef(0);
  const sending = useRef(false);
  const pulling = useRef(false);
  const typingTimer = useRef(0);
  const mediaRecorder = useRef(null);
  const recordChunks = useRef([]);
  const recordTick = useRef(0);
  const messageCount = useRef(data.open?.messages?.length ?? 0);
  const authGone = useRef(false);
  const [shownId, setShownId] = useState(data.open?.id ?? "");
  const [live, setLive] = useState(data.open ?? null);
  const [rows, setRows] = useState(data.threads);
  const shownRef = useRef(shownId);
  shownRef.current = shownId;
  const open = live;
  const openId = open?.id ?? shownId;
  const mention = mentionAt(body, caret);
  const mentionPeople = (open?.members ?? []).filter((member) => member.userId !== data.viewerId);
  const mentionQuery = mention?.query.toLocaleLowerCase("tr") ?? null;
  const suggestions = mentionQuery === null ? [] : [
    ...("herkes".startsWith(mentionQuery) ? [{ userId: "herkes", name: "Herkes", image: "", everyone: true }] : []),
    ...mentionPeople.filter((person) => person.name.toLocaleLowerCase("tr").includes(mentionQuery)),
  ];
  const activeMention = suggestions.length === 0 ? 0 : Math.min(mentionIndex, suggestions.length - 1);

  useEffect(() => {
    setRows(data.threads);
  }, [data.threads]);

  useEffect(() => {
    const viewer = data.viewerId;
    setStarred(readSet(prefsKey(viewer, "starred")));
    setHiddenMsgs(readSet(prefsKey(viewer, "hidden")));
    setArchived(readSet(prefsKey(viewer, "archived")));
    setMuteUntil(readMap(prefsKey(viewer, "muteUntil")));
  }, [data.viewerId]);

  useEffect(() => {
    if (!data.open) return;
    const cached = cacheRef.current.get(data.open.id);
    const incoming = data.open.partial && cached && !cached.partial ? cached : data.open;
    if (incoming === data.open) cacheRef.current.set(data.open.id, data.open);
    if (hold.current === 0 && shownRef.current === data.open.id) {
      setLive(incoming);
      setTyping(incoming.typing ?? []);
    }
  }, [data.open]);

  function handleAuthLost() {
    if (authGone.current) return;
    authGone.current = true;
    router.replace(`/giris?next=${encodeURIComponent("/flywork-chat")}`);
  }

  async function pull(id, markRead) {
    if (!id || authGone.current || pulling.current) return;
    pulling.current = true;
    const seq = ++pullSeq.current;
    try {
      const result = await loadThreadAction(id, markRead);
      if (result?.auth) {
        handleAuthLost();
        return;
      }
      if (!result?.ok || seq !== pullSeq.current) return;
      cacheRef.current.set(id, result.open);
      if (shownRef.current === id) {
        const prevLen = messageCount.current;
        const nextLen = result.open.messages.length;
        setLive(result.open);
        setTyping(result.open.typing ?? []);
        messageCount.current = nextLen;
        if (!stick.current && nextLen > prevLen) {
          setAway(true);
          setMissed((count) => count + (nextLen - prevLen));
        }
      }
      if (markRead) setRows((current) => current.map((row) => (row.id === id ? { ...row, unread: 0 } : row)));
    } finally {
      pulling.current = false;
    }
  }

  function warm(id) {
    const cached = id ? cacheRef.current.get(id) : null;
    if (!id || authGone.current || id === shownRef.current || (cached && !cached.partial)) return;
    void loadThreadAction(id, false).then((result) => {
      if (result?.auth) {
        handleAuthLost();
        return;
      }
      if (!result?.ok) return;
      cacheRef.current.set(id, result.open);
      if (shownRef.current === id && hold.current === 0) setLive(result.open);
    });
  }

  function begin() {
    hold.current += 1;
    pullSeq.current += 1;
  }

  function finishMutation(id, result) {
    hold.current = Math.max(0, hold.current - 1);
    if (!result?.ok) setNote(result?.message ?? "İşlem tamamlanamadı.");
    if (id) void pull(id, true);
  }

  function patchOpen(recipe) {
    setLive((current) => {
      if (!current) return current;
      const next = recipe(current);
      cacheRef.current.set(next.id, next);
      return next;
    });
  }

  useEffect(() => {
    const id = shownRef.current;
    if (id) void pull(id, true);
  }, []);

  useEffect(() => {
    const ids = data.threads.slice(0, 8).map((thread) => thread.id);
    const timers = ids.map((id, index) => window.setTimeout(() => warm(id), 400 + index * 250));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [data.threads]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || hold.current > 0 || authGone.current) return;
      const id = shownRef.current;
      if (id) void pull(id, true);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshQuiet(router);
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);

  useEffect(() => {
    if (!emojiOpen && !attachOpen && !menuFor && !reactFor && !sideMenuOpen && !chatMenuOpen && !filterMenuOpen && !threadMenuFor) return undefined;
    function close(event) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-chat-pop]")) return;
      setEmojiOpen(false);
      setAttachOpen(false);
      setMenuFor(null);
      setReactFor(null);
      setSideMenuOpen(false);
      setChatMenuOpen(false);
      setFilterMenuOpen(false);
      setThreadMenuFor(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [emojiOpen, attachOpen, menuFor, reactFor, sideMenuOpen, chatMenuOpen, filterMenuOpen, threadMenuFor]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    stick.current = true;
    setAway(false);
    setMissed(0);
    messageCount.current = open?.messages?.length ?? 0;
  }, [openId]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !stick.current) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [open?.messages.length]);

  useEffect(() => {
    if (!recording) return undefined;
    recordTick.current = window.setInterval(() => {
      setRecordElapsed(Math.floor((Date.now() - recording.startedAt) / 1000));
    }, 250);
    return () => clearInterval(recordTick.current);
  }, [recording]);

  const needle = query.trim().toLocaleLowerCase("tr");
  const enrichedRows = useMemo(() => rows.map((thread) => {
    const until = muteUntil[thread.id];
    const muted = thread.muted || (until && until > Date.now());
    return {
      ...thread,
      muted: Boolean(muted),
      archived: archived.has(thread.id),
      typingPreview: openId === thread.id && typing.length > 0,
    };
  }), [rows, muteUntil, archived, openId, typing]);
  const threads = useMemo(() => enrichedRows.filter((thread) => {
    if (filter === "archived") {
      if (!thread.archived) return false;
    } else if (thread.archived) {
      return false;
    }
    if (filter === "groups" || filter === "channels") {
      if (thread.kind !== "GROUP") return false;
    }
    if (filter === "dm" && thread.kind !== "DIRECT") return false;
    if (filter === "unread" && thread.unread <= 0 && thread.id !== openId) return false;
    if (!needle) return true;
    return (data.searchText[thread.id] ?? thread.title).toLocaleLowerCase("tr").includes(needle);
  }), [enrichedRows, data.searchText, filter, needle, openId]);
  const pinned = threads.filter((thread) => thread.pinned);
  const rest = threads.filter((thread) => !thread.pinned);
  const canSend = Boolean(body.trim() || files.length > 0);
  const mentionNames = open?.members.map((member) => member.name) ?? [];
  const visibleMessages = useMemo(() => {
    const list = (open?.messages ?? []).filter((message) => !hiddenMsgs.has(message.id));
    return list;
  }, [open?.messages, hiddenMsgs]);
  const searchHits = useMemo(() => {
    const q = threadSearch.trim().toLocaleLowerCase("tr");
    if (!q) return [];
    return visibleMessages.filter((message) => !message.deleted && (
      message.body.toLocaleLowerCase("tr").includes(q)
      || message.authorName.toLocaleLowerCase("tr").includes(q)
    ));
  }, [visibleMessages, threadSearch]);
  const typingLabel = typing.length === 0
    ? ""
    : typing.length === 1
      ? `${typing[0].name} yazıyor...`
      : "birkaç kişi yazıyor...";
  const listTypingLabel = typing.length > 0 ? "yazıyor..." : "";

  const persistStarred = useEffectEvent((next) => {
    setStarred(next);
    writeSet(prefsKey(data.viewerId, "starred"), next);
  });
  const persistHidden = useEffectEvent((next) => {
    setHiddenMsgs(next);
    writeSet(prefsKey(data.viewerId, "hidden"), next);
  });
  const persistArchived = useEffectEvent((next) => {
    setArchived(next);
    writeSet(prefsKey(data.viewerId, "archived"), next);
  });
  const persistMuteUntil = useEffectEvent((next) => {
    setMuteUntil(next);
    writeMap(prefsKey(data.viewerId, "muteUntil"), next);
  });

  useEffect(() => {
    const field = composerRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 128)}px`;
  }, [body]);

  function openThread(id) {
    if (id === shownRef.current) {
      setInfo((value) => !value);
      return;
    }
    setInfo(false);
    setReply(null);
    setMenuFor(null);
    setReactFor(null);
    setEmojiOpen(false);
    setAttachOpen(false);
    setEditing(null);
    setThreadSearch("");
    setThreadSearchOpen(false);
    setShownId(id);
    const row = rows.find((item) => item.id === id);
    setLive(cacheRef.current.get(id) ?? shellThread(row, id));
    setRows((current) => current.map((item) => (item.id === id ? { ...item, unread: 0 } : item)));
    startTransition(() => router.replace(`/flywork-chat?sohbet=${id}`, { scroll: false }));
    void pull(id, true);
  }

  function toggleReaction(messageId, emoji) {
    const threadId = shownRef.current;
    begin();
    patchOpen((current) => ({
      ...current,
      messages: current.messages.map((message) => (message.id === messageId ? { ...message, reactions: toggleGrouped(message.reactions, emoji, data.profile?.name ?? "") } : message)),
    }));
    setMenuFor(null);
    void reactChatAction({ messageId, emoji }).then((result) => finishMutation(threadId, result));
  }

  function saveEdit(messageId) {
    const threadId = shownRef.current;
    const nextBody = draft.trim();
    if (!nextBody) return;
    begin();
    patchOpen((current) => ({
      ...current,
      messages: current.messages.map((message) => (message.id === messageId ? { ...message, body: nextBody, edited: true } : message)),
    }));
    setEditing(null);
    void editChatAction({ messageId, body: nextBody }).then((result) => finishMutation(threadId, result));
  }

  function removeMessageEveryone(messageId) {
    if (!window.confirm("Bu mesaj herkesten silinsin mi?")) return;
    const threadId = shownRef.current;
    begin();
    patchOpen((current) => ({
      ...current,
      messages: current.messages.filter((message) => message.id !== messageId),
      pins: current.pins.filter((pin) => pin.id !== messageId),
    }));
    void deleteChatAction(messageId).then((result) => finishMutation(threadId, result));
  }

  function removeMessageMine(messageId) {
    const next = new Set(hiddenMsgs);
    next.add(messageId);
    persistHidden(next);
    setMenuFor(null);
    setDeleteFor(null);
  }

  function toggleStar(messageId) {
    const next = new Set(starred);
    if (next.has(messageId)) next.delete(messageId);
    else next.add(messageId);
    persistStarred(next);
    setMenuFor(null);
  }

  function copyMessage(message) {
    const text = message.body || message.attachments?.[0]?.fileName || "";
    void navigator.clipboard?.writeText(text).then(() => setToast("Mesaj kopyalandı"));
    setMenuFor(null);
  }

  function jumpBottom() {
    const node = scroller.current;
    if (!node) return;
    stick.current = true;
    setAway(false);
    setMissed(0);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  function jumpToMessage(id) {
    const node = messageRefs.current.get(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("ring-2", "ring-[#00a884]");
    window.setTimeout(() => node.classList.remove("ring-2", "ring-[#00a884]"), 1200);
  }

  function signalTyping() {
    const id = shownRef.current;
    if (!id) return;
    void setTypingAction(id, true);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void setTypingAction(id, false);
    }, 2500);
  }

  function flagThread(threadId, field, value) {
    let next = value;
    begin();
    if (threadId === shownRef.current) {
      patchOpen((current) => {
        next = typeof value === "boolean" ? value : !current[field];
        return { ...current, [field]: next };
      });
    } else {
      next = typeof value === "boolean" ? value : !rows.find((row) => row.id === threadId)?.[field];
    }
    setRows((current) => current.map((row) => (row.id === threadId ? { ...row, [field]: next } : row)));
    void setChatFlagsAction({ threadId, [field]: next }).then((result) => finishMutation(threadId, result));
  }

  function muteThread(threadId, duration) {
    const until = duration === "8h"
      ? Date.now() + 8 * 60 * 60 * 1000
      : duration === "1w"
        ? Date.now() + 7 * 24 * 60 * 60 * 1000
        : Number.MAX_SAFE_INTEGER;
    persistMuteUntil({ ...muteUntil, [threadId]: until });
    flagThread(threadId, "muted", true);
  }

  function unmuteThread(threadId) {
    const next = { ...muteUntil };
    delete next[threadId];
    persistMuteUntil(next);
    flagThread(threadId, "muted", false);
  }

  function markThreadRead(threadId, unread) {
    if (unread) {
      setRows((current) => current.map((row) => (row.id === threadId ? { ...row, unread: Math.max(1, row.unread || 1) } : row)));
      void setChatFlagsAction({ threadId, markUnread: true });
      return;
    }
    setRows((current) => current.map((row) => (row.id === threadId ? { ...row, unread: 0 } : row)));
    void pull(threadId, true);
  }

  function toggleArchive(threadId) {
    const next = new Set(archived);
    if (next.has(threadId)) next.delete(threadId);
    else next.add(threadId);
    persistArchived(next);
  }

  async function forwardTo(threadId) {
    if (!forwardMsg) return;
    const form = new FormData();
    form.set("threadId", threadId);
    form.set("body", forwardMsg.body?.trim() ? `↪ ${forwardMsg.authorName}: ${forwardMsg.body}` : `↪ ${forwardMsg.authorName}: [medya]`);
    setForwardMsg(null);
    setToast("Mesaj iletildi");
    const result = await sendChatAction(form);
    if (!result?.ok) setNote(result?.message ?? "İletilemedi.");
    else if (threadId === shownRef.current) void pull(threadId, true);
  }

  async function startRecording() {
    if (recording || !navigator.mediaDevices?.getUserMedia) {
      setToast("Mikrofon kullanılamıyor");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunks.current.push(event.data);
      };
      recorder.start();
      mediaRecorder.current = recorder;
      setRecordElapsed(0);
      setRecording({ startedAt: Date.now(), stream });
    } catch {
      setToast("Mikrofon izni gerekli");
    }
  }

  function cancelRecording() {
    const recorder = mediaRecorder.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recording?.stream?.getTracks().forEach((track) => track.stop());
    mediaRecorder.current = null;
    recordChunks.current = [];
    setRecording(null);
    setRecordElapsed(0);
  }

  async function sendRecording() {
    const recorder = mediaRecorder.current;
    if (!recorder || !open) return;
    const stream = recording?.stream;
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(recordChunks.current, { type: "audio/webm" }));
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(new Blob(recordChunks.current, { type: "audio/webm" }));
    });
    stream?.getTracks().forEach((track) => track.stop());
    mediaRecorder.current = null;
    setRecording(null);
    setRecordElapsed(0);
    if (blob.size < 200) {
      setToast("Kayıt çok kısa");
      return;
    }
    const file = new File([blob], `ses-${Date.now()}.webm`, { type: "audio/webm" });
    const entry = { id: `audio-${file.name}`, file, kind: "audio", name: file.name, url: URL.createObjectURL(blob) };
    void send({ body: "", files: [entry], reply: null });
  }

  function shareContact(person) {
    setModal(null);
    void send({ body: `${CONTACT_PREFIX}${person.name}`, files: [], reply: null });
  }

  function togglePin(message) {
    const threadId = shownRef.current;
    begin();
    patchOpen((current) => {
      const exists = current.pins.some((pin) => pin.id === message.id);
      const pins = exists
        ? current.pins.filter((pin) => pin.id !== message.id)
        : [{ id: message.id, authorName: message.authorName, body: message.body.replace(/\s+/g, " ").slice(0, 140), time: message.time }, ...current.pins].slice(0, 5);
      return { ...current, pins };
    });
    void pinMessageAction(message.id).then((result) => finishMutation(threadId, result));
  }

  function toggleFlag(field) {
    const threadId = shownRef.current;
    let next = false;
    begin();
    patchOpen((current) => {
      next = !current[field];
      return { ...current, [field]: next };
    });
    setRows((current) => current.map((row) => (row.id === threadId ? { ...row, [field]: next } : row)));
    void setChatFlagsAction({ threadId, [field]: next }).then((result) => finishMutation(threadId, result));
  }

  function removeThread(thread) {
    const question = thread.system
      ? "Genel ekip kanalındaki mesajlar silinsin mi? Kanal boş olarak durur."
      : thread.kind === "GROUP"
        ? "Bu grup sohbeti silinsin mi?"
        : "Bu sohbet silinsin mi?";
    if (!window.confirm(question)) return;
    void run(() => deleteThreadAction(thread.id)).then((result) => {
      if (result && thread.id === openId) {
        setInfo(false);
        router.push("/flywork-chat");
      }
    });
  }

  function addFiles(list, kind) {
    addMixed(list.map((file) => ({ file, kind })), []);
  }

  function addMixed(entries, rejected) {
    const room = Math.max(0, 6 - files.length);
    const taken = entries.slice(0, room);
    if (rejected.length > 0) setNote(`Eklenmedi: ${rejected.join(", ")}`);
    else if (entries.length > room) setNote("Bir mesaja en fazla 6 dosya eklenebilir.");
    else setNote("");
    setAttachOpen(false);
    setDragging(false);
    setFiles((current) => {
      const next = [...current];
      for (const entry of taken) {
        if (next.length >= 6) break;
        next.push({
          id: `${entry.kind}-${entry.file.name}-${entry.file.size}-${next.length}`,
          file: entry.file,
          kind: entry.kind,
          name: entry.file.name,
          url: entry.kind === "image" || entry.kind === "video" || entry.kind === "audio" ? URL.createObjectURL(entry.file) : "",
        });
      }
      return next;
    });
  }

  function addDropped(fileList) {
    const entries = [];
    const rejected = [];
    for (const file of fileList) {
      const kind = fileKind(file);
      if (!kind) rejected.push(file.name);
      else entries.push({ file, kind });
    }
    if (entries.length === 0 && rejected.length === 0) return;
    addMixed(entries, rejected);
  }

  function hasDragFiles(event) {
    const types = event.dataTransfer?.types;
    return Boolean(types && [...types].includes("Files"));
  }

  function onDragEnter(event) {
    if (!hasDragFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(event) {
    if (!hasDragFiles(event)) return;
    event.preventDefault();
  }

  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addDropped([...event.dataTransfer.files]);
  }

  function insertMention(name) {
    const field = composerRef.current;
    const cursor = field?.selectionStart ?? caret;
    const found = mentionAt(body, cursor);
    if (!found) return;
    const next = `${body.slice(0, found.start)}@${name} ${body.slice(cursor)}`;
    const nextCaret = found.start + name.length + 2;
    setBody(next);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function onComposerKeyDown(event) {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((activeMention + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((activeMention - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        insertMention(suggestions[activeMention].name);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const cursor = composerRef.current?.selectionStart ?? caret;
        const found = mentionAt(body, cursor);
        if (!found) return;
        const next = `${body.slice(0, found.start)}${body.slice(cursor)}`;
        setBody(next);
        setCaret(found.start);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function dropFile(id) {
    setFiles((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return current.filter((entry) => entry.id !== id);
    });
  }

  async function send(overrides = {}) {
    if (!open || sending.current) return;
    const text = overrides.body ?? body;
    const outgoing = overrides.files ?? files;
    const quote = overrides.reply !== undefined ? overrides.reply : reply;
    if (!text.trim() && outgoing.length === 0) return;
    const threadId = open.id;
    const localId = `local-${Date.now()}`;
    sending.current = true;
    begin();
    stick.current = true;
    setAway(false);
    setMissed(0);
    const previewLabel = text.trim()
      || (outgoing.some((item) => item.kind === "audio") ? "Sesli mesaj"
        : outgoing.some((item) => item.kind === "video") ? "Video"
          : outgoing.some((item) => item.kind === "image") ? "Görsel"
            : "Dosya");
    patchOpen((current) => ({
      ...current,
      messages: [...current.messages, {
        id: localId,
        authorId: data.viewerId,
        authorName: data.profile?.name ?? "",
        mine: true,
        body: text.trim(),
        deleted: false,
        edited: false,
        time: localClock(),
        dayKey: data.today,
        reply: quote ? { authorName: quote.authorName, body: quote.body } : null,
        attachments: outgoing.map((item) => ({
          id: item.id,
          contentType: item.kind === "image"
            ? "image/jpeg"
            : item.kind === "audio"
              ? "audio/webm"
              : item.kind === "video"
                ? "video/mp4"
                : "application/octet-stream",
          fileName: item.name,
          size: "",
          localUrl: item.url,
        })),
        reactions: [],
        mentions: [],
        read: false,
      }],
    }));
    messageCount.current += 1;
    setRows((current) => current.map((row) => (row.id === threadId ? { ...row, preview: previewLabel, time: localClock(), unread: 0 } : row)));
    setBody("");
    setFiles([]);
    setReply(null);
    setEmojiOpen(false);
    setAttachOpen(false);
    setNote("");
    void setTypingAction(threadId, false);
    const form = new FormData();
    form.set("threadId", threadId);
    form.set("body", text);
    if (quote) form.set("replyToId", quote.id);
    for (const item of outgoing) {
      const field = item.kind === "file" ? "file" : item.kind === "audio" ? "audio" : item.kind === "video" ? "video" : "image";
      form.append(field, item.file);
    }
    const result = await sendChatAction(form);
    sending.current = false;
    if (!result.ok) {
      setBody(text);
      setFiles(outgoing);
      setReply(quote);
      patchOpen((current) => ({ ...current, messages: current.messages.filter((message) => message.id !== localId) }));
      messageCount.current = Math.max(0, messageCount.current - 1);
    } else {
      for (const item of outgoing) if (item.url) URL.revokeObjectURL(item.url);
    }
    finishMutation(threadId, result);
  }

  function run(action) {
    const resultPromise = Promise.resolve().then(action);
    void resultPromise.then((result) => {
      if (!result?.ok) setNote(result?.message ?? "İşlem tamamlanamadı.");
      else {
        setNote("");
        refreshQuiet(router);
      }
    });
    return resultPromise;
  }

  function onScroll() {
    const node = scroller.current;
    if (!node) return;
    const near = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    stick.current = near;
    if (near) {
      setAway(false);
      setMissed(0);
    } else {
      setAway(true);
    }
  }

  function onBodyChange(event) {
    setBody(event.target.value);
    setCaret(event.target.selectionStart ?? 0);
    if (event.target.value.trim()) signalTyping();
  }

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:-mx-6 sm:-my-4 lg:-mx-8">
      <div className="relative flex min-h-0 flex-1 overflow-hidden border border-slate-200 bg-white">
        <aside className={`${open ? "hidden xl:flex" : "flex"} h-full w-full min-w-0 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-[320px] xl:min-w-[320px] xl:max-w-[340px]`}>
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-r border-slate-200 bg-[#f0f2f5] px-4">
            <button
              type="button"
              title="Profilim"
              className="rounded-full"
              onClick={() => { setBioDraft((profileView ?? data.profile)?.bio ?? ""); setProfileFile(null); setProfilePreview(""); setDropPhoto(false); setModal("profile"); setNote(""); }}
            >
              <Avatar name={(profileView ?? data.profile)?.name ?? ""} src={(profileView ?? data.profile)?.image ?? ""} size="h-10 w-10" />
            </button>
            <div className="relative flex items-center gap-1" data-chat-pop="">
              <button
                type="button"
                aria-label="Yeni sohbet"
                className="grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-black/5"
                onClick={() => { setModal("pick"); setPicked([]); setGroupTitle(""); setGroupTopic(""); setNote(""); }}
              >
                <MessageCircle size={20} />
              </button>
              <button
                type="button"
                aria-label="Menü"
                aria-expanded={sideMenuOpen}
                className="grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-black/5"
                onClick={() => setSideMenuOpen((value) => !value)}
              >
                <MoreVertical size={20} />
              </button>
              {sideMenuOpen ? (
                <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-md bg-white py-2 shadow-lg ring-1 ring-black/5">
                  <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setSideMenuOpen(false); setModal("pick"); setPicked([]); setGroupTitle(""); setGroupTopic(""); setNote(""); }}>Yeni sohbet</button>
                  <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setSideMenuOpen(false); setFilter("all"); }}>Tüm sohbetler</button>
                  <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setSideMenuOpen(false); setFilter("groups"); }}>Kanallar / Gruplar</button>
                  <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setSideMenuOpen(false); setFilter("dm"); }}>Direkt mesajlar</button>
                  <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setSideMenuOpen(false); setBioDraft((profileView ?? data.profile)?.bio ?? ""); setProfileFile(null); setProfilePreview(""); setDropPhoto(false); setModal("profile"); setNote(""); }}>Profil</button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ara veya yeni sohbet başlat"
                className="w-full rounded-lg bg-[#f0f2f5] py-1.5 pl-9 pr-4 text-xs text-slate-700 outline-none placeholder:text-slate-400"
                aria-label="Mesajlarda ara"
              />
            </div>
            <div className="relative" data-chat-pop="">
              <button
                type="button"
                title="Sohbet filtreleri"
                aria-pressed={filter !== "all"}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${filter !== "all" ? "bg-[#00a884]/15 text-[#008f6f]" : "text-slate-500 hover:bg-slate-100"}`}
                onClick={() => setFilterMenuOpen((value) => !value)}
              >
                <ListFilter size={18} />
              </button>
              <ListFilterMenu
                open={filterMenuOpen}
                value={filter === "channels" ? "groups" : filter}
                onChange={(next) => { setFilter(next); setFilterMenuOpen(false); }}
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
            {pinned.length > 0 ? <p className="bg-[#f0f2f5] px-4 py-1.5 text-[11px] font-medium text-slate-500">Sabitlenenler</p> : null}
            {pinned.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === openId}
                typing={thread.id === openId ? listTypingLabel : ""}
                menuOpen={threadMenuFor === thread.id}
                onOpen={openThread}
                onMenu={() => setThreadMenuFor(threadMenuFor === thread.id ? null : thread.id)}
                onWarm={warm}
              >
                <ThreadActionsMenu
                  open={threadMenuFor === thread.id}
                  thread={thread}
                  onPin={() => flagThread(thread.id, "pinned")}
                  onMarkRead={() => markThreadRead(thread.id, thread.unread <= 0)}
                  onMutePick={(duration) => (duration === "off" ? unmuteThread(thread.id) : muteThread(thread.id, duration))}
                  onArchive={() => toggleArchive(thread.id)}
                  onDelete={() => removeThread(thread)}
                  onClose={() => setThreadMenuFor(null)}
                />
              </ThreadRow>
            ))}
            {rest.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Sohbet bulunamadı.</p>
            ) : rest.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === openId}
                typing={thread.id === openId ? listTypingLabel : ""}
                menuOpen={threadMenuFor === thread.id}
                onOpen={openThread}
                onMenu={() => setThreadMenuFor(threadMenuFor === thread.id ? null : thread.id)}
                onWarm={warm}
              >
                <ThreadActionsMenu
                  open={threadMenuFor === thread.id}
                  thread={thread}
                  onPin={() => flagThread(thread.id, "pinned")}
                  onMarkRead={() => markThreadRead(thread.id, thread.unread <= 0)}
                  onMutePick={(duration) => (duration === "off" ? unmuteThread(thread.id) : muteThread(thread.id, duration))}
                  onArchive={() => toggleArchive(thread.id)}
                  onDelete={() => removeThread(thread)}
                  onClose={() => setThreadMenuFor(null)}
                />
              </ThreadRow>
            ))}
            <div className="min-h-0 flex-1 bg-white" aria-hidden="true" />
          </div>
        </aside>
        <section
          className={`${open ? "flex" : "hidden xl:flex"} relative min-h-0 min-w-0 flex-1 flex-col bg-[#efeae2]`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center border-2 border-dashed border-[#00a884] bg-[#00a884]/10">
              <p className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#008f6f] shadow">Görsel veya dosyayı bırak</p>
            </div>
          ) : null}
          {open ? (
            <>
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-[#f0f2f5] px-4">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setInfo(true)}>
                  <Avatar name={open.title} src={open.image} size="h-10 w-10" online={open.kind === "DIRECT" && (open.online > 1 || open.members.some((member) => member.online && member.userId !== data.viewerId))} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{open.title}</span>
                    <span className={`block truncate text-xs ${typingLabel ? "text-[#008f6f]" : "text-slate-500"}`}>
                      {typingLabel || (open.kind === "GROUP"
                        ? `${open.memberCount} üye · ${open.online} çevrimiçi`
                        : open.online > 1 || open.members.some((member) => member.online && member.userId !== data.viewerId)
                          ? "çevrimiçi"
                          : "son görülme bilinmiyor")}
                    </span>
                  </span>
                </button>
                <div className="relative flex items-center gap-1" data-chat-pop="">
                  <button
                    type="button"
                    className={`grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-black/5 ${threadSearchOpen ? "bg-black/5" : ""}`}
                    aria-label="Sohbette ara"
                    onClick={() => setThreadSearchOpen((value) => !value)}
                  >
                    <Search size={20} />
                  </button>
                  <button
                    type="button"
                    aria-label="Menü"
                    aria-expanded={chatMenuOpen}
                    className="grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-black/5"
                    onClick={() => setChatMenuOpen((value) => !value)}
                  >
                    <MoreVertical size={20} />
                  </button>
                  {chatMenuOpen ? (
                    <div className="absolute right-0 top-11 z-30 w-48 overflow-hidden rounded-md bg-white py-2 shadow-lg ring-1 ring-black/5">
                      <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setChatMenuOpen(false); setInfo(true); }}>Sohbet bilgisi</button>
                      <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setChatMenuOpen(false); toggleFlag("pinned"); }}>{open.pinned ? "Sabiti kaldır" : "Sohbeti sabitle"}</button>
                      <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setChatMenuOpen(false); toggleFlag("muted"); }}>{open.muted ? "Sesi aç" : "Sessize al"}</button>
                      <button type="button" className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => { setChatMenuOpen(false); removeThread(data.threads.find((thread) => thread.id === open.id) ?? { id: open.id, kind: open.kind, system: open.system }); }}>Sohbeti sil</button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="relative min-h-0 flex-1">
              <div
                ref={scroller}
                onScroll={onScroll}
                className="h-full space-y-1.5 overflow-y-auto px-4 py-3 sm:px-12 lg:px-16"
                style={{ backgroundImage: "linear-gradient(rgba(239,234,226,0.92), rgba(239,234,226,0.92))" }}
              >
                {visibleMessages.map((message, index) => {
                  const previous = visibleMessages[index - 1];
                  const showDay = !previous || previous.dayKey !== message.dayKey;
                  const contactName = parseContact(message.body);
                  const contactPerson = contactName ? data.people.find((person) => person.name === contactName) : null;
                  return (
                    <div
                      key={message.id}
                      ref={(node) => {
                        if (node) messageRefs.current.set(message.id, node);
                        else messageRefs.current.delete(message.id);
                      }}
                    >
                      {showDay ? <DayDivider label={dayHeading(message.dayKey, data.today)} /> : null}
                      <article className={`group flex ${message.mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`relative max-w-[65%] overflow-visible rounded-lg px-3 py-1.5 text-slate-900 ${WA_SHADOW} ${message.mine ? "ml-auto rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"}`}
                          onDoubleClick={() => {
                            if (message.deleted || editing === message.id) return;
                            setMenuFor(null);
                            setReactFor((current) => (current === message.id ? null : message.id));
                          }}
                        >
                          {!message.deleted ? (
                            <div
                              data-chat-pop=""
                              className={`absolute -top-2 z-10 ${message.mine ? "left-1" : "right-1"} ${menuFor === message.id || reactFor === message.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                            >
                              <button
                                type="button"
                                aria-label="Mesaj işlemleri"
                                aria-expanded={menuFor === message.id}
                                className="grid h-6 w-6 place-items-center rounded-full bg-white text-slate-500 shadow ring-1 ring-black/5 hover:text-slate-700"
                                onClick={() => {
                                  setReactFor(null);
                                  setMenuFor(menuFor === message.id ? null : message.id);
                                }}
                              >
                                <ChevronDown size={14} className={menuFor === message.id ? "rotate-180 transition-transform" : "transition-transform"} />
                              </button>
                              <MessageMenu
                                mine={message.mine}
                                open={menuFor === message.id}
                                starred={starred.has(message.id)}
                                onReply={() => { setReply({ id: message.id, authorName: message.authorName, body: message.body.slice(0, 80) || "[medya]" }); setMenuFor(null); }}
                                onReact={() => { setMenuFor(null); setReactFor(message.id); }}
                                onCopy={() => copyMessage(message)}
                                onForward={() => { setForwardMsg(message); setMenuFor(null); }}
                                onStar={() => toggleStar(message.id)}
                                onDeleteMine={() => removeMessageMine(message.id)}
                                onDeleteEveryone={() => { removeMessageEveryone(message.id); setMenuFor(null); }}
                                onClose={() => setMenuFor(null)}
                              />
                            </div>
                          ) : null}
                          {starred.has(message.id) ? (
                            <span className={`absolute -bottom-1 ${message.mine ? "left-1" : "right-1"}`}>
                              <StarBadge />
                            </span>
                          ) : null}
                          {open.kind === "GROUP" && !message.mine && !message.deleted ? (
                            <p className="mb-0.5 text-xs font-semibold text-emerald-600">{message.authorName}</p>
                          ) : null}
                          {message.reply ? (
                            <div className="mb-1.5 rounded border-l-4 border-emerald-500 bg-slate-50/80 p-1.5 text-xs text-slate-600">
                              <p className="font-semibold text-emerald-700">{message.reply.authorName}</p>
                              <p className="truncate">{message.reply.body}</p>
                            </div>
                          ) : null}
                          {editing === message.id ? (
                            <form onSubmit={(event) => { event.preventDefault(); saveEdit(message.id); }}>
                              <input value={draft} onChange={(event) => setDraft(event.target.value)} className="field" aria-label="Mesajı düzenle" />
                              <div className="mt-1 flex gap-2">
                                <button type="submit" className="text-xs font-semibold text-[#008f6f]">Kaydet</button>
                                <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => setEditing(null)}>Vazgeç</button>
                              </div>
                            </form>
                          ) : message.deleted ? (
                            <p className="text-sm italic text-slate-400">Bu mesaj silindi</p>
                          ) : contactName ? (
                            <div>
                              <ContactCard
                                name={contactName}
                                image={contactPerson?.image ?? ""}
                                onOpen={() => {
                                  if (contactPerson) void run(() => openDirectAction(contactPerson.id)).then((result) => { if (result?.id) openThread(result.id); });
                                }}
                              />
                              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                                <span>{message.time}</span>
                                {message.mine ? <CheckCheck size={14} className={message.read ? "text-sky-500" : "text-slate-400"} /> : null}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-end gap-2">
                              {message.body ? (
                                <p className="inline-block min-w-0 max-w-full flex-1 break-words whitespace-pre-wrap text-[14.2px] leading-[19px] text-slate-900">
                                  {highlight(message.body, mentionNames, false)}
                                </p>
                              ) : null}
                              <span className="ml-2 inline-flex shrink-0 items-center gap-1 pb-px text-[11px] leading-none text-slate-500">
                                {message.edited ? <span>düzenlendi</span> : null}
                                {starred.has(message.id) ? <Star size={11} className="fill-amber-400 text-amber-400" /> : null}
                                <span>{message.time}</span>
                                {message.mine ? <CheckCheck size={14} className={message.read ? "text-sky-500" : "text-slate-400"} /> : null}
                              </span>
                            </div>
                          )}
                          {message.attachments.map((file) => {
                            const url = file.localUrl || `/api/sohbet-dosya/${file.id}`;
                            if (file.contentType.startsWith("image/")) {
                              return (
                                <button
                                  key={file.id}
                                  type="button"
                                  className="mt-1 block"
                                  onClick={() => setLightbox({ url, name: file.fileName, video: false })}
                                >
                                  <img src={url} alt="" className="max-h-56 rounded-md object-cover" />
                                </button>
                              );
                            }
                            if (file.contentType.startsWith("video/")) {
                              return (
                                <button
                                  key={file.id}
                                  type="button"
                                  className="mt-1 block"
                                  onClick={() => setLightbox({ url, name: file.fileName, video: true })}
                                >
                                  <video src={url} className="max-h-56 rounded-md" muted />
                                </button>
                              );
                            }
                            if (file.contentType.startsWith("audio/")) {
                              return <VoiceBubble key={file.id} src={url} mine={message.mine} />;
                            }
                            return (
                              <a key={file.id} href={url} download={file.fileName} className="mt-1 flex items-center gap-2 rounded-md bg-white/70 px-3 py-2">
                                <FileText size={18} className="text-red-600" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-slate-800">{file.fileName}</span>
                                  <span className="block text-xs text-slate-400">{file.size || "Belge"}</span>
                                </span>
                              </a>
                            );
                          })}
                          {message.reactions.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {message.reactions.map((reaction) => (
                                <button
                                  key={reaction.emoji}
                                  type="button"
                                  title={reaction.names.join(", ")}
                                  onClick={() => toggleReaction(message.id, reaction.emoji)}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${reaction.mine ? "border-[#25d366]/40 bg-[#25d366]/10" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                                >
                                  {reaction.emoji} {reaction.count}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <ReactBar
                            open={reactFor === message.id}
                            onPick={(emoji) => {
                              toggleReaction(message.id, emoji);
                              setReactFor(null);
                            }}
                          />
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
              {away ? <JumpDown count={missed} onClick={jumpBottom} /> : null}
              <ThreadSearchPanel
                open={threadSearchOpen}
                query={threadSearch}
                onQuery={setThreadSearch}
                hits={searchHits}
                onJump={(id) => { jumpToMessage(id); setThreadSearchOpen(false); }}
                onClose={() => { setThreadSearchOpen(false); setThreadSearch(""); }}
              />
              </div>
              <div className="mt-auto shrink-0 border-t border-slate-200 bg-[#f0f2f5] p-3">
                {note ? <p className="mb-2 text-sm text-red-700">{note}</p> : null}
                {reply ? (
                  <div className="mb-2 flex items-center justify-between rounded-lg border-l-4 border-emerald-500 bg-white px-3 py-2 text-sm">
                    <p className="truncate text-slate-600"><span className="font-semibold text-emerald-700">{reply.authorName}</span> {reply.body}</p>
                    <button type="button" aria-label="Yanıtı kaldır" onClick={() => setReply(null)}><X size={14} /></button>
                  </div>
                ) : null}
                {files.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {files.map((item) => (
                      <span key={item.id} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1">
                        {item.url && item.kind === "image" ? <img src={item.url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="max-w-32 truncate px-2 text-xs font-semibold">{item.name}</span>}
                        <button type="button" className="pr-1 text-xs text-slate-500" onClick={() => dropFile(item.id)}>Kaldır</button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {recording ? (
                  <VoiceComposer elapsed={recordElapsed} onCancel={cancelRecording} onSend={() => void sendRecording()} />
                ) : (
                <div className="relative flex items-end gap-3">
                  {suggestions.length > 0 ? (
                    <ul role="listbox" aria-label="Etiket önerileri" className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                      {suggestions.map((person, index) => {
                        const active = index === activeMention;
                        return (
                          <li key={person.userId} role="option" aria-selected={active}>
                            <button
                              type="button"
                              className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm ${active ? "bg-[#00a884] text-white" : "hover:bg-slate-50"}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setMentionIndex(index)}
                              onClick={() => insertMention(person.name)}
                            >
                              {person.everyone ? (
                                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${active ? "bg-white/20" : "bg-[#00a884] text-white"}`}><Users size={14} /></span>
                              ) : (
                                <Avatar name={person.name} src={person.image} size="h-8 w-8" />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{person.everyone ? "@Herkes" : person.name}</span>
                                {person.everyone ? <span className={`block text-xs ${active ? "text-white/80" : "text-slate-500"}`}>Sohbetteki herkes</span> : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <div className="relative flex shrink-0 items-center gap-1 pb-0.5" data-chat-pop="">
                    <div className="relative">
                      <button type="button" aria-label="Emoji" className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-black/5" onClick={() => { setAttachOpen(false); setEmojiOpen((value) => !value); }}>
                        <Smile size={22} />
                      </button>
                      {emojiOpen ? (
                        <div className="absolute bottom-12 left-0 z-10 flex w-48 flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                          {COMMENT_EMOJIS.map((emoji) => (
                            <button key={emoji} type="button" className="rounded-lg px-1.5 py-0.5 text-lg hover:bg-slate-50" onClick={() => { setBody((current) => `${current}${emoji}`); setEmojiOpen(false); }}>{emoji}</button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="relative">
                      <button type="button" aria-label="Dosya veya görsel ekle" className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-black/5" onClick={() => { setEmojiOpen(false); setAttachOpen((value) => !value); }}>
                        <Paperclip size={20} />
                      </button>
                      <AttachDrawer
                        open={attachOpen}
                        onPhotos={() => { setAttachOpen(false); videoRef.current?.click(); }}
                        onDocs={() => { setAttachOpen(false); fileRef.current?.click(); }}
                        onContact={() => { setAttachOpen(false); setModal("contact"); setNote(""); }}
                      />
                    </div>
                  </div>
                  <textarea
                    ref={composerRef}
                    value={body}
                    rows={1}
                    placeholder="Bir mesaj yazın"
                    aria-label="Mesaj"
                    aria-expanded={suggestions.length > 0}
                    className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border border-transparent bg-white px-4 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-300"
                    onChange={onBodyChange}
                    onSelect={(event) => setCaret(event.target.selectionStart ?? 0)}
                    onKeyDown={onComposerKeyDown}
                  />
                  {canSend ? (
                    <button
                      type="button"
                      aria-label="Gönder"
                      disabled={pending}
                      onClick={() => void send()}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition-all hover:bg-[#008f6f] disabled:opacity-50"
                    >
                      <Send size={18} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Sesli mesaj kaydet"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-black/5"
                      onClick={() => void startRecording()}
                    >
                      <Mic size={22} />
                    </button>
                  )}
                  <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { addFiles([...(event.target.files ?? [])], "image"); event.target.value = ""; }} />
                  <input ref={videoRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple className="sr-only" onChange={(event) => {
                    const list = [...(event.target.files ?? [])];
                    const entries = [];
                    const rejected = [];
                    for (const file of list) {
                      const kind = fileKind(file) || (file.type.startsWith("video/") ? "video" : "");
                      if (kind === "image" || kind === "video") entries.push({ file, kind });
                      else rejected.push(file.name);
                    }
                    addMixed(entries, rejected);
                    event.target.value = "";
                  }} />
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.txt,.csv,.zip" multiple className="sr-only" onChange={(event) => { addFiles([...(event.target.files ?? [])], "file"); event.target.value = ""; }} />
                </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center bg-[#f0f2f5] text-slate-500">
              <div className="text-center">
                <MessageCircle className="mx-auto mb-2 text-slate-400" size={48} strokeWidth={1.25} />
                <p className="text-lg font-light text-slate-600">Flywork Chat</p>
                <p className="mt-1 text-sm text-slate-400">Bir sohbet seçerek konuşmaya başla.</p>
              </div>
            </div>
          )}
        </section>
        {open && info ? (
          <div className="h-full w-full shrink-0 xl:w-[300px] xl:max-w-[300px]">
            <InfoPane
              thread={open}
              onClose={() => setInfo(false)}
              onEdit={() => { setRenameId(open.id); setModal("edit"); setGroupTitle(open.title); setGroupTopic(open.topic); }}
              onPhoto={(file) => {
                const url = URL.createObjectURL(file);
                const threadId = open.id;
                patchOpen((current) => ({ ...current, image: url }));
                setRows((current) => current.map((row) => (row.id === threadId ? { ...row, image: url } : row)));
                const form = new FormData();
                form.set("threadId", threadId);
                form.set("photo", file);
                void run(() => saveGroupPhotoAction(form));
              }}
              onRemovePhoto={() => {
                const threadId = open.id;
                patchOpen((current) => ({ ...current, image: "" }));
                setRows((current) => current.map((row) => (row.id === threadId ? { ...row, image: "" } : row)));
                const form = new FormData();
                form.set("threadId", threadId);
                form.set("removePhoto", "1");
                void run(() => saveGroupPhotoAction(form));
              }}
              onAdd={() => { setModal("members"); setPicked([]); }}
              onLeave={() => { if (window.confirm("Gruptan ayrılmak istiyor musun?")) void run(() => leaveChatAction(open.id)).then((result) => { if (result) router.push("/flywork-chat"); }); }}
            />
          </div>
        ) : null}
      </div>
      {modal === "profile" ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={() => setModal(null)}>
          <form
            className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              if (profileFile) form.set("photo", profileFile);
              if (dropPhoto) {
                form.delete("photo");
                form.set("removePhoto", "1");
              }
              setProfileView({
                ...(data.profile ?? {}),
                bio: String(form.get("bio") ?? ""),
                image: profilePreview || (dropPhoto ? "" : data.profile?.image ?? ""),
              });
              setModal(null);
              void run(() => saveProfileAction(form));
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Profilim</h2>
              <button type="button" aria-label="Kapat" onClick={() => setModal(null)}><X size={16} /></button>
            </div>
            {note ? <p className="mb-2 text-sm text-red-700">{note}</p> : null}
            <div className="flex flex-col items-center gap-3">
              <Avatar name={data.profile?.name ?? ""} src={profilePreview || (dropPhoto ? "" : data.profile?.image ?? "")} size="h-20 w-20" />
              <label className="cursor-pointer text-sm font-semibold text-[#03624c]">
                Fotoğrafı değiştir
                <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (profilePreview) URL.revokeObjectURL(profilePreview);
                  setProfileFile(file);
                  setProfilePreview(URL.createObjectURL(file));
                  setDropPhoto(false);
                  event.target.value = "";
                }} />
              </label>
              {(data.profile?.image || profilePreview) ? (
                <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => { setProfileFile(null); if (profilePreview) URL.revokeObjectURL(profilePreview); setProfilePreview(""); setDropPhoto(true); }}>
                  Fotoğrafı kaldır
                </button>
              ) : null}
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Biyografi
              <textarea name="bio" value={bioDraft} onChange={(event) => setBioDraft(event.target.value.slice(0, 160))} rows={3} className="field mt-1" placeholder="Kendini kısaca anlat" aria-label="Biyografi" />
            </label>
            <p className="mt-1 text-right text-xs text-slate-400">{bioDraft.length}/160</p>
            <button type="submit" className="btn-primary mt-3" disabled={pending}>{pending ? "Kaydediliyor…" : "Kaydet"}</button>
          </form>
        </div>
      ) : null}
      {modal && modal !== "profile" && modal !== "contact" ? (
        <ChatDialog
          modal={modal}
          people={data.people}
          members={open?.members ?? []}
          groupTitle={groupTitle}
          groupTopic={groupTopic}
          picked={picked}
          pending={pending}
          note={note}
          onClose={() => setModal(null)}
          onTitle={setGroupTitle}
          onTopic={setGroupTopic}
          onPick={(id) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
          onDirect={(id) => { setModal(null); void run(() => openDirectAction(id)).then((result) => { if (result?.id) openThread(result.id); }); }}
          onGroup={() => setModal("group")}
          onCreate={() => { setModal(null); void run(() => createGroupAction({ title: groupTitle, topic: groupTopic, memberIds: picked })).then((result) => { if (result?.id) openThread(result.id); }); }}
          onSave={() => {
            const threadId = renameId || open?.id;
            const title = groupTitle;
            const topic = groupTopic;
            setRows((current) => current.map((row) => (row.id === threadId ? { ...row, title } : row)));
            patchOpen((current) => (current?.id === threadId ? { ...current, title, topic } : current));
            setModal(null);
            void run(() => updateGroupAction({ threadId, title, topic }));
          }}
          onAdd={() => { setModal(null); void run(() => addMembersAction({ threadId: open.id, memberIds: picked })); }}
        />
      ) : null}
      {modal === "contact" ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={() => setModal(null)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Kişi paylaş</h2>
              <button type="button" aria-label="Kapat" onClick={() => setModal(null)}><X size={16} /></button>
            </div>
            <ul className="space-y-1">
              {data.people.map((person) => (
                <li key={person.id}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50" onClick={() => shareContact(person)}>
                    <Avatar name={person.name} src={person.image} size="h-8 w-8" />
                    <span className="text-sm font-semibold">{person.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {forwardMsg ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={() => setForwardMsg(null)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Mesajı ilet</h2>
              <button type="button" aria-label="Kapat" onClick={() => setForwardMsg(null)}><X size={16} /></button>
            </div>
            <p className="mb-3 line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{forwardMsg.body || "[medya]"}</p>
            <ul className="space-y-1">
              {rows.filter((thread) => thread.id !== openId).map((thread) => (
                <li key={thread.id}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50" onClick={() => void forwardTo(thread.id)}>
                    <Avatar name={thread.title} src={thread.image} size="h-8 w-8" />
                    <span className="text-sm font-semibold">{thread.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
      <Toast text={toast} onDone={() => setToast("")} />
    </div>
  );
}

function ThreadRow({ thread, active, typing = "", menuOpen, onOpen, onMenu, onWarm, children }) {
  return (
    <div
      className={`group/row relative flex w-full items-center border-b border-slate-100 px-3 py-2.5 transition-colors ${active ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"}`}
      onMouseEnter={() => onWarm(thread.id)}
    >
      <button type="button" onClick={() => onOpen(thread.id)} className="flex min-w-0 flex-1 items-center text-left">
        <Avatar name={thread.title} src={thread.image} size="h-11 w-11" online={thread.kind === "DIRECT" && Boolean(thread.online)} />
        <div className="ml-3 flex min-w-0 flex-1 flex-col justify-center">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-slate-900">
              <span className="truncate">{thread.title}</span>
              {thread.pinned ? <PinBadge /> : null}
              {thread.muted ? <MuteBadge /> : null}
            </h4>
            <span className={`flex-shrink-0 text-[11px] ${thread.unread > 0 ? "text-[#25d366]" : "text-slate-400"}`}>
              {thread.time}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className={`truncate text-xs ${typing ? "font-medium text-[#008f6f]" : "text-slate-500"}`}>
              {typing || thread.preview || "Henüz mesaj yok"}
            </p>
            {thread.unread > 0 ? (
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[11px] font-bold text-white">
                {thread.unread > 99 ? "99+" : thread.unread}
              </span>
            ) : null}
          </div>
        </div>
      </button>
      <button
        type="button"
        aria-label="Sohbet işlemleri"
        aria-expanded={menuOpen}
        data-chat-pop=""
        className={`ml-1 rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 ${menuOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
        onClick={(event) => {
          event.stopPropagation();
          onMenu();
        }}
      >
        <MoreVertical size={16} />
      </button>
      {children}
    </div>
  );
}

function InfoPane({ thread, onClose, onEdit, onAdd, onLeave, onPhoto, onRemovePhoto }) {
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex h-full w-full flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:static xl:z-0 xl:shadow-none">
      <div className="flex justify-end px-3 pt-3">
        <button type="button" aria-label="Bilgiyi kapat" className="rounded-full p-2 text-slate-500 hover:bg-slate-100" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="px-4 pb-5 text-center">
        <div className="mx-auto w-fit"><Avatar name={thread.title} src={thread.image} size="h-16 w-16" /></div>
        {thread.kind === "GROUP" && thread.admin ? (
          <div className="mt-2 flex justify-center gap-3">
            <label className="cursor-pointer text-xs font-semibold text-[#03624c]">
              Fotoğrafı değiştir
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPhoto(file);
                event.target.value = "";
              }} />
            </label>
            {thread.image ? <button type="button" className="text-xs font-semibold text-slate-500" onClick={onRemovePhoto}>Kaldır</button> : null}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-center gap-2">
          <h2 className="text-base font-semibold">{thread.title}</h2>
          {thread.kind === "GROUP" && thread.admin ? <button type="button" className="text-xs font-semibold text-[#03624c]" onClick={onEdit}>Adı düzenle</button> : null}
        </div>
        <p className="text-xs text-slate-500">{thread.kind === "GROUP" ? `${thread.memberCount} üye · ${thread.online} çevrimiçi` : "Direkt mesaj"}</p>
        {thread.bio ? <p className="mt-3 text-sm text-slate-600">{thread.bio}</p> : null}
        {thread.topic ? <p className="mt-3 text-left text-sm text-slate-600">{thread.topic}</p> : null}
      </div>
      <div className="border-t border-slate-100 px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Medya, Bağlantı ve Dosyalar</h3>
        </div>
        {thread.media.length === 0 ? <p className="text-sm text-slate-500">Henüz dosya yok.</p> : (
          <div className="grid grid-cols-3 gap-2">
            {thread.media.map((file) => (
              file.contentType.startsWith("image/") ? (
                <a key={file.id} href={`/api/sohbet-dosya/${file.id}`} target="_blank" rel="noreferrer">
                  <img src={`/api/sohbet-dosya/${file.id}`} alt="" className="h-16 w-full rounded-lg object-cover" />
                </a>
              ) : (
                <a key={file.id} href={`/api/sohbet-dosya/${file.id}`} className="flex h-16 items-center justify-center rounded-lg bg-slate-50 px-1 text-center text-[10px] font-semibold text-slate-600">{file.fileName}</a>
              )
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 px-4 py-4">
        <h3 className="mb-2 text-sm font-semibold">Sabitlenen Mesajlar</h3>
        {thread.pins.length === 0 ? <p className="text-sm text-slate-500">Sabit mesaj yok.</p> : (
          <ul className="space-y-2">
            {thread.pins.map((pin) => (
              <li key={pin.id} className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold text-slate-700">{pin.authorName}</p>
                <p className="text-sm text-slate-600">{pin.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {thread.kind === "GROUP" ? (
        <div className="border-t border-slate-100 px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Katılımcılar ({thread.memberCount})</h3>
            {thread.admin ? <button type="button" className="text-xs font-semibold text-[#03624c]" onClick={onAdd}>Üye ekle</button> : null}
          </div>
          <ul className="space-y-2">
            {thread.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2">
                <Avatar name={member.name} src={member.image} size="h-8 w-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{member.name}</span>
                  <span className="block text-xs text-slate-400">{member.roleLabel}{member.online ? " · çevrimiçi" : ""}</span>
                </span>
              </li>
            ))}
          </ul>
          {!thread.system ? <button type="button" className="mt-4 text-sm font-semibold text-red-600" onClick={onLeave}>Gruptan ayrıl</button> : null}
        </div>
      ) : null}
    </aside>
  );
}

function ChatDialog({ modal, people, members, groupTitle, groupTopic, picked, pending, note, onClose, onTitle, onTopic, onPick, onDirect, onGroup, onCreate, onSave, onAdd }) {
  const memberIds = new Set(members.map((member) => member.userId));
  const choices = modal === "members" ? people.filter((person) => !memberIds.has(person.id)) : people;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{modal === "pick" ? "Yeni sohbet" : modal === "group" ? "Yeni grup" : modal === "edit" ? "Grubu düzenle" : "Üye ekle"}</h2>
          <button type="button" aria-label="Kapat" onClick={onClose}><X size={16} /></button>
        </div>
        {note ? <p className="mb-2 text-sm text-red-700">{note}</p> : null}
        {modal === "pick" ? (
          <>
            <button type="button" className="mb-3 flex w-full items-center gap-3 rounded-xl bg-[#f0f2f5] px-3 py-3 text-left hover:bg-slate-100" onClick={onGroup}>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#00a884] text-white"><Users size={18} /></span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">Yeni grup</span>
                <span className="block text-xs text-slate-500">Birden fazla kişiyi seç</span>
              </span>
            </button>
            <p className="mb-2 px-1 text-xs font-medium text-slate-500">Direkt mesaj</p>
            <ul className="space-y-1">
              {people.map((person) => (
                <li key={person.id}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50" onClick={() => onDirect(person.id)}>
                    <Avatar name={person.name} src={person.image} size="h-8 w-8" />
                    <span className="text-sm font-semibold">{person.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {modal !== "members" ? (
              <div className="space-y-2">
                <input value={groupTitle} onChange={(event) => onTitle(event.target.value)} className="field" placeholder="Grup adı" aria-label="Grup adı" />
                <textarea value={groupTopic} onChange={(event) => onTopic(event.target.value)} className="field" rows={2} placeholder="Grup açıklaması" aria-label="Grup açıklaması" />
              </div>
            ) : null}
            {modal !== "edit" ? (
              <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                {choices.map((person) => (
                  <li key={person.id}>
                    <label className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-slate-50">
                      <input type="checkbox" checked={picked.includes(person.id)} onChange={() => onPick(person.id)} />
                      <Avatar name={person.name} src={person.image} size="h-8 w-8" />
                      <span className="text-sm font-semibold">{person.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="btn-primary mt-3" disabled={pending} onClick={modal === "edit" ? onSave : modal === "members" ? onAdd : onCreate}>
              {pending ? "Kaydediliyor…" : modal === "edit" ? "Kaydet" : modal === "members" ? "Ekle" : "Grubu kur"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
