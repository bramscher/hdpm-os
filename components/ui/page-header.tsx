import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Standard page container + header (UI Wave 4). One content width for the
 * app: max-w-6xl. `width="full"` is the escape hatch for the board and map.
 */
export function PageContainer({
  width = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { width?: "default" | "full" }) {
  return (
    <div
      className={cn(
        "w-full px-4 py-8 sm:px-6",
        width === "default" && "mx-auto max-w-6xl",
        className
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-display text-charcoal-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-charcoal-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
