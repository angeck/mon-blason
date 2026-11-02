# Pocket Club (nom provisoire) · alpha 3.6.0

Application web installable (PWA) pour les clubs sportifs : agenda avec réponses « Je viens / Je ne viens pas », appel, fiches joueurs, licences et cotisations, groupes d'échange (messages en direct, sondages), équipes, membres, corbeille de 30 jours.

- Données : Supabase (PostgreSQL, comptes, temps réel). Tous les droits sont vérifiés par la base (règles d'accès et fonctions) dans `supabase/schema.sql`.
- Interface : HTML, CSS et JavaScript, sans étape de compilation. Hébergement : GitHub Pages.
- Le nom de l'application n'est écrit qu'à un endroit : `config.js` (plus `manifest.webmanifest`, lu à l'installation sur le téléphone).

## Fichiers

- `app.js` : affichage des écrans, aiguillage des actions, connexion, temps réel.
- `js/core.js` (état, données, droits vus à l'écran) · `js/ui.js` (logos, en-tête, onglets) · un module par partie : `auth`, `accueil`, `agenda`, `messages`, `equipe`, `joueur`, `club`, `compte`, `coach` (espace coach), `vie` (espaces, rubriques, annonces, bénévoles), `importer` (lecture des listes), `profils` (liste déroulante « Profil de test », alpha 3.3.1), `v35` (alpha 3.5.0 : vérification des heures, ordre des blocs des espaces, résultats, ententes). L'appel en tuiles est dans `agenda`.
- `js/vendor/xlsx.bundle.js` : lecture et écriture Excel (xlsx-js-style 1.2.0, licence Apache 2.0, copie locale pour ne pas dépendre d'un CDN).
- `style.css` : styles Pocket Club, d'après les jetons de la charte (`04-jetons-design.css` du projet).
- `supabase/schema.sql` (3.0), puis `alpha_3_0_1.sql`, `alpha_3_0_2.sql`, `alpha_3_1.sql`, `alpha_3_2.sql`, `alpha_3_2_1.sql` et `alpha_3_2_4.sql` (mises à jour). `supabase/build_reset.sh` fabrique `RESET_ALPHA_3_0.sql` (efface tout, comptes compris, puis installe tout), `MAJ_ALPHA_3_2.sql` et `MAJ_ALPHA_3_2_4.sql` (mises à jour sans perte).

## Installation (une fois)

1. Supabase → SQL Editor → coller `supabase/RESET_ALPHA_3_0.sql` → *Run*. **Efface toutes les données et tous les comptes.**
2. Supabase → Authentication → Sign In / Providers → Email : mot de passe de 8 caractères minimum.
3. Supabase → Authentication → URL Configuration → *Site URL* = `https://angeck.github.io/mon-blason/`.
4. GitHub → Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Tests (jamais sur la base réelle)

`PGHOST=… PGPORT=… PGUSER=postgres sh tests/lancer.sh` : base PostgreSQL 16 locale (`tests/prelude.sql` imite Supabase), puis
- `tests/vie_de_club.py` : faux club complet et saison simulée, 566 vérifications des droits (visiteur non connecté compris) ;
- `tests/import.test.mjs` : lecture de listes de joueurs (14 tests) ;
- `tests/ecrans.py` : parcours dans un navigateur sans écran, avec le faux client `tests/faux_supabase.js` (216 tests), dont l'import des listes fictives de `tests/fichiers/` (fabriquées par `fabriquer.py`).

Toutes les personnes des tests sont fictives.

## Alpha 3.6.0

Mise à jour d'une base 3.5.0 : `supabase/MAJ_ALPHA_3_6_0.sql` (source `supabase/alpha_3_6_0.sql`, ajoutée au RESET), sans perte de données, relançable. N° 82 à 92 : taux horaire des coachs, pièces jointes et transfert des messages, espaces sans logo et rangée des rôles visible, formulaire d'exercice avec tags et demandes de schéma, refonte de l'arborescence (gestion du club dans l'Espace, cartes du coach sur l'Accueil), « Tout le club » avec ou sans les supporteurs, écran d'ouverture avec le grand logo, ballons par sport et icône 4/4, nom « pocket club », blason du club sur les convocations. Ballons et icônes : `img/` et `tools/fabriquer_logos.py` ; la refonte est dans `js/v36.js`, `js/club.js` (page « Gestion du club ») et `js/coach.js`.

## Alpha 3.5.1

Pas de changement de base : aucun script Supabase à lancer. Nouvelle icône de l'application : ballon multisport seul sur carré bleu #2F5BFF, sans texte (icônes any, maskable avec le ballon dans la zone sûre, apple-touch-icon). Livrée sans relancer les tests.

## Alpha 3.5.0

Mise à jour d'une base 3.4.2 : `supabase/MAJ_ALPHA_3_5_0.sql` (source `supabase/alpha_3_5_0.sql`, ajoutée au RESET), sans perte de données, relançable. Nouveau look (logo empilé et ballon multisport, plus de p●c), appel en tuiles (n° 81), n° 75 à 80.
