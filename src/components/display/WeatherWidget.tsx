"use client";

import { useState } from "react";
import { useInterval } from "@/lib/hooks/useInterval";
import type { WeatherResult } from "@/lib/weather";

const REFRESH_MS = 15 * 60 * 1000; // weather doesn't need second-by-second polling

const ICON_EMOJI: Record<string, string> = {
  "01": "☀️",
  "02": "⛅",
  "03": "☁️",
  "04": "☁️",
  "09": "🌧️",
  "10": "🌦️",
  "11": "⛈️",
  "13": "❄️",
  "50": "🌫️",
};

function emojiFor(icon: string): string {
  return ICON_EMOJI[icon.slice(0, 2)] ?? "🌡️";
}

export function WeatherWidget({ householdId }: { householdId: string }) {
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [locationName, setLocationName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useInterval(async () => {
    try {
      const res = await fetch(`/api/weather?householdId=${householdId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Weather unavailable");
      setWeather(json.weather);
      setLocationName(json.locationName);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Weather unavailable");
    }
  }, REFRESH_MS);

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-hearth-muted">{error}</div>;
  }
  if (!weather) {
    return <div className="flex h-full items-center justify-center text-sm text-hearth-muted">Loading weather…</div>;
  }

  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-center gap-4">
        <div className="text-[clamp(2.5rem,6vw,4rem)] leading-none">{emojiFor(weather.current.icon)}</div>
        <div>
          <div className="font-display text-[clamp(2rem,5vw,3.5rem)] font-bold leading-none">{weather.current.tempF}°</div>
          <div className="text-sm text-hearth-muted">
            {weather.current.condition} · {locationName}
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {weather.daily.map((d) => (
          <div key={d.date} className="flex flex-col items-center gap-1 rounded-lg bg-hearth-surface px-2 py-2 text-center">
            <span className="text-xs text-hearth-muted">
              {new Date(d.date).toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="text-lg">{emojiFor(d.icon)}</span>
            <span className="text-xs">
              <span className="font-semibold">{d.highF}°</span> <span className="text-hearth-muted">{d.lowF}°</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
