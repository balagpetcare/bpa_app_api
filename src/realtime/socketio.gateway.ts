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
    if (orgId) socket.join(`org:${orgId}`);
    if (Array.isArray(branchIds)) {
      branchIds.forEach((b: number) => socket.join(`branch:${b}`));
    }

    socket.emit("connected", { userId, orgId, branchIds });

    socket.on("disconnect", () => {
      // rooms are left automatically
    });
  });

  return io;
}
