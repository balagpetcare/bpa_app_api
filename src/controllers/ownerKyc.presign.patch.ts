const { getPresignedGetUrl } = require("../services/presign.service");

async function mapOwnerKycWithPresignedUrls(kyc) {
  return {
    ...kyc,
    documents: await Promise.all(
      (kyc.documents || []).map(async (d) => ({
        id: d.id,
        type: d.type,
        mediaId: d.mediaId,
        url: await getPresignedGetUrl(d.media.key, 600),
      }))
    ),
  };
}

module.exports = { mapOwnerKycWithPresignedUrls };

export {};
