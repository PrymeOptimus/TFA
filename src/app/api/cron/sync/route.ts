import { addMonths, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { fetchEvents } from "@/lib/google-calendar";

/**
 * Scheduled sync across every active connection in every household. Protect
 * with CRON_SECRET (Vercel Cron sends it as `Authorization: Bearer <secret>`
 * — configure that header in vercel.json / the cron job definition).
 * See docs/DEPLOYMENT.md for the schedule.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.calendarConnection.findMany({ where: { status: { not: "DISABLED" } } });
  const timeMinIso = subMonths(new Date(), 1).toISOString();
  const timeMaxIso = addMonths(new Date(), 6).toISOString();

  let synced = 0;
  let failed = 0;

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
              householdId: connection.householdId,
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
      synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      await prisma.calendarConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: message } });
      failed++;
    }
  }

  return Response.json({ synced, failed, total: connections.length });
}
