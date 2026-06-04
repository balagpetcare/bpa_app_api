export type PickListLineUpdatePayload = { lineId: number; quantityPicked: number };

/**
 * Normalize optional `lines` on pick-list complete (supports legacy/alternate keys).
 */
export function parsePickListLineUpdatesFromBody(body: unknown): PickListLineUpdatePayload[] | undefined {
  if (body == null || typeof body !== "object") return undefined;
  const lines = (body as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length === 0) return undefined;
  const out: PickListLineUpdatePayload[] = [];
  for (const raw of lines) {
    if (raw == null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const lineId = Number(r.lineId ?? r.id);
    const quantityPicked = Number(r.quantityPicked ?? r.pickedQty ?? r.qtyPicked ?? r.picked);
    if (!Number.isFinite(lineId) || lineId <= 0) continue;
    if (!Number.isFinite(quantityPicked)) continue;
    out.push({ lineId, quantityPicked: Math.floor(quantityPicked) });
  }
  return out.length ? out : undefined;
}
