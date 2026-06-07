/**
 * Derive user-facing SMS delivery status from booking payment-success SMS fields.
 */
export type SmsDeliveryStatus = "sent" | "pending" | "failed";

export function deriveSmsDeliveryStatus(booking: {
  smsSentAt?: Date | null;
  smsReference?: string | null;
  paymentStatus?: string;
}): SmsDeliveryStatus | undefined {
  const paid =
    booking.paymentStatus === "COMPLETED" || booking.paymentStatus === "NOT_REQUIRED";

  if (!paid) return undefined;

  if (booking.smsSentAt) {
    const ref = (booking.smsReference ?? "").toLowerCase();
    if (ref.startsWith("error:") || ref === "failed") {
      return "failed";
    }
    return "sent";
  }

  return "pending";
}
