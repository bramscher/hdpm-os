import { cn } from "@/lib/utils";

/**
 * Loading placeholder (UI Wave 4). Sand-toned pulse; build skeleton layouts
 * that mirror the loaded markup so nothing shifts when data lands.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-lg bg-sand-100", className)} {...props} />;
}

/** A few rows of table-shaped placeholder. */
function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** A card-shaped placeholder for grid layouts. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-sand-200 bg-white p-5 shadow-card", className)}>
      <Skeleton className="h-4 w-1/3 mb-3" />
      <Skeleton className="h-8 w-1/2 mb-2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export { Skeleton, SkeletonRows, SkeletonCard };
