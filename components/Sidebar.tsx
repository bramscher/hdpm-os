"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { FileText, BarChart3, Home, MessageCircle, LogOut, ChevronRight, ChevronLeft, ClipboardList, ClipboardCheck, Navigation, Megaphone, Activity, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/",
    icon: Home,
    matchExact: true,
  },
  {
    label: "KPI Dashboard",
    href: "/dashboard",
    icon: Activity,
    matchPrefix: "/dashboard",
    adminOnly: true,
  },
  {
    label: "Invoices",
    href: "/maintenance/invoices",
    icon: FileText,
    matchPrefix: "/maintenance/invoices",
    badge: null as string | null,
  },
  {
    label: "Backlog Triage",
    href: "/maintenance/triage",
    icon: ClipboardList,
    matchPrefix: "/maintenance/triage",
  },
  {
    label: "Inspections",
    href: "/maintenance/inspections",
    icon: ClipboardCheck,
    matchPrefix: "/maintenance/inspections",
    matchExclude: "/maintenance/inspections/routes",
  },
  {
    label: "Route Builder",
    href: "/maintenance/inspections/routes",
    icon: Navigation,
    matchPrefix: "/maintenance/inspections/routes",
  },
  {
    label: "Rent Comps",
    href: "/comps",
    icon: BarChart3,
    matchPrefix: "/comps",
  },
  {
    label: "Craigslist",
    href: "/craigslist",
    icon: Megaphone,
    matchPrefix: "/craigslist",
  },
  {
    label: "Zoom Sync",
    href: "/admin/zoom-sync",
    icon: Phone,
    matchPrefix: "/admin/zoom-sync",
    adminOnly: true,
  },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggleChat?: () => void;
  isChatOpen?: boolean;
}

export function Sidebar({ collapsed = false, onToggleChat, isChatOpen = false }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;

  // Don't show sidebar on login page
  if (pathname === "/login") return null;

  const navItems = NAV_ITEMS.filter(
    (item) => !(item as { adminOnly?: boolean }).adminOnly || isAdmin
  );

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
    <aside
      className={cn(
        "fixed left-0 top-0 bottom-0 sidebar-gradient shadow-sidebar z-50 flex flex-col transition-all duration-300 ease-in-out",
        collapsed ? "w-[64px]" : "w-[220px]"
      )}
    >
      {/* Brand */}
      <div className={cn("pt-6 pb-4 transition-all duration-300", collapsed ? "px-3" : "px-4")}>
        <Link href="/" className="block group" title="Dashboard">
          {collapsed ? (
            <div className="w-10 h-10 mx-auto rounded-lg bg-white/10 flex items-center justify-center">
              <Image
                src="/HDPM-SecondaryLogo-White.png"
                alt="HDPM"
                width={28}
                height={28}
                className="opacity-90 group-hover:opacity-100 transition-opacity object-contain"
              />
            </div>
          ) : (
            <Image
              src="/HDPM-SecondaryLogo-White.png"
              alt="HDPM"
              width={200}
              height={60}
              className="w-full h-auto opacity-90 group-hover:opacity-100 transition-opacity"
            />
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 mt-2">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const prefixMatch = pathname.startsWith(item.matchPrefix ?? item.href);
            const excludePrefix = "matchExclude" in item ? item.matchExclude : undefined;
            const excluded = excludePrefix ? pathname.startsWith(excludePrefix) : false;
            const isActive = item.matchExact
              ? pathname === item.href
              : prefixMatch && !excluded;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-lg text-[13px] font-medium transition-all duration-150 group relative",
                  collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-charcoal-400 hover:text-white hover:bg-white/[0.05]"
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-terra-500 rounded-r-full" />
                )}
                <Icon className={cn("w-[18px] h-[18px] flex-shrink-0", isActive ? "text-terra-400" : "")} />
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && isActive && (
                  <ChevronRight className="w-3.5 h-3.5 text-charcoal-500" />
                )}
              </Link>
            );
          })}
        </div>

        {/* AI Chat section */}
        <div className={cn("mt-6 pt-4 border-t border-white/[0.06]", collapsed && "border-none mt-4 pt-2")}>
          {!collapsed && (
            <p className="px-3 mb-2 text-2xs font-semibold text-charcoal-500 uppercase tracking-widest">
              AI Assistant
            </p>
          )}
          <button
            className={cn(
              "flex items-center rounded-lg text-[13px] font-medium transition-all duration-150 w-full group",
              collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5 text-left",
              isChatOpen
                ? "bg-white/10 text-white"
                : "text-charcoal-400 hover:text-white hover:bg-white/[0.05]"
            )}
            onClick={onToggleChat}
            title={collapsed ? "ORS 90 Chat" : undefined}
          >
            {isChatOpen && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-terra-500 rounded-r-full" />
            )}
            <MessageCircle className={cn("w-[18px] h-[18px] flex-shrink-0", isChatOpen ? "text-terra-400" : "")} />
            {!collapsed && <span className="flex-1">ORS 90 Chat</span>}
            {!collapsed && <span className="w-2 h-2 rounded-full bg-green-400 opacity-75" />}
          </button>
        </div>
      </nav>

      {/* Collapse / expand hint at bottom when in chat */}
      {isChatOpen && (
        <div className="px-2 pb-2">
          <button
            onClick={onToggleChat}
            className="flex items-center justify-center w-full py-2 rounded-lg text-charcoal-500 hover:text-white hover:bg-white/[0.05] transition-all duration-150"
            title="Close chat"
          >
            <ChevronLeft className={cn("w-4 h-4 transition-transform", collapsed && "rotate-180")} />
            {!collapsed && <span className="text-2xs ml-1">Collapse</span>}
          </button>
        </div>
      )}

      {/* User section at bottom */}
      <div className="px-2 pb-4 mt-auto">
        <div className="border-t border-white/[0.06] pt-3">
          <div className={cn("flex items-center py-2", collapsed ? "justify-center px-0" : "gap-3 px-3")}>
            <div className="w-8 h-8 rounded-full bg-terra-500/20 border border-terra-500/30 flex items-center justify-center flex-shrink-0">
              <span className="text-2xs font-bold text-terra-400">
                {initials}
              </span>
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">
                    {firstName}
                  </p>
                  <p className="text-2xs text-charcoal-500 truncate">
                    {session?.user?.email ?? ""}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-charcoal-500 hover:text-charcoal-300 transition-colors p-1"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
