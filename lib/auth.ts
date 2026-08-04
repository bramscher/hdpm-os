import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { getRoleForEmail } from "@/lib/roles";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
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
};
