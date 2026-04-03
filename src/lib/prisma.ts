/**
 * Legacy import path for the shared Prisma client. Prefer `infrastructure/db/prismaClient` in new code.
 */
import prismaSingleton from "../infrastructure/db/prismaClient";

export const prisma = prismaSingleton;
export default prismaSingleton;

module.exports = prismaSingleton;
module.exports.prisma = prismaSingleton;
module.exports.default = prismaSingleton;
