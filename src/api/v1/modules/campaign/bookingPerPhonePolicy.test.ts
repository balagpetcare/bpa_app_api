/**
 * Regression: same phone may hold multiple bookings per campaign/day (express + OTP flows).
 * Payment idempotency remains in payment.service / fulfillCheckoutSession.
 */
import * as fs from "fs";
import * as path from "path";

const campaignDir = path.join(__dirname);

function readModule(name: string): string {
  return fs.readFileSync(path.join(campaignDir, name), "utf8");
}

describe("booking per-phone policy", () => {
  it("express checkout does not block duplicate phone on same campaign/day", () => {
    const src = readModule("checkout.service.ts");
    expect(src).not.toContain("You already have a booking for today on this campaign");
    expect(src).not.toMatch(/existingToday\s*=/);
  });

  it("OTP slot booking does not block duplicate phone on same campaign/day", () => {
    const src = readModule("booking.service.ts");
    expect(src).not.toMatch(/existingBooking\s*=\s*await\s*tx\.campaignBooking\.findFirst/);
    expect(src).not.toContain("BookingErrors.ALREADY_EXISTS");
  });

  it("payment webhook idempotency remains", () => {
    const src = readModule("payment.service.ts");
    expect(src).toContain("idempotencyKey");
    expect(src).toMatch(/duplicate:\s*true/);
  });

  it("checkout session fulfillment remains idempotent", () => {
    const src = readModule("checkout.service.ts");
    expect(src).toContain("ALREADY_FULFILLED");
    expect(src).toMatch(/status === "FULFILLED"/);
  });
});
