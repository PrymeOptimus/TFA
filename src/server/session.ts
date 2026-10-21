import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import type { Actor } from "./authz";
import { listMemberships, resolveActor } from "./services/crm";

export const TENANT_COOKIE = "crm_tenant";

export async function getSessionUser() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * Resolves the acting user and tenant. The tenant cookie is only a preference: the actor's tenant
 * is always one of the user's verified memberships.
 */
export async function getActor(): Promise<Actor | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const pref = (await cookies()).get(TENANT_COOKIE)?.value ?? null;
  return resolveActor({ id: user.id, name: user.name, email: user.email }, pref);
}

export async function requireActor(): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const pref = (await cookies()).get(TENANT_COOKIE)?.value ?? null;
  const actor = await resolveActor({ id: user.id, name: user.name, email: user.email }, pref);
  if (!actor) redirect("/no-access");
  return actor;
}

export async function getMemberships(userId: string) {
  return listMemberships(userId);
}
