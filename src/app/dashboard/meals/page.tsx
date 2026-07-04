"use client";

import { Fragment, useEffect, useState } from "react";
import { startOfWeek } from "date-fns";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOTS = ["BREAKFAST", "LUNCH", "DINNER"] as const;

interface MealEntry {
  id: string;
  dayOfWeek: number;
  slot: (typeof SLOTS)[number];
  title: string;
}
interface GroceryItem {
  id: string;
  label: string;
  isChecked: boolean;
}

export default function MealsPage() {
  const { householdId } = useHousehold();
  const [planId, setPlanId] = useState<string | null>(null);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [newItem, setNewItem] = useState("");

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  async function load() {
    const res = await fetch(`/api/meals?householdId=${householdId}&weekStart=${weekStart.toISOString()}`);
    if (res.ok) {
      const json = await res.json();
      setPlanId(json.mealPlan.id);
      setEntries(json.mealPlan.entries);
      setGrocery(json.mealPlan.groceryItems);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function setEntry(dayOfWeek: number, slot: (typeof SLOTS)[number], title: string) {
    if (!planId) return;
    await fetch(`/api/meals/${planId}/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, dayOfWeek, slot, title }),
    });
    load();
  }

  async function addGroceryItem(e: React.FormEvent) {
    e.preventDefault();
    if (!planId || !newItem.trim()) return;
    await fetch(`/api/meals/${planId}/grocery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, label: newItem }),
    });
    setNewItem("");
    load();
  }

  async function toggleGrocery(item: GroceryItem) {
    if (!planId) return;
    await fetch(`/api/meals/${planId}/grocery/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, isChecked: !item.isChecked }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Meal Plan</h1>
        <p className="text-sm text-hearth-muted">Plan the week&apos;s breakfast, lunch, and dinner.</p>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[900px] grid-cols-8 gap-2">
          <div />
          {DAYS.map((d) => (
            <div key={d} className="text-center text-sm font-semibold text-hearth-muted">
              {d}
            </div>
          ))}
          {SLOTS.map((slot) => (
            <Fragment key={slot}>
              <div className="flex items-center text-sm font-medium capitalize">{slot.toLowerCase()}</div>
              {DAYS.map((_, dayOfWeek) => {
                const entry = entries.find((e) => e.dayOfWeek === dayOfWeek && e.slot === slot);
                return (
                  <Input
                    key={`${slot}-${dayOfWeek}`}
                    defaultValue={entry?.title ?? ""}
                    placeholder="—"
                    onBlur={(e) => {
                      if (e.target.value !== (entry?.title ?? "")) setEntry(dayOfWeek, slot, e.target.value);
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Grocery list</CardTitle>
        </CardHeader>
        <form onSubmit={addGroceryItem} className="mb-3 flex gap-2">
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item…" />
          <Button type="submit">Add</Button>
        </form>
        <ul className="space-y-1">
          {grocery.map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={item.isChecked} onChange={() => toggleGrocery(item)} />
                <span className={item.isChecked ? "text-hearth-muted line-through" : ""}>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
