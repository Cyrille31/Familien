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
import { el, text, rng, fit, f2, INK, cyl, drawGrain, wave, perpendiculars, taper, trunkShape, drawSoil, drawSurfaceLife, spousesMainFirst, marriageDate } from './oak.js';

const K = 6.5;          // pixels par année
const GROUND = 440;     // le sol, sous le centre de l'éventail
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
  const spouseId = spousesMainFirst(db, rootId)[0] || null;

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
  const date = marriageDate(db, a, b);
  return date ? `∞ ${date}` : '∞';
}

function renderChrono(g, db, o) {
  const { root, spouseId, desc, anc, bbox, y0, rootEst, step, rD, rA, maxRd, maxRa, TW, TB } = o;
  const C0 = { x: 0, y: 0 };
  const CA = { x: 0, y: GROUND };

  el('rect', { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h, class: 'ch-paper' }, g);
  el('rect', { x: bbox.x + 18, y: bbox.y + 18, width: bbox.w - 36, height: bbox.h - 36, rx: 60, class: 'ch-frame' }, g);
  el('rect', { x: bbox.x + 28, y: bbox.y + 28, width: bbox.w - 56, height: bbox.h - 56, rx: 52, class: 'ch-frame thin' }, g);

  // ----- Coupe du sol (sous les cercles et le bois) -----
  drawSoil(g, { x0: bbox.x + 28, x1: bbox.x + bbox.w - 28, ground: GROUND, bottom: bbox.y + bbox.h - 28, seed: 'ch' + root.id, rx: 52 });

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
      const ly = center.y + 18; // sous la ligne de sol pour les racines, libre pour la vie de surface
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
  const knotG = el('g', { class: 'ch-knot' }, g);
  // (le remplissage a un liseré de sa couleur : il recouvre les coutures entre pièces voisines)
  const wood = (d) => { el('path', { d }, edgeG); el('path', { d }, woodG); };
  const poly = (pts) => 'M' + pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L');

  // Une branche : part du centre de la section du parent (décalée de `off` le long
  // de la perpendiculaire), file en arc vers sa position, et arrive dans l'axe du rayon.
  // `lines` : positions relatives (-0,5 … 0,5) des nervures reçues du parent.
  // Une branche : part du centre de la section du parent (décalée de `off` le long
  // de la perpendiculaire) et tourne vers sa direction dans une zone de largeur
  // radiale D, commune à toute la fratrie (les branches ne peuvent donc pas se
  // croiser), puis file droit vers l'extérieur.
  // `lines` : positions relatives (-0,5 … 0,5) des nervures reçues du parent ;
  // elles se prolongent toutes jusqu'au bout de la branche, sans se croiser.
  // Une branche : part de sa place sur la section du parent (décalage `off` le long
  // de la perpendiculaire), dans la direction du parent, rejoint en courbe le cercle
  // r0 + D sur son propre rayon (D commun à la fratrie : pas de croisement), puis
  // file droit vers l'extérieur jusqu'à son nœud.
  // `lines` : positions relatives (-0,5 … 0,5) des nervures reçues du parent ;
  // elles se prolongent toutes jusqu'au bout de la branche, sans se croiser.
  function limb(center, r0, a0, k, w0, w1, off, lines, D, minSlot) {
    const n0 = nrm(a0), d0 = { x: Math.cos(a0), y: -Math.sin(a0) }, u1 = { x: Math.cos(k.angle), y: -Math.sin(k.angle) };
    const base = P(center, r0, a0);
    const S = { x: base.x + n0.x * off, y: base.y + n0.y * off };
    const rT = Math.min(k.r, r0 + D);
    const Q = P(center, rT, k.angle);
    // Tangentes de même longueur pour toute la fratrie (pas de croisement), virage ample
    const h = D * 0.5;
    const c0 = { x: S.x + d0.x * h, y: S.y + d0.y * h }, c1 = { x: Q.x - u1.x * h, y: Q.y - u1.y * h };
    const n1 = 28, n2 = k.r > rT + 1 ? 14 : 0, raw = [];
    for (let i = 0; i <= n1; i++) {
      const t = i / n1, v = 1 - t;
      raw.push({ x: v * v * v * S.x + 3 * v * v * t * c0.x + 3 * v * t * t * c1.x + t * t * t * Q.x, y: v * v * v * S.y + 3 * v * v * t * c0.y + 3 * v * t * t * c1.y + t * t * t * Q.y });
    }
    for (let i = 1; i <= n2; i++) raw.push(P(center, rT + ((k.r - rT) * i) / n2, k.angle));
    const n = raw.length - 1;
    // Axe légèrement ondulé (nul aux deux bouts : raccords parfaits)
    // (amplitude bornée par la place angulaire de la branche : pas de croisement avec ses voisines)
    const room = 0.22 * Math.min(k.slot, minSlot) * (r0 + k.r) / 2;
    const pts = wave(raw, 'b' + k.id, Math.min(12, 2 + Math.abs(k.r - r0) * 0.02, room));
    if (globalThis.__FAMILIEN_DEBUG) (globalThis.__limbs ||= []).push({ id: k.id, pts });
    const perp = perpendiculars(pts);
    perp[0] = { x: -d0.y, y: d0.x }; // départ exactement dans l'axe du parent : rainures alignées sur les siennes
    const width = taper(w0, w1); // s'amincit sans à-coup : même largeur et même direction à la jonction
    const side = (u) => pts.map((p, i) => ({ x: p.x + perp[i].x * u * width(i / n), y: p.y + perp[i].y * u * width(i / n) }));
    wood(poly([...side(0.5), ...side(-0.5).reverse()]) + 'Z');
    const keep = [...lines].sort((x, y) => x - y);
    const target = cyl(keep.length);
    drawGrain(grainG, knotG, pts, perp, width, keep, target, (t) => ss(Math.min(1, (t * n) / n1)), k.id);
    return { end: pts[n], lines: target };
  }

  // Fourche : répartit les enfants côte à côte sur la section du parent
  function grow(center, node, r0, a0, endW, lines, prefix) {
    const kids = [...node.kids].sort((a, b) => b.angle - a.angle);
    const D = Math.max(30, 0.8 * Math.min(...kids.map((k) => k.r - r0)));
    const minSlot = Math.min(...kids.map((k) => k.slot));
    let acc = -endW / 2;
    kids.forEach((k, i) => {
      const lo = acc, hi = acc + k.start, pos = (lo + hi) / 2;
      acc = hi;
      const last = i === kids.length - 1;
      const mine = lines.map((u) => u * endW).filter((q) => q >= lo && (last ? q <= hi : q < hi)).map((q) => (q - pos) / k.start);
      const res = limb(center, r0, a0, k, k.start, k.end, pos, mine, D, minSlot);
      k.pt = res.end;
      if (k.kids.length) grow(center, k, k.r, k.angle, k.end, res.lines, prefix);
    });
  }

  // Tronc : du sol (largeur TB) au centre de l'éventail (largeur TW), bords verticaux aux deux bouts
  const G = GROUND;
  const trunk = trunkShape(G, 0, TB, TW, root.id);
  wood(trunk.d);
  const trunkLines = cyl(Math.max(8, Math.floor(TW / 3.2)));
  // Deux nœuds de part et d'autre du cartouche : l'un à gauche, l'autre à droite
  drawGrain(grainG, knotG, trunk.pts, trunk.perp, trunk.width, trunkLines, trunkLines, () => 0, 'tronc',
    { knots: [{ t: [0.15, 0.17], u: -0.24 }, { t: [0.83, 0.85], u: 0.24 }], knotChance: 1, rho: 0.13 });
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
  drawSurfaceLife(g, { x0: bbox.x + 60, x1: bbox.x + bbox.w - 60, ground: GROUND, avoid: [[-TB / 2 - 40, TB / 2 + 40]], seed: 'ch' + root.id });

  // ----- Couples d'ancêtres : un trait souple les relie, avec la date de mariage -----
  const coupleG = el('g', { class: 'ch-couple' }, g);
  const coupleLink = (a, b) => {
    const A = P(CA, a.r, a.angle), B = P(CA, b.r, b.angle);
    const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const ol = Math.hypot(M.x - CA.x, M.y - CA.y) || 1, out = { x: (M.x - CA.x) / ol, y: (M.y - CA.y) / ol };
    const C = { x: M.x + out.x * len * 0.16, y: M.y + out.y * len * 0.16 };
    el('path', { d: `M${f2(A.x)} ${f2(A.y)}Q${f2(C.x)} ${f2(C.y)} ${f2(B.x)} ${f2(B.y)}` }, coupleG);
    const T = { x: (A.x + 2 * C.x + B.x) / 4 + out.x * 9, y: (A.y + 2 * C.y + B.y) / 4 + out.y * 9 };
    let rot = deg(Math.atan2(B.y - A.y, B.x - A.x));
    if (rot > 90) rot -= 180; else if (rot < -90) rot += 180;
    text(coupleG, 0, 0, marriageText(db, a.id, b.id), 'ch-date', { 'text-anchor': 'middle', transform: `translate(${f2(T.x)} ${f2(T.y + 3)}) rotate(${f2(rot)})` });
  };
  (function couples(n, top) {
    const groups = top ? [n.kids.filter((k) => k.base === 'root'), n.kids.filter((k) => k.base === 'spouse')] : [n.kids];
    for (const grp of groups) if (grp.length === 2) coupleLink(grp[0], grp[1]);
    for (const k of n.kids) couples(k, false);
  })(anc, true);

  // ----- Noms, dans le sens des rayons ; couples sur deux lignes -----
  const labelG = el('g', {}, g);
  const CH = 6.3;
  const yr = (k) => `${k.est ? '~' : ''}${k.year}`;
  // Le nom complet est gardé : texte un peu réduit (80 %) avec l'année, puis sans,
  // puis réduit jusqu'à 55 % ; en dernier recours seulement, il est tronqué.
  const MIN = 0.55;
  const sized = (opts, room) => {
    for (const o of opts) if (o.length * CH * 0.8 <= room) return [o, Math.min(1, room / (o.length * CH))];
    const last = opts[opts.length - 1];
    const sc = room / (last.length * CH);
    if (sc >= MIN) return [last, sc];
    return [fit(last, Math.max(3, Math.floor(room / (CH * MIN)))), MIN];
  };
  const shorten = (k, p, room) => sized([`${p.name} ${yr(k)}`, p.name], room);
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
    const spouses = couple ? spousesMainFirst(db, k.id) : [];
    let lines;
    if (spouses.length) {
      const sp = db.get(spouses[0]);
      const spLine = sp.name + (sp.birthYear ? ' ' + sp.birthYear : '') + (spouses.length > 1 ? ` (+${spouses.length - 1})` : '');
      lines = [
        [...shorten(k, p, room), 'ch-name', -13],
        [marriageText(db, k.id, spouses[0]), 1, 'ch-date', 1],
        [...sized([spLine, sp.name], room), 'ch-name spouse', 15],
      ];
    } else lines = [[...shorten(k, p, room), 'ch-name', 4]];
    const w = Math.max(...lines.map((l) => l[0].length * CH * l[1])) + 10;
    el('rect', { x: toEnd ? -w : 0, y: spouses.length ? -24 : -9, width: w, height: spouses.length ? 46 : 16, fill: 'transparent' }, grp);
    for (const [s, sc, cls, y] of lines) {
      // La ligne du conjoint ouvre la fiche du conjoint, pas celle du descendant
      let into = grp;
      if (cls === 'ch-name spouse') {
        into = el('g', { class: 't-person ch-person', 'data-id': spouses[0] }, grp);
        const sw = s.length * CH * sc + 10;
        el('rect', { x: toEnd ? -sw : 0, y: y - 11, width: sw, height: 15, fill: 'transparent' }, into);
      }
      const size = sc < 1 ? { style: `font-size:${f2(13 * sc)}px` } : {};
      text(into, 0, y, s, k.est && cls === 'ch-name' ? cls + ' est' : cls, { ...anchor, ...size });
    }
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
  .ch-wood-edge path{fill:${INK};stroke:${INK};stroke-width:4;stroke-linejoin:round}
  .ch-wood path{fill:#d8c197;stroke:#d8c197;stroke-width:1.4;stroke-linejoin:round}
  .ch-grain path{fill:none;stroke:#978262;stroke-width:.7;stroke-linecap:butt;stroke-linejoin:round}
  .ch-knot path{fill:none;stroke-linejoin:round;stroke:${INK};stroke-width:.9;opacity:.6}
  .ch-knot path.core{fill:${INK};opacity:.55}
  .ch-ground{fill:none;stroke:${INK};stroke-width:2}
  .ch-couple path{fill:none;stroke:${INK};stroke-width:1.3;opacity:.7;stroke-linecap:round}
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
