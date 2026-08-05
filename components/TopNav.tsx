"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { FileText, BarChart3, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    label: "Invoices",
    href: "/maintenance/invoices",
    icon: FileText,
    matchPrefix: "/maintenance",
  },
  {
    label: "Rent Comps",
    href: "/comps",
    icon: BarChart3,
    matchPrefix: "/comps",
  },
  {
    label: "Company",
    href: "/company/scorecard",
    icon: Target,
    matchPrefix: "/company",
  },
];

export function TopNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Don't show nav on login page
  if (pathname === "/login") return null;

  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "??";

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200/60">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo + Brand */}
        <Link href="/" className="flex items-center gap-3 group">
          <Image
            src="/hdpm-logo.png"
            alt="HDPM"
            width={36}
            height={24}
            className="flex-shrink-0"
          />
          <span className="text-sm font-semibold text-slate-800 tracking-tight hidden sm:block">
            HDPM
          </span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.matchPrefix);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* User Avatar */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
            <span className="text-xs font-semibold text-slate-500">
              {initials}
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}
