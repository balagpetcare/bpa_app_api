const prismaMock = {
  order: { findFirst: jest.fn() },
  campaignBooking: { findUnique: jest.fn() },
};

jest.mock("../../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("./eps.gateway", () => ({
  verifyEpsTransaction: jest.fn(),
  parseEpsCallbackQuery: jest.fn(),
}));

jest.mock("../paymentTransaction.service", () => ({
  createPaymentTransaction: jest.fn(),
  findPaymentTransactionByGatewayTx: jest.fn(),
  mapWebhookStatusToTransactionStatus: jest.fn((s: string) => s),
  updatePaymentTransaction: jest.fn(),
  upsertPaymentTransaction: jest.fn().mockResolvedValue({ id: 1, duplicate: false }),
}));

jest.mock("../../../providers/paymentReplay.guard", () => ({
  buildPaymentEventKey: jest.fn(() => "key"),
  isPaymentEventReplay: jest.fn().mockResolvedValue(false),
  markPaymentEventProcessed: jest.fn(),
}));

jest.mock("../../campaign/payment.service", () => ({
  processPaymentWebhook: jest.fn().mockResolvedValue({
    success: true,
    bookingId: 99,
  }),
}));

jest.mock("./eps.redirectResolver", () => ({
  logEpsRedirect: jest.fn(),
  resolveEpsRedirectContext: jest.fn(),
}));

const { verifyEpsTransaction, parseEpsCallbackQuery } = require("./eps.gateway");
const { resolveEpsRedirectContext } = require("./eps.redirectResolver");
const { handleEpsCallback } = require("./eps.service");

describe("handleEpsCallback redirect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyEpsTransaction.mockResolvedValue(null);
    parseEpsCallbackQuery.mockReturnValue({
      provider: "eps",
      transactionId: "CKO-EZTUBGCU",
      providerTxId: "EPS-1",
      status: "SUCCESS",
      amount: 0,
      eventId: "eps:callback:CKO-EZTUBGCU:SUCCESS:Success",
      rawResponse: {},
    });
    resolveEpsRedirectContext
      .mockResolvedValueOnce({
        checkoutId: "clcheckout123",
        orderNumber: "CKO-EZTUBGCU",
        orderId: 10,
      })
      .mockResolvedValue({
        checkoutId: "clcheckout123",
        orderNumber: "CKO-EZTUBGCU",
        orderId: 10,
      });
    prismaMock.order.findFirst.mockResolvedValue({ id: 10, totalAmount: 350 });
    prismaMock.campaignBooking.findUnique.mockResolvedValue({
      checkoutSessionId: "clcheckout123",
      bookingRef: "VAC-TEST01",
    });
  });

  it("redirects to /book/success?checkoutId= from MerchantTransactionId CKO-*", async () => {
    const result = await handleEpsCallback("success", {
      Status: "Success",
      MerchantTransactionId: "CKO-EZTUBGCU",
      EPSTransactionId: "260607071504083ZQ",
    });

    expect(result.redirectPath).toContain("/book/success?");
    expect(result.redirectPath).toContain("checkoutId=clcheckout123");
    expect(result.checkoutId).toBe("clcheckout123");
  });
});
