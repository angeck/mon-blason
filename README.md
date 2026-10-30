# Pocket Club (nom provisoire) · alpha 3.0.2

Application web installable (PWA) pour les clubs sportifs : agenda avec réponses « Je viens / Je ne viens pas », appel, fiches joueurs, licences et cotisations, groupes d'échange (messages en direct, sondages), équipes, membres, corbeille de 30 jours.

- Données : Supabase (PostgreSQL, comptes, temps réel). Tous les droits sont vérifiés par la base (règles d'accès et fonctions) dans `supabase/schema.sql`.
- Interface : HTML, CSS et JavaScript, sans étape de compilation. Hébergement : GitHub Pages.
- Le nom de l'application n'est écrit qu'à un endroit : `config.js` (plus `manifest.webmanifest`, lu à l'installation sur le téléphone).

## Fichiers

- `app.js` : affichage des écrans, aiguillage des actions, connexion, temps réel.
- `js/core.js` (état, données, droits vus à l'écran) · `js/ui.js` (logos, en-tête, onglets) · un module par partie : `auth`, `accueil`, `agenda`, `messages`, `equipe`, `joueur`, `club`, `compte`, `importer` (lecture des listes).
- `js/vendor/xlsx.bundle.js` : lecture et écriture Excel (xlsx-js-style 1.2.0, licence Apache 2.0, copie locale pour ne pas dépendre d'un CDN).
- `style.css` : styles Pocket Club, d'après les jetons de la charte (`04-jetons-design.css` du projet).
- `supabase/schema.sql` (3.0), puis `alpha_3_0_1.sql` et `alpha_3_0_2.sql` (mises à jour). `supabase/build_reset.sh` fabrique `RESET_ALPHA_3_0.sql` (efface tout, comptes compris, puis installe tout) et `MAJ_ALPHA_3_0_2.sql` (mise à jour sans perte).

## Installation (une fois)

1. Supabase → SQL Editor → coller `supabase/RESET_ALPHA_3_0.sql` → *Run*. **Efface toutes les données et tous les comptes.**
2. Supabase → Authentication → Sign In / Providers → Email : mot de passe de 8 caractères minimum.
3. Supabase → Authentication → URL Configuration → *Site URL* = `https://angeck.github.io/mon-blason/`.
4. GitHub → Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Tests (jamais sur la base réelle)

`PGHOST=… PGPORT=… PGUSER=postgres sh tests/lancer.sh` : base PostgreSQL 16 locale (`tests/prelude.sql` imite Supabase), puis
- `tests/vie_de_club.py` : faux club complet et saison simulée, 212 vérifications des droits (visiteur non connecté compris) ;
- `tests/import.test.mjs` : lecture de listes de joueurs (14 tests) ;
- `tests/ecrans.py` : parcours dans un navigateur sans écran, avec le faux client `tests/faux_supabase.js` (80 tests), dont l'import des listes fictives de `tests/fichiers/` (fabriquées par `fabriquer.py`).

Toutes les personnes des tests sont fictives.
