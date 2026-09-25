"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, BarChart3, Home, LogOut, ClipboardCheck, Navigation, Megaphone, Activity, Phone, Wrench, Bot, KeyRound, Target, Menu, X, BookOpen, RefreshCw, Clock3, ListTodo, Percent, Users } from "lucide-react";
import { canViewHabuDemo } from "@/lib/habu-demo-access";
import { APP_SECTIONS, sectionForPage } from "@/lib/access/sections";
import { cn } from "@/lib/utils";
import { springDefault } from "@/lib/motion";

interface NavItem {
  key: string;
  ownerOnly?: boolean;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string | null;
  adminOnly?: boolean;
  items: NavItem[];
}

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home, list: ListTodo, wrench: Wrench, file: FileText, clipboard: ClipboardCheck, navigation: Navigation,
  refresh: RefreshCw, book: BookOpen, chart: BarChart3, megaphone: Megaphone, key: KeyRound, target: Target,
  clock: Clock3, bot: Bot, users: Users, activity: Activity, percent: Percent, phone: Phone,
};

/** Menu built from the section registry (lib/access/sections.ts) — new sections appear automatically. */
const NAV_SECTIONS: NavSection[] = (["main", "Maintenance", "Leasing", "Company", "Admin"] as const).map((group) => ({
  label: group === "main" ? null : group,
  adminOnly: group === "Admin",
  items: APP_SECTIONS.filter((s) => s.group === group && s.nav)
    .sort((x, y) => x.nav!.order - y.nav!.order)
    .map((s) => ({ key: s.key, label: s.label, href: s.nav!.href, icon: NAV_ICONS[s.nav!.icon] ?? FileText, ownerOnly: s.ownerOnly })),
}));

function isItemActive(item: NavItem, pathname: string): boolean {
  return sectionForPage(pathname)?.key === item.key;
}

/** Section label for the current route — mobile top bar wayfinding. */
export function currentSectionLabel(pathname: string): string {
  return sectionForPage(pathname)?.label ?? "HDPM";
}

interface SidebarContentProps {
  onNavigate?: () => void;
}

/** The nav content itself — rendered inside the desktop rail and the mobile drawer. */
function SidebarContent({ onNavigate }: SidebarContentProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;
  const reducedMotion = useReducedMotion();

  const denied = new Set(session?.user?.deniedSections ?? []);
  const sections = NAV_SECTIONS.filter((s) => !s.adminOnly || isAdmin)
    .map((s) => ({
      ...s,
      items: s.items.filter((item) => !denied.has(item.key) && (!item.ownerOnly || canViewHabuDemo(session?.user))),
    }))
    .filter((s) => s.items.length > 0);

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
          <div key={section.label ?? "home"} className={cn(i > 0 && "mt-4")}>
            {section.label && (
              <p className="px-2.5 mb-1 text-[11px] font-medium text-charcoal-400">
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
                      "relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors duration-150 group",
                      isActive
                        ? "font-semibold text-charcoal-950"
                        : "font-medium text-charcoal-600 hover:text-charcoal-950 hover:bg-charcoal-900/[0.04]"
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="nav-active-pill"
                        className="absolute inset-0 rounded-md nav-glass-active"
                        transition={reducedMotion ? { duration: 0 } : springDefault}
                        aria-hidden
                      />
                    )}
                    <Icon
                      className={cn(
                        "relative z-10 w-4 h-4 flex-shrink-0",
                        isActive ? "text-charcoal-950" : "text-charcoal-500"
                      )}
                    />
                    <span className="relative z-10 flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User section at bottom */}
      <div className="px-2 pb-4 mt-auto">
        <div className="border-t border-sand-200 pt-3">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-charcoal-950 flex items-center justify-center flex-shrink-0">
              <span className="text-2xs font-bold text-white">{initials}</span>
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

/** Desktop rail — hidden below md (MobileNav takes over there). */
export function Sidebar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-[220px] sidebar-gradient z-50 flex-col">
      <SidebarContent />
    </aside>
  );
}

/** Mobile chrome: sticky glass top bar + slide-in nav drawer (below md). */
export function MobileNav() {
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
              <SidebarContent onNavigate={() => setOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
