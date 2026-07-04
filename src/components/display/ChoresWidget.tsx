"use client";

import { useState } from "react";
import { useInterval } from "@/lib/hooks/useInterval";
import { FamilyMemberAvatar } from "@/components/display/FamilyMemberAvatar";

interface ChoreDTO {
  id: string;
  title: string;
  points: number;
  dueDate: string | null;
  familyMember: { id: string; name: string; color: string; initials: string | null; avatarUrl: string | null };
}

const REFRESH_MS = 60 * 1000;

export function ChoresWidget({ householdId }: { householdId: string }) {
  const [chores, setChores] = useState<ChoreDTO[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);

  useInterval(async () => {
    const res = await fetch(`/api/chores?householdId=${householdId}`);
    if (res.ok) {
      const json = await res.json();
      setChores(json.chores);
    }
  }, REFRESH_MS);

  async function complete(choreId: string) {
    setCompletingId(choreId);
    setChores((prev) => prev.filter((c) => c.id !== choreId)); // optimistic: one-off chores disappear immediately
    try {
      await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId, complete: true }),
      });
    } finally {
      setCompletingId(null);
    }
  }

  if (chores.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-hearth-muted">All chores done! 🎉</div>;
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto">
      {chores.map((chore) => (
        <button
          key={chore.id}
          onClick={() => complete(chore.id)}
          disabled={completingId === chore.id}
          className="flex w-full items-center gap-3 rounded-xl bg-hearth-surface px-3 py-3 text-left transition active:scale-[0.98] disabled:opacity-50"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-hearth-border" />
          <FamilyMemberAvatar
            name={chore.familyMember.name}
            color={chore.familyMember.color}
            initials={chore.familyMember.initials ?? "?"}
            avatarUrl={chore.familyMember.avatarUrl}
            size={28}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{chore.title}</span>
          {chore.points > 0 && <span className="shrink-0 text-xs font-semibold text-hearth-accent">+{chore.points} pts</span>}
        </button>
      ))}
    </div>
  );
}
