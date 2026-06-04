/**
 * WebSocket gateway for realtime notifications.
 * Path: /api/v1/realtime. Auth via JWT (query or first message).
 * Rooms: user:{userId}. Redis pub/sub for multi-instance broadcast.
 */
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server as HttpServer } from "http";

const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");

import {
  createDedicatedRedisClient,
  isRedisPubSubEnabled,
} from "../infrastructure/redis/redis.client";

let redisPublisher: any = null;
let redisSubscriber: any = null;
const roomPrefix = "user:";
const channelPrefix = "notif:user:";

// roomKey -> Set of WebSocket
const rooms = new Map<string, Set<WebSocket>>();
// ws -> userId (for cleanup)
const wsToUserId = new Map<WebSocket, number>();
// channels we're subscribed to on Redis (so we only subscribe once per channel)
const subscribedChannels = new Set<string>();

function getRedisPublisher(): any {
  if (!isRedisPubSubEnabled()) return null;
  if (redisPublisher) return redisPublisher;
  redisPublisher = createDedicatedRedisClient("realtime-publisher");
  return redisPublisher;
}

function getRedisSubscriber(): any {
  if (!isRedisPubSubEnabled()) return null;
  if (redisSubscriber) return redisSubscriber;
  redisSubscriber = createDedicatedRedisClient("realtime-subscriber");
  if (redisSubscriber) {
    redisSubscriber.on("message", (channel: string, message: string) => {
      const roomKey = channel.startsWith(channelPrefix) ? channel.replace(channelPrefix, roomPrefix) : null;
      if (roomKey) broadcastToRoom(roomKey, message);
    });
  }
  return redisSubscriber;
}

function roomKey(userId: number): string {
  return `${roomPrefix}${userId}`;
}

function channelName(userId: number): string {
  return `${channelPrefix}${userId}`;
}

function ensureSubscribed(userId: number) {
  const sub = getRedisSubscriber();
  if (!sub) return;
  const ch = channelName(userId);
  if (subscribedChannels.has(ch)) return;
  subscribedChannels.add(ch);
  sub.subscribe(ch, (err: Error) => {
    if (err) console.warn("[Realtime] subscribe error", ch, err?.message);
  });
}

function broadcastToRoom(roomKey: string, rawMessage: string) {
  const set = rooms.get(roomKey);
  if (!set) return;
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(rawMessage);
      } catch (e) {
        // ignore
      }
    }
  });
}

/**
 * Publish notification event to a user (call from NotificationService).
 * Publishes to Redis so other instances can broadcast; also broadcasts locally.
 */
export function publishNotificationToUser(userId: number, payload: { event: string; data: Record<string, unknown> }) {
  const ch = channelName(userId);
  const raw = JSON.stringify(payload);

  const pub = getRedisPublisher();
  if (pub) {
    pub.publish(ch, raw).catch((err: Error) => console.warn("[Realtime] publish error", err?.message));
  }

  const rk = roomKey(userId);
  broadcastToRoom(rk, raw);
}

function resolveUserIdFromToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, appConfig.jwt.secret) as any;
    const id = payload?.id ?? payload?.userId ?? (payload?.sub ? Number(payload.sub) : null);
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function attachWss(server: HttpServer) {
  const apiPrefix = "/api/v1";
  const path = `${apiPrefix}/realtime`;
  const wss = new WebSocketServer({ server, path });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url || "";
    const params = new URLSearchParams(url.includes("?") ? url.split("?")[1] : "");
    let token = params.get("token") || params.get("access_token") || (req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim())[0] || "";

    let userId: number | null = resolveUserIdFromToken(token);
    if (!userId && !token) {
      ws.close(4401, "Unauthorized");
      return;
    }

    if (!userId && token) {
      ws.once("message", (data: Buffer) => {
        try {
          const text = data.toString();
          const parsed = JSON.parse(text);
          const t = parsed?.token ?? parsed?.access_token ?? parsed?.auth;
          if (t) userId = resolveUserIdFromToken(String(t));
        } catch {
          // ignore
        }
        if (!userId) {
          ws.close(4401, "Unauthorized");
          return;
        }
        joinRoom(ws, userId);
      });
      return;
    }

    joinRoom(ws, userId!);
  });

  function joinRoom(ws: WebSocket, userId: number) {
    const key = roomKey(userId);
    if (!rooms.has(key)) rooms.set(key, new Set());
    rooms.get(key)!.add(ws);
    wsToUserId.set(ws, userId);
    ensureSubscribed(userId);

    ws.on("close", () => {
      rooms.get(key)?.delete(ws);
      wsToUserId.delete(ws);
      if (rooms.get(key)?.size === 0) rooms.delete(key);
    });
    ws.on("error", () => {
      rooms.get(key)?.delete(ws);
      wsToUserId.delete(ws);
    });

    const welcome = JSON.stringify({ event: "connected", data: { userId } });
    if (ws.readyState === WebSocket.OPEN) ws.send(welcome);
  }
}

/**
 * Attach WebSocket server to the HTTP server. Call from index.ts after creating server.
 */
export function attachRealtimeGateway(server: HttpServer) {
  attachWss(server);
}
