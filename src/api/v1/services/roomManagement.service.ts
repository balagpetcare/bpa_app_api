/**
 * Room Management Service – shared list, detail, filters, summary.
 * Used by owner and staff clinic routes. Branch-scoped.
 */

const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

export type RoomListFilters = {
  roomType?: string;
  status?: string;
  operationalStatus?: string;
  zone?: string;
  floor?: string;
  activeOnly?: boolean;
  bookableOnly?: boolean;
};

export type RoomSummary = {
  total: number;
  availableNow: number;
  occupiedNow: number;
  cleaning: number;
  maintenance: number;
  blocked: number;
  todayBookings: number;
};

/** List rooms for a branch with optional filters. */
export async function listRooms(
  branchId: number,
  filters?: RoomListFilters
): Promise<any[]> {
  const where: any = { branchId };
  if (filters?.roomType) where.roomType = filters.roomType;
  if (filters?.status) where.status = filters.status;
  else if (filters?.activeOnly !== false) where.status = "ACTIVE"; // default: active only
  if (filters?.operationalStatus) where.operationalStatus = filters.operationalStatus;
  if (filters?.zone) where.zone = filters.zone;
  if (filters?.floor) where.floor = filters.floor;
  if (filters?.bookableOnly === true) where.bookable = true;

  const rooms = await prisma.branchRoom.findMany({
    where,
    orderBy: [{ name: "asc" }],
  });
  return rooms;
}

/** Get summary counts for branch rooms (for overview cards). */
export async function getRoomSummary(branchId: number): Promise<RoomSummary> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const [rooms, todayBookingsCount] = await Promise.all([
    prisma.branchRoom.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { id: true, operationalStatus: true },
    }),
    prisma.appointment.count({
      where: {
        branchId,
        roomId: { not: null },
        status: { in: ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_QUEUE", "CALLED", "IN_CONSULT"] },
        scheduledStartAt: { gte: todayStart, lt: todayEnd },
      },
    }),
  ]);

  const total = rooms.length;
  const availableNow = rooms.filter((r: any) => r.operationalStatus === "AVAILABLE").length;
  const occupiedNow = rooms.filter((r: any) => r.operationalStatus === "OCCUPIED").length;
  const cleaning = rooms.filter((r: any) => r.operationalStatus === "CLEANING").length;
  const maintenance = rooms.filter((r: any) => r.operationalStatus === "MAINTENANCE").length;
  const blocked = rooms.filter((r: any) => r.operationalStatus === "BLOCKED").length;

  return {
    total,
    availableNow,
    occupiedNow,
    cleaning,
    maintenance,
    blocked,
    todayBookings: todayBookingsCount,
  };
}

/** Get single room detail by id (branch-scoped). Returns null if not found. */
export async function getRoomDetail(branchId: number, roomId: number): Promise<any | null> {
  const room = await prisma.branchRoom.findFirst({
    where: { id: roomId, branchId },
    include: {
      roomScheduleTemplates: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
      _count: { select: { appointments: true } },
    },
  });
  return room;
}
