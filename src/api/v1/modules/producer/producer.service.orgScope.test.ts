describe("producer service org scoping", () => {
  test("listProducts scopes by producerOrgId", async () => {
    jest.resetModules();

    const mockPrisma = {
      authProduct: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => mockPrisma);

    const svc = require("./producer.service");

    await svc.listProducts(5);

    expect(mockPrisma.authProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { producerOrgId: 5 } })
    );
  });
});

