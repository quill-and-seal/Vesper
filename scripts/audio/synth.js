/**
 * Sons générés : simple façade sur le moteur procédural (patches.js + patch-player.js).
 * Une « couche générée » du paysage sonore, ou un son généré posé sur la carte, joue une recette :
 * un modèle livré avec Vesper (feu, vent, pluie…) ou un son créé dans l'atelier.
 */

import { BUILTIN_IDS, getPatch } from "../patches.js";
import { PatchPlayer } from "./patch-player.js";

/** Identifiants des modèles livrés. */
export const SYNTH_TYPES = BUILTIN_IDS;

/**
 * Crée le lecteur d'une recette.
 * @param {BaseAudioContext} ctx
 * @param {string} id        modèle ou son de l'atelier
 * @param {object} [opts]    voir PatchPlayer
 */
export function createSynth(ctx, id, opts = {}) {
  const patch = getPatch(id) ?? getPatch("wind");
  return new PatchPlayer(ctx, patch, opts);
}

/** Dossier des fichiers silencieux qui marquent un son généré posé sur la carte. */
export const SYNTH_DIR = "modules/vesper-audio/synth/";

/** Fichier à donner à un son d'ambiance procédural (Foundry exige un fichier ; celui-ci est muet). */
export const PROCEDURAL_PATH = `${SYNTH_DIR}procedural.wav`;

/** Modèle désigné par le chemin d'un son d'ambiance (synth/feu.wav…), ou null. */
export function synthFromPath(path) {
  const m = /(?:^|\/)modules\/vesper-audio\/synth\/([a-z0-9-]+)\.wav$/.exec(String(path ?? ""));
  return m && getPatch(m[1]) ? m[1] : null;
}

/** Le chemin désigne-t-il un son procédural (modèle ou recette indiquée dans les réglages du son) ? */
export function isProceduralPath(path) {
  return /(?:^|\/)modules\/vesper-audio\/synth\/[a-z0-9-]+\.wav$/.test(String(path ?? ""));
}
