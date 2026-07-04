import type { InputHTMLAttributes } from "react";
import { clsx } from "@/lib/clsx";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full rounded-lg border border-hearth-border bg-hearth-surface px-3 py-2 text-sm text-hearth-text placeholder:text-hearth-muted focus:outline-none focus:ring-2 focus:ring-hearth-accent",
        className,
      )}
      {...props}
    />
  );
}
