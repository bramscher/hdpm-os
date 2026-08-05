import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InvoiceDashboard } from "./invoice-dashboard";

export default async function InvoicesPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <InvoiceDashboard
          userEmail={session.user.email!}
          userName={session.user.name || ""}
        />
      </div>
    </main>
  );
}
