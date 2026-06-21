import {
  assignSeat,
  add,
  remove,
  releaseIp,
  tryReserve,
  snapshot,
  totalConnected,
  generateVisitorId,
} from "./presence";
import { register, unregister, handleSend, sanitize, broadcast } from "./chat";
import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.PORT ?? 3000);
// Trust X-Forwarded-For for per-IP limits. Keep true behind a trusted reverse
// proxy; set false when the server is directly exposed (XFF is then spoofable).
const TRUST_PROXY = (process.env.TRUST_PROXY ?? "true") !== "false";
// Optional access password (off when empty). When set, a client must authenticate
// over the WebSocket before being admitted to presence/chat. In-memory only.
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD ?? "";
const DIST = new URL("../dist/", import.meta.url);

// Shared radio state: a single switch for everyone. Anyone can turn it on/off,
// and the change is broadcast to all (one cuts -> all cut). Ephemeral, in-memory.
let radioOn = false;

type ConnData = { visitorId: string; ip: string; admitted: boolean; attempts: number };

function clientIp(req: Request, server: Bun.Server<ConnData>): string {
  if (TRUST_PROXY) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  const ip = server.requestIP(req);
  return ip?.address ?? "unknown";
}

function sendJson(ws: { send(data: string): void }, obj: unknown): void {
  ws.send(JSON.stringify(obj));
}

function publishPresence(obj: unknown): void {
  server.publish("presence", JSON.stringify(obj));
}

// Reserve a slot, seat the visitor, and announce their presence. Called on
// connect (no password) or after a successful auth (password set).
function admit(ws: ServerWebSocket<ConnData>): void {
  const { visitorId, ip } = ws.data;
  const reserve = tryReserve(ip);
  if (!reserve.ok) {
    sendJson(ws, { v: 1, type: "error", code: reserve.code, msg: "too many connections" });
    ws.close(1013);
    return;
  }
  ws.data.admitted = true;
  const seatIndex = assignSeat();
  add(visitorId, seatIndex);
  register(ws, visitorId);
  sendJson(ws, { v: 1, type: "init", visitorId, seatIndex, now: Date.now(), radio: radioOn, presence: snapshot() });
  publishPresence({ v: 1, type: "presence:join", visitorId, seatIndex });
  ws.subscribe("presence");
}

const server = Bun.serve<ConnData>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = server.upgrade(req, {
        data: { visitorId: generateVisitorId(), ip: clientIp(req, server), admitted: false, attempts: 0 },
      });
      return ok ? undefined : new Response("upgrade failed", { status: 400 });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
      if (ACCESS_PASSWORD === "") admit(ws);
      else sendJson(ws, { v: 1, type: "auth:required" });
    },
    message(ws, msg) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof msg === "string" ? msg : new TextDecoder().decode(msg));
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const p = parsed as { type?: string; text?: unknown; on?: unknown; password?: unknown };

      if (!ws.data.admitted) {
        if (p.type === "auth" && ACCESS_PASSWORD !== "") {
          if (typeof p.password === "string" && p.password === ACCESS_PASSWORD) {
            admit(ws);
          } else {
            ws.data.attempts++;
            sendJson(ws, { v: 1, type: "error", code: "auth_failed", msg: "wrong password" });
            if (ws.data.attempts >= 5) ws.close(1008);
          }
        }
        return;
      }

      if (p.type === "radio:set") {
        const on = p.on === true;
        if (on !== radioOn) {
          radioOn = on;
          publishPresence({ v: 1, type: "radio:state", on: radioOn });
        }
        return;
      }

      if (p.type !== "chat:send") return;
      const result = handleSend(ws, p.text);
      if (!result.ok) {
        sendJson(ws, {
          v: 1,
          type: "error",
          code: result.code,
          msg:
            result.code === "rate_limited"
              ? "slow down"
              : result.code === "too_long"
                ? "too long"
                : "empty",
        });
        return;
      }
      broadcast(sanitize(result.text), ws.data.visitorId);
    },
    close(ws) {
      if (!ws.data.admitted) return;
      const { visitorId, ip } = ws.data;
      remove(visitorId);
      releaseIp(ip);
      unregister(ws);
      publishPresence({ v: 1, type: "presence:leave", visitorId });
    },
  },
});

function serveStatic(pathname: string): Response {
  let path = pathname;
  if (path === "/" || path === "") path = "/index.html";
  const file = Bun.file(new URL("." + path, DIST));
  if (file.size > 0) return new Response(file);
  // SPA fallback only for extensionless paths (no asset/route mismatch)
  if (!path.includes(".")) {
    const index = Bun.file(new URL("index.html", DIST));
    if (index.size > 0) return new Response(index);
  }
  return new Response("not found", { status: 404 });
}

console.log(`campfire listening on :${PORT} (presence: ${totalConnected()})`);
