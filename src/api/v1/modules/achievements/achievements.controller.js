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
