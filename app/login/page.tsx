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
    return (
      <div className="min-h-screen flex items-center justify-center bg-sand-50">
        <div className="text-center">
          <div className="w-8 h-8 border-[3px] border-terra-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-charcoal-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel — Brand */}
      <div className="hidden lg:flex lg:w-[45%] login-panel relative overflow-hidden items-end p-12">
        <div className="relative z-10 animate-slide-up">
          <Image
            src="/HDPM-PrimaryLogo-White.png"
            alt="High Desert Property Management"
            width={280}
            height={90}
            className="mb-6 opacity-95"
          />
          <p className="text-charcoal-400 text-base max-w-xs leading-relaxed">
            Internal automation tools for invoice generation, rent analysis, and knowledge management.
          </p>

          {/* Decorative elements */}
          <div className="mt-12 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-terra-500/40 to-transparent" />
          </div>
          <div className="mt-4 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-charcoal-500">AppFolio Connected</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-charcoal-500">AI Ready</span>
            </div>
          </div>
        </div>

        {/* Background decorative circle */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full border border-white/[0.04]" />
        <div className="absolute -top-12 -right-12 w-72 h-72 rounded-full border border-white/[0.03]" />
      </div>

      {/* Right Panel — Sign In */}
      <div className="flex-1 flex items-center justify-center bg-sand-50 px-8">
        <div className="w-full max-w-sm animate-slide-up" style={{ animationDelay: "100ms" }}>
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <Image
              src="/HDPM-PrimaryLogo-Black.png"
              alt="High Desert Property Management"
              width={400}
              height={130}
              className="w-full h-auto mb-2"
            />
          </div>

          <div className="lg:block hidden">
            <Image
              src="/HDPM-PrimaryLogo-Black.png"
              alt="High Desert Property Management"
              width={400}
              height={130}
              className="w-full h-auto mb-6"
            />
            <p className="text-sm font-medium text-charcoal-400 mb-1">Welcome back</p>
            <h2 className="text-2xl font-bold text-charcoal-900 tracking-tight mb-8">
              Sign in to continue
            </h2>
          </div>

          <div className="lg:hidden">
            <p className="text-sm text-charcoal-500 mb-6">
              Sign in with your company account to continue.
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error === "AccessDenied" ? (
                <>
                  <strong>Access Denied:</strong> Only @highdesertpm.com email
                  addresses are allowed. Please sign in with your company Microsoft
                  account.
                </>
              ) : (
                <>
                  <strong>Error:</strong> There was a problem signing in. Please
                  try again.
                </>
              )}
            </div>
          )}

          {/* Sign In Button */}
          <Button
            onClick={() => signIn("azure-ad", { redirectTo: "/" })}
            className="w-full bg-charcoal-900 hover:bg-charcoal-800 h-12 text-sm font-medium shadow-sm hover:shadow-md transition-all duration-200 rounded-xl text-white"
          >
            <svg
              className="w-5 h-5 mr-2.5"
              viewBox="0 0 21 21"
              fill="currentColor"
            >
              <path d="M0 0h10v10H0V0zm11 0h10v10H11V0zM0 11h10v10H0V11zm11 0h10v10H11V11z" />
            </svg>
            Sign in with Microsoft
          </Button>

          <p className="text-center text-xs text-charcoal-400 mt-6">
            Use your @highdesertpm.com account
          </p>

          <div className="mt-12 pt-6 border-t border-sand-200">
            <p className="text-2xs text-charcoal-300 text-center uppercase tracking-widest">
              Internal Use Only
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-sand-50">
          <div className="text-center">
            <div className="w-8 h-8 border-[3px] border-terra-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-charcoal-500 text-sm">Loading...</p>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
