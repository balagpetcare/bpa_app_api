/**
 * Incident list filter query-builder tests. No Prisma or controller; runs with other governance tests.
 */

const { buildIncidentsWhereClause: buildWhere } = require("./incidentsListFilter");

describe("buildIncidentsWhereClause", () => {
  test("empty query returns empty where", () => {
    const where = buildWhere({});
    expect(where).toEqual({});
  });

  test("q searches reason and ticketId (case-insensitive)", () => {
    const where = buildWhere({ q: "foo" });
    expect(where.OR).toBeDefined();
    expect(Array.isArray(where.OR)).toBe(true);
    expect((where.OR as any[]).length).toBe(2);
    expect((where.OR as any[])[0]).toEqual({ reason: { contains: "foo", mode: "insensitive" } });
    expect((where.OR as any[])[1]).toEqual({ ticketId: { contains: "foo", mode: "insensitive" } });
  });

  test("q is trimmed and capped at 200 chars", () => {
    const long = "a".repeat(300);
    const where = buildWhere({ q: "  " + long + "  " });
    expect((where.OR as any[])[0].reason.contains).toHaveLength(200);
  });

  test("dateFrom sets createdAt.gte", () => {
    const where = buildWhere({ dateFrom: "2026-02-01" });
    expect(where.createdAt).toEqual({ gte: new Date("2026-02-01") });
  });

  test("dateTo sets createdAt.lte", () => {
    const where = buildWhere({ dateTo: "2026-02-28" });
    expect(where.createdAt).toEqual({ lte: new Date("2026-02-28") });
  });

  test("dateFrom and dateTo combine", () => {
    const where = buildWhere({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28T23:59:59Z",
    });
    expect(where.createdAt).toMatchObject({
      gte: new Date("2026-02-01"),
      lte: new Date("2026-02-28T23:59:59Z"),
    });
  });

  test("entityId + actionTaken combination", () => {
    const where = buildWhere({
      entityId: "42",
      actionTaken: "HIDDEN",
    });
    expect(where.entityId).toBe(42);
    expect(where.actionTaken).toBe("HIDDEN");
  });

  test("resolved true sets resolvedAt not null", () => {
    const where = buildWhere({ resolved: "true" });
    expect(where.resolvedAt).toEqual({ not: null });
  });

  test("resolved false sets resolvedAt null", () => {
    const where = buildWhere({ resolved: "false" });
    expect(where.resolvedAt).toBe(null);
  });

  test("resolved other value does not add resolvedAt", () => {
    const where = buildWhere({ resolved: "x" });
    expect(where.resolvedAt).toBeUndefined();
  });

  test("producerOrgId and entityType and incidentType and severity", () => {
    const where = buildWhere({
      producerOrgId: 1,
      entityType: "PRODUCT",
      incidentType: "POLICY_VIOLATION",
      severity: "HIGH",
    });
    expect(where.producerOrgId).toBe(1);
    expect(where.entityType).toBe("PRODUCT");
    expect(where.incidentType).toBe("POLICY_VIOLATION");
    expect(where.severity).toBe("HIGH");
  });

  test("all filters additive", () => {
    const where = buildWhere({
      producerOrgId: "5",
      entityId: 10,
      entityType: "BATCH",
      incidentType: "SUSPEND",
      severity: "MEDIUM",
      actionTaken: "FROZEN",
      resolved: "false",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      q: "ticket-123",
    });
    expect(where.producerOrgId).toBe(5);
    expect(where.entityId).toBe(10);
    expect(where.entityType).toBe("BATCH");
    expect(where.incidentType).toBe("SUSPEND");
    expect(where.severity).toBe("MEDIUM");
    expect(where.actionTaken).toBe("FROZEN");
    expect(where.resolvedAt).toBe(null);
    expect(where.createdAt).toMatchObject({
      gte: new Date("2026-01-01"),
      lte: new Date("2026-01-31"),
    });
    expect(where.OR).toBeDefined();
  });
});
