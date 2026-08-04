import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RentAnalysisWizard } from "./rent-analysis";

export default async function RentAnalysisPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <RentAnalysisWizard
          userEmail={session.user.email!}
          userName={session.user.name || ""}
        />
      </div>
    </main>
  );
}
