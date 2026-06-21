// Integration test: two WS clients against the running server.
// Usage: bun test/ws-it.ts
const URL = process.env.WS_URL ?? "ws://localhost:3100/ws";

type Msg = { v?: number; type: string; [k: string]: unknown };

function openClient(name: string): Promise<{ ws: WebSocket; first: Promise<Msg[]> }> {
  const ws = new WebSocket(URL);
  const received: Msg[] = [];
  const first = new Promise<Msg[]>((resolve) => {
    ws.addEventListener("message", (e) => {
      received.push(JSON.parse((e as MessageEvent).data));
      if (received.length >= 1) resolve(received);
    });
    ws.addEventListener("open", () => {});
    ws.addEventListener("error", () => resolve(received));
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve({ ws, first }));
    ws.addEventListener("error", () => reject(new Error(`${name}: connect failed`)));
  });
}

function nextMsg(ws: WebSocket, wantType?: string, timeoutMs = 1200): Promise<Msg | null> {
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(e.data) as Msg;
      if (!wantType || m.type === wantType) {
        ws.removeEventListener("message", onMsg);
        resolve(m);
      }
    };
    ws.addEventListener("message", onMsg);
    setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      resolve(null);
    }, timeoutMs);
  });
}

async function main() {
  let failures = 0;
  const assert = (cond: boolean, label: string) => {
    if (cond) console.log(`  ok  - ${label}`);
    else {
      console.log(`  FAIL- ${label}`);
      failures++;
    }
  };

  console.log("# A connects");
  const A = await openClient("A");
  const aInit = (await A.first)[0]!;
  assert(aInit.type === "init", "A receives init");
  assert(typeof aInit.visitorId === "string", "init has visitorId");
  assert(typeof aInit.seatIndex === "number", "init has seatIndex");
  assert(Array.isArray(aInit.presence), "init has presence array");
  assert((aInit.presence as unknown[]).length === 1, "presence includes self only");
  assert(typeof (aInit as any).v === "number", "init has v:1");
  assert(typeof (aInit as any).now === "number", "init has server time");

  console.log("# B connects");
  const B = await openClient("B");
  const bInit = (await B.first)[0]!;
  assert(bInit.type === "init", "B receives init");
  assert((bInit.presence as unknown[]).length === 2, "B sees A and self");
  const aSeesB = await nextMsg(A.ws, "presence:join");
  assert(aSeesB?.type === "presence:join", "A sees B join");

  console.log("# A sends chat");
  A.ws.send(JSON.stringify({ v: 1, type: "chat:send", text: "hello from A" }));
  const bMsg = await nextMsg(B.ws, "chat:message");
  assert(bMsg?.type === "chat:message", "B receives chat:message");
  assert(bMsg?.text === "hello from A", "message text preserved");
  assert(typeof bMsg?.ts === "number", "message has server ts");

  console.log("# rate limit");
  A.ws.send(JSON.stringify({ v: 1, type: "chat:send", text: "spam1" }));
  const err = await nextMsg(A.ws, "error");
  assert(err?.type === "error" && err?.code === "rate_limited", "A rate-limited on 2nd msg");

  console.log("# too long");
  await new Promise((r) => setTimeout(r, 2300));
  A.ws.send(JSON.stringify({ v: 1, type: "chat:send", text: "x".repeat(200) }));
  const tooLong = await nextMsg(A.ws, "error");
  assert(tooLong?.type === "error" && tooLong?.code === "too_long", "A rejected too_long");

  console.log("# sanitization");
  await new Promise((r) => setTimeout(r, 2300));
  A.ws.send(JSON.stringify({ v: 1, type: "chat:send", text: "<script>alert(1)</script>" }));
  const san = await nextMsg(B.ws, "chat:message");
  assert(san?.text === "&lt;script&gt;alert(1)&lt;/script&gt;", "html escaped");

  console.log("# B disconnects");
  B.ws.close();
  const aSeesLeave = await nextMsg(A.ws, "presence:leave");
  assert(aSeesLeave?.type === "presence:leave", "A sees B leave");

  console.log("# client-sent visitorId ignored (server overrides)");
  await new Promise((r) => setTimeout(r, 500));
  // A's own id from init must be the authoritative one in broadcasts
  A.ws.send(JSON.stringify({ v: 1, type: "chat:send", text: "idcheck", visitorId: "FAKE" }));
  await new Promise((r) => setTimeout(r, 2300));
  const C = await openClient("C");
  const cInit = (await C.first)[0]!;
  // C's presence snapshot should still contain A's real id, not FAKE
  const ids = (cInit.presence as Array<{ visitorId: string }>).map((p) => p.visitorId);
  assert(ids.includes(aInit.visitorId as string), "A's real visitorId in snapshot (FAKE ignored)");
  assert(!ids.includes("FAKE"), "FAKE visitorId not in snapshot");

  A.ws.close();
  C.ws.close();
  await new Promise((r) => setTimeout(r, 300));

  console.log(`\n${failures === 0 ? "ALL GREEN" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
