/** GSM-7 style segment estimate (160 chars per segment for plain SMS). */

const DEFAULT_CHARS_PER_SEGMENT = 160;
const DEFAULT_COST_PER_SEGMENT_BDT = 0.25;

export function getSmsCharsPerSegment(): number {
  const n = Number(process.env.SMS_CHARS_PER_SEGMENT || DEFAULT_CHARS_PER_SEGMENT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHARS_PER_SEGMENT;
}

export function getSmsCostPerSegmentBdt(): number {
  const n = Number(process.env.SMS_COST_PER_SEGMENT_BDT || DEFAULT_COST_PER_SEGMENT_BDT);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COST_PER_SEGMENT_BDT;
}

export function computeSmsSegments(message: string): number {
  const len = String(message || "").length;
  if (len === 0) return 0;
  return Math.ceil(len / getSmsCharsPerSegment());
}

export function estimateSmsCostBdt(message: string): { segmentCount: number; estimatedCostBdt: number } {
  const segmentCount = computeSmsSegments(message);
  const estimatedCostBdt = Math.round(segmentCount * getSmsCostPerSegmentBdt() * 10000) / 10000;
  return { segmentCount, estimatedCostBdt };
}
