"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { Utensils } from "lucide-react";
import Notice from "@/components/Notice";
import { publishCatalogAction } from "@/app/(panel)/yemek-yonetimi/actions";

const SLOT_LABELS = {
  MAIN: "Ana yemek",
  SOUP: "Çorba",
  SIDE: "Pilav / garnitür",
  DESSERT: "Tatlı",
};




















export default function MenuPlanner({
  date,
  editable,
  menu,
  catalog,
}





















) {
  const [state, action, pending] = useActionState(publishCatalogAction, undefined);
  const dishes = useMemo(
    () =>
      catalog.flatMap((category) =>
        category.dishes
          .filter((dish) => dish.active)
          .map((dish) => ({
            id: dish.id,
            name: dish.name,
            slot: dish.slot,
            categoryId: category.id,
            categoryName: category.name,
            priceLabel: dish.priceLabel,
            description: dish.description,
            photoUrl: dish.photoUrl,
          })),
      ),
    [catalog],
  );
  const [selected, setSelected] = useState(
    () => menu?.items.filter((item) => item.available && item.dishId).map((item) => item.dishId) ?? [],
  );
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("hepsi");
  const [note, setNote] = useState(menu?.note ?? "");
  const foldedQuery = query.toLocaleLowerCase("tr").trim();
  const visible = dishes.filter((dish) => {
    const matchesCategory = categoryId === "hepsi" || dish.categoryId === categoryId;
    const matchesQuery = !foldedQuery || dish.name.toLocaleLowerCase("tr").includes(foldedQuery);
    return matchesCategory && matchesQuery;
  });
  const selectedDishes = selected
    .map((id) => dishes.find((dish) => dish.id === id))
    .filter((dish) => Boolean(dish));
  const removed = menu?.items.filter((item) => !item.available) ?? [];

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <section className="panel-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Menü planı</h2>
          <p className="text-sm text-slate-600">
            {menu ? (menu.published ? "Menü yayında" : "Menü taslak") : "Bugün için menü yok"}.
            {menu ? ` ${menu.orderCount} sipariş.` : ""} Katalogdan seçin, taslak kaydedin veya açıkça yayınlayın.
          </p>
        </div>
        <p className="text-sm font-semibold text-slate-700">{selectedDishes.length} yemek seçili</p>
      </div>
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      {removed.length > 0 ? (
        <Notice tone="err">
          {`Menüden çıkan ve siparişte kalan yemekler: ${removed.map((item) => item.name).join(", ")}. Bu seçimler başka yemekle değiştirilmedi.`}
        </Notice>
      ) : null}
      {!editable ? (
        <p className="text-sm text-slate-600">Bugünün menüsü kapanıştan sonra değiştirilemez.</p>
      ) : (
        <form action={action} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <input type="hidden" name="date" value={date} />
          {selected.map((id) => (
            <input key={id} type="hidden" name="dishIds" value={id} />
          ))}
          <div className="space-y-3">
            <label className="block text-sm" htmlFor="menu-search">
              Yemek ara
            </label>
            <input
              id="menu-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="field"
              placeholder="Katalogda ara"
            />
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                className={categoryId === "hepsi" ? "btn-primary shrink-0" : "btn-secondary shrink-0"}
                onClick={() => setCategoryId("hepsi")}
              >
                Tüm kategoriler
              </button>
              {catalog.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={categoryId === category.id ? "btn-primary shrink-0" : "btn-secondary shrink-0"}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-slate-500">Bu süzgeçte yemek yok.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visible.map((dish) => {
                  const active = selected.includes(dish.id);
                  return (
                    <li key={dish.id}>
                      <button
                        type="button"
                        className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left ${active ? "border-[#03624c] bg-[#03624c]/10" : "border-slate-200 bg-white"}`}
                        onClick={() => toggle(dish.id)}
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                          <Utensils size={18} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{dish.name}</span>
                          <span className="block text-xs text-slate-500">
                            {dish.categoryName} · {SLOT_LABELS[dish.slot] ?? dish.slot}
                          </span>
                        </span>
                        <span className="ml-auto text-xs font-semibold text-[#03624c]">{active ? "Eklendi" : "Ekle"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <aside className="h-fit space-y-3 rounded-2xl border border-slate-200 p-3 lg:sticky lg:top-24">
            <h3 className="text-sm font-semibold">Seçilen yemekler</h3>
            {selectedDishes.length === 0 ? (
              <p className="text-sm text-slate-500">Henüz yemek eklenmedi.</p>
            ) : (
              (["MAIN", "SOUP", "SIDE", "DESSERT"] ).map((slot) => {
                const rows = selectedDishes.filter((dish) => dish.slot === slot);
                if (rows.length === 0) {
                  return null;
                }
                return (
                  <div key={slot}>
                    <p className="text-xs font-semibold text-slate-500">{SLOT_LABELS[slot]}</p>
                    <ul className="mt-1 space-y-1">
                      {rows.map((dish) => (
                        <li key={dish.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{dish.name}</span>
                          <button type="button" className="btn-secondary shrink-0 px-2 py-1" onClick={() => toggle(dish.id)}>
                            Çıkar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
            <label className="block text-sm" htmlFor="planner-note">
              Menü notu
            </label>
            <input id="planner-note" name="note" value={note} onChange={(event) => setNote(event.target.value)} className="field" />
            <button
              type="submit"
              name="yayin"
              value="taslak"
              className="btn-secondary w-full"
              disabled={pending || selectedDishes.length === 0}
            >
              Taslak kaydet
            </button>
            <button
              type="submit"
              name="yayin"
              value="yayin"
              className="btn-primary w-full"
              disabled={pending || selectedDishes.length === 0}
            >
              Yayınla
            </button>
            <p className="text-xs text-slate-500">Taslak çalışanlara görünmez. Yayınlanan menü kapanışa kadar düzenlenebilir.</p>
          </aside>
        </form>
      )}
    </section>
  );
}
