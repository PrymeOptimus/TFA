"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { clsx } from "@/lib/clsx";
import { Button } from "@/components/ui/Button";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/calendar", label: "Calendar" },
  { href: "/dashboard/family", label: "Family" },
  { href: "/dashboard/chores", label: "Chores & Rewards" },
  { href: "/dashboard/meals", label: "Meal Plan" },
  { href: "/dashboard/notes", label: "Notes" },
  { href: "/dashboard/photos", label: "Photos" },
  { href: "/dashboard/widgets", label: "Layouts & Widgets" },
  { href: "/dashboard/displays", label: "Displays" },
  { href: "/settings", label: "Settings" },
];

export function DashboardShell({
  householdName,
  children,
}: {
  householdName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-hearth-bg">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-hearth-border bg-hearth-surface p-4 sm:flex">
        <div className="mb-6 px-2">
          <div className="font-display text-lg font-bold">Hearth</div>
          <div className="truncate text-xs text-hearth-muted">{householdName}</div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "block rounded-lg px-3 py-2 text-sm font-medium transition",
                pathname === item.href ? "bg-hearth-accent text-white" : "text-hearth-text hover:bg-hearth-border/40",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </Button>
      </aside>
      <main className="min-w-0 flex-1 p-6 sm:p-8">{children}</main>
    </div>
  );
}
