"use client";

import { useActionState } from "react";
import { changeOwnPasswordAction } from "@/app/(panel)/hesap/actions";
import Notice from "@/components/Notice";

export default function PasswordForm() {
  const [state, action, pending] = useActionState(
    changeOwnPasswordAction,
    undefined,
  );

  return (
    <form action={action} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <p className="text-sm font-semibold text-slate-900">Şifremi değiştir</p>
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <label className="block text-xs text-slate-500">
        Mevcut şifre
        <input name="currentPassword" type="password" autoComplete="current-password" required className="field mt-1" />
      </label>
      <label className="block text-xs text-slate-500">
        Yeni şifre
        <input name="newPassword" type="password" autoComplete="new-password" required className="field mt-1" />
      </label>
      <label className="block text-xs text-slate-500">
        Yeni şifre tekrar
        <input name="confirmPassword" type="password" autoComplete="new-password" required className="field mt-1" />
      </label>
      <p className="text-xs text-slate-500">En az 8 karakter, bir harf, bir rakam ve bir özel karakter.</p>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Şifreyi kaydet"}
      </button>
    </form>
  );
}
