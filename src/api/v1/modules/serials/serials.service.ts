const { prisma } = require("../../../../lib/prisma");
const { verifyPayload } = require("../../utils/serialSigner");

async function verifySerial({ serialCode }) {
  const code = String(serialCode || "").trim();
  if (!code) {
    const err = new Error("Invalid serial");
    (err as any).statusCode = 400;
    throw err;
  }

  const serial = await prisma.serial.findUnique({
    where: { serialCode: code },
    include: {
      batch: {
        include: {
          productVersion: { include: { product: true } },
        },
      },
    },
  });
  if (!serial) {
    const err = new Error("Serial not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const payload = `${serial.serialCode}:${serial.batch.productVersionId}:${serial.batchId}`;
  const signatureOk = verifyPayload(payload, serial.signature);

  return {
    serial: {
      code: serial.serialCode,
      status: serial.status,
      firstScanAt: serial.firstScanAt,
      firstScanCountry: serial.firstScanCountry,
    },
    product: {
      id: serial.batch.productVersion.product.id,
      name: serial.batch.productVersion.product.name,
      version: serial.batch.productVersion.version,
      versionStatus: serial.batch.productVersion.status,
    },
    batch: {
      id: serial.batchId,
      status: serial.batch.status,
      mfgDate: serial.batch.mfgDate,
      expDate: serial.batch.expDate,
    },
    signatureOk,
  };
}

async function createScanEvent({ serialCode, actorRole, action, countryCode, deviceId, metaJson }) {
  const code = String(serialCode || "").trim();
  if (!code) {
    const err = new Error("Invalid serial");
    (err as any).statusCode = 400;
    throw err;
  }
  if (!actorRole || !action) {
    const err = new Error("actorRole and action are required");
    (err as any).statusCode = 400;
    throw err;
  }

  const serial = await prisma.serial.findUnique({ where: { serialCode: code } });
  if (!serial) {
    const err = new Error("Serial not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const scan = await tx.scanEvent.create({
      data: {
        serialId: serial.id,
        actorRole,
        action,
        countryCode: countryCode || null,
        deviceId: deviceId || null,
        metaJson: metaJson || null,
      },
    });

    // First-scan binding (MVP)
    if (!serial.firstScanAt) {
      await tx.serial.update({
        where: { id: serial.id },
        data: {
          firstScanAt: new Date(),
          firstScanCountry: countryCode || null,
          firstScanDevice: deviceId || null,
          status: "ACTIVATED",
        },
      });
    }

    return scan;
  });

  return updated;
}

async function listSerials({ batchId, status, search, page = 1, limit = 20 }) {
  const take = Math.min(Number(limit) || 20, 100);
  const skip = (Number(page) - 1) * take;
  const where: any = {};
  if (batchId) where.batchId = Number(batchId);
  if (status) where.status = String(status).toUpperCase();
  if (search) where.serialCode = { contains: String(search).trim(), mode: "insensitive" };

  const [items, total] = await Promise.all([
    prisma.serial.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: { batch: true },
    }),
    prisma.serial.count({ where }),
  ]);

  return { items, pagination: { page: Number(page), limit: take, total } };
}

async function listScanEvents({ serialCode, page = 1, limit = 20 }) {
  const take = Math.min(Number(limit) || 20, 100);
  const skip = (Number(page) - 1) * take;
  const where: any = {};
  if (serialCode) {
    const serial = await prisma.serial.findUnique({ where: { serialCode: String(serialCode) } });
    if (!serial) {
      return { items: [], pagination: { page: Number(page), limit: take, total: 0 } };
    }
    where.serialId = serial.id;
  }

  const [items, total] = await Promise.all([
    prisma.scanEvent.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: { serial: true },
    }),
    prisma.scanEvent.count({ where }),
  ]);

  return { items, pagination: { page: Number(page), limit: take, total } };
}

async function listFraudAlerts({ sinceHours = 24 }) {
  const since = new Date(Date.now() - Number(sinceHours || 24) * 60 * 60 * 1000);

  const recent = await prisma.scanEvent.findMany({
    where: { createdAt: { gte: since } },
    select: { serialId: true, countryCode: true },
  });

  const map: Record<string, { count: number; countries: Set<string> }> = {};
  for (const r of recent) {
    const key = String(r.serialId);
    if (!map[key]) map[key] = { count: 0, countries: new Set() };
    map[key].count += 1;
    if (r.countryCode) map[key].countries.add(r.countryCode);
  }

  const flaggedIds = Object.entries(map)
    .filter(([_, v]) => v.count >= 3 || v.countries.size >= 2)
    .map(([id]) => Number(id));

  if (flaggedIds.length === 0) return [];

  const serials = await prisma.serial.findMany({
    where: { id: { in: flaggedIds } },
    select: { id: true, serialCode: true },
  });
  const serialById = new Map(serials.map((s) => [s.id, s.serialCode]));

  return flaggedIds.map((id) => ({
    serialId: id,
    serialCode: serialById.get(id),
    scansLastWindow: map[String(id)].count,
    countries: Array.from(map[String(id)].countries),
  }));
}

module.exports = {
  verifySerial,
  createScanEvent,
  listSerials,
  listScanEvents,
  listFraudAlerts,
};
export { verifySerial, createScanEvent };
