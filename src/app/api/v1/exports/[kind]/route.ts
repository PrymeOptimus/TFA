import { apiRoute, jsonError } from "@/server/api";
import { exportCsv } from "@/server/services/crm";

export const GET = apiRoute<{ params: Promise<{ kind: string }> }>(async (_req, actor, { params }) => {
  const { kind } = await params;
  const k = kind === "contacts.csv" ? "contacts" : kind === "opportunities.csv" ? "opportunities" : null;
  if (!k) return jsonError(404, "not_found", "Unknown export");
  const { csv } = await exportCsv(actor, k);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${k}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
