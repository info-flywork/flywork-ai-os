"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { refreshQuiet } from "@/client/refreshQuiet";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronDown, FileText, Image as ImageIcon, MessageCircle, Paperclip, Pencil, Pin, Plus, Search, Send, Smile, Trash2, Users, X } from "lucide-react";
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
  updateGroupAction,
} from "@/app/(panel)/flywork-chat/actions";

const FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "group", label: "Gruplar" },
  { id: "unread", label: "Okunmamış" },
];

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

function Avatar({ name, src = "", size = "h-10 w-10" }) {
  if (src) return <img src={src} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-full text-xs font-semibold text-white`} style={{ background: colorOf(name || "?") }}>
      {initials(name || "?")}
    </span>
  );
}

function fileKind(file) {
  const name = file.name.toLocaleLowerCase("tr");
  if (/\.(jpe?g|png|webp)$/.test(name)) return "image";
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

function highlight(body, names) {
  const links = body.split(/(https?:\/\/[^\s]+)/g);
  const ranked = [...new Set(["Herkes", ...names])].sort((left, right) => right.length - left.length);
  return links.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer" className="font-semibold underline">{part}</a>;
    }
    if (ranked.length === 0) return <span key={index}>{part}</span>;
    const pattern = new RegExp(`(${ranked.map((name) => `@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).join("|")})`, "gi");
    const bits = part.split(pattern);
    return bits.map((bit, bitIndex) => (
      ranked.some((name) => bit.toLocaleLowerCase("tr") === `@${name}`.toLocaleLowerCase("tr"))
        ? <span key={`${index}-${bitIndex}`} className="font-semibold text-[#03624c]">{bit}</span>
        : <span key={`${index}-${bitIndex}`}>{bit}</span>
    ));
  });
}

export default function FlyworkChat({ data }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
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
  const [bioDraft, setBioDraft] = useState("");
  const [profileFile, setProfileFile] = useState(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [dropPhoto, setDropPhoto] = useState(false);
  const [info, setInfo] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const imageRef = useRef(null);
  const fileRef = useRef(null);
  const composerRef = useRef(null);
  const scroller = useRef(null);
  const stick = useRef(true);
  const dragDepth = useRef(0);
  const cacheRef = useRef(new Map(data.open ? [[data.open.id, data.open]] : []));
  const pullSeq = useRef(0);
  const hold = useRef(0);
  const sending = useRef(false);
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
    if (!data.open) return;
    const cached = cacheRef.current.get(data.open.id);
    const incoming = data.open.partial && cached && !cached.partial ? cached : data.open;
    if (incoming === data.open) cacheRef.current.set(data.open.id, data.open);
    if (hold.current === 0 && shownRef.current === data.open.id) setLive(incoming);
  }, [data.open]);

  async function pull(id, markRead) {
    const seq = ++pullSeq.current;
    const result = await loadThreadAction(id, markRead);
    if (!result?.ok || seq !== pullSeq.current) return;
    cacheRef.current.set(id, result.open);
    if (shownRef.current === id) setLive(result.open);
    if (markRead) setRows((current) => current.map((row) => (row.id === id ? { ...row, unread: 0 } : row)));
  }

  function warm(id) {
    const cached = id ? cacheRef.current.get(id) : null;
    if (!id || id === shownRef.current || (cached && !cached.partial)) return;
    void loadThreadAction(id, false).then((result) => {
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
    const timer = setTimeout(() => {
      for (const thread of data.threads) warm(thread.id);
    }, 300);
    return () => clearTimeout(timer);
  }, [data.threads]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || hold.current > 0) return;
      const id = shownRef.current;
      if (id) void pull(id, true);
    }, 3000);
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
    if (!emojiOpen && !attachOpen && !menuFor && !reactFor) return undefined;
    function close(event) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-chat-pop]")) return;
      setEmojiOpen(false);
      setAttachOpen(false);
      setMenuFor(null);
      setReactFor(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [emojiOpen, attachOpen, menuFor, reactFor]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    stick.current = true;
  }, [openId]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [open?.messages.length]);

  const needle = query.trim().toLocaleLowerCase("tr");
  const threads = useMemo(() => rows.filter((thread) => {
    const current = thread.id === openId;
    if (!current && filter === "group" && thread.kind !== "GROUP") return false;
    if (!current && filter === "unread" && thread.unread <= 0) return false;
    if (!needle) return true;
    return (data.searchText[thread.id] ?? thread.title).toLocaleLowerCase("tr").includes(needle);
  }), [rows, data.searchText, filter, needle, openId]);
  const pinned = threads.filter((thread) => thread.pinned);
  const rest = threads.filter((thread) => !thread.pinned);
  const mentionNames = open?.members.map((member) => member.name) ?? [];

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

  function removeMessage(messageId) {
    if (!window.confirm("Bu mesaj silinsin mi?")) return;
    const threadId = shownRef.current;
    begin();
    patchOpen((current) => ({
      ...current,
      messages: current.messages.filter((message) => message.id !== messageId),
      pins: current.pins.filter((pin) => pin.id !== messageId),
    }));
    void deleteChatAction(messageId).then((result) => finishMutation(threadId, result));
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

  function renameThread(thread) {
    setRenameId(thread.id);
    setGroupTitle(thread.title);
    setGroupTopic(thread.topic ?? "");
    setModal("edit");
    setNote("");
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
          url: entry.kind === "image" ? URL.createObjectURL(entry.file) : "",
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

  async function send() {
    if (!open || sending.current) return;
    const text = body;
    const outgoing = files;
    const quote = reply;
    if (!text.trim() && outgoing.length === 0) return;
    const threadId = open.id;
    const localId = `local-${Date.now()}`;
    sending.current = true;
    begin();
    stick.current = true;
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
          contentType: item.kind === "image" ? "image/jpeg" : "application/octet-stream",
          fileName: item.name,
          size: "",
          localUrl: item.url,
        })),
        reactions: [],
        mentions: [],
        read: false,
      }],
    }));
    setRows((current) => current.map((row) => (row.id === threadId ? { ...row, preview: text.trim() || (outgoing.some((item) => item.kind === "image") ? "Görsel" : "Dosya"), time: localClock(), unread: 0 } : row)));
    setBody("");
    setFiles([]);
    setReply(null);
    setEmojiOpen(false);
    setNote("");
    const form = new FormData();
    form.set("threadId", threadId);
    form.set("body", text);
    if (quote) form.set("replyToId", quote.id);
    for (const item of outgoing) form.append(item.kind === "file" ? "file" : "image", item.file);
    const result = await sendChatAction(form);
    sending.current = false;
    if (!result.ok) {
      setBody(text);
      setFiles(outgoing);
      setReply(quote);
      patchOpen((current) => ({ ...current, messages: current.messages.filter((message) => message.id !== localId) }));
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
    stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  return (
    <div className="-mx-4 -mt-4 flex h-[100dvh] flex-col sm:-mx-6 lg:-mx-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div>
          <h1 className="page-title">Flywork Chat</h1>
          <p className="text-sm text-slate-500">Ekip arkadaşlarınla iletişimde kalın, dosya paylaşın, işleri birlikte halledin.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mesajlarda ara..." className="field w-56 pl-9" aria-label="Mesajlarda ara" />
          </label>
          <button type="button" className="btn-secondary gap-2" onClick={() => { setBioDraft((profileView ?? data.profile)?.bio ?? ""); setProfileFile(null); setProfilePreview(""); setDropPhoto(false); setModal("profile"); setNote(""); }}>
            <Avatar name={(profileView ?? data.profile)?.name ?? ""} src={(profileView ?? data.profile)?.image ?? ""} size="h-7 w-7" />
            Profilim
          </button>
          <button type="button" className="btn-primary gap-1.5" onClick={() => { setModal("pick"); setPicked([]); setGroupTitle(""); setGroupTopic(""); setNote(""); }}>
            <Plus size={16} /> Yeni Sohbet
          </button>
        </div>
      </header>
      <div className={`relative grid min-h-0 flex-1 grid-cols-1 ${info && open ? "xl:grid-cols-[320px_minmax(0,1fr)_300px]" : "xl:grid-cols-[320px_minmax(0,1fr)]"}`}>
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex gap-1 p-3">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${filter === item.id ? "bg-[#03624c] text-white" : "bg-slate-100 text-slate-600"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {pinned.length > 0 ? <p className="px-2 pb-1 text-xs font-semibold text-slate-400">Sabitlenenler</p> : null}
            {pinned.map((thread) => <ThreadRow key={thread.id} thread={thread} active={thread.id === openId} onOpen={openThread} onRename={renameThread} onDelete={removeThread} onWarm={warm} />)}
            <p className="px-2 pb-1 pt-3 text-xs font-semibold text-slate-400">Tüm Sohbetler</p>
            {rest.length === 0 ? <p className="px-3 py-6 text-sm text-slate-500">Eşleşen sohbet yok.</p> : rest.map((thread) => <ThreadRow key={thread.id} thread={thread} active={thread.id === openId} onOpen={openThread} onRename={renameThread} onDelete={removeThread} onWarm={warm} />)}
          </div>
        </aside>
        <section
          className="relative flex min-h-0 flex-col bg-[#f6f8f7]"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center border-2 border-dashed border-[#03624c] bg-[#03624c]/10">
              <p className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#03624c] shadow">Görsel veya dosyayı bırak</p>
            </div>
          ) : null}
          {open ? (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setInfo(true)}>
                  <Avatar name={open.title} src={open.image} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900">{open.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {open.kind === "GROUP" ? `${open.memberCount} üye · ${open.online} çevrimiçi` : open.online > 1 ? "çevrimiçi" : "Bilgi için tıkla"}
                    </span>
                  </span>
                </button>
                <button type="button" className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={open.pinned ? "Sabiti kaldır" : "Sohbeti sabitle"} onClick={() => toggleFlag("pinned")}>
                  <Pin size={18} />
                </button>
                <button type="button" className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={open.muted ? "Sesi aç" : "Sessize al"} onClick={() => toggleFlag("muted")}>
                  <Bell size={18} />
                </button>
                <button type="button" className="rounded-full p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="Sohbeti sil" onClick={() => removeThread(data.threads.find((thread) => thread.id === open.id) ?? { id: open.id, kind: open.kind, system: open.system })}>
                  <Trash2 size={18} />
                </button>
              </div>
              <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {open.messages.map((message, index) => {
                  const previous = open.messages[index - 1];
                  const showDay = !previous || previous.dayKey !== message.dayKey;
                  return (
                    <div key={message.id}>
                      {showDay ? <p className="mb-3 text-center text-xs font-semibold text-slate-400">{dayHeading(message.dayKey, data.today)}</p> : null}
                      <article className={`group flex ${message.mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${message.mine ? "rounded-br-md bg-[#e7f6ef]" : "rounded-bl-md border border-slate-200 bg-white"}`}
                          onDoubleClick={() => {
                            if (message.deleted || editing === message.id) return;
                            setMenuFor(null);
                            setReactFor((current) => (current === message.id ? null : message.id));
                          }}
                        >
                          {!message.deleted ? (
                            <div
                              data-chat-pop=""
                              className={`absolute top-1.5 right-1.5 z-10 ${menuFor === message.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                            >
                              <button
                                type="button"
                                aria-label="Mesaj işlemleri"
                                aria-expanded={menuFor === message.id}
                                className="grid h-6 w-6 place-items-center rounded-full bg-white/95 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-slate-700"
                                onClick={() => {
                                  setReactFor(null);
                                  setMenuFor(menuFor === message.id ? null : message.id);
                                }}
                              >
                                <ChevronDown size={14} className={menuFor === message.id ? "rotate-180 transition-transform" : "transition-transform"} />
                              </button>
                              {menuFor === message.id ? (
                                <div className="absolute right-0 top-full mt-1 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                                  <button
                                    type="button"
                                    className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                    onClick={() => {
                                      setReply({ id: message.id, authorName: message.authorName, body: message.body.slice(0, 80) });
                                      setMenuFor(null);
                                    }}
                                  >
                                    Yanıtla
                                  </button>
                                  {(open.kind === "DIRECT" || open.admin) ? (
                                    <button
                                      type="button"
                                      className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                      onClick={() => {
                                        togglePin(message);
                                        setMenuFor(null);
                                      }}
                                    >
                                      Sabitle
                                    </button>
                                  ) : null}
                                  {message.mine ? (
                                    <button
                                      type="button"
                                      className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                      onClick={() => {
                                        setEditing(message.id);
                                        setDraft(message.body);
                                        setMenuFor(null);
                                      }}
                                    >
                                      Düzenle
                                    </button>
                                  ) : null}
                                  {(message.mine || open.admin) ? (
                                    <button
                                      type="button"
                                      className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-red-600 hover:bg-red-50"
                                      onClick={() => {
                                        removeMessage(message.id);
                                        setMenuFor(null);
                                      }}
                                    >
                                      Sil
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {open.kind === "GROUP" && !message.mine && !message.deleted ? <p className="pr-7 text-xs font-semibold text-[#03624c]">{message.authorName}</p> : null}
                          {message.reply ? (
                            <p className="mb-1 rounded-lg bg-white/70 px-2 py-1 text-xs text-slate-500">
                              <span className="font-semibold text-slate-700">{message.reply.authorName}</span> {message.reply.body}
                            </p>
                          ) : null}
                          {editing === message.id ? (
                            <form onSubmit={(event) => {
                              event.preventDefault();
                              saveEdit(message.id);
                            }}>
                              <input value={draft} onChange={(event) => setDraft(event.target.value)} className="field" aria-label="Mesajı düzenle" />
                              <div className="mt-1 flex gap-2">
                                <button type="submit" className="text-xs font-semibold text-[#03624c]">Kaydet</button>
                                <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => setEditing(null)}>Vazgeç</button>
                              </div>
                            </form>
                          ) : message.deleted ? (
                            <p className="text-sm italic text-slate-400">Bu mesaj silindi</p>
                          ) : (
                            <p className={`whitespace-pre-wrap break-words text-sm text-slate-800 ${open.kind === "GROUP" && !message.mine ? "" : "pr-7"}`}>{highlight(message.body, mentionNames)}</p>
                          )}
                          {message.attachments.map((file) => (
                            file.contentType.startsWith("image/") ? (
                              <a key={file.id} href={file.localUrl || `/api/sohbet-dosya/${file.id}`} target="_blank" rel="noreferrer" className="mt-2 block">
                                <img src={file.localUrl || `/api/sohbet-dosya/${file.id}`} alt="" className="max-h-56 rounded-xl object-cover" />
                              </a>
                            ) : (
                              <a key={file.id} href={`/api/sohbet-dosya/${file.id}`} className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <FileText size={18} className="text-red-600" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">{file.fileName}</span>
                                  <span className="block text-xs text-slate-400">{file.size}</span>
                                </span>
                              </a>
                            )
                          ))}
                          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400">
                            {message.edited && !message.deleted ? <span>düzenlendi</span> : null}
                            <span>{message.time}</span>
                            {message.mine ? <CheckCheck size={14} className={message.read ? "text-[#03624c]" : "text-slate-300"} /> : null}
                          </div>
                          {message.reactions.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {message.reactions.map((reaction) => (
                                <button key={reaction.emoji} type="button" title={reaction.names.join(", ")} onClick={() => toggleReaction(message.id, reaction.emoji)} className={`rounded-full border px-2 py-0.5 text-xs ${reaction.mine ? "border-[#03624c] bg-white" : "border-slate-200 bg-white"}`}>
                                  {reaction.emoji} {reaction.count}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {reactFor === message.id ? (
                            <div data-chat-pop="" className="mt-2 flex flex-wrap gap-0.5 border-t border-slate-200/70 pt-2">
                              {COMMENT_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="grid h-8 w-8 place-items-center rounded-lg text-base hover:bg-white/80"
                                  onClick={() => {
                                    toggleReaction(message.id, emoji);
                                    setReactFor(null);
                                  }}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-slate-200 bg-white px-4 py-3">
                {note ? <p className="mb-2 text-sm text-red-700">{note}</p> : null}
                {reply ? (
                  <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <p className="truncate text-slate-600"><span className="font-semibold">{reply.authorName}</span> {reply.body}</p>
                    <button type="button" aria-label="Yanıtı kaldır" onClick={() => setReply(null)}><X size={14} /></button>
                  </div>
                ) : null}
                {files.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {files.map((item) => (
                      <span key={item.id} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 p-1">
                        {item.url ? <img src={item.url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="max-w-32 truncate px-2 text-xs font-semibold">{item.name}</span>}
                        <button type="button" className="pr-1 text-xs text-slate-500" onClick={() => dropFile(item.id)}>Kaldır</button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="relative">
                  {suggestions.length > 0 ? (
                    <ul role="listbox" aria-label="Etiket önerileri" className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                      {suggestions.map((person, index) => {
                        const active = index === activeMention;
                        return (
                          <li key={person.userId} role="option" aria-selected={active}>
                            <button
                              type="button"
                              className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm ${active ? "bg-[#03624c] text-white" : "hover:bg-slate-50"}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setMentionIndex(index)}
                              onClick={() => insertMention(person.name)}
                            >
                              {person.everyone ? (
                                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${active ? "bg-white/20" : "bg-[#03624c] text-white"}`}><Users size={14} /></span>
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
                <div className="flex items-end gap-2 rounded-3xl border border-slate-200 bg-slate-50 px-2 py-2">
                  <div className="flex shrink-0 items-center">
                  <div className="relative" data-chat-pop="">
                    <button type="button" aria-label="Emoji" className="grid h-9 w-8 place-items-center rounded-full text-slate-500" onClick={() => { setAttachOpen(false); setEmojiOpen((value) => !value); }}>
                      <Smile size={18} />
                    </button>
                    {emojiOpen ? (
                      <div className="absolute bottom-11 left-0 z-10 flex w-48 flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                        {COMMENT_EMOJIS.map((emoji) => (
                          <button key={emoji} type="button" className="rounded-lg px-1.5 py-0.5 text-lg" onClick={() => { setBody((current) => `${current}${emoji}`); setEmojiOpen(false); }}>{emoji}</button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative" data-chat-pop="">
                    <button type="button" aria-label="Dosya veya görsel ekle" className="grid h-9 w-8 place-items-center rounded-full text-slate-500" onClick={() => { setEmojiOpen(false); setAttachOpen((value) => !value); }}>
                      <Plus size={18} />
                    </button>
                    {attachOpen ? (
                      <div className="absolute bottom-11 left-0 z-10 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setAttachOpen(false); imageRef.current?.click(); }}><ImageIcon size={14} /> Görsel ekle</button>
                        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setAttachOpen(false); fileRef.current?.click(); }}><Paperclip size={14} /> Dosya ekle</button>
                      </div>
                    ) : null}
                  </div>
                  </div>
                  <textarea
                    ref={composerRef}
                    value={body}
                    rows={1}
                    placeholder="Mesaj yaz..."
                    aria-label="Mesaj"
                    aria-expanded={suggestions.length > 0}
                    className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
                    onChange={(event) => { setBody(event.target.value); setCaret(event.target.selectionStart ?? 0); }}
                    onSelect={(event) => setCaret(event.target.selectionStart ?? 0)}
                    onKeyDown={onComposerKeyDown}
                  />
                  <button type="button" aria-label="Gönder" disabled={pending} onClick={() => void send()} className="grid h-10 w-10 place-items-center rounded-full bg-[#03624c] text-white disabled:opacity-60">
                    <Send size={16} />
                  </button>
                  <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { addFiles([...(event.target.files ?? [])], "image"); event.target.value = ""; }} />
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.txt,.csv,.zip" multiple className="sr-only" onChange={(event) => { addFiles([...(event.target.files ?? [])], "file"); event.target.value = ""; }} />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-slate-500">
              <div className="text-center">
                <MessageCircle className="mx-auto mb-2" />
                <p>Bir sohbet seç.</p>
              </div>
            </div>
          )}
        </section>
        {open && info ? (
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
      {modal && modal !== "profile" ? (
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
    </div>
  );
}

function ThreadRow({ thread, active, onOpen, onRename, onDelete, onWarm }) {
  return (
    <div className={`mb-1 flex w-full items-center gap-2 rounded-2xl px-2 py-2 ${active ? "bg-[#e7f6ef]" : "hover:bg-slate-50"}`} onMouseEnter={() => onWarm(thread.id)}>
      <button type="button" onClick={() => onOpen(thread.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar name={thread.title} src={thread.image} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{thread.title}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{thread.time}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-slate-500">{thread.preview}</span>
            {thread.unread > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#03624c] px-1 text-[11px] font-semibold text-white">{thread.unread}</span> : null}
          </span>
        </span>
      </button>
      {thread.canRename ? <button type="button" aria-label="Grup adını değiştir" className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-[#03624c]" onClick={() => onRename(thread)}><Pencil size={14} /></button> : null}
      {thread.canDelete ? <button type="button" aria-label="Sohbeti sil" className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-red-600" onClick={() => onDelete(thread)}><Trash2 size={14} /></button> : null}
    </div>
  );
}

function InfoPane({ thread, onClose, onEdit, onAdd, onLeave, onPhoto, onRemovePhoto }) {
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:static xl:z-0 xl:max-w-none xl:shadow-none">
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
            <button type="button" className="btn-secondary mb-3 w-full" onClick={onGroup}>Yeni grup</button>
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
