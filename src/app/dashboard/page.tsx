"use client";

import { useHousehold } from "@/app/dashboard/HouseholdContext";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { CalendarListView } from "@/components/display/CalendarListView";
import { ChoresWidget } from "@/components/display/ChoresWidget";
import { NotesWidget } from "@/components/display/NotesWidget";

export default function DashboardOverviewPage() {
  const { householdId, householdName } = useHousehold();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">{householdName}</h1>
        <p className="text-sm text-hearth-muted">Here&apos;s what&apos;s happening across the household.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-96 lg:col-span-1">
          <CardHeader>
            <CardTitle>Agenda</CardTitle>
          </CardHeader>
          <div className="h-[calc(100%-2.5rem)]">
            <CalendarListView householdId={householdId} />
          </div>
        </Card>
        <Card className="h-96 lg:col-span-1">
          <CardHeader>
            <CardTitle>Chores</CardTitle>
          </CardHeader>
          <div className="h-[calc(100%-2.5rem)]">
            <ChoresWidget householdId={householdId} />
          </div>
        </Card>
        <Card className="h-96 lg:col-span-1">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <div className="h-[calc(100%-2.5rem)]">
            <NotesWidget householdId={householdId} />
          </div>
        </Card>
      </div>
    </div>
  );
}
