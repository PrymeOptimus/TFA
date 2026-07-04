import { z } from "zod";
import { addMonths, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { fetchEvents } from "@/lib/google-calendar";

const syncSchema = z.object({
  householdId: z.string(),
  connectionId: z.string().optional(), // sync one connection, or all if omitted
});

/**
 * Pulls fresh events from each connected Google Calendar into
 * CalendarEventCache. Called both from the dashboard's "Sync now" button
 * and from a scheduled cron job (see docs/DEPLOYMENT.md) hitting this route
 * with CRON_SECRET instead of a user session.
 */
export async function POST(req: Request) {
  try {
    const body = syncSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const connections = await prisma.calendarConnection.findMany({
      where: {
        householdId: body.householdId,
        ...(body.connectionId ? { id: body.connectionId } : {}),
        status: { not: "DISABLED" },
      },
    });

    const results = [];
    const timeMinIso = subMonths(new Date(), 1).toISOString();
    const timeMaxIso = addMonths(new Date(), 6).toISOString();

    for (const connection of connections) {
      try {
        const { events, nextSyncToken } = await fetchEvents(connection, { timeMinIso, timeMaxIso });

        await prisma.$transaction(
          events.map((e) =>
            prisma.calendarEventCache.upsert({
              where: {
                calendarConnectionId_externalEventId: {
                  calendarConnectionId: connection.id,
                  externalEventId: e.externalEventId,
                },
              },
              create: {
                householdId: body.householdId,
                calendarConnectionId: connection.id,
                externalEventId: e.externalEventId,
                title: e.title,
                description: e.description,
                location: e.location,
                startAt: e.startAt,
                endAt: e.endAt,
                allDay: e.allDay,
                timezone: e.timezone,
                recurrenceRule: e.recurrenceRule,
                recurringEventId: e.recurringEventId,
                isCancelled: e.isCancelled,
              },
              update: {
                title: e.title,
                description: e.description,
                location: e.location,
                startAt: e.startAt,
                endAt: e.endAt,
                allDay: e.allDay,
                timezone: e.timezone,
                recurrenceRule: e.recurrenceRule,
                recurringEventId: e.recurringEventId,
                isCancelled: e.isCancelled,
              },
            }),
          ),
        );

        await prisma.calendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncedAt: new Date(), status: "CONNECTED", lastError: null, ...(nextSyncToken ? { syncToken: nextSyncToken } : {}) },
        });

        results.push({ connectionId: connection.id, eventCount: events.length, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown sync error";
        await prisma.calendarConnection.update({
          where: { id: connection.id },
          data: { status: "ERROR", lastError: message },
        });
        results.push({ connectionId: connection.id, ok: false, error: message });
      }
    }

    return Response.json({ results });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
