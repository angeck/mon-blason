# mypocketclub · alpha 4.4.1

Application web installable (PWA) pour les clubs sportifs : agenda avec réponses « Je viens / Je ne viens pas », appel, fiches joueurs, licences et cotisations, groupes d'échange (messages en direct, sondages), équipes, membres, corbeille de 30 jours.

- Données : Supabase (PostgreSQL, comptes, temps réel). Tous les droits sont vérifiés par la base (règles d'accès et fonctions) dans `supabase/schema.sql`.
- Interface : HTML, CSS et JavaScript, sans étape de compilation. Hébergement : GitHub Pages.
- Le nom de l'application, « mypocketclub » (toujours en minuscules), n'est écrit qu'à un endroit : `config.js` (plus `manifest.webmanifest` et `index.html`, lus à l'installation sur le téléphone).

## Fichiers

- `app.js` : affichage des écrans, aiguillage des actions, connexion, temps réel.
- `js/core.js` (état, données, droits vus à l'écran) · `js/ui.js` (logos, en-tête, onglets) · un module par partie : `auth`, `accueil`, `agenda`, `messages`, `equipe`, `joueur`, `club`, `compte`, `coach` (espace coach), `vie` (espaces, rubriques, annonces, bénévoles), `importer` (lecture des listes), `profils` (liste déroulante « Profil de test », alpha 3.3.1), `v35` (alpha 3.5.0 : vérification des heures, ordre des blocs des espaces, résultats, ententes), `v36` (cartes du coach sur l'Accueil), `v37` (alpha 3.7.0 : top 5 des équipes suivies, demandes d'ajout d'un club et page Admin), `v38` (alpha 3.8.0 : création, import et doublons d'équipes dans l'espace, e-mail de test), `v42` (alpha 4.2.0 : envoi des convocations, recherche du club reçu, suivi, versions -v2 ; 4.3.0 : plusieurs destinataires), `v43` (alpha 4.3.0 : clubs à valider, état d'envoi, encart rouge, profils de test lus dans la base, images du PDF), `v44` (alpha 4.4.0 : bandeau et onglets de chaque fonction du bureau, relance des cotisations en un geste, export des membres, passage de saison du club), `pdfmin` (petit fabricant de PDF sans dépendance, n° 112 ; images JPEG, n° 128), `v310` (alpha 3.10.0 : espace coach en deux niveaux et espace de l'équipe, espace du président en cinq onglets, « Qui s'occupe de quoi », présidence, suppression du club, paiement « bientôt »), `equipes_import` (lecture des listes d'équipes, sans dépendance). L'appel en tuiles est dans `agenda`.
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
- `tests/vie_de_club.py` : faux club complet et saison simulée, 749 vérifications des droits (visiteur non connecté compris) ;
- `tests/import.test.mjs` : lecture de listes de joueurs et d'équipes (20 tests) ;
- `tests/email.test.mjs` : fonction d'envoi des e-mails, Supabase et Resend imités (42 tests, dont l'envoi et la réservation des convocations) ;
- `tests/pdf.test.mjs` : petit fabricant de PDF (14 tests, images comprises) ;
- `tests/ecrans.py` : parcours dans un navigateur sans écran, avec le faux client `tests/faux_supabase.js` (350 tests), dont l'import des listes fictives de `tests/fichiers/` (fabriquées par `fabriquer.py`).

Toutes les personnes des tests sont fictives.

## Alpha 4.4.1

Correctif, rien à lancer dans Supabase : la liste « Profil de test » ne se chargeait plus depuis la 4.3.0 (`.catch()` sur une requête Supabase, qui n'a que `.then`). Le faux client des tests imite maintenant ce comportement.

## Alpha 4.4.0

N° 114 (suite). Mise à jour d'une base 4.3.0 : `supabase/MAJ_ALPHA_4_4_0.sql` (source `supabase/alpha_4_4_0.sql`, ajoutée au RESET), sans perte de données, relançable. **À lancer après la mise en ligne du code** : l'application 4.4.0 marche avec une base 4.3.0, pas l'inverse.

- Chaque fonction du bureau a son bandeau et ses onglets dans l'en-tête (`js/v44.js`) : Trésorier (Cotisations, Tarifs, Heures des coachs), Secrétaire (Licences, Fiches, Import / export), Correspondant licences, Correspondant rencontres (Rencontres, Convocations, Bénévoles, Contact), Directeur technique (Équipes, Coachs, Exercices, Ententes), Communication (Annonces, Lecteurs), personne désignée pour les Événements ; les rubriques ouvertes en plus sont dans un onglet « Rubriques ». Le vice-président, le membre du bureau et le sponsoring gardent la présentation d'avant.
- Base : le Secrétariat et le correspondant licences ne lisent plus les montants (`club_licences`, `set_licence`) ; « cotisation à jour » (oui / non) si le président l'active (`clubs.secretary_sees_fees`). Les coordonnées des fiches ne se lisent plus dans la table `players` mais par `player_contacts` ; le président peut les masquer au Directeur technique (`clubs.tech_sees_contacts`, aussi dans `phones_for`).
- Exports journalisés : `export_members` (président, secrétaire, secrétaire adjoint), `log_export` (cotisations du trésorier). Relance des cotisations en un geste : `remind_fees`. Passage de saison du club : `renew_club_season` (président).

## Alpha 4.3.0

Audit de sécurité du 5 novembre 2026. Mise à jour d'une base 4.2.0 : `supabase/MAJ_ALPHA_4_3_0.sql` (source `supabase/alpha_4_3_0.sql`, ajoutée au RESET), sans perte de données, relançable. **Puis redéployer la fonction `envoyer-email`.** Base de test seulement : `supabase/VALIDER_CLUBS_DE_TEST.sql` valide d'office les présidents de Boissy et de Lardy.
**Règle pour toutes les mises à jour suivantes** : finir chaque script par `select close_visitor_functions();` (Supabase ouvre chaque nouvelle fonction au visiteur non connecté ; la fonction ne lui laisse que la recherche, la page publique, la demande de club et les fonctions des règles d'accès).
N° 123 (S2) : `delete_announcement`, `trash_exercise` et `remind_event` refusent le visiteur et l'inconnu (correctif du 5 novembre repris dans le script).
N° 124 (S1) : envoi des convocations (e-mail et dans mypocketclub) réservé aux personnes validées : le président par l'administrateur (`sender_validations`, écran « Clubs à valider » dans Mon compte › Administration, motif payé / devis / gratuité / test et date de fin), les autres personnes de la rubrique Événements par l'attribution d'un président validé ; la validation suit la personne (effacée quand elle n'est plus présidente, administrateur prévenu d'un nouveau président) ; `envoyer-email` réserve chaque e-mail dans la base (`convocation_reserve`, ligne « en cours », limite de 20 par club et 80 en tout par jour, toutes les tentatives comptent) avant d'appeler Resend, puis `convocation_finish` ; `convocation_record` n'accepte plus les e-mails ; boutons grisés pour un compte non validé (le PDF reste libre) ; fin d'une année payée ou d'une gratuité : encart rouge sur l'Accueil (`my_send_state`), pas de blocage.
N° 125 (S3) : nom des missions par défaut échappé (`js/vie.js`).
N° 126 (S4) : fonctions fermées au visiteur (`close_visitor_functions`, dont `due_for`, `grid_for`, `member_rank`) ; liste des profils de test rangée dans la base (`test_profiles`, `my_test_profiles`), plus aucune adresse dans `config.js` ; Turnstile et copie locale des bibliothèques : pas encore.
N° 127 : rencontre en semaine : « cette semaine, le jeudi 5 novembre 2026 » (semaine de l'envoi), sinon « le jeudi 12 novembre 2026 » ; samedi-dimanche : « le week-end du … » (e-mail, PDF joint, document imprimé).
N° 128 : PDF joint avec le blason du club (ou le ballon du sport sans logo) et le vrai logo mypocketclub (`img/logo-mypocketclub.svg`), dessinés en JPEG dans le navigateur.
N° 129 : plusieurs destinataires (dans mypocketclub, par e-mail, ou PDF envoyé à la main, noté dans le suivi), plus de champ « Club reçu », « Envoyer à tous » avec récapitulatif, un e-mail par destinataire, une seule copie au choix, contact masqué « Jean D. · j***@club.fr » dans le suivi.
Tests rendus indépendants du jour (heures des coachs : n° 75 et export Excel).

## Alpha 4.2.0

Mise à jour d'une base 4.1.0 (même base que la 3.10.0) : `supabase/MAJ_ALPHA_4_2_0.sql` (source `supabase/alpha_4_2_0.sql`, ajoutée au RESET), sans perte de données, relançable. **Puis redéployer la fonction `envoyer-email`** (Edge Functions → envoyer-email → coller `supabase/functions/envoyer-email/index.ts` → Deploy) : elle envoie maintenant les convocations.
Bugs : n° 118 (les joueurs de l'onglet Effectif ouvrent leur fiche), n° 119 (plus de seconde ligne « Commun » sans nom chez le secrétaire : la sous-rubrique « licences » n'a pas de ligne à part), n° 120 (sans choix enregistré, la fonction du bureau s'ouvre avant la casquette « Coach » ; profil de test « Directeur technique »).
N° 117 : « Masquer » à côté de « Équipe en entente » (par équipe, pour tous ses coachs ; « Réafficher » dans les réglages de l'équipe). N° 121 : l'espace Communication ne montre que les annonces de la personne (et leurs lecteurs). N° 114 : « Qui s'occupe de quoi » devient « Fonctions » ; les touchers sur « Payer · Bientôt disponible » sont comptés (Mon compte → Administration). N° 80 : « Ajouter mes séances du mois » reprend la durée de chaque rendez-vous.
N° 122 : le contact du club suit la fonction attribuée (licences : la personne désignée, sinon le correspondant licences, sinon le secrétaire, sinon le président ; rencontres : la personne désignée, sinon le correspondant rencontres, sinon le président) ; coordonnées montrées seulement si la personne les a confirmées pour ses fonctions du moment (Mon compte, encart jaune sur l'Accueil ; une nouvelle fonction demande une nouvelle confirmation) ; « Écrire au correspondant » par l'application (au plus 5 nouvelles conversations par jour) ; qui voit quoi : membres hors supporteurs = le bureau, supporteurs et visiteurs connectés = le contact licences, clubs du même sport = aussi le correspondant rencontres, club hors recherche = rien à l'extérieur ; cases « Contact pour… » retirées ; le correspondant des convocations est le correspondant rencontres.
N° 109, 112, 107 : écran de la convocation : chercher le club reçu ; trouvé → envoi dans mypocketclub (le club reçu est prévenu, l'ouverture vaut accusé de lecture) ; pas trouvé → fenêtre e-mail (Madame ou Monsieur, prénom, nom, e-mail), PDF fabriqué dans l'application et joint, expéditeur « club + catégories » depuis notifications@, réponses et copie à la personne qui envoie, contact non gardé (adresse masquée dans le suivi) ; document modifié après un envoi = « Mise à jour » et référence -v2 ; suivi des envois du week-end (envoyé, lu, échec) avec « Renvoyer », personne prévenue d'un échec ; limite de 20 e-mails par club et 80 en tout par jour (Resend gratuit : 100).

## Alpha 4.1.0

Rien à lancer dans Supabase (aucun changement de la base) ; mise à jour de l'écran seulement.
N° 116 : un seul bloc bleu dans les espaces : en-tête (retour, logo, loupe, Mon compte), puis qui (blason, équipe ou rôle, « club · saison »), puis la rangée des casquettes, puis les onglets de l'espace (Pointer · Planifier · Préparer · Stats · Effectif pour une équipe, Vue d'ensemble · Demandes · Qui s'occupe de quoi · Réglages · Journal pour le président) ; plus de carte bleue de l'équipe dans la page (le blason, le club et l'équipe ne sont dits qu'une fois) ; casquette ouverte en jaune ; plus de phrase « Tes casquettes · touche pour changer d'espace » ; « Ouvrir … par défaut ? » devient une ligne en bas de page ; « Mes heures » et « Mes exercices » sous le contenu de l'onglet ; un appel ouvert depuis l'Agenda ou l'Accueil est une page de l'équipe (onglets dans l'en-tête). Président : plus de « Rubriques » (doublon du dépliant « Bureau »), ni de carte « demandes à valider » (doublon de la tuile du bandeau) ; « Créer une équipe », l'import et les doublons dans le dépliant « Équipes » ; la corbeille du club dans Réglages, zone sensible.

## Alpha 3.10.0

Mise à jour d'une base 3.9.0 : `supabase/MAJ_ALPHA_3_10_0.sql` (source `supabase/alpha_3_10_0.sql`, ajoutée au RESET), sans perte de données, relançable.
N° 113 : une seule casquette « Coach » ; avec plusieurs équipes, l'« Espace coach » liste les équipes (cartes), « À faire », « Mes exercices », « Mes heures » ; une équipe ouvre son espace avec un bandeau et cinq onglets toujours visibles : Pointer · Planifier · Préparer · Stats · Effectif (« Programme » retiré) ; coach d'une seule équipe : l'espace de l'équipe directement. Fiche joueur et boutons de l'équipe modifiables dans l'espace (onglet Effectif) ; ouverts depuis un onglet du bas, en lecture seule avec « Gérer dans l'espace de l'équipe ». Le bouton de rôle ouvre la vue choisie par défaut (encart « Garder par défaut » au changement de rôle), sinon le dernier espace.
N° 114 : « Coordinateur » devient « Correspondant rencontres » (rubrique Événements seulement), « Directeur sportif » devient « Directeur technique », « Correspondant licences » n'a plus que les licences (sous-rubrique `licences`) ; espace du président : bandeau, dépliants « Bureau » (espace de chaque fonction, actions à son nom) et « Équipes », onglets Vue d'ensemble · Demandes · Qui s'occupe de quoi · Réglages · Journal ; désignations (`club_designations`, `set_designation`) ; fonctions réservées aux adultes, personne prévenue à l'attribution et au retrait ; état de licence modifiable par la trésorerie ; blason et informations du club réservés au président et au vice-président ; transfert de la présidence accepté par le nouveau président (`offer_presidency`, `answer_presidency`) ; suppression du club en corbeille 30 jours, nom à taper (`delete_club`, `restore_club`).
N° 115 : « Payer ma cotisation · Bientôt disponible » (fiche de l'enfant ou du joueur) et « Paiement en ligne · Bientôt » (trésorerie), sans action.

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
