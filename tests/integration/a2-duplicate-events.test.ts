/**
 * A2 — Reprocessing the same identified source event 10 times yields one contact resolution, one
 * opportunity, one task and one logical send, while every attempted ingest is preserved.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeAppDb } from "@/db/client";
import { leadFields, publishVariant, q, runRecords, setWait, submit, testEngine, TENANT_A, TOKEN_A, actors } from "../helpers";

afterAll(closeAppDb);

async function counts(sourceKeyLike: string, contactId: string) {
  const [r] = await q<Record<string, number>>(
    TENANT_A,
    sql`select
      (select count(*)::int from inbox_event where source_key like ${sourceKeyLike}) inbox,
      (select coalesce(max(receive_count),0)::int from inbox_event where source_key like ${sourceKeyLike}) receive_count,
      (select count(*)::int from ingest_attempt where source_key like ${sourceKeyLike}) attempts,
      (select count(*)::int from ingest_attempt where source_key like ${sourceKeyLike} and outcome = 'accepted') accepted,
      (select count(*)::int from ingest_attempt where source_key like ${sourceKeyLike} and outcome = 'duplicate') duplicates,
      (select count(*)::int from form_submission where contact_id = ${contactId}) submissions,
      (select count(*)::int from contact where id = ${contactId}) contacts,
      (select count(*)::int from workflow_run where contact_id = ${contactId}) runs,
      (select count(*)::int from opportunity where contact_id = ${contactId}) opportunities,
      (select count(*)::int from task where contact_id = ${contactId}) tasks,
      (select count(*)::int from message where contact_id = ${contactId} and direction = 'outbound') sends,
      (select count(*)::int from outbox_event o join message m on m.id = o.aggregate_id where m.contact_id = ${contactId}) outbox,
      (select count(*)::int from consent_event where contact_id = ${contactId}) consents`,
  );
  return r!;
}

describe("A2 duplicate source events", () => {
  it("10 sequential repeats of one submission create one set of business effects", async () => {
    const { managerA } = await actors();
    await publishVariant(managerA, setWait(60), "A2 baseline");
    const id = randomUUID();
    const fields = leadFields({ firstName: "Dupe", lastName: `Sequential ${id.slice(0, 6)}` });
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await submit(TOKEN_A, fields, id));
    expect(results[0]!.status).toBe("accepted");
    expect(results.slice(1).every((r) => r.status === "duplicate")).toBe(true);
    const contactId = (results[0] as { contactId: string }).contactId;

    const eng = testEngine();
    await eng.drain();
    // Re-deliver again after processing: still no new effects.
    for (let i = 0; i < 3; i++) await submit(TOKEN_A, fields, id);
    await eng.drain();

    const c = await counts(`%:${id}`, contactId);
    expect(c).toMatchObject({ inbox: 1, receive_count: 13, attempts: 13, accepted: 1, duplicates: 12, submissions: 1, contacts: 1, runs: 1, opportunities: 1, tasks: 1, sends: 1, outbox: 1, consents: 1 });
    const [run] = await q<{ id: string }>(TENANT_A, sql`select id from workflow_run where contact_id = ${contactId}`);
    const rec = await runRecords(TENANT_A, run!.id);
    expect(rec.deliveries).toHaveLength(1);
    expect(rec.messages[0]!.status).toBe("provider_accepted");
    // Every duplicate receipt is visible on the contact timeline as evidence.
    const dupEvents = await q(TENANT_A, sql`select id from audit_event where contact_id = ${contactId} and action = 'form.duplicate_received'`);
    expect(dupEvents).toHaveLength(12);
  });

  it("10 concurrent deliveries of one submission race safely to a single effect set", async () => {
    const id = randomUUID();
    const fields = leadFields({ firstName: "Dupe", lastName: `Concurrent ${id.slice(0, 6)}` });
    const results = await Promise.all(Array.from({ length: 10 }, () => submit(TOKEN_A, fields, id)));
    expect(results.filter((r) => r.status === "accepted")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(9);
    const contactId = (results.find((r) => r.status === "accepted") as { contactId: string }).contactId;
    // Two engines draining concurrently must not duplicate effects either.
    await Promise.all([testEngine().drain(), testEngine().drain()]);
    const c = await counts(`%:${id}`, contactId);
    expect(c).toMatchObject({ inbox: 1, attempts: 10, accepted: 1, contacts: 1, runs: 1, opportunities: 1, tasks: 1, sends: 1, outbox: 1 });
  });

  it("a repeated submission id with different content is ignored and flagged", async () => {
    const id = randomUUID();
    const first = await submit(TOKEN_A, leadFields({ firstName: "Mismatch" }), id);
    const second = await submit(TOKEN_A, leadFields({ firstName: "Different" }), id);
    expect(first.status).toBe("accepted");
    expect(second).toMatchObject({ status: "duplicate", payloadMatches: false });
    const [a] = await q<{ outcome: string }>(TENANT_A, sql`select outcome from ingest_attempt where source_key like ${`%:${id}`} order by received_at desc limit 1`);
    expect(a!.outcome).toBe("duplicate_payload_mismatch");
  });

  it("validation rejections, honeypot hits and rate limiting are recorded without business effects", async () => {
    const bad = randomUUID();
    await expect(submit(TOKEN_A, { firstName: "", email: "not-an-email" }, bad)).rejects.toMatchObject({ status: 422 });
    const spam = randomUUID();
    const r = await submit(TOKEN_A, leadFields({ website: "http://spam.example" }), spam);
    expect(r.status).toBe("ignored");
    const outcomes = await q<{ outcome: string }>(TENANT_A, sql`select outcome from ingest_attempt where source_key like ${`%:${bad}`} or source_key like ${`%:${spam}`}`);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(["rejected_validation", "spam_honeypot"]);
    const inbox = await q(TENANT_A, sql`select id from inbox_event where source_key like ${`%:${bad}`} or source_key like ${`%:${spam}`}`);
    expect(inbox).toHaveLength(0);

    const { ingestFormSubmission, RATE_LIMIT_PER_MINUTE } = await import("@/server/services/ingest");
    const ipHash = `rate-${randomUUID()}`;
    const send = () => ingestFormSubmission({ token: TOKEN_A, submissionId: randomUUID(), fields: leadFields(), attribution: {}, ipHash, userAgent: null, correlationId: randomUUID() });
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) await send();
    await expect(send()).rejects.toMatchObject({ status: 429 });
    const limited = await q(TENANT_A, sql`select id from ingest_attempt where ip_hash = ${ipHash} and outcome = 'rate_limited'`);
    expect(limited).toHaveLength(1);
  });

  it("an unknown or malformed form token is rejected without touching any tenant", async () => {
    await expect(submit("this-token-does-not-exist-anywhere", leadFields())).rejects.toMatchObject({ status: 404 });
    await expect(submit("../../etc", leadFields())).rejects.toMatchObject({ status: 404 });
  });
});
