import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { completeTask } from "@/server/services/crm";

export const POST = apiRoute<{ params: Promise<{ id: string }> }>(async (_req, actor, { params }) => {
  const { id } = await params;
  return NextResponse.json(await completeTask(actor, id));
});
