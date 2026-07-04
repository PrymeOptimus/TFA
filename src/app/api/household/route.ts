import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess, UnauthorizedError } from "@/lib/session-context";

const createHouseholdSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default("America/New_York"),
});

/** GET: the signed-in user's households (usually one). */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) throw new UnauthorizedError();

    const memberships = await prisma.householdMember.findMany({
      where: { userId },
      include: { household: true },
      orderBy: { createdAt: "asc" },
    });

    return Response.json({ households: memberships.map((m) => ({ ...m.household, role: m.role })) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** POST: onboarding — create a household and make the caller its OWNER. */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) throw new UnauthorizedError();

    const body = createHouseholdSchema.parse(await req.json());

    const household = await prisma.$transaction(async (tx) => {
      const created = await tx.household.create({ data: { name: body.name, timezone: body.timezone } });
      await tx.householdMember.create({
        data: { householdId: created.id, userId, role: "OWNER" },
      });
      // Seed the layout presets described in the design spec so a fresh
      // household has something to select in /dashboard/widgets immediately.
      await tx.layout.createMany({
        data: [
          { householdId: created.id, name: "Full Calendar", isPreset: true, background: "none" },
          { householdId: created.id, name: "Family Dashboard", isPreset: true, background: "none" },
          { householdId: created.id, name: "Kitchen Command Center", isPreset: true, background: "none" },
          { householdId: created.id, name: "Minimal Clock + Agenda", isPreset: true, background: "none" },
          { householdId: created.id, name: "Photo Frame + Calendar Overlay", isPreset: true, background: "photos" },
        ],
      });
      return created;
    });

    return Response.json({ household }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

const updateSchema = z.object({
  householdId: z.string(),
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

/** PATCH: update household name/timezone from /settings. */
export async function PATCH(req: Request) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const household = await prisma.household.update({
      where: { id: body.householdId },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
      },
    });
    return Response.json({ household });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
