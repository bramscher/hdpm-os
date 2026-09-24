import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ActivitiesView } from "@/components/activities/ActivitiesView";

export const metadata = {
  title: "Activities — HDPM",
};

export default async function ActivitiesPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith("@highdesertpm.com")) {
    redirect("/login");
  }

  return <ActivitiesView />;
}
