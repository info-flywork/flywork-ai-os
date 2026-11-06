"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { refreshQuiet } from "@/client/refreshQuiet";
import Notice from "@/components/Notice";
import { finishWorkAction, setWorkFocusAction } from "@/app/(panel)/is-takibi/actions";
import { appHistoryReport, dayReport, formatWorkDuration, shiftIsoDate, shortDayLabel, taskHistoryReport } from "@/lib/workTime";

function initials(name) {
  const parts = String(name ?? "").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toLocaleUpperCase("tr");
}

function personColors(people) {
  const blue = 217;
  const used = [blue];
  const colors = new Map();
  const ordered = [...people].sort((left, right) => left.id.localeCompare(right.id));
  for (const person of ordered) {
    if (person.name.toLocaleLowerCase("tr").includes("emrah")) {
      colors.set(person.id, `hsl(${blue} 78% 42%)`);
      continue;
    }
    let hash = 2166136261;
    for (const char of person.id) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    let hue = (hash >>> 0) % 360;
    let guard = 0;
    while (
      used.some((taken) => {
        const gap = Math.abs(taken - hue);
        return Math.min(gap, 360 - gap) < 32;
      }) &&
      guard < 12
    ) {
      hue = (hue + 32) % 360;
      guard += 1;
    }
    used.push(hue);
    colors.set(person.id, `hsl(${hue} 70% 40%)`);
  }
  return colors;
}

function dayHeading(iso, today) {
  if (iso === today) return "Bugün";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function dayLabel(iso) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function cardHref(taskId) {
  return taskId ? `/is-takibi?kart=${encodeURIComponent(taskId)}` : "/is-takibi";
}

export default function WorkActivity({ data }) {
  const router = useRouter();
  const isAdmin = data.viewerRole === "ADMIN";
  const day = data.day ?? { now: [], paused: [], earlier: [], log: [], roster: [], team: false };
  const colors = useMemo(() => personColors(data.people ?? []), [data.people]);
  const people = useMemo(
    () => (data.people ?? [])
      .filter((person) => person.role === "EMPLOYEE")
      .map((person) => ({ userId: person.id, name: person.name })),
    [data.people],
  );
  const earliest = shiftIsoDate(data.today, -120);
  const [lookingAt, setLookingAt] = useState(data.today);
  const [view, setView] = useState("gun");
  const [jobQuery, setJobQuery] = useState("");
  const productApps = useMemo(() => [...(data.apps ?? [])], [data.apps]);
  const arconModules = useMemo(() => [...(data.arconModules ?? [])], [data.arconModules]);
  const otherWorkApp = data.otherWorkApp || "Diğer işler";
  const [appName, setAppName] = useState(productApps[0] ?? arconModules[0] ?? otherWorkApp);
  const [appMenuOpen, setAppMenuOpen] = useState(null);
  const [focusing, setFocusing] = useState(false);
  const [message, setMessage] = useState(null);
  const [sessionNow, setSessionNow] = useState(null);
  const [sessionPaused, setSessionPaused] = useState(null);
  const [tick, setTick] = useState(0);
  const appSource = arconModules.includes(appName) ? "arcon" : appName === otherWorkApp ? "other" : "apps";

  useEffect(() => {
    setSessionNow(null);
    setSessionPaused(null);
  }, [data.day]);

  useEffect(() => {
    const known = new Set([...productApps, ...arconModules, otherWorkApp]);
    if (!known.has(appName)) {
      setAppName(productApps[0] ?? arconModules[0] ?? otherWorkApp);
    }
  }, [productApps, arconModules, otherWorkApp, appName]);

  useEffect(() => {
    if (!appMenuOpen) return undefined;
    function onPointer(event) {
      if (event.target instanceof Element && event.target.closest("[data-app-menu]")) return;
      setAppMenuOpen(null);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [appMenuOpen]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      refreshQuiet(router);
      setTick((value) => value + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  const nowList = (sessionNow ?? day.now ?? []).filter((item) => isAdmin || item.userId === data.viewerId);
  const pausedList = (sessionPaused ?? day.paused ?? []).filter((item) => isAdmin || item.userId === data.viewerId);
  const myNow = nowList.filter((item) => item.userId === data.viewerId);
  const myPaused = pausedList.filter((item) => item.userId === data.viewerId);
  const archive = (isAdmin
    ? day.team
      ? (day.log ?? []).filter((item) => item.day === lookingAt)
      : lookingAt === data.today
        ? day.earlier ?? []
        : []
    : (day.earlier ?? []).filter((item) => item.userId === data.viewerId && item.day === data.today));
  const entries = data.timeLog ?? [];
  const byPerson = useMemo(() => dayReport(people, entries, lookingAt, new Date()), [people, entries, lookingAt, tick]);
  const byTask = useMemo(() => taskHistoryReport(people, entries, new Date()), [people, entries, tick]);
  const byApp = useMemo(() => appHistoryReport(people, entries, appName, new Date()), [people, entries, appName, tick]);
  const jobNeedle = jobQuery.trim().toLocaleLowerCase("tr");
  const shownJobs = useMemo(
    () => (jobNeedle ? byTask.filter((task) => task.title.toLocaleLowerCase("tr").includes(jobNeedle)) : byTask),
    [byTask, jobNeedle],
  );
  const workedPeople = byPerson.filter((person) => person.minutes > 0);
  const totalMinutes = byPerson.reduce((sum, person) => sum + person.minutes, 0);
  const jobMinutes = shownJobs.reduce((sum, task) => sum + task.minutes, 0);
  const appMinutes = byApp.reduce((sum, task) => sum + task.minutes, 0);
  const viewerName = data.people.find((person) => person.id === data.viewerId)?.name ?? "";

  function moveDay(step) {
    const next = shiftIsoDate(lookingAt, step);
    if (next < earliest || next > data.today) return;
    setLookingAt(next);
  }

  function chooseFocus(taskId) {
    const currentNow = sessionNow ?? day.now ?? [];
    const currentPaused = sessionPaused ?? day.paused ?? [];
    const runningMine = currentNow.find((item) => item.taskId === taskId && item.userId === data.viewerId);
    setFocusing(true);
    if (runningMine) {
      setSessionNow(currentNow.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)));
      setSessionPaused([
        ...currentPaused.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)),
        { ...runningMine, pausedLabel: "şimdi" },
      ]);
    } else {
      const previous = currentPaused.find((item) => item.taskId === taskId && item.userId === data.viewerId)
        ?? currentNow.find((item) => item.taskId === taskId);
      setSessionPaused(currentPaused.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)));
      setSessionNow([
        ...currentNow.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)),
        {
          id: previous?.id ?? `local-${taskId}`,
          userId: data.viewerId,
          userName: previous?.userName || viewerName,
          title: previous?.title ?? "",
          taskId,
          startedLabel: "şimdi",
        },
      ]);
    }
    void setWorkFocusAction(taskId).then((result) => {
      setFocusing(false);
      if (!result.ok) {
        setMessage(result.message);
        setSessionNow(null);
        setSessionPaused(null);
        return;
      }
      refreshQuiet(router);
    });
  }

  function finishFocus(taskId) {
    const currentNow = sessionNow ?? day.now ?? [];
    const current = currentNow.find((item) => item.taskId === taskId && item.userId === data.viewerId);
    setFocusing(true);
    setSessionNow(currentNow.filter((item) => !(item.taskId === taskId && item.userId === data.viewerId)));
    if (current) {
      setSessionPaused([...(sessionPaused ?? day.paused ?? []), { ...current, pausedLabel: "şimdi" }]);
    }
    void finishWorkAction(taskId).then((result) => {
      setFocusing(false);
      if (!result.ok) {
        setMessage(result.message);
        setSessionNow(null);
        setSessionPaused(null);
        return;
      }
      refreshQuiet(router);
    });
  }

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        {message ? <Notice tone="err">{message}</Notice> : null}
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr]">
          <p className="pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Bugün</p>
          <p className="text-sm text-slate-500 sm:col-span-1">{dayLabel(data.today)}</p>

          <p className="pt-1 text-xs font-bold uppercase tracking-wide text-[#03624c]">Şu an</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {myNow.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">Kartlar sekmesinden oynat düğmesiyle iş başlat.</p>
            ) : myNow.map((item) => (
              <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-emerald-50 py-1 pl-1 pr-2 text-sm">
                <Link href={cardHref(item.taskId)} className="inline-flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(item.userId) ?? "#03624c" }}>{initials(item.userName)}</span>
                  <span className="truncate font-semibold text-slate-800">{item.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{item.startedLabel}</span>
                </Link>
                <button type="button" className="shrink-0 text-xs font-semibold text-[#03624c]" disabled={focusing} onClick={() => chooseFocus(item.taskId)}>Durdur</button>
                <button type="button" className="shrink-0 text-xs font-semibold text-emerald-700" disabled={focusing} onClick={() => finishFocus(item.taskId)}>Bitir</button>
              </span>
            ))}
          </div>

          {myPaused.length > 0 ? (
            <>
              <p className="pt-1 text-xs font-bold uppercase tracking-wide text-amber-700">Durdu</p>
              <div className="flex min-w-0 flex-wrap gap-2">
                {myPaused.map((item) => (
                  <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-amber-50 py-1 pl-3 pr-2 text-sm text-slate-700">
                    <Link href={cardHref(item.taskId)} className="inline-flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs text-slate-400">{item.pausedLabel}</span>
                      <span className="truncate font-semibold">{item.title}</span>
                    </Link>
                    <button type="button" className="shrink-0 text-xs font-semibold text-[#03624c]" disabled={focusing} onClick={() => chooseFocus(item.taskId)}>Devam</button>
                    <button type="button" className="shrink-0 text-xs font-semibold text-emerald-700" disabled={focusing} onClick={() => finishFocus(item.taskId)}>Bitir</button>
                  </span>
                ))}
              </div>
            </>
          ) : null}

          <p className="pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Kapanan</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {archive.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">Bugün kapanan işin yok.</p>
            ) : archive.map((item) => (
              <Link key={item.id} href={cardHref(item.taskId)} className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-700">
                <span className="shrink-0 text-xs text-slate-400">{item.startedLabel}–{item.endedLabel}</span>
                <span className="truncate font-semibold">{item.title}</span>
                {item.done ? <span className="shrink-0 text-xs font-semibold text-emerald-700">bitti</span> : null}
              </Link>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <Link
            href="/is-takibi"
            className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-slate-500 no-underline hover:text-slate-700"
          >
            Kartlar
          </Link>
          <Link
            href="/is-takibi?sekme=calisma"
            className="inline-flex h-7 items-center rounded-md bg-white px-2.5 text-xs font-medium text-slate-800 no-underline shadow-sm"
          >
            Çalışma
          </Link>
        </div>
      </div>
      {message ? <Notice tone="err">{message}</Notice> : null}

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr]">
        <p className="pt-1 text-xs font-bold uppercase tracking-wide text-[#03624c]">Şu an</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          {myNow.map((item) => (
            <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-emerald-50 py-1 pl-1 pr-2 text-sm">
              <Link href={cardHref(item.taskId)} className="inline-flex min-w-0 items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(item.userId) ?? "#03624c" }}>{initials(item.userName)}</span>
                <span className="shrink-0 font-semibold text-slate-800">{item.userName}</span>
                <span className="truncate text-slate-600">{item.title}</span>
                <span className="shrink-0 text-xs text-slate-400">{item.startedLabel}</span>
              </Link>
              <button type="button" className="shrink-0 text-xs font-semibold text-[#03624c]" disabled={focusing} onClick={() => chooseFocus(item.taskId)}>Durdur</button>
              <button type="button" className="shrink-0 text-xs font-semibold text-emerald-700" disabled={focusing} onClick={() => finishFocus(item.taskId)}>Bitir</button>
            </span>
          ))}
          {day.roster.flatMap((person) => {
            const currents = person.currents?.length ? person.currents : person.current ? [person.current] : [];
            if (currents.length > 0) {
              return currents.map((current) => (
                <span key={`${person.userId}-${current.id}`} className="inline-flex max-w-full items-center gap-2 rounded-full bg-emerald-50 py-1 pl-1 pr-3 text-sm">
                  <Link href={cardHref(current.taskId)} className="inline-flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(person.userId) ?? "#03624c" }}>{initials(person.userName)}</span>
                    <span className="shrink-0 font-semibold text-slate-800">{person.userName}</span>
                    <span className="truncate text-slate-600">{current.title}</span>
                    <span className="shrink-0 text-xs text-slate-400">{current.startedLabel}</span>
                  </Link>
                </span>
              ));
            }
            const held = person.paused;
            return [
              <span key={person.userId} className={`inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm ${held ? "bg-amber-50" : "bg-slate-50"}`}>
                {held ? (
                  <Link href={cardHref(held.taskId)} className="inline-flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(person.userId) ?? "#03624c" }}>{initials(person.userName)}</span>
                    <span className="shrink-0 font-semibold text-slate-800">{person.userName}</span>
                    <span className="truncate text-slate-600">{held.title}</span>
                    <span className="shrink-0 text-xs font-semibold text-amber-700">durdu</span>
                  </Link>
                ) : (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(person.userId) ?? "#03624c" }}>{initials(person.userName)}</span>
                    <span className="shrink-0 font-semibold text-slate-800">{person.userName}</span>
                    <span className="truncate text-slate-400">iş seçmedi</span>
                  </span>
                )}
              </span>,
            ];
          })}
        </div>

        {pausedList.length > 0 ? (
          <>
            <p className="pt-1 text-xs font-bold uppercase tracking-wide text-amber-700">Durdu</p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {pausedList.map((item) => (
                <span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-amber-50 py-1 pl-3 pr-2 text-sm text-slate-700">
                  <Link href={cardHref(item.taskId)} className="inline-flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-xs text-slate-400">{item.pausedLabel}</span>
                    <span className="shrink-0 font-semibold">{item.userName}</span>
                    <span className="truncate">{item.title}</span>
                  </Link>
                  {item.userId === data.viewerId ? (
                    <>
                      <button type="button" className="shrink-0 text-xs font-semibold text-[#03624c]" disabled={focusing} onClick={() => chooseFocus(item.taskId)}>Devam</button>
                      <button type="button" className="shrink-0 text-xs font-semibold text-emerald-700" disabled={focusing} onClick={() => finishFocus(item.taskId)}>Bitir</button>
                    </>
                  ) : null}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={view === "gun" ? "btn-primary" : "btn-secondary"} onClick={() => { setView("gun"); setAppMenuOpen(null); }}>Gün gün</button>
            <button type="button" className={view === "is" ? "btn-primary" : "btn-secondary"} onClick={() => { setView("is"); setAppMenuOpen(null); }}>İş iş</button>
            <div className="relative" data-app-menu="">
              <button
                type="button"
                className={`${view === "uygulama" && appSource === "apps" ? "btn-primary" : "btn-secondary"} inline-flex items-center gap-1.5`}
                aria-expanded={appMenuOpen === "apps"}
                onClick={() => {
                  setView("uygulama");
                  setAppMenuOpen((value) => (value === "apps" ? null : "apps"));
                }}
              >
                {view === "uygulama" && appSource === "apps" && appName ? appName : "Uygulama"}
                <ChevronDown size={14} className={appMenuOpen === "apps" ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
              {appMenuOpen === "apps" ? (
                <div className="absolute left-0 top-full z-20 mt-1 max-h-72 min-w-[14rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {productApps.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-500">Uygulama yok.</p>
                  ) : productApps.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${name === appName ? "font-semibold text-[#03624c]" : "text-slate-700"}`}
                      onClick={() => {
                        setAppName(name);
                        setView("uygulama");
                        setAppMenuOpen(null);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="relative" data-app-menu="">
              <button
                type="button"
                className={`${view === "uygulama" && appSource === "arcon" ? "btn-primary" : "btn-secondary"} inline-flex items-center gap-1.5`}
                aria-expanded={appMenuOpen === "arcon"}
                onClick={() => {
                  setView("uygulama");
                  setAppMenuOpen((value) => (value === "arcon" ? null : "arcon"));
                }}
              >
                {view === "uygulama" && appSource === "arcon" && appName ? appName : "ARCON"}
                <ChevronDown size={14} className={appMenuOpen === "arcon" ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
              {appMenuOpen === "arcon" ? (
                <div className="absolute left-0 top-full z-20 mt-1 max-h-72 min-w-[14rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {arconModules.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-500">Modül yok.</p>
                  ) : arconModules.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${name === appName ? "font-semibold text-[#03624c]" : "text-slate-700"}`}
                      onClick={() => {
                        setAppName(name);
                        setView("uygulama");
                        setAppMenuOpen(null);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={view === "uygulama" && appSource === "other" ? "btn-primary" : "btn-secondary"}
              onClick={() => {
                setAppName(otherWorkApp);
                setView("uygulama");
                setAppMenuOpen(null);
              }}
            >
              Diğer işler
            </button>
          </div>
          {view === "gun" ? (
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-md px-1 text-sm font-bold text-slate-500 disabled:text-slate-300" aria-label="Önceki gün" disabled={lookingAt <= earliest} onClick={() => moveDay(-1)}>
                <ChevronLeft size={16} />
              </button>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{dayHeading(lookingAt, data.today)}</p>
              <button type="button" className="rounded-md px-1 text-sm font-bold text-slate-500 disabled:text-slate-300" aria-label="Sonraki gün" disabled={lookingAt >= data.today} onClick={() => moveDay(1)}>
                <ChevronRight size={16} />
              </button>
              <input
                type="date"
                className="field ml-2 w-40"
                aria-label="Gün seç"
                min={earliest}
                max={data.today}
                value={lookingAt}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next && next >= earliest && next <= data.today) setLookingAt(next);
                }}
              />
            </div>
          ) : view === "uygulama" ? (
            <p className="text-sm text-slate-500">
              {appName || "Uygulama"}
              {" · "}
              {byApp.length} kart · {formatWorkDuration(appMinutes)}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{shownJobs.length} iş · {formatWorkDuration(jobMinutes)}</p>
          )}
        </div>

        {view === "is" ? (
          <div className="mt-3">
            <label className="sr-only" htmlFor="is-isi-ara">İş ara</label>
            <input
              id="is-isi-ara"
              type="search"
              value={jobQuery}
              onChange={(event) => setJobQuery(event.target.value)}
              className="field w-full max-w-md"
              placeholder="İş adı ara…"
              autoComplete="off"
            />
          </div>
        ) : null}

        {view === "gun" ? (
          <>
            <p className="mt-3 text-sm font-medium text-slate-700">
              {dayLabel(lookingAt)}
              {lookingAt === data.today ? " · bugün" : ""}
              {" · "}
              {workedPeople.length} kişi · {formatWorkDuration(totalMinutes)}
            </p>

            <div className="mt-3 flex min-w-0 flex-wrap gap-2">
              {archive.length === 0 ? (
                <p className="py-1 text-sm text-slate-500">{lookingAt === data.today ? "Bugün kapanan iş yok." : "Bu günde kapanan iş yok."}</p>
              ) : archive.map((item) => (
                <Link key={item.id} href={cardHref(item.taskId)} className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-700">
                  <span className="shrink-0 text-xs text-slate-400">{item.startedLabel}–{item.endedLabel}</span>
                  <span className="shrink-0 font-semibold">{item.userName}</span>
                  <span className="truncate">{item.title}</span>
                  {item.done ? <span className="shrink-0 text-xs font-semibold text-emerald-700">bitti</span> : null}
                </Link>
              ))}
            </div>

            <ul className="mt-4 divide-y divide-slate-100">
              {workedPeople.length === 0 ? (
                <li className="py-3 text-sm text-slate-500">Bu günde çalışan yok.</li>
              ) : workedPeople.map((person) => (
                <li key={person.userId} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(person.userId) ?? "#03624c" }}>{initials(person.name)}</span>
                      <span className="truncate text-sm font-semibold text-slate-900">{person.name}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">
                      {formatWorkDuration(person.minutes)}
                      {person.running ? " · sürüyor" : ""}
                    </span>
                  </div>
                  <p className="mt-1 pl-9 text-xs font-semibold uppercase tracking-wide text-slate-400">Ne yaptı</p>
                  <ul className="mt-1.5 space-y-1.5 pl-9">
                    {person.stints.map((stint, index) => (
                      <li key={`${stint.taskId ?? stint.title}-${stint.from}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          {stint.taskId ? (
                            <Link href={cardHref(stint.taskId)} className="min-w-0 flex-1 text-sm font-medium text-slate-800 hover:underline">{stint.title}</Link>
                          ) : (
                            <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{stint.title}</span>
                          )}
                          <span className="shrink-0 text-sm font-semibold text-slate-700">{formatWorkDuration(stint.minutes)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{stint.from}–{stint.running ? "şimdi" : stint.to}{stint.running ? " · sürüyor" : ""}</p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        ) : view === "uygulama" ? (
          <ul className="mt-4 divide-y divide-slate-100">
            {!appName ? (
              <li className="py-3 text-sm text-slate-500">Uygulama seç.</li>
            ) : byApp.length === 0 ? (
              <li className="py-3 text-sm text-slate-500">{appName} için çalışma kaydı yok.</li>
            ) : byApp.map((task) => {
              const workers = [...new Map(
                task.days.flatMap((row) => row.stints.map((stint) => [stint.userId, stint.name])),
              ).entries()];
              return (
                <li key={task.taskId ?? task.title} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {task.taskId ? (
                        <Link href={cardHref(task.taskId)} className="text-sm font-semibold text-slate-900 hover:underline">{task.title}</Link>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900">{task.title}</span>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {workers.map(([, name]) => name).join(", ") || "Kimse"}
                        {" · "}
                        {task.days.length} gün
                        {task.running ? " · sürüyor" : ""}
                        {" · "}
                        {task.days.map((row) => shortDayLabel(row.day)).join(", ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">{formatWorkDuration(task.minutes)}</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {task.days.map((row) => (
                      <li key={row.day} className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            {row.day === data.today ? "Bugün" : shortDayLabel(row.day)}
                            <span className="ml-2 font-medium normal-case tracking-normal text-slate-400">{dayLabel(row.day)}</span>
                          </span>
                          <span className="text-sm font-semibold text-slate-700">{formatWorkDuration(row.minutes)}</span>
                        </div>
                        <ul className="mt-2 space-y-1">
                          {row.stints.map((stint, index) => (
                            <li key={`${stint.userId}-${stint.from}-${index}`} className="flex items-center gap-3 text-sm">
                              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(stint.userId) ?? "#03624c" }}>{initials(stint.name)}</span>
                              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{stint.name}</span>
                              <span className="shrink-0 text-slate-400">{stint.from}–{stint.running ? "şimdi" : stint.to}</span>
                              <span className="w-20 shrink-0 text-right text-slate-600">{formatWorkDuration(stint.minutes)}</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {byTask.length === 0 ? (
              <li className="py-3 text-sm text-slate-500">Henüz iş kaydı yok.</li>
            ) : shownJobs.length === 0 ? (
              <li className="py-3 text-sm text-slate-500">Aramaya uyan iş yok.</li>
            ) : shownJobs.map((task) => (
              <li key={task.taskId ?? task.title} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {task.taskId ? (
                      <Link href={cardHref(task.taskId)} className="text-sm font-semibold text-slate-900 hover:underline">{task.title}</Link>
                    ) : (
                      <span className="text-sm font-semibold text-slate-900">{task.title}</span>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {task.days.length} gün çalışıldı
                      {task.running ? " · sürüyor" : ""}
                      {" · "}
                      {task.days.map((row) => shortDayLabel(row.day)).join(", ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-900">{formatWorkDuration(task.minutes)}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {task.days.map((row) => (
                    <li key={row.day} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          {row.day === data.today ? "Bugün" : shortDayLabel(row.day)}
                          <span className="ml-2 font-medium normal-case tracking-normal text-slate-400">{dayLabel(row.day)}</span>
                        </span>
                        <span className="text-sm font-semibold text-slate-700">{formatWorkDuration(row.minutes)}</span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {row.stints.map((stint, index) => (
                          <li key={`${stint.userId}-${stint.from}-${index}`} className="flex items-center gap-3 text-sm">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: colors.get(stint.userId) ?? "#03624c" }}>{initials(stint.name)}</span>
                            <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{stint.name}</span>
                            <span className="shrink-0 text-slate-400">{stint.from}–{stint.running ? "şimdi" : stint.to}</span>
                            <span className="w-20 shrink-0 text-right text-slate-600">{formatWorkDuration(stint.minutes)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
