import { generateEpsHash, generateEpsMerchantTransactionId, normalizeEpsPhone } from "./eps.utils";

describe("eps.utils", () => {
  it("generateEpsHash returns stable base64 hmac", () => {
    const a = generateEpsHash("merchant@example.com", "dGVzdGhhc2hrZXkxMjM0NTY3ODkw");
    const b = generateEpsHash("merchant@example.com", "dGVzdGhhc2hrZXkxMjM0NTY3ODkw");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("generateEpsMerchantTransactionId is at least 10 digits", () => {
    const id = generateEpsMerchantTransactionId();
    expect(id.length).toBeGreaterThanOrEqual(10);
    expect(/^\d+$/.test(id)).toBe(true);
  });

  it("normalizeEpsPhone formats BD mobile", () => {
    expect(normalizeEpsPhone("8801712345678")).toBe("01712345678");
    expect(normalizeEpsPhone("01712345678")).toBe("01712345678");
  });
});
