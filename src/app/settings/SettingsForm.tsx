"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function SettingsForm({
  householdId,
  householdName,
  timezone,
  locationName,
  units,
  userEmail,
}: {
  householdId: string;
  householdName: string;
  timezone: string;
  locationName: string;
  units: string;
  userEmail: string;
}) {
  const [name, setName] = useState(householdName);
  const [tz, setTz] = useState(timezone);
  const [location, setLocation] = useState(locationName);
  const [unitPref, setUnitPref] = useState(units);
  const [status, setStatus] = useState<string | null>(null);

  async function saveHousehold(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/household", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, name, timezone: tz }),
    });
    setStatus("Household settings saved.");
  }

  async function saveWeather(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/weather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, locationName: location, units: unitPref }),
    });
    setStatus(res.ok ? "Weather location saved." : "Could not find that location.");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <p className="mb-3 text-sm text-hearth-muted">Signed in as {userEmail}</p>
        <Button variant="secondary" onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </Button>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
        </CardHeader>
        <form onSubmit={saveHousehold} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Household name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Timezone</label>
            <select value={tz} onChange={(e) => setTz(e.target.value)} className="w-full rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm">
              {TIMEZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Save household</Button>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weather location</CardTitle>
        </CardHeader>
        <form onSubmit={saveWeather} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Location</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Austin, TX" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Units</label>
            <select value={unitPref} onChange={(e) => setUnitPref(e.target.value)} className="w-full rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm">
              <option value="imperial">Fahrenheit</option>
              <option value="metric">Celsius</option>
            </select>
          </div>
          <Button type="submit">Save location</Button>
        </form>
      </Card>

      {status && <p className="text-sm text-hearth-accent">{status}</p>}
    </div>
  );
}
