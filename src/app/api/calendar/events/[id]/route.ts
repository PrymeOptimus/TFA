import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { deleteEvent, updateEvent } from "@/lib/google-calendar";

const updateSchema = z.object({
  householdId: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  location: z.string().max(300).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
});

/** PATCH: edit a manually-created (or synced) event — writes through to Google, then updates the cache. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const cached = await prisma.calendarEventCache.findFirst({
      where: { id: params.id, householdId: body.householdId },
      include: { calendarConnection: true },
    });
    if (!cached) return Response.json({ error: "Not found" }, { status: 404 });

    await updateEvent(cached.calendarConnection, cached.externalEventId, {
      title: body.title,
      description: body.description,
      location: body.location,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
      allDay: body.allDay,
    });

    const updated = await prisma.calendarEventCache.update({
      where: { id: cached.id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.startAt ? { startAt: new Date(body.startAt) } : {}),
        ...(body.endAt ? { endAt: new Date(body.endAt) } : {}),
        ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
      },
    });

    return Response.json({ event: updated });
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

    const cached = await prisma.calendarEventCache.findFirst({
      where: { id: params.id, householdId },
      include: { calendarConnection: true },
    });
    if (!cached) return Response.json({ error: "Not found" }, { status: 404 });

    await deleteEvent(cached.calendarConnection, cached.externalEventId);
    await prisma.calendarEventCache.delete({ where: { id: cached.id } });

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
