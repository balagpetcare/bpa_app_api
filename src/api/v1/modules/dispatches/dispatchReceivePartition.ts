/** Quantities sent on POST receive (matches ReceiveItemInput in dispatches.service). */
export type ReceiveBatchLineInput = {
  variantId: number;
  lotId?: number;
  quantityReceived?: number;
  quantityDamaged?: number;
  quantityShort?: number;
  excessQty?: number;
  reasonCode?: string | null;
  lineNote?: string | null;
  followUpNote?: string | null;
};

export const DISPATCH_RECEIVE_LINE_DISCREPANCY_REASON_CODES = [
  "DAMAGED_IN_TRANSIT",
  "SHORT_SHIPPED",
  "NOT_SENT_BY_WAREHOUSE",
  "LOST_IN_TRANSIT",
  "PACKING_MISMATCH",
  "HELD_FOR_LATER_DELIVERY",
  "QUALITY_ISSUE",
  "OVER_DELIVERED",
  "EXTRA_ITEM_FOUND",
  "WRONG_DISPATCH_QTY",
  "REVIEW_REQUIRED",
  "OTHER",
] as const;

const ALLOWED = new Set<string>(DISPATCH_RECEIVE_LINE_DISCREPANCY_REASON_CODES);

export type DispatchLineRemainingSource = {
  variantId: number;
  lotId: number | null;
  quantityDispatched: number;
  quantityReceived: number;
  quantityDamaged: number;
  quantityShort: number;
};

export function lineRemainingBeforeBatch(line: DispatchLineRemainingSource): number {
  return Math.max(
    0,
    line.quantityDispatched - line.quantityReceived - line.quantityDamaged - line.quantityShort
  );
}

/**
 * @returns error message or null if OK
 */
export function validateReceiveBatchAgainstRemaining(
  line: DispatchLineRemainingSource,
  batch: Pick<ReceiveBatchLineInput, "quantityReceived" | "quantityDamaged" | "quantityShort" | "excessQty">,
  options?: { relaxRemainingPartition?: boolean }
): string | null {
  if (batch.excessQty != null && Number(batch.excessQty) < 0) {
    return `Excess cannot be negative for variant ${line.variantId}.`;
  }
  const remaining = lineRemainingBeforeBatch(line);
  const qtyR = Math.max(0, batch.quantityReceived ?? 0);
  const qtyD = Math.max(0, batch.quantityDamaged ?? 0);
  const qtyS = Math.max(0, batch.quantityShort ?? 0);
  const sum = qtyR + qtyD + qtyS;

  if (qtyD < 0 || qtyS < 0 || qtyR < 0) return "Quantities cannot be negative.";
  if (sum > remaining) {
    return `Batch total ${sum} cannot exceed remaining ${remaining} for variant ${line.variantId}.`;
  }
  const relax = options?.relaxRemainingPartition === true;
  if (!relax && remaining > 0 && sum > 0 && sum !== remaining) {
    return (
      `For variant ${line.variantId}: Accepted + Damage + Shortage must equal the line remaining (${remaining}) ` +
      `for this receipt. Current sum is ${sum}. Adjust damage, shortage, or use legacy receive if a partial batch is required.`
    );
  }
  return null;
}

/**
 * Controlled receive: damage, shortage, or excess need reason + details. Legacy partial envelope needs details only.
 */
export function assertReceiveItemsHaveDiscrepancyNotes(
  dispatchItems: DispatchLineRemainingSource[],
  items: ReceiveBatchLineInput[],
  options?: { relaxRemainingPartition?: boolean }
) {
  const relax = options?.relaxRemainingPartition === true;
  for (const rec of items) {
    const qtyR = Math.max(0, rec.quantityReceived ?? 0);
    const qtyD = Math.max(0, rec.quantityDamaged ?? 0);
    const qtyS = Math.max(0, rec.quantityShort ?? 0);
    const qtyX = Math.max(0, rec.excessQty ?? 0);
    const total = qtyR + qtyD + qtyS;
    if (total <= 0 && qtyX <= 0) continue;
    const line = dispatchItems.find(
      (i) => i.variantId === rec.variantId && (rec.lotId == null || rec.lotId === i.lotId)
    );
    if (!line) continue;
    const remaining = lineRemainingBeforeBatch(line);
    const note = rec.lineNote != null && String(rec.lineNote).trim() ? String(rec.lineNote).trim() : "";
    const rcRaw = rec.reasonCode != null && String(rec.reasonCode).trim() ? String(rec.reasonCode).trim() : "";
    const rcOk = ALLOWED.has(rcRaw);

    const needsReasonAndDetail = qtyD > 0 || qtyS > 0 || qtyX > 0;
    const needsNoteOnly = relax && total < remaining && total > 0 && qtyD === 0 && qtyS === 0 && qtyX === 0;

    if (needsReasonAndDetail) {
      if (!rcOk) {
        throw new Error(
          `Variant ${rec.variantId}: choose a discrepancy reason when recording damage, shortage, or excess (over-received quantity).`
        );
      }
      if (note.length < 5) {
        throw new Error(
          `Variant ${rec.variantId}: add discrepancy details (at least 5 characters) explaining the issue and next steps.`
        );
      }
    } else if (needsNoteOnly) {
      if (note.length < 5) {
        throw new Error(
          `Variant ${rec.variantId}: add receiving notes for this partial receipt (at least 5 characters), or record damage/shortage explicitly.`
        );
      }
    }
  }
}
