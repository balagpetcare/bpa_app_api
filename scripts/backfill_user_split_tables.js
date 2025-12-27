/* scripts/backfill_user_split_tables.js */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Simple username generator from name/email
 * - lowercased
 * - spaces -> _
 * - remove non-alphanumeric/_.
 */
function slugifyUsername(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\.]/g, "");
}

/**
 * Ensure unique username by adding numeric suffix if needed.
 * gobinda -> gobinda1 -> gobinda2 ...
 */
async function ensureUniqueUsername(base) {
  let username = base || "user";
  let i = 0;

  while (true) {
    const existing = await prisma.userProfile.findUnique({
      where: { username },
      select: { id: true },
    });

    if (!existing) return username;
    i += 1;
    username = `${base}${i}`;
  }
}

async function main() {
  const users = await prisma.user.findMany({
    // IMPORTANT: old fields still exist at this stage
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      password: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });

  console.log(`Found ${users.length} users. Starting backfill...`);

  let createdAuth = 0;
  let createdProfile = 0;
  let createdStats = 0;

  for (const u of users) {
    // Use transaction per user to keep consistency
    await prisma.$transaction(async (tx) => {
      // 1) UserAuth
      const authExists = await tx.userAuth.findUnique({
        where: { userId: u.id },
        select: { id: true },
      });

      if (!authExists) {
        // If your old user.password is already hashed, copy it to passwordHash.
        // If old password was plaintext (shouldn't), you MUST hash before storing.
        await tx.userAuth.create({
          data: {
            userId: u.id,
            provider: "LOCAL",
            email: u.email || null,
            phone: u.phone || null,
            passwordHash: u.password || null,
            // createdAt/updatedAt auto
          },
        });
        createdAuth += 1;
      }

      // 2) UserProfile
      const profileExists = await tx.userProfile.findUnique({
        where: { userId: u.id },
        select: { id: true },
      });

      if (!profileExists) {
        // base username preference:
        // a) email prefix, b) name slug, c) user{id}
        const emailPrefix = (u.email || "").split("@")[0];
        const baseRaw = emailPrefix || u.name || `user${u.id}`;
        const base = slugifyUsername(baseRaw) || `user${u.id}`;
        const uniqueUsername = await ensureUniqueUsername(base);

        await tx.userProfile.create({
          data: {
            userId: u.id,
            displayName: u.name || "User",
            username: uniqueUsername,
            bio: null,
            visibility: "PUBLIC",
            showEmail: false,
            showPhone: false,
          },
        });
        createdProfile += 1;
      }

      // 3) UserStatsCache
      const statsExists = await tx.userStatsCache.findUnique({
        where: { userId: u.id },
        select: { userId: true },
      });

      if (!statsExists) {
        const petsCount = await tx.pet.count({
          where: { userId: u.id, deleted: false },
        });

        // pawPoints cache = wallet.points (if wallet exists)
        const wallet = await tx.userWallet.findUnique({
          where: { userId: u.id },
          select: { points: true },
        });

        await tx.userStatsCache.create({
          data: {
            userId: u.id,
            petsCount,
            pawPoints: wallet?.points ?? 0,
            followersCount: 0,
            followingCount: 0,
            rankGlobal: null,
          },
        });
        createdStats += 1;
      }
    });

    console.log(`✅ Backfilled userId=${u.id}`);
  }

  console.log("Backfill finished.");
  console.log({ createdAuth, createdProfile, createdStats });
}

main()
  .catch((e) => {
    console.error("Backfill error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
