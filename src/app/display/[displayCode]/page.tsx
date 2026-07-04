"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { DisplayGrid } from "@/components/display/DisplayGrid";
import { PhotoBackground } from "@/components/display/PhotoBackground";
import type { DisplayBootstrapDTO } from "@/types";

const POLL_MS = 60 * 1000; // picks up admin changes (layout swap, re-theme) without a manual reload

function hexToRgbTriplet(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export default function DisplayPage() {
  const params = useParams<{ displayCode: string }>();
  const [data, setData] = useState<DisplayBootstrapDTO | { unclaimed: true; pairingCode: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/displays/bootstrap?code=${params.displayCode}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "This display could not be found.");
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong");
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [params.displayCode]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-lg">{error}</p>
      </div>
    );
  }

  if (!data) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-white">Loading…</div>;
  }

  if ("unclaimed" in data) {
    return (
      <div className="kiosk flex min-h-screen flex-col items-center justify-center gap-6 bg-black text-white">
        <h1 className="font-display text-3xl font-bold">Welcome to Hearth</h1>
        <p className="text-hearth-muted">Enter this code in Dashboard → Displays to pair this screen:</p>
        <div className="rounded-2xl bg-white/10 px-10 py-6 font-mono text-6xl font-bold tracking-[0.3em]">
          {data.pairingCode}
        </div>
      </div>
    );
  }

  const isDark = data.display.theme === "dark" || (data.display.theme === "auto" && new Date().getHours() >= 19);

  return (
    <div
      className={`kiosk min-h-screen w-screen overflow-hidden ${isDark ? "dark" : ""}`}
      style={
        {
          "--hearth-accent": hexToRgbTriplet(data.display.accentColor),
        } as CSSProperties
      }
    >
      {data.layout?.background === "photos" && <PhotoBackground householdId={data.household.id} />}
      <DisplayGrid
        widgets={data.widgets}
        columns={data.layout?.columns ?? 12}
        rows={data.layout?.rows ?? 8}
        householdId={data.household.id}
        timezone={data.household.timezone}
      />
    </div>
  );
}
