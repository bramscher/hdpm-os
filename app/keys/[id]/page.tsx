import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KeyDetailClient } from "./detail-client";

export const metadata = {
  title: "Key Detail — HDPM",
};

export default async function KeyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  const { id } = await params;

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <KeyDetailClient slotId={id} />
      </div>
    </main>
  );
}
