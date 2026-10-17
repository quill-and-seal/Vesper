/**
 * Couches générées : aucun fichier à fournir. Elles réagissent en direct à une intensité (0 à 1) :
 * la force du vent d'Ember, l'intensité de la pluie, la tension réglée par le MJ.
 *
 *   wind      : vent qui souffle en rafales (bruit filtré, filtre et volume modulés lentement)
 *   rain      : pluie (souffle aigu + crépitement + grondement quand elle est forte)
 *   drone     : nappe grave inquiétante, de plus en plus dissonante avec la tension
 *   heartbeat : battement de cœur qui accélère avec la tension
 */

export const SYNTH_TYPES = ["wind", "rain", "drone", "heartbeat"];

const noiseBuffers = new WeakMap();

/** Bruit blanc de 4 s en boucle (partagé). */
function noiseBuffer(ctx) {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    const len = ctx.sampleRate * 4;
    b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    noiseBuffers.set(ctx, b);
  }
  return b;
}

function noise(ctx) {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  n.start(0, Math.random() * 4);
  return n;
}

/** Oscillateur très lent qui module un paramètre autour de sa valeur. */
function lfo(ctx, freq, depth, target) {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
  return [o, g];
}

class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.nodes = [];
    this.intensity = 0.5;
  }

  keep(...nodes) {
    this.nodes.push(...nodes.flat());
    return nodes[0];
  }

  setIntensity(v) {
    this.intensity = Math.min(1, Math.max(0, v));
  }

  stop() {
    clearInterval(this.timer);
    for (const n of this.nodes) {
      try {
        n.stop?.();
      } catch {
        /* déjà arrêté */
      }
      try {
        n.disconnect();
      } catch {
        /* déjà débranché */
      }
    }
    try {
      this.output.disconnect();
    } catch {
      /* déjà débranché */
    }
  }
}

class Wind extends Synth {
  constructor(ctx) {
    super(ctx);
    const src = this.keep(noise(ctx));
    this.band = this.keep(ctx.createBiquadFilter());
    this.band.type = "bandpass";
    this.band.Q.value = 0.9;
    this.band.frequency.value = 450;
    this.low = this.keep(ctx.createBiquadFilter());
    this.low.type = "lowpass";
    this.low.frequency.value = 2200;
    this.gust = this.keep(ctx.createGain());
    this.gust.gain.value = 0.6;
    src.connect(this.band).connect(this.low).connect(this.gust).connect(this.output);
    // Rafales : deux oscillations lentes non synchronisées sur le filtre et le volume
    this.keep(lfo(ctx, 0.071, 260, this.band.frequency), lfo(ctx, 0.113, 140, this.band.frequency));
    this.keep(lfo(ctx, 0.053, 0.3, this.gust.gain), lfo(ctx, 0.17, 0.12, this.gust.gain));
    this.setIntensity(0.5);
  }

  setIntensity(v) {
    super.setIntensity(v);
    const t = this.ctx.currentTime;
    const i = this.intensity;
    this.band.frequency.setTargetAtTime(300 + 700 * i, t, 1.5);
    this.low.frequency.setTargetAtTime(1200 + 4000 * i, t, 1.5);
    this.output.gain.setTargetAtTime(0.5 + 1.2 * i, t, 1.5);
  }
}

class Rain extends Synth {
  constructor(ctx) {
    super(ctx);
    // Souffle : la nappe de pluie
    const a = this.keep(noise(ctx));
    const hp = this.keep(ctx.createBiquadFilter());
    hp.type = "highpass";
    hp.frequency.value = 500;
    this.lp = this.keep(ctx.createBiquadFilter());
    this.lp.type = "lowpass";
    this.lp.frequency.value = 7000;
    this.hiss = this.keep(ctx.createGain());
    a.connect(hp).connect(this.lp).connect(this.hiss).connect(this.output);
    // Crépitement : bande aiguë dont le volume tremble vite
    const b = this.keep(noise(ctx));
    const bp = this.keep(ctx.createBiquadFilter());
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 1.4;
    this.patter = this.keep(ctx.createGain());
    this.patter.gain.value = 0.3;
    b.connect(bp).connect(this.patter).connect(this.output);
    this.keep(lfo(ctx, 7.3, 0.15, this.patter.gain), lfo(ctx, 11.9, 0.1, this.patter.gain));
    // Grondement de la pluie forte
    const c = this.keep(noise(ctx));
    const rl = this.keep(ctx.createBiquadFilter());
    rl.type = "lowpass";
    rl.frequency.value = 220;
    this.rumble = this.keep(ctx.createGain());
    c.connect(rl).connect(this.rumble).connect(this.output);
    this.setIntensity(0.5);
  }

  setIntensity(v) {
    super.setIntensity(v);
    const t = this.ctx.currentTime;
    const i = this.intensity;
    this.hiss.gain.setTargetAtTime(0.15 + 0.5 * i, t, 2);
    this.lp.frequency.setTargetAtTime(4000 + 6000 * i, t, 2);
    this.patter.gain.setTargetAtTime(0.1 + 0.35 * i, t, 2);
    this.rumble.gain.setTargetAtTime(Math.max(0, i - 0.4) * 1.6, t, 2);
  }
}

class Drone extends Synth {
  constructor(ctx) {
    super(ctx);
    this.lp = this.keep(ctx.createBiquadFilter());
    this.lp.type = "lowpass";
    this.lp.frequency.value = 280;
    this.lp.Q.value = 2;
    this.lp.connect(this.output);
    // Fondamentale, quinte, puis seconde mineure qui monte avec la tension
    this.oscs = [
      [55, "sawtooth", 0.35],
      [55.35, "sawtooth", 0.35],
      [82.4, "triangle", 0.25],
      [58.27, "sawtooth", 0]
    ].map(([f, type, g]) => {
      const o = this.keep(ctx.createOscillator());
      o.type = type;
      o.frequency.value = f;
      const gain = this.keep(ctx.createGain());
      gain.gain.value = g;
      o.connect(gain).connect(this.lp);
      o.start();
      return { o, gain };
    });
    this.keep(lfo(ctx, 0.05, 120, this.lp.frequency));
    this.setIntensity(0.3);
  }

  setIntensity(v) {
    super.setIntensity(v);
    const t = this.ctx.currentTime;
    const i = this.intensity;
    this.oscs[3].gain.gain.setTargetAtTime(0.3 * i, t, 3);
    this.oscs[1].o.frequency.setTargetAtTime(55.35 + 1.2 * i, t, 3); // battement plus rapide
    this.lp.frequency.setTargetAtTime(220 + 500 * i, t, 3);
    this.output.gain.setTargetAtTime(0.25 + 0.5 * i, t, 3);
  }
}

class Heartbeat extends Synth {
  constructor(ctx) {
    super(ctx);
    this.lp = this.keep(ctx.createBiquadFilter());
    this.lp.type = "lowpass";
    this.lp.frequency.value = 160;
    this.lp.connect(this.output);
    this.next = ctx.currentTime + 0.1;
    this.setIntensity(0.5);
    // Programmation en avance (le minuteur de la page n'est pas précis, l'horloge audio l'est)
    this.timer = setInterval(() => this.#schedule(), 100);
  }

  #thump(at, amp) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(38, at + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    o.connect(g).connect(this.lp);
    o.start(at);
    o.stop(at + 0.25);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  #schedule() {
    const ctx = this.ctx;
    const bpm = 58 + 62 * this.intensity;
    const period = 60 / bpm;
    while (this.next < ctx.currentTime + 0.3) {
      if (this.next > ctx.currentTime) {
        this.#thump(this.next, 0.9);
        this.#thump(this.next + period * 0.28, 0.6);
      }
      this.next += period;
    }
  }
}

const CLASSES = { wind: Wind, rain: Rain, drone: Drone, heartbeat: Heartbeat };

/** Crée une couche générée. */
export function createSynth(ctx, type) {
  const C = CLASSES[type] ?? Wind;
  return new C(ctx);
}
