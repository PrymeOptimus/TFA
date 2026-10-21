import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { appDb } from "@/db/client";
import { authAccount, authSession, authTwoFactor, authUser, authVerification } from "@/db/schema";

/**
 * Authentication: Better Auth (scrypt password hashing, database-backed sessions, TOTP MFA with
 * backup codes). We do not implement password hashing or session cryptography ourselves.
 * Public sign-up is disabled: accounts are provisioned (seed now; invitations in Milestone 3).
 */
function createAuth() {
  return betterAuth({
    appName: "Agentic Operations CRM",
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(appDb().db, {
      provider: "pg",
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification, twoFactor: authTwoFactor },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    advanced: { useSecureCookies: process.env.APP_ENV === "production" },
    // Explicit limits (in-memory, per process; a shared store is required for multi-instance
    // deployments). Sign-in is limited per client IP. AUTH_SIGNIN_LIMIT exists for automated tests.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: Number(process.env.AUTH_SIGNIN_LIMIT ?? 10) },
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 10 },
      },
    },
    telemetry: { enabled: false },
    plugins: [twoFactor({ issuer: "Agentic Operations CRM" }), nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __crmAuth?: Auth };
export function getAuth(): Auth {
  g.__crmAuth ??= createAuth();
  return g.__crmAuth;
}
