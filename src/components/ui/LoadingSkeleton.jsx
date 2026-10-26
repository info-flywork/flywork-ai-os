export default function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-4 md:p-8" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-xl bg-slate-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl bg-white" />
        ))}
      </div>
    </div>
  );
}
