/**
 * prisma/seed_social.js (CommonJS) — schema-compatible
 * Creates: Users (auth+profile+stats) + Media(ownerUserId) + Posts(authorId) + PostMedia(order) + Likes + Comments(text)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const USER_COUNT = 60;   // 50+ users
const POST_COUNT = 240;  // 200+ posts
const MAX_MEDIA_PER_POST = 4;

const LIKE_RATE = 0.20;
const COMMENT_RATE = 0.12;

const CAPTIONS = [
  "BPA we Love it ❤️",
  "আজকের দিনটা দারুণ 🐾",
  "আমাদের পোষা বন্ধুটা 😄",
  "Pet care tips coming soon!",
  "New reel dropped 🔥",
  "Cute moments 🐶🐱",
  "Healthy food, happy pet ✅",
  "ভালোবাসা আর যত্ন 🫶",
  "Training time!",
  "Playtime video 🎥",
  "Grooming day ✨",
  "Vet visit done ✅",
  "Morning walk 🚶‍♂️🐾",
];

const IMAGE_URLS = Array.from({ length: 300 }, (_, i) => `https://picsum.photos/seed/bpa_img_${i}/720/720`);
const VIDEO_URLS = [
  "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
  "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_2mb.mp4",
  "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_5mb.mp4",
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}
function uniquePhone(i) {
  // matches your earlier example 01700000001...
  const base = 1700000000 + i;
  return `0${base}`;
}
function usernameFor(i) {
  return `demo_user_${i}`; // unique
}

async function seedSocial() {
  console.log("🌱 Seeding Social feed (schema-compatible) ...");

  // ✅ Clean only social tables (keep animalTypes/breeds)
  await prisma.postLike.deleteMany({});
  await prisma.postComment.deleteMany({});
  await prisma.postMedia.deleteMany({});
  await prisma.post.deleteMany({});

  // Media may be used elsewhere; safe approach: only delete medias owned by demo users later.
  // For simplicity we keep old media. We will create new media anyway.

  // ✅ Create users (User thin) + auth + profile + stats
  const users = [];
  for (let i = 1; i <= USER_COUNT; i++) {
    const u = await prisma.user.create({
      data: {
        status: "ACTIVE",
        auth: {
          create: {
            provider: "LOCAL",
            phone: uniquePhone(i),
            // passwordHash optional in schema; keep null for demo
          },
        },
        profile: {
          create: {
            displayName: `Demo User ${i}`,
            username: usernameFor(i),
            bio: i % 3 === 0 ? "Pet lover 🐾" : null,
            visibility: "PUBLIC",
            showEmail: false,
            showPhone: false,
          },
        },
        stats: {
          create: {
            followersCount: 0,
            followingCount: 0,
            petsCount: 0,
            pawPoints: 0,
          },
        },
      },
      include: { profile: true, auth: true },
    });
    users.push(u);
  }
  console.log(`✅ Users created: ${users.length}`);

  // ✅ Create media pool (must include ownerUserId)
  const mediaPool = [];
  const images = [];
  const videos = [];

  // create 320 images
  for (let i = 0; i < 320; i++) {
    const owner = pick(users);
    const m = await prisma.media.create({
      data: {
        url: IMAGE_URLS[i % IMAGE_URLS.length],
        key: null,
        type: "IMAGE",
        ownerUserId: owner.id,
      },
    });
    mediaPool.push(m);
    images.push(m);
  }

  // create 80 videos
  for (let i = 0; i < 80; i++) {
    const owner = pick(users);
    const m = await prisma.media.create({
      data: {
        url: VIDEO_URLS[i % VIDEO_URLS.length],
        key: null,
        type: "VIDEO",
        ownerUserId: owner.id,
      },
    });
    mediaPool.push(m);
    videos.push(m);
  }

  console.log(`✅ Media created: ${mediaPool.length} (images: ${images.length}, videos: ${videos.length})`);

  // ✅ Assign avatars for some profiles (optional, looks nicer)
  for (let i = 0; i < users.length; i++) {
    if (i % 2 === 0) {
      const avatar = pick(images);
      await prisma.userProfile.update({
        where: { userId: users[i].id },
        data: { avatarMediaId: avatar.id },
      });
    }
  }

  // ✅ Create posts
  const posts = [];
  for (let i = 0; i < POST_COUNT; i++) {
    const author = pick(users);

    // distribution: TEXT 30%, IMAGE 40%, VIDEO 15%, REEL 15%
    const r = Math.random();
    let type = "TEXT";
    if (r < 0.30) type = "TEXT";
    else if (r < 0.70) type = "IMAGE";
    else if (r < 0.85) type = "VIDEO";
    else type = "REEL";

    const post = await prisma.post.create({
      data: {
        authorId: author.id,
        type,
        caption: pick(CAPTIONS),
      },
    });

    // Attach media with order (unique per post)
    if (type === "IMAGE") {
      const count = randInt(1, MAX_MEDIA_PER_POST); // 1-4
      const picked = shuffle(images).slice(0, count);
      for (let order = 0; order < picked.length; order++) {
        await prisma.postMedia.create({
          data: { postId: post.id, mediaId: picked[order].id, order },
        });
      }
    }

    if (type === "VIDEO" || type === "REEL") {
      const v = pick(videos);
      await prisma.postMedia.create({
        data: { postId: post.id, mediaId: v.id, order: 0 },
      });
    }

    posts.push(post);
  }
  console.log(`✅ Posts created: ${posts.length}`);

  // ✅ Likes
  let likeCount = 0;
  for (const post of posts) {
    const sampled = shuffle(users).slice(0, randInt(0, 14));
    for (const u of sampled) {
      if (u.id === post.authorId) continue;
      if (Math.random() > LIKE_RATE) continue;

      try {
        await prisma.postLike.create({ data: { postId: post.id, userId: u.id } });
        likeCount++;
      } catch (_) {}
    }
  }
  console.log(`✅ Likes created: ${likeCount}`);

  // ✅ Comments (field name = text)
  const COMMENT_TEXTS = ["Nice! 🔥", "So cute 😍", "Great post!", "Love this ❤️", "Amazing 😄", "Keep it up!", "Wow!", "Superb ✅"];
  let commentCount = 0;

  for (const post of posts) {
    const sampled = shuffle(users).slice(0, randInt(0, 8));
    for (const u of sampled) {
      if (u.id === post.authorId) continue;
      if (Math.random() > COMMENT_RATE) continue;

      await prisma.postComment.create({
        data: {
          postId: post.id,
          userId: u.id,
          text: pick(COMMENT_TEXTS),
        },
      });
      commentCount++;
    }
  }
  console.log(`✅ Comments created: ${commentCount}`);

  console.log("🎉 Social seed completed.");
}

module.exports = seedSocial()
  .catch((e) => {
    console.error("❌ seed_social failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
