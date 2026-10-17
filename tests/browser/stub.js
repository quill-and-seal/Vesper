/**
 * Faux Foundry minimal pour faire tourner Vesper dans un navigateur sans Foundry.
 * Juste ce que le module utilise ; tout est observable depuis le test (window.T).
 */

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  once(name, fn) {
    this.on(name, fn);
  },
  async call(name, ...args) {
    for (const fn of hooks.get(name) ?? []) await fn(...args);
  }
};

const settings = new Map();
const ctx = new AudioContext();

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function makeFlagged(obj) {
  obj.flags ??= {};
  obj.getFlag = (mod, key) => getPath(obj.flags, `${mod}.${key}`);
  obj.setFlag = async (mod, key, value) => {
    obj.flags[mod] ??= {};
    obj.flags[mod][key] = structuredClone(value);
    await Hooks.call("updateScene", obj, { flags: { [mod]: { [key]: value } } });
  };
  return obj;
}

globalThis.foundry = {
  utils: {
    randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "x"),
    deepClone: (o) => structuredClone(o),
    hasProperty: (o, p) => getPath(o, p) !== undefined,
    getProperty: (o, p) => getPath(o, p),
    setProperty: (o, p, v) => {
      const parts = p.split(".");
      let x = o;
      parts.slice(0, -1).forEach((k) => (x = x[k] ??= {}));
      x[parts.at(-1)] = v;
      return true;
    },
    expandObject: (flat) => {
      const out = {};
      for (const [k, v] of Object.entries(flat)) {
        const parts = k.split(".");
        let o = out;
        parts.slice(0, -1).forEach((p) => (o = o[p] ??= {}));
        o[parts.at(-1)] = v;
      }
      return out;
    }
  },
  data: {
    regionBehaviors: { RegionBehaviorType: class {} },
    fields: new Proxy({}, { get: () => class { constructor(o) { this.o = o; } } })
  },
  audio: { AudioHelper: { inputToVolume: (v) => Math.pow(v, 1.5) } },
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        async render() {
          if (!this.element) {
            this.element = document.createElement("form");
            this.element.innerHTML = `<section class="window-content"></section>`;
            document.body.append(this.element);
            const opts = this.constructor.DEFAULT_OPTIONS ?? {};
            // Comme ApplicationV2 : boutons data-action et soumission du formulaire à chaque changement
            this.element.addEventListener("click", (ev) => {
              const target = ev.target.closest("[data-action]");
              const fn = target && opts.actions?.[target.dataset.action];
              if (fn) {
                ev.preventDefault();
                this.lastAction = fn.call(this, ev, target);
              }
            });
            this.element.addEventListener("change", (ev) => {
              if (!opts.form?.submitOnChange) return;
              const object = {};
              for (const el of this.element.querySelectorAll("[name]")) {
                if (el.disabled) continue;
                if (el.type === "checkbox") object[el.name] = el.checked;
                else if (el.type === "number" || el.type === "range") object[el.name] = el.value === "" ? null : Number(el.value);
                else object[el.name] = el.value;
              }
              this.lastSubmit = opts.form.handler.call(this, ev, this.element, { object });
            });
            this._onFirstRender?.({}, {});
          }
          const content = this.element.querySelector(".window-content");
          const html = await this._renderHTML({}, {});
          this._replaceHTML(html, content, {});
          this._onRender?.({}, {});
          return this;
        }
        close() {
          this.element?.remove();
          this._onClose?.({});
        }
      }
    }
  }
};

class BaseAmbientSound {
  constructor(document) {
    this.document = document;
  }
  async sync(isAudible, volume, options) {
    this.lastSync = { isAudible, volume, options };
  }
}

globalThis.CONFIG = {
  AmbientSound: { objectClass: BaseAmbientSound },
  RegionBehavior: { dataModels: {}, typeIcons: {} }
};

const modules = new Map([
  ["vesper-audio", { active: true }],
  ["ember-particles", { active: true }]
]);

const listeners = [{ x: 0, y: 0, elevation: 0 }];

globalThis.game = {
  user: { isGM: true },
  modules: { get: (id) => modules.get(id) },
  settings: {
    register(mod, key, cfg) {
      settings.set(`${mod}.${key}`, { ...cfg, value: cfg.default });
    },
    get(mod, key) {
      if (mod === "core" && key === "globalAmbientVolume") return 1;
      const s = settings.get(`${mod}.${key}`);
      if (!s) throw new Error(`setting ${mod}.${key}`);
      return s.value;
    },
    async set(mod, key, value) {
      const s = settings.get(`${mod}.${key}`);
      s.value = value;
      s.onChange?.(value);
    }
  },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
  socket: { on() {}, emit(...a) { (globalThis.T.emitted ??= []).push(a); } },
  time: {
    get serverTime() {
      return Date.now();
    }
  },
  combats: [],
  audio: { environment: ctx, locked: false }
};

const scene = makeFlagged({
  id: "scene1",
  name: "Test",
  grid: { units: "m" },
  environment: { darknessLevel: 0 },
  sounds: [],
  regions: []
});

globalThis.canvas = {
  ready: true,
  scene,
  dimensions: { size: 100, distance: 1.5, distancePixels: 100 / 1.5 },
  walls: { placeables: [] },
  sounds: { getListenerPositions: () => listeners.map((l) => ({ ...l })), refresh() {} },
  tokens: { controlled: [] },
  stage: { pivot: { x: 0, y: 0 } },
  environment: { darknessLevel: 0 },
  app: { ticker: { add() {}, remove() {} } }
};

globalThis.ui = { notifications: { info() {}, warn() {} } };

/** Outils du test. */
globalThis.T = {
  ctx,
  listeners,
  scene,
  makeSound(id, x, y, extra = {}) {
    const doc = makeFlagged({
      id,
      path: "/tests/browser/noise.wav",
      x,
      y,
      radius: 15, // en mètres : 15 × 66,7 px = 1000 px
      easing: true,
      walls: true,
      volume: 1,
      repeat: true,
      hidden: false,
      darkness: { min: 0, max: 1 },
      elevation: 0,
      ...extra
    });
    doc.parent = scene;
    doc.object = { radius: doc.radius * canvas.dimensions.distancePixels, isAudible: true };
    scene.sounds.push(doc);
    return doc;
  },
  wall(x1, y1, x2, y2, extra = {}) {
    const w = { document: { id: `w${canvas.walls.placeables.length}`, c: [x1, y1, x2, y2], sound: 20, door: 0, ds: 0, ...extra } };
    canvas.walls.placeables.push(w);
    return w;
  },
  region(x1, y1, x2, y2, system) {
    const r = {
      id: `r${scene.regions.length}`,
      behaviors: { contents: [{ id: "b", type: "vesper-audio.acoustics", disabled: false, system }] },
      testPoint: (p) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2,
      polygons: [{ points: [x1, y1, x2, y1, x2, y2, x1, y2] }]
    };
    scene.regions.push(r);
    return r;
  },
  hooks
};
