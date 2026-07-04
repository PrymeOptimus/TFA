import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { saveHouseholdPhoto } from "@/lib/storage";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/rate-limit";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const photos = await prisma.photo.findMany({
      where: { householdId, isEnabled: true },
      orderBy: { sortOrder: "asc" },
    });
    return Response.json({ photos });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** POST: multipart/form-data upload — { householdId, file }. */
export async function POST(req: Request) {
  try {
    const limit = rateLimit(rateLimitKeyFromRequest(req, "photos:upload"));
    if (!limit.allowed) {
      return Response.json({ error: "Too many uploads, slow down." }, { status: 429 });
    }

    const form = await req.formData();
    const householdId = String(form.get("householdId") ?? "");
    const file = form.get("file");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });

    await requireHouseholdAccess(householdId);

    const { url, storageKey } = await saveHouseholdPhoto(householdId, file);

    const count = await prisma.photo.count({ where: { householdId } });
    const photo = await prisma.photo.create({
      data: { householdId, url, storageKey, sortOrder: count },
    });

    return Response.json({ photo }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
