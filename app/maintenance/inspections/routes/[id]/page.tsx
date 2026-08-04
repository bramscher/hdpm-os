import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RouteDetail } from "./route-detail";

interface RouteDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RouteDetailPage({ params }: RouteDetailPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  const { id } = await params;

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <RouteDetail routeId={id} />
      </div>
    </main>
  );
}
