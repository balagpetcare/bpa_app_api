const prismaMock = {
  campaignBooking: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  campaignSmsLog: {
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock("../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("../../api/v1/modules/campaign/campaign.service", () => ({
  logCampaignAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../shared/services/sms/sms.service", () => ({
  sendSMS: jest.fn().mockResolvedValue({ success: true, messageId: "gw-123", queued: false }),
}));

const { sendSMS } = require("../../shared/services/sms/sms.service");
const {
  dispatchPaymentSuccessSms,
  __paymentSuccessSmsTestUtils,
} = require("./payment-success-sms.service");

describe("payment-success-sms.service", () => {
  const baseBooking = {
    id: 7,
    bookingRef: "VAC-TEST01",
    ownerPhone: "01711111111",
    ownerName: "Owner",
    petCount: 2,
    bookingDate: new Date("2026-06-15"),
    paymentStatus: "COMPLETED",
    bookingMode: "VENUE",
    status: "CONFIRMED",
    smsSentAt: null,
    smsReference: null,
    checkoutSessionId: "sess-abc",
    bookingArea: null,
    coverageZoneName: null,
    campaign: { id: 1, name: "Dhaka Cat Vaccination 2026", slug: "dhaka-2026" },
    location: { id: 1, name: "DNCC Venue A", address: "Dhaka" },
    slot: { startTime: "09:00", endTime: "11:00", sessionName: "Morning" },
    pets: [{ name: "Milo" }, { name: "Luna" }],
    checkoutSession: { id: "sess-abc", status: "FULFILLED" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.campaignBooking.findUnique.mockResolvedValue(baseBooking);
    prismaMock.campaignBooking.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.campaignBooking.update.mockResolvedValue({});
    prismaMock.campaignSmsLog.create.mockResolvedValue({ id: 501 });
    prismaMock.campaignSmsLog.update.mockResolvedValue({});
  });

  it("formats the vaccination payment success message", () => {
    const message = __paymentSuccessSmsTestUtils.buildMessage(baseBooking);
    expect(message).toContain("Bangladesh Pet Association");
    expect(message).toContain("Booking Ref: VAC-TEST01");
    expect(message).toContain("Campaign: Dhaka Cat Vaccination 2026");
    expect(message).toContain("Pet: Milo, Luna");
    expect(message).toContain("Date:");
  });

  it("skips when smsSentAt already exists", async () => {
    prismaMock.campaignBooking.findUnique.mockResolvedValue({
      ...baseBooking,
      smsSentAt: new Date(),
      smsReference: "campaign_sms_log:99",
    });

    const result = await dispatchPaymentSuccessSms(7);
    expect(result.status).toBe("skipped_duplicate");
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("sends once and stores smsReference", async () => {
    const result = await dispatchPaymentSuccessSms(7);

    expect(result.status).toBe("sent");
    expect(prismaMock.campaignBooking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, smsSentAt: null } })
    );
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(prismaMock.campaignBooking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ smsReference: "campaign_sms_log:501" }),
      })
    );
  });

  it("skips when checkout session is not FULFILLED", async () => {
    prismaMock.campaignBooking.findUnique.mockResolvedValue({
      ...baseBooking,
      checkoutSession: { id: "sess-abc", status: "PENDING" },
    });

    const result = await dispatchPaymentSuccessSms(7);
    expect(result.status).toBe("skipped_not_eligible");
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("is safe when claim races (updateMany count 0)", async () => {
    prismaMock.campaignBooking.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.campaignBooking.findUnique
      .mockResolvedValueOnce(baseBooking)
      .mockResolvedValueOnce({ smsReference: "campaign_sms_log:501" });

    const result = await dispatchPaymentSuccessSms(7);
    expect(result.status).toBe("skipped_duplicate");
    expect(sendSMS).not.toHaveBeenCalled();
  });
});
