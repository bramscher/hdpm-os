import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KeysDashboard } from "@/components/keys/KeysDashboard";

export const metadata = {
  title: "Key Manager — HDPM",
};

export default async function KeysPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <KeysDashboard />
      </div>
    </main>
  );
}
