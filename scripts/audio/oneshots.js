/**
 * Sons ponctuels fabriqués à la volée (aucun fichier) : tonnerre, flamme soufflée, vapeur.
 *
 * Chaque son est calculé dans un AudioBuffer à partir d'une graine : la même graine donne
 * exactement le même son, ce qui permet à tous les joueurs d'entendre le même coup de tonnerre.
 */

import { prng } from "./reverb-presets.js";

/** Bruit brun (intégration d'un bruit blanc), plus grave et plus « roulant ». */
function brownNoise(rand, n) {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/** Passe-bas à un pôle, en place. */
function lowpass(data, sampleRate, freq) {
  const a = Math.exp((-2 * Math.PI * freq) / sampleRate);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y = (1 - a) * data[i] + a * y;
    data[i] = y;
  }
  return data;
}

function normalize(data, peak = 0.9) {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / max;
  return data;
}

/**
 * Enveloppe du tonnerre : un claquement (si l'éclair est proche), puis plusieurs grondements
 * qui roulent et s'éteignent lentement.
 * @param {number} distance  0 = tout près (claquement sec), 1 = lointain (grondement sourd)
 */
export function thunderEnvelope(t, duration, distance, rumbles) {
  const crack = distance < 0.5 ? Math.exp(-t * 18) * (1 - distance * 2) : 0;
  let roll = 0;
  for (const r of rumbles) {
    if (t < r.at) continue;
    const u = t - r.at;
    roll += r.amp * (1 - Math.exp(-u * 6)) * Math.exp(-u / r.len);
  }
  const tail = Math.max(0, 1 - t / duration);
  return (crack + roll) * tail;
}

/** Échantillons du tonnerre (Float32Array), sans contexte audio : testable. */
export function thunderSamples(sampleRate, seed, distance = 0.5) {
  const rand = prng(seed >>> 0);
  const duration = 4 + distance * 3 + rand() * 1.5;
  const n = Math.floor(sampleRate * duration);
  const rumbles = Array.from({ length: 3 + Math.floor(rand() * 3) }, (_, i) => ({
    at: i === 0 ? 0.02 : 0.2 + rand() * (duration * 0.5),
    amp: i === 0 ? 1 : 0.35 + rand() * 0.5,
    len: 0.6 + rand() * 1.4
  }));
  const low = lowpass(brownNoise(rand, n), sampleRate, 140 + (1 - distance) * 260);
  const mid = lowpass(Float32Array.from({ length: n }, () => rand() * 2 - 1), sampleRate, 900 + (1 - distance) * 2500);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = thunderEnvelope(t, duration, distance, rumbles);
    const crackPart = distance < 0.5 ? mid[i] * Math.exp(-t * 10) * (0.5 - distance) : 0;
    out[i] = low[i] * env + crackPart * env;
  }
  return normalize(out, 0.95);
}

/** Bouffée d'une flamme soufflée (« fffh ») ou sifflement de vapeur (flamme éteinte par la pluie). */
export function puffSamples(sampleRate, seed, kind = "puff") {
  const rand = prng(seed >>> 0);
  const steam = kind === "steam";
  const duration = steam ? 1.1 : 0.45;
  const n = Math.floor(sampleRate * duration);
  const noise = Float32Array.from({ length: n }, () => rand() * 2 - 1);
  // Vapeur : sifflement aigu ; flamme : souffle plus grave
  const band = lowpass(noise, sampleRate, steam ? 6000 : 1400);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / (steam ? 0.03 : 0.015));
    const env = attack * Math.exp(-t / (steam ? 0.35 : 0.12));
    // Passe-haut doux pour retirer le grave sourd
    const hp = band[i] - prev * 0.95;
    prev = band[i];
    out[i] = (steam ? hp : band[i] * 0.7 + hp * 0.3) * env;
  }
  return normalize(out, steam ? 0.6 : 0.8);
}

/** Met des échantillons dans un AudioBuffer mono. */
export function toBuffer(ctx, samples) {
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
