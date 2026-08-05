import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PropertyMap } from "@/components/properties/PropertyMap";

export const metadata = {
  title: "Property Map — HDPM",
};

export default async function PropertyMapPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-800">Property Map</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Every managed property — green is actively managed, yellow is
            leaving management. Click a house for details and its AppFolio page.
          </p>
        </div>
        <PropertyMap />
      </div>
    </main>
  );
}
