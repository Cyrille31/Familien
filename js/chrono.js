// Vue « chronologique » : éventail de descendants au-dessus, racines d'ancêtres
// en dessous, et des cercles d'années (tous les 5, 10, 20 ou 25 ans). La distance
// au centre dépend de l'année de naissance : les cousins nés la même année se
// retrouvent sur le même cercle.
//
// Le bois est continu : à chaque fourche, les branches filles se partagent la
// largeur de la branche mère, côte à côte, dans son prolongement ; les nervures
// passent du tronc aux branches et aux racines, plus serrées sur les bords
// (effet de cylindre).

import { buildAncestors, buildDescendants } from './tree.js';
import { el, text, rng, fit, f2, INK } from './oak.js';

const K = 6.5;          // pixels par année
const GROUND = 330;     // le sol, sous le centre de l'éventail
const ARC1 = 17;        // place (le long du cercle) pour un nom seul
const ARC2 = 46;        // place pour un couple (3 lignes)
const GEN = 28;         // écart moyen entre générations, pour estimer une année inconnue
const MAX_TRUNK = 150;

const deg = (a) => (a * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ss = (t) => t * t * (3 - 2 * t); // départ et arrivée sans à-coup
const P = (c, r, a) => ({ x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) });
const nrm = (a) => ({ x: Math.sin(a), y: Math.cos(a) }); // perpendiculaire au rayon

function weigh(n) {
  const own = n.need / ARC1;
  n.weight = n.kids.length ? Math.max(own, n.kids.reduce((s, k) => s + weigh(k), 0)) : own;
  return n.weight;
}

function assignAngles(n, a0, a1) {
  n.angle = (a0 + a1) / 2;
  n.slot = Math.abs(a1 - a0);
  const total = n.kids.reduce((s, k) => s + k.weight, 0) || 1;
  let a = a0;
  for (const k of n.kids) {
    const part = ((a1 - a0) * k.weight) / total;
    assignAngles(k, a, a + part);
    a += part;
  }
}

// Largeurs : départ (part de la largeur du parent) et arrivée (à la fourche).
const natural = (n) => (n.kids.length ? 3 + 5.2 * Math.sqrt(n.weight) : 2.4);
function shareWidths(n, endWidth) {
  n.end = endWidth;
  const sum = n.kids.reduce((s, k) => s + natural(k), 0) || 1;
  for (const k of n.kids) {
    k.start = (endWidth * natural(k)) / sum;
    shareWidths(k, k.kids.length ? Math.min(natural(k), k.start * 0.88) : 2.2);
  }
}

export function computeChrono(db, rootId, ancDepth, descDepth, step = 10) {
  const root = db.get(rootId);
  const desc = buildDescendants(db, rootId, descDepth);
  const spouseId = desc.spouses[0] || null;

  // Racines : les parents de la personne et ceux de son conjoint (4 racines)
  const ancA = buildAncestors(db, rootId, ancDepth);
  ancA.kids.forEach((k) => { k.base = 'root'; });
  const anc = { id: rootId, kids: [...ancA.kids] };
  if (spouseId) {
    const ancB = buildAncestors(db, spouseId, ancDepth);
    ancB.kids.forEach((k) => { k.base = 'spouse'; });
    anc.kids.push(...ancB.kids);
  }

  // ----- Années (estimées si inconnues) -----
  const yearOf = (id) => Number(db.get(id)?.birthYear) || null;
  let y0 = yearOf(rootId);
  const rootEst = !y0;
  if (!y0) {
    const kidY = desc.kids.map((k) => yearOf(k.id)).filter(Boolean);
    const parY = ancA.kids.map((k) => yearOf(k.id)).filter(Boolean);
    y0 = kidY.length ? Math.min(...kidY) - GEN : parY.length ? Math.max(...parY) + GEN : 1950;
  }
  const ySpouse = (spouseId && yearOf(spouseId)) || y0;
  desc.year = y0;
  (function down(n) {
    for (const k of n.kids) {
      const y = yearOf(k.id);
      k.est = !y;
      k.year = Math.max(y || n.year + GEN, n.year + 12);
      down(k);
    }
  })(desc);
  (function up(n, base) {
    for (const k of n.kids) {
      const from = n === anc ? (k.base === 'spouse' ? ySpouse : y0) : base;
      const y = yearOf(k.id);
      k.est = !y;
      k.year = Math.min(y || from - GEN, from - 12);
      up(k, k.year);
    }
  })(anc, y0);

  // ----- Place des étiquettes, angles, rayons -----
  (function need(n) { for (const k of n.kids) { k.need = db.spousesOf(k.id).length ? ARC2 : ARC1; need(k); } })(desc);
  (function need(n) { for (const k of n.kids) { k.need = ARC1; need(k); } })(anc);
  desc.need = ARC1; anc.need = ARC1;
  weigh(desc); weigh(anc);
  assignAngles(desc, rad(186), rad(-6));
  assignAngles(anc, rad(194), rad(346));
  let Rd0 = 60, Ra0 = 90;
  (function scan(n) { for (const k of n.kids) { Rd0 = Math.max(Rd0, k.need / k.slot - (k.year - y0) * K); scan(k); } })(desc);
  (function scan(n) { for (const k of n.kids) { Ra0 = Math.max(Ra0, k.need / k.slot - (y0 - k.year) * K); scan(k); } })(anc);
  const rD = (y) => Rd0 + (y - y0) * K;
  const rA = (y) => Ra0 + (y0 - y) * K;

  let maxRd = 200, maxRa = 200, ancCount = 0, descCount = 0;
  (function scan(n) { for (const k of n.kids) { k.r = rD(k.year); maxRd = Math.max(maxRd, k.r); descCount++; scan(k); } })(desc);
  (function scan(n) { for (const k of n.kids) { k.r = rA(k.year); maxRa = Math.max(maxRa, k.r); ancCount++; scan(k); } })(anc);

  // Largeurs : le tronc se partage entre les branches, et entre les racines
  const sumNat = (n) => n.kids.reduce((s, k) => s + natural(k), 0);
  const TW = Math.max(60, Math.min(MAX_TRUNK, sumNat(desc) || 60));
  const TB = Math.max(TW * 1.25, Math.min(MAX_TRUNK * 1.4, sumNat(anc) || TW * 1.3));
  shareWidths(desc, TW);
  shareWidths(anc, TB);

  const R = Math.max(maxRd, maxRa) + 200;
  const bbox = { x: -R - 40, y: -maxRd - 340, w: 2 * R + 80, h: maxRd + 340 + GROUND + maxRa + 220 };
  return {
    oak: true, bbox, ancCount, descCount, boxes: [], style: CHRONO_STYLE,
    render: (g, database) => renderChrono(g, database, { root, spouseId, desc, anc, bbox, y0, rootEst, step, rD, rA, maxRd, maxRa, TW, TB }),
  };
}

function marriageText(db, a, b) {
  const pa = db.get(a), pb = db.get(b);
  const date = pa?.marriageDate || pb?.marriageDate || '';
  return date ? `∞ ${date}` : '∞';
}

function renderChrono(g, db, o) {
  const { root, spouseId, desc, anc, bbox, y0, rootEst, step, rD, rA, maxRd, maxRa, TW, TB } = o;
  const C0 = { x: 0, y: 0 };
  const CA = { x: 0, y: GROUND };

  el('rect', { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h, class: 'ch-paper' }, g);
  el('rect', { x: bbox.x + 18, y: bbox.y + 18, width: bbox.w - 36, height: bbox.h - 36, rx: 60, class: 'ch-frame' }, g);
  el('rect', { x: bbox.x + 28, y: bbox.y + 28, width: bbox.w - 56, height: bbox.h - 56, rx: 52, class: 'ch-frame thin' }, g);

  // ----- Cercles d'années -----
  const ringG = el('g', {}, g);
  const ringLabels = el('g', {}, g);
  const rings = (center, years, r, upper) => {
    const sweep = upper ? 1 : 0;
    years.forEach((y, i) => {
      const r1 = r(y), r2 = i + 1 < years.length ? r(years[i + 1]) : null;
      if (r2 !== null && i % 2 === 0) {
        const [a, b] = [Math.min(r1, r2), Math.max(r1, r2)];
        el('path', { d: `M${f2(center.x - b)} ${center.y}A${f2(b)} ${f2(b)} 0 0 ${sweep} ${f2(center.x + b)} ${center.y}`
          + `L${f2(center.x + a)} ${center.y}A${f2(a)} ${f2(a)} 0 0 ${1 - sweep} ${f2(center.x - a)} ${center.y}Z`, class: 'ch-band' }, ringG);
      }
      el('path', { d: `M${f2(center.x - r1)} ${center.y}A${f2(r1)} ${f2(r1)} 0 0 ${sweep} ${f2(center.x + r1)} ${center.y}`, class: y % (step * 5) === 0 ? 'ch-ring major' : 'ch-ring' }, ringG);
      const ly = center.y + (upper ? 18 : -8);
      text(ringLabels, center.x - r1, ly, String(y), 'ch-year', { 'text-anchor': 'middle' });
      text(ringLabels, center.x + r1, ly, String(y), 'ch-year', { 'text-anchor': 'middle' });
    });
  };
  const up = [], down = [];
  for (let y = Math.ceil((y0 + 1) / step) * step; rD(y) <= maxRd + 40; y += step) up.push(y);
  for (let y = Math.floor((y0 - 1) / step) * step; rA(y) <= maxRa + 40; y -= step) down.push(y);
  rings(C0, up, rD, true);
  rings(CA, down, rA, false);

  // ----- Bois : contours puis remplissages (aucune jointure visible) -----
  const edgeG = el('g', { class: 'ch-wood-edge' }, g);
  const woodG = el('g', { class: 'ch-wood' }, g);
  const grainG = el('g', { class: 'ch-grain' }, g);
  const wood = (d) => { el('path', { d }, edgeG); el('path', { d }, woodG); };
  const poly = (pts) => 'M' + pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L');
  const cyl = (m) => Array.from({ length: m }, (_, j) => 0.46 * Math.sin(-Math.PI / 2 + (Math.PI * (j + 0.5)) / m));

  // Une branche : part du centre de la section du parent (décalée de `off` le long
  // de la perpendiculaire), file en arc vers sa position, et arrive dans l'axe du rayon.
  // `lines` : positions relatives (-0,5 … 0,5) des nervures reçues du parent.
  // Une branche : part du centre de la section du parent (décalée de `off` le long
  // de la perpendiculaire) et tourne vers sa direction dans une zone de largeur
  // radiale D, commune à toute la fratrie (les branches ne peuvent donc pas se
  // croiser), puis file droit vers l'extérieur.
  // `lines` : positions relatives (-0,5 … 0,5) des nervures reçues du parent ;
  // elles se prolongent toutes jusqu'au bout de la branche, sans se croiser.
  function limb(center, r0, a0, k, w0, w1, off, lines, D) {
    const n = 34;
    const n0 = nrm(a0);
    const turn = (t) => ss(Math.min(1, ((k.r - r0) * t) / D));
    const at = (t) => {
      const e = turn(t), p = P(center, r0 + (k.r - r0) * t, a0 + (k.angle - a0) * e);
      return { x: p.x + n0.x * off * (1 - e), y: p.y + n0.y * off * (1 - e) };
    };
    const pts = Array.from({ length: n + 1 }, (_, i) => at(i / n));
    const width = (t) => w0 + (w1 - w0) * Math.pow(t, 0.75);
    const perp = pts.map((p, i) => {
      const q = pts[Math.min(i + 1, n)], s = pts[Math.max(i - 1, 0)];
      const dx = q.x - s.x, dy = q.y - s.y, len = Math.hypot(dx, dy) || 1;
      return { x: -dy / len, y: dx / len };
    });
    const side = (u) => pts.map((p, i) => ({ x: p.x + perp[i].x * u * width(i / n), y: p.y + perp[i].y * u * width(i / n) }));
    const L = side(0.5), Rr = side(-0.5);
    wood(poly([...L, ...Rr.reverse()]) + 'Z');
    // Nervures : dans l'ordre (aucun croisement), elles glissent vers une
    // répartition « cylindrique » pendant le virage, puis restent parallèles
    const keep = [...lines].sort((x, y) => x - y);
    const target = cyl(keep.length);
    keep.forEach((u0, j) => {
      const d = pts.map((p, i) => {
        const t = i / n, u = u0 + (target[j] - u0) * turn(t);
        return { x: p.x + perp[i].x * u * width(t), y: p.y + perp[i].y * u * width(t) };
      });
      el('path', { d: poly(d) }, grainG);
    });
    return { end: pts[n], lines: target };
  }

  // Fourche : répartit les enfants côte à côte sur la section du parent
  function grow(center, node, r0, a0, endW, lines, prefix) {
    const kids = [...node.kids].sort((a, b) => b.angle - a.angle);
    const D = Math.max(30, 0.8 * Math.min(...kids.map((k) => k.r - r0)));
    let acc = -endW / 2;
    kids.forEach((k, i) => {
      const lo = acc, hi = acc + k.start, pos = (lo + hi) / 2;
      acc = hi;
      const last = i === kids.length - 1;
      const mine = lines.map((u) => u * endW).filter((q) => q >= lo && (last ? q <= hi : q < hi)).map((q) => (q - pos) / k.start);
      const res = limb(center, r0, a0, k, k.start, k.end, pos, mine.length ? mine : [0], D);
      k.pt = res.end;
      if (k.kids.length) grow(center, k, k.r, k.angle, k.end, res.lines, prefix);
    });
  }

  // Tronc : du sol (largeur TB) au centre de l'éventail (largeur TW), bords verticaux aux deux bouts
  const G = GROUND;
  const edge = (s) => `C${f2((s * TB) / 2)} ${f2(G * 0.55)} ${f2((s * TW) / 2)} ${f2(G * 0.45)} ${f2((s * TW) / 2)} 0`;
  wood(`M${f2(-TB / 2)} ${G}${edge(-1)}L${f2(TW / 2)} 0C${f2(TW / 2)} ${f2(G * 0.45)} ${f2(TB / 2)} ${f2(G * 0.55)} ${f2(TB / 2)} ${G}Z`);
  const trunkLines = cyl(Math.max(6, Math.floor(TW / 3.2)));
  for (const u of trunkLines) {
    el('path', { d: `M${f2(u * TB)} ${G}C${f2(u * TB)} ${f2(G * 0.55)} ${f2(u * TW)} ${f2(G * 0.45)} ${f2(u * TW)} 0` }, grainG);
  }
  grow(C0, desc, 0, Math.PI / 2, TW, trunkLines, 'b');
  // Les racines partent du pied du tronc ; vu vers le bas, la gauche et la droite s'inversent
  grow(CA, anc, 0, (3 * Math.PI) / 2, TB, trunkLines.map((u) => -u), 'r');

  // Sol
  // (interrompu au pied du tronc)
  const rs = rng('sol');
  let d = '';
  for (const [x0, x1] of [[bbox.x + 40, -TB / 2 - 2], [TB / 2 + 2, bbox.x + bbox.w - 40]]) {
    d += `M${f2(x0)} ${GROUND}`;
    for (let x = x0; x < x1; x += 40) {
      const xe = Math.min(x + 40, x1);
      d += `Q${f2((x + xe) / 2)} ${f2(GROUND - 2 + rs() * 5)} ${f2(xe)} ${f2(xe === x1 ? GROUND : GROUND + rs() * 3)}`;
    }
  }
  el('path', { d, class: 'ch-ground' }, g);

  // ----- Noms, dans le sens des rayons ; couples sur deux lignes -----
  const labelG = el('g', {}, g);
  const CH = 6.3;
  const yr = (k) => `${k.est ? '~' : ''}${k.year}`;
  const shorten = (k, p, room) => {
    const options = [`${p.name} ${yr(k)}`, `${p.firstName || p.name} ${yr(k)}`, p.firstName || p.name];
    return options.find((s) => s.length * CH <= room) || fit(options[2], Math.max(3, Math.floor(room / CH)));
  };
  // Bout de branche : le nom file vers l'extérieur. Nœud : le nom est écrit le long
  // de la branche qui y arrive (entre le parent et le nœud), pour ne pas couvrir les enfants.
  const place = (center, k, couple, parentR) => {
    const p = db.get(k.id);
    const a = k.angle, flip = Math.cos(a) < 0;
    const inner = k.kids.length > 0;
    const at = P(center, inner ? k.r - 9 : k.r + 8, a);
    const rot = flip ? 180 - deg(a) : -deg(a);
    const grp = el('g', { class: 't-person ch-person', 'data-id': k.id, transform: `translate(${f2(at.x)} ${f2(at.y)}) rotate(${f2(rot)})` }, labelG);
    const room = inner ? k.r - Math.max(parentR, 40) - 22 : 400;
    const toEnd = inner !== flip; // le texte se termine au point d'ancrage
    const anchor = { 'text-anchor': toEnd ? 'end' : 'start' };
    const spouses = couple ? db.spousesOf(k.id) : [];
    let lines;
    if (spouses.length) {
      const sp = db.get(spouses[0]);
      const spLine = sp.name + (sp.birthYear ? ' ' + sp.birthYear : '') + (spouses.length > 1 ? ` (+${spouses.length - 1})` : '');
      lines = [
        [shorten(k, p, room), 'ch-name', -13],
        [marriageText(db, k.id, spouses[0]), 'ch-date', 1],
        [room < 400 ? fit(spLine, Math.max(4, Math.floor(room / CH))) : spLine, 'ch-name spouse', 15],
      ];
    } else lines = [[shorten(k, p, room), 'ch-name', 4]];
    const w = Math.max(...lines.map((l) => l[0].length)) * CH + 10;
    el('rect', { x: toEnd ? -w : 0, y: spouses.length ? -24 : -9, width: w, height: spouses.length ? 46 : 16, fill: 'transparent' }, grp);
    for (const [s, cls, y] of lines) text(grp, 0, y, s, k.est && cls === 'ch-name' ? cls + ' est' : cls, anchor);
    const dot = P(center, k.r, a);
    el('circle', { cx: f2(dot.x), cy: f2(dot.y), r: 3.2, class: 'ch-dot' }, labelG);
  };
  (function walk(n, r) { for (const k of n.kids) { place(C0, k, true, r); walk(k, k.r); } })(desc, 0);
  (function walk(n, r) { for (const k of n.kids) { place(CA, k, false, r); walk(k, k.r); } })(anc, 0);

  // ----- Le couple, gravé sur le tronc -----
  const cy = GROUND * 0.5;
  const plaque = el('g', {}, g);
  const H = spouseId ? 150 : 96, W = 280;
  el('path', { d: `M${-W / 2} ${cy - H / 2}h${W}c-10 18 -10 ${H - 36} 0 ${H}h${-W}c10 -18 10 ${-(H - 36)} 0 ${-H}Z`, class: 'ch-plaque' }, plaque);
  el('path', { d: `M${-W / 2 + 10} ${cy - H / 2 + 8}h${W - 20}c-8 15 -8 ${H - 46} 0 ${H - 16}h${-(W - 20)}c8 -15 8 ${-(H - 46)} 0 ${-(H - 16)}Z`, class: 'ch-plaque-inner' }, plaque);
  const life = (p, est, y) => `${est ? '~' : ''}${y || p.birthYear || ''}${p.deathYear ? ' – ' + p.deathYear : ''}`;
  const rg = el('g', { class: 't-person ch-person', 'data-id': root.id }, g);
  el('rect', { x: -W / 2, y: cy - H / 2, width: W, height: spouseId ? H / 2 - 12 : H, fill: 'transparent' }, rg);
  const top = spouseId ? cy - 42 : cy - 4;
  text(rg, 0, top, fit(root.name, 22), 'ch-script', { 'text-anchor': 'middle' });
  text(rg, 0, top + 22, life(root, rootEst, y0), 'ch-italic', { 'text-anchor': 'middle' });
  if (spouseId) {
    const sp = db.get(spouseId);
    text(g, 0, cy + 12, marriageText(db, root.id, spouseId), 'ch-date big', { 'text-anchor': 'middle' });
    const sg = el('g', { class: 't-person ch-person', 'data-id': spouseId }, g);
    el('rect', { x: -W / 2, y: cy + 18, width: W, height: H / 2 - 18, fill: 'transparent' }, sg);
    text(sg, 0, cy + 44, fit(sp.name, 22), 'ch-script', { 'text-anchor': 'middle' });
    text(sg, 0, cy + 64, life(sp, false), 'ch-italic', { 'text-anchor': 'middle' });
  }

  // ----- Titre -----
  const title = `Généalogie de la famille ${root.lastName || root.name}`.toUpperCase();
  text(g, 0, bbox.y + 96, title, 'ch-title', { 'text-anchor': 'middle' });
  text(g, 0, bbox.y + 132, `Cercles tous les ${step} ans · ~ année estimée · ∞ mariage`, 'ch-italic', { 'text-anchor': 'middle' });
}

export const CHRONO_STYLE = `
  .ch-paper{fill:#f6eedb}
  .ch-frame{fill:none;stroke:${INK};stroke-width:3}
  .ch-frame.thin{stroke-width:1;opacity:.7}
  .ch-band{fill:#e9dcb8;opacity:.55}
  .ch-ring{fill:none;stroke:${INK};stroke-width:.8;opacity:.35;stroke-dasharray:4 5}
  .ch-ring.major{stroke-width:1.3;opacity:.55;stroke-dasharray:none}
  .ch-year{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:13px;fill:${INK};opacity:.75}
  .ch-wood-edge path{fill:${INK};stroke:${INK};stroke-width:3;stroke-linejoin:round}
  .ch-wood path{fill:#d8c197;stroke:none}
  .ch-grain path{fill:none;stroke:${INK};stroke-width:.7;opacity:.42;stroke-linecap:round}
  .ch-ground{fill:none;stroke:${INK};stroke-width:2}
  .ch-dot{fill:${INK}}
  .ch-person{cursor:pointer}
  .ch-person text{pointer-events:none}
  .ch-name{font-family:'IM Fell English',Georgia,serif;font-size:13px;fill:${INK};paint-order:stroke;stroke:#f6eedb;stroke-width:3.5px;stroke-linejoin:round}
  .ch-name.est{font-style:italic}
  .ch-name.spouse{font-style:italic;opacity:.85}
  .ch-date{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:11px;fill:${INK};paint-order:stroke;stroke:#f6eedb;stroke-width:3px}
  .ch-date.big{font-size:15px}
  .ch-plaque{fill:#f5ebcf;stroke:${INK};stroke-width:2}
  .ch-plaque-inner{fill:none;stroke:${INK};stroke-width:.8;opacity:.7}
  .ch-script{font-family:'Pinyon Script',cursive;font-size:28px;fill:${INK}}
  .ch-italic{font-family:'IM Fell English',Georgia,serif;font-style:italic;font-size:16px;fill:${INK}}
  .ch-title{font-family:'IM Fell English',Georgia,serif;font-size:40px;letter-spacing:.18em;fill:${INK}}
`;
