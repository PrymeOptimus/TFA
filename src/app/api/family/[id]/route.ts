import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { initialsFromName } from "@/lib/colors";

const updateSchema = z.object({
  householdId: z.string(),
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  isChild: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const existing = await prisma.familyMember.findFirst({
      where: { id: params.id, householdId: body.householdId },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const member = await prisma.familyMember.update({
      where: { id: params.id },
      data: {
        ...(body.name ? { name: body.name, initials: initialsFromName(body.name) } : {}),
        ...(body.color ? { color: body.color } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.isChild !== undefined ? { isChild: body.isChild } : {}),
      },
    });
    return Response.json({ familyMember: member });
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

    const existing = await prisma.familyMember.findFirst({ where: { id: params.id, householdId } });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    // Soft-delete: preserves chore/reward history instead of cascading deletes.
    await prisma.familyMember.update({ where: { id: params.id }, data: { archivedAt: new Date() } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
