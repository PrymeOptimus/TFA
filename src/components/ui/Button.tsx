"use client";

import type { ButtonHTMLAttributes } from "react";
import { clsx } from "@/lib/clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "touch";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-hearth-accent text-white hover:opacity-90",
  secondary: "bg-hearth-surface border border-hearth-border text-hearth-text hover:bg-hearth-border/40",
  ghost: "text-hearth-text hover:bg-hearth-border/40",
  danger: "bg-red-500 text-white hover:bg-red-600",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-sm px-3 py-1.5 rounded-lg",
  md: "text-sm px-4 py-2 rounded-xl",
  lg: "text-base px-5 py-3 rounded-xl",
  // Large touch target for wall-mounted screens (min 44px, WCAG-friendly).
  touch: "text-lg px-6 py-4 rounded-2xl min-h-[56px] min-w-[56px]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
