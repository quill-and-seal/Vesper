/**
 * Palette : le son que l'outil « Poser » de Vesper place sur la scène.
 * Un son procédural (modèle ou son de l'atelier) ou un fichier audio, avec son rayon et son volume.
 * Le choix est propre à chaque MJ (réglage client).
 */

import { MODULE_ID, t, esc } from "./constants.js";
import { allPatches, BUILTIN_IDS } from "./patches.js";
import { patchLabel } from "./workshop.js";
import { placeChoice } from "./layer.js";

const { ApplicationV2 } = foundry.applications.api;

/** Rayons proposés par défaut selon le son (en cases). */
const DEFAULT_RADIUS = { fire: 6, torch: 4, river: 10, drips: 5, crickets: 8, wind: 12, rain: 15, drone: 10, heartbeat: 4 };

export class Palette extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-palette`,
    tag: "form",
    classes: ["vesper", "vesper-palette"],
    window: { icon: "fa-solid fa-palette", resizable: true },
    position: { width: 460, height: "auto" },
    form: { handler: Palette.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      choose: Palette.#onChoose,
      pickFile: Palette.#onPickFile
    }
  };

  get title() {
    return t("Palette.Title");
  }

  async _renderHTML() {
    const c = placeChoice();
    const patches = allPatches();
    const ids = [...BUILTIN_IDS, ...Object.keys(patches).filter((id) => !patches[id].builtin)];
    const card = (id) => {
      const p = patches[id];
      const on = c.source === "patch" && c.patch === id;
      return `<button type="button" class="vp-card ${on ? "active" : ""}" data-action="choose" data-patch="${esc(id)}">
        <i class="${esc(p.icon ?? "fa-solid fa-sliders")}"></i><span>${esc(patchLabel(id))}</span></button>`;
    };
    const fileOn = c.source === "file";
    const div = document.createElement("div");
    div.className = "vesper-body";
    div.innerHTML = `
      <p class="notes">${t("Palette.Hint")}</p>
      <div class="vp-grid">${ids.map(card).join("")}
        <button type="button" class="vp-card ${fileOn ? "active" : ""}" data-action="pickFile">
          <i class="fa-solid fa-file-audio"></i><span>${esc(fileOn && c.path ? c.path.split("/").pop() : t("Palette.File"))}</span>
        </button>
      </div>
      <div class="vp-row">
        <label>${t("Palette.Radius")} <input type="number" name="radius" value="${Number(c.radius)}" min="0.5" max="100" step="0.5"> <small>${t("Workshop.Cells")}</small></label>
        <label>${t("Palette.Volume")} <input type="range" name="volume" value="${Number(c.volume)}" min="0" max="1" step="0.05"></label>
      </div>`;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  async #save(changes) {
    await game.settings.set(MODULE_ID, "placeChoice", { ...placeChoice(), ...changes });
    this.render();
  }

  /** Passe à l'outil « Poser » de la case Vesper. */
  static #usePlaceTool() {
    try {
      ui.controls?.activate?.({ control: "vesper", tool: "place" });
    } catch {
      /* ancienne interface : l'outil reste à choisir à la main */
    }
  }

  static async #onSubmit(event, form, formData) {
    const o = formData.object ?? {};
    await this.#save({ radius: Number(o.radius) || 6, volume: Number(o.volume) });
  }

  static async #onChoose(event, target) {
    const patch = target.dataset.patch;
    const c = placeChoice();
    // Un rayon adapté au son, sauf si le MJ l'a déjà réglé pour ce son
    const radius = c.source === "patch" && c.patch === patch ? c.radius : DEFAULT_RADIUS[patch] ?? c.radius;
    await this.#save({ source: "patch", patch, radius });
    Palette.#usePlaceTool();
  }

  static async #onPickFile() {
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "audio",
      current: placeChoice().path,
      callback: async (path) => {
        await this.#save({ source: "file", path });
        Palette.#usePlaceTool();
      }
    }).browse();
  }
}
