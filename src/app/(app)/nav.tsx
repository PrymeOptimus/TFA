"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS = [
  { href: "/today", label: "Today" },
  { href: "/contacts", label: "Contacts" },
  { href: "/inbox", label: "Inbox" },
  { href: "/pipelines", label: "Pipelines" },
  { href: null, label: "Appointments", note: "Planned for Milestone 2 (internal scheduling)." },
  { href: "/automations", label: "Automations" },
  { href: null, label: "Reports", note: "Planned: response-time and booking reports in Milestone 2; revenue only with reconciled payment data." },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav({ compact = false }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className={cx(compact ? "flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1" : "flex flex-col gap-0.5 px-2")}>
      {ITEMS.map((i) =>
        i.href ? (
          <Link
            key={i.label}
            href={i.href}
            aria-current={path.startsWith(i.href) ? "page" : undefined}
            className={cx(
              "rounded-md px-3 py-2 text-sm whitespace-nowrap",
              path.startsWith(i.href) ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-slate-100",
            )}
          >
            {i.label}
          </Link>
        ) : (
          <span key={i.label} aria-disabled="true" title={i.note} className="cursor-not-allowed rounded-md px-3 py-2 text-sm whitespace-nowrap text-slate-400">
            {i.label} <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase">Planned</span>
            {!compact && <span className="sr-only">. {i.note}</span>}
          </span>
        ),
      )}
    </nav>
  );
}
