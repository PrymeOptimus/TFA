import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const createSchema = z.object({
  householdId: z.string(),
  name: z.string().min(1).max(140),
  description: z.string().max(500).optional(),
  requiredPoints: z.number().int().min(1).max(100000),
  iconUrl: z.string().url().optional(),
});

async function pointsBalance(familyMemberId: string): Promise<number> {
  const earned = await prisma.choreCompletion.aggregate({
    where: { chore: { familyMemberId } },
    _sum: { pointsEarned: true },
  });
  const spent = await prisma.rewardRedemption.aggregate({
    where: { familyMemberId },
    _sum: { pointsSpent: true },
  });
  return (earned._sum.pointsEarned ?? 0) - (spent._sum.pointsSpent ?? 0);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    const familyMemberId = searchParams.get("familyMemberId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const rewards = await prisma.reward.findMany({
      where: { householdId, isActive: true },
      orderBy: { requiredPoints: "asc" },
    });

    const balance = familyMemberId ? await pointsBalance(familyMemberId) : null;

    return Response.json({ rewards, balance });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const reward = await prisma.reward.create({
      data: {
        householdId: body.householdId,
        name: body.name,
        description: body.description,
        requiredPoints: body.requiredPoints,
        iconUrl: body.iconUrl,
      },
    });
    return Response.json({ reward }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
