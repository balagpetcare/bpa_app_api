/**
 * Room Occupancy – live state and actions.
 * Current status, current/next appointment, mark occupied/cleaning/block/release.
 */

const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

const ACTIVE_APPOINTMENT_STATUSES = [
  "DRAFT", "PRE_BOOKED", "BOOKED", "CONFIRMED", "CHECKED_IN",
  "IN_QUEUE", "CALLED", "IN_CONSULT",
];

export type RoomLiveState = {
  roomId: number;
  roomName: string;
  code: string | null;
  operationalStatus: string;
  currentAppointment: {
    id: number;
    scheduledStartAt: string;
    scheduledEndAt: string;
    status: string;
    petName: string | null;
    doctorName: string | null;
    serviceName: string;
  } | null;
  nextAppointment: {
    id: number;
    scheduledStartAt: string;
    scheduledEndAt: string;
    petName: string | null;
    doctorName: string | null;
    serviceName: string;
  } | null;
  activeBlock: { id: number; type: string; startAt: string; endAt: string; reason: string | null } | null;
};

/** Get live state for one room: operational status, current/next appointment, active block. */
export async function getRoomLiveState(branchId: number, roomId: number, at: Date): Promise<RoomLiveState | null> {
  await releaseCleaningRoomsForBranch(branchId, at);
  const room = await prisma.branchRoom.findFirst({
    where: { id: roomId, branchId },
    select: { id: true, name: true, code: true, operationalStatus: true },
  });
  if (!room) return null;

  const [currentApt, nextApt, activeBlock] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        branchId,
        roomId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        scheduledStartAt: { lte: at },
        scheduledEndAt: { gt: at },
      },
      include: {
        service: { select: { name: true } },
        pet: { select: { name: true } },
        doctor: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
      },
      orderBy: { scheduledStartAt: "asc" },
    }),
    prisma.appointment.findFirst({
      where: {
        branchId,
        roomId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        scheduledStartAt: { gt: at },
      },
      include: {
        service: { select: { name: true } },
        pet: { select: { name: true } },
        doctor: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
      },
      orderBy: { scheduledStartAt: "asc" },
    }),
    prisma.clinicRoomBlock.findFirst({
      where: {
        roomId,
        startAt: { lte: at },
        endAt: { gt: at },
      },
      orderBy: { startAt: "desc" },
    }),
  ]);

  const mapApt = (a: any, includeStatus?: boolean) => {
    if (!a) return null;
    const base = {
      id: a.id,
      scheduledStartAt: a.scheduledStartAt?.toISOString?.() ?? String(a.scheduledStartAt),
      scheduledEndAt: a.scheduledEndAt?.toISOString?.() ?? String(a.scheduledEndAt),
      petName: (a.pet as any)?.name ?? null,
      doctorName: (a.doctor as any)?.user?.profile?.displayName ?? null,
      serviceName: (a.service as any)?.name ?? "",
    };
    if (includeStatus) (base as any).status = a.status;
    return base;
  };

  return {
    roomId: room.id,
    roomName: room.name,
    code: room.code,
    operationalStatus: room.operationalStatus,
    currentAppointment: currentApt ? mapApt(currentApt, true) as any : null,
    nextAppointment: nextApt ? mapApt(nextApt) : null,
    activeBlock: activeBlock
      ? {
          id: activeBlock.id,
          type: activeBlock.type,
          startAt: activeBlock.startAt?.toISOString?.() ?? String(activeBlock.startAt),
          endAt: activeBlock.endAt?.toISOString?.() ?? String(activeBlock.endAt),
          reason: activeBlock.reason,
        }
      : null,
  };
}

/** Get live state for all active rooms in branch. */
export async function getAllRoomsLiveState(branchId: number, at?: Date): Promise<RoomLiveState[]> {
  const when = at ?? new Date();
  await releaseCleaningRoomsForBranch(branchId, when);
  const rooms = await prisma.branchRoom.findMany({
    where: { branchId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const results: RoomLiveState[] = [];
  for (const r of rooms) {
    const state = await getRoomLiveState(branchId, r.id, when);
    if (state) results.push(state);
  }
  return results;
}

/** Create a room block. Returns the created block. */
export async function createRoomBlock(
  branchId: number,
  roomId: number,
  data: { type: string; startAt: Date; endAt: Date; reason?: string | null },
  createdByUserId?: number | null
): Promise<{ id: number; roomId: number; type: string; startAt: Date; endAt: Date; reason: string | null }> {
  const room = await prisma.branchRoom.findFirst({
    where: { id: roomId, branchId },
  });
  if (!room) throw new Error("ROOM_NOT_FOUND");

  const block = await prisma.clinicRoomBlock.create({
    data: {
      branchId,
      roomId,
      type: data.type,
      startAt: data.startAt,
      endAt: data.endAt,
      reason: data.reason?.trim() || null,
      createdByUserId: createdByUserId ?? null,
    },
  });
  return {
    id: block.id,
    roomId: block.roomId,
    type: block.type,
    startAt: block.startAt,
    endAt: block.endAt,
    reason: block.reason,
  };
}

/** Release (delete) a room block. */
export async function releaseRoomBlock(blockId: number, branchId: number): Promise<boolean> {
  const block = await prisma.clinicRoomBlock.findFirst({
    where: { id: blockId, branchId },
  });
  if (!block) return false;
  await prisma.clinicRoomBlock.delete({ where: { id: blockId } });
  return true;
}

/** List active blocks for a room in date range (for "Maintenance & blocks" and impact check). */
export async function listRoomBlocks(
  branchId: number,
  roomId: number,
  start: Date,
  end: Date
): Promise<{ id: number; type: string; startAt: Date; endAt: Date; reason: string | null }[]> {
  const blocks = await prisma.clinicRoomBlock.findMany({
    where: {
      branchId,
      roomId,
      startAt: { lt: end },
      endAt: { gt: start },
    },
    orderBy: { startAt: "asc" },
  });
  return blocks.map((b) => ({
    id: b.id,
    type: b.type,
    startAt: b.startAt,
    endAt: b.endAt,
    reason: b.reason,
  }));
}

/** Set room operational status (used by visit start/end). */
export async function setRoomOperationalStatus(
  roomId: number,
  branchId: number,
  status: "AVAILABLE" | "RESERVED" | "OCCUPIED" | "CLEANING" | "MAINTENANCE" | "BLOCKED"
): Promise<boolean> {
  const room = await prisma.branchRoom.findFirst({
    where: { id: roomId, branchId },
    select: { id: true },
  });
  if (!room) return false;
  await prisma.branchRoom.update({
    where: { id: roomId },
    data: { operationalStatus: status },
  });
  return true;
}

/** Visit start: set appointment's room to OCCUPIED. Call when visit status becomes IN_PROGRESS. */
export async function setRoomOccupiedForVisit(visitId: number, branchId: number): Promise<void> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    select: { appointmentId: true },
  });
  if (!visit?.appointmentId) return;
  const apt = await prisma.appointment.findFirst({
    where: { id: visit.appointmentId, branchId },
    select: { roomId: true },
  });
  if (apt?.roomId) await setRoomOperationalStatus(apt.roomId, branchId, "OCCUPIED");
}

/** Visit end: set appointment's room to CLEANING. Call when visit status becomes COMPLETED. */
export async function setRoomCleaningForVisit(visitId: number, branchId: number): Promise<void> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    select: { appointmentId: true },
  });
  if (!visit?.appointmentId) return;
  const apt = await prisma.appointment.findFirst({
    where: { id: visit.appointmentId, branchId },
    select: { roomId: true },
  });
  if (apt?.roomId) await setRoomOperationalStatus(apt.roomId, branchId, "CLEANING");
}

/** Live operations snapshot: ongoing visits, occupied/cleaning rooms, waiting appointments. For clinic floor / live board. */
export async function getLiveOperationsState(
  branchId: number,
  at: Date = new Date()
): Promise<{
  ongoingVisits: { visitId: number; appointmentId: number | null; roomId: number | null; roomName: string | null; doctorName: string | null; petName: string | null }[];
  occupiedRoomIds: number[];
  cleaningRoomIds: number[];
  waitingAppointments: { id: number; roomId: number | null; roomName: string | null; doctorName: string | null; petName: string | null; scheduledStartAt: string; status: string }[];
}> {
  await releaseCleaningRoomsForBranch(branchId, at);

  const [visits, rooms, appointments] = await Promise.all([
    prisma.visit.findMany({
      where: { branchId, status: "IN_PROGRESS" },
      select: {
        id: true,
        appointmentId: true,
        appointment: { select: { roomId: true, room: { select: { name: true } } } },
        doctor: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
        pet: { select: { name: true } },
      },
    }),
    prisma.branchRoom.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { id: true, operationalStatus: true },
    }),
    prisma.appointment.findMany({
      where: {
        branchId,
        status: { in: ["CHECKED_IN", "IN_QUEUE"] },
        scheduledStartAt: { lte: at },
        scheduledEndAt: { gte: at },
      },
      select: {
        id: true,
        roomId: true,
        room: { select: { name: true } },
        doctor: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
        pet: { select: { name: true } },
        scheduledStartAt: true,
        status: true,
      },
    }),
  ]);

  const ongoingVisits = visits.map((v: any) => ({
    visitId: v.id,
    appointmentId: v.appointmentId,
    roomId: v.appointment?.roomId ?? null,
    roomName: v.appointment?.room?.name ?? null,
    doctorName: v.doctor?.user?.profile?.displayName ?? null,
    petName: v.pet?.name ?? null,
  }));
  const occupiedRoomIds = rooms.filter((r: any) => r.operationalStatus === "OCCUPIED").map((r: any) => r.id);
  const cleaningRoomIds = rooms.filter((r: any) => r.operationalStatus === "CLEANING").map((r: any) => r.id);
  const waitingAppointments = appointments.map((a: any) => ({
    id: a.id,
    roomId: a.roomId,
    roomName: a.room?.name ?? null,
    doctorName: a.doctor?.user?.profile?.displayName ?? null,
    petName: a.pet?.name ?? null,
    scheduledStartAt: a.scheduledStartAt?.toISOString?.() ?? String(a.scheduledStartAt),
    status: a.status,
  }));

  return { ongoingVisits, occupiedRoomIds, cleaningRoomIds, waitingAppointments };
}

/** Release CLEANING rooms to AVAILABLE when completedAt + room.cleaningBufferMinutes has passed. Call from room read paths (e.g. getRoomLiveState, getCompatibleRoomIds). */
export async function releaseCleaningRoomsForBranch(branchId: number, now: Date = new Date()): Promise<void> {
  const cleaningRooms = await prisma.branchRoom.findMany({
    where: { branchId, status: "ACTIVE", operationalStatus: "CLEANING" },
    select: { id: true, cleaningBufferMinutes: true },
  });
  for (const room of cleaningRooms) {
    const bufferMin = room.cleaningBufferMinutes ?? 0;
    const lastCompletedVisit = await prisma.visit.findFirst({
      where: {
        branchId,
        status: "COMPLETED",
        completedAt: { not: null },
        appointment: { roomId: room.id },
      },
      select: { completedAt: true },
      orderBy: { completedAt: "desc" },
    });
    if (!lastCompletedVisit?.completedAt) continue;
    const effectiveEnd = new Date(lastCompletedVisit.completedAt.getTime() + bufferMin * 60 * 1000);
    if (now >= effectiveEnd) {
      await prisma.branchRoom.update({
        where: { id: room.id },
        data: { operationalStatus: "AVAILABLE" },
      });
    }
  }
}
