/**
 * Paysage sonore : couches d'ambiance non positionnées qui évoluent toutes seules.
 *
 * Chaque couche joue quand ses conditions sont remplies (jour/nuit, combat, météo d'Ember, intérieur
 * ou extérieur, tension réglée par le MJ) et entre ou sort en fondu. Trois sortes de couches :
 *   - boucle   : un fichier en boucle (vent, foule, rivière lointaine)
 *   - dispersé : des sons ponctuels à intervalles irréguliers, à gauche, à droite, près ou loin
 *                (oiseaux, craquements, tonnerre) — synchronisés entre tous les joueurs
 *   - généré   : vent, pluie, nappe de tension, battement de cœur, sans aucun fichier
 *
 * Une couche « extérieure » est étouffée quand l'auditeur entre dans une Région isolée :
 * on passe la porte de la taverne, l'orage devient un grondement sourd.
 */

import { MODULE_ID, FLAG_SOUNDSCAPE, SOUNDSCAPE_DEFAULTS, SMOOTH, dbToGain, setting } from "./constants.js";
import { normalizeLayer, conditionsMatch, eventsBetween } from "./soundscape-logic.js";
import { hashString } from "./audio/reverb-presets.js";
import { createSynth } from "./audio/synth.js";
import { getPatch, patchIntensity, patchSignature } from "./patches.js";
import { Voice } from "./audio/voice.js";
import { readDarkness, readCombat, readWeather, readWind } from "./world.js";

/** Avance de programmation des sons dispersés (ms). */
const LOOKAHEAD = 1500;

/** Paysage sonore d'une scène (valeurs par défaut comprises). */
export function readSoundscape(scene = canvas.scene) {
  const flag = scene?.getFlag?.(MODULE_ID, FLAG_SOUNDSCAPE) ?? {};
  const s = { ...SOUNDSCAPE_DEFAULTS, ...flag };
  s.layers = (Array.isArray(flag.layers) ? flag.layers : []).map(normalizeLayer).filter((l) => l.id);
  return s;
}

export async function writeSoundscape(changes, scene = canvas.scene) {
  if (!game.user.isGM) throw new Error(game.i18n.localize("VESPER.Error.GMOnly"));
  const current = scene.getFlag(MODULE_ID, FLAG_SOUNDSCAPE) ?? {};
  const next = { ...SOUNDSCAPE_DEFAULTS, ...current, ...changes };
  // Les couches sont un tableau : Foundry le remplace en entier (pas de fusion élément par élément)
  await scene.setFlag(MODULE_ID, FLAG_SOUNDSCAPE, next);
  return next;
}

/** Ce qui fait changer de couche : signature qui oblige à recréer les sources. */
function sourceSignature(l) {
  return JSON.stringify([l.kind, l.kind === "synth" ? [l.synth, patchSignature(l.synth)] : l.paths]);
}

export class Soundscape {
  /**
   * @param {import("./audio/output.js").AudioOutput} out
   * @param {import("./spatial-engine.js").SpatialEngine} spatial
   */
  constructor(out, spatial) {
    this.out = out;
    this.spatial = spatial;
    this.layers = new Map();
    this.data = { ...SOUNDSCAPE_DEFAULTS, layers: [] };
    this.state = null;
    this.scheduled = new Set();
    this.sceneId = null;
  }

  /** Relit le paysage de la scène. */
  sync() {
    if (!this.out.ctx || !canvas.scene) return;
    if (this.sceneId !== canvas.scene.id) {
      this.clear();
      this.sceneId = canvas.scene.id;
    }
    this.data = readSoundscape();
    const wanted = new Map(this.data.layers.map((l) => [l.id, l]));
    for (const [id, rt] of this.layers) {
      const l = wanted.get(id);
      if (!l || sourceSignature(l) !== rt.signature) this.#remove(id, rt.layer.fade);
    }
    for (const l of this.data.layers) {
      const rt = this.layers.get(l.id);
      if (rt) rt.layer = l;
      else this.layers.set(l.id, this.#create(l));
    }
    this.update();
  }

  clear() {
    for (const [id] of this.layers) this.#remove(id, 0.3);
    this.scheduled.clear();
  }

  #create(layer) {
    const ctx = this.out.ctx;
    const input = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const send = ctx.createGain();
    send.gain.value = 0;
    input.connect(filter).connect(gain);
    gain.connect(this.out.bedBus);
    gain.connect(send).connect(this.out.reverb.input);
    return { layer, signature: sourceSignature(layer), input, filter, gain, send, source: null, synth: null, active: false, loading: false, offSince: null };
  }

  #remove(id, fade = 1) {
    const rt = this.layers.get(id);
    if (!rt) return;
    this.layers.delete(id);
    const t = this.out.now;
    rt.gain.gain.cancelScheduledValues(t);
    rt.gain.gain.setTargetAtTime(0, t, Math.max(0.05, fade / 3));
    setTimeout(() => this.#dispose(rt), (fade + 0.5) * 1000);
  }

  #dispose(rt) {
    try {
      rt.source?.stop();
    } catch {
      /* déjà arrêté */
    }
    rt.synth?.stop();
    for (const n of [rt.source, rt.input, rt.filter, rt.gain, rt.send]) {
      try {
        n?.disconnect();
      } catch {
        /* déjà débranché */
      }
    }
    rt.source = null;
    rt.synth = null;
  }

  /** État du monde qui décide des couches. */
  readState() {
    const place = this.spatial.listenerPlace;
    const weather = readWeather();
    return {
      night: readDarkness() >= 0.5,
      combat: readCombat(),
      weather: weather.kind,
      weatherIntensity: weather.intensity,
      wind: readWind(),
      inside: (place?.isolation ?? 0) > 0,
      isolation: place?.isolation ?? 0,
      tension: Number(this.data.tension) || 0
    };
  }

  /** Mise à jour (appelée à chaque pas du moteur spatial). */
  update() {
    if (!this.out.ctx || !canvas.scene) return;
    const state = (this.state = this.readState());
    const enabled = this.data.enabled !== false && setting("soundscape", true);
    const sceneGain = dbToGain(Number(this.data.volume) || 0);
    const t = this.out.now;

    for (const rt of this.layers.values()) {
      const l = rt.layer;
      const active = enabled && l.enabled !== false && conditionsMatch(l.when, state);
      const fade = Math.max(0.1, Number(l.fade) || 0);

      // Étouffement des couches extérieures quand on est à l'intérieur
      const muffle = l.outdoor ? state.isolation : 0;
      const target = active ? dbToGain(Number(l.volume) || 0) * sceneGain * dbToGain(-20 * muffle) : 0;
      rt.gain.gain.setTargetAtTime(target, t, active !== rt.active ? fade / 3 : SMOOTH * 3);
      rt.filter.frequency.setTargetAtTime(Math.max(350, 20000 * (1 - 0.92 * muffle)), t, 0.4);
      rt.send.gain.setTargetAtTime(l.outdoor && state.inside ? 0.35 : 0.12, t, 0.4);
      rt.active = active;

      if (active) {
        rt.offSince = null;
        this.#ensureSource(rt, state);
      } else if (rt.offSince === null) rt.offSince = t;
      else if ((rt.source || rt.synth) && t - rt.offSince > fade + 2) {
        // Couche silencieuse depuis un moment : on libère la source
        this.#stopSource(rt);
      }

      if (rt.synth) rt.synth.setIntensity(this.#synthIntensity(l.synth, state));
      if (l.kind === "scatter" && active) this.#scheduleScatter(rt);
    }
    if (this.scheduled.size > 500) this.scheduled.clear();
  }

  #synthIntensity(type, state) {
    return patchIntensity(getPatch(type), state);
  }

  #ensureSource(rt) {
    const l = rt.layer;
    if (l.kind === "synth") {
      if (!rt.synth) {
        rt.synth = createSynth(this.out.ctx, l.synth);
        rt.synth.output.connect(rt.input);
      }
      return;
    }
    if (l.kind === "loop") {
      if (rt.source || rt.loading || !l.paths.length) return;
      const path = l.paths[hashString(`${this.sceneId}|${l.id}`) % l.paths.length];
      rt.loading = true;
      this.out.load(path).then((buffer) => {
        rt.loading = false;
        if (!buffer || rt.source || this.layers.get(l.id) !== rt) return;
        const src = this.out.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(rt.input);
        src.start(0, buffer.duration > 1 ? Math.random() * buffer.duration : 0);
        rt.source = src;
      });
      return;
    }
    // Dispersé : on précharge les fichiers
    for (const p of l.paths) this.out.load(p);
  }

  #stopSource(rt) {
    try {
      rt.source?.stop();
      rt.source?.disconnect();
    } catch {
      /* déjà arrêté */
    }
    rt.synth?.stop();
    rt.source = null;
    rt.synth = null;
  }

  #scheduleScatter(rt) {
    const l = rt.layer;
    if (!l.paths.length) return;
    const now = game.time?.serverTime ?? Date.now();
    for (const e of eventsBetween(l, this.sceneId, now, now + LOOKAHEAD)) {
      if (this.scheduled.has(e.key)) continue;
      this.scheduled.add(e.key);
      const path = l.paths[e.index % l.paths.length];
      this.out.load(path).then((buffer) => {
        if (!buffer || this.layers.get(l.id) !== rt) return;
        const delay = (e.time - (game.time?.serverTime ?? Date.now())) / 1000;
        if (delay < -0.25) return; // trop tard (fichier long à charger) : on saute ce son
        const v = new Voice(this.out, buffer, { loop: false, panning: "stereo", bus: rt.input, rate: e.rate });
        // Loin : plus faible, plus sourd, plus réverbéré
        v.set({
          gain: e.far ? 0.4 : 1,
          cutoff: e.far ? 2200 : 18000,
          send: e.far ? 0.7 : 0.2,
          dir: { x: e.pan, y: 0, z: 0, pan: e.pan },
          smooth: 0.001
        });
        v.start(this.out.now + Math.max(0, delay), 0);
      });
    }
  }

  describe() {
    return {
      state: this.state,
      layers: [...this.layers.values()].map((rt) => ({ id: rt.layer.id, label: rt.layer.label, kind: rt.layer.kind, active: rt.active }))
    };
  }
}
