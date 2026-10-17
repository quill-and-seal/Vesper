/**
 * Géométrie pure (aucune dépendance à Foundry) : testable hors du jeu.
 */

/**
 * Les segments [a,b] et [c,d] se croisent-ils (au sens strict, sans toucher les extrémités) ?
 * Un rayon qui frôle le bout d'un mur ne compte pas : le son contourne le coin.
 */
export function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return false; // parallèles ou colinéaires
  const qpX = cx - ax;
  const qpY = cy - ay;
  const tA = (qpX * sY - qpY * sX) / denom;
  const tC = (qpX * rY - qpY * rX) / denom;
  const eps = 1e-6;
  return tA > eps && tA < 1 - eps && tC > eps && tC < 1 - eps;
}

/** Aire d'un polygone donné en tableau plat [x0,y0,x1,y1,…] (valeur absolue). */
export function polygonArea(points) {
  let a = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += points[i] * points[j + 1] - points[j] * points[i + 1];
  }
  return Math.abs(a) / 2;
}

/** Point dans un polygone plat [x0,y0,…] (règle pair-impair). */
export function pointInPolygon(x, y, points) {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = points[i];
    const yi = points[i + 1];
    const xj = points[j];
    const yj = points[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Point dans une forme faite de plusieurs polygones, certains étant des trous.
 * @param {{points:number[], isPositive?:boolean}[]} polygons
 */
export function pointInShape(x, y, polygons) {
  let inside = false;
  for (const poly of polygons) {
    const pts = poly?.points;
    if (!pts || pts.length < 6) continue;
    if (!pointInPolygon(x, y, pts)) continue;
    if (poly.isPositive === false) return false; // dans un trou
    inside = true;
  }
  return inside;
}

/** Distance entre deux points. */
export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}
