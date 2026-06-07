import { buildEpsLandingRedirectPath } from "./eps.redirectPaths";

describe("buildEpsLandingRedirectPath", () => {
  it("prefers checkoutId for express success redirect", () => {
    const path = buildEpsLandingRedirectPath(
      "success",
      { MerchantTransactionId: "CKO-EZTUBGCU" },
      { checkoutId: "sess-uuid-123", bookingRef: "BPA-ABC123" }
    );
    expect(path).toContain("checkoutId=sess-uuid-123");
    expect(path).toContain("ref=BPA-ABC123");
  });

  it("uses legacy booking ref when checkoutId is absent", () => {
    const path = buildEpsLandingRedirectPath(
      "success",
      { CustomerOrderId: "CAMP-VAC-ABC123" },
      {}
    );
    expect(path).toBe("/book/payment/success?ref=VAC-ABC123");
  });

  it("includes checkoutId on failed redirect", () => {
    const path = buildEpsLandingRedirectPath(
      "fail",
      {},
      { checkoutId: "sess-uuid-123" }
    );
    expect(path).toBe("/book/payment/failed?checkoutId=sess-uuid-123");
  });
});
