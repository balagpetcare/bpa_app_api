/**
 * API Test: Producer Org status gating
 *
 * Usage:
 *   npx ts-node scripts/test-producer-org-status.ts
 *
 * Env:
 *   API_BASE_URL (default http://localhost:3000)
 *   JWT_SECRET (required)
 */

import "dotenv/config";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const apiBase = String(process.env.API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  console.error("[TEST] ❌ JWT_SECRET is missing in .env");
  process.exit(1);
}

if (typeof fetch !== "function") {
  console.error("[TEST] ❌ fetch is not available. Please use Node 18+.");
  process.exit(1);
}

async function call(path: string, token: string) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

async function callPost(path: string, token: string, body?: any) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {}
  return { status: res.status, body: payload };
}

function signToken(userId: number) {
  return jwt.sign({ id: userId, perms: [] }, jwtSecret as string, { expiresIn: "1h" });
}

function assertStatus(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`[TEST] ${label} expected ${expected} but got ${actual}`);
  }
}

async function main() {
  console.log("[TEST] Producer org status gating");
  const now = Date.now();
  const email = `producer_status_${now}@test.local`;
  const username = `producer_status_${now}`;
  const passwordHash = await bcrypt.hash("test1234", 10);

  let userId: number | null = null;
  let orgId: number | null = null;
  let productId: number | null = null;
  let batchId: number | null = null;

  try {
    const user = await prisma.user.create({
      data: {
        auth: { create: { email, passwordHash } },
        profile: { create: { displayName: "Status Tester", username } },
        wallet: { create: { balance: 0.0, points: 0, tier: "Bronze", currency: "BDT" } },
      },
      select: { id: true },
    });
    userId = user.id;

    const org = await prisma.producerOrg.create({
      data: {
        ownerUserId: user.id,
        name: "Status Test Org",
        status: "PENDING",
        countryCode: "BD",
      },
      select: { id: true },
    });
    orgId = org.id;

    const token = signToken(user.id);

    const scenarios: Array<{ status: "PENDING" | "VERIFIED" | "SUSPENDED" }> = [
      { status: "PENDING" },
      { status: "VERIFIED" },
      { status: "SUSPENDED" },
    ];

    for (const s of scenarios) {
      await prisma.producerOrg.update({ where: { id: org.id }, data: { status: s.status } });
      console.log(`\n[TEST] Status: ${s.status}`);

      const products = await call("/api/v1/producer/products", token);
      const batches = await call("/api/v1/producer/batches?limit=1", token);
      const kyc = await call("/api/v1/producer/kyc/status", token);

      console.log(`  products: ${products.status}`);
      console.log(`  batches : ${batches.status}`);
      console.log(`  kyc     : ${kyc.status}`);

      if (s.status === "VERIFIED") {
        assertStatus("products", products.status, 200);
        assertStatus("batches", batches.status, 200);

        // Create product + batch for code generation tests
        const p = await callPost("/api/v1/producer/products", token, {
          brandName: "TestBrand",
          productName: "Test Product",
          sku: `SKU-${now}`,
        });
        assertStatus("create product", p.status, 201);
        productId = p.body?.data?.id || null;

        const b = await callPost(`/api/v1/producer/products/${productId}/batches`, token, {
          batchNo: `B-${now}`,
          qtyPlanned: 10,
        });
        assertStatus("create batch", b.status, 201);
        batchId = b.body?.data?.id || null;

        // Quantity limit check (over limit)
        const over = await callPost(`/api/v1/producer/batches/${batchId}/codes/generate`, token, {
          quantity: 11,
          length: 12,
        });
        assertStatus("generate over limit", over.status, 400);

        // Valid generate with custom prefix/suffix
        const gen = await callPost(`/api/v1/producer/batches/${batchId}/codes/generate`, token, {
          quantity: 3,
          length: 12,
          prefix: "ABC",
          suffix: "01",
        });
        assertStatus("generate codes", gen.status, 200);

        const codes = gen.body?.data?.codes || [];
        const sample = codes[0];
        if (!sample || !String(sample).startsWith("ABC") || !String(sample).endsWith("01")) {
          throw new Error("[TEST] code format mismatch");
        }

        // Search code
        const search = await call(`/api/v1/producer/codes/search?code=${encodeURIComponent(sample)}`, token);
        assertStatus("search code", search.status, 200);
      } else {
        assertStatus("products", products.status, 403);
        assertStatus("batches", batches.status, 403);
      }
      assertStatus("kyc.status", kyc.status, 200);
    }

    console.log("\n[TEST] ✅ All status checks passed.");
  } finally {
    if (batchId) {
      await prisma.authBatch.delete({ where: { id: batchId } }).catch(() => null);
    }
    if (productId) {
      await prisma.authProduct.delete({ where: { id: productId } }).catch(() => null);
    }
    if (orgId) {
      await prisma.producerOrg.delete({ where: { id: orgId } }).catch(() => null);
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[TEST] ❌ Failed:", e?.message || e);
  process.exit(1);
});
