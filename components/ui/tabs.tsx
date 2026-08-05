"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";

/**
 * The two tab patterns (UI Wave 4).
 *
 * TabNav — route-level tabs as links (extracted from CompanySubNav): underline
 * style, terra active border, wayfinding via URL.
 *
 * Tabs/TabsList/TabsTrigger/TabsContent — Radix tabs for in-page state
 * (segmented style), replacing the hand-rolled useState button rows.
 */

export interface TabNavItem {
  label: string;
  href: string;
}

export function TabNav({ tabs, className }: { tabs: TabNavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn("border-b border-sand-200 bg-white", className)}>
      <nav className="mx-auto flex max-w-6xl gap-6 px-4">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "-mb-px border-b-2 py-3 text-sm font-medium transition-colors",
                active
                  ? "border-terra-500 text-charcoal-900"
                  : "border-transparent text-charcoal-500 hover:border-sand-300 hover:text-charcoal-700"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Current tab value + a unique layout id, so triggers can render the
 *  sliding indicator (motion layoutId) without fighting Radix internals. */
const TabsContext = React.createContext<{ value?: string; groupId: string }>({ groupId: "tabs" });

const Tabs = ({
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>) => {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value ?? internal;
  const groupId = React.useId();
  return (
    <TabsContext.Provider value={{ value: current, groupId }}>
      <TabsPrimitive.Root
        value={current}
        onValueChange={(v) => {
          setInternal(v);
          onValueChange?.(v);
        }}
        {...props}
      />
    </TabsContext.Provider>
  );
};

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext);
  const reduced = useReducedMotion();
  const active = ctx.value === value;
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-charcoal-500 transition-colors",
        "hover:text-charcoal-700 data-[state=active]:text-charcoal-900",
        className
      )}
      {...props}
    >
      {active && (
        <motion.span
          layoutId={`${ctx.groupId}-indicator`}
          className="absolute inset-0 rounded-lg bg-white shadow-card"
          transition={reduced ? { duration: 0 } : springSnappy}
          aria-hidden
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 outline-none animate-fade-in", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
