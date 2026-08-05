import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Empty state (UI Wave 4): icon + what's empty + why/what next. Use instead
 * of bare "No data" divs so empty never reads as broken.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-sand-100">
          <Icon className="h-5 w-5 text-charcoal-400" />
        </div>
      )}
      <p className="text-heading text-charcoal-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-charcoal-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
