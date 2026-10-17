/**
 * Vesper — son immersif pour Foundry VTT v14.
 * Point d'entrée : réglages, hooks, socket et API publique.
 */

import { MODULE_ID, SOCKET, log, t } from "./constants.js";
import { AudioOutput } from "./audio/output.js";
import { SpatialEngine, isManaged } from "./spatial-engine.js";
import { Soundscape, readSoundscape, writeSoundscape } from "./soundscape.js";
import { registerRegionBehavior } from "./region-behavior.js";
import { registerAmbientSoundClass } from "./ambient-sound.js";
import { SoundscapeConfig, openApps, injectAmbientSoundConfig, TEMPLATES } from "./apps.js";
import { REVERB_PRESETS } from "./audio/reverb-presets.js";
import { SYNTH_TYPES } from "./audio/synth.js";
import { setCustomPatches, getPatch, allPatches, customPatches, normalizePatch } from "./patches.js";
import { Workshop } from "./workshop.js";

const out = new AudioOutput();
const spatial = new SpatialEngine(out);
const soundscape = new Soundscape(out, spatial);
spatial.afterUpdate = () => soundscape.update();

/** Moteur exposé aux fenêtres. */
const engine = { out, spatial, soundscape };

/** Relance tout après un changement de réglage. */
function resync() {
  if (!out.ctx || !canvas.ready) return;
  spatial.sync();
  soundscape.sync();
  canvas.sounds?.refresh?.({ fade: 0 });
}

/* -------------------------------------------- */
/*  Initialisation                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  log("Initialisation");

  const world = (key, type, def, extra = {}) =>
    game.settings.register(MODULE_ID, key, {
      name: `VESPER.Settings.${key}.Name`,
      hint: `VESPER.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      type,
      default: def,
      onChange: resync,
      ...extra
    });
  const client = (key, type, def, extra = {}) => world(key, type, def, { scope: "client", ...extra });

  world("takeover", Boolean, true);
  world("realism", Number, 1, { range: { min: 0, max: 1, step: 0.05 } });
  world("airAbsorption", Boolean, true);
  world("wallLoss", Number, 18, { range: { min: 0, max: 40, step: 1 } });
  world("doorLoss", Number, 9, { range: { min: 0, max: 30, step: 1 } });
  world("thinLoss", Number, 4, { range: { min: 0, max: 20, step: 1 } });
  world("defaultPlace", String, "outdoor", {
    choices: Object.fromEntries(Object.keys(REVERB_PRESETS).map((k) => [k, `VESPER.Place.${k}`]))
  });
  world("gmListener", String, "camera", { choices: { camera: "VESPER.Settings.gmListener.Camera", none: "VESPER.Settings.gmListener.None" } });

  client("panning", String, "hrtf", {
    choices: { hrtf: "VESPER.Settings.panning.Hrtf", stereo: "VESPER.Settings.panning.Stereo", off: "VESPER.Settings.panning.Off" }
  });
  client("occlusionQuality", String, "high", {
    choices: { high: "VESPER.Settings.occlusionQuality.High", low: "VESPER.Settings.occlusionQuality.Low" }
  });
  client("masterVolume", Number, 1, { range: { min: 0, max: 1.5, step: 0.05 }, onChange: () => out.updateVolume() });
  client("spatialVolume", Number, 1, { range: { min: 0, max: 1.5, step: 0.05 }, onChange: () => out.updateVolume() });
  client("soundscapeVolume", Number, 1, { range: { min: 0, max: 1.5, step: 0.05 }, onChange: () => out.updateVolume() });
  client("reverbVolume", Number, 1, { range: { min: 0, max: 2, step: 0.05 }, onChange: () => out.updateVolume() });
  client("soundscape", Boolean, true, { onChange: () => soundscape.update() });

  // Sons créés dans l'atelier : partagés avec tous les joueurs
  game.settings.register(MODULE_ID, "patches", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: (value) => {
      setCustomPatches(value);
      soundscape.sync();
      for (const app of openApps) app.onSceneChanged?.();
      for (const app of Workshop.open) app.onPatchesChanged();
    }
  });

  registerRegionBehavior();
  registerAmbientSoundClass();

  // API publique : game.modules.get("vesper-audio").api
  game.modules.get(MODULE_ID).api = {
    engine,
    places: REVERB_PRESETS,
    synths: SYNTH_TYPES,
    templates: TEMPLATES,
    isManaged,
    /** Joue un son depuis un point de la scène, pour tout le monde (ou localement avec emit: false). */
    playAt: (src, origin, options = {}) => playAt(src, origin, options),
    getSoundscape: (scene) => readSoundscape(scene),
    setSoundscape: (changes, scene) => writeSoundscape(changes, scene),
    getTension: (scene) => readSoundscape(scene).tension,
    setTension: (level, scene) => writeSoundscape({ tension: Math.max(0, Math.min(3, Number(level) || 0)) }, scene),
    openSoundscape: () => new SoundscapeConfig(engine).render({ force: true }),
    openWorkshop: (patchId) => new Workshop(engine, { patchId }).render({ force: true }),
    /** Sons procéduraux : modèles livrés et sons de l'atelier. */
    getPatch,
    allPatches,
    /** Ajoute ou remplace un son de l'atelier (MJ). */
    savePatch: async (id, patch) => {
      const map = Object.fromEntries(Object.entries(customPatches()).map(([k, p]) => [k, JSON.parse(JSON.stringify({ ...p, builtin: undefined, icon: undefined, id: undefined }))]));
      const clean = normalizePatch(patch, id);
      delete clean.id;
      map[id] = clean;
      await game.settings.set(MODULE_ID, "patches", map);
    },
    describe: () => ({ ...spatial.describe(), soundscape: soundscape.describe() })
  };
});

/* -------------------------------------------- */
/*  Son ponctuel pour tous (socket)             */
/* -------------------------------------------- */

async function playAt(src, origin, { emit = true, ...options } = {}) {
  if (emit) game.socket.emit(SOCKET, { action: "playAt", src, origin, options });
  return spatial.playAt(src, origin, options);
}

// Les réglages du monde sont lus : on charge les sons de l'atelier
Hooks.once("setup", () => {
  try {
    setCustomPatches(game.settings.get(MODULE_ID, "patches"));
  } catch {
    setCustomPatches({});
  }
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, (msg) => {
    if (msg?.action === "playAt") spatial.playAt(msg.src, msg.origin, msg.options ?? {});
  });
});

/* -------------------------------------------- */
/*  Contrôles de scène : bouton dans « Sons »   */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const button = (fn) => ({ button: true, onChange: fn });
  const tools = {
    soundscape: {
      name: "soundscape",
      title: "VESPER.Controls.Soundscape",
      icon: "fa-solid fa-tree",
      order: 0,
      ...button(() => new SoundscapeConfig(engine).render({ force: true }))
    },
    workshop: {
      name: "workshop",
      title: "VESPER.Controls.Workshop",
      icon: "fa-solid fa-flask",
      order: 1,
      ...button(() => new Workshop(engine).render({ force: true }))
    }
  };
  // Sa propre case dans la barre de gauche, à côté des Sons de Foundry
  const order = (Array.isArray(controls) ? null : controls.sounds?.order) ?? Object.keys(controls).length;
  const control = {
    name: "vesper",
    title: "VESPER.Controls.Group",
    icon: "fa-solid fa-ear-listen",
    order: order + 0.5,
    visible: true,
    activeTool: "soundscape"
  };
  if (Array.isArray(controls)) controls.push({ ...control, tools: Object.values(tools) });
  else controls.vesper = { ...control, tools };
});

/* -------------------------------------------- */
/*  Synchronisation avec la scène               */
/* -------------------------------------------- */

function refreshApps() {
  for (const app of openApps) app.onSceneChanged?.();
}

Hooks.on("canvasReady", () => {
  out.init();
  spatial.sync();
  soundscape.sync();
  refreshApps();
});

Hooks.on("canvasTearDown", () => {
  spatial.clear();
  soundscape.clear();
});

// Murs posés, déplacés, portes ouvertes ou fermées (petit délai : Foundry met d'abord à jour ses murs)
let wallsTimer = null;
for (const hook of ["createWall", "updateWall", "deleteWall"]) {
  Hooks.on(hook, (wall) => {
    if (wall.parent?.id !== canvas.scene?.id) return;
    clearTimeout(wallsTimer);
    wallsTimer = setTimeout(() => spatial.refreshWalls(), 30);
  });
}

// Régions « Acoustique »
let regionsTimer = null;
const onRegionChange = (doc) => {
  const scene = doc.parent?.documentName === "Scene" ? doc.parent : doc.parent?.parent;
  if (scene?.id !== canvas.scene?.id) return;
  clearTimeout(regionsTimer);
  regionsTimer = setTimeout(() => spatial.refreshZones(), 50);
};
for (const hook of ["createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
  Hooks.on(hook, onRegionChange);
}

// Sons d'ambiance
for (const hook of ["createAmbientSound", "updateAmbientSound", "deleteAmbientSound"]) {
  Hooks.on(hook, (doc) => {
    if (doc.parent?.id !== canvas.scene?.id) return;
    spatial.refreshSounds();
  });
}

// Paysage sonore, acoustique de la scène, météo et vent d'Ember
Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || foundry.utils.hasProperty(changes, `flags.-=${MODULE_ID}`)) {
    spatial.refreshZones();
    soundscape.sync();
  }
  if (foundry.utils.hasProperty(changes, "grid")) spatial.sync();
  refreshApps();
});

// Combat : les couches « en combat » entrent sans attendre
for (const hook of ["combatStart", "updateCombat", "deleteCombat"]) {
  Hooks.on(hook, () => {
    soundscape.update();
    refreshApps();
  });
}

// Fenêtre d'un son d'ambiance : réglages Vesper
Hooks.on("renderAmbientSoundConfig", (app, html) => injectAmbientSoundConfig(app, html));

Hooks.once("ready", () => {
  log(`Prêt — ${Object.keys(REVERB_PRESETS).length} lieux acoustiques, ${SYNTH_TYPES.length} couches générées.`);
  if (game.user.isGM && !game.modules.get("ember-particles")?.active) log(t("Log.NoEmber"));
});
