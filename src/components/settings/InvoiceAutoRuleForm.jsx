"use client";

import { useActionState } from "react";
import Notice from "@/components/Notice";

export default function InvoiceAutoRuleForm({ action, rule }) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="panel-card max-w-xl space-y-4 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={rule.enabled} />
        Belirli tedarikçilerden gelen faturaları otomatik onayla
      </label>
      <label className="block">
        Tutarın altı
        <input className="field mt-1" name="maxAmount" inputMode="decimal" defaultValue={rule.maxAmount} required />
      </label>
      <label className="block">
        Para birimi
        <select className="field mt-1" name="currency" defaultValue={rule.currency}>
          <option value="TRY">TRY</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </label>
      <label className="block">
        Tedarikçiler
        <textarea className="field mt-1 min-h-28" name="vendors" defaultValue={rule.vendors.join("\n")} placeholder="Her satıra bir tedarikçi adı" />
      </label>
      <p className="text-slate-500">Eşleşme tedarikçi adı ve para birimi aynıysa, tutar bu sınırın altındaysa yapılır. Kural kapalıyken hiçbir fatura kendiliğinden onaylanmaz.</p>
      {state?.message ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <button className="btn-primary" disabled={pending}>{pending ? "Kaydediliyor…" : "Kaydet"}</button>
    </form>
  );
}
