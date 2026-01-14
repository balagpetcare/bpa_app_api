import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export type JwtPayload = { uid: number };

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function signToken(uid: number) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  const payload: JwtPayload = { uid };
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

export function verifyToken(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.verify(token, secret) as JwtPayload;
}
