/**
 * Unit tests for org-scoped inventory locations listing (owner stock request source picker).
 */
const service = require("./inventory.service");

jest.mock("../../../../infrastructure/db/prismaClient", () => {
  const organization = { findFirst: jest.fn(), findMany: jest.fn() };
  const branchMember = { findFirst: jest.fn() };
  const branch = { findMany: jest.fn() };
  const inventoryLocation = { findMany: jest.fn() };
  const mock = { organization, branchMember, branch, inventoryLocation };
  return { __esModule: true, default: mock, ...mock };
});

const prisma = require("../../../../infrastructure/db/prismaClient");

describe("getInventoryLocations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws FORBIDDEN_ORG when orgId is set and user neither owns nor is member of org", async () => {
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.branchMember.findFirst.mockResolvedValue(null);
    await expect(service.getInventoryLocations(99, { orgId: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN_ORG",
    });
  });

  it("when orgId is set and user owns org, loads locations only for branches in that org", async () => {
    prisma.organization.findFirst.mockResolvedValue({ id: 5 });
    prisma.branch.findMany.mockResolvedValue([{ id: 10 }]);
    prisma.inventoryLocation.findMany.mockResolvedValue([{ id: 7, name: "Central Hub" }]);

    const r = await service.getInventoryLocations(1, { orgId: 5 });

    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where: { orgId: 5 },
      select: { id: true },
    });
    expect(prisma.inventoryLocation.findMany).toHaveBeenCalled();
    expect(r).toEqual([{ id: 7, name: "Central Hub" }]);
  });

  it("when orgId omitted, unions branches from all owned orgs", async () => {
    prisma.branchMember.findFirst.mockResolvedValue(null);
    prisma.organization.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.branch.findMany.mockResolvedValue([{ id: 100 }, { id: 200 }]);
    prisma.inventoryLocation.findMany.mockResolvedValue([]);

    await service.getInventoryLocations(42, undefined);

    expect(prisma.organization.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 42 },
      select: { id: true },
    });
    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where: { orgId: { in: [1, 2] } },
      select: { id: true },
    });
  });

  it("when orgId is set and user is active branch member of org, allows listing", async () => {
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.branchMember.findFirst.mockResolvedValue({ id: 1 });
    prisma.branch.findMany.mockResolvedValue([{ id: 20 }]);
    prisma.inventoryLocation.findMany.mockResolvedValue([{ id: 3 }]);

    const r = await service.getInventoryLocations(7, { orgId: 9 });

    expect(r).toEqual([{ id: 3 }]);
    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where: { orgId: 9 },
      select: { id: true },
    });
  });
});
