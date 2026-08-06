"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, BarChart3, Home, MessageCircle, LogOut, ClipboardCheck, Navigation, Megaphone, Activity, Phone, Wrench, Bot, KeyRound, Target, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { springDefault } from "@/lib/motion";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPrefix?: string;
  matchExclude?: string;
  matchExact?: boolean;
}

interface NavSection {
  label: string | null;
  adminOnly?: boolean;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/", icon: Home, matchExact: true }],
  },
  {
    label: "Maintenance",
    items: [
      { label: "MaintOS", href: "/maintenance/board", icon: Wrench, matchPrefix: "/maintenance/board" },
      { label: "Invoices", href: "/maintenance/invoices", icon: FileText, matchPrefix: "/maintenance/invoices" },
      {
        label: "Inspections",
        href: "/maintenance/inspections",
        icon: ClipboardCheck,
        matchPrefix: "/maintenance/inspections",
        matchExclude: "/maintenance/inspections/routes",
      },
      { label: "Route Builder", href: "/maintenance/inspections/routes", icon: Navigation, matchPrefix: "/maintenance/inspections/routes" },
    ],
  },
  {
    label: "Leasing",
    items: [
      { label: "Rent Comps", href: "/comps", icon: BarChart3, matchPrefix: "/comps" },
      { label: "Craigslist", href: "/craigslist", icon: Megaphone, matchPrefix: "/craigslist" },
      { label: "Keys", href: "/keys", icon: KeyRound, matchPrefix: "/keys" },
    ],
  },
  {
    label: "Company",
    items: [
      { label: "Company", href: "/company/scorecard", icon: Target, matchPrefix: "/company" },
      { label: "Agents", href: "/agents", icon: Bot, matchPrefix: "/agents" },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { label: "Company KPIs", href: "/dashboard", icon: Activity, matchPrefix: "/dashboard" },
      { label: "Zoom Sync", href: "/admin/zoom-sync", icon: Phone, matchPrefix: "/admin/zoom-sync" },
    ],
  },
];

function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.matchExact) return pathname === item.href;
  const prefixMatch = pathname.startsWith(item.matchPrefix ?? item.href);
  const excluded = item.matchExclude ? pathname.startsWith(item.matchExclude) : false;
  return prefixMatch && !excluded;
}

/** Section label for the current route — mobile top bar wayfinding. */
export function currentSectionLabel(pathname: string): string {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (isItemActive(item, pathname)) return item.label;
    }
  }
  if (pathname === "/") return "Dashboard";
  return "HDPM";
}

interface SidebarContentProps {
  onToggleChat?: () => void;
  isChatOpen?: boolean;
  onNavigate?: () => void;
}

/** The nav content itself — rendered inside the desktop rail and the mobile drawer. */
function SidebarContent({ onToggleChat, isChatOpen = false, onNavigate }: SidebarContentProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;

  const sections = NAV_SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "??";

  const firstName = session?.user?.name?.split(" ")[0] ?? "User";

  return (
    <>
      {/* Brand */}
      <div className="pt-6 pb-4 px-4">
        <Link href="/" className="block group" title="Dashboard" onClick={onNavigate}>
          <Image
            src="/HDPM-SecondaryLogo-Black.png"
            alt="HDPM"
            width={200}
            height={60}
            className="w-full h-auto opacity-90 group-hover:opacity-100 transition-opacity"
          />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 mt-2 overflow-y-auto">
        {sections.map((section, i) => (
          <div key={section.label ?? "home"} className={cn(i > 0 && "mt-5")}>
            {section.label && (
              <p className="px-3 mb-1.5 text-2xs font-semibold text-charcoal-500 uppercase tracking-widest">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = isItemActive(item, pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors duration-150 group",
                      isActive
                        ? "text-terra-600"
                        : "text-charcoal-500 hover:text-charcoal-900 hover:bg-charcoal-900/[0.04]"
                    )}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* AI Chat section */}
        <div className="mt-6 pt-4 border-t border-sand-200">
          <p className="px-3 mb-2 text-2xs font-semibold text-charcoal-500 uppercase tracking-widest">
            AI Assistant
          </p>
          <button
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors duration-150 w-full group text-left",
              isChatOpen
                ? "text-terra-600"
                : "text-charcoal-500 hover:text-charcoal-900 hover:bg-charcoal-900/[0.04]"
            )}
            onClick={() => {
              onToggleChat?.();
              onNavigate?.();
            }}
          >
            <MessageCircle className="w-[18px] h-[18px] flex-shrink-0" />
            <span className="flex-1">Knowledge Chat</span>
            <span className="w-2 h-2 rounded-full bg-green-400 opacity-75" />
          </button>
        </div>
      </nav>

      {/* User section at bottom */}
      <div className="px-2 pb-4 mt-auto">
        <div className="border-t border-sand-200 pt-3">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-terra-500/20 border border-terra-500/30 flex items-center justify-center flex-shrink-0">
              <span className="text-2xs font-bold text-terra-600">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-charcoal-900 truncate">{firstName}</p>
              <p className="text-2xs text-charcoal-500 truncate">{session?.user?.email ?? ""}</p>
            </div>
            <button
              onClick={() => signOut({ redirectTo: "/login" })}
              className="text-charcoal-500 hover:text-charcoal-700 transition-colors p-1"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface SidebarProps {
  onToggleChat?: () => void;
  isChatOpen?: boolean;
}

/** Desktop rail — hidden below md (MobileNav takes over there). */
export function Sidebar({ onToggleChat, isChatOpen = false }: SidebarProps) {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-[220px] sidebar-gradient z-50 flex-col">
      <SidebarContent onToggleChat={onToggleChat} isChatOpen={isChatOpen} />
    </aside>
  );
}

/** Mobile chrome: sticky glass top bar + slide-in nav drawer (below md). */
export function MobileNav({ onToggleChat, isChatOpen = false }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  // Escape closes; body scroll locks while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (pathname === "/login") return null;

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-40 glass-chrome scroll-edge-fade flex items-center gap-3 h-12 px-3">
        <button
          onClick={() => setOpen(true)}
          className="p-2 -ml-1 rounded-lg text-charcoal-700 hover:bg-sand-100 transition-colors"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Image src="/hdpm-logo.png" alt="HDPM" width={30} height={20} className="flex-shrink-0" />
        <span className="text-sm font-semibold text-charcoal-800 tracking-tight truncate">
          {currentSectionLabel(pathname)}
        </span>
      </header>

      {/* Drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="overlay"
              className="fixed inset-0 z-50 bg-charcoal-950/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="drawer"
              className="fixed left-0 top-0 bottom-0 z-50 w-[260px] sidebar-gradient shadow-sidebar flex flex-col"
              initial={reducedMotion ? { opacity: 0 } : { x: -260 }}
              animate={reducedMotion ? { opacity: 1 } : { x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { x: -260 }}
              transition={reducedMotion ? { duration: 0.2 } : springDefault}
              role="dialog"
              aria-label="Navigation"
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute top-4 right-3 p-1.5 rounded-lg text-charcoal-500 hover:text-charcoal-900 hover:bg-charcoal-900/[0.04] transition-colors"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
              <SidebarContent
                onToggleChat={onToggleChat}
                isChatOpen={isChatOpen}
                onNavigate={() => setOpen(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
