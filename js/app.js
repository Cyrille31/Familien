import { parseCSV } from './csv.js';
import { FIELDS, detectMapping, headersSignature, buildDatabase, diffDatabases } from './model.js';
import * as store from './storage.js';
import { fetchSheet, fetchSheetWithToken, hashText } from './sheets.js';
import * as auth from './auth.js';
import { computeTree, renderInto, exportSvgString, PanZoom } from './tree.js';

const APP_VERSION = '1.1.2';
// Fichier de la famille proposé par défaut au premier lancement
const DEFAULT_URL = 'https://docs.google.com/spreadsheets/d/1GVpEFBoonQ2M5ZG7dK4_bNW2w1BkZXE9ZupN6cHlXYM/edit';
// Identifiant client Google (OAuth) pour lire le fichier privé avec son compte Google.
// Il n'est pas secret ; il peut aussi être saisi dans les réglages.
const DEFAULT_CLIENT_ID = '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  config: { url: DEFAULT_URL, clientId: DEFAULT_CLIENT_ID, autoCheck: true, mapping: null, headersSig: '' },
  data: null,      // { csv, hash, fetchedAt, source, fileName }
  headers: [],
  db: null,
  tree: null,
  rootId: null,
  pending: null,   // nouvelle version du Drive en attente d'accord
  ancDepth: 99,
  descDepth: 99,
};

const prefs = {
  get(k, d) { try { const v = localStorage.getItem('familien.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('familien.' + k, JSON.stringify(v)); } catch { /* ignoré */ } },
};

// ---------- Outils d'interface ----------

let toastTimer;
function toast(msg, { action, onAction, duration = 3500 } = {}) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.onclick = () => { t.hidden = true; onAction(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => { t.hidden = true; }, duration);
}

function busy(btn, on) {
  btn.disabled = on;
  btn.classList.toggle('busy', on);
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

const years = (p) => {
  const b = p.birthYear, d = p.deathYear;
  return b || d ? `${b || '?'}${d ? '–' + d : ''}` : '';
};

// ---------- Données ----------

function prepare(csv, config = state.config) {
  const rows = parseCSV(csv);
  if (rows.length < 2) throw new Error('Le fichier est vide ou ne contient que des en-têtes.');
  const headers = rows[0].map((h) => h.trim());
  const sig = headersSignature(headers);
  const mapping = config.mapping && config.headersSig === sig ? config.mapping : detectMapping(headers);
  return { rows, headers, sig, mapping, db: buildDatabase(rows, mapping) };
}

async function applyDataset(csv, meta) {
  const prep = prepare(csv);
  state.data = { csv, hash: meta.hash || (await hashText(csv)), fetchedAt: Date.now(), source: meta.source, fileName: meta.fileName || '' };
  state.config.mapping = prep.mapping;
  state.config.headersSig = prep.sig;
  state.headers = prep.headers;
  state.db = prep.db;
  state.pending = null;
  $('updateDot').hidden = true;
  await store.set('data', state.data);
  await store.set('config', state.config);
  store.requestPersistence();
  if (state.rootId && !state.db.get(state.rootId)) state.rootId = null;
  refreshAll();
  return prep;
}

async function saveConfig() {
  await store.set('config', state.config);
}

function refreshAll() {
  renderSourceInfo();
  renderMapping();
  renderTree(true);
  if (!$('panel').hidden && state.panelId) showPerson(state.panelId);
}

// ---------- Drive ----------

class Redirecting extends Error {}

// Lit le fichier : avec le compte Google si un identifiant client est configuré
// (fichier privé), sinon comme fichier public. `interactive` autorise la
// redirection vers la page de connexion Google.
async function driveFetch(url, interactive) {
  const clientId = state.config.clientId;
  if (!clientId) return fetchSheet(url);
  const token = auth.getToken();
  if (token) {
    try {
      return await fetchSheetWithToken(url, token.token);
    } catch (e) {
      if (e.code !== 'AUTH') throw e;
      auth.clearToken();
    }
  }
  if (!interactive) throw new Redirecting();
  await saveConfig();
  auth.signIn(clientId, 'check');
  throw new Redirecting();
}

async function downloadFromDrive() {
  const url = $('sheetUrl').value.trim();
  if (!url) { toast("Collez d'abord l'adresse du fichier."); $('sheetUrl').focus(); return; }
  const btn = $('btnDownload');
  busy(btn, true);
  try {
    state.config.url = url;
    const csv = await driveFetch(url, true);
    const hash = await hashText(csv);
    if (state.data && state.data.hash === hash) {
      await saveConfig();
      toast('Votre copie est déjà à jour ✓');
      return;
    }
    const prep = await applyDataset(csv, { source: 'drive', hash });
    toast(`${prep.db.persons.size} personnes chargées ✓`);
    $('mappingSection').hidden = false;
  } catch (e) {
    if (!(e instanceof Redirecting)) toast(e.message, { duration: 9000 });
  } finally {
    busy(btn, false);
  }
}

async function checkForUpdate({ silent = false } = {}) {
  if (!state.config.url) {
    if (!silent) { openSettings(); toast("Indiquez d'abord l'adresse du fichier sur le Drive."); }
    return;
  }
  if (!navigator.onLine) { if (!silent) toast('Pas de connexion : vous utilisez la copie enregistrée sur l’appareil.'); return; }
  const btn = $('btnCheck');
  busy(btn, true);
  try {
    const csv = await driveFetch(state.config.url, !silent);
    const hash = await hashText(csv);
    state.config.lastCheck = Date.now();
    await saveConfig();
    if (!state.data) {
      await applyDataset(csv, { source: 'drive', hash });
      toast(`${state.db.persons.size} personnes chargées ✓`);
      return;
    }
    if (hash === state.data.hash) {
      if (!silent) toast('Le fichier n’a pas changé : votre copie est à jour ✓');
      return;
    }
    const prep = prepare(csv);
    const diff = diffDatabases(state.db, prep.db);
    state.pending = { csv, hash };
    $('updateDot').hidden = false;
    const parts = [];
    if (diff.added) parts.push(`<b>${diff.added}</b> personne${diff.added > 1 ? 's' : ''} ajoutée${diff.added > 1 ? 's' : ''}`);
    if (diff.modified) parts.push(`<b>${diff.modified}</b> modifiée${diff.modified > 1 ? 's' : ''}`);
    if (diff.removed) parts.push(`<b>${diff.removed}</b> supprimée${diff.removed > 1 ? 's' : ''}`);
    $('updateText').innerHTML =
      `${parts.length ? parts.join(', ') + '.' : 'Le contenu du fichier a été modifié.'}<br>` +
      `<span class="muted">Votre copie date du ${esc(formatDate(state.data.fetchedAt))}. Voulez-vous la remplacer par la version du Drive ?</span>`;
    $('dlgUpdate').showModal();
  } catch (e) {
    if (!silent && !(e instanceof Redirecting)) toast(e.message, { duration: 9000 });
  } finally {
    busy(btn, false);
  }
}

// ---------- Arbre ----------

const svg = $('treeSvg');
const viewport = $('viewport');
const pz = new PanZoom(svg, viewport, (id) => showPerson(id));

function renderTree(fit) {
  const has = state.db && state.rootId && state.db.get(state.rootId);
  $('empty').hidden = !!has;
  svg.style.visibility = has ? 'visible' : 'hidden';
  $('toolbar').hidden = !has;
  $('treeInfo').hidden = !has;
  if (!has) { viewport.textContent = ''; renderEmpty(); return; }
  state.tree = computeTree(state.db, state.rootId, state.ancDepth, state.descDepth);
  renderInto(viewport, state.db, state.tree);
  const p = state.db.get(state.rootId);
  $('treeInfo').textContent = `${p.name} · ${state.tree.ancCount} ascendant${state.tree.ancCount > 1 ? 's' : ''} · ${state.tree.descCount} descendant${state.tree.descCount > 1 ? 's' : ''}`;
  if (fit) requestAnimationFrame(() => pz.fit(state.tree.bbox, true));
  document.title = `${p.name} – Familien`;
}

function renderEmpty() {
  document.title = 'Familien';
  if (state.db) {
    $('emptyTitle').textContent = `${state.db.persons.size} personnes dans votre fichier`;
    $('emptyText').innerHTML = 'Tapez le nom d’une personne dans la barre de recherche pour afficher son arbre complet : ascendants et descendants.' +
      (state.data?.fetchedAt ? `<br><span class="muted">Copie locale du ${esc(formatDate(state.data.fetchedAt))}</span>` : '');
    $('btnStart').hidden = true;
  } else {
    $('emptyTitle').textContent = 'Bienvenue dans Familien';
    $('emptyText').textContent = 'Reliez votre fichier généalogique Google Sheets pour commencer.';
    $('btnStart').hidden = false;
  }
}

function selectRoot(id, push = true) {
  if (!state.db?.get(id)) return;
  state.rootId = id;
  prefs.set('root', id);
  if (push && location.hash !== '#p=' + encodeURIComponent(id)) history.pushState({ id }, '', '#p=' + encodeURIComponent(id));
  hidePanel();
  renderTree(true);
}

window.addEventListener('popstate', () => {
  const m = location.hash.match(/^#p=(.+)$/);
  const id = m ? decodeURIComponent(m[1]) : null;
  if (id && state.db?.get(id)) selectRoot(id, false);
  else { state.rootId = null; renderTree(false); }
});

function fillDepthSelect(sel, value) {
  const opts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 99];
  sel.innerHTML = opts.map((n) => `<option value="${n}">${n === 99 ? 'Toutes' : n + ' gén.'}</option>`).join('');
  sel.value = String(opts.includes(value) ? value : 99);
}

// ---------- Fiche d'une personne ----------

function personButton(id) {
  const p = state.db.get(id);
  if (!p) return '';
  const sex = p.sex === 'M' ? 'm' : p.sex === 'F' ? 'f' : 'u';
  const y = years(p);
  return `<button class="plink s-${sex}" data-id="${esc(id)}">${esc(p.name)}${y ? ` <small>${esc(y)}</small>` : ''}</button>`;
}

function showPerson(id) {
  const db = state.db;
  const p = db.get(id);
  if (!p) return;
  state.panelId = id;
  const fact = (label, ...vals) => {
    const v = vals.filter(Boolean).join(', ');
    return v ? `<div class="fact"><dt>${esc(label)}</dt><dd>${esc(v)}</dd></div>` : '';
  };
  const group = (label, ids) => ids.length
    ? `<div class="fam"><h4>${esc(label)}</h4><div class="plinks">${ids.map(personButton).join('')}</div></div>` : '';
  const sexLabel = p.sex === 'M' ? 'Homme' : p.sex === 'F' ? 'Femme' : '';
  const parents = [p.father, p.mother].filter(Boolean);
  $('panelBody').innerHTML = `
    <div class="p-head s-${p.sex === 'M' ? 'm' : p.sex === 'F' ? 'f' : 'u'}">
      <h3>${esc(p.name)}</h3>
      <p class="muted">${esc([sexLabel, years(p)].filter(Boolean).join(' · '))}</p>
    </div>
    ${id !== state.rootId ? `<button class="btn primary block" data-root="${esc(id)}">Afficher son arbre</button>` : ''}
    <dl class="facts">
      ${fact('Naissance', p.birthDate, p.birthPlace)}
      ${fact('Décès', p.deathDate, p.deathPlace)}
      ${fact('Mariage', p.marriageDate, p.marriagePlace)}
      ${fact('Profession', p.occupation)}
      ${fact('Notes', p.notes)}
      ${p.extras.map(([k, v]) => fact(k, v)).join('')}
    </dl>
    ${group('Parents', parents)}
    ${group(db.spousesOf(id).length > 1 ? 'Conjoints' : 'Conjoint', db.spousesOf(id))}
    ${group('Enfants', db.childrenOf(id))}
    ${group('Frères et sœurs', db.siblingsOf(id))}
  `;
  $('panel').hidden = false;
  $('panelBody').scrollTop = 0;
}

function hidePanel() { $('panel').hidden = true; state.panelId = null; }

$('panelBody').addEventListener('click', (e) => {
  const root = e.target.closest('[data-root]');
  if (root) return selectRoot(root.dataset.root);
  const link = e.target.closest('.plink');
  if (link) showPerson(link.dataset.id);
});
$('panelClose').onclick = hidePanel;

// ---------- Recherche ----------

const search = $('search');
const results = $('results');
let resultItems = [];

function renderResults() {
  const q = search.value;
  if (!state.db || !q.trim()) { results.hidden = true; return; }
  resultItems = state.db.search(q);
  results.innerHTML = resultItems.length
    ? resultItems.map((p, i) => `<li role="option" data-i="${i}"><b>${esc(p.name)}</b> <span class="muted">${esc([years(p), p.birthPlace].filter(Boolean).join(' · '))}</span></li>`).join('')
    : '<li class="none">Aucune personne trouvée</li>';
  results.hidden = false;
}

function pickResult(i) {
  const p = resultItems[i];
  if (!p) return;
  search.value = '';
  results.hidden = true;
  search.blur();
  selectRoot(p.id);
}

search.addEventListener('input', renderResults);
search.addEventListener('focus', () => {
  renderResults();
  if (!state.db) toast("Reliez d'abord votre fichier (bouton ⚙).");
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); pickResult(0); }
  if (e.key === 'Escape') { search.value = ''; results.hidden = true; }
});
results.addEventListener('pointerdown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); pickResult(Number(li.dataset.i)); }
});
search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));

// ---------- Réglages ----------

function openSettings() {
  $('sheetUrl').value = state.config.url || '';
  $('autoCheck').checked = !!state.config.autoCheck;
  $('clientId').value = state.config.clientId || '';
  $('redirectUri').textContent = auth.redirectUri();
  renderAuthInfo();
  renderSourceInfo();
  renderMapping();
  $('dlgSettings').showModal();
}

function renderAuthInfo() {
  const box = $('authInfo');
  if (!state.config.clientId) {
    box.innerHTML = '<span class="muted">Non configuré : seuls les fichiers publics peuvent être lus.</span>';
    return;
  }
  const t = auth.getToken();
  box.innerHTML = t
    ? `Connecté à Google jusqu'à ${esc(new Date(t.exp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}. <button id="btnSignOut" class="btn ghost">Se déconnecter</button>`
    : '<span class="muted">La connexion sera demandée au prochain téléchargement depuis le Drive.</span>';
  const out = $('btnSignOut');
  if (out) out.onclick = () => { auth.clearToken(); renderAuthInfo(); toast('Déconnecté de Google.'); };
}

function renderSourceInfo() {
  const box = $('sourceInfo');
  if (!state.data || !state.db) { box.hidden = true; return; }
  const src = { drive: 'Google Drive', file: `fichier importé${state.data.fileName ? ' « ' + state.data.fileName + ' »' : ''}`, demo: 'exemple' }[state.data.source] || '';
  box.innerHTML = `<b>${state.db.persons.size}</b> personnes enregistrées sur cet appareil<br>
    <span class="muted">Source : ${esc(src)} · copie du ${esc(formatDate(state.data.fetchedAt))}</span>
    ${state.db.unresolved ? `<br><span class="warn">${state.db.unresolved} lien(s) familial(aux) non retrouvé(s) dans le fichier.</span>` : ''}`;
  box.hidden = false;
}

function renderMapping() {
  const sec = $('mappingSection');
  if (!state.headers.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const m = state.config.mapping || {};
  const options = (sel) => ['<option value="">—</option>',
    ...state.headers.map((h, i) => `<option value="${i}"${String(sel) === String(i) ? ' selected' : ''}>${esc(h || 'Colonne ' + (i + 1))}</option>`)].join('');
  $('mappingGrid').innerHTML = FIELDS.map((f) =>
    `<label><span>${esc(f.label)}</span><select data-key="${f.key}">${options(m[f.key] ?? '')}</select></label>`).join('');
}

$('btnApplyMapping').onclick = async () => {
  const mapping = {};
  for (const sel of $('mappingGrid').querySelectorAll('select')) if (sel.value !== '') mapping[sel.dataset.key] = Number(sel.value);
  state.config.mapping = mapping;
  await saveConfig();
  state.db = prepare(state.data.csv).db;
  refreshAll();
  toast('Correspondance des colonnes appliquée ✓');
};

$('btnSettings').onclick = openSettings;
$('btnStart').onclick = openSettings;
$('btnDownload').onclick = downloadFromDrive;
$('sheetUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); downloadFromDrive(); } });
const isClientId = (v) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(v);

$('clientId').onchange = async (e) => {
  const v = e.target.value.trim();
  if (v && !isClientId(v)) {
    toast("Ce n'est pas un identifiant client : il se termine par « .apps.googleusercontent.com » et se crée dans la console Google Cloud (voir le guide). Ce n'est pas votre adresse Gmail.", { duration: 10000 });
    e.target.value = state.config.clientId || '';
    return;
  }
  state.config.clientId = v;
  auth.clearToken();
  await saveConfig();
  renderAuthInfo();
};
$('autoCheck').onchange = async (e) => { state.config.autoCheck = e.target.checked; await saveConfig(); };
$('btnCheck').onclick = () => (state.pending ? $('dlgUpdate').showModal() : checkForUpdate());

$('btnAccept').onclick = async () => {
  $('dlgUpdate').close();
  if (!state.pending) return;
  const { csv, hash } = state.pending;
  try {
    await applyDataset(csv, { source: 'drive', hash });
    toast(`Mise à jour effectuée : ${state.db.persons.size} personnes ✓`);
  } catch (e) { toast(e.message, { duration: 8000 }); }
};
$('btnRefuse').onclick = () => {
  $('dlgUpdate').close();
  toast('Vous gardez votre version. Le point orange rappelle qu’une mise à jour est disponible.', { duration: 5000 });
};

$('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const csv = await file.text();
    const prep = await applyDataset(csv, { source: 'file', fileName: file.name });
    toast(`${prep.db.persons.size} personnes importées ✓`);
  } catch (err) { toast(err.message, { duration: 8000 }); }
};

$('btnDemo').onclick = async () => {
  try {
    const csv = await (await fetch('exemple.csv')).text();
    const prep = await applyDataset(csv, { source: 'demo' });
    $('dlgSettings').close();
    toast(`Exemple chargé : ${prep.db.persons.size} personnes. Cherchez « Louise ».`, { duration: 5000 });
  } catch (err) { toast(err.message); }
};

$('btnClear').onclick = async () => {
  if (!confirm('Effacer le fichier et les réglages enregistrés sur cet appareil ?')) return;
  await store.del('data');
  await store.del('config');
  try { localStorage.clear(); } catch { /* ignoré */ }
  Object.assign(state, { data: null, db: null, headers: [], rootId: null, pending: null,
    config: { url: DEFAULT_URL, clientId: DEFAULT_CLIENT_ID, autoCheck: true, mapping: null, headersSig: '' } });
  $('updateDot').hidden = true;
  hidePanel();
  $('dlgSettings').close();
  history.replaceState(null, '', location.pathname);
  refreshAll();
  toast('Données effacées.');
};

// ---------- Barre d'outils de l'arbre ----------

$('zoomIn').onclick = () => pz.zoomCenter(1.25);
$('zoomOut').onclick = () => pz.zoomCenter(0.8);
$('zoomFit').onclick = () => state.tree && pz.fit(state.tree.bbox);
$('ancDepth').onchange = (e) => { state.ancDepth = Number(e.target.value); prefs.set('anc', state.ancDepth); renderTree(true); };
$('descDepth').onchange = (e) => { state.descDepth = Number(e.target.value); prefs.set('desc', state.descDepth); renderTree(true); };

// ---------- Export ----------

function fileBase() {
  const p = state.db.get(state.rootId);
  return 'arbre-' + p.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function saveBlob(blob, filename) {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  if (isMobile && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

$('btnExport').onclick = () => $('dlgExport').showModal();
$('expSvg').onclick = async () => {
  $('dlgExport').close();
  const s = exportSvgString(state.db, state.tree);
  await saveBlob(new Blob([s], { type: 'image/svg+xml' }), fileBase() + '.svg');
};
$('expPng').onclick = async () => {
  $('dlgExport').close();
  const { w, h } = state.tree.bbox;
  const s = exportSvgString(state.db, state.tree);
  // Limite de taille des images sur iPhone (~16 millions de pixels)
  const scale = Math.min(2, Math.sqrt(16e6 / (w * h)), 16000 / w, 16000 / h);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((blob) => blob ? saveBlob(blob, fileBase() + '.png') : toast('Arbre trop grand pour une image PNG : utilisez le format SVG.'), 'image/png');
  };
  img.onerror = () => toast("Échec de la création de l'image.");
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
};

// ---------- Installation & hors ligne ----------

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('btnInstall').hidden = false; });
$('btnInstall').onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('btnInstall').hidden = true;
};

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const notify = (worker) => toast("Une nouvelle version de l'application est disponible.", {
      action: 'Recharger', duration: 0, onAction: () => worker.postMessage('skipWaiting'),
    });
    if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) notify(w); });
    });
  }).catch(() => { /* hors ligne non disponible */ });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('panel').hidden) hidePanel();
});

// ---------- Démarrage ----------

async function init() {
  const authResult = auth.handleRedirect();
  $('appVersion').textContent = `Familien ${APP_VERSION}`;
  state.ancDepth = prefs.get('anc', 99);
  state.descDepth = prefs.get('desc', 99);
  fillDepthSelect($('ancDepth'), state.ancDepth);
  fillDepthSelect($('descDepth'), state.descDepth);

  const config = await store.get('config');
  if (config) Object.assign(state.config, config);
  if (!isClientId(state.config.clientId || '')) state.config.clientId = DEFAULT_CLIENT_ID;
  const data = await store.get('data');
  if (data?.csv) {
    try {
      const prep = prepare(data.csv);
      state.data = data;
      state.headers = prep.headers;
      state.db = prep.db;
    } catch (e) { toast(e.message); }
  }
  const m = location.hash.match(/^#p=(.+)$/);
  const fromHash = m ? decodeURIComponent(m[1]) : null;
  const start = fromHash && state.db?.get(fromHash) ? fromHash : prefs.get('root', null);
  if (start && state.db?.get(start)) {
    state.rootId = start;
    history.replaceState({ id: start }, '', '#p=' + encodeURIComponent(start));
  }
  renderTree(true);
  if (authResult?.error) {
    toast(authResult.error === 'access_denied' ? 'Connexion Google annulée.' : `Échec de la connexion Google (${authResult.error}).`, { duration: 6000 });
  }
  if (authResult?.action) checkForUpdate();
  else if (!state.db) setTimeout(openSettings, 400);
  else if (state.config.url && state.config.autoCheck && navigator.onLine) checkForUpdate({ silent: true });
}

init();
