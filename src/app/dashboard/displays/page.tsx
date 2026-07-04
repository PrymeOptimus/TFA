"use client";

import { useEffect, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface Display {
  id: string;
  name: string;
  displayCode: string;
  orientation: "landscape" | "portrait";
  theme: "dark" | "light" | "auto";
  accentColor: string;
  layoutId: string | null;
  lastSeenAt: string | null;
}
interface Layout {
  id: string;
  name: string;
}

export default function DisplaysPage() {
  const { householdId } = useHousehold();
  const [displays, setDisplays] = useState<Display[]>([]);
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const [pairName, setPairName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [dRes, lRes] = await Promise.all([
      fetch(`/api/displays?householdId=${householdId}`),
      fetch(`/api/layouts?householdId=${householdId}`),
    ]);
    if (dRes.ok) setDisplays((await dRes.json()).displays);
    if (lRes.ok) setLayouts((await lRes.json()).layouts);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/displays/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, pairingCode, name: pairName || "New Display" }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Could not pair display");
      return;
    }
    setPairingCode("");
    setPairName("");
    load();
  }

  async function update(id: string, data: Partial<Display>) {
    await fetch(`/api/displays/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, ...data }),
    });
    load();
  }

  async function unpair(id: string) {
    await fetch(`/api/displays/${id}?householdId=${householdId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Displays</h1>
        <p className="text-sm text-hearth-muted">
          Open <code>/display</code> on any TV, tablet, or browser to get a 6-digit pairing code, then enter it here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pair a new display</CardTitle>
        </CardHeader>
        <form onSubmit={pair} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Pairing code</label>
            <Input value={pairingCode} onChange={(e) => setPairingCode(e.target.value)} placeholder="123456" maxLength={6} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input value={pairName} onChange={(e) => setPairName(e.target.value)} placeholder="Kitchen TV" />
          </div>
          <Button type="submit">Pair</Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </Card>

      <div className="space-y-3">
        {displays.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle>{d.name}</CardTitle>
              <Button variant="danger" size="sm" onClick={() => unpair(d.id)}>
                Unpair
              </Button>
            </CardHeader>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-hearth-muted">Layout</label>
                <select
                  value={d.layoutId ?? ""}
                  onChange={(e) => update(d.id, { layoutId: e.target.value || null })}
                  className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {layouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-hearth-muted">Orientation</label>
                <select
                  value={d.orientation}
                  onChange={(e) => update(d.id, { orientation: e.target.value as Display["orientation"] })}
                  className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-1.5 text-sm"
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-hearth-muted">Theme</label>
                <select
                  value={d.theme}
                  onChange={(e) => update(d.id, { theme: e.target.value as Display["theme"] })}
                  className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-1.5 text-sm"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <div className="text-xs text-hearth-muted">
                {d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "Not seen yet"}
              </div>
            </div>
          </Card>
        ))}
        {displays.length === 0 && <p className="text-sm text-hearth-muted">No displays paired yet.</p>}
      </div>
    </div>
  );
}
