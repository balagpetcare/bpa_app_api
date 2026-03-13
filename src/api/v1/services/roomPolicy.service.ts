/**
 * Room Policy – compatibility and business rules.
 * - Compatible rooms for service/package
 * - Validate room assignable (active, not blocked, no overlap, type compatible)
 */

const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

const ACTIVE_APPOINTMENT_STATUSES = [
  "DRAFT", "PRE_BOOKED", "BOOKED", "CONFIRMED", "CHECKED_IN",
  "IN_QUEUE", "CALLED", "IN_CONSULT",
];

/** Check if a room has any overlapping block in [start, end). */
export async function isRoomBlocked(roomId: number, start: Date, end: Date, excludeBlockId?: number): Promise<boolean> {
  const blocks = await prisma.clinicRoomBlock.findMany({
    where: {
      roomId,
      startAt: { lt: end },
      endAt: { gt: start },
      ...(excludeBlockId != null ? { id: { not: excludeBlockId } } : {}),
    },
    take: 1,
  });
  return blocks.length > 0;
}

/** Check if another appointment uses the same room in [start, end). Exclude appointmentId for updates. Does not consider cleaning buffer. */
export async function hasRoomOverlap(
  branchId: number,
  roomId: number,
  start: Date,
  end: Date,
  excludeAppointmentId?: number
): Promise<boolean> {
  const overlap = await prisma.appointment.findFirst({
    where: {
      branchId,
      roomId,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      scheduledStartAt: { lt: end },
      scheduledEndAt: { gt: start },
      ...(excludeAppointmentId != null ? { id: { not: excludeAppointmentId } } : {}),
    },
  });
  return !!overlap;
}

/** Effective end of an appointment in a room = scheduledEndAt + room.cleaningBufferMinutes. Room is busy until then. */
function getEffectiveEnd(scheduledEndAt: Date, cleaningBufferMinutes: number | null): Date {
  const buf = cleaningBufferMinutes ?? 0;
  return new Date(scheduledEndAt.getTime() + buf * 60 * 1000);
}

/** Check if room is busy for [start, end] including cleaning buffer after each appointment. */
export async function hasRoomOverlapWithCleaningBuffer(
  branchId: number,
  roomId: number,
  start: Date,
  end: Date,
  excludeAppointmentId?: number
): Promise<boolean> {
  const room = await prisma.branchRoom.findFirst({
    where: { id: roomId, branchId },
    select: { cleaningBufferMinutes: true },
  });
  if (!room) return true;
  const appointments = await prisma.appointment.findMany({
    where: {
      branchId,
      roomId,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      scheduledStartAt: { lt: end },
      ...(excludeAppointmentId != null ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { id: true, scheduledStartAt: true, scheduledEndAt: true },
  });
  for (const a of appointments) {
    const busyUntil = getEffectiveEnd(a.scheduledEndAt, room.cleaningBufferMinutes);
    if (busyUntil > start) return true;
  }
  return false;
}

/** Get allowed room types for a service (from service.allowedRoomTypes). Empty = any. */
export async function getAllowedRoomTypesForService(serviceId: number): Promise<string[]> {
  const svc = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { allowedRoomTypes: true },
  });
  if (!svc?.allowedRoomTypes) return [];
  const arr = Array.isArray(svc.allowedRoomTypes) ? svc.allowedRoomTypes : [];
  return arr.filter((t): t is string => typeof t === "string");
}

/** Get allowed room types for a surgery package. Empty = any. */
export async function getAllowedRoomTypesForPackage(packageId: number): Promise<string[]> {
  const pkg = await prisma.surgeryPackage.findUnique({
    where: { id: packageId },
    select: { allowedRoomTypes: true },
  });
  if (!pkg?.allowedRoomTypes) return [];
  const arr = Array.isArray(pkg.allowedRoomTypes) ? pkg.allowedRoomTypes : [];
  return arr.filter((t): t is string => typeof t === "string");
}

/** Room is type-compatible with service/package. Empty allowed list = any room type. */
export function isRoomTypeCompatible(roomType: string, allowedTypes: string[]): boolean {
  if (!allowedTypes || allowedTypes.length === 0) return true;
  return allowedTypes.includes(roomType);
}

/** Get list of room IDs that are assignable for the given slot and service/package. Uses cleaning buffer. When doctorId is set, preferred rooms for that doctor come first. */
export async function getCompatibleRoomIds(
  branchId: number,
  start: Date,
  end: Date,
  options: { serviceId?: number; surgeryPackageId?: number; doctorId?: number } = {}
): Promise<number[]> {
  const result = await getCompatibleRoomsWithDetails(branchId, start, end, options);
  return result.roomIds;
}

export type CompatibleRoomDetail = { id: number; name: string; code: string | null; roomType: string };

/** Get compatible room IDs and room details (for UI). Preferred rooms first when doctorId is set. */
export async function getCompatibleRoomsWithDetails(
  branchId: number,
  start: Date,
  end: Date,
  options: { serviceId?: number; surgeryPackageId?: number; doctorId?: number } = {}
): Promise<{ roomIds: number[]; rooms: CompatibleRoomDetail[] }> {
  const { releaseCleaningRoomsForBranch } = require("./roomOccupancy.service");
  await releaseCleaningRoomsForBranch(branchId, start);

  const rooms = await prisma.branchRoom.findMany({
    where: {
      branchId,
      status: "ACTIVE",
      bookable: true,
    },
    select: { id: true, name: true, code: true, roomType: true, cleaningBufferMinutes: true, preferredDoctorIds: true },
  });

  let allowedTypes: string[] = [];
  if (options.serviceId) allowedTypes = await getAllowedRoomTypesForService(options.serviceId);
  else if (options.surgeryPackageId) allowedTypes = await getAllowedRoomTypesForPackage(options.surgeryPackageId);

  const compatible: typeof rooms = [];
  for (const room of rooms) {
    if (!isRoomTypeCompatible(room.roomType, allowedTypes)) continue;
    const blocked = await isRoomBlocked(room.id, start, end);
    if (blocked) continue;
    const overlap = await hasRoomOverlapWithCleaningBuffer(branchId, room.id, start, end);
    if (overlap) continue;
    compatible.push(room);
  }

  const doctorId = options.doctorId;
  const isPreferred = (preferred: any, docId: number) =>
    Array.isArray(preferred) && preferred.some((id: any) => Number(id) === docId);
  if (doctorId != null) {
    compatible.sort((a, b) => {
      const aPref = isPreferred(a.preferredDoctorIds, doctorId);
      const bPref = isPreferred(b.preferredDoctorIds, doctorId);
      if (aPref && !bPref) return -1;
      if (!aPref && bPref) return 1;
      return a.name.localeCompare(b.name);
    });
  } else {
    compatible.sort((a, b) => a.name.localeCompare(b.name));
  }

  const roomIds = compatible.map((r) => r.id);
  const roomDetails: CompatibleRoomDetail[] = compatible.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    roomType: r.roomType,
  }));
  return { roomIds, rooms: roomDetails };
}

/** Validate room assignment for an appointment. Throws if invalid. */
export async function validateRoomAssignment(
  branchId: number,
  roomId: number,
  start: Date,
  end: Date,
  options: {
    serviceId?: number;
    surgeryPackageId?: number;
    excludeAppointmentId?: number;
  } = {}
): Promise<void> {
  const room = await prisma.branchRoom.findFirst({
    where: { id: roomId, branchId },
    select: { id: true, status: true, bookable: true, roomType: true },
  });
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.status !== "ACTIVE") throw new Error("ROOM_INACTIVE");
  if (room.bookable === false) throw new Error("ROOM_NOT_BOOKABLE");

  const blocked = await isRoomBlocked(roomId, start, end);
  if (blocked) throw new Error("ROOM_BLOCKED");

  const overlap = await hasRoomOverlapWithCleaningBuffer(branchId, roomId, start, end, options.excludeAppointmentId);
  if (overlap) throw new Error("ROOM_DOUBLE_BOOKED");

  if (options.serviceId) {
    const allowed = await getAllowedRoomTypesForService(options.serviceId);
    if (!isRoomTypeCompatible(room.roomType, allowed)) throw new Error("ROOM_TYPE_INCOMPATIBLE");
  }
  if (options.surgeryPackageId) {
    const allowed = await getAllowedRoomTypesForPackage(options.surgeryPackageId);
    if (!isRoomTypeCompatible(room.roomType, allowed)) throw new Error("ROOM_TYPE_INCOMPATIBLE");
  }
}
