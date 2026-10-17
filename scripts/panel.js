/**
 * Le panneau Vesper : tout se règle ici, sans ouvrir d'autres fenêtres.
 *
 *   En haut, toujours visibles : la tension de la scène et la carte du son (champ de toutes les sources).
 *   Onglet Sons     : la bibliothèque ; on glisse un son sur la carte pour le poser.
 *   Onglet Scène    : les sources posées (réglages de la source sélectionnée) et les pièces (acoustique des Régions).
 *   Onglet Ambiance : l'état de la scène et les couches du paysage sonore.
 *   Roue dentée     : les réglages du module.
 *
 * Ancré à droite de l'écran (à côté de la barre latérale de Foundry), ou flottant : le glisser par
 * son en-tête le détache, le bouton d'ancrage le remet en place.
 */

import { MODULE_ID, FLAG_ACOUSTICS, setting, t, esc } from "./constants.js";
import { selection } from "./selection.js";
import { libraryCategories, soundChoices, addLibraryFile, removeLibraryFile, fileLabel } from "./library.js";
import { getPatch } from "./patches.js";
import { REVERB_PRESETS } from "./audio/reverb-presets.js";
import { PROCEDURAL_PATH } from "./audio/synth.js";
import { soundSettings, soundPatch } from "./spatial-engine.js";
import { readSoundscape, writeSoundscape } from "./soundscape.js";
import { readSceneAcoustics, emberActive, ACOUSTICS_BEHAVIOR } from "./world.js";
import { markerInfo } from "./layer.js";

const { ApplicationV2 } = foundry.applications.api;

const WIDTH = 360;
const MARGIN = 8;
const TENSION_COLORS = ["#6fae6a", "#c9b458", "#d9822b", "#c0392b"];

/** Réglages du module affichés derrière la roue dentée. */
const SETTINGS_LAYOUT = [
  { title: "Walls", scope: "world", items: [["wallLoss", "slider", " dB"], ["doorLoss", "slider", " dB"], ["thinLoss", "slider", " dB"]] },
  { title: "Propagation", scope: "world", items: [["realism", "slider", "%"], ["airAbsorption", "toggle"], ["takeover", "toggle"], ["gmListener", "choice"]] },
  { title: "Listening", scope: "client", items: [["masterVolume", "slider", "%"], ["spatialVolume", "slider", "%"], ["soundscapeVolume", "slider", "%"], ["reverbVolume", "slider", "%"], ["panning", "choice"], ["occlusionQuality", "choice"], ["soundscape", "toggle"]] }
];

function icon(cls, extra = "") {
  return `<i class="${esc(cls)}" aria-hidden="true"${extra}></i>`;
}

function hex(n) {
  return `#${Number(n ?? 0).toString(16).padStart(6, "0")}`;
}

/** Interrupteur (role=switch). */
function toggle(on, attrs) {
  return `<button type="button" role="switch" aria-checked="${on}" class="vp-switch ${on ? "on" : ""}" ${attrs}><span></span></button>`;
}

export class VesperPanel extends ApplicationV2 {
  /** Le panneau (un seul). */
  static instance = null;

  static open(engine) {
    if (!this.instance) this.instance = new VesperPanel(engine);
    this.instance.render({ force: true });
    return this.instance;
  }

  static close() {
    this.instance?.close();
  }

  constructor(engine, options = {}) {
    super(options);
    this.engine = engine;
    const saved = setting("panel", {}) ?? {};
    this.docked = saved.docked !== false;
    this.tab = ["sons", "scene", "ambiance"].includes(saved.tab) ? saved.tab : "sons";
    this.settingsOpen = false;
    this.query = "";
    this.#offSelection = selection.on((id) => {
      if (id && this.tab !== "scene") this.tab = "scene";
      this.settingsOpen = false;
      this.render();
    });
  }

  #offSelection;
  #docking = false;
  #dragging = false;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-panel`,
    classes: ["vesper", "vesper-panel"],
    window: { icon: "fa-solid fa-ear-listen", resizable: false, minimizable: false },
    position: { width: WIDTH, height: 700 },
    actions: {
      tab: VesperPanel.#onTab,
      tension: VesperPanel.#onTension,
      showAll: VesperPanel.#onShowAll,
      dock: VesperPanel.#onDock,
      settings: VesperPanel.#onSettings,
      workshop: VesperPanel.#onWorkshop,
      editSound: VesperPanel.#onEditSound,
      addFile: VesperPanel.#onAddFile,
      removeFile: VesperPanel.#onRemoveFile,
      select: VesperPanel.#onSelect,
      toggleFlag: VesperPanel.#onToggleFlag,
      toggleHidden: VesperPanel.#onToggleHidden,
      intensityAuto: VesperPanel.#onIntensityAuto,
      intensityFixed: VesperPanel.#onIntensityFixed,
      showField: VesperPanel.#onShowField,
      deleteSource: VesperPanel.#onDeleteSource,
      foundrySheet: VesperPanel.#onFoundrySheet,
      drawRoom: VesperPanel.#onDrawRoom,
      layerToggle: VesperPanel.#onLayerToggle,
      editLayers: VesperPanel.#onEditLayers,
      settingToggle: VesperPanel.#onSettingToggle,
      settingChoice: VesperPanel.#onSettingChoice
    }
  };

  get title() {
    return "Vesper";
  }

  /* -------------------------------------------- */
  /*  Ancrage                                     */
  /* -------------------------------------------- */

  /** Position ancrée : à droite, juste à gauche de la barre latérale de Foundry, sur toute la hauteur. */
  dockedPosition() {
    const sidebar = document.getElementById("sidebar");
    const right = sidebar ? sidebar.getBoundingClientRect().left : window.innerWidth;
    return { left: Math.max(0, right - WIDTH - MARGIN), top: MARGIN, width: WIDTH, height: Math.max(360, window.innerHeight - MARGIN * 2) };
  }

  dock() {
    if (!this.docked || !this.rendered) return;
    this.#docking = true;
    this.setPosition(this.dockedPosition());
    this.#docking = false;
  }

  /** Glisser le panneau ancré le détache. */
  _onPosition(position) {
    super._onPosition?.(position);
    // Seul un glisser de la barre de titre détache le panneau (pas le premier placement de la fenêtre)
    if (!this.docked || this.#docking || !this.#dragging) return;
    const d = this.dockedPosition();
    if (Math.abs((position.left ?? d.left) - d.left) > 6 || Math.abs((position.top ?? d.top) - d.top) > 6) {
      this.docked = false;
      this.#save();
      this.element?.classList.remove("docked");
      this.setPosition({ height: Math.min(720, window.innerHeight - 40) });
      this.render();
    }
  }

  #save() {
    game.settings.set(MODULE_ID, "panel", { docked: this.docked, tab: this.tab }).catch(() => {});
  }

  /* -------------------------------------------- */
  /*  Rendu                                       */
  /* -------------------------------------------- */

  async _renderHTML() {
    const div = document.createElement("div");
    div.className = "vesper-body vp-body";
    div.innerHTML = this.#html();
    return div;
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".vp-content")?.scrollTop ?? 0;
    content.replaceChildren(result);
    const box = content.querySelector(".vp-content");
    if (box) box.scrollTop = scroll;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    if (this.docked) this.dock();
    this.#onResize = () => this.dock();
    window.addEventListener("resize", this.#onResize);
    this.element?.querySelector(".window-header")?.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button, a, input")) return;
      this.#dragging = true;
      window.addEventListener("pointerup", () => (this.#dragging = false), { once: true });
    });
  }

  #onResize = null;

  _onClose(options) {
    super._onClose?.(options);
    window.removeEventListener("resize", this.#onResize);
    canvas.vesper?.highlightRegion?.(null);
    if (VesperPanel.instance === this) VesperPanel.instance = null;
    this.#offSelection?.();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    root.classList.toggle("docked", this.docked);
    // Bouton d'ancrage et roue dentée dans l'en-tête de la fenêtre
    const header = root.querySelector(".window-header");
    if (header && !header.querySelector(".vp-head-tools")) {
      const tools = document.createElement("div");
      tools.className = "vp-head-tools";
      header.querySelector(".window-title")?.after(tools);
    }
    const tools = header?.querySelector(".vp-head-tools");
    if (tools) {
      tools.innerHTML = `
        <button type="button" class="vp-icon ${this.settingsOpen ? "active" : ""}" data-action="settings" aria-pressed="${this.settingsOpen}" aria-label="${esc(t("Panel.Settings"))}" data-tooltip="${esc(t("Panel.Settings"))}">${icon("fa-solid fa-gear")}</button>
        <button type="button" class="vp-icon" data-action="dock" aria-label="${esc(t(this.docked ? "Panel.Undock" : "Panel.Dock"))}" data-tooltip="${esc(t(this.docked ? "Panel.Undock" : "Panel.Dock"))}">${icon(this.docked ? "fa-solid fa-up-right-from-square" : "fa-solid fa-table-columns")}</button>`;
    }

    // Glisser un son de la bibliothèque sur la carte
    for (const card of root.querySelectorAll(".vp-card[draggable]")) {
      card.addEventListener("dragstart", (ev) => {
        const ref = card.dataset.patch ? { patch: card.dataset.patch } : { path: card.dataset.path };
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "VesperSound", ...ref }));
        ev.dataTransfer.effectAllowed = "copy";
        canvas.vesper?.setDropHint?.(true);
      });
      card.addEventListener("dragend", () => canvas.vesper?.setDropHint?.(false));
    }

    // Champs : « input » met à jour l'affichage, « change » enregistre
    for (const el of root.querySelectorAll("[data-field]")) {
      el.addEventListener("input", () => {
        const out = el.closest(".vp-row")?.querySelector("output");
        if (out && el.type === "range") out.textContent = this.#format(el.dataset.field, Number(el.value), el);
      });
      el.addEventListener("change", () => this.#onField(el));
    }
    root.querySelector(".vp-search")?.addEventListener("input", (ev) => {
      this.query = ev.currentTarget.value;
      this.#filterLibrary();
    });
    this.#filterLibrary();

    // Survol d'une pièce : contour sur la carte
    for (const row of root.querySelectorAll("[data-region]")) {
      row.addEventListener("mouseenter", () => canvas.vesper?.highlightRegion?.(row.dataset.region));
      row.addEventListener("mouseleave", () => canvas.vesper?.highlightRegion?.(null));
    }
  }

  #filterLibrary() {
    const q = this.query.trim().toLowerCase();
    for (const card of this.element?.querySelectorAll(".vp-card") ?? []) card.hidden = !!q && !card.dataset.name.toLowerCase().includes(q);
    for (const sec of this.element?.querySelectorAll(".vp-cat") ?? []) sec.hidden = ![...sec.querySelectorAll(".vp-card")].some((c) => !c.hidden);
  }

  #format(field, v, el) {
    if (field === "radius") return `${v} ${t("Workshop.Cells")}`;
    if (field === "volume" || field === "isolation" || field === "intensity") {
      if (field === "isolation") return v === 0 ? t("Panel.IsoOpen") : v < 50 ? t("Panel.IsoLight") : v < 85 ? t("Panel.IsoClosed") : t("Panel.IsoSealed");
      if (field === "intensity") return v < 34 ? t("Panel.Small") : v < 67 ? t("Panel.Medium") : t("Panel.Large");
      return `${v} %`;
    }
    if (field.startsWith("setting:")) return `${v}${el?.dataset.unit ?? ""}`;
    return String(v);
  }

  #html() {
    const ss = readSoundscape();
    const tension = Number(ss.tension) || 0;
    const showAll = !!setting("showAll", false);
    const tensions = [0, 1, 2, 3]
      .map((n) => `<button type="button" class="vp-tension ${n === tension ? "on" : ""}" style="--tc:${TENSION_COLORS[n]}" data-action="tension" data-value="${n}" aria-pressed="${n === tension}">${esc(t(`Tension.${n}`))}</button>`)
      .join("");

    if (this.settingsOpen) return `<div class="vp-content vp-scroll">${this.#settingsHtml()}</div>`;

    const count = canvas.scene?.sounds?.size ?? canvas.scene?.sounds?.length ?? 0;
    const tab = (key, label, badge = "") =>
      `<button type="button" role="tab" class="vp-tab ${this.tab === key ? "on" : ""}" aria-selected="${this.tab === key}" data-action="tab" data-tab="${key}">${esc(label)}${badge ? `<span class="vp-badge">${badge}</span>` : ""}</button>`;

    return `
      <div class="vp-top">
        <div class="vp-line"><span class="vp-cap">${t("Soundscape.Tension")}</span><div class="vp-seg" role="group" aria-label="${esc(t("Soundscape.Tension"))}">${tensions}</div></div>
        <div class="vp-line"><span class="vp-cap">${t("Panel.Map")}</span><span class="vp-grow">${t("Panel.ShowAll")}</span>${toggle(showAll, `data-action="showAll" aria-label="${esc(t("Panel.ShowAll"))}"`)}</div>
      </div>
      <div class="vp-tabs" role="tablist">${tab("sons", t("Panel.TabSounds"))}${tab("scene", t("Panel.TabScene"), String(count))}${tab("ambiance", t("Panel.TabAmbience"))}</div>
      <div class="vp-content vp-scroll">${this.tab === "sons" ? this.#soundsHtml() : this.tab === "scene" ? this.#sceneHtml() : this.#ambienceHtml()}</div>`;
  }

  /* -------------------------------------------- */
  /*  Onglet Sons                                 */
  /* -------------------------------------------- */

  #soundsHtml() {
    const cats = libraryCategories()
      .map((cat) => {
        const cards = cat.entries
          .map((e) => {
            const info = e.patch ? markerInfoForPatch(e.patch) : { color: 0xe8e2d4, icon: "fa-solid fa-music" };
            const editable = !!e.patch;
            return `<div class="vp-card" draggable="true" data-name="${esc(e.name)}" ${e.patch ? `data-patch="${esc(e.patch)}"` : `data-path="${esc(e.path)}"`} style="--c:${hex(info.color)}">
              <span class="vp-badge-icon">${icon(info.icon)}</span>
              <span class="vp-card-name">${esc(e.name)}</span>
              ${editable ? `<button type="button" class="vp-mini" data-action="editSound" data-patch="${esc(e.patch)}" aria-label="${esc(t("Panel.OpenInWorkshop", { name: e.name }))}" data-tooltip="${esc(t("Panel.OpenInWorkshopShort"))}">${icon("fa-solid fa-pen")}</button>` : ""}
              ${e.fileId ? `<button type="button" class="vp-mini" data-action="removeFile" data-id="${esc(e.fileId)}" aria-label="${esc(t("Panel.RemoveFile", { name: e.name }))}" data-tooltip="${esc(t("Panel.RemoveFileShort"))}">${icon("fa-solid fa-xmark")}</button>` : ""}
            </div>`;
          })
          .join("");
        return `<section class="vp-cat"><h3 class="vp-h">${esc(cat.title)}</h3><div class="vp-grid">${cards}</div></section>`;
      })
      .join("");
    return `
      <p class="vp-note">${t("Panel.SoundsHint")}</p>
      <div class="vp-line">
        <label class="vp-searchbox">${icon("fa-solid fa-magnifying-glass")}<input type="search" class="vp-search" value="${esc(this.query)}" placeholder="${esc(t("Panel.Search"))}" aria-label="${esc(t("Panel.Search"))}"></label>
        <button type="button" class="vp-accent-btn" data-action="workshop">${icon("fa-solid fa-flask")} ${t("Panel.Workshop")}</button>
      </div>
      ${cats}
      <button type="button" class="vp-dashed" data-action="addFile">+ ${t("Panel.AddFile")}</button>`;
  }

  /* -------------------------------------------- */
  /*  Onglet Scène                                */
  /* -------------------------------------------- */

  #sceneHtml() {
    const docs = [...(canvas.scene?.sounds ?? [])];
    const selId = selection.id;
    const rows = docs
      .map((doc) => {
        const info = markerInfo(doc);
        const on = doc.id === selId;
        const cells = Math.round(((Number(doc.radius) || 0) / (canvas.dimensions?.distance || 1)) * 2) / 2;
        return `<li><button type="button" class="vp-row-btn ${on ? "on" : ""} ${doc.hidden ? "dim" : ""}" data-action="select" data-id="${doc.id}" aria-pressed="${on}">
          <span class="vp-badge-icon small" style="--c:${hex(doc.hidden ? 0x8a8278 : info.color)}">${icon(info.iconClass)}</span>
          <span class="vp-grow">${esc(info.label)}</span>
          <span class="vp-meta">${doc.hidden ? `${t("Panel.Hidden")} · ` : ""}${cells} ${t("Workshop.Cells")}</span>
        </button></li>`;
      })
      .join("");
    const sel = selId ? canvas.scene?.sounds?.get(selId) : null;
    return `
      <h3 class="vp-h">${t("Panel.Sources")}</h3>
      ${docs.length ? `<ul class="vp-list">${rows}</ul>` : `<p class="vp-note">${t("Panel.NoSources")}</p>`}
      ${sel ? this.#inspectorHtml(sel) : docs.length ? `<p class="vp-note">${t("Panel.SelectHint")}</p>` : ""}
      ${this.#roomsHtml()}`;
  }

  #inspectorHtml(doc) {
    const s = soundSettings(doc);
    const patchId = soundPatch(doc);
    const patch = patchId ? getPatch(patchId) : null;
    const value = patchId ? `patch:${patchId}` : `file:${doc.path}`;
    const choices = soundChoices();
    if (!patchId && doc.path && !choices.some((c) => c.value === value)) choices.push({ value, label: fileLabel(doc.path), group: t("Library.Cat.files") });
    const groups = [...new Set(choices.map((c) => c.group))];
    const options = groups
      .map((g) => `<optgroup label="${esc(g)}">${choices.filter((c) => c.group === g).map((c) => `<option value="${esc(c.value)}" ${c.value === value ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</optgroup>`)
      .join("");
    const distance = canvas.dimensions?.distance || 1;
    const cells = Math.round(((Number(doc.radius) || 0) / distance) * 2) / 2;
    const vol = Math.round((Number.isFinite(doc.volume) ? doc.volume : 0.5) * 100);
    const auto = !Number.isFinite(s.intensity);
    const intensity = Math.round((auto ? patch?.fixed ?? 0.5 : s.intensity) * 100);
    const follows = patch?.intensity ?? "fixed";
    const autoLabel = t(`Panel.Follows.${follows}`);
    const tog = (on, label, hint, attrs) => `<div class="vp-toggle-row"><span class="vp-grow">${esc(label)}<small>${esc(hint)}</small></span>${toggle(on, `${attrs} aria-label="${esc(label)}"`)}</div>`;
    return `
      <div class="vp-inspector">
        <label class="vp-stack">${t("Panel.Name")}<input type="text" data-field="label" value="${esc(s.label || "")}" placeholder="${esc(markerInfo(doc).label)}"></label>
        <label class="vp-stack">${t("Panel.Sound")}<select data-field="sound">${options}</select></label>
        <label class="vp-row"><span class="vp-lbl">${t("Panel.Radius")}</span><input type="range" min="0.5" max="40" step="0.5" value="${cells}" data-field="radius"><output>${cells} ${t("Workshop.Cells")}</output></label>
        <label class="vp-row"><span class="vp-lbl">${t("Panel.Volume")}</span><input type="range" min="0" max="100" step="1" value="${vol}" data-field="volume"><output>${vol} %</output></label>
        ${
          patch
            ? `<div class="vp-row"><span class="vp-lbl">${t("SoundConfig.Intensity")}</span><div class="vp-seg" role="group" aria-label="${esc(t("SoundConfig.Intensity"))}">
                <button type="button" class="vp-segbtn ${auto ? "on" : ""}" data-action="intensityAuto" aria-pressed="${auto}">${esc(autoLabel)}</button>
                <button type="button" class="vp-segbtn ${!auto ? "on" : ""}" data-action="intensityFixed" aria-pressed="${!auto}">${t("Panel.Fixed")}</button></div></div>
               ${!auto ? `<label class="vp-row"><span class="vp-lbl">${t("Panel.Size")}</span><input type="range" min="0" max="100" step="1" value="${intensity}" data-field="intensity"><output>${this.#format("intensity", intensity)}</output></label>` : ""}`
            : ""
        }
        ${tog(s.directional !== false, t("SoundConfig.Directional"), t("Panel.DirectionalHint"), `data-action="toggleFlag" data-flag="directional"`)}
        ${tog(!!doc.hidden, t("Panel.HiddenLabel"), t("Panel.HiddenHint"), `data-action="toggleHidden"`)}
        ${tog(s.managed !== false, t("Panel.Managed"), t("Panel.ManagedHint"), `data-action="toggleFlag" data-flag="managed"`)}
        <div class="vp-line">
          <button type="button" class="vp-btn vp-grow" data-action="showField">${icon("fa-solid fa-bullseye")} ${t("Panel.ShowField")}</button>
          <button type="button" class="vp-btn" data-action="foundrySheet" aria-label="${esc(t("Panel.FoundrySheet"))}" data-tooltip="${esc(t("Panel.FoundrySheet"))}">${icon("fa-solid fa-sliders")}</button>
          <button type="button" class="vp-btn danger" data-action="deleteSource">${icon("fa-solid fa-trash-can")} ${t("Panel.Delete")}</button>
        </div>
      </div>`;
  }

  #roomsHtml() {
    const regions = [...(canvas.scene?.regions ?? [])];
    const places = Object.keys(REVERB_PRESETS);
    const rows = regions
      .map((r) => {
        const behaviors = r.behaviors?.contents ?? [...(r.behaviors ?? [])];
        const b = behaviors.find((x) => x.type === ACOUSTICS_BEHAVIOR);
        const place = b && !b.disabled ? b.system?.place ?? "room" : "";
        const iso = Math.round((Number(b?.system?.isolation) || 0) * 100);
        const opts = [`<option value="" ${place ? "" : "selected"}>${esc(t("Panel.NoAcoustics"))}</option>`]
          .concat(places.map((p) => `<option value="${p}" ${p === place ? "selected" : ""}>${esc(t(`Place.${p}`))}</option>`))
          .join("");
        return `<div class="vp-room" data-region="${r.id}">
          <div class="vp-line">${icon("fa-solid fa-house")}<strong class="vp-grow">${esc(r.name || t("Panel.Room"))}</strong></div>
          <label class="vp-row"><span class="vp-lbl">${t("Panel.Place")}</span><select data-field="roomPlace" data-region="${r.id}">${opts}</select></label>
          ${place ? `<label class="vp-row"><span class="vp-lbl">${t("Panel.Isolation")}</span><input type="range" min="0" max="100" step="5" value="${iso}" data-field="isolation" data-region="${r.id}"><output>${this.#format("isolation", iso)}</output></label>` : ""}
        </div>`;
      })
      .join("");
    return `
      <h3 class="vp-h vp-sep">${t("Panel.Rooms")}</h3>
      <p class="vp-note">${t("Panel.RoomsHint")}</p>
      ${rows || `<p class="vp-note">${t("Panel.NoRooms")}</p>`}
      <button type="button" class="vp-dashed" data-action="drawRoom">+ ${t("Panel.DrawRoom")}</button>`;
  }

  /* -------------------------------------------- */
  /*  Onglet Ambiance                             */
  /* -------------------------------------------- */

  #ambienceHtml() {
    const state = this.engine.soundscape.readState();
    const data = readSoundscape();
    const acoustics = readSceneAcoustics();
    const weather = emberActive() ? t(`When.weather.${state.weather === "other" ? "any" : state.weather}`) : t("State.NoEmber");
    const chips = [
      [state.night ? "fa-moon" : "fa-sun", t(state.night ? "State.Night" : "State.Day")],
      ["fa-cloud", weather],
      ["fa-swords", t(state.combat ? "State.Combat" : "State.NoCombat")],
      [state.inside ? "fa-house" : "fa-tree", t(state.inside ? "State.Inside" : "State.Outside")]
    ]
      .map(([i, l]) => `<span class="vp-chip">${icon(`fa-solid ${i}`)} ${esc(l)}</span>`)
      .join("");
    const live = new Map(this.engine.soundscape.describe().layers.map((l) => [l.id, l.active]));
    const layers = data.layers
      .map((l) => {
        const active = !!live.get(l.id);
        const on = l.enabled !== false;
        return `<div class="vp-layer">
          <span class="vp-dot ${active ? "on" : ""}" role="img" aria-label="${esc(t(active ? "Layer.Playing" : "Layer.Silent"))}" data-tooltip="${esc(t(active ? "Layer.Playing" : "Layer.Silent"))}"></span>
          <span class="vp-grow"><strong>${esc(l.label || t(`Kind.${l.kind}`))}</strong><small>${esc(whenSummary(l))}</small></span>
          ${toggle(on, `data-action="layerToggle" data-id="${esc(l.id)}" aria-label="${esc(l.label || t(`Kind.${l.kind}`))}"`)}
        </div>`;
      })
      .join("");
    const places = Object.keys(REVERB_PRESETS)
      .map((p) => `<option value="${p}" ${p === acoustics.place ? "selected" : ""}>${esc(t(`Place.${p}`))}</option>`)
      .join("");
    return `
      <div class="vp-chips">${chips}</div>
      <p class="vp-note">${t("Panel.StateHint")}</p>
      <h3 class="vp-h">${t("Panel.Layers")}</h3>
      ${layers || `<p class="vp-note">${t("Soundscape.Empty")}</p>`}
      <button type="button" class="vp-dashed" data-action="editLayers">${icon("fa-solid fa-pen")} ${t("Panel.EditLayers")}</button>
      <label class="vp-stack">${t("Panel.ScenePlace")}<select data-field="scenePlace">${places}</select></label>`;
  }

  /* -------------------------------------------- */
  /*  Réglages                                    */
  /* -------------------------------------------- */

  #settingsHtml() {
    const groups = SETTINGS_LAYOUT.map((g) => {
      const items = g.items
        .map(([key, kind, unit = ""]) => {
          const cfg = game.settings.settings.get(`${MODULE_ID}.${key}`);
          if (!cfg) return "";
          const v = game.settings.get(MODULE_ID, key);
          const label = t(`Settings.${key}.Name`);
          const hint = t(`Settings.${key}.Hint`);
          if (kind === "toggle") return `<div class="vp-toggle-row"><span class="vp-grow">${esc(label)}<small>${esc(hint)}</small></span>${toggle(!!v, `data-action="settingToggle" data-key="${key}" aria-label="${esc(label)}"`)}</div>`;
          if (kind === "choice") {
            const opts = Object.entries(cfg.choices ?? {})
              .map(([val, lab]) => `<button type="button" class="vp-segbtn ${val === v ? "on" : ""}" data-action="settingChoice" data-key="${key}" data-value="${esc(val)}" aria-pressed="${val === v}">${esc(game.i18n.localize(lab))}</button>`)
              .join("");
            return `<div class="vp-stack"><span>${esc(label)}</span><div class="vp-seg" role="group" aria-label="${esc(label)}">${opts}</div></div>`;
          }
          const r = cfg.range ?? { min: 0, max: 1, step: 0.05 };
          const pct = unit === "%";
          const show = pct ? Math.round(v * 100) : v;
          return `<label class="vp-row" data-tooltip="${esc(hint)}"><span class="vp-lbl wide">${esc(label)}</span>
            <input type="range" min="${pct ? r.min * 100 : r.min}" max="${pct ? r.max * 100 : r.max}" step="${pct ? Math.max(1, r.step * 100) : r.step}" value="${show}" data-field="setting:${key}" data-unit="${pct ? " %" : unit}" data-pct="${pct}">
            <output>${show}${pct ? " %" : unit}</output></label>`;
        })
        .join("");
      return `<section class="vp-settings-group"><h3>${t(`Panel.SettingsGroup.${g.title}`)}</h3><p class="vp-note">${t(g.scope === "world" ? "Panel.ScopeWorld" : "Panel.ScopeClient")}</p>${items}</section>`;
    }).join("");
    return `<button type="button" class="vp-link" data-action="settings">← ${t("Panel.Back")}</button><h2 class="vp-title">${t("Panel.Settings")}</h2>${groups}`;
  }

  /* -------------------------------------------- */
  /*  Modifications                               */
  /* -------------------------------------------- */

  #selected() {
    return selection.id ? canvas.scene?.sounds?.get(selection.id) ?? null : null;
  }

  async #setFlag(doc, changes) {
    const flags = {};
    for (const [k, v] of Object.entries(changes)) flags[`flags.${MODULE_ID}.sound.${k}`] = v;
    await doc.update(flags);
  }

  async #onField(el) {
    const field = el.dataset.field;
    const value = el.type === "range" || el.type === "number" ? Number(el.value) : el.value;
    const doc = this.#selected();

    if (field.startsWith("setting:")) {
      const key = field.slice(8);
      await game.settings.set(MODULE_ID, key, el.dataset.pct === "true" ? value / 100 : value);
      return;
    }
    if (field === "scenePlace") {
      const place = REVERB_PRESETS[value] ? value : "outdoor";
      await canvas.scene.setFlag(MODULE_ID, FLAG_ACOUSTICS, { place, wet: REVERB_PRESETS[place].wet });
      return;
    }
    if (field === "roomPlace" || field === "isolation") {
      const region = canvas.scene?.regions?.get(el.dataset.region);
      if (!region) return;
      const behaviors = region.behaviors?.contents ?? [...(region.behaviors ?? [])];
      const b = behaviors.find((x) => x.type === ACOUSTICS_BEHAVIOR);
      if (field === "isolation") {
        await b?.update({ "system.isolation": value / 100 });
        return;
      }
      if (!value) await b?.delete();
      else if (b) await b.update({ disabled: false, "system.place": value, "system.wet": null });
      else await region.createEmbeddedDocuments("RegionBehavior", [{ type: ACOUSTICS_BEHAVIOR, name: t("TypeName"), system: { place: value, wet: null, isolation: 0 } }]);
      return;
    }
    if (!doc) return;
    if (field === "label") return this.#setFlag(doc, { label: value });
    if (field === "radius") return doc.update({ radius: value * (canvas.dimensions?.distance || 1) });
    if (field === "volume") return doc.update({ volume: value / 100 });
    if (field === "intensity") return this.#setFlag(doc, { intensity: value / 100 });
    if (field === "sound") {
      const [kind, ref] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
      if (kind === "patch") return doc.update({ path: PROCEDURAL_PATH, [`flags.${MODULE_ID}.sound.patch`]: ref });
      return doc.update({ path: ref, [`flags.${MODULE_ID}.sound.patch`]: null });
    }
  }

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.#save();
    this.render();
  }

  static async #onTension(event, target) {
    await writeSoundscape({ tension: Number(target.dataset.value) || 0 });
    this.render();
  }

  static async #onShowAll() {
    await game.settings.set(MODULE_ID, "showAll", !setting("showAll", false));
    this.render();
  }

  static #onDock() {
    this.docked = !this.docked;
    this.#save();
    if (this.docked) this.dock();
    else this.setPosition({ left: Math.max(20, this.position.left - 120), top: 80, height: Math.min(720, window.innerHeight - 120) });
    this.render();
  }

  static #onSettings() {
    this.settingsOpen = !this.settingsOpen;
    this.render();
  }

  static #onWorkshop() {
    this.engine.openWorkshop?.();
  }

  static #onEditSound(event, target) {
    event.stopPropagation();
    this.engine.openWorkshop?.(target.dataset.patch);
  }

  static #onAddFile() {
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({ type: "audio", callback: async (path) => {
      await addLibraryFile(path);
      this.render();
    } }).browse();
  }

  static async #onRemoveFile(event, target) {
    event.stopPropagation();
    await removeLibraryFile(target.dataset.id);
    this.render();
  }

  static #onSelect(event, target) {
    selection.set(target.dataset.id);
  }

  static async #onToggleFlag(event, target) {
    const doc = this.#selected();
    if (!doc) return;
    const key = target.dataset.flag;
    await this.#setFlag(doc, { [key]: soundSettings(doc)[key] === false });
  }

  static async #onToggleHidden() {
    const doc = this.#selected();
    await doc?.update({ hidden: !doc.hidden });
  }

  static async #onIntensityAuto() {
    const doc = this.#selected();
    if (doc) await this.#setFlag(doc, { intensity: null });
  }

  static async #onIntensityFixed() {
    const doc = this.#selected();
    if (!doc) return;
    const patch = getPatch(soundPatch(doc));
    await this.#setFlag(doc, { intensity: patch?.fixed ?? 0.5 });
  }

  static #onShowField() {
    const id = selection.id;
    if (id) canvas.vesper?.showField?.(id);
  }

  static async #onDeleteSource() {
    const doc = this.#selected();
    if (!doc) return;
    selection.set(null);
    await doc.delete();
  }

  static #onFoundrySheet() {
    this.#selected()?.sheet?.render(true);
  }

  static #onDrawRoom() {
    try {
      ui.controls?.activate?.({ control: "regions", tool: "rectangle" });
    } catch {
      ui.notifications.info(t("Panel.DrawRoomHint"));
    }
  }

  static async #onLayerToggle(event, target) {
    const data = readSoundscape();
    const layers = data.layers.map((l) => (l.id === target.dataset.id ? { ...l, enabled: l.enabled === false } : l));
    await writeSoundscape({ layers });
    this.render();
  }

  static #onEditLayers() {
    this.engine.openSoundscape?.();
  }

  static async #onSettingToggle(event, target) {
    const key = target.dataset.key;
    await game.settings.set(MODULE_ID, key, !game.settings.get(MODULE_ID, key));
    this.render();
  }

  static async #onSettingChoice(event, target) {
    await game.settings.set(MODULE_ID, target.dataset.key, target.dataset.value);
    this.render();
  }

  /** La scène a changé (sons, Régions, paysage) : on redessine, sans casser une saisie en cours. */
  refresh() {
    if (!this.rendered) return;
    const active = document.activeElement;
    if (this.element?.contains(active) && active.matches("input[type=text], input[type=search]")) return;
    this.render();
  }
}

/** Icône et couleur d'un son procédural (pour la bibliothèque). */
function markerInfoForPatch(id) {
  const info = markerInfo({ path: PROCEDURAL_PATH, flags: { [MODULE_ID]: { sound: { patch: id } } }, getFlag: () => ({ patch: id }) });
  return { color: info.color, icon: info.iconClass };
}

/** Résumé des conditions d'une couche. */
function whenSummary(l) {
  const w = l.when ?? {};
  const parts = [];
  if (w.time && w.time !== "any") parts.push(t(`When.time.${w.time}`));
  if (w.weather && w.weather !== "any") parts.push(t(`When.weather.${w.weather}`));
  if (w.combat && w.combat !== "any") parts.push(t(`When.combat.${w.combat}`));
  if (w.place && w.place !== "any") parts.push(t(`When.place.${w.place}`));
  if ((w.tensionMin ?? 0) > 0 || (w.tensionMax ?? 3) < 3) parts.push(`${t("When.Tension")} ${t(`Tension.${w.tensionMin ?? 0}`)} → ${t(`Tension.${w.tensionMax ?? 3}`)}`);
  return parts.length ? parts.join(" · ") : t("Panel.Always");
}
