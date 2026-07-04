import { unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const photo = await prisma.photo.findFirst({ where: { id: params.id, householdId } });
    if (!photo) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.photo.delete({ where: { id: photo.id } });

    if (photo.storageKey && process.env.STORAGE_DRIVER !== "supabase" && process.env.STORAGE_DRIVER !== "s3") {
      const filePath = path.join(process.cwd(), "public", "uploads", photo.storageKey);
      await unlink(filePath).catch(() => {
        /* file may already be gone; deletion is best-effort */
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
