"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ClockWidget } from "@/components/display/ClockWidget";
import { WeatherWidget } from "@/components/display/WeatherWidget";
import { CalendarMonthView } from "@/components/display/CalendarMonthView";
import { CalendarWeekView } from "@/components/display/CalendarWeekView";
import { CalendarDayAgenda } from "@/components/display/CalendarDayAgenda";
import { CalendarListView } from "@/components/display/CalendarListView";
import { ChoresWidget } from "@/components/display/ChoresWidget";
import { MealPlanWidget } from "@/components/display/MealPlanWidget";
import { NotesWidget } from "@/components/display/NotesWidget";
import type { LayoutWidgetDTO } from "@/types";

const WIDGET_TITLES: Record<LayoutWidgetDTO["type"], string> = {
  CLOCK: "",
  WEATHER: "Weather",
  CALENDAR_MONTH: "Calendar",
  CALENDAR_WEEK: "This Week",
  CALENDAR_AGENDA: "Today",
  CALENDAR_LIST: "Agenda",
  CHORES: "Chores",
  MEAL_PLAN: "Meal Plan",
  NOTES: "Notes",
  PHOTOS: "",
};

function renderWidgetBody(widget: LayoutWidgetDTO, householdId: string, timezone: string) {
  const familyMemberIds = widget.config?.familyMemberIds;
  switch (widget.type) {
    case "CLOCK":
      return <ClockWidget timezone={timezone} />;
    case "WEATHER":
      return <WeatherWidget householdId={householdId} />;
    case "CALENDAR_MONTH":
      return <CalendarMonthView householdId={householdId} familyMemberIds={familyMemberIds} />;
    case "CALENDAR_WEEK":
      return <CalendarWeekView householdId={householdId} familyMemberIds={familyMemberIds} />;
    case "CALENDAR_AGENDA":
      return <CalendarDayAgenda householdId={householdId} familyMemberIds={familyMemberIds} />;
    case "CALENDAR_LIST":
      return <CalendarListView householdId={householdId} familyMemberIds={familyMemberIds} />;
    case "CHORES":
      return <ChoresWidget householdId={householdId} />;
    case "MEAL_PLAN":
      return <MealPlanWidget householdId={householdId} />;
    case "NOTES":
      return <NotesWidget householdId={householdId} />;
    case "PHOTOS":
      return null; // rendered as a full-bleed background by the page, not a grid cell
    default:
      return null;
  }
}

/** Renders a Layout's Widgets on a CSS grid — the runtime for every preset in docs/WIREFRAMES.md. */
export function DisplayGrid({
  widgets,
  columns,
  rows,
  householdId,
  timezone,
}: {
  widgets: LayoutWidgetDTO[];
  columns: number;
  rows: number;
  householdId: string;
  timezone: string;
}) {
  const gridWidgets = widgets.filter((w) => w.isEnabled && w.type !== "PHOTOS");

  return (
    <div
      className="grid h-full w-full gap-4 p-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {gridWidgets.map((widget) => (
        <div
          key={widget.id}
          style={{
            gridColumn: `${widget.x + 1} / span ${widget.w}`,
            gridRow: `${widget.y + 1} / span ${widget.h}`,
          }}
        >
          {widget.type === "CLOCK" ? (
            <div className="h-full">{renderWidgetBody(widget, householdId, timezone)}</div>
          ) : (
            <Card className="h-full overflow-hidden">
              {WIDGET_TITLES[widget.type] && (
                <CardHeader>
                  <CardTitle>{WIDGET_TITLES[widget.type]}</CardTitle>
                </CardHeader>
              )}
              <div className="h-[calc(100%-2rem)]">{renderWidgetBody(widget, householdId, timezone)}</div>
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}
