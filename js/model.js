// Modèle généalogique : détection des colonnes, construction des personnes et des liens.

export const FIELDS = [
  { key: 'id', label: 'Identifiant' },
  { key: 'firstName', label: 'Prénom(s)' },
  { key: 'lastName', label: 'Nom' },
  { key: 'maidenName', label: 'Nom de naissance' },
  { key: 'fullName', label: 'Nom complet' },
  { key: 'sex', label: 'Sexe' },
  { key: 'birthDate', label: 'Date de naissance' },
  { key: 'birthDM', label: 'Naissance : jour et mois (JJMM)' },
  { key: 'birthY', label: 'Naissance : année' },
  { key: 'birthPlace', label: 'Lieu de naissance' },
  { key: 'deathDate', label: 'Date de décès' },
  { key: 'deathDM', label: 'Décès : jour et mois (JJMM)' },
  { key: 'deathY', label: 'Décès : année' },
  { key: 'deathPlace', label: 'Lieu de décès' },
  { key: 'father', label: 'Père' },
  { key: 'mother', label: 'Mère' },
  { key: 'parents', label: 'Parents (les deux)' },
  { key: 'spouse', label: 'Conjoint(s)' },
  { key: 'spouse2', label: 'Conjoint 2' },
  { key: 'spouse3', label: 'Conjoint 3' },
  { key: 'children', label: 'Enfants' },
  { key: 'marriageDate', label: 'Date de mariage' },
  { key: 'marriageDM', label: 'Mariage : jour et mois (JJMM)' },
  { key: 'marriageY', label: 'Mariage : année' },
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
      has(/^(id|num|numero|ref)(personne|individu|person|individual)$/) ||
      has(/^(n|no|num|numero|id)?fiche$/)) return 'id';
  if (has(/^(sexe|sex|genre|gender|s|hf|fh|mf|hommefemme|masculinfeminin)$/)) return 'sex';
  if (has(/^(id|nom|ref|num|numero|no|n)?(du|de|of)?(pere|father|papa)(id|nom|ref|num|numero|no)?$/)) return 'father';
  if (has(/^(id|nom|ref|num|numero|no|n)?(de|la|dela|of)?(mere|mother|maman)(id|nom|ref|num|numero|no)?$/)) return 'mother';
  if (has(/^(les)?(id|ids|nom|noms)?(des)?parents?(id|ids|nom|noms)?$/)) return 'parents';
  if (has(/conjoint|epou|spouse|^mari$|^mari(e|id|nom)|^(nom|id)?(du|de)?mari$|husband|wife|partenaire|partner|compagn|^femme$/)) return 'spouse';
  if (has(/^(id|ids|nom|noms)?(des)?(enfants?|children|child|kids)(id|ids|nom|noms)?$/)) return 'children';

  if (has(/^nom(de)?(naissance|jeunefille|jf)$|^nomnais|maiden|birthname/)) return 'maidenName';

  const place = has(/lieu|ville|commune|place|endroit|paroisse|localite|pays|departement/);
  const birth = has(/naiss|birth|^nee?$|^nee?(le|a)$|bapteme|bapt/);
  const death = has(/deces|death|mort|dcd|inhum|sepult|deced/);
  const marr = has(/mariage|marriage|union|wedding|noces/);
  if (place && birth) return 'birthPlace';
  if (place && death) return 'deathPlace';
  if (place && marr) return 'marriagePlace';
  // Dates en deux colonnes : jour/mois (JJMM) et année (AAAA)
  const dm = has(/jjmm|jourmois|jour|ddmm/);
  const yr = has(/aaaa|annee|year|yyyy/);
  if (birth && dm) return 'birthDM';
  if (birth && yr) return 'birthY';
  if (death && dm) return 'deathDM';
  if (death && yr) return 'deathY';
  if (marr && dm) return 'marriageDM';
  if (marr && yr) return 'marriageY';
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
    let key = detectField(h);
    if (key === 'spouse' && 'spouse' in mapping) key = 'spouse2' in mapping ? 'spouse3' : 'spouse2';
    if (key && !(key in mapping)) mapping[key] = i;
  });
  return mapping;
}

// Trouve la ligne des titres (le fichier peut commencer par un titre ou une date).
export function findHeaderRow(rows) {
  let best = 0, bestScore = -1;
  rows.slice(0, 15).forEach((row, i) => {
    const score = new Set(row.map(detectField).filter(Boolean)).size;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

// « 2210 » + « 2021 » → « 22/10/2021 » ; « 101 » (1er janvier) = jour inconnu.
function composeDate(dm, y) {
  if (!y || !/^\d+$/.test(y)) return { date: y || '', unknown: false };
  if (Number(y) < 100) return { date: '', unknown: true };
  const d = String(dm || '').replace(/[,.].*$/, '').replace(/\D/g, '');
  if (d.length >= 3 && d !== '101' && d !== '0101') {
    const day = Number(d.slice(0, -2)), month = Number(d.slice(-2));
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${y}`, unknown: false };
    }
  }
  return { date: y, unknown: false };
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

// Certains fichiers ont un bloc de fiches numérotées à partir de 2001 dont les
// références (père, mère, conjoints) omettent le « 2000 ». On choisit, pour chaque
// bloc, le décalage qui donne des écarts d'âge parents/enfants cohérents.
function computeSectionOffsets(persons) {
  const bySection = new Map();
  for (const p of persons.values()) {
    if (!bySection.has(p.section)) bySection.set(p.section, []);
    bySection.get(p.section).push(p);
  }
  const offsets = new Map();
  for (const [section, list] of bySection) {
    const nums = list.map((p) => Number(p.id)).filter(Number.isFinite);
    if (nums.length < 5) continue;
    const maxOffset = Math.floor(Math.min(...nums) / 1000) * 1000;
    if (!maxOffset) continue;
    const score = (off) => {
      let sc = 0;
      for (const p of list) {
        const cy = Number(p.birthYear);
        for (const r of [p.refs.father, p.refs.mother]) {
          if (!/^\d+$/.test(r)) continue;
          const parent = persons.get(String(Number(r) + off));
          const py = parent && Number(parent.birthYear);
          if (cy && py) sc += cy - py >= 12 && cy - py <= 70 ? 1 : -1;
        }
      }
      return sc;
    };
    let best = 0, bestScore = score(0);
    for (let off = 1000; off <= maxOffset; off += 1000) {
      const sc = score(off);
      if (sc > bestScore + Math.max(3, list.length * 0.05)) { best = off; bestScore = sc; }
    }
    if (best) offsets.set(section, { offset: best, from: Math.min(...nums), to: Math.max(...nums) });
  }
  return offsets;
}

// rows : tableau de lignes (la première = en-têtes). mapping : { champ: indexColonne }
export function buildDatabase(rows, mapping) {
  const headers = rows[0] || [];
  const body = rows.slice(1);
  const col = (row, key) => {
    if (!(key in mapping) || mapping[key] === null || mapping[key] === '') return '';
    const v = (row[mapping[key]] ?? '').trim();
    return v === '0' ? '' : v; // « 0 » signifie « vide » dans beaucoup de fichiers
  };
  const mappedCols = new Set(Object.values(mapping).map(Number));

  const persons = new Map();
  const order = [];
  let section = 0, prevNum = null;
  body.forEach((row, idx) => {
    // Ignore les lignes modèles vides (sans aucun nom)
    if (!col(row, 'firstName') && !col(row, 'lastName') && !col(row, 'fullName')) return;
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
      if (!mappedCols.has(i) && (row[i] || '').trim() && row[i].trim() !== '0') extras.push([h || `Colonne ${i + 1}`, row[i].trim()]);
    });
    const birth = composeDate(col(row, 'birthDM'), col(row, 'birthY'));
    const death = composeDate(col(row, 'deathDM'), col(row, 'deathY'));
    const marriage = composeDate(col(row, 'marriageDM'), col(row, 'marriageY'));
    let maidenName = col(row, 'maidenName');
    // « (Buret) » = nom de naissance inconnu ; « X » = inconnu
    if (/^\(.*\)$/.test(maidenName) || /^x$/i.test(maidenName) || normalize(maidenName) === normalize(lastName)) maidenName = '';
    const p = {
      id,
      maidenName,
      deceased: death.unknown || !!(col(row, 'deathDate') || death.date),
      row: idx + 2,
      firstName,
      lastName,
      fullName,
      sex: parseSex(col(row, 'sex')),
      birthDate: col(row, 'birthDate') || birth.date,
      birthPlace: col(row, 'birthPlace'),
      deathDate: col(row, 'deathDate') || death.date || (death.unknown ? 'date inconnue' : ''),
      deathPlace: col(row, 'deathPlace'),
      marriageDate: col(row, 'marriageDate') || marriage.date,
      marriagePlace: col(row, 'marriagePlace'),
      occupation: col(row, 'occupation'),
      notes: col(row, 'notes'),
      refs: {
        father: col(row, 'father'),
        mother: col(row, 'mother'),
        parents: col(row, 'parents'),
        spouse: [col(row, 'spouse'), col(row, 'spouse2'), col(row, 'spouse3')].filter(Boolean).join(';'),
        children: col(row, 'children'),
      },
      extras,
      father: null,
      mother: null,
      spouses: [],
    };
    p.sexRaw = p.sex;
    p.name = [p.firstName, p.lastName].filter(Boolean).join(' ') || '(sans nom)';
    p.birthYear = extractYear(p.birthDate);
    // Clé de tri des fratries : date complète, puis rang des jumeaux (« 101,2 »)
    const dm = String(p.birthDate).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    const twin = (col(row, 'birthDM').match(/[,.](\d+)/) || [])[1] || '0';
    p.birthKey = p.birthYear
      ? p.birthYear + (dm ? dm[2].padStart(2, '0') + dm[1].padStart(2, '0') : '0000') + twin.padStart(2, '0')
      : '99999999';
    p.deathYear = extractYear(p.deathDate);
    p.search = normalize(`${p.firstName} ${p.lastName} ${p.maidenName} ${p.fullName} ${p.id}`);
    // Sections : blocs de numéros de fiche qui se suivent
    const num = /^\d+$/.test(id) ? Number(id) : null;
    if (num !== null && prevNum !== null && Math.abs(num - prevNum) > 50) section++;
    if (num !== null) prevNum = num;
    p.section = section;
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

  const offsets = computeSectionOffsets(persons);
  const offsetOf = (p) => offsets.get(p.section)?.offset || 0;

  let unresolved = 0;
  const resolve = (ref, off = 0) => {
    let r = String(ref || '').trim();
    if (!r) return null;
    if (off && /^\d+$/.test(r) && persons.has(String(Number(r) + off))) return String(Number(r) + off);
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
  const resolveList = (v, off = 0) => {
    const parts = splitRefs(v);
    let ids = parts.map((x) => resolve(x, off));
    // Repli : liste séparée par des virgules
    if (parts.length === 1 && !ids[0] && v.includes(',')) {
      unresolved--;
      ids = v.split(',').map((x) => resolve(x.trim(), off));
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
    const f = resolve(p.refs.father, offsetOf(p));
    const m = resolve(p.refs.mother, offsetOf(p));
    if (f && f !== p.id) p.father = f;
    if (m && m !== p.id && m !== p.father) p.mother = m;
  }
  for (const p of persons.values()) {
    const off = offsetOf(p);
    if (p.refs.parents) resolveList(p.refs.parents, off).forEach((pid) => setParent(p, pid));
    if (p.refs.children) resolveList(p.refs.children, off).forEach((cid) => setParent(persons.get(cid), p.id));
    if (p.refs.spouse) resolveList(p.refs.spouse, off).forEach((sid) => addSpouse(p.id, sid));
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
    const ka = pa.birthKey, kb = pb.birthKey;
    return ka === kb ? pa.row - pb.row : ka < kb ? -1 : 1;
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
    offsets: [...offsets.values()],
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
  const sig = (p) => JSON.stringify([p.name, p.sexRaw, p.birthDate, p.birthPlace, p.deathDate, p.deathPlace,
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
