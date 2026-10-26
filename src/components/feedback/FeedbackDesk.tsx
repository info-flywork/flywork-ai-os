"use client";

import { useActionState, useEffect, useRef } from "react";
import Notice from "@/components/Notice";
import StatusBadge from "@/components/ui/StatusBadge";
import {
  createFeedbackAction,
  deleteFeedbackAction,
  reviewFeedbackAction,
  type ActionState,
} from "@/app/(panel)/oneri/actions";

type Note = {
  id: string;
  kind: "SUGGESTION" | "COMPLAINT";
  kindLabel: string;
  body: string;
  status: "OPEN" | "REVIEWED";
  statusLabel: string;
  createdAt: string;
  authorName: string | null;
};

function DeleteButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(
    deleteFeedbackAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="shrink-0"
      onSubmit={(event) => {
        if (!window.confirm("Bu ileti silinsin mi?")) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {state && !state.ok ? <Notice tone="err">{state.message}</Notice> : null}
      <button type="submit" disabled={pending} className="btn-secondary">
        {pending ? "Siliniyor…" : "Sil"}
      </button>
    </form>
  );
}

function ReviewButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(
    reviewFeedbackAction,
    undefined,
  );
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="id" value={id} />
      {state && !state.ok ? <Notice tone="err">{state.message}</Notice> : null}
      <button type="submit" disabled={pending} className="btn-secondary">
        {pending ? "Kaydediliyor…" : "İncelendi"}
      </button>
    </form>
  );
}

export default function FeedbackDesk({
  data,
  canReview,
}: {
  data: { admin: boolean; notes: Note[] };
  canReview: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(
    createFeedbackAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Öneri ve Geri Bildirim</h1>
      </header>

      <section className="panel-card">
        <h2 className="section-title">Yeni ileti</h2>
        <form ref={formRef} action={action} className="grid gap-3">
          {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
          <div>
            <label className="mb-1 block text-sm" htmlFor="feedback-kind">Tür</label>
            <select id="feedback-kind" name="kind" defaultValue="SUGGESTION" className="field">
              <option value="SUGGESTION">Öneri</option>
              <option value="COMPLAINT">Şikayet</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm" htmlFor="feedback-body">Metin</label>
            <textarea
              id="feedback-body"
              name="body"
              required
              minLength={5}
              maxLength={2000}
              rows={5}
              className="field"
              placeholder="Öneri veya şikayetinizi yazın."
            />
          </div>
          <div>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "Gönderiliyor…" : "Gönder"}
            </button>
          </div>
        </form>
      </section>

      {data.admin ? <section className="panel-card">
        <h2 className="section-title">Gelen iletiler</h2>
        {data.notes.length === 0 ? (
          <p className="text-sm text-slate-500">Henüz öneri veya şikayet yok.</p>
        ) : (
          <ul>
            {data.notes.map((note) => (
              <li key={note.id} className="border-b border-slate-100 py-4 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={note.kind === "COMPLAINT" ? "bad" : "ok"}>{note.kindLabel}</StatusBadge>
                      <StatusBadge tone={note.status === "REVIEWED" ? "info" : "neutral"}>{note.statusLabel}</StatusBadge>
                      <span className="text-sm text-slate-500">{note.createdAt}</span>
                    </div>
                    {note.authorName ? <p className="mt-2 text-sm font-semibold text-slate-900">{note.authorName}</p> : null}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
                    {canReview && note.status === "OPEN" ? <ReviewButton id={note.id} /> : null}
                  </div>
                  {canReview ? <DeleteButton id={note.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section> : null}
    </div>
  );
}
