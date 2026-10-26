"use client";

import { useActionState, useMemo, useState } from "react";
import Notice from "@/components/Notice";
import {
  deleteAwardAction,
  saveAwardAction,
  saveCriterionAction,
  setAwardPaidAction,
  setCriterionActiveAction,
  type BonusActionState,
} from "@/app/(panel)/prim/actions";

type Criterion = { id: string; name: string; defaultAmount: string; active: boolean };
type Person = { id: string; name: string; team: boolean; total: string };
type Award = {
  id: string;
  criterionId: string;
  criterionName: string;
  title: string;
  amount: string;
  paid: boolean;
  days: number | null;
  note: string | null;
  month: string;
  recipientIds: string[];
  recipientNames: string[];
};

export type BonusPageData = {
  month: string;
  monthLabel: string;
  companyTotal: string;
  criteria: Criterion[];
  people: Person[];
  awards: Award[];
};

function lira(value: string) {
  const [whole, fraction = "00"] = Number(value).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction} TL`;
}

function StateForm({
  action,
  children,
  className,
}: {
  action: (previous: BonusActionState | undefined, formData: FormData) => Promise<BonusActionState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <fieldset disabled={pending} className={className?.includes("flex") ? "m-0 flex flex-wrap items-end gap-2 border-0 p-0" : "m-0 space-y-3 border-0 p-0"}>{children}</fieldset>
    </form>
  );
}

export default function BonusDesk({
  data,
  canManage,
  editing,
}: {
  data: BonusPageData;
  canManage: boolean;
  editing: Award | null;
}) {
  const activeCriteria = data.criteria.filter((item) => item.active || item.id === editing?.criterionId);
  const [criterionId, setCriterionId] = useState(editing?.criterionId ?? activeCriteria[0]?.id ?? "");
  const defaultAmount = data.criteria.find((item) => item.id === criterionId)?.defaultAmount ?? "";
  const [amount, setAmount] = useState(editing?.amount ?? defaultAmount);
  const [selected, setSelected] = useState<string[]>(editing?.recipientIds ?? data.people.filter((person) => person.team).map((person) => person.id));
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Primler</h1>
        </div>
        <form method="get" className="w-52 text-sm">
          <label>
            Ay
            <input type="month" name="ay" defaultValue={data.month} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="field mt-1" />
          </label>
        </form>
      </header>

      <section>
        <h2 className="section-title">{data.monthLabel}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {data.people.filter((person) => Number(person.total) > 0 || person.team).map((person) => (
            <article key={person.id} className="panel-card">
              <p className="text-sm text-slate-500">{person.name}</p>
              <p className="mt-2 text-2xl font-semibold">{lira(person.total)}</p>
            </article>
          ))}
          <article className="panel-card">
            <p className="text-sm text-slate-500">Toplam prim</p>
            <p className="mt-2 text-2xl font-semibold">{lira(data.companyTotal)}</p>
          </article>
        </div>
      </section>

      <section className="panel-card">
        <h2 className="section-title">Bu ayın primleri</h2>
        {data.awards.length === 0 ? <p className="mt-3 text-sm text-slate-500">Bu ay prim kaydı yok.</p> : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.awards.map((award) => (
              <li key={award.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{award.title}</p>
                  <p className="text-sm text-slate-600">{award.criterionName} · kişi başı {lira(award.amount)} · {award.paid ? "Ödendi" : "Ödenmedi"}</p>
                  <p className="text-sm text-slate-500">Prim alanlar: {award.recipientNames.join(", ")}{award.days ? ` · ${award.days} gün` : ""}</p>
                  {award.note ? <p className="text-sm text-slate-500">Yapan: {award.note}</p> : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <a className="btn-secondary" href={`/prim?ay=${data.month}&kayit=${award.id}`}>Düzenle</a>
                    <form action={setAwardPaidAction}>
                      <input type="hidden" name="id" value={award.id} />
                      <input type="hidden" name="paid" value={award.paid ? "false" : "true"} />
                      <button className="btn-secondary" type="submit">{award.paid ? "Ödenmedi yap" : "Ödendi"}</button>
                    </form>
                    <form action={deleteAwardAction} onSubmit={(event) => { if (!window.confirm("Bu prim kaydı silinsin mi?")) event.preventDefault(); }}>
                      <input type="hidden" name="id" value={award.id} />
                      <button className="btn-secondary" type="submit">Sil</button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="panel-card">
          <h2 className="section-title">{editing ? "Primi düzenle" : "Prim ekle"}</h2>
          <StateForm action={saveAwardAction} className="mt-3 space-y-3">
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <input type="hidden" name="month" value={editing?.month ?? data.month} />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Kriter
                <select
                  name="criterionId"
                  className="field mt-1"
                  value={criterionId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCriterionId(next);
                    const found = data.criteria.find((item) => item.id === next);
                    if (found && !editing) setAmount(found.defaultAmount);
                  }}
                >
                  {activeCriteria.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                Uygulama veya fikir
                <input name="title" required defaultValue={editing?.title ?? ""} className="field mt-1" placeholder="Örn. Ten Matcher" />
              </label>
              <label className="text-sm">
                Kişi başı ücret (TL)
                <input name="amount" required value={amount} onChange={(event) => setAmount(event.target.value)} className="field mt-1" />
              </label>
              <label className="text-sm">
                Süre (gün)
                <input name="days" inputMode="numeric" defaultValue={editing?.days ?? ""} className="field mt-1" />
              </label>
            </div>
            <label className="text-sm">
              Yapan kişi
              <input name="note" defaultValue={editing?.note ?? ""} className="field mt-1" placeholder="İşi kim yaptı. Prime etkisi yok." />
            </label>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">Kimlere verilecek</p>
                <button type="button" className="text-sm font-semibold text-[#03624c]" onClick={() => setSelected(data.people.filter((person) => person.team).map((person) => person.id))}>Ekip</button>
                <button type="button" className="text-sm font-semibold text-slate-500" onClick={() => setSelected([])}>Temizle</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.people.map((person) => (
                  <label key={person.id} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${selectedSet.has(person.id) ? "border-[#03624c] bg-[#03624c]/10" : "border-slate-200"}`}>
                    <input type="checkbox" name="userId" value={person.id} checked={selectedSet.has(person.id)} onChange={() => toggle(person.id)} />
                    {person.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="paid" defaultChecked={editing?.paid ?? false} />
              Ödeme yapıldı
            </label>
            <button className="btn-primary" type="submit">{editing ? "Kaydet" : "Prim ekle"}</button>
          </StateForm>
        </section>
      ) : null}

      <section className="panel-card">
        <h2 className="section-title">Kriterler</h2>
        <p className="mt-1 text-sm text-slate-500">Yeni kayıt bu ücreti getirir. Kayıttaki ücret ayrıca değiştirilir. Eski kayıtlar değişmez.</p>
        <ul className="mt-3 divide-y divide-slate-100">
          {data.criteria.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              {canManage ? (
                <StateForm action={saveCriterionAction} className="flex flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={item.id} />
                  <input name="name" defaultValue={item.name} className="field w-56" />
                  <input name="defaultAmount" defaultValue={item.defaultAmount} className="field w-32" />
                  <button className="btn-secondary" type="submit">Kaydet</button>
                  {!item.active ? <span className="text-sm text-slate-500">Kapalı</span> : null}
                </StateForm>
              ) : (
                <p>{item.name} · {lira(item.defaultAmount)}{item.active ? "" : " · Kapalı"}</p>
              )}
              {canManage ? (
                <form action={setCriterionActiveAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="active" value={item.active ? "false" : "true"} />
                  <button className="btn-secondary" type="submit">{item.active ? "Kapat" : "Aç"}</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <StateForm action={saveCriterionAction} className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Yeni kriter
              <input name="name" required className="field mt-1 w-56" placeholder="Örn. Fikir" />
            </label>
            <label className="text-sm">
              Başlangıç ücreti
              <input name="defaultAmount" required className="field mt-1 w-32" placeholder="1000" />
            </label>
            <button className="btn-primary" type="submit">Kriter ekle</button>
          </StateForm>
        ) : null}
      </section>
    </div>
  );
}
