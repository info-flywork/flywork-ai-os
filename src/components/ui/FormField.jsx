

export default function FormField({
  label,
  htmlFor,
  children,
}



) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
      {label}
      <span className="mt-1 block font-normal">{children}</span>
    </label>
  );
}
