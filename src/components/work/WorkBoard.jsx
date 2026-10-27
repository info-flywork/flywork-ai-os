"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, MessageCircle, Pencil } from "lucide-react";
import { reminderKind, taskDeadline } from "@/lib/workDeadline";
import Notice from "@/components/Notice";
import {
  addCommentAction,
  addImageAction,
  addLinkAction,
  deleteTaskAction,
  moveTaskAction,
  removeImageAction,
  removeLinkAction,
  createSpaceAction,
  saveTaskAction,
  setTaskCompletedAction,

} from "@/app/(panel)/is-takibi/actions";



























const COLUMNS = [
  { code: "POOL", name: "İş Havuzu", bar: "bg-slate-500" },
  { code: "DOING", name: "Yapılıyor", bar: "bg-[#03624c]" },
  { code: "REVIEW", name: "Kontrol Ediliyor", bar: "bg-amber-500" },
  { code: "REVISION", name: "Revize Ediliyor", bar: "bg-orange-500" },
  { code: "DONE", name: "Tamamlandı", bar: "bg-emerald-600" },
];

const PRIORITY = {
  URGENT: { label: "P0 — Acil", className: "bg-red-100 text-red-700" },
  HIGH: { label: "P1 — Öncelikli", className: "bg-amber-200 text-amber-950" },
  NORMAL: { label: "P2 — Normal", className: "bg-emerald-100 text-emerald-800" },
  LOW: { label: "P3 — Düşük", className: "bg-slate-200 text-slate-600" },
};

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toLocaleUpperCase("tr");
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

function TaskDialog({
  task,
  column,
  spaceId,
  people,
  onClose,
}





) {
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
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(false);
  const mentionQuery = comment.match(/(^|\s)@([^\n@]*)$/)?.[2] ?? null;
  const suggestions = mentionQuery === null ? [] : people.filter((person) => person.name.toLocaleLowerCase("tr").includes(mentionQuery.toLocaleLowerCase("tr"))).slice(0, 6);

  function insertMention(name) {
    setComment((current) => current.replace(/(^|\s)@[^\n@]*$/, `$1@${name} `));
  }

  async function save() {
    setPending(true);
    const result = await saveTaskAction({
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
    setPending(false);
    setState(result);
    if (result.ok) onClose();
  }

  async function remove() {
    if (!task || !window.confirm("Bu kart silinsin mi?")) return;
    setPending(true);
    const result = await deleteTaskAction(task.id);
    setPending(false);
    if (result.ok) onClose();
    else setState(result);
  }

  async function sendComment() {
    if (!task) return;
    setPending(true);
    const result = await addCommentAction({ taskId: task.id, body: comment });
    setPending(false);
    setState(result);
    if (result.ok) {
      setComment("");
      router.refresh();
    }
  }

  async function sendLink() {
    if (!task) return;
    setPending(true);
    const result = await addLinkAction({ taskId: task.id, url: linkUrl, label: linkLabel });
    setPending(false);
    setState(result);
    if (result.ok) {
      setLinkUrl("");
      setLinkLabel("");
      router.refresh();
    }
  }

  async function sendImage(file) {
    if (!task) return;
    const form = new FormData();
    form.set("taskId", task.id);
    form.set("file", file);
    setPending(true);
    const result = await addImageAction(form);
    setPending(false);
    setState(result);
    if (result.ok) router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="kart-baslik" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="kart-baslik" className="text-lg font-semibold">{task ? "Kart" : "Kart ekle"}</h2>
        {state && !state.ok ? <div className="mt-3"><Notice tone="err">{state.message}</Notice></div> : null}
        <div className="mt-4 space-y-3">
          <label className="block text-sm">Başlık
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="field mt-1" />
          </label>
          <label className="block text-sm">Açıklama
            <textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={3} className="field mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Kolon
              <select value={target} onChange={(event) => setTarget(event.target.value )} className="field mt-1">
                {COLUMNS.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Öncelik
              <select value={priority} onChange={(event) => setPriority(event.target.value )} className="field mt-1">
                {Object.entries(PRIORITY).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-sm">Başlangıç tarihi
              <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="field mt-1" />
            </label>
            <label className="text-sm">Bitiş tarihi
              <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} className="field mt-1" />
            </label>
            <label className="text-sm">Başlangıç saati
              <input type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="field mt-1" />
            </label>
            <label className="text-sm">Bitiş saati
              <input type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="field mt-1" />
            </label>
          </div>
          <div>
            <p className="text-sm font-semibold">Atananlar</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {people.map((person) => {
                const on = selected.includes(person.id);
                return (
                  <label key={person.id} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${on ? "border-[#03624c] bg-[#03624c]/10" : "border-slate-200"}`}>
                    <input type="checkbox" checked={on} onChange={() => setSelected((current) => on ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                    {person.name}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={pending} onClick={() => void save()}>{pending ? "Kaydediliyor…" : "Kaydet"}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Vazgeç</button>
          {task ? <button type="button" className="btn-secondary text-red-600" disabled={pending} onClick={() => void remove()}>Sil</button> : null}
        </div>
        {task ? (
          <div className="mt-6 space-y-4 border-t border-slate-200 pt-4">
            <section>
              <h3 className="text-sm font-semibold">Linkler</h3>
              <ul className="mt-2 space-y-1">
                {task.links.map((link) => (
                  <li key={link.id} className="flex items-center gap-2 text-sm">
                    <a href={link.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-[#03624c] underline">{link.label}</a>
                    <button type="button" className="text-slate-500" onClick={() => void removeLinkAction(link.id)}>Kaldır</button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" className="field" />
                <input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="Ad" className="field" />
                <button type="button" className="btn-secondary" disabled={pending} onClick={() => void sendLink()}>Link ekle</button>
              </div>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Görseller</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {task.images.map((image) => (
                  <figure key={image.id} className="relative">
                    <img src={`/api/is-gorsel/${image.id}`} alt="" className="h-24 w-24 rounded-xl object-cover" />
                    <button type="button" className="absolute right-1 top-1 rounded-full bg-white px-2 text-xs font-semibold" onClick={() => void removeImageAction(image.id)}>Sil</button>
                  </figure>
                ))}
              </div>
              <label className="btn-secondary mt-2">
                Görsel ekle
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void sendImage(file);
                  event.target.value = "";
                }} />
              </label>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Yorumlar</h3>
              <ul className="mt-2 space-y-3">
                {task.comments.map((item) => (
                  <li key={item.id} className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-500">{item.authorName} · {item.createdAt}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm"><CommentBody body={item.body} people={people} /></p>
                  </li>
                ))}
              </ul>
              <div className="relative mt-2">
                {suggestions.length > 0 ? (
                  <ul className="absolute bottom-full mb-1 w-full rounded-xl border border-slate-200 bg-white shadow">
                    {suggestions.map((person) => (
                      <li key={person.id}>
                        <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => insertMention(person.name)}>{person.name}</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Yorum yazın. Etiket için @ yazın." className="field" />
              </div>
              <button type="button" className="btn-primary mt-2" disabled={pending} onClick={() => void sendComment()}>Yorum ekle</button>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function WorkBoard({
  data,
}

) {
  const router = useRouter();
  const [tasks, setTasks] = useState(data.tasks);
  const [spaceId, setSpaceId] = useState(data.spaces[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState(null);
  const [over, setOver] = useState(null);
  const dragging = useRef(null);
  const moved = useRef(false);
  const incoming = JSON.stringify(data.tasks);

  useEffect(() => {
    setTasks(data.tasks);
  }, [incoming, data.tasks]);

  useEffect(() => {
    if (!data.spaces.some((space) => space.id === spaceId)) {
      setSpaceId(data.spaces[0]?.id ?? "");
    }
  }, [data.spaces, spaceId]);

  useEffect(() => {
    if (!editor?.id) {
      return undefined;
    }
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [editor?.id, router]);

  const names = new Map(data.people.map((person) => [person.id, person.name]));
  const colors = personColors(data.people);
  const openTask = editor?.id ? tasks.find((task) => task.id === editor.id) ?? null : null;

  function columnTasks(column) {
    return tasks.filter((task) => task.spaceId === spaceId && task.column === column).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "tr"));
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
    router.refresh();
  }

  async function place(taskId, column, index) {
    const current = tasks.find((task) => task.id === taskId);
    if (!current) return;
    const destination = columnTasks(column).filter((task) => task.id !== taskId);
    const nextColumn = [...destination.slice(0, index), { ...current, column, completed: column === "DONE" ? true : current.column === "DONE" ? false : current.completed }, ...destination.slice(index)];
    const previous = tasks;
    setTasks([
      ...tasks.filter((task) => task.spaceId !== spaceId || (task.column !== column && task.id !== taskId)),
      ...nextColumn.map((task, order) => ({ ...task, sortOrder: order })),
    ]);
    const result = await moveTaskAction({ taskId, column, orderedIds: nextColumn.map((task) => task.id) });
    if (!result.ok) {
      setTasks(previous);
      setMessage(result.message);
    }
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

  async function toggleComplete(task) {
    const done = isDone(task);
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
    <div className="-mx-4 flex h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:-mx-6 lg:-mx-8">
      <header className="px-4 pb-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">İş Takibi</h1>
          <div className="flex flex-wrap items-center gap-2">
            {data.spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                className={space.id === spaceId
                  ? "rounded-full bg-[#03624c] px-4 py-1.5 text-sm font-semibold text-white"
                  : "rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700"}
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
              <button type="button" className="rounded-full border border-dashed border-slate-300 px-4 py-1.5 text-sm font-semibold text-slate-600" onClick={() => setAdding(true)}>
                + Alan ekle
              </button>
            )}
          </div>
        </div>
        {message ? <div className="mt-3"><Notice tone="err">{message}</Notice></div> : null}
      </header>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-8">
        {COLUMNS.map((column) => {
          const cards = columnTasks(column.code);
          return (
            <section
              key={column.code}
              className={`flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-3xl border-2 border-slate-300 bg-slate-100 shadow-md ${over === column.code ? "ring-2 ring-[#03624c]" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(column.code);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropOnColumn(column.code);
              }}
            >
              <header className="border-b-2 border-slate-200 bg-white px-4 py-4">
                <div className={`mb-3 h-2 rounded-full ${column.bar}`} />
                <div className="flex items-center gap-2">
                  <h2 className="flex-1 text-base font-bold leading-tight tracking-tight">{column.name}</h2>
                  <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-sm font-semibold text-white">{cards.length}</span>
                </div>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                {cards.map((task) => {
                  const done = isDone(task);
                  const deadline = taskDeadline(task);
                  const kind = deadline ? reminderKind(deadline, new Date(data.now)) : null;
                  const late = Boolean(!done && ((task.dueOn && task.dueOn < data.today) || (deadline && Date.parse(deadline) <= Date.parse(data.now))));
                  const when = scheduleLabel(task);
                  return (
                    <article
                      key={task.id}
                      draggable
                      onDragStart={(event) => {
                        if ((event.target ).closest("[data-no-drag]")) {
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
                      onClick={(event) => {
                        if ((event.target ).closest("[data-no-drag]")) return;
                        if (moved.current) return;
                        setEditor({ id: task.id, column: task.column });
                      }}
                      className="cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${PRIORITY[task.priority].className}`}>{PRIORITY[task.priority].label}</span>
                        <button type="button" data-no-drag aria-label="Kartı düzenle" className="rounded-full border border-slate-200 p-1.5 text-slate-500" onClick={() => setEditor({ id: task.id, column: task.column })}>
                          <Pencil size={14} />
                        </button>
                      </div>
                      <div className="mt-2 flex items-start gap-2">
                        <button
                          type="button"
                          data-no-drag
                          aria-label={done ? "Tamamlandı işaretini kaldır" : "Tamamlandı işaretle"}
                          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}
                          onClick={() => void toggleComplete(task)}
                        >
                          {done ? <Check size={12} strokeWidth={3} /> : null}
                        </button>
                        <p className={`font-medium leading-snug ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>{task.title}</p>
                      </div>
                      {task.images.length > 0 ? (
                        <div className="mt-2 flex gap-1 pl-7">
                          {task.images.slice(0, 3).map((image) => (
                            <img key={image.id} src={`/api/is-gorsel/${image.id}`} alt="" className="h-10 w-10 rounded-lg object-cover" />
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {when ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${done ? "bg-emerald-50 text-emerald-600" : late || kind ? "bg-red-50 text-red-500" : "text-slate-500"}`}>
                            <Clock size={13} />
                            {when}
                          </span>
                        ) : null}
                        {task.commentCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                            <MessageCircle size={14} />
                            {task.commentCount}
                          </span>
                        ) : null}
                        <div className="ml-auto flex -space-x-1.5">
                          {task.assigneeIds.map((id) => {
                            const name = names.get(id) ?? "";
                            return (
                              <span key={id} title={name} className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white" style={{ background: colors.get(id) ?? "#03624c" }}>
                                {initials(name)}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <button
                type="button"
                className="mx-3 mb-3 shrink-0 rounded-2xl bg-[#03624c] px-3 py-3 text-sm font-semibold text-white shadow-sm"
                onClick={() => setEditor({ id: null, column: column.code })}
              >
                + Kart ekle
              </button>
            </section>
          );
        })}
      </div>
      {editor ? (
        <TaskDialog
          key={editor.id ?? editor.column}
          task={openTask}
          column={editor.column}
          spaceId={spaceId}
          people={data.people}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
