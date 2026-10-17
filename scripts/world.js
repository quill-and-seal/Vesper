/**
 * Lecture de l'état du monde Foundry : murs, auditeurs, Régions acoustiques, jour/nuit, combat, météo.
 * Tout ce qui touche à l'API de Foundry est regroupé ici (le reste du moteur reste testable).
 */

import { MODULE_ID, FLAG_ACOUSTICS, setting } from "./constants.js";
import { pointInShape, polygonArea } from "./geometry.js";
import { MATERIAL_DEFAULTS } from "./acoustics.js";
import { REVERB_PRESETS } from "./audio/reverb-presets.js";

export const ACOUSTICS_BEHAVIOR = `${MODULE_ID}.acoustics`;
const EMBER_ID = "ember-particles";

/** Murs de la scène sous forme de données simples (copie, rafraîchie quand un mur change). */
export function readWalls() {
  const out = [];
  for (const wall of canvas.walls?.placeables ?? []) {
    const d = wall.document;
    if (!d?.c) continue;
    out.push({ id: d.id, c: [...d.c], sound: d.sound, door: d.door, ds: d.ds });
  }
  return out;
}

/** Matériaux réglés par le MJ. */
export function readMaterials() {
  return {
    wall: { loss: setting("wallLoss", MATERIAL_DEFAULTS.wall.loss), cutoff: MATERIAL_DEFAULTS.wall.cutoff },
    door: { loss: setting("doorLoss", MATERIAL_DEFAULTS.door.loss), cutoff: MATERIAL_DEFAULTS.door.cutoff },
    thin: { loss: setting("thinLoss", MATERIAL_DEFAULTS.thin.loss), cutoff: MATERIAL_DEFAULTS.thin.cutoff }
  };
}

/**
 * Positions d'écoute : celles de Foundry (tokens qui entendent), sinon, pour le MJ sans token,
 * le centre de la caméra (on promène la carte pour écouter la scène).
 * @returns {{x:number,y:number,elevation:number}[]}
 */
export function readListeners() {
  let list = [];
  try {
    list = canvas.sounds?.getListenerPositions?.() ?? [];
  } catch {
    list = [];
  }
  if (!list.length) {
    const tokens = canvas.tokens?.controlled ?? [];
    list = tokens.map((t) => ({ ...t.center, elevation: t.document.elevation ?? 0 }));
  }
  if (!list.length && game.user.isGM && setting("gmListener", "camera") === "camera") {
    const p = canvas.stage?.pivot;
    if (p) list = [{ x: p.x, y: p.y, elevation: 0 }];
  }
  return list.map((p) => ({ x: p.x, y: p.y, elevation: p.elevation ?? 0 }));
}

/** Métriques de la scène : pixels par case, distance d'une case et son unité. */
export function readMetrics() {
  const d = canvas.dimensions;
  return {
    size: d?.size ?? 100,
    distance: d?.distance ?? 1.5,
    units: canvas.scene?.grid?.units ?? d?.units ?? "m",
    distancePixels: d?.distancePixels ?? (d?.size ?? 100) / (d?.distance ?? 1.5)
  };
}

/** Polygones d'une Région (Foundry v13+). */
function regionPolygons(region) {
  return region.polygons ?? region.object?.polygons ?? [];
}

/** Le point est-il dans la Région (élévation comprise) ? */
export function regionContains(region, point) {
  try {
    if (typeof region.testPoint === "function") return region.testPoint({ x: point.x, y: point.y, elevation: point.elevation ?? 0 });
  } catch {
    /* repli ci-dessous */
  }
  const e = region.elevation ?? {};
  const z = point.elevation ?? 0;
  if (Number.isFinite(e.bottom) && z < e.bottom) return false;
  if (Number.isFinite(e.top) && z > e.top) return false;
  return pointInShape(point.x, point.y, regionPolygons(region));
}

function regionArea(region) {
  let a = 0;
  for (const p of regionPolygons(region)) if (p?.points && p.isPositive !== false) a += polygonArea(p.points);
  return a || Infinity;
}

/**
 * Régions de la scène qui ont un comportement « Acoustique » actif.
 * @returns {{region:object, place:string, wet:number, isolation:number, area:number}[]}
 */
export function readAcousticZones(scene = canvas.scene) {
  const out = [];
  for (const region of scene?.regions ?? []) {
    const behaviors = region.behaviors?.contents ?? [...(region.behaviors ?? [])];
    for (const b of behaviors) {
      if (b.type !== ACOUSTICS_BEHAVIOR || b.disabled) continue;
      const s = b.system ?? {};
      const place = REVERB_PRESETS[s.place] ? s.place : "room";
      const wet = Number.isFinite(s.wet) && s.wet !== null ? s.wet : REVERB_PRESETS[place].wet;
      out.push({ id: `${region.id}.${b.id}`, region, place, wet, isolation: Number(s.isolation) || 0, area: regionArea(region) });
    }
  }
  // La plus petite Région gagne (une crypte dans une cathédrale)
  out.sort((a, b) => a.area - b.area);
  return out;
}

/** Acoustique par défaut de la scène (hors Régions). */
export function readSceneAcoustics(scene = canvas.scene) {
  const flag = scene?.getFlag?.(MODULE_ID, FLAG_ACOUSTICS) ?? {};
  const place = REVERB_PRESETS[flag.place] ? flag.place : setting("defaultPlace", "outdoor");
  const wet = Number.isFinite(flag.wet) ? flag.wet : REVERB_PRESETS[place].wet;
  return { place, wet };
}

/** Lieu acoustique en un point : la plus petite Région qui le contient, sinon celui de la scène. */
export function placeAt(point, zones, fallback) {
  for (const z of zones) if (regionContains(z.region, point)) return z;
  return { id: null, place: fallback.place, wet: fallback.wet, isolation: 0 };
}

/** Le point est-il « à l'intérieur » (dans une Région acoustique isolée) ? */
export function isInside(point, zones) {
  return zones.some((z) => z.isolation > 0 && regionContains(z.region, point));
}

/**
 * Isolation entre deux points : chaque Région isolée qui contient l'un mais pas l'autre ajoute
 * une perte (on est dans la taverne, la source est dehors : le son est étouffé, même sans murs).
 * @returns {{loss:number, factor:number}}
 */
export function isolationBetween(a, b, zones) {
  let loss = 0;
  let factor = 1;
  for (const z of zones) {
    if (!(z.isolation > 0)) continue;
    if (regionContains(z.region, a) === regionContains(z.region, b)) continue;
    loss += 24 * z.isolation;
    factor *= 1 - 0.85 * z.isolation;
  }
  return { loss, factor: Math.max(0.02, factor) };
}

/** Obscurité de la scène (0 = plein jour, 1 = nuit noire). */
export function readDarkness() {
  return canvas.environment?.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? canvas.scene?.darkness ?? 0;
}

/** Un combat a-t-il commencé sur cette scène ? */
export function readCombat() {
  for (const c of game.combats ?? []) {
    if (!c.started) continue;
    const sceneId = c.scene?.id ?? c.sceneId ?? null;
    if (!sceneId || sceneId === canvas.scene?.id) return true;
  }
  return false;
}

/** Ember est-il actif ? */
export function emberActive() {
  return !!game.modules.get(EMBER_ID)?.active;
}

/**
 * Météo lue dans Ember : clear | rain | storm | snow | fog | other, et son intensité.
 */
export function readWeather(scene = canvas.scene) {
  if (!emberActive()) return { kind: "clear", intensity: 0, lightning: false };
  const w = scene?.getFlag?.(EMBER_ID, "weather") ?? {};
  const intensity = Number(w.intensity) || 0;
  let kind = "clear";
  if (w.kind === "rain") kind = w.lightning || intensity >= 0.85 ? "storm" : "rain";
  else if (w.kind === "snow") kind = "snow";
  else if (w.kind && w.kind !== "none") kind = "other";
  else if ((Number(w.fog) || 0) >= 0.35) kind = "fog";
  return { kind, intensity: kind === "fog" ? Number(w.fog) || 0 : intensity, lightning: !!w.lightning };
}

/** Vent lu dans Ember (0 à 1). */
export function readWind(scene = canvas.scene) {
  if (!emberActive()) return 0;
  const w = scene?.getFlag?.(EMBER_ID, "wind") ?? {};
  if (!w.enabled) return 0;
  return Math.min(1, (Number(w.strength) || 0) / 100);
}
