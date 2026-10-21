import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { moveOpportunity } from "@/server/services/crm";

export const POST = apiRoute<{ params: Promise<{ id: string }> }>(async (req, actor, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { stageId?: string };
  return NextResponse.json(await moveOpportunity(actor, id, String(body.stageId ?? "")));
});
