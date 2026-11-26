import { findHeaderRow, headersSignature, headerScore } from './model.js';
import { readXlsx } from './xlsx.js';

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

// Lit tous les tableaux d'une page (un par onglet Google Sheets).
function htmlTables(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const table of doc.querySelectorAll('table')) {
    const rows = [];
    for (const tr of table.querySelectorAll('tbody tr, :scope > tr')) {
      const cells = [];
      for (const cell of tr.children) {
        // Google Sheets : les <th> sont les numéros de ligne / lettres de colonne
        if (cell.tagName !== 'TD' || /freezebar/.test(cell.className)) continue;
        cell.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        const text = cell.textContent.replace(/\u00a0/g, ' ').trim();
        const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
        cells.push(text);
        for (let k = 1; k < span; k++) cells.push('');
      }
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    if (rows.length >= 2) out.push(rows);
  }
  return out;
}

// Réunit les onglets qui ont les mêmes colonnes ; sinon garde le plus grand.
function mergeTables(tables) {
  const groups = new Map();
  for (const rows of tables) {
    const h = findHeaderRow(rows);
    const sig = headersSignature(rows[h].map((c) => c.split('\n').join(' ')));
    if (!groups.has(sig)) groups.set(sig, { rows: rows.slice(0, h + 1), count: 0 });
    const g = groups.get(sig);
    g.rows.push(...rows.slice(h + 1));
    g.count += rows.length - h - 1;
  }
  let best = null;
  for (const g of groups.values()) if (!best || g.count > best.count) best = g;
  return best?.rows;
}

function rowsToCsv(rows) {
  // Retire les colonnes vides à droite
  let width = 0;
  for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (r[i] !== '') { width = Math.max(width, i + 1); break; }
  return rows.map((r) => Array.from({ length: width }, (_, i) => csvCell(r[i] ?? '')).join(',')).join('\n');
}

// Classeur Excel : l'onglet qui contient l'arbre. S'il y en a plusieurs possibles,
// on demande lequel (chooseSheet), en proposant d'abord celui choisi la dernière fois.
async function xlsxToCsv(file, { chooseSheet, preferredSheet } = {}) {
  const sheets = (await readXlsx(file)).filter((s) => s.rows.length >= 2);
  const scored = sheets.map((s) => ({ ...s, score: headerScore(s.rows), count: s.rows.length - 1 - findHeaderRow(s.rows) }));
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best < 2) throw new Error("Aucun onglet de ce classeur ne ressemble à une liste de personnes (colonnes Nom, Prénom, Père, Mère…).");
  // Onglets plausibles : presque autant de colonnes reconnues que le meilleur
  const cands = scored.filter((s) => s.score >= Math.max(2, best - 1));
  let pick = cands[0];
  if (cands.length > 1) {
    const order = cands.slice().sort((a, b) => (b.name === preferredSheet) - (a.name === preferredSheet) || b.score - a.score || b.count - a.count);
    const name = chooseSheet ? await chooseSheet(order.map(({ name, count }) => ({ name, count }))) : order[0].name;
    if (!name) return null; // annulé
    pick = cands.find((s) => s.name === name);
  } else pick = cands.sort((a, b) => b.score - a.score)[0];
  return { csv: rowsToCsv(pick.rows.slice(findHeaderRow(pick.rows))), sheet: pick.name };
}

// Renvoie { csv, sheet } (sheet : onglet Excel choisi), ou null si l'utilisateur a annulé.
export async function fileToCsv(file, opts = {}) {
  const lower = (file.name || '').toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(lower) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return xlsxToCsv(file, opts);
  }
  const csv = await otherToCsv(file);
  return { csv, sheet: '' };
}

async function otherToCsv(file) {
  const name = (file.name || '').toLowerCase();
  if (/\.pdf$/.test(name) || file.type === 'application/pdf') {
    throw new Error("Un PDF ne contient pas les données sous forme de tableau. Importez plutôt le fichier .mht (page enregistrée) ou un fichier .csv.");
  }
  if (/\.(xls|ods)$/.test(name)) {
    throw new Error("Ancien format Excel (.xls) ou OpenOffice (.ods) non pris en charge : enregistrez le classeur au format .xlsx (Fichier → Enregistrer sous).");
  }
  const text = await file.text();
  const head = text.slice(0, 3000);
  const isMhtml = /\.(mht|mhtml)$/.test(name) || /^\s*(from:|mime-version:)/im.test(head) && /multipart\/related/i.test(head);
  const isHtml = /\.(html?|xhtml)$/.test(name) || /^\s*(<!doctype html|<html)/i.test(head);
  if (!isMhtml && !isHtml) return text;
  const pages = isMhtml ? mhtmlHtmlParts(text) : [text];
  const best = mergeTables(pages.flatMap(htmlTables));
  if (!best || best.length < 2) throw new Error("Aucun tableau de données trouvé dans ce fichier.");
  return rowsToCsv(best);
}
