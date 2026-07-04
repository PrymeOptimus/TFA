import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const updateSchema = z.object({
  householdId: z.string(),
  name: z.string().min(1).max(80).optional(),
  layoutId: z.string().nullable().optional(),
  orientation: z.enum(["landscape", "portrait"]).optional(),
  theme: z.enum(["dark", "light", "auto"]).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const display = await prisma.display.findFirst({ where: { id: params.id, householdId: body.householdId } });
    if (!display) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.display.update({
      where: { id: display.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.layoutId !== undefined ? { layoutId: body.layoutId } : {}),
        ...(body.orientation ? { orientation: body.orientation } : {}),
        ...(body.theme ? { theme: body.theme } : {}),
        ...(body.accentColor ? { accentColor: body.accentColor } : {}),
      },
    });
    return Response.json({ display: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** DELETE: unpair a display (it can be re-paired later with a fresh code by revisiting /display). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const display = await prisma.display.findFirst({ where: { id: params.id, householdId } });
    if (!display) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.display.delete({ where: { id: display.id } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
