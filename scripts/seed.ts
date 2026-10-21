import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "./env";

loadEnv();

const { getAuth } = await import("../src/server/auth");
const schema = await import("../src/db/schema");
const { sha256 } = await import("../src/server/util");
const { SCHEMA_VERSION } = await import("../src/server/workflow/definition");
const { contentHash } = await import("../src/server/workflow/hash");
const { normalizeEmail, normalizeName, normalizePhone, displayName } = await import("../src/server/normalize");
const { closeAppDb } = await import("../src/db/client");

/**
 * Deterministic synthetic seed: two isolated demo businesses. All people, emails (.test) and
 * phone numbers (555-01xx) are fictional. Refuses to run in production.
 */
export const DEMO = {
  password: process.env.SEED_PASSWORD ?? "Demo-Password-2026!",
  tenants: {
    a: { id: "a0000000-0000-4000-8000-000000000001", name: "Brightline Wellness (Demo)", slug: "brightline-demo", formToken: "demo-brightline-lead-form-local-token" },
    b: { id: "b0000000-0000-4000-8000-000000000002", name: "Harbor Home Services (Demo)", slug: "harbor-demo", formToken: "demo-harbor-lead-form-local-token" },
  },
  users: [
    { email: "founder@agentic.test", name: "Demo Founder", memberships: [["a", "owner"], ["b", "owner"]] },
    { email: "owner@brightline.test", name: "Avery Owner", memberships: [["a", "owner"]] },
    { email: "manager@brightline.test", name: "Morgan Manager", memberships: [["a", "manager"]] },
    { email: "frontdesk@brightline.test", name: "Jordan Frontdesk", memberships: [["a", "staff"]] },
    { email: "restricted@brightline.test", name: "Riley Restricted", memberships: [["a", "restricted_staff"]] },
    { email: "readonly@brightline.test", name: "Quinn Readonly", memberships: [["a", "read_only"]] },
    { email: "owner@harbor.test", name: "Casey Harbor", memberships: [["b", "owner"]] },
    { email: "staff@harbor.test", name: "Taylor Harbor", memberships: [["b", "staff"]] },
  ] as { email: string; name: string; memberships: [keyof typeof DEMO_TENANTS, string][] }[],
} as const;
const DEMO_TENANTS = { a: 1, b: 2 } as const;

const SAMPLE_CONTACTS: Record<"a" | "b", [string, string, string][]> = {
  a: [
    ["Ada", "Lovelace", "0101"], ["Grace", "Hopper", "0102"], ["Alan", "Turing", "0103"], ["Katherine", "Johnson", "0104"],
    ["Dorothy", "Vaughan", "0105"], ["Mary", "Jackson", "0106"], ["Claude", "Shannon", "0107"], ["Hedy", "Lamarr", "0108"],
    ["Edsger", "Dijkstra", "0109"], ["Barbara", "Liskov", "0110"], ["Donald", "Knuth", "0111"], ["Frances", "Allen", "0112"],
  ],
  b: [
    ["Nikola", "Tesla", "0151"], ["Marie", "Curie", "0152"], ["Rosalind", "Franklin", "0153"], ["Carl", "Sagan", "0154"],
    ["Lise", "Meitner", "0155"], ["Emmy", "Noether", "0156"], ["Richard", "Feynman", "0157"], ["Chien-Shiung", "Wu", "0158"],
  ],
};

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("refusing to seed synthetic data in production");
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is not set");
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  const db = drizzle(pool, { schema });
  const auth = getAuth();
  const ctx = await auth.$context;

  // Users (platform identity) via Better Auth's own adapter + password hasher.
  const userIds = new Map<string, string>();
  for (const u of DEMO.users) {
    const existing = await ctx.internalAdapter.findUserByEmail(u.email);
    if (existing) {
      userIds.set(u.email, existing.user.id);
      continue;
    }
    const created = await ctx.internalAdapter.createUser({ email: u.email, name: u.name, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: await ctx.password.hash(DEMO.password) });
    userIds.set(u.email, created.id);
  }
  const uid = (email: string) => userIds.get(email)!;

  for (const key of ["a", "b"] as const) {
    const t = DEMO.tenants[key];
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${t.id}, true)`);
      const [exists] = await tx.select({ id: schema.tenant.id }).from(schema.tenant).where(eq(schema.tenant.id, t.id));
      if (exists) return;
      await tx.insert(schema.tenant).values({ id: t.id, name: t.name, slug: t.slug, timezone: "America/New_York", isSynthetic: true });
      await tx.insert(schema.location).values({ tenantId: t.id, name: "Main location", timezone: "America/New_York" });
      for (const u of DEMO.users) for (const [tk, role] of u.memberships) if (tk === key) await tx.insert(schema.membership).values({ tenantId: t.id, userId: uid(u.email), role: role as never });

      const [p] = await tx.insert(schema.pipeline).values({ tenantId: t.id, name: key === "a" ? "New client inquiries" : "Service requests", isDefault: true }).returning();
      const stageDefs: [string, "open" | "won" | "lost"][] = [["New inquiry", "open"], ["Contacted", "open"], ["Consult booked", "open"], ["Won", "won"], ["Lost", "lost"]];
      const stages = [];
      for (const [i, [name, kind]] of stageDefs.entries()) {
        const [s] = await tx.insert(schema.stage).values({ tenantId: t.id, pipelineId: p!.id, name, position: i, kind }).returning();
        stages.push(s!);
      }
      await tx.insert(schema.form).values({
        tenantId: t.id,
        name: "Website lead form",
        tokenHash: sha256(t.formToken),
        tokenHint: t.formToken.slice(0, 6),
        smsConsentText: `I agree that ${t.name} may text me about this inquiry (transactional only). Msg & data rates may apply. Reply STOP to opt out.`,
        marketingConsentText: `Send me occasional news and offers from ${t.name}. I can unsubscribe at any time.`,
      });

      const staffEmail = key === "a" ? "frontdesk@brightline.test" : "staff@harbor.test";
      const managerEmail = key === "a" ? "manager@brightline.test" : "owner@harbor.test";
      const base = Date.UTC(2026, 9, 1, 14, 0, 0); // deterministic timestamps
      for (const [i, [first, last, suffix]] of SAMPLE_CONTACTS[key].entries()) {
        const phone = `(404) 555-${suffix}`;
        const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.test`;
        const at = new Date(base + i * 3_600_000);
        const [c] = await tx
          .insert(schema.contact)
          .values({
            tenantId: t.id, firstName: first, lastName: last, displayName: displayName(first, last), nameNormalized: normalizeName(first, last),
            email, emailNormalized: normalizeEmail(email), phone, phoneE164: normalizePhone(phone), ownerUserId: uid(staffEmail), source: "seed", createdAt: at, updatedAt: at,
          })
          .returning();
        const stg = stages[i % 4]!;
        const [o] = await tx.insert(schema.opportunity).values({ tenantId: t.id, contactId: c!.id, pipelineId: p!.id, stageId: stg.id, name: `${first} ${last} — initial consult`, valueCents: 15000 + i * 2500, createdAt: at, updatedAt: at }).returning();
        await tx.insert(schema.auditEvent).values({ tenantId: t.id, actorType: "system", actorId: "seed", action: "contact.created", entityType: "contact", entityId: c!.id, contactId: c!.id, summary: "Synthetic contact created by seed", data: {}, occurredAt: at });
        if (i < 4) {
          await tx.insert(schema.task).values({ tenantId: t.id, contactId: c!.id, opportunityId: o!.id, title: `Follow up with ${first}`, assigneeUserId: uid(i % 2 ? managerEmail : staffEmail), dueAt: new Date(base + (i - 2) * 86_400_000), createdAt: at });
        }
      }

      // The demo automation, published as v1 (immutable). Its draft starts equal to v1.
      const def = {
        schemaVersion: SCHEMA_VERSION as 1,
        trigger: { type: "form.submitted" as const, formId: null },
        steps: [
          { id: "create_opportunity", type: "create_opportunity" as const, name: "Open opportunity", pipelineId: p!.id, stageId: stages[0]!.id, title: "{{contact.displayName}} — web inquiry", valueCents: null },
          { id: "call_task", type: "create_task" as const, name: "Assign first call", title: "Call {{contact.firstName}} about their web inquiry", description: "They wrote: {{submission.message}}", assigneeUserId: uid(staffEmail), dueInMinutes: 15 },
          { id: "acknowledge", type: "send_message" as const, name: "Text acknowledgment", channel: "sms" as const, purpose: "transactional" as const, body: "Hi {{contact.firstName}}, thanks for contacting {{business.name}}. A team member will call you shortly." },
          { id: "wait_for_call", type: "wait" as const, name: "Give staff time to call", seconds: 120 },
          { id: "check_call", type: "branch" as const, name: "Was the call task completed?", condition: { kind: "task_completed" as const, taskStepId: "call_task" }, onTrue: "done", onFalse: "escalate" },
          { id: "escalate", type: "create_task" as const, name: "Escalate to manager", title: "Escalation: {{contact.firstName}} has not been called yet", assigneeUserId: uid(managerEmail), dueInMinutes: 30, next: "done" },
          { id: "done", type: "finish" as const, name: "Finish" },
        ],
      };
      const [wf] = await tx.insert(schema.workflow).values({ tenantId: t.id, name: "New lead follow-up", triggerType: "form.submitted", draftDefinition: def, draftUpdatedByUserId: uid(managerEmail) }).returning();
      const [v] = await tx.insert(schema.workflowVersion).values({ tenantId: t.id, workflowId: wf!.id, version: 1, schemaVersion: SCHEMA_VERSION, definition: def, contentHash: contentHash(def), changeSummary: "Initial version (seed)", publishedByUserId: uid(managerEmail) }).returning();
      await tx.update(schema.workflow).set({ activeVersionId: v!.id }).where(eq(schema.workflow.id, wf!.id));
      await tx.insert(schema.auditEvent).values({ tenantId: t.id, actorType: "system", actorId: "seed", action: "workflow.published", entityType: "workflow", entityId: wf!.id, summary: `Published "New lead follow-up" v1: Initial version (seed)`, data: { version: 1, contentHash: contentHash(def) } });
    });
  }
  await pool.end();
  await closeAppDb();
  console.log("seeded synthetic demo data");
  for (const k of ["a", "b"] as const) console.log(`  ${DEMO.tenants[k].name}: ${process.env.APP_BASE_URL ?? "http://localhost:3000"}/f/${DEMO.tenants[k].formToken}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
export { main as seed };
