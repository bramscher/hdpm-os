import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one table look (UI Wave 4). Light styled elements — consistent chrome
 * for the 31 hand-rolled tables; no sorting/virtualization infrastructure.
 * Wrap in <Card> or the exported TableCard for the bordered surface.
 */

function TableCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card", className)}
      {...props}
    />
  );
}

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn("w-full text-sm", className)} {...props} />
  )
);
Table.displayName = "Table";

const THead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500",
        className
      )}
      {...props}
    />
  )
);
THead.displayName = "THead";

const TBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("divide-y divide-sand-100", className)} {...props} />
  )
);
TBody.displayName = "TBody";

const TR = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn("hover:bg-sand-50/60 transition-colors", className)} {...props} />
  )
);
TR.displayName = "TR";

const TH = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn("px-3 py-2 font-semibold", className)} {...props} />
  )
);
TH.displayName = "TH";

const TD = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-3 py-2 text-charcoal-700", className)} {...props} />
  )
);
TD.displayName = "TD";

export { TableCard, Table, THead, TBody, TR, TH, TD };
