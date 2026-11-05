/**
 * Sources sonores fournies par d'autres modules (Ember…), sans document AmbientSound.
 *
 * Un module enregistre une fonction qui renvoie, à chaque pas du moteur, la liste de ses sources :
 *   vesper.setSoundProvider("ember-particles", () => [{ id, x, y, patch, radius, … }]);
 * Chaque client calcule ses propres sources (Ember connaît l'état de ses flammes sur chaque client) :
 * rien n'est écrit en base, rien ne passe par le réseau.
 *
 * Champs d'une source (seuls id, x, y et patch ou src sont obligatoires) :
 *   id          identifiant stable (unique pour ce fournisseur)
 *   x, y        position en pixels de la scène ; elevation (unités de la scène)
 *   patch       son procédural de Vesper (modèle ou son de l'atelier) ; ou src : fichier audio en boucle
 *   radius      rayon d'écoute en cases (10 par défaut)
 *   volume      0 à 1 (0,5 par défaut, comme un son d'ambiance de Foundry)
 *   intensity   0 à 1, ou null pour suivre le vent / la pluie / la tension comme un son posé
 *   size        taille de la source en cases (1 par défaut) : une grande zone faiblit moins vite
 *   directional false : nappe sans direction
 *   walls       false : pas d'occlusion par les murs
 *   audible     false : la source se tait (fondu de sortie), par exemple une flamme soufflée
 */

import { clamp } from "./constants.js";

const providers = new Map();

/** Enregistre (ou retire avec null) le fournisseur de sources d'un module. */
export function setSoundProvider(name, fn) {
  if (!name) throw new Error("Vesper | setSoundProvider : nom manquant");
  if (typeof fn === "function") providers.set(name, fn);
  else providers.delete(name);
}

export function providerNames() {
  return [...providers.keys()];
}

/** Source complète (valeurs par défaut comprises), ou null si elle est invalide. */
export function normalizeSource(s) {
  if (!s || s.id === undefined || s.id === null) return null;
  const x = Number(s.x);
  const y = Number(s.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!s.patch && !s.src) return null;
  const num = (v, def) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : def);
  return {
    id: String(s.id),
    x,
    y,
    elevation: num(s.elevation, 0),
    patch: s.patch ? String(s.patch) : null,
    src: s.src ? String(s.src) : null,
    radius: Math.max(0.1, num(s.radius, 10)),
    volume: clamp(num(s.volume, 0.5), 0, 2),
    intensity: s.intensity === null || s.intensity === undefined ? null : clamp(num(s.intensity, 0.5), 0, 1),
    size: Math.max(0.25, num(s.size, 1)),
    directional: s.directional !== false,
    walls: s.walls !== false,
    audible: s.audible !== false
  };
}

/** Toutes les sources des fournisseurs, avec une clé unique « fournisseur:id ». */
export function providerSources() {
  const out = [];
  for (const [name, fn] of providers) {
    let list;
    try {
      list = fn() ?? [];
    } catch (err) {
      console.warn(`Vesper | sources de « ${name} » illisibles`, err);
      continue;
    }
    for (const raw of list) {
      const s = normalizeSource(raw);
      if (s) out.push({ key: `${name}:${s.id}`, provider: name, ...s });
    }
  }
  return out;
}
