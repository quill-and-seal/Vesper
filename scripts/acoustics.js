/**
 * Acoustique pure (aucune dépendance à Foundry ni au Web Audio) : testable hors du jeu.
 *
 * - Atténuation avec la distance : loi en 1/d (-6 dB à chaque doublement), comme dans l'air libre,
 *   avec un fondu doux juste avant le rayon du son pour qu'il ne se coupe jamais net.
 * - Absorption de l'air : les aigus se perdent avec la distance (un son lointain est plus sourd).
 * - Occlusion : chaque mur traversé retire des décibels et des aigus. Plusieurs rayons sont lancés
 *   autour de la source ; un passage ouvert (porte ouverte, couloir) laisse donc filtrer le son
 *   au lieu d'un tout-ou-rien.
 */

import { segmentsCross } from "./geometry.js";

/** Valeurs de Foundry (CONST.WALL_SENSE_TYPES, DOOR_TYPES, DOOR_STATES). */
export const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 };
export const DOOR = { NONE: 0, DOOR: 1, SECRET: 2 };
export const DOOR_STATE = { CLOSED: 0, OPEN: 1, LOCKED: 2 };

/** Fréquence de coupure « rien ne filtre ». */
export const OPEN_CUTOFF = 20000;

/**
 * Matériaux par défaut : perte en dB et part des aigus qui traversent (facteur sur la fréquence de coupure).
 * Réglables par le MJ (réglages du module).
 */
export const MATERIAL_DEFAULTS = Object.freeze({
  wall: { loss: 18, cutoff: 0.12 }, // mur plein : on entend surtout les graves
  door: { loss: 9, cutoff: 0.3 }, // porte fermée : plus mince, et l'air passe dessous
  thin: { loss: 4, cutoff: 0.6 } // mur « limité » : tenture, palissade, cloison
});

/** Perte maximale cumulée par les murs (au-delà, le son est de toute façon inaudible). */
export const MAX_LOSS = 60;

/**
 * Matériau d'un mur pour le son, ou null s'il ne bloque pas.
 * @param {{sound:number, door:number, ds:number}} wall
 * @param {typeof MATERIAL_DEFAULTS} materials
 */
export function wallMaterial(wall, materials = MATERIAL_DEFAULTS) {
  if (!wall || wall.sound === SENSE.NONE) return null;
  if (wall.door > DOOR.NONE) {
    if (wall.ds === DOOR_STATE.OPEN) return null;
    return materials.door;
  }
  if (wall.sound === SENSE.NORMAL) return materials.wall;
  // Limité, proximité, distance : le son passe en partie
  return materials.thin;
}

/**
 * Gain dû à la distance.
 * @param {number} d        distance (px)
 * @param {number} radius   rayon du son (px) : au-delà, silence
 * @param {number} ref      distance de référence (px) : en deçà, plein volume
 * @param {number} realism  0 = fondu linéaire (comme Foundry), 1 = loi physique en 1/d
 */
export function distanceGain(d, radius, ref, realism = 1) {
  if (radius <= 0 || d >= radius) return 0;
  const r = Math.max(1, Math.min(ref, radius * 0.5));
  const physical = d <= r ? 1 : r / d;
  const linear = 1 - d / radius;
  const base = realism * physical + (1 - realism) * linear;
  // Fondu sur le dernier quart du rayon (courbe en S) pour une sortie sans coupure
  const edge = radius * 0.75;
  let fade = 1;
  if (d > edge) {
    const x = (d - edge) / (radius - edge);
    fade = 1 - x * x * (3 - 2 * x);
  }
  return base * fade;
}

/**
 * Fréquence de coupure due à l'air (Hz).
 * Exagérée par rapport au réel pour que la distance « s'entende » à l'échelle d'une carte de JDR.
 * @param {number} meters distance en mètres
 */
export function airCutoff(meters) {
  return Math.max(2500, OPEN_CUTOFF * Math.exp(-Math.max(0, meters) / 70));
}

/** Convertit une distance de la scène en mètres (pieds, mètres, km, miles…). */
export function toMeters(value, units) {
  const u = String(units ?? "").trim().toLowerCase();
  if (["ft", "ft.", "feet", "pieds", "pied", "'"].includes(u)) return value * 0.3048;
  if (["mi", "mile", "miles"].includes(u)) return value * 1609.34;
  if (["km", "kilomètres", "kilometres", "kilometers"].includes(u)) return value * 1000;
  if (["yd", "yard", "yards"].includes(u)) return value * 0.9144;
  return value; // mètres par défaut (m, mètres, ou unité inconnue)
}

/**
 * Perte et filtrage le long d'un rayon.
 * @returns {{loss:number, factor:number}} perte en dB, facteur cumulé sur la coupure
 */
export function rayOcclusion(ax, ay, bx, by, walls, materials = MATERIAL_DEFAULTS) {
  let loss = 0;
  let factor = 1;
  for (const w of walls) {
    const c = w.c;
    if (!segmentsCross(ax, ay, bx, by, c[0], c[1], c[2], c[3])) continue;
    const m = wallMaterial(w, materials);
    if (!m) continue;
    loss += m.loss;
    factor *= m.cutoff;
    if (loss >= MAX_LOSS) return { loss: MAX_LOSS, factor };
  }
  return { loss, factor };
}

/** Un segment traverse-t-il un mur qui bloque le son ? */
export function blocked(ax, ay, bx, by, walls, materials = MATERIAL_DEFAULTS) {
  for (const w of walls) {
    const c = w.c;
    if (segmentsCross(ax, ay, bx, by, c[0], c[1], c[2], c[3]) && wallMaterial(w, materials)) return true;
  }
  return false;
}

/**
 * Occlusion entre un auditeur et une source, avec plusieurs rayons.
 *
 * Les rayons visent la source et des points autour d'elle (dans sa propre pièce seulement).
 * Les gains des rayons sont moyennés en énergie : si un seul rayon passe par une porte ouverte,
 * le son filtre déjà un peu, comme dans la réalité où il contourne les obstacles.
 *
 * @param {{x:number,y:number}} listener
 * @param {{x:number,y:number}} source
 * @param {object[]} walls     murs { c:[x1,y1,x2,y2], sound, door, ds }
 * @param {object} [opts]
 * @param {number} [opts.spread]  écart des rayons autour de la source (px)
 * @param {number} [opts.rays]    1 (rapide) ou 5 (précis)
 * @returns {{gain:number, cutoff:number, loss:number}} gain linéaire, coupure (Hz), perte (dB) du meilleur rayon
 */
export function occlusion(listener, source, walls, { spread = 50, rays = 5, materials = MATERIAL_DEFAULTS } = {}) {
  if (!walls?.length) return { gain: 1, cutoff: OPEN_CUTOFF, loss: 0 };
  const targets = [[source.x, source.y]];
  if (rays > 1 && spread > 0) {
    for (const [ox, oy] of [[spread, 0], [-spread, 0], [0, spread], [0, -spread]]) {
      const tx = source.x + ox;
      const ty = source.y + oy;
      // Le point doit être dans la même pièce que la source, sinon il ferait « fuir » le son à travers un mur
      if (!blocked(source.x, source.y, tx, ty, walls, materials)) targets.push([tx, ty]);
    }
  }
  let energy = 0;
  let wSum = 0;
  let logCut = 0;
  let best = MAX_LOSS;
  for (const [tx, ty] of targets) {
    const { loss, factor } = rayOcclusion(listener.x, listener.y, tx, ty, walls, materials);
    const g = Math.pow(10, -loss / 20);
    energy += g * g;
    wSum += g;
    logCut += g * Math.log(Math.max(80, OPEN_CUTOFF * factor));
    if (loss < best) best = loss;
  }
  const gain = Math.sqrt(energy / targets.length);
  const cutoff = wSum > 0 ? Math.exp(logCut / wSum) : 80;
  return { gain, cutoff, loss: best };
}

/**
 * Direction de la source pour le panoramique, dans le repère audio de l'auditeur.
 * Vue du dessus : le haut de l'écran est « devant », la droite de l'écran est à droite.
 * Tout près de la source, le son remonte au-dessus de la tête au lieu de sauter d'une oreille à l'autre.
 *
 * @returns {{x:number,y:number,z:number,pan:number}} vecteur unitaire (x droite, y haut, z arrière) et panoramique stéréo [-1,1]
 */
export function direction(dx, dy, near) {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 1, z: 0, pan: 0 };
  const a = Math.min(1, d / Math.max(1, near));
  const ux = dx / d;
  const uz = dy / d;
  const x = ux * a;
  const z = uz * a;
  const y = Math.sqrt(Math.max(0, 1 - a * a));
  return { x, y, z, pan: x * 0.85 };
}

/** Lissage d'une valeur vers une cible (pour les calculs hors audio). */
export function approach(current, target, rate) {
  return current + (target - current) * rate;
}
