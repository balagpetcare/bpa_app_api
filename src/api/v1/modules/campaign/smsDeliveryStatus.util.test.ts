const { deriveSmsDeliveryStatus } = require("./smsDeliveryStatus.util");

describe("deriveSmsDeliveryStatus", () => {
  it("returns sent when smsSentAt is set", () => {
    expect(
      deriveSmsDeliveryStatus({
        paymentStatus: "COMPLETED",
        smsSentAt: new Date(),
        smsReference: "campaign_sms_log:1",
      })
    ).toBe("sent");
  });

  it("returns failed when smsReference indicates error", () => {
    expect(
      deriveSmsDeliveryStatus({
        paymentStatus: "COMPLETED",
        smsSentAt: new Date(),
        smsReference: "error:gateway_timeout",
      })
    ).toBe("failed");
  });

  it("returns pending for paid booking without smsSentAt", () => {
    expect(
      deriveSmsDeliveryStatus({
        paymentStatus: "COMPLETED",
        smsSentAt: null,
      })
    ).toBe("pending");
  });

  it("returns undefined when not paid", () => {
    expect(
      deriveSmsDeliveryStatus({
        paymentStatus: "PENDING",
        smsSentAt: null,
      })
    ).toBeUndefined();
  });
});
