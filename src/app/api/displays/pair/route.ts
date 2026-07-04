import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const pairSchema = z.object({
  householdId: z.string(),
  pairingCode: z.string().length(6),
  name: z.string().min(1).max(80).default("New Display"),
});

/** POST (auth required): admin claims an unclaimed display using its on-screen pairing code. */
export async function POST(req: Request) {
  try {
    const body = pairSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const display = await prisma.display.findFirst({
      where: { pairingCode: body.pairingCode, isClaimed: false },
    });
    if (!display) return Response.json({ error: "Invalid or already-used pairing code" }, { status: 404 });

    const claimed = await prisma.display.update({
      where: { id: display.id },
      data: { householdId: body.householdId, name: body.name, isClaimed: true, pairingCode: null },
    });

    return Response.json({ display: claimed });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
