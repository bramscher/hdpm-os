"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Info, X, BookOpen, ArrowUpRight } from "lucide-react";
import { findHelpSop, SOP_LIBRARY_URL } from "@/lib/help-sops";

/**
 * Global help affordance — an info circle fixed to the bottom-right of every
 * page. Opens a small popover linking to the current page's SOP in the Notion
 * SOP library (HDPM-OS App section). Pages without a mapped SOP fall back to
 * the library index.
 */
export function HelpButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the popover on navigation so it never shows a stale page's SOP.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (pathname === "/login") return null;

  const sop = findHelpSop(pathname);

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {open && (
        <div className="absolute bottom-12 right-0 w-72 rounded-xl border border-sand-200 bg-white p-4 shadow-card-hover">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-terra-500">
              How this page works
            </p>
            <button
              onClick={() => setOpen(false)}
              className="text-charcoal-300 hover:text-charcoal-600"
              aria-label="Close help"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {sop ? (
            <>
              <p className="text-sm font-semibold text-charcoal-900">{sop.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-charcoal-500">{sop.blurb}</p>
              <a
                href={sop.notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-1.5 rounded-lg bg-charcoal-900 px-3 py-2 text-xs font-medium text-white hover:bg-charcoal-800"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Open SOP in Notion
                <ArrowUpRight className="ml-auto h-3.5 w-3.5" />
              </a>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-charcoal-500">
              No SOP is mapped to this page yet.
            </p>
          )}
          <a
            href={SOP_LIBRARY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-charcoal-400 hover:text-charcoal-600"
          >
            Browse the full SOP library ↗
          </a>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Page help & SOP"
        title="Page help & SOP"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-sand-200 bg-white text-charcoal-400 shadow-card transition-colors hover:text-terra-600 hover:shadow-card-hover"
      >
        <Info className="h-5 w-5" />
      </button>
    </div>
  );
}
