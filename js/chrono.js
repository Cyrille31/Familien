// Vue « chronologique » : éventail de descendants au-dessus, racines d'ancêtres
// en dessous, et des cercles d'années (tous les 5, 10, 20 ou 25 ans). La distance
// au centre dépend de l'année de naissance : les cousins nés la même année se
// retrouvent sur le même cercle.

import { buildAncestors, buildDescendants } from './tree.js';
import { el, text, rng, fit, f2, INK } from './oak.js';

const K = 6.5;          // pixels par année
const GROUND = 250;     // le sol, sous le centre de l'éventail
const ROW_ARC = 17;     // place minimale (le long du cercle) pour un nom
const GEN = 28;         // écart moyen entre générations, pour estimer une année inconnue

const deg = (a) => (a * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

function leaves(n) {
  n.weight = n.kids.length ? n.kids.reduce((s, k) => s + leaves(k), 0) : 1;
  return n.weight;
}

// Répartit les angles : chaque nœud reçoit une part proportionnelle à ses feuilles.
function assignAngles(n, a0, a1) {
  n.a0 = a0; n.a1 = a1; n.angle = (a0 + a1) / 2;
  let a = a0;
  for (const k of n.kids) {
    const part = ((a1 - a0) * k.weight) / n.weight;
    assignAngles(k, a, a + part);
    a += part;
  }
}

export function computeChrono(db, rootId, ancDepth, descDepth, step = 10) {
  const root = db.get(rootId);
  const desc = buildDescendants(db, rootId, descDepth);
  const anc = buildAncestors(db, rootId, ancDepth);

  // ----- Années (estimées si inconnues) -----
  const yearOf = (id) => Number(db.get(id)?.birthYear) || null;
  let y0 = yearOf(rootId);
  let rootEst = false;
  if (!y0) {
    rootEst = true;
    const kidY = desc.kids.map((k) => yearOf(k.id)).filter(Boolean);
    const parY = anc.kids.map((k) => yearOf(k.id)).filter(Boolean);
    y0 = kidY.length ? Math.min(...kidY) - GEN : parY.length ? Math.max(...parY) + GEN : 1950;
  }
  desc.year = y0; desc.est = rootEst;
  (function down(n) {
    for (const k of n.kids) {
      const y = yearOf(k.id);
      k.est = !y;
      k.year = Math.max(y || n.year + GEN, n.year + 12); // un enfant naît après ses parents
      down(k);
    }
  })(desc);
  anc.year = y0;
  (function up(n) {
    for (const k of n.kids) {
      const y = yearOf(k.id);
      k.est = !y;
      k.year = Math.min(y || n.year - GEN, n.year - 12);
      up(k);
    }
  })(anc);

  // ----- Angles et rayons -----
  leaves(desc); leaves(anc);
  const D0 = rad(186), D1 = rad(-6);   // éventail des descendants (gauche → droite)
  const A0 = rad(192), A1 = rad(348);  // éventail des racines (sous le sol)
  assignAngles(desc, D0, D1);
  assignAngles(anc, A0, A1);
  // Rayon de départ assez grand pour que les noms voisins ne se chevauchent pas
  let minYd = Infinity, minDy = Infinity;
  (function scan(n) { for (const k of n.kids) { minYd = Math.min(minYd, k.year - y0); minDy = Math.min(minDy, Math.abs(k.a1 - k.a0)); scan(k); } })(desc);
  let minYa = Infinity, minDa = Infinity;
  (function scan(n) { for (const k of n.kids) { minYa = Math.min(minYa, y0 - k.year); minDa = Math.min(minDa, Math.abs(k.a1 - k.a0)); scan(k); } })(anc);
  const Rd0 = desc.kids.length ? Math.max(60, ROW_ARC / minDy - minYd * K) : 60;
  const Ra0 = anc.kids.length ? Math.max(70, ROW_ARC / minDa - minYa * K) : 70;
  const rD = (y) => Rd0 + (y - y0) * K;
  const rA = (y) => Ra0 + (y0 - y) * K;
  const CA = { x: 0, y: GROUND }; // centre des racines

  let maxRd = 0, maxRa = 0, ancCount = 0, descCount = 0;
  (function scan(n) { for (const k of n.kids) { k.r = rD(k.year); maxRd = Math.max(maxRd, k.r); descCount++; scan(k); } })(desc);
  (function scan(n) { for (const k of n.kids) { k.r = rA(k.year); maxRa = Math.max(maxRa, k.r); ancCount++; scan(k); } })(anc);
  maxRd = Math.max(maxRd, 200); maxRa = Math.max(maxRa, 200);

  const R = Math.max(maxRd, maxRa) + 190;
  const bbox = { x: -R - 40, y: -maxRd - 330, w: 2 * R + 80, h: maxRd + 330 + GROUND + maxRa + 210 };

  return {
    oak: true, bbox, ancCount, descCount, boxes: [], style: CHRONO_STYLE,
    render: (g, database) => renderChrono(g, database, { root, desc, anc, bbox, y0, step, rD, rA, CA, maxRd, maxRa, R }),
  };
}

function renderChrono(g, db, o) {
  const { root, desc, anc, bbox, y0, step, rD, rA, CA, maxRd, maxRa } = o;
  const P = (c, r, a) => ({ x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) });
  const C0 = { x: 0, y: 0 };

  el('rect', { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h, class: 'ch-paper' }, g);
  el('rect', { x: bbox.x + 18, y: bbox.y + 18, width: bbox.w - 36, height: bbox.h - 36, rx: 60, class: 'ch-frame' }, g);
  el('rect', { x: bbox.x + 28, y: bbox.y + 28, width: bbox.w - 56, height: bbox.h - 56, rx: 52, class: 'ch-frame thin' }, g);

  // ----- Cercles d'années -----
  const ringG = el('g', {}, g);
  const ringLabels = el('g', {}, g);
  const bands = (center, years, r, upper) => {
    years.forEach((y, i) => {
      const r1 = r(y), r2 = i + 1 < years.length ? r(years[i + 1]) : null;
      const sweep = upper ? 1 : 0;
      if (r2 !== null && i % 2 === 0) {
        const [a, b] = [Math.min(r1, r2), Math.max(r1, r2)];
        const d = `M${f2(center.x - b)} ${center.y}A${f2(b)} ${f2(b)} 0 0 ${sweep} ${f2(center.x + b)} ${center.y}`
          + `L${f2(center.x + a)} ${center.y}A${f2(a)} ${f2(a)} 0 0 ${1 - sweep} ${f2(center.x - a)} ${center.y}Z`;
        el('path', { d, class: 'ch-band' }, ringG);
      }
      el('path', { d: `M${f2(center.x - r1)} ${center.y}A${f2(r1)} ${f2(r1)} 0 0 ${sweep} ${f2(center.x + r1)} ${center.y}`, class: y % (step * 5) === 0 ? 'ch-ring major' : 'ch-ring' }, ringG);
      const ly = center.y + (upper ? 18 : -8);
      text(ringLabels, center.x - r1, ly, String(y), 'ch-year', { 'text-anchor': 'middle' });
      text(ringLabels, center.x + r1, ly, String(y), 'ch-year', { 'text-anchor': 'middle' });
      const top = P(center, r1, upper ? Math.PI / 2 : -Math.PI / 2);
      text(ringLabels, top.x, top.y + (upper ? -4 : 13), String(y), 'ch-year small', { 'text-anchor': 'middle' });
    });
  };
  const ringsUp = [], ringsDown = [];
  for (let y = Math.ceil((y0 + 1) / step) * step; rD(y) <= maxRd + 40; y += step) ringsUp.push(y);
  for (let y = Math.floor((y0 - 1) / step) * step; rA(y) <= maxRa + 40; y -= step) ringsDown.push(y);
  bands(C0, ringsUp, rD, true);
  bands(CA, ringsDown, rA, false);

  // ----- Bois : contours puis remplissages (aucune jointure visible) -----
  const edgeG = el('g', { class: 'ch-wood-edge' }, g);
  const woodG = el('g', { class: 'ch-wood' }, g);
  const grainG = el('g', { class: 'ch-grain' }, g);
  const wood = (d) => { el('path', { d }, edgeG); el('path', { d }, woodG); };
  const knot = (p, w) => {
    el('circle', { cx: f2(p.x), cy: f2(p.y), r: f2(w / 2) }, edgeG);
    el('circle', { cx: f2(p.x), cy: f2(p.y), r: f2(w / 2) }, woodG);
  };

  // Branche en coordonnées polaires : elle s'oriente d'abord, puis file vers l'extérieur.
  const polarLimb = (center, r0, a0, r1, a1, w0, w1, seed) => {
    const n = 26, pts = [];
    const r = rng(seed), wob = (r() - 0.5) * 0.06;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const e = 1 - Math.pow(1 - t, 2.4);
      const rr = r0 + (r1 - r0) * t;
      const aa = a0 + (a1 - a0) * e + wob * Math.sin(Math.PI * t);
      pts.push(P(center, rr, aa));
    }
    const left = [], right = [];
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, n)], o = pts[Math.max(i - 1, 0)];
      const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy) || 1;
      const t = i / n, w = (w0 + (w1 - w0) * Math.pow(t, 0.7)) / 2;
      left.push([p.x - (dy / len) * w, p.y + (dx / len) * w]);
      right.push([p.x + (dy / len) * w, p.y - (dx / len) * w]);
    });
    wood('M' + [...left, ...right.reverse()].map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L') + 'Z');
    // Fil du bois
    if (w0 > 8) {
      for (const k of [-0.2, 0.22]) {
        const d = 'M' + pts.map((p, i) => {
          const q = pts[Math.min(i + 1, n)], o = pts[Math.max(i - 1, 0)];
          const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy) || 1;
          const w = (w0 + (w1 - w0) * Math.pow(i / n, 0.7)) * k;
          return `${f2(p.x - (dy / len) * w)} ${f2(p.y + (dx / len) * w)}`;
        }).join('L');
        el('path', { d }, grainG);
      }
    }
    return pts[n];
  };
  const width = (n) => Math.min(44, 3 + 5.5 * Math.sqrt(n.weight));

  // Tronc
  const T = GROUND;
  wood(`M-80 ${T + 14}C-52 ${T - 20} -40 ${T * 0.6} -36 ${T * 0.3}C-33 ${T * 0.1} -30 6 -26 -4L26 -4C30 6 33 ${T * 0.1} 36 ${T * 0.3}C40 ${T * 0.6} 52 ${T - 20} 84 ${T + 14}Z`);
  for (let k = -3; k <= 3; k++) el('path', { d: `M${k * 15} ${T + 4}C${k * 12} ${T * 0.6} ${k * 9} ${T * 0.3} ${k * 6} 0` }, grainG);

  // Branches (descendants)
  (function branches(n, depth) {
    for (const k of n.kids) {
      const w1 = k.kids.length ? width(k) : 2.2;
      const w0 = depth === 0 ? Math.min(46, width(k) + 8) : width(n) * 0.9;
      const end = polarLimb(C0, depth === 0 ? 0 : n.r, depth === 0 ? Math.PI / 2 : n.angle, k.r, k.angle, w0, w1, 'b' + k.id);
      if (k.kids.length) knot(end, w1);
      k.pt = end;
      branches(k, depth + 1);
    }
  })(desc, 0);

  // Racines (ascendants)
  (function roots(n, depth) {
    for (const k of n.kids) {
      const w1 = k.kids.length ? width(k) : 2.2;
      const w0 = depth === 0 ? Math.min(50, width(k) + 10) : width(n) * 0.9;
      const end = polarLimb(CA, depth === 0 ? 0 : n.r, depth === 0 ? (3 * Math.PI) / 2 : n.angle, k.r, k.angle, w0, w1, 'r' + k.id);
      if (k.kids.length) knot(end, w1);
      k.pt = end;
      roots(k, depth + 1);
    }
  })(anc, 0);

  // Sol
  const r = rng('sol');
  let d = `M${bbox.x + 40} ${GROUND}`;
  for (let x = bbox.x + 40; x < bbox.x + bbox.w - 40; x += 40) d += `Q${x + 20} ${f2(GROUND - 2 + r() * 5)} ${x + 40} ${f2(GROUND + r() * 3)}`;
  el('path', { d, class: 'ch-ground' }, g);

  // ----- Noms, écrits dans le sens des rayons -----
  const labelG = el('g', {}, g);
  const CH = 6.3; // largeur moyenne d'un caractère
  const nameOf = (k) => {
    const p = db.get(k.id);
    const yr = `${k.est ? '~' : ''}${k.year}`;
    if (!k.kids.length) {
      const sp = db.spousesOf(k.id).map((id) => db.get(id)?.firstName).filter(Boolean);
      return `${fit(p.name, 26)} ${yr}${sp.length ? ' ∞ ' + fit(sp.join(', '), 18) : ''}`;
    }
    // Avant ses enfants, la place est limitée : on raccourcit si besoin
    const room = Math.min(...k.kids.map((c) => c.r)) - k.r - 16;
    const options = [`${p.name} ${yr}`, `${p.firstName || p.name} ${yr}`, p.firstName || p.name];
    return options.find((o) => o.length * CH <= room) || fit(options[2], Math.max(3, Math.floor(room / CH)));
  };
  const place = (center, k) => {
    const a = k.angle;
    const flip = Math.cos(a) < 0; // à gauche : on retourne le texte pour qu'il se lise
    const p = P(center, k.r + 7, a);
    const rot = flip ? 180 - deg(a) : -deg(a);
    const grp = el('g', { class: 't-person ch-person', 'data-id': k.id, transform: `translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(rot)})` }, labelG);
    const label = nameOf(k);
    const w = label.length * CH + 10;
    el('rect', { x: flip ? -w : 0, y: -9, width: w, height: 16, fill: 'transparent' }, grp);
    text(grp, 0, 4, label, k.est ? 'ch-name est' : 'ch-name', { 'text-anchor': flip ? 'end' : 'start' });
    const dot = P(center, k.r, a);
    el('circle', { cx: f2(dot.x), cy: f2(dot.y), r: 3.2, class: 'ch-dot' }, labelG);
  };
  (function walk(n) { for (const k of n.kids) { place(C0, k); walk(k); } })(desc);
  (function walk(n) { for (const k of n.kids) { place(CA, k); walk(k); } })(anc);

  // ----- Cartouche de la personne choisie, sur le tronc -----
  const rg = el('g', { class: 't-person ch-person', 'data-id': root.id }, g);
  const cy = GROUND * 0.48;
  el('path', { d: `M-118 ${cy - 44}h236c-9 16 -9 72 0 88h-236c9 -16 9 -72 0 -88Z`, class: 'ch-plaque' }, rg);
  el('path', { d: `M-109 ${cy - 37}h218c-7 14 -7 60 0 74h-218c7 -14 7 -60 0 -74Z`, class: 'ch-plaque-inner' }, rg);
  text(rg, 0, cy - 2, fit(root.name, 22), 'ch-script', { 'text-anchor': 'middle' });
  text(rg, 0, cy + 24, `${desc.est ? '~' : ''}${y0}${root.deathYear ? ' – ' + root.deathYear : ''}`, 'ch-italic', { 'text-anchor': 'middle' });

  // ----- Titre -----
  const title = `Généalogie de la famille ${root.lastName || root.name}`.toUpperCase();
  text(g, 0, bbox.y + 96, title, 'ch-title', { 'text-anchor': 'middle' });
  text(g, 0, bbox.y + 132, `Cercles tous les ${step} ans · ~ année estimée`, 'ch-italic', { 'text-anchor': 'middle' });
}

export const CHRONO_STYLE = `
  .ch-paper{fill:#f6eedb}
  .ch-frame{fill:none;stroke:${INK};stroke-width:3}
  .ch-frame.thin{stroke-width:1;opacity:.7}
  .ch-band{fill:#e9dcb8;opacity:.55}
  .ch-ring{fill:none;stroke:${INK};stroke-width:.8;opacity:.35;stroke-dasharray:4 5}
  .ch-ring.major{stroke-width:1.3;opacity:.55;stroke-dasharray:none}
  .ch-year{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:13px;fill:${INK};opacity:.75}
  .ch-year.small{font-size:11px;opacity:.6}
  .ch-wood-edge path,.ch-wood-edge circle{fill:${INK};stroke:${INK};stroke-width:3;stroke-linejoin:round}
  .ch-wood path,.ch-wood circle{fill:#d8c197;stroke:none}
  .ch-grain path{fill:none;stroke:${INK};stroke-width:.8;opacity:.45;stroke-linecap:round}
  .ch-ground{fill:none;stroke:${INK};stroke-width:2}
  .ch-dot{fill:${INK}}
  .ch-person{cursor:pointer}
  .ch-person text{pointer-events:none}
  .ch-name{font-family:'IM Fell English',Georgia,serif;font-size:13px;fill:${INK};paint-order:stroke;stroke:#f6eedb;stroke-width:3.5px;stroke-linejoin:round}
  .ch-name.est{font-style:italic}
  .ch-plaque{fill:#f5ebcf;stroke:${INK};stroke-width:2}
  .ch-plaque-inner{fill:none;stroke:${INK};stroke-width:.8;opacity:.7}
  .ch-script{font-family:'Pinyon Script',cursive;font-size:28px;fill:${INK}}
  .ch-italic{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:16px;fill:${INK}}
  .ch-title{font-family:'IM Fell English',Georgia,serif;font-size:40px;letter-spacing:.18em;fill:${INK}}
`;
