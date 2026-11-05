"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Bell, Check, ChevronDown, Clock, ExternalLink, LayoutGrid, List, ListTodo, MessageCircle, MoreVertical, Paperclip, Pause, Play, Plus, Search, Smile, SmilePlus, Trash2, UserRound, X } from "lucide-react";
import { refreshQuiet } from "@/client/refreshQuiet";
import { COMMENT_EMOJIS } from "@/lib/commentReactions";
import { taskDeadline } from "@/lib/workDeadline";
import { WORK_FILTERS, matchesWorkFilter } from "@/lib/workPulse";
import Notice from "@/components/Notice";
import {
  addCommentAction,
  addImageAction,
  addLinkAction,
  archiveDoneTasksAction,
  deleteTaskAction,
  moveTaskAction,
  removeImageAction,
  removeLinkAction,
  createSpaceAction,
  saveTaskAction,
  setRevisionAction,
  addRevisionItemsAction,
  setTaskCompletedAction,
  setWorkFocusAction,
  seeCardAction,
  toggleCommentReactionAction,
  updateCommentAction,
} from "@/app/(panel)/is-takibi/actions";

const COLUMNS = [
  { code: "POOL", name: "İş Havuzu", bar: "bg-slate-400" },
  { code: "DOING", name: "Yapılıyor", bar: "bg-[#03624c]" },
  { code: "REVIEW", name: "Kontrol Ediliyor", bar: "bg-amber-500" },
  { code: "REVISION", name: "Revize Ediliyor", bar: "bg-violet-500" },
  { code: "DONE", name: "Tamamlandı", bar: "bg-emerald-500" },
];

const BADGE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none";

const PRIORITY = {
  URGENT: {
    label: "P0 — Acil",
    short: "P0",
    className: `${BADGE} border border-red-200 bg-red-50 text-red-600`,
  },
  HIGH: {
    label: "P1 — Öncelikli",
    short: "P1",
    className: `${BADGE} border border-orange-200 bg-orange-50 text-orange-600`,
  },
  NORMAL: {
    label: "P2 — Normal",
    short: "P2",
    className: `${BADGE} border border-sky-200 bg-sky-50 text-sky-700`,
  },
  LOW: {
    label: "P3 — Düşük",
    short: "P3",
    className: `${BADGE} border border-slate-200 bg-slate-50 text-slate-600`,
  },
};

const QUICK_FILTERS = [
  { key: "bana", label: "Bana Atananlar" },
  { key: "acil", label: "Acil (P1)" },
  { key: "geciken", label: "Gecikenler" },
];

const TAG_STYLES = {
  revize: `${BADGE} border border-violet-200 bg-violet-50 text-violet-700`,
  done: `${BADGE} border border-emerald-200 bg-emerald-50 text-emerald-700`,
  space: `${BADGE} border border-slate-200 bg-slate-50 text-slate-600`,
};

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toLocaleUpperCase("tr");
}

function matchesSearch(task, needle, names) {
  if (!needle) return true;
  const bits = [
    task.title,
    task.detail,
    task.createdByName,
    ...task.assigneeIds.map((id) => names.get(id) ?? ""),
    ...(task.comments ?? []).flatMap((comment) => [comment.body, comment.authorName]),
    ...(task.revisions ?? []).map((item) => item.body),
    ...(task.links ?? []).flatMap((link) => [link.label, link.url]),
  ];
  return bits.join("\n").toLocaleLowerCase("tr").includes(needle);
}

function personColors(people) {
  const blue = 217;
  const used = [blue];
  const colors = new Map();
  const ordered = [...people].sort((left, right) => left.id.localeCompare(right.id));
  for (const person of ordered) {
    if (person.name.toLocaleLowerCase("tr").includes("emrah")) {
      colors.set(person.id, `hsl(${blue} 78% 42%)`);
      continue;
    }
    let hash = 2166136261;
    for (const char of person.id) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    let hue = (hash >>> 0) % 360;
    let guard = 0;
    while (
      used.some((taken) => {
        const gap = Math.abs(taken - hue);
        return Math.min(gap, 360 - gap) < 32;
      }) &&
      guard < 12
    ) {
      hue = (hue + 32) % 360;
      guard += 1;
    }
    used.push(hue);
    colors.set(person.id, `hsl(${hue} 64% 34%)`);
  }
  return colors;
}

function dueLabel(value) {
  const [, month, day] = value.split("-");
  const months = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  return `${Number(day)} ${months[Number(month)]}`;
}

function createdStamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(value ?? "");
  if (!match) return value ?? "";
  return `${dueLabel(`${match[1]}-${match[2]}-${match[3]}`)} ${match[1]} ${match[4]}`;
}

function scheduleLabel(task) {
  const start = task.startsOn ? dueLabel(task.startsOn) : "";
  const end = task.dueOn ? dueLabel(task.dueOn) : "";
  const dates = start && end && task.startsOn !== task.dueOn ? `${start} – ${end}` : end || start;
  const times = task.startsAt && task.endsAt ? `${task.startsAt}–${task.endsAt}` : task.startsAt || task.endsAt || "";
  return [dates, times].filter(Boolean).join(" ");
}

function isDone(task) {
  return task.completed || task.column === "DONE";
}

function dueTone(task, today, nowIso) {
  if (isDone(task)) {
    return { kind: "done", label: scheduleLabel(task), className: `${BADGE} border border-emerald-200 bg-emerald-50 text-emerald-700` };
  }
  const deadline = taskDeadline(task);
  const late = Boolean((task.dueOn && task.dueOn < today) || (deadline && Date.parse(deadline) <= Date.parse(nowIso)));
  if (late) {
    return { kind: "late", label: "Gecikti", detail: scheduleLabel(task), className: `${BADGE} border border-red-200 bg-red-50 text-red-600` };
  }
  if (task.dueOn === today) {
    return { kind: "today", label: "Bugün", detail: scheduleLabel(task), className: `${BADGE} border border-amber-200 bg-amber-50 text-amber-700` };
  }
  const when = scheduleLabel(task);
  if (!when) return null;
  return { kind: "soon", label: when, className: `${BADGE} border border-slate-200 bg-slate-50 text-slate-500` };
}

function revisionProgress(task) {
  const items = Array.isArray(task.revisions) ? task.revisions : [];
  if (items.length === 0) return null;
  const doneCount = items.filter((item) => item.done).length;
  return {
    doneCount,
    total: items.length,
    percent: Math.min(100, Math.round((doneCount / items.length) * 100)),
  };
}

function attachmentCount(task) {
  return (task.images?.length ?? 0) + (task.links?.length ?? 0);
}


function columnName(code) {
  return COLUMNS.find((item) => item.code === code)?.name ?? code;
}

const DOING_GATE = "Yapılıyor sütununa taşımak için sorumlu kişi ve teslim tarihi gerekli.";
const DONE_GATE = "Kartı yalnızca yönetici tamamlar.";
const REVIEW_GATE = "Kontrol Ediliyor sütununa geçmek için revize maddelerinin hepsi işaretlenmeli.";
const FIELD_GATE = "Sorumlu kişi ve teslim tarihi gerekli.";

function CommentBody({ body, people }) {
  const marks = [];
  const lower = body.toLocaleLowerCase("tr");
  for (const person of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${person.name}`.toLocaleLowerCase("tr");
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const overlaps = marks.some((mark) => at < mark.end && at + needle.length > mark.start);
      if (!overlaps) marks.push({ start: at, end: at + needle.length, kind: "mention" });
      from = at + needle.length;
    }
  }
  for (const match of body.matchAll(/https?:\/\/[^\s]+/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!marks.some((mark) => start < mark.end && end > mark.start)) marks.push({ start, end, kind: "link" });
  }
  marks.sort((a, b) => a.start - b.start);
  const nodes = [];
  let cursor = 0;
  marks.forEach((mark, index) => {
    if (mark.start > cursor) nodes.push(body.slice(cursor, mark.start));
    const text = body.slice(mark.start, mark.end);
    nodes.push(mark.kind === "link" ? (
      <a key={index} href={text} target="_blank" rel="noreferrer" className="font-semibold text-[#03624c] underline">{text}</a>
    ) : (
      <span key={index} className="font-semibold text-[#03624c]">{text}</span>
    ));
    cursor = mark.end;
  });
  if (cursor < body.length) nodes.push(body.slice(cursor));
  return <>{nodes}</>;
}

function toggleGrouped(reactions, emoji, viewerName) {
  const next = (reactions ?? []).map((item) => ({ ...item, names: [...(item.names ?? [])] }));
  const found = next.find((item) => item.emoji === emoji);
  if (found?.mine) {
    found.count -= 1;
    found.mine = false;
    found.names = found.names.filter((name) => name !== viewerName);
    return next.filter((item) => item.count > 0);
  }
  if (found) {
    found.count += 1;
    found.mine = true;
    if (viewerName) found.names.push(viewerName);
    return next;
  }
  return [...next, { emoji, count: 1, mine: true, names: viewerName ? [viewerName] : [] }];
}

function MentionChoices({ suggestions, activeMention, people, onHover, onPick }) {
  return (
    <ul role="listbox" className="absolute bottom-full z-10 mb-1 w-full rounded-xl border border-slate-400 bg-slate-200 p-1.5 shadow-lg">
      {suggestions.map((person, index) => {
        const active = index === activeMention;
        return (
          <li key={person.id} role="option" aria-selected={active}>
            <button
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm shadow-sm ${active ? "border-[#03624c] bg-[#03624c] text-white" : "border-slate-300 bg-white text-slate-900"}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(person.name)}
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: active ? "rgba(255,255,255,0.25)" : (personColors(people).get(person.id) ?? "#03624c") }}
              >
                {initials(person.name)}
              </span>
              {person.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function InlineComposer({ column, onSubmit, onCancel }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onCancel();
    }
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) onCancel();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onCancel]);

  async function submit() {
    const body = title.trim();
    if (!body || busy) return;
    setBusy(true);
    const ok = await onSubmit(body, column);
    if (!ok) setBusy(false);
  }

  return (
    <div ref={rootRef} className="mx-2.5 mb-2.5 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Kart başlığı yazın..."
        aria-label="Yeni kart başlığı"
        disabled={busy}
        className="w-full rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
      />
      <div className="mt-1.5 flex items-center gap-2 px-1">
        <button type="button" className="btn-primary h-7 px-2.5 text-xs" disabled={busy || !title.trim()} onClick={() => void submit()}>
          {busy ? "Ekleniyor…" : "Ekle"}
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700" onClick={onCancel}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function TaskDialog({
  task,
  column,
  spaceId,
  people,
  viewerAdmin,
  viewerId,
  onClose,
  onAskRevision,
  onToggleRevision,
  onMoveColumn,
  patchTask,
  report,
  viewerName,
}) {
  const router = useRouter();
  const [title, setTitle] = useState(task?.title ?? "");
  const [detail, setDetail] = useState(task?.detail ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "NORMAL");
  const [startsOn, setStartsOn] = useState(task?.startsOn ?? "");
  const [startsAt, setStartsAt] = useState(task?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(task?.endsAt ?? "");
  const [dueOn, setDueOn] = useState(task?.dueOn ?? "");
  const [selected, setSelected] = useState(task?.assigneeIds ?? []);
  const [target, setTarget] = useState(task?.column ?? column);
  const [comment, setComment] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [brokenImages, setBrokenImages] = useState({});
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [state, setState] = useState(null);
  const pending = false;
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiFor, setEmojiFor] = useState(null);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [shown, setShown] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const commentRef = useRef(null);
  const saveTimer = useRef(null);
  const editRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const assigneeMenuRef = useRef(null);
  const colors = personColors(people);
  const selectedPeople = people.filter((person) => selected.includes(person.id));
  const mentionSource = editingId ? draft : comment;
  const mentionQuery = mentionSource.match(/(^|\s)@([^\n@]*)$/)?.[2] ?? null;
  const suggestions = mentionQuery === null ? [] : people.filter((person) => person.name.toLocaleLowerCase("tr").includes(mentionQuery.toLocaleLowerCase("tr"))).slice(0, 6);
  const activeMention = suggestions.length === 0 ? 0 : Math.min(mentionIndex, suggestions.length - 1);
  const checklist = task?.revisions ?? [];
  const checklistDone = checklist.filter((item) => item.done).length;
  const checklistPercent = checklist.length === 0 ? 0 : Math.round((checklistDone / checklist.length) * 100);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (task?.column) setTarget(task.column);
  }, [task?.column]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  useEffect(() => {
    if (!assigneeOpen) return undefined;
    function onPointer(event) {
      if (!assigneeMenuRef.current?.contains(event.target)) setAssigneeOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [assigneeOpen]);

  function addChecklistItem() {
    const body = checklistDraft.trim();
    if (!task || !body) return;
    const local = { id: `local-rev-${Date.now()}`, body, done: false };
    patchTask(task.id, (current) => ({
      ...current,
      revisions: [...(current.revisions ?? []), local],
      revisionCount: (current.revisionCount ?? 0) + 1,
    }));
    setChecklistDraft("");
    void addRevisionItemsAction({ taskId: task.id, items: [body] }).then((result) => {
      if (!result.ok) {
        report(result.message);
        patchTask(task.id, (current) => ({
          ...current,
          revisions: (current.revisions ?? []).filter((item) => item.id !== local.id),
          revisionCount: Math.max(0, (current.revisionCount ?? 1) - 1),
        }));
        return;
      }
      refreshQuiet(router);
    });
  }

  function insertEmoji(emoji) {
    const field = editingId ? editRef.current : commentRef.current;
    const current = field?.value ?? mentionSource;
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${emoji}${current.slice(end)}`;
    const caret = start + emoji.length;
    if (editingId) setDraft(next);
    else setComment(next);
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  }

  function insertMention(name) {
    const field = editingId ? editRef.current : commentRef.current;
    const current = field?.value ?? mentionSource;
    const next = current.replace(/(^|\s)@[^\n@]*$/, `$1@${name} `);
    if (editingId) setDraft(next);
    else setComment(next);
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(next.length, next.length);
    });
  }

  function onCommentKeyDown(event) {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex((activeMention + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((activeMention - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const person = suggestions[activeMention];
      if (person) insertMention(person.name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setComment((current) => current.replace(/(^|\s)@[^\n@]*$/, "$1"));
    }
  }

  const required = !task || task.enforced;
  const missingOwner = selected.length === 0 || !dueOn;

  async function save() {
    if (required && missingOwner) {
      setState({ ok: false, message: FIELD_GATE });
      return;
    }
    if (target === "DOING" && task?.column !== "DOING" && missingOwner) {
      setState({ ok: false, message: DOING_GATE });
      return;
    }
    if (target === "REVIEW" && (task?.revisions ?? []).some((item) => !item.done)) {
      setState({ ok: false, message: REVIEW_GATE });
      return;
    }
    if (!viewerAdmin && target === "DONE" && task?.column !== "DONE") {
      setState({ ok: false, message: DONE_GATE });
      return;
    }
    const enteringRevision = target === "REVISION" && (!task || task.column !== "REVISION");
    if (enteringRevision) {
      if (!viewerAdmin) {
        setState({ ok: false, message: "Revize maddelerini yönetici girer." });
        return;
      }
      onAskRevision({
        ...(task ? { id: task.id } : { spaceId }),
        title,
        detail,
        column: target,
        priority,
        startsOn: startsOn || null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        dueOn: dueOn || null,
        assigneeIds: selected,
      });
      return;
    }
    const payload = {
      ...(task ? { id: task.id } : { spaceId }),
      title,
      detail,
      column: target,
      priority,
      startsOn: startsOn || null,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      dueOn: dueOn || null,
      assigneeIds: selected,
    };
    const note = comment;
    const attachments = commentFiles;
    const localId = task?.id ?? `local-${Date.now()}`;
    const optimisticComment = task && (note.trim() || attachments.length > 0) ? {
      id: `local-comment-${Date.now()}`,
      authorId: viewerId,
      authorName: viewerName || "Sen",
      body: note.trim(),
      createdAt: new Date().toISOString(),
      images: attachments.map((item) => ({
        id: item.id,
        contentType: item.kind === "image" ? "image/jpeg" : "application/octet-stream",
        fileName: item.name,
        localUrl: item.url,
      })),
      reactions: [],
    } : null;
    if (task) {
      patchTask(task.id, (current) => ({
        ...current,
        ...payload,
        completed: target === "DONE" ? true : current.column === "DONE" && target !== "DONE" ? false : current.completed,
        comments: optimisticComment ? [...current.comments, optimisticComment] : current.comments,
        commentCount: current.commentCount + (optimisticComment ? 1 : 0),
      }));
    } else {
      patchTask(localId, () => ({
        id: localId,
        spaceId,
        title,
        detail,
        column: target,
        priority,
        startsOn: startsOn || null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        dueOn: dueOn || null,
        assigneeIds: selected,
        completed: target === "DONE",
        sortOrder: Date.now(),
        createdByName: viewerName || "",
        createdById: viewerId,
        commentCount: 0,
        comments: [],
        links: [],
        images: [],
        revisions: [],
        revisionCount: 0,
        unreadComments: 0,
        enforced: false,
        moves: [],
      }));
    }
    onClose();
    const result = await saveTaskAction(payload);
    if (!result.ok) {
      report(result.message);
      refreshQuiet(router);
      return;
    }
    const posted = await postComment();
    if (!posted.ok) report(posted.message);
    refreshQuiet(router);
  }

  async function remove() {
    if (!task || !window.confirm("Bu görev silinsin mi?")) return;
    const id = task.id;
    patchTask(id, () => null);
    onClose();
    const result = await deleteTaskAction(id);
    if (!result.ok) {
      report(result.message);
      refreshQuiet(router);
      return;
    }
    refreshQuiet(router);
  }

  async function changeStatus(nextColumn) {
    if (!task || !onMoveColumn) return;
    if (nextColumn === task.column) return;
    if (!viewerAdmin && nextColumn === "DONE" && task.column !== "DONE") {
      setTarget(task.column);
      setState({ ok: false, message: DONE_GATE });
      return;
    }
    if (nextColumn === "DOING" && task.column !== "DOING" && (!dueOn || selected.length === 0)) {
      setTarget(task.column);
      setState({ ok: false, message: DOING_GATE });
      return;
    }
    if (nextColumn === "REVIEW" && (task.revisions ?? []).some((item) => !item.done)) {
      setTarget(task.column);
      setState({ ok: false, message: REVIEW_GATE });
      return;
    }
    if (nextColumn === "REVISION" && task.column !== "REVISION") {
      if (!viewerAdmin) {
        setTarget(task.column);
        setState({ ok: false, message: "Revize maddelerini yönetici girer." });
        return;
      }
      onAskRevision({
        id: task.id,
        title,
        detail,
        column: nextColumn,
        priority,
        startsOn: startsOn || null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        dueOn: dueOn || null,
        assigneeIds: selected,
      });
      return;
    }
    setStatusBusy(true);
    const result = await onMoveColumn(task.id, nextColumn);
    setStatusBusy(false);
    if (result && !result.ok) {
      setTarget(task.column);
      setState({ ok: false, message: result.message || "Durum değiştirilemedi." });
      return;
    }
    setState(null);
  }

  function buildPayload(overrides = {}) {
    return {
      ...(task ? { id: task.id } : { spaceId }),
      title,
      detail,
      column: target,
      priority,
      startsOn: startsOn || null,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      dueOn: dueOn || null,
      assigneeIds: selected,
      ...overrides,
    };
  }

  function persistFields(overrides = {}) {
    if (!task) return;
    const payload = buildPayload(overrides);
    if (required && (payload.assigneeIds.length === 0 || !payload.dueOn)) return;
    patchTask(task.id, (current) => ({
      ...current,
      ...payload,
      completed: payload.column === "DONE" ? true : current.column === "DONE" && payload.column !== "DONE" ? false : current.completed,
    }));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveTaskAction(payload).then((result) => {
        if (!result.ok) {
          report(result.message);
          refreshQuiet(router);
          return;
        }
        refreshQuiet(router);
      });
    }, 450);
  }

  async function sendComposerComment() {
    if (!task || commentBusy) return;
    if (!comment.trim() && commentFiles.length === 0) return;
    const note = comment.trim();
    const attachments = commentFiles;
    const optimistic = {
      id: `local-comment-${Date.now()}`,
      authorId: viewerId,
      authorName: viewerName || "Sen",
      body: note,
      createdAt: new Date().toISOString(),
      images: attachments.map((item) => ({
        id: item.id,
        contentType: item.kind === "image" ? "image/jpeg" : "application/octet-stream",
        fileName: item.name,
        localUrl: item.url,
      })),
      reactions: [],
    };
    patchTask(task.id, (current) => ({
      ...current,
      comments: [...current.comments, optimistic],
      commentCount: current.commentCount + 1,
    }));
    setComment("");
    setCommentFiles([]);
    setComposerEmojiOpen(false);
    setCommentBusy(true);
    const form = new FormData();
    form.set("taskId", task.id);
    form.set("body", note);
    for (const item of attachments) form.append(item.kind === "file" ? "file" : "image", item.file);
    const result = await addCommentAction(form);
    setCommentBusy(false);
    if (!result.ok) {
      report(result.message);
      refreshQuiet(router);
      return;
    }
    refreshQuiet(router);
  }

  function addCommentFiles(files, kind) {
    setAttachOpen(false);
    setCommentFiles((current) => {
      const next = [...current];
      for (const file of files) {
        if (next.length >= 6) break;
        next.push({ id: `${kind}-${file.name}-${file.size}-${next.length}`, file, kind, name: file.name, url: kind === "image" ? URL.createObjectURL(file) : "" });
      }
      return next;
    });
  }

  function dropCommentFile(id) {
    setCommentFiles((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      return current.filter((entry) => entry.id !== id);
    });
  }

  async function postComment() {
    if (!task || (!comment.trim() && commentFiles.length === 0)) return { ok: true, skipped: true };
    const form = new FormData();
    form.set("taskId", task.id);
    form.set("body", comment);
    for (const item of commentFiles) form.append(item.kind === "file" ? "file" : "image", item.file);
    return addCommentAction(form);
  }

  function leaveReaction(commentId, emoji) {
    if (!task) return;
    patchTask(task.id, (current) => ({
      ...current,
      comments: current.comments.map((comment) => comment.id === commentId ? { ...comment, reactions: toggleGrouped(comment.reactions, emoji, viewerName) } : comment),
    }));
    setEmojiFor(null);
    void toggleCommentReactionAction({ commentId, emoji }).then((result) => {
      if (!result.ok) report(result.message);
      else refreshQuiet(router);
    });
  }

  function saveComment() {
    if (!editingId || !task) return;
    const commentId = editingId;
    const body = draft;
    patchTask(task.id, (current) => ({
      ...current,
      comments: current.comments.map((comment) => comment.id === commentId ? { ...comment, body } : comment),
    }));
    setEditingId(null);
    setDraft("");
    void updateCommentAction({ id: commentId, body }).then((result) => {
      if (!result.ok) report(result.message);
      else refreshQuiet(router);
    });
  }

  function sendLink() {
    if (!task) return;
    const url = linkUrl.trim();
    if (!url) return;
    const label = linkLabel.trim();
    patchTask(task.id, (current) => ({
      ...current,
      links: [...(current.links ?? []), { id: `local-link-${Date.now()}`, url, label: label || "" }],
    }));
    setLinkUrl("");
    setLinkLabel("");
    void addLinkAction({ taskId: task.id, url, label: label || undefined }).then((result) => {
      if (!result.ok) report(result.message);
      refreshQuiet(router);
    });
  }

  function sendImages(files) {
    if (!task || files.length === 0) return;
    const taskId = task.id;
    const added = files.map((file) => ({
      id: `local-image-${file.name}-${file.size}-${Date.now()}`,
      localUrl: URL.createObjectURL(file),
      file,
    }));
    patchTask(taskId, (current) => ({ ...current, images: [...current.images, ...added.map(({ id, localUrl }) => ({ id, localUrl }))] }));
    void (async () => {
      for (const item of added) {
        const form = new FormData();
        form.set("taskId", taskId);
        form.set("file", item.file);
        const result = await addImageAction(form);
        if (!result.ok) {
          report(result.message);
          break;
        }
      }
      refreshQuiet(router);
    })();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Paneli kapat"
        className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kart-baslik"
        className={`relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${shown ? "translate-x-0" : "translate-x-full"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="relative shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Kapat"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <textarea
            id="kart-baslik"
            value={title}
            rows={Math.min(4, Math.max(1, title.split("\n").length + Math.floor(title.length / 42)))}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => persistFields()}
            className={`w-full resize-none break-words border-0 bg-transparent p-0 pr-12 text-lg font-semibold leading-snug outline-none placeholder:text-slate-400 focus:ring-0 ${task && (task.completed || target === "DONE") ? "text-slate-400 line-through" : "text-slate-800"}`}
            placeholder="Kart başlığı"
          />
          <div className="mt-2 flex items-center gap-2">
            <select
              value={target}
              disabled={!task || statusBusy}
              onChange={(event) => {
                const next = event.target.value;
                setTarget(next);
                void changeStatus(next);
              }}
              className="h-7 appearance-none rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 shadow-sm outline-none hover:bg-slate-100 disabled:opacity-60"
              aria-label="Sütun durumu"
            >
              {COLUMNS.filter((item) => viewerAdmin || item.code !== "DONE" || task?.column === "DONE").map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(event) => {
                const next = event.target.value;
                setPriority(next);
                persistFields({ priority: next });
              }}
              className="h-7 appearance-none rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 shadow-sm outline-none hover:bg-slate-100"
              aria-label="Öncelik"
            >
              {Object.entries(PRIORITY).map(([value, item]) => (
                <option key={value} value={value}>{item.short} — {item.label.split("—")[1]?.trim() || item.label}</option>
              ))}
            </select>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {task?.createdByName ? (
          <div className="mb-4 flex items-start gap-3">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: personColors(people).get(task.createdById) ?? "#03624c" }}
            >
              {initials(task.createdByName)}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm text-slate-800">
                <span className="font-semibold">{task.createdByName}</span>
                {" bu kartı oluşturdu"}
              </p>
              <p className="text-xs font-medium text-[#03624c]">{createdStamp(task.createdAt)}</p>
            </div>
          </div>
        ) : null}
        {state && !state.ok ? <div className="mb-3"><Notice tone="err">{state.message}</Notice></div> : null}
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">Açıklama
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              onBlur={() => persistFields()}
              rows={4}
              placeholder="Açıklama ekleyin..."
              className="field mt-1.5"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600">
                Başlangıç
                <input
                  type="date"
                  value={startsOn}
                  onChange={(event) => {
                    const next = event.target.value;
                    setStartsOn(next);
                    persistFields({ startsOn: next || null });
                  }}
                  className="field mt-1"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Saat
                <input
                  type="time"
                  value={startsAt}
                  onChange={(event) => {
                    const next = event.target.value;
                    setStartsAt(next);
                    persistFields({ startsAt: next || null });
                  }}
                  className="field mt-1"
                />
              </label>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600">
                Teslim{required ? " *" : ""}
                <input
                  type="date"
                  value={dueOn}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDueOn(next);
                    persistFields({ dueOn: next || null });
                  }}
                  className="field mt-1"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Saat
                <input
                  type="time"
                  value={endsAt}
                  onChange={(event) => {
                    const next = event.target.value;
                    setEndsAt(next);
                    persistFields({ endsAt: next || null });
                  }}
                  className="field mt-1"
                />
              </label>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Sorumlu kişi{required ? " *" : ""}</p>
            <div className="relative mt-2" ref={assigneeMenuRef}>
              <button
                type="button"
                aria-expanded={assigneeOpen}
                aria-haspopup="listbox"
                onClick={() => setAssigneeOpen((open) => !open)}
                className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm hover:border-slate-300 hover:bg-slate-50"
              >
                {selectedPeople.length === 0 ? (
                  <>
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-400">
                      <UserRound size={14} />
                    </span>
                    <span className="flex-1 text-sm text-slate-500">Sorumlu seçin</span>
                  </>
                ) : (
                  <>
                    <span className="flex -space-x-1.5">
                      {selectedPeople.slice(0, 4).map((person) => (
                        <span
                          key={person.id}
                          title={person.name}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
                          style={{ background: colors.get(person.id) ?? "#03624c" }}
                        >
                          {initials(person.name)}
                        </span>
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                      {selectedPeople.map((person) => person.name.split(" ")[0]).join(", ")}
                      {selectedPeople.length > 4 ? ` +${selectedPeople.length - 4}` : ""}
                    </span>
                  </>
                )}
                <ChevronDown size={16} className="shrink-0 text-slate-400" />
              </button>
              {assigneeOpen ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
                  {people.map((person) => {
                    const on = selected.includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50 ${on ? "bg-slate-50" : ""}`}
                        onClick={() => {
                          const next = on ? selected.filter((id) => id !== person.id) : [...selected, person.id];
                          setSelected(next);
                          persistFields({ assigneeIds: next });
                        }}
                      >
                        <span
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: colors.get(person.id) ?? "#03624c" }}
                        >
                          {initials(person.name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{person.name}</span>
                        {on ? <Check size={14} className="shrink-0 text-[#03624c]" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {!task ? (
          <div className="mt-5">
            <button type="button" className="btn-primary" disabled={pending} onClick={() => void save()}>{pending ? "Kaydediliyor…" : "Kaydet"}</button>
          </div>
        ) : null}
        {task ? (
          <div className="mt-6 space-y-5 border-t border-slate-200 pt-4">
            <section>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Kontrol listesi</h3>
                {checklist.length > 0 ? (
                  <span className="text-xs font-medium tabular-nums text-slate-500">{checklistDone}/{checklist.length} · %{checklistPercent}</span>
                ) : null}
              </div>
              {checklist.length > 0 ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${checklistPercent === 100 ? "bg-emerald-500" : "bg-sky-500"}`}
                    style={{ width: `${checklistPercent}%` }}
                  />
                </div>
              ) : null}
              <ul className="mt-3 space-y-1.5">
                {checklist.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-start gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" className="mt-0.5" checked={item.done} onChange={() => onToggleRevision(task.id, item)} />
                      <span className={item.done ? "text-slate-400 line-through" : "text-slate-800"}>{item.body}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <input
                  value={checklistDraft}
                  onChange={(event) => setChecklistDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChecklistItem();
                    }
                  }}
                  placeholder="Yeni madde ekle..."
                  className="field flex-1"
                />
                <button type="button" className="btn-secondary shrink-0" onClick={addChecklistItem}>Ekle</button>
              </div>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-slate-800">Aktivite</h3>
              {(task.moves ?? []).length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">Henüz sütun hareketi yok.</p>
              ) : (
                <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3 text-xs text-slate-500">
                  {task.moves.map((move) => (
                    <li key={move.id} className="relative">
                      <span className="absolute -left-[1.1875rem] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-slate-300 ring-1 ring-slate-200" aria-hidden="true" />
                      <p className="leading-relaxed">
                        <span className="font-semibold text-slate-700">{columnName(move.column)}</span>
                        {" · "}
                        {createdStamp(move.createdAt)}
                        {" · "}
                        {move.actorName}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section>
              <h3 className="text-sm font-semibold">Linkler</h3>
              <ul className="mt-2 space-y-2">
                {task.links.map((link) => {
                  const rawLabel = String(link.label ?? "").trim();
                  const customTitle = rawLabel && rawLabel !== link.url ? rawLabel : "";
                  return (
                    <li key={link.id} className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                      <a href={link.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 no-underline" title={link.url}>
                        <span className="flex items-center gap-2">
                          <ExternalLink size={14} className="shrink-0 text-slate-400" />
                          <span className="min-w-0">
                            {customTitle ? (
                              <>
                                <span className="block truncate text-sm font-semibold text-slate-800">{customTitle}</span>
                                <span className="mt-0.5 block max-w-[280px] truncate text-xs text-slate-500">{link.url}</span>
                              </>
                            ) : (
                              <span className="block max-w-[280px] truncate text-sm font-semibold text-[#03624c]">{link.url}</span>
                            )}
                          </span>
                        </span>
                      </a>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-700"
                        onClick={() => {
                          patchTask(task.id, (current) => ({ ...current, links: (current.links ?? []).filter((item) => item.id !== link.id) }));
                          void removeLinkAction(link.id).then((result) => {
                            if (!result.ok) report(result.message);
                            else refreshQuiet(router);
                          });
                        }}
                      >
                        Kaldır
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" className="field" />
                <input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="Ad" className="field" />
                <button type="button" className="btn-secondary" disabled={pending} onClick={() => void sendLink()}>Link ekle</button>
              </div>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Görseller</h3>
              <div className="mt-2 flex flex-col gap-3">
                {(task.images ?? []).map((image) => (
                  <figure key={image.id} className="relative">
                    {brokenImages[image.id] ? (
                      <div className="flex min-h-24 items-center rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">Görsel dosyası bulunamadı. Yeniden ekleyin.</div>
                    ) : (
                      <a href={image.localUrl || `/api/is-gorsel/${image.id}`} target="_blank" rel="noreferrer">
                        <img
                          src={image.localUrl || `/api/is-gorsel/${image.id}`}
                          alt=""
                          className="max-h-80 w-full rounded-xl bg-slate-50 object-contain"
                          onError={() => setBrokenImages((current) => ({ ...current, [image.id]: true }))}
                        />
                      </a>
                    )}
                    {viewerAdmin ? <button type="button" className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold shadow" onClick={() => { patchTask(task.id, (current) => ({ ...current, images: (current.images ?? []).filter((item) => item.id !== image.id) })); void removeImageAction(image.id).then((result) => { if (!result.ok) report(result.message); else refreshQuiet(router); }); }}>Sil</button> : null}
                  </figure>
                ))}
              </div>
              <label className="btn-secondary mt-2">
                Görsel ekle
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  if (files.length > 0) void sendImages(files);
                  event.target.value = "";
                }} />
              </label>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Yorumlar</h3>
              <ul className="mt-2 space-y-3">
                {task.comments.map((item) => (
                  <li key={item.id} className="group rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-500">{item.authorName} · {createdStamp(item.createdAt)}</p>
                      {item.authorId === viewerId && editingId !== item.id ? (
                        <button type="button" className="text-xs font-semibold text-[#03624c]" onClick={() => { setEditingId(item.id); setDraft(item.body); }}>Düzenle</button>
                      ) : null}
                    </div>
                    {editingId === item.id ? (
                      <div className="relative mt-2">
                        {suggestions.length > 0 ? <MentionChoices suggestions={suggestions} activeMention={activeMention} people={people} onHover={setMentionIndex} onPick={insertMention} /> : null}
                        <textarea ref={editRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onCommentKeyDown} rows={3} className="field" />
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="btn-primary" disabled={pending} onClick={() => void saveComment()}>Kaydet</button>
                          <button type="button" className="btn-secondary" disabled={pending} onClick={() => { setEditingId(null); setDraft(""); }}>Vazgeç</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {item.body ? <p className="mt-1 whitespace-pre-wrap text-sm"><CommentBody body={item.body} people={people} /></p> : null}
                        {(item.images ?? []).length > 0 ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {item.images.map((image) => (
                              image.contentType?.startsWith("image/") ? (
                                <a key={image.id} href={image.localUrl || `/api/is-gorsel/${image.id}`} target="_blank" rel="noreferrer">
                                  {brokenImages[image.id] ? (
                                    <span className="block rounded-xl bg-white px-3 py-6 text-center text-xs text-slate-500">Görsel açılamadı</span>
                                  ) : (
                                    <img
                                      src={image.localUrl || `/api/is-gorsel/${image.id}`}
                                      alt=""
                                      className="max-h-48 w-full rounded-xl bg-white object-contain"
                                      onError={() => setBrokenImages((current) => ({ ...current, [image.id]: true }))}
                                    />
                                  )}
                                </a>
                              ) : (
                                <a key={image.id} href={`/api/is-gorsel/${image.id}`} className="flex items-center rounded-xl bg-white px-3 py-3 text-sm font-semibold text-[#03624c] underline">
                                  {image.fileName || "Dosya"}
                                </a>
                              )
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {(item.reactions ?? []).map((reaction) => (
                        <button
                          key={reaction.emoji}
                          type="button"
                          title={reaction.names.join(", ")}
                          disabled={pending}
                          onClick={() => void leaveReaction(item.id, reaction.emoji)}
                          className={`rounded-full border px-2 py-0.5 text-xs ${reaction.mine ? "border-[#03624c] bg-[#03624c]/10" : "border-slate-200 bg-white"}`}
                        >
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                      <div className="relative">
                        <button
                          type="button"
                          aria-label="Reaksiyon ekle"
                          title="Reaksiyon ekle"
                          disabled={pending}
                          onClick={() => setEmojiFor(emojiFor === item.id ? null : item.id)}
                          className={`inline-flex h-7 items-center gap-1 rounded-full border border-transparent px-1.5 text-slate-400 transition-all hover:border-slate-200 hover:bg-white hover:text-slate-600 ${(item.reactions ?? []).length === 0 ? "opacity-0 group-hover:opacity-100 focus:opacity-100" : "opacity-70 hover:opacity-100"} ${emojiFor === item.id ? "opacity-100 border-slate-200 bg-white text-slate-600" : ""}`}
                        >
                          <SmilePlus size={14} />
                        </button>
                        {emojiFor === item.id ? (
                          <div className="absolute bottom-8 left-0 z-10 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                            {COMMENT_EMOJIS.map((emoji) => (
                              <button key={emoji} type="button" disabled={pending} onClick={() => void leaveReaction(item.id, emoji)} className="rounded-lg px-1.5 py-1 text-base hover:bg-slate-50">
                                {emoji}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="relative mt-3 rounded-xl border border-slate-200 bg-white shadow-sm">
                {!editingId && suggestions.length > 0 ? (
                  <MentionChoices suggestions={suggestions} activeMention={activeMention} people={people} onHover={setMentionIndex} onPick={insertMention} />
                ) : null}
                <textarea
                  ref={commentRef}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    onCommentKeyDown(event);
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void sendComposerComment();
                    }
                  }}
                  rows={3}
                  placeholder="Yorum yazın. Etiket için @ yazın."
                  className="field min-h-[5.5rem] resize-none rounded-xl border-0 bg-transparent pb-12 shadow-none focus:ring-0"
                />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                  <div className="relative flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Dosya veya görsel ekle"
                      aria-expanded={attachOpen}
                      disabled={pending || commentBusy}
                      onClick={() => {
                        setComposerEmojiOpen(false);
                        setAttachOpen((current) => !current);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="Emoji ekle"
                      aria-expanded={composerEmojiOpen}
                      disabled={pending || commentBusy}
                      onClick={() => {
                        setAttachOpen(false);
                        setComposerEmojiOpen((open) => !open);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Smile size={16} />
                    </button>
                    {attachOpen ? (
                      <div className="absolute bottom-10 left-0 z-10 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => imageInputRef.current?.click()}>Görsel ekle</button>
                        <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => fileInputRef.current?.click()}>Dosya ekle</button>
                      </div>
                    ) : null}
                    {composerEmojiOpen ? (
                      <div className="absolute bottom-10 left-0 z-10 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                        {COMMENT_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            disabled={pending || commentBusy}
                            onClick={() => {
                              insertEmoji(emoji);
                              setComposerEmojiOpen(false);
                            }}
                            className="rounded-lg px-1.5 py-1 text-base hover:bg-slate-50"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={pending || commentBusy || (!comment.trim() && commentFiles.length === 0)}
                    onClick={() => void sendComposerComment()}
                    className="inline-flex h-8 items-center rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                  >
                    {commentBusy ? "Gönderiliyor…" : "Gönder"}
                  </button>
                </div>
                <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  if (files.length > 0) addCommentFiles(files, "image");
                  event.target.value = "";
                }} />
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.txt,.csv,.zip" multiple className="sr-only" onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  if (files.length > 0) addCommentFiles(files, "file");
                  event.target.value = "";
                }} />
              </div>
              {commentFiles.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {commentFiles.map((item) => (
                    <span key={item.id} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1">
                      {item.url ? <img src={item.url} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="max-w-40 truncate px-2 text-xs font-semibold text-slate-700">{item.name}</span>}
                      <button type="button" className="pr-2 text-xs font-semibold text-slate-500" onClick={() => dropCommentFile(item.id)}>Kaldır</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
        </div>

        <footer className="sticky bottom-0 flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white p-4">
          <div>
            {task && viewerAdmin ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                disabled={pending}
                onClick={() => void remove()}
              >
                <Trash2 size={15} />
                Görevi Sil
              </button>
            ) : (
              <span />
            )}
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Kapat
          </button>
        </footer>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  column,
  today,
  nowIso,
  colors,
  names,
  focusing,
  live,
  mine,
  pausedMine,
  unread,
  spaceLabel,
  onOpen,
  onFocus,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) {
  const done = isDone(task);
  const when = dueTone(task, today, nowIso);
  const progress = revisionProgress(task);
  const files = attachmentCount(task);
  const detail = String(task.detail ?? "").trim();
  const title = String(task.title ?? "").trim() || "Adsız kart";
  const priority = PRIORITY[task.priority] ?? PRIORITY.NORMAL;
  const images = Array.isArray(task.images) ? task.images : [];
  const assigneeIds = Array.isArray(task.assigneeIds) ? task.assigneeIds : [];
  const commentCount = Number(task.commentCount) || 0;
  const accentBar = live.length > 0
    ? "bg-emerald-500"
    : pausedMine
      ? "bg-amber-400"
      : null;
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(event) => {
        if (event.target.closest("[data-no-drag]")) return;
        onOpen();
      }}
      className={`group relative cursor-grab rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing ${live.length > 0 ? "ring-2 ring-emerald-500/20" : pausedMine ? "ring-2 ring-amber-400/15" : ""}`}
    >
      {accentBar ? <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 z-0 w-1 rounded-l-lg ${accentBar}`} /> : null}
      <div className="relative z-10 w-full p-3.5">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className={priority.className}>{priority.short}</span>
            {(Number(task.revisionCount) > 0 || task.column === "REVISION") ? (
              <span className={TAG_STYLES.revize}>
                Revize{Number(task.revisionCount) > 0 ? ` ${task.revisionCount}` : ""}
              </span>
            ) : null}
            {done ? <span className={TAG_STYLES.done}>Tamam</span> : null}
            {spaceLabel ? (
              <span className={`${TAG_STYLES.space} max-w-[7rem] truncate`}>{spaceLabel}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {!done && (mine || pausedMine) ? (
              <button
                type="button"
                data-no-drag
                disabled={focusing}
                aria-label={mine ? "Bu işi durdur" : "Bu işe devam et"}
                className={`rounded-md p-1 ${mine ? "bg-[#03624c] text-white" : "border border-amber-300 bg-amber-50 text-amber-700"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onFocus();
                }}
              >
                {mine ? <Pause size={13} /> : <Play size={13} />}
              </button>
            ) : null}
            <button
              type="button"
              data-no-drag
              aria-label="Kart işlemleri"
              className="rounded-md p-1 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-600"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              <MoreVertical size={14} />
            </button>
          </div>
        </div>

        <p className={`mt-2 w-full break-words text-[13px] font-medium leading-snug line-clamp-2 ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>
          {title}
        </p>
        {detail ? (
          <p className="mt-1 w-full break-words text-xs leading-snug text-slate-500 line-clamp-2">{detail}</p>
        ) : null}

        {images.length > 0 ? (
          <div className="mt-2.5 flex gap-1.5">
            {images.slice(0, 3).map((image) => (
              <img key={image.id} src={`/api/is-gorsel/${image.id}`} alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-200" />
            ))}
          </div>
        ) : null}

        <div className="mt-2.5 flex w-full items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            {unread > 0 ? (
              <span className={`${BADGE} border border-red-200 bg-red-50 text-red-600`} aria-label={`${unread} yeni yorum`}>
                <Bell size={11} />
                {unread}
              </span>
            ) : null}
            {when ? (
              <span className={`${when.className} max-w-[9.5rem]`} title={when.detail || when.label}>
                <Clock size={11} className="shrink-0" />
                <span className="truncate">{when.label}</span>
              </span>
            ) : null}
            {progress ? (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-slate-500" title={`Alt görev ${progress.doneCount}/${progress.total}`}>
                <ListTodo size={12} aria-hidden="true" />
                <span className="tabular-nums">{progress.doneCount}/{progress.total}</span>
              </span>
            ) : null}
            {commentCount > 0 ? (
              <span className={`${BADGE} shrink-0 text-slate-500`}>
                <MessageCircle size={11} />
                {commentCount}
              </span>
            ) : null}
            {files > 0 ? (
              <span className={`${BADGE} shrink-0 text-slate-500`}>
                <Paperclip size={11} />
                {files}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 -space-x-1.5">
            {assigneeIds.length === 0 ? (
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-slate-400" title="Atanmadı">
                <UserRound size={11} />
              </span>
            ) : (
              assigneeIds.slice(0, 3).map((id) => {
                const name = names.get(id) ?? "";
                return (
                  <span
                    key={id}
                    title={name}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[9px] font-semibold text-white shadow-sm"
                    style={{ background: colors.get(id) ?? "#03624c" }}
                  >
                    {initials(name)}
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>
      {column ? <span className="sr-only">{column}</span> : null}
    </article>
  );
}

export default function WorkBoard({
  data,
  filtre = "",
  kart = "",
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(data.tasks);
  const [spaceId, setSpaceId] = useState(data.spaces[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState(null);
  const [over, setOver] = useState(null);
  const [focusing, setFocusing] = useState(false);
  const [revision, setRevision] = useState(null);
  const [clearedComments, setClearedComments] = useState({});
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [view, setView] = useState("board");
  const [composing, setComposing] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const dragging = useRef(null);
  const moveLock = useRef(0);
  const assigneeMenuRef = useRef(null);
  const editorRef = useRef(null);
  editorRef.current = editor;
  const searchRef = useRef(null);
  const queryJump = useRef("");
  const moved = useRef(false);
  const openedKart = useRef(false);
  const incoming = JSON.stringify(data.tasks);

  useEffect(() => {
    if (moveLock.current > 0) return;
    setTasks(data.tasks);
  }, [incoming, data.tasks]);

  useEffect(() => {
    if (!data.spaces.some((space) => space.id === spaceId)) {
      setSpaceId(data.spaces[0]?.id ?? "");
    }
  }, [data.spaces, spaceId]);

  useEffect(() => {
    if (openedKart.current || !kart) return;
    const task = tasks.find((item) => item.id === kart);
    if (!task) return;
    openedKart.current = true;
    setSpaceId(task.spaceId);
    setEditor({ id: task.id, column: task.column });
  }, [kart, tasks]);

  useEffect(() => {
    if (!filtre) return;
    if (tasks.some((task) => task.spaceId === spaceId && matchesWorkFilter(task, filtre, data.today, data.viewerId) && (filtre === "bana" || data.viewerRole === "ADMIN" || task.assigneeIds.includes(data.viewerId)))) return;
    const next = data.spaces.find((space) => tasks.some((task) => task.spaceId === space.id && matchesWorkFilter(task, filtre, data.today, data.viewerId) && (filtre === "bana" || data.viewerRole === "ADMIN" || task.assigneeIds.includes(data.viewerId))));
    if (next && next.id !== spaceId) setSpaceId(next.id);
  }, [filtre, tasks, spaceId, data.spaces, data.today, data.viewerRole, data.viewerId]);

  useEffect(() => {
    if (!editor?.id) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (document.hidden) return;
      refreshQuiet(router);
    }, 5000);
    return () => clearInterval(timer);
  }, [editor?.id, router]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (dragging.current || moveLock.current > 0 || document.hidden || editorRef.current) return;
      refreshQuiet(router);
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  const day = data.day ?? { now: [], earlier: [], log: [] };
  const [sessionNow, setSessionNow] = useState(null);
  const [sessionPaused, setSessionPaused] = useState(null);
  useEffect(() => {
    setSessionNow(null);
    setSessionPaused(null);
  }, [data.day]);
  const nowList = sessionNow ?? day.now;
  const pausedList = sessionPaused ?? (day.paused ?? []);
  const viewerName = data.people.find((person) => person.id === data.viewerId)?.name ?? day.now.find((item) => item.userId === data.viewerId)?.userName ?? "";

  function patchTask(taskId, recipe) {
    setTasks((current) => {
      const index = current.findIndex((task) => task.id === taskId);
      const base = index >= 0 ? current[index] : null;
      const next = recipe(base ?? { id: taskId, comments: [], images: [], links: [], revisions: [] });
      if (!next) return current.filter((task) => task.id !== taskId);
      if (index < 0) return [...current, next];
      return current.map((task) => (task.id === taskId ? next : task));
    });
  }

  function chooseFocus(taskId) {
    const task = tasks.find((item) => item.id === taskId);
    const currentNow = sessionNow ?? day.now;
    const currentPaused = sessionPaused ?? day.paused ?? [];
    const runningMine = currentNow.find((item) => item.taskId === taskId && item.userId === data.viewerId);
    if (runningMine) {
      setSessionNow(currentNow.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)));
      setSessionPaused([
        ...currentPaused.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)),
        { ...runningMine, pausedLabel: "şimdi" },
      ]);
    } else {
      const previous = currentPaused.find((item) => item.taskId === taskId && item.userId === data.viewerId);
      setSessionPaused(currentPaused.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)));
      setSessionNow([
        ...currentNow.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)),
        {
          id: previous?.id ?? `local-${taskId}`,
          userId: data.viewerId,
          userName: previous?.userName || viewerName,
          title: task?.title ?? previous?.title ?? "",
          taskId,
          spaceId: task?.spaceId ?? previous?.spaceId ?? null,
          startedLabel: "şimdi",
        },
      ]);
    }
    void setWorkFocusAction(taskId).then((result) => {
      if (!result.ok) {
        setMessage(result.message);
        setSessionNow(null);
        setSessionPaused(null);
        return;
      }
      refreshQuiet(router);
    });
  }

  const names = new Map(data.people.map((person) => [person.id, person.name]));
  const needle = query.trim().toLocaleLowerCase("tr");

  useEffect(() => {
    if (!assigneeOpen) return undefined;
    function onPointer(event) {
      if (!assigneeMenuRef.current?.contains(event.target)) setAssigneeOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [assigneeOpen]);

  useEffect(() => {
    if (!needle) {
      queryJump.current = "";
      return;
    }
    if (queryJump.current === needle) return;
    queryJump.current = needle;
    const people = new Map(data.people.map((person) => [person.id, person.name]));
    const own = (task) => !filtre || data.viewerRole === "ADMIN" || task.assigneeIds.includes(data.viewerId);
    if (tasks.some((task) => task.spaceId === spaceId && matchesWorkFilter(task, filtre, data.today, data.viewerId) && own(task) && matchesSearch(task, needle, people))) return;
    const next = data.spaces.find((space) => tasks.some((task) => task.spaceId === space.id && matchesWorkFilter(task, filtre, data.today, data.viewerId) && own(task) && matchesSearch(task, needle, people)));
    if (next && next.id !== spaceId) setSpaceId(next.id);
  }, [needle, tasks, spaceId, filtre, data.today, data.spaces, data.people, data.viewerId, data.viewerRole]);
  const colors = personColors(data.people);
  const openTask = editor?.id ? tasks.find((task) => task.id === editor.id) ?? null : null;
  const openCommentCount = openTask?.commentCount ?? null;
  const assigneePerson = assigneeFilter ? data.people.find((person) => person.id === assigneeFilter) : null;

  useEffect(() => {
    if (!editor?.id || openCommentCount == null) return undefined;
    setClearedComments((current) => current[editor.id] === openCommentCount ? current : { ...current, [editor.id]: openCommentCount });
    let cancel = false;
    void seeCardAction(editor.id).then((result) => {
      if (!cancel && result?.ok) refreshQuiet(router);
    });
    return () => {
      cancel = true;
    };
  }, [editor?.id, openCommentCount, router]);

  function matchesBoard(task) {
    if (!matchesWorkFilter(task, filtre, data.today, data.viewerId)) return false;
    if (assigneeFilter && !task.assigneeIds.includes(assigneeFilter)) return false;
    if (!filtre || filtre === "bana" || data.viewerRole === "ADMIN") return true;
    return task.assigneeIds.includes(data.viewerId);
  }

  function columnTasks(column) {
    return tasks
      .filter((task) => task.spaceId === spaceId && task.column === column && matchesBoard(task) && matchesSearch(task, needle, names))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "tr"));
  }

  function visibleTasks() {
    return tasks
      .filter((task) => task.spaceId === spaceId && matchesBoard(task) && matchesSearch(task, needle, names))
      .sort((a, b) => {
        const left = COLUMNS.findIndex((column) => column.code === a.column);
        const right = COLUMNS.findIndex((column) => column.code === b.column);
        return left - right || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "tr");
      });
  }

  async function addSpace() {
    const result = await createSpaceAction({ name: spaceName });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setSpaceName("");
    setAdding(false);
    if (result.id) setSpaceId(result.id);
    refreshQuiet(router);
  }

  async function place(taskId, column, index, items) {
    if (moveLock.current > 0) return { ok: false, message: "Kart taşıması sürüyor." };
    const current = tasks.find((task) => task.id === taskId);
    if (!current) return { ok: false, message: "Kart bulunamadı." };
    if (current.column === column) {
      const already = columnTasks(column);
      const from = already.findIndex((task) => task.id === taskId);
      const without = already.filter((task) => task.id !== taskId);
      const at = Math.max(0, Math.min(index, without.length));
      if (from === at) return { ok: true };
    }
    const missingOwner = !current.dueOn || (current.assigneeIds ?? []).length === 0;
    if (column !== current.column && column === "DOING" && missingOwner) {
      setMessage(DOING_GATE);
      return { ok: false, message: DOING_GATE };
    }
    if (column !== current.column && column === "REVIEW" && (current.revisions ?? []).some((item) => !item.done)) {
      setMessage(REVIEW_GATE);
      return { ok: false, message: REVIEW_GATE };
    }
    if (data.viewerRole !== "ADMIN" && column === "DONE" && current.column !== "DONE") {
      setMessage(DONE_GATE);
      return { ok: false, message: DONE_GATE };
    }
    if (column !== current.column && column === "REVISION" && !items) {
      if (data.viewerRole !== "ADMIN") {
        setMessage("Revize maddelerini yönetici girer.");
        return { ok: false, message: "Revize maddelerini yönetici girer." };
      }
      setRevision({ mode: "move", taskId, index });
      return { ok: true, pendingRevision: true };
    }
    const destination = columnTasks(column).filter((task) => task.id !== taskId);
    const at = Math.max(0, Math.min(index, destination.length));
    const nextColumn = [
      ...destination.slice(0, at),
      {
        ...current,
        column,
        completed: column === "DONE" ? true : current.column === "DONE" ? false : current.completed,
      },
      ...destination.slice(at),
    ];
    const previous = tasks;
    const columnChanged = column !== current.column;
    moveLock.current += 1;
    setTasks([
      ...tasks.filter((task) => task.spaceId !== spaceId || (task.column !== column && task.id !== taskId)),
      ...nextColumn.map((task, order) => ({ ...task, sortOrder: order })),
    ]);
    try {
      const result = await moveTaskAction({
        taskId,
        column,
        orderedIds: nextColumn.map((task) => task.id),
        ...(items ? { items } : {}),
      });
      if (!result?.ok) {
        setTasks(previous);
        setMessage(result?.message || "Kart taşınamadı.");
        moveLock.current = Math.max(0, moveLock.current - 1);
        return result;
      }
      if (columnChanged) {
        refreshQuiet(router);
        window.setTimeout(() => {
          moveLock.current = Math.max(0, moveLock.current - 1);
        }, 1200);
      } else {
        moveLock.current = Math.max(0, moveLock.current - 1);
      }
      return result;
    } catch (error) {
      setTasks(previous);
      setMessage("Kart taşınamadı. Yeniden deneyin.");
      moveLock.current = Math.max(0, moveLock.current - 1);
      return { ok: false, message: "Kart taşınamadı. Yeniden deneyin." };
    }
  }

  async function toggleRevision(taskId, item) {
    const next = !item.done;
    const previous = tasks;
    setTasks(tasks.map((task) => task.id === taskId ? {
      ...task,
      revisions: (task.revisions ?? []).map((row) => row.id === item.id ? { ...row, done: next } : row),
    } : task));
    const result = await setRevisionAction({ id: item.id, done: next });
    if (!result.ok) {
      setTasks(previous);
      setMessage(result.message);
    }
  }

  function confirmRevision(items) {
    if (!revision) return;
    const current = revision;
    setRevision(null);
    if (current.mode === "move") {
      void place(current.taskId, "REVISION", current.index, items).then((result) => {
        if (!result?.ok) setRevision(current);
      });
      return;
    }
    if (current.payload?.id) {
      patchTask(current.payload.id, (task) => ({
        ...task,
        ...current.payload,
        column: "REVISION",
        revisions: items.map((body, index) => ({ id: `local-rev-${index}`, body, done: false })),
        revisionCount: items.length,
      }));
    }
    setEditor(null);
    void saveTaskAction({ ...current.payload, items }).then((result) => {
      if (!result.ok) setMessage(result.message);
      refreshQuiet(router);
    });
  }

  function dropOnColumn(column, targetId) {
    const taskId = dragging.current;
    dragging.current = null;
    setOver(null);
    if (!taskId) return;
    const list = columnTasks(column).filter((task) => task.id !== taskId);
    const found = targetId ? list.findIndex((task) => task.id === targetId) : list.length;
    void place(taskId, column, found < 0 ? list.length : found);
  }

  async function createQuickCard(title, column) {
    if (column === "DONE" && data.viewerRole !== "ADMIN") {
      setMessage(DONE_GATE);
      return false;
    }
    if (column === "DOING") {
      setMessage(DOING_GATE);
      return false;
    }
    if (column === "REVISION") {
      setMessage("Revize sütununa kart eklemek için önce kontrol listesi gerekir. Kartı İş Havuzu'na ekleyip taşıyın.");
      return false;
    }
    const localId = `local-${Date.now()}`;
    const optimistic = {
      id: localId,
      spaceId,
      title,
      detail: "",
      column,
      priority: "NORMAL",
      startsOn: null,
      startsAt: null,
      endsAt: null,
      dueOn: null,
      assigneeIds: [],
      completed: column === "DONE",
      archived: false,
      sortOrder: Date.now(),
      createdByName: viewerName || "",
      createdById: data.viewerId,
      createdAt: new Date().toISOString(),
      commentCount: 0,
      comments: [],
      links: [],
      images: [],
      revisions: [],
      revisionCount: 0,
      unreadComments: 0,
      enforced: false,
      moves: [],
    };
    setTasks((current) => [...current, optimistic]);
    setComposing(null);
    const result = await saveTaskAction({
      spaceId,
      title,
      detail: "",
      column,
      priority: "NORMAL",
      startsOn: null,
      startsAt: null,
      endsAt: null,
      dueOn: null,
      assigneeIds: [],
    });
    if (!result.ok) {
      setTasks((current) => current.filter((task) => task.id !== localId));
      setMessage(result.message);
      return false;
    }
    refreshQuiet(router);
    return true;
  }

  async function archiveDoneCards() {
    if (data.viewerRole !== "ADMIN") {
      setMessage("Tamamlananları yalnızca yönetici arşivleyebilir.");
      return;
    }
    const doneCards = columnTasks("DONE");
    if (doneCards.length === 0) {
      setMessage("Arşivlenecek tamamlanan kart yok.");
      return;
    }
    if (!window.confirm(`${doneCards.length} tamamlanan kart arşivlensin mi?`)) return;
    setArchiving(true);
    const ids = new Set(doneCards.map((task) => task.id));
    setTasks((current) => current.filter((task) => !ids.has(task.id)));
    const result = await archiveDoneTasksAction({ spaceId });
    setArchiving(false);
    if (!result.ok) {
      setMessage(result.message);
      refreshQuiet(router);
      return;
    }
    setMessage(result.message);
    refreshQuiet(router);
  }

  async function toggleComplete(task) {
    if (data.viewerRole !== "ADMIN") {
      setMessage(DONE_GATE);
      return;
    }
    const done = isDone(task);
    if (done && task.column === "DONE" && (!task.dueOn || task.assigneeIds.length === 0)) {
      setMessage(DOING_GATE);
      return;
    }
    const previous = tasks;
    setTasks(tasks.map((item) => item.id === task.id ? {
      ...item,
      completed: !done,
      column: done && item.column === "DONE" ? "DOING" : item.column,
    } : item));
    const result = await setTaskCompletedAction({ id: task.id, completed: !done });
    if (!result.ok) {
      setTasks(previous);
      setMessage(result.message);
    }
  }

  return (
    <div className="-mx-4 flex flex-col sm:-mx-6 lg:-mx-8">
      <header className="space-y-3 px-4 pb-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {data.spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                className={space.id === spaceId
                  ? "rounded-full bg-[#03624c] px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                  : "rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-800"}
                onClick={() => setSpaceId(space.id)}
              >
                {space.name}
              </button>
            ))}
            {adding ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addSpace();
                }}
              >
                <input
                  value={spaceName}
                  onChange={(event) => setSpaceName(event.target.value)}
                  className="field w-36"
                  placeholder="Yeni alan"
                  aria-label="Yeni alan"
                  autoFocus
                />
                <button type="submit" className="btn-primary">Ekle</button>
                <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setSpaceName(""); }}>Vazgeç</button>
              </form>
            ) : (
              <button type="button" className="rounded-full border border-dashed border-slate-300 px-4 py-1.5 text-sm font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700" onClick={() => setAdding(true)}>
                + Alan ekle
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {QUICK_FILTERS.map((item) => {
              const active = filtre === item.key;
              return (
                <Link
                  key={item.key}
                  href={active ? "/is-takibi" : `/is-takibi?filtre=${item.key}`}
                  className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium no-underline transition-colors ${active ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"}`}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="relative" ref={assigneeMenuRef}>
              <button
                type="button"
                aria-expanded={assigneeOpen}
                className={`inline-flex h-8 items-center gap-2 rounded-full px-2.5 text-xs font-medium transition-colors ${assigneeFilter ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"}`}
                onClick={() => setAssigneeOpen((open) => !open)}
              >
                {assigneePerson ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: colors.get(assigneePerson.id) ?? "#03624c" }}>
                    {initials(assigneePerson.name)}
                  </span>
                ) : (
                  <UserRound size={13} aria-hidden="true" />
                )}
                {assigneePerson ? assigneePerson.name.split(" ")[0] : "Atanan"}
              </button>
              {assigneeOpen ? (
                <div className="absolute left-0 top-full z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      setAssigneeFilter("");
                      setAssigneeOpen(false);
                    }}
                  >
                    Herkes
                  </button>
                  {data.people.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50 ${assigneeFilter === person.id ? "bg-slate-50 text-[#03624c]" : "text-slate-700"}`}
                      onClick={() => {
                        setAssigneeFilter(person.id);
                        setAssigneeOpen(false);
                      }}
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: colors.get(person.id) ?? "#03624c" }}>
                        {initials(person.name)}
                      </span>
                      {person.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {filtre && WORK_FILTERS[filtre] && !QUICK_FILTERS.some((item) => item.key === filtre) ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                {WORK_FILTERS[filtre]}
                <Link href="/is-takibi" className="text-[#03624c] no-underline">Kaldır</Link>
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <Link
                href="/is-takibi"
                className="inline-flex h-7 items-center rounded-md bg-white px-2.5 text-xs font-medium text-slate-800 no-underline shadow-sm"
              >
                Kartlar
              </Link>
              <Link
                href="/is-takibi?sekme=calisma"
                className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-slate-500 no-underline hover:text-slate-700"
              >
                Çalışma
              </Link>
              <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden="true" />
              <button
                type="button"
                aria-pressed={view === "board"}
                aria-label="Pano görünümü"
                title="Pano"
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ${view === "board" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                onClick={() => setView("board")}
              >
                <LayoutGrid size={13} aria-hidden="true" />
                Pano
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                aria-label="Liste görünümü"
                title="Liste"
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ${view === "list" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                onClick={() => setView("list")}
              >
                <List size={13} aria-hidden="true" />
                Liste
              </button>
            </div>
            <label className="relative inline-flex h-8 items-center">
              <Search size={14} className="pointer-events-none absolute left-2.5 text-slate-400" aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="field h-8 w-52 pl-8 text-sm"
                placeholder="Kart ara..."
                aria-label="Kart ara"
              />
            </label>
          </div>
        </div>
        {message ? <Notice tone="err">{message}</Notice> : null}
      </header>

      {view === "list" ? (
        <div className="px-4 pb-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,1.6fr)_120px_110px_120px_100px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Görev</span>
              <span>Durum</span>
              <span>Öncelik</span>
              <span>Tarih</span>
              <span>Atanan</span>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleTasks().length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">Bu filtreye uyan kart yok.</p>
              ) : (
                visibleTasks().map((task) => {
                  const priority = PRIORITY[task.priority] ?? PRIORITY.NORMAL;
                  const when = dueTone(task, data.today, data.now);
                  const progress = revisionProgress(task);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="grid w-full grid-cols-[minmax(0,1.6fr)_120px_110px_120px_100px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                      onClick={() => setEditor({ id: task.id, column: task.column })}
                    >
                      <span className="min-w-0">
                        <span className={`block truncate text-sm font-semibold ${isDone(task) ? "text-slate-400 line-through" : "text-slate-800"}`}>{task.title}</span>
                        {progress ? (
                          <span className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                            <ListTodo size={12} aria-hidden="true" />
                            <span className="tabular-nums">{progress.doneCount}/{progress.total}</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-xs font-medium text-slate-500">{columnName(task.column)}</span>
                      <span className={`inline-flex w-fit ${priority.className}`}>{priority.short}</span>
                      <span className={when ? `inline-flex w-fit ${when.className}` : "text-xs text-slate-400"}>
                        {when ? <><Clock size={11} />{when.label}</> : "—"}
                      </span>
                      <span className="flex -space-x-1.5">
                        {task.assigneeIds.map((id) => (
                          <span key={id} title={names.get(id)} className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[9px] font-semibold text-white" style={{ background: colors.get(id) ?? "#03624c" }}>
                            {initials(names.get(id) ?? "")}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : (
      <div className="flex h-[calc(100dvh-11rem)] shrink-0 gap-3 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-8">
        {COLUMNS.map((column) => {
          const cards = columnTasks(column.code);
          return (
            <section
              key={column.code}
              className={`flex h-full w-[18.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border transition-all duration-150 ${over === column.code ? "border-emerald-300 bg-slate-100/80 shadow-md ring-2 ring-emerald-500/20" : "border-slate-200 bg-slate-50/90"}`}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(column.code);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropOnColumn(column.code);
              }}
            >
              <header className="border-b border-slate-200/80 bg-white/95 px-3.5 py-3 backdrop-blur">
                <div className={`mb-2.5 h-1 rounded-full ${column.bar}`} />
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-sm font-bold leading-tight tracking-tight text-slate-800">{column.name}</h2>
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                    {cards.length}
                  </span>
                </div>
                {column.code === "DONE" && data.viewerRole === "ADMIN" && cards.length > 0 ? (
                  <button
                    type="button"
                    disabled={archiving}
                    className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                    onClick={() => void archiveDoneCards()}
                  >
                    <Archive size={12} />
                    {archiving ? "Arşivleniyor…" : "Tamamlananları Arşivle"}
                  </button>
                ) : null}
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5">
                {cards.map((task) => {
                  const unread = clearedComments[task.id] === task.commentCount ? 0 : (task.unreadComments ?? 0);
                  const live = nowList.filter((item) => item.taskId === task.id);
                  const mine = live.some((item) => item.userId === data.viewerId);
                  const pausedMine = pausedList.some((item) => item.taskId === task.id && item.userId === data.viewerId);
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      column={column.code}
                      today={data.today}
                      nowIso={data.now}
                      colors={colors}
                      names={names}
                      focusing={focusing}
                      live={live}
                      mine={mine}
                      pausedMine={pausedMine}
                      unread={unread}
                      spaceLabel=""
                      onOpen={() => {
                        if (moved.current) return;
                        setEditor({ id: task.id, column: task.column });
                      }}
                      onFocus={() => void chooseFocus(task.id)}
                      onDragStart={(event) => {
                        if (event.target.closest("[data-no-drag]")) {
                          event.preventDefault();
                          return;
                        }
                        dragging.current = task.id;
                        moved.current = true;
                      }}
                      onDragEnd={() => {
                        setOver(null);
                        window.setTimeout(() => {
                          moved.current = false;
                        }, 0);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOver(column.code);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        dropOnColumn(column.code, task.id);
                      }}
                    />
                  );
                })}
              </div>
              {column.code === "DONE" && data.viewerRole !== "ADMIN" ? null : composing === column.code ? (
                <InlineComposer
                  column={column.code}
                  onSubmit={createQuickCard}
                  onCancel={() => setComposing(null)}
                />
              ) : (
                <button
                  type="button"
                  className="mx-2.5 mb-2.5 w-[calc(100%-1.25rem)] shrink-0 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 transition-all hover:border-slate-400 hover:bg-white/50 hover:text-slate-700"
                  onClick={() => setComposing(column.code)}
                >
                  + Kart ekle
                </button>
              )}
            </section>
          );
        })}
      </div>
      )}
      {editor?.id ? (
        <TaskDialog
          key={editor.id}
          task={openTask}
          column={editor.column}
          spaceId={spaceId}
          people={data.people}
          viewerAdmin={data.viewerRole === "ADMIN"}
          viewerId={data.viewerId}
          onClose={() => setEditor(null)}
          onAskRevision={(payload) => setRevision({ mode: "save", payload })}
          onToggleRevision={(taskId, item) => void toggleRevision(taskId, item)}
          onMoveColumn={(taskId, column) => {
            const at = columnTasks(column).filter((task) => task.id !== taskId).length;
            return place(taskId, column, at);
          }}
          patchTask={patchTask}
          report={setMessage}
          viewerName={viewerName}
        />
      ) : null}
      {revision ? <RevisionDialog onClose={() => setRevision(null)} onSave={(items) => void confirmRevision(items)} /> : null}
    </div>
  );
}

function RevisionDialog({ onClose, onSave }) {
  const [rows, setRows] = useState([""]);
  const [warning, setWarning] = useState("");

  function save() {
    const items = rows.map((row) => row.trim()).filter(Boolean);
    if (items.length === 0) {
      setWarning("En az bir revize maddesi yazın.");
      return;
    }
    onSave(items);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="revize-baslik" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="revize-baslik" className="text-lg font-semibold">Revize maddeleri</h2>
        <p className="mt-1 text-sm text-slate-600">Maddeler kartta işaretlenebilir liste olur. Hepsi işaretlenmeden kart Kontrol Ediliyor sütununa geçemez.</p>
        {warning ? <div className="mt-3"><Notice tone="err">{warning}</Notice></div> : null}
        <div className="mt-4 space-y-2">
          {rows.map((row, index) => (
            <input
              key={index}
              value={row}
              onChange={(event) => setRows(rows.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
              className="field"
              placeholder={`Madde ${index + 1}`}
              aria-label={`Revize maddesi ${index + 1}`}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setRows([...rows, ""])}>Madde ekle</button>
          <button type="button" className="btn-primary" onClick={save}>Kaydet</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Vazgeç</button>
        </div>
      </div>
    </div>
  );
}
