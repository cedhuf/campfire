// Shared lofi radio. The on/off switch is global (synced by the server: one
// cuts -> all cut). Muting is local and per-visitor. The stream itself is a
// live HTTP audio feed, so everyone tuned in hears the same thing.
//
// Swap the station by changing RADIO_URL (must be HTTPS to avoid mixed-content
// when the app is served over TLS).
import { t } from "./i18n";

export const RADIO_URL = "https://lofi.stream.laut.fm/lofi";

const MUTE_KEY = "campfire:radio-muted";

export class Radio {
  private audio: HTMLAudioElement;
  private powerBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private onToggle: (on: boolean) => void;
  private globalOn = false;
  private localMuted: boolean;
  private gestureArmed = false;

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

    this.audio = new Audio();
    this.audio.src = streamUrl;
    this.audio.preload = "none";
    this.audio.volume = 0.55;

    this.powerBtn.addEventListener("click", () => {
      const next = !this.globalOn;
      // Optimistically start playback inside the click (satisfies autoplay).
      if (next && !this.localMuted) this.audio.play().catch(() => {});
      this.onToggle(next);
    });

    this.muteBtn.addEventListener("click", () => {
      this.localMuted = !this.localMuted;
      localStorage.setItem(MUTE_KEY, this.localMuted ? "1" : "0");
      this.apply();
      this.render();
    });

    this.render();
  }

  // Authoritative shared state from the server.
  setGlobal(on: boolean): void {
    this.globalOn = on;
    this.apply();
    this.render();
  }

  // Re-render labels (e.g. after a language change).
  refresh(): void {
    this.render();
  }

  private apply(): void {
    if (this.globalOn && !this.localMuted) {
      const p = this.audio.play();
      if (p) p.catch(() => this.armGesture());
    } else {
      this.audio.pause();
    }
  }

  // If autoplay is blocked (we arrived while the radio was already on), retry
  // on the next user interaction anywhere on the page.
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
