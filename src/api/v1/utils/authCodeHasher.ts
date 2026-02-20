const crypto = require("crypto");

const HMAC_SECRET = process.env.AUTH_CODE_HMAC_SECRET || "change_me_auth_code_hmac";
const ENC_SECRET = process.env.AUTH_CODE_ENC_SECRET || "change_me_auth_code_encrypt";

function hmacHash(code: string): string {
  return crypto.createHmac("sha256", HMAC_SECRET).update(code).digest("hex");
}

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(ENC_SECRET).digest();
}

function encryptCode(code: string): { cipher: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const key = deriveKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptCode(cipherText: string, ivText: string, tagText: string): string {
  const key = deriveKey();
  const iv = Buffer.from(ivText, "base64");
  const tag = Buffer.from(tagText, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

module.exports = { hmacHash, encryptCode, decryptCode };
export { hmacHash, encryptCode, decryptCode };
