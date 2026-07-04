"use client";

import { useEffect, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";

const WIDGET_TYPES = [
  "CLOCK",
  "WEATHER",
  "CALENDAR_MONTH",
  "CALENDAR_WEEK",
  "CALENDAR_AGENDA",
  "CALENDAR_LIST",
  "CHORES",
  "MEAL_PLAN",
  "NOTES",
  "PHOTOS",
] as const;

interface Widget {
  id: string;
  type: (typeof WIDGET_TYPES)[number];
  x: number;
  y: number;
  w: number;
  h: number;
  isEnabled: boolean;
}
interface Layout {
  id: string;
  name: string;
  isPreset: boolean;
  columns: number;
  rows: number;
  widgets: Widget[];
}

/**
 * Grid-coordinate layout builder. Widgets are positioned with numeric
 * x/y/w/h fields against the layout's column/row grid rather than
 * freeform drag-and-drop — a true pointer-drag canvas is a natural
 * Phase 3 upgrade (see docs/IMPLEMENTATION_PLAN.md) that can swap in on
 * top of the same PATCH /api/widgets contract used here.
 */
export default function WidgetsPage() {
  const { householdId } = useHousehold();
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null);
  const [newWidgetType, setNewWidgetType] = useState<Widget["type"]>("CLOCK");

  async function load() {
    const res = await fetch(`/api/layouts?householdId=${householdId}`);
    if (res.ok) {
      const json = await res.json();
      setLayouts(json.layouts);
      if (!activeLayoutId && json.layouts[0]) setActiveLayoutId(json.layouts[0].id);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const activeLayout = layouts.find((l) => l.id === activeLayoutId) ?? null;

  async function addWidget() {
    if (!activeLayout) return;
    await fetch("/api/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, layoutId: activeLayout.id, type: newWidgetType, x: 0, y: 0, w: 4, h: 4 }),
    });
    load();
  }

  async function updateWidget(id: string, data: Partial<Pick<Widget, "x" | "y" | "w" | "h" | "isEnabled">>) {
    await fetch("/api/widgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, id, ...data }),
    });
    load();
  }

  async function removeWidget(id: string) {
    await fetch(`/api/widgets?householdId=${householdId}&id=${id}`, { method: "DELETE" });
    load();
  }

  async function createLayout() {
    const name = prompt("Layout name?");
    if (!name) return;
    await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, name }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Layouts & Widgets</h1>
          <p className="text-sm text-hearth-muted">Choose a preset or build your own — enable widgets and position them on the grid.</p>
        </div>
        <Button onClick={createLayout}>New layout</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {layouts.map((l) => (
          <button
            key={l.id}
            onClick={() => setActiveLayoutId(l.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              l.id === activeLayoutId ? "bg-hearth-accent text-white" : "bg-hearth-surface text-hearth-text"
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>

      {activeLayout && (
        <Card>
          <CardHeader>
            <CardTitle>
              {activeLayout.name} · {activeLayout.columns}×{activeLayout.rows} grid
            </CardTitle>
          </CardHeader>

          <div className="mb-4 flex items-end gap-3">
            <select
              value={newWidgetType}
              onChange={(e) => setNewWidgetType(e.target.value as Widget["type"])}
              className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm"
            >
              {WIDGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <Button onClick={addWidget} size="sm">
              Add widget
            </Button>
          </div>

          <div className="space-y-2">
            {activeLayout.widgets.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-hearth-surface p-3">
                <span className="w-36 font-medium">{w.type.replaceAll("_", " ")}</span>
                <label className="text-xs text-hearth-muted">
                  x <Input type="number" value={w.x} onChange={(e) => updateWidget(w.id, { x: Number(e.target.value) })} className="w-16" />
                </label>
                <label className="text-xs text-hearth-muted">
                  y <Input type="number" value={w.y} onChange={(e) => updateWidget(w.id, { y: Number(e.target.value) })} className="w-16" />
                </label>
                <label className="text-xs text-hearth-muted">
                  w <Input type="number" value={w.w} onChange={(e) => updateWidget(w.id, { w: Number(e.target.value) })} className="w-16" />
                </label>
                <label className="text-xs text-hearth-muted">
                  h <Input type="number" value={w.h} onChange={(e) => updateWidget(w.id, { h: Number(e.target.value) })} className="w-16" />
                </label>
                <Toggle checked={w.isEnabled} onChange={(v) => updateWidget(w.id, { isEnabled: v })} label="Enabled" />
                <Button variant="ghost" size="sm" onClick={() => removeWidget(w.id)}>
                  Remove
                </Button>
              </div>
            ))}
            {activeLayout.widgets.length === 0 && <p className="text-sm text-hearth-muted">No widgets yet — add one above.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
