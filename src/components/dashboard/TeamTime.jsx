"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayReport, formatWorkDuration, shiftIsoDate } from "@/lib/workTime";

function dayLabel(iso) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  }).format(new Date(`${iso}T12:00:00Z`));
}

export default function TeamTime({ today, people, entries }) {
  const earliest = shiftIsoDate(today, -120);
  const [day, setDay] = useState(today);
  const [tick, setTick] = useState(0);
  const report = useMemo(() => dayReport(people, entries, day, new Date()), [people, entries, day, tick]);
  const total = report.reduce((sum, person) => sum + person.minutes, 0);
  const worked = report.filter((person) => person.minutes > 0).length;

  function move(step) {
    const next = shiftIsoDate(day, step);
    if (next < earliest || next > today) return;
    setDay(next);
    setTick((value) => value + 1);
  }

  return (
    <section className="panel-card mt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Ekip durumu</h2>
          <p className="text-sm text-slate-500">{worked} kişi çalıştı · {formatWorkDuration(total)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary px-2" aria-label="Önceki gün" disabled={day <= earliest} onClick={() => move(-1)}>
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            className="field w-40"
            aria-label="Gün seç"
            min={earliest}
            max={today}
            value={day}
            onChange={(event) => {
              const next = event.target.value;
              if (next && next >= earliest && next <= today) setDay(next);
            }}
          />
          <button type="button" className="btn-secondary px-2" aria-label="Sonraki gün" disabled={day >= today} onClick={() => move(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm font-medium text-slate-700">{dayLabel(day)}{day === today ? " · bugün" : ""}</p>
      <ul className="divide-y divide-slate-100">
        {report.map((person) => (
          <li key={person.userId} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-semibold text-slate-900">{person.name}</span>
              <span className={`shrink-0 text-sm font-semibold ${person.minutes > 0 ? "text-slate-900" : "text-slate-400"}`}>
                {formatWorkDuration(person.minutes)}
                {person.running ? " · sürüyor" : ""}
              </span>
            </div>
            {person.stints.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">Kayıt yok</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {person.stints.map((stint, index) => (
                  <li key={`${stint.taskId ?? stint.title}-${stint.from}-${index}`} className="flex items-center gap-3 text-sm">
                    {stint.taskId ? (
                      <Link href={`/is-takibi?kart=${stint.taskId}`} className="min-w-0 flex-1 truncate text-slate-700 hover:underline">
                        {stint.title}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-slate-700">{stint.title}</span>
                    )}
                    <span className="shrink-0 text-slate-400">{stint.from}–{stint.running ? "şimdi" : stint.to}</span>
                    <span className="w-20 shrink-0 text-right text-slate-600">{formatWorkDuration(stint.minutes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
