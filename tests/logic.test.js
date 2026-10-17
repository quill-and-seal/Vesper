import { test } from "node:test";
import { nearFactor } from "../scripts/audio/patch-player.js";
import assert from "node:assert/strict";
import { segmentsCross, pointInShape, polygonArea } from "../scripts/geometry.js";
import { distanceGain, airCutoff, toMeters, occlusion, direction, wallMaterial, MATERIAL_DEFAULTS, SENSE, DOOR, DOOR_STATE } from "../scripts/acoustics.js";
import { generateImpulse, REVERB_PRESETS } from "../scripts/audio/reverb-presets.js";
import { conditionsMatch, scatterEvents, eventsBetween, normalizeLayer, WINDOW_MS } from "../scripts/soundscape-logic.js";

const wall = (x1, y1, x2, y2, extra = {}) => ({ c: [x1, y1, x2, y2], sound: SENSE.NORMAL, door: DOOR.NONE, ds: DOOR_STATE.CLOSED, ...extra });

test("segments : croisement net, extrémité frôlée, parallèles", () => {
  assert.ok(segmentsCross(0, 0, 10, 0, 5, -5, 5, 5));
  assert.ok(!segmentsCross(0, 0, 10, 0, 10, -5, 10, 5)); // touche le bout du rayon
  assert.ok(!segmentsCross(0, 0, 10, 0, 0, 1, 10, 1));
  assert.ok(!segmentsCross(0, 0, 10, 0, 5, 1, 5, 5));
});

test("forme : trou et aire", () => {
  const outer = { points: [0, 0, 100, 0, 100, 100, 0, 100] };
  const hole = { points: [40, 40, 60, 40, 60, 60, 40, 60], isPositive: false };
  assert.ok(pointInShape(10, 10, [outer, hole]));
  assert.ok(!pointInShape(50, 50, [outer, hole]));
  assert.ok(!pointInShape(150, 50, [outer, hole]));
  assert.equal(polygonArea(outer.points), 10000);
});

test("distance : plein volume près, -6 dB par doublement, silence au rayon, sans saut", () => {
  const R = 1000;
  const ref = 100;
  assert.equal(distanceGain(50, R, ref), 1);
  const g200 = distanceGain(200, R, ref);
  const g400 = distanceGain(400, R, ref);
  assert.ok(Math.abs(g200 / g400 - 2) < 1e-9, "1/d");
  assert.equal(distanceGain(R, R, ref), 0);
  // Décroissance monotone et continue jusqu'au bord
  let prev = 1;
  for (let d = 0; d <= R; d += 5) {
    const g = distanceGain(d, R, ref);
    assert.ok(g <= prev + 1e-12, `monotone à ${d}`);
    assert.ok(prev - g < 0.05, `pas de saut à ${d}`);
    prev = g;
  }
  // Réalisme 0 : linéaire comme Foundry
  assert.ok(Math.abs(distanceGain(500, R, ref, 0) - 0.5) < 1e-9);
});

test("air : les aigus baissent avec la distance, plancher à 2,5 kHz", () => {
  assert.ok(airCutoff(0) > 19000);
  assert.ok(airCutoff(50) < airCutoff(10));
  assert.equal(airCutoff(10000), 2500);
  assert.ok(Math.abs(toMeters(5, "ft") - 1.524) < 1e-9);
  assert.equal(toMeters(1.5, "m"), 1.5);
});

test("matériaux : porte ouverte transparente, mur limité plus léger", () => {
  assert.equal(wallMaterial(wall(0, 0, 1, 1, { door: DOOR.DOOR, ds: DOOR_STATE.OPEN })), null);
  assert.equal(wallMaterial(wall(0, 0, 1, 1, { door: DOOR.DOOR })), MATERIAL_DEFAULTS.door);
  assert.equal(wallMaterial(wall(0, 0, 1, 1, { sound: SENSE.LIMITED })), MATERIAL_DEFAULTS.thin);
  assert.equal(wallMaterial(wall(0, 0, 1, 1, { sound: SENSE.NONE })), null);
});

test("occlusion : mur plein, porte, et fuite par une ouverture", () => {
  const L = { x: 0, y: 0 };
  const S = { x: 400, y: 0 };
  assert.deepEqual(occlusion(L, S, []).gain, 1);

  // Un long mur plein entre les deux : tous les rayons perdent 18 dB
  const solid = occlusion(L, S, [wall(200, -1000, 200, 1000)], { spread: 50 });
  assert.ok(Math.abs(20 * Math.log10(solid.gain) + 18) < 0.01, `mur ${solid.gain}`);
  assert.ok(solid.cutoff < 3000);

  // Porte fermée : moins de perte qu'un mur
  const door = occlusion(L, S, [wall(200, -1000, 200, 1000, { door: DOOR.DOOR })], { spread: 50 });
  assert.ok(door.gain > solid.gain);

  // Mur percé d'une ouverture au niveau d'un rayon décalé : le son filtre en partie
  // (le rayon visant y=50 croise le mur en y=25, dans l'ouverture 10–40)
  const gap = occlusion(L, S, [wall(200, -1000, 200, 10), wall(200, 40, 200, 1000)], { spread: 50 });
  assert.ok(gap.gain > solid.gain * 2, `fuite ${gap.gain}`);
  assert.ok(gap.gain < 1);

  // Source collée à un mur : les rayons décalés de l'autre côté du mur sont écartés
  const nearWall = occlusion(L, { x: 400, y: 0 }, [wall(420, -1000, 420, 1000)], { spread: 50 });
  assert.equal(nearWall.gain, 1);
});

test("direction : droite de l'écran = droite, au-dessus de la tête tout près", () => {
  const right = direction(100, 0, 10);
  assert.ok(right.pan > 0.8 && right.x > 0.99);
  const up = direction(0, -100, 10);
  assert.ok(up.z < -0.99, "haut de l'écran = devant (z négatif)");
  const close = direction(1, 0, 100);
  assert.ok(close.y > 0.99 && Math.abs(close.pan) < 0.02);
});

test("réverbération : réponses impulsionnelles stables, finies et de même énergie", () => {
  const energies = [];
  for (const [id, p] of Object.entries(REVERB_PRESETS)) {
    const ir = generateImpulse(p, 48000, 7);
    if (id === "none") {
      assert.equal(ir, null);
      continue;
    }
    assert.equal(ir.length, 2);
    let e = 0;
    for (const c of ir) for (const v of c) {
      assert.ok(Number.isFinite(v));
      e += v * v;
    }
    energies.push(e);
    // Décroissance : la fin est bien plus faible que le début
    const c = ir[0];
    const rms = (a, b) => Math.sqrt(c.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    const n = c.length;
    assert.ok(rms(n - 2000, n) < rms(0, Math.min(n, 4000)) * 0.05, `${id} décroît`);
  }
  const min = Math.min(...energies);
  const max = Math.max(...energies);
  assert.ok(max / min < 1.01, "même énergie pour tous les lieux");
  // Déterministe
  assert.deepEqual(generateImpulse(REVERB_PRESETS.cave, 8000, 3)[0].slice(0, 50), generateImpulse(REVERB_PRESETS.cave, 8000, 3)[0].slice(0, 50));
});

test("conditions des couches", () => {
  const base = { night: false, combat: false, weather: "clear", inside: false, tension: 0 };
  assert.ok(conditionsMatch({}, base));
  assert.ok(!conditionsMatch({ time: "night" }, base));
  assert.ok(conditionsMatch({ time: "night" }, { ...base, night: true }));
  assert.ok(conditionsMatch({ weather: "rain" }, { ...base, weather: "storm" }), "pluie inclut orage");
  assert.ok(!conditionsMatch({ weather: "storm" }, { ...base, weather: "rain" }));
  assert.ok(!conditionsMatch({ combat: "yes" }, base));
  assert.ok(!conditionsMatch({ place: "inside" }, base));
  assert.ok(!conditionsMatch({ tensionMin: 2 }, { ...base, tension: 1 }));
  assert.ok(conditionsMatch({ tensionMin: 2 }, { ...base, tension: 3 }));
  assert.ok(!conditionsMatch({ tensionMax: 1 }, { ...base, tension: 2 }));
});

test("sons dispersés : déterministes, dans les intervalles, sans doublon entre fenêtres", () => {
  const layer = normalizeLayer({ id: "abc", kind: "scatter", paths: ["a.ogg", "b.ogg", "c.ogg"], scatter: { min: 5, max: 10, spread: 1, distance: 0.5, pitch: 0.1 } });
  const a = scatterEvents(layer, "scene1", 42);
  const b = scatterEvents(layer, "scene1", 42);
  assert.deepEqual(a, b, "même calendrier pour tous les joueurs");
  assert.notDeepEqual(a, scatterEvents(layer, "scene2", 42));
  for (let i = 1; i < a.length; i++) {
    const gap = (a[i].time - a[i - 1].time) / 1000;
    assert.ok(gap >= 5 - 1e-9 && gap <= 10 + 1e-9);
  }
  for (const e of a) {
    assert.ok(e.index >= 0 && e.index < 3);
    assert.ok(e.pan >= -1 && e.pan <= 1);
    assert.ok(e.rate >= 0.9 && e.rate <= 1.1);
  }
  // Entre deux fenêtres : chaque événement n'apparaît qu'une fois
  const from = 42 * WINDOW_MS + WINDOW_MS - 3000;
  const ev = eventsBetween(layer, "scene1", from, from + 6000);
  assert.equal(new Set(ev.map((e) => e.key)).size, ev.length);
  for (const e of ev) assert.ok(e.time > from && e.time <= from + 6000);
  // Cadence moyenne cohérente (~7,5 s)
  let count = 0;
  for (let k = 0; k < 20; k++) count += scatterEvents(layer, "s", k).length;
  const mean = (20 * WINDOW_MS) / 1000 / count;
  assert.ok(mean > 6 && mean < 10, `intervalle moyen ${mean}`);
});

import { pval, nextInterval, eventAmp, normalizePatch, BUILTIN_PATCHES, BUILTIN_IDS, patchIntensity, modTargets, LIMITS, setCustomPatches, getPatch } from "../scripts/patches.js";

test("procédural : valeurs liées à l'intensité", () => {
  assert.equal(pval(5, 0.3), 5);
  assert.equal(pval({ a: 4, b: 18 }, 0), 4);
  assert.equal(pval({ a: 4, b: 18 }, 1), 18);
  assert.equal(pval({ a: 4, b: 18 }, 0.5), 11);
  assert.equal(pval({ a: 4, b: 18 }, 3), 18, "intensité bornée");
});

test("procédural : intervalles, métronome et hasard", () => {
  assert.equal(nextInterval(2, 1, 0.123), 0.5);
  // Moyenne du processus de Poisson ≈ 1/cadence
  let sum = 0;
  const n = 20000;
  for (let k = 1; k <= n; k++) sum += nextInterval(4, 0, (k - 0.5) / n);
  assert.ok(Math.abs(sum / n - 0.25) < 0.01);
  assert.equal(eventAmp(0.1, 0.5, 2, 0), 0.1);
  assert.equal(eventAmp(0.1, 0.5, 2, 1), 0.5);
  assert.ok(eventAmp(0, 1, 3, 0.5) < 0.2, "contraste : la plupart des événements sont petits");
});

test("procédural : les modèles livrés sont valides et intacts après nettoyage", () => {
  for (const id of BUILTIN_IDS) {
    const raw = BUILTIN_PATCHES[id];
    const p = normalizePatch(raw, id);
    assert.ok(p.layers.length > 0, id);
    assert.equal(p.layers.length, raw.layers.length, `${id} garde ses couches`);
    p.layers.forEach((l, i) => {
      assert.equal(l.mods.length, raw.layers[i].mods?.length ?? 0, `${id}/${l.id} garde ses modulations`);
      for (const m of l.mods) assert.ok(modTargets(l).includes(m.target));
      if (l.source.type === "events") assert.ok(pval(l.source.rate, 1) <= LIMITS.eventRate);
    });
    // Le nettoyage est stable
    assert.deepEqual(normalizePatch(p, id), p);
  }
});

test("procédural : une recette malveillante est bornée", () => {
  const p = normalizePatch({
    volume: 999,
    layers: Array.from({ length: 50 }, () => ({
      source: { type: "events", rate: 1e6, burstMax: 1e4, decay: -5 },
      filters: Array.from({ length: 20 }, () => ({ type: "evil", freq: 1e9 })),
      mods: [{ target: "filters.99.freq" }, { target: "gain", rate: 1e5, depth: 9 }],
      gain: "abc"
    }))
  });
  assert.equal(p.volume, 12);
  assert.equal(p.layers.length, LIMITS.layers);
  const l = p.layers[0];
  assert.equal(l.source.rate, LIMITS.eventRate);
  assert.equal(l.source.burstMax, LIMITS.burstMax);
  assert.equal(l.source.decay, 0.1);
  assert.equal(l.filters.length, LIMITS.filters);
  assert.equal(l.filters[0].type, "lowpass");
  assert.equal(l.filters[0].freq, 20000);
  assert.deepEqual(l.mods.map((m) => m.target), ["gain"]);
  assert.equal(l.mods[0].depth, 1);
  assert.equal(l.gain, 0.5);
});

test("procédural : intensité selon le vent, la pluie, la tension", () => {
  const fire = normalizePatch(BUILTIN_PATCHES.fire);
  assert.equal(patchIntensity(fire, { wind: 0.8 }), 0.8);
  assert.ok(Math.abs(patchIntensity(fire, { wind: 0, tension: 0 }) - fire.fixed) < 1e-9);
  assert.equal(patchIntensity(fire, { wind: 0.8 }, 0.1), 0.1, "réglage du son prioritaire");
  const rain = normalizePatch(BUILTIN_PATCHES.rain);
  assert.equal(patchIntensity(rain, { weather: "storm", weatherIntensity: 0.9 }), 0.9);
  assert.equal(patchIntensity(rain, { weather: "clear" }), rain.fixed);
  assert.equal(patchIntensity(normalizePatch(BUILTIN_PATCHES.heartbeat), { tension: 3 }), 1);
});

test("procédural : bibliothèque, les sons du MJ ne remplacent pas les modèles", () => {
  setCustomPatches({ "my-a": { label: "A", layers: [{ source: { type: "noise" } }] }, fire: { label: "pirate" } });
  assert.equal(getPatch("my-a").label, "A");
  assert.equal(getPatch("my-a").builtin, false);
  assert.equal(getPatch("fire").builtin, true);
  setCustomPatches({});
  assert.equal(getPatch("my-a"), null);
});



test("procédural : couches « seulement de près »", () => {
  assert.equal(nearFactor(0, 50), 1, "near = 0 : toujours");
  assert.equal(nearFactor(1, 0), 1);
  assert.equal(nearFactor(1, 1), 0);
  assert.equal(nearFactor(1, 3), 0);
  assert.equal(nearFactor(1, Infinity), 0, "sans source (paysage sonore) : muet");
  assert.ok(Math.abs(nearFactor(1, 0.5) - 0.25) < 1e-9, "monte vite en s'approchant");
  const fire = normalizePatch(BUILTIN_PATCHES.fire);
  assert.equal(fire.layers.find((l) => l.id === "roar").near, 1);
  assert.equal(fire.layers.find((l) => l.id === "crackle").near, 0);
});
