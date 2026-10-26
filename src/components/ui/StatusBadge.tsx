const TONES = {
  ok: "bg-[#03624c]/10 text-[#03624c]",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
  neutral: "bg-slate-100 text-slate-600",
} as const;

export default function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
