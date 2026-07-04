import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse, requireHouseholdAccess } from "@/lib/session-context";
import { geocodeLocation, getWeather } from "@/lib/weather";

const settingsSchema = z.object({
  householdId: z.string(),
  locationName: z.string().min(1).max(140),
  units: z.enum(["imperial", "metric"]).default("imperial"),
});

/** GET ?householdId= — current weather + 5-day forecast for the household's configured location. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const householdId = searchParams.get("householdId");
    if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });
    await requireHouseholdAccess(householdId);

    const settings = await prisma.weatherSettings.findUnique({ where: { householdId } });
    if (!settings?.latitude || !settings?.longitude) {
      return Response.json({ error: "No location configured yet. Set one in /settings." }, { status: 409 });
    }

    const weather = await getWeather(settings.latitude, settings.longitude);
    return Response.json({ weather, units: settings.units, locationName: settings.locationName });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/** POST: geocode a free-text location and save it as the household's weather source. */
export async function POST(req: Request) {
  try {
    const body = settingsSchema.parse(await req.json());
    await requireHouseholdAccess(body.householdId);

    const geo = await geocodeLocation(body.locationName);
    if (!geo) return Response.json({ error: "Could not find that location" }, { status: 404 });

    const settings = await prisma.weatherSettings.upsert({
      where: { householdId: body.householdId },
      create: {
        householdId: body.householdId,
        locationName: geo.label,
        latitude: geo.lat,
        longitude: geo.lon,
        units: body.units,
      },
      update: { locationName: geo.label, latitude: geo.lat, longitude: geo.lon, units: body.units },
    });

    return Response.json({ settings });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
