const { getStorageProvider } = require("../../infrastructure/storage/storage.factory");

function publicMediaBase(): string {
  const provider = getStorageProvider();
  const base = String(
    provider.config.publicUrl || provider.config.endpoint || ""
  ).replace(/\/$/, "");
  return base;
}

/** Canonical object URL for clients (path-style S3-compatible storage). */
function buildPublicMediaUrl(key: string): string {
  return getStorageProvider().buildPublicUrl(key);
}

/**
 * Prefer rebuilding from `key` so host changes (STORAGE_PUBLIC_URL) do not break clients.
 * Falls back to rewriting localhost/docker hosts in stored URLs.
 */
function resolveClientMediaUrl(input: { url?: string | null; key?: string | null }): string {
  const key = input?.key;
  if (key) return buildPublicMediaUrl(key);

  const raw = String(input?.url || "").trim();
  if (!raw) return "";

  try {
    const uri = new URL(raw);
    const host = uri.hostname.toLowerCase();
    const localHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "10.0.2.2" ||
      host.includes("bpa-storage") ||
      host.includes("minio") ||
      host.includes("backblazeb2.com");

    if (!localHost) return raw;

    return `${publicMediaBase()}${uri.pathname}${uri.search}`;
  } catch (_) {
    if (raw.startsWith("/")) return `${publicMediaBase()}${raw}`;
    return raw;
  }
}

module.exports = {
  publicMediaBase,
  buildPublicMediaUrl,
  resolveClientMediaUrl,
};

export {};
