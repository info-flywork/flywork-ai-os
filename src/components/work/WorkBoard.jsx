"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Clock, MessageCircle, Pause, Pencil, Play } from "lucide-react";
import { reminderKind, taskDeadline } from "@/lib/workDeadline";
import { WORK_FILTERS, matchesWorkFilter } from "@/lib/workPulse";
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
  finishWorkAction,
  setRevisionAction,
  setTaskCompletedAction,
  setWorkFocusAction,
  seeCardAction,
  updateCommentAction,

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
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [brokenImages, setBrokenImages] = useState({});
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const commentRef = useRef(null);
  const editRef = useRef(null);
  const mentionSource = editingId ? draft : comment;
  const mentionQuery = mentionSource.match(/(^|\s)@([^\n@]*)$/)?.[2] ?? null;
  const suggestions = mentionQuery === null ? [] : people.filter((person) => person.name.toLocaleLowerCase("tr").includes(mentionQuery.toLocaleLowerCase("tr"))).slice(0, 6);
  const activeMention = suggestions.length === 0 ? 0 : Math.min(mentionIndex, suggestions.length - 1);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

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

  async function saveComment() {
    if (!editingId) return;
    setPending(true);
    const result = await updateCommentAction({ id: editingId, body: draft });
    setPending(false);
    setState(result);
    if (result.ok) {
      setEditingId(null);
      setDraft("");
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

  async function sendImages(files) {
    if (!task || files.length === 0) return;
    setPending(true);
    let added = 0;
    let failure = null;
    for (const file of files) {
      const form = new FormData();
      form.set("taskId", task.id);
      form.set("file", file);
      const result = await addImageAction(form);
      if (!result.ok) {
        failure = result;
        break;
      }
      added += 1;
    }
    setPending(false);
    if (failure) {
      setState(added > 0 ? { ok: false, message: `${added} görsel eklendi. ${failure.message}` } : failure);
    }
    if (added > 0) router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="kart-baslik" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="kart-baslik" className="text-lg font-semibold">{task ? "Kart" : "Kart ekle"}</h2>
        {task?.createdByName ? (
          <div className="mt-3 flex items-start gap-3">
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
                {COLUMNS.filter((item) => viewerAdmin || item.code !== "DONE" || task?.column === "DONE").map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
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
            <label className="text-sm">Teslim tarihi{required ? " (zorunlu)" : ""}
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
            <p className="text-sm font-semibold">Sorumlu kişi{required ? " (zorunlu)" : ""}</p>
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
          {task && viewerAdmin ? <button type="button" className="btn-secondary text-red-600" disabled={pending} onClick={() => void remove()}>Sil</button> : null}
        </div>
        {task ? (
          <div className="mt-6 space-y-4 border-t border-slate-200 pt-4">
            {(task.revisions ?? []).length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold">Revize maddeleri</h3>
                <ul className="mt-2 space-y-1">
                  {task.revisions.map((item) => (
                    <li key={item.id}>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={item.done} onChange={() => onToggleRevision(task.id, item)} />
                        <span className={item.done ? "text-slate-400 line-through" : "text-slate-800"}>{item.body}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <h3 className="text-sm font-semibold">Hareketler</h3>
              {(task.moves ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Henüz sütun hareketi yok.</p>
              ) : (
                <ol className="mt-2 space-y-1">
                  {task.moves.map((move) => (
                    <li key={move.id} className="text-sm text-slate-700">
                      <span className="font-semibold">{columnName(move.column)}</span>
                      {" · "}
                      {createdStamp(move.createdAt)}
                      {" · "}
                      {move.actorName}
                    </li>
                  ))}
                </ol>
              )}
            </section>
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
              <div className="mt-2 flex flex-col gap-3">
                {task.images.map((image) => (
                  <figure key={image.id} className="relative">
                    {brokenImages[image.id] ? (
                      <div className="flex min-h-24 items-center rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">Görsel dosyası bulunamadı. Yeniden ekleyin.</div>
                    ) : (
                      <a href={`/api/is-gorsel/${image.id}`} target="_blank" rel="noreferrer">
                        <img
                          src={`/api/is-gorsel/${image.id}`}
                          alt=""
                          className="max-h-80 w-full rounded-xl bg-slate-50 object-contain"
                          onError={() => setBrokenImages((current) => ({ ...current, [image.id]: true }))}
                        />
                      </a>
                    )}
                    {viewerAdmin ? <button type="button" className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold shadow" onClick={() => void removeImageAction(image.id)}>Sil</button> : null}
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
                  <li key={item.id} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-500">{item.authorName} · {item.createdAt}</p>
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
                      <p className="mt-1 whitespace-pre-wrap text-sm"><CommentBody body={item.body} people={people} /></p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="relative mt-2">
                {!editingId && suggestions.length > 0 ? (
                  <MentionChoices suggestions={suggestions} activeMention={activeMention} people={people} onHover={setMentionIndex} onPick={insertMention} />
                ) : null}
                <textarea ref={commentRef} value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={onCommentKeyDown} rows={3} placeholder="Yorum yazın. Etiket için @ yazın." className="field" />
              </div>
              <button type="button" className="btn-primary mt-2" disabled={pending} onClick={() => void sendComment()}>Yorum ekle</button>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function shiftIsoDay(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayHeading(iso, today) {
  if (iso === today) return "Bugün";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

export default function WorkBoard({
  data,
  filtre = "",
  kart = "",
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
  const [focusing, setFocusing] = useState(false);
  const [revision, setRevision] = useState(null);
  const [historyDay, setHistoryDay] = useState(data.today);
  const [clearedComments, setClearedComments] = useState({});
  const dragging = useRef(null);
  const moved = useRef(false);
  const openedKart = useRef(false);
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
    if (openedKart.current || !kart) return;
    const task = tasks.find((item) => item.id === kart);
    if (!task) return;
    openedKart.current = true;
    setSpaceId(task.spaceId);
    setEditor({ id: task.id, column: task.column });
  }, [kart, tasks]);

  useEffect(() => {
    if (!filtre) return;
    if (tasks.some((task) => task.spaceId === spaceId && matchesWorkFilter(task, filtre, data.today))) return;
    const next = data.spaces.find((space) => tasks.some((task) => task.spaceId === space.id && matchesWorkFilter(task, filtre, data.today)));
    if (next && next.id !== spaceId) setSpaceId(next.id);
  }, [filtre, tasks, spaceId, data.spaces, data.today]);

  useEffect(() => {
    if (!editor?.id) {
      return undefined;
    }
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [editor?.id, router]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (dragging.current) return;
      router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  const day = data.day ?? { now: [], earlier: [], log: [] };
  const lookingAt = day.team ? historyDay : data.today;
  const archive = day.team ? (day.log ?? []).filter((item) => item.day === lookingAt) : day.earlier;
  const oldestDay = shiftIsoDay(data.today, -60);

  async function chooseFocus(taskId) {
    setFocusing(true);
    const result = await setWorkFocusAction(taskId);
    setFocusing(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  async function finishFocus(taskId) {
    setFocusing(true);
    const result = await finishWorkAction(taskId);
    setFocusing(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  function openFocused(item) {
    if (!item.taskId) return;
    const task = tasks.find((row) => row.id === item.taskId);
    if (item.spaceId) setSpaceId(item.spaceId);
    if (task) setEditor({ id: task.id, column: task.column });
  }

  const names = new Map(data.people.map((person) => [person.id, person.name]));
  const colors = personColors(data.people);
  const openTask = editor?.id ? tasks.find((task) => task.id === editor.id) ?? null : null;
  const openCommentCount = openTask?.commentCount ?? null;

  useEffect(() => {
    if (!editor?.id || openCommentCount == null) return undefined;
    setClearedComments((current) => current[editor.id] === openCommentCount ? current : { ...current, [editor.id]: openCommentCount });
    let cancel = false;
    void seeCardAction(editor.id).then((result) => {
      if (!cancel && result?.ok) router.refresh();
    });
    return () => {
      cancel = true;
    };
  }, [editor?.id, openCommentCount, router]);

  function columnTasks(column) {
    return tasks
      .filter((task) => task.spaceId === spaceId && task.column === column && matchesWorkFilter(task, filtre, data.today))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "tr"));
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

  async function place(taskId, column, index, items) {
    const current = tasks.find((task) => task.id === taskId);
    if (!current) return;
    const missingOwner = !current.dueOn || current.assigneeIds.length === 0;
    if (column !== current.column && column === "DOING" && missingOwner) {
      setMessage(DOING_GATE);
      return;
    }
    if (column !== current.column && column === "REVIEW" && (current.revisions ?? []).some((item) => !item.done)) {
      setMessage(REVIEW_GATE);
      return;
    }
    if (data.viewerRole !== "ADMIN" && column === "DONE" && current.column !== "DONE") {
      setMessage(DONE_GATE);
      return;
    }
    if (column !== current.column && column === "REVISION" && !items) {
      if (data.viewerRole !== "ADMIN") {
        setMessage("Revize maddelerini yönetici girer.");
        return;
      }
      setRevision({ mode: "move", taskId, index });
      return;
    }
    const destination = columnTasks(column).filter((task) => task.id !== taskId);
    const nextColumn = [...destination.slice(0, index), { ...current, column, completed: column === "DONE" ? true : current.column === "DONE" ? false : current.completed }, ...destination.slice(index)];
    const previous = tasks;
    setTasks([
      ...tasks.filter((task) => task.spaceId !== spaceId || (task.column !== column && task.id !== taskId)),
      ...nextColumn.map((task, order) => ({ ...task, sortOrder: order })),
    ]);
    const result = await moveTaskAction({
      taskId,
      column,
      orderedIds: nextColumn.map((task) => task.id),
      ...(items ? { items } : {}),
    });
    if (!result.ok) {
      setTasks(previous);
      setMessage(result.message);
      return result;
    }
    if (column !== current.column) router.refresh();
    return result;
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

  async function confirmRevision(items) {
    if (!revision) return;
    if (revision.mode === "move") {
      const result = await place(revision.taskId, "REVISION", revision.index, items);
      if (result?.ok) setRevision(null);
      return;
    }
    const result = await saveTaskAction({ ...revision.payload, items });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setRevision(null);
    setEditor(null);
    router.refresh();
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
      <header className="px-4 pb-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">İş Takibi</h1>
          {filtre && WORK_FILTERS[filtre] ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
              {WORK_FILTERS[filtre]}
              <Link href="/is-takibi" className="text-[#03624c]">Kaldır</Link>
            </span>
          ) : null}
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
        <section className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 sm:grid-cols-[auto_1fr]">
          <p className="pt-1 text-xs font-bold uppercase tracking-wide text-[#03624c]">Şu an</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {day.now.filter((item) => item.userId === data.viewerId).map((item) => (
              <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-emerald-50 py-1 pl-1 pr-2 text-sm">
                <button type="button" className="inline-flex min-w-0 items-center gap-2" onClick={() => openFocused(item)}>
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(item.userId) ?? "#03624c" }}>{initials(item.userName)}</span>
                  <span className="shrink-0 font-semibold text-slate-800">{item.userName}</span>
                  <span className="truncate text-slate-600">{item.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{item.startedLabel}</span>
                </button>
                <button type="button" className="shrink-0 text-xs font-semibold text-[#03624c]" disabled={focusing} onClick={() => void chooseFocus(item.taskId)}>Durdur</button>
                <button type="button" className="shrink-0 text-xs font-semibold text-emerald-700" disabled={focusing} onClick={() => void finishFocus(item.taskId)}>Bitir</button>
              </span>
            ))}
            {day.team ? day.roster.map((person) => {
              const held = person.current ? null : person.paused;
              return (
                <span key={person.userId} className={`inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm ${person.current ? "bg-emerald-50" : held ? "bg-amber-50" : "bg-slate-50"}`}>
                  <button type="button" className="inline-flex min-w-0 items-center gap-2" disabled={!person.current && !held} onClick={() => openFocused(person.current || held)}>
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(person.userId) ?? "#03624c" }}>{initials(person.userName)}</span>
                    <span className="shrink-0 font-semibold text-slate-800">{person.userName}</span>
                    <span className={`truncate ${person.current || held ? "text-slate-600" : "text-slate-400"}`}>{person.current ? person.current.title : held ? held.title : "iş seçmedi"}</span>
                    {person.current ? <span className="shrink-0 text-xs text-slate-400">{person.current.startedLabel}</span> : null}
                    {held ? <span className="shrink-0 text-xs font-semibold text-amber-700">durdu</span> : null}
                  </button>
                </span>
              );
            }) : null}
            {!day.team && day.now.every((item) => item.userId !== data.viewerId) ? (
              <p className="py-1 text-sm text-slate-500">Karttaki oynat düğmesiyle şu anki işini seç.</p>
            ) : null}
          </div>
          {(day.paused ?? []).length > 0 ? (
            <>
              <p className="pt-1 text-xs font-bold uppercase tracking-wide text-amber-700">Durdu</p>
              <div className="flex min-w-0 flex-wrap gap-2">
                {day.paused.map((item) => (
                  <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-amber-50 py-1 pl-3 pr-2 text-sm text-slate-700">
                    <button type="button" className="inline-flex min-w-0 items-center gap-2" onClick={() => openFocused(item)}>
                      <span className="shrink-0 text-xs text-slate-400">{item.pausedLabel}</span>
                      <span className="shrink-0 font-semibold">{item.userName}</span>
                      <span className="truncate">{item.title}</span>
                    </button>
                    {item.userId === data.viewerId ? (
                      <>
                        <button type="button" className="shrink-0 text-xs font-semibold text-[#03624c]" disabled={focusing} onClick={() => void chooseFocus(item.taskId)}>Devam</button>
                        <button type="button" className="shrink-0 text-xs font-semibold text-emerald-700" disabled={focusing} onClick={() => void finishFocus(item.taskId)}>Bitir</button>
                      </>
                    ) : null}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-1 pt-1">
            {day.team ? (
              <button type="button" className="rounded-md px-1 text-sm font-bold text-slate-500 disabled:text-slate-300" aria-label="Önceki gün" disabled={lookingAt <= oldestDay} onClick={() => setHistoryDay(shiftIsoDay(lookingAt, -1))}>‹</button>
            ) : null}
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{dayHeading(lookingAt, data.today)}</p>
            {day.team ? (
              <button type="button" className="rounded-md px-1 text-sm font-bold text-slate-500 disabled:text-slate-300" aria-label="Sonraki gün" disabled={lookingAt >= data.today} onClick={() => setHistoryDay(shiftIsoDay(lookingAt, 1))}>›</button>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            {archive.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">{lookingAt === data.today ? "Bugün kapanan iş yok." : "Bu günde kapanan iş yok."}</p>
            ) : archive.map((item) => (
              <button key={item.id} type="button" className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-700" onClick={() => openFocused(item)}>
                <span className="shrink-0 text-xs text-slate-400">{item.startedLabel}–{item.endedLabel}</span>
                <span className="shrink-0 font-semibold">{item.userName}</span>
                <span className="truncate">{item.title}</span>
                {item.done ? <span className="shrink-0 text-xs font-semibold text-emerald-700">bitti</span> : null}
              </button>
            ))}
          </div>
        </section>
      </header>
      <div className="flex h-[calc(100dvh-8rem)] shrink-0 gap-3 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-8">
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
                  const unread = clearedComments[task.id] === task.commentCount ? 0 : (task.unreadComments ?? 0);
                  const live = day.now.filter((item) => item.taskId === task.id);
                  const mine = live.some((item) => item.userId === data.viewerId);
                  const pausedMine = (day.paused ?? []).some((item) => item.taskId === task.id && item.userId === data.viewerId);
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
                      className={`cursor-grab rounded-xl border bg-white p-3 shadow-sm active:cursor-grabbing ${live.length > 0 ? "border-[#03624c] ring-2 ring-[#03624c]/30" : pausedMine ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-1">
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${PRIORITY[task.priority].className}`}>{PRIORITY[task.priority].label}</span>
                          {task.revisionCount > 0 ? (
                            <span className="inline-flex rounded-md bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">Revize {task.revisionCount}</span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          {done ? null : (
                            <button type="button" data-no-drag disabled={focusing} aria-label={mine ? "Bu işi durdur" : pausedMine ? "Bu işe devam et" : "Şu an bu kartta çalışıyorum"} className={`rounded-full p-1.5 ${mine ? "bg-[#03624c] text-white" : pausedMine ? "border border-amber-400 bg-amber-50 text-amber-700" : "border border-slate-200 text-slate-500"}`} onClick={(event) => {
                                event.stopPropagation();
                                void chooseFocus(task.id);
                              }}>
                              {mine ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                          )}
                          <button type="button" data-no-drag aria-label="Kartı düzenle" className="rounded-full border border-slate-200 p-1.5 text-slate-500" onClick={() => setEditor({ id: task.id, column: task.column })}>
                            <Pencil size={14} />
                          </button>
                        </span>
                      </div>
                      <div className="mt-2 flex items-start gap-2">
                        {data.viewerRole === "ADMIN" ? (
                          <button
                            type="button"
                            data-no-drag
                            aria-label={done ? "Tamamlandı işaretini kaldır" : "Tamamlandı işaretle"}
                            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}
                            onClick={() => void toggleComplete(task)}
                          >
                            {done ? <Check size={12} strokeWidth={3} /> : null}
                          </button>
                        ) : done ? (
                          <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-600 text-white">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        ) : null}
                        <p className={`font-medium leading-snug ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>{task.title}</p>
                      </div>
                      {(task.revisions ?? []).length > 0 ? (
                        <ul className="mt-2 space-y-1 pl-7">
                          {task.revisions.map((item) => (
                            <li key={item.id}>
                              <label data-no-drag className="flex items-start gap-2 text-xs" onClick={(event) => event.stopPropagation()}>
                                <input type="checkbox" className="mt-0.5" checked={item.done} onChange={() => void toggleRevision(task.id, item)} />
                                <span className={item.done ? "text-slate-400 line-through" : "text-slate-700"}>{item.body}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {task.images.length > 0 ? (
                        <div className="mt-2 flex gap-1 pl-7">
                          {task.images.slice(0, 3).map((image) => (
                            <img key={image.id} src={`/api/is-gorsel/${image.id}`} alt="" className="h-10 w-10 rounded-lg object-cover" />
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {unread > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#dc2626] px-1.5 py-1 text-xs font-bold text-white" aria-label={`${unread} yeni yorum`}>
                            <Bell size={14} />
                            {unread}
                          </span>
                        ) : null}
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
              {column.code === "DONE" && data.viewerRole !== "ADMIN" ? null : (
                <button
                  type="button"
                  className="mx-3 mb-3 shrink-0 rounded-2xl bg-[#03624c] px-3 py-3 text-sm font-semibold text-white shadow-sm"
                  onClick={() => setEditor({ id: null, column: column.code })}
                >
                  + Kart ekle
                </button>
              )}
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
          viewerAdmin={data.viewerRole === "ADMIN"}
          viewerId={data.viewerId}
          onClose={() => setEditor(null)}
          onAskRevision={(payload) => setRevision({ mode: "save", payload })}
          onToggleRevision={(taskId, item) => void toggleRevision(taskId, item)}
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
