// Minimal i18n: French + English only, English as fallback.
export type Lang = "fr" | "en";

type Dict = Record<string, string>;

const en: Dict = {
  present: "PRESENT",
  whisper: "whisper…",
  err_slow: "// slow down…",
  err_long: "// too long…",
  settings_title: "SETTINGS",
  s_motion: "ANIMATIONS",
  s_floating: "FLOATING MESSAGES",
  s_fire: "FIRE CRACKLE",
  s_language: "LANGUAGE",
  aria_radio: "Shared radio — on/off for everyone",
  aria_mute: "Mute (local)",
  aria_unmute: "Unmute",
  aria_settings: "Settings",
  aria_close: "Close",
  aria_share: "Share the link",
  aria_send: "Send",
  share_text: "Join me at the campfire",
  link_copied: "Link copied",
  gate_title: "This space is protected",
  password: "password",
  enter: "Enter",
  wrong_password: "Wrong password",
  phase_night: "NIGHT",
  phase_dawn: "DAWN",
  phase_sunrise: "SUNRISE",
  phase_day: "DAY",
  phase_noon: "NOON",
  phase_sunset: "SUNSET",
  phase_dusk: "DUSK",
};

const fr: Dict = {
  present: "PRÉSENT·ES",
  whisper: "murmurer…",
  err_slow: "// doucement…",
  err_long: "// trop long…",
  settings_title: "RÉGLAGES",
  s_motion: "ANIMATIONS",
  s_floating: "MESSAGES DANS L'AIR",
  s_fire: "CRÉPITEMENT DU FEU",
  s_language: "LANGUE",
  aria_radio: "Radio partagée — marche/arrêt pour tout le monde",
  aria_mute: "Couper le son (local)",
  aria_unmute: "Réactiver le son",
  aria_settings: "Réglages",
  aria_close: "Fermer",
  aria_share: "Partager le lien",
  aria_send: "Envoyer",
  share_text: "Rejoins-moi au feu de camp",
  link_copied: "Lien copié",
  gate_title: "Cet espace est protégé",
  password: "mot de passe",
  enter: "Entrer",
  wrong_password: "Mot de passe incorrect",
  phase_night: "NUIT",
  phase_dawn: "AUBE",
  phase_sunrise: "LEVER",
  phase_day: "JOUR",
  phase_noon: "MIDI",
  phase_sunset: "COUCHER",
  phase_dusk: "CRÉPUSCULE",
};

const DICTS: Record<Lang, Dict> = { en, fr };

let current: Lang = "en";

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
}

export function t(key: string): string {
  return DICTS[current][key] ?? en[key] ?? key;
}

export function detectLang(): Lang {
  const stored = localStorage.getItem("campfire:lang");
  if (stored === "fr" || stored === "en") return stored;
  return (navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}

// Apply translations to all tagged elements. data-i18n -> textContent,
// data-i18n-aria -> aria-label, data-i18n-ph -> placeholder.
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh!);
  });
}
