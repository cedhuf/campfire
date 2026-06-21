const MAX_LEN = 140;
const RATE_LIMIT_MS = 2200;

export type ChatWS = { readonly readyState: number; send(data: string): void };

type ConnMeta = { visitorId: string; lastMsgAt: number };

const conns = new Map<ChatWS, ConnMeta>();

export function register(ws: ChatWS, visitorId: string): void {
  conns.set(ws, { visitorId, lastMsgAt: 0 });
}

export function unregister(ws: ChatWS): void {
  conns.delete(ws);
}

export type SendResult =
  | { ok: true; text: string }
  | { ok: false; code: "rate_limited" | "too_long" | "empty" };

export function handleSend(ws: ChatWS, raw: unknown): SendResult {
  const meta = conns.get(ws);
  if (!meta) return { ok: false, code: "empty" };
  const now = Date.now();
  if (now - meta.lastMsgAt < RATE_LIMIT_MS) return { ok: false, code: "rate_limited" };
  if (typeof raw !== "string") return { ok: false, code: "empty" };
  const text = raw.trim();
  if (text.length === 0) return { ok: false, code: "empty" };
  if (text.length > MAX_LEN) return { ok: false, code: "too_long" };
  meta.lastMsgAt = now;
  return { ok: true, text };
}

export function sanitize(text: string): string {
  let s = text;
  s = s.replace(/&/g, "&amp;");
  s = s.replace(/</g, "&lt;");
  s = s.replace(/>/g, "&gt;");
  s = s.replace(/"/g, "&quot;");
  return s;
}

export function broadcast(text: string, visitorId: string): void {
  const ts = Date.now();
  const payload = JSON.stringify({
    v: 1,
    type: "chat:message",
    visitorId,
    text,
    ts,
  });
  for (const ws of conns.keys()) {
    if (ws.readyState === 1) ws.send(payload);
  }
}
