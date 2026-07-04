import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { createEvent } from "@/lib/google-calendar";
import type { AgendaEvent } from "@/types";

const querySchema = z.object({
  householdId: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  familyMemberIds: z.array(z.string()).optional(),
});

/** GET: cached events in [start, end], flattened for display components. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.parse({
      householdId: searchParams.get("householdId"),
      start: searchParams.get("start"),
      end: searchParams.get("end"),
      familyMemberIds: searchParams.getAll("familyMemberId").length
        ? searchParams.getAll("familyMemberId")
        : undefined,
    });
    await requireHouseholdAccess(parsed.householdId);

    const events = await prisma.calendarEventCache.findMany({
      where: {
        householdId: parsed.householdId,
        isCancelled: false,
        startAt: { lte: new Date(parsed.end) },
        endAt: { gte: new Date(parsed.start) },
        ...(parsed.familyMemberIds
          ? { attendees: { some: { familyMemberId: { in: parsed.familyMemberIds } } } }
          : {}),
      },
      include: {
        calendarConnection: { include: { familyMember: true } },
        attendees: { include: { familyMember: true } },
      },
      orderBy: { startAt: "asc" },
    });

    const flattened: AgendaEvent[] = events.map((e) => {
      const attendeeMembers = e.attendees.map((a) => a.familyMember);
      const primaryMember = attendeeMembers[0] ?? e.calendarConnection.familyMember ?? null;
      const color = e.colorOverride ?? e.calendarConnection.color ?? primaryMember?.color ?? "#6366F1";

      return {
        id: e.id,
        title: e.title,
        location: e.location,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt.toISOString(),
        allDay: e.allDay,
        category: e.category,
        color,
        familyMembers: (attendeeMembers.length ? attendeeMembers : primaryMember ? [primaryMember] : []).map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
          initials: m.initials ?? "?",
        })),
      };
    });

    return Response.json({ events: flattened });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

const createSchema = z.object({
  householdId: z.string(),
  connectionId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  location: z.string().max(300).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().default(false),
  familyMemberIds: z.array(z.string()).default([]),
});

/**
 * POST: manual event creation. Writes through to Google first (source of
 * truth), then caches the result locally so it shows up immediately without
 * waiting for the next sync pass.
 */
export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const connection = await prisma.calendarConnection.findFirst({
      where: { id: body.connectionId, householdId: body.householdId },
    });
    if (!connection) return Response.json({ error: "Calendar connection not found" }, { status: 404 });

    const googleEvent = await createEvent(connection, {
      title: body.title,
      description: body.description,
      location: body.location,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      allDay: body.allDay,
    });
    if (!googleEvent.id) throw new Error("Google did not return an event id");

    const cached = await prisma.calendarEventCache.create({
      data: {
        householdId: body.householdId,
        calendarConnectionId: connection.id,
        externalEventId: googleEvent.id,
        title: body.title,
        description: body.description,
        location: body.location,
        startAt: new Date(body.startAt),
        endAt: new Date(body.endAt),
        allDay: body.allDay,
        attendees: { create: body.familyMemberIds.map((familyMemberId) => ({ familyMemberId })) },
      },
    });

    return Response.json({ event: cached }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
