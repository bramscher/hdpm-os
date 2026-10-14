"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Expired sessions (8 hours). The offline worker (public/kc-sw.js) opens the
 * saved page and owner list when signed out so recording still works — which
 * also means nobody is sent to sign-in. Saves then come back 401. This module
 * notices (a session check on open, or any 401) and offers sign-in instead of
 * a bare "Authentication required".
 */

export const SIGN_IN_URL = "/login?callbackUrl=%2Fknowledge-capture";

let signedOut = false;
const listeners = new Set<() => void>();

function setSignedOut(v: boolean) {
  if (signedOut === v) return;
  signedOut = v;
  listeners.forEach((fn) => fn());
}

export class SignedOutError extends Error {
  constructor() {
    super("Your sign-in has expired. Sign in again to save.");
    this.name = "SignedOutError";
  }
}

/** The error for a failed Knowledge Capture request; a 401 also raises the sign-in banner. */
export function requestError(res: Response, body: { error?: string }): Error {
  if (res.status === 401) {
    setSignedOut(true);
    return new SignedOutError();
  }
  return new Error(body.error || `Request failed (${res.status})`);
}

/** Toast for a failed action; an expired session gets a Sign in button. */
export function showError(err: unknown, fallback: string) {
  if (err instanceof SignedOutError) {
    toast.error(err.message, { action: { label: "Sign in", onClick: () => window.location.assign(SIGN_IN_URL) }, duration: 15000 });
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}

export function useSignedOut(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => signedOut,
    () => false
  );
}

/** Checks the session when the page opens, comes back online, or returns to the foreground. */
function useSessionCheck() {
  useEffect(() => {
    const check = async () => {
      if (!navigator.onLine || document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        setSignedOut(!body?.user);
      } catch {
        // No signal: can't tell; recording works either way.
      }
    };
    void check();
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
}

/** Shown when the session has expired: recording still works, saving needs sign-in. */
export function SignInBanner() {
  useSessionCheck();
  const out = useSignedOut();
  if (!out) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>Your sign-in has expired. Sign in again to save notes — recordings stay on this phone until you do.</span>
      <Button size="sm" onClick={() => window.location.assign(SIGN_IN_URL)}>
        <LogIn className="mr-2 h-4 w-4" />
        Sign in again
      </Button>
    </div>
  );
}
