const prisma = require('../../../../infrastructure/db/prismaClient');

// GET /api/v1/achievements
// Returns achievements with achieved flag + overall progress.
exports.listAchievements = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true, achievements: { include: { achievement: { include: { iconMedia: true } } } } },
    });

    const points = user?.wallet?.points ?? 0;

    const all = await prisma.achievement.findMany({
      include: { iconMedia: true },
      orderBy: { id: 'asc' },
    });

    const unlockedIds = new Set(
      (user?.achievements ?? []).map((ua) => ua.achievementId)
    );

    const items = all.map((a) => {
      const requiredPoints = a.requiredPoints ?? 0;
      const achieved = points >= requiredPoints || unlockedIds.has(a.id);
      return {
        id: a.id,
        code: a.code,
        achievement_name: a.title,
        icon_url: a.iconMedia?.url ?? null,
        required_points: requiredPoints,
        description: a.description ?? null,
        how_to: a.howTo ?? null,
        achieved,
      };
    });

    const achievedCount = items.filter((x) => x.achieved).length;
    const progressPercent = items.length === 0 ? 0 : Math.round((achievedCount / items.length) * 100);

    return res.json({
      success: true,
      data: {
        points,
        progressPercent,
        achievements: items,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || 'Failed to load achievements' });
  }
};

// -----------------------------
// Admin: POST /api/v1/achievements
// -----------------------------
exports.createAchievement = async (req, res) => {
  try {
    const { code, title, description, requiredPoints, pointsReward, howTo, iconMediaId } = req.body;

    if (!code || !title) {
      return res.status(400).json({ success: false, message: 'code and title are required' });
    }

    const achievement = await prisma.achievement.create({
      data: {
        code: String(code).trim(),
        title: String(title).trim(),
        description: description ? String(description) : null,
        requiredPoints: requiredPoints !== undefined ? Number(requiredPoints) : 0,
        pointsReward: pointsReward !== undefined ? Number(pointsReward) : 0,
        howTo: howTo ? String(howTo) : null,
        iconMediaId: iconMediaId ? Number(iconMediaId) : null,
      },
      include: { iconMedia: true },
    });

    return res.status(201).json({ success: true, data: achievement });
  } catch (e) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Achievement code already exists' });
    }
    return res.status(500).json({ success: false, message: e.message || 'Failed to create achievement' });
  }
};

// -----------------------------
// Admin: PUT/PATCH /api/v1/achievements/:id
// -----------------------------
exports.updateAchievement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const { code, title, description, requiredPoints, pointsReward, howTo, iconMediaId } = req.body;

    const data = {};
    if (code !== undefined) data.code = String(code).trim();
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description ? String(description) : null;
    if (requiredPoints !== undefined) data.requiredPoints = Number(requiredPoints);
    if (pointsReward !== undefined) data.pointsReward = Number(pointsReward);
    if (howTo !== undefined) data.howTo = howTo ? String(howTo) : null;
    if (iconMediaId !== undefined) data.iconMediaId = iconMediaId ? Number(iconMediaId) : null;

    const achievement = await prisma.achievement.update({
      where: { id },
      data,
      include: { iconMedia: true },
    });

    return res.json({ success: true, data: achievement });
  } catch (e) {
    if (e?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Achievement not found' });
    }
    if (e?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Achievement code already exists' });
    }
    return res.status(500).json({ success: false, message: e.message || 'Failed to update achievement' });
  }
};

// -----------------------------
// Admin: DELETE /api/v1/achievements/:id
// -----------------------------
exports.deleteAchievement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    await prisma.achievement.delete({ where: { id } });
    return res.json({ success: true, message: 'Achievement deleted' });
  } catch (e) {
    if (e?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Achievement not found' });
    }
    // If there are foreign key constraints, tell user.
    return res.status(500).json({ success: false, message: e.message || 'Failed to delete achievement' });
  }
};
