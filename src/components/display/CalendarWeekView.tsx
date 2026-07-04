"use client";

import { addDays, endOfWeek, format, isSameDay, startOfWeek } from "date-fns";
import { useAgendaEvents } from "@/lib/hooks/useAgendaEvents";

export function CalendarWeekView({
  householdId,
  anchorDate = new Date(),
  familyMemberIds,
}: {
  householdId: string;
  anchorDate?: Date;
  familyMemberIds?: string[];
}) {
  const weekStart = startOfWeek(anchorDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(anchorDate, { weekStartsOn: 0 });
  const { events, loading } = useAgendaEvents(householdId, weekStart, weekEnd, familyMemberIds);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  return (
    <div className="grid h-full grid-cols-7 gap-2">
      {days.map((day) => {
        const dayEvents = events.filter((e) => isSameDay(new Date(e.startAt), day));
        const isToday = isSameDay(day, today);
        return (
          <div key={day.toISOString()} className={`flex flex-col rounded-lg p-2 ${isToday ? "bg-hearth-accent/10 ring-1 ring-hearth-accent" : "bg-hearth-surface"}`}>
            <div className="mb-1 text-center">
              <div className="text-xs text-hearth-muted">{format(day, "EEE")}</div>
              <div className="font-display text-lg font-semibold">{format(day, "d")}</div>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {loading ? (
                <div className="text-xs text-hearth-muted">…</div>
              ) : (
                dayEvents.map((e) => (
                  <div
                    key={e.id}
                    className="truncate rounded px-1.5 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: e.color }}
                    title={e.title}
                  >
                    {!e.allDay && <span className="opacity-80">{format(new Date(e.startAt), "h:mma ")}</span>}
                    {e.title}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
