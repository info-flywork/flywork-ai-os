import Link from "next/link";
import type { ReactNode } from "react";

const TONES = {
  green: "bg-[#03624c]/10 text-[#03624c]",
  blue: "bg-sky-50 text-sky-600",
  violet: "bg-violet-50 text-violet-600",
  orange: "bg-orange-50 text-orange-500",
} as const;

export default function StatCard({
  href,
  label,
  value,
  hint,
  icon,
  tone = "green",
}: {
  href?: string;
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: keyof typeof TONES;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        {icon ? <span className={`rounded-2xl p-2.5 ${TONES[tone]}`}>{icon}</span> : null}
      </div>
      <div className="mt-4 text-[1.65rem] font-semibold leading-tight tracking-tight text-slate-900">{value}</div>
      {hint ? <p className="mt-2 text-sm text-slate-400">{hint}</p> : null}
    </>
  );
  if (!href) {
    return <article className="panel-card">{body}</article>;
  }
  return (
    <Link href={href} className="panel-card block hover:border-[#03624c]">
      {body}
    </Link>
  );
}
