"use client";

import { useState, type ChangeEvent } from "react";
import { useActionState } from "react";
import Notice from "@/components/Notice";
import { mealGroup, sharesGroup } from "@/server/meals/selection";
import {
  remindMealAction,
  saveGuestOrderAction,
  saveManagedOrderAction,
  type ActionState,
} from "@/app/(panel)/yemek-yonetimi/actions";

type MenuItem = {
  id: string;
  name: string;
  slot: string | null;
  available: boolean;
  choiceKey?: string | null;
};

type OrderRow = {
  id: string;
  userId: string;
  employeeName: string;
  itemId: string | null;
  soupItemId: string | null;
  sideItemId: string | null;
  dessertItemId: string | null;
  mainName: string | null;
  soupName: string | null;
  sideName: string | null;
  dessertName: string | null;
  note: string | null;
  status: string;
  absent: boolean;
  invalidItems: string[];
};

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Sipariş alındı",
  PREPARING: "Hazırlanıyor",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal",
};

function ChoiceFields({
  items,
  initial,
}: {
  items: MenuItem[];
  initial?: { itemId: string | null; soupItemId: string | null; sideItemId: string | null; dessertItemId: string | null } | null;
}) {
  const [mainId, setMainId] = useState(initial?.itemId ?? "");
  const [soupId, setSoupId] = useState(initial?.soupItemId ?? "");
  const [sideId, setSideId] = useState(initial?.sideItemId ?? "");
  const [dessertId, setDessertId] = useState(initial?.dessertItemId ?? "");
  const grouped = items.some((item) => item.choiceKey);
  const main = items.find((item) => item.id === mainId);
  const group = mealGroup(main?.choiceKey);
  const exclusive = group.mode === "or" || group.mode === "salad";
  const matches = (item: MenuItem) => !grouped || sharesGroup(item.choiceKey, group.key);
  const sideOptions = items.filter((item) => item.slot === "SIDE" && item.available && matches(item));
  const saladOrCacik = group.mode === "and" && sideOptions.length > 0 && sideOptions.every((item) => {
    const name = item.name.toLocaleUpperCase("tr-TR");
    return name === "SALATA" || name === "CACIK";
  });

  function chooseMain(id: string) {
    setMainId(id);
    const next = items.find((item) => item.id === id);
    const nextGroup = mealGroup(next?.choiceKey);
    if (!nextGroup.key) {
      return;
    }
    const soupOk = items.some((item) => item.id === soupId && item.slot === "SOUP" && item.available && sharesGroup(item.choiceKey, nextGroup.key));
    const sideOk = items.some((item) => item.id === sideId && item.slot === "SIDE" && item.available && sharesGroup(item.choiceKey, nextGroup.key));
    if (!soupOk) {
      setSoupId("");
    }
    if (!sideOk || (nextGroup.mode !== "and" && soupOk && sideOk)) {
      setSideId("");
    }
  }

  function chooseSoup(id: string) {
    setSoupId(id);
    if (exclusive) {
      setSideId("");
    }
  }

  function chooseSide(id: string) {
    setSideId(id);
    if (exclusive) {
      setSoupId("");
    }
  }

  const groups = [
    ["mainItemId", "Ana yemek", "MAIN", true, mainId, chooseMain],
    ["soupItemId", "Çorba", "SOUP", false, soupId, chooseSoup],
    ["sideItemId", saladOrCacik ? "Salata veya cacık" : group.mode === "salad" ? "Salata" : group.mode === "or" ? "Pilav" : "Pilav / garnitür", "SIDE", false, sideId, chooseSide],
    ["dessertItemId", "Tatlı", "DESSERT", false, dessertId, setDessertId],
  ] as const;
  return (
    <>
      {group.mode === "salad" ? <p className="text-sm text-slate-500 sm:col-span-2">Çorba ya da salata seçilir. İkisi birlikte seçilemez.</p> : null}
      {saladOrCacik ? <p className="text-sm text-slate-500 sm:col-span-2">Çorba seçilir. Yanına salata ya da cacık seçilir.</p> : null}
      {group.mode === "or" ? <p className="text-sm text-slate-500 sm:col-span-2">Pilav ya da çorba seçilir. İkisi birlikte seçilemez.</p> : null}
      {groups.map(([name, label, slot, required, value, onChange]) => {
        const options = items.filter((item) => item.slot === slot && item.available && (slot === "MAIN" || slot === "DESSERT" || matches(item)));
        if (!required && options.length === 0) {
          return null;
        }
        return (
          <label key={name} className="block text-sm">
            {label}
            <select
              name={name}
              className="field mt-1"
              value={value}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
            >
              <option value="">{required ? "Seçin" : "İstemiyorum"}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        );
      })}
    </>
  );
}

function RemindButton({ menuId, userId }: { menuId: string; userId: string }) {
  const [state, action, pending] = useActionState<ActionState | undefined, FormData>(remindMealAction, undefined);
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="menuId" value={menuId} />
      <input type="hidden" name="userId" value={userId} />
      <button className="rounded-xl border border-[#03624c] bg-white px-4 py-1.5 text-sm font-semibold text-[#03624c] disabled:opacity-60" type="submit" disabled={pending}>
        {pending ? "Gönderiliyor" : "Hatırlat"}
      </button>
      {state ? <span className={`mt-1 block max-w-56 text-right text-xs ${state.ok ? "text-[#03624c]" : "text-rose-700"}`}>{state.message}</span> : null}
    </form>
  );
}

function OrderLines({
  row,
}: {
  row: { mainName: string | null; soupName: string | null; sideName: string | null; dessertName: string | null; note: string | null };
}) {
  return (
    <div className="text-sm text-slate-600">
      <p>Ana yemek: {row.mainName ?? "—"}</p>
      <p>Çorba: {row.soupName ?? "—"}</p>
      <p>Pilav / garnitür: {row.sideName ?? "—"}</p>
      <p>Tatlı: {row.dessertName ?? "—"}</p>
      <p>Not: {row.note || "—"}</p>
    </div>
  );
}

export default function AdminOrderDesk({
  menu,
  orders,
  guests,
  people,
  pending,
  away,
  canEdit,
  canManage = true,
  windowMessage,
}: {
  menu: { id: string; published: boolean; items: MenuItem[] } | null;
  orders: OrderRow[];
  guests: { id: string; guestName: string; note: string | null; itemId: string | null; soupItemId: string | null; sideItemId: string | null; dessertItemId: string | null; mainName: string | null; soupName: string | null; sideName: string | null; dessertName: string | null }[];
  people: { id: string; name: string }[];
  pending: { id: string; name: string }[];
  away: { id: string; name: string }[];
  canEdit: boolean;
  canManage?: boolean;
  windowMessage: string;
}) {
  const [panel, setPanel] = useState<"guest" | "employee" | null>(null);
  const [employeeUserId, setEmployeeUserId] = useState("");
  const [guestId, setGuestId] = useState("");
  const [guestState, guestAction, guestPending] = useActionState<ActionState | undefined, FormData>(saveGuestOrderAction, undefined);
  const [employeeState, employeeAction, employeePending] = useActionState<ActionState | undefined, FormData>(saveManagedOrderAction, undefined);
  const open = Boolean(menu?.published) && canEdit;
  const visibleOrders = orders.filter((order) => order.status !== "CANCELLED" && !order.absent);
  const selectedOrder = orders.find((order) => order.userId === employeeUserId && order.status !== "CANCELLED");
  const selectedGuest = guests.find((guest) => guest.id === guestId) ?? null;
  function editEmployee(userId: string) {
    setEmployeeUserId(userId);
    setPanel("employee");
  }
  function editGuest(id: string) {
    setGuestId(id);
    setPanel("guest");
  }

  return (
    <div className="space-y-5">
      <section className="panel-card">
        <h2 className="section-title">Bugünkü Siparişler</h2>
        {canManage ? <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!open} onClick={() => editGuest("")}>+ Misafir İçin Yemek Ekle</button>
          <button type="button" className="btn-secondary" disabled={!open} onClick={() => editEmployee("")}>+ Çalışan Siparişi Ekle / Düzenle</button>
        </div> : null}
        {!menu?.published ? <p className="mb-3 text-sm text-slate-600">Bugün için yayınlanmış menü yok.</p> : null}
        {menu?.published && !canEdit ? <p className="mb-3 text-sm text-slate-600">{windowMessage}</p> : null}
        {panel === "guest" && menu ? (
          <form key={guestId || "yeni-misafir"} action={guestAction} className="mb-4 grid gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-2">
            <input type="hidden" name="menuId" value={menu.id} />
            <input type="hidden" name="guestOrderId" value={selectedGuest?.id ?? ""} />
            {guestState ? <div className="sm:col-span-2"><Notice tone={guestState.ok ? "ok" : "err"}>{guestState.message}</Notice></div> : null}
            {selectedGuest ? <p className="text-sm text-slate-500 sm:col-span-2">Kayıtlı misafir siparişi açıldı. Kaydedince güncellenir.</p> : null}
            <label className="block text-sm sm:col-span-2">Misafir adı
              <input name="guestName" required minLength={2} className="field mt-1" defaultValue={selectedGuest?.guestName ?? ""} />
            </label>
            <ChoiceFields key={guestId || "yeni-misafir"} items={menu.items} initial={selectedGuest} />
            <label className="block text-sm sm:col-span-2">Sipariş notu
              <input name="note" className="field mt-1" defaultValue={selectedGuest?.note ?? ""} />
            </label>
            <button className="btn-primary sm:col-span-2" type="submit" disabled={guestPending}>{selectedGuest ? "Misafir siparişini güncelle" : "Misafir siparişini kaydet"}</button>
          </form>
        ) : null}
        {panel === "employee" && menu ? (
          <form key={employeeUserId || "yeni"} action={employeeAction} className="mb-4 grid gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-2">
            <input type="hidden" name="menuId" value={menu.id} />
            {employeeState ? <div className="sm:col-span-2"><Notice tone={employeeState.ok ? "ok" : "err"}>{employeeState.message}</Notice></div> : null}
            <label className="block text-sm sm:col-span-2">Çalışan
              <select name="userId" required className="field mt-1" value={employeeUserId} onChange={(event) => setEmployeeUserId(event.target.value)}>
                <option value="">Seçin</option>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            {selectedOrder ? <p className="text-sm text-slate-500 sm:col-span-2">Kayıtlı sipariş açıldı. Kaydedince güncellenir.</p> : null}
            <ChoiceFields key={employeeUserId || "yeni"} items={menu.items} initial={selectedOrder} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="absent" defaultChecked={selectedOrder?.absent ?? false} />
              Ofiste olmayacak
            </label>
            <label className="block text-sm sm:col-span-2">Sipariş notu
              <input name="note" className="field mt-1" defaultValue={selectedOrder?.note ?? ""} />
            </label>
            <button className="btn-primary sm:col-span-2" type="submit" disabled={employeePending}>{selectedOrder ? "Siparişi güncelle" : "Çalışan siparişini kaydet"}</button>
          </form>
        ) : null}
        {visibleOrders.length === 0 && guests.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600">Henüz sipariş yok.</p>
        ) : (
          <div className="space-y-3">
            {visibleOrders.map((order) => (
              <article key={order.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{order.employeeName}</h3>
                  <span className="flex items-center gap-2">
                    {canManage && open ? <button type="button" className="btn-secondary" onClick={() => editEmployee(order.userId)}>Düzenle</button> : null}
                    <span className="text-sm text-slate-500">{STATUS_LABELS[order.status] ?? order.status}</span>
                  </span>
                </div>
                <OrderLines row={order} />
                {order.invalidItems.length > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-rose-700">Menüden çıkarıldı: {order.invalidItems.join(", ")}. Başka yemekle değiştirilmedi.</p>
                ) : null}
              </article>
            ))}
            {guests.map((guest) => (
              <article key={guest.id} className="rounded-2xl border border-[#03624c]/30 bg-[#03624c]/10 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{guest.guestName}</h3>
                  <span className="flex items-center gap-2">
                    {canManage && open ? <button type="button" className="btn-secondary" onClick={() => editGuest(guest.id)}>Düzenle</button> : null}
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[#03624c]">Misafir</span>
                  </span>
                </div>
                <OrderLines row={guest} />
              </article>
            ))}
          </div>
        )}
        {canEdit && menu?.published && !windowMessage.includes("kapandı") ? <p className="mt-3 text-sm text-slate-500">{windowMessage}</p> : null}
      </section>

      <section className="panel-card">
        <h2 className="section-title">Sipariş vermeyenler</h2>
        {pending.length === 0 ? <p className="text-sm text-slate-500">Bekleyen kişi yok.</p> : (
          <ul className="divide-y divide-slate-100">
            {pending.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-4 py-4">
                <span className="font-medium text-slate-800">{person.name}</span>
                {canManage && menu ? <RemindButton menuId={menu.id} userId={person.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-card">
        <h2 className="section-title">Ofiste olmayanlar</h2>
        {away.length === 0 ? <p className="text-sm text-slate-500">Ofiste olmadığını bildiren yok.</p> : (
          <ul className="divide-y divide-slate-100">
            {away.map((person) => <li key={person.id} className="py-3">{person.name}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
