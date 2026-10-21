import { and, count, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, withoutContext, type Tx } from "@/db/client";
import {
  consentEvent,
  contact,
  conversation,
  duplicateSuggestion,
  formSubmission,
  inboxEvent,
  ingestAttempt,
  message,
  tenant,
  workflow,
  workflowRun,
  workflowVersion,
} from "@/db/schema";
import { audit } from "../audit";
import { NotFoundError, RateLimitedError, ValidationError } from "../errors";
import { displayName, normalizeEmail, normalizeName, normalizePhone } from "../normalize";
import { canonicalJson, isUuid, sha256 } from "../util";
import { parseDefinition } from "../workflow/definition";

export const RATE_LIMIT_PER_MINUTE = 10;

export const leadFieldsSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().max(100).default(""),
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address").max(254)]).default(""),
    phone: z.string().trim().max(40).default(""),
    message: z.string().trim().max(2000).default(""),
    smsConsent: z.boolean().default(false),
    marketingConsent: z.boolean().default(false),
    /** Honeypot. Real visitors never see or fill this field. */
    website: z.string().max(200).default(""),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: "Provide an email or a phone number" });
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid phone number" });
  });
export type LeadFields = z.infer<typeof leadFieldsSchema>;

export const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "page_url"] as const;

export interface PublicFormInfo {
  formId: string;
  tenantId: string;
  formName: string;
  tenantName: string;
  active: boolean;
  smsConsentText: string;
  marketingConsentText: string;
}

/** Resolves a public form token without exposing any other tenant data. */
export async function resolvePublicForm(token: string): Promise<PublicFormInfo | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const rows = await withoutContext((tx) =>
    tx.execute<{
      form_id: string;
      tenant_id: string;
      form_name: string;
      tenant_name: string;
      active: boolean;
      sms_consent_text: string;
      marketing_consent_text: string;
    }>(sql`select * from resolve_public_form(${sha256(token)})`),
  );
  const r = rows.rows[0];
  if (!r) return null;
  return {
    formId: r.form_id,
    tenantId: r.tenant_id,
    formName: r.form_name,
    tenantName: r.tenant_name,
    active: r.active,
    smsConsentText: r.sms_consent_text,
    marketingConsentText: r.marketing_consent_text,
  };
}

export interface SubmissionInput {
  token: string;
  /** Client-generated id for this submission; repeats of the same id are the same source event. */
  submissionId: string;
  fields: unknown;
  attribution: Record<string, string>;
  ipHash: string | null;
  userAgent: string | null;
  correlationId: string;
  now?: Date;
}

export type SubmissionResult =
  | { status: "accepted"; contactId: string; submissionId: string; runIds: string[]; inboxEventId: string }
  | { status: "duplicate"; contactId: string | null; inboxEventId: string; payloadMatches: boolean }
  | { status: "ignored" };

/**
 * Idempotent form ingestion. One transaction records the receipt, deduplicates on the source
 * event identity, resolves the contact, records consent, opens the conversation and starts runs
 * for every published workflow with a matching trigger. Repeats only add an ingest_attempt row.
 */
export async function ingestFormSubmission(input: SubmissionInput): Promise<SubmissionResult> {
  const form = await resolvePublicForm(input.token);
  if (!form || !form.active) throw new NotFoundError("This form is not available");
  if (!isUuid(input.submissionId)) throw new ValidationError("Invalid submission id");

  const parsed = leadFieldsSchema.safeParse(input.fields);
  const sourceKey = `${form.formId}:${input.submissionId.toLowerCase()}`;
  const now = input.now ?? new Date();
  const attribution = pickAttribution(input.attribution);

  // Rejections are recorded as evidence, so the transaction must commit before we throw.
  let rejection: Error | null = null;
  const result = await withTenant(form.tenantId, null, async (tx): Promise<SubmissionResult | null> => {
    const attempt = (outcome: string, extra: { inboxEventId?: string; payloadHash?: string } = {}) =>
      tx.insert(ingestAttempt).values({
        tenantId: form.tenantId,
        source: "form",
        sourceKey,
        outcome,
        ipHash: input.ipHash,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        correlationId: input.correlationId,
        receivedAt: now,
        inboxEventId: extra.inboxEventId ?? null,
        payloadHash: extra.payloadHash ?? null,
      });

    if (input.ipHash) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(ingestAttempt)
        .where(and(eq(ingestAttempt.ipHash, input.ipHash), gt(ingestAttempt.receivedAt, new Date(now.getTime() - 60_000))));
      if (n >= RATE_LIMIT_PER_MINUTE) {
        await attempt("rate_limited");
        rejection = new RateLimitedError();
        return null;
      }
    }
    if (!parsed.success) {
      await attempt("rejected_validation");
      rejection = new ValidationError("Please correct the highlighted fields", parsed.error.flatten().fieldErrors);
      return null;
    }
    const fields = parsed.data;
    const payloadHash = sha256(canonicalJson({ fields: { ...fields, website: undefined }, attribution }));
    if (fields.website) {
      // Honeypot filled: record evidence, create nothing, respond like a success to the bot.
      await attempt("spam_honeypot", { payloadHash });
      return { status: "ignored" };
    }

    // Deduplicate on source identity. ON CONFLICT DO UPDATE takes a row lock, so concurrent
    // repeats wait for the first transaction and then observe it as a duplicate.
    const [ev] = await tx
      .insert(inboxEvent)
      .values({ tenantId: form.tenantId, source: "form", sourceKey, payloadHash, firstReceivedAt: now, lastReceivedAt: now })
      .onConflictDoUpdate({
        target: [inboxEvent.tenantId, inboxEvent.source, inboxEvent.sourceKey],
        set: { receiveCount: sql`${inboxEvent.receiveCount} + 1`, lastReceivedAt: now },
      })
      .returning({ id: inboxEvent.id, payloadHash: inboxEvent.payloadHash, result: inboxEvent.result, inserted: sql<boolean>`(xmax = 0)` });
    if (!ev) throw new Error("inbox insert returned nothing");

    if (!ev.inserted) {
      const payloadMatches = ev.payloadHash === payloadHash;
      await attempt(payloadMatches ? "duplicate" : "duplicate_payload_mismatch", { inboxEventId: ev.id, payloadHash });
      const contactId = (ev.result?.contactId as string | undefined) ?? null;
      await audit(tx, {
        tenantId: form.tenantId,
        actor: { type: "public_form", id: form.formId },
        action: "form.duplicate_received",
        entityType: "inbox_event",
        entityId: ev.id,
        contactId,
        correlationId: input.correlationId,
        summary: payloadMatches
          ? `Repeat of an already-processed submission to "${form.formName}" received; no records created`
          : `Repeat submission id with different content received for "${form.formName}"; ignored and kept as evidence`,
        data: { sourceKey, payloadMatches },
        at: now,
      });
      return { status: "duplicate", contactId, inboxEventId: ev.id, payloadMatches };
    }

    const resolved = await resolveContact(tx, form.tenantId, fields, now, input.correlationId);
    const contactId = resolved.contactId;
    const [sub] = await tx
      .insert(formSubmission)
      .values({
        tenantId: form.tenantId,
        formId: form.formId,
        inboxEventId: ev.id,
        contactId,
        fields: {
          firstName: fields.firstName,
          lastName: fields.lastName,
          email: fields.email,
          phone: fields.phone,
          message: fields.message,
          smsConsent: String(fields.smsConsent),
          marketingConsent: String(fields.marketingConsent),
        },
        attribution,
        submittedAt: now,
      })
      .returning({ id: formSubmission.id });
    const submissionId = sub!.id;

    await audit(tx, {
      tenantId: form.tenantId,
      actor: { type: "public_form", id: form.formId },
      action: "form.submitted",
      entityType: "form_submission",
      entityId: submissionId,
      contactId,
      correlationId: input.correlationId,
      summary: `Submitted "${form.formName}"${attribution.utm_source ? ` (source: ${attribution.utm_source})` : ""}`,
      data: { formId: form.formId, attribution, contactResolution: resolved.resolution },
      at: now,
    });

    // Consent ledger: only what the person explicitly checked, with the exact text shown.
    const consents: { channel: "sms" | "email"; purpose: "transactional" | "marketing"; text: string }[] = [];
    if (fields.smsConsent && fields.phone) consents.push({ channel: "sms", purpose: "transactional", text: form.smsConsentText });
    if (fields.marketingConsent) {
      if (fields.email) consents.push({ channel: "email", purpose: "marketing", text: form.marketingConsentText });
      if (fields.phone) consents.push({ channel: "sms", purpose: "marketing", text: form.marketingConsentText });
    }
    for (const c of consents) {
      await tx.insert(consentEvent).values({
        tenantId: form.tenantId,
        contactId,
        channel: c.channel,
        purpose: c.purpose,
        action: "granted",
        source: "form",
        evidence: { formSubmissionId: submissionId, formId: form.formId, consentText: c.text, ipHash: input.ipHash },
        occurredAt: now,
      });
      await audit(tx, {
        tenantId: form.tenantId,
        actor: { type: "public_form", id: form.formId },
        action: "consent.granted",
        entityType: "contact",
        entityId: contactId,
        contactId,
        correlationId: input.correlationId,
        summary: `Consent granted: ${c.channel.toUpperCase()} ${c.purpose} (checkbox on "${form.formName}")`,
        data: { channel: c.channel, purpose: c.purpose, formSubmissionId: submissionId },
        at: now,
      });
    }

    // Conversation + inbound inquiry record.
    const [conv] = await tx
      .insert(conversation)
      .values({ tenantId: form.tenantId, contactId, unanswered: true, lastInboundAt: now, lastActivityAt: now })
      .onConflictDoUpdate({
        target: [conversation.tenantId, conversation.contactId],
        set: { unanswered: true, lastInboundAt: now, lastActivityAt: now },
      })
      .returning({ id: conversation.id });
    await tx.insert(message).values({
      tenantId: form.tenantId,
      conversationId: conv!.id,
      contactId,
      direction: "inbound",
      channel: "form",
      body: fields.message || "(Form submitted without a message)",
      status: "recorded",
      idempotencyKey: `form:${sourceKey}`,
      createdAt: now,
      updatedAt: now,
    });

    const runIds = await startRunsForFormSubmission(tx, {
      tenantId: form.tenantId,
      formId: form.formId,
      inboxEventId: ev.id,
      contactId,
      submissionId,
      message: fields.message,
      correlationId: input.correlationId,
      now,
    });

    await tx
      .update(inboxEvent)
      .set({ processedAt: now, result: { contactId, formSubmissionId: submissionId, runIds, contactResolution: resolved.resolution } })
      .where(eq(inboxEvent.id, ev.id));
    await attempt("accepted", { inboxEventId: ev.id, payloadHash });
    return { status: "accepted", contactId, submissionId, runIds, inboxEventId: ev.id };
  });
  if (rejection) throw rejection;
  return result!;
}

function pickAttribution(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 300);
  }
  return out;
}

/**
 * Contact resolution. Shared email/phone alone does not prove identity (families share phones,
 * offices share inboxes): we reuse a contact only when the normalized name also matches, and
 * otherwise create a new contact plus a duplicate suggestion for authorized review.
 */
async function resolveContact(tx: Tx, tenantId: string, f: LeadFields, now: Date, correlationId: string) {
  const email = normalizeEmail(f.email);
  const phone = normalizePhone(f.phone);
  const name = normalizeName(f.firstName, f.lastName);
  const matchers = [email ? eq(contact.emailNormalized, email) : undefined, phone ? eq(contact.phoneE164, phone) : undefined].filter(
    (x): x is NonNullable<typeof x> => x !== undefined,
  );
  const candidates = matchers.length
    ? await tx
        .select()
        .from(contact)
        .where(and(eq(contact.tenantId, tenantId), or(...matchers)))
        .limit(20)
    : [];
  const exact = candidates.find((c) => c.nameNormalized === name);
  if (exact) {
    const fill: Partial<typeof contact.$inferInsert> = {};
    if (!exact.emailNormalized && email) Object.assign(fill, { email: f.email, emailNormalized: email });
    if (!exact.phoneE164 && phone) Object.assign(fill, { phone: f.phone, phoneE164: phone });
    if (Object.keys(fill).length) {
      await tx.update(contact).set({ ...fill, updatedAt: now }).where(eq(contact.id, exact.id));
    }
    await audit(tx, {
      tenantId,
      actor: { type: "system", id: "contact-resolution" },
      action: "contact.matched",
      entityType: "contact",
      entityId: exact.id,
      contactId: exact.id,
      correlationId,
      summary: `Matched existing contact by name + ${email && exact.emailNormalized === email ? "email" : "phone"}${Object.keys(fill).length ? "; filled missing contact details" : ""}`,
      data: { filled: Object.keys(fill) },
      at: now,
    });
    return { contactId: exact.id, resolution: "matched_existing" as const };
  }

  const [c] = await tx
    .insert(contact)
    .values({
      tenantId,
      firstName: f.firstName,
      lastName: f.lastName,
      displayName: displayName(f.firstName, f.lastName),
      nameNormalized: name,
      email: f.email || null,
      emailNormalized: email,
      phone: f.phone || null,
      phoneE164: phone,
      source: "web_form",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: contact.id });
  const contactId = c!.id;
  await audit(tx, {
    tenantId,
    actor: { type: "system", id: "contact-resolution" },
    action: "contact.created",
    entityType: "contact",
    entityId: contactId,
    contactId,
    correlationId,
    summary: "Contact created from web form",
    data: {},
    at: now,
  });
  for (const cand of candidates) {
    const reason = [email && cand.emailNormalized === email ? "same email" : null, phone && cand.phoneE164 === phone ? "same phone" : null]
      .filter(Boolean)
      .join(" and ");
    await tx.insert(duplicateSuggestion).values({ tenantId, contactId, candidateContactId: cand.id, reason }).onConflictDoNothing();
    await audit(tx, {
      tenantId,
      actor: { type: "system", id: "contact-resolution" },
      action: "contact.duplicate_suggested",
      entityType: "contact",
      entityId: contactId,
      contactId,
      correlationId,
      summary: `Possible duplicate of ${cand.displayName} (${reason}); names differ, so records were not merged`,
      data: { candidateContactId: cand.id },
      at: now,
    });
  }
  return { contactId, resolution: candidates.length ? ("created_with_duplicate_suggestion" as const) : ("created" as const) };
}

/** Starts one run per published workflow whose trigger matches. Idempotent per (workflow, event). */
export async function startRunsForFormSubmission(
  tx: Tx,
  p: { tenantId: string; formId: string; inboxEventId: string; contactId: string; submissionId: string; message: string; correlationId: string; now: Date },
): Promise<string[]> {
  const wfs = await tx
    .select({ id: workflow.id, name: workflow.name, versionId: workflow.activeVersionId, definition: workflowVersion.definition, version: workflowVersion.version })
    .from(workflow)
    .innerJoin(workflowVersion, and(eq(workflowVersion.tenantId, workflow.tenantId), eq(workflowVersion.id, workflow.activeVersionId)))
    .where(and(eq(workflow.tenantId, p.tenantId), eq(workflow.triggerType, "form.submitted"), isNotNull(workflow.activeVersionId)));
  const [biz] = await tx.select({ name: tenant.name, timezone: tenant.timezone }).from(tenant).where(eq(tenant.id, p.tenantId));
  const runIds: string[] = [];
  for (const wf of wfs) {
    const parsed = parseDefinition(wf.definition);
    if (!parsed.ok) continue; // published versions are validated; this guards schema drift
    const def = parsed.def;
    if (def.trigger.formId && def.trigger.formId !== p.formId) continue;
    const [run] = await tx
      .insert(workflowRun)
      .values({
        tenantId: p.tenantId,
        workflowId: wf.id,
        workflowVersionId: wf.versionId!,
        triggerInboxEventId: p.inboxEventId,
        contactId: p.contactId,
        status: "pending",
        currentStepId: def.steps[0]!.id,
        context: { contactId: p.contactId, formSubmissionId: p.submissionId, submissionMessage: p.message, businessName: biz?.name ?? "", businessTimezone: biz?.timezone ?? "America/New_York" },
        wakeAt: p.now,
        correlationId: p.correlationId,
        createdAt: p.now,
        updatedAt: p.now,
      })
      .onConflictDoNothing()
      .returning({ id: workflowRun.id });
    if (!run) continue;
    runIds.push(run.id);
    await audit(tx, {
      tenantId: p.tenantId,
      actor: { type: "workflow", id: wf.id, name: wf.name },
      action: "workflow_run.started",
      entityType: "workflow_run",
      entityId: run.id,
      contactId: p.contactId,
      correlationId: p.correlationId,
      summary: `Automation "${wf.name}" v${wf.version} started`,
      data: { workflowId: wf.id, workflowVersionId: wf.versionId, version: wf.version },
      at: p.now,
    });
  }
  return runIds;
}
