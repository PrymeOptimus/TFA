"use client";

import { useEffect, useState } from "react";

interface PhotoDTO {
  id: string;
  url: string;
}

const SLIDE_MS = 30 * 1000;
const REFRESH_LIST_MS = 10 * 60 * 1000;

/**
 * Full-bleed crossfading background slideshow with a dark overlay so
 * foreground widget text stays readable regardless of photo content.
 */
export function PhotoBackground({ householdId, overlayOpacity = 0.55 }: { householdId: string; overlayOpacity?: number }) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/photos?householdId=${householdId}`);
      if (!cancelled && res.ok) setPhotos((await res.json()).photos);
    }
    load();
    const id = setInterval(load, REFRESH_LIST_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [householdId]);

  useEffect(() => {
    if (photos.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % photos.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [photos.length]);

  if (photos.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-[2000ms]"
          style={{ backgroundImage: `url(${photo.url})`, opacity: i === index ? 1 : 0 }}
        />
      ))}
      <div className="absolute inset-0 bg-black" style={{ opacity: overlayOpacity }} />
    </div>
  );
}
