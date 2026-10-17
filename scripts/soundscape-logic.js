/**
 * Logique pure du paysage sonore (testable hors du jeu) : conditions des couches
 * et calendrier des sons dispersés.
 *
 * Le calendrier est déterministe : il ne dépend que de l'identifiant de la couche, de la scène
 * et de l'heure du serveur. Tous les joueurs entendent donc le même coup de tonnerre au même moment,
 * venant du même côté, sans aucun message réseau.
 */

import { LAYER_DEFAULTS, clamp } from "./constants.js";
import { prng, hashString } from "./audio/reverb-presets.js";

/** Durée d'une fenêtre du calendrier (ms). */
export const WINDOW_MS = 60000;

/** Couche complète (valeurs par défaut comprises). */
export function normalizeLayer(layer) {
  const l = { ...LAYER_DEFAULTS, ...(layer ?? {}) };
  l.when = { ...LAYER_DEFAULTS.when, ...(layer?.when ?? {}) };
  l.scatter = { ...LAYER_DEFAULTS.scatter, ...(layer?.scatter ?? {}) };
  l.paths = Array.isArray(l.paths) ? l.paths.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim()) : [];
  return l;
}

/**
 * La couche doit-elle jouer dans cet état ?
 * @param {object} when    conditions de la couche
 * @param {{night:boolean, combat:boolean, weather:string, inside:boolean, tension:number}} state
 */
export function conditionsMatch(when, state) {
  const w = { ...LAYER_DEFAULTS.when, ...(when ?? {}) };
  if (w.time === "day" && state.night) return false;
  if (w.time === "night" && !state.night) return false;
  if (w.combat === "yes" && !state.combat) return false;
  if (w.combat === "no" && state.combat) return false;
  if (w.place === "inside" && !state.inside) return false;
  if (w.place === "outside" && state.inside) return false;
  if (w.weather !== "any") {
    const k = state.weather ?? "clear";
    // « Pluie » comprend l'orage ; « Orage » est plus strict
    const ok = w.weather === "rain" ? k === "rain" || k === "storm" : k === w.weather;
    if (!ok) return false;
  }
  const t = state.tension ?? 0;
  if (t < (w.tensionMin ?? 0) || t > (w.tensionMax ?? 3)) return false;
  return true;
}

/**
 * Sons dispersés d'une fenêtre du calendrier.
 * @param {object} layer      couche normalisée
 * @param {string} sceneId
 * @param {number} k          indice de la fenêtre (heure serveur / WINDOW_MS)
 * @returns {{key:string, time:number, index:number, pan:number, far:boolean, rate:number}[]}
 */
export function scatterEvents(layer, sceneId, k) {
  const s = layer.scatter;
  const n = Math.max(1, layer.paths.length || 1);
  const min = Math.max(0.5, Number(s.min) || 1);
  const max = Math.max(min, Number(s.max) || min);
  const rand = prng(hashString(`${sceneId}|${layer.id}|${k}`));
  const start = k * WINDOW_MS;
  const out = [];
  // Premier son décalé au hasard dans l'intervalle, pour ne pas en avoir un à chaque début de fenêtre
  let t = start + rand() * max * 1000;
  let i = 0;
  while (t < start + WINDOW_MS) {
    out.push({
      key: `${layer.id}:${k}:${i}`,
      time: t,
      index: Math.floor(rand() * n),
      pan: clamp((rand() * 2 - 1) * (Number(s.spread) || 0), -1, 1),
      far: rand() < (Number(s.distance) || 0),
      rate: 1 + (rand() * 2 - 1) * (Number(s.pitch) || 0)
    });
    t += (min + rand() * (max - min)) * 1000;
    i++;
  }
  return out;
}

/**
 * Sons dispersés à programmer entre deux heures serveur (fenêtres voisines comprises).
 */
export function eventsBetween(layer, sceneId, from, to) {
  const out = [];
  for (let k = Math.floor(from / WINDOW_MS); k <= Math.floor(to / WINDOW_MS); k++) {
    for (const e of scatterEvents(layer, sceneId, k)) if (e.time > from && e.time <= to) out.push(e);
  }
  return out;
}
