import type { ReactNode } from "react";

export default function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
      {label}
      <span className="mt-1 block font-normal">{children}</span>
    </label>
  );
}
