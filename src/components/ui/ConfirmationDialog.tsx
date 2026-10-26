"use client";

import { useState, type ReactNode } from "react";

export default function ConfirmationDialog({
  title,
  body,
  confirmLabel,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        {confirmLabel}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="panel-card w-full max-w-md">
            <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{body}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Vazgeç</button>
              <div onClick={() => setOpen(false)}>{children}</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
