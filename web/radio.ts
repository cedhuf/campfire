// Shared lofi radio. The on/off switch is global (synced by the server: one
// cuts -> all cut). Muting is local and per-visitor. The stream itself is a
// live HTTP audio feed, so everyone tuned in hears the same thing.
//
// Swap the station by changing RADIO_URL (must be HTTPS to avoid mixed-content
// when the app is served over TLS).
import { t } from "./i18n";

export const RADIO_URL = "https://lofi.stream.laut.fm/lofi";

const MUTE_KEY = "campfire:radio-muted";
const VOL_KEY = "campfire:radio-volume";
const QUIET_KEY = "campfire:quiet";
const QUIET_START = 22; // 22h
const QUIET_END = 8; // 8h

export class Radio {
  private audio: HTMLAudioElement;
  private powerBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private onToggle: (on: boolean) => void;
  private globalOn = false;
  private localMuted: boolean;
  private volume: number;
  private gestureArmed = false;
  private quietHours = false;

  constructor(
    streamUrl: string,
    powerBtn: HTMLButtonElement,
    muteBtn: HTMLButtonElement,
    onToggle: (on: boolean) => void,
  ) {
    this.powerBtn = powerBtn;
    this.muteBtn = muteBtn;
    this.onToggle = onToggle;
    this.localMuted = localStorage.getItem(MUTE_KEY) === "1";
    this.volume = Number(localStorage.getItem(VOL_KEY) ?? 55) / 100;
    this.quietHours = localStorage.getItem(QUIET_KEY) === "1";

    this.audio = new Audio();
    this.audio.src = streamUrl;
    this.audio.preload = "none";
    this.audio.volume = this.volume;

    this.powerBtn.addEventListener("click", () => {
      const next = !this.globalOn;
      if (next && !this.localMuted && !this.isQuietActive()) this.audio.play().catch(() => {});
      this.onToggle(next);
    });

    this.muteBtn.addEventListener("click", () => {
      this.localMuted = !this.localMuted;
      localStorage.setItem(MUTE_KEY, this.localMuted ? "1" : "0");
      this.apply();
      this.render();
    });

    this.render();
    this.startQuietTicker();
  }

  setGlobal(on: boolean): void {
    this.globalOn = on;
    this.apply();
    this.render();
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this.volume;
    localStorage.setItem(VOL_KEY, String(Math.round(this.volume * 100)));
  }

  getQuietHours(): boolean {
    return this.quietHours;
  }

  setQuietHours(on: boolean): void {
    this.quietHours = on;
    localStorage.setItem(QUIET_KEY, on ? "1" : "0");
    this.apply();
  }

  // Quiet hours follow the visitor's own local clock — it's about their
  // real-world evening, not the shared (server-anchored) day/night cycle.
  private isQuietActive(): boolean {
    if (!this.quietHours) return false;
    const h = new Date().getHours();
    return h >= QUIET_START || h < QUIET_END;
  }

  private startQuietTicker(): void {
    const tick = () => {
      // re-evaluate every minute (setInterval drifts but fine for this scope)
      this.apply();
    };
    window.setInterval(tick, 60_000);
  }

  refresh(): void {
    this.render();
  }

  private apply(): void {
    if (this.globalOn && !this.localMuted && !this.isQuietActive()) {
      const p = this.audio.play();
      if (p) p.catch(() => this.armGesture());
    } else {
      this.audio.pause();
    }
  }

  private armGesture(): void {
    if (this.gestureArmed) return;
    this.gestureArmed = true;
    const retry = () => {
      this.gestureArmed = false;
      this.apply();
    };
    document.addEventListener("pointerdown", retry, { once: true });
  }

  private render(): void {
    this.powerBtn.setAttribute("aria-pressed", String(this.globalOn));
    this.powerBtn.classList.toggle("is-on", this.globalOn);
    this.muteBtn.hidden = !this.globalOn;
    this.muteBtn.classList.toggle("is-muted", this.localMuted);
    this.muteBtn.setAttribute("aria-label", this.localMuted ? t("aria_unmute") : t("aria_mute"));
    this.muteBtn.setAttribute("aria-pressed", String(this.localMuted));
  }
}
