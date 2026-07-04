"use client";

import { useState } from "react";
import { useInterval } from "@/lib/hooks/useInterval";

interface NoteDTO {
  id: string;
  body: string;
  color: string;
  authorName: string | null;
  pinned: boolean;
}

const REFRESH_MS = 2 * 60 * 1000;

export function NotesWidget({ householdId }: { householdId: string }) {
  const [notes, setNotes] = useState<NoteDTO[]>([]);

  useInterval(async () => {
    const res = await fetch(`/api/notes?householdId=${householdId}`);
    if (res.ok) setNotes((await res.json()).notes);
  }, REFRESH_MS);

  if (notes.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-hearth-muted">No announcements</div>;
  }

  return (
    <div className="grid h-full auto-rows-min grid-cols-2 gap-2 overflow-y-auto">
      {notes.map((note) => (
        <div
          key={note.id}
          className="rounded-lg p-3 text-sm shadow-sm"
          style={{ backgroundColor: note.color, color: "#1a1a1a" }}
        >
          <p className="whitespace-pre-wrap">{note.body}</p>
          {note.authorName && <p className="mt-2 text-xs opacity-70">— {note.authorName}</p>}
        </div>
      ))}
    </div>
  );
}
