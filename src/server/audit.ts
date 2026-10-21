import { auditEvent } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { Actor } from "./authz";

export type AuditActor =
  | { type: "user"; id: string; name?: string }
  | { type: "workflow"; id: string; name?: string }
  | { type: "system"; id: string }
  | { type: "public_form"; id: string }
  | { type: "local_provider"; id: string };

export const userActor = (a: Actor): AuditActor => ({ type: "user", id: a.userId, name: a.name });

export interface AuditInput {
  tenantId: string;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  contactId?: string | null;
  correlationId?: string | null;
  summary: string;
  data?: Record<string, unknown>;
  at?: Date;
}

/** Appends an audit/timeline event. Must be called inside the transaction that made the change. */
export async function audit(tx: Tx, e: AuditInput) {
  await tx.insert(auditEvent).values({
    tenantId: e.tenantId,
    actorType: e.actor.type,
    actorId: e.actor.id,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    contactId: e.contactId ?? null,
    correlationId: e.correlationId ?? null,
    summary: e.summary,
    data: { ...(e.data ?? {}), ...("name" in e.actor && e.actor.name ? { actorName: e.actor.name } : {}) },
    ...(e.at ? { occurredAt: e.at } : {}),
  });
}
