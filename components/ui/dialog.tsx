"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one modal (UI Wave 4). Radix Dialog for real a11y (focus trap, focus
 * return, aria wiring, scroll lock) styled to the Desert card language.
 *
 * `Modal` is the app-facing wrapper with the ModalShell contract
 * (title/onClose/busy/footer/wide) so existing call sites migrate by
 * changing only the import; `busy` blocks Escape and overlay dismissal
 * exactly as ModalShell did.
 */

interface ModalProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, busy, children, footer, wide }: ModalProps) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-charcoal-900/25 backdrop-blur-sm data-[state=open]:animate-fade-in"
          onClick={() => !busy && onClose()}
        />
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none">
          <DialogPrimitive.Content
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              if (busy) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              if (busy) e.preventDefault();
            }}
            className={cn(
              "pointer-events-auto relative w-full max-h-[85vh] flex flex-col",
              "rounded-2xl border border-sand-200 bg-white/90 backdrop-blur-2xl shadow-card-hover",
              "data-[state=open]:animate-slide-up",
              wide ? "max-w-2xl" : "max-w-lg"
            )}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-sand-200">
              <DialogPrimitive.Title className="text-heading text-charcoal-900">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <button
                  onClick={onClose}
                  disabled={busy}
                  aria-label="Close"
                  className="text-charcoal-400 hover:text-charcoal-700 transition-colors disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </DialogPrimitive.Close>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
            {footer && <div className="px-5 py-4 border-t border-sand-200">{footer}</div>}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
