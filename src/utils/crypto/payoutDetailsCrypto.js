const crypto = require('crypto');

// AES-256-GCM encryption for payoutDetailsJson.
//
// Env:
// - WALLET_PAYOUT_DETAILS_KEY: 32-byte key (base64 or hex). Recommended: base64.
//
// Stored format:
//   enc:v1:<iv_b64>:<cipher_b64>:<tag_b64>

function _getKey() {
  const raw = process.env.WALLET_PAYOUT_DETAILS_KEY;
  if (!raw) return null;

  let buf = null;
  // Try base64 first
  try {
    buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {}

  // Try hex
  try {
    buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  } catch {}

  return null;
}

function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith('enc:v1:');
}

function encryptJsonString(plain) {
  const key = _getKey();
  if (!key) return plain; // If no key configured, store as-is (dev mode).
  if (plain == null) return plain;
  const s = String(plain);
  if (isEncrypted(s)) return s;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

function decryptToString(maybeEnc) {
  const key = _getKey();
  if (!key) return null;
  if (!isEncrypted(maybeEnc)) return maybeEnc;

  const parts = String(maybeEnc).split(':');
  // enc:v1:<iv>:<cipher>:<tag>
  if (parts.length < 5) return null;
  const iv = Buffer.from(parts[2], 'base64');
  const cipherText = Buffer.from(parts[3], 'base64');
  const tag = Buffer.from(parts[4], 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  return plain;
}

function decryptToJson(maybeEnc) {
  const s = decryptToString(maybeEnc);
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function maskEncrypted() {
  return { encrypted: true, note: 'Hidden for security' };
}

module.exports = {
  isEncrypted,
  encryptJsonString,
  decryptToString,
  decryptToJson,
  maskEncrypted,
};
