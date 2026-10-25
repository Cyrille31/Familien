# Familien

<img src="icons/logo.svg" width="96" align="right" alt="Logo Familien">

Application d'arbre généalogique qui fonctionne sur **iPhone, Android et PC**, à partir d'un fichier brut de généalogie dans **Google Sheets**.

Tapez le nom d'une personne : Familien affiche son **arbre complet**, avec tous ses **ascendants** (au-dessus) et tous ses **descendants** avec leurs conjoints (en dessous).

## Fonctionnement

- **Local d'abord** : le fichier est enregistré sur l'appareil. L'application fonctionne ensuite **sans connexion**.
- **Le Drive n'est contacté que sur demande** : bouton « Drive » en haut, ou vérification au démarrage (option désactivable dans les réglages).
- **Alerte de modification** : si le fichier a changé sur le Drive, une alerte indique combien de personnes ont été ajoutées / modifiées / supprimées, et vous **acceptez ou non** la mise à jour. Si vous refusez, un point orange rappelle qu'une nouvelle version existe.
- Fiche de chaque personne (dates, lieux, profession, notes, parents, conjoints, enfants, frères et sœurs) en touchant sa case.
- Zoom au doigt (pincer) ou à la molette, nombre de générations réglable, export de l'arbre en image PNG ou SVG (pour imprimer).
- Thème clair / sombre automatique.

## Préparer le fichier Google Sheets

1. Une ligne par personne ; la première ligne contient les titres des colonnes.
2. Les colonnes sont **reconnues automatiquement** (titres en français ou en anglais) et peuvent être corrigées dans les réglages :

| Colonne | Exemples de titres reconnus |
|---|---|
| Identifiant | `ID`, `N°`, `Numéro`, `Réf` |
| Prénom / Nom | `Prénom`, `Nom`, ou `Nom complet` |
| Sexe | `Sexe`, `Genre` (H/M/F, Homme/Femme) |
| Naissance / Décès | `Date de naissance`, `Lieu de naissance`, `Décès`, `Lieu de décès` |
| Parents | `Père`, `Mère` (ou `Parents`) |
| Conjoint(s) | `Conjoint`, `Époux`, `Épouse` (plusieurs séparés par `;`) |
| Enfants (facultatif) | `Enfants` |
| Autres | `Profession`, `Notes`… toutes les autres colonnes sont affichées dans la fiche |

Les colonnes Père / Mère / Conjoint peuvent contenir **l'identifiant** de la personne (recommandé) ou son **nom complet** (« Jean Martin »).
Voir le fichier [`exemple.csv`](exemple.csv).

3. Partage : **Partager → Accès général → Tous les utilisateurs disposant du lien (Lecteur)**, puis copier le lien et le coller dans les réglages de l'application.
   Pour un onglet précis, ouvrez cet onglet avant de copier le lien.

> ⚠️ Le fichier doit être une vraie feuille **Google Sheets**. Pour un fichier Excel simplement déposé sur le Drive : l'ouvrir puis *Fichier → Enregistrer au format Google Sheets*.
> Toute personne ayant le lien peut lire le fichier : ne le diffusez qu'à la famille.

## Installer l'application

L'application est publiée par GitHub Pages (voir ci-dessous). Ouvrez son adresse puis :

- **iPhone / iPad** : dans Safari, bouton Partager → **Sur l'écran d'accueil**.
- **Android** : dans Chrome, menu ⋮ → **Installer l'application**.
- **PC / Mac** : icône d'installation dans la barre d'adresse (Chrome, Edge), ou simple favori.

Sur iPhone, installez-la sur l'écran d'accueil : sinon Safari peut effacer les données d'un site non visité depuis longtemps.

## Publication (GitHub Pages)

Le workflow `.github/workflows/pages.yml` publie l'application à chaque mise à jour de la branche `main`.
À faire une seule fois : **Settings → Pages → Source : GitHub Actions**.
L'adresse sera `https://<utilisateur>.github.io/Familien/`.

Pour tester sur un ordinateur : `python3 -m http.server` dans le dossier, puis ouvrir http://localhost:8000.

## Technique

Application web progressive (PWA) sans dépendance ni compilation : HTML, CSS et JavaScript (modules ES).

- `js/sheets.js` : téléchargement du fichier (export CSV de Google Sheets) et empreinte SHA-256 pour détecter les changements
- `js/model.js` : détection des colonnes, construction des liens familiaux, comparaison de versions
- `js/tree.js` : mise en page compacte de l'arbre, dessin SVG, zoom/déplacement tactile, export
- `js/storage.js` : enregistrement local (IndexedDB)
- `sw.js` : service worker pour le fonctionnement hors ligne (augmenter `VERSION` à chaque modification)
