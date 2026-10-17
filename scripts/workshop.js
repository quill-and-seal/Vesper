/**
 * Atelier sonore : le MJ crée ses propres sons procéduraux en assemblant des couches.
 *
 * Les modèles livrés se consultent (et s'écoutent) mais ne se modifient pas : on les duplique.
 * Les sons créés sont enregistrés dans un réglage du monde, donc partagés avec tous les joueurs,
 * et utilisables dans le paysage sonore (couche générée) ou sur la carte (son procédural).
 */

import { MODULE_ID, t, esc } from "./constants.js";
import {
  allPatches,
  getPatch,
  customPatches,
  normalizePatch,
  modTargets,
  LIMITS,
  LAYER_DEFAULTS,
  NOISE_COLORS,
  WAVES,
  FILTER_TYPES,
  GRAIN_TYPES,
  MOD_KINDS,
  INTENSITY_SOURCES,
  BUILTIN_IDS,
  pval
} from "./patches.js";
import { PatchPlayer } from "./audio/patch-player.js";

const { ApplicationV2 } = foundry.applications.api;

/** Nom affiché d'une recette. */
export function patchLabel(id) {
  const p = getPatch(id);
  if (!p) return id;
  if (p.builtin) return t(`Synth.${id}`);
  return p.label || id;
}

/** Options d'une liste de recettes, groupées (modèles, puis sons de l'atelier). */
export function patchOptions(selected) {
  const custom = Object.values(customPatches());
  const opt = (id) => `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc(patchLabel(id))}</option>`;
  let html = `<optgroup label="${esc(t("Workshop.Builtins"))}">${BUILTIN_IDS.map(opt).join("")}</optgroup>`;
  if (custom.length) html += `<optgroup label="${esc(t("Workshop.Mine"))}">${custom.map((p) => opt(p.id)).join("")}</optgroup>`;
  return html;
}

/** Enregistre les sons de l'atelier (réglage du monde). */
async function saveCustom(map) {
  await game.settings.set(MODULE_ID, "patches", map);
}

/** Tableau à partir d'un objet { "0": …, "1": … } (formulaire déplié). */
function arr(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  return Object.keys(v)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => v[k]);
}

const NEW_PATCH = () => ({
  label: "",
  intensity: "fixed",
  fixed: 0.5,
  volume: 0,
  layers: [{ id: "l1", label: "", source: { ...LAYER_DEFAULTS.noise }, filters: [{ type: "lowpass", freq: 1200, q: 0.7 }], gain: 0.5, pan: 0, mods: [] }]
});

export class Workshop extends ApplicationV2 {
  constructor(engine, options = {}) {
    super({ id: `${MODULE_ID}-workshop`, ...options });
    this.engine = engine;
    this.patchId = options.patchId ?? "fire";
    this.previewIntensity = null;
    // Distance d'écoute (cases) : loin par défaut, comme la plupart du temps en jeu
    this.previewDistance = 3;
    this.player = null;
    this.previewGain = null;
    this.#saveTimer = null;
  }

  #saveTimer;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["vesper", "vesper-workshop"],
    window: { icon: "fa-solid fa-flask", resizable: true },
    position: { width: 720, height: 780 },
    form: { handler: Workshop.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      play: Workshop.#onPlay,
      newPatch: Workshop.#onNew,
      duplicate: Workshop.#onDuplicate,
      deletePatch: Workshop.#onDelete,
      addLayer: Workshop.#onAddLayer,
      removeLayer: Workshop.#onRemoveLayer,
      moveLayer: Workshop.#onMoveLayer,
      addFilter: Workshop.#onAddFilter,
      removeFilter: Workshop.#onRemoveFilter,
      addMod: Workshop.#onAddMod,
      removeMod: Workshop.#onRemoveMod,
      link: Workshop.#onLink
    }
  };

  get title() {
    return t("Workshop.Title");
  }

  get patch() {
    return getPatch(this.patchId) ?? getPatch("fire");
  }

  get editable() {
    return game.user.isGM && !this.patch.builtin;
  }

  /* -------------------------------------------- */
  /*  Rendu                                       */
  /* -------------------------------------------- */

  async _renderHTML() {
    const div = document.createElement("div");
    div.className = "vesper-body";
    div.innerHTML = this.#html();
    return div;
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".vw-layers")?.scrollTop ?? 0;
    content.replaceChildren(result);
    const list = content.querySelector(".vw-layers");
    if (list) list.scrollTop = scroll;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    // Changer de recette : un « change » sur la liste, hors du formulaire de la recette
    root.querySelector(".vw-pick")?.addEventListener("change", (ev) => {
      ev.stopPropagation();
      this.patchId = ev.currentTarget.value;
      this.previewIntensity = null;
      this.#restartPreview();
      this.render();
    });
    // Intensité d'écoute : n'est pas enregistrée
    const slider = root.querySelector(".vw-preview-intensity");
    slider?.addEventListener("input", (ev) => {
      ev.stopPropagation();
      this.previewIntensity = Number(slider.value);
      slider.nextElementSibling.textContent = `${Math.round(this.previewIntensity * 100)} %`;
      this.player?.setIntensity(this.previewIntensity);
    });
    slider?.addEventListener("change", (ev) => ev.stopPropagation());
    const dist = root.querySelector(".vw-preview-distance");
    dist?.addEventListener("input", (ev) => {
      ev.stopPropagation();
      this.previewDistance = Number(dist.value);
      dist.nextElementSibling.textContent = `${this.previewDistance.toFixed(1)} ${t("Workshop.Cells")}`;
      this.player?.setDistance(this.previewDistance);
    });
    dist?.addEventListener("change", (ev) => ev.stopPropagation());
  }

  /** Ateliers ouverts (rafraîchis quand la bibliothèque change). */
  static open = new Set();

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Workshop.open.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    Workshop.open.delete(this);
    this.#stopPreview();
  }

  #num(label, path, value, { min = 0, max = 1, step = 0.01, unit = "", hint = "" } = {}) {
    const pair = value && typeof value === "object";
    const dis = this.editable ? "" : "disabled";
    const input = (key, v) => `<input type="number" name="${path}${key}" value="${Number(v)}" min="${min}" max="${max}" step="${step}" ${dis}>`;
    const fields = pair
      ? `${input(".a", value.a)}<i class="fa-solid fa-arrow-right-long vw-arrow" data-tooltip="${esc(t("Workshop.PairHint"))}"></i>${input(".b", value.b)}`
      : input("", value);
    const link = this.editable
      ? `<a class="vw-link ${pair ? "active" : ""}" data-action="link" data-path="${path}" data-tooltip="${esc(t(pair ? "Workshop.Unlink" : "Workshop.Link"))}"><i class="fa-solid fa-chart-line"></i></a>`
      : pair
        ? `<i class="fa-solid fa-chart-line vw-link active"></i>`
        : "";
    return `<label class="vw-field ${pair ? "is-pair" : ""}" ${hint ? `data-tooltip="${esc(hint)}"` : ""}><span>${esc(label)}${unit ? ` <small>${esc(unit)}</small>` : ""}</span><span class="vw-inputs">${fields}${link}</span></label>`;
  }

  /** Nombre simple (ne suit jamais l'intensité). */
  #plain(label, name, value, { min = 0, max = 1, step = 0.01, unit = "", hint = "" } = {}) {
    const dis = this.editable ? "" : "disabled";
    return `<label class="vw-field" ${hint ? `data-tooltip="${esc(hint)}"` : ""}><span>${esc(label)}${unit ? ` <small>${esc(unit)}</small>` : ""}</span><span class="vw-inputs"><input type="number" name="${name}" value="${Number(value)}" min="${min}" max="${max}" step="${step}" ${dis}></span></label>`;
  }

  #sel(label, name, values, value, prefix) {
    const dis = this.editable ? "" : "disabled";
    return `<label class="vw-field"><span>${esc(label)}</span><select name="${name}" ${dis}>${values
      .map((v) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(t(`${prefix}.${v}`))}</option>`)
      .join("")}</select></label>`;
  }

  #sourceHtml(l, p) {
    const s = l.source;
    const base = `layers.${p}.source`;
    const type = `<input type="hidden" name="${base}.type" value="${s.type}">`;
    if (s.type === "noise") return type + `<div class="vw-grid">${this.#sel(t("Workshop.Color"), `${base}.color`, NOISE_COLORS, s.color, "Workshop.Colors")}</div>`;
    if (s.type === "osc")
      return (
        type +
        `<div class="vw-grid">${this.#sel(t("Workshop.Wave"), `${base}.wave`, WAVES, s.wave, "Workshop.Waves")}${this.#num(t("Workshop.Freq"), `${base}.freq`, s.freq, { min: 10, max: 12000, step: 0.01, unit: "Hz" })}</div>`
      );
    const n = (key, opts) => this.#num(t(`Workshop.Ev.${key}`), `${base}.${key}`, s[key], { ...opts, hint: t(`Workshop.Ev.${key}Hint`) });
    return (
      type +
      `<div class="vw-subtitle">${t("Workshop.Rhythm")}</div>
      <div class="vw-grid">
        ${n("rate", { min: 0.01, max: LIMITS.eventRate, step: 0.01, unit: "/s" })}
        ${n("regularity", { min: 0, max: 1, step: 0.05 })}
        ${n("burstChance", { min: 0, max: 1, step: 0.01 })}
        ${n("burstMin", { min: 1, max: LIMITS.burstMax, step: 1 })}
        ${n("burstMax", { min: 1, max: LIMITS.burstMax, step: 1 })}
        ${n("burstGap", { min: 0.002, max: 2, step: 0.001, unit: "s" })}
      </div>
      <div class="vw-subtitle">${t("Workshop.Grain")}</div>
      <div class="vw-grid">
        ${this.#sel(t("Workshop.Ev.grain"), `${base}.grain`, GRAIN_TYPES, s.grain, "Workshop.Grains")}
        ${n("decay", { min: 0.1, max: 1000, step: 0.1, unit: "ms" })}
        ${n("freqMin", { min: 20, max: 16000, step: 1, unit: "Hz" })}
        ${n("freqMax", { min: 20, max: 16000, step: 1, unit: "Hz" })}
        ${s.grain === "noise" ? n("q", { min: 0.1, max: 30, step: 0.1 }) + n("ring", { min: 0, max: 1, step: 0.01 }) : n("drop", { min: 0.1, max: 4, step: 0.01 })}
        ${n("ampMin", { min: 0, max: 2, step: 0.01 })}
        ${n("ampMax", { min: 0, max: 2, step: 0.01 })}
        ${n("skew", { min: 0.1, max: 8, step: 0.1 })}
        ${n("spread", { min: 0, max: 1, step: 0.05 })}
      </div>`
    );
  }

  #layerHtml(l, i, count) {
    const p = i;
    const dis = this.editable ? "" : "disabled";
    const tools = this.editable
      ? `<span class="vw-tools">
          <a data-action="moveLayer" data-index="${i}" data-dir="-1" ${i === 0 ? 'class="disabled"' : ""}><i class="fa-solid fa-arrow-up"></i></a>
          <a data-action="moveLayer" data-index="${i}" data-dir="1" ${i === count - 1 ? 'class="disabled"' : ""}><i class="fa-solid fa-arrow-down"></i></a>
          <a data-action="removeLayer" data-index="${i}" data-tooltip="${esc(t("Workshop.RemoveLayer"))}"><i class="fa-solid fa-trash"></i></a>
        </span>`
      : "";
    const icon = { noise: "fa-wave-square", osc: "fa-wave-sine", events: "fa-burst" }[l.source.type] ?? "fa-wave-square";

    const filters = l.filters
      .map(
        (f, k) => `<div class="vw-row">
          ${this.#sel(t("Workshop.FilterType"), `layers.${p}.filters.${k}.type`, FILTER_TYPES, f.type, "Workshop.Filters")}
          ${this.#num(t("Workshop.Freq"), `layers.${p}.filters.${k}.freq`, f.freq, { min: 20, max: 20000, step: 1, unit: "Hz" })}
          ${this.#num("Q", `layers.${p}.filters.${k}.q`, f.q, { min: 0.05, max: 30, step: 0.05 })}
          ${f.type === "peaking" ? this.#num(t("Workshop.Boost"), `layers.${p}.filters.${k}.gain`, f.gain, { min: -30, max: 30, step: 0.5, unit: "dB" }) : ""}
          ${this.editable ? `<a class="vw-del" data-action="removeFilter" data-index="${i}" data-k="${k}"><i class="fa-solid fa-xmark"></i></a>` : ""}
        </div>`
      )
      .join("");

    const targets = modTargets(l);
    const mods = l.mods
      .map(
        (m, k) => `<div class="vw-row">
          <label class="vw-field"><span>${t("Workshop.ModTarget")}</span><select name="layers.${p}.mods.${k}.target" ${dis}>${targets
            .map((tg) => `<option value="${tg}" ${tg === m.target ? "selected" : ""}>${esc(this.#targetLabel(tg, l))}</option>`)
            .join("")}</select></label>
          ${this.#sel(t("Workshop.ModKind"), `layers.${p}.mods.${k}.kind`, MOD_KINDS, m.kind, "Workshop.Mods")}
          ${this.#num(t("Workshop.ModRate"), `layers.${p}.mods.${k}.rate`, m.rate, { min: 0.01, max: 40, step: 0.01, unit: "Hz" })}
          ${this.#num(t("Workshop.ModDepth"), `layers.${p}.mods.${k}.depth`, m.depth, { min: 0, max: 1, step: 0.01 })}
          ${this.editable ? `<a class="vw-del" data-action="removeMod" data-index="${i}" data-k="${k}"><i class="fa-solid fa-xmark"></i></a>` : ""}
        </div>`
      )
      .join("");

    return `
      <fieldset class="vw-layer ${l.mute ? "is-muted" : ""}">
        <input type="hidden" name="layers.${p}.id" value="${esc(l.id)}">
        <legend>
          <i class="fa-solid ${icon}"></i>
          <input type="text" name="layers.${p}.label" value="${esc(l.label)}" placeholder="${esc(t(`Workshop.Source.${l.source.type}`))}" ${dis}>
          <label class="vw-mute" data-tooltip="${esc(t("Workshop.Mute"))}"><input type="checkbox" name="layers.${p}.mute" ${l.mute ? "checked" : ""} ${dis}><i class="fa-solid fa-volume-xmark"></i></label>
          ${tools}
        </legend>
        ${this.#sourceHtml(l, p)}
        <div class="vw-subtitle">${t("Workshop.Output")}</div>
        <div class="vw-grid">
          ${this.#num(t("Workshop.Gain"), `layers.${p}.gain`, l.gain, { min: 0, max: 4, step: 0.01 })}
          ${this.#num(t("Workshop.Pan"), `layers.${p}.pan`, l.pan, { min: -1, max: 1, step: 0.05 })}
          ${this.#plain(t("Workshop.Near"), `layers.${p}.near`, l.near ?? 0, { min: 0, max: 10, step: 0.25, unit: t("Workshop.Cells"), hint: t("Workshop.NearHint") })}
        </div>
        <div class="vw-subtitle">${t("Workshop.FiltersTitle")} ${this.editable && l.filters.length < LIMITS.filters ? `<a data-action="addFilter" data-index="${i}"><i class="fa-solid fa-plus"></i></a>` : ""}</div>
        ${filters || `<p class="notes">${t("Workshop.NoFilter")}</p>`}
        <div class="vw-subtitle">${t("Workshop.ModsTitle")} ${this.editable && l.mods.length < LIMITS.mods ? `<a data-action="addMod" data-index="${i}"><i class="fa-solid fa-plus"></i></a>` : ""}</div>
        ${mods || `<p class="notes">${t("Workshop.NoMod")}</p>`}
      </fieldset>`;
  }

  #targetLabel(target, layer) {
    if (target === "gain") return t("Workshop.Gain");
    if (target === "pan") return t("Workshop.Pan");
    if (target === "source.freq") return t("Workshop.Freq");
    if (target === "source.rate") return t("Workshop.Ev.rate");
    const m = /^filters\.(\d+)\.(freq|q)$/.exec(target);
    if (m) {
      const f = layer.filters[Number(m[1])];
      return `${t(`Workshop.Filters.${f?.type ?? "lowpass"}`)} ${Number(m[1]) + 1} — ${m[2] === "freq" ? t("Workshop.Freq") : "Q"}`;
    }
    return target;
  }

  #html() {
    const p = this.patch;
    const dis = this.editable ? "" : "disabled";
    const playing = !!this.player;
    const intensity = this.previewIntensity ?? p.fixed;
    const layers = p.layers.map((l, i) => this.#layerHtml(l, i, p.layers.length)).join("");

    const banner = p.builtin
      ? `<div class="vw-banner"><i class="fa-solid fa-lock"></i> ${t("Workshop.BuiltinNote")} ${game.user.isGM ? `<button type="button" data-action="duplicate"><i class="fa-solid fa-copy"></i> ${t("Workshop.Duplicate")}</button>` : ""}</div>`
      : "";

    return `
      <section class="vw-head">
        <div class="vw-bar">
          <select class="vw-pick">${patchOptions(this.patchId)}</select>
          <button type="button" class="vw-play ${playing ? "active" : ""}" data-action="play"><i class="fa-solid ${playing ? "fa-stop" : "fa-play"}"></i> ${t(playing ? "Workshop.Stop" : "Workshop.Play")}</button>
          ${game.user.isGM ? `<button type="button" data-action="newPatch" data-tooltip="${esc(t("Workshop.New"))}"><i class="fa-solid fa-file-circle-plus"></i></button>
          <button type="button" data-action="duplicate" data-tooltip="${esc(t("Workshop.Duplicate"))}"><i class="fa-solid fa-copy"></i></button>
          ${p.builtin ? "" : `<button type="button" data-action="deletePatch" data-tooltip="${esc(t("Workshop.Delete"))}"><i class="fa-solid fa-trash"></i></button>`}` : ""}
        </div>
        <label class="vw-preview"><span>${t("Workshop.PreviewIntensity")}</span><input type="range" class="vw-preview-intensity" min="0" max="1" step="0.01" value="${intensity}"><output>${Math.round(intensity * 100)} %</output></label>
        <label class="vw-preview" data-tooltip="${esc(t("Workshop.PreviewDistanceHint"))}"><span>${t("Workshop.PreviewDistance")}</span><input type="range" class="vw-preview-distance" min="0" max="10" step="0.05" value="${this.previewDistance}"><output>${this.previewDistance.toFixed(1)} ${t("Workshop.Cells")}</output></label>
        ${banner}
        <div class="vw-grid">
          <label class="vw-field"><span>${t("Workshop.Name")}</span><input type="text" name="label" value="${esc(p.builtin ? patchLabel(this.patchId) : p.label)}" ${dis}></label>
          ${this.#sel(t("Workshop.IntensitySource"), "intensity", INTENSITY_SOURCES, p.intensity, "Workshop.Intensity")}
          ${this.#num(t("Workshop.Fixed"), "fixed", p.fixed, { min: 0, max: 1, step: 0.01, hint: t("Workshop.FixedHint") })}
          ${this.#num(t("Workshop.Volume"), "volume", p.volume, { min: -40, max: 12, step: 0.5, unit: "dB" })}
        </div>
        <p class="notes">${t("Workshop.UseHint")}</p>
      </section>
      <section class="vw-layers">${layers || `<p class="vesper-empty">${t("Workshop.Empty")}</p>`}</section>
      ${
        this.editable && p.layers.length < LIMITS.layers
          ? `<footer class="vw-foot">
              <button type="button" data-action="addLayer" data-type="noise"><i class="fa-solid fa-wave-square"></i> ${t("Workshop.Source.noise")}</button>
              <button type="button" data-action="addLayer" data-type="osc"><i class="fa-solid fa-wave-sine"></i> ${t("Workshop.Source.osc")}</button>
              <button type="button" data-action="addLayer" data-type="events"><i class="fa-solid fa-burst"></i> ${t("Workshop.Source.events")}</button>
            </footer>`
          : ""
      }`;
  }

  /* -------------------------------------------- */
  /*  Écoute                                      */
  /* -------------------------------------------- */

  #startPreview() {
    const out = this.engine.out;
    out.init();
    const ctx = out.ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!this.previewGain) {
      this.previewGain = ctx.createGain();
      this.previewGain.connect(out.master);
    }
    this.player = new PatchPlayer(ctx, this.patch);
    this.player.setIntensity(this.previewIntensity ?? this.patch.fixed);
    this.player.setDistance(this.previewDistance);
    this.player.output.connect(this.previewGain);
  }

  #stopPreview() {
    if (this.player) {
      const player = this.player;
      player.output.gain.setTargetAtTime(0, this.engine.out.now, 0.05);
      setTimeout(() => player.stop(), 300);
    }
    this.player = null;
  }

  #restartPreview() {
    if (!this.player) return;
    this.#stopPreview();
    this.#startPreview();
  }

  /* -------------------------------------------- */
  /*  Modifications                               */
  /* -------------------------------------------- */

  /** Écrit la recette modifiée (immédiatement dans la bibliothèque locale, puis dans le réglage du monde). */
  async #commit(patch, { now = false } = {}) {
    if (!this.editable) return;
    const map = customPatches();
    const clean = normalizePatch(patch, this.patchId);
    delete clean.id;
    const stored = Object.fromEntries(Object.entries(map).map(([id, p]) => [id, { ...p, builtin: undefined, icon: undefined, id: undefined }]));
    stored[this.patchId] = clean;
    clearTimeout(this.#saveTimer);
    const write = async () => {
      await saveCustom(JSON.parse(JSON.stringify(stored)));
      this.#restartPreview();
    };
    if (now) await write();
    else this.#saveTimer = setTimeout(write, 250);
  }

  /** Recette modifiable (copie). */
  #draft() {
    return foundry.utils.deepClone(this.patch);
  }

  static async #onSubmit(event, form, formData) {
    if (!this.editable) return;
    const obj = foundry.utils.expandObject(formData.object ?? formData);
    const current = this.#draft();
    const layers = arr(obj.layers).map((l, i) => {
      const prev = current.layers[i] ?? {};
      return {
        ...prev,
        ...l,
        mute: !!l.mute,
        source: { ...prev.source, ...(l.source ?? {}) },
        filters: arr(l.filters).map((f, k) => ({ ...(prev.filters?.[k] ?? {}), ...f })),
        mods: arr(l.mods).map((m, k) => ({ ...(prev.mods?.[k] ?? {}), ...m }))
      };
    });
    // Un changement de type de grain réaffiche les champs qui lui correspondent
    const regrain = layers.some((l, i) => l.source?.grain && l.source.grain !== current.layers[i]?.source?.grain);
    await this.#commit({ ...current, label: obj.label, intensity: obj.intensity, fixed: obj.fixed, volume: obj.volume, layers }, { now: regrain });
  }

  async #mutate(fn) {
    if (!this.editable) return;
    const p = this.#draft();
    fn(p);
    await this.#commit(p, { now: true });
  }

  static #onPlay() {
    if (this.player) this.#stopPreview();
    else this.#startPreview();
    this.render();
  }

  static async #onNew() {
    const id = `my-${foundry.utils.randomID(8).toLowerCase()}`;
    const map = Object.fromEntries(Object.entries(customPatches()).map(([k, p]) => [k, { ...p, builtin: undefined, icon: undefined, id: undefined }]));
    map[id] = { ...NEW_PATCH(), label: t("Workshop.NewName") };
    this.patchId = id;
    await saveCustom(JSON.parse(JSON.stringify(map)));
  }

  static async #onDuplicate() {
    const src = this.patch;
    const id = `my-${foundry.utils.randomID(8).toLowerCase()}`;
    const map = Object.fromEntries(Object.entries(customPatches()).map(([k, p]) => [k, { ...p, builtin: undefined, icon: undefined, id: undefined }]));
    const copy = foundry.utils.deepClone(src);
    delete copy.builtin;
    delete copy.icon;
    delete copy.id;
    copy.label = t("Workshop.CopyName", { name: patchLabel(this.patchId) });
    map[id] = copy;
    this.patchId = id;
    await saveCustom(JSON.parse(JSON.stringify(map)));
  }

  static async #onDelete() {
    if (this.patch.builtin) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("Workshop.Delete") },
      content: `<p>${esc(t("Workshop.DeleteConfirm", { name: patchLabel(this.patchId) }))}</p>`
    });
    if (!ok) return;
    const map = Object.fromEntries(
      Object.entries(customPatches())
        .filter(([k]) => k !== this.patchId)
        .map(([k, p]) => [k, { ...p, builtin: undefined, icon: undefined, id: undefined }])
    );
    this.#stopPreview();
    this.patchId = "fire";
    await saveCustom(JSON.parse(JSON.stringify(map)));
  }

  static async #onAddLayer(event, target) {
    const type = target.dataset.type;
    await this.#mutate((p) => {
      const layer = { id: `l${foundry.utils.randomID(6)}`, label: "", source: { ...LAYER_DEFAULTS[type] }, filters: [], gain: 0.5, pan: 0, mods: [] };
      if (type === "noise") layer.filters.push({ type: "lowpass", freq: 1200, q: 0.7 });
      if (type === "osc") layer.gain = 0.2;
      if (type === "events") layer.gain = 1;
      p.layers.push(layer);
    });
  }

  static async #onRemoveLayer(event, target) {
    const i = Number(target.dataset.index);
    await this.#mutate((p) => p.layers.splice(i, 1));
  }

  static async #onMoveLayer(event, target) {
    const i = Number(target.dataset.index);
    const j = i + Number(target.dataset.dir);
    await this.#mutate((p) => {
      if (j < 0 || j >= p.layers.length) return;
      [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
    });
  }

  static async #onAddFilter(event, target) {
    const i = Number(target.dataset.index);
    await this.#mutate((p) => p.layers[i]?.filters.push({ type: "lowpass", freq: 2000, q: 0.7 }));
  }

  static async #onRemoveFilter(event, target) {
    const i = Number(target.dataset.index);
    const k = Number(target.dataset.k);
    await this.#mutate((p) => {
      const l = p.layers[i];
      if (!l) return;
      l.filters.splice(k, 1);
      // Les modulations qui visaient un filtre disparu ou décalé sont recalées
      l.mods = l.mods
        .filter((m) => m.target !== `filters.${k}.freq` && m.target !== `filters.${k}.q`)
        .map((m) => {
          const mm = /^filters\.(\d+)\.(freq|q)$/.exec(m.target);
          return mm && Number(mm[1]) > k ? { ...m, target: `filters.${Number(mm[1]) - 1}.${mm[2]}` } : m;
        });
    });
  }

  static async #onAddMod(event, target) {
    const i = Number(target.dataset.index);
    await this.#mutate((p) => p.layers[i]?.mods.push({ target: "gain", kind: "jitter", rate: 2, depth: 0.3 }));
  }

  static async #onRemoveMod(event, target) {
    const i = Number(target.dataset.index);
    const k = Number(target.dataset.k);
    await this.#mutate((p) => p.layers[i]?.mods.splice(k, 1));
  }

  /** Lie un nombre à l'intensité (deux valeurs, au calme et au maximum), ou le délie. */
  static async #onLink(event, target) {
    const path = target.dataset.path;
    await this.#mutate((p) => {
      const v = foundry.utils.getProperty(p, path);
      if (v && typeof v === "object") foundry.utils.setProperty(p, path, pval(v, 0.5));
      else foundry.utils.setProperty(p, path, { a: Number(v) || 0, b: Number(v) || 0 });
    });
  }

  /** Bibliothèque changée (ce MJ ou un autre) : on redessine. */
  onPatchesChanged() {
    if (!getPatch(this.patchId)) this.patchId = "fire";
    // Ne pas casser une saisie en cours
    if (this.element?.contains(document.activeElement) && document.activeElement.matches("input[type=text], input[type=number]")) return;
    this.render();
  }
}

export { allPatches };
