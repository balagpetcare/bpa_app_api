/**
 * Producer Governance smoke test.
 * Hits: producers list, producer detail, metrics, audit (with fromDate/toDate), print-jobs (with fromDate/toDate),
 * approvals (with producerOrgId), permissions registry.
 * Validates envelope shape (success, traceId) and non-empty traceId.
 *
 * Env: BASE_URL (default http://localhost:3000), ADMIN_TOKEN (required), ORG_ID (required).
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();
const ORG_ID = (process.env.ORG_ID || "").trim();

const api = (path: string, options: RequestInit = {}) => {
  const url = `${BASE_URL}/api/v1${path}`;
  const headers: Record<string, string> = { Accept: "application/json", ...(options.headers as Record<string, string>) };
  headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
  return fetch(url, { ...options, headers });
};

function assertEnvelope(body: any, label: string): void {
  if (typeof body !== "object" || body === null) throw new Error(`${label}: response is not an object`);
  if (typeof body.success !== "boolean") throw new Error(`${label}: missing or invalid 'success'`);
  if (body.traceId === undefined || body.traceId === null) throw new Error(`${label}: missing 'traceId'`);
  if (String(body.traceId).trim() === "") throw new Error(`${label}: traceId is empty`);
}

async function run(): Promise<void> {
  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN is required. Set env ADMIN_TOKEN to a valid Bearer token.");
    process.exit(1);
  }
  const orgIdNum = ORG_ID ? parseInt(ORG_ID, 10) : NaN;
  if (!ORG_ID || !Number.isFinite(orgIdNum) || orgIdNum <= 0) {
    console.error("ORG_ID is required and must be a positive integer. Set env ORG_ID.");
    process.exit(1);
  }
  const orgId = orgIdNum;
  const errors: string[] = [];

  const from = new Date();
  from.setDate(from.getDate() - 30);
  const to = new Date();
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  // 1) Producers list
  try {
    const r1 = await api("/admin/producers");
    const b1 = await r1.json().catch(() => ({}));
    assertEnvelope(b1, "GET /admin/producers");
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  // 2) Producer detail
  try {
    const r2 = await api(`/admin/producers/${orgId}`);
    const b2 = await r2.json().catch(() => ({}));
    assertEnvelope(b2, `GET /admin/producers/${orgId}`);
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  // 3) Metrics
  try {
    const r3 = await api(`/admin/producers/${orgId}/metrics`);
    const b3 = await r3.json().catch(() => ({}));
    assertEnvelope(b3, `GET /admin/producers/${orgId}/metrics`);
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  // 4) Audit with fromDate/toDate
  try {
    const r4 = await api(`/admin/producers/${orgId}/audit?limit=10&fromDate=${fromStr}&toDate=${toStr}`);
    const b4 = await r4.json().catch(() => ({}));
    assertEnvelope(b4, `GET /admin/producers/${orgId}/audit`);
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  // 5) Print-jobs with fromDate/toDate
  try {
    const r5 = await api(`/admin/producers/${orgId}/print-jobs?limit=10&fromDate=${fromStr}&toDate=${toStr}`);
    const b5 = await r5.json().catch(() => ({}));
    assertEnvelope(b5, `GET /admin/producers/${orgId}/print-jobs`);
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  // 6) Approvals with producerOrgId
  try {
    const rApp = await api(`/admin/approvals?producerOrgId=${orgId}`);
    const bApp = await rApp.json().catch(() => ({}));
    assertEnvelope(bApp, "GET /admin/approvals?producerOrgId=...");
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  // 7) Permissions registry
  try {
    const rPerm = await api("/admin/permissions");
    const bPerm = await rPerm.json().catch(() => ({}));
    assertEnvelope(bPerm, "GET /admin/permissions");
  } catch (e: any) {
    errors.push(String(e?.message || e));
  }

  if (errors.length > 0) {
    console.error("Smoke failures:");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }
  console.log("Governance smoke OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
