import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const btn = {
  primary: "bg-brand text-brand-ink hover:bg-teal-800 border-transparent",
  secondary: "bg-surface text-ink border-line hover:bg-slate-50",
  danger: "bg-surface text-danger border-red-200 hover:bg-danger-soft",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-slate-100",
};
export type ButtonVariant = keyof typeof btn;
export const buttonClass = (v: ButtonVariant = "secondary", size: "sm" | "md" = "md") =>
  cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    btn[v],
  );

export function Button({ variant = "secondary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button {...p} className={cx(buttonClass(variant, size), className)} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link {...p} className={cx(buttonClass(variant, size), className)} />;
}

const tone = {
  neutral: "bg-slate-100 text-ink-2",
  brand: "bg-brand-soft text-brand",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  ok: "bg-ok-soft text-ok",
  sim: "bg-sim-soft text-sim",
};
export type Tone = keyof typeof tone;
export function Badge({ tone: t = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone[t])}>
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-surface", className)} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Notice({ tone: t = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div role="note" className={cx("rounded-md px-3 py-2 text-sm", tone[t])}>{children}</div>;
}

export const inputClass = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-2">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-3" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && <p className="text-xs text-danger" id={`${htmlFor}-error`} role="alert">{error}</p>}
    </div>
  );
}

const RUN_TONE: Record<string, Tone> = { completed: "ok", failed: "danger", needs_review: "danger", waiting: "brand", running: "brand", pending: "neutral", cancelled: "neutral" };
export function RunStatus({ status }: { status: string }) {
  return <Badge tone={RUN_TONE[status] ?? "neutral"}>{status.replace("_", " ")}</Badge>;
}

const MSG: Record<string, { tone: Tone; label: string }> = {
  recorded: { tone: "neutral", label: "Recorded" },
  queued: { tone: "neutral", label: "Queued" },
  dispatching: { tone: "warn", label: "Dispatching" },
  provider_accepted: { tone: "brand", label: "Provider accepted" },
  delivered: { tone: "ok", label: "Delivered" },
  failed: { tone: "danger", label: "Failed" },
  suppressed: { tone: "warn", label: "Not sent (policy)" },
  unknown: { tone: "danger", label: "Outcome unknown" },
};
export function MessageStatus({ status, simulated }: { status: string; simulated: boolean }) {
  const m = MSG[status] ?? { tone: "neutral" as Tone, label: status };
  return (
    <span className="inline-flex gap-1">
      <Badge tone={m.tone}>{m.label}</Badge>
      {simulated && <Badge tone="sim" title="Handled by the local simulation adapter. No real message was sent.">Local simulation</Badge>}
    </span>
  );
}

export function fmtDateTime(d: Date | string | null | undefined, tz = "America/New_York") {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(d));
}
export function fmtMoney(cents: number | null | undefined, currency = "USD") {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
