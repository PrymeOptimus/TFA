"use client";

import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { useAgendaEvents } from "@/lib/hooks/useAgendaEvents";

const MAX_CHIPS_PER_DAY = 3;

export function CalendarMonthView({
  householdId,
  anchorDate = new Date(),
  familyMemberIds,
}: {
  householdId: string;
  anchorDate?: Date;
  familyMemberIds?: string[];
}) {
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const { events, loading } = useAgendaEvents(householdId, gridStart, gridEnd, familyMemberIds);

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const today = new Date();

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 font-display text-lg font-semibold">{format(anchorDate, "MMMM yyyy")}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-hearth-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="pb-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-1">
        {days.map((day) => {
          const dayEvents = events.filter((e) => isSameDay(new Date(e.startAt), day));
          const inMonth = isSameMonth(day, anchorDate);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`flex flex-col rounded-md p-1 ${inMonth ? "bg-hearth-surface" : "bg-transparent opacity-40"} ${isToday ? "ring-2 ring-hearth-accent" : ""}`}
            >
              <div className="text-right text-xs font-medium">{format(day, "d")}</div>
              <div className="mt-0.5 flex-1 space-y-0.5 overflow-hidden">
                {!loading &&
                  dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((e) => (
                    <div key={e.id} className="truncate rounded px-1 text-[10px] font-medium text-white" style={{ backgroundColor: e.color }}>
                      {e.title}
                    </div>
                  ))}
                {dayEvents.length > MAX_CHIPS_PER_DAY && (
                  <div className="text-[10px] text-hearth-muted">+{dayEvents.length - MAX_CHIPS_PER_DAY} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
