"use client";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export type SpendDay = {
  date: string;
  weekdayLabel: string;
  eaters: number;
  missing: boolean;
  totalLabel: string;
  absent: string[];
  employees: { personName: string; choices: string[]; personLabel: string }[];
  guests: { personName: string; choices: string[]; personLabel: string }[];
  orderCount: number;
};

export type SpendMonth = {
  month: number;
  label: string;
  mealDays: number;
  orders: number;
  uniqueEmployees: number;
  participations: number;
  missing: boolean;
  totalLabel: string;
  days: SpendDay[];
};

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function People({ title, rows }: { title: string; rows: SpendDay["employees"] }) {
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      {rows.length === 0 ? <p className="text-slate-500">Kayıt yok.</p> : (
        <ul className="mt-1 space-y-1">
          {rows.map((row) => (
            <li key={`${title}-${row.personName}`}>
              {row.personName}: {row.choices.join(", ") || "Seçim yok"} · {row.personLabel}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DailySpend({ days, embedded = false }: { days: SpendDay[]; embedded?: boolean }) {
  const visible = days
    .filter((day) => day.eaters > 0)
    .sort((left, right) => right.date.localeCompare(left.date));
  return (
    <section className="space-y-3">
      {embedded ? null : <h2 className="section-title">Günlük Yemek Giderleri</h2>}
      {visible.length === 0 ? <p className="panel-card text-sm text-slate-600">Kayıtlı yemek günü yok.</p> : visible.map((day) => (
        <details key={day.date} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <summary className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">{formatDate(day.date)} — {day.weekdayLabel}</span>
              <span className="text-sm text-slate-500">{day.eaters} kişi</span>
            </span>
            <span className="text-right font-semibold">{day.missing ? "Toplam hesaplanamıyor" : day.totalLabel}</span>
          </summary>
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-sm">
            <People title="Sipariş veren çalışanlar" rows={day.employees} />
            <People title="Misafirler" rows={day.guests} />
            <p>Ofiste olmayanlar: {day.absent.length > 0 ? day.absent.join(", ") : "yok"}</p>
            <p>Günlük toplam: {day.missing ? "Toplam hesaplanamıyor" : day.totalLabel}</p>
          </div>
        </details>
      ))}
    </section>
  );
}

export function MonthlySpend({
  year,
  month,
  months,
}: {
  year: number;
  month: number | null;
  months: SpendMonth[];
}) {
  const visible = month ? months.filter((item) => item.month === month) : months;
  return (
    <section className="space-y-3">
      <h2 className="section-title">Aylık Yemek Toplamları</h2>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="sekme" value="aylik" />
        <label className="flex w-28 flex-col gap-1 text-sm text-slate-600">
          Yıl
          <input className="field" type="number" name="yil" min={2000} max={2100} defaultValue={year} />
        </label>
        <label className="flex w-44 flex-col gap-1 text-sm text-slate-600">
          Ay
          <select className="field" name="ay" defaultValue={month ?? ""}>
            <option value="">Tüm aylar</option>
            {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
        </label>
        <button className="btn-secondary" type="submit">Göster</button>
      </form>
      {visible.length === 0 ? <p className="panel-card text-sm text-slate-600">Bu dönem için kayıtlı yemek toplamı yok.</p> : visible.map((item) => (
        <details key={item.month} className="rounded-2xl border border-slate-200 bg-white px-4 py-3" open={month === item.month}>
          <summary className="flex cursor-pointer items-center justify-between gap-4">
            <span className="font-semibold">{item.label}</span>
            <span className="font-semibold">{item.missing ? "Toplam hesaplanamıyor" : item.totalLabel}</span>
          </summary>
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
            <p>Toplam yemek günü: {item.mealDays}</p>
            <p>Toplam sipariş: {item.orders}</p>
            <p>Tekil çalışan: {item.uniqueEmployees}</p>
            <p>Toplam katılım: {item.participations}</p>
            <p>Toplam gider: {item.missing ? "Toplam hesaplanamıyor" : item.totalLabel}</p>
            <DailySpend days={item.days} embedded />
          </div>
        </details>
      ))}
    </section>
  );
}
