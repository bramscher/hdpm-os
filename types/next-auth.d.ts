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
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    isAdmin?: boolean;
    role?: AccessRole;
  }
}
