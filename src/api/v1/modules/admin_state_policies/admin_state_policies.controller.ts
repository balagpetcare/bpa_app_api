import { Prisma } from "@prisma/client";
const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeatureCode(v) {
  return String(v || "").trim().toUpperCase();
}

exports.listByState = async (req, res) => {
  try {
    const stateId = toInt(req.params?.stateId);
    if (!stateId) return res.status(400).json({ success: false, message: "Invalid stateId" });

    const rows = await prisma.statePolicy.findMany({
      where: { stateId },
      orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
      include: {
        features: { select: { id: true, featureCode: true, enabled: true } },
        rules: { select: { id: true, ruleKey: true, enabled: true, valueJson: true } },
      },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("admin_state_policies.listByState error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const stateId = toInt(req.params?.stateId);
    if (!stateId) return res.status(400).json({ success: false, message: "Invalid stateId" });

    const name = String(req.body?.name || "").trim() || "Draft State Policy";
    const status = String(req.body?.status || "DRAFT").toUpperCase();

    const row = await prisma.statePolicy.create({
      data: {
        stateId,
        name,
        status,
        effectiveFrom: req.body?.effectiveFrom ? new Date(req.body.effectiveFrom) : new Date(),
        effectiveTo: req.body?.effectiveTo ? new Date(req.body.effectiveTo) : null,
      },
    });
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_POLICY_CREATE",
      entityType: "STATE_POLICY",
      entityId: row.id,
      before: null,
      after: row,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error("admin_state_policies.create error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const data: Prisma.StatePolicyUpdateInput = {};
    if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body?.status !== undefined) {
      const status = String(req.body.status).toUpperCase();
      if (status === "ACTIVE") {
        return res.status(400).json({ success: false, message: "Use /activate to set ACTIVE" });
      }
      data.status = status;
    }
    if (req.body?.effectiveFrom !== undefined) data.effectiveFrom = new Date(req.body.effectiveFrom);
    if (req.body?.effectiveTo !== undefined) data.effectiveTo = req.body.effectiveTo ? new Date(req.body.effectiveTo) : null;

    const row = await prisma.statePolicy.update({ where: { id }, data });
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_POLICY_UPDATE",
      entityType: "STATE_POLICY",
      entityId: row.id,
      before: null,
      after: row,
    });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("admin_state_policies.update error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.activate = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const policy = await prisma.statePolicy.findUnique({ where: { id } });
    if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

    const result = await prisma.$transaction(async (tx) => {
      await tx.statePolicy.updateMany({
        where: { stateId: policy.stateId, status: "ACTIVE" },
        data: { status: "ARCHIVED" },
      });
      return tx.statePolicy.update({
        where: { id },
        data: { status: "ACTIVE", effectiveFrom: new Date() },
      });
    });

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_POLICY_ACTIVATE",
      entityType: "STATE_POLICY",
      entityId: result.id,
      before: null,
      after: result,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("admin_state_policies.activate error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.replaceFeatures = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const policy = await prisma.statePolicy.findUnique({ where: { id } });
    if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

    const payload = req.body?.features || req.body;
    let items = [];
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && typeof payload === "object") {
      items = Object.keys(payload).map((key) => ({ featureCode: key, enabled: !!payload[key] }));
    }

    for (const it of items) {
      const code = normalizeFeatureCode(it.featureCode);
      if (!code) continue;
      await prisma.statePolicyFeature.upsert({
        where: { statePolicyId_featureCode: { statePolicyId: id, featureCode: code } },
        update: { enabled: !!it.enabled },
        create: { statePolicyId: id, featureCode: code, enabled: !!it.enabled },
      });
    }

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_POLICY_FEATURES_UPDATE",
      entityType: "STATE_POLICY",
      entityId: id,
      before: null,
      after: { updated: true },
    });

    return res.json({ success: true, message: "Features updated" });
  } catch (e) {
    console.error("admin_state_policies.replaceFeatures error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.replaceRules = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const policy = await prisma.statePolicy.findUnique({ where: { id } });
    if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

    const payload = req.body?.rules || req.body;
    let items = [];
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && typeof payload === "object") {
      items = Object.keys(payload).map((key) => ({ ruleKey: key, valueJson: payload[key], enabled: true }));
    }

    for (const it of items) {
      const key = String(it.ruleKey || "").trim();
      if (!key) continue;
      await prisma.statePolicyRule.upsert({
        where: { statePolicyId_ruleKey: { statePolicyId: id, ruleKey: key } },
        update: { enabled: it.enabled !== undefined ? !!it.enabled : true, valueJson: it.valueJson ?? null },
        create: { statePolicyId: id, ruleKey: key, enabled: it.enabled !== undefined ? !!it.enabled : true, valueJson: it.valueJson ?? null },
      });
    }

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_POLICY_RULES_UPDATE",
      entityType: "STATE_POLICY",
      entityId: id,
      before: null,
      after: { updated: true },
    });

    return res.json({ success: true, message: "Rules updated" });
  } catch (e) {
    console.error("admin_state_policies.replaceRules error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

