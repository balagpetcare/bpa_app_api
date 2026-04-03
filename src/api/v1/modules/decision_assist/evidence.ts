import * as crypto from "crypto";

export const ENGINE_VERSION = "wave5.decision.v1";

export interface EvidenceSource {
  table: string;
  id?: number;
  keys?: Record<string, unknown>;
}

export function buildEvidencePayload(input: {
  sources: EvidenceSource[];
  factors: Array<{ name: string; value: number | string; unit?: string; source?: string }>;
  policyIds: string[];
  confidence: number;
  caveats: string[];
  rankingMethod?: string;
  synthesisSource?: string;
}): Record<string, unknown> {
  const canonical = JSON.stringify({
    sources: input.sources,
    factors: input.factors,
    policyIds: input.policyIds,
    rankingMethod: input.rankingMethod,
    synthesisSource: input.synthesisSource,
  });
  const inputsHash = crypto.createHash("sha256").update(canonical).digest("hex");
  return {
    engineVersion: ENGINE_VERSION,
    inputsHash,
    sources: input.sources,
    factors: input.factors,
    policyIds: input.policyIds,
    confidence: input.confidence,
    caveats: input.caveats,
    ...(input.rankingMethod ? { rankingMethod: input.rankingMethod } : {}),
    ...(input.synthesisSource ? { synthesisSource: input.synthesisSource } : {}),
  };
}
