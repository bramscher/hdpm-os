import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CompsDashboard } from "./comps-dashboard";

export default async function CompsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <CompsDashboard
          userEmail={session.user.email!}
          userName={session.user.name || ""}
        />
      </div>
    </main>
  );
}
