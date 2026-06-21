// Local campfire crackle ambience. Streamed on demand (no upfront full download)
// and looped manually so we skip the file's baked-in fade in/out — otherwise the
// loop seam dips to silence and you hear the "reboot" on every repeat.
//
// Per-visitor (not shared), gesture-armed for autoplay policy, on by default,
// toggled from the settings modal and persisted locally.
const KEY = "campfire:fire-sound";
const VOL_KEY = "campfire:fire-volume";

// Seconds trimmed off each loop to avoid the file's fade-in / fade-out.
const LOOP_HEAD = 0.6;
const LOOP_TAIL = 0.9;

export class FireSound {
  private audio: HTMLAudioElement;
  private enabled: boolean;
  private volume: number;
  private armed = false;

  constructor(url: string) {
    this.enabled = localStorage.getItem(KEY) !== "0"; // default on
    this.volume = Number(localStorage.getItem(VOL_KEY) ?? 40) / 100; // 0..1, default 0.4
    this.audio = new Audio();
    this.audio.src = url;
    this.audio.preload = "none"; // stream on play, don't download upfront
    this.audio.loop = false; // we loop manually to skip the baked fades
    this.audio.volume = this.volume;

    // Jump back to the steady middle before the tail fade. The head region is
    // already buffered (we just played it), so the seek is instant — no rebuffer.
    this.audio.addEventListener("timeupdate", () => {
      const d = this.audio.duration;
      if (!d || !isFinite(d)) return;
      if (this.audio.currentTime >= d - LOOP_TAIL) this.audio.currentTime = LOOP_HEAD;
    });
    // Safety net in case timeupdate misses the window.
    this.audio.addEventListener("ended", () => {
      if (!this.enabled) return;
      this.audio.currentTime = LOOP_HEAD;
      this.audio.play().catch(() => {});
    });

    if (this.enabled) this.armGesture();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    localStorage.setItem(KEY, on ? "1" : "0");
    this.apply();
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this.volume;
    localStorage.setItem(VOL_KEY, String(Math.round(this.volume * 100)));
  }

  private apply(): void {
    if (this.enabled) {
      const p = this.audio.play();
      if (p) p.catch(() => this.armGesture());
    } else {
      this.audio.pause();
    }
  }

  private armGesture(): void {
    if (this.armed) return;
    this.armed = true;
    const retry = () => {
      this.armed = false;
      this.apply();
    };
    document.addEventListener("pointerdown", retry, { once: true });
  }
}

export const FIRE_SOUND_URL = "/sounds_fx/campfire_1.mp3";
