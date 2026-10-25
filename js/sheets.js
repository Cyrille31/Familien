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
    "Impossible de lire le fichier. Dans Google Sheets : Partager → Accès général → « Tous les utilisateurs disposant du lien » (Lecteur). " +
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
