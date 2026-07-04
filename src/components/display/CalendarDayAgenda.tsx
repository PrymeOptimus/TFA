"use client";

import { endOfDay, format, startOfDay } from "date-fns";
import { useAgendaEvents } from "@/lib/hooks/useAgendaEvents";
import { Badge } from "@/components/ui/Badge";

export function CalendarDayAgenda({
  householdId,
  date = new Date(),
  familyMemberIds,
}: {
  householdId: string;
  date?: Date;
  familyMemberIds?: string[];
}) {
  const { events, loading } = useAgendaEvents(householdId, startOfDay(date), endOfDay(date), familyMemberIds);

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-2 font-display text-lg font-semibold">{format(date, "EEEE, MMMM d")}</h3>
      {loading ? (
        <div className="text-sm text-hearth-muted">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-sm text-hearth-muted">No events today</div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-3 rounded-lg border-l-4 bg-hearth-surface p-3" style={{ borderColor: e.color }}>
              <div className="w-20 shrink-0 text-sm tabular-nums text-hearth-muted">
                {e.allDay ? "All day" : format(new Date(e.startAt), "h:mm a")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{e.title}</div>
                {e.location && <div className="text-xs text-hearth-muted">{e.location}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                {e.familyMembers.map((m) => (
                  <Badge key={m.id} label={m.name} color={m.color} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
