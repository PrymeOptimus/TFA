import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { getRun } from "@/server/services/workflows";

export const GET = apiRoute<{ params: Promise<{ id: string }> }>(async (_req, actor, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getRun(actor, id));
});
