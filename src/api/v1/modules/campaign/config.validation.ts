/**
 * Validation schemas for Campaign Configuration Engine
 */

import { z } from "zod";

export const campaignConfigSchema = z.object({
  bookingEnabled: z.boolean().optional(),
  onlinePaymentEnabled: z.boolean().optional(),
  payAtVenueEnabled: z.boolean().optional(),
  walkInAllowed: z.boolean().optional(),
  approvalRequired: z.boolean().optional(),
  slotRequired: z.boolean().optional(),
  autoCloseWhenFull: z.boolean().optional(),
  maxCapacity: z.number().int().min(0).max(1000000).optional(),
  maxCatsPerBooking: z.number().int().min(1).max(20).optional(),
  showRemainingSlots: z.boolean().optional(),
  lateBookingAllowed: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.onlinePaymentEnabled === false && data.payAtVenueEnabled === false && data.bookingEnabled === true) {
      return true; // allow — admin may intentionally disable both temporarily
    }
    return true;
  },
  { message: "At least one payment method should be enabled when booking is active" },
);

export const campaignConfigHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
