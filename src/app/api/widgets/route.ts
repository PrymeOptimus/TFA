import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";

const widgetTypeEnum = z.enum([
  "CLOCK",
  "WEATHER",
  "CALENDAR_MONTH",
  "CALENDAR_WEEK",
  "CALENDAR_AGENDA",
  "CALENDAR_LIST",
  "CHORES",
  "MEAL_PLAN",
  "NOTES",
  "PHOTOS",
]);

const createSchema = z.object({
  householdId: z.string(),
  layoutId: z.string(),
  type: widgetTypeEnum,
  x: z.number().int().min(0).default(0),
  y: z.number().int().min(0).default(0),
  w: z.number().int().min(1).max(24).default(4),
  h: z.number().int().min(1).max(24).default(4),
  config: z.record(z.any()).optional(),
});

const updateSchema = z.object({
  householdId: z.string(),
  id: z.string(),
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  w: z.number().int().min(1).max(24).optional(),
  h: z.number().int().min(1).max(24).optional(),
  isEnabled: z.boolean().optional(),
  config: z.record(z.any()).optional(),
});

/** POST: add a widget to a layout. */
export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const layout = await prisma.layout.findFirst({ where: { id: body.layoutId, householdId: body.householdId } });
    if (!layout) return Response.json({ error: "Layout not found" }, { status: 404 });

    const widget = await prisma.widget.create({
      data: {
        householdId: body.householdId,
        layoutId: body.layoutId,
        type: body.type,
        x: body.x,
        y: body.y,
        w: body.w,
        h: body.h,
        config: body.config ?? undefined,
      },
    });
    return Response.json({ widget }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** PATCH: move/resize/toggle/reconfigure a widget — used by the drag-and-drop layout builder. */
export async function PATCH(req: Request) {
  try {
    const body = updateSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const widget = await prisma.widget.findFirst({ where: { id: body.id, householdId: body.householdId } });
    if (!widget) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.widget.update({
      where: { id: widget.id },
      data: {
        ...(body.x !== undefined ? { x: body.x } : {}),
        ...(body.y !== undefined ? { y: body.y } : {}),
        ...(body.w !== undefined ? { w: body.w } : {}),
        ...(body.h !== undefined ? { h: body.h } : {}),
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
      },
    });
    return Response.json({ widget: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    const id = searchParams.get("id");
    if (!householdId || !id) return Response.json({ error: "householdId and id are required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const widget = await prisma.widget.findFirst({ where: { id, householdId } });
    if (!widget) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.widget.delete({ where: { id: widget.id } });
    return Response.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
