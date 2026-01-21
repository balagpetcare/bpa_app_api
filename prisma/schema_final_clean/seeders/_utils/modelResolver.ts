export type AnyDelegate = {
  upsert: Function;
  create: Function;
  createMany?: Function;
  findFirst?: Function;
  findUnique?: Function;
};

export function pickDelegate(prisma: any, candidates: string[], label: string): AnyDelegate {
  for (const key of candidates) {
    const d = prisma?.[key];
    if (d && typeof d === "object" && typeof d.upsert === "function" && typeof d.create === "function") {
      return d as AnyDelegate;
    }
  }
  const available = Object.keys(prisma || {}).filter((k) => typeof (prisma as any)[k] === "object");
  throw new Error(
    `Required Prisma model not found for "${label}". Tried: ${candidates.join(", ")}\nAvailable delegates (sample): ${available.slice(0, 80).join(", ")}`
  );
}
