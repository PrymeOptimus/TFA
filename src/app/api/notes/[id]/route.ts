import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const updateSchema = z.object({
  householdId: z.string(),
  body: z.string().min(1).max(2000).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const note = await prisma.note.findFirst({ where: { id: params.id, householdId: body.householdId } });
    if (!note) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.note.update({
      where: { id: note.id },
      data: {
        ...(body.body !== undefined ? { body: body.body.replace(/<[^>]*>/g, "").slice(0, 2000) } : {}),
        ...(body.color ? { color: body.color } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      },
    });
    return Response.json({ note: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const note = await prisma.note.findFirst({ where: { id: params.id, householdId } });
    if (!note) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.note.delete({ where: { id: note.id } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
