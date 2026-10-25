// Accès au fichier Google Sheets / Google Drive. Appelé uniquement sur demande.

export function parseSheetUrl(input) {
  // Retire la ponctuation collée par erreur en fin de lien
  const s = (input || '').trim().replace(/[\s,;.)\]>»"']+$/, '');
  if (!s) return null;
  const gid = (s.match(/[#&?]gid=(\d+)/) || [])[1];
  const gidParam = gid ? `&gid=${gid}` : '';

  // Feuille « publiée sur le Web »
  let m = s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([\w-]+)/);
  if (m) {
    return { id: m[1], gid, urls: [`https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv${gidParam}`] };
  }
  // Lien de partage classique (ou lien Drive vers une feuille Google)
  m = s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/) || s.match(/\/file\/d\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  if (!m && /^[\w-]{25,}$/.test(s)) m = [s, s];
  if (m) {
    const id = m[1];
    return {
      id,
      gid,
      urls: [
        `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gidParam}`,
        `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1${gidParam}`,
      ],
    };
  }
  // Toute autre adresse : on suppose un CSV direct
  if (/^https?:\/\//i.test(s)) return { id: null, gid: null, urls: [s] };
  return null;
}

// Lecture par « JSONP » (balise <script>) : contourne les blocages CORS de l'export CSV.
function fetchViaScript(id, gid, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const cb = '__familien_cb' + Date.now() + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    const cleanup = () => { delete window[cb]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('délai dépassé')); }, timeout);
    window[cb] = (data) => {
      cleanup();
      if (!data || data.status === 'error') {
        const reason = data?.errors?.[0]?.detailed_message || data?.errors?.[0]?.message || 'erreur Google';
        return reject(new Error(reason));
      }
      resolve(gvizToCsv(data.table));
    };
    const denied = () => { cleanup(); reject(new Error('accès refusé par Google : fichier non partagé publiquement')); };
    script.onerror = denied;
    // Script chargé sans appel du rappel : Google a renvoyé sa page de connexion
    script.onload = () => setTimeout(() => { if (window[cb]) denied(); }, 50);
    script.src = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=1${gid ? '&gid=' + gid : ''}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function gvizToCsv(table) {
  const header = table.cols.map((c, i) => c.label || c.id || `Colonne ${i + 1}`);
  const lines = [header.map(csvCell).join(',')];
  for (const row of table.rows || []) {
    const cells = table.cols.map((_, i) => {
      const c = row.c?.[i];
      if (!c) return '';
      return c.f ?? c.v ?? '';
    });
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}

// Lecture d'un fichier privé avec le compte Google connecté (API Google Sheets, lecture seule).
export async function fetchSheetWithToken(input, token) {
  const parsed = parseSheetUrl(input);
  if (!parsed?.id || /^2PACX-/.test(parsed.id)) throw new Error("Adresse non reconnue. Collez le lien de la feuille Google Sheets.");
  if (!navigator.onLine) throw new Error('Pas de connexion Internet.');
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsed.id)}`;
  const call = async (url) => {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (resp.ok) return resp.json();
    let msg = '';
    try { msg = (await resp.json()).error?.message || ''; } catch { /* ignoré */ }
    const err = new Error(apiErrorMessage(resp.status, msg));
    if (resp.status === 401) err.code = 'AUTH';
    throw err;
  };
  const meta = await call(`${base}?fields=sheets.properties(sheetId,title)`);
  const sheets = meta.sheets || [];
  const sheet = sheets.find((s) => String(s.properties.sheetId) === String(parsed.gid)) || sheets[0];
  if (!sheet) throw new Error('Le fichier ne contient aucun onglet.');
  const range = `'${sheet.properties.title.replace(/'/g, "''")}'`;
  const data = await call(`${base}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  const rows = data.values || [];
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, i) => csvCell(r[i] ?? '')).join(',')).join('\n');
}

function apiErrorMessage(status, msg) {
  if (status === 401) return 'Connexion Google expirée.';
  if (/has not been used|is disabled|not enabled/i.test(msg)) {
    return "L'API Google Sheets n'est pas activée dans le projet Google Cloud (API et services → Bibliothèque → Google Sheets API → Activer).";
  }
  if (/not supported for this document/i.test(msg)) {
    return "Ce fichier est un fichier Excel déposé sur le Drive. Ouvrez-le puis Fichier → Enregistrer au format Google Sheets, et utilisez le lien du nouveau fichier.";
  }
  if (status === 403) return "Le compte Google connecté n'a pas accès à ce fichier. Partagez-le avec ce compte (Partager → ajouter son adresse).";
  if (status === 404) return 'Fichier introuvable : vérifiez son adresse.';
  return `Erreur Google (${status})${msg ? ' : ' + msg : ''}`;
}

export async function fetchSheet(input) {
  const parsed = parseSheetUrl(input);
  if (!parsed) throw new Error("Adresse non reconnue. Collez le lien de partage de la feuille Google Sheets.");
  if (!navigator.onLine) throw new Error('Pas de connexion Internet.');
  const problems = [];
  for (const url of parsed.urls) {
    try {
      const resp = await fetch(url, { cache: 'no-store', redirect: 'follow', credentials: 'omit' });
      if (!resp.ok) { problems.push(`réponse ${resp.status}`); continue; }
      const text = await resp.text();
      const type = resp.headers.get('content-type') || '';
      if (type.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) { problems.push('page de connexion Google'); continue; }
      return text;
    } catch (e) {
      problems.push(e.message || 'échec réseau');
    }
  }
  if (parsed.id && typeof document !== 'undefined') {
    try {
      return await fetchViaScript(parsed.id, parsed.gid);
    } catch (e) {
      problems.push(e.message);
    }
  }
  throw new Error(
    "Impossible de lire le fichier sans connexion Google : il n'est pas public. Renseignez l'identifiant client Google dans les réglages (« Fichier privé : connexion Google ») pour vous connecter avec votre compte. " +
    `(Détail : ${problems.join(' ; ')})`
  );
}

export async function hashText(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // FNV-1a si crypto.subtle n'est pas disponible (page non sécurisée)
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return 'fnv' + (h >>> 0).toString(16) + text.length;
  }
}
