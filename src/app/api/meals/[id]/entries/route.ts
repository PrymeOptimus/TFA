import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const upsertSchema = z.object({
  householdId: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  slot: z.enum(["BREAKFAST", "LUNCH", "DINNER"]),
  title: z.string().min(1).max(140),
  imageUrl: z.string().url().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

/** PUT /api/meals/:planId/entries — upserts a single day/slot entry on a plan. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = upsertSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const plan = await prisma.mealPlan.findFirst({ where: { id: params.id, householdId: body.householdId } });
    if (!plan) return Response.json({ error: "Not found" }, { status: 404 });

    const entry = await prisma.mealEntry.upsert({
      where: { mealPlanId_dayOfWeek_slot: { mealPlanId: plan.id, dayOfWeek: body.dayOfWeek, slot: body.slot } },
      create: {
        mealPlanId: plan.id,
        dayOfWeek: body.dayOfWeek,
        slot: body.slot,
        title: body.title,
        imageUrl: body.imageUrl ?? undefined,
        notes: body.notes ?? undefined,
      },
      update: {
        title: body.title,
        imageUrl: body.imageUrl ?? null,
        notes: body.notes ?? null,
      },
    });

    return Response.json({ entry });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
