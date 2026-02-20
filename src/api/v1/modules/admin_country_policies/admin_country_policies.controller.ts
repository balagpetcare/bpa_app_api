import { Prisma } from "@prisma/client";
const prisma = require("../../../../infrastructure/db/prismaClient");
const { invalidatePolicyCache } = require("../../services/policyEngine.service");
const { writeAudit } = require("../../../../middlewares/auditWriter");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeatureCode(v) {
  return String(v || "").trim().toUpperCase();
}

exports.listByCountry = async (req, res) => {
  try {
    const countryId = toInt(req.params?.countryId);
    if (!countryId) return res.status(400).json({ success: false, message: "Invalid countryId" });

    const rows = await prisma.countryPolicy.findMany({
      where: { countryId },
      orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
      include: {
        features: { select: { id: true, featureCode: true, enabled: true } },
        donationRules: { select: { id: true, ruleType: true, enabled: true, maxAmountSingle: true, maxAmountDaily: true } },
        paymentMethods: { select: { id: true, providerCode: true, enabled: true, sortOrder: true } },
        rules: { select: { id: true, ruleKey: true, enabled: true, valueJson: true } },
      },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("admin_country_policies.listByCountry error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const countryId = toInt(req.params?.countryId);
    if (!countryId) return res.status(400).json({ success: false, message: "Invalid countryId" });

    const name = String(req.body?.name || "").trim() || "Draft Policy";
    const status = String(req.body?.status || "DRAFT").toUpperCase();

    const row = await prisma.countryPolicy.create({
      data: {
        countryId,
        name,
        status,
        effectiveFrom: req.body?.effectiveFrom ? new Date(req.body.effectiveFrom) : new Date(),
        effectiveTo: req.body?.effectiveTo ? new Date(req.body.effectiveTo) : null,
      },
    });

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_POLICY_CREATE",
      entityType: "COUNTRY_POLICY",
      entityId: row.id,
      before: null,
      after: row,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error("admin_country_policies.create error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const data: Prisma.CountryPolicyUpdateInput = {};
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

    const row = await prisma.countryPolicy.update({ where: { id }, data });
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_POLICY_UPDATE",
      entityType: "COUNTRY_POLICY",
      entityId: row.id,
      before: null,
      after: row,
    });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("admin_country_policies.update error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.activate = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const policy = await prisma.countryPolicy.findUnique({ where: { id } });
    if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

    const result = await prisma.$transaction(async (tx) => {
      await tx.countryPolicy.updateMany({
        where: { countryId: policy.countryId, status: "ACTIVE" },
        data: { status: "ARCHIVED" },
      });
      return tx.countryPolicy.update({
        where: { id },
        data: { status: "ACTIVE", effectiveFrom: new Date() },
      });
    });

    const country = await prisma.country.findUnique({ where: { id: policy.countryId } });
    if (country?.code) await invalidatePolicyCache(country.code);

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_POLICY_ACTIVATE",
      entityType: "COUNTRY_POLICY",
      entityId: result.id,
      before: null,
      after: result,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("admin_country_policies.activate error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.replaceFeatures = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const policy = await prisma.countryPolicy.findUnique({ where: { id } });
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
      await prisma.policyFeature.upsert({
        where: { countryPolicyId_featureCode: { countryPolicyId: id, featureCode: code } },
        update: { enabled: !!it.enabled },
        create: { countryPolicyId: id, featureCode: code, enabled: !!it.enabled },
      });
    }

    const country = await prisma.country.findUnique({ where: { id: policy.countryId } });
    if (country?.code) await invalidatePolicyCache(country.code);

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_POLICY_FEATURES_UPDATE",
      entityType: "COUNTRY_POLICY",
      entityId: id,
      before: null,
      after: { updated: true },
    });

    return res.json({ success: true, message: "Features updated" });
  } catch (e) {
    console.error("admin_country_policies.replaceFeatures error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.replaceRules = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid policy id" });

    const policy = await prisma.countryPolicy.findUnique({ where: { id } });
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
      await prisma.policyRule.upsert({
        where: { countryPolicyId_ruleKey: { countryPolicyId: id, ruleKey: key } },
        update: { enabled: it.enabled !== undefined ? !!it.enabled : true, valueJson: it.valueJson ?? null },
        create: { countryPolicyId: id, ruleKey: key, enabled: it.enabled !== undefined ? !!it.enabled : true, valueJson: it.valueJson ?? null },
      });
    }

    const country = await prisma.country.findUnique({ where: { id: policy.countryId } });
    if (country?.code) await invalidatePolicyCache(country.code);

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_POLICY_RULES_UPDATE",
      entityType: "COUNTRY_POLICY",
      entityId: id,
      before: null,
      after: { updated: true },
    });

    return res.json({ success: true, message: "Rules updated" });
  } catch (e) {
    console.error("admin_country_policies.replaceRules error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

