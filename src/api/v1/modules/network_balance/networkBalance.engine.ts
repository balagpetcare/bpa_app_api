/**
 * Pure helpers for Wave-3 network balancing (unit-testable).
 */

export type NodeBalanceInput = {
  locationId: number;
  branchId: number;
  /** Sellable available qty (after reserves & recall blocks). */
  availableQty: number;
  inboundPipelineQty: number;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  /** Higher = more urgent fill (e.g. branch priority weight). */
  priorityWeight: number;
};

export function shortageUnits(n: NodeBalanceInput, safetyBuffer = 0): number {
  const rop = n.reorderPoint > 0 ? n.reorderPoint : n.minStock;
  const cover = n.availableQty + n.inboundPipelineQty;
  return Math.max(0, rop + safetyBuffer - cover);
}

export function surplusUnits(n: NodeBalanceInput, safetyBuffer = 0): number {
  const cover = n.availableQty + n.inboundPipelineQty;
  if (n.maxStock <= 0) return 0;
  return Math.max(0, cover - n.maxStock - safetyBuffer);
}

export type GreedyMatch = {
  fromLocationId: number;
  toLocationId: number;
  qty: number;
  variantId: number;
};

/**
 * Greedy: match highest surplus nodes to highest shortage nodes (by severity * priority).
 */
export function greedyMatch(args: {
  variantId: number;
  surplusNodes: Array<{ locationId: number; surplus: number }>;
  shortageNodes: Array<{ locationId: number; shortage: number; score: number }>;
  minMoveQty: number;
  routeAllowed: (fromId: number, toId: number) => boolean;
}): GreedyMatch[] {
  const surplus = args.surplusNodes
    .filter((s) => s.surplus >= args.minMoveQty)
    .sort((a, b) => b.surplus - a.surplus);
  const shortage = args.shortageNodes
    .filter((s) => s.shortage >= args.minMoveQty)
    .sort((a, b) => b.score - a.score);

  const out: GreedyMatch[] = [];
  const surRem = new Map(surplus.map((s) => [s.locationId, s.surplus]));
  const shortRem = new Map(shortage.map((s) => [s.locationId, s.shortage]));

  for (const sh of shortage) {
    let need = shortRem.get(sh.locationId) ?? 0;
    if (need < args.minMoveQty) continue;
    for (const su of surplus) {
      let have = surRem.get(su.locationId) ?? 0;
      if (have < args.minMoveQty) continue;
      if (!args.routeAllowed(su.locationId, sh.locationId)) continue;
      const move = Math.min(need, have);
      if (move < args.minMoveQty) continue;
      out.push({
        variantId: args.variantId,
        fromLocationId: su.locationId,
        toLocationId: sh.locationId,
        qty: move,
      });
      need -= move;
      have -= move;
      shortRem.set(sh.locationId, need);
      surRem.set(su.locationId, have);
      if (need < args.minMoveQty) break;
    }
  }
  return out;
}
