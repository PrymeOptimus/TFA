import { customAlphabet } from "nanoid";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/rate-limit";

const displayCodeId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 24);
const pairingCodeId = customAlphabet("0123456789", 6);

/** GET ?householdId= — list this household's paired displays (dashboard use, requires auth). */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const displays = await prisma.display.findMany({ where: { householdId }, orderBy: { createdAt: "asc" } });
    return Response.json({ displays });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * POST (no auth): called by a fresh /display page load with no code yet.
 * Creates an unclaimed Display row with a long unguessable displayCode
 * (the URL capability token, used going forward as /display/[displayCode])
 * and a short pairingCode shown on-screen for an admin to type into
 * /dashboard/displays. Rate-limited per IP since it is intentionally open
 * to unauthenticated kiosk devices.
 */
export async function POST(req: Request) {
  try {
    const limit = rateLimit(rateLimitKeyFromRequest(req, "displays:create"));
    if (!limit.allowed) {
      return Response.json({ error: "Too many display registrations, try again shortly." }, { status: 429 });
    }

    const display = await prisma.display.create({
      data: { displayCode: displayCodeId(), pairingCode: pairingCodeId() },
      select: { displayCode: true, pairingCode: true },
    });

    return Response.json(display, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
