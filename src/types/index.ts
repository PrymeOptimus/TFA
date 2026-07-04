import type { WidgetType } from "@prisma/client";

/** Flattened, display-friendly shape of a CalendarEventCache + its attendees. */
export interface AgendaEvent {
  id: string;
  title: string;
  location: string | null;
  startAt: string; // ISO
  endAt: string; // ISO
  allDay: boolean;
  category: string | null;
  color: string;
  familyMembers: { id: string; name: string; color: string; initials: string }[];
}

export interface WidgetConfig {
  familyMemberIds?: string[];
  calendarView?: "month" | "week" | "agenda" | "list";
  showWeather?: boolean;
  maxItems?: number;
}

export interface LayoutWidgetDTO {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig | null;
  isEnabled: boolean;
}

export interface DisplayBootstrapDTO {
  display: {
    id: string;
    name: string;
    displayCode: string;
    orientation: "landscape" | "portrait";
    theme: "dark" | "light" | "auto";
    accentColor: string;
  };
  household: { id: string; name: string; timezone: string };
  layout: { id: string; name: string; columns: number; rows: number; background: string | null } | null;
  widgets: LayoutWidgetDTO[];
  familyMembers: { id: string; name: string; color: string; initials: string; avatarUrl: string | null }[];
}
