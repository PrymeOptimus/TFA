"use client";

import { useEffect, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ACCENT_PALETTE } from "@/lib/colors";

interface Connection {
  id: string;
  provider: "GOOGLE" | "MICROSOFT" | "APPLE";
  providerAccountEmail: string | null;
  displayName: string | null;
  color: string | null;
  familyMemberId: string | null;
  status: "CONNECTED" | "NEEDS_REAUTH" | "ERROR" | "DISABLED";
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface FamilyMember {
  id: string;
  name: string;
  color: string;
}

export default function CalendarSettingsPage() {
  const { householdId } = useHousehold();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const [connRes, famRes] = await Promise.all([
      fetch(`/api/calendar/connections?householdId=${householdId}`),
      fetch(`/api/family?householdId=${householdId}`),
    ]);
    if (connRes.ok) setConnections((await connRes.json()).connections);
    if (famRes.ok) setFamilyMembers((await famRes.json()).familyMembers);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function syncNow() {
    setSyncing(true);
    await fetch("/api/calendar/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId }),
    });
    await load();
    setSyncing(false);
  }

  async function assign(connectionId: string, familyMemberId: string) {
    await fetch("/api/calendar/connections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, id: connectionId, familyMemberId: familyMemberId || null }),
    });
    load();
  }

  async function setColor(connectionId: string, color: string) {
    await fetch("/api/calendar/connections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, id: connectionId, color }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Calendar</h1>
          <p className="text-sm text-hearth-muted">Google Calendar syncs automatically. Microsoft Outlook and Apple Calendar are coming in a later phase.</p>
        </div>
        <Button onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      <div className="space-y-4">
        {connections.length === 0 && (
          <Card>
            <p className="text-sm text-hearth-muted">
              No calendar connected yet. Your Google account is connected automatically the first time you sign in — try signing out and back in if you don&apos;t see it here.
            </p>
          </Card>
        )}
        {connections.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.displayName ?? c.providerAccountEmail ?? c.provider}</CardTitle>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  c.status === "CONNECTED" ? "bg-emerald-500/20 text-emerald-600" : "bg-red-500/20 text-red-600"
                }`}
              >
                {c.status}
              </span>
            </CardHeader>
            {c.lastError && <p className="mb-2 text-xs text-red-500">{c.lastError}</p>}
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-hearth-muted">Family member</label>
                <select
                  value={c.familyMemberId ?? ""}
                  onChange={(e) => assign(c.id, e.target.value)}
                  className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-1.5 text-sm"
                >
                  <option value="">Unassigned</option>
                  {familyMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-hearth-muted">Color override</label>
                <div className="flex gap-1">
                  {ACCENT_PALETTE.map((color) => (
                    <button
                      key={color}
                      onClick={() => setColor(c.id, color)}
                      className="h-6 w-6 rounded-full"
                      style={{ backgroundColor: color, boxShadow: c.color === color ? `0 0 0 2px ${color}` : undefined }}
                    />
                  ))}
                </div>
              </div>
              <div className="text-xs text-hearth-muted">
                {c.lastSyncedAt ? `Last synced ${new Date(c.lastSyncedAt).toLocaleString()}` : "Never synced"}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
