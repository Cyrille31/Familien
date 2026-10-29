// Lien entre deux personnes : ancêtre commun le plus proche, sinon descendant
// commun, sinon chemin par alliance (mariages). Renvoie le chemin à afficher
// et une phrase qui nomme le lien.

// Distances vers les ascendants (ou descendants) : id -> { d, next } où `next`
// est la personne suivante en revenant vers le point de départ.
function distances(db, start, neighbours) {
  const out = new Map([[start, { d: 0, next: null }]]);
  let frontier = [start];
  while (frontier.length) {
    const nextFrontier = [];
    for (const id of frontier) {
      for (const n of neighbours(id)) {
        if (!n || out.has(n) || !db.get(n)) continue;
        out.set(n, { d: out.get(id).d + 1, next: id });
        nextFrontier.push(n);
      }
    }
    frontier = nextFrontier;
  }
  return out;
}

const parentsOf = (db) => (id) => [db.get(id).father, db.get(id).mother];
const childrenOf = (db) => (id) => db.childrenOf(id);

// Chemin depuis `id` en suivant `next` jusqu'au point de départ.
function chain(map, id) {
  const out = [];
  for (let cur = id; cur; cur = map.get(cur).next) out.push(cur);
  return out;
}

function best(mapA, mapB) {
  let found = null;
  for (const [id, a] of mapA) {
    const b = mapB.get(id);
    if (!b) continue;
    const sum = a.d + b.d;
    if (!found || sum < found.sum || (sum === found.sum && Math.abs(a.d - b.d) < Math.abs(found.dA - found.dB))) {
      found = { id, sum, dA: a.d, dB: b.d };
    }
  }
  return found;
}

function kinship(dA, dB, fem, half) {
  const g = (m, f) => (fem ? f : m);
  if (dA === 0) {
    if (dB === 1) return g('le fils', 'la fille');
    if (dB === 2) return g('le petit-fils', 'la petite-fille');
    if (dB === 3) return g("l'arrière-petit-fils", "l'arrière-petite-fille");
    return g(`un descendant (${dB} générations)`, `une descendante (${dB} générations)`);
  }
  if (dB === 0) {
    if (dA === 1) return g('le père', 'la mère');
    if (dA === 2) return g('le grand-père', 'la grand-mère');
    if (dA === 3) return g("l'arrière-grand-père", "l'arrière-grand-mère");
    if (dA === 4) return g("l'arrière-arrière-grand-père", "l'arrière-arrière-grand-mère");
    return g(`un ancêtre (${dA} générations)`, `une ancêtre (${dA} générations)`);
  }
  if (dA === 1 && dB === 1) return half ? g('le demi-frère', 'la demi-sœur') : g('le frère', 'la sœur');
  if (dA === 1) {
    if (dB === 2) return g('le neveu', 'la nièce');
    if (dB === 3) return g('le petit-neveu', 'la petite-nièce');
    if (dB === 4) return g("l'arrière-petit-neveu", "l'arrière-petite-nièce");
    return g("un descendant d'un frère ou d'une sœur", "une descendante d'un frère ou d'une sœur");
  }
  if (dB === 1) {
    if (dA === 2) return g("l'oncle", 'la tante');
    if (dA === 3) return g('le grand-oncle', 'la grand-tante');
    if (dA === 4) return g("l'arrière-grand-oncle", "l'arrière-grand-tante");
    return g(`le frère d'un ancêtre (${dA - 1} générations)`, `la sœur d'un ancêtre (${dA - 1} générations)`);
  }
  if (dA === dB) {
    if (dA === 2) return g('le cousin germain', 'la cousine germaine');
    if (dA === 3) return g('le cousin issu de germain', 'la cousine issue de germain');
    if (dA === 4) return g("le cousin issu d'issus de germains", "la cousine issue d'issus de germains");
    return g(`un cousin éloigné (${dA - 1}e degré)`, `une cousine éloignée (${dA - 1}e degré)`);
  }
  if (dA === 2 && dB === 3) return g("le petit-cousin (fils d'un cousin germain)", "la petite-cousine (fille d'un cousin germain)");
  if (dA === 3 && dB === 2) return g("le cousin germain d'un parent", "la cousine germaine d'un parent");
  return g('un cousin éloigné', 'une cousine éloignée');
}

// steps : [{ id, move }] avec move = 'start' | 'up' | 'down' | 'spouse'
export function findRelation(db, a, b) {
  if (!db.get(a) || !db.get(b) || a === b) return null;
  const A = db.get(a), B = db.get(b);

  // 1. Ancêtre commun le plus proche (lien du sang)
  const upA = distances(db, a, parentsOf(db));
  const upB = distances(db, b, parentsOf(db));
  const ca = best(upA, upB);
  if (ca) {
    const pathA = chain(upA, ca.id).reverse(); // a … ancêtre
    const pathB = chain(upB, ca.id);           // ancêtre … b
    const steps = pathA.map((id, i) => ({ id, move: i === 0 ? 'start' : 'up' }));
    pathB.slice(1).forEach((id) => steps.push({ id, move: 'down' }));
    // L'autre parent commun (couple d'ancêtres), s'il existe
    const childA = pathA[pathA.length - 2], childB = pathB[1];
    const other = (cid) => cid && (db.get(cid).father === ca.id ? db.get(cid).mother : db.get(cid).father);
    const co = childA && childB && other(childA) && other(childA) === other(childB) ? other(childA) : null;
    const half = ca.dA === 1 && ca.dB === 1 && !co;
    const term = kinship(ca.dA, ca.dB, B.sex === 'F', half);
    const common = co ? `${db.get(ca.id).name} et ${db.get(co).name}` : db.get(ca.id).name;
    let detail;
    if (ca.dA === 0 || ca.dB === 0) detail = `Lignée directe : ${ca.sum} génération${ca.sum > 1 ? 's' : ''}.`;
    else detail = `Ancêtre${co ? 's' : ''} commun${co ? 's' : ''} : ${common}. Degré de parenté : ${ca.sum}.`;
    return { kind: 'blood', steps, co, coIndex: pathA.length - 1, text: `${B.name} est ${term} de ${A.name}.`, detail };
  }

  // 2. Conjoints
  if (db.spousesOf(a).includes(b)) {
    const word = B.sex === 'F' ? "l'épouse" : B.sex === 'M' ? "l'époux" : 'le conjoint';
    return { kind: 'spouse', steps: [{ id: a, move: 'start' }, { id: b, move: 'spouse' }], text: `${B.name} est ${word} de ${A.name}.`, detail: '' };
  }

  // 3. Descendant commun (par exemple deux grands-parents d'un même enfant)
  const downA = distances(db, a, childrenOf(db));
  const downB = distances(db, b, childrenOf(db));
  const cd = best(downA, downB);
  if (cd) {
    const pathA = chain(downA, cd.id).reverse();
    const pathB = chain(downB, cd.id);
    const steps = pathA.map((id, i) => ({ id, move: i === 0 ? 'start' : 'down' }));
    pathB.slice(1).forEach((id) => steps.push({ id, move: 'up' }));
    const C = db.get(cd.id);
    const fem = C.sex === 'F';
    const text = cd.dA === 1 && cd.dB === 1
      ? `${A.name} et ${B.name} sont les parents de ${C.name}.`
      : `${C.name} est ${kinship(0, cd.dA, fem)} de ${A.name} et ${kinship(0, cd.dB, fem)} de ${B.name}.`;
    return { kind: 'descendant', steps, text, detail: 'Pas d’ancêtre commun connu : lien par un descendant commun.' };
  }

  // 4. Chemin par alliance (parents, enfants, conjoints)
  const all = (id) => {
    const p = db.get(id);
    return [p.father, p.mother, ...db.childrenOf(id), ...db.spousesOf(id)];
  };
  const fromA = distances(db, a, all);
  if (!fromA.has(b)) return { kind: 'none', steps: [], text: `Aucun lien trouvé entre ${A.name} et ${B.name} dans le fichier.`, detail: '' };
  const ids = chain(fromA, b).reverse();
  const steps = ids.map((id, i) => {
    if (i === 0) return { id, move: 'start' };
    const prev = db.get(ids[i - 1]);
    if (prev.father === id || prev.mother === id) return { id, move: 'up' };
    if (db.get(id).father === prev.id || db.get(id).mother === prev.id) return { id, move: 'down' };
    return { id, move: 'spouse' };
  });
  const words = { up: ['son père', 'sa mère'], down: ['son fils', 'sa fille'], spouse: ['son époux', 'son épouse'] };
  const parts = steps.map((s, i) => {
    const p = db.get(s.id);
    return i === 0 ? p.name : `${words[s.move][p.sex === 'F' ? 1 : 0]} ${p.name}`;
  });
  return { kind: 'alliance', steps, text: `Parenté par alliance : ${parts.join(' → ')}.`, detail: '' };
}
