/** Identifiant du module, utilisé pour les flags, les réglages, le socket et l'API. */
export const MODULE_ID = "vesper-audio";

/** Flag de scène : paysage sonore (ambiances dynamiques). */
export const FLAG_SOUNDSCAPE = "soundscape";

/** Flag de scène : acoustique par défaut (hors de toute Région « Acoustique »). */
export const FLAG_ACOUSTICS = "acoustics";

/** Flags d'un son d'ambiance de Foundry. */
export const FLAG_SOUND = "sound";

/** Nom du canal de socket (déclaré par « socket: true » dans module.json). */
export const SOCKET = `module.${MODULE_ID}`;

/** Fréquence de mise à jour des paramètres audio (ms). Le lissage audio fait le reste. */
export const TICK_MS = 50;

/** Constante de temps du lissage des paramètres (s) : évite les clics quand un token bouge. */
export const SMOOTH = 0.08;

/** Réglages par défaut d'un son d'ambiance repris par Vesper (flags du document). */
export const SOUND_DEFAULTS = Object.freeze({
  // false : Vesper laisse Foundry jouer ce son comme d'habitude
  managed: true,
  // true : le son vient d'une direction (stéréo / HRTF) ; false : nappe sans direction
  directional: true,
  // Taille de la source en cases : une rivière ou une foule est « grande » et faiblit moins vite
  size: 1,
  // Son procédural joué à la place du fichier (identifiant d'une recette), ou null
  patch: null,
  // Intensité imposée au son procédural (0 à 1), ou null : elle suit le vent, la pluie ou la tension
  intensity: null
});

/** Paysage sonore par défaut d'une scène. */
export const SOUNDSCAPE_DEFAULTS = Object.freeze({
  enabled: true,
  // 0 calme, 1 inquiétant, 2 danger, 3 terreur
  tension: 0,
  volume: 0,
  layers: []
});

/** Couche d'ambiance par défaut. */
export const LAYER_DEFAULTS = Object.freeze({
  id: "",
  label: "",
  // loop : boucle continue ; scatter : sons ponctuels dispersés ; synth : son généré (aucun fichier)
  kind: "loop",
  paths: [],
  synth: "wind",
  volume: -12,
  fade: 3,
  // Couche « extérieure » : étouffée quand on entre dans une Région isolée (une taverne sous la pluie)
  outdoor: true,
  when: {
    time: "any", // any | day | night
    combat: "any", // any | yes | no
    weather: "any", // any | clear | rain | storm | snow | fog (lue dans Ember s'il est actif)
    place: "any", // any | outside | inside
    tensionMin: 0,
    tensionMax: 3
  },
  scatter: {
    min: 8, // intervalle entre deux sons (s)
    max: 25,
    spread: 1, // largeur stéréo (0 = centre, 1 = tout autour)
    distance: 0.6, // part des sons qui viennent de loin (plus sourds, plus réverbérés)
    pitch: 0.08 // variation de hauteur (± 8 %)
  }
});

/** Log préfixé. */
export function log(...args) {
  console.log("Vesper |", ...args);
}

export function warn(...args) {
  console.warn("Vesper |", ...args);
}

/** Traduction raccourcie. */
export function t(key, data) {
  const full = `VESPER.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/** Réglage du module, avec une valeur de repli si le réglage n'est pas encore enregistré. */
export function setting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export function gainToDb(g) {
  return g <= 0 ? -Infinity : 20 * Math.log10(g);
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
