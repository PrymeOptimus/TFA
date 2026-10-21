import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { localSimAttempt, localSimDelivery } from "@/db/schema";
import type { MessagingProvider, SendRequest, SendResult } from "./provider";

/**
 * LOCAL SIMULATION adapter. Records "accepted" messages in local_sim_delivery and never contacts a
 * real carrier or mailbox. Rejected at startup when APP_ENV=production (see config.ts).
 *
 * Deterministic failure rules for testing and demos (synthetic numbers only):
 *   recipient ending in 0199 (or local part "fail-permanent") -> permanent failure
 *   recipient ending in 0198 (or local part "fail-retry")     -> retryable failure on the first 2 attempts
 */
export class LocalSimulatedProvider implements MessagingProvider {
  readonly name = "local-simulator";
  readonly simulated = true;
  readonly supportsIdempotentRetry = true;

  async send(req: SendRequest): Promise<SendResult> {
    return withTenant(req.tenantId, null, async (tx) => {
      const [existing] = await tx
        .select()
        .from(localSimDelivery)
        .where(and(eq(localSimDelivery.tenantId, req.tenantId), eq(localSimDelivery.idempotencyKey, req.idempotencyKey)));
      if (existing) {
        await tx.insert(localSimAttempt).values({ tenantId: req.tenantId, idempotencyKey: req.idempotencyKey, outcome: "replayed_idempotent" });
        return { ok: true, providerMessageId: existing.providerMessageId, status: "provider_accepted", replayed: true };
      }
      const rule = failureRule(req.to);
      if (rule === "permanent") {
        await tx.insert(localSimAttempt).values({ tenantId: req.tenantId, idempotencyKey: req.idempotencyKey, outcome: "failed_permanent" });
        return { ok: false, retryable: false, error: "Local simulator: recipient rejected (permanent failure rule)" };
      }
      if (rule === "retry") {
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(localSimAttempt)
          .where(and(eq(localSimAttempt.tenantId, req.tenantId), eq(localSimAttempt.idempotencyKey, req.idempotencyKey), eq(localSimAttempt.outcome, "failed_retryable")));
        if (n < 2) {
          await tx.insert(localSimAttempt).values({ tenantId: req.tenantId, idempotencyKey: req.idempotencyKey, outcome: "failed_retryable" });
          return { ok: false, retryable: true, error: "Local simulator: temporary failure (retry rule)" };
        }
      }
      const providerMessageId = `sim_${randomUUID()}`;
      await tx.insert(localSimDelivery).values({
        tenantId: req.tenantId,
        idempotencyKey: req.idempotencyKey,
        channel: req.channel,
        toAddress: req.to,
        body: req.body,
        providerMessageId,
      });
      await tx.insert(localSimAttempt).values({ tenantId: req.tenantId, idempotencyKey: req.idempotencyKey, outcome: "accepted" });
      return { ok: true, providerMessageId, status: "provider_accepted", replayed: false };
    });
  }
}

function failureRule(to: string): "permanent" | "retry" | null {
  const t = to.toLowerCase();
  if (t.endsWith("0199") || t.startsWith("fail-permanent@")) return "permanent";
  if (t.endsWith("0198") || t.startsWith("fail-retry@")) return "retry";
  return null;
}

let provider: MessagingProvider | undefined;
export function messagingProvider(): MessagingProvider {
  provider ??= new LocalSimulatedProvider();
  return provider;
}
