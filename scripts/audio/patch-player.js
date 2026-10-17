/**
 * Joue une recette procédurale (voir patches.js) avec le Web Audio.
 *
 * Tout est calculé en direct : aucune boucle ne se répète, le feu ne crépite jamais deux fois pareil.
 * Les événements et les modulations sont programmés un peu en avance sur l'horloge audio
 * (le minuteur de la page n'est pas précis, l'horloge audio l'est).
 */

import { dbToGain } from "../constants.js";
import { pval, nextInterval, eventAmp } from "../patches.js";

/** Avance de programmation (s). */
const LOOKAHEAD = 0.4;
/** Pas des modulations régulières (s). */
const LFO_STEP = 0.05;

/* -------------------------------------------- */
/*  Bruits (partagés par contexte)              */
/* -------------------------------------------- */

const noiseCache = new WeakMap();

function noiseBuffer(ctx, color) {
  let byColor = noiseCache.get(ctx);
  if (!byColor) noiseCache.set(ctx, (byColor = {}));
  if (byColor[color]) return byColor[color];
  const len = ctx.sampleRate * 4;
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    if (color === "pink") {
      // Filtre de Paul Kellet : -3 dB par octave (pluie lointaine, cascade, rivière)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (color === "brown") {
      // Marche aléatoire : -6 dB par octave (grondement, tonnerre lointain)
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
  }
  byColor[color] = b;
  return b;
}

/* -------------------------------------------- */
/*  Lecteur                                     */
/* -------------------------------------------- */

export class PatchPlayer {
  /**
   * @param {BaseAudioContext} ctx
   * @param {object} patch       recette normalisée
   * @param {object} [opts]
   * @param {boolean} [opts.timers]  false : rendu hors ligne, on appelle schedule() soi-même
   * @param {() => number} [opts.random]
   */
  constructor(ctx, patch, { timers = true, random = Math.random } = {}) {
    this.ctx = ctx;
    this.patch = patch;
    this.rand = random;
    this.intensity = patch?.fixed ?? 0.5;
    this.output = ctx.createGain();
    this.output.gain.value = dbToGain(Number(patch?.volume) || 0);
    this.nodes = [];
    this.layers = (patch?.layers ?? []).filter((l) => !l.mute).map((l) => this.#build(l));
    this.stopped = false;
    this.#apply(true);
    if (timers) this.timer = setInterval(() => this.schedule(this.ctx.currentTime + LOOKAHEAD), 100);
  }

  /** Pour les couches générées du paysage sonore (même interface que les anciennes). */
  setIntensity(v) {
    const i = Math.min(1, Math.max(0, Number(v) || 0));
    if (Math.abs(i - this.intensity) < 0.002) return;
    this.intensity = i;
    this.#apply(false);
  }

  #keep(node) {
    this.nodes.push(node);
    return node;
  }

  #build(layer) {
    const ctx = this.ctx;
    const rt = { layer, filters: [], mods: [], src: null, osc: null, nextEvent: ctx.currentTime + 0.02 + this.rand() * 0.2 };
    rt.gain = this.#keep(ctx.createGain());
    rt.gain.gain.value = 0;
    rt.panner = ctx.createStereoPanner ? this.#keep(ctx.createStereoPanner()) : null;

    // Entrée de la chaîne de filtres
    let head = null;
    let tail = null;
    for (const f of layer.filters) {
      const node = this.#keep(ctx.createBiquadFilter());
      node.type = f.type;
      if (f.type === "peaking") node.gain.value = pval(f.gain, this.intensity);
      if (!head) head = node;
      else tail.connect(node);
      tail = node;
      rt.filters.push(node);
    }
    rt.input = head ?? rt.gain;
    if (tail) tail.connect(rt.gain);
    if (rt.panner) rt.gain.connect(rt.panner).connect(this.output);
    else rt.gain.connect(this.output);

    const s = layer.source;
    if (s.type === "noise") {
      const n = this.#keep(ctx.createBufferSource());
      n.buffer = noiseBuffer(ctx, s.color);
      n.loop = true;
      n.connect(rt.input);
      n.start(0, this.rand() * 4);
      rt.src = n;
    } else if (s.type === "osc") {
      const o = this.#keep(ctx.createOscillator());
      o.type = s.wave;
      o.connect(rt.input);
      o.start();
      rt.osc = o;
    }
    // Les événements sont créés à la volée dans schedule()

    rt.mods = layer.mods.map((m) => ({ ...m, value: 0, next: ctx.currentTime, phase: this.rand() * Math.PI * 2 }));
    return rt;
  }

  /** Paramètre audio d'une couche visé par une modulation. */
  #param(rt, target) {
    if (target === "gain") return rt.gain.gain;
    if (target === "pan") return rt.panner?.pan ?? null;
    if (target === "source.freq") return rt.osc?.frequency ?? null;
    const m = /^filters\.(\d+)\.(freq|q)$/.exec(target);
    if (m) {
      const f = rt.filters[Number(m[1])];
      return f ? (m[2] === "freq" ? f.frequency : f.Q) : null;
    }
    return null;
  }

  /** Valeur de base d'un paramètre (sans modulation). */
  #base(rt, target) {
    const l = rt.layer;
    const i = this.intensity;
    if (target === "gain") return pval(l.gain, i);
    if (target === "pan") return pval(l.pan, i);
    if (target === "source.freq") return pval(l.source.freq, i);
    if (target === "source.rate") return pval(l.source.rate, i);
    const m = /^filters\.(\d+)\.(freq|q)$/.exec(target);
    if (m) {
      const f = l.filters[Number(m[1])];
      return f ? pval(m[2] === "freq" ? f.freq : f.q, i) : 0;
    }
    return 0;
  }

  /** Facteur de modulation actuel d'un paramètre (produit de ses modulations). */
  #factor(rt, target) {
    let k = 1;
    for (const m of rt.mods) if (m.target === target) k *= 1 + m.value * pval(m.depth, this.intensity);
    return k;
  }

  /** Applique les valeurs de base (intensité changée, ou démarrage). */
  #apply(initial) {
    const t = this.ctx.currentTime;
    for (const rt of this.layers) {
      for (const target of ["gain", "pan", "source.freq", ...rt.filters.flatMap((_, i) => [`filters.${i}.freq`, `filters.${i}.q`])]) {
        const p = this.#param(rt, target);
        if (!p) continue;
        let v = this.#base(rt, target) * this.#factor(rt, target);
        if (target === "pan") v = Math.max(-1, Math.min(1, this.#base(rt, target) + (this.#factor(rt, target) - 1)));
        if (initial && target !== "gain") p.value = v;
        else p.setTargetAtTime(v, t, initial ? 0.15 : 0.6);
      }
    }
  }

  /* -------------------------------------------- */
  /*  Programmation                               */
  /* -------------------------------------------- */

  /** Programme modulations et événements jusqu'à l'heure audio « until ». */
  schedule(until) {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    for (const rt of this.layers) {
      this.#scheduleMods(rt, now, until);
      if (rt.layer.source.type === "events") this.#scheduleEvents(rt, now, until);
    }
  }

  #scheduleMods(rt, now, until) {
    if (!rt.mods.length) return;
    const i = this.intensity;
    // Avance chaque modulation et repère les instants où une valeur change
    const times = new Set();
    for (const m of rt.mods) {
      const rate = pval(m.rate, i);
      while (m.next < until) {
        const at = Math.max(now, m.next);
        if (m.kind === "lfo") {
          m.value = Math.sin(m.phase + 2 * Math.PI * rate * at);
          m.next = at + LFO_STEP;
        } else {
          // Vacillement : nouvelle cible au hasard, à intervalles irréguliers
          m.value = this.rand() * 2 - 1;
          m.next = at + nextInterval(rate, 0.35, this.rand());
        }
        m.pending ??= [];
        m.pending.push([at, m.value]);
        times.add(at);
      }
    }
    // Écrit les paramètres audio aux instants repérés
    const sorted = [...times].sort((a, b) => a - b);
    const targets = new Set(rt.mods.map((m) => m.target));
    const values = new Map(rt.mods.map((m) => [m, m.pending?.[0]?.[1] ?? m.value]));
    for (const at of sorted) {
      for (const m of rt.mods) {
        while (m.pending?.length && m.pending[0][0] <= at) values.set(m, m.pending.shift()[1]);
      }
      for (const target of targets) {
        if (target === "source.rate") continue;
        const p = this.#param(rt, target);
        if (!p) continue;
        let k = 1;
        let tc = LFO_STEP;
        for (const m of rt.mods) {
          if (m.target !== target) continue;
          k *= 1 + values.get(m) * pval(m.depth, i);
          if (m.kind === "jitter") tc = Math.max(tc, 0.35 / Math.max(0.05, pval(m.rate, i)));
        }
        const base = this.#base(rt, target);
        const v = target === "pan" ? Math.max(-1, Math.min(1, base + (k - 1))) : Math.max(0, base * k);
        p.setTargetAtTime(v, at, tc * 0.5);
      }
    }
    // Valeur courante, pour la cadence des événements
    for (const m of rt.mods) m.value = values.get(m);
  }

  #scheduleEvents(rt, now, until) {
    const s = rt.layer.source;
    const i = this.intensity;
    if (rt.nextEvent < now) rt.nextEvent = now;
    // Sécurité : jamais plus de 200 événements programmés d'un coup
    let guard = 200;
    while (rt.nextEvent < until && guard-- > 0) {
      const at = rt.nextEvent;
      const burst = this.rand() < pval(s.burstChance, i);
      const count = burst ? s.burstMin + Math.floor(this.rand() * (s.burstMax - s.burstMin + 1)) : 1;
      let t = at;
      for (let k = 0; k < count; k++) {
        this.#event(rt, t, burst ? 0.85 : 1);
        t += pval(s.burstGap, i) * (0.6 + 0.8 * this.rand() * (1 - pval(s.regularity, i)) + 0.4 * pval(s.regularity, i));
      }
      const rate = pval(s.rate, i) * this.#factor(rt, "source.rate");
      rt.nextEvent = at + nextInterval(rate, pval(s.regularity, i), this.rand());
    }
  }

  /** Un événement : grain de bruit filtré (éclat, goutte) ou note brève (grillon, battement, bulle). */
  #event(rt, at, scale) {
    const ctx = this.ctx;
    const s = rt.layer.source;
    const i = this.intensity;
    const fMin = pval(s.freqMin, i);
    const fMax = pval(s.freqMax, i);
    const freq = fMin + (fMax - fMin) * this.rand();
    const amp = eventAmp(pval(s.ampMin, i), pval(s.ampMax, i), pval(s.skew, i), this.rand()) * scale;
    const decay = Math.max(0.0001, pval(s.decay, i) / 1000) * (0.7 + 0.6 * this.rand());
    const end = at + decay * 10 + 0.005;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(amp, at + Math.min(0.002, decay * 0.3));
    env.gain.setTargetAtTime(0, at + Math.min(0.002, decay * 0.3), decay);

    const made = [env];
    let out = env;
    const spread = pval(s.spread, i);
    if (spread > 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = (this.rand() * 2 - 1) * spread;
      env.connect(p);
      out = p;
      made.push(p);
    }
    out.connect(rt.input);

    const drop = pval(s.drop, i);
    const ring = pval(s.ring, i);
    let last = null;
    if (s.grain === "noise") {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, "white");
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = pval(s.q, i);
      n.connect(bp).connect(env);
      n.start(at, this.rand() * 3.5);
      n.stop(end);
      made.push(n, bp);
      last = n;
    }
    if (s.grain === "tone" || ring > 0) {
      // Note brève, dont la hauteur glisse (drop < 1 : descend, comme un battement ; > 1 : monte, comme une goutte)
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, at);
      if (Math.abs(drop - 1) > 0.01) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * drop), at + decay * 3);
      const g = ctx.createGain();
      g.gain.value = s.grain === "tone" ? 1 : ring * 0.6;
      o.connect(g).connect(env);
      o.start(at);
      o.stop(end);
      made.push(o, g);
      last = o;
    }
    if (last) {
      last.onended = () => {
        for (const n of made) {
          try {
            n.disconnect();
          } catch {
            /* déjà débranché */
          }
        }
      };
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
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
