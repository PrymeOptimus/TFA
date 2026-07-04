"use client";

import { useState } from "react";
import { startOfWeek } from "date-fns";
import { useInterval } from "@/lib/hooks/useInterval";

interface MealEntryDTO {
  dayOfWeek: number;
  slot: "BREAKFAST" | "LUNCH" | "DINNER";
  title: string;
  imageUrl: string | null;
}

const SLOT_LABEL: Record<MealEntryDTO["slot"], string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

const REFRESH_MS = 10 * 60 * 1000;

export function MealPlanWidget({ householdId }: { householdId: string }) {
  const [entries, setEntries] = useState<MealEntryDTO[]>([]);
  const todayIndex = new Date().getDay();

  useInterval(async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
    const res = await fetch(`/api/meals?householdId=${householdId}&weekStart=${encodeURIComponent(weekStart)}`);
    if (res.ok) {
      const json = await res.json();
      setEntries(json.mealPlan.entries);
    }
  }, REFRESH_MS);

  const todayEntries = entries.filter((e) => e.dayOfWeek === todayIndex);

  return (
    <div className="h-full space-y-2 overflow-y-auto">
      {(["BREAKFAST", "LUNCH", "DINNER"] as const).map((slot) => {
        const entry = todayEntries.find((e) => e.slot === slot);
        return (
          <div key={slot} className="flex items-center gap-3 rounded-lg bg-hearth-surface p-2">
            {entry?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-hearth-border/40 text-lg">🍽️</div>
            )}
            <div className="min-w-0">
              <div className="text-xs text-hearth-muted">{SLOT_LABEL[slot]}</div>
              <div className="truncate font-medium">{entry?.title ?? "Not planned"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
