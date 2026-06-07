const prismaMock = {
  campaignBooking: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  order: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orderPayment: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  branch: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  Prisma: {
    TransactionIsolationLevel: { Serializable: "Serializable" },
  },
  PaymentMethod: {
    BKASH: "BKASH",
    NAGAD: "NAGAD",
    CARD: "CARD",
    ONLINE: "ONLINE",
  },
}));

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("./campaign.service", () => ({
  logCampaignAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("./sms.service", () => ({
  sendPaymentFailureSms: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../../services/notification/payment-success-sms.service", () => ({
  dispatchPaymentSuccessSms: jest.fn().mockResolvedValue({ status: "sent" }),
}));

jest.mock("./checkout.service", () => ({
  fulfillCheckoutFromOrder: jest.fn().mockResolvedValue(42),
}));

const {
  processPaymentWebhook,
  getPaymentStatus,
  resolveCampaignBookingPaymentAmount,
} = require("./payment.service");
const { dispatchPaymentSuccessSms } = require("../../../../services/notification/payment-success-sms.service");
const { fulfillCheckoutFromOrder } = require("./checkout.service");

describe("campaign payment.service integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<unknown>) =>
      fn(prismaMock)
    );
  });

  describe("processPaymentWebhook idempotency", () => {
    const order = {
      id: 10,
      orderNumber: "CAMP-VAC-ABC123",
      notes: "campaign_booking:5|idempotency:deadbeef",
      paymentStatus: "PENDING",
      paymentMethod: "BKASH",
      totalAmount: 500,
      status: "PENDING",
    };

    const booking = {
      id: 5,
      campaignId: 1,
      status: "DRAFT",
      paymentStatus: "PENDING",
    };

    it("is idempotent for duplicate SUCCESS webhooks", async () => {
      prismaMock.order.findFirst.mockResolvedValue({ ...order, paymentStatus: "COMPLETED" });

      const result = await processPaymentWebhook({
        provider: "bkash",
        transactionId: "CAMP-VAC-ABC123",
        status: "SUCCESS",
      });

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(true);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(dispatchPaymentSuccessSms).not.toHaveBeenCalled();
    });

    it("creates one order payment and confirms booking on SUCCESS", async () => {
      prismaMock.order.findFirst.mockResolvedValue(order);
      prismaMock.order.findUnique.mockResolvedValue(order);
      prismaMock.orderPayment.findFirst.mockResolvedValue(null);
      prismaMock.campaignBooking.findUnique.mockResolvedValue(booking);
      prismaMock.order.update.mockResolvedValue({});
      prismaMock.orderPayment.create.mockResolvedValue({ id: 1 });
      prismaMock.campaignBooking.update.mockResolvedValue({ ...booking, status: "CONFIRMED" });

      const result = await processPaymentWebhook({
        provider: "bkash",
        transactionId: "TX-001",
        status: "SUCCESS",
        amount: 500,
      });

      expect(result.success).toBe(true);
      expect(result.bookingId).toBe(5);
      expect(prismaMock.orderPayment.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.campaignBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: expect.objectContaining({ status: "CONFIRMED", paymentStatus: "COMPLETED" }),
        })
      );
      expect(dispatchPaymentSuccessSms).toHaveBeenCalledWith(5);
    });

    it("rejects SUCCESS webhook when amount does not match order total", async () => {
      prismaMock.order.findFirst.mockResolvedValue(order);

      const result = await processPaymentWebhook({
        provider: "bkash",
        transactionId: "CAMP-VAC-ABC123",
        status: "SUCCESS",
        amount: 1,
      });

      expect(result.success).toBe(false);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("accepts EPS callback fallback with amount 0 and enriches from order total", async () => {
      const checkoutOrder = {
        id: 20,
        orderNumber: "CKO-EZTUBGCU",
        notes: "campaign_checkout:sess123|idempotency:abc",
        paymentStatus: "PENDING",
        paymentMethod: "ONLINE",
        totalAmount: 350,
        status: "PENDING",
      };

      prismaMock.order.findFirst.mockResolvedValue(checkoutOrder);
      prismaMock.order.findUnique.mockResolvedValue(checkoutOrder);
      prismaMock.orderPayment.findFirst.mockResolvedValue(null);
      prismaMock.order.update.mockResolvedValue({});
      prismaMock.orderPayment.create.mockResolvedValue({ id: 2 });

      const result = await processPaymentWebhook({
        provider: "eps",
        transactionId: "CKO-EZTUBGCU",
        status: "SUCCESS",
        amount: 0,
      });

      expect(result.success).toBe(true);
      expect(fulfillCheckoutFromOrder).toHaveBeenCalledWith(20);
      expect(dispatchPaymentSuccessSms).not.toHaveBeenCalled();
    });

    it("does not duplicate orderPayment when webhook retries", async () => {
      prismaMock.order.findFirst.mockResolvedValue(order);
      prismaMock.order.findUnique.mockResolvedValue(order);
      prismaMock.orderPayment.findFirst.mockResolvedValue({ id: 99, reference: "TX-001" });
      prismaMock.campaignBooking.findUnique.mockResolvedValue({ ...booking, paymentStatus: "PENDING" });

      await processPaymentWebhook({
        provider: "bkash",
        transactionId: "TX-001",
        status: "SUCCESS",
      });

      expect(prismaMock.orderPayment.create).not.toHaveBeenCalled();
    });
  });

  describe("resolveCampaignBookingPaymentAmount", () => {
    it("aligns backend charge with coupon-adjusted total", () => {
      const pricing = resolveCampaignBookingPaymentAmount(200, 2, "BPA2026");
      expect(pricing.subtotal).toBe(400);
      expect(pricing.total).toBe(320);
    });
  });

  describe("getPaymentStatus", () => {
    it("returns total amount as unit price times pet count", async () => {
      prismaMock.campaignBooking.findUnique.mockResolvedValue({
        bookingRef: "VAC-ABC123",
        petCount: 3,
        paymentStatus: "PENDING",
        paidAmount: null,
        paymentOrderId: 10,
        refundStatus: null,
        refundAmount: null,
        campaign: { pricingType: "PAID", priceAmount: 200 },
      });

      const status = await getPaymentStatus(5);
      expect(status.amount).toBe(600);
      expect(status.unitPrice).toBe(200);
      expect(status.petCount).toBe(3);
    });
  });
});
