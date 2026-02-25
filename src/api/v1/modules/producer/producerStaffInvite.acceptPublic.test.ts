describe("producer staff invite accept-public", () => {
  test("creates user and activates staff membership", async () => {
    jest.resetModules();

    const invite = {
      id: 10,
      producerOrgId: 7,
      invitedByUserId: 1,
      roleId: 2,
      tokenHash: "x",
      expiresAt: new Date(Date.now() + 60_000),
      status: "SENT",
      email: "staff@example.com",
      phone: null,
      producerOrg: { name: "Org" },
      role: { id: 2 },
    };

    const tx: any = {
      userAuth: { update: jest.fn() },
      user: {
        create: jest.fn().mockResolvedValue({ id: 123, auth: { email: "staff@example.com" }, profile: { displayName: "S" } }),
        findUnique: jest.fn().mockResolvedValue({
          id: 123,
          tokenVersion: 0,
          auth: { email: "staff@example.com", phone: null },
          profile: { displayName: "Staff", username: "staff" },
        }),
      },
      producerOrgStaff: { upsert: jest.fn() },
      producerStaffInvite: { update: jest.fn() },
    };

    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => ({
      producerStaffInvite: { findFirst: jest.fn().mockResolvedValue(invite) },
      userAuth: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
    }));

    const auditPath = require.resolve("./producerAudit");
    jest.doMock(auditPath, () => ({ writeProducerAudit: jest.fn().mockResolvedValue(undefined) }));

    const svc = require("./producerStaffInvite.service");

    const result = await svc.acceptStaffInvitePublic({
      token: "token",
      password: "pass1234",
      name: "Staff",
    });

    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.producerOrgStaff.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ producerOrgId: 7, userId: 123, status: "ACTIVE" }),
      })
    );
    expect(tx.producerStaffInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10 }, data: expect.objectContaining({ status: "ACCEPTED", acceptedByUserId: 123 }) })
    );
    expect(result.user.id).toBe(123);
    expect(result.producerOrgId).toBe(7);
  });
});
