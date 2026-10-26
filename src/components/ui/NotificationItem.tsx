import type { ReactNode } from "react";
import Link from "next/link";

export default function NotificationItem({
  title,
  body,
  href,
  read,
  category,
  action,
  icon,
}: {
  title: string;
  body: string;
  href: string;
  read: boolean;
  category: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-3 border-b border-slate-100 py-3 last:border-b-0 sm:flex-row sm:items-center">
      {icon ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          <span className={`h-2 w-2 shrink-0 rounded-full ${read ? "bg-slate-300" : "bg-[#ff5a5f]"}`} aria-hidden="true" />
        </div>
        <p className="truncate text-sm text-slate-500">{body}</p>
        <p className="text-xs text-slate-400">{category} · {read ? "Okundu" : "Okunmadı"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <Link className="font-semibold text-[#03624c]" href={href}>Aç</Link>
        {action}
      </div>
    </article>
  );
}
