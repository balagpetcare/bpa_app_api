const { getActivePolicy, getActiveStatePolicy } = require('../../services/policyEngine.service');

function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

/**
 * GET /api/v1/meta/policy?countryCode=BD&stateCode=CA (optional)
 * Read-only: returns active country policy (and optional state override).
 */
exports.getPolicy = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const countryCode = String(req.query?.countryCode || req.countryContext?.countryCode || '').toUpperCase().trim();
    if (!countryCode) {
      return res.status(400).json({ success: false, message: 'countryCode is required' });
    }
    const stateCode = req.query?.stateCode ? String(req.query.stateCode).toUpperCase().trim() : null;

    if (stateCode) {
      const statePolicy = await getActiveStatePolicy(prisma, countryCode, stateCode);
      if (!statePolicy) {
        return res.status(404).json({ success: false, message: 'No active policy for country' });
      }
      const country = await prisma.country.findFirst({
        where: { id: statePolicy.state.countryId },
        select: { code: true, name: true, currencyCode: true },
      });
      return res.json({
        success: true,
        data: {
          countryCode: country?.code || countryCode,
          countryName: country?.name || null,
          policyId: statePolicy.id,
          policyName: statePolicy.name,
          status: statePolicy.status,
          features: statePolicy.features.map((f) => ({ featureCode: f.featureCode, enabled: f.enabled })),
          currencyCode: country?.currencyCode || null,
          stateCode: statePolicy.state?.code || stateCode,
          stateName: statePolicy.state?.name || null,
          statePolicyId: statePolicy.id,
          statePolicyName: statePolicy.name,
        },
      });
    }

    const policy = await getActivePolicy(prisma, countryCode);
    if (!policy) {
      return res.status(404).json({ success: false, message: 'No active policy for country' });
    }
    return res.json({
      success: true,
      data: {
        countryCode: policy.country?.code || countryCode,
        countryName: policy.country?.name || null,
        policyId: policy.id,
        policyName: policy.name,
        status: policy.status,
        features: policy.features.map((f) => ({ featureCode: f.featureCode, enabled: f.enabled })),
        currencyCode: policy.country?.currencyCode || null,
        stateCode: null,
        stateName: null,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/meta/features?countryCode=BD
 * Phase 5: Public endpoint for policy features (DONATION, ADS, PRODUCTS) so frontend can hide/disable UI.
 */
exports.getFeatures = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const code = String(req.query?.countryCode || req.countryContext?.countryCode || 'BD').toUpperCase().trim() || 'BD';
    const policy = await getActivePolicy(prisma, code);
    const features = {};
    if (policy?.features) {
      for (const f of policy.features) {
        features[f.featureCode] = !!f.enabled;
      }
    }
    return res.json({
      success: true,
      data: { countryCode: code, features },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listBranchTypes = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const rows = await prisma.branchType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listOrganizationTypes = async (req, res) => {
  try {
    const prisma = getPrisma(req);

    // If the DB has not been migrated yet, keep UI functional by returning fallback types.
    const hasModel = typeof prisma.organizationType?.findMany === 'function';
    if (!hasModel) {
      const fallback = [
        { id: 0, code: 'CLINIC_ORG', nameEn: 'Clinic Organization', nameBn: 'ক্লিনিক প্রতিষ্ঠান', isActive: true },
        { id: 0, code: 'PET_SHOP_ORG', nameEn: 'Pet Shop Organization', nameBn: 'পেট শপ প্রতিষ্ঠান', isActive: true },
        { id: 0, code: 'DELIVERY_ORG', nameEn: 'Delivery Hub Organization', nameBn: 'ডেলিভারি হাব প্রতিষ্ঠান', isActive: true },
      ];
      return res.json({ success: true, data: fallback });
    }

    const rows = await prisma.organizationType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });

    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/meta/categories
 * Returns category tree (top-level with children). For product Category / Sub-category dropdowns.
 */
exports.listCategories = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const hasModel = typeof prisma.category?.findMany === 'function';
    if (!hasModel) {
      return res.json({ success: true, data: [] });
    }

    const all = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const byParent = {};
    for (const c of all) {
      const key = c.parentId == null ? 'root' : c.parentId;
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(c);
    }

    function buildTree(parentKey) {
      return (byParent[parentKey] || []).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId,
        sortOrder: c.sortOrder,
        children: buildTree(c.id),
      }));
    }

    const tree = buildTree('root');
    return res.json({ success: true, data: tree });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/meta/brands
 * Returns flat list of brands for product Brand dropdown.
 * Supports optional ?search= query parameter for filtering.
 */
exports.listBrands = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const hasModel = typeof prisma.brand?.findMany === 'function';
    if (!hasModel) {
      return res.json({ success: true, data: [] });
    }

    const searchQuery = req.query.search?.toString()?.trim() || '';

    const where = searchQuery
      ? {
          OR: [
            { name: { contains: searchQuery, mode: 'insensitive' } },
            { slug: { contains: searchQuery, mode: 'insensitive' } },
          ],
        }
      : {};

    const rows = await prisma.brand.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
