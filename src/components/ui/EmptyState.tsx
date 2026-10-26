import type { ReactNode } from "react";

export default function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl px-4 py-8 text-center">
      {icon ? <div className="mb-3 flex justify-center text-slate-300">{icon}</div> : null}
      <p className="font-medium text-slate-700">{title}</p>
      {body ? <p className="mt-1 text-sm text-slate-500">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
