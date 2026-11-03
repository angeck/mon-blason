# mypocketclub · alpha 3.9.0

Application web installable (PWA) pour les clubs sportifs : agenda avec réponses « Je viens / Je ne viens pas », appel, fiches joueurs, licences et cotisations, groupes d'échange (messages en direct, sondages), équipes, membres, corbeille de 30 jours.

- Données : Supabase (PostgreSQL, comptes, temps réel). Tous les droits sont vérifiés par la base (règles d'accès et fonctions) dans `supabase/schema.sql`.
- Interface : HTML, CSS et JavaScript, sans étape de compilation. Hébergement : GitHub Pages.
- Le nom de l'application, « mypocketclub » (toujours en minuscules), n'est écrit qu'à un endroit : `config.js` (plus `manifest.webmanifest` et `index.html`, lus à l'installation sur le téléphone).

## Fichiers

- `app.js` : affichage des écrans, aiguillage des actions, connexion, temps réel.
- `js/core.js` (état, données, droits vus à l'écran) · `js/ui.js` (logos, en-tête, onglets) · un module par partie : `auth`, `accueil`, `agenda`, `messages`, `equipe`, `joueur`, `club`, `compte`, `coach` (espace coach), `vie` (espaces, rubriques, annonces, bénévoles), `importer` (lecture des listes), `profils` (liste déroulante « Profil de test », alpha 3.3.1), `v35` (alpha 3.5.0 : vérification des heures, ordre des blocs des espaces, résultats, ententes), `v36` (cartes du coach sur l'Accueil), `v37` (alpha 3.7.0 : top 5 des équipes suivies, demandes d'ajout d'un club et page Admin), `v38` (alpha 3.8.0 : création, import et doublons d'équipes dans l'espace, e-mail de test), `equipes_import` (lecture des listes d'équipes, sans dépendance). L'appel en tuiles est dans `agenda`.
- `js/vendor/xlsx.bundle.js` : lecture et écriture Excel (xlsx-js-style 1.2.0, licence Apache 2.0, copie locale pour ne pas dépendre d'un CDN).
- `style.css` : styles mypocketclub, d'après les jetons de la charte (`04-jetons-design.css` du projet).
- `supabase/schema.sql` (3.0), puis `alpha_3_0_1.sql`, `alpha_3_0_2.sql`, `alpha_3_1.sql`, `alpha_3_2.sql`, `alpha_3_2_1.sql` et `alpha_3_2_4.sql` (mises à jour). `supabase/build_reset.sh` fabrique `RESET_ALPHA_3_0.sql` (efface tout, comptes compris, puis installe tout), `MAJ_ALPHA_3_2.sql` et `MAJ_ALPHA_3_2_4.sql` (mises à jour sans perte).

## Installation (une fois)

1. Supabase → SQL Editor → coller `supabase/RESET_ALPHA_3_0.sql` → *Run*. **Efface toutes les données et tous les comptes.**
2. Supabase → Authentication → Sign In / Providers → Email : mot de passe de 8 caractères minimum.
3. Supabase → Authentication → URL Configuration → *Site URL* = `https://angeck.github.io/mon-blason/`.
4. GitHub → Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Tests (jamais sur la base réelle)

`PGHOST=… PGPORT=… PGUSER=postgres sh tests/lancer.sh` : base PostgreSQL 16 locale (`tests/prelude.sql` imite Supabase), puis
- `tests/vie_de_club.py` : faux club complet et saison simulée, 596 vérifications des droits (visiteur non connecté compris) ;
- `tests/import.test.mjs` : lecture de listes de joueurs et d'équipes (20 tests) ;
- `tests/email.test.mjs` : fonction d'envoi des e-mails, Supabase et Resend imités (18 tests) ;
- `tests/ecrans.py` : parcours dans un navigateur sans écran, avec le faux client `tests/faux_supabase.js` (288 tests), dont l'import des listes fictives de `tests/fichiers/` (fabriquées par `fabriquer.py`).

Toutes les personnes des tests sont fictives.

## Alpha 3.9.0

Mise à jour d'une base 3.8.0 : `supabase/MAJ_ALPHA_3_9_0.sql` (source `supabase/alpha_3_9_0.sql`, ajoutée au RESET), sans perte de données, relançable.
N° 108 : case « Match à domicile » encadrée, visible dès qu'on choisit un match, un plateau ou un tournoi, quel que soit le rôle ; quand un coach (sans la rubrique Événements) crée un match à domicile ou coche la case après coup, le coordinateur, le vice-président et le président reçoivent une notification « Match à domicile à convoquer » ; carte « Matchs à domicile à convoquer » (30 prochains jours) dans la rubrique Événements. N° 109 : documents de convocation avec la catégorie et le genre (« U9 F »), jamais le nom interne de l'équipe ; écran d'envoi avec trois façons (PDF prêt, e-mail et envoi dans mypocketclub annoncés « bientôt ») et expéditeur prévu « nom du club + catégories » ; règle de l'expéditeur et de l'adresse de réponse (correspondant, sinon contact@) prête dans `envoyer-email` (`senderName`, `convocationEnvelope`), pas encore branchée. N° 111 : titre du rendez-vous écrit tout seul (« Match vs Palaiseau - 10/11/26 », « Entraînement U9 F - chaque mercredi 18h00 »), modifiable, avec « Revenir au titre automatique » ; adversaire, date et équipe avant le titre.
N° 110 · purge à lancer une fois, à part : `supabase/PURGE_MESSAGES_RENDEZ_VOUS.sql` efface tous les rendez-vous (entraînements et séries compris, réponses, appels, missions, séances liées), les heures des coachs, tous les messages (groupes, sondages, annonces, pièces jointes) et les notifications en attente ; garde clubs, comptes, équipes et créneaux, joueurs, rôles, exercices. **Irréversible.**

## Alpha 3.8.0

Mise à jour d'une base 3.7.0 : `supabase/MAJ_ALPHA_3_8_0.sql` (source `supabase/alpha_3_8_0.sql`, ajoutée au RESET), sans perte de données, relançable : une équipe part à la corbeille aussi par le bureau qui a la rubrique Technique (n° 103).
N° 98 : icône « cible » du directeur sportif. N° 99 : en-tête de l'espace sans pastille du rôle, casquette ouverte en bleu. N° 100 : une casquette par équipe pour un coach de plusieurs équipes (clé `coach:<équipe>`), espace limité à l'équipe ouverte. N° 101 : création d'équipe dans l'espace (Président, rubrique Technique), plus de création ni de carte « Gestion du club » dans l'onglet Club ; pages ouvertes en haut, rappel du rôle (« Espace Bureau · Trésorier »), le bouton Retour retrouve la position. N° 102 : « Importer des équipes » (Excel, CSV, liste collée, photo lue dans le téléphone) avec aperçu, cases douteuses en orange, équipes en mode fantôme, équipe déjà présente jamais doublée. N° 103 : « Supprimer (doublon) » (corbeille 30 jours) et doublons possibles signalés dans l'espace. N° 104 : sur ordinateur, bloc « Mes rôles » sous les onglets. N° 106 : ballon de la marque « étoile creuse » (`img/ballon-mypocketclub-etoile.svg`), icônes refaites par `tools/fabriquer_logos.py`, ballon médecine retiré. Contact `contact@mypocketclub.fr` et site `mypocketclub.fr` (mentions légales, Mon compte, accueil public) : `config.js`.
N° 107 · e-mails depuis notifications@mypocketclub.fr : fonction `supabase/functions/envoyer-email/index.ts`, pour l'instant un e-mail de test réservé à l'administrateur (Mon compte → Administration). Mise en place : Supabase → Edge Functions → Secrets : `RESEND_API_KEY` (clé Resend, jamais dans le dépôt) ; puis Edge Functions → Deploy a new function → Via Editor, nom `envoyer-email`, coller le fichier, garder « Verify JWT » activé.

## Alpha 3.7.0

Mise à jour d'une base 3.6.0 : `supabase/MAJ_ALPHA_3_7_0.sql` (source `supabase/alpha_3_7_0.sql`, ajoutée au RESET), sans perte de données, relançable. N° 93 : onglet Équipe avec une seule liste par rôle (coach : « Joueurs » en noms complets et chiffres de l'effectif en une ligne ; parent et joueur : « Prénom N. » ; bureau : rubrique « Effectifs » de la gestion du club ; supporteur sans équipe : « Tu veux commencer à suivre une équipe ? », équipes du club et top 5 des équipes les plus suivies dès 10 équipes visibles). N° 94 : « N demandes à valider » de l'Accueil et « Voir » de l'espace Président ouvrent directement la gestion du club. N° 95 : « Ajouter des joueurs » dans les espaces (coach, président, bureau Technique ou Secrétariat) et sur la fiche de l'équipe, plus dans l'onglet Équipe. N° 96 : « Mon club n'est pas dans la liste » (version test, sans e-mail) et page Admin. N° 97 : nom et charte mypocketclub (logo « my » en étiquette, ballons jaune et encre, ballon médecine, icône et favicon) ; fichiers dans `img/`, icônes PNG fabriquées par `tools/fabriquer_logos.py`.

## Alpha 3.6.0

Mise à jour d'une base 3.5.0 : `supabase/MAJ_ALPHA_3_6_0.sql` (source `supabase/alpha_3_6_0.sql`, ajoutée au RESET), sans perte de données, relançable. N° 82 à 92 : taux horaire des coachs, pièces jointes et transfert des messages, espaces sans logo et rangée des rôles visible, formulaire d'exercice avec tags et demandes de schéma, refonte de l'arborescence (gestion du club dans l'Espace, cartes du coach sur l'Accueil), « Tout le club » avec ou sans les supporteurs, écran d'ouverture avec le grand logo, ballons par sport et icône 4/4, nom « pocket club », blason du club sur les convocations. Ballons et icônes : `img/` et `tools/fabriquer_logos.py` ; la refonte est dans `js/v36.js`, `js/club.js` (page « Gestion du club ») et `js/coach.js`.

## Alpha 3.5.1

Pas de changement de base : aucun script Supabase à lancer. Nouvelle icône de l'application : ballon multisport seul sur carré bleu #2F5BFF, sans texte (icônes any, maskable avec le ballon dans la zone sûre, apple-touch-icon). Livrée sans relancer les tests.

## Alpha 3.5.0

Mise à jour d'une base 3.4.2 : `supabase/MAJ_ALPHA_3_5_0.sql` (source `supabase/alpha_3_5_0.sql`, ajoutée au RESET), sans perte de données, relançable. Nouveau look (logo empilé et ballon multisport, plus de p●c), appel en tuiles (n° 81), n° 75 à 80.
