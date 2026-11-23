// mypocketclub · alpha 4.9.0 · n° 175 et n° 180 : mentions légales, « Vos données » (version courte et politique complète),
// conditions d'utilisation. Textes de claude/15-textes-juridiques.md, 15b et 15c (version de test 1.5 du 13 novembre 2026 : n° 229, toutes les données gardées ;
// n° 230, coordonnées par fonction ; lot e-mails 1 ; conditions 1.3 : gratuité ; 1.6 du 13 novembre 2026 : n° 162, recommandations,
// n° 187, journal des actions à 1 an ; 1.9 (5.17.0) : n° 257, e-mail « demande validée » sans notification ; n° 254, gymnases du club ; 1.7 (5.13.0) : n° 236, un seul chemin « recommander mon club », coordonnées facultatives ; conditions inchangées) ; 1.10 (bêta 1.2.2) : dictée du navigateur (n° 265), licence et cotisation visibles du parent (n° 264), lieu de la base selon le site,
// non relus par un juriste. Vouvoiement. Changer LEGAL.version et LEGAL.date (et CGU_VERSION dans config.js
// pour les conditions) à chaque modification : une nouvelle version des conditions est présentée à la connexion suivante.
import { BRAND, IS_PROD } from '../config.js';
// bêta 1.2.2 : lieu de la base selon le site (vrai site : projet « mpc » à Paris ; site de test : « mpc-test » en Irlande)
const LIEU = IS_PROD ? 'France, à Paris' : 'Irlande';
import { esc } from './core.js';

export const LEGAL = { version: '1.14', date: '23 novembre 2026' }; // 1.14 (bêta 1.7.2) : toutes les pages légales alignées sur les bêtas 1.7.0 et 1.7.1 (version courte, conditions 1.4) ; 1.13 (bêta 1.7.1) : groupe d'équipe commun d'une entente (n° 78), joueur en prêt (n° 293) ; 1.12 (bêta 1.7.0) : signalement d'un problème (n° 292), contact du coach dans la convocation (n° 295) ; 1.11 (bêta 1.6.0) : équipe en entente vue des deux clubs (n° 78)
const C = BRAND.contact;

// Petit format de texte : « ## » titre de carte, « - » puce, « | a | b | » ligne de tableau, **gras**, lien mailto pour l'adresse de contact.
function md(src) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replaceAll(esc(C), `<a href="mailto:${esc(C)}">${esc(C)}</a>`).replace(/\bcnil\.fr\b/g, '<a href="https://www.cnil.fr" target="_blank" rel="noopener">cnil.fr</a>');
  const cards = []; let cur = null, list = null, tab = null;
  const close = () => { if (list) { cur.push(`<ul class="note legal-ul">${list.join('')}</ul>`); list = null; } if (tab) { cur.push(`<div class="list legal-tab">${tab.join('')}</div>`); tab = null; } };
  for (const raw of src.trim().split('\n')) {
    const l = raw.trim();
    if (l.startsWith('## ')) { close(); cur = [`<h3>${inline(l.slice(3))}</h3>`]; cards.push(cur); continue; }
    if (!cur) { cur = []; cards.push(cur); }
    if (!l) { close(); continue; }
    if (l.startsWith('- ')) { if (tab) close(); (list = list || []).push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (l.startsWith('|')) { if (list) close(); const [a, b] = l.split('|').slice(1, 3).map((x) => x.trim()); (tab = tab || []).push(`<div class="row static"><span class="g"><b>${inline(a)}</b><small>${inline(b)}</small></span></div>`); continue; }
    close(); cur.push(`<p class="note legal-p">${inline(l)}</p>`);
  }
  close();
  return cards.map((c) => `<div class="card">${c.join('')}</div>`).join('');
}
const stamp = (t) => `<p class="note legal-v">${esc(t)} · version ${LEGAL.version} du ${LEGAL.date} · version de test, non relue par un juriste.</p>`;

// ---------- 1. Mentions légales ----------
const MENTIONS = `
## Éditeur
mypocketclub est édité par Gaël Raveneau, particulier. Le service est en phase de test ; aucune société n'est encore créée.
Contact : ${C}
Directeur de la publication : Gaël Raveneau.
## Hébergement
- Pages de l'application : GitHub Pages, GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis.
- Base de données et fichiers : Supabase, Inc. ; les données sont stockées dans l'Union européenne (${LIEU}).
- Nom de domaine : OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.
## Version de test
Le service est fourni gratuitement pendant le test. Il peut évoluer, être interrompu ou comporter des erreurs. Merci de nous les signaler à ${C}.
## Propriété intellectuelle
Le nom mypocketclub, le logo, les textes, les écrans et le code sont protégés. Tous droits réservés. Le nom et le logo de chaque club restent la propriété du club.
## Signaler un contenu
Pour signaler un message, un exercice ou tout contenu qui pose problème : ${C}. Nous répondons au plus vite et retirons ce qui doit l'être.
## Données personnelles
Voir la page « Vos données ».`;

// ---------- 2. Vos données, en bref ----------
const SHORT = `
## Qui s'occupe de vos données ?
- **Votre club** décide des informations qu'il gère sur ses membres (équipes, présences, cotisations). Il en est responsable.
- **mypocketclub** (Gaël Raveneau) fournit l'application au club et gère votre compte (connexion, sécurité). Contact : ${C}.
## Quelles données ?
- Votre compte : nom, prénom, e-mail, téléphone si vous le donnez, mot de passe (chiffré), appareils utilisés pour vous connecter.
- Votre place dans le club : rôle, équipe, lien entre un parent et son enfant.
- La fiche d'un joueur : nom, prénom, date de naissance, équipe ; e-mail et téléphone d'un parent et contact d'urgence si le club les note ; autorisations (rentrer seul, soins d'urgence, covoiturage) ; réponse de chaque parent sur le droit à l'image.
- La vie du club : réponses aux rendez-vous, présences (avec l'heure d'arrivée), scores des matchs, messages et groupes, missions de bénévole, heures des coachs, signalements d'un problème lors d'un rendez-vous (matériel, ou comportement d'un joueur de l'équipe).
- Licence et cotisation : état de la licence, cotisation, remise éventuelle, versements notés, attestations de paiement ; visibles du bureau, et du parent ou du joueur majeur pour sa propre fiche.
- Vos réglages : équipes suivies, notifications sur chaque appareil, avancée du guide « Pour bien démarrer ».
- Renforts, ententes et prêts : le fait qu'un joueur renforce une autre équipe de son club (avec l'accord de sa famille) ; pour une équipe en entente, le club d'origine du joueur ; le prêt d'un joueur à un autre club, ou venu d'un autre club, pour la saison.
- Jamais d'information médicale. Merci de ne pas en écrire dans l'application.
## Pour quoi faire ?
Organiser la vie du club : agenda, présences, convocations, messages, cotisations. Rien d'autre : pas de publicité, pas de revente, pas de profilage.
## Qui voit quoi ?
- Les autres joueurs et parents voient les joueurs sous la forme « Prénom N. », sans coordonnées ni photo.
- Les coachs et le contact d'équipe voient le nom et les coordonnées utiles des joueurs de leurs équipes, y compris, pour une équipe en entente, ceux de l'autre club.
- Un signalement d'un problème n'est lu que par le coach de l'équipe, le directeur technique, le vice-président et le président.
- Une convocation envoyée à un autre club donne le nom des coachs ; leur téléphone ou leur e-mail seulement s'ils l'ont choisi.
- Les coordonnées des familles ne sont visibles, pour tout le club, que du président, du secrétariat, de la trésorerie, du directeur technique, du contact licences et du contact rencontres. Les autres membres du bureau ne les voient pas.
- Une personne non connectée ne voit que la liste des clubs.
## Enfants et adolescents
- Avant 15 ans, un enfant n'a pas de compte : c'est son parent qui gère tout depuis le sien.
- De 15 à 17 ans, le joueur peut avoir son compte ; nous demandons l'e-mail d'un parent pour l'inviter.
- Un adulte ne peut pas échanger en privé avec un mineur : hors des groupes d'équipe, un parent du mineur est toujours dans la conversation. Dans un groupe d'équipe (y compris celui d'une équipe en entente, qui réunit les deux clubs), les parents inscrits du mineur sont ajoutés d'office.
## Ce que vous choisissez
Deux accords sont facultatifs, et vous pouvez les retirer à tout moment dans « Mon compte » : le droit à l'image, et les e-mails d'information. Une désinscription par le lien d'un e-mail est définitive : nous gardons seulement une empreinte de l'adresse, pour ne plus y écrire. Les e-mails nécessaires au service (convocation, sécurité du compte, changement d'un rendez-vous, attestation demandée, avertissement avant la suppression d'un compte) sont toujours envoyés.
## Combien de temps ?
- Votre fiche dans un club : 2 saisons après votre départ, puis elle est effacée.
- Votre compte : sans connexion pendant 2 saisons (une saison va du 1er juillet au 30 juin), vous êtes prévenu par e-mail, puis le compte passe 30 jours en corbeille avant d'être effacé. Si vous le supprimez vous-même : 30 jours de corbeille, puis effacement.
- Présences : rendues anonymes après une saison. Messages : 2 saisons.
- Appareils de connexion : effacés après 12 mois sans usage.
- Attestations de paiement : jusqu'à la fin de la saison.
- Prêt d'un joueur : la saison du prêt.
## Où sont vos données ?
Dans l'Union européenne (${LIEU}), chez Supabase. Les e-mails sont envoyés par Resend, les pages sont servies par GitHub et la vérification « vous n'êtes pas un robot » est faite par Cloudflare, trois sociétés américaines liées par un contrat de protection des données ; le nom de domaine est chez OVH, en France. Les notifications passent par le service de votre navigateur (Google, Apple ou Mozilla), chiffrées. Quand un coach prépare le schéma d'un exercice avec l'IA, le texte de l'exercice est envoyé à Anthropic (États-Unis), jamais un nom ni une donnée de joueur.
Le bouton micro utilise la dictée de votre navigateur : sur Chrome et Samsung Internet, votre voix est transformée en texte par Google ; sur Safari, par Apple. mypocketclub ne reçoit que le texte, jamais le son. Évitez de dicter le nom d'un joueur.
## Vos droits
Vous pouvez demander à voir vos données, les corriger, les effacer, en obtenir une copie ou vous opposer à un usage. Écrivez à ${C} : réponse sous un mois. Si la demande concerne les données gérées par votre club, nous la lui transmettons. Vous pouvez aussi saisir la CNIL (cnil.fr).`;

// ---------- 3. Politique de confidentialité complète ----------
const FULL = `
## 1. Qui est responsable de vos données ?
mypocketclub est une application qui aide les clubs sportifs à s'organiser. Deux responsables se partagent les rôles :
- **Votre club** est responsable des données de ses membres : il décide de les enregistrer et de les utiliser pour la vie du club. mypocketclub agit alors comme son prestataire (« sous-traitant » au sens du RGPD) et suit ses instructions.
- **mypocketclub**, édité par Gaël Raveneau, est responsable des données de votre compte : création, connexion, sécurité, assistance.
- **Deux clubs en entente** sont responsables ensemble des données qu'ils partagent pour leur équipe commune (voir la partie 4).
Contact pour toute question : ${C}.
## 2. Quelles données sont traitées ?
- **Compte** : nom, prénom, adresse e-mail, téléphone si vous le donnez, mot de passe (conservé chiffré), date d'acceptation des conditions et version acceptée.
- **Sécurité** : appareils utilisés pour vous connecter (identifiant et nom de l'appareil), dates de connexion, journal des actions du club (qui a exporté, délivré une attestation, changé une fonction…). Pour limiter les abus, l'adresse IP d'une recherche de club, d'une demande d'ajout ou d'une recommandation n'est gardée que sous forme d'empreinte (jamais en clair).
- **Place dans le club** : club, rôle, fonction au bureau, équipe, lien entre un parent et son enfant, contact d'équipe.
- **Fiche d'un joueur** : nom, prénom, date de naissance, équipe ; e-mail et téléphone d'un parent et contact d'urgence, quand le club les note ; autorisations notées par la famille ou le club (rentrer seul, soins d'urgence, covoiturage) ; réponse de chaque parent sur le droit à l'image.
- **Réglages** : équipes suivies, réglages de l'application, abonnement aux notifications sur chaque appareil, avancée du guide « Pour bien démarrer ».
- **Signalements** : un message signalé garde la trace de la personne qui l'a signalé et de la date.
- **Vie du club** : rendez-vous et réponses, présences (avec l'heure d'arrivée notée à l'appel), scores des matchs, convocations, messages et groupes d'échange, sondages, missions de bénévole, signalements d'un problème lors d'un rendez-vous.
- **Entraîneurs** : heures, taux horaire et montants, visibles du président et de la trésorerie.
- **Licence et cotisation** : état de la licence, cotisation, remise éventuelle, versements notés, demandes d'attestation de paiement ; visibles du bureau, et du parent ou du joueur majeur pour sa propre fiche (c'est là qu'il demande une attestation).
- **Attestations de paiement** : demande (nom du demandeur), attestation délivrée en PDF, signature en image de la personne qui la délivre (gardée avec son compte) ; coordonnées, numéro SIRET ou RNA et cachet du club, réglés par le président.
- **Renforts, ententes et prêts** : le fait qu'un joueur renforce une autre équipe de son club, avec la réponse de sa famille ; pour une équipe en entente, le club d'origine du joueur et le contact du club partenaire ; le prêt d'un joueur (club d'accueil ou d'origine, saison).
- **Contact du coach pour les convocations** : ce que chaque coach choisit de montrer (téléphone, SMS, e-mail, ou rien).
- **Abonnement du club** : nombre de joueurs, statut et montant, visibles du président du club et de mypocketclub.
- **Exercices préparés avec l'IA** : date, club, compte et coût de chaque demande, pour suivre la dépense ; jamais le texte de l'exercice.
- **E-mails envoyés** : type, club, date et réussite de chaque envoi, pour respecter les limites d'envoi ; jamais l'adresse ni le contenu. Une adresse qui s'est désinscrite est gardée sous forme d'empreinte, pour ne plus jamais y écrire.
- **Gymnases du club** : nom et adresse des salles, saisis par le président, visibles des membres du club pour remplir le lieu des rendez-vous à domicile. Toucher une adresse ouvre l'application de cartes de votre appareil (Plans, Google Maps…), qui reçoit alors cette adresse.
- **Recommandations** : quand une personne recommande mypocketclub à un dirigeant de son club, nous gardons seulement l'empreinte de l'adresse du dirigeant (pour ne jamais lui écrire deux fois), jamais l'adresse, ni le prénom ou le club saisis.
- **Accords** : droit à l'image et e-mails d'information, avec leur date.
- **Contenus que vous créez** : exercices, séances, tactiques (schémas de placement des coachs), annonces, fichiers joints.
mypocketclub ne demande **aucune donnée de santé**. Seul le fait qu'un certificat a été fourni, oui ou non, peut être noté par le club. Merci de ne pas écrire d'information médicale dans l'application.
Les données viennent de vous, de votre club (qui peut vous inscrire ou inscrire votre enfant) ou, pour un enfant, de son parent.
## 3. Pourquoi, et sur quelle base ?
| Créer et gérer votre compte, vous connecter | Exécution des conditions d'utilisation |
| Organiser la vie du club : agenda, présences, convocations, messages, cotisations, renforts | Intérêt légitime du club et relation d'adhésion entre le club et ses membres |
| Sécuriser les comptes, prévenir la fraude, tenir un journal des actions sensibles, traiter les signalements | Intérêt légitime de mypocketclub |
| Inviter un parent par e-mail, à la demande de son enfant ou d'un adulte du club qui veut échanger avec l'enfant | Intérêt légitime du club et de l'enfant ; l'adresse ne sert qu'à cela |
| Utiliser l'image d'un joueur | Votre accord, ou celui des parents pour un mineur |
| Faire jouer un joueur en renfort dans une autre équipe | L'accord de sa famille (celle d'un mineur, ou lui-même s'il est majeur) |
| Partager une équipe en entente avec l'autre club (rendez-vous, groupe d'échange, coordonnées utiles aux coachs) | Intérêt légitime des deux clubs, responsables ensemble |
| Noter le prêt d'un joueur et prévenir l'autre club | Relation d'adhésion entre le club et ses membres, et intérêt légitime des deux clubs |
| Garder le signalement d'un problème lors d'un rendez-vous | Intérêt légitime du club : sécurité des joueurs et bon déroulement des activités |
| Montrer le téléphone ou l'e-mail d'un coach dans une convocation envoyée à un autre club | Le choix du coach, modifiable à tout moment |
| Vous envoyer des e-mails d'information | Votre accord |
| Préparer le schéma d'un exercice avec l'IA, à la demande d'un coach (seul le texte de l'exercice est envoyé, jamais un nom) | Intérêt légitime du club (outil d'entraînement) |
| Répondre à vos demandes et respecter nos obligations légales | Obligation légale |
Vos données ne servent ni à de la publicité, ni à de la revente, ni à établir un profil de vous.
## 4. Qui peut voir vos données ?
- **Les autres joueurs et parents** voient les joueurs sous la forme « Prénom N. », sans coordonnées ni photo.
- **Les entraîneurs** voient le nom complet et les coordonnées utiles des joueurs de leurs équipes et de leurs parents. Un joueur qui renforce une équipe n'est vu de son coach que sous la forme « Prénom N. » tant que sa famille n'a pas accepté.
- **Le contact d'équipe**, un adulte choisi pour une équipe (coach, joueur majeur ou membre du bureau), voit les coordonnées des familles et des joueurs de cette équipe seulement. Son droit s'arrête dès qu'il n'a plus le rôle qui le justifiait.
- **Le profil « Aide coach »**, que peut avoir un jeune de 15 à 17 ans choisi par un entraîneur ou le président, ne donne aucun droit de plus : il permet de voir l'effectif de l'équipe, sans coordonnées. Il s'arrête à 18 ans.
- **Le bureau du club** voit ce dont il a besoin pour gérer le club. La cotisation, la remise et la licence ne sont visibles que du bureau.
- **Les coordonnées des familles** (e-mail, téléphone, contact d'urgence) ne sont visibles, pour tout le club, que du président, du secrétariat, de la trésorerie, du directeur technique (sauf si le président les lui masque), du contact licences et du contact rencontres. Le vice-président, la communication, le sponsoring, les événements et les autres fonctions ne les voient pas.
- **Dans Messages**, chacun ne peut inviter dans un groupe que les personnes avec qui il a un lien : le bureau (tout le monde peut lui écrire), les coachs et les membres de son équipe ou de celle de son enfant, les autres coachs s'il est coach ; le bureau peut écrire à tout le club. Les noms apparaissent sous la forme « Prénom N. », sauf pour le bureau et le coach de l'équipe.
- **Équipe en entente entre deux clubs** : une fois l'entente acceptée par les deux clubs, les membres de l'autre club qui font partie de l'équipe (joueurs, parents, coachs) voient l'équipe et ses rendez-vous, et y répondent. Un joueur de l'autre club leur apparaît sous la forme « Prénom N. ». Les coachs de l'équipe, des deux clubs, voient les joueurs de toute l'équipe ; le bureau du club qui porte l'équipe voit leurs fiches ; le bureau de l'autre club ne voit que les fiches de son club. Les licences et cotisations restent gérées par chaque club pour ses joueurs. Les coordonnées des familles de toute l'équipe sont visibles des coachs et du contact de l'équipe, des deux clubs. Le groupe d'échange de l'équipe (messages et sondages) peut réunir les membres de l'équipe des deux clubs ; il n'y a pas d'autres messages entre les deux clubs. Les deux clubs sont responsables ensemble de ces données ; l'entente cesse dès que le club qui porte l'équipe la retire.
- **Signalement d'un problème** : depuis un rendez-vous, le coach de l'équipe, le directeur technique, le vice-président et le président peuvent signaler un problème matériel, ou un problème humain qui nomme un enfant de l'équipe. Un signalement n'est lu que par le coach de l'équipe, le directeur technique, le vice-président et le président. Il ne doit contenir aucune information médicale. La notification envoyée ne contient ni le texte, ni le nom de l'enfant.
- **Joueur prêté ou en prêt** : le bureau ou le coach de l'équipe peut noter qu'un joueur est prêté à un autre club, ou qu'il vient en prêt d'un autre club, pour la saison. Si l'autre club utilise mypocketclub, son président en est prévenu, avec seulement le prénom et l'initiale du nom du joueur. Sinon, mypocketclub écrit au club, à l'adresse qu'il publie, un seul message (et au plus une relance), avec un lien pour refuser définitivement ; ce message ne nomme ni le joueur ni la personne qui a noté le prêt.
- **Contact du coach dans la convocation** : la convocation envoyée aux clubs reçus donne le nom du coach de chaque équipe. Son téléphone ou son adresse e-mail n'y figurent que s'il l'a choisi dans « Mon compte » (rien par défaut) ; il peut changer d'avis à tout moment.
- **Le président du club** voit les messages signalés dans les groupes du club, avec leur auteur ; il peut aussi retirer l'accès d'un joueur à son club.
- **Le contact du club** choisit lui-même si son e-mail ou son téléphone est affiché aux personnes connectées.
- **Une personne non connectée** ne voit que la liste des clubs.
- **Un organisme qui finance un club** (mairie, comité) ne voit que des chiffres : jamais de nom.
- **mypocketclub** n'accède aux données d'un club que pour l'assistance, la sécurité ou la correction d'un problème. Il ne lit un message signalé que si le président le lui transmet, et ce message seul.
Le club peut exporter la liste de ses membres. Ce fichier est alors sous sa responsabilité.
## 5. Enfants et adolescents
- **Avant 15 ans**, un enfant n'a pas de compte. Son parent gère sa participation depuis son propre compte.
- **De 15 à 17 ans**, un joueur peut avoir son compte. Il peut saisir l'e-mail d'un parent pour l'inviter : le parent reçoit un lien valable 14 jours, crée son compte avec cette adresse, et sa demande doit être validée par le président du club. Sans parent relié, le jeune n'accède qu'aux groupes de son équipe.
- **Échanges avec un adulte.** Un adulte ne peut pas échanger en privé avec un mineur. En dehors des groupes d'équipe, un parent de chaque mineur est toujours présent dans la conversation. Dans un groupe d'équipe, y compris celui d'une équipe en entente qui réunit les deux clubs, les parents inscrits du mineur sont ajoutés d'office. Un supporteur n'est jamais dans un groupe avec un mineur. Pour ouvrir une conversation avec un mineur, l'adulte ajoute un de ses parents : un parent déjà inscrit, ou un parent invité par e-mail (adresse saisie par un adulte du club, jamais demandée à l'enfant). La conversation n'est créée qu'avec l'accord de ce parent ; sans réponse sous 14 jours, elle est annulée. Tout message peut être signalé au président du club.
- **Droit à l'image.** Il est donné par les parents. Si l'un des deux le refuse, le refus s'applique.
- **Renforts.** Un mineur ne renforce une autre équipe que si sa famille accepte. Un « non » d'un des parents l'emporte et retire le renfort. Le renfort et sa famille ne voient que les rendez-vous de cette équipe où le coach l'invite.
- **Bénévolat.** Un jeune ne participe à une mission que si son parent l'inscrit et si le club a ouvert cette mission aux jeunes.
## 6. Ce que vous pouvez choisir
Deux accords sont facultatifs, jamais cochés d'avance, et modifiables à tout moment dans « Mon compte » :
- le **droit à l'image** ;
- les **e-mails d'information** (rappels, nouveautés, relances), qui contiennent aussi un lien de désinscription. Une désinscription par ce lien est définitive ; vous pouvez revenir sur ce choix vous-même dans « Mon compte ».
Les e-mails nécessaires au service sont toujours envoyés : convocation, changement d'un rendez-vous, sécurité du compte, invitation d'un parent, attestation de paiement demandée (si le club choisit de l'envoyer aussi par e-mail), avertissement avant la suppression d'un compte inactif, et validation de votre demande pour rejoindre un club (ou de votre club) quand les notifications ne sont activées sur aucun de vos appareils. Cet e-mail attend au plus 7 jours dans une file d'envoi, qui ne garde que votre compte, le club et le rôle demandé.
## 7. Combien de temps les données sont-elles gardées ?
| Fiche dans un club | 2 saisons après votre départ, visible du bureau seulement, puis effacée |
| Compte | Tant que vous l'utilisez ; sans connexion pendant 2 saisons : e-mail d'avertissement, puis 30 jours de corbeille, puis effacement |
| Compte que vous supprimez | 30 jours de corbeille, puis effacement |
| Accès et fiche retirés par le président du club | 30 jours de corbeille (le président peut les restaurer), puis effacement |
| Message signalé | Gardé avec son signalement, visible du président du club, tant que le message existe |
| Signalement d'un problème lors d'un rendez-vous | Durée en cours de décision (version de test) ; effacé avec le club |
| Prêt d'un joueur | La saison du prêt, puis gardé avec la fiche du joueur |
| Choix du coach pour les convocations | Tant que le coach le garde ; une convocation déjà envoyée garde ce qu'elle montrait |
| Rendez-vous, réponses et scores | Gardés avec le club (version de test) ; une durée plus courte reste à fixer |
| Présences | Rendues anonymes après 1 saison |
| Messages et groupes | 2 saisons |
| Appareils de connexion | Effacés après 12 mois sans usage |
| Renfort | Jusqu'à la fin de la saison, ou jusqu'à son retrait |
| Journal des actions du club | 1 an |
| Copie du profil après la suppression d'un compte | 30 jours (le temps de la corbeille) |
| Demande et attestation de paiement | Jusqu'à la fin de la saison |
| Signature en image | Tant que la personne la garde dans son compte |
| Abonnement aux notifications | Tant que l'appareil l'utilise |
| Suivi des demandes faites à l'IA | Tant que le club existe (il sert au budget de chaque saison) |
| Journal des e-mails envoyés | 13 mois |
| Empreinte d'une adresse désinscrite | Tant que le service existe, pour ne plus y écrire |
| Empreinte d'une adresse recommandée | Tant que le service existe, pour ne jamais lui écrire deux fois |
| Empreinte d'adresse IP | Environ 1 heure (recherche de club) ; 2 jours (recommandation) ; avec la demande d'ajout d'un club, tant qu'elle est gardée |
| Club supprimé | 90 jours de corbeille, données non consultées, puis effacement |
| Adresse saisie pour inviter une personne (par exemple un parent) | Le lien d'invitation vaut 14 jours ; l'adresse est effacée après 30 jours |
| Demande de conversation avec un mineur (qui la fait, le parent sollicité, sa réponse) | Effacée 30 jours après la réponse ou l'annulation |
Les copies de sauvegarde sont effacées dans les semaines qui suivent. Le motif d'un départ n'est jamais enregistré.
## 8. Où sont les données, et qui nous aide ?
| Supabase | Base de données, comptes, fichiers · ${LIEU} (Union européenne) |
| Resend | Envoi des e-mails · États-Unis |
| Cloudflare | Vérification « vous n'êtes pas un robot » (Turnstile) à l'inscription, à la connexion et pour une recommandation · États-Unis |
| GitHub | Pages de l'application (aucune donnée de membre) · États-Unis |
| Anthropic | IA Claude : propose le schéma d'un exercice à la demande d'un coach ; reçoit seulement le titre, la description et les tags de l'exercice, jamais un nom ni une donnée de joueur · États-Unis |
| OVH | Nom de domaine et boîte de contact · France |
| Services de notification des navigateurs (Google, Apple, Mozilla, selon votre appareil) | Acheminent les notifications, dont le contenu est chiffré de bout en bout · selon le navigateur |
Les prestataires américains interviennent dans le cadre des garanties prévues par le RGPD pour les transferts hors de l'Union européenne (clauses contractuelles types ou cadre de protection des données entre l'Union européenne et les États-Unis). Cette liste est mise à jour à chaque changement.

**Dictée.** Le bouton micro (description d'un exercice, consignes d'une tactique) n'est pas un service de mypocketclub : c'est la dictée de votre navigateur, régie par les règles de son éditeur (Google pour Chrome et Samsung Internet, Apple pour Safari), qui peut envoyer votre voix à ses serveurs pour la transformer en texte. mypocketclub ne reçoit que le texte écrit dans le champ, jamais le son. Évitez de dicter le nom d'un joueur ; si vous ne voulez pas utiliser la dictée, tapez le texte.
## 9. Sécurité
- Les échanges avec l'application sont chiffrés.
- Les droits de chacun sont vérifiés par le serveur, selon son rôle dans le club.
- Les mots de passe ne sont jamais conservés en clair.
- Une connexion depuis un nouvel appareil déclenche un e-mail d'alerte, avec un lien pour déconnecter tous vos appareils.
- En cas d'incident touchant vos données, votre club est prévenu sous 48 heures. Si l'incident présente un risque pour vous, vous êtes prévenu, ainsi que la CNIL.
## 10. Vos droits
Vous pouvez à tout moment :
- **accéder** à vos données et en obtenir une copie ;
- les faire **corriger** ;
- les faire **effacer** ;
- vous **opposer** à un usage ou demander sa **limitation** ;
- **retirer un accord** que vous avez donné ;
- donner des instructions sur le sort de vos données après votre décès.
Écrivez à ${C}. Nous répondons dans le mois. Si votre demande concerne des données gérées par votre club, nous la lui transmettons et l'aidons à vous répondre. Un parent exerce ces droits pour son enfant mineur.
Si la réponse ne vous satisfait pas, vous pouvez saisir la CNIL : cnil.fr.
## 11. Traceurs
mypocketclub n'utilise aucun traceur publicitaire ni outil de mesure d'audience. L'application enregistre sur votre appareil ce qui est strictement nécessaire : votre connexion, vos réglages et un identifiant d'appareil servant à la sécurité. Ces éléments ne demandent pas de consentement.
## 12. Démarchage des clubs
mypocketclub peut écrire à un club pour se présenter. Il n'utilise pour cela que les adresses publiées par le club ou sa fédération pour le contacter. Il n'écrit que si une personne le demande (« Recommander mon club », quand elle n'a pas l'adresse d'un contact du club). Elle choisit de donner ses coordonnées ou de rester anonyme : si elle les donne, le message indique son nom et son e-mail sert seulement à la prévenir quand le club arrive ; sinon, le message dit seulement qu'un membre du club l'a demandé et rien n'est gardé sur elle. Chaque message indique d'où vient l'adresse et permet de refuser tout nouvel envoi ; ce refus est définitif. Un club n'est contacté qu'une fois, avec au plus une relance. Les adresses reçues à l'occasion d'une convocation ne servent jamais à cela.
Trois autres façons de faire connaître mypocketclub existent :
- **La recommandation.** Une personne peut saisir l'adresse e-mail d'un contact de son club qu'elle connaît. Un seul e-mail part, avec son prénom si elle choisit de le donner ; il permet de refuser tout nouvel envoi. Une adresse ne reçoit jamais deux recommandations, ni une recommandation si elle s'est désinscrite ou si elle a déjà un compte.
- **La convocation.** Quand un club envoie une convocation par e-mail à un club qui n'utilise pas mypocketclub, une courte mention de mypocketclub figure en bas du message. L'adresse du destinataire n'est pas gardée.
- **Le prêt d'un joueur.** Quand un club note qu'un joueur est prêté à un club qui n'utilise pas mypocketclub, ou qu'il en vient, mypocketclub peut écrire à ce club, avec les mêmes règles que ci-dessus (adresse publiée, un message et au plus une relance, refus définitif). Le message ne nomme ni le joueur ni la personne qui a noté le prêt.
## 13. Modification de cette politique
Toute modification importante vous est signalée dans l'application avant de s'appliquer. La version et la date figurent en tête de cette page.`;

// ---------- 4. Conditions d'utilisation ----------
const CGU = `
## 1. Objet
mypocketclub est une application qui aide les clubs sportifs à s'organiser : agenda, présences, convocations, messages, équipes, cotisations, exercices, bénévoles. Les présentes conditions fixent les règles entre mypocketclub et chaque personne qui utilise l'application. Créer un compte vaut acceptation de ces conditions.
## 2. Éditeur et version de test
mypocketclub est édité par Gaël Raveneau (${C}). L'application est en phase de test : elle est gratuite, elle peut évoluer, comporter des erreurs ou être momentanément indisponible. Vos remarques sont les bienvenues à la même adresse.
## 3. Votre compte
- **Âge.** Il faut avoir 15 ans ou plus pour créer un compte. Avant 15 ans, c'est un parent qui gère la participation de l'enfant depuis son propre compte. Le club peut vérifier l'âge de ses membres.
- **Exactitude.** Vous donnez des informations exactes et vous les tenez à jour.
- **Un compte par personne.** Votre compte est personnel. Vous gardez votre mot de passe secret et vous nous prévenez si quelqu'un d'autre l'a utilisé.
- **Compte de fonction.** Un club peut utiliser un compte partagé pour une fonction (par exemple le secrétariat). Le président désigne alors une personne responsable de ce compte, et le club répond de ce qui est fait avec.
- **Plusieurs rôles.** Un même compte peut porter plusieurs profils : joueur, parent, entraîneur, membre du bureau, supporteur, dans un ou plusieurs clubs.
## 4. Le rôle du club
Chaque club est créé par son président, dont la qualité est vérifiée par mypocketclub. Le club :
- décide qui tient quelle fonction (bureau, entraîneurs, contacts, contact d'équipe) et retire les accès quand une personne quitte son rôle ;
- est responsable des informations qu'il enregistre sur ses membres et de l'usage qu'il en fait ;
- informe ses membres, et les parents des joueurs mineurs, qu'il utilise mypocketclub ;
- reste seul organisateur de ses activités : entraînements, matchs, déplacements, événements, bénévolat. mypocketclub n'organise, n'encadre et n'assure aucune de ces activités ;
- déclare avec exactitude les joueurs prêtés à un autre club ou venus en prêt d'un autre club : un joueur est compté par le club où il a signé sa licence ;
- pour une équipe en entente, partage avec l'autre club, dans l'application, l'équipe, ses rendez-vous, son groupe d'échange et les coordonnées utiles aux coachs : les deux clubs en sont responsables ensemble.
## 5. Protection des mineurs
- Les autres joueurs et parents voient les joueurs sous la forme « Prénom N. », sans coordonnées ni photo.
- Un adulte ne peut pas échanger en privé avec un mineur. En dehors des groupes d'équipe, un parent de chaque mineur est présent dans la conversation. Dans un groupe d'équipe, y compris celui d'une équipe en entente, les parents inscrits du mineur sont ajoutés d'office. Il est interdit de contourner cette règle, dans l'application ou en invitant un mineur à poursuivre l'échange ailleurs.
- Le droit à l'image est donné par les parents. Publier la photo d'un mineur sans cet accord est interdit.
- Un jeune ne tient une mission de bénévole que si son parent l'a inscrit. Le club s'engage à ce qu'un adulte soit présent, et aucune mission où l'on manie de l'argent ne lui est confiée.
## 6. Règles de conduite
Vous vous engagez à ne pas :
- publier de contenu illégal, insultant, menaçant, discriminatoire, à caractère sexuel ou portant atteinte à la vie privée d'autrui ;
- écrire d'information médicale sur une personne, y compris dans le signalement d'un problème ;
- signaler un problème de façon mensongère ou pour nuire à un enfant ou à sa famille ;
- utiliser les coordonnées des membres pour autre chose que la vie du club, en particulier pour de la publicité ;
- vous faire passer pour une autre personne ou pour un club ;
- tenter d'accéder à des données qui ne vous sont pas destinées, ni perturber le fonctionnement de l'application ;
- extraire en masse les données de l'application.
## 7. Vos contenus
- **Ils restent à vous.** Vous gardez vos droits sur les messages, exercices, séances et fichiers que vous créez.
- **Ce que vous autorisez.** Vous autorisez mypocketclub à les stocker et à les afficher aux personnes à qui vous les destinez, pour faire fonctionner l'application.
- **Exercices partagés.** En partageant un exercice avec votre club ou avec tous les clubs, vous certifiez en être l'auteur ou avoir le droit de le partager, et vous accordez aux autres utilisateurs le droit gratuit et non exclusif de l'utiliser pour leurs entraînements. Vous pouvez le retirer à tout moment ; les séances déjà préparées par d'autres peuvent en garder une copie.
- **Images créées avec une aide automatique.** Si l'application propose de générer une image ou une animation pour un exercice, vous restez responsable de l'exercice publié et vous vérifiez le résultat avant de le partager.
- **Logo du club.** Le club certifie avoir le droit d'utiliser le logo qu'il importe.
## 8. Signalement et retrait
Tout contenu peut être signalé, dans l'application ou à ${C}. mypocketclub héberge les contenus des utilisateurs sans les lire à l'avance. Il retire rapidement ce qui lui est signalé et qui est manifestement illicite ou contraire à ces conditions, et peut en informer le président du club concerné. Dans un groupe, le président du club voit les messages signalés. Un problème signalé depuis un rendez-vous (matériel ou comportement d'un joueur) n'est lu que par le coach de l'équipe, le directeur technique, le vice-président et le président du club, qui décident de la suite.
## 9. Données personnelles
Le traitement de vos données est décrit dans la politique de confidentialité, accessible depuis l'application (« Vos données »).
## 10. Suspension, suppression et fin
- **Par vous.** Vous pouvez quitter un profil, quitter un club ou supprimer votre compte à tout moment depuis « Mon compte ». Un compte supprimé reste 30 jours en corbeille, puis il est effacé.
- **Par le club.** Un club peut retirer un membre ou une fonction.
- **Par mypocketclub.** En cas de manquement à ces conditions, mypocketclub peut retirer un contenu, suspendre un compte ou le supprimer, après vous avoir prévenu, sauf urgence ou risque pour un mineur.
- **Club non validé.** Un club dont le président n'est pas validé est prévenu de la date limite. Sans validation dans les 30 jours, le club est supprimé.
- **Club supprimé.** Ses données restent 90 jours en corbeille, sans être consultées, puis elles sont effacées. Le président peut annuler la suppression pendant ce délai.
## 11. Disponibilité et responsabilité
mypocketclub fait ses meilleurs efforts pour que l'application fonctionne et pour protéger vos données, sans garantie de disponibilité permanente pendant le test. Il ne peut pas être tenu responsable :
- des décisions et des activités du club, ni des informations que le club ou ses membres enregistrent ;
- d'une absence ou d'un retard de notification : pour une information importante, le club garde un autre moyen de prévenir ses membres ;
- d'une interruption due à un prestataire technique ou à votre connexion.
Rien dans ces conditions ne limite les droits que la loi vous reconnaît.
## 12. Propriété intellectuelle
L'application, son nom, son logo, ses textes et son code appartiennent à leur éditeur. Tous droits réservés. Vous disposez d'un droit personnel d'utiliser l'application, sans pouvoir la copier, la revendre ni en réutiliser le contenu en dehors de la vie de votre club.
## 13. Offres payantes
L'application est gratuite pendant le test. Si une offre payante est proposée plus tard, elle fera l'objet de conditions séparées, acceptées par le club ou par la personne concernée. Deux gratuités sont prévues : un club qui s'inscrit est gratuit jusqu'à la fin de la saison en cours (une saison va du 1er juillet au 30 juin) ; une équipe est gratuite pendant une saison complète, de sa date de début à la même date l'année suivante (par exemple de décembre à décembre). Un soutien versé à un club par l'application ne sera jamais un don ouvrant droit à un reçu fiscal. Si un prix est fixé par joueur, chaque joueur n'est compté qu'une fois, par le club où il a signé sa licence : un joueur prêté à un autre club reste compté par son club ; un joueur venu en prêt n'est pas compté par le club qui l'accueille.
## 14. Modification des conditions
Ces conditions peuvent évoluer. Une modification importante vous est présentée à votre connexion suivante, et votre accord vous est redemandé. La version et la date figurent en tête de cette page.
## 15. Droit applicable et contact
Ces conditions sont soumises au droit français. Pour toute question ou réclamation : ${C}. Nous cherchons d'abord une solution amiable.`;

// Pages : menu (sans id), « mentions », « donnees » (courte), « politique » (complète), « cgu »
export const LEGAL_PAGES = {
  mentions: { title: 'Mentions légales', body: () => stamp('Mentions légales') + md(MENTIONS) },
  donnees: { title: 'Vos données', body: () => stamp('Vos données, en bref') + md(SHORT) + `<button class="btn" data-act="legal" data-v="politique">Lire la politique complète</button>` },
  politique: { title: 'Politique de confidentialité', body: () => stamp('Politique de confidentialité') + md(FULL) },
  cgu: { title: "Conditions d'utilisation", body: () => stamp("Conditions d'utilisation") + md(CGU) },
};
export const legalLinks = (cls = 'btn ghost') => `<div class="stack legal-links"><button class="${cls}" data-act="legal" data-v="mentions">Mentions légales</button><button class="${cls}" data-act="legal" data-v="donnees">Vos données</button><button class="${cls}" data-act="legal" data-v="cgu">Conditions d'utilisation</button></div>`;
export function legalBody(id) {
  const p = LEGAL_PAGES[id];
  if (p) return p.body();
  return `<p class="note">Version ${LEGAL.version} du ${LEGAL.date} · version de test, non relue par un juriste.</p>${legalLinks('btn')}<p class="note">Contact : <a href="mailto:${esc(C)}">${esc(C)}</a></p>`;
}
export const legalTitle = (id) => LEGAL_PAGES[id]?.title || 'Mentions et données';
