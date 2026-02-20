const crypto = require("crypto");

// HMAC-based signer for MVP; replace with HSM/KMS later
const SIGN_SECRET = process.env.AUTH_SERIAL_SIGNING_SECRET || "change_me_serial_secret";

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", SIGN_SECRET).update(payload).digest("hex");
}

function verifyPayload(payload: string, signature: string): boolean {
  return signPayload(payload) === signature;
}

module.exports = { signPayload, verifyPayload };
export { signPayload, verifyPayload };
