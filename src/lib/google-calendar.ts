import { google } from "googleapis";
import type { CalendarConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto";

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
}

/**
 * Builds an authenticated Calendar client for a connection, refreshing and
 * persisting a new access token first if the cached one has expired.
 * Tokens never leave this module in decrypted form.
 */
export async function getCalendarClientFor(connection: CalendarConnection) {
  if (!connection.refreshTokenEnc) {
    throw new Error("Calendar connection has no refresh token; user must reconnect");
  }

  const oauth2Client = getOAuthClient();
  const refreshToken = decryptToken(connection.refreshTokenEnc);

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: connection.accessTokenEnc ? decryptToken(connection.accessTokenEnc) : undefined,
    expiry_date: connection.tokenExpiresAt?.getTime(),
  });

  oauth2Client.on("tokens", async (tokens) => {
    // Persist rotated tokens so subsequent syncs reuse them instead of
    // hitting Google's token endpoint every time.
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        ...(tokens.access_token ? { accessTokenEnc: encryptToken(tokens.access_token) } : {}),
        ...(tokens.refresh_token ? { refreshTokenEnc: encryptToken(tokens.refresh_token) } : {}),
        ...(tokens.expiry_date ? { tokenExpiresAt: new Date(tokens.expiry_date) } : {}),
      },
    }).catch(() => {
      /* best-effort; next sync will refresh again */
    });
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export interface NormalizedEvent {
  externalEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone: string | null;
  recurrenceRule: string | null;
  recurringEventId: string | null;
  isCancelled: boolean;
}

/**
 * Fetches events for a connection using incremental sync (syncToken) when
 * available, falling back to a full time-bounded sync otherwise. Returns
 * both the normalized events and the new syncToken to persist.
 */
export async function fetchEvents(
  connection: CalendarConnection,
  opts: { timeMinIso: string; timeMaxIso: string },
): Promise<{ events: NormalizedEvent[]; nextSyncToken: string | null }> {
  const calendar = await getCalendarClientFor(connection);
  const calendarId = connection.externalCalendarId || "primary";

  const events: NormalizedEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const res = await calendar.events.list({
      calendarId,
      pageToken,
      ...(connection.syncToken
        ? { syncToken: connection.syncToken }
        : { timeMin: opts.timeMinIso, timeMax: opts.timeMaxIso, singleEvents: false }),
      maxResults: 250,
    });

    for (const item of res.data.items ?? []) {
      if (!item.id) continue;
      const isCancelled = item.status === "cancelled";
      const startAt = item.start?.dateTime ?? item.start?.date;
      const endAt = item.end?.dateTime ?? item.end?.date;
      if (!startAt || !endAt) continue;

      events.push({
        externalEventId: item.id,
        title: item.summary ?? "(No title)",
        description: item.description ?? null,
        location: item.location ?? null,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        allDay: !item.start?.dateTime,
        timezone: item.start?.timeZone ?? null,
        recurrenceRule: item.recurrence?.[0] ?? null,
        recurringEventId: item.recurringEventId ?? null,
        isCancelled,
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
    if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

export async function createEvent(
  connection: CalendarConnection,
  input: { title: string; description?: string; location?: string; startAt: Date; endAt: Date; allDay?: boolean },
) {
  const calendar = await getCalendarClientFor(connection);
  const calendarId = connection.externalCalendarId || "primary";

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: input.allDay
        ? { date: input.startAt.toISOString().slice(0, 10) }
        : { dateTime: input.startAt.toISOString() },
      end: input.allDay
        ? { date: input.endAt.toISOString().slice(0, 10) }
        : { dateTime: input.endAt.toISOString() },
    },
  });

  return res.data;
}

export async function updateEvent(
  connection: CalendarConnection,
  externalEventId: string,
  input: Partial<{ title: string; description: string; location: string; startAt: Date; endAt: Date; allDay: boolean }>,
) {
  const calendar = await getCalendarClientFor(connection);
  const calendarId = connection.externalCalendarId || "primary";

  const res = await calendar.events.patch({
    calendarId,
    eventId: externalEventId,
    requestBody: {
      ...(input.title ? { summary: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.startAt
        ? { start: input.allDay ? { date: input.startAt.toISOString().slice(0, 10) } : { dateTime: input.startAt.toISOString() } }
        : {}),
      ...(input.endAt
        ? { end: input.allDay ? { date: input.endAt.toISOString().slice(0, 10) } : { dateTime: input.endAt.toISOString() } }
        : {}),
    },
  });

  return res.data;
}

export async function deleteEvent(connection: CalendarConnection, externalEventId: string) {
  const calendar = await getCalendarClientFor(connection);
  const calendarId = connection.externalCalendarId || "primary";
  await calendar.events.delete({ calendarId, eventId: externalEventId });
}
