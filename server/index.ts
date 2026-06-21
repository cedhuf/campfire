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

const PORT = Number(process.env.PORT ?? 3000);
// Trust X-Forwarded-For for per-IP limits. Keep true behind a trusted reverse
// proxy; set false when the server is directly exposed (XFF is then spoofable).
const TRUST_PROXY = (process.env.TRUST_PROXY ?? "true") !== "false";
const DIST = new URL("../dist/", import.meta.url);

type ConnData = { visitorId: string; ip: string; admitted: boolean };

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

const server = Bun.serve<ConnData>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = server.upgrade(req, {
        data: { visitorId: generateVisitorId(), ip: clientIp(req, server), admitted: false },
      });
      return ok ? undefined : new Response("upgrade failed", { status: 400 });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
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

      sendJson(ws, { v: 1, type: "init", visitorId, seatIndex, now: Date.now(), presence: snapshot() });
      publishPresence({ v: 1, type: "presence:join", visitorId, seatIndex });
      ws.subscribe("presence");
    },
    message(ws, msg) {
      if (!ws.data.admitted) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof msg === "string" ? msg : new TextDecoder().decode(msg));
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const p = parsed as { type?: string; text?: unknown };
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
