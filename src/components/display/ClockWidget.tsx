"use client";

import { useEffect, useState } from "react";

function greeting(hour: number): string {
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export function ClockWidget({ timezone, showGreeting = true }: { timezone: string; showGreeting?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(now);

  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(now);

  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(now),
  );

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="font-display text-[clamp(2.5rem,8vw,6rem)] font-bold leading-none tabular-nums">{time}</div>
      <div className="mt-2 text-[clamp(1rem,2.5vw,1.5rem)] text-hearth-muted">{date}</div>
      {showGreeting && <div className="mt-1 text-[clamp(0.9rem,2vw,1.15rem)] text-hearth-accent">{greeting(hour)}</div>}
    </div>
  );
}
