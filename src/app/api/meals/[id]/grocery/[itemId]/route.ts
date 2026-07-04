import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const toggleSchema = z.object({
  householdId: z.string(),
  isChecked: z.boolean(),
});

export async function PATCH(req: Request, { params }: { params: { id: string; itemId: string } }) {
  try {
    const body = toggleSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const item = await prisma.groceryItem.findFirst({
      where: { id: params.itemId, mealPlanId: params.id, mealPlan: { householdId: body.householdId } },
    });
    if (!item) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.groceryItem.update({ where: { id: item.id }, data: { isChecked: body.isChecked } });
    return Response.json({ item: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string; itemId: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const item = await prisma.groceryItem.findFirst({
      where: { id: params.itemId, mealPlanId: params.id, mealPlan: { householdId } },
    });
    if (!item) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.groceryItem.delete({ where: { id: item.id } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
