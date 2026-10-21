import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { publishWorkflow } from "@/server/services/workflows";

export const POST = apiRoute<{ params: Promise<{ id: string }> }>(async (req, actor, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { changeSummary?: string };
  const v = await publishWorkflow(actor, id, String(body.changeSummary ?? ""));
  return NextResponse.json({ id: v.id, version: v.version, contentHash: v.contentHash }, { status: 201 });
});
