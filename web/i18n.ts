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
  s_volume: "VOLUME",
  s_radio_vol: "RADIO VOLUME",
  s_quiet: "QUIET HOURS",
  s_quiet_hint: "Auto-pause radio 22h–8h",
  s_nudge: "NUDGES",
  s_nudge_hint: "Let others wave at you (tap someone in the list)",
  s_shortcut: "KEYBOARD",
  s_shortcut_hint: "Press / or Space to whisper",
  s_language: "LANGUAGE",
  wave: "WAVE",
  wave_hint: "Tap someone to wave",
  aria_radio: "Shared radio — on/off for everyone",
  aria_mute: "Mute (local)",
  aria_unmute: "Unmute",
  aria_settings: "Settings",
  aria_close: "Close",
  aria_share: "Share the link",
  aria_send: "Send",
  aria_clock: "Open clock and presence",
  share_text: "Join me at the campfire",
  copy_link: "COPY LINK",
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
  you: "YOU",
  just_now: "now",
  min: "min",
  hour: "h",
  conn_live: "LIVE",
  conn_connecting: "CONNECTING",
  conn_reconnecting: "RECONNECTING",
  nudged: "waved at you",
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
  s_volume: "VOLUME",
  s_radio_vol: "VOLUME RADIO",
  s_quiet: "HEURES CALMES",
  s_quiet_hint: "Couper la radio 22h–8h",
  s_nudge: "COUPS DE COUDE",
  s_nudge_hint: "Laisser les autres te saluer (touche quelqu'un dans la liste)",
  s_shortcut: "CLAVIER",
  s_shortcut_hint: "Appuie sur / ou Espace pour murmurer",
  s_language: "LANGUE",
  wave: "SALUER",
  wave_hint: "Touche quelqu'un pour le saluer",
  aria_radio: "Radio partagée — marche/arrêt pour tout le monde",
  aria_mute: "Couper le son (local)",
  aria_unmute: "Réactiver le son",
  aria_settings: "Réglages",
  aria_close: "Fermer",
  aria_share: "Partager le lien",
  aria_send: "Envoyer",
  aria_clock: "Ouvrir l'heure et les présents",
  share_text: "Rejoins-moi au feu de camp",
  copy_link: "COPIER LE LIEN",
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
  you: "VOUS",
  just_now: "à l'instant",
  min: "min",
  hour: "h",
  conn_live: "EN LIGNE",
  conn_connecting: "CONNEXION",
  conn_reconnecting: "RECONNEXION",
  nudged: "te fait signe",
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
