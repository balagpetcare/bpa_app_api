import jwt from "jsonwebtoken";

describe("auth middleware tokenVersion", () => {
  test("rejects when tokenVersion mismatches", async () => {
    process.env.JWT_SECRET = "test_secret";
    jest.resetModules();

    const prismaPath = require.resolve("../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => ({
      user: { findUnique: jest.fn().mockResolvedValue({ tokenVersion: 2 }) },
    }));

    const appConfig = require("../config/appConfig");
    const authMiddleware = require("./auth.middleware");

    const token = jwt.sign({ id: 123, tv: 1, perms: [] }, appConfig.jwt.secret, { expiresIn: "1h" });

    const req: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Unauthorized: token revoked" });
    expect(next).not.toHaveBeenCalled();
  });
});

