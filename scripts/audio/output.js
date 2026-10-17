/**
 * Sortie audio de Vesper : contexte, bus maître, bus de réverbération et cache des fichiers.
 *
 * Vesper se branche sur le contexte « environnement » de Foundry (game.audio.environment) :
 * le déverrouillage au premier geste est donc géré par Foundry, et le curseur « Ambiance »
 * du joueur s'applique à Vesper comme aux sons d'ambiance natifs.
 */

import { MODULE_ID, SMOOTH, warn, setting } from "../constants.js";
import { REVERB_PRESETS, generateImpulse, hashString } from "./reverb-presets.js";

/** Durée du fondu entre deux lieux acoustiques (s). */
const REVERB_CROSSFADE = 1.2;

export class AudioOutput {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.#buffers = new Map();
    this.#impulses = new Map();
  }

  #buffers;
  #impulses;
  #ownContext = false;

  /** Prépare le contexte et les bus (idempotent). */
  init() {
    if (this.ctx) return this;
    let ctx = game.audio?.environment;
    if (!(ctx instanceof BaseAudioContext)) {
      // Repli : contexte propre, repris au premier geste du joueur
      ctx = new AudioContext();
      this.#ownContext = true;
      const resume = () => ctx.resume().catch(() => {});
      for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, resume, { once: true, capture: true });
    }
    this.ctx = ctx;
    // Foundry applique le volume « Ambiance » sur ce nœud quand il existe
    this.destination = ctx.gainNode instanceof AudioNode ? ctx.gainNode : ctx.destination;
    this.foundryVolume = ctx.gainNode instanceof AudioNode;

    this.master = ctx.createGain();
    this.master.connect(this.destination);

    // Bus des voix positionnelles et bus du paysage sonore : réglables séparément
    this.spatialBus = ctx.createGain();
    this.spatialBus.connect(this.master);
    this.bedBus = ctx.createGain();
    this.bedBus.connect(this.master);

    this.reverb = new ReverbBus(this);
    this.updateVolume();
    return this;
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  /** Volume maître : réglages Vesper × curseur « Ambiance » de Foundry (si Foundry ne l'applique pas déjà). */
  updateVolume() {
    if (!this.master) return;
    let core = 1;
    if (!this.foundryVolume) {
      try {
        const v = game.settings.get("core", "globalAmbientVolume");
        core = foundry.audio?.AudioHelper?.inputToVolume?.(v) ?? Math.pow(v, 1.5);
      } catch {
        core = 1;
      }
    }
    const t = this.now;
    this.master.gain.setTargetAtTime(core * setting("masterVolume", 1), t, SMOOTH);
    this.spatialBus.gain.setTargetAtTime(setting("spatialVolume", 1), t, SMOOTH);
    this.bedBus.gain.setTargetAtTime(setting("soundscapeVolume", 1), t, SMOOTH);
    this.reverb?.setLevel(setting("reverbVolume", 1));
  }

  /**
   * Charge et décode un fichier (une seule fois par chemin).
   * @returns {Promise<AudioBuffer|null>}
   */
  load(path) {
    if (!path) return Promise.resolve(null);
    let p = this.#buffers.get(path);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(path);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.arrayBuffer();
          return await this.ctx.decodeAudioData(data);
        } catch (err) {
          warn(`impossible de charger « ${path} »`, err);
          this.#buffers.delete(path);
          return null;
        }
      })();
      this.#buffers.set(path, p);
    }
    return p;
  }

  /** Réponse impulsionnelle d'un lieu (générée une fois). */
  impulse(id) {
    if (this.#impulses.has(id)) return this.#impulses.get(id);
    const preset = REVERB_PRESETS[id];
    const data = generateImpulse(preset, this.ctx.sampleRate, hashString(`${MODULE_ID}.${id}`));
    let buffer = null;
    if (data) {
      buffer = this.ctx.createBuffer(2, data[0].length, this.ctx.sampleRate);
      buffer.copyToChannel(data[0], 0);
      buffer.copyToChannel(data[1], 1);
    }
    this.#impulses.set(id, buffer);
    return buffer;
  }

  /** Oublie les fichiers chargés (changement de scène) sauf ceux qu'on garde. */
  forget(keep = new Set()) {
    for (const path of this.#buffers.keys()) if (!keep.has(path)) this.#buffers.delete(path);
  }

  destroy() {
    try {
      this.master?.disconnect();
    } catch {
      /* déjà débranché */
    }
    if (this.#ownContext) this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * Bus de réverbération : deux convolutions en parallèle pour passer d'un lieu à l'autre en fondu
 * (on entre dans la cathédrale, la réverbération s'ouvre au lieu de sauter).
 */
export class ReverbBus {
  /** @param {AudioOutput} out */
  constructor(out) {
    const ctx = out.ctx;
    this.out = out;
    this.input = ctx.createGain();
    this.level = ctx.createGain();
    this.level.connect(out.master);
    this.slots = [0, 1].map(() => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.level);
      return { gain, conv: null, id: null };
    });
    this.active = 0;
    this.current = null;
    this.wet = 0;
  }

  setLevel(v) {
    this.level.gain.setTargetAtTime(v, this.out.now, SMOOTH);
  }

  /**
   * Change de lieu acoustique.
   * @param {string} id     identifiant de REVERB_PRESETS
   * @param {number} wet    niveau de réverbération
   */
  setPlace(id, wet) {
    const t = this.out.now;
    if (id === this.current) {
      if (Math.abs(wet - this.wet) > 0.001) {
        this.slots[this.active].gain.gain.setTargetAtTime(wet, t, 0.3);
        this.wet = wet;
      }
      return;
    }
    this.current = id;
    this.wet = wet;
    const ctx = this.out.ctx;
    const buffer = this.out.impulse(id);
    const next = 1 - this.active;
    const old = this.slots[this.active];
    const slot = this.slots[next];

    // Ancienne réverbération : fondu de sortie
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setTargetAtTime(0, t, REVERB_CROSSFADE / 3);

    // Nouvelle : on remplace la convolution de l'emplacement libre
    if (slot.conv) {
      try {
        this.input.disconnect(slot.conv);
        slot.conv.disconnect();
      } catch {
        /* déjà débranché */
      }
      slot.conv = null;
    }
    slot.gain.gain.cancelScheduledValues(t);
    slot.gain.gain.setValueAtTime(0, t);
    if (buffer) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = buffer;
      this.input.connect(conv);
      conv.connect(slot.gain);
      slot.conv = conv;
      slot.gain.gain.setTargetAtTime(wet, t, REVERB_CROSSFADE / 3);
    }
    slot.id = id;
    this.active = next;
  }
}
