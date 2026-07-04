import { readableTextColor } from "@/lib/colors";

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: color, color: readableTextColor(color) }}
    >
      {label}
    </span>
  );
}
