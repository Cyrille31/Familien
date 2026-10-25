// Lecture des fichiers importés depuis l'appareil : CSV, ou page Google Sheets
// enregistrée (.mht / .mhtml « page web » ou .html), dont on extrait le tableau.

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function decodeQuotedPrintable(text, charset) {
  const clean = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.substr(i + 1, 2))) {
      bytes.push(parseInt(clean.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(clean.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes));
}

function decodeBase64(text, charset) {
  const bin = atob(text.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder(charset || 'utf-8').decode(bytes);
}

// Extrait toutes les parties HTML d'une archive MHTML.
function mhtmlHtmlParts(raw) {
  const boundary = (raw.match(/boundary="?([^"\r\n;]+)"?/i) || [])[1];
  const chunks = boundary ? raw.split('--' + boundary) : [raw];
  const parts = [];
  for (const chunk of chunks) {
    const sep = chunk.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const head = chunk.slice(0, sep);
    if (!/content-type:\s*text\/html/i.test(head)) continue;
    const body = chunk.slice(sep).replace(/^\r?\n\r?\n/, '');
    const charset = (head.match(/charset="?([\w-]+)/i) || [])[1];
    const enc = ((head.match(/content-transfer-encoding:\s*([\w-]+)/i) || [])[1] || '').toLowerCase();
    try {
      if (enc === 'quoted-printable') parts.push(decodeQuotedPrintable(body, charset));
      else if (enc === 'base64') parts.push(decodeBase64(body, charset));
      else parts.push(body);
    } catch { /* partie illisible */ }
  }
  return parts;
}

// Convertit le plus grand tableau d'une page en lignes de cellules.
function htmlTableRows(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = [...doc.querySelectorAll('table')];
  let best = null;
  for (const table of tables) {
    const rows = [];
    for (const tr of table.querySelectorAll('tbody tr, :scope > tr')) {
      const cells = [];
      for (const cell of tr.children) {
        // Google Sheets : les <th> sont les numéros de ligne / lettres de colonne
        if (cell.tagName !== 'TD' || /freezebar/.test(cell.className)) continue;
        cell.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        const text = cell.textContent.replace(/ /g, ' ').trim();
        const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
        cells.push(text);
        for (let k = 1; k < span; k++) cells.push('');
      }
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    if (rows.length && (!best || rows.length > best.length)) best = rows;
  }
  return best;
}

function rowsToCsv(rows) {
  // Retire les colonnes vides à droite
  let width = 0;
  for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (r[i] !== '') { width = Math.max(width, i + 1); break; }
  return rows.map((r) => Array.from({ length: width }, (_, i) => csvCell(r[i] ?? '')).join(',')).join('\n');
}

export async function fileToCsv(file) {
  const name = (file.name || '').toLowerCase();
  if (/\.pdf$/.test(name) || file.type === 'application/pdf') {
    throw new Error("Un PDF ne contient pas les données sous forme de tableau. Importez plutôt le fichier .mht (page enregistrée) ou un fichier .csv.");
  }
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    throw new Error("Format non pris en charge. Dans Google Sheets : Fichier → Télécharger → Valeurs séparées par des virgules (.csv).");
  }
  const text = await file.text();
  const head = text.slice(0, 3000);
  const isMhtml = /\.(mht|mhtml)$/.test(name) || /^\s*(from:|mime-version:)/im.test(head) && /multipart\/related/i.test(head);
  const isHtml = /\.(html?|xhtml)$/.test(name) || /^\s*(<!doctype html|<html)/i.test(head);
  if (!isMhtml && !isHtml) return text;
  const pages = isMhtml ? mhtmlHtmlParts(text) : [text];
  let best = null;
  for (const html of pages) {
    const rows = htmlTableRows(html);
    if (rows && (!best || rows.length > best.length)) best = rows;
  }
  if (!best || best.length < 2) throw new Error("Aucun tableau de données trouvé dans ce fichier.");
  return rowsToCsv(best);
}
