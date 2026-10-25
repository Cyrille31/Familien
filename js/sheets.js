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

export async function fetchSheet(input) {
  const parsed = parseSheetUrl(input);
  if (!parsed) throw new Error("Adresse non reconnue. Collez le lien de partage de la feuille Google Sheets.");
  if (!navigator.onLine) throw new Error('Pas de connexion Internet.');
  let lastError = null;
  let sawHtml = false;
  for (const url of parsed.urls) {
    try {
      const resp = await fetch(url, { cache: 'no-store', redirect: 'follow', credentials: 'omit' });
      if (!resp.ok) { lastError = new Error(`Réponse ${resp.status}`); continue; }
      const text = await resp.text();
      const type = resp.headers.get('content-type') || '';
      if (type.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) { sawHtml = true; continue; }
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  if (sawHtml || lastError) {
    throw new Error(
      "Impossible de lire le fichier. Vérifiez qu'il est partagé en « Tous les utilisateurs disposant du lien » (lecteur) " +
      "et qu'il s'agit bien d'une feuille Google Sheets (pas d'un fichier Excel déposé sur le Drive)."
    );
  }
  throw new Error('Fichier introuvable.');
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
