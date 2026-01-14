import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { authRoutes } from "./routes/auth.routes";
import { partnerRoutes } from "./routes/partner.routes";
import { adminRoutes } from "./routes/admin.routes";

dotenv.config();

export function makeApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/v1/auth", authRoutes());
  app.use("/api/v1/partner", partnerRoutes());
  app.use("/api/v1/admin", adminRoutes());

  app.use((err: any, _req: any, res: any, _next: any) => {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ success: false, error: { message: "Internal Server Error" } });
  });

  return app;
}
