"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Notice from "@/components/Notice";
import AdminOrderDesk from "@/components/meals/AdminOrderDesk";
import CatalogImport from "@/components/meals/CatalogImport";
import EmployeeMeal, { mealDayClass, mealDayLabel } from "@/components/meals/EmployeeMeal";
import { DailySpend, MonthlySpend } from "@/components/meals/MealSpendBoard";
import MenuPlanner from "@/components/meals/MenuPlanner";
import PhotoReview from "@/components/meals/PhotoReview";

import MealTabs, { ORDER_MEAL_TABS, } from "@/components/meals/MealTabs";
import { publicHoliday } from "@/server/meals/holidays";
import { upcomingMealDates } from "@/server/meals/schedule";
import {
  closingTimeAction,
  saveCategoryAction,
  saveDishAction,
  saveMenuAction,

} from "@/app/(panel)/yemek-yonetimi/actions";






















































function ActionForm({
  action,
  children,
}


) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-3">
      {state ? <Notice tone={state.ok ? "ok" : "err"}>{state.message}</Notice> : null}
      <fieldset disabled={pending} className="space-y-3">
        {children}
      </fieldset>
    </form>
  );
}















const SLOT_OPTIONS = [
  ["MAIN", "Ana yemek"],
  ["SOUP", "Çorba"],
  ["SIDE", "Pilav / garnitür"],
  ["DESSERT", "Tatlı"],
] ;

export default function AdminMeal({
  view,
  tab,
  catalog,
  reviewing = false,
  photoReview = null,
  orderView = null,
  spend = null,
  spendYear = new Date().getFullYear(),
  spendMonth = null,
  canManage = true,
  telegramLinked = false,
}











) {
  const days = upcomingMealDates(view.today, view.schedule.weekdays, 6);
  const [holidayNote, setHolidayNote] = useState(null);
  const hrefFor = (next) => {
    const report = next === "aylik" ? "ay" : next === "gunluk" ? "gun" : "gun";
    return `/yemek-yonetimi?sekme=${next}&tarih=${view.selectedDate}&rapor=${report}`;
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.7rem] font-semibold tracking-tight text-slate-900">Günlük Menü</h1>
      </header>
      <MealTabs tabs={ORDER_MEAL_TABS} active={reviewing ? "katalog" : tab} hrefFor={hrefFor} appearance="meal" />
      {reviewing && photoReview ? <PhotoReview view={photoReview} /> : null}
      {!reviewing && (tab === "bugun" || tab === "plan") ? (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((date) => publicHoliday(date) ? (
              <button
                key={date}
                type="button"
                aria-disabled="true"
                className={mealDayClass(false, true)}
                onClick={() => setHolidayNote("Resmi tatil.")}
              >
                {mealDayLabel(date)}
              </button>
            ) : (
              <a
                key={date}
                href={`/yemek-yonetimi?sekme=${tab}&tarih=${date}&rapor=gun`}
                className={mealDayClass(date === view.selectedDate)}
                onClick={() => setHolidayNote(null)}
              >
                {mealDayLabel(date)}
              </a>
            ))}
          </div>
          {holidayNote ? <p role="status" className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{holidayNote}</p> : null}
        </div>
      ) : null}
      {!reviewing && tab === "siparis" && orderView ? (
        <EmployeeMeal
          embedded
          today={orderView.today}
          days={orderView.days}
          telegramLinked={telegramLinked}
        />
      ) : null}
      {!reviewing && (tab === "plan" || tab === "katalog") ? (
      <div className="space-y-5">
      {tab === "plan" ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <section className="panel-card text-sm">
          <p className="text-slate-500">Sipariş günleri</p>
          <p className="mt-2 font-semibold">{view.schedule.weekdayLabels.join(", ")}</p>
        </section>
        <section className="panel-card text-sm">
          <p className="text-slate-500">Kapanış</p>
          <p className="mt-2 font-semibold">{view.schedule.closesAt}</p>
        </section>
        <section className="panel-card text-sm">
          <p className="text-slate-500">Seçili gün</p>
          <p className="mt-2 font-semibold">{view.menu ? (view.menu.published ? "Menü yayında" : "Menü taslak") : "Menü yok"}</p>
        </section>
      </div> : null}

      {tab === "plan" ? (days.includes(view.selectedDate) ? (
        <MenuPlanner
          key={view.selectedDate}
          date={view.selectedDate}
          editable={canManage && view.window.allowed}
          menu={view.menu}
          catalog={catalog}
        />
      ) : (
        <section className="panel-card text-sm text-slate-600">
          Menü planı yaklaşan Pazartesi, Salı ve Perşembe günleri için hazırlanır. Yukarıdan bir yemek günü seçin.
        </section>
      )) : null}

      {canManage && tab === "plan" ? <section className="panel-card">
        <h2 className="section-title">Kapanış saati</h2>
        <ActionForm action={closingTimeAction}>
          <label className="block text-sm" htmlFor="closesAt">
            Türkiye saatiyle son sipariş
          </label>
          <input
            id="closesAt"
            name="closesAt"
            type="time"
            required
            defaultValue={view.schedule.closesAt}
            className="field sm:w-40"
          />
          <button className="btn-primary w-full sm:w-auto" type="submit">
            Saati kaydet
          </button>
        </ActionForm>
      </section> : null}

      {tab === "katalog" ? <section className="panel-card">
        <h2 className="section-title">Yemek kataloğu</h2>
        <Link href="/yemek-yonetimi?sekme=fotograflar" className={reviewing ? "btn-primary mb-3" : "btn-secondary mb-3"}>Fotoğraf incelemesi</Link>
        <p className="mb-3 text-sm text-slate-600">
          Katalog bakımı ayrıdır. Gün menüsü yukarıdaki plandan hazırlanır.
        </p>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {catalog.map((category) => (
            <p key={category.id} className="text-sm">
              <strong>{category.name}</strong>
              <span className="text-slate-500"> · {category.dishes.filter((dish) => dish.active).length} aktif yemek</span>
            </p>
          ))}
        </div>
        {canManage ? <CatalogImport /> : null}
        {canManage ? <>
        <ActionForm action={saveCategoryAction}>
          <label className="block text-sm" htmlFor="category-name">Yeni kategori</label>
          <input id="category-name" name="name" required minLength={2} className="field" />
          <button className="btn-secondary w-full sm:w-auto" type="submit">Kategoriyi kaydet</button>
        </ActionForm>
        <ActionForm action={saveDishAction}>
          <label className="block text-sm" htmlFor="dish-name">Yemek adı</label>
          <input id="dish-name" name="name" required minLength={2} className="field" />
          <label className="block text-sm" htmlFor="dish-category">Kategori</label>
          <select id="dish-category" name="categoryId" required className="field">
            {catalog.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <label className="block text-sm" htmlFor="dish-slot">Sipariş grubu</label>
          <select id="dish-slot" name="slot" required className="field">
            {SLOT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <label className="block text-sm" htmlFor="dish-photo">Fotoğraf</label>
          <input id="dish-photo" name="foto" type="file" accept="image/jpeg,image/png,image/webp" className="field" />
          <label className="block text-sm" htmlFor="dish-price">Fiyat (TL, isteğe bağlı)</label>
          <input id="dish-price" name="price" className="field" placeholder="19,90" />
          <label className="block text-sm" htmlFor="dish-description">Açıklama</label>
          <input id="dish-description" name="description" className="field" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked />
            Aktif
          </label>
          <button className="btn-primary w-full sm:w-auto" type="submit">Yemeği kaydet</button>
        </ActionForm>
        </> : null}
      </section> : null}

      {canManage && tab === "plan" ? <details className="panel-card">
        <summary className="section-title cursor-pointer">Serbest menü (katalog dışı)</summary>
        {view.menu?.items.some((item) => item.dishId) ? (
          <p className="text-sm text-slate-600">Bugün katalog menüsüyle hazırlandı. Yemekler menü planından değiştirilir.</p>
        ) : (
        <>
        {view.menu ? (
          <p className="mb-3 text-sm text-gray-700">
            {view.menu.date}: {view.menu.published ? "yayında" : "taslak"} · {view.menu.items.map((item) => item.name).join(", ") || "yemek yok"}
            {view.menu.orderCount > 0 ? ` · ${view.menu.orderCount} sipariş` : ""}
          </p>
        ) : (
          <p className="mb-3 text-sm text-gray-700">Seçili gün için menü yok.</p>
        )}
        <ActionForm action={saveMenuAction}>
          <label className="block text-sm" htmlFor="menu-date">Tarih</label>
          <input id="menu-date" name="date" type="date" required defaultValue={view.selectedDate} className="field sm:w-48" />
          <label className="block text-sm" htmlFor="menu-items">Yemekler, her satıra bir tane</label>
          <textarea id="menu-items" name="items" required rows={4} className="field" placeholder={"Mercimek çorbası\nIzgara tavuk"} />
          <label className="block text-sm" htmlFor="menu-note">Not</label>
          <input id="menu-note" name="note" className="field" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="published" defaultChecked />
            Yayınla
          </label>
          <button className="btn-primary w-full sm:w-auto" type="submit">
            Menüyü kaydet
          </button>
        </ActionForm>
        </>
        )}
      </details> : null}
      </div>
      ) : null}

      {tab === "bugun" ? (
        <AdminOrderDesk
          menu={view.menu}
          orders={view.orders}
          guests={view.guests}
          people={view.people}
          pending={view.pending}
          away={view.away}
          canEdit={canManage}
          canManage={canManage}
          windowMessage={view.window.message}
        />
      ) : null}

      {tab === "gunluk" ? <DailySpend days={(spend?.months ?? []).flatMap((month) => month.days)} /> : null}
      {tab === "aylik" ? <MonthlySpend year={spendYear} month={spendMonth} months={spend?.months ?? []} /> : null}
    </div>
  );
}
