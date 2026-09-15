import { redirect } from "next/navigation";

// Retired preview links now lead staff to the live Timekeeping module.
export default function Page() {
  redirect("/timekeeping");
}
