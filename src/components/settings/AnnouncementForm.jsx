"use client";

import { useActionState } from "react";
import Notice from "@/components/Notice";
import { createAnnouncementAction } from "@/app/(panel)/ayarlar/actions";

export default function AnnouncementForm({ items }) {
  const [state, action, pending] = useActionState(createAnnouncementAction, undefined);
  return (
    <section className="panel-card mt-4">
      <h2 className="text-base font-semibold">Duyuru</h2>
      <p className="mt-1 text-sm text-slate-500">Son üç duyuru çalışan ana sayfasında görünür.</p>
      <form action={action} className="mt-3 space-y-3">
        {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
        <textarea name="body" required maxLength={280} rows={3} className="field" placeholder="Kısa bir duyuru yaz" aria-label="Duyuru" />
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Kaydediliyor…" : "Duyuruyu yayınla"}</button>
      </form>
      {items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="border-t border-slate-100 pt-3">
              <p className="text-sm text-slate-800">{item.body}</p>
              <p className="text-xs text-slate-400">{item.createdAt}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
