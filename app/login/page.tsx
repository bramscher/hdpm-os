"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";

function LoginContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    if (session) {
      router.push("/");
    }
  }, [session, router]);

  if (status === "loading") {
    return <LoginSpinner />;
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left — the OS brand panel */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden bg-black text-white flex-col justify-between p-12">
        <div className="os-login-grid absolute inset-0" aria-hidden />

        <div className="relative z-10 flex items-center gap-2.5 animate-slide-up">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-[13px] font-black text-black">
            H
          </span>
          <span className="text-sm font-medium tracking-tight text-white/80">os.highdesertpm.com</span>
        </div>

        <div className="relative z-10 animate-slide-up" style={{ animationDelay: "80ms" }}>
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
            High Desert Property Management
          </p>
          <h1 className="text-[76px] font-bold leading-[0.9] tracking-[-0.045em]">
            HDPM
            <br />
            <span className="text-white/35">OS</span>
            <span className="os-caret ml-2 inline-block h-[0.72em] w-[0.09em] translate-y-[0.02em] bg-white align-baseline" />
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-white/55">
            The operating system for property management. Maintenance, leasing, inspections, and
            the numbers behind them, in one place.
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 font-mono text-[11px] text-white/45 animate-slide-up" style={{ animationDelay: "160ms" }}>
          {[
            ["AppFolio", "connected"],
            ["Agents", "online"],
            ["Region", "Central Oregon"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="uppercase tracking-[0.18em] text-white/30">{k}</p>
              <p className="mt-1 flex items-center gap-1.5 text-white/75">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {v}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Right — sign in */}
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[340px] animate-slide-up" style={{ animationDelay: "120ms" }}>
          {/* Mobile brand */}
          <div className="lg:hidden mb-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-charcoal-400">
              os.highdesertpm.com
            </p>
            <h1 className="mt-2 text-5xl font-bold tracking-[-0.04em] text-black">
              HDPM <span className="text-charcoal-300">OS</span>
            </h1>
            <p className="mt-2 text-sm text-charcoal-500">The HDPM Operating System</p>
          </div>

          <Image
            src="/HDPM-PrimaryLogo-Black.png"
            alt="High Desert Property Management"
            width={400}
            height={130}
            className="hidden lg:block w-44 h-auto mb-10"
          />

          <h2 className="text-2xl font-semibold tracking-tight text-black">Sign in</h2>
          <p className="mt-1 mb-8 text-sm text-charcoal-500">
            Welcome to the HDPM Operating System.
          </p>

          {/* Error Message */}
          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
              {error === "AccessDenied" ? (
                <>
                  <strong>Access denied.</strong> Only @highdesertpm.com accounts can sign in. Use your
                  company Microsoft account.
                </>
              ) : (
                <>
                  <strong>Sign-in failed.</strong> There was a problem signing in. Please try again.
                </>
              )}
            </div>
          )}

          <Button
            onClick={() => signIn("azure-ad", { redirectTo: "/" })}
            className="group w-full h-11 rounded-lg bg-black text-sm font-medium text-white hover:bg-charcoal-800 transition-colors"
          >
            <svg className="w-4 h-4 mr-2.5" viewBox="0 0 21 21" fill="currentColor" aria-hidden>
              <path d="M0 0h10v10H0V0zm11 0h10v10H11V0zM0 11h10v10H0V11zm11 0h10v10H11V11z" />
            </svg>
            Continue with Microsoft
            <span className="ml-2 transition-transform group-hover:translate-x-0.5" aria-hidden>
              →
            </span>
          </Button>

          <p className="mt-4 text-xs text-charcoal-400">Use your @highdesertpm.com account.</p>

          <p className="mt-16 border-t border-sand-200 pt-4 font-mono text-[10.5px] uppercase tracking-[0.2em] text-charcoal-300">
            Internal use only
          </p>
        </div>
      </div>
    </div>
  );
}

function LoginSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSpinner />}>
      <LoginContent />
    </Suspense>
  );
}
