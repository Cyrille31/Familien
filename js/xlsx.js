// Lecture des classeurs Excel (.xlsx, .xlsm) sans bibliothèque externe :
// un .xlsx est une archive zip de fichiers XML.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Ce navigateur ne sait pas lire les fichiers Excel. Mettez-le à jour, ou enregistrez le fichier au format .csv.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Table des fichiers de l'archive : nom → fonction qui renvoie le contenu
function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier Excel est illisible (archive incomplète).");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const data = b.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error('Compression non prise en charge dans ce fichier Excel.');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function readXml(files, name) {
  const get = files.get(name.replace(/^\//, ''));
  if (!get) return null;
  const text = new TextDecoder().decode(await get());
  return new DOMParser().parseFromString(text, 'application/xml');
}

const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const textOf = (node) => tags(node, 't').filter((t) => !t.closest?.('rPh')).map((t) => t.textContent).join('');

// Formats de date intégrés à Excel
const DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function dateKind(code) {
  const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
  if (!/[dy]/.test(c) && !/m/.test(c.replace(/[hs]:?m+|m+:?s/g, ''))) return null;
  if (/^[^dmy]*h/.test(c) && !/[dy]/.test(c)) return null; // heure seule
  return { d: /d/.test(c), m: /m/.test(c), y: /y/.test(c) };
}

function formatDate(serial, kind, date1904) {
  const ms = Math.round((serial + (date1904 ? 1462 : 0)) * 86400000);
  const dt = new Date(Date.UTC(1899, 11, 30) + ms);
  const dd = String(dt.getUTCDate()).padStart(2, '0'), mm = String(dt.getUTCMonth() + 1).padStart(2, '0'), yy = dt.getUTCFullYear();
  if (kind.y && !kind.d && !kind.m) return String(yy);
  if (kind.y && !kind.d) return `${mm}/${yy}`;
  if (!kind.y) return `${dd}/${mm}`;
  return `${dd}/${mm}/${yy}`;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

// Renvoie les onglets visibles : [{ name, rows: [[texte, …], …] }]
export async function readXlsx(file) {
  const files = unzip(await file.arrayBuffer());
  const wb = await readXml(files, 'xl/workbook.xml');
  if (!wb) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx).");
  const rels = await readXml(files, 'xl/_rels/workbook.xml.rels');
  const target = new Map(rels ? tags(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]) : []);
  const date1904 = tags(wb, 'workbookPr').some((w) => /^(1|true)$/.test(w.getAttribute('date1904') || ''));

  const sst = await readXml(files, 'xl/sharedStrings.xml');
  const shared = sst ? tags(sst, 'si').map(textOf) : [];

  // Styles : quels numéros de style sont des dates
  const styles = await readXml(files, 'xl/styles.xml');
  const xfDate = [];
  if (styles) {
    const custom = new Map(tags(styles, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '']));
    const cellXfs = tags(styles, 'cellXfs')[0];
    for (const xf of cellXfs ? Array.from(cellXfs.children).filter((x) => x.localName === 'xf') : []) {
      const id = Number(xf.getAttribute('numFmtId') || 0);
      xfDate.push(custom.has(id) ? dateKind(custom.get(id)) : DATE_IDS.has(id) ? { d: true, m: true, y: true } : null);
    }
  }

  const out = [];
  for (const sh of tags(wb, 'sheet')) {
    if (/hidden/i.test(sh.getAttribute('state') || '')) continue;
    const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
    let path = target.get(rid);
    if (!path) continue;
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const doc = await readXml(files, path);
    if (!doc) continue;
    const rows = [];
    for (const row of tags(doc, 'row')) {
      const cells = [];
      let next = 0;
      for (const c of Array.from(row.children).filter((x) => x.localName === 'c')) {
        const ref = c.getAttribute('r');
        const i = ref ? colIndex(ref) : next;
        next = i + 1;
        const t = c.getAttribute('t') || 'n';
        const v = tags(c, 'v')[0]?.textContent ?? '';
        let s = '';
        if (t === 's') s = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') s = textOf(c);
        else if (t === 'str') s = v;
        else if (t === 'b') s = v === '1' ? 'VRAI' : 'FAUX';
        else if (t === 'e') s = '';
        else if (v !== '') {
          const num = Number(v);
          const kind = xfDate[Number(c.getAttribute('s') || 0)];
          s = kind && Number.isFinite(num) ? formatDate(num, kind, date1904) : Number.isFinite(num) ? String(Number(num.toPrecision(15))) : v;
        }
        cells[i] = s.replace(/\r\n?/g, '\n').trim();
      }
      for (let k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = '';
      if (cells.some((x) => x !== '')) rows.push(cells);
    }
    out.push({ name: sh.getAttribute('name') || `Onglet ${out.length + 1}`, rows });
  }
  return out;
}
