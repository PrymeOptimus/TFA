import { z } from "zod";
import { startOfWeek } from "date-fns";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const querySchema = z.object({
  householdId: z.string(),
  weekStart: z.string().datetime(),
});

/** GET: fetch (or lazily create) the meal plan for a given week. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.parse({
      householdId: searchParams.get("householdId"),
      weekStart: searchParams.get("weekStart"),
    });
    await requireHouseholdAccess(parsed.householdId);

    const weekStart = startOfWeek(new Date(parsed.weekStart), { weekStartsOn: 1 });

    const plan = await prisma.mealPlan.upsert({
      where: { householdId_weekStart: { householdId: parsed.householdId, weekStart } },
      create: { householdId: parsed.householdId, weekStart },
      update: {},
      include: { entries: true, groceryItems: { orderBy: { createdAt: "asc" } } },
    });

    return Response.json({ mealPlan: plan });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
