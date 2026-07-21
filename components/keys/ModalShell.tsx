"use client";

import React, { useCallback, useEffect } from "react";
import { X } from "lucide-react";

interface ModalShellProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

/** Fixed-overlay modal following the invoices capture-payment-modal pattern. */
export function ModalShell({ title, onClose, busy, children, footer, wide }: ModalShellProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    },
    [onClose, busy]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-charcoal-900/40" onClick={() => !busy && onClose()} />
      <div
        className={`relative bg-white rounded-xl shadow-xl border border-sand-200 w-full ${
          wide ? "max-w-2xl" : "max-w-lg"
        } max-h-[85vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-sand-200">
          <h2 className="text-base font-bold text-charcoal-900">{title}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-charcoal-400 hover:text-charcoal-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-sand-200">{footer}</div>}
      </div>
    </div>
  );
}
