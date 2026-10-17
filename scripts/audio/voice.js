/**
 * Une voix : un son qui joue, avec sa chaîne de traitement.
 *
 *   source ─► passe-bas (air + murs) ─► volume ─► panoramique ─┬─► sec ───► bus
 *                                                             └─► envoi ─► réverbération
 *
 * Tous les paramètres sont lissés (setTargetAtTime) : un token qui marche ne crée aucun clic.
 */

import { SMOOTH } from "../constants.js";

export class Voice {
  /**
   * @param {import("./output.js").AudioOutput} out
   * @param {AudioBuffer|{output:AudioNode, stop:Function}} buffer  fichier décodé, ou lecteur procédural
   * @param {object} opts
   * @param {boolean} [opts.loop]
   * @param {"hrtf"|"stereo"|"off"} [opts.panning]
   * @param {AudioNode} [opts.bus]       destination sèche (bus spatial par défaut)
   * @param {number} [opts.rate]         vitesse de lecture (hauteur)
   * @param {Function} [opts.onEnded]
   */
  constructor(out, buffer, { loop = true, panning = "hrtf", bus = null, rate = 1, onEnded = null } = {}) {
    const ctx = out.ctx;
    this.out = out;
    this.loop = loop;
    this.ended = false;

    // Lecteur procédural : sa sortie remplace la lecture d'un fichier
    this.player = buffer instanceof AudioBuffer ? null : buffer;
    if (this.player) {
      this.source = this.player.output;
    } else {
      this.source = ctx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = loop;
      this.source.playbackRate.value = rate;
    }

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.5;
    this.filter.frequency.value = 20000;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;

    if (panning === "hrtf") {
      this.panner = ctx.createPanner();
      this.panner.panningModel = "HRTF";
      // Vesper calcule lui-même l'atténuation : le panner ne sert qu'à la direction
      this.panner.distanceModel = "linear";
      this.panner.rolloffFactor = 0;
      this.panner.refDistance = 1;
      this.panner.maxDistance = 10000;
    } else if (panning === "stereo") {
      this.panner = ctx.createStereoPanner();
    } else {
      this.panner = null;
    }

    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.send.gain.value = 0;

    this.source.connect(this.filter);
    this.filter.connect(this.gain);
    const post = this.panner ?? this.gain;
    if (this.panner) this.gain.connect(this.panner);
    post.connect(this.dry);
    post.connect(this.send);
    this.dry.connect(bus ?? out.spatialBus);
    this.send.connect(out.reverb.input);

    if (!this.player) {
      this.source.onended = () => {
        this.ended = true;
        this.#disconnect();
        onEnded?.(this);
      };
    }
  }

  /** Démarre la lecture (une boucle commence à un endroit au hasard : deux sources identiques ne sonnent pas en phase). */
  start(when = 0, offset = null) {
    if (this.player) return this;
    const dur = this.source.buffer?.duration ?? 0;
    const off = offset ?? (this.loop && dur > 1 ? Math.random() * dur : 0);
    this.source.start(when || this.out.now, off);
    return this;
  }

  /**
   * Met à jour la voix.
   * @param {object} p
   * @param {number} p.gain       volume linéaire
   * @param {number} p.cutoff     coupure du passe-bas (Hz)
   * @param {number} p.send       niveau envoyé à la réverbération
   * @param {{x:number,y:number,z:number,pan:number}} [p.dir]
   * @param {number} [p.smooth]   constante de temps (s)
   */
  set({ gain, cutoff, send, dir, smooth = SMOOTH }) {
    if (this.ended) return;
    const t = this.out.now;
    if (gain !== undefined) this.gain.gain.setTargetAtTime(gain, t, smooth);
    if (cutoff !== undefined) this.filter.frequency.setTargetAtTime(Math.min(20000, Math.max(60, cutoff)), t, smooth);
    if (send !== undefined) this.send.gain.setTargetAtTime(send, t, smooth);
    if (dir && this.panner) {
      if (this.panner.pan) this.panner.pan.setTargetAtTime(dir.pan, t, smooth);
      else if (this.panner.positionX) {
        this.panner.positionX.setTargetAtTime(dir.x, t, smooth);
        this.panner.positionY.setTargetAtTime(dir.y, t, smooth);
        this.panner.positionZ.setTargetAtTime(dir.z, t, smooth);
      } else this.panner.setPosition?.(dir.x, dir.y, dir.z);
    }
  }

  /** Coupe la voix en fondu, puis la libère. */
  stop(fade = 0.4) {
    if (this.ended) return;
    const t = this.out.now;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, Math.max(0.01, fade / 4));
    if (this.player) {
      // Le lecteur procédural n'a pas de fin : on l'arrête après le fondu
      const player = this.player;
      setTimeout(() => {
        player.stop();
        this.#disconnect();
      }, (fade + 0.1) * 1000);
    } else {
      try {
        this.source.stop(t + fade + 0.05);
      } catch {
        this.#disconnect();
      }
    }
    this.ended = true;
  }

  #disconnect() {
    for (const n of [this.source, this.filter, this.gain, this.panner, this.dry, this.send]) {
      try {
        n?.disconnect();
      } catch {
        /* déjà débranché */
      }
    }
  }
}
