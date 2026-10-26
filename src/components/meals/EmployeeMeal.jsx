"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActionState } from "react";
import { Check, Utensils, X } from "lucide-react";
import Notice from "@/components/Notice";
import TelegramPairing from "@/components/automation/TelegramPairing";
import { saveOrderAction } from "@/app/(panel)/yemek-yonetimi/actions";
import { mealGroup, sharesGroup } from "@/server/meals/selection";

const SLOT_LABELS = {
  MAIN: "Ana yemekler",
  SOUP: "Çorbalar",
  SIDE: "Garnitürler",
  DESSERT: "Tatlılar",
} ;









































const CATEGORY_ORDER = [
  "Sebzeli Yemekler",
  "Tavuklu Yemekler",
  "Etli Yemekler",
  "Mantılar",
  "Etli Sebzeli Yemekler",
  "Sebzeli Ürünler",
  "Makarnalar",
  "Pilav Üstü",
  "Yan Ürünler",
  "Tatlılar",
];

function cap(value) {
  return value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1);
}

function weekdayName(date) {
  return cap(new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T00:00:00Z`)));
}

function mealName(value) {
  return value.replace(/\s*\(\s*\+?\d+(?:[.,]\d+)?\s*\)/g, " ").replace(/\s+/g, " ").trim();
}

export function mealDayLabel(date) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "2-digit" }).format(value);
  const month = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", month: "2-digit" }).format(value);
  return `${weekdayName(date)} ${day}.${month}`;
}

export function mealDayClass(selected, holiday = false) {
  if (holiday) {
    return "inline-flex shrink-0 cursor-not-allowed items-center rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400 no-underline";
  }
  return selected
    ? "inline-flex shrink-0 items-center rounded-full border border-[#03624c] bg-white px-4 py-2 text-sm font-semibold text-[#03624c] no-underline"
    : "inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 no-underline";
}

function savedCategory(day) {
  const name = day?.menu?.items.find((item) => item.id === day.order?.itemId)?.categoryName;
  return name || "Sebzeli Yemekler";
}

function orderableDate(days, today) {
  if (days.some((item) => item.date === today && !item.holiday)) {
    return today;
  }
  return days.find((item) => !item.holiday)?.date ?? days[0]?.date ?? today;
}

export default function EmployeeMeal({
  today,
  days,
  embedded = false,
  telegramLinked = false,
}




) {
  const [state, action, pending] = useActionState(saveOrderAction, undefined);
  const [holidayNote, setHolidayNote] = useState(null);
  const [activeDate, setActiveDate] = useState(orderableDate(days, today));
  const day = days.find((item) => item.date === activeDate) ?? days[0];
  const menu = day?.menu ?? null;
  const slotted = Boolean(menu?.items.some((item) => item.slot));
  const [mainId, setMainId] = useState(day?.order?.itemId ?? "");
  const [soupId, setSoupId] = useState(day?.order?.soupItemId ?? "");
  const [sideId, setSideId] = useState(day?.order?.sideItemId ?? "");
  const [dessertId, setDessertId] = useState(day?.order?.dessertItemId ?? "");
  const [legacyId, setLegacyId] = useState(day?.order?.itemId ?? "");
  const [absent, setAbsent] = useState(day?.order?.absent ?? false);
  const intent = useRef(null);
  const [note, setNote] = useState(day?.order?.note ?? "");
  const [category, setCategory] = useState(savedCategory(day));

  function selectDay(date) {
    const next = days.find((item) => item.date === date);
    setActiveDate(date);
    setMainId(next?.order?.itemId ?? "");
    setSoupId(next?.order?.soupItemId ?? "");
    setSideId(next?.order?.sideItemId ?? "");
    setDessertId(next?.order?.dessertItemId ?? "");
    setLegacyId(next?.order?.itemId ?? "");
    setAbsent(next?.order?.absent ?? false);
    setNote(next?.order?.note ?? "");
    setCategory(savedCategory(next));
  }

  const selectable = useMemo(() => (menu?.items ?? []).filter((item) => item.available !== false), [menu]);
  const categories = useMemo(() => {
    const names = [...new Set(selectable.filter((item) => item.slot === "MAIN" || item.slot === "DESSERT" || !item.slot).map((item) => item.categoryName).filter((name) => Boolean(name)))];
    return names.sort((left, right) => {
      const leftIndex = CATEGORY_ORDER.indexOf(left);
      const rightIndex = CATEGORY_ORDER.indexOf(right);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex) || left.localeCompare(right, "tr");
    });
  }, [selectable]);
  const selectedMain = selectable.find((item) => item.id === mainId);
  const groupedMenu = selectable.some((item) => item.choiceKey);
  const group = mealGroup(selectedMain?.choiceKey);
  const groupKey = group.key;
  const exclusive = group.mode === "or" || group.mode === "salad";
  const inGroup = (item, key) => sharesGroup(item.choiceKey, key);
  const soups = groupedMenu
    ? selectable.filter((item) => item.slot === "SOUP" && groupKey && inGroup(item, groupKey))
    : selectable.filter((item) => item.slot === "SOUP");
  const sides = groupedMenu
    ? selectable.filter((item) => item.slot === "SIDE" && groupKey && inGroup(item, groupKey))
    : selectable.filter((item) => item.slot === "SIDE");
  const visibleMains = selectable.filter((item) => item.slot === "MAIN" && item.categoryName === category);
  const visibleDesserts = selectable.filter((item) => item.slot === "DESSERT" && item.categoryName === category);
  const invalidNames = [mainId, soupId, sideId, dessertId]
    .map((id) => menu?.items.find((item) => item.id === id))
    .filter((item) => Boolean(item && item.available === false))
    .map((item) => item.name);
  const locked = !day?.open;
  const saladOrCacik = group.mode === "and" && sides.length > 0 && sides.every((item) => {
    const name = item.name.toLocaleUpperCase("tr-TR");
    return name === "SALATA" || name === "CACIK";
  });
  const companionReady = exclusive
    ? Boolean((soupId && !sideId) || (!soupId && sideId))
    : Boolean((soups.length === 0 || soupId) && (sides.length === 0 || sideId));
  const ready = (absent || (slotted ? Boolean(mainId && companionReady) : Boolean(legacyId))) && invalidNames.length === 0;
  const summaryRows = [
    mainId ? { id: mainId, slot: "MAIN" , label: "Ana yemek" } : null,
    soupId ? { id: soupId, slot: "SOUP" , label: "Menü seçimi" } : null,
    sideId ? { id: sideId, slot: "SIDE" , label: "Menü seçimi" } : null,
    dessertId ? { id: dessertId, slot: "DESSERT" , label: "Tatlı" } : null,
    !slotted && legacyId ? { id: legacyId, slot: "MAIN" , label: "Ana yemek" } : null,
  ].flatMap((row) => {
    if (!row) {
      return [];
    }
    const item = menu?.items.find((entry) => entry.id === row.id);
    return item ? [{ ...row, name: mealName(item.name), photoUrl: item.photoUrl }] : [];
  });

  function clearSummary(slot) {
    if (slot === "MAIN") {
      setMainId("");
      setLegacyId("");
      return;
    }
    if (slot === "SOUP") {
      setSoupId("");
      return;
    }
    if (slot === "SIDE") {
      setSideId("");
      return;
    }
    setDessertId("");
  }

  useEffect(() => {
    const sameMenu = intent.current?.menuId === menu?.id;
    if (state?.ok && sameMenu && intent.current?.kind === "undo" && state.message === "Ofiste olmama durumu geri alındı.") {
      setAbsent(false);
      return;
    }
    if (state?.ok && sameMenu && intent.current?.kind === "absent") {
      setAbsent(true);
      return;
    }
    if (state?.ok && sameMenu && intent.current?.kind === "cancel" && state.message === "Siparişiniz iptal edildi.") {
      setMainId("");
      setSoupId("");
      setSideId("");
      setDessertId("");
      setLegacyId("");
      setNote("");
      setAbsent(false);
      return;
    }
    setAbsent(day?.order?.absent ?? false);
  }, [state, day?.order?.absent, menu?.id]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [categories, category]);

  function chooseMain(id) {
    setMainId(id);
    const next = selectable.find((item) => item.id === id);
    const nextGroup = mealGroup(next?.choiceKey);
    if (!nextGroup.key) {
      return;
    }
    const soupOk = selectable.some((item) => item.id === soupId && item.slot === "SOUP" && sharesGroup(item.choiceKey, nextGroup.key));
    const sideOk = selectable.some((item) => item.id === sideId && item.slot === "SIDE" && sharesGroup(item.choiceKey, nextGroup.key));
    if (!soupOk) {
      setSoupId("");
    }
    if (!sideOk || (nextGroup.mode !== "and" && soupOk && sideOk)) {
      setSideId("");
    }
  }

  function chooseSoup(id) {
    setSoupId(id);
    if (exclusive) {
      setSideId("");
    }
  }

  function chooseSide(id) {
    setSideId(id);
    if (exclusive) {
      setSoupId("");
    }
  }

  return (
    <div className="space-y-5">
      {embedded ? null : (
        <header>
          <h1 className="text-[1.7rem] font-semibold tracking-tight text-slate-900">Günlük Menü</h1>
        </header>
      )}
      <div className="space-y-5">
          {telegramLinked ? null : (
            <section className="panel-card">
              <h2 className="section-title">Telegram hatırlatması</h2>
              <TelegramPairing linked={false} showCode={false} lead="Telegram'da @FlyworkAIOSBot ile özel sohbet açın. /start yazın ve paneldeki e-postanızı gönderin. Yönetici onaylayınca hesap bağlanır." />
            </section>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((item) => (
              <button
                key={item.date}
                type="button"
                aria-disabled={item.holiday ? true : undefined}
                className={mealDayClass(item.date === activeDate, Boolean(item.holiday))}
                onClick={() => {
                  if (item.holiday) {
                    setHolidayNote("Resmi tatil.");
                    return;
                  }
                  setHolidayNote(null);
                  selectDay(item.date);
                }}
              >
                {mealDayLabel(item.date)}
              </button>
            ))}
          </div>
          {holidayNote ? (
            <p role="status" className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{holidayNote}</p>
          ) : null}
          {day && menu && !day.open ? <Notice tone="err">{day.message}</Notice> : null}
          {state && !(state.ok && (absent || state.message === "Ofiste olmama durumu geri alındı.")) ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
          {invalidNames.length > 0 ? (
            <Notice tone="err">
              {`Menüden çıkarılan seçiminiz: ${invalidNames.join(", ")}. Yeni yemek seçin. Seçiminiz başka yemekle değiştirilmedi.`}
            </Notice>
          ) : null}
          <div className={absent ? "" : "grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]"}>
            <section className="space-y-4">
              {menu ? (
                <form id="meal-order-form" action={action} className="space-y-4">
                  <input type="hidden" name="menuId" value={menu.id} />
                  <input type="hidden" name="mainItemId" value={mainId} />
                  <input type="hidden" name="soupItemId" value={soupId} />
                  <input type="hidden" name="sideItemId" value={sideId} />
                  <input type="hidden" name="dessertItemId" value={dessertId} />
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#03624c]/10 px-4 py-3">
                    <div>
                      <p className="font-semibold text-slate-800">🏠 Bugün ofiste olmayacağım</p>
                      <p className="mt-1 text-sm text-slate-600">{weekdayName(day?.date ?? today)} günü için yemek hazırlanmasın. Bu durum ekip sayımına dahil edilir.</p>
                    </div>
                    {absent ? (
                      <button
                        type="submit"
                        name="undoAbsent"
                        value="on"
                        className="inline-flex items-center gap-2 rounded-full bg-[#03624c] px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => {
                          intent.current = { kind: "undo", menuId: menu.id };
                        }}
                        disabled={locked || pending}
                      >
                        <Check size={16} aria-hidden="true" />
                        İşaretlendi · Geri al
                      </button>
                    ) : (
                      <button
                        type="submit"
                        name="absent"
                        value="on"
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                        onClick={() => {
                          intent.current = { kind: "absent", menuId: menu.id };
                        }}
                        disabled={locked || pending}
                      >
                        Ofiste olmayacağım
                      </button>
                    )}
                  </div>
                  {absent ? (
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <p className="flex items-start gap-2 font-semibold text-slate-800">
                        <Check className="mt-0.5 shrink-0 text-[#03624c]" size={18} aria-hidden="true" />
                        {weekdayName(day?.date ?? today)} için ofiste olmayacağın kaydedildi.
                      </p>
                      <p className="mt-2 pl-7 text-sm text-slate-500">Yemek seçmek istersen yukarıdaki butondan bu durumu geri al.</p>
                    </div>
                  ) : (
                    <fieldset disabled={locked || pending} className="space-y-4">
                      <legend className="sr-only">Yemek seçimi</legend>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Menüden seçimini yap</h2>
                        <p className="mt-1 text-sm text-slate-500">Yemek kategori, ana yemeğini ve yanında sunulan seçenekleri belirle.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {categories.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className={name === category
                              ? "rounded-2xl border border-[#03624c] bg-[#03624c]/10 px-3 py-4 text-sm font-semibold text-[#03624c]"
                              : "rounded-2xl border border-slate-200 bg-white px-3 py-4 text-sm font-semibold text-slate-700"}
                            onClick={() => setCategory(name)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      {slotted ? (
                        <>
                          {visibleMains.length > 0 ? (
                            <SlotGroup slot="MAIN" items={visibleMains} selected={mainId} blocked={[mainId, soupId, sideId, dessertId]} onSelect={chooseMain} />
                          ) : null}
                          {group.mode === "or" && (soups.length > 0 || sides.length > 0) ? (
                            <p className="text-sm text-slate-500">Pilav ya da çorba seçilir. Pilav olarak yalnızca pirinç veya bulgur var.</p>
                          ) : null}
                          {group.mode === "salad" && (soups.length > 0 || sides.length > 0) ? (
                            <p className="text-sm text-slate-500">Çorba ya da salata seçilir. İkisi birlikte seçilemez.</p>
                          ) : null}
                          {saladOrCacik ? (
                            <p className="text-sm text-slate-500">Çorba seçilir. Yanına salata ya da cacık seçilir.</p>
                          ) : null}
                          {category !== "Tatlılar" && soups.length > 0 ? (
                            <SlotGroup slot="SOUP" items={soups} selected={soupId} blocked={[mainId, soupId, sideId, dessertId]} onSelect={chooseSoup} hint={group.mode === "salad" ? "(çorba ya da salata)" : group.mode === "or" ? "(pilav ya da çorba)" : undefined} />
                          ) : null}
                          {sides.length > 0 ? (
                            <SlotGroup slot="SIDE" items={sides} selected={sideId} blocked={[mainId, soupId, sideId, dessertId]} onSelect={chooseSide} title={saladOrCacik ? "Salata veya cacık" : group.mode === "salad" ? "Salata" : group.mode === "or" ? "Pilav" : undefined} hint={saladOrCacik ? "(birini seç)" : group.mode === "salad" ? "(çorba yerine)" : group.mode === "or" ? "(pirinç veya bulgur)" : undefined} />
                          ) : null}
                          {visibleDesserts.length > 0 ? (
                            <SlotGroup slot="DESSERT" items={visibleDesserts} selected={dessertId} blocked={[mainId, soupId, sideId, dessertId]} onSelect={setDessertId} onClear={dessertId ? () => setDessertId("") : undefined} />
                          ) : null}
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                          {menu.items.map((item) => (
                            <FoodCard key={item.id} item={item} active={legacyId === item.id} name="itemId" onSelect={() => setLegacyId(item.id)} />
                          ))}
                        </div>
                      )}
                      <label className="block text-sm text-slate-600" htmlFor="order-note">Sipariş notu</label>
                      <textarea id="order-note" name="note" rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} className="field" placeholder="İsteğe bağlı" />
                    </fieldset>
                  )}
                </form>
              ) : (
                <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Bugün için yayınlanmış menü yok.</p>
              )}
            </section>
            {absent ? null : <aside className={`flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24 ${summaryRows.length === 0 ? "min-h-[32rem]" : ""}`}>
              <h2 className="text-lg font-semibold text-slate-900">Sipariş Özeti</h2>
              {summaryRows.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
                  <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                    <Utensils size={28} aria-hidden="true" />
                  </span>
                  <p className="font-semibold text-slate-800">Henüz seçim yapmadın.</p>
                  <p className="mt-1 text-sm text-slate-500">Seçtiğin ürünler burada görünecek.</p>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {summaryRows.map((row) => (
                    <li key={`${row.slot}-${row.id}`} className="flex items-center gap-3 py-3">
                      {row.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                          <Utensils size={18} aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-5 text-slate-900">{row.name}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{row.label}</span>
                      </span>
                      <button
                        type="button"
                        className="shrink-0 p-1 text-slate-400"
                        aria-label={`${row.name} kaldır`}
                        onClick={() => clearSummary(row.slot)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                form="meal-order-form"
                type="submit"
                className="mt-4 w-full rounded-xl bg-[#03624c] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                disabled={!menu || !ready || locked || pending}
              >
                {pending ? "Kaydediliyor…" : day?.order && !day.order.absent && !(state?.ok && state.message === "Siparişiniz iptal edildi.") ? "Siparişi güncelle" : "Siparişi tamamla"}
              </button>
              {day?.order && !(state?.ok && state.message === "Siparişiniz iptal edildi.") ? (
                <button
                  form="meal-order-form"
                  type="submit"
                  name="cancelOrder"
                  value="on"
                  className="btn-secondary mt-2 w-full"
                  disabled={locked || pending}
                  onClick={() => {
                    intent.current = { kind: "cancel", menuId: menu?.id ?? "" };
                  }}
                >
                  Siparişi iptal et
                </button>
              ) : null}
            </aside>}
          </div>
      </div>
    </div>
  );
}

function SlotGroup({
  slot,
  items,
  selected,
  blocked,
  onSelect,
  onClear,
  title,
  hint,
}








) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[#1e293b]">
          {title ?? SLOT_LABELS[slot]}{" "}
          <span className="font-medium text-slate-400">{hint ?? (slot === "DESSERT" ? "(isteğe bağlı)" : "(1 tane seç)")}</span>
        </h2>
        {onClear ? (
          <button type="button" className="text-sm font-semibold text-slate-500" onClick={onClear}>
            Kaldır
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Bu grupta yemek yok.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {items.map((item) => (
            <FoodCard
              key={item.id}
              item={item}
              active={selected === item.id}
              name={slot === "MAIN" ? "mainItemId" : slot === "SOUP" ? "soupItemId" : slot === "SIDE" ? "sideItemId" : "dessertItemId"}
              disabled={blocked.includes(item.id) && selected !== item.id}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FoodCard({
  item,
  active,
  name,
  disabled,
  onSelect,
}





) {
  return (
    <label
      className={`block cursor-pointer rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        className="sr-only"
        type="radio"
        name={name}
        value={item.id}
        checked={active}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="relative block">
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photoUrl} alt="" className="aspect-[5/4] w-full rounded-xl object-cover" />
        ) : (
          <span className="flex aspect-[5/4] w-full items-center justify-center rounded-xl bg-slate-100 text-slate-300">
            <Utensils size={28} aria-hidden="true" />
          </span>
        )}
        <span
          className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full border bg-white shadow-sm ${active ? "border-[#03624c]" : "border-slate-200"}`}
          aria-hidden="true"
        >
          {active ? <span className="h-3 w-3 rounded-full bg-[#03624c]" /> : null}
        </span>
      </span>
      <span className="block px-1.5 pb-2 pt-3 text-left text-sm font-bold uppercase leading-5 tracking-tight text-[#1e293b]">
        {mealName(item.name)}
      </span>
    </label>
  );
}
