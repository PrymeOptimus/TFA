import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { initialsFromName } from "@/lib/colors";

const createSchema = z.object({
  householdId: z.string(),
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  avatarUrl: z.string().url().optional(),
  isChild: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });

    await requireHouseholdAccess(householdId);

    const members = await prisma.familyMember.findMany({
      where: { householdId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return Response.json({ familyMembers: members });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const member = await prisma.familyMember.create({
      data: {
        householdId: body.householdId,
        name: body.name,
        color: body.color,
        avatarUrl: body.avatarUrl,
        initials: initialsFromName(body.name),
        isChild: body.isChild ?? false,
      },
    });
    return Response.json({ familyMember: member }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
