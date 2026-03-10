/**
 * Socket.IO gateway for real-time notifications.
 * Rooms: user:{userId}, org:{orgId}, branch:{branchId}
 * Events: notification:new, notification:update, unread:count
 */
import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

const appConfig = require("../config/appConfig");

let io: Server | null = null;

function resolveUserFromToken(token: string): { userId: number; orgId?: number; branchIds?: number[] } | null {
  try {
    const payload = jwt.verify(token, appConfig.jwt?.secret || process.env.JWT_SECRET || "secret") as any;
    const userId = payload?.id ?? payload?.userId ?? (payload?.sub ? Number(payload.sub) : null);
    const n = Number(userId);
    if (!Number.isFinite(n) || n <= 0) return null;
    return {
      userId: n,
      orgId: payload?.orgId ? Number(payload.orgId) : undefined,
      branchIds: Array.isArray(payload?.branchIds) ? payload.branchIds.map(Number).filter(Number.isFinite) : undefined,
    };
  } catch {
    return null;
  }
}

export function getSocketIO(): Server | null {
  return io;
}

/**
 * Emit notification:new to user room.
 */
export function emitNotificationNew(userId: number, payload: { notification: any }) {
  if (io) {
    io.to(`user:${userId}`).emit("notification:new", payload);
  }
}

/**
 * Emit unread:count to user room (after mark-read / read-all).
 */
export function emitUnreadCount(userId: number, count: number) {
  if (io) {
    io.to(`user:${userId}`).emit("unread:count", { count });
  }
}

/** Clinic queue: staff/console subscribers (room clinic:queue:{orgId}:{branchId}) */
export function emitQueueUpdated(orgId: number, branchId: number, payload: { tickets?: any[]; nowServing?: any }) {
  if (io) {
    io.to(`clinic:queue:${orgId}:${branchId}`).emit("QUEUE_UPDATED", payload);
  }
}

/** Clinic waiting screen: PII-safe now serving (room clinic:screen:{branchId}) */
export function emitNowServingChanged(orgId: number, branchId: number, payload: { tokenNo: string; roomName?: string; doctorInitials?: string; priorityTag?: string }) {
  if (io) {
    io.to(`clinic:screen:${branchId}`).emit("NOW_SERVING_CHANGED", payload);
    io.to(`clinic:queue:${orgId}:${branchId}`).emit("NOW_SERVING_CHANGED", payload);
  }
}

/** Clinic waiting screen: estimated wait times */
export function emitEstimateUpdated(orgId: number, branchId: number, estimates: any[]) {
  if (io) {
    io.to(`clinic:screen:${branchId}`).emit("ESTIMATE_UPDATED", { estimates });
  }
}

/** Doctor queue: notify doctor that their appointment list should refresh (room doctor:queue:{userId}) */
export function emitDoctorQueueUpdate(userId: number, payload: { event: string; appointmentId?: number }) {
  if (io) {
    io.to(`doctor:queue:${userId}`).emit("DOCTOR_QUEUE_UPDATED", payload);
  }
}

/** Doctor notifications: emit to doctor room */
export function emitDoctorNotification(userId: number, payload: {
  id?: number;
  type?: string;
  title?: string;
  message?: string;
  createdAt?: string | Date;
  readAt?: string | Date | null;
  [key: string]: any;
}) {
  if (io) {
    io.to(`doctor:queue:${userId}`).emit("DOCTOR_NOTIFICATION", payload);
  }
}

/** Doctor appointment stream updates */
export function emitDoctorAppointmentUpdate(userId: number, payload: {
  event: string;
  appointmentId?: number;
  branchId?: number;
  [key: string]: any;
}) {
  if (io) {
    io.to(`doctor:queue:${userId}`).emit("DOCTOR_APPOINTMENT_UPDATED", payload);
  }
}

/** Doctor lab-ready updates */
export function emitDoctorLabReady(userId: number, payload: {
  requisitionId?: number;
  visitId?: number;
  branchId?: number;
  [key: string]: any;
}) {
  if (io) {
    io.to(`doctor:queue:${userId}`).emit("DOCTOR_LAB_READY", payload);
  }
}

// ----- Branch Manager Control: escalation and alerts -----

/** Notify owner when a manager creates an escalation (pending approval). */
export function emitManagerEscalationCreated(ownerUserId: number, payload: { escalationId: number; branchId: number; type: string; branchName?: string }) {
  if (io) {
    io.to(`user:${ownerUserId}`).emit("manager:escalation:created", payload);
  }
}

/** Notify manager when owner resolves their escalation (approve/reject). */
export function emitManagerEscalationResolved(managerUserId: number, payload: { escalationId: number; status: string; decidedBy?: number; rejectReason?: string }) {
  if (io) {
    io.to(`user:${managerUserId}`).emit("manager:escalation:resolved", payload);
  }
}

/** Notify manager(s) of low stock alert at branch. */
export function emitManagerLowStockAlert(managerUserIds: number[], payload: { branchId: number; branchName?: string; count: number; itemIds?: number[] }) {
  if (io && Array.isArray(managerUserIds)) {
    managerUserIds.forEach((userId) => {
      io.to(`user:${userId}`).emit("manager:low_stock_alert", payload);
    });
  }
}

/** Nightly daily summary to owner (e.g. from cron). */
export function emitManagerDailySummary(ownerUserId: number, payload: { date: string; branches?: { branchId: number; name: string; revenue?: number; appointments?: number }[] }) {
  if (io) {
    io.to(`user:${ownerUserId}`).emit("manager:daily_summary", payload);
  }
}

export function attachSocketIO(server: HttpServer) {
  io = new Server(server, {
    path: "/api/v1/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.auth?.access_token ??
      socket.handshake.query?.token ??
      socket.handshake.query?.access_token;
    const t = typeof token === "string" ? token : "";
    const ctx = resolveUserFromToken(t);
    if (!ctx) {
      return next(new Error("Unauthorized"));
    }
    (socket as any).authContext = ctx;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const ctx = (socket as any).authContext as { userId: number; orgId?: number; branchIds?: number[] };
    if (!ctx) return;
    const { userId, orgId, branchIds } = ctx;

    socket.join(`user:${userId}`);
    socket.join(`doctor:queue:${userId}`);
    if (orgId) socket.join(`org:${orgId}`);
    if (Array.isArray(branchIds)) {
      branchIds.forEach((b: number) => {
        socket.join(`branch:${b}`);
        if (orgId) socket.join(`clinic:queue:${orgId}:${b}`);
        socket.join(`clinic:screen:${b}`);
      });
    }

    socket.emit("connected", { userId, orgId, branchIds });

    socket.on("clinic:queue:subscribe", (data: { orgId: number; branchId: number }) => {
      if (data?.orgId && data?.branchId) socket.join(`clinic:queue:${data.orgId}:${data.branchId}`);
    });
    socket.on("clinic:screen:subscribe", (data: { branchId: number }) => {
      if (data?.branchId) socket.join(`clinic:screen:${data.branchId}`);
    });

    socket.on("disconnect", () => {
      // rooms are left automatically
    });
  });

  return io;
}
