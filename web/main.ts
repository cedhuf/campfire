import { Scene } from "./scene";
import { Chat } from "./chat";
import { DayBar } from "./daybar";
import { themeAt } from "./theme";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hudCount = document.getElementById("hud-count") as HTMLElement;
const chatLog = document.getElementById("chat-log") as HTMLElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const daybarEl = document.getElementById("daybar") as HTMLElement;
const motionBtn = document.getElementById("motion-btn") as HTMLButtonElement;

type PresenceItem = { visitorId: string; seatIndex: number; connectedAt: number };

const scene = new Scene(canvas);
const chat = new Chat(chatLog, chatInput, chatForm, (text) => {
  safeSend({ v: 1, type: "chat:send", text });
});

const daybar = new DayBar(daybarEl);

const presence = new Map<string, PresenceItem>();
let selfId = "";
let ws: WebSocket | null = null;
let backoff = 500;
// Offset between the server clock and ours, so every visitor shares the same
// day phase regardless of local timezone (day fraction is derived in UTC).
let serverOffset = 0;

const DAY_MS = 86_400_000;

function dayFraction(ms: number): number {
  return (((ms % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
}

function tickTime() {
  const frac = dayFraction(Date.now() + serverOffset);
  const theme = themeAt(frac);
  scene.setTheme(theme);
  daybar.update(frac, theme);
}

function updateHud() {
  const n = presence.size;
  hudCount.textContent = String(n).padStart(2, "0");
  scene.setCount(n);
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;

  sock.addEventListener("open", () => {
    backoff = 500;
  });

  sock.addEventListener("message", (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "init": {
        selfId = msg.visitorId;
        if (typeof msg.now === "number") {
          serverOffset = msg.now - Date.now();
          tickTime();
        }
        chat.setSelf(selfId);
        presence.clear();
        for (const p of msg.presence ?? []) {
          presence.set(p.visitorId, { visitorId: p.visitorId, seatIndex: p.seatIndex, connectedAt: p.connectedAt });
        }
        // re-sync scene from scratch
        for (const p of presence.values()) scene.add(p.visitorId, p.seatIndex);
        updateHud();
        break;
      }
      case "presence:join": {
        if (msg.visitorId === selfId) break;
        const entry: PresenceItem = { visitorId: msg.visitorId, seatIndex: msg.seatIndex, connectedAt: Date.now() };
        presence.set(msg.visitorId, entry);
        scene.add(msg.visitorId, msg.seatIndex);
        updateHud();
        break;
      }
      case "presence:leave": {
        if (msg.visitorId === selfId) break;
        if (presence.delete(msg.visitorId)) {
          scene.remove(msg.visitorId);
          updateHud();
        }
        break;
      }
      case "chat:message": {
        chat.add(msg.visitorId, msg.text, msg.ts);
        break;
      }
      case "error": {
        // minimal: brief input flash via placeholder
        if (msg.code === "rate_limited") {
          chatInput.placeholder = "// doucement…";
          setTimeout(() => (chatInput.placeholder = "murmurer…"), 1500);
        } else if (msg.code === "too_long") {
          chatInput.placeholder = "// trop long…";
          setTimeout(() => (chatInput.placeholder = "murmurer…"), 1500);
        }
        break;
      }
    }
  });

  sock.addEventListener("close", () => {
    ws = null;
    scheduleReconnect();
  });
  sock.addEventListener("error", () => {
    sock.close();
  });
}

function scheduleReconnect() {
  const delay = backoff;
  backoff = Math.min(backoff * 1.7, 8000);
  setTimeout(connect, delay);
}

function safeSend(obj: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Reduced-motion: OS preference by default, overridable via the config panel.
const RM_KEY = "campfire:reduced";
function resolveReduced(): boolean {
  const stored = localStorage.getItem(RM_KEY);
  if (stored !== null) return stored === "1";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
let reduced = resolveReduced();
function applyReduced(r: boolean): void {
  document.documentElement.classList.toggle("reduced", r);
  motionBtn.setAttribute("aria-checked", String(!r));
  scene.setReduced(r);
}
applyReduced(reduced);
motionBtn.addEventListener("click", () => {
  reduced = !reduced;
  localStorage.setItem(RM_KEY, reduced ? "1" : "0");
  applyReduced(reduced);
});

tickTime();
setInterval(tickTime, 1000);

connect();
scene.start();
