"use client";

import { useEffect, useState } from "react";
import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FamilyMemberAvatar } from "@/components/display/FamilyMemberAvatar";

interface FamilyMember {
  id: string;
  name: string;
  color: string;
  initials: string | null;
  avatarUrl: string | null;
}
interface Chore {
  id: string;
  title: string;
  points: number;
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  dueDate: string | null;
  familyMember: FamilyMember;
}
interface Reward {
  id: string;
  name: string;
  requiredPoints: number;
}

export default function ChoresPage() {
  const { householdId } = useHousehold();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);

  const [title, setTitle] = useState("");
  const [points, setPoints] = useState(5);
  const [recurrence, setRecurrence] = useState<Chore["recurrence"]>("NONE");
  const [assignee, setAssignee] = useState("");

  const [rewardName, setRewardName] = useState("");
  const [rewardPoints, setRewardPoints] = useState(50);

  async function load() {
    const [famRes, choreRes, rewardRes] = await Promise.all([
      fetch(`/api/family?householdId=${householdId}`),
      fetch(`/api/chores?householdId=${householdId}`),
      fetch(`/api/rewards?householdId=${householdId}`),
    ]);
    const fam = famRes.ok ? (await famRes.json()).familyMembers : [];
    setMembers(fam);
    if (!assignee && fam[0]) setAssignee(fam[0].id);
    if (choreRes.ok) setChores((await choreRes.json()).chores);
    if (rewardRes.ok) setRewards((await rewardRes.json()).rewards);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  async function addChore(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assignee) return;
    await fetch("/api/chores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, familyMemberId: assignee, title, points, recurrence }),
    });
    setTitle("");
    load();
  }

  async function completeChore(id: string) {
    await fetch(`/api/chores/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, complete: true }),
    });
    load();
  }

  async function addReward(e: React.FormEvent) {
    e.preventDefault();
    if (!rewardName.trim()) return;
    await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, name: rewardName, requiredPoints: rewardPoints }),
    });
    setRewardName("");
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Chores & Rewards</h1>
        <p className="text-sm text-hearth-muted">Assign chores, award points, and set up the reward bank kids can redeem into.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New chore</CardTitle>
        </CardHeader>
        <form onSubmit={addChore} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Take out the trash" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Assign to</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm">
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Points</label>
            <Input type="number" min={0} value={points} onChange={(e) => setPoints(Number(e.target.value))} className="w-24" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Repeats</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as Chore["recurrence"])}
              className="rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm"
            >
              <option value="NONE">One time</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          <Button type="submit">Add chore</Button>
        </form>
      </Card>

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold">Active chores</h2>
        <div className="space-y-2">
          {chores.map((c) => (
            <Card key={c.id} className="flex items-center gap-3">
              <FamilyMemberAvatar
                name={c.familyMember.name}
                color={c.familyMember.color}
                initials={c.familyMember.initials ?? "?"}
                avatarUrl={c.familyMember.avatarUrl}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-hearth-muted">
                  {c.familyMember.name} · {c.recurrence === "NONE" ? "One time" : c.recurrence.toLowerCase()} · {c.points} pts
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => completeChore(c.id)}>
                Mark done
              </Button>
            </Card>
          ))}
          {chores.length === 0 && <p className="text-sm text-hearth-muted">No active chores.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold">Reward bank</h2>
        <Card className="mb-4">
          <form onSubmit={addReward} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm font-medium">Reward</label>
              <Input value={rewardName} onChange={(e) => setRewardName(e.target.value)} placeholder="Movie night pick" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Points required</label>
              <Input type="number" min={1} value={rewardPoints} onChange={(e) => setRewardPoints(Number(e.target.value))} className="w-28" />
            </div>
            <Button type="submit">Add reward</Button>
          </form>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.map((r) => (
            <Card key={r.id}>
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-hearth-muted">{r.requiredPoints} points</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
