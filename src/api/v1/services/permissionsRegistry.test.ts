/**
 * Minimal tests: grouped permissions registry and DTO envelope shape (traceId).
 */

const { getGroupedRegistry } = require("./permissionsRegistry.service");

describe("permissionsRegistry.service", () => {
  test("getGroupedRegistry returns grouped permissions", () => {
    const groups = getGroupedRegistry();
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    const governance = groups.find((g) => g.group === "Governance");
    expect(governance).toBeDefined();
    expect(governance.permissions.length).toBeGreaterThan(0);
    const first = governance.permissions[0];
    expect(first).toMatchObject({
      key: expect.any(String),
      label: expect.any(String),
      group: "Governance",
      description: expect.any(String),
      scope: expect.stringMatching(/^(admin|producer|both)$/),
    });
  });

  test("each permission has key, label, group, description, scope", () => {
    const groups = getGroupedRegistry();
    for (const { group, permissions } of groups) {
      for (const p of permissions) {
        expect(p).toHaveProperty("key", expect.any(String));
        expect(p).toHaveProperty("label", expect.any(String));
        expect(p).toHaveProperty("group", group);
        expect(p).toHaveProperty("description", expect.any(String));
        expect(["admin", "producer", "both"]).toContain(p.scope);
      }
    }
  });
});

describe("GET /admin/permissions envelope", () => {
  test("response shape includes traceId and success envelope fields", () => {
    const { getTraceId, successEnvelope } = require("../utils/governanceResponses");
    const req = { headers: { "x-trace-id": "trc_test_123" } };
    const traceId = getTraceId(req);
    const groups = getGroupedRegistry();
    const body = successEnvelope({ groups }, "Human-readable permissions registry", "OK", traceId);
    expect(body).toMatchObject({
      success: true,
      code: "OK",
      message: "Human-readable permissions registry",
      traceId: "trc_test_123",
      data: { groups: expect.any(Array) },
    });
    expect(body.data.groups.length).toBeGreaterThan(0);
  });
});
