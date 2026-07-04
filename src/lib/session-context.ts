import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}

/**
 * Resolves the logged-in user's membership for a given household and throws
 * a typed error if they're not signed in or don't belong to it. Every API
 * route that touches household-scoped data must call this first — it is
 * the household-level access control boundary described in the security
 * requirements.
 */
export async function requireHouseholdAccess(householdId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new UnauthorizedError("Not signed in");

  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (!membership) throw new ForbiddenError("Not a member of this household");

  return { userId, membership };
}

/** Returns the current user's first household membership, or null. Used for onboarding redirects. */
export async function getCurrentMembership() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  return prisma.householdMember.findFirst({
    where: { userId },
    include: { household: true },
    orderBy: { createdAt: "asc" },
  });
}

export function apiErrorResponse(err: unknown) {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  return Response.json({ error: message }, { status });
}
