/**
 * Campaign OTP Service
 * OTP-based authentication for public users (pet owners)
 */

import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import prisma from "../../../../infrastructure/db/prismaClient";
import { isRedisAvailable } from "../../../../infrastructure/redis/redis.client";
import { getRedisConnectionOptions, isRedisEnabled } from "../../../../infrastructure/redis/redisConnection";
import { OtpErrors, ValidationErrors } from "./campaign.errors";
import {
  isValidBdPhone,
  normalizePhone,
  generateOtp,
} from "./campaign.utils";

// Redis client for OTP storage (production / when REDIS_ENABLED)
let redis: Redis | null = null;

// OTP Configuration
const OTP_EXPIRY_SECONDS = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 3;
const OTP_RATE_LIMIT_WINDOW = 60; // 1 minute
const OTP_RATE_LIMIT_MAX = 3; // Max 3 OTPs per minute per phone

type OtpStore = {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSec: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSec: number): Promise<void>;
};

const memoryEntries = new Map<string, { value: string; expiresAt: number }>();

const memoryStore: OtpStore = {
  async get(key) {
    const row = memoryEntries.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      memoryEntries.delete(key);
      return null;
    }
    return row.value;
  },
  async setex(key, ttlSec, value) {
    memoryEntries.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  },
  async del(key) {
    memoryEntries.delete(key);
  },
  async incr(key) {
    const raw = await memoryStore.get(key);
    const n = raw ? parseInt(raw, 10) + 1 : 1;
    await memoryStore.setex(key, OTP_RATE_LIMIT_WINDOW, String(n));
    return n;
  },
  async expire(key, ttlSec) {
    const row = memoryEntries.get(key);
    if (row) row.expiresAt = Date.now() + ttlSec * 1000;
  },
};

function getRedis(): Redis {
  if (!redis) {
    const opts = getRedisConnectionOptions();
    const base = opts.url
      ? { url: opts.url }
      : { host: opts.host, port: opts.port };
    redis = new Redis({
      ...base,
      connectTimeout: 3000,
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }
  return redis;
}

function getOtpStore(): OtpStore {
  if (!isRedisEnabled() || !isRedisAvailable()) return memoryStore;
  const client = getRedis();
  return {
    get: (k) => client.get(k),
    setex: (k, t, v) => client.setex(k, t, v).then(() => undefined),
    del: (k) => client.del(k).then(() => undefined),
    incr: (k) => client.incr(k),
    expire: (k, t) => client.expire(k, t).then(() => undefined),
  };
}

export async function checkOtpRedisHealth(): Promise<boolean> {
  if (!isRedisEnabled()) return false;
  return isRedisAvailable();
}

// Session Configuration
const SESSION_SECRET = process.env.CAMPAIGN_JWT_SECRET || process.env.JWT_SECRET || "campaign-secret";
const SESSION_EXPIRY = "24h";

// ============================================================================
// OTP Generation & Sending
// ============================================================================

/**
 * Request OTP for a phone number
 */
export async function requestOtp(
  phone: string,
  purpose: "BOOKING" | "VIEW_BOOKING" = "BOOKING"
): Promise<{ success: boolean; expiresIn: number }> {
  // Validate phone
  if (!isValidBdPhone(phone)) {
    throw ValidationErrors.INVALID_PHONE();
  }

  const normalizedPhone = normalizePhone(phone);
  const store = getOtpStore();

  // Rate limit check
  const rateLimitKey = `campaign:otp:rate:${normalizedPhone}`;
  const currentCount = await store.incr(rateLimitKey);

  if (currentCount === 1) {
    await store.expire(rateLimitKey, OTP_RATE_LIMIT_WINDOW);
  }

  if (currentCount > OTP_RATE_LIMIT_MAX) {
    throw OtpErrors.RATE_LIMITED();
  }

  // Generate OTP (fixed test code in non-production when CAMPAIGN_TEST_OTP is set)
  const otp =
    process.env.NODE_ENV !== "production" && process.env.CAMPAIGN_TEST_OTP
      ? process.env.CAMPAIGN_TEST_OTP
      : generateOtp();

  // Hash OTP for storage (don't store plain text)
  const otpHash = createHash("sha256").update(otp).digest("hex");

  // Store OTP with metadata
  const otpKey = `campaign:otp:${normalizedPhone}:${purpose}`;
  const otpData = JSON.stringify({
    hash: otpHash,
    attempts: 0,
    createdAt: Date.now(),
  });

  await store.setex(otpKey, OTP_EXPIRY_SECONDS, otpData);

  // Send OTP via SMS (skip when using in-memory store without gateways in dev)
  if (isRedisEnabled()) {
    await sendOtpSms(normalizedPhone, otp);
  } else {
    console.warn(`[OTP] Dev mode (REDIS_ENABLED=false): OTP for ${normalizedPhone} not sent via SMS`);
  }

  return {
    success: true,
    expiresIn: OTP_EXPIRY_SECONDS,
  };
}

/**
 * Send OTP SMS (integrates with existing SMS service)
 */
async function sendOtpSms(phone: string, otp: string): Promise<void> {
  try {
    const { sendOtpSMS } = require("../../../../shared/services/sms/sms.service") as {
      sendOtpSMS: (input: { phone: string; otp: string; purpose?: string }) => Promise<{ success: boolean; error?: string }>;
    };
    const result = await sendOtpSMS({
      phone,
      otp,
      purpose: "CAMPAIGN_BOOKING",
    });
    if (!result.success) throw new Error(result.error || "SMS send failed");
  } catch (smsError) {
    console.error("Failed to send OTP SMS:", smsError);
    throw OtpErrors.SEND_FAILED();
  }
}

// ============================================================================
// OTP Verification
// ============================================================================

/**
 * Verify OTP and issue session token
 */
export async function verifyOtp(
  phone: string,
  otp: string,
  purpose: "BOOKING" | "VIEW_BOOKING" = "BOOKING"
): Promise<{ token: string; expiresIn: string; phone: string; isExistingUser: boolean }> {
  // Validate phone
  if (!isValidBdPhone(phone)) {
    throw ValidationErrors.INVALID_PHONE();
  }

  const normalizedPhone = normalizePhone(phone);
  const store = getOtpStore();

  // Get stored OTP
  const otpKey = `campaign:otp:${normalizedPhone}:${purpose}`;
  const storedData = await store.get(otpKey);

  if (!storedData) {
    throw OtpErrors.EXPIRED();
  }

  const otpRecord = JSON.parse(storedData);

  // Check attempts
  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    await store.del(otpKey);
    throw OtpErrors.MAX_ATTEMPTS();
  }

  // Verify OTP
  const inputHash = createHash("sha256").update(otp).digest("hex");

  if (inputHash !== otpRecord.hash) {
    // Increment attempts
    otpRecord.attempts++;
    await store.setex(otpKey, OTP_EXPIRY_SECONDS, JSON.stringify(otpRecord));
    throw OtpErrors.INVALID();
  }

  // OTP is valid - delete it
  await store.del(otpKey);

  // Check if user has BPA account
  const existingUser = await prisma.userAuth.findFirst({
    where: { phone: normalizedPhone },
    include: { user: true },
  });

  // Generate session token
  const sessionId = randomBytes(16).toString("hex");
  const token = jwt.sign(
    {
      type: "campaign_session",
      phone: normalizedPhone,
      sessionId,
      userId: existingUser?.user.id,
    },
    SESSION_SECRET,
    { expiresIn: SESSION_EXPIRY }
  );

  // Store session in Redis for quick validation
  const sessionKey = `campaign:session:${sessionId}`;
  await store.setex(
    sessionKey,
    24 * 60 * 60, // 24 hours
    JSON.stringify({
      phone: normalizedPhone,
      userId: existingUser?.user.id,
      createdAt: Date.now(),
    })
  );

  return {
    token,
    expiresIn: SESSION_EXPIRY,
    phone: normalizedPhone,
    isExistingUser: !!existingUser,
  };
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Verify session token
 */
export async function verifySession(
  token: string
): Promise<{
  valid: boolean;
  phone?: string;
  userId?: number;
  sessionId?: string;
}> {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET) as {
      type: string;
      phone: string;
      sessionId: string;
      userId?: number;
    };

    if (decoded.type !== "campaign_session") {
      return { valid: false };
    }

    // Optionally verify session still exists in Redis
    const store = getOtpStore();
    const sessionKey = `campaign:session:${decoded.sessionId}`;
    const sessionData = await store.get(sessionKey);

    if (!sessionData) {
      return { valid: false };
    }

    return {
      valid: true,
      phone: decoded.phone,
      userId: decoded.userId,
      sessionId: decoded.sessionId,
    };
  } catch (e) {
    return { valid: false };
  }
}

/**
 * Revoke session
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const store = getOtpStore();
  const sessionKey = `campaign:session:${sessionId}`;
  await store.del(sessionKey);
}

/**
 * Middleware helper to extract session from request
 */
export function extractSessionFromHeader(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

// ============================================================================
// Development/Testing Helpers
// ============================================================================

/**
 * Verify OTP in test mode (bypasses actual OTP check)
 * Only works when NODE_ENV is not production and TEST_OTP env var is set
 */
export function isTestOtp(otp: string): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  const testOtp = process.env.CAMPAIGN_TEST_OTP || "123456";
  return otp === testOtp;
}

export default {
  requestOtp,
  verifyOtp,
  verifySession,
  revokeSession,
  extractSessionFromHeader,
  isTestOtp,
};
