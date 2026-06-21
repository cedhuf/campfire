// Local campfire crackle ambience. Loops a static asset, plays per-visitor
// (not shared), and is gesture-armed so it respects autoplay policy. On by
// default; toggled from the settings modal and persisted locally.
const KEY = "campfire:fire-sound";

export class FireSound {
  private audio: HTMLAudioElement;
  private enabled: boolean;
  private armed = false;

  constructor(url: string) {
    this.enabled = localStorage.getItem(KEY) !== "0"; // default on
    this.audio = new Audio(url);
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = 0.4;
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
