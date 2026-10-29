// Mise en page et dessin de l'arbre : ascendants au-dessus, descendants (avec conjoints) en dessous.

export const BOX_W = 176;
export const BOX_H = 72;
const H_GAP = 22;
const V_GAP = 60;
const SP_GAP = 14;
const ROW = BOX_H + V_GAP;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Compactage par contours (type Reingold-Tilford simplifié).
export function layoutTree(root, extent, childCenter) {
  function rec(node) {
    const [l, r] = extent(node);
    // Pile verticale d'enfants (vue intermédiaire) : occupe plusieurs niveaux
    if (node.levels) { node.kidOffsets = []; return Array.from({ length: node.levels }, () => [l, r]); }
    if (!node.kids.length) { node.kidOffsets = []; return [[l, r]]; }
    const contours = node.kids.map(rec);
    const offs = [0];
    const merged = contours[0].map((a) => a.slice());
    for (let i = 1; i < contours.length; i++) {
      const c = contours[i];
      let shift = -Infinity;
      for (let d = 0; d < Math.min(merged.length, c.length); d++) shift = Math.max(shift, merged[d][1] - c[d][0] + H_GAP);
      offs.push(shift);
      for (let d = 0; d < c.length; d++) {
        const a = [c[d][0] + shift, c[d][1] + shift];
        if (d < merged.length) { merged[d][0] = Math.min(merged[d][0], a[0]); merged[d][1] = Math.max(merged[d][1], a[1]); }
        else merged.push(a);
      }
    }
    const first = node.kids[0], last = node.kids[node.kids.length - 1];
    const ef = extent(first), el = extent(last);
    const mid = (offs[0] + (ef[0] + ef[1]) / 2 + offs[offs.length - 1] + (el[0] + el[1]) / 2) / 2;
    const delta = childCenter(node) - mid;
    node.kidOffsets = offs.map((o) => o + delta);
    return [[l, r], ...merged.map(([a, b]) => [a + delta, b + delta])];
  }
  rec(root);
  (function place(node, x, depth) {
    node.x = x; node.depth = depth;
    node.kids.forEach((k, i) => place(k, x + node.kidOffsets[i], depth + 1));
  })(root, 0, 0);
}

export function buildAncestors(db, id, maxDepth) {
  const path = new Set();
  const rec = (pid, depth) => {
    const p = db.get(pid);
    const node = { id: pid, kids: [], more: false };
    if (path.has(pid)) return node;
    const parents = [p.father, p.mother].filter(Boolean);
    if (depth >= maxDepth) { node.more = parents.length > 0; return node; }
    path.add(pid);
    for (const par of parents) node.kids.push(rec(par, depth + 1));
    path.delete(pid);
    return node;
  };
  return rec(id, 0);
}

export function buildDescendants(db, id, maxDepth) {
  const path = new Set();
  const rec = (pid, depth) => {
    const kidsAll = db.childrenOf(pid);
    const spouses = db.spousesOf(pid).slice();
    const node = { id: pid, spouses, kids: [], groups: [], more: false };
    if (path.has(pid)) return node;
    if (depth >= maxDepth) { node.more = kidsAll.length > 0; return node; }
    path.add(pid);
    // Regroupe les enfants par autre parent (ordre des conjoints)
    const groupOf = (cid) => {
      const c = db.get(cid);
      const other = c.father === pid ? c.mother : c.father;
      if (other && !spouses.includes(other)) spouses.push(other);
      return other ? spouses.indexOf(other) : -1;
    };
    const tagged = kidsAll.map((cid, i) => ({ cid, g: groupOf(cid), i }));
    tagged.sort((a, b) => a.g - b.g || a.i - b.i);
    for (const t of tagged) {
      node.kids.push(rec(t.cid, depth + 1));
      node.groups.push(t.g);
    }
    path.delete(pid);
    return node;
  };
  return rec(id, 0);
}

const spouseX = (node, k) => node.x + (k + 1) * (BOX_W + SP_GAP);

const S_ROW = BOX_H + 14;   // pas vertical d'une pile d'enfants
const S_LINE = 12;          // trait vertical à gauche de la pile

// Vue intermédiaire : dans chaque fratrie, les enfants sans descendants affichés
// sont regroupés en une pile verticale (une par conjoint).
function stackLeaves(node) {
  if (!node.kids.length) return;
  node.kids.forEach(stackLeaves);
  // Seuls les enfants sans descendants qui se suivent forment une pile :
  // l'ordre de naissance est conservé (de gauche à droite, puis de haut en bas).
  const kids = [], groups = [];
  let i = 0;
  while (i < node.kids.length) {
    const g = node.groups[i];
    if (node.kids[i].kids.length) { kids.push(node.kids[i]); groups.push(g); i++; continue; }
    const run = [];
    for (; i < node.kids.length && node.groups[i] === g && !node.kids[i].kids.length; i++) run.push(node.kids[i]);
    if (run.length > 1) {
      const levels = 1 + Math.ceil(((run.length - 1) * S_ROW) / ROW);
      kids.push({ stack: run, kids: [], spouses: [], levels });
      groups.push(g);
    } else { kids.push(run[0]); groups.push(g); }
  }
  node.kids = kids;
  node.groups = groups;
}

// Place une rangée de cases au plus près des positions souhaitées, sans chevauchement
// et sans changer leur ordre (régression isotone, « pool adjacent violators »).
function packRow(desired, gap) {
  const blocks = [];
  desired.forEach((p, i) => {
    blocks.push({ sum: p - i * gap, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum; a.n += b.n; blocks.pop();
    }
  });
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n + out.length * gap);
  return out;
}

// Ascendants resserrés : chaque couple de parents au plus près au-dessus de son enfant.
export function layoutAncestorsClose(anc) {
  const rows = [];
  (function collect(n, depth, child) {
    n.depth = depth; n.child = child;
    (rows[depth] ||= []).push(n);
    n.kids.forEach((k) => collect(k, depth + 1, n));
  })(anc, 0, null);
  anc.x = 0;
  const step = BOX_W + H_GAP;
  for (let d = 1; d < rows.length; d++) {
    const desired = rows[d].map((n) => {
      const c = n.child;
      if (c.kids.length === 1) return c.x;
      return c.x + (c.kids.indexOf(n) === 0 ? -step / 2 : step / 2);
    });
    packRow(desired, step).forEach((x, i) => { rows[d][i].x = x; });
  }
}

export function computeTree(db, rootId, ancDepth, descDepth, { mixed = false } = {}) {
  const anc = buildAncestors(db, rootId, ancDepth);
  if (mixed) layoutAncestorsClose(anc);
  else layoutTree(anc, () => [-BOX_W / 2, BOX_W / 2], () => 0);
  const desc = buildDescendants(db, rootId, descDepth);
  if (mixed) stackLeaves(desc);
  const maxSp = (n) => Math.max(0, ...n.stack.map((k) => k.spouses.length));
  const ext = (n) => n.stack
    ? [-BOX_W / 2 - S_LINE - 2, BOX_W / 2 + maxSp(n) * (BOX_W + SP_GAP)]
    : [-BOX_W / 2, BOX_W / 2 + n.spouses.length * (BOX_W + SP_GAP)];
  layoutTree(desc, ext, (n) => (ext(n)[0] + ext(n)[1]) / 2);

  const boxes = [];   // { id, x, y, kind, more }
  const lines = [];   // chemins SVG
  const unions = [];

  // Ascendants (la racine est dessinée avec les descendants)
  let ancCount = 0;
  (function walk(n) {
    const y = -n.depth * ROW;
    if (n.depth > 0) { boxes.push({ id: n.id, x: n.x, y, kind: 'anc', more: n.more ? 'up' : '' }); ancCount++; }
    if (n.kids.length && mixed) {
      // Courbes : ne se croisent jamais, même quand les parents sont décalés
      const top = y - BOX_H / 2;
      let d = '';
      for (const k of n.kids) {
        const ky = -k.depth * ROW + BOX_H / 2;
        const my = (top + ky) / 2;
        d += `M${n.x} ${top}C${n.x} ${my} ${k.x} ${my} ${k.x} ${ky}`;
      }
      lines.push(d);
    } else if (n.kids.length) {
      const top = y - BOX_H / 2;
      const bus = top - V_GAP / 2;
      const xs = n.kids.map((k) => k.x);
      let d = `M${n.x} ${top}V${bus}`;
      d += `M${Math.min(n.x, ...xs)} ${bus}H${Math.max(n.x, ...xs)}`;
      for (const k of n.kids) d += `M${k.x} ${bus}V${-k.depth * ROW + BOX_H / 2}`;
      lines.push(d);
    }
    n.kids.forEach(walk);
  })(anc);

  let descCount = 0;
  const stackLineX = (k) => k.x - BOX_W / 2 - S_LINE;
  (function walk(n) {
    const y = n.depth * ROW;
    if (n.stack) {
      n.stack.forEach((leaf, j) => {
        const ly = y + j * S_ROW;
        boxes.push({ id: leaf.id, x: n.x, y: ly, kind: 'desc', more: leaf.more ? 'down' : '' });
        descCount++;
        leaf.spouses.forEach((sid, k) => {
          const sx = n.x + (k + 1) * (BOX_W + SP_GAP);
          boxes.push({ id: sid, x: sx, y: ly, kind: 'spouse', more: '' });
          unions.push(`M${n.x + BOX_W / 2} ${ly}H${sx - BOX_W / 2}`);
        });
      });
      return;
    }
    boxes.push({ id: n.id, x: n.x, y, kind: n.depth === 0 ? 'root' : 'desc', more: n.more ? 'down' : '' });
    if (n.depth > 0) descCount++;
    n.spouses.forEach((sid, k) => {
      boxes.push({ id: sid, x: spouseX(n, k), y, kind: 'spouse', more: '' });
      unions.push(`M${n.x + BOX_W / 2} ${y}H${spouseX(n, k) - BOX_W / 2}`);
    });
    if (n.kids.length) {
      const groups = new Map();
      n.kids.forEach((k, i) => {
        const g = n.groups[i];
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(k);
      });
      let gi = 0;
      for (const [g, kids] of groups) {
        const sx = g < 0 ? n.x : spouseX(n, g) - BOX_W / 2 - SP_GAP / 2;
        const sy = g < 0 ? y + BOX_H / 2 : y;
        const bus = y + BOX_H / 2 + V_GAP / 2 + (gi++) * 5 - 5 * (groups.size - 1) / 2;
        const xs = kids.map((k) => (k.stack ? stackLineX(k) : k.x));
        let d = `M${sx} ${sy}V${bus}M${Math.min(sx, ...xs)} ${bus}H${Math.max(sx, ...xs)}`;
        for (const k of kids) {
          if (!k.stack) { d += `M${k.x} ${bus}V${k.depth * ROW - BOX_H / 2}`; continue; }
          // Pile : trait vertical à gauche, puis un petit trait vers chaque enfant
          const lx = stackLineX(k), y0 = k.depth * ROW;
          d += `M${lx} ${bus}V${y0 + (k.stack.length - 1) * S_ROW}`;
          k.stack.forEach((_, j) => { d += `M${lx} ${y0 + j * S_ROW}H${k.x - BOX_W / 2}`; });
        }
        lines.push(d);
      }
    }
    n.kids.forEach(walk);
  })(desc);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - BOX_W / 2); maxX = Math.max(maxX, b.x + BOX_W / 2);
    minY = Math.min(minY, b.y - BOX_H / 2); maxY = Math.max(maxY, b.y + BOX_H / 2);
  }
  const pad = 30;
  return {
    boxes, lines, unions, ancCount, descCount,
    bbox: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad },
  };
}

// ---------- Vue compacte (verticale) ----------
// Ascendants « en escalier » : chaque personne a son père juste au-dessus d'elle,
// décalé d'un cran vers l'extérieur, et sa mère au-dessus de la lignée du père.
// Côté paternel à gauche, côté maternel à droite (en miroir), de sorte que le
// père et la mère sont tous deux juste au-dessus de la personne choisie.
// Descendants en liste indentée, un par ligne, conjoints à droite.

const C_IND = 26;              // décalage d'une génération
const C_ROW = BOX_H + 12;      // hauteur d'une ligne
const C_GAP = 24;              // écart entre côté paternel et côté maternel
const C_ROOT_GAP = 22;         // espace supplémentaire autour de la personne choisie

// Lignes (de haut en bas) de la personne et de ses ascendants, la personne en dernier.
function ancestorRows(db, id, gen, maxDepth, path) {
  const p = db.get(id);
  if (!p) return [];
  const parents = [p.father, p.mother].filter(Boolean);
  if (gen >= maxDepth || path.has(id)) return [{ id, gen, more: gen >= maxDepth && parents.length > 0, parents: [] }];
  path.add(id);
  const rows = [];
  const me = { id, gen, more: false, parents: [] };
  for (const q of [p.mother, p.father]) {
    if (!q) continue;
    const sub = ancestorRows(db, q, gen + 1, maxDepth, path);
    if (sub.length) me.parents.push(sub[sub.length - 1]);
    rows.push(...sub);
  }
  path.delete(id);
  rows.push(me);
  return rows;
}

export function computeCompactTree(db, rootId, ancDepth, descDepth) {
  const boxes = [];
  const lines = [];
  const unions = [];
  const root = db.get(rootId);
  const half = BOX_W / 2;

  // --- Ascendants ---
  // Bord gauche d'une case selon le côté et la génération (gen 1 = parents).
  const leftEdge = (side, gen) => side === 'L'
    ? -C_GAP / 2 - BOX_W - (gen - 1) * C_IND
    : C_GAP / 2 + (gen - 1) * C_IND;
  let ancCount = 0;
  let fPos = null, mPos = null;
  const sides = [['L', root.father], ['R', root.mother]];
  const parentRowY = -(C_ROW + C_ROOT_GAP);
  for (const [side, pid] of sides) {
    if (!pid || ancDepth < 1) continue;
    const rows = ancestorRows(db, pid, 1, ancDepth, new Set([rootId]));
    rows.forEach((r, i) => {
      const y = parentRowY - (rows.length - 1 - i) * C_ROW;
      const x = leftEdge(side, r.gen);
      r.x = x; r.y = y;
      boxes.push({ id: r.id, x: x + half, y, kind: 'anc', more: r.more ? 'up' : '' });
      ancCount++;
    });
    // Traits : des parents vers l'enfant, par le côté extérieur au tronc
    if (side === 'L') fPos = rows[rows.length - 1]; else mPos = rows[rows.length - 1];
    for (const me of rows) {
      const par = me.parents;
      if (!par.length) continue;
      const lx = side === 'L' ? me.x + BOX_W - C_IND / 2 : me.x + C_IND / 2;
      let d = '';
      for (const q of par) d += `M${side === 'L' ? q.x + BOX_W : q.x} ${q.y}H${lx}`;
      d += `M${lx} ${Math.min(...par.map((q) => q.y))}V${me.y - BOX_H / 2}`;
      lines.push(d);
    }
  }
  // Trait des deux parents vers la personne choisie
  if (fPos || mPos) {
    const bus = -BOX_H / 2 - C_ROOT_GAP / 2 - 4;
    const xs = [];
    let d = '';
    for (const q of [fPos, mPos].filter(Boolean)) {
      xs.push(q.x + half);
      d += `M${q.x + half} ${q.y + BOX_H / 2}V${bus}`;
    }
    d += `M${Math.min(0, ...xs)} ${bus}H${Math.max(0, ...xs)}M0 ${bus}V${-BOX_H / 2}`;
    lines.push(d);
  }

  // --- Personne choisie et descendants : liste indentée ---
  const desc = buildDescendants(db, rootId, descDepth);
  let row = 0;
  let descCount = 0;
  const rootLeft = -half;
  (function walk(n, depth) {
    const x = rootLeft + depth * C_IND;
    const y = row === 0 ? 0 : row * C_ROW + C_ROOT_GAP;
    row++;
    n.x = x; n.y = y;
    boxes.push({ id: n.id, x: x + half, y, kind: depth === 0 ? 'root' : 'desc', more: n.more ? 'down' : '' });
    if (depth > 0) descCount++;
    n.spouses.forEach((sid, k) => {
      const sx = x + (k + 1) * (BOX_W + SP_GAP);
      boxes.push({ id: sid, x: sx + half, y, kind: 'spouse', more: '' });
      unions.push(`M${x + BOX_W} ${y}H${sx}`);
    });
    n.kids.forEach((k) => walk(k, depth + 1));
    if (n.kids.length) {
      const lx = x + C_IND / 2;
      let d = `M${lx} ${y + BOX_H / 2}V${n.kids[n.kids.length - 1].y}`;
      for (const k of n.kids) d += `M${lx} ${k.y}H${k.x}`;
      lines.push(d);
    }
  })(desc, 0);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - half); maxX = Math.max(maxX, b.x + half);
    minY = Math.min(minY, b.y - BOX_H / 2); maxY = Math.max(maxY, b.y + BOX_H / 2);
  }
  const pad = 30;
  return {
    boxes, lines, unions, ancCount, descCount, compact: true,
    // Largeur à montrer à l'ouverture : les deux parents et quelques crans d'ancêtres
    focusWidth: 2 * BOX_W + C_GAP + 5 * C_IND + 20,
    bbox: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad },
  };
}

// ---------- Lien entre deux personnes ----------
// Le chemin est dessiné de gauche à droite : on monte d'une génération vers un
// parent, on descend vers un enfant, on reste au même niveau vers un conjoint.
export function computePathTree(db, relation) {
  const boxes = [], lines = [], unions = [];
  const step = BOX_W + H_GAP;
  const pts = [];
  let x = 0, level = 0;
  relation.steps.forEach((s, i) => {
    if (s.move === 'up') { level--; x += step / 2; }
    else if (s.move === 'down') { level++; x += step / 2; }
    else if (s.move === 'spouse') x += BOX_W + SP_GAP;
    const last = i === 0 || i === relation.steps.length - 1;
    pts.push({ id: s.id, x, y: level * ROW });
    boxes.push({ id: s.id, x, y: level * ROW, kind: last ? 'root' : 'anc', more: '' });
  });
  // Conjoint de l'ancêtre commun, s'il est aussi ancêtre commun
  let coPt = null;
  if (relation.co) {
    const c = pts[relation.coIndex];
    coPt = { x: c.x + BOX_W + SP_GAP, y: c.y };
    boxes.push({ id: relation.co, x: coPt.x, y: coPt.y, kind: 'spouse', more: '' });
    unions.push(`M${c.x + BOX_W / 2} ${c.y}H${coPt.x - BOX_W / 2}`);
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], move = relation.steps[i].move;
    if (move === 'spouse') { unions.push(`M${a.x + BOX_W / 2} ${a.y}H${b.x - BOX_W / 2}`); continue; }
    const [top, bottom] = move === 'up' ? [b, a] : [a, b]; // parent au-dessus, enfant en dessous
    // Depuis le milieu du couple quand l'ancêtre commun est accompagné de son conjoint
    const fromCouple = coPt && (i === relation.coIndex || i === relation.coIndex + 1);
    const sx = fromCouple ? (pts[relation.coIndex].x + coPt.x) / 2 : top.x;
    const sy = fromCouple ? top.y : top.y + BOX_H / 2;
    const bus = top.y + BOX_H / 2 + V_GAP / 2;
    lines.push(`M${sx} ${sy}V${bus}H${bottom.x}V${bottom.y - BOX_H / 2}`);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - BOX_W / 2); maxX = Math.max(maxX, b.x + BOX_W / 2);
    minY = Math.min(minY, b.y - BOX_H / 2); maxY = Math.max(maxY, b.y + BOX_H / 2);
  }
  const pad = 30;
  return {
    boxes, lines, unions, ancCount: 0, descCount: 0,
    bbox: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad },
  };
}

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function truncate(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function lifeLine(p) {
  const b = p.birthYear || p.birthDate || '';
  const unknownDeath = p.deceased && !p.deathYear && /inconnue/.test(p.deathDate);
  const d = p.deathYear || (unknownDeath ? '' : p.deathDate || '');
  if (b && d) return `${truncate(b, 10)} – ${truncate(d, 10)}`;
  if (b) return unknownDeath ? `${truncate(b, 14)} – †` : `° ${truncate(b, 18)}`;
  if (d) return `† ${truncate(d, 18)}`;
  return unknownDeath ? '†' : '';
}

// Dessine le contenu de l'arbre dans un <g>.
export function renderInto(g, db, tree) {
  g.textContent = '';
  if (tree.render) return tree.render(g, db); // vue « chêne »
  const lineG = el('g', { class: 't-lines' }, g);
  for (const d of tree.unions) el('path', { d, class: 't-union' }, lineG);
  for (const d of tree.lines) el('path', { d }, lineG);
  const boxG = el('g', { class: 't-boxes' }, g);
  for (const b of tree.boxes) {
    const p = db.get(b.id);
    if (!p) continue;
    const sex = p.sex === 'M' ? 'm' : p.sex === 'F' ? 'f' : 'u';
    const box = el('g', {
      class: `t-person t-${sex} t-${b.kind}`,
      transform: `translate(${b.x - BOX_W / 2},${b.y - BOX_H / 2})`,
      'data-id': p.id,
    }, boxG);
    el('title', {}, box).textContent = `${p.name}${p.birthDate ? '\nNé(e) : ' + p.birthDate : ''}${p.deathDate ? '\nDécès : ' + p.deathDate : ''}`;
    el('rect', { width: BOX_W, height: BOX_H, rx: 12, class: 't-card' }, box);
    el('rect', { width: 6, height: BOX_H - 20, x: 0, y: 10, rx: 3, class: 't-band' }, box);
    const hasLast = p.firstName && p.lastName;
    const t1 = el('text', { x: 16, y: hasLast ? 25 : 31, class: 't-first' }, box);
    t1.textContent = truncate(hasLast ? p.firstName : p.name, 20);
    if (hasLast) {
      const t2 = el('text', { x: 16, y: 44, class: 't-last' }, box);
      t2.textContent = truncate(p.lastName.toUpperCase(), 19);
    }
    const life = lifeLine(p);
    if (life) el('text', { x: 16, y: 62, class: 't-life' }, box).textContent = life;
    if (b.more) {
      const arrow = el('text', { x: BOX_W - 14, y: b.more === 'up' ? 18 : BOX_H - 8, class: 't-more' }, box);
      arrow.textContent = b.more === 'up' ? '▲' : '▼';
    }
  }
}

// Feuille de style intégrée pour l'export (image autonome).
export const EXPORT_STYLE = `
  .t-lines path{fill:none;stroke:#8a9a94;stroke-width:2}
  .t-lines .t-union{stroke:#d29b3a;stroke-width:3;stroke-dasharray:2 5;stroke-linecap:round}
  .t-card{fill:#fff;stroke:#c9d4cf;stroke-width:1.5}
  .t-m .t-band{fill:#5b8def}.t-f .t-band{fill:#e2729a}.t-u .t-band{fill:#a0aaa6}
  .t-root .t-card{stroke:#f2a93b;stroke-width:4;fill:#fff8e8}
  .t-spouse .t-card{stroke-dasharray:5 4}
  text{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;fill:#1d2b27}
  .t-first{font-size:15px;font-weight:700}.t-last{font-size:12.5px;letter-spacing:.04em}
  .t-life{font-size:12px;fill:#5d6d68}.t-more{font-size:11px;fill:#f2a93b;text-anchor:middle}
`;

export function exportSvgString(db, tree) {
  const { x, y, w, h } = tree.bbox;
  const svg = el('svg', { xmlns: SVG_NS, viewBox: `${x} ${y} ${w} ${h}`, width: w, height: h });
  el('rect', { x, y, width: w, height: h, fill: '#f6f3ec' }, svg);
  el('style', {}, svg).textContent = EXPORT_STYLE;
  renderInto(el('g', {}, svg), db, tree);
  return new XMLSerializer().serializeToString(svg);
}

// Déplacement / zoom à la souris, au doigt (pincer) et à la molette.
export class PanZoom {
  constructor(svg, g, onTap) {
    this.svg = svg; this.g = g; this.onTap = onTap;
    this.s = 1; this.tx = 0; this.ty = 0;
    this.pointers = new Map();
    this.bbox = null;
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.up(e, true));
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      this.zoomAt(e.offsetX, e.offsetY, f);
    }, { passive: false });
  }
  apply() { this.g.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.s})`); }
  zoomAt(px, py, f) {
    const ns = Math.min(3, Math.max(0.05, this.s * f));
    f = ns / this.s;
    this.tx = px - (px - this.tx) * f;
    this.ty = py - (py - this.ty) * f;
    this.s = ns;
    this.apply();
  }
  zoomCenter(f) { const r = this.svg.getBoundingClientRect(); this.zoomAt(r.width / 2, r.height / 2, f); }
  fit(bbox = this.bbox, focusRoot = false, top = 40) {
    if (!bbox) return;
    this.bbox = bbox;
    const r = this.svg.getBoundingClientRect();
    // Marges : bandeau d'information en haut, barre d'outils en bas
    const bottom = 76;
    const W = r.width || 360, H = Math.max(120, (r.height || 500) - top - bottom);
    const s = Math.min(W / bbox.w, H / bbox.h, 1.1);
    if (focusRoot && s < 0.4) {
      // Arbre trop grand pour être lisible en entier : on centre sur la personne choisie
      this.s = Math.min(0.7, W / (BOX_W * 3.2));
      this.tx = W / 2;
      this.ty = top + H / 2;
    } else {
      this.s = s;
      this.tx = W / 2 - (bbox.x + bbox.w / 2) * s;
      this.ty = top + H / 2 - (bbox.y + bbox.h / 2) * s;
    }
    this.apply();
  }
  // Centre la personne choisie, assez zoomé pour lire ses parents de part et d'autre.
  focus(width, bbox = this.bbox) {
    this.bbox = bbox;
    const r = this.svg.getBoundingClientRect();
    const top = 40, bottom = 76;
    const W = r.width || 360, H = Math.max(120, (r.height || 500) - top - bottom);
    this.s = Math.min(1.1, W / width);
    this.tx = W / 2;
    this.ty = top + H * 0.5;
    this.apply();
  }
  local(e) { const r = this.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  down(e) {
    this.svg.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      const target = e.target.closest?.('.t-person');
      this.tap = { x: p.x, y: p.y, id: target?.dataset.id, t: Date.now() };
    } else this.tap = null;
    this.prev = this.snapshot();
  }
  snapshot() {
    const pts = [...this.pointers.values()];
    if (!pts.length) return { cx: 0, cy: 0, dist: 0 };
    if (pts.length === 1) return { cx: pts[0].x, cy: pts[0].y, dist: 0 };
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const cur = this.snapshot();
    if (this.tap && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) > 8) this.tap = null;
    this.tx += cur.cx - this.prev.cx;
    this.ty += cur.cy - this.prev.cy;
    if (cur.dist && this.prev.dist) this.zoomAt(cur.cx, cur.cy, cur.dist / this.prev.dist);
    else this.apply();
    this.prev = cur;
  }
  up(e, cancel) {
    this.pointers.delete(e.pointerId);
    if (!cancel && this.tap && this.pointers.size === 0 && this.tap.id && Date.now() - this.tap.t < 800) this.onTap(this.tap.id);
    this.tap = null;
    this.prev = this.snapshot();
  }
}
