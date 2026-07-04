import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const createSchema = z.object({
  householdId: z.string(),
  name: z.string().min(1).max(120),
  columns: z.number().int().min(4).max(24).default(12),
  rows: z.number().int().min(4).max(24).default(8),
  background: z.string().max(40).optional(),
  cloneFromLayoutId: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const layouts = await prisma.layout.findMany({
      where: { householdId },
      include: { widgets: true },
      orderBy: [{ isPreset: "desc" }, { createdAt: "asc" }],
    });
    return Response.json({ layouts });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const layout = await prisma.$transaction(async (tx) => {
      const created = await tx.layout.create({
        data: {
          householdId: body.householdId,
          name: body.name,
          columns: body.columns,
          rows: body.rows,
          background: body.background,
        },
      });

      if (body.cloneFromLayoutId) {
        const source = await tx.widget.findMany({ where: { layoutId: body.cloneFromLayoutId, householdId: body.householdId } });
        if (source.length) {
          await tx.widget.createMany({
            data: source.map((w) => ({
              householdId: body.householdId,
              layoutId: created.id,
              type: w.type,
              x: w.x,
              y: w.y,
              w: w.w,
              h: w.h,
              config: w.config as any,
              isEnabled: w.isEnabled,
            })),
          });
        }
      }

      return created;
    });

    return Response.json({ layout }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
