import { Scene } from "./scene";
import { Chat, type ChatMode } from "./chat";
import { DayBar } from "./daybar";
import { themeAt } from "./theme";
import { Radio, RADIO_URL } from "./radio";
import { FireSound, FIRE_SOUND_URL } from "./ambient";
import { Presents } from "./presents";
import { detectLang, setLang, applyI18n, t, type Lang } from "./i18n";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hudCount = document.getElementById("hud-count") as HTMLElement;
const chatLog = document.getElementById("chat-log") as HTMLElement;
const chatAir = document.getElementById("chat-air") as HTMLElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const daybarEl = document.getElementById("daybar") as HTMLElement;
const motionBtn = document.getElementById("motion-btn") as HTMLButtonElement;
const chatmodeBtn = document.getElementById("chatmode-btn") as HTMLButtonElement;
const radioPower = document.getElementById("radio-power") as HTMLButtonElement;
const radioMute = document.getElementById("radio-mute") as HTMLButtonElement;
const settingsOpen = document.getElementById("settings-open") as HTMLButtonElement;
const modalBackdrop = document.getElementById("modal-backdrop") as HTMLElement;
const modalClose = document.getElementById("modal-close") as HTMLButtonElement;
const fireBtn = document.getElementById("fire-btn") as HTMLButtonElement;
const langSeg = document.getElementById("lang-seg") as HTMLElement;
const shareBtn = document.getElementById("share-btn") as HTMLButtonElement;
const gate = document.getElementById("gate") as HTMLElement;
const gateForm = document.getElementById("gate-form") as HTMLFormElement;
const gateInput = document.getElementById("gate-input") as HTMLInputElement;
const gateError = document.getElementById("gate-error") as HTMLElement;
const toast = document.getElementById("toast") as HTMLElement;
const daybarBtn = document.getElementById("daybar-btn") as HTMLButtonElement;
const presentsEl = document.getElementById("presents") as HTMLElement;

type PresenceItem = { visitorId: string; seatIndex: number; connectedAt: number };

const scene = new Scene(canvas);
const chat = new Chat(chatLog, chatAir, chatInput, chatForm, (text) => {
  safeSend({ v: 1, type: "chat:send", text });
});

const daybar = new DayBar(daybarEl);
const fire = new FireSound(FIRE_SOUND_URL);

const presence = new Map<string, PresenceItem>();
const presents = new Presents(presentsEl, presence, () => selfId, () => Date.now() + serverOffset);
const radio = new Radio(RADIO_URL, radioPower, radioMute, (on) => {
  safeSend({ v: 1, type: "radio:set", on });
});
daybarBtn.addEventListener("click", () => {
  if (presents.isOpen()) presents.close();
  else presents.open();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && presents.isOpen()) presents.close();
});
let selfId = "";
let ws: WebSocket | null = null;
let backoff = 500;
// Offset between the server clock and ours, so every visitor shares the same
// day phase regardless of local timezone. `serverOffset` aligns the wall clock;
// `tzOffset` is the server's timezone (minutes east of UTC), applied so the
// day fraction is expressed in the server's local time (not UTC).
let serverOffset = 0;
let tzOffset = 0;

const DAY_MS = 86_400_000;

function dayFraction(ms: number): number {
  return ((((ms + tzOffset * 60_000) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
}

function tickTime() {
  const frac = dayFraction(Date.now() + serverOffset);
  const theme = themeAt(frac);
  scene.setTheme(theme);
  daybar.update(frac, theme);
  presents.renderHeader(frac, theme);
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
        hideGate();
        selfId = msg.visitorId;
        if (typeof msg.now === "number") {
          serverOffset = msg.now - Date.now();
          if (typeof msg.tz === "number") tzOffset = msg.tz;
          tickTime();
        }
        if (typeof msg.radio === "boolean") radio.setGlobal(msg.radio);
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
      case "radio:state": {
        radio.setGlobal(msg.on === true);
        break;
      }
      case "auth:required": {
        if (gatePassword) safeSend({ v: 1, type: "auth", password: gatePassword });
        else showGate(false);
        break;
      }
      case "error": {
        if (msg.code === "auth_failed") {
          gatePassword = "";
          gateInput.value = "";
          showGate(true);
        } else if (msg.code === "rate_limited") {
          flashPlaceholder("err_slow");
        } else if (msg.code === "too_long") {
          flashPlaceholder("err_long");
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

function flashPlaceholder(key: string): void {
  chatInput.placeholder = t(key);
  setTimeout(() => (chatInput.placeholder = t("whisper")), 1500);
}

// Password gate — only seen when the server runs with ACCESS_PASSWORD set.
let gatePassword = "";
function showGate(error: boolean): void {
  gateError.hidden = !error;
  gate.hidden = false;
  gateInput.focus();
}
function hideGate(): void {
  gate.hidden = true;
  gateError.hidden = true;
}
gateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  gatePassword = gateInput.value;
  gateError.hidden = true;
  safeSend({ v: 1, type: "auth", password: gatePassword });
});

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

// Chat display mode: "air" (default, messages drift in the scene) or "classic".
const CHAT_KEY = "campfire:chatmode";
let chatMode: ChatMode = localStorage.getItem(CHAT_KEY) === "classic" ? "classic" : "air";
function applyChatMode(m: ChatMode): void {
  chatmodeBtn.setAttribute("aria-checked", String(m === "air"));
  chat.setMode(m);
}
applyChatMode(chatMode);
chatmodeBtn.addEventListener("click", () => {
  chatMode = chatMode === "air" ? "classic" : "air";
  localStorage.setItem(CHAT_KEY, chatMode);
  applyChatMode(chatMode);
});

// Settings modal
function openModal(): void {
  modalBackdrop.classList.add("open");
  modalClose.focus();
}
function closeModal(): void {
  modalBackdrop.classList.remove("open");
  settingsOpen.focus();
}
settingsOpen.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalBackdrop.classList.contains("open")) closeModal();
});

// Fire crackle ambience
function applyFire(on: boolean): void {
  fireBtn.setAttribute("aria-checked", String(on));
}
applyFire(fire.isEnabled());
fireBtn.addEventListener("click", () => {
  const on = !fire.isEnabled();
  fire.setEnabled(on);
  applyFire(on);
});

// Share the link
let toastTimer = 0;
function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => (toast.hidden = true), 260);
  }, 1800);
}
shareBtn.addEventListener("click", async () => {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: "campfire", text: t("share_text"), url });
      return;
    } catch {
      /* cancelled — fall through to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast(t("link_copied"));
  } catch {
    showToast(url);
  }
});

// Language (FR / EN, English fallback)
const langOpts = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".lang-opt"));
function applyLang(l: Lang): void {
  setLang(l);
  localStorage.setItem("campfire:lang", l);
  applyI18n();
  chatInput.placeholder = t("whisper");
  radio.refresh();
  for (const b of langOpts) {
    const active = b.dataset.lang === l;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  tickTime(); // refresh daybar phase label immediately
}
for (const b of langOpts) {
  b.addEventListener("click", () => applyLang(b.dataset.lang as Lang));
}
applyLang(detectLang());

tickTime();
setInterval(tickTime, 1000);

// iOS Safari: when the virtual keyboard opens, fixed-positioned elements at
// the bottom (chat input, radio, actions) get covered. The
// `interactive-widget=resizes-content` viewport meta handles this on iOS
// 16.4+, but older versions need a JS fallback that tracks the visual
// viewport and exposes the keyboard height as a CSS variable.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const updateKb = () => {
    const kb = Math.max(0, window.innerHeight - vv.height);
    document.documentElement.style.setProperty("--kb", kb + "px");
  };
  vv.addEventListener("resize", updateKb);
  vv.addEventListener("scroll", updateKb);
  updateKb();
}

connect();
scene.start();
