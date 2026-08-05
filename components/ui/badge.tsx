import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one badge/pill (UI Wave 4). tone = meaning, variant = weight.
 * Soft is the default (tinted background); solid for high-emphasis states;
 * outline for quiet metadata chips.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "",
        terra: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
      },
      variant: {
        soft: "",
        solid: "",
        outline: "border bg-transparent",
      },
    },
    compoundVariants: [
      { tone: "neutral", variant: "soft", class: "bg-sand-100 text-charcoal-700" },
      { tone: "neutral", variant: "solid", class: "bg-charcoal-700 text-white" },
      { tone: "neutral", variant: "outline", class: "border-sand-300 text-charcoal-600" },
      { tone: "terra", variant: "soft", class: "bg-terra-50 text-terra-700" },
      { tone: "terra", variant: "solid", class: "bg-terra-500 text-white" },
      { tone: "terra", variant: "outline", class: "border-terra-200 text-terra-700" },
      { tone: "success", variant: "soft", class: "bg-green-50 text-green-800" },
      { tone: "success", variant: "solid", class: "bg-green-700 text-white" },
      { tone: "success", variant: "outline", class: "border-green-200 text-green-700" },
      { tone: "warning", variant: "soft", class: "bg-amber-50 text-amber-800" },
      { tone: "warning", variant: "solid", class: "bg-amber-600 text-white" },
      { tone: "warning", variant: "outline", class: "border-amber-200 text-amber-700" },
      { tone: "danger", variant: "soft", class: "bg-red-50 text-red-700" },
      { tone: "danger", variant: "solid", class: "bg-red-600 text-white" },
      { tone: "danger", variant: "outline", class: "border-red-200 text-red-700" },
      { tone: "info", variant: "soft", class: "bg-blue-50 text-blue-700" },
      { tone: "info", variant: "solid", class: "bg-blue-600 text-white" },
      { tone: "info", variant: "outline", class: "border-blue-200 text-blue-700" },
    ],
    defaultVariants: {
      tone: "neutral",
      variant: "soft",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
