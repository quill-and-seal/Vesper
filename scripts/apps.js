/**
 * Fenêtres de Vesper (ApplicationV2, sans template Handlebars, comme Ember) :
 *   - SoundscapeConfig : paysage sonore de la scène (couches, tension, lieu par défaut)
 *   - champs ajoutés à la fenêtre d'un son d'ambiance de Foundry
 */

import { MODULE_ID, FLAG_ACOUSTICS, FLAG_SOUND, SOUND_DEFAULTS, LAYER_DEFAULTS, t, esc } from "./constants.js";
import { REVERB_PRESETS } from "./audio/reverb-presets.js";
import { SYNTH_TYPES } from "./audio/synth.js";
import { readSoundscape, writeSoundscape } from "./soundscape.js";
import { readSceneAcoustics, emberActive } from "./world.js";
import { soundSettings } from "./spatial-engine.js";

const { ApplicationV2 } = foundry.applications.api;

/** Fenêtres ouvertes, rafraîchies quand la scène change. */
export const openApps = new Set();

function options(values, selected, prefix) {
  return values.map((v) => `<option value="${v}" ${v === selected ? "selected" : ""}>${esc(t(`${prefix}.${v}`))}</option>`).join("");
}

function newId() {
  return foundry.utils.randomID(12);
}

/** Modèles de paysages : la structure est prête, il reste à choisir ses fichiers. */
export const TEMPLATES = {
  forest: () => [
    { label: t("Template.Layer.Wind"), kind: "synth", synth: "wind", volume: -20 },
    { label: t("Template.Layer.Birds"), kind: "scatter", volume: -14, when: { time: "day" }, scatter: { min: 4, max: 14 } },
    { label: t("Template.Layer.NightCritters"), kind: "scatter", volume: -16, when: { time: "night" }, scatter: { min: 6, max: 20 } },
    { label: t("Template.Layer.Dread"), kind: "synth", synth: "drone", volume: -22, outdoor: false, when: { tensionMin: 2 } }
  ],
  storm: () => [
    { label: t("Template.Layer.Rain"), kind: "synth", synth: "rain", volume: -10 },
    { label: t("Template.Layer.Wind"), kind: "synth", synth: "wind", volume: -16 },
    { label: t("Template.Layer.Thunder"), kind: "scatter", volume: -6, scatter: { min: 12, max: 45, distance: 0.7, spread: 1, pitch: 0.1 } }
  ],
  tavern: () => [
    { label: t("Template.Layer.Crowd"), kind: "loop", volume: -14, outdoor: false, when: { place: "inside" } },
    { label: t("Template.Layer.Mugs"), kind: "scatter", volume: -16, outdoor: false, when: { place: "inside" }, scatter: { min: 3, max: 10, distance: 0.3 } },
    { label: t("Template.Layer.Rain"), kind: "synth", synth: "rain", volume: -12, when: { weather: "rain" } }
  ],
  dungeon: () => [
    { label: t("Template.Layer.Dread"), kind: "synth", synth: "drone", volume: -24, outdoor: false },
    { label: t("Template.Layer.Drips"), kind: "scatter", volume: -18, outdoor: false, scatter: { min: 2, max: 9, distance: 0.5 } },
    { label: t("Template.Layer.Distant"), kind: "scatter", volume: -16, outdoor: false, when: { tensionMin: 1 }, scatter: { min: 15, max: 40, distance: 0.9 } },
    { label: t("Template.Layer.Heart"), kind: "synth", synth: "heartbeat", volume: -14, outdoor: false, when: { tensionMin: 2 } }
  ]
};

function makeLayer(data) {
  return {
    ...foundry.utils.deepClone(LAYER_DEFAULTS),
    ...data,
    id: newId(),
    when: { ...LAYER_DEFAULTS.when, ...(data.when ?? {}) },
    scatter: { ...LAYER_DEFAULTS.scatter, ...(data.scatter ?? {}) }
  };
}

/* ============================================ */
/*  Paysage sonore de la scène                  */
/* ============================================ */

export class SoundscapeConfig extends ApplicationV2 {
  constructor(engine, options = {}) {
    super({ id: `${MODULE_ID}-soundscape`, ...options });
    this.engine = engine;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["vesper", "vesper-soundscape"],
    window: { icon: "fa-solid fa-ear-listen", resizable: true },
    position: { width: 620, height: 720 },
    form: { handler: SoundscapeConfig.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      addLayer: SoundscapeConfig.#onAddLayer,
      removeLayer: SoundscapeConfig.#onRemoveLayer,
      duplicateLayer: SoundscapeConfig.#onDuplicateLayer,
      moveLayer: SoundscapeConfig.#onMoveLayer,
      pickFile: SoundscapeConfig.#onPickFile,
      tension: SoundscapeConfig.#onTension
    }
  };

  get title() {
    return t("Soundscape.Title", { scene: canvas.scene?.name ?? "" });
  }

  async _renderHTML() {
    const div = document.createElement("div");
    div.className = "vesper-body";
    div.innerHTML = this.#html();
    return div;
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".vesper-layers")?.scrollTop ?? 0;
    content.replaceChildren(result);
    const list = content.querySelector(".vesper-layers");
    if (list) list.scrollTop = scroll;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    openApps.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    openApps.delete(this);
  }

  /** La scène a changé : on redessine (sauf pendant une saisie). */
  onSceneChanged() {
    if (this.element?.contains(document.activeElement) && document.activeElement.matches("input[type=text], textarea")) return;
    this.render();
  }

  #stateLine() {
    const s = this.engine.soundscape.state;
    const place = this.engine.spatial.listenerPlace;
    if (!s) return "";
    const chips = [
      [s.night ? "fa-moon" : "fa-sun", t(s.night ? "State.Night" : "State.Day")],
      ["fa-swords", t(s.combat ? "State.Combat" : "State.NoCombat")],
      ["fa-cloud", emberActive() ? t(`When.weather.${s.weather === "other" ? "any" : s.weather}`) : t("State.NoEmber")],
      [s.inside ? "fa-house" : "fa-tree", t(s.inside ? "State.Inside" : "State.Outside")],
      [REVERB_PRESETS[place?.place]?.icon ?? "fa-ear-listen", t(`Place.${place?.place ?? "none"}`)]
    ];
    return chips.map(([icon, label]) => `<span class="vesper-chip"><i class="fa-solid ${icon}"></i> ${esc(label)}</span>`).join("");
  }

  #html() {
    const data = readSoundscape();
    const acoustics = readSceneAcoustics();
    const tension = Number(data.tension) || 0;
    const places = Object.keys(REVERB_PRESETS);

    const tensionButtons = [0, 1, 2, 3]
      .map((n) => `<button type="button" class="vesper-tension-btn ${n === tension ? "active" : ""} t${n}" data-action="tension" data-value="${n}">${esc(t(`Tension.${n}`))}</button>`)
      .join("");

    const layers = data.layers.map((l, i) => this.#layerHtml(l, i, data.layers.length)).join("");

    return `
      <section class="vesper-head">
        <div class="vesper-state">${this.#stateLine()}</div>
        <div class="form-group">
          <label>${t("Soundscape.Tension")}</label>
          <div class="vesper-tension">${tensionButtons}</div>
        </div>
        <div class="vesper-row">
          <label class="checkbox"><input type="checkbox" name="enabled" ${data.enabled !== false ? "checked" : ""}> ${t("Soundscape.Enabled")}</label>
          <label>${t("Soundscape.Volume")} <input type="number" name="volume" value="${Number(data.volume) || 0}" min="-40" max="12" step="1" class="vesper-num"> dB</label>
        </div>
        <div class="form-group">
          <label>${t("Soundscape.DefaultPlace")}</label>
          <select name="acoustics.place">${options(places, acoustics.place, "Place")}</select>
          <input type="number" name="acoustics.wet" value="${acoustics.wet}" min="0" max="1" step="0.01" class="vesper-num" data-tooltip="${esc(t("Soundscape.Wet"))}">
        </div>
        <p class="notes">${t("Soundscape.DefaultPlaceHint")}</p>
      </section>

      <section class="vesper-layers">${layers || `<p class="vesper-empty">${t("Soundscape.Empty")}</p>`}</section>

      <footer class="vesper-foot">
        <button type="button" data-action="addLayer" data-kind="loop"><i class="fa-solid fa-repeat"></i> ${t("Kind.loop")}</button>
        <button type="button" data-action="addLayer" data-kind="scatter"><i class="fa-solid fa-shuffle"></i> ${t("Kind.scatter")}</button>
        <button type="button" data-action="addLayer" data-kind="synth"><i class="fa-solid fa-wave-square"></i> ${t("Kind.synth")}</button>
        <select class="vesper-template">
          <option value="">${t("Template.Choose")}</option>
          ${Object.keys(TEMPLATES).map((k) => `<option value="${k}">${esc(t(`Template.${k}`))}</option>`).join("")}
        </select>
      </footer>`;
  }

  #layerHtml(l, i, count) {
    const p = `layers.${i}`;
    const w = l.when;
    const s = l.scatter;
    const sel = (name, values, value, prefix) => `<select name="${p}.when.${name}">${options(values, value, prefix)}</select>`;
    const active = this.engine.soundscape.describe().layers.find((x) => x.id === l.id)?.active;

    const files =
      l.kind === "synth"
        ? `<div class="form-group"><label>${t("Layer.Synth")}</label><select name="${p}.synth">${options(SYNTH_TYPES, l.synth, "Synth")}</select></div>
           <p class="notes">${t(`Synth.${l.synth}Hint`)}</p>`
        : `<div class="form-group stacked">
             <label>${t(l.kind === "scatter" ? "Layer.FilesScatter" : "Layer.FilesLoop")}
               <button type="button" class="vesper-mini" data-action="pickFile" data-index="${i}"><i class="fa-solid fa-file-audio"></i> ${t("Layer.AddFile")}</button></label>
             <textarea name="${p}.paths" rows="${Math.max(2, Math.min(6, l.paths.length + 1))}" placeholder="${esc(t("Layer.FilesPlaceholder"))}">${esc(l.paths.join("\n"))}</textarea>
           </div>`;

    const scatter =
      l.kind === "scatter"
        ? `<div class="vesper-grid">
             <label>${t("Scatter.Min")}<input type="number" name="${p}.scatter.min" value="${s.min}" min="0.5" step="0.5"></label>
             <label>${t("Scatter.Max")}<input type="number" name="${p}.scatter.max" value="${s.max}" min="0.5" step="0.5"></label>
             <label>${t("Scatter.Spread")}<input type="range" name="${p}.scatter.spread" value="${s.spread}" min="0" max="1" step="0.05"></label>
             <label>${t("Scatter.Distance")}<input type="range" name="${p}.scatter.distance" value="${s.distance}" min="0" max="1" step="0.05"></label>
             <label>${t("Scatter.Pitch")}<input type="range" name="${p}.scatter.pitch" value="${s.pitch}" min="0" max="0.3" step="0.01"></label>
           </div>`
        : "";

    return `
      <fieldset class="vesper-layer ${active ? "is-active" : ""}" data-id="${l.id}">
        <input type="hidden" name="${p}.id" value="${l.id}">
        <input type="hidden" name="${p}.kind" value="${l.kind}">
        <legend>
          <i class="fa-solid ${l.kind === "loop" ? "fa-repeat" : l.kind === "scatter" ? "fa-shuffle" : "fa-wave-square"}"></i>
          <span class="vesper-dot" data-tooltip="${esc(t(active ? "Layer.Playing" : "Layer.Silent"))}"></span>
          <input type="text" name="${p}.label" value="${esc(l.label)}" placeholder="${esc(t(`Kind.${l.kind}`))}">
          <span class="vesper-tools">
            <a data-action="moveLayer" data-index="${i}" data-dir="-1" ${i === 0 ? "class=disabled" : ""} data-tooltip="${esc(t("Layer.Up"))}"><i class="fa-solid fa-arrow-up"></i></a>
            <a data-action="moveLayer" data-index="${i}" data-dir="1" ${i === count - 1 ? "class=disabled" : ""} data-tooltip="${esc(t("Layer.Down"))}"><i class="fa-solid fa-arrow-down"></i></a>
            <a data-action="duplicateLayer" data-index="${i}" data-tooltip="${esc(t("Layer.Duplicate"))}"><i class="fa-solid fa-copy"></i></a>
            <a data-action="removeLayer" data-index="${i}" data-tooltip="${esc(t("Layer.Remove"))}"><i class="fa-solid fa-trash"></i></a>
          </span>
        </legend>
        ${files}
        <div class="vesper-grid">
          <label>${t("Layer.Volume")}<span class="vesper-range"><input type="range" name="${p}.volume" value="${l.volume}" min="-48" max="6" step="1"><output>${l.volume} dB</output></span></label>
          <label>${t("Layer.Fade")}<input type="number" name="${p}.fade" value="${l.fade}" min="0" max="30" step="0.5"></label>
          <label class="checkbox" data-tooltip="${esc(t("Layer.OutdoorHint"))}"><input type="checkbox" name="${p}.outdoor" ${l.outdoor ? "checked" : ""}> ${t("Layer.Outdoor")}</label>
        </div>
        <div class="vesper-when">
          <span class="vesper-when-title">${t("When.Title")}</span>
          ${sel("time", ["any", "day", "night"], w.time, "When.time")}
          ${sel("combat", ["any", "yes", "no"], w.combat, "When.combat")}
          ${sel("weather", ["any", "clear", "rain", "storm", "snow", "fog"], w.weather, "When.weather")}
          ${sel("place", ["any", "outside", "inside"], w.place, "When.place")}
          <label class="vesper-tension-range">${t("When.Tension")}
            <select name="${p}.when.tensionMin">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${n === w.tensionMin ? "selected" : ""}>${esc(t(`Tension.${n}`))}</option>`).join("")}</select>
            →
            <select name="${p}.when.tensionMax">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${n === w.tensionMax ? "selected" : ""}>${esc(t(`Tension.${n}`))}</option>`).join("")}</select>
          </label>
        </div>
        ${scatter}
      </fieldset>`;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Affiche le volume pendant qu'on glisse le curseur
    for (const input of this.element.querySelectorAll(".vesper-range input")) {
      input.addEventListener("input", () => (input.nextElementSibling.textContent = `${input.value} dB`));
    }
    // Les modèles passent par un « change », pas un clic
    this.element.querySelector(".vesper-template")?.addEventListener("change", (ev) => {
      ev.stopPropagation();
      SoundscapeConfig.#applyTemplate.call(this, ev.currentTarget.value);
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Lit le formulaire en couches. */
  static #read(formData) {
    const obj = foundry.utils.expandObject(formData.object ?? formData);
    const raw = obj.layers ?? {};
    const layers = Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => {
        const l = raw[k];
        const paths = typeof l.paths === "string" ? l.paths.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined;
        const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const when = { ...l.when, tensionMin: num(l.when?.tensionMin, 0), tensionMax: num(l.when?.tensionMax, 3) };
        if (when.tensionMax < when.tensionMin) when.tensionMax = when.tensionMin;
        const out = { ...l, when, volume: num(l.volume, -12), fade: num(l.fade, 3), outdoor: !!l.outdoor };
        if (paths) out.paths = paths;
        if (l.scatter) out.scatter = Object.fromEntries(Object.entries(l.scatter).map(([k2, v]) => [k2, num(v, LAYER_DEFAULTS.scatter[k2])]));
        return out;
      });
    return { obj, layers };
  }

  static async #onSubmit(event, form, formData) {
    const { obj, layers } = SoundscapeConfig.#read(formData);
    const current = readSoundscape();
    // On garde ce que le formulaire ne montre pas (fichiers d'une couche générée, etc.)
    const merged = layers.map((l) => ({ ...(current.layers.find((c) => c.id === l.id) ?? {}), ...l }));
    await writeSoundscape({ enabled: !!obj.enabled, volume: Number(obj.volume) || 0, layers: merged });
    if (obj.acoustics) {
      const place = REVERB_PRESETS[obj.acoustics.place] ? obj.acoustics.place : "outdoor";
      const prev = readSceneAcoustics();
      // Changer de lieu reprend le niveau conseillé de ce lieu
      const wet = place !== prev.place ? REVERB_PRESETS[place].wet : Math.min(1, Math.max(0, Number(obj.acoustics.wet) || 0));
      await canvas.scene.setFlag(MODULE_ID, FLAG_ACOUSTICS, { place, wet });
    }
  }

  async #mutate(fn) {
    const data = readSoundscape();
    const layers = foundry.utils.deepClone(data.layers);
    fn(layers);
    await writeSoundscape({ layers });
  }

  static async #onAddLayer(event, target) {
    const kind = target.dataset.kind;
    await this.#mutate((layers) => layers.push(makeLayer({ kind, label: "", synth: kind === "synth" ? "wind" : LAYER_DEFAULTS.synth })));
  }

  static async #onRemoveLayer(event, target) {
    const i = Number(target.dataset.index);
    await this.#mutate((layers) => layers.splice(i, 1));
  }

  static async #onDuplicateLayer(event, target) {
    const i = Number(target.dataset.index);
    await this.#mutate((layers) => layers.splice(i + 1, 0, { ...foundry.utils.deepClone(layers[i]), id: newId(), label: `${layers[i].label} (2)` }));
  }

  static async #onMoveLayer(event, target) {
    const i = Number(target.dataset.index);
    const j = i + Number(target.dataset.dir);
    await this.#mutate((layers) => {
      if (j < 0 || j >= layers.length) return;
      [layers[i], layers[j]] = [layers[j], layers[i]];
    });
  }

  static async #onPickFile(event, target) {
    const i = Number(target.dataset.index);
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "audio",
      callback: (path) => this.#mutate((layers) => layers[i] && (layers[i].paths = [...(layers[i].paths ?? []), path]))
    }).browse();
  }

  static async #onTension(event, target) {
    await writeSoundscape({ tension: Number(target.dataset.value) || 0 });
  }

  static async #applyTemplate(key) {
    const make = TEMPLATES[key];
    if (!make) return;
    await this.#mutate((layers) => layers.push(...make().map(makeLayer)));
    ui.notifications.info(t("Template.Added"));
  }
}

/* ============================================ */
/*  Fenêtre d'un son d'ambiance de Foundry      */
/* ============================================ */

/** Ajoute les réglages Vesper à la fenêtre d'un son d'ambiance. */
export function injectAmbientSoundConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  const doc = app.document;
  if (!root || !doc || root.querySelector(".vesper-sound-config")) return;
  const s = soundSettings(doc);
  const base = `flags.${MODULE_ID}.${FLAG_SOUND}`;
  const fs = document.createElement("fieldset");
  fs.className = "vesper-sound-config";
  fs.innerHTML = `
    <legend><i class="fa-solid fa-ear-listen"></i> Vesper</legend>
    <div class="form-group">
      <label>${t("SoundConfig.Managed")}</label>
      <input type="checkbox" name="${base}.managed" ${s.managed !== false ? "checked" : ""}>
      <p class="hint">${t("SoundConfig.ManagedHint")}</p>
    </div>
    <div class="form-group">
      <label>${t("SoundConfig.Directional")}</label>
      <input type="checkbox" name="${base}.directional" ${s.directional !== false ? "checked" : ""}>
      <p class="hint">${t("SoundConfig.DirectionalHint")}</p>
    </div>
    <div class="form-group">
      <label>${t("SoundConfig.Size")}</label>
      <input type="number" name="${base}.size" value="${Number(s.size) || SOUND_DEFAULTS.size}" min="0.25" max="20" step="0.25">
      <p class="hint">${t("SoundConfig.SizeHint")}</p>
    </div>`;
  const anchor = root.querySelector("footer.form-footer, .form-footer, footer");
  if (anchor) anchor.before(fs);
  else (root.querySelector("form") ?? root).append(fs);
  app.setPosition?.({ height: "auto" });
}
