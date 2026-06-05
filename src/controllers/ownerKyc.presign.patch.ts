const { buildPrivateFileAccessUrl } = require("../shared/storage/fileAccessUrl");

async function mapOwnerKycWithPresignedUrls(kyc, { baseUrl, userId }) {
  if (!kyc) return kyc;
  return {
    ...kyc,
    documents: await Promise.all(
      (kyc.documents || []).map(async (d) => {
        const key = d?.media?.key ? String(d.media.key) : null;
        if (!key) return { ...d, url: null };
        const url = await buildPrivateFileAccessUrl({
          key,
          userId: Number(userId),
          baseUrl,
        });
        return {
          id: d.id,
          type: d.type,
          mediaId: d.mediaId,
          url,
        };
      })
    ),
  };
}

module.exports = { mapOwnerKycWithPresignedUrls };

export {};
