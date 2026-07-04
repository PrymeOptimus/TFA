import { z } from "zod";
import { addDays, addMonths, addWeeks } from "date-fns";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const updateSchema = z.object({
  householdId: z.string(),
  title: z.string().min(1).max(140).optional(),
  notes: z.string().max(1000).nullable().optional(),
  points: z.number().int().min(0).max(1000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
  familyMemberId: z.string().optional(),
  /** Touch-friendly check-off: marks one completion and, for recurring
   * chores, rolls dueDate forward instead of deactivating the chore. */
  complete: z.boolean().optional(),
});

function nextDueDate(current: Date, recurrence: string): Date {
  switch (recurrence) {
    case "DAILY":
      return addDays(current, 1);
    case "WEEKLY":
      return addWeeks(current, 1);
    case "MONTHLY":
      return addMonths(current, 1);
    default:
      return current;
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const chore = await prisma.chore.findFirst({ where: { id: params.id, householdId: body.householdId } });
    if (!chore) return Response.json({ error: "Not found" }, { status: 404 });

    if (body.complete) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.choreCompletion.create({
          data: { choreId: chore.id, pointsEarned: chore.points },
        });
        return tx.chore.update({
          where: { id: chore.id },
          data:
            chore.recurrence === "NONE"
              ? { isActive: false }
              : { dueDate: chore.dueDate ? nextDueDate(chore.dueDate, chore.recurrence) : null },
        });
      });
      return Response.json({ chore: updated });
    }

    const updated = await prisma.chore.update({
      where: { id: chore.id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.points !== undefined ? { points: body.points } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? new Date(body.dueDate) : null } : {}),
        ...(body.recurrence ? { recurrence: body.recurrence } : {}),
        ...(body.familyMemberId ? { familyMemberId: body.familyMemberId } : {}),
      },
    });
    return Response.json({ chore: updated });
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

    const chore = await prisma.chore.findFirst({ where: { id: params.id, householdId } });
    if (!chore) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.chore.update({ where: { id: chore.id }, data: { isActive: false } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
