import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { HavenDashboard } from "@/components/haven/HavenDashboard";

export const metadata = {
  title: "Haven Leasing — HDPM",
};

export default async function HavenPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-slate-800">Haven — Leasing &amp; Reception</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            The AI leasing pipeline, flags that need a human, and receptionist performance.
          </p>
        </div>
        <HavenDashboard />
      </div>
    </main>
  );
}
