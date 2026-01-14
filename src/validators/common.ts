import { z } from "zod";

export const phoneSchema = z.string().min(10).max(20);
export const passwordSchema = z.string().min(6).max(100);
