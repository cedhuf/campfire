export const INNER_SEATS = 6;
const MAX_TOTAL = 500;
const MAX_PER_IP = 10;

export type PresenceEntry = { seatIndex: number; connectedAt: number };

const visitors = new Map<string, PresenceEntry>();
const occupiedSeats = new Set<number>();
let overflowCounter = INNER_SEATS;
const perIpCount = new Map<string, number>();

export function totalConnected(): number {
  return visitors.size;
}

function ipKey(ip: string): string {
  return ip;
}

export function tryReserve(ip: string): { ok: true } | { ok: false; code: "too_many_connections" } {
  const perIp = perIpCount.get(ipKey(ip)) ?? 0;
  if (perIp >= MAX_PER_IP) return { ok: false, code: "too_many_connections" };
  if (visitors.size >= MAX_TOTAL) return { ok: false, code: "too_many_connections" };
  perIpCount.set(ipKey(ip), perIp + 1);
  return { ok: true };
}

export function assignSeat(): number {
  for (let i = 0; i < INNER_SEATS; i++) {
    if (!occupiedSeats.has(i)) {
      occupiedSeats.add(i);
      return i;
    }
  }
  const seat = overflowCounter++;
  return seat;
}

export function add(visitorId: string, seatIndex: number): PresenceEntry {
  const entry: PresenceEntry = { seatIndex, connectedAt: Date.now() };
  visitors.set(visitorId, entry);
  return entry;
}

export function remove(visitorId: string): PresenceEntry | undefined {
  const entry = visitors.get(visitorId);
  if (!entry) return undefined;
  visitors.delete(visitorId);
  if (entry.seatIndex < INNER_SEATS) occupiedSeats.delete(entry.seatIndex);
  return entry;
}

export function releaseIp(ip: string): void {
  const c = perIpCount.get(ipKey(ip)) ?? 0;
  if (c <= 1) perIpCount.delete(ipKey(ip));
  else perIpCount.set(ipKey(ip), c - 1);
}

export function snapshot(): Array<{ visitorId: string; seatIndex: number; connectedAt: number }> {
  return Array.from(visitors.entries()).map(([visitorId, e]) => ({
    visitorId,
    seatIndex: e.seatIndex,
    connectedAt: e.connectedAt,
  }));
}

export function generateVisitorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
