import { prisma } from "@/lib/prisma";
import type { DisplayBootstrapDTO } from "@/types";

/**
 * GET ?code=<displayCode> — public, unauthenticated. This is the only
 * endpoint the kiosk browser itself calls once paired; the long random
 * displayCode is its capability token (same trust model as an unlisted
 * share link). It only ever returns display-safe read data — never OAuth
 * tokens, never other households' data (enforced by the code being the
 * sole lookup key, unique per Display row).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return Response.json({ error: "code is required" }, { status: 400 });

  const display = await prisma.display.findUnique({
    where: { displayCode: code },
    include: { layout: { include: { widgets: { where: { isEnabled: true } } } }, household: { include: { familyMembers: { where: { archivedAt: null } } } } },
  });

  if (!display) return Response.json({ error: "Unknown display code" }, { status: 404 });

  await prisma.display.update({ where: { id: display.id }, data: { lastSeenAt: new Date() } });

  if (!display.isClaimed || !display.household) {
    return Response.json({ unclaimed: true, pairingCode: display.pairingCode });
  }

  const dto: DisplayBootstrapDTO = {
    display: {
      id: display.id,
      name: display.name,
      displayCode: display.displayCode,
      orientation: display.orientation as "landscape" | "portrait",
      theme: display.theme as "dark" | "light" | "auto",
      accentColor: display.accentColor,
    },
    household: { id: display.household.id, name: display.household.name, timezone: display.household.timezone },
    layout: display.layout
      ? {
          id: display.layout.id,
          name: display.layout.name,
          columns: display.layout.columns,
          rows: display.layout.rows,
          background: display.layout.background,
        }
      : null,
    widgets: (display.layout?.widgets ?? []).map((w) => ({
      id: w.id,
      type: w.type,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      config: w.config as any,
      isEnabled: w.isEnabled,
    })),
    familyMembers: display.household.familyMembers.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      initials: m.initials ?? "?",
      avatarUrl: m.avatarUrl,
    })),
  };

  return Response.json(dto);
}
