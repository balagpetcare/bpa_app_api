/** Prisma fragment: User has no scalar `name` / `email` (see UserProfile + UserAuth). */
export const userPublicSelect = {
  id: true,
  profile: { select: { displayName: true } },
  auth: { select: { email: true } },
};
