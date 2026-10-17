/**
 * Calque de Vesper : poser des sources sonores et voir comment le son se répand.
 *
 * Outils de la case Vesper :
 *   - « Sélectionner » : survol d'une source = carte de son champ sonore ; glisser = déplacer
 *     (la carte suit en direct) ; clic = la sélectionner (ses réglages s'ouvrent dans le panneau,
 *     une corbeille apparaît à côté du logo) ; clic droit = fenêtre de Foundry ;
 *   - « Carte du son » : le champ de toutes les sources de la scène à la fois.
 * Les sons se posent en les glissant depuis la bibliothèque du panneau.
 *
 * La carte : dégradé chaud là où le son arrive direct, froid là où il arrive étouffé par un mur ;
 * anneaux à -6, -12, -24 et -36 dB. Calculée avec le moteur du jeu, elle montre exactement ce que Vesper joue.
 *
 * Foundry v14 ne relaie pas les clics de la scène au calque : la souris est lue directement
 * sur l'élément HTML du canvas (comme dans Ember).
 */

import { MODULE_ID, setting, t } from "./constants.js";
import { RINGS, contourSegments, labelPoint, paintPixels, combineGrids, smoothGrid, SILENT_DB } from "./field.js";
import { soundPatch, isManaged, soundSettings } from "./spatial-engine.js";
import { selection } from "./selection.js";
import { libraryEntry, soundDataForEntry } from "./library.js";
import { getPatch } from "./patches.js";

export const LAYER_NAME = "vesper";

const BADGE_PX = 18;
const TRASH_PX = 14;
const CLICK_TOLERANCE = 6;
const COLOR_PATCH = 0xf2a23c;
const COLOR_FILE = 0xe8e2d4;
const COLOR_OFF = 0x7d7d7d;

/** Outil actif (compatible v12 et v13+). */
export function activeToolName() {
  const tool = ui.controls?.tool;
  if (typeof tool === "string") return tool;
  return tool?.name ?? ui.controls?.activeTool ?? null;
}

function activeControlName() {
  const control = ui.controls?.control;
  if (typeof control === "string") return control;
  return control?.name ?? ui.controls?.activeControl ?? null;
}

/** Codes des icônes Font Awesome utilisées par les sons (police chargée par Foundry). */
const GLYPHS = {
  "fa-fire": "\uf06d",
  "fa-fire-flame-simple": "\uf46a",
  "fa-wind": "\uf72e",
  "fa-cloud-rain": "\uf73d",
  "fa-water": "\uf773",
  "fa-droplet": "\uf043",
  "fa-bug": "\uf188",
  "fa-wave-square": "\uf83e",
  "fa-heart-pulse": "\uf21e",
  "fa-sliders": "\uf1de",
  "fa-music": "\uf001"
};

/** Couleur du badge selon le son. */
const COLORS = {
  fire: 0xf28c28,
  torch: 0xf2b23c,
  wind: 0xb8d4e3,
  rain: 0x5fa8e8,
  river: 0x3fb6c8,
  drips: 0x7fc4f0,
  crickets: 0x8fd16a,
  drone: 0xb07ae8,
  heartbeat: 0xe85a6a
};

/** Ce qu'affiche le logo d'un son : icône, couleur, nom. */
export function markerInfo(doc) {
  const id = soundPatch(doc);
  if (id) {
    const p = getPatch(id);
    const cls = String(p?.icon ?? "").split(" ").find((c) => GLYPHS[c]) ?? "fa-sliders";
    const label = customLabel(doc) || (p?.builtin ? game.i18n.localize(`VESPER.Synth.${id}`) : p?.label || id);
    return { glyph: GLYPHS[cls], iconClass: `fa-solid ${cls}`, color: COLORS[id] ?? COLOR_PATCH, label };
  }
  const file = String(doc.path ?? "").split("/").pop() || "—";
  let name = file.replace(/\.[a-z0-9]+$/i, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    /* nom laissé tel quel */
  }
  return { glyph: GLYPHS["fa-music"], iconClass: "fa-solid fa-music", color: COLOR_FILE, label: customLabel(doc) || name };
}

/** Nom donné à la source par le MJ (panneau), s'il y en a un. */
function customLabel(doc) {
  try {
    return String(soundSettings(doc).label ?? "").trim();
  } catch {
    return "";
  }
}

/** Icône de secours dessinée (haut-parleur et ondes), si la police d'icônes n'est pas chargée. */
function speakerIcon(r, color) {
  const g = new PIXI.Graphics();
  g.beginFill(color).drawPolygon([-r, -r * 0.35, -r * 0.45, -r * 0.35, r * 0.1, -r * 0.9, r * 0.1, r * 0.9, -r * 0.45, r * 0.35, -r, r * 0.35]).endFill();
  g.lineStyle(r * 0.18, color, 1);
  g.arc(r * 0.15, 0, r * 0.5, -0.8, 0.8);
  g.moveTo(r * 0.15 + Math.cos(-0.8) * r * 0.9, Math.sin(-0.8) * r * 0.9).arc(r * 0.15, 0, r * 0.9, -0.8, 0.8);
  return g;
}

/** Icône Font Awesome en texte PIXI, ou null si la police n'est pas disponible. */
function iconGlyph(glyph, size, color) {
  // La police doit être réellement chargée (Foundry l'utilise pour ses propres boutons)
  const loaded = new Set();
  try {
    for (const f of document.fonts ?? []) if (f.status === "loaded") loaded.add(String(f.family).replace(/["']/g, ""));
  } catch {
    return null;
  }
  const family = ["Font Awesome 6 Pro", "Font Awesome 6 Free", "Font Awesome 5 Free"].find((f) => loaded.has(f));
  if (!family) return null;
  const t = new PIXI.Text(glyph, { fontFamily: family, fontWeight: "900", fontSize: Math.round(size), fill: color });
  t.anchor.set(0.5);
  return t;
}

export function createVesperLayerClass({ engine }) {
  const InteractionLayer = foundry.canvas?.layers?.InteractionLayer ?? globalThis.InteractionLayer;

  return class VesperLayer extends InteractionLayer {
    markers = null;
    single = null;
    all = null;
    room = null;
    trash = null;

    #view = null;
    #press = null;
    #drag = null;
    #hover = null;
    #frame = null;
    #allTimer = null;
    #offSelection = null;
    #dropHint = null;

    static get layerOptions() {
      return foundry.utils.mergeObject(super.layerOptions, { name: LAYER_NAME, zIndex: 880 });
    }

    /* -------------------------------------------- */
    /*  Cycle de vie                                */
    /* -------------------------------------------- */

    async _draw(options) {
      await super._draw?.(options);
      this.all = this.addChild(this.#makeFieldContainer());
      this.single = this.addChild(this.#makeFieldContainer());
      this.room = this.addChild(new PIXI.Container());
      this.markers = this.addChild(new PIXI.Container());
      this.markers.visible = false;
      this.trash = this.addChild(new PIXI.Container());
      this.trash.visible = false;
      this.#offSelection = selection.on(() => this.refreshMarkers());
      const view = canvas.app?.view ?? canvas.app?.canvas;
      if (view?.addEventListener) {
        this.#view = view;
        view.addEventListener("pointerdown", this.#onDown);
        view.addEventListener("pointermove", this.#onMove);
        view.addEventListener("pointerup", this.#onUp);
        view.addEventListener("contextmenu", this.#onContext);
        view.addEventListener("pointerleave", this.#onLeave);
      }
      this.refreshMarkers();
    }

    async _tearDown(options) {
      const view = this.#view;
      view?.removeEventListener("pointerdown", this.#onDown);
      view?.removeEventListener("pointermove", this.#onMove);
      view?.removeEventListener("pointerup", this.#onUp);
      view?.removeEventListener("contextmenu", this.#onContext);
      view?.removeEventListener("pointerleave", this.#onLeave);
      this.#view = null;
      this.#offSelection?.();
      this.setDropHint(false);
      this.#press = this.#drag = this.#hover = null;
      clearTimeout(this.#allTimer);
      for (const c of [this.single, this.all]) this.#clearField(c);
      this.markers = this.single = this.all = null;
      return super._tearDown?.(options);
    }

    _activate() {
      super._activate?.();
      if (this.markers) this.markers.visible = game.user.isGM;
      this.refreshMarkers();
      this.refreshAll();
    }

    _deactivate() {
      super._deactivate?.();
      if (this.markers) this.markers.visible = false;
      this.#press = this.#drag = null;
      this.#setHover(null);
      this.#clearField(this.all);
    }

    /** La case Vesper est-elle ouverte, pour le MJ ? */
    #active() {
      return game.user.isGM && activeControlName() === LAYER_NAME;
    }

    /* -------------------------------------------- */
    /*  Repères des sources                         */
    /* -------------------------------------------- */

    refreshMarkers() {
      if (!this.markers) return;
      for (const c of this.markers.removeChildren()) c.destroy({ children: true });
      // Visibles dès que la case Vesper est ouverte, pour le MJ
      this.markers.visible = this.#active();
      this.#drawTrash();
      if (!this.markers.visible) return;
      const zoom = this.#zoom();
      for (const doc of canvas.scene?.sounds ?? []) this.markers.addChild(this.#marker(doc, zoom));
    }

    /** Corbeille ronde en haut à droite du logo sélectionné : un clic supprime la source. */
    #drawTrash() {
      if (!this.trash) return;
      for (const c of this.trash.removeChildren()) c.destroy({ children: true });
      const doc = selection.id ? canvas.scene?.sounds?.get(selection.id) : null;
      this.trash.visible = !!doc && this.#active() && !this.#drag;
      if (!this.trash.visible) return;
      const zoom = this.#zoom();
      const pos = this.#trashPoint(doc);
      this.trash.position.set(pos.x, pos.y);
      this.trash.scale.set(1 / zoom);
      const g = this.trash.addChild(new PIXI.Graphics());
      g.lineStyle(2, 0x15120e, 1).beginFill(0xc0392b, 1).drawCircle(0, 0, TRASH_PX).endFill();
      const glyph = iconGlyph("\uf2ed", TRASH_PX * 1.05, 0xffffff);
      if (glyph) this.trash.addChild(glyph);
      else {
        // Corbeille dessinée
        const d = this.trash.addChild(new PIXI.Graphics());
        const r = TRASH_PX * 0.5;
        d.lineStyle(2, 0xffffff, 1).moveTo(-r, -r * 0.55).lineTo(r, -r * 0.55).moveTo(-r * 0.3, -r * 0.55).lineTo(-r * 0.3, -r * 0.9).lineTo(r * 0.3, -r * 0.9).lineTo(r * 0.3, -r * 0.55);
        d.moveTo(-r * 0.75, -r * 0.4).lineTo(-r * 0.6, r).lineTo(r * 0.6, r).lineTo(r * 0.75, -r * 0.4);
      }
    }

    /** Position de la corbeille (scène) pour un son. */
    #trashPoint(doc) {
      const zoom = this.#zoom();
      return { x: doc.x + (BADGE_PX + 4) / zoom, y: doc.y - (BADGE_PX + 4) / zoom };
    }

    /** Le point (scène) est-il sur la corbeille ? */
    #onTrash(point) {
      const doc = selection.id ? canvas.scene?.sounds?.get(selection.id) : null;
      if (!doc || !this.trash?.visible) return false;
      const p = this.#trashPoint(doc);
      return Math.hypot(point.x - p.x, point.y - p.y) <= (TRASH_PX + 3) / this.#zoom();
    }

    /** Contour d'une pièce (Région) survolée dans le panneau. */
    highlightRegion(id) {
      if (!this.room) return;
      for (const c of this.room.removeChildren()) c.destroy({ children: true });
      const region = id ? canvas.scene?.regions?.get(id) : null;
      if (!region) return;
      const zoom = this.#zoom();
      const g = this.room.addChild(new PIXI.Graphics());
      const polys = region.polygons ?? region.object?.polygons ?? [];
      let top = null;
      for (const poly of polys) {
        const pts = poly?.points;
        if (!pts || pts.length < 6) continue;
        g.beginFill(0xf2a23c, 0.1).lineStyle(3 / zoom, 0xf2a23c, 0.95).drawPolygon(pts).endFill();
        for (let i = 0; i < pts.length; i += 2) if (!top || pts[i + 1] < top[1] || (pts[i + 1] === top[1] && pts[i] < top[0])) top = [pts[i], pts[i + 1]];
      }
      if (!top) return;
      const label = new PIXI.Text(region.name || "", { fontFamily: "Signika, sans-serif", fontSize: 13, fontWeight: "600", fill: 0x15120e });
      const pad = 6;
      const bg = new PIXI.Graphics().beginFill(0xf2a23c, 1).drawRoundedRect(-pad, -3, label.width + pad * 2, label.height + 6, (label.height + 6) / 2).endFill();
      const tag = new PIXI.Container();
      tag.addChild(bg, label);
      tag.scale.set(1 / zoom);
      tag.position.set(top[0], top[1] - (label.height + 12) / zoom);
      this.room.addChild(tag);
    }

    /** Affiche le champ d'une source (bouton « Voir son champ » du panneau). */
    showField(id) {
      this.#hover = null;
      this.#setHover(id);
    }

    /** Cadre en pointillés sur la carte pendant qu'on glisse un son depuis le panneau. */
    setDropHint(on) {
      if (!on) {
        this.#dropHint?.remove();
        this.#dropHint = null;
        return;
      }
      if (this.#dropHint || !this.#view) return;
      const r = this.#view.getBoundingClientRect();
      const el = document.createElement("div");
      el.className = "vesper-drop-hint";
      el.style.cssText = `left:${r.left + 12}px;top:${r.top + 12}px;width:${r.width - 24}px;height:${r.height - 24}px`;
      el.innerHTML = `<span>${t("Panel.DropHint")}</span>`;
      document.body.append(el);
      this.#dropHint = el;
    }

    /** Logo d'une source : badge rond, icône du son, nom en dessous. Taille constante à l'écran. */
    #marker(doc, zoom) {
      const info = markerInfo(doc);
      const hovered = doc.id === this.#hover || doc.id === selection.id;
      const off = doc.hidden || !doc.path;
      const m = new PIXI.Container();
      m.soundId = doc.id;
      m.position.set(doc.x, doc.y);
      m.scale.set(1 / zoom);

      const g = m.addChild(new PIXI.Graphics());
      const ring = off ? COLOR_OFF : info.color;
      if (hovered) g.beginFill(0xffffff, 0.25).drawCircle(0, 0, BADGE_PX + 7).endFill();
      g.lineStyle(3, ring, 1).beginFill(0x15120e, 0.88).drawCircle(0, 0, BADGE_PX).endFill();

      const icon = iconGlyph(info.glyph, BADGE_PX * 1.05, off ? COLOR_OFF : info.color);
      if (icon) m.addChild(icon);
      else m.addChild(speakerIcon(BADGE_PX * 0.55, off ? COLOR_OFF : info.color));

      const label = new PIXI.Text(info.label, {
        fontFamily: "Signika, sans-serif",
        fontSize: 13,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 3
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, BADGE_PX + 4);
      m.addChild(label);

      if (off || !isManaged(doc)) m.alpha = 0.6;
      return m;
    }

    /* -------------------------------------------- */
    /*  Carte du champ sonore                       */
    /* -------------------------------------------- */

    #makeFieldContainer() {
      const c = new PIXI.Container();
      c.sprite = c.addChild(new PIXI.Sprite());
      c.rings = c.addChild(new PIXI.Graphics());
      c.labels = c.addChild(new PIXI.Container());
      c.visible = false;
      return c;
    }

    #clearField(c) {
      if (!c) return;
      c.visible = false;
      const tex = c.sprite?.texture;
      if (tex && tex !== PIXI.Texture.EMPTY) {
        c.sprite.texture = PIXI.Texture.EMPTY;
        tex.destroy(true);
      }
      c.rings?.clear();
      for (const l of c.labels?.removeChildren() ?? []) l.destroy();
    }

    /** Affiche une grille (dégradé + anneaux) dans un conteneur. */
    #drawField(c, grid, { labels = true } = {}) {
      if (!c) return;
      this.#clearField(c);
      const canvasEl = document.createElement("canvas");
      canvasEl.width = grid.w;
      canvasEl.height = grid.h;
      const ctx2d = canvasEl.getContext("2d");
      const img = ctx2d.createImageData(grid.w, grid.h);
      paintPixels(grid, img.data);
      ctx2d.putImageData(img, 0, 0);
      const tex = PIXI.Texture.from(canvasEl);
      if (tex.baseTexture) tex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
      c.sprite.texture = tex;
      c.sprite.position.set(grid.x0 - grid.step / 2, grid.y0 - grid.step / 2);
      c.sprite.width = grid.w * grid.step;
      c.sprite.height = grid.h * grid.step;

      const zoom = this.#zoom();
      const taken = [];
      const smooth = smoothGrid(grid);
      for (const level of RINGS) {
        const segs = contourSegments(smooth, level);
        if (!segs.length) continue;
        // Contour sombre puis trait clair : lisible sur une carte claire comme sombre
        for (const [width, color, alpha] of [[3.2, 0x000000, 0.35], [1.4, 0xffffff, level === -6 ? 0.85 : 0.6]]) {
          c.rings.lineStyle(width / zoom, color, alpha);
          for (const s of segs) c.rings.moveTo(s[0], s[1]).lineTo(s[2], s[3]);
        }
        if (!labels) continue;
        const p = labelPoint(segs, taken, 18 / zoom);
        if (!p) continue;
        taken.push(p);
        const text = new PIXI.Text(`${level} dB`, {
          fontFamily: "Signika, sans-serif",
          fontSize: 13,
          fill: 0xffffff,
          stroke: 0x000000,
          strokeThickness: 3
        });
        text.anchor.set(0, 0.5);
        text.scale.set(1 / zoom);
        text.position.set(p[0] + 4 / zoom, p[1]);
        c.labels.addChild(text);
      }
      c.visible = true;
    }

    #zoom() {
      return canvas.stage?.scale?.x || 1;
    }

    /** Source survolée : sa carte (calcul fin). */
    #setHover(id) {
      if (id === this.#hover && id) return;
      this.#hover = id;
      this.refreshMarkers();
      if (!id) return this.#clearField(this.single);
      const doc = canvas.scene?.sounds?.get(id);
      if (!doc) return this.#clearField(this.single);
      this.#drawField(this.single, engine.spatial.field(engine.spatial.sourceOf(doc)));
    }

    /** Recalcule la carte survolée (murs, portes, Régions ou son modifiés). */
    refreshHover() {
      const id = this.#hover;
      this.#hover = null;
      this.#setHover(id);
    }

    /** Toutes les sources à la fois (calcul différé : plusieurs changements d'affilée = un seul calcul). */
    refreshAll() {
      clearTimeout(this.#allTimer);
      if (!this.#active() || !setting("showAll", false)) return this.#clearField(this.all);
      this.#allTimer = setTimeout(() => this.#computeAll(), 120);
    }

    #computeAll() {
      if (!this.all || !this.#active() || !setting("showAll", false)) return;
      const docs = (canvas.scene?.sounds ?? []).filter((d) => d.path && !d.hidden);
      if (!docs.length) return this.#clearField(this.all);
      const rect = canvas.dimensions.sceneRect ?? canvas.dimensions.rect;
      const area = { x0: rect.x, y0: rect.y, x1: rect.x + rect.width, y1: rect.y + rect.height };
      // Pas adapté à la taille de la scène (au plus ~40 000 points)
      const cell = canvas.dimensions.size;
      const step = Math.max(cell / 2, Math.sqrt((rect.width * rect.height) / 40000));
      let total = null;
      for (const doc of docs) {
        const g = engine.spatial.field(engine.spatial.sourceOf(doc, { relative: false }), { rect: area, step });
        if (!total) total = { ...g, db: new Float32Array(g.db.length).fill(SILENT_DB), muffle: new Float32Array(g.db.length) };
        combineGrids(total, g);
      }
      this.#drawField(this.all, total, { labels: false });
    }

    /* -------------------------------------------- */
    /*  Souris                                      */
    /* -------------------------------------------- */

    #toScene(clientX, clientY) {
      try {
        if (typeof canvas.canvasCoordinatesFromClient === "function") return canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
      } catch {
        /* repli ci-dessous */
      }
      const rect = this.#view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      return canvas.stage.toLocal(new PIXI.Point(clientX - rect.left, clientY - rect.top));
    }

    /** Source sous la souris (sa pastille). */
    #hit(point) {
      const grab = (BADGE_PX + 6) / this.#zoom();
      let best = null;
      let bestD = Infinity;
      for (const doc of canvas.scene?.sounds ?? []) {
        const d = Math.hypot(doc.x - point.x, doc.y - point.y);
        if (d <= grab && d < bestD) {
          best = doc.id;
          bestD = d;
        }
      }
      return best;
    }

    #onDown = (event) => {
      if ((event.button !== 0 && event.button !== 2) || !this.#active()) return;
      const point = this.#toScene(event.clientX, event.clientY);
      if (!point) return;
      if (event.button === 0 && this.#onTrash(point)) {
        this.#press = { x: event.clientX, y: event.clientY, point, trash: true, button: 0 };
        return;
      }
      this.#press = { x: event.clientX, y: event.clientY, point, id: this.#hit(point), button: event.button, tool: activeToolName() };
    };

    #onMove = (event) => {
      if (!this.#active()) return;
      const point = this.#toScene(event.clientX, event.clientY);
      if (!point) return;
      const press = this.#press;
      if (press?.id && press.button === 0) {
        if (!this.#drag && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE) {
          this.#drag = { id: press.id, point };
          this.#hover = press.id;
          if (this.trash) this.trash.visible = false;
        }
        if (this.#drag) {
          this.#drag.point = point;
          this.#scheduleDragField();
          return;
        }
      }
      if (!press) this.#setHover(this.#hit(point));
    };

    /** Pendant un glisser : repère et carte suivent la souris (calcul grossier, une fois par image). */
    #scheduleDragField() {
      if (this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = null;
        const drag = this.#drag;
        const doc = drag && canvas.scene?.sounds?.get(drag.id);
        if (!doc) return;
        const marker = this.markers?.children?.find((m) => m.soundId === drag.id);
        marker?.position.set(drag.point.x, drag.point.y);
        const src = { ...engine.spatial.sourceOf(doc), x: drag.point.x, y: drag.point.y };
        this.#drawField(this.single, engine.spatial.field(src, { fast: true }), { labels: false });
      });
    }

    #onUp = async (event) => {
      const press = this.#press;
      const drag = this.#drag;
      this.#press = null;
      this.#drag = null;
      if (!press || event.button !== press.button || !this.#active()) return;
      const point = this.#toScene(event.clientX, event.clientY);
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE;

      if (press.trash) {
        if (!moved && point && this.#onTrash(point)) {
          const doc = canvas.scene?.sounds?.get(selection.id);
          selection.set(null);
          this.#setHover(null);
          await doc?.delete();
        }
        return;
      }

      if (drag) {
        const doc = canvas.scene?.sounds?.get(drag.id);
        let { x, y } = point;
        if (event.shiftKey) ({ x, y } = this.#snap({ x, y }));
        await doc?.update({ x: Math.round(x), y: Math.round(y) });
        selection.set(drag.id);
        this.refreshHover();
        this.refreshMarkers();
        return;
      }
      if (moved || press.button !== 0) return;

      // Clic sur un logo : on le sélectionne (ses réglages s'ouvrent dans le panneau) ; ailleurs : on désélectionne
      selection.set(press.id ?? null);
    };

    #onContext = (event) => {
      if (!this.#active()) return;
      const point = this.#toScene(event.clientX, event.clientY);
      const id = point && this.#hit(point);
      if (!id) return;
      event.preventDefault();
      canvas.scene.sounds.get(id)?.sheet?.render(true);
    };

    #onLeave = () => {
      if (!this.#drag) this.#setHover(null);
    };

    #snap(point) {
      try {
        return canvas.grid.getCenterPoint(point);
      } catch {
        return point;
      }
    }

    /**
     * Pose un son de la bibliothèque (déposé depuis le panneau) et le sélectionne.
     * @param {{patch?:string, path?:string}} ref
     */
    async place(ref, point, { snap = false } = {}) {
      const entry = libraryEntry(ref);
      if (!entry) return null;
      const at = snap ? this.#snap(point) : point;
      const [doc] = await canvas.scene.createEmbeddedDocuments("AmbientSound", [soundDataForEntry(entry, at, canvas.dimensions.distance)]);
      if (doc) {
        selection.set(doc.id);
        this.#hover = null;
        this.#setHover(doc.id);
      }
      return doc;
    }
  };
}
