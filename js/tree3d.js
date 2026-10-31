// Vue « 3D » : l'arbre chronologique en volume. La hauteur dépend de l'année de
// naissance (les cousins nés la même année sont à la même hauteur, sur le même
// cercle d'années) ; les familles se répartissent tout autour du tronc. Les
// ancêtres forment les racines, sous le sol. Un écriteau est suspendu à chaque
// embranchement ; on tourne autour de l'arbre et on zoome avec le doigt ou la souris.

import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { buildAncestors, buildDescendants } from './tree.js';
import { spousesMainFirst, marriageDate } from './oak.js';

const GEN = 28;        // écart moyen entre générations (année inconnue)
const NEED_FORK = 15;  // place autour du cercle pour un écriteau de couple
const NEED_LEAF = 10;  // pour un nom seul (les écriteaux se décalent aussi en hauteur)
const R0 = 5;          // rayon des premières fourches
const INK = '#2b1d0e';
const FONT = "'IM Fell English', Georgia, serif";

function weigh(n) {
  const own = n.need / NEED_LEAF;
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

// Calcule la disposition (années, angles, rayons, épaisseurs).
function layout(db, rootId, ancDepth, descDepth) {
  const desc = buildDescendants(db, rootId, descDepth);
  const spouseId = spousesMainFirst(db, rootId)[0] || null;
  const ancA = buildAncestors(db, rootId, ancDepth);
  ancA.kids.forEach((k) => { k.base = 'root'; });
  const anc = { id: rootId, kids: [...ancA.kids] };
  if (spouseId) {
    const ancB = buildAncestors(db, spouseId, ancDepth);
    ancB.kids.forEach((k) => { k.base = 'spouse'; });
    anc.kids.push(...ancB.kids);
  }

  const yearOf = (id) => Number(db.get(id)?.birthYear) || null;
  let y0 = yearOf(rootId);
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

  // Angles tout autour du tronc, rayon minimal pour que les écriteaux tiennent
  (function need(n) { for (const k of n.kids) { k.need = k.kids.length ? NEED_FORK : NEED_LEAF; need(k); } })(desc);
  (function need(n) { for (const k of n.kids) { k.need = NEED_LEAF; need(k); } })(anc);
  desc.need = NEED_LEAF; anc.need = NEED_LEAF;
  weigh(desc); weigh(anc);
  assignAngles(desc, 0, Math.PI * 2);
  assignAngles(anc, Math.PI / 4, Math.PI * 2 + Math.PI / 4);
  // La couronne s'évase avec les années (un cône) : l'écartement par année est
  // choisi pour que chaque écriteau ait sa place sur son cercle.
  let KR = 0.4, KRa = 0.4, span = 20, spanA = 20;
  (function scan(n) { for (const k of n.kids) { const dy = Math.max(k.year - y0, 8); span = Math.max(span, k.year - y0); KR = Math.max(KR, (k.need / Math.max(k.slot, 1e-3) - R0) / dy); scan(k); } })(desc);
  (function scan(n) { for (const k of n.kids) { const dy = Math.max(y0 - k.year, 8); spanA = Math.max(spanA, y0 - k.year); KRa = Math.max(KRa, (k.need / Math.max(k.slot, 1e-3) - R0) / dy); scan(k); } })(anc);
  const crown = R0 + KR * span;
  // La hauteur suit la largeur, pour garder une silhouette d'arbre
  const KV = Math.max(0.6, (0.95 * crown) / span);
  const BASE = Math.max(12, crown * 0.3);
  const rD = (y) => R0 + (y - y0) * KR;
  // Les racines s'étalent au moins autant que la moitié de la couronne
  KRa = Math.max(KRa, (0.6 * (R0 + KR * span)) / spanA);
  const rA = (y) => R0 + (y0 - y) * KRa;
  const hD = (y) => BASE + (y - y0) * KV;
  const hA = (y) => -6 - (y0 - y) * Math.min(KV * 0.6, KRa * 0.9);

  let descCount = 0, ancCount = 0, maxR = 30, top = BASE, bottom = 0;
  const place = (k, r, h) => {
    k.pos = new THREE.Vector3(r * Math.cos(k.angle), h, r * Math.sin(k.angle));
    maxR = Math.max(maxR, r); top = Math.max(top, h); bottom = Math.min(bottom, h);
  };
  (function scan(n) { for (const k of n.kids) { descCount++; place(k, rD(k.year), hD(k.year)); scan(k); } })(desc);
  (function scan(n) { for (const k of n.kids) { ancCount++; place(k, rA(k.year), hA(k.year)); scan(k); } })(anc);
  desc.pos = new THREE.Vector3(0, BASE, 0);
  anc.pos = new THREE.Vector3(0, 0, 0);

  // Épaisseurs : chaque branche fille reçoit une part de la section de sa mère
  const thick = Math.min(3, Math.max(0.6, crown / 90));
  const natural = (n) => (n.kids.length ? (0.35 + 0.42 * Math.sqrt(n.weight)) * thick : 0.22 * thick);
  const share = (n, end) => {
    n.r1 = end;
    const sum = Math.sqrt(n.kids.reduce((s, k) => s + natural(k) ** 2, 0)) || 1;
    for (const k of n.kids) {
      k.r0 = (end * natural(k)) / sum;
      share(k, k.kids.length ? Math.min(natural(k), k.r0 * 0.85) : 0.12 * thick);
    }
  };
  const trunkR = Math.max(1.6, Math.min(crown * 0.045, natural(desc) * 0.9));
  share(desc, trunkR * 0.85);
  share(anc, trunkR * 1.05);
  return { desc, anc, spouseId, y0, rD, rA, hD, hA, trunkR, descCount, ancCount, maxR, top, bottom, BASE, thick };
}

// ---------- Géométrie : tubes effilés, tous réunis dans un seul maillage ----------

class WoodBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  // radius : nombre (r0) ou fonction t → rayon ; v0 : départ de la texture
  // Repères transportés le long de la courbe, en partant de la normale N0 :
  // une branche fille reprend la normale de sa mère, les facettes se raccordent.
  static frames(curve, segs, N0) {
    const tangents = [], normals = [], binormals = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i <= segs; i++) tangents.push(curve.getTangentAt(i / segs).normalize());
    let N = N0 ? N0.clone() : new THREE.Vector3(1, 0, 0);
    const T0 = tangents[0];
    N.addScaledVector(T0, -N.dot(T0));
    if (N.lengthSq() < 1e-6) N.set(0, 0, 1).addScaledVector(T0, -T0.z);
    N.normalize();
    for (let i = 0; i <= segs; i++) {
      if (i) { q.setFromUnitVectors(tangents[i - 1], tangents[i]); N = N.clone().applyQuaternion(q).normalize(); }
      normals.push(N);
      binormals.push(tangents[i].clone().cross(N).normalize());
    }
    return { tangents, normals, binormals };
  }
  tube(curve, r0, r1, segs = 20, radial = 8, v0 = 0, startCap = false, N0 = null) {
    const frames = WoodBuilder.frames(curve, segs, N0);
    this.endNormal = frames.normals[segs];
    const len = curve.getLength();
    const base = this.pos.length / 3;
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      curve.getPointAt(t, P);
      const r = typeof r0 === 'function' ? r0(t) : r0 + (r1 - r0) * t * t * (3 - 2 * t);
      const nT = frames.normals[i], bT = frames.binormals[i];
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        N.copy(nT).multiplyScalar(Math.cos(a)).addScaledVector(bT, Math.sin(a));
        this.pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
        this.nor.push(N.x, N.y, N.z);
        this.uv.push((j / radial) * 2, v0 + (t * len) / 6);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j, b = a + radial + 1;
        this.idx.push(a, a + 1, b, b, a + 1, b + 1); // faces tournées vers l'extérieur
      }
    }
    // Bout arrondi (et départ fermé pour le tronc) : pas de tube ouvert
    const radiusAt = (t) => (typeof r0 === 'function' ? r0(t) : r0 + (r1 - r0) * t * t * (3 - 2 * t));
    const cap = (i, sign) => {
      const t = i / segs, r = radiusAt(t);
      const T = frames.tangents[i].clone().multiplyScalar(sign);
      curve.getPointAt(t, P);
      const start = this.pos.length / 3;
      for (let j = 0; j <= radial; j++) {
        const k = (base + i * (radial + 1) + j) * 3;
        this.pos.push(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
        N.set(this.nor[k], this.nor[k + 1], this.nor[k + 2]).add(T).normalize();
        this.nor.push(N.x, N.y, N.z);
        this.uv.push((j / radial) * 2, v0 + (t * len) / 6);
      }
      const c = this.pos.length / 3;
      this.pos.push(P.x + T.x * r * 0.7, P.y + T.y * r * 0.7, P.z + T.z * r * 0.7);
      this.nor.push(T.x, T.y, T.z);
      this.uv.push(1, v0 + (t * len) / 6 + r / 6);
      for (let j = 0; j < radial; j++) {
        if (sign > 0) this.idx.push(start + j, start + j + 1, c);
        else this.idx.push(start + j + 1, start + j, c);
      }
    };
    cap(segs, 1);
    if (startCap) cap(0, -1);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
  static length(curve) { return curve.getLength() / 6; }
}

// Branche continue : elle naît à l'intérieur de sa branche mère, décalée vers
// son côté (les branches filles se partagent la section de la mère, comme dans
// la vue chronologique), part dans le prolongement de la mère (tangente T),
// puis s'incline vers son nœud ; elle y arrive avec la tangente E, que ses
// propres branches filles prolongeront.
function branchCurve(S, T, B, E, minAlong = 0.12) {
  const L = S.distanceTo(B);
  // Départ d'autant plus court que la branche doit tourner (pas de boucle)
  const along = Math.max(minAlong, B.clone().sub(S).normalize().dot(T));
  return new THREE.CubicBezierCurve3(S.clone(), S.clone().addScaledVector(T, L * 0.38 * along),
    B.clone().addScaledVector(E, -L * 0.3), B.clone());
}

// ---------- Textures dessinées ----------

function barkTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#b89464'; x.fillRect(0, 0, 128, 256);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const px = r() * 128;
    x.strokeStyle = r() < 0.5 ? 'rgba(70,45,20,.55)' : 'rgba(240,220,180,.35)';
    x.lineWidth = 1 + r() * 2.2;
    x.beginPath();
    for (let y = 0; y <= 256; y += 16) x.lineTo(px + Math.sin(y / 40 + i) * 3, y);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Un seul canevas sert à mesurer le texte (Safari limite la mémoire des canevas)
const measure = document.createElement('canvas').getContext('2d');

// Rectangle arrondi (roundRect n'existe pas avant iOS 16)
function rounded(x, X, Y, W, H, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

// Écriteau en bois avec quelques lignes de texte.
function plank(lines, opts = {}) {
  const S = opts.small ? 1.1 : 1.4; // résolution (mémoire limitée sur téléphone)
  const pad = 22, lh = opts.small ? 34 : 40;
  const ctx0 = measure;
  const fontOf = (l) => `${l.italic ? 'italic ' : ''}${l.size || (opts.small ? 30 : 34)}px ${FONT}`;
  let w = 0;
  for (const l of lines) { ctx0.font = fontOf(l); w = Math.max(w, ctx0.measureText(l.text).width); }
  const maxW = opts.small ? 360 : 440;
  w = Math.min(Math.max(w, 120), maxW) + pad * 2;
  const h = lines.length * lh + pad * 1.3;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * S / 2) * 2; c.height = Math.ceil(h * S / 2) * 2;
  const x = c.getContext('2d');
  x.scale(S, S);
  // Planche
  const r = 12;
  rounded(x, 3, 3, w - 6, h - 6, r);
  const grd = x.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, opts.root ? '#e9d3a0' : '#dcc08a'); grd.addColorStop(1, opts.root ? '#d5b57a' : '#c7a46b');
  x.fillStyle = grd; x.fill();
  x.lineWidth = 4; x.strokeStyle = '#5a3d1e'; x.stroke();
  x.save(); x.clip();
  x.strokeStyle = 'rgba(90,61,30,.18)'; x.lineWidth = 1.5;
  for (let i = 1; i < 6; i++) {
    const yy = (h * i) / 6;
    x.beginPath(); x.moveTo(0, yy); x.bezierCurveTo(w * 0.3, yy - 4, w * 0.6, yy + 4, w, yy - 2); x.stroke();
  }
  x.restore();
  if (!opts.small) for (const px of [16, w - 16]) { x.beginPath(); x.arc(px, 14, 4, 0, 7); x.fillStyle = '#4a3218'; x.fill(); }
  // Texte
  x.fillStyle = INK; x.textAlign = 'center'; x.textBaseline = 'middle';
  const bands = [];
  lines.forEach((l, i) => {
    x.font = fontOf(l);
    const yy = pad * 0.65 + lh * (i + 0.5);
    const tw = x.measureText(l.text).width;
    const sc = Math.min(1, (w - pad * 2) / tw);
    x.save(); x.translate(w / 2, yy); x.scale(sc, 1); x.fillText(l.text, 0, 0); x.restore();
    bands.push({ y0: (yy - lh / 2) / h, y1: (yy + lh / 2) / h, id: l.id });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Une fois envoyée à la carte graphique, l'image n'est plus utile en mémoire
  tex.onUpdate = () => { c.width = c.height = 1; };
  return { tex, w, h, bands };
}

function yearLabel(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const x = c.getContext('2d');
  x.font = `30px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(246,238,219,.9)'; x.strokeText(text, 64, 26);
  x.fillStyle = '#6b5434'; x.fillText(text, 64, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const life = (p, est) => {
  const b = p.birthYear ? `${est ? '~' : ''}${p.birthYear}` : '';
  return p.deathYear ? `${b} – ${p.deathYear}` : b ? `° ${b}` : '';
};

// ---------- Scène ----------

export async function mount3D(container, db, opts) {
  const { rootId, ancDepth, descDepth, step, onPick } = opts;
  try { await document.fonts.load(`30px ${FONT}`); } catch { /* police par défaut */ }
  const L = layout(db, rootId, ancDepth, descDepth);
  const { desc, anc, BASE } = L;
  const n = L.descCount + L.ancCount;
  const U = (L.maxR / 70) * Math.max(1, Math.min(2.2, 2.4 - n / 80));
 // taille des écriteaux, proportionnelle à l'arbre

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f3ead6');
  scene.fog = new THREE.Fog('#f3ead6', L.maxR * 4, L.maxR * 9);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, L.maxR * 20);
  scene.add(new THREE.HemisphereLight('#fff8ea', '#7a6a4a', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(60, 120, 80);
  scene.add(sun);

  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };

  // ----- Bois : tronc, branches, racines -----
  const wood = new WoodBuilder();
  const UP = new THREE.Vector3(0, 1, 0);
  const trunk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -2, 0), new THREE.Vector3(0.6, BASE * 0.35, 0.3),
    new THREE.Vector3(-0.4, BASE * 0.7, -0.2), new THREE.Vector3(0, BASE, 0),
  ]);
  const RAD = 14; // facettes autour de chaque branche (identique partout, pour les raccords)
  wood.tube(trunk, L.trunkR * 1.12, desc.r1, 24, RAD, 0, true, new THREE.Vector3(1, 0, 0));
  desc.N = wood.endNormal;
  desc.T = trunk.getTangentAt(1).normalize();
  desc.v = WoodBuilder.length(trunk);
  anc.T = new THREE.Vector3(0, -1, 0);
  anc.pos = new THREE.Vector3(0, -1.5, 0);
  anc.r1 = L.trunkR * 1.12;
  anc.v = 0;
  anc.N = new THREE.Vector3(1, 0, 0);
  const ss = (t) => t * t * (3 - 2 * t);
  // Chaque branche fille naît exactement dans le prolongement de sa mère, avec la
  // même section : le bois est continu. Elle s'affine en s'écartant de ses sœurs.
  const grow = (n, dirY) => {
    for (const k of n.kids) {
      // Plus les enfants s'étalent autour du nœud, plus la branche y arrive verticale
      const f = Math.min(1, (k.kids.length ? k.slot : 0) / 2);
      const E = k.pos.clone().sub(n.pos).normalize().multiplyScalar(1 - 0.8 * f).addScaledVector(UP, dirY * (0.7 + 1.5 * f)).normalize();
      k.T = E;
      const S = n.pos.clone().addScaledVector(n.T, -n.r1 * 0.3);
      // Les racines plongent d'abord avant de s'étaler (pas de coude à angle droit)
      const curve = branchCurve(S, n.T, k.pos, E, dirY < 0 ? 0.4 : 0.12);
      const R = n.r1, a = k.r0, b = k.r1;
      const rad = (t) => (t < 0.18 ? R + (a - R) * ss(t / 0.18) : a + (b - a) * ss((t - 0.18) / 0.82));
      wood.tube(curve, rad, 0, 26, k.kids.length || n.r1 > 0.6 ? RAD : 7, n.v, false, n.N);
      k.N = wood.endNormal;
      k.v = n.v + WoodBuilder.length(curve);
      grow(k, dirY);
    }
  };
  grow(desc, 1);
  grow(anc, -1);
  const bark = keep(barkTexture());
  const woodMat = keep(new THREE.MeshStandardMaterial({ map: bark, roughness: 0.9, metalness: 0 }));
  const woodGeo = keep(wood.geometry());
  scene.add(new THREE.Mesh(woodGeo, woodMat));
  const M = new THREE.Matrix4();

  // ----- Feuillage au bout des branches -----
  const leafEnds = [];
  (function f(n) { for (const k of n.kids) { if (!k.kids.length) leafEnds.push(k); f(k); } })(desc);
  const leafGeo = keep(new THREE.SphereGeometry(1, 8, 6));
  leafGeo.scale(0.55, 0.12, 1);
  const leafMat = keep(new THREE.MeshStandardMaterial({ color: '#7d9a4a', roughness: 0.8 }));
  const PER = 7;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafEnds.length * PER);
  const col = new THREE.Color();
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
  leafEnds.forEach((k, i) => {
    for (let j = 0; j < PER; j++) {
      e.set(rnd() * 1.2 - 0.6, rnd() * Math.PI * 2, rnd() * 1.2 - 0.6);
      q.setFromEuler(e);
      const z = (1.1 + rnd() * 0.7) * L.thick;
      sc.set(z, z, z);
      tp.set(k.pos.x + (rnd() - 0.5) * 2.2 * L.thick, k.pos.y + (rnd() * 1.4 - 0.3) * L.thick, k.pos.z + (rnd() - 0.5) * 2.2 * L.thick);
      leaves.setMatrixAt(i * PER + j, M.compose(tp, q, sc));
      leaves.setColorAt(i * PER + j, col.setHSL(0.22 + rnd() * 0.06, 0.38, 0.36 + rnd() * 0.12));
    }
  });
  scene.add(leaves);

  // ----- Sol, à demi transparent pour laisser voir les racines -----
  const groundR = L.maxR * 0.85;
  const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(groundR, 72)),
    keep(new THREE.MeshStandardMaterial({ color: '#a8b27a', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const edge = new THREE.Mesh(keep(new THREE.RingGeometry(groundR - 0.6, groundR, 96)),
    keep(new THREE.MeshBasicMaterial({ color: '#6e7a48', side: THREE.DoubleSide, transparent: true, opacity: 0.6 })));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  scene.add(edge);

  // ----- Cercles d'années, sur l'enveloppe de l'arbre -----
  const ringMat = keep(new THREE.LineBasicMaterial({ color: '#7a6040', transparent: true, opacity: 0.32 }));
  const ringMatStrong = keep(new THREE.LineBasicMaterial({ color: '#5a4020', transparent: true, opacity: 0.55 }));
  const ring = (y, r, strong) => {
    const pts = [];
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))); }
    scene.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(pts)), strong ? ringMatStrong : ringMat));
  };
  const years = [];
  (function f(n) { for (const k of n.kids) { years.push(k.year); f(k); } })(desc);
  const maxYear = years.length ? Math.max(...years) : L.y0 + 10;
  const label = (txt, p) => {
    const sp = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(yearLabel(txt)), transparent: true, depthWrite: false })));
    sp.scale.set(5.6 * U * 0.8, 2.1 * U * 0.8, 1);
    sp.position.copy(p);
    scene.add(sp);
  };
  for (let y = Math.ceil((L.y0 + 1) / step) * step; y <= maxYear + 2; y += step) {
    const strong = y % 50 === 0;
    ring(L.hD(y), L.rD(y), strong);
    if (strong || step >= 10 || y % 10 === 0) {
      label(String(y), new THREE.Vector3(L.rD(y) + 3 * U, L.hD(y), 0));
      label(String(y), new THREE.Vector3(-L.rD(y) - 3 * U, L.hD(y), 0));
    }
  }
  const ancYears = [];
  (function f(n) { for (const k of n.kids) { ancYears.push(k.year); f(k); } })(anc);
  if (ancYears.length) {
    const minY = Math.min(...ancYears);
    for (let y = Math.floor((L.y0 - 1) / step) * step; y >= minY - 2; y -= step) {
      ring(L.hA(y), L.rA(y), y % 50 === 0);
      if (step >= 10 || y % 10 === 0) label(String(y), new THREE.Vector3(L.rA(y) + 3 * U, L.hA(y), 0));
    }
  }

  // ----- Écriteaux -----
  const signs = [];
  const ropeMat = keep(new THREE.LineBasicMaterial({ color: '#4a3218' }));
  const addSign = (lines, at, size, o = {}) => {
    const p = plank(lines, o);
    keep(p.tex);
    // Envoi immédiat à la carte graphique : le canevas est libéré aussitôt
    // (sinon les ~200 écriteaux dépassent la mémoire permise par Safari)
    renderer.initTexture(p.tex);
    const mat = keep(new THREE.SpriteMaterial({ map: p.tex, alphaTest: 0.2 }));
    const sp = new THREE.Sprite(mat);
    const W = size, H = (size * p.h) / p.w;
    sp.scale.set(W, H, 1);
    sp.userData = { bands: p.bands, id: lines[0].id, H };
    sp.position.copy(at);
    scene.add(sp);
    signs.push(sp);
    return sp;
  };
  const coupleLines = (k) => {
    const p = db.get(k.id);
    const lines = [{ text: p.name, id: k.id, size: 38 }];
    const l = life(p, k.est);
    if (l) lines.push({ text: l, id: k.id, italic: true, size: 28 });
    const sps = spousesMainFirst(db, k.id);
    if (sps.length) {
      const d = marriageDate(db, k.id, sps[0]);
      lines.push({ text: d ? `∞ ${d}` : '∞', id: sps[0], size: 26 });
      const sp = db.get(sps[0]);
      lines.push({ text: sp.name + (sps.length > 1 ? ` (+${sps.length - 1})` : ''), id: sps[0], italic: true, size: 32 });
    }
    return lines;
  };
  // Écriteau du couple, cloué sur le tronc (tourné vers la caméra)
  const rootSign = addSign(coupleLines({ id: rootId, est: false }), new THREE.Vector3(0, BASE * 0.5, 0), 14 * U, { root: true });
  rootSign.material.depthTest = false;
  rootSign.renderOrder = 10;
  // Embranchements : écriteau suspendu sous la fourche, un peu vers l'extérieur
  const hang = (k, size, dirY) => {
    const out = new THREE.Vector3(Math.cos(k.angle), 0, Math.sin(k.angle));
    const lines = dirY > 0 ? coupleLines(k)
      : [{ text: db.get(k.id).name, id: k.id, size: 36 }, { text: life(db.get(k.id), k.est), id: k.id, italic: true, size: 28 }].filter((l) => l.text);
    const leaf = !k.kids.length;
    const at = k.pos.clone();
    let sp;
    if (leaf && dirY > 0) {
      sp = addSign(lines, at, size, { small: true });
      at.y += sp.userData.H / 2 + 1.6 * L.thick;
      sp.position.copy(at);
      return;
    }
    sp = addSign(lines, at, size, { small: leaf });
    at.addScaledVector(out, 1.2 + k.r1);
    at.y -= sp.userData.H / 2 + k.r1 + 1.4;
    sp.position.copy(at);
    const top = at.clone(); top.y += sp.userData.H / 2;
    scene.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints([k.pos.clone().addScaledVector(out, k.r1 * 0.6), top])), ropeMat));
  };
  (function f(n) { for (const k of n.kids) { hang(k, (k.kids.length ? 9 : 6.5) * U, 1); f(k); } })(desc);
  (function f(n) { for (const k of n.kids) { hang(k, 6.5 * U, -1); f(k); } })(anc);
  // Couples d'ancêtres : arc entre les deux parents, avec la date du mariage (comme le chronologique)
  const bondMat = keep(new THREE.LineBasicMaterial({ color: '#8a5a20', transparent: true, opacity: 0.85 }));
  const bond = (a, b) => {
    const A = a.pos, B = b.pos;
    const M = A.clone().add(B).multiplyScalar(0.5);
    const out = new THREE.Vector3(M.x, 0, M.z);
    if (out.lengthSq() < 1e-6) out.set(Math.cos(a.angle), 0, Math.sin(a.angle)); else out.normalize();
    const C = M.clone().addScaledVector(out, A.distanceTo(B) * 0.22 + 1);
    C.y -= A.distanceTo(B) * 0.08;
    const curve = new THREE.QuadraticBezierCurve3(A, C, B);
    scene.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32))), bondMat));
    const d = marriageDate(db, a.id, b.id);
    const at = curve.getPoint(0.5).addScaledVector(out, 0.6);
    addSign([{ text: d ? `∞ ${d}` : '∞', id: a.id, size: 30 }], at, 3.2 * U, { small: true });
  };
  (function couples(n, top) {
    const groups = top ? [n.kids.filter((k) => k.base === 'root'), n.kids.filter((k) => k.base === 'spouse')] : [n.kids];
    for (const grp of groups) if (grp.length === 2) bond(grp[0], grp[1]);
    for (const k of n.kids) couples(k, false);
  })(anc, true);

  // ----- Caméra et commandes -----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.minDistance = 6;
  controls.maxDistance = L.maxR * 8;
  controls.addEventListener('start', () => { controls.autoRotate = false; focus = null; });

  const center = new THREE.Vector3(0, (L.top + Math.max(L.bottom, -L.maxR * 0.4)) / 2, 0);
  const fit = () => {
    const h = L.top - Math.max(L.bottom, -L.maxR * 0.5) + 20;
    const w = (L.maxR + 15) * 2;
    const aspect = camera.aspect || 1;
    const vfov = (camera.fov * Math.PI) / 180;
    const dist = Math.max(h / 2 / Math.tan(vfov / 2), w / 2 / (Math.tan(vfov / 2) * aspect)) * 0.85;
    controls.target.copy(center);
    camera.position.set(0, center.y + dist * 0.35, dist);
    camera.updateProjectionMatrix();
    controls.update();
  };

  const resize = () => {
    const r = container.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  fit();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  if (globalThis.__FAMILIEN_DEBUG) globalThis.__FAMILIEN_DEBUG.three = { camera, controls, L, scene };

  // ----- Toucher un écriteau : ouvre la fiche (le conjoint, s'il est touché) -----
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null, focus = null;
  const el = renderer.domElement;
  const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; };
  const onUp = (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 8 || !quick) return;
    const r = el.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(signs, false);
    // L'écriteau du tronc est toujours devant
    const hit = hits.find((h) => h.object === rootSign) || hits[0];
    if (!hit) return;
    const v = 1 - hit.uv.y;
    const band = hit.object.userData.bands.find((b) => v >= b.y0 && v <= b.y1);
    // On se rapproche doucement de l'écriteau touché, puis la fiche s'ouvre
    focus = hit.object === rootSign ? null : hit.object.position.clone();
    controls.autoRotate = false;
    onPick((band || hit.object.userData).id);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  // ----- Animation -----
  const toCam = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    if (document.hidden) return;
    if (focus) {
      const d = focus.clone().sub(controls.target);
      if (d.lengthSq() < 0.01) focus = null;
      else { d.multiplyScalar(0.12); controls.target.add(d); camera.position.add(d); }
    }
    controls.update();
    // L'écriteau du tronc reste sur la face du tronc tournée vers nous
    toCam.set(camera.position.x, 0, camera.position.z);
    if (toCam.lengthSq() > 1e-6) toCam.normalize();
    rootSign.position.set(toCam.x * (L.trunkR + 0.8), BASE * 0.5, toCam.z * (L.trunkR + 0.8));
    renderer.render(scene, camera);
  });

  return {
    ancCount: L.ancCount,
    descCount: L.descCount,
    fit() { focus = null; fit(); },
    zoom(f) {
      controls.autoRotate = false;
      const d = camera.position.clone().sub(controls.target);
      const len = THREE.MathUtils.clamp(d.length() / f, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(d.setLength(len));
      controls.update();
    },
    snapshot() {
      renderer.render(scene, camera);
      return new Promise((res) => el.toBlob(res, 'image/png'));
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      controls.dispose();
      for (const sp of signs) { sp.material.map.dispose(); sp.material.dispose(); }
      for (const d of disposables) d.dispose?.();
      leaves.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      el.remove();
    },
  };
}
