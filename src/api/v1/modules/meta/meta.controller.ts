function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

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

export {};
