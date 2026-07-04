"use client";

import { useEffect, useRef, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface Photo {
  id: string;
  url: string;
}

export default function PhotosPage() {
  const { householdId } = useHousehold();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/photos?householdId=${householdId}`);
    if (res.ok) setPhotos((await res.json()).photos);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("householdId", householdId);
      form.set("file", file);
      const res = await fetch("/api/photos", { method: "POST", body: form });
      if (!res.ok) setError((await res.json()).error ?? "Upload failed");
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/photos/${id}?householdId=${householdId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Photos & Backgrounds</h1>
        <p className="text-sm text-hearth-muted">Uploaded photos crossfade behind the display. Google Photos sync is coming in a later phase.</p>
      </div>

      <Card>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">Upload photos</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => upload(e.target.files)}
            disabled={uploading}
          />
        </label>
        {uploading && <p className="mt-2 text-sm text-hearth-muted">Uploading…</p>}
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo) => (
          <div key={photo.id} className="group relative aspect-video overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="" className="h-full w-full object-cover" />
            <Button
              variant="danger"
              size="sm"
              className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100"
              onClick={() => remove(photo.id)}
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
