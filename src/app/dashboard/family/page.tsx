"use client";

import { useEffect, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { FamilyMemberAvatar } from "@/components/display/FamilyMemberAvatar";
import { ACCENT_PALETTE } from "@/lib/colors";

interface FamilyMember {
  id: string;
  name: string;
  color: string;
  initials: string | null;
  avatarUrl: string | null;
  isChild: boolean;
}

export default function FamilyPage() {
  const { householdId } = useHousehold();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(ACCENT_PALETTE[0]);
  const [isChild, setIsChild] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/api/family?householdId=${householdId}`);
    if (res.ok) setMembers((await res.json()).familyMembers);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, name, color, isChild }),
    });
    setName("");
    setIsChild(false);
    load();
  }

  async function removeMember(id: string) {
    await fetch(`/api/family/${id}?householdId=${householdId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Family Members</h1>
        <p className="text-sm text-hearth-muted">Add everyone in the household so calendars and chores can be color-coded per person.</p>
      </div>

      <Card>
        <form onSubmit={addMember} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Color</label>
            <div className="flex gap-1">
              {ACCENT_PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className="h-8 w-8 rounded-full ring-offset-2"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <Toggle checked={isChild} onChange={setIsChild} label="Child profile" />
          <Button type="submit">Add member</Button>
        </form>
      </Card>

      {loading ? (
        <p className="text-sm text-hearth-muted">Loading…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <Card key={m.id} className="flex items-center gap-3">
              <FamilyMemberAvatar name={m.name} color={m.color} initials={m.initials ?? "?"} avatarUrl={m.avatarUrl} size={48} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name}</div>
                {m.isChild && <div className="text-xs text-hearth-muted">Child</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeMember(m.id)}>
                Remove
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
