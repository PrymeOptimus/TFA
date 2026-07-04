"use client";

import { useEffect, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { ACCENT_PALETTE } from "@/lib/colors";

const NOTE_COLORS = ["#FDE68A", "#BFDBFE", "#FBCFE8", "#BBF7D0", "#FED7AA"];

interface Note {
  id: string;
  body: string;
  color: string;
  pinned: boolean;
}

export default function NotesPage() {
  const { householdId } = useHousehold();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [color, setColor] = useState(NOTE_COLORS[0]);
  const [pinned, setPinned] = useState(false);

  async function load() {
    const res = await fetch(`/api/notes?householdId=${householdId}`);
    if (res.ok) setNotes((await res.json()).notes);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, body, color, pinned }),
    });
    setBody("");
    setPinned(false);
    load();
  }

  async function removeNote(id: string) {
    await fetch(`/api/notes/${id}?householdId=${householdId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Notes & Announcements</h1>
        <p className="text-sm text-hearth-muted">Sticky notes shown on the display for the whole family.</p>
      </div>

      <Card>
        <form onSubmit={addNote} className="space-y-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Don't forget picture day is Friday!"
            rows={3}
            className="w-full rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1">
              {NOTE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${ACCENT_PALETTE[0]}` : undefined }}
                />
              ))}
            </div>
            <Toggle checked={pinned} onChange={setPinned} label="Pin to top" />
            <Button type="submit">Post note</Button>
          </div>
        </form>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {notes.map((note) => (
          <div key={note.id} className="rounded-xl p-4 shadow-card" style={{ backgroundColor: note.color, color: "#1a1a1a" }}>
            <p className="whitespace-pre-wrap text-sm">{note.body}</p>
            <div className="mt-3 flex items-center justify-between">
              {note.pinned && <span className="text-xs font-semibold">📌 Pinned</span>}
              <button onClick={() => removeNote(note.id)} className="ml-auto text-xs underline">
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
