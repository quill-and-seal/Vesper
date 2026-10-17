/**
 * Lieux acoustiques. Aucune réponse impulsionnelle n'est téléchargée : elles sont générées
 * (bruit qui décroît, aigus qui s'éteignent plus vite, premières réflexions sur les parois).
 *
 * decay     : temps de réverbération (s, chute de 60 dB)
 * predelay  : délai avant la queue de réverbération (ms) : grand pour un grand volume
 * damping   : fréquence vers laquelle les aigus s'éteignent (Hz) : bas = lieu « mat » (tissus, terre)
 * early     : nombre de premières réflexions (parois proches)
 * earlyTime : fenêtre des premières réflexions (ms)
 * flutter   : écho en rafale entre deux parois parallèles (ms), 0 = aucun
 * wet       : niveau de réverbération par défaut
 */
export const REVERB_PRESETS = {
  none: { icon: "fa-solid fa-volume-xmark", decay: 0, predelay: 0, damping: 0, early: 0, earlyTime: 0, flutter: 0, wet: 0 },
  outdoor: { icon: "fa-solid fa-mountain-sun", decay: 0.7, predelay: 12, damping: 2800, early: 3, earlyTime: 60, flutter: 0, wet: 0.12 },
  forest: { icon: "fa-solid fa-tree", decay: 1.3, predelay: 18, damping: 3500, early: 10, earlyTime: 90, flutter: 0, wet: 0.2 },
  room: { icon: "fa-solid fa-door-closed", decay: 0.45, predelay: 3, damping: 5000, early: 8, earlyTime: 18, flutter: 0, wet: 0.22 },
  tavern: { icon: "fa-solid fa-beer-mug-empty", decay: 0.9, predelay: 8, damping: 3200, early: 12, earlyTime: 35, flutter: 0, wet: 0.24 },
  hall: { icon: "fa-solid fa-chess-rook", decay: 2.2, predelay: 25, damping: 4500, early: 14, earlyTime: 70, flutter: 0, wet: 0.3 },
  cathedral: { icon: "fa-solid fa-place-of-worship", decay: 5, predelay: 45, damping: 3800, early: 16, earlyTime: 120, flutter: 0, wet: 0.36 },
  dungeon: { icon: "fa-solid fa-dungeon", decay: 1.8, predelay: 10, damping: 4200, early: 12, earlyTime: 40, flutter: 0, wet: 0.3 },
  cave: { icon: "fa-solid fa-mound", decay: 3.4, predelay: 30, damping: 2400, early: 18, earlyTime: 110, flutter: 0, wet: 0.4 },
  tunnel: { icon: "fa-solid fa-archway", decay: 2.4, predelay: 6, damping: 3000, early: 10, earlyTime: 30, flutter: 22, wet: 0.42 },
  underwater: { icon: "fa-solid fa-water", decay: 1.6, predelay: 2, damping: 600, early: 6, earlyTime: 20, flutter: 0, wet: 0.5 }
};

export const REVERB_IDS = Object.keys(REVERB_PRESETS);

/** Petit générateur pseudo-aléatoire déterministe (mulberry32) : même lieu = même réverbération. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine stable à partir d'une chaîne. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Génère une réponse impulsionnelle stéréo.
 * @param {object} p           un REVERB_PRESETS
 * @param {number} sampleRate
 * @param {number} [seed]
 * @returns {Float32Array[]|null} [gauche, droite], ou null pour « aucune »
 */
export function generateImpulse(p, sampleRate, seed = 1) {
  if (!p || !(p.decay > 0)) return null;
  const rand = prng(seed);
  const pre = Math.round((p.predelay / 1000) * sampleRate);
  const tail = Math.round(p.decay * 1.15 * sampleRate);
  const length = pre + tail;
  const channels = [new Float32Array(length), new Float32Array(length)];
  const k = 6.907755 / p.decay; // ln(1000) : -60 dB en « decay » secondes

  for (let ch = 0; ch < 2; ch++) {
    const out = channels[ch];
    // Filtre passe-bas à un pôle dont la coupure descend vers « damping » : les aigus meurent avant les graves
    let lp = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-k * t) * Math.min(1, t / 0.004);
      const fc = p.damping + (14000 - p.damping) * Math.exp(-t / (p.decay * 0.18));
      const alpha = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      const noise = rand() * 2 - 1;
      lp += alpha * (noise - lp);
      out[pre + i] = lp * env;
    }

    // Premières réflexions : quelques échos nets sur les parois proches, différents à gauche et à droite
    const window = Math.round((p.earlyTime / 1000) * sampleRate);
    for (let r = 0; r < p.early; r++) {
      const pos = Math.round(rand() * window) + Math.round(0.001 * sampleRate);
      if (pos >= length) continue;
      const amp = (0.9 - (0.6 * pos) / Math.max(1, window)) * (rand() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rand());
      out[pos] += amp;
    }

    // Écho en rafale (tunnel, couloir) : une série d'échos réguliers qui s'éteignent
    if (p.flutter > 0) {
      const step = Math.round((p.flutter / 1000) * sampleRate);
      const offset = ch === 0 ? 0 : Math.round(step * 0.5);
      for (let pos = step + offset, n = 1; pos < length; pos += step, n++) {
        out[pos] += 0.5 * Math.exp(-k * (pos / sampleRate)) * (n % 2 ? 1 : -1);
      }
    }
  }

  // Normalisation en énergie : tous les lieux ont le même niveau à « wet » égal
  let energy = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) energy += c[i] * c[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy / 2) : 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= scale * 0.35;
  return channels;
}
