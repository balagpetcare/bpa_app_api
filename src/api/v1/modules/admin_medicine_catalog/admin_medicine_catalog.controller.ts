const {
  resolveCountryIdByAdminParams,
  searchCountryMedicineCatalog,
  getCountryMedicineBrandDetail,
  getCountryDisplayMeta,
  MIN_QUERY_LEN,
} = require("../../services/countryMedicineCatalog.service");

function asInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

exports.search = async (req: any, res: any) => {
  try {
    const countryId = await resolveCountryIdByAdminParams({
      countryId: asInt(req.query.countryId) ?? undefined,
      countryCode: req.query.countryCode ? String(req.query.countryCode) : undefined,
    });
    if (countryId == null) {
      return res.status(400).json({
        success: false,
        message:
          "Provide a valid, active countryId or countryCode (ISO 3166-1 alpha-2, e.g. BD) to search the imported national medicine catalog.",
      });
    }
    const q = String(req.query.q ?? req.query.query ?? "");
    if (q.trim().length < MIN_QUERY_LEN) {
      return res.status(400).json({
        success: false,
        message: `Enter at least ${MIN_QUERY_LEN} characters (brand, generic, manufacturer, strength, dosage form, or pack marking).`,
      });
    }
    const page = asInt(req.query.page) ?? 1;
    const limit = asInt(req.query.limit) ?? 20;
    const result = await searchCountryMedicineCatalog({
      countryId,
      q,
      genericId: asInt(req.query.genericId) ?? undefined,
      manufacturerId: asInt(req.query.manufacturerId) ?? undefined,
      dosageFormId: asInt(req.query.dosageFormId) ?? undefined,
      strength: req.query.strength ? String(req.query.strength) : undefined,
      page,
      limit,
    });
    const catalogCountry = await getCountryDisplayMeta(countryId);
    return res.json({ success: true, data: { ...result, catalogCountry } });
  } catch (e: any) {
    console.error("[admin.medicineCatalog.search]", e);
    return res.status(500).json({ success: false, message: e?.message || "Search failed" });
  }
};

exports.getBrand = async (req: any, res: any) => {
  try {
    const brandListingId = asInt(req.params.id);
    if (brandListingId == null) return res.status(400).json({ success: false, message: "Invalid brand id" });
    const countryId = await resolveCountryIdByAdminParams({
      countryId: asInt(req.query.countryId) ?? undefined,
      countryCode: req.query.countryCode ? String(req.query.countryCode) : undefined,
    });
    if (countryId == null) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid, active countryId or countryCode to load this catalog entry.",
      });
    }
    const row = await getCountryMedicineBrandDetail(countryId, brandListingId);
    if (!row) return res.status(404).json({ success: false, message: "Catalog medicine not found for this country" });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    console.error("[admin.medicineCatalog.getBrand]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

export {};
