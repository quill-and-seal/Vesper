/**
 * Sons procéduraux : le format des « recettes » et les modèles livrés avec Vesper.
 * Logique pure (aucune dépendance au Web Audio ni à Foundry) : testable hors du jeu.
 *
 * Une recette est une liste de couches qui jouent ensemble. Chaque couche :
 *
 *   source ─► filtres (dans l'ordre) ─► volume ─► position stéréo
 *
 * Sources :
 *   noise   : bruit (blanc, rose ou brun) — souffle, grondement, vent, eau
 *   osc     : oscillateur (sinus, triangle, carré, dent de scie) — nappes, bourdons
 *   events  : petits sons ponctuels à intervalles aléatoires — crépitements, gouttes, grillons, battements
 *
 * Modulations : un paramètre (volume, fréquence d'un filtre, cadence…) oscille (lfo) ou vacille
 * au hasard (jitter) autour de sa valeur.
 *
 * Intensité : chaque nombre peut être fixe (12) ou suivre l'intensité du son ({a: 4, b: 18} : 4 au calme,
 * 18 au maximum). L'intensité vient du vent ou de la pluie d'Ember, de la tension, ou d'un réglage fixe.
 */

import { clamp } from "./constants.js";

/* -------------------------------------------- */
/*  Valeurs                                     */
/* -------------------------------------------- */

/** Valeur d'un paramètre pour une intensité donnée (0 à 1). */
export function pval(v, i = 0.5) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return Number(v.a) + (Number(v.b) - Number(v.a)) * clamp(i, 0, 1);
  return 0;
}

/**
 * Intervalle avant le prochain événement (s).
 * regularity 0 : au hasard (processus de Poisson, comme des crépitements) ; 1 : métronome (battement de cœur).
 */
export function nextInterval(rate, regularity, u) {
  const mean = 1 / Math.max(0.01, rate);
  const random = -Math.log(1 - Math.min(0.999999, u));
  return mean * ((1 - regularity) * random + regularity);
}

/** Volume d'un événement : beaucoup de petits, peu de gros quand skew est grand. */
export function eventAmp(min, max, skew, u) {
  return min + (max - min) * Math.pow(u, Math.max(0.1, skew));
}

/* -------------------------------------------- */
/*  Limites (une recette d'un joueur ne doit pas écrouler le navigateur) */
/* -------------------------------------------- */

export const LIMITS = Object.freeze({
  layers: 8,
  filters: 4,
  mods: 4,
  eventRate: 60,
  burstMax: 12
});

export const NOISE_COLORS = ["white", "pink", "brown"];
export const WAVES = ["sine", "triangle", "square", "sawtooth"];
export const FILTER_TYPES = ["lowpass", "highpass", "bandpass", "peaking", "notch"];
export const GRAIN_TYPES = ["noise", "tone"];
export const MOD_KINDS = ["lfo", "jitter"];
export const INTENSITY_SOURCES = ["fixed", "wind", "rain", "tension"];

/** Paramètres modulables d'une couche (selon sa source et ses filtres). */
export function modTargets(layer) {
  const out = ["gain", "pan"];
  (layer.filters ?? []).forEach((_, i) => out.push(`filters.${i}.freq`, `filters.${i}.q`));
  if (layer.source?.type === "osc") out.push("source.freq");
  if (layer.source?.type === "events") out.push("source.rate");
  return out;
}

/* -------------------------------------------- */
/*  Nettoyage d'une recette                     */
/* -------------------------------------------- */

/** Nombre ou paire {a,b}, bornés. */
function num(v, def, min, max) {
  if (v && typeof v === "object" && ("a" in v || "b" in v)) {
    // Une paire reste une paire même si ses deux valeurs sont égales (l'atelier affiche alors deux champs)
    return { a: num(v.a, def, min, max), b: num(v.b, def, min, max) };
  }
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, min, max) : def;
}

function pick(v, list, def) {
  return list.includes(v) ? v : def;
}

export const LAYER_DEFAULTS = Object.freeze({
  noise: { type: "noise", color: "white" },
  osc: { type: "osc", wave: "sine", freq: 110 },
  events: {
    type: "events",
    rate: 4,
    regularity: 0,
    burstChance: 0,
    burstMin: 2,
    burstMax: 4,
    burstGap: 0.03,
    grain: "noise",
    decay: 2,
    ring: 0,
    freqMin: 1500,
    freqMax: 5000,
    q: 1,
    drop: 1,
    ampMin: 0.1,
    ampMax: 0.6,
    skew: 2,
    spread: 0.4
  }
});

function cleanSource(s) {
  const type = pick(s?.type, ["noise", "osc", "events"], "noise");
  const d = LAYER_DEFAULTS[type];
  if (type === "noise") return { type, color: pick(s.color, NOISE_COLORS, d.color) };
  if (type === "osc") return { type, wave: pick(s.wave, WAVES, d.wave), freq: num(s.freq, d.freq, 10, 12000) };
  return {
    type,
    rate: num(s.rate, d.rate, 0.01, LIMITS.eventRate),
    regularity: num(s.regularity, d.regularity, 0, 1),
    burstChance: num(s.burstChance, d.burstChance, 0, 1),
    burstMin: Math.round(num(pval(s.burstMin, 0), d.burstMin, 1, LIMITS.burstMax)),
    burstMax: Math.round(num(pval(s.burstMax, 0), d.burstMax, 1, LIMITS.burstMax)),
    burstGap: num(s.burstGap, d.burstGap, 0.002, 2),
    grain: pick(s.grain, GRAIN_TYPES, d.grain),
    decay: num(s.decay, d.decay, 0.1, 1000),
    ring: num(s.ring, d.ring, 0, 1),
    freqMin: num(s.freqMin, d.freqMin, 20, 16000),
    freqMax: num(s.freqMax, d.freqMax, 20, 16000),
    q: num(s.q, d.q, 0.1, 30),
    drop: num(s.drop, d.drop, 0.1, 4),
    ampMin: num(s.ampMin, d.ampMin, 0, 2),
    ampMax: num(s.ampMax, d.ampMax, 0, 2),
    skew: num(s.skew, d.skew, 0.1, 8),
    spread: num(s.spread, d.spread, 0, 1)
  };
}

function cleanLayer(l, i) {
  const layer = {
    id: String(l?.id ?? `l${i}`).slice(0, 32) || `l${i}`,
    label: String(l?.label ?? "").slice(0, 60),
    mute: !!l?.mute,
    source: cleanSource(l?.source ?? {}),
    filters: (Array.isArray(l?.filters) ? l.filters : []).slice(0, LIMITS.filters).map((f) => ({
      type: pick(f?.type, FILTER_TYPES, "lowpass"),
      freq: num(f?.freq, 1000, 20, 20000),
      q: num(f?.q, 0.7, 0.05, 30),
      ...(f?.type === "peaking" ? { gain: num(f?.gain, 6, -30, 30) } : {})
    })),
    gain: num(l?.gain, 0.5, 0, 4),
    pan: num(l?.pan, 0, -1, 1),
    mods: []
  };
  const targets = modTargets(layer);
  layer.mods = (Array.isArray(l?.mods) ? l.mods : [])
    .filter((m) => targets.includes(m?.target))
    .slice(0, LIMITS.mods)
    .map((m) => ({
      target: m.target,
      kind: pick(m.kind, MOD_KINDS, "lfo"),
      rate: num(m.rate, 0.2, 0.01, 40),
      depth: num(m.depth, 0.3, 0, 1)
    }));
  return layer;
}

/** Recette nettoyée (valeurs bornées, champs manquants complétés). */
export function normalizePatch(p, id = null) {
  return {
    id: String(id ?? p?.id ?? "").slice(0, 40),
    label: String(p?.label ?? "").slice(0, 60),
    intensity: pick(p?.intensity, INTENSITY_SOURCES, "fixed"),
    fixed: num(p?.fixed, 0.5, 0, 1),
    volume: num(p?.volume, 0, -40, 12),
    layers: (Array.isArray(p?.layers) ? p.layers : []).slice(0, LIMITS.layers).map(cleanLayer)
  };
}

/**
 * Intensité d'une recette dans l'état du monde.
 * @param {object} patch
 * @param {{wind:number, weather:string, weatherIntensity:number, tension:number}} state
 * @param {number|null} [override]  intensité imposée (réglage d'un son posé)
 */
export function patchIntensity(patch, state = {}, override = null) {
  if (Number.isFinite(override)) return clamp(override, 0, 1);
  const fixed = patch?.fixed ?? 0.5;
  switch (patch?.intensity) {
    case "wind":
      // Sans vent d'Ember : la valeur fixe, un peu poussée par la tension
      return state.wind > 0 ? state.wind : clamp(fixed + 0.05 * (state.tension ?? 0), 0, 1);
    case "rain":
      return state.weather === "rain" || state.weather === "storm" ? Math.max(0.2, state.weatherIntensity ?? 0) : fixed;
    case "tension":
      return clamp((state.tension ?? 0) / 3, 0, 1);
    default:
      return fixed;
  }
}

/* -------------------------------------------- */
/*  Modèles livrés                              */
/* -------------------------------------------- */

const r = (a, b) => ({ a, b });

export const BUILTIN_PATCHES = {
  fire: {
    icon: "fa-solid fa-fire",
    intensity: "wind",
    fixed: 0.45,
    layers: [
      {
        id: "roar",
        label: "Grondement",
        source: { type: "noise", color: "white" },
        filters: [{ type: "highpass", freq: 45, q: 0.7 }, { type: "lowpass", freq: r(300, 750), q: 0.6 }],
        gain: r(0.22, 0.6),
        mods: [{ target: "gain", kind: "jitter", rate: r(4, 9), depth: r(0.25, 0.5) }]
      },
      {
        id: "hiss",
        label: "Souffle",
        source: { type: "noise", color: "white" },
        filters: [{ type: "highpass", freq: 2800, q: 0.7 }, { type: "lowpass", freq: 9000, q: 0.7 }],
        gain: r(0.02, 0.06),
        mods: [{ target: "gain", kind: "lfo", rate: 0.13, depth: 0.4 }]
      },
      {
        id: "crackle",
        label: "Crépitements",
        source: {
          type: "events", rate: r(4, 18), regularity: 0, burstChance: r(0.07, 0.13), burstMin: 3, burstMax: 9, burstGap: 0.025,
          grain: "noise", decay: 1, ring: 0.2, freqMin: 1500, freqMax: 7000, q: 1.2, drop: 1, ampMin: 0.06, ampMax: 0.55, skew: 3, spread: 0.35
        },
        gain: 3.2
      },
      {
        id: "pops",
        label: "Bûches qui éclatent",
        source: {
          type: "events", rate: r(0.15, 0.35), regularity: 0.2, burstChance: 0.5, burstMin: 2, burstMax: 5, burstGap: 0.05,
          grain: "noise", decay: 7, ring: 0.35, freqMin: 600, freqMax: 2000, q: 0.6, drop: 1, ampMin: 0.45, ampMax: 0.8, skew: 1, spread: 0.25
        },
        gain: 2.2
      }
    ]
  },

  torch: {
    icon: "fa-solid fa-fire-flame-simple",
    intensity: "wind",
    fixed: 0.4,
    layers: [
      {
        id: "flame",
        label: "Flamme",
        source: { type: "noise", color: "white" },
        filters: [{ type: "highpass", freq: 80, q: 0.7 }, { type: "lowpass", freq: r(450, 900), q: 0.8 }],
        gain: r(0.25, 0.7),
        mods: [{ target: "gain", kind: "jitter", rate: r(10, 18), depth: r(0.4, 0.7) }, { target: "filters.1.freq", kind: "jitter", rate: 6, depth: 0.3 }]
      },
      {
        id: "sputter",
        label: "Grésillements",
        source: {
          type: "events", rate: r(1.5, 6), regularity: 0, burstChance: 0.15, burstMin: 2, burstMax: 4, burstGap: 0.02,
          grain: "noise", decay: 0.8, ring: 0.1, freqMin: 2500, freqMax: 8000, q: 1, drop: 1, ampMin: 0.04, ampMax: 0.3, skew: 2.5, spread: 0.1
        },
        gain: 2.5
      }
    ]
  },

  wind: {
    icon: "fa-solid fa-wind",
    intensity: "wind",
    fixed: 0.35,
    volume: -4,
    layers: [
      {
        id: "gusts",
        label: "Rafales",
        source: { type: "noise", color: "white" },
        filters: [{ type: "bandpass", freq: r(300, 1000), q: 0.9 }, { type: "lowpass", freq: r(1200, 5200), q: 0.7 }],
        gain: r(0.5, 1.7),
        mods: [
          { target: "filters.0.freq", kind: "lfo", rate: 0.071, depth: 0.45 },
          { target: "filters.0.freq", kind: "jitter", rate: 0.3, depth: 0.3 },
          { target: "gain", kind: "lfo", rate: 0.053, depth: 0.4 },
          { target: "gain", kind: "jitter", rate: 0.2, depth: 0.25 }
        ]
      },
      {
        id: "whistle",
        label: "Sifflement",
        source: { type: "noise", color: "white" },
        filters: [{ type: "bandpass", freq: r(900, 1800), q: 8 }],
        gain: r(0, 0.5),
        mods: [{ target: "filters.0.freq", kind: "jitter", rate: 0.25, depth: 0.25 }, { target: "gain", kind: "jitter", rate: 0.15, depth: 0.8 }]
      }
    ]
  },

  rain: {
    icon: "fa-solid fa-cloud-rain",
    intensity: "rain",
    fixed: 0.5,
    volume: -6,
    layers: [
      {
        id: "hiss",
        label: "Nappe",
        source: { type: "noise", color: "white" },
        filters: [{ type: "highpass", freq: 500, q: 0.7 }, { type: "lowpass", freq: r(4000, 10000), q: 0.7 }],
        gain: r(0.15, 0.65)
      },
      {
        id: "patter",
        label: "Crépitement",
        source: { type: "noise", color: "white" },
        filters: [{ type: "bandpass", freq: 3200, q: 1.4 }],
        gain: r(0.1, 0.45),
        mods: [{ target: "gain", kind: "jitter", rate: 15, depth: 0.6 }]
      },
      {
        id: "drops",
        label: "Gouttes proches",
        source: {
          type: "events", rate: r(6, 25), regularity: 0, burstChance: 0, burstMin: 1, burstMax: 1, burstGap: 0.03,
          grain: "noise", decay: 0.8, ring: 0, freqMin: 2000, freqMax: 8000, q: 1.5, drop: 1, ampMin: 0.05, ampMax: 0.3, skew: 2, spread: 0.9
        },
        gain: 1
      },
      {
        id: "rumble",
        label: "Grondement (forte pluie)",
        source: { type: "noise", color: "brown" },
        filters: [{ type: "lowpass", freq: 220, q: 0.7 }],
        gain: r(0, 1)
      }
    ]
  },

  river: {
    icon: "fa-solid fa-water",
    intensity: "fixed",
    fixed: 0.5,
    layers: [
      {
        id: "flow",
        label: "Courant",
        source: { type: "noise", color: "pink" },
        filters: [{ type: "lowpass", freq: r(1200, 2600), q: 0.7 }],
        gain: r(0.35, 0.8),
        mods: [{ target: "gain", kind: "jitter", rate: 0.5, depth: 0.15 }]
      },
      {
        id: "babble",
        label: "Gargouillis",
        source: { type: "noise", color: "white" },
        filters: [{ type: "bandpass", freq: 700, q: 3 }],
        gain: r(0.25, 0.5),
        mods: [{ target: "filters.0.freq", kind: "jitter", rate: 8, depth: 0.5 }]
      },
      {
        id: "babble2",
        label: "Gargouillis aigus",
        source: { type: "noise", color: "white" },
        filters: [{ type: "bandpass", freq: 1500, q: 4 }],
        gain: r(0.12, 0.3),
        mods: [{ target: "filters.0.freq", kind: "jitter", rate: 12, depth: 0.5 }]
      },
      {
        id: "bubbles",
        label: "Bulles",
        source: {
          type: "events", rate: r(3, 10), regularity: 0, burstChance: 0.1, burstMin: 2, burstMax: 3, burstGap: 0.04,
          grain: "tone", decay: 12, ring: 0, freqMin: 500, freqMax: 1600, q: 1, drop: 1.7, ampMin: 0.04, ampMax: 0.18, skew: 2, spread: 0.7
        },
        gain: 1
      }
    ]
  },

  drips: {
    icon: "fa-solid fa-droplet",
    intensity: "fixed",
    fixed: 0.4,
    volume: 4,
    layers: [
      {
        id: "drips",
        label: "Gouttes",
        source: {
          type: "events", rate: r(0.4, 2.2), regularity: 0.15, burstChance: 0.08, burstMin: 2, burstMax: 2, burstGap: 0.25,
          grain: "tone", decay: 35, ring: 0, freqMin: 900, freqMax: 2400, q: 1, drop: 1.8, ampMin: 0.1, ampMax: 0.5, skew: 2, spread: 0.9
        },
        gain: 1
      }
    ]
  },

  crickets: {
    icon: "fa-solid fa-bug",
    intensity: "fixed",
    fixed: 0.5,
    volume: 8,
    layers: [
      {
        id: "c1",
        label: "Grillon 1",
        source: {
          type: "events", rate: 1.6, regularity: 0.75, burstChance: 1, burstMin: 3, burstMax: 4, burstGap: 0.035,
          grain: "tone", decay: 9, ring: 0, freqMin: 4400, freqMax: 4550, q: 1, drop: 1, ampMin: 0.1, ampMax: 0.18, skew: 1, spread: 0
        },
        gain: r(0.6, 1),
        pan: -0.45
      },
      {
        id: "c2",
        label: "Grillon 2",
        source: {
          type: "events", rate: 1.25, regularity: 0.75, burstChance: 1, burstMin: 3, burstMax: 3, burstGap: 0.04,
          grain: "tone", decay: 9, ring: 0, freqMin: 4900, freqMax: 5050, q: 1, drop: 1, ampMin: 0.06, ampMax: 0.12, skew: 1, spread: 0
        },
        gain: r(0.5, 1),
        pan: 0.5
      },
      {
        id: "chorus",
        label: "Chœur lointain",
        source: {
          type: "events", rate: r(4, 12), regularity: 0, burstChance: 1, burstMin: 2, burstMax: 4, burstGap: 0.035,
          grain: "tone", decay: 7, ring: 0, freqMin: 3800, freqMax: 5600, q: 1, drop: 1, ampMin: 0.01, ampMax: 0.04, skew: 1, spread: 1
        },
        filters: [{ type: "lowpass", freq: 5000, q: 0.7 }],
        gain: 1
      }
    ]
  },

  drone: {
    icon: "fa-solid fa-wave-square",
    intensity: "tension",
    fixed: 0.3,
    volume: -4,
    layers: [
      { id: "root", label: "Fondamentale", source: { type: "osc", wave: "sawtooth", freq: 55 }, filters: [{ type: "lowpass", freq: r(220, 720), q: 2 }], gain: r(0.12, 0.25), mods: [{ target: "filters.0.freq", kind: "lfo", rate: 0.05, depth: 0.35 }] },
      { id: "beat", label: "Battement", source: { type: "osc", wave: "sawtooth", freq: r(55.35, 56.6) }, filters: [{ type: "lowpass", freq: r(220, 720), q: 2 }], gain: r(0.12, 0.25) },
      { id: "fifth", label: "Quinte", source: { type: "osc", wave: "triangle", freq: 82.4 }, filters: [{ type: "lowpass", freq: 600, q: 0.7 }], gain: r(0.08, 0.15) },
      { id: "minor", label: "Seconde mineure", source: { type: "osc", wave: "sawtooth", freq: 58.27 }, filters: [{ type: "lowpass", freq: r(220, 720), q: 2 }], gain: r(0, 0.2) }
    ]
  },

  heartbeat: {
    icon: "fa-solid fa-heart-pulse",
    intensity: "tension",
    fixed: 0.5,
    layers: [
      {
        id: "beat",
        label: "Battements",
        source: {
          type: "events", rate: r(0.97, 2), regularity: 1, burstChance: 1, burstMin: 2, burstMax: 2, burstGap: r(0.3, 0.16),
          grain: "tone", decay: 60, ring: 0, freqMin: 68, freqMax: 72, q: 1, drop: 0.55, ampMin: 0.8, ampMax: 0.9, skew: 1, spread: 0
        },
        filters: [{ type: "lowpass", freq: 160, q: 0.7 }],
        gain: 1.4
      }
    ]
  }
};

export const BUILTIN_IDS = Object.keys(BUILTIN_PATCHES);

/* -------------------------------------------- */
/*  Bibliothèque (modèles + sons du MJ)         */
/* -------------------------------------------- */

const normalizedBuiltins = Object.fromEntries(
  Object.entries(BUILTIN_PATCHES).map(([id, p]) => [id, { ...normalizePatch(p, id), builtin: true, icon: p.icon }])
);
let custom = {};

/** Sons créés par le MJ (réglage du monde). */
export function setCustomPatches(obj) {
  custom = {};
  for (const [id, p] of Object.entries(obj ?? {})) {
    if (!id || BUILTIN_PATCHES[id]) continue;
    custom[id] = { ...normalizePatch(p, id), builtin: false, icon: "fa-solid fa-sliders" };
  }
}

export function getPatch(id) {
  return normalizedBuiltins[id] ?? custom[id] ?? null;
}

export function customPatches() {
  return { ...custom };
}

export function allPatches() {
  return { ...normalizedBuiltins, ...custom };
}

/** Empreinte d'une recette : change quand la recette change (pour relancer les sons qui la jouent). */
export function patchSignature(id) {
  const p = getPatch(id);
  return p ? JSON.stringify(p) : "";
}
