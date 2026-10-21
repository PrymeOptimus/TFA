import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { createContact, listContacts } from "@/server/services/crm";

export const GET = apiRoute(async (req, actor) => {
  const u = new URL(req.url);
  return NextResponse.json(await listContacts(actor, { q: u.searchParams.get("q") ?? undefined, page: Number(u.searchParams.get("page") ?? 1) }));
});

export const POST = apiRoute(async (req, actor) => NextResponse.json(await createContact(actor, await req.json()), { status: 201 }));
