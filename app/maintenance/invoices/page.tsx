import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InvoiceDashboard } from "./invoice-dashboard";

export const metadata = { title: "HDPM-OS — Work & Billing" };

export default async function InvoicesPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="w-full min-w-0 px-4 py-6 lg:px-8">
        <InvoiceDashboard
          userEmail={session.user.email!}
          userName={session.user.name || ""}
        />
      </div>
    </main>
  );
}
