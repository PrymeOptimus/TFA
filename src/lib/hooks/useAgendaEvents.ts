"use client";

import { useCallback, useState } from "react";
import { useInterval } from "@/lib/hooks/useInterval";
import type { AgendaEvent } from "@/types";

const REFRESH_MS = 5 * 60 * 1000; // "Auto-refresh calendar data"

export function useAgendaEvents(householdId: string, start: Date, end: Date, familyMemberIds?: string[]) {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      householdId,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    (familyMemberIds ?? []).forEach((id) => params.append("familyMemberId", id));

    try {
      const res = await fetch(`/api/calendar/events?${params.toString()}`);
      const json = await res.json();
      if (res.ok) setEvents(json.events);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, start.getTime(), end.getTime(), JSON.stringify(familyMemberIds)]);

  useInterval(load, REFRESH_MS);

  return { events, loading, refresh: load };
}
