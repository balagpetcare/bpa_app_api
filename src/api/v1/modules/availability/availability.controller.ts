import { getMultiSourceAvailability } from "../../services/multiSourceAvailability.service";
import { getOrgIdsForUser } from "../grn/grn.service";

/** Parse demand: JSON object {"101":5} or comma-separated 101:5,102:10 */
function parseDemandQuery(raw: unknown): Record<number, number> | undefined {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim();
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const out: Record<number, number> = {};
      for (const [k, v] of Object.entries(o)) {
        const n = Number(k);
        const q = Number(v);
        if (Number.isFinite(n) && Number.isFinite(q) && q > 0) out[n] = q;
      }
      return Object.keys(out).length ? out : undefined;
    } catch {
      return undefined;
    }
  }
  const out: Record<number, number> = {};
  for (const part of s.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const [a, b] = seg.split(":");
    if (a && b) {
      const n = Number(a.trim());
      const q = Number(b.trim());
      if (Number.isFinite(n) && Number.isFinite(q) && q > 0) out[n] = q;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveOrg(req: any): Promise<{ userId: number; orgId: number } | null> {
  const userId = getUserId(req);
  if (!userId) return null;
  const orgIds = await getOrgIdsForUser(userId);
  if (!orgIds.length) return null;
  const raw = req.body?.orgId ?? req.query?.orgId;
  const orgId = raw != null ? Number(raw) : orgIds[0];
  if (!orgIds.includes(orgId)) return null;
  return { userId, orgId };
}

export async function getMultiSource(req: any, res: any) {
  try {
    const ctx = await resolveOrg(req);
    if (!ctx) return res.status(403).json({ success: false, message: "No organization access" });

    const rawVariantIds = req.query.variantIds;
    if (!rawVariantIds) {
      return res.status(400).json({ success: false, message: "variantIds query parameter required" });
    }

    const variantIds = String(rawVariantIds)
      .split(",")
      .map(Number)
      .filter(Number.isFinite);

    if (!variantIds.length) {
      return res.status(400).json({ success: false, message: "At least one valid variantId required" });
    }

    if (variantIds.length > 50) {
      return res.status(400).json({ success: false, message: "Maximum 50 variant IDs per request" });
    }

    const preferredLocationId = req.query.preferredLocationId
      ? Number(req.query.preferredLocationId)
      : undefined;
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const demandByVariantId = parseDemandQuery(req.query.demand ?? req.query.demandByVariantId);
    const demandVariantIds = demandByVariantId ? Object.keys(demandByVariantId).map(Number).filter(Number.isFinite) : [];
    const mergedVariantIds = [...new Set([...variantIds, ...demandVariantIds])];

    const result = await getMultiSourceAvailability(ctx.orgId, mergedVariantIds, {
      preferredLocationId,
      branchId,
      demandByVariantId,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("availability.getMultiSource", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
}
