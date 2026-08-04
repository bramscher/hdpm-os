/**
 * Auth.js v5 configuration (Phase 0, Brief B — migrated from next-auth v4).
 *
 * - Provider: Microsoft Entra ID (the v5 name for the Azure AD provider),
 *   same app registration and env vars (AZURE_AD_*) as before.
 * - Sessions: JWT, 8h. The jwt callback stamps role/isAdmin from
 *   staff.access_role (lib/roles.ts, Brief A).
 * - Secret: AUTH_SECRET preferred (v5 convention), NEXTAUTH_SECRET honored
 *   so no env change is required at deploy time.
 * - Server code reads the session via `auth()` (replaces
 *   getServerSession(authOptions)); the route handler re-exports `handlers`.
 * - Route protection lives in proxy.ts (Next 16 convention), which decodes
 *   the session cookie via next-auth/jwt getToken — it deliberately does NOT
 *   import this file, keeping Supabase/Node deps out of the edge runtime.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getRoleForEmail } from "@/lib/roles";

export const AUTH_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const authConfig = {
  secret: AUTH_SECRET,
  trustHost: true,
  providers: [
    MicrosoftEntraID({
      // Keep the v4 provider id so the OAuth callback URL stays
      // /api/auth/callback/azure-ad — the redirect URI already registered in
      // the Azure app. Renaming to the v5 default would break sign-in until
      // Azure is updated; do that (if ever) as its own deliberate change.
      id: "azure-ad",
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read Calendars.ReadWrite",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow users from highdesertpm.com domain
      const email = user.email?.toLowerCase();
      if (!email?.endsWith("@highdesertpm.com")) {
        console.log(`Sign-in blocked for non-company email: ${email}`);
        return false;
      }
      return true;
    },
    async session({ session, token }) {
      // Add user info to session
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      // Expose Microsoft Graph access token for calendar integration
      if (token.accessToken) {
        session.accessToken = token.accessToken as string;
      }
      // Surface role + admin status (gates the financial dashboards)
      if (session.user) {
        session.user.isAdmin = token.isAdmin === true;
        session.user.role = token.role;
      }
      return session;
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      // Stamp the access role from staff.access_role on every token refresh
      // (60s-cached lookup; ADMIN_EMAILS survives only as bootstrap fallback).
      const role = await getRoleForEmail(token.email);
      token.role = role;
      token.isAdmin = role === "admin";
      return token;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours (work day)
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
