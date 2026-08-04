import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ImportKeysClient } from "@/components/keys/ImportKeysClient";

export const metadata = {
  title: "Import Key List — HDPM",
};

export default async function KeysImportPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <ImportKeysClient />
      </div>
    </main>
  );
}
