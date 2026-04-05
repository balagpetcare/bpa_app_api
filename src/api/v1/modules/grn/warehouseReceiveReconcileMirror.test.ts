/**
 * Mirrors bpa_web/src/lib/warehouseReceiveReconcile.ts reconciliation math for CI parity.
 * Run: npx jest warehouseReceiveReconcileMirror.test.ts
 */
function deriveAccepted(expectedRef: number, damaged: number, short: number, extra: number): number {
  return Math.max(0, Math.floor(expectedRef + extra - damaged - short));
}
function deriveShort(expectedRef: number, accepted: number, damaged: number, extra: number): number {
  return Math.max(0, Math.floor(expectedRef + extra - accepted - damaged));
}

describe("warehouse receive reconcile (mirror of frontend)", () => {
  it("editing damaged → derive accepted", () => {
    const expectedRef = 10;
    const damaged = 2;
    const short = 1;
    const extra = 0;
    expect(deriveAccepted(expectedRef, damaged, short, extra)).toBe(7);
    expect(7 + damaged + short).toBe(expectedRef + extra);
  });

  it("editing accepted → derive short", () => {
    const expectedRef = 10;
    const accepted = 8;
    const damaged = 1;
    const extra = 0;
    expect(deriveShort(expectedRef, accepted, damaged, extra)).toBe(1);
    expect(accepted + damaged + 1).toBe(expectedRef + extra);
  });

  it("extra shifts RHS: accepted + damaged + short = expectedRef + extra", () => {
    const expectedRef = 10;
    const extra = 2;
    const accepted = 5;
    const damaged = 1;
    const short = deriveShort(expectedRef, accepted, damaged, extra);
    expect(short).toBe(6);
    expect(accepted + damaged + short).toBe(expectedRef + extra);
  });
});
