import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { getContact, getTimeline } from "@/server/services/crm";

export const GET = apiRoute<{ params: Promise<{ id: string }> }>(async (_req, actor, { params }) => {
  const { id } = await params;
  const [detail, timeline] = await Promise.all([getContact(actor, id), getTimeline(actor, id)]);
  return NextResponse.json({ ...detail, timeline });
});
