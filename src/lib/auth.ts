import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";

/**
 * Login uses Google OAuth. We deliberately request Calendar scopes up front
 * so the same consent grant can back the default "primary" CalendarConnection
 * — avoiding a second OAuth round-trip for the common case of one Google
 * account per user. Additional calendar connections (a second Google
 * account, or future Microsoft/Apple) are added from /dashboard/calendar
 * via a separate, narrower OAuth flow.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
          ].join(" "),
          access_type: "offline",
          prompt: "consent", // ensures a refresh_token is issued every time
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        (session.user as typeof session.user & { id: string }).id = user.id;
      }
      return session;
    },
  },
  events: {
    /**
     * On first sign-in (and re-consent), persist the Google tokens into a
     * CalendarConnection so the household's default calendar sync "just
     * works" without a separate setup step. Tokens are encrypted before
     * they touch the database and are never exposed via any API response.
     */
    async linkAccount({ user, account }) {
      if (account.provider !== "google") return;
      if (!account.access_token) return;

      const membership = await prisma.householdMember.findFirst({ where: { userId: user.id } });
      if (!membership) return; // household is created during onboarding, before this fires on subsequent logins

      const existing = await prisma.calendarConnection.findFirst({
        where: { userId: user.id, provider: "GOOGLE", householdId: membership.householdId },
        select: { id: true },
      });

      const data = {
        accessTokenEnc: encryptToken(account.access_token),
        ...(account.refresh_token ? { refreshTokenEnc: encryptToken(account.refresh_token) } : {}),
        tokenExpiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
        scopes: account.scope ?? null,
        status: "CONNECTED" as const,
        lastError: null,
      };

      if (existing) {
        await prisma.calendarConnection.update({ where: { id: existing.id }, data });
      } else {
        await prisma.calendarConnection.create({
          data: {
            householdId: membership.householdId,
            userId: user.id,
            provider: "GOOGLE",
            providerAccountEmail: user.email ?? undefined,
            externalCalendarId: "primary",
            ...data,
          },
        });
      }
    },
  },
};
