import { z } from "zod";

const MAX_DAYS_SPAN = 180;

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

export const dashboardDateRangeSchema = z
  .object({
    dateFrom: isoDateString,
    dateTo: isoDateString,
    branchId: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (data) => {
      const from = new Date(data.dateFrom);
      const to = new Date(data.dateTo);
      return from <= to;
    },
    { message: "dateTo must be >= dateFrom", path: ["dateTo"] }
  )
  .refine(
    (data) => {
      const from = new Date(data.dateFrom);
      const to = new Date(data.dateTo);
      const days = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
      return days <= MAX_DAYS_SPAN;
    },
    { message: `Date range must not exceed ${MAX_DAYS_SPAN} days`, path: ["dateTo"] }
  );

export const dashboardTopProductsSchema = dashboardDateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type DashboardDateRangeInput = z.infer<typeof dashboardDateRangeSchema>;
export type DashboardTopProductsInput = z.infer<typeof dashboardTopProductsSchema>;
