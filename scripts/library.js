/**
 * Bibliothèque du panneau : les sons prêts à poser sur la carte.
 *   - les modèles livrés avec Vesper ;
 *   - les sons de l'atelier que le MJ a enregistrés dans la bibliothèque ;
 *   - les fichiers audio qu'il y a ajoutés.
 */

import { MODULE_ID, setting, t } from "./constants.js";
import { BUILTIN_IDS, customPatches, getPatch } from "./patches.js";
import { PROCEDURAL_PATH } from "./audio/synth.js";

/** Rayon proposé selon le son (en cases). */
export const DEFAULT_RADIUS = { fire: 6, torch: 4, river: 10, drips: 5, crickets: 8, wind: 12, rain: 15, drone: 10, heartbeat: 4 };

/** Catégories des modèles livrés. */
export const BUILTIN_CATEGORIES = [
  ["fire", ["fire", "torch"]],
  ["water", ["river", "drips", "rain"]],
  ["nature", ["crickets", "wind"]],
  ["tension", ["drone", "heartbeat"]]
];

/** Fichiers audio de la bibliothèque (réglage du monde). */
export function libraryFiles() {
  const list = setting("libraryFiles", []);
  return Array.isArray(list) ? list.filter((f) => f?.path) : [];
}

export async function addLibraryFile(path) {
  const files = libraryFiles();
  if (files.some((f) => f.path === path)) return;
  files.push({ id: foundry.utils.randomID(8), path, name: fileLabel(path) });
  await game.settings.set(MODULE_ID, "libraryFiles", files);
}

export async function removeLibraryFile(id) {
  await game.settings.set(MODULE_ID, "libraryFiles", libraryFiles().filter((f) => f.id !== id));
}

/** Nom lisible d'un fichier (sans dossier ni extension). */
export function fileLabel(path) {
  let name = String(path ?? "").split("/").pop() || "—";
  name = name.replace(/\.[a-z0-9]+$/i, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    /* laissé tel quel */
  }
  return name;
}

/** Sons de l'atelier présents dans la bibliothèque. */
export function librarySounds() {
  return Object.values(customPatches()).filter((p) => p.library);
}

/**
 * Entrée de bibliothèque à poser : { patch } ou { path }, avec nom et rayon proposés.
 * @param {{patch?:string, path?:string}} ref
 */
export function libraryEntry(ref) {
  if (ref?.patch && getPatch(ref.patch)) {
    const p = getPatch(ref.patch);
    return { patch: ref.patch, path: PROCEDURAL_PATH, name: p.builtin ? t(`Synth.${ref.patch}`) : p.label || ref.patch, radius: DEFAULT_RADIUS[ref.patch] ?? 6 };
  }
  if (ref?.path) return { patch: null, path: ref.path, name: fileLabel(ref.path), radius: 8 };
  return null;
}

/** Données d'un son d'ambiance de Foundry posé depuis la bibliothèque. */
export function soundDataForEntry(entry, point, distancePerCell) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
    radius: entry.radius * distancePerCell,
    path: entry.path,
    volume: 0.5,
    repeat: true,
    easing: true,
    walls: true,
    flags: { [MODULE_ID]: { sound: { patch: entry.patch ?? null } } }
  };
}

/** Toutes les entrées, par catégorie, pour le panneau. */
export function libraryCategories() {
  const cats = BUILTIN_CATEGORIES.map(([key, ids]) => ({ key, title: t(`Library.Cat.${key}`), entries: ids.map((id) => libraryEntry({ patch: id })) }));
  const mine = librarySounds().map((p) => libraryEntry({ patch: p.id }));
  if (mine.length) cats.push({ key: "mine", title: t("Library.Cat.mine"), entries: mine });
  const files = libraryFiles().map((f) => ({ ...libraryEntry({ path: f.path }), fileId: f.id, name: f.name || fileLabel(f.path) }));
  if (files.length) cats.push({ key: "files", title: t("Library.Cat.files"), entries: files });
  return cats;
}

/** Choix « Son » de l'inspecteur : tout ce qu'on peut jouer. */
export function soundChoices() {
  const out = BUILTIN_IDS.map((id) => ({ value: `patch:${id}`, label: t(`Synth.${id}`), group: t("Library.Builtins") }));
  for (const p of Object.values(customPatches())) out.push({ value: `patch:${p.id}`, label: p.label || p.id, group: t("Library.Cat.mine") });
  for (const f of libraryFiles()) out.push({ value: `file:${f.path}`, label: f.name || fileLabel(f.path), group: t("Library.Cat.files") });
  return out;
}
