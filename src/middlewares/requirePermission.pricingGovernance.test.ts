const requirePermission = require("./requirePermission");

describe("requirePermission — pricing governance", () => {
  function run(permissions: string[], ...required: string[]) {
    const req: any = { user: { id: 1, permissions } };
    const res: any = {
      statusCode: 0,
      body: null as any,
      locals: {} as any,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(j: any) {
        this.body = j;
        return this;
      },
    };
    const next = jest.fn();
    requirePermission(...required)(req, res, next);
    return { next, res };
  }

  test("PATCH policy requires pricing.central.write", () => {
    const ok = run(["pricing.central.write"], "pricing.central.write");
    expect(ok.next).toHaveBeenCalled();

    const denied = run(["org.read", "pricing.audit.view"], "pricing.central.write");
    expect(denied.next).not.toHaveBeenCalled();
    expect(denied.res.statusCode).toBe(403);
    expect(denied.res.body?.code).toBe("MISSING_PERMISSION");
  });

  test("GET policy guard accepts org.read, audit.view, or central.read", () => {
    const keys = ["pricing.central.read", "pricing.audit.view", "org.read"];
    expect(run(["org.read"], ...keys).next).toHaveBeenCalled();
    expect(run(["pricing.audit.view"], ...keys).next).toHaveBeenCalled();
    expect(run(["pricing.central.read"], ...keys).next).toHaveBeenCalled();
    expect(run(["inventory.read"], ...keys).next).not.toHaveBeenCalled();
  });
});
