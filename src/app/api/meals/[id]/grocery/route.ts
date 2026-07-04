import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const createSchema = z.object({
  householdId: z.string(),
  label: z.string().min(1).max(140),
});

/** POST /api/meals/:planId/grocery — adds an item to the plan's grocery list. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const plan = await prisma.mealPlan.findFirst({ where: { id: params.id, householdId: body.householdId } });
    if (!plan) return Response.json({ error: "Not found" }, { status: 404 });

    const item = await prisma.groceryItem.create({ data: { mealPlanId: plan.id, label: body.label } });
    return Response.json({ item }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
