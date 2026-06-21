import { Scene } from "./scene";
import { Chat, type ChatMode } from "./chat";
import { DayBar } from "./daybar";
import { themeAt } from "./theme";
import { Radio, RADIO_URL } from "./radio";
import { FireSound, FIRE_SOUND_URL } from "./ambient";
import { Presents } from "./presents";
import { detectLang, setLang, applyI18n, t, type Lang } from "./i18n";
import qrcode from "qrcode-generator";

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
const fireVolume = document.getElementById("fire-volume") as HTMLInputElement;
const connDot = document.getElementById("conn-dot") as HTMLElement;
const connLabel = document.getElementById("conn-label") as HTMLElement;

type ConnState = "live" | "connecting" | "reconnecting";
let connState: ConnState = "connecting";
function setConn(state: ConnState): void {
  connState = state;
  connDot.classList.toggle("is-live", state === "live");
  connDot.classList.toggle("is-connecting", state === "connecting");
  connDot.classList.toggle("is-reconnecting", state === "reconnecting");
  const label = state === "live" ? `CAMPFIRE&nbsp;/&nbsp;${t("conn_live")}` : state === "connecting" ? `CAMPFIRE&nbsp;/&nbsp;${t("conn_connecting")}` : `CAMPFIRE&nbsp;/&nbsp;${t("conn_reconnecting")}`;
  connLabel.innerHTML = label;
}

type PresenceItem = { visitorId: string; seatIndex: number; connectedAt: number };

const scene = new Scene(canvas);
const chat = new Chat(chatLog, chatAir, chatInput, chatForm, (text) => {
  safeSend({ v: 1, type: "chat:send", text });
}, (typing) => {
  // Broadcast to the room so others see your pastille react — your own dot is
  // intentionally left alone (you already know you're typing).
  safeSend({ v: 1, type: "typing", on: typing });
});

const daybar = new DayBar(daybarEl);
const fire = new FireSound(FIRE_SOUND_URL);

const presence = new Map<string, PresenceItem>();
const presents = new Presents(presentsEl, presence, () => selfId, () => Date.now() + serverOffset, (target) => {
  if (target && target !== selfId) safeSend({ v: 1, type: "nudge", target });
});
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
let latitude = 46.6; // updated from the server's init (deployment location)

const DAY_MS = 86_400_000;

function dayFraction(ms: number): number {
  return ((((ms + tzOffset * 60_000) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
}

// Sunrise/sunset as day fractions for the given local time + latitude, so the
// cycle tracks the seasons (around solar noon ≈ 12:00 local). `localMs` must
// already be shifted into the server's local timezone (read via getUTC*).
function solarTimes(localMs: number, latDeg: number): [number, number] {
  const d = new Date(localMs);
  const dayOfYear = (localMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS;
  const phi = (latDeg * Math.PI) / 180;
  const decl = 0.40928 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365.25);
  const cosH = Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl)));
  const H = Math.acos(cosH); // half-day arc (0..π)
  const halfDay = Math.max(0.08, Math.min(0.46, (H / Math.PI) * 0.5));
  return [0.5 - halfDay, 0.5 + halfDay];
}

// Stretch the clock fraction so real sunrise/sunset land on the theme's
// dawn/dusk anchors — day expands in summer, contracts in winter.
function remapDay(f: number, sr: number, ss: number): number {
  const TR = 0.28; // theme sunrise anchor
  const TS = 0.76; // theme sunset anchor
  if (f < sr) return (f / sr) * TR;
  if (f < ss) return TR + ((f - sr) / (ss - sr)) * (TS - TR);
  return TS + ((f - ss) / (1 - ss)) * (1 - TS);
}

function tickTime() {
  const nowMs = Date.now() + serverOffset;
  const clockFrac = dayFraction(nowMs);
  const [sr, ss] = solarTimes(nowMs + tzOffset * 60_000, latitude);
  const theme = themeAt(remapDay(clockFrac, sr, ss));
  scene.setTheme(theme);
  daybar.update(clockFrac, theme);
  presents.renderHeader(clockFrac, theme);
}

function updateHud() {
  const n = presence.size;
  hudCount.textContent = String(n).padStart(2, "0");
  scene.setCount(n);
}

function connect() {
  setConn(ws === null && backoff > 500 ? "reconnecting" : "connecting");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;

  sock.addEventListener("open", () => {
    backoff = 500;
    setConn("connecting");
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
        setConn("live");
        selfId = msg.visitorId;
        if (typeof msg.now === "number") {
          serverOffset = msg.now - Date.now();
          if (typeof msg.tz === "number") tzOffset = msg.tz;
          if (typeof msg.lat === "number") latitude = msg.lat;
          tickTime();
        }
        if (typeof msg.radio === "boolean") radio.setGlobal(msg.radio);
        chat.setSelf(selfId);
        scene.setSelf(selfId);
        presence.clear();
        for (const p of msg.presence ?? []) {
          presence.set(p.visitorId, { visitorId: p.visitorId, seatIndex: p.seatIndex, connectedAt: p.connectedAt });
        }
        // Re-sync the scene to exactly this snapshot: add newcomers and drop any
        // orphaned pastilles left over from a previous connection (a reconnect
        // hands out a fresh visitorId, so the old self dot would otherwise
        // linger — visible on mobile as pastilles piling up).
        const ids = new Set<string>();
        for (const p of presence.values()) {
          scene.add(p.visitorId, p.seatIndex);
          ids.add(p.visitorId);
        }
        scene.retain(ids);
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
        scene.speak(msg.visitorId);
        break;
      }
      case "radio:state": {
        radio.setGlobal(msg.on === true);
        break;
      }
      case "typing": {
        if (msg.from && msg.from !== selfId) scene.setTyping(msg.from, msg.on === true);
        break;
      }
      case "nudge": {
        if (msg.target === selfId) {
          if (!nudgeEnabled) break; // opted out of receiving waves
          scene.ripple(selfId);
          if (msg.from && presence.has(msg.from)) showToast(t("nudged"));
        } else {
          scene.ripple(msg.target);
        }
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
    setConn("reconnecting");
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

// Fire crackle volume
fireVolume.value = String(Math.round(fire.getVolume() * 100));
const syncVolFill = () => fireVolume.style.setProperty("--vol-fill", fireVolume.value + "%");
syncVolFill();
fireVolume.addEventListener("input", () => {
  fire.setVolume(Number(fireVolume.value) / 100);
  syncVolFill();
});

// Radio volume
const radioVolume = document.getElementById("radio-volume") as HTMLInputElement;
radioVolume.value = String(Math.round(radio.getVolume() * 100));
const syncRadioFill = () => radioVolume.style.setProperty("--vol-fill", radioVolume.value + "%");
syncRadioFill();
radioVolume.addEventListener("input", () => {
  radio.setVolume(Number(radioVolume.value) / 100);
  syncRadioFill();
});

// Quiet hours
const quietBtn = document.getElementById("quiet-btn") as HTMLButtonElement;
function applyQuiet(on: boolean): void {
  quietBtn.setAttribute("aria-checked", String(on));
}
applyQuiet(radio.getQuietHours());
quietBtn.addEventListener("click", () => {
  const on = !radio.getQuietHours();
  radio.setQuietHours(on);
  applyQuiet(on);
});

// Nudge toggle (whether others can wave at you; also gates your own taps)
const NUDGE_KEY = "campfire:nudge";
let nudgeEnabled = localStorage.getItem(NUDGE_KEY) !== "0";
const nudgeBtn = document.getElementById("nudge-btn") as HTMLButtonElement;
function applyNudge(on: boolean): void {
  nudgeBtn.setAttribute("aria-checked", String(on));
}
applyNudge(nudgeEnabled);
nudgeBtn.addEventListener("click", () => {
  nudgeEnabled = !nudgeEnabled;
  localStorage.setItem(NUDGE_KEY, nudgeEnabled ? "1" : "0");
  applyNudge(nudgeEnabled);
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
// Share popover (QR code + copy). Falls back to Web Share API on capable
// devices (mobile), otherwise opens a small panel with a scannable QR.
const sharePopover = document.getElementById("share-popover") as HTMLElement;
const shareClose = document.getElementById("share-close") as HTMLButtonElement;
const shareQr = document.getElementById("share-qr") as HTMLElement;
const shareCopy = document.getElementById("share-copy") as HTMLButtonElement;

// Build the QR as an inline SVG with rounded modules on an on-brand, off-white
// card with a proper quiet zone — dark-on-light so it actually scans, softened
// so it reads less like a tin-can barcode.
function buildQrSvg(text: string): string {
  const qr = qrcode(0, "M"); // auto version, medium error correction
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 3; // quiet zone in modules
  const size = n + margin * 2;
  let cells = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      cells += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" rx="0.32" ry="0.32"/>`;
    }
  }
  return (
    `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">` +
    `<rect width="${size}" height="${size}" rx="3" fill="#f4f1ea"/>` +
    `<g fill="#161310">${cells}</g></svg>`
  );
}

function openShare(): void {
  shareQr.innerHTML = buildQrSvg(location.href);
  sharePopover.hidden = false;
  void sharePopover.offsetWidth;
  sharePopover.classList.add("open");
}
function closeShare(): void {
  sharePopover.classList.remove("open");
  setTimeout(() => {
    if (!sharePopover.classList.contains("open")) sharePopover.hidden = true;
  }, 220);
}
shareClose.addEventListener("click", closeShare);
sharePopover.addEventListener("click", (e) => {
  if (e.target === sharePopover) closeShare();
});
shareCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast(t("link_copied"));
  } catch {
    showToast(location.href);
  }
});

shareBtn.addEventListener("click", async () => {
  // On mobile with Web Share, prefer the native sheet (one-tap share).
  if (navigator.share) {
    try {
      await navigator.share({ title: "campfire", text: t("share_text"), url: location.href });
      return;
    } catch {
      /* cancelled — fall through to popover */
    }
  }
  openShare();
});

// Language (FR / EN, English fallback)
const langOpts = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".lang-opt"));
function applyLang(l: Lang): void {
  setLang(l);
  localStorage.setItem("campfire:lang", l);
  applyI18n();
  chatInput.placeholder = t("whisper");
  radio.refresh();
  setConn(connState); // re-render the connection label in the new language
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

// Keyboard shortcuts: "/" or "Space" focuses the whisper field (when no other
// input is focused and nothing is selected).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" && e.key !== " ") return;
  // Only fire when nothing interactive holds focus — otherwise we'd hijack
  // Space/"/" from buttons, inputs, the gate, etc.
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae !== canvas) return;
  if (window.getSelection()?.toString()) return;
  if (
    modalBackdrop.classList.contains("open") ||
    presentsEl.classList.contains("open") ||
    sharePopover.classList.contains("open") ||
    !gate.hidden
  ) return;
  e.preventDefault();
  chatInput.focus();
});

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
