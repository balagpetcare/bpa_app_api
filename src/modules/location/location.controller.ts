const service = require("./location.service");
const dto = require("./location.dto");

function getPrisma(req) {
  if (req?.prisma) return req.prisma;
  return require("../../infrastructure/db/prismaClient");
}

function parseListInput(req) {
  return dto.toHierarchyListDto(req.query || {});
}

exports.listDivisions = async (req, res) => {
  try {
    const result = await service.listDivisions(getPrisma(req), parseListInput(req));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to fetch divisions" });
  }
};

exports.listDistricts = async (req, res) => {
  try {
    const result = await service.listDistricts(getPrisma(req), parseListInput(req));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to fetch districts" });
  }
};

exports.listUpazilas = async (req, res) => {
  try {
    const result = await service.listUpazilas(getPrisma(req), parseListInput(req));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to fetch upazilas" });
  }
};

exports.listUnions = async (req, res) => {
  try {
    const result = await service.listUnions(getPrisma(req), parseListInput(req));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to fetch unions" });
  }
};

exports.listAreas = async (req, res) => {
  try {
    const result = await service.listAreas(getPrisma(req), parseListInput(req));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to fetch areas" });
  }
};

exports.search = async (req, res) => {
  try {
    const input = {
      ...dto.toSearchDto(req.query || {}),
    };
    const result = await service.searchLocations(getPrisma(req), input);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to search locations" });
  }
};

exports.validateSelection = async (req, res) => {
  try {
    const result = await service.validateSelection(getPrisma(req), dto.toSelectionDto(req.body || {}));
    if (!result.ok) return res.status(400).json({ success: false, ...result });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to validate selection" });
  }
};

exports.listCoverage = async (req, res) => {
  try {
    const entityType = String(req.params.entityType || "");
    const entityId = Number(req.params.entityId);
    if (!entityType || !Number.isFinite(entityId)) {
      return res.status(400).json({ success: false, message: "entityType and entityId are required" });
    }
    const data = await service.listCoverage(getPrisma(req), entityType, entityId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to fetch coverage" });
  }
};

exports.replaceCoverage = async (req, res) => {
  try {
    const entityType = String(req.params.entityType || "");
    const entityId = Number(req.params.entityId);
    if (!entityType || !Number.isFinite(entityId)) {
      return res.status(400).json({ success: false, message: "entityType and entityId are required" });
    }
    const parsed = dto.toCoverageReplaceDto(req.params || {}, req.body || {});
    const result = await service.replaceCoverage(getPrisma(req), parsed.entityType, parsed.entityId, parsed.rows);
    if (!result.ok) return res.status(400).json({ success: false, ...result });
    const data = await service.listCoverage(getPrisma(req), parsed.entityType, parsed.entityId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Failed to update coverage" });
  }
};

module.exports = {
  listDivisions: exports.listDivisions,
  listDistricts: exports.listDistricts,
  listUpazilas: exports.listUpazilas,
  listUnions: exports.listUnions,
  listAreas: exports.listAreas,
  search: exports.search,
  validateSelection: exports.validateSelection,
  listCoverage: exports.listCoverage,
  replaceCoverage: exports.replaceCoverage,
};
