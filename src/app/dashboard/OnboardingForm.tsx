"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
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

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, timezone }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create household");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-hearth-bg px-6">
      <Card className="w-full max-w-md">
        <h1 className="font-display text-2xl font-bold">Welcome to Hearth</h1>
        <p className="mt-1 text-sm text-hearth-muted">Let&apos;s set up your household first.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Household name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Aiken Family" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating…" : "Create household"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
