/**
 * Alias mount: /api/v1/producer-print/*
 * Single route: GET /issuances/:issuanceId/download (same controller as producer/print/issuances/:issuanceId/download).
 * Uses same auth + producer.batches.read. Reuses downloadPrintIssuance -> downloadIssuanceSerials().
 */
const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const { requireProducerPermission } = require("../../middlewares/producerAuth");
const ctrl = require("./producer.controller");

router.get(
  "/issuances/:issuanceId/download",
  auth,
  requireProducerPermission(["producer.batches.read"]),
  ctrl.downloadPrintIssuance
);

export default router;
