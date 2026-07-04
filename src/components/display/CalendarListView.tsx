"use client";

import { addDays, endOfDay, format, isSameDay, startOfDay } from "date-fns";
import { useAgendaEvents } from "@/lib/hooks/useAgendaEvents";
import { Badge } from "@/components/ui/Badge";
import type { AgendaEvent } from "@/types";

function EventRow({ event }: { event: AgendaEvent }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hearth-surface">
      <div className="w-16 shrink-0 text-sm tabular-nums text-hearth-muted">
        {event.allDay ? "All day" : format(new Date(event.startAt), "h:mm a")}
      </div>
      <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{event.title}</div>
        {event.location && <div className="truncate text-xs text-hearth-muted">{event.location}</div>}
      </div>
      <div className="flex shrink-0 -space-x-2">
        {event.familyMembers.slice(0, 3).map((m) => (
          <Badge key={m.id} label={m.initials} color={m.color} />
        ))}
      </div>
    </div>
  );
}

function Section({ title, events }: { title: string; events: AgendaEvent[] }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-hearth-muted">{title}</h4>
      {events.length === 0 ? (
        <div className="px-2 py-2 text-sm text-hearth-muted">Nothing scheduled</div>
      ) : (
        <div className="divide-y divide-hearth-border/60">
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Today / Tomorrow / Upcoming" list view called for in the spec. */
export function CalendarListView({ householdId, familyMemberIds }: { householdId: string; familyMemberIds?: string[] }) {
  const now = new Date();
  const rangeStart = startOfDay(now);
  const rangeEnd = endOfDay(addDays(now, 13));
  const { events, loading } = useAgendaEvents(householdId, rangeStart, rangeEnd, familyMemberIds);

  if (loading) return <div className="text-sm text-hearth-muted">Loading agenda…</div>;

  const today = events.filter((e) => isSameDay(new Date(e.startAt), now));
  const tomorrow = events.filter((e) => isSameDay(new Date(e.startAt), addDays(now, 1)));
  const upcoming = events.filter(
    (e) => !isSameDay(new Date(e.startAt), now) && !isSameDay(new Date(e.startAt), addDays(now, 1)),
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <Section title="Today" events={today} />
      <Section title="Tomorrow" events={tomorrow} />
      <Section title="Upcoming" events={upcoming} />
    </div>
  );
}
