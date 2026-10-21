import "server-only";
import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { log } from "./log";
import { getActor } from "./session";
import type { Actor } from "./authz";
import { newCorrelationId } from "./util";

export function jsonError(status: number, code: string, message: string, details?: unknown, correlationId?: string) {
  return NextResponse.json({ error: { code, message, details, correlationId } }, { status });
}

/**
 * Wraps an authenticated API route: resolves the actor from the session (never from a client-sent
 * tenant id), blocks cross-site state-changing requests, and maps errors to JSON.
 */
export function apiRoute<C>(fn: (req: Request, actor: Actor, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const correlationId = req.headers.get("x-correlation-id")?.slice(0, 64) || newCorrelationId();
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        const host = req.headers.get("host");
        if (origin && host && new URL(origin).host !== host) return jsonError(403, "cross_origin", "Cross-origin request rejected", undefined, correlationId);
      }
      const actor = await getActor();
      if (!actor) return jsonError(401, "unauthenticated", "Sign in required", undefined, correlationId);
      const res = await fn(req, actor, ctx);
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (e) {
      if (e instanceof AppError) return jsonError(e.status, e.code, e.message, e.details, correlationId);
      log.error({ correlationId, err: (e as Error).message }, "api route failed");
      return jsonError(500, "internal", "Unexpected error", undefined, correlationId);
    }
  };
}
