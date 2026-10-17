/**
 * Champ sonore : ce qu'on entendrait en chaque point autour d'une source.
 * Logique pure (aucune dépendance à Foundry ni à PIXI) : testable hors du jeu.
 *
 * La grille est calculée avec la même fonction d'écoute que le jeu (distance, murs, portes,
 * isolation des Régions, absorption de l'air) : la carte affichée est exactement ce que Vesper joue.
 */

/** Niveau plancher affiché (dB) : en dessous, transparent. */
export const FLOOR_DB = -54;

/** Anneaux affichés (dB par rapport à la source). */
export const RINGS = [-6, -12, -24, -36];

/** Silence (hors du rayon). */
export const SILENT_DB = -120;

/**
 * Grille du champ d'une source.
 * @param {(x:number, y:number) => {gain:number, occlusion:number}} hearAt  écoute en un point
 * @param {{x0:number, y0:number, x1:number, y1:number}} rect  zone à couvrir (scène)
 * @param {number} step  pas de la grille (px de scène)
 * @returns {{x0:number, y0:number, step:number, w:number, h:number, db:Float32Array, muffle:Float32Array}}
 */
export function computeGrid(hearAt, rect, step) {
  const w = Math.max(2, Math.ceil((rect.x1 - rect.x0) / step) + 1);
  const h = Math.max(2, Math.ceil((rect.y1 - rect.y0) / step) + 1);
  const db = new Float32Array(w * h).fill(SILENT_DB);
  const muffle = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = rect.y0 + j * step;
    for (let i = 0; i < w; i++) {
      const x = rect.x0 + i * step;
      const r = hearAt(x, y);
      if (!r || !(r.gain > 0)) continue;
      const k = j * w + i;
      db[k] = Math.max(SILENT_DB, 20 * Math.log10(r.gain));
      muffle[k] = mufflePart(r.occlusion);
    }
  }
  return { x0: rect.x0, y0: rect.y0, step, w, h, db, muffle };
}

/**
 * Part étouffée (0 = son direct, 1 = très étouffé) d'après le gain des murs et de l'isolation.
 * Un mur plein (-18 dB) donne 1.
 */
export function mufflePart(occlusionGain) {
  if (!(occlusionGain > 0)) return 1;
  if (occlusionGain >= 1) return 0;
  const loss = -20 * Math.log10(occlusionGain);
  return Math.min(1, loss / 18);
}

/**
 * Additionne plusieurs grilles de même géométrie (énergies) : « tout afficher ».
 * La part étouffée est la moyenne pondérée par l'énergie.
 */
export function combineGrids(target, grid, gainDb = 0) {
  const n = target.db.length;
  for (let k = 0; k < n; k++) {
    const b = grid.db[k];
    if (b <= SILENT_DB) continue;
    const eb = Math.pow(10, (b + gainDb) / 10);
    const a = target.db[k];
    const ea = a <= SILENT_DB ? 0 : Math.pow(10, a / 10);
    const e = ea + eb;
    target.muffle[k] = (target.muffle[k] * ea + grid.muffle[k] * eb) / e;
    target.db[k] = 10 * Math.log10(e);
  }
  return target;
}

/* -------------------------------------------- */
/*  Couleurs                                    */
/* -------------------------------------------- */

/** Dégradés : du plus faible au plus fort. */
const WARM = [
  [96, 18, 18],
  [196, 58, 22],
  [246, 146, 42],
  [255, 226, 140],
  [255, 250, 225]
];
const COOL = [
  [16, 26, 84],
  [32, 78, 168],
  [64, 150, 214],
  [150, 214, 240],
  [228, 246, 255]
];

function ramp(stops, t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Couleur d'un point : teinte chaude pour le son direct, froide pour le son étouffé,
 * claire et opaque près de la source, sombre et transparente vers le bord.
 * @returns {[number, number, number, number]} r, g, b (0-255), alpha (0-1)
 */
export function colorAt(db, muffle) {
  if (db <= FLOOR_DB) return [0, 0, 0, 0];
  const t = (db - FLOOR_DB) / -FLOOR_DB;
  const w = ramp(WARM, t);
  const c = ramp(COOL, t);
  const m = Math.min(1, Math.max(0, muffle));
  const alpha = Math.min(0.75, 0.1 + 0.62 * Math.pow(t, 0.75));
  return [w[0] + (c[0] - w[0]) * m, w[1] + (c[1] - w[1]) * m, w[2] + (c[2] - w[2]) * m, alpha];
}

/** Remplit un tableau RGBA (ImageData) avec la grille, un pixel par point. */
export function paintPixels(grid, data) {
  for (let k = 0; k < grid.db.length; k++) {
    const [r, g, b, a] = colorAt(grid.db[k], grid.muffle[k]);
    data[k * 4] = r;
    data[k * 4 + 1] = g;
    data[k * 4 + 2] = b;
    data[k * 4 + 3] = Math.round(a * 255);
  }
  return data;
}

/* -------------------------------------------- */
/*  Anneaux (marching squares)                  */
/* -------------------------------------------- */

/**
 * Grille lissée (moyenne 3 × 3 des niveaux audibles) pour tracer des anneaux sans îlots ni dents.
 * Les points silencieux restent silencieux : le bord du rayon ne bave pas.
 */
export function smoothGrid(grid) {
  const { w, h, db } = grid;
  const out = new Float32Array(db.length);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (db[k] <= SILENT_DB) {
        out[k] = SILENT_DB;
        continue;
      }
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const v = db[y * w + x];
          if (v <= SILENT_DB) continue;
          sum += v;
          n++;
        }
      }
      out[k] = sum / n;
    }
  }
  return { ...grid, db: out };
}

/**
 * Segments de la courbe de niveau « level » (dB), en coordonnées de scène.
 * @returns {number[][]} liste de segments [x1, y1, x2, y2]
 */
export function contourSegments(grid, level) {
  const { w, h, db, x0, y0, step } = grid;
  const out = [];
  const lerp = (a, b) => (level - a) / (b - a || 1e-9);
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const tl = db[j * w + i];
      const tr = db[j * w + i + 1];
      const br = db[(j + 1) * w + i + 1];
      const bl = db[(j + 1) * w + i];
      const c = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const x = x0 + i * step;
      const y = y0 + j * step;
      // Points sur les arêtes : haut, droite, bas, gauche
      const T = [x + lerp(tl, tr) * step, y];
      const R = [x + step, y + lerp(tr, br) * step];
      const B = [x + lerp(bl, br) * step, y + step];
      const L = [x, y + lerp(tl, bl) * step];
      const seg = (p, q) => out.push([p[0], p[1], q[0], q[1]]);
      switch (c) {
        case 1: case 14: seg(L, B); break;
        case 2: case 13: seg(B, R); break;
        case 3: case 12: seg(L, R); break;
        case 4: case 11: seg(T, R); break;
        case 6: case 9: seg(T, B); break;
        case 7: case 8: seg(L, T); break;
        case 5: seg(L, T); seg(B, R); break;
        case 10: seg(T, R); seg(L, B); break;
      }
    }
  }
  return out;
}

/**
 * Point où poser l'étiquette d'un anneau : le plus à droite possible, sans toucher les étiquettes déjà posées.
 * @param {number[][]} segments
 * @param {number[][]} [taken]   étiquettes déjà posées [x, y]
 * @param {number} [gap]         écart minimal entre deux étiquettes (px de scène)
 */
export function labelPoint(segments, taken = [], gap = 0) {
  const pts = [];
  for (const s of segments) pts.push([s[0], s[1]], [s[2], s[3]]);
  pts.sort((a, b) => b[0] - a[0]);
  for (const p of pts) if (!taken.some((q) => Math.abs(q[0] - p[0]) < gap * 2.2 && Math.abs(q[1] - p[1]) < gap)) return p;
  return null;
}
