import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const createSchema = z.object({
  householdId: z.string(),
  familyMemberId: z.string(),
  title: z.string().min(1).max(140),
  notes: z.string().max(1000).optional(),
  points: z.number().int().min(0).max(1000).default(0),
  dueDate: z.string().datetime().optional(),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).default("NONE"),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const chores = await prisma.chore.findMany({
      where: { householdId, isActive: true },
      include: { familyMember: true, completions: { orderBy: { completedAt: "desc" }, take: 1 } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });
    return Response.json({ chores });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const chore = await prisma.chore.create({
      data: {
        householdId: body.householdId,
        familyMemberId: body.familyMemberId,
        title: body.title,
        notes: body.notes,
        points: body.points,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        recurrence: body.recurrence,
      },
    });
    return Response.json({ chore }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
