import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const createSchema = z.object({
  householdId: z.string(),
  body: z.string().min(1).max(2000),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#FDE68A"),
  authorName: z.string().max(80).optional(),
  pinned: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
});

function sanitizeBody(input: string): string {
  // Notes render as plain text (see NotesWidget), but strip anything that
  // looks like markup defensively in case a future view renders raw HTML.
  return input.replace(/<[^>]*>/g, "").slice(0, 2000);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const notes = await prisma.note.findMany({
      where: {
        householdId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    });
    return Response.json({ notes });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const note = await prisma.note.create({
      data: {
        householdId: body.householdId,
        body: sanitizeBody(body.body),
        color: body.color,
        authorName: body.authorName,
        pinned: body.pinned,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    return Response.json({ note }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
