import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { config } from "@/server/config";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import { ingestFormSubmission } from "@/server/services/ingest";
import { newCorrelationId, sha256 } from "@/server/util";

/**
 * Public, unauthenticated lead-form endpoint. The token selects exactly one form (and therefore one
 * tenant); no other tenant data is reachable. The submission id makes repeats idempotent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const correlationId = newCorrelationId();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "bad_request", "Expected a JSON body", undefined, correlationId);
  }
  const submissionId = String(req.headers.get("idempotency-key") ?? body.submissionId ?? "");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  try {
    const r = await ingestFormSubmission({
      token,
      submissionId,
      fields: body.fields,
      attribution: (body.attribution as Record<string, string>) ?? {},
      ipHash: sha256(`${config().IP_HASH_SALT}:${ip}`),
      userAgent: req.headers.get("user-agent"),
      correlationId,
    });
    // Identical response for first receipt and repeats; never reveals record ids publicly.
    return NextResponse.json({ status: r.status === "duplicate" ? "already_received" : "received", correlationId }, { status: r.status === "duplicate" ? 200 : 201 });
  } catch (e) {
    if (e instanceof AppError) return jsonError(e.status, e.code, e.message, e.details, correlationId);
    log.error({ correlationId, err: (e as Error).message }, "form ingestion failed");
    return jsonError(500, "internal", "We could not record your request. Please try again.", undefined, correlationId);
  }
}
