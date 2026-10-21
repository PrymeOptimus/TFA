import { randomBytes } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { form, membership, tenant } from "@/db/schema";
import { audit, userActor } from "../audit";
import { authorize, ROLES, ROLE_LABELS, type Actor, type Role } from "../authz";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { sha256 } from "../util";

export async function changeMemberRole(actor: Actor, userId: string, role: string) {
  authorize(actor, "members.manage");
  if (!(ROLES as readonly string[]).includes(role)) throw new ValidationError("Unknown role");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [m] = await tx.select().from(membership).where(and(eq(membership.tenantId, actor.tenantId), eq(membership.userId, userId))).for("update");
    if (!m) throw new NotFoundError("Member not found");
    if (m.role === role) return;
    if (m.role === "owner" && role !== "owner") {
      const [{ owners } = { owners: 0 }] = await tx.select({ owners: count() }).from(membership).where(and(eq(membership.tenantId, actor.tenantId), eq(membership.role, "owner")));
      if (owners <= 1) throw new ConflictError("A business must keep at least one owner");
    }
    await tx.update(membership).set({ role: role as Role }).where(eq(membership.id, m.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "membership.role_changed",
      entityType: "membership",
      entityId: m.id,
      summary: `Role changed from ${ROLE_LABELS[m.role]} to ${ROLE_LABELS[role as Role]}`,
      data: { userId, from: m.role, to: role },
    });
  });
}

export async function listForms(actor: Actor) {
  authorize(actor, "contacts.read");
  return withTenant(actor.tenantId, actor.userId, (tx) =>
    tx.select({ id: form.id, name: form.name, tokenHint: form.tokenHint, active: form.active, createdAt: form.createdAt }).from(form).orderBy(asc(form.name)),
  );
}

export function newFormToken() {
  return randomBytes(24).toString("base64url");
}

/** Rotates a form's public token. The new token is shown once; only its hash is stored. */
export async function rotateFormToken(actor: Actor, formId: string) {
  authorize(actor, "forms.manage");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [f] = await tx.select().from(form).where(eq(form.id, formId)).for("update");
    if (!f) throw new NotFoundError("Form not found");
    const token = newFormToken();
    await tx.update(form).set({ tokenHash: sha256(token), tokenHint: token.slice(0, 6) }).where(eq(form.id, f.id));
    await audit(tx, { tenantId: actor.tenantId, actor: userActor(actor), action: "form.token_rotated", entityType: "form", entityId: f.id, summary: `Public link for "${f.name}" rotated; the previous link stopped working` });
    return { token };
  });
}

export async function setSendingPaused(actor: Actor, paused: boolean, reason: string) {
  authorize(actor, "sending.control");
  const why = (reason ?? "").trim().slice(0, 200);
  if (paused && why.length < 3) throw new ValidationError("Give a reason for pausing outbound sending");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    await tx.update(tenant).set({ sendingPaused: paused, sendingPausedReason: paused ? why : null }).where(eq(tenant.id, actor.tenantId));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: paused ? "tenant.sending_paused" : "tenant.sending_resumed",
      entityType: "tenant",
      entityId: actor.tenantId,
      summary: paused ? `Outbound sending paused for this business: ${why}` : "Outbound sending resumed for this business",
    });
  });
}
