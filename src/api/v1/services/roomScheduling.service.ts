/**
 * Room Scheduling – schedule board data, by room/doctor/date.
 * Conflict detection for same room overlapping slots.
 */

const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

const ACTIVE_APPOINTMENT_STATUSES = [
  "DRAFT", "PRE_BOOKED", "BOOKED", "CONFIRMED", "CHECKED_IN",
  "IN_QUEUE", "CALLED", "IN_CONSULT",
];

export type ScheduleBoardFilters = {
  roomId?: number;
  doctorId?: number;
  serviceId?: number;
};

export type ScheduleBoardAppointment = {
  id: number;
  roomId: number | null;
  roomName: string | null;
  doctorId: number | null;
  doctorName: string | null;
  serviceId: number;
  serviceName: string;
  patientId: number | null;
  petId: number | null;
  petName: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  status: string;
  hasConflict: boolean;
};

export type ScheduleBoardResult = {
  dateFrom: string;
  dateTo: string;
  rooms: { id: number; name: string; code: string | null; roomType: string }[];
  appointments: ScheduleBoardAppointment[];
  conflicts: { appointmentId: number; roomId: number; overlapsWith: number[] }[];
};

/** Get schedule board for branch: appointments in date range with room/doctor/pet summary. */
export async function getScheduleBoard(
  branchId: number,
  dateFrom: Date,
  dateTo: Date,
  filters?: ScheduleBoardFilters
): Promise<ScheduleBoardResult> {
  const where: any = {
    branchId,
    status: { in: ACTIVE_APPOINTMENT_STATUSES },
    scheduledStartAt: { gte: dateFrom },
    scheduledEndAt: { lte: dateTo },
  };
  if (filters?.roomId) where.roomId = filters.roomId;
  if (filters?.doctorId) where.doctorId = filters.doctorId;
  if (filters?.serviceId) where.serviceId = filters.serviceId;

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      room: { select: { id: true, name: true, code: true, roomType: true } },
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      service: { select: { id: true, name: true } },
      pet: { select: { id: true, name: true } },
    },
    orderBy: [{ scheduledStartAt: "asc" }],
  });

  const roomIds = [...new Set(appointments.map((a: any) => a.roomId).filter(Boolean))] as number[];
  const roomsList = roomIds.length
    ? await prisma.branchRoom.findMany({
        where: { id: { in: roomIds }, branchId },
        select: { id: true, name: true, code: true, roomType: true },
      })
    : [];
  const allRooms = filters?.roomId
    ? await prisma.branchRoom.findMany({
        where: { branchId, status: "ACTIVE", id: filters.roomId },
        select: { id: true, name: true, code: true, roomType: true },
      })
    : await prisma.branchRoom.findMany({
        where: { branchId, status: "ACTIVE" },
        select: { id: true, name: true, code: true, roomType: true },
        orderBy: [{ name: "asc" }],
      });

  const byRoom = new Map<number, any[]>();
  for (const a of appointments) {
    if (a.roomId) {
      if (!byRoom.has(a.roomId)) byRoom.set(a.roomId, []);
      byRoom.get(a.roomId)!.push(a);
    }
  }
  const roomIdsInUse = Array.from(byRoom.keys());
  const roomBuffers =
    roomIdsInUse.length > 0
      ? await prisma.branchRoom.findMany({
          where: { id: { in: roomIdsInUse }, branchId },
          select: { id: true, cleaningBufferMinutes: true },
        })
      : [];
  const bufferByRoomId = new Map(roomBuffers.map((r: any) => [r.id, r.cleaningBufferMinutes ?? 0]));

  const conflicts: { appointmentId: number; roomId: number; overlapsWith: number[] }[] = [];
  for (const [rid, list] of byRoom) {
    const bufferMin = Number(bufferByRoomId.get(rid) ?? 0);
    const sorted = [...list].sort(
      (x: any, y: any) => new Date(x.scheduledStartAt).getTime() - new Date(y.scheduledStartAt).getTime()
    );
    for (let i = 0; i < sorted.length; i++) {
      const endAt = new Date(sorted[i].scheduledEndAt);
      const effectiveEndI = endAt.getTime() + bufferMin * 60 * 1000;
      const overlaps: number[] = [];
      for (let j = i + 1; j < sorted.length; j++) {
        const startJ = new Date(sorted[j].scheduledStartAt).getTime();
        if (startJ < effectiveEndI) overlaps.push(sorted[j].id);
        else break;
      }
      if (overlaps.length > 0) conflicts.push({ appointmentId: sorted[i].id, roomId: rid, overlapsWith: overlaps });
    }
  }
  const conflictAppointmentIds = new Set(conflicts.flatMap((c) => [c.appointmentId, ...c.overlapsWith]));

  const mapAppointment = (a: any): ScheduleBoardAppointment => ({
    id: a.id,
    roomId: a.roomId,
    roomName: a.room?.name ?? null,
    doctorId: a.doctorId,
    doctorName: (a.doctor as any)?.user?.profile?.displayName ?? null,
    serviceId: a.serviceId,
    serviceName: (a.service as any)?.name ?? "",
    patientId: a.patientId,
    petId: a.petId,
    petName: (a.pet as any)?.name ?? null,
    scheduledStartAt: a.scheduledStartAt?.toISOString?.() ?? String(a.scheduledStartAt),
    scheduledEndAt: a.scheduledEndAt?.toISOString?.() ?? String(a.scheduledEndAt),
    status: a.status,
    hasConflict: conflictAppointmentIds.has(a.id),
  });

  return {
    dateFrom: dateFrom.toISOString().slice(0, 10),
    dateTo: dateTo.toISOString().slice(0, 10),
    rooms: allRooms.map((r: any) => ({ id: r.id, name: r.name, code: r.code, roomType: r.roomType })),
    appointments: appointments.map(mapAppointment),
    conflicts,
  };
}

/** Get today's schedule for a single room (for room detail "Today Schedule" tab). */
export async function getRoomTodaySchedule(branchId: number, roomId: number, date: Date): Promise<ScheduleBoardAppointment[]> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const appointments = await prisma.appointment.findMany({
    where: {
      branchId,
      roomId,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      scheduledStartAt: { gte: dayStart },
      scheduledEndAt: { lte: dayEnd },
    },
    include: {
      service: { select: { id: true, name: true } },
      pet: { select: { id: true, name: true } },
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
    },
    orderBy: [{ scheduledStartAt: "asc" }],
  });

  return appointments.map((a: any) => ({
    id: a.id,
    roomId: a.roomId,
    roomName: null,
    doctorId: a.doctorId,
    doctorName: (a.doctor as any)?.user?.profile?.displayName ?? null,
    serviceId: a.serviceId,
    serviceName: (a.service as any)?.name ?? "",
    patientId: a.patientId,
    petId: a.petId,
    petName: (a.pet as any)?.name ?? null,
    scheduledStartAt: a.scheduledStartAt?.toISOString?.() ?? String(a.scheduledStartAt),
    scheduledEndAt: a.scheduledEndAt?.toISOString?.() ?? String(a.scheduledEndAt),
    status: a.status,
    hasConflict: false,
  }));
}
