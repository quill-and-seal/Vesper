/**
 * Moteur spatial : rend les sons d'ambiance de Foundry (AmbientSound) depuis la position du token.
 *
 * Pour chaque son, à chaque pas de mise à jour, et pour l'auditeur qui l'entend le mieux :
 *   volume  = distance (loi physique) × murs traversés × isolation des Régions × volume du son
 *   aigus   = absorption de l'air × murs × isolation
 *   direction (HRTF ou stéréo), et part envoyée à la réverbération du lieu où se tient l'auditeur.
 *
 * Les sons « gérés » ne sont plus joués par Foundry (voir ambient-sound.js) : Vesper les joue à sa place.
 */

import { MODULE_ID, FLAG_SOUND, FLAG_SOUNDSCAPE, SOUND_DEFAULTS, TICK_MS, dbToGain, setting } from "./constants.js";
import { distanceGain, airCutoff, toMeters, occlusion, direction, OPEN_CUTOFF } from "./acoustics.js";
import { dist } from "./geometry.js";
import { Voice } from "./audio/voice.js";
import { createSynth, synthFromPath } from "./audio/synth.js";
import { getPatch, patchIntensity, patchSignature } from "./patches.js";
import {
  readWalls,
  readMaterials,
  readListeners,
  readMetrics,
  readAcousticZones,
  readSceneAcoustics,
  placeAt,
  isolationBetween,
  readDarkness,
  readWind,
  readWeather
} from "./world.js";

/** En dessous de ce volume (-70 dB), une voix ne mérite pas d'exister. */
const SILENT = 0.0003;

/** Un son est préchargé quand l'auditeur entre dans cette part de son rayon. */
const PRELOAD = 1.3;

/** Réglages Vesper d'un son d'ambiance. */
export function soundSettings(doc) {
  return { ...SOUND_DEFAULTS, ...(doc?.getFlag?.(MODULE_ID, FLAG_SOUND) ?? doc?.flags?.[MODULE_ID]?.[FLAG_SOUND] ?? {}) };
}

/**
 * Recette procédurale jouée par ce son d'ambiance, ou null pour un fichier.
 * Choisie dans la fenêtre du son (réglage « Son procédural »), ou désignée par son chemin (synth/fire.wav).
 */
export function soundPatch(doc) {
  const id = soundSettings(doc).patch;
  if (id && getPatch(id)) return id;
  return synthFromPath(doc?.path);
}

/** État du monde qui règle l'intensité des sons procéduraux. */
export function readWorldState(scene = canvas.scene) {
  const w = readWeather(scene);
  return {
    wind: readWind(scene),
    weather: w.kind,
    weatherIntensity: w.intensity,
    tension: Number(scene?.getFlag?.(MODULE_ID, FLAG_SOUNDSCAPE)?.tension) || 0
  };
}

/** Vesper joue-t-il ce son à la place de Foundry ? */
export function isManaged(doc) {
  if (!doc?.path) return false;
  if (!setting("takeover", true)) return false;
  return soundSettings(doc).managed !== false;
}

export class SpatialEngine {
  /** @param {import("./audio/output.js").AudioOutput} out */
  constructor(out) {
    this.out = out;
    this.entries = new Map();
    this.oneShots = new Set();
    this.walls = [];
    this.materials = readMaterials();
    this.zones = [];
    this.sceneAcoustics = { place: "outdoor", wet: 0.12 };
    this.metrics = { size: 100, distance: 1.5, units: "m", distancePixels: 66 };
    this.listeners = [];
    this.listenerPlace = null;
    this.wallsVersion = 0;
    this.#elapsed = 0;
    this.#tickFn = (ticker) => this.#onTick(ticker);
  }

  #elapsed;
  #tickFn;
  #running = false;

  /* -------------------------------------------- */
  /*  Cycle de vie                                */
  /* -------------------------------------------- */

  start() {
    if (this.#running || !canvas.app?.ticker) return;
    canvas.app.ticker.add(this.#tickFn);
    this.#running = true;
  }

  stop() {
    if (this.#running) canvas.app?.ticker?.remove(this.#tickFn);
    this.#running = false;
  }

  /** Relit tout (scène prête, réglages changés). */
  sync() {
    this.metrics = readMetrics();
    this.refreshWalls();
    this.refreshZones();
    this.refreshSounds();
    this.start();
    this.update();
  }

  refreshWalls() {
    this.walls = readWalls();
    this.materials = readMaterials();
    this.wallsVersion++;
  }

  refreshZones() {
    this.zones = readAcousticZones();
    this.sceneAcoustics = readSceneAcoustics();
    this.wallsVersion++;
  }

  /** Les documents de sons ont changé : on retire les voix des sons supprimés ou rendus à Foundry. */
  refreshSounds() {
    const docs = new Map((canvas.scene?.sounds ?? []).map((d) => [d.id, d]));
    for (const [id, entry] of this.entries) {
      const doc = docs.get(id);
      if (!doc || !isManaged(doc) || doc.path !== entry.path) this.#release(id);
    }
  }

  /** Coupe tout (sortie de scène). */
  clear() {
    for (const id of [...this.entries.keys()]) this.#release(id, 0.2);
    for (const s of this.oneShots) s.voice?.stop(0.2);
    this.oneShots.clear();
    this.stop();
  }

  #release(id, fade = 0.6) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.voice?.stop(fade);
    this.entries.delete(id);
  }

  #onTick(ticker) {
    this.#elapsed += ticker?.deltaMS ?? 16;
    if (this.#elapsed < TICK_MS) return;
    this.#elapsed = 0;
    this.update();
  }

  /* -------------------------------------------- */
  /*  Mise à jour                                 */
  /* -------------------------------------------- */

  update() {
    if (!this.out.ctx || !canvas.ready || !canvas.scene) return;
    this.out.updateVolume();
    this.listeners = readListeners();

    // Réverbération : le lieu où se tient le premier auditeur
    const main = this.listeners[0];
    const here = main ? placeAt(main, this.zones, this.sceneAcoustics) : { place: this.sceneAcoustics.place, wet: this.sceneAcoustics.wet };
    this.listenerPlace = here;
    this.out.reverb.setPlace(here.place, here.wet);

    const darkness = readDarkness();
    this.worldState = readWorldState();
    const seen = new Set();
    for (const doc of canvas.scene.sounds ?? []) {
      if (!isManaged(doc)) continue;
      seen.add(doc.id);
      this.#updateSound(doc, darkness);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.#release(id);
    for (const shot of this.oneShots) this.#updateOneShot(shot);
    this.afterUpdate?.();
  }

  /** Le son est-il audible (caché, plage d'obscurité) ? */
  #audible(doc, darkness) {
    const obj = doc.object;
    if (obj && typeof obj.isAudible === "boolean") return obj.isAudible;
    if (doc.hidden) return false;
    const r = doc.darkness ?? {};
    const min = Number.isFinite(r.min) ? r.min : 0;
    const max = Number.isFinite(r.max) ? r.max : 1;
    return darkness >= min && darkness <= max;
  }

  /** Rayon du son en pixels. */
  #radius(doc) {
    const r = doc.object?.radius;
    if (Number.isFinite(r) && r > 0) return r;
    return (Number(doc.radius) || 0) * this.metrics.distancePixels;
  }

  /**
   * Calcule ce qu'entend un auditeur d'une source.
   * @returns {{gain:number,cutoff:number,send:number,dir:object,d:number}}
   */
  hear(listener, src, { radius, size = 1, walls = true, easing = true, directional = true, volume = 1, cache = null }) {
    const d = dist(listener.x, listener.y, src.x, src.y);
    const cell = this.metrics.size;
    if (d >= radius) return { gain: 0, cutoff: OPEN_CUTOFF, send: 0, dir: null, d };

    // Distance
    let gDist;
    if (easing) {
      const ref = Math.max(cell * size, radius / 12);
      gDist = distanceGain(d, radius, ref, setting("realism", 1));
    } else {
      // « Atténuation » décochée dans Foundry : plein volume dans tout le rayon, court fondu au bord
      gDist = Math.min(1, (radius - d) / (radius * 0.05));
    }
    const meters = toMeters(d / this.metrics.distancePixels, this.metrics.units);
    let cutoff = setting("airAbsorption", true) ? airCutoff(meters) : OPEN_CUTOFF;

    // Murs et isolation, mis en cache tant que rien n'a bougé
    let occ = { gain: 1, cutoff: OPEN_CUTOFF };
    let iso = { loss: 0, factor: 1 };
    if (walls) {
      const key = `${Math.round(listener.x / 4)},${Math.round(listener.y / 4)},${Math.round(src.x / 4)},${Math.round(src.y / 4)},${this.wallsVersion}`;
      if (cache && cache.key === key) ({ occ, iso } = cache);
      else {
        occ = occlusion(listener, src, this.walls, {
          spread: cell * 0.5 * size,
          rays: setting("occlusionQuality", "high") === "high" ? 5 : 1,
          materials: this.materials
        });
        iso = isolationBetween(listener, src, this.zones);
        if (cache) Object.assign(cache, { key, occ, iso });
      }
    }
    const gain = gDist * occ.gain * dbToGain(-iso.loss) * volume;
    cutoff *= (occ.cutoff / OPEN_CUTOFF) * iso.factor;

    // Réverbération : diminue moins vite que le son direct (le lointain paraît plus « dans la salle »)
    const send = volume * Math.sqrt(gDist) * (0.35 + 0.65 * occ.gain) * dbToGain(-iso.loss * 0.5);
    const dir = directional ? direction(src.x - listener.x, src.y - listener.y, cell * 1.5 * size) : { x: 0, y: 1, z: 0, pan: 0 };
    return { gain, cutoff, send, dir, d };
  }

  #updateSound(doc, darkness) {
    const s = soundSettings(doc);
    const patchId = soundPatch(doc);
    const signature = patchId ? patchSignature(patchId) : null;
    let entry = this.entries.get(doc.id);
    // Recette changée (modifiée dans l'atelier, ou autre recette choisie) : on relance le son
    if (entry && entry.signature !== signature) {
      this.#release(doc.id, 0.3);
      entry = null;
    }
    if (!entry) {
      entry = { path: doc.path, voice: null, loading: false, played: false, caches: [], signature, patchId };
      this.entries.set(doc.id, entry);
    }
    const radius = this.#radius(doc);
    const src = { x: doc.x, y: doc.y, elevation: doc.elevation ?? 0 };
    const audible = this.#audible(doc, darkness) && radius > 0;

    // Meilleur auditeur pour cette source
    let best = null;
    let nearest = Infinity;
    if (audible) {
      this.listeners.forEach((l, i) => {
        entry.caches[i] ??= {};
        const h = this.hear(l, src, {
          radius,
          size: Math.max(0.25, Number(s.size) || 1),
          walls: doc.walls !== false,
          easing: doc.easing !== false,
          directional: s.directional !== false,
          volume: Number.isFinite(doc.volume) ? doc.volume : 0.5,
          cache: entry.caches[i]
        });
        nearest = Math.min(nearest, h.d);
        if (!best || h.gain > best.gain) best = h;
      });
    }

    const inRange = best && best.gain > SILENT;
    if (!inRange) {
      if (entry.voice) {
        entry.voice.stop(0.6);
        entry.voice = null;
      }
      // Un son joué une seule fois peut rejouer quand on revient
      if (nearest >= radius) entry.played = false;
      if (!patchId && nearest < radius * PRELOAD && !entry.loading) this.out.load(doc.path);
      return;
    }

    if (patchId) {
      // Son procédural : calculé en direct, toujours en continu
      const intensity = patchIntensity(getPatch(patchId), this.worldState, Number.isFinite(s.intensity) ? s.intensity : null);
      if (!entry.voice) {
        const player = createSynth(this.out.ctx, patchId);
        player.setIntensity(intensity);
        player.setDistance(best.d / this.metrics.size);
        entry.voice = new Voice(this.out, player, { panning: setting("panning", "hrtf") });
        entry.voice.set({ ...best, smooth: 0.25 });
      } else {
        entry.voice.player?.setIntensity(intensity);
        // Distance en cases : les couches « tout près » (le grondement du feu) ne s'entendent que collé à la source
        entry.voice.player?.setDistance(best.d / this.metrics.size);
      }
      entry.last = best;
      entry.voice.set(best);
      return;
    }

    if (!entry.voice && !entry.loading && !(entry.played && !doc.repeat)) {
      entry.loading = true;
      this.out.load(doc.path).then((buffer) => {
        entry.loading = false;
        if (!buffer || this.entries.get(doc.id) !== entry || entry.voice) return;
        entry.voice = new Voice(this.out, buffer, {
          loop: !!doc.repeat,
          panning: setting("panning", "hrtf"),
          onEnded: (v) => {
            if (entry.voice === v) entry.voice = null;
          }
        }).start();
        entry.played = true;
        // Démarre au bon volume (fondu d'entrée court) puis suit les mises à jour
        entry.voice.set({ ...this.#lastParams(entry, best), smooth: 0.25 });
      });
    }
    entry.last = best;
    entry.voice?.set(best);
  }

  #lastParams(entry, fallback) {
    return entry.last ?? fallback;
  }

  /* -------------------------------------------- */
  /*  Sons ponctuels positionnés (API, macros)    */
  /* -------------------------------------------- */

  /**
   * Joue un son une fois depuis un point de la scène, avec distance, murs et réverbération.
   * @param {string} src
   * @param {{x:number,y:number,elevation?:number}} origin
   * @param {object} [opts]
   * @param {number} [opts.radius]   rayon en unités de la scène (par défaut 30 cases)
   * @param {number} [opts.volume]
   * @param {boolean} [opts.walls]
   */
  async playAt(src, origin, { radius = null, volume = 0.8, walls = true } = {}) {
    if (!this.out.ctx || !canvas.ready) return null;
    const buffer = await this.out.load(src);
    if (!buffer) return null;
    const px = radius ? radius * this.metrics.distancePixels : this.metrics.size * 30;
    const shot = { origin: { x: origin.x, y: origin.y, elevation: origin.elevation ?? 0 }, radius: px, volume, walls, caches: [], voice: null };
    const params = this.#hearShot(shot);
    if (!params || params.gain <= SILENT) return null;
    shot.voice = new Voice(this.out, buffer, {
      loop: false,
      panning: setting("panning", "hrtf"),
      onEnded: () => this.oneShots.delete(shot)
    });
    shot.voice.set({ ...params, smooth: 0.005 });
    shot.voice.start(0, 0);
    this.oneShots.add(shot);
    return shot;
  }

  #hearShot(shot) {
    let best = null;
    this.listeners.forEach((l, i) => {
      shot.caches[i] ??= {};
      const h = this.hear(l, shot.origin, { radius: shot.radius, walls: shot.walls, volume: shot.volume, cache: shot.caches[i] });
      if (!best || h.gain > best.gain) best = h;
    });
    return best;
  }

  #updateOneShot(shot) {
    if (!shot.voice || shot.voice.ended) return this.oneShots.delete(shot);
    const p = this.#hearShot(shot);
    if (p) shot.voice.set(p);
  }

  /* -------------------------------------------- */
  /*  Diagnostic                                  */
  /* -------------------------------------------- */

  /** État lisible (console, fenêtre du MJ). */
  describe() {
    return {
      listeners: this.listeners,
      place: this.listenerPlace,
      voices: [...this.entries.entries()]
        .filter(([, e]) => e.voice)
        .map(([id, e]) => ({ id, path: e.path, gainDb: e.last ? Math.round(20 * Math.log10(Math.max(1e-6, e.last.gain))) : null, cutoff: Math.round(e.last?.cutoff ?? 0) }))
    };
  }
}
