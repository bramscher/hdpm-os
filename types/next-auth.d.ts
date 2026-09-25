import "next-auth";
import "next-auth/jwt";
import type { AccessRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      id?: string;
      isAdmin?: boolean;
      role?: AccessRole;
      capabilities?: import("@/lib/staff-capabilities").Capabilities;
      /** Section keys switched off for this person (Admin → User settings). */
      deniedSections?: string[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    isAdmin?: boolean;
    role?: AccessRole;
    deniedSections?: string[];
  }
}
