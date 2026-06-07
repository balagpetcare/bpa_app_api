import axios from "axios";
import { parseEpsCallbackQuery, verifyEpsTransaction } from "./eps.gateway";

jest.mock("axios");
const axiosMock = axios as jest.Mocked<typeof axios>;

jest.mock("./eps.config", () => ({
  assertEpsConfigured: () => ({
    baseUrl: "https://sandboxpgapi.eps.com.bd",
    username: "u",
    password: "p",
    hashKey: "hash",
    merchantId: "m",
    storeId: "s",
    successUrl: "https://api.test/success",
    failUrl: "https://api.test/fail",
    cancelUrl: "https://api.test/cancel",
    callbackUrl: "https://api.test/webhook",
    timeoutMs: 5000,
    sandbox: true,
  }),
}));

describe("eps.gateway verifyEpsTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axiosMock.post.mockResolvedValue({
      data: { token: "tok", expireDate: new Date(Date.now() + 3600000).toISOString() },
    } as never);
  });

  it("returns null on HTTP 404 without throwing", async () => {
    axiosMock.get.mockResolvedValue({
      status: 404,
      data: {},
    } as never);

    const result = await verifyEpsTransaction({
      merchantTransactionId: "CKO-EZTUBGCU",
      epsTransactionId: "260607071504083ZQ",
    });

    expect(result).toBeNull();
  });
});

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
