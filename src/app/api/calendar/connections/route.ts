import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

/**
 * Connections are always returned WITHOUT accessTokenEnc/refreshTokenEnc —
 * those never leave the server (see security requirements). The `select`
 * below is the enforcement point, not just an optimization.
 */
const PUBLIC_SELECT = {
  id: true,
  provider: true,
  providerAccountEmail: true,
  externalCalendarId: true,
  displayName: true,
  color: true,
  familyMemberId: true,
  status: true,
  lastSyncedAt: true,
  lastError: true,
  createdAt: true,
} as const;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const connections = await prisma.calendarConnection.findMany({
      where: { householdId },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return Response.json({ connections });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

const updateSchema = z.object({
  householdId: z.string(),
  id: z.string(),
  familyMemberId: z.string().nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  displayName: z.string().max(120).nullable().optional(),
});

export async function PATCH(req: Request) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const connection = await prisma.calendarConnection.findFirst({ where: { id: body.id, householdId: body.householdId } });
    if (!connection) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        ...(body.familyMemberId !== undefined ? { familyMemberId: body.familyMemberId } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      },
      select: PUBLIC_SELECT,
    });
    return Response.json({ connection: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    const id = searchParams.get("id");
    if (!householdId || !id) return Response.json({ error: "householdId and id are required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const connection = await prisma.calendarConnection.findFirst({ where: { id, householdId } });
    if (!connection) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.calendarConnection.delete({ where: { id: connection.id } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
