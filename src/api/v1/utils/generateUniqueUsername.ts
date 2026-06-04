import prisma from "../../../infrastructure/db/prismaClient";

/**
 * Generate a unique username for UserProfile (shared by password register + OAuth bootstrap).
 */
export async function generateUniqueUsername(params: {
  emailNorm: string | null;
  phoneNorm: string | null;
  displayName: string | null | undefined;
}): Promise<string> {
  const { emailNorm, phoneNorm, displayName } = params;
  let base =
    (emailNorm ? emailNorm.split("@")[0] : "") ||
    (phoneNorm ? `user${phoneNorm.replace(/\D/g, "")}` : "") ||
    (displayName ? displayName.toLowerCase().replace(/\s+/g, "") : "user");

  base = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  if (!base) base = "user";

  let username = base;
  for (let i = 0; i < 10; i++) {
    const exists = await prisma.userProfile.findFirst({
      where: { username },
      select: { id: true },
    });

    if (!exists) return username;

    const suffix = Math.floor(1000 + Math.random() * 9000);
    username = `${base}_${suffix}`.slice(0, 30);
  }

  return `user_${Date.now()}`;
}
