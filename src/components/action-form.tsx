"use client";
import { useActionState, type ReactNode } from "react";
import { buttonClass, cx, type ButtonVariant } from "./ui";

export type ActionResult = { ok: boolean; message?: string } | null;

/**
 * Submits a bound server action and renders its result inline (role=status / role=alert), so a
 * refused or failed action is explained rather than silently ignored.
 */
export function ActionForm({
  action,
  label,
  pendingLabel,
  variant = "secondary",
  size = "md",
  confirm,
  children,
  disabled,
  disabledReason,
  className,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  confirm?: string;
  children?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={cx("inline-flex flex-col items-start gap-1", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button type="submit" className={buttonClass(variant, size)} disabled={pending || disabled} title={disabled ? disabledReason : undefined} aria-disabled={disabled || undefined}>
        {pending ? (pendingLabel ?? "Working…") : label}
      </button>
      {disabled && disabledReason && <span className="text-xs text-ink-3">{disabledReason}</span>}
      {state && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      {state?.ok && state.message && <span role="status" className="text-xs text-ok">{state.message}</span>}
    </form>
  );
}
