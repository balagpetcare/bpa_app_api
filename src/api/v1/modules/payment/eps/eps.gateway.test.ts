import { parseEpsCallbackQuery } from "./eps.gateway";

describe("eps.gateway parseEpsCallbackQuery", () => {
  it("uses CustomerOrderId as transactionId for campaign order lookup", () => {
    const event = parseEpsCallbackQuery({
      CustomerOrderId: "CKO-ABC12345",
      merchantTransactionId: "20260607120000123",
      EPSTransactionId: "EPS-999",
      status: "success",
    });

    expect(event).not.toBeNull();
    expect(event!.transactionId).toBe("CKO-ABC12345");
    expect(event!.providerTxId).toBe("EPS-999");
    expect(event!.status).toBe("SUCCESS");
  });

  it("falls back to merchantTransactionId when CustomerOrderId absent", () => {
    const event = parseEpsCallbackQuery({
      merchantTransactionId: "20260607120000456",
      status: "failed",
    });

    expect(event!.transactionId).toBe("20260607120000456");
    expect(event!.status).toBe("FAILED");
  });
});
