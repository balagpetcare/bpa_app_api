const service = require("./producer.service");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const { resolvePermissionsForUser } = require("../../utils/permissions");
const { performUnifiedLogin } = require("../../services/authUnified.service");

exports.register = async (req, res) => {
  try {
    const data = await service.registerProducer(req.body);
    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", data.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });
    return res.status(201).json({ success: true, data: { user: data.user } });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Registration failed" });
  }
};

/**
 * Producer login – uses shared authUnified.service with producerOnly gate.
 * Returns canonical contexts + default_redirect.
 */
exports.login = async (req, res) => {
  try {
    let result;
    try {
      result = await performUnifiedLogin({
        email: req.body?.email || null,
        phone: req.body?.phone || null,
        password: req.body?.password || "",
        options: { producerOnly: true },
      });
    } catch (authErr) {
      const status = authErr.statusCode || 401;
      return res.status(status).json({ success: false, message: authErr?.message || "Login failed" });
    }

    const { user, contexts, default_redirect } = result;
    const perms = await resolvePermissionsForUser(user.id);
    const token = jwt.sign({ id: user.id, perms }, appConfig.jwt.secret, { expiresIn: "7d" });

    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.auth?.email ?? null,
          phone: user.auth?.phone ?? null,
          displayName: user.profile?.displayName || null,
          username: user.profile?.username || null,
        },
      },
      contexts,
      default_redirect,
    });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Login failed" });
  }
};

exports.me = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getMe(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to load" });
  }
};

/** Legacy KYC submit (docsJson only). @deprecated Use VerificationCase flow: POST /kyc/documents + POST /kyc/submit */
exports.submitKyc = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.submitKyc({ userId, name: req.body.name, countryCode: req.body.countryCode, docsJson: req.body.docsJson });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "KYC submit failed" });
  }
};

/** POST /kyc/submit: legacy (body with docsJson) → legacy submit + deprecation; else → new VerificationCase submit */
exports.submitKycLegacyOrNew = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const hasLegacyBody = req.body?.docsJson !== undefined || req.body?.name !== undefined || req.body?.countryCode !== undefined;
    if (hasLegacyBody) {
      const data = await service.submitKyc({ userId, name: req.body.name, countryCode: req.body.countryCode, docsJson: req.body.docsJson });
      return res.status(200).json({
        success: true,
        data,
        deprecated: true,
        message: "docsJson-based KYC is deprecated. Please use /kyc/documents to upload files and submit for verification.",
      });
    }
    const kycService = require("./producerKyc.service");
    const { verificationCase } = await kycService.submitProducerKyc(userId);
    return res.json({ success: true, data: verificationCase, message: "KYC submitted for review" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "KYC submit failed" });
  }
};

exports.kycStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getKycStatus(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to load status" });
  }
};

exports.listProducts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listProducts(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list products" });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createProduct(userId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create product" });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getProduct(userId, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to get product" });
  }
};

exports.createBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createBatch(userId, req.params.id, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create batch" });
  }
};

exports.listBatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listBatches(userId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list batches" });
  }
};

exports.getBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getBatchWithCodes(userId, req.params.id, {
      page: req.query?.codesPage,
      limit: req.query?.codesLimit,
    });
    if (!data) return res.status(404).json({ success: false, message: "Batch not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to get batch" });
  }
};

exports.generateCodes = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.generateCodes(userId, req.params.batchId, req.body.quantity, {
      length: req.body.length,
      prefix: req.body.prefix,
      suffix: req.body.suffix,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to generate codes" });
  }
};

exports.exportCodes = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.exportCodes(userId, req.params.batchId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to export codes" });
  }
};

exports.verify = async (req, res) => {
  try {
    const data = await service.verifyCode({
      publicCode: req.body.code,
      ip: req.ip,
      country: req.countryContext?.countryCode,
      deviceId: req.body.deviceId,
      userId: req.user?.id,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Verify failed" });
  }
};

exports.searchCode = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.searchCode(userId, req.query?.code);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Search failed" });
  }
};

// Staff Management
exports.inviteStaff = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const invitedBy = req.user?.id;
    const data = await service.inviteStaff({ producerOrgId, invitedBy, ...req.body });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to invite staff" });
  }
};

exports.listStaff = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const data = await service.listStaff(producerOrgId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list staff" });
  }
};

exports.updateStaffRole = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const { staffId } = req.params;
    const { roleKey } = req.body;
    const data = await service.updateStaffRole(producerOrgId, Number(staffId), roleKey);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to update staff role" });
  }
};

exports.removeStaff = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const { staffId } = req.params;
    await service.removeStaff(producerOrgId, Number(staffId));
    return res.status(200).json({ success: true, message: "Staff removed successfully" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to remove staff" });
  }
};

module.exports = {
  register: exports.register,
  login: exports.login,
  me: exports.me,
  submitKyc: exports.submitKyc,
  submitKycLegacyOrNew: exports.submitKycLegacyOrNew,
  kycStatus: exports.kycStatus,
  listProducts: exports.listProducts,
  createProduct: exports.createProduct,
  getProduct: exports.getProduct,
  createBatch: exports.createBatch,
  listBatches: exports.listBatches,
  getBatch: exports.getBatch,
  generateCodes: exports.generateCodes,
  exportCodes: exports.exportCodes,
  verify: exports.verify,
  searchCode: exports.searchCode,
  inviteStaff: exports.inviteStaff,
  listStaff: exports.listStaff,
  updateStaffRole: exports.updateStaffRole,
  removeStaff: exports.removeStaff,
};

export {};
