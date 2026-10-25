// Connexion Google (OAuth 2.0, flux par redirection) pour lire un fichier privé.
// Pas de pop-up : fonctionne aussi dans l'application installée sur iPhone.
// Le jeton (lecture seule, valable 1 h) reste sur l'appareil.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_KEY = 'familien.token';
const PENDING_KEY = 'familien.oauth';

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function getToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    if (t && t.exp > Date.now() + 60000) return t;
  } catch { /* ignoré */ }
  return null;
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignoré */ }
}

// Quitte l'application vers la page de connexion Google ; `action` est rejouée au retour.
export function signIn(clientId, action) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(PENDING_KEY, JSON.stringify({ state, action, back: location.hash }));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params);
}

// À appeler au démarrage : récupère le jeton renvoyé par Google dans l'adresse.
export function handleRedirect() {
  if (!/(^#|&)(access_token|error)=/.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  let pending = {};
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; } catch { /* ignoré */ }
  localStorage.removeItem(PENDING_KEY);
  history.replaceState(null, '', location.pathname + location.search + (pending.back || ''));
  if (p.get('error')) return { error: p.get('error') };
  if (!pending.state || p.get('state') !== pending.state) return { error: 'state_mismatch' };
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    token: p.get('access_token'),
    exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000,
  }));
  return { action: pending.action };
}
