// Modèle généalogique : détection des colonnes, construction des personnes et des liens.

export const FIELDS = [
  { key: 'id', label: 'Identifiant' },
  { key: 'firstName', label: 'Prénom(s)' },
  { key: 'lastName', label: 'Nom' },
  { key: 'fullName', label: 'Nom complet' },
  { key: 'sex', label: 'Sexe' },
  { key: 'birthDate', label: 'Date de naissance' },
  { key: 'birthPlace', label: 'Lieu de naissance' },
  { key: 'deathDate', label: 'Date de décès' },
  { key: 'deathPlace', label: 'Lieu de décès' },
  { key: 'father', label: 'Père' },
  { key: 'mother', label: 'Mère' },
  { key: 'parents', label: 'Parents (les deux)' },
  { key: 'spouse', label: 'Conjoint(s)' },
  { key: 'children', label: 'Enfants' },
  { key: 'marriageDate', label: 'Date de mariage' },
  { key: 'marriagePlace', label: 'Lieu de mariage' },
  { key: 'occupation', label: 'Profession' },
  { key: 'notes', label: 'Notes' },
];

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (s) => normalize(s).replace(/ /g, '');

function detectField(header) {
  const h = compact(header);
  if (!h) return null;
  const has = (re) => re.test(h);
  if (has(/^(id|ident|identifiant|num|numero|no|n|ref|reference|code|cle|key|uid|sosa)$/) ||
      has(/^(id|num|numero|ref)(personne|individu|person|individual)$/)) return 'id';
  if (has(/^(sexe|sex|genre|gender|s|hf|fh|mf|hommefemme|masculinfeminin)$/)) return 'sex';
  if (has(/^(id|nom|ref|num|numero|no|n)?(du|de|of)?(pere|father|papa)(id|nom|ref|num|numero|no)?$/)) return 'father';
  if (has(/^(id|nom|ref|num|numero|no|n)?(de|la|dela|of)?(mere|mother|maman)(id|nom|ref|num|numero|no)?$/)) return 'mother';
  if (has(/^(les)?(id|ids|nom|noms)?(des)?parents?(id|ids|nom|noms)?$/)) return 'parents';
  if (has(/conjoint|epoux|epouse|spouse|^mari$|^mari(e|id|nom)|^(nom|id)?(du|de)?mari$|husband|wife|partenaire|partner|compagn|^femme$/)) return 'spouse';
  if (has(/^(id|ids|nom|noms)?(des)?(enfants?|children|child|kids)(id|ids|nom|noms)?$/)) return 'children';

  const place = has(/lieu|ville|commune|place|endroit|paroisse|localite|pays|departement/);
  const birth = has(/naiss|birth|^nee?$|^nee?(le|a)$|bapteme|bapt/);
  const death = has(/deces|death|mort|dcd|inhum|sepult|deced/);
  const marr = has(/mariage|marriage|union|wedding|noces/);
  if (place && birth) return 'birthPlace';
  if (place && death) return 'deathPlace';
  if (place && marr) return 'marriagePlace';
  if (birth) return 'birthDate';
  if (death) return 'deathDate';
  if (marr) return 'marriageDate';

  if (has(/prenom|firstname|givenname|forename|given/)) return 'firstName';
  if (has(/^(nomcomplet|nometprenoms?|prenoms?etnom|nomprenoms?|prenoms?nom|name|fullname|personne|individu|identite)$/)) return 'fullName';
  if (has(/^(nom|noms|nomdefamille|nomfamille|patronyme|surname|lastname|familyname|nomdenaissance|nomusuel)$/) || has(/^nom/)) return 'lastName';
  if (has(/profession|metier|occupation|job|activite/)) return 'occupation';
  if (has(/note|remarque|comment|observation|info|source/)) return 'notes';
  return null;
}

export function detectMapping(headers) {
  const mapping = {};
  headers.forEach((h, i) => {
    const key = detectField(h);
    if (key && !(key in mapping)) mapping[key] = i;
  });
  return mapping;
}

export function headersSignature(headers) {
  return headers.map(compact).join('|');
}

function parseSex(v) {
  const s = compact(v);
  if (!s) return '';
  if (/^(m|h|homme|masculin|masc|male|man|garcon|1|fils|pere)$/.test(s)) return 'M';
  if (/^(f|femme|feminin|fem|female|woman|fille|2|mere)$/.test(s)) return 'F';
  return '';
}

export function extractYear(v) {
  const m = String(v || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? m[1] : '';
}

function splitRefs(v) {
  const s = String(v || '').trim();
  if (!s) return [];
  return s.split(/\s*[;|\n/]+\s*|\s+et\s+|\s*&\s*|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
}

// rows : tableau de lignes (la première = en-têtes). mapping : { champ: indexColonne }
export function buildDatabase(rows, mapping) {
  const headers = rows[0] || [];
  const body = rows.slice(1);
  const col = (row, key) => (key in mapping && mapping[key] !== null && mapping[key] !== '' ? (row[mapping[key]] ?? '').trim() : '');
  const mappedCols = new Set(Object.values(mapping).map(Number));

  const persons = new Map();
  const order = [];
  body.forEach((row, idx) => {
    let id = col(row, 'id') || `L${idx + 2}`;
    id = id.replace(/\.0+$/, '');
    if (persons.has(id)) {
      let k = 2;
      while (persons.has(`${id}#${k}`)) k++;
      id = `${id}#${k}`;
    }
    let firstName = col(row, 'firstName');
    let lastName = col(row, 'lastName');
    const fullName = col(row, 'fullName');
    if (!firstName && !lastName && fullName) {
      // « NOM Prénom » ou « Prénom Nom » : on garde tel quel pour l'affichage
      firstName = fullName;
    }
    const extras = [];
    headers.forEach((h, i) => {
      if (!mappedCols.has(i) && (row[i] || '').trim()) extras.push([h || `Colonne ${i + 1}`, row[i].trim()]);
    });
    const p = {
      id,
      row: idx + 2,
      firstName,
      lastName,
      fullName,
      sex: parseSex(col(row, 'sex')),
      birthDate: col(row, 'birthDate'),
      birthPlace: col(row, 'birthPlace'),
      deathDate: col(row, 'deathDate'),
      deathPlace: col(row, 'deathPlace'),
      marriageDate: col(row, 'marriageDate'),
      marriagePlace: col(row, 'marriagePlace'),
      occupation: col(row, 'occupation'),
      notes: col(row, 'notes'),
      refs: {
        father: col(row, 'father'),
        mother: col(row, 'mother'),
        parents: col(row, 'parents'),
        spouse: col(row, 'spouse'),
        children: col(row, 'children'),
      },
      extras,
      father: null,
      mother: null,
      spouses: [],
    };
    p.name = [p.firstName, p.lastName].filter(Boolean).join(' ') || '(sans nom)';
    p.birthYear = extractYear(p.birthDate);
    p.deathYear = extractYear(p.deathDate);
    p.search = normalize(`${p.firstName} ${p.lastName} ${p.fullName} ${p.id}`);
    persons.set(id, p);
    order.push(id);
  });

  // Index par nom pour résoudre les références écrites en toutes lettres
  const byName = new Map();
  const addName = (key, id) => {
    const k = normalize(key);
    if (!k) return;
    if (!byName.has(k)) byName.set(k, []);
    if (!byName.get(k).includes(id)) byName.get(k).push(id);
  };
  for (const p of persons.values()) {
    addName(`${p.firstName} ${p.lastName}`, p.id);
    addName(`${p.lastName} ${p.firstName}`, p.id);
    if (p.fullName) addName(p.fullName, p.id);
  }

  let unresolved = 0;
  const resolve = (ref) => {
    let r = String(ref || '').trim();
    if (!r) return null;
    if (persons.has(r)) return r;
    const noDec = r.replace(/\.0+$/, '');
    if (persons.has(noDec)) return noDec;
    const candidates = [r, r.replace(/\s*\(.*?\)\s*/g, ' ')];
    for (const c of candidates) {
      const ids = byName.get(normalize(c));
      if (ids && ids.length) {
        if (ids.length > 1) {
          const year = extractYear(r);
          const match = year && ids.find((id) => persons.get(id).birthYear === year);
          if (match) return match;
        }
        return ids[0];
      }
    }
    unresolved++;
    return null;
  };
  const resolveList = (v) => {
    const parts = splitRefs(v);
    let ids = parts.map(resolve);
    // Repli : liste séparée par des virgules
    if (parts.length === 1 && !ids[0] && v.includes(',')) {
      unresolved--;
      ids = v.split(',').map((x) => resolve(x.trim()));
    }
    return ids.filter(Boolean);
  };

  const setParent = (child, parentId) => {
    if (!parentId || parentId === child.id) return;
    const parent = persons.get(parentId);
    if (child.father === parentId || child.mother === parentId) return;
    if (parent.sex === 'M' && !child.father) child.father = parentId;
    else if (parent.sex === 'F' && !child.mother) child.mother = parentId;
    else if (!parent.sex) {
      if (!child.father) child.father = parentId;
      else if (!child.mother) child.mother = parentId;
    }
  };
  const addSpouse = (a, b) => {
    if (!a || !b || a === b) return;
    const pa = persons.get(a);
    const pb = persons.get(b);
    if (!pa.spouses.includes(b)) pa.spouses.push(b);
    if (!pb.spouses.includes(a)) pb.spouses.push(a);
  };

  for (const p of persons.values()) {
    const f = resolve(p.refs.father);
    const m = resolve(p.refs.mother);
    if (f && f !== p.id) p.father = f;
    if (m && m !== p.id) p.mother = m;
  }
  for (const p of persons.values()) {
    if (p.refs.parents) resolveList(p.refs.parents).forEach((pid) => setParent(p, pid));
    if (p.refs.children) resolveList(p.refs.children).forEach((cid) => setParent(persons.get(cid), p.id));
    if (p.refs.spouse) resolveList(p.refs.spouse).forEach((sid) => addSpouse(p.id, sid));
  }
  // Déduit le sexe des parents si absent
  for (const p of persons.values()) {
    if (p.father && !persons.get(p.father).sex) persons.get(p.father).sex = 'M';
    if (p.mother && !persons.get(p.mother).sex) persons.get(p.mother).sex = 'F';
  }

  // Enfants
  const children = new Map();
  for (const id of order) {
    const p = persons.get(id);
    for (const par of [p.father, p.mother]) {
      if (!par) continue;
      if (!children.has(par)) children.set(par, []);
      children.get(par).push(id);
    }
  }
  const byBirth = (a, b) => {
    const pa = persons.get(a), pb = persons.get(b);
    const ya = pa.birthYear || '9999', yb = pb.birthYear || '9999';
    return ya === yb ? pa.row - pb.row : ya < yb ? -1 : 1;
  };
  for (const list of children.values()) list.sort(byBirth);
  // Les co-parents sont considérés comme conjoints
  for (const p of persons.values()) {
    if (p.father && p.mother) addSpouse(p.father, p.mother);
  }

  return {
    persons,
    order,
    unresolved,
    get: (id) => persons.get(id),
    childrenOf: (id) => children.get(id) || [],
    spousesOf: (id) => persons.get(id)?.spouses || [],
    siblingsOf(id) {
      const p = persons.get(id);
      if (!p) return [];
      const set = new Set();
      for (const par of [p.father, p.mother]) if (par) (children.get(par) || []).forEach((c) => c !== id && set.add(c));
      return [...set].sort(byBirth);
    },
    search(query, limit = 40) {
      const tokens = normalize(query).split(' ').filter(Boolean);
      if (!tokens.length) return [];
      const out = [];
      for (const id of order) {
        const p = persons.get(id);
        const words = p.search.split(' ');
        if (tokens.every((t) => words.some((w) => w.startsWith(t)))) out.push(p);
      }
      out.sort((a, b) => a.name.localeCompare(b.name, 'fr') || (a.birthYear || '').localeCompare(b.birthYear || ''));
      return out.slice(0, limit);
    },
  };
}

// Compare deux versions du fichier pour l'alerte de mise à jour.
export function diffDatabases(oldDb, newDb) {
  const key = (p) => (p.id.startsWith('L') && /^L\d+$/.test(p.id) ? normalize(p.name + ' ' + p.birthDate) : p.id);
  const sig = (p) => JSON.stringify([p.name, p.sex, p.birthDate, p.birthPlace, p.deathDate, p.deathPlace,
    p.father, p.mother, p.spouses, p.occupation, p.notes, p.extras]);
  const oldMap = new Map([...oldDb.persons.values()].map((p) => [key(p), sig(p)]));
  const newMap = new Map([...newDb.persons.values()].map((p) => [key(p), sig(p)]));
  let added = 0, removed = 0, modified = 0;
  for (const [k, s] of newMap) {
    if (!oldMap.has(k)) added++;
    else if (oldMap.get(k) !== s) modified++;
  }
  for (const k of oldMap.keys()) if (!newMap.has(k)) removed++;
  return { added, removed, modified };
}
