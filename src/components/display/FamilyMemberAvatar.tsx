import { readableTextColor } from "@/lib/colors";

export function FamilyMemberAvatar({
  name,
  color,
  initials,
  avatarUrl,
  size = 40,
}: {
  name: string;
  color: string;
  initials: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover ring-2"
        style={{ width: size, height: size, ["--tw-ring-color" as any]: color }}
      />
    );
  }

  return (
    <div
      title={name}
      className="flex items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, backgroundColor: color, color: readableTextColor(color), fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}
