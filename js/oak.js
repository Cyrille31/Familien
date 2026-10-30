// Vue « chêne » : l'arbre dessiné comme une gravure ancienne.
// Ancêtres dans les racines, enfants dans les branches, dernière génération dans
// les feuilles ; la personne choisie est gravée sur un cartouche du tronc.

import { layoutTree, layoutAncestorsClose, buildAncestors, buildDescendants } from './tree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const INK = '#3b2a1a';
const TRUNK_H = 330;      // hauteur du tronc (sol à y = 0)
const UP = 150;           // écart entre générations dans la ramure
const DOWN = 128;         // écart entre générations dans les racines
const LEAF_L = 182, LEAF_H = 84;
const NODE_W = 166;

// ---------- Outils ----------

export function el(name, attrs = {}, parent) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function text(parent, x, y, str, cls, attrs = {}) {
  const t = el('text', { x, y, class: cls, ...attrs }, parent);
  t.textContent = str;
  return t;
}

// Aléatoire reproductible : le même arbre est toujours dessiné de la même façon.
export function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const fit = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
export const f2 = (n) => Math.round(n * 10) / 10;

export function lifeSpan(p) {
  const b = p.birthYear, d = p.deathYear;
  if (b && d) return `${b} – ${d}`;
  if (b) return p.deceased ? `${b} – †` : `né${p.sex === 'F' ? 'e' : ''} en ${b}`;
  if (d) return `† ${d}`;
  return '';
}

function spouseLine(db, ids) {
  const names = ids.map((id) => db.get(id)?.name).filter(Boolean);
  return names.length ? '∞ ' + names.join(', ') : '';
}

// Nervures réparties comme sur un cylindre vu de face : jusqu'aux bords, et plus
// serrées sur les bords qu'au centre.
export const cyl = (m) => Array.from({ length: m }, (_, j) => 0.5 * Math.sin(-Math.PI / 2 + (Math.PI * (j + 0.5)) / m));
const smooth = (t) => t * t * (3 - 2 * t);

// Nervures d'une pièce de bois (tronc, branche ou racine) décrite par son axe `pts`,
// ses perpendiculaires `perp` et sa largeur `width(t)`. Chaque nervure passe de la
// position `from[j]` à `to[j]` (positions relatives, -0,5 … 0,5) selon `mix(t)`.
// Ondulations douces (nulles aux extrémités, pour des raccords parfaits) et, sur le
// bois épais, un nœud à cernes que les nervures contournent. Aucune nervure ne
// croise sa voisine : chaque déformation conserve leur ordre.
export function drawGrain(lineG, knotG, pts, perp, width, from, to, mix, seed, opts = {}) {
  const n = pts.length - 1, r = rng('g' + seed);
  let L = 0;
  for (let i = 1; i <= n; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const A = 0.045, freq = 1 + r() * 1.8, ph = r() * 2 * Math.PI;
  const knots = [];
  for (const [t0, t1] of opts.knotT || [[0.3, 0.75]]) {
    if (Math.min(width(0), width(1)) < (opts.knotMin || 18) || L < 110 || r() >= (opts.knotChance ?? 0.5)) continue;
    const t = t0 + r() * (t1 - t0), w = width(t), rho = opts.rho || 0.09 + r() * 0.05;
    // Le nœud doit s'estomper avant les extrémités : les raccords restent parfaits
    const sig = Math.min(Math.max(0.02, (rho * w * 2.6) / L), Math.min(t, 1 - t) / 2.8);
    knots.push({ t, u: (r() - 0.5) * 0.34, rho, w, sig });
  }
  const shape = (u0, u1, t) => {
    let u = u0 + (u1 - u0) * mix(t);
    u += A * Math.sin(2 * Math.PI * freq * t + ph) * Math.sin(Math.PI * t) * (1 - 4 * u * u);
    for (const knot of knots) {
      const c = knot.rho * Math.exp(-(((t - knot.t) / knot.sig) ** 2));
      const d = u - knot.u;
      u = knot.u + (d < 0 ? -1 : 1) * Math.sqrt(d * d + c * c);
    }
    return Math.max(-0.497, Math.min(0.497, u));
  };
  from.forEach((u0, j) => {
    const q = pts.map((p, i) => {
      const t = i / n, u = shape(u0, to[j], t), w = width(t);
      return { x: p.x + perp[i].x * u * w, y: p.y + perp[i].y * u * w };
    });
    // Prolongée d'un pixel à chaque bout : se superpose à la nervure voisine (tronc ↔ branche)
    const ext = (a, b) => { const l = Math.hypot(a.x - b.x, a.y - b.y) || 1; return { x: a.x + (a.x - b.x) / l, y: a.y + (a.y - b.y) / l }; };
    q.unshift(ext(q[0], q[1]));
    q.push(ext(q[q.length - 1], q[q.length - 2]));
    el('path', { d: 'M' + q.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L') }, lineG);
  });
  for (const knot of knots) {
    const i = Math.round(knot.t * n), q = perp[i];
    const c = { x: pts[i].x + q.x * knot.u * knot.w, y: pts[i].y + q.y * knot.u * knot.w };
    const ang = (Math.atan2(-q.x, q.y) * 180) / Math.PI; // direction du bois
    const g = el('g', { transform: `translate(${f2(c.x)} ${f2(c.y)}) rotate(${f2(ang)})` }, knotG);
    const rx = knot.sig * L * 0.95, ry = knot.rho * knot.w * 0.9;
    for (const k of [1, 0.72, 0.46]) el('ellipse', { cx: 0, cy: 0, rx: f2(rx * k), ry: f2(ry * k) }, g);
    el('ellipse', { cx: 0, cy: 0, rx: f2(rx * 0.2), ry: f2(ry * 0.22), class: 'core' }, g);
  }
}

// Ondulation douce de l'axe d'une branche, nulle (et à pente nulle) aux deux bouts.
export function wave(pts, seed, amp) {
  const n = pts.length - 1, r = rng('w' + seed), f = 1 + r() * 1.5, ph = r() * 2 * Math.PI;
  return pts.map((p, i) => {
    const q = pts[Math.min(i + 1, n)], s = pts[Math.max(i - 1, 0)];
    const dx = q.x - s.x, dy = q.y - s.y, len = Math.hypot(dx, dy) || 1, t = i / n;
    const a = amp * Math.sin(2 * Math.PI * f * t + ph) * Math.sin(Math.PI * t) ** 2;
    return { x: p.x - (dy / len) * a, y: p.y + (dx / len) * a };
  });
}

export const perpendiculars = (pts) => pts.map((p, i) => {
  const n = pts.length - 1, q = pts[Math.min(i + 1, n)], s = pts[Math.max(i - 1, 0)];
  const dx = q.x - s.x, dy = q.y - s.y, len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
});

export const taper = (w0, w1) => (t) => w0 + (w1 - w0) * smooth(t);

// Feuille de chêne lobée, centrée sur l'origine, pétiole à gauche.
function oakLeafPath(L, H, r) {
  const n = 64, lobes = 4 + Math.round(r() * 1.5);
  const up = [], down = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = -L / 2 + u * L;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04)), 0.65) * (0.82 + 0.18 * u);
    const lobeU = 0.68 + 0.32 * Math.abs(Math.sin(lobes * Math.PI * u + 0.3));
    const lobeD = 0.68 + 0.32 * Math.abs(Math.sin(lobes * Math.PI * u + 1.1));
    up.push([x, (-H / 2) * env * lobeU]);
    down.push([x, (H / 2) * env * lobeD]);
  }
  const pts = [...up, ...down.reverse()];
  return 'M' + pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L') + 'Z';
}

// ---------- Mise en page ----------

function countLeaves(n) {
  n.weight = n.kids.length ? n.kids.reduce((s, k) => s + countLeaves(k), 0) : 1;
  return n.weight;
}

export function computeOak(db, rootId, ancDepth, descDepth) {
  const root = db.get(rootId);

  // Ramure : arbre des descendants, « bombé » pour former une couronne
  const desc = buildDescendants(db, rootId, descDepth);
  const ext = (n) => (n.kids.length ? [-NODE_W / 2, NODE_W / 2] : [-LEAF_L / 2 - 4, LEAF_L / 2 + 4]);
  layoutTree(desc, ext, () => 0);
  countLeaves(desc);
  let maxX = 1;
  (function scan(n) { maxX = Math.max(maxX, Math.abs(n.x)); n.kids.forEach(scan); })(desc);
  // Plus la ramure est large, plus le tronc est fort et la couronne haute
  const scale = Math.max(1, maxX / 900);
  const tw = Math.min(3, Math.pow(scale, 0.7));
  const trunkH = TRUNK_H * Math.min(2.2, Math.sqrt(scale));
  const up = UP * Math.max(1, Math.min(3, scale * 0.85));
  const dome = Math.max(120, maxX * 0.24);
  (function place(n) {
    n.y = n.depth === 0 ? -trunkH : -trunkH - n.depth * up - dome * (1 - Math.pow(n.x / maxX, 2));
    n.kids.forEach(place);
  })(desc);

  // Racines : ascendants resserrés sous le tronc
  const anc = buildAncestors(db, rootId, ancDepth);
  const spouseId = db.spousesOf(rootId)[0];
  if (spouseId) anc.kids.push(...buildAncestors(db, spouseId, ancDepth).kids);
  layoutAncestorsClose(anc);
  (function place(n) {
    n.y = n.depth === 0 ? 0 : 70 + (n.depth - 1) * DOWN + 22 * Math.pow(Math.min(1, Math.abs(n.x) / 900), 2);
    n.weight = 1 + n.kids.reduce((s, k) => s + place(k), 0);
    return n.weight;
  })(anc);

  // Cadre
  let minX = -260, maxXb = 260, minY = -trunkH - 200, maxY = 140;
  const grow = (x, y, w, h) => {
    minX = Math.min(minX, x - w / 2); maxXb = Math.max(maxXb, x + w / 2);
    minY = Math.min(minY, y - h / 2); maxY = Math.max(maxY, y + h / 2);
  };
  // Le feuillage déborde d'environ 230 au-dessus des rameaux
  (function scan(n) { if (n.depth) grow(n.x, n.y, LEAF_L + 200, 470); n.kids.forEach(scan); })(desc);
  (function scan(n) { if (n.depth) grow(n.x, n.y, NODE_W + 40, 90); n.kids.forEach(scan); })(anc);
  minY -= 140; // titre
  const pad = 40;
  const bbox = { x: minX - pad, y: minY - pad, w: maxXb - minX + 2 * pad, h: maxY - minY + 2 * pad };

  let ancCount = -1, descCount = -1;
  (function c(n) { ancCount++; n.kids.forEach(c); })(anc);
  (function c(n) { descCount++; n.kids.forEach(c); })(desc);

  return {
    oak: true, bbox, ancCount, descCount, boxes: [],
    render: (g, database) => renderOak(g, database, { root, desc, anc, bbox, trunkH, tw }),
  };
}

// ---------- Dessin ----------

function renderOak(g, db, { root, desc, anc, bbox, trunkH, tw }) {
  const defs = el('defs', {}, g);
  defs.innerHTML = `
    <radialGradient id="oak-paper" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#f7efd9"/><stop offset=".7" stop-color="#efe2c0"/><stop offset="1" stop-color="#dcc797"/>
    </radialGradient>
    <linearGradient id="oak-earth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e3d1a6"/><stop offset="1" stop-color="#d6c08e"/>
    </linearGradient>
    <linearGradient id="oak-bark" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#cdb185"/><stop offset=".45" stop-color="#e4d0a8"/><stop offset="1" stop-color="#9c7b52"/>
    </linearGradient>
    <pattern id="oak-foliage" width="46" height="40" patternUnits="userSpaceOnUse">
      <path d="M4 10q5-7 10 0M20 6q4-6 9 0M33 14q5-6 10 1M8 26q5-7 10 0M26 24q4-6 9 0M14 37q4-6 9 0M37 34q4-5 8 0" fill="none" stroke="${INK}" stroke-width="1" opacity=".55"/>
    </pattern>
    <linearGradient id="oak-leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dfe2b0"/><stop offset="1" stop-color="#c3c88a"/>
    </linearGradient>`;

  // Fond parchemin et terre
  el('rect', { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h, fill: 'url(#oak-paper)' }, g);
  el('rect', { x: bbox.x, y: 0, width: bbox.w, height: bbox.y + bbox.h, fill: 'url(#oak-earth)', opacity: 0.55 }, g);
  el('rect', { x: bbox.x + 14, y: bbox.y + 14, width: bbox.w - 28, height: bbox.h - 28, fill: 'none', stroke: INK, 'stroke-width': 3, opacity: 0.7 }, g);
  el('rect', { x: bbox.x + 22, y: bbox.y + 22, width: bbox.w - 44, height: bbox.h - 44, fill: 'none', stroke: INK, 'stroke-width': 1, opacity: 0.6 }, g);

  const canopyG = el('g', { class: 'oak-canopy' }, g);
  // Bois en deux passes : tous les contours, puis tous les remplissages par-dessus.
  // Le tronc, les branches et les racines forment ainsi une seule silhouette, sans raccord.
  const edgeG = el('g', { class: 'oak-wood-edge' }, g);
  const woodG = el('g', { class: 'oak-wood' }, g);
  const hatchG = el('g', { class: 'oak-hatch' }, g);
  const knotG = el('g', { class: 'oak-knot' }, g);
  const leafG = el('g', {}, g);
  const labelG = el('g', {}, g);

  // (le remplissage a un liseré de sa couleur : il recouvre les coutures entre pièces voisines)
  const wood = (d) => { el('path', { d }, edgeG); el('path', { d }, woodG); };
  const poly = (pts) => 'M' + pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L');
  const unit = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
  const perpOf = (d) => ({ x: -d.y, y: d.x });
  const ss = (t) => t * t * (3 - 2 * t);

  // Une pièce de bois de S à E : part dans la direction d0 (celle du parent), arrive
  // dans la direction d1 ; largeur w0 → w1 ; `lines` = nervures reçues du parent.
  function limb(S, d0, E, d1, w0, w1, lines, seed) {
    const r = rng(seed);
    const L = Math.hypot(E.x - S.x, E.y - S.y);
    const c0 = { x: S.x + d0.x * L * (0.4 + r() * 0.1), y: S.y + d0.y * L * (0.4 + r() * 0.1) };
    const c1 = { x: E.x - d1.x * L * 0.35, y: E.y - d1.y * L * 0.35 };
    const n = 36, raw = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      raw.push({
        x: u * u * u * S.x + 3 * u * u * t * c0.x + 3 * u * t * t * c1.x + t * t * t * E.x,
        y: u * u * u * S.y + 3 * u * u * t * c0.y + 3 * u * t * t * c1.y + t * t * t * E.y,
      });
    }
    // Axe légèrement ondulé (nul aux deux bouts), amincissement sans à-coup
    const pts = wave(raw, seed, Math.min(6, 1 + L * 0.012) * (w0 > 5 ? 1 : 0.5));
    const perp = perpendiculars(pts);
    const width = taper(w0, w1);
    const side = (u) => pts.map((p, i) => ({ x: p.x + perp[i].x * u * width(i / n), y: p.y + perp[i].y * u * width(i / n) }));
    wood(poly([...side(0.5), ...side(-0.5).reverse()]) + 'Z');
    // Toutes les nervures reçues se prolongent, dans l'ordre (aucun croisement)
    const keep = [...lines].sort((x, y) => x - y);
    const target = cyl(keep.length);
    drawGrain(hatchG, knotG, pts, perp, width, keep, target, (t) => ss(Math.min(1, t / 0.45)), seed);
    return { lines: target };
  }

  // Fourche : les enfants partent côte à côte, en se partageant la section du parent
  function fork(node, P, dir, W, lines, target, prefix) {
    const q = perpOf(dir);
    const kids = [...node.kids].sort((a, b) => (target(a).x - P.x) * q.x + (target(a).y - P.y) * q.y - ((target(b).x - P.x) * q.x + (target(b).y - P.y) * q.y));
    let acc = -W / 2;
    for (const k of kids) {
      const pos = acc + k.start / 2;
      acc += k.start;
      const S = { x: P.x + q.x * pos, y: P.y + q.y * pos };
      const E = target(k);
      const lo = pos - k.start / 2, hi = pos + k.start / 2, last = k === kids[kids.length - 1];
      const mine = lines.map((u) => u * W).filter((v) => v >= lo && (last ? v <= hi : v < hi)).map((v) => (v - pos) / k.start);
      const d1 = k.endDir(S, E);
      const res = limb(S, dir, E, d1, k.start, k.end, mine.length ? mine : [0], prefix + k.id);
      k.endPt = E;
      if (k.kids.length) fork(k, E, d1, k.end, res.lines, target, prefix);
    }
  }

  function shareWidths(n, endW, nat, tipW) {
    const sum = n.kids.reduce((acc, k) => acc + nat(k), 0) || 1;
    for (const k of n.kids) {
      k.start = (endW * nat(k)) / sum;
      k.end = k.kids.length ? Math.min(nat(k), k.start * 0.88) : tipW;
      shareWidths(k, k.end, nat, tipW);
    }
  }

  // ----- Feuillage : masse festonnée derrière la ramure -----
  if (desc.kids.length) {
    const blobs = [];
    const rc = rng('feuillage');
    const pts = [];
    (function collect(n) { for (const k of n.kids) { pts.push(k); collect(k); } })(desc);
    // Remplit, colonne par colonne, l'espace occupé par les rameaux et les feuilles
    const xs = pts.map((q) => q.x);
    const STEP = 95;
    for (let x = Math.min(...xs) - 60; x <= Math.max(...xs) + 60; x += STEP) {
      const near = pts.filter((q) => Math.abs(q.x - x) < 170);
      if (!near.length) continue;
      const top = Math.min(...near.map((q) => q.y)) - 95;
      const bottom = Math.max(...near.map((q) => q.y)) + 70;
      for (let y = top; y <= bottom; y += STEP) {
        blobs.push([x + (rc() - 0.5) * 30, y + (rc() - 0.5) * 30, 95 + rc() * 35]);
      }
    }
    // Contour : disques épais d'abord, puis disques pleins par-dessus
    const outline = el('g', { opacity: 0.75 }, canopyG);
    const fill = el('g', {}, canopyG);
    const tex = el('g', { opacity: 0.55 }, canopyG);
    for (const [x, y, r0] of blobs) {
      const rr = r0 * (0.9 + rc() * 0.2);
      el('circle', { cx: f2(x), cy: f2(y), r: f2(rr), class: 'oak-canopy-edge' }, outline);
      el('circle', { cx: f2(x), cy: f2(y), r: f2(rr), class: 'oak-canopy-fill' }, fill);
      el('circle', { cx: f2(x), cy: f2(y), r: f2(rr - 6), fill: 'url(#oak-foliage)' }, tex);
    }
  }

  // ----- Bois : tronc, racines et branches d'un seul tenant -----
  const T = trunkH;
  const natB = (n) => (n.kids.length ? Math.min(42 * tw, 4 + 6.5 * Math.sqrt(n.weight)) : 2.5);
  const natR = (n) => Math.min(46 * tw, 7 + 7 * Math.sqrt(n.weight));
  const sumB = desc.kids.reduce((a, k) => a + natB(k), 0);
  const sumR = anc.kids.reduce((a, k) => a + natR(k), 0);
  const TT = Math.max(70 * tw, Math.min(sumB || 70 * tw, 120 * tw));
  const TB = Math.max(TT * 1.5, Math.min(sumR || TT * 1.6, 190 * tw));
  shareWidths(desc, TT, natB, 2.5);
  shareWidths(anc, TB, natR, 6);

  // Tronc : bords verticaux en haut et en bas, pour se prolonger dans les branches et les racines
  const base = 6;
  wood(`M${f2(-TB / 2)} ${base}C${f2(-TB / 2)} ${f2(-T * 0.22)} ${f2(-TT / 2)} ${f2(-T * 0.55)} ${f2(-TT / 2)} ${f2(-T)}`
    + `L${f2(TT / 2)} ${f2(-T)}C${f2(TT / 2)} ${f2(-T * 0.55)} ${f2(TB / 2)} ${f2(-T * 0.22)} ${f2(TB / 2)} ${base}Z`);
  const trunkLines = cyl(Math.max(8, Math.floor(TT / 3.4)));
  {
    const bez = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
    const n = 48, pts = [], half = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: 0, y: bez(base, -T * 0.22, -T * 0.55, -T, t) });
      half.push(bez(TB / 2, TB / 2, TT / 2, TT / 2, t));
    }
    // Un nœud au-dessus du cartouche
    drawGrain(hatchG, knotG, pts, pts.map(() => ({ x: 1, y: 0 })), (t) => 2 * half[Math.round(t * n)], trunkLines, trunkLines, () => 0, 'tronc', { knotT: [[0.72, 0.8]], knotChance: 1, rho: 0.07 });
  }

  // Racines (ascendants) : vers le haut des cartouches, en tendant vers le bas
  (function dirs(n) { for (const k of n.kids) { k.endDir = (S, E) => unit({ x: (E.x - S.x) * 0.5, y: Math.abs(E.y - S.y) + 40 }); dirs(k); } })(anc);
  fork(anc, { x: 0, y: base }, { x: 0, y: 1 }, TB, trunkLines.map((u) => -u), (k) => ({ x: k.x, y: k.y - 26 }), 'r');
  // Radicelles
  (function rootlets(n) {
    for (const k of n.kids) {
      const r = rng('rl' + k.id);
      if (!k.kids.length) {
        for (let j = 0; j < 3; j++) {
          const a = Math.PI / 2 + (r() - 0.5) * 1.6, len = 22 + r() * 26;
          el('path', { d: `M${f2(k.x)} ${f2(k.y + 30)}q${f2(Math.cos(a) * len * 0.5 + 6)} ${f2(Math.sin(a) * len * 0.4)} ${f2(Math.cos(a) * len)} ${f2(Math.sin(a) * len)}`, class: 'oak-rootlet' }, hatchG);
        }
      }
      rootlets(k);
    }
  })(anc);

  // Branches (descendants) : les branches maîtresses montent, les rameaux s'étalent
  (function dirs(n) {
    for (const k of n.kids) {
      k.endDir = k.kids.length
        ? (S, E) => unit({ x: (E.x - S.x) * 0.35, y: -Math.abs(E.y - S.y) - 60 })
        : () => ({ x: Math.cos(k.leafAngle), y: Math.sin(k.leafAngle) });
      dirs(k);
    }
  })(desc);
  (function stems(n) { for (const k of n.kids) { if (!k.kids.length) setLeafAngle(k, n); stems(k); } })(desc);
  fork(desc, { x: 0, y: -T }, { x: 0, y: -1 }, TT, trunkLines, (k) => (k.kids.length ? { x: k.x, y: k.y + 16 } : k.stem), 'b');

  // Point d'attache du pétiole d'une feuille, et son orientation
  function setLeafAngle(k, parent) {
    const dx = k.x - (parent.depth === 0 ? 0 : parent.x);
    const side = dx >= 0 ? 1 : -1;
    // Sur les côtés, la feuille s'étale vers l'extérieur ; au centre, elle se dresse
    const ang = Math.abs(dx) > LEAF_L * 0.95 ? (side > 0 ? -0.35 : Math.PI + 0.35) : -Math.PI / 2 + side * 0.5;
    k.leafAngle = ang;
    k.stem = { x: k.x - Math.cos(ang) * (LEAF_L / 2 + 6), y: k.y - Math.sin(ang) * (LEAF_L / 2 + 6) };
  }

  // ----- Feuilles : dernière génération -----
  (function drawLeaves(n) {
    for (const k of n.kids) {
      if (k.kids.length) { drawLeaves(k); continue; }
      const p = db.get(k.id);
      const r = rng('l' + k.id);
      const deg = (k.leafAngle * 180) / Math.PI + (r() - 0.5) * 8;
      const grp = el('g', { class: 't-person oak-person', 'data-id': k.id }, leafG);
      const leaf = el('g', { transform: `translate(${f2(k.x)} ${f2(k.y)}) rotate(${f2(deg)})` }, grp);
      el('path', { d: oakLeafPath(LEAF_L, LEAF_H, r), class: 'oak-leaf' }, leaf);
      el('path', { d: `M${-LEAF_L / 2 - 8} 0L${LEAF_L / 2 - 6} 0`, class: 'oak-vein main' }, leaf);
      for (let v = 1; v <= 4; v++) {
        const x = -LEAF_L / 2 + (v * LEAF_L) / 5.2;
        el('path', { d: `M${x} 0l${LEAF_L / 12} -${LEAF_H * 0.3}M${x + 6} 0l${LEAF_L / 12} ${LEAF_H * 0.3}`, class: 'oak-vein' }, leaf);
      }
      // Gland, de temps en temps
      if (r() < 0.18) acorn(grp, k.x + (r() - 0.5) * 60, k.y + LEAF_H / 2 + 10);
      label(grp, k.x, k.y, p, db.spousesOf(k.id));
    }
  })(desc);

  // ----- Étiquettes des branches et des racines -----
  (function branchLabels(n) {
    for (const k of n.kids) {
      if (!k.kids.length) continue;
      const grp = el('g', { class: 't-person oak-person', 'data-id': k.id }, labelG);
      ribbon(grp, k.x, k.y, db.get(k.id), db.spousesOf(k.id));
      branchLabels(k);
    }
  })(desc);
  (function rootLabels(n) {
    for (const k of n.kids) {
      const grp = el('g', { class: 't-person oak-person', 'data-id': k.id }, labelG);
      cartouche(grp, k.x, k.y, db.get(k.id), k.more);
      rootLabels(k);
    }
  })(anc);

  // ----- Sol -----
  const groundG = el('g', { class: 'oak-ground' }, g);
  let d = `M${bbox.x + 30} 2`;
  const r = rng('sol');
  for (let x = bbox.x + 30; x < bbox.x + bbox.w - 30; x += 40) d += `Q${x + 20} ${f2(-2 + r() * 6)} ${x + 40} ${f2(r() * 4)}`;
  el('path', { d, class: 'oak-ground-line' }, groundG);
  for (let x = bbox.x + 50; x < bbox.x + bbox.w - 50; x += 18 + r() * 30) {
    if (Math.abs(x) < 110) continue;
    const h = 6 + r() * 12;
    el('path', { d: `M${f2(x)} 2l${f2(-3 - r() * 3)} -${f2(h)}M${f2(x + 3)} 2l${f2(r() * 4)} -${f2(h * 1.2)}M${f2(x + 6)} 2l${f2(3 + r() * 3)} -${f2(h * 0.8)}`, class: 'oak-grass' }, groundG);
  }

  // ----- Cartouche du tronc : la personne choisie -----
  const rg = el('g', { class: 't-person oak-person', 'data-id': root.id }, g);
  const cy = -T * 0.42;
  const spId = db.spousesOf(root.id)[0];
  const ph = spId ? 160 : 104;
  el('path', { d: `M-128 ${cy - ph / 2}h256c-10 18 -10 ${ph - 18} 0 ${ph}h-256c10 -18 10 ${-(ph - 18)} 0 ${-ph}Z`, class: 'oak-plaque' }, rg);
  el('path', { d: `M-118 ${cy - ph / 2 + 8}h236c-8 16 -8 ${ph - 32} 0 ${ph - 16}h-236c8 -16 8 ${-(ph - 32)} 0 ${-(ph - 16)}Z`, class: 'oak-plaque-inner' }, rg);
  // Le couple : le descendant au-dessus, la date de mariage, puis le conjoint
  const top = spId ? cy - 40 : cy - 8;
  text(rg, 0, top, fit(root.name, 22), 'oak-script', { 'text-anchor': 'middle' });
  text(rg, 0, top + 22, lifeSpan(root), 'oak-italic', { 'text-anchor': 'middle' });
  if (spId) {
    const sp = db.get(spId);
    text(rg, 0, cy + 14, marriage(root.id, spId), 'oak-italic', { 'text-anchor': 'middle' });
    const sg = el('g', { class: 't-person oak-person', 'data-id': spId }, g);
    el('rect', { x: -120, y: cy + 22, width: 240, height: 54, fill: 'transparent' }, sg);
    text(sg, 0, cy + 46, fit(sp.name, 22), 'oak-script', { 'text-anchor': 'middle' });
    text(sg, 0, cy + 68, lifeSpan(sp), 'oak-small', { 'text-anchor': 'middle' });
  }

  // ----- Titre -----
  const title = root.lastName ? `Famille ${root.lastName}` : 'Arbre de famille';
  text(g, bbox.x + bbox.w / 2, bbox.y + 92, title, 'oak-title', { 'text-anchor': 'middle' });
  text(g, bbox.x + bbox.w / 2, bbox.y + 128, `Ascendance et descendance de ${root.name}`, 'oak-italic', { 'text-anchor': 'middle' });

  // ---------- Éléments graphiques ----------

  function label(grp, x, y, p, spouses) {
    const lines = [fit(p.name, 22), lifeSpan(p), fit(spouseLine(db, spouses), 26)].filter(Boolean);
    const top = y - (lines.length - 1) * 8 + 4;
    lines.forEach((s, i) => text(grp, x, top + i * 16, s, i === 0 ? 'oak-name' : 'oak-small', { 'text-anchor': 'middle' }));
    el('rect', { x: x - LEAF_L / 2, y: y - LEAF_H / 2, width: LEAF_L, height: LEAF_H, fill: 'transparent' }, grp);
  }

  function marriage(a, b) {
    const date = db.get(a)?.marriageDate || db.get(b)?.marriageDate;
    return date ? `∞ ${date}` : '∞';
  }

  function ribbon(grp, x, y, p, spouses) {
    const name = fit(p.name, 22);
    const w = Math.max(110, Math.min(200, name.length * 8.6 + 34));
    const h = 26;
    const l = x - w / 2, t = y - h / 2;
    // Pans du ruban
    el('path', { d: `M${l + 6} ${t + 8}h-22l8 ${h / 2}l-8 ${h / 2}h22Z`, class: 'oak-ribbon-tail' }, grp);
    el('path', { d: `M${l + w - 6} ${t + 8}h22l-8 ${h / 2}l8 ${h / 2}h-22Z`, class: 'oak-ribbon-tail' }, grp);
    el('path', { d: `M${l} ${t}Q${x} ${t - 7} ${l + w} ${t}v${h}Q${x} ${t + h - 7} ${l} ${t + h}Z`, class: 'oak-ribbon' }, grp);
    el('rect', { x: l - 16, y: t - 8, width: w + 32, height: h + 50, fill: 'transparent' }, grp);
    text(grp, x, y + 2, name, 'oak-name', { 'text-anchor': 'middle' });
    const sub = [lifeSpan(p), ...(spouses.length ? [marriage(p.id, spouses[0]), fit(db.get(spouses[0]).name + (spouses.length > 1 ? ` (+${spouses.length - 1})` : ''), 28)] : [])];
    sub.forEach((s, i) => text(grp, x, y + 30 + i * 15, s, 'oak-small oak-halo', { 'text-anchor': 'middle' }));
  }

  function cartouche(grp, x, y, p, more) {
    const w = NODE_W, h = 58;
    el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 26, class: 'oak-plaque' }, grp);
    el('rect', { x: x - w / 2 + 5, y: y - h / 2 + 5, width: w - 10, height: h - 10, rx: 21, class: 'oak-plaque-inner' }, grp);
    text(grp, x, y - 2, fit(p.name, 20), 'oak-name', { 'text-anchor': 'middle' });
    text(grp, x, y + 16, lifeSpan(p), 'oak-small', { 'text-anchor': 'middle' });
    if (more) text(grp, x, y + h / 2 + 14, '…', 'oak-small', { 'text-anchor': 'middle' });
  }

  function acorn(grp, x, y) {
    const a = el('g', { transform: `translate(${f2(x)} ${f2(y)})` }, grp);
    el('ellipse', { cx: 0, cy: 9, rx: 7, ry: 10, class: 'oak-acorn' }, a);
    el('path', { d: 'M-9 3a9 7 0 0 1 18 0Z', class: 'oak-cup' }, a);
    el('path', { d: 'M0 -4v-5', class: 'oak-vein main' }, a);
  }
}

// Style autonome (export en image) ; les polices sont ajoutées à l'export.
export const OAK_STYLE = `
  .oak-canopy-edge{fill:none;stroke:${INK};stroke-width:7;stroke-dasharray:2 9;stroke-linecap:round}
  .oak-canopy-fill{fill:#e6e2b8}
  .oak-wood-edge path,.oak-wood-edge circle{fill:${INK};stroke:${INK};stroke-width:4;stroke-linejoin:round}
  .oak-wood path,.oak-wood circle{fill:#d8c197;stroke:#d8c197;stroke-width:1.4;stroke-linejoin:round}
  .oak-knot ellipse{fill:none;stroke:${INK};stroke-width:.9;opacity:.6}
  .oak-knot ellipse.core{fill:${INK};opacity:.55}
  .oak-hatch path{fill:none;stroke:#8f7a5a;stroke-width:.8;stroke-linecap:butt;stroke-linejoin:round}
  .oak-hatch .oak-rootlet{stroke:${INK};stroke-width:1.2;opacity:.7;stroke-linecap:round}
  .oak-hatch .oak-bark-line{stroke-width:1.1;opacity:.5}
  .oak-leaf{fill:url(#oak-leaf);stroke:${INK};stroke-width:1.3;stroke-linejoin:round}
  .oak-vein{fill:none;stroke:${INK};stroke-width:.7;opacity:.45}
  .oak-vein.main{stroke-width:1.1;opacity:.6}
  .oak-acorn{fill:#c9a46a;stroke:${INK};stroke-width:1}
  .oak-cup{fill:#8d6b40;stroke:${INK};stroke-width:1}
  .oak-ribbon{fill:#f4e8c8;stroke:${INK};stroke-width:1.3}
  .oak-ribbon-tail{fill:#e2d0a2;stroke:${INK};stroke-width:1.2}
  .oak-plaque{fill:#f5ebcf;stroke:${INK};stroke-width:2}
  .oak-plaque-inner{fill:none;stroke:${INK};stroke-width:.8;opacity:.7}
  .oak-ground-line{fill:none;stroke:${INK};stroke-width:2}
  .oak-grass{fill:none;stroke:${INK};stroke-width:1;opacity:.6;stroke-linecap:round}
  .oak-person{cursor:pointer}
  .oak-person text{pointer-events:none}
  .oak-title{font-family:'Pinyon Script',cursive;font-size:64px;fill:${INK}}
  .oak-script{font-family:'Pinyon Script',cursive;font-size:30px;fill:${INK}}
  .oak-name{font-family:'IM Fell English',Georgia,serif;font-size:15.5px;fill:${INK}}
  .oak-italic{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:16px;fill:${INK}}
  .oak-small{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:12.5px;fill:${INK}}
  .oak-halo{paint-order:stroke;stroke:#f3e7c6;stroke-width:4px;stroke-linejoin:round}
`;

export async function fontDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

// SVG autonome, polices incluses (pour l'export PNG / SVG).
export async function exportOakSvg(db, oak) {
  const { x, y, w, h } = oak.bbox;
  const svg = el('svg', { xmlns: SVG_NS, viewBox: `${x} ${y} ${w} ${h}`, width: w, height: h });
  let fonts = '';
  try {
    const [fell, fellIt, pinyon] = await Promise.all([
      fontDataUrl('fonts/im-fell-english.woff2'),
      fontDataUrl('fonts/im-fell-english-italic.woff2'),
      fontDataUrl('fonts/pinyon-script.woff2'),
    ]);
    fonts = `@font-face{font-family:'IM Fell English';src:url(${fell}) format('woff2')}
      @font-face{font-family:'IM Fell English';font-style:italic;src:url(${fellIt}) format('woff2')}
      @font-face{font-family:'Pinyon Script';src:url(${pinyon}) format('woff2')}`;
  } catch { /* polices de secours */ }
  el('style', {}, svg).textContent = fonts + OAK_STYLE + (oak.style || '');
  oak.render(el('g', {}, svg), db);
  return new XMLSerializer().serializeToString(svg);
}
