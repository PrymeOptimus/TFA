import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const redeemSchema = z.object({
  householdId: z.string(),
  familyMemberId: z.string(),
});

/** POST /api/rewards/:id — redeems a reward for a family member if they have enough points. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = redeemSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const reward = await prisma.reward.findFirst({ where: { id: params.id, householdId: body.householdId } });
    if (!reward) return Response.json({ error: "Not found" }, { status: 404 });

    const earned = await prisma.choreCompletion.aggregate({
      where: { chore: { familyMemberId: body.familyMemberId } },
      _sum: { pointsEarned: true },
    });
    const spent = await prisma.rewardRedemption.aggregate({
      where: { familyMemberId: body.familyMemberId },
      _sum: { pointsSpent: true },
    });
    const balance = (earned._sum.pointsEarned ?? 0) - (spent._sum.pointsSpent ?? 0);

    if (balance < reward.requiredPoints) {
      return Response.json({ error: "Not enough points" }, { status: 400 });
    }

    const redemption = await prisma.rewardRedemption.create({
      data: {
        householdId: body.householdId,
        rewardId: reward.id,
        familyMemberId: body.familyMemberId,
        pointsSpent: reward.requiredPoints,
      },
    });

    return Response.json({ redemption }, { status: 201 });
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

    const reward = await prisma.reward.findFirst({ where: { id: params.id, householdId } });
    if (!reward) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.reward.update({ where: { id: reward.id }, data: { isActive: false } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
