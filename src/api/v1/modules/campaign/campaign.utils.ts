/**
 * Campaign Module Utilities
 * Common helper functions for the vaccination campaign
 */

import { randomBytes, createHash } from "crypto";
import { CampaignError } from "./campaign.errors";

/** Normalize Express route/query param to a single string. */
export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Parse a positive integer route param (e.g. CampaignSlot.id).
 * Rejects NaN, zero, negatives, and missing values before Prisma calls.
 */
export function parseRouteIdParam(
  paramName: string,
  raw: string | string[] | undefined,
  entityLabel = "ID"
): number {
  const str = routeParam(raw).trim();
  if (!str) {
    throw new CampaignError(
      "INVALID_ROUTE_PARAM",
      `Missing route parameter '${paramName}'`,
      400,
      { param: paramName }
    );
  }
  const id = Number.parseInt(str, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CampaignError(
      "INVALID_ROUTE_PARAM",
      `Invalid ${entityLabel}: '${str}' is not a positive integer`,
      400,
      { param: paramName, value: str }
    );
  }
  return id;
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a unique booking reference (e.g., "VAC-ABC123")
 */
export function generateBookingRef(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars I,O,0,1
  let code = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `VAC-${code}`;
}

/**
 * Generate a QR token (32-char hex string)
 */
export function generateQrToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Generate a certificate token (e.g., "CERT-ABCD12345678")
 */
export function generateCertificateToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "";
  const bytes = randomBytes(12);
  for (let i = 0; i < 12; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `CERT-${code}`;
}

/**
 * Generate a queue number (e.g., "A042" for slot A, position 42)
 */
export function generateQueueNumber(prefix: string, position: number): string {
  return `${prefix}${position.toString().padStart(3, "0")}`;
}

/**
 * Generate a 6-digit OTP
 */
export function generateOtp(): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1000000;
  return num.toString().padStart(6, "0");
}

// ============================================================================
// Phone Validation
// ============================================================================

/**
 * Validate Bangladesh phone number format
 * Accepts: 01712345678, +8801712345678, 8801712345678
 */
export function isValidBdPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s-]/g, "");
  return /^(\+?880)?01[3-9]\d{8}$/.test(cleaned);
}

/**
 * Normalize phone to standard format (01XXXXXXXXX)
 */
export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s-]/g, "");
  
  if (cleaned.startsWith("+880")) {
    return "0" + cleaned.slice(4);
  }
  if (cleaned.startsWith("880")) {
    return "0" + cleaned.slice(3);
  }
  if (cleaned.startsWith("01")) {
    return cleaned;
  }
  
  return cleaned;
}

/**
 * Mask phone number for display (01712***678)
 */
export function maskPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.length >= 8) {
    return `${normalized.slice(0, 5)}***${normalized.slice(-3)}`;
  }
  return normalized;
}

// ============================================================================
// Date/Time Utilities
// ============================================================================

/**
 * Get start of day in local timezone
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day in local timezone
 */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Add hours to a date
 */
export function addHours(date: Date, hours: number): Date {
  const d = new Date(date);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Format time as HH:MM
 */
export function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

/**
 * Parse time string to minutes from midnight
 */
export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is in the past
 */
export function isInPast(date: Date): boolean {
  return date < startOfDay(new Date());
}

/**
 * Get difference in hours between two dates
 */
export function diffInHours(date1: Date, date2: Date): number {
  return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60);
}

// ============================================================================
// Text Utilities
// ============================================================================

/**
 * Sanitize text input
 */
export function sanitizeText(text: string): string {
  return text
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 1000);
}

/**
 * Generate URL-friendly slug
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Capitalize first letter of each word
 */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Generate SHA256 hash
 */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Generate idempotency key for operations
 */
export function generateIdempotencyKey(prefix: string, ...parts: (string | number)[]): string {
  const data = [prefix, ...parts].join(":");
  return sha256(data);
}

// ============================================================================
// Queue Utilities
// ============================================================================

/**
 * Get queue prefix from slot time (A for morning, P for afternoon)
 */
export function getQueuePrefix(startTime: string): string {
  const hour = parseInt(startTime.split(":")[0], 10);
  if (hour < 12) return "A";
  if (hour < 17) return "P";
  return "E";
}

/**
 * Calculate estimated wait time based on position and avg service time
 */
export function estimateWaitTime(position: number, avgServiceMinutes: number = 5): number {
  return Math.max(0, (position - 1) * avgServiceMinutes);
}

// ============================================================================
// SMS Template Utilities
// ============================================================================

/**
 * Replace template placeholders with values
 * Template format: "Hello {{name}}, your booking is {{ref}}"
 */
export function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate time format (HH:MM)
 */
export function isValidTimeFormat(time: string): boolean {
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

/**
 * Check if end time is after start time
 */
export function isValidTimeRange(startTime: string, endTime: string): boolean {
  return parseTimeToMinutes(endTime) > parseTimeToMinutes(startTime);
}
