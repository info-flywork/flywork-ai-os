export default function Notice({
  tone,
  children,
}: {
  tone: "ok" | "err";
  children: string;
}) {
  const className =
    tone === "ok"
      ? "border-[#03624c]/30 bg-[#03624c]/10 text-[#03624c]"
      : "border-red-700 bg-red-50 text-red-900";

  return (
    <p role="status" className={`rounded-xl border px-3 py-2 text-sm ${className}`}>
      {children}
    </p>
  );
}
