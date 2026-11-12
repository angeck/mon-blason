// mypocketclub · alpha 5.5.0 · onboarding « Pour bien démarrer » et FAQ (document claude/16-onboarding-fiches.md, piste B,
// décisions de Gaël du 12 novembre 2026). Une fiche sert deux fois : ligne de l'encart et question de la FAQ (Mon compte › Aide).
// Progression gardée dans les métadonnées du compte (clé « onboarding », comme le thème) : même liste sur tous les appareils.
// N° 164 : justificatif d'adhésion pour un comité d'entreprise (PDF délivré par le président ou la trésorerie).
import { BRAND } from '../config.js';
import {
  S, sb, esc, hooks, run, toast, render, ACTIONS, active, isBoard, isPresident, hasArea, coachOf, coachTeams, toValidate, playersOfTeam,
  myFonctions, isMajor, myKids, mySelf, teamName, pl, pname, download, plural,
} from './core.js';
import { header, icon } from './ui.js';
import { V310_VIEWS } from './v310.js';
import { N, standalone } from './notif.js';
import { Pdf } from './pdfmin.js';
import { SHOTS } from './faq_shots.js'; // 5.7.0 · n° 206 : captures de la FAQ (fabriquées par tools/captures_faq.py)

// ---------- progression (métadonnées du compte) ----------
const meta = () => S.session?.user?.user_metadata?.onboarding || {};
function saveMeta(o) {
  const u = S.session?.user; if (!u) return;
  const v = { ...meta(), ...o };
  u.user_metadata = { ...(u.user_metadata || {}), onboarding: v };
  sb.auth.updateUser({ data: { onboarding: v } }).catch(() => {});
}
const doneSet = () => new Set(meta().done || []);

// ---------- contexte ----------
const roles = () => active();
const has = (r) => roles().some((m) => m.role === r);
const onlySupporter = () => roles().length > 0 && roles().every((m) => m.role === 'supporteur');
const realRole = () => roles().some((m) => m.role !== 'supporteur');
const adult = () => !mySelf().length || mySelf().every((p) => isMajor(p));
const fns = () => myFonctions();
const fnHas = (...l) => fns().some((f) => l.includes(f));
const coachTids = () => coachTeams();
const myEventIds = () => new Set(S.events.filter((e) => e.created_by === S.me.id).map((e) => e.id));

// ---------- les fiches (textes du document 16, vérifiés dans le code 5.4.0) ----------
// show : sélecteurs des boutons à entourer, un par écran ; auto : coche automatique ; faq : FAQ seulement (pas de ligne)
const TAB = (i) => `[data-act=tab][data-i="${i}"]`;
const ROLESBTN = '[data-act=espace], .tb nav.roles [data-act=casq]'; // 5.7.0 : sur ordinateur, le bloc « Mes rôles » à gauche
export const FICHES = {
  T1: { q: 'Comment installer mypocketclub sur mon téléphone ?', line: () => (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Installer l’appli sur ton téléphone · 1 min' : 'Mettre l’appli sur ton téléphone'),
    why: 'L’appli s’ouvre depuis une icône, comme les autres, et peut te prévenir des rendez-vous. Sur iPhone, c’est obligatoire pour recevoir les notifications.',
    steps: ['iPhone (Safari) : Partager, puis « Sur l’écran d’accueil », puis « Ajouter ».', 'Android (Chrome) : menu ⋮, puis « Installer l’application ».', 'Samsung Internet : menu ≡, « Ajouter la page à », « Écran d’accueil ».', 'Ordinateur : icône d’installation dans la barre d’adresse.'],
    extra: '<button class="btn main" data-act="guide">Ouvrir le guide pas à pas</button>', auto: () => standalone() },
  T2: { q: 'Comment recevoir les notifications ?', line: () => (N.state === 'ios-install' ? 'Activer les notifications (installe d’abord l’appli)' : 'Activer les notifications'),
    why: 'Être prévenu d’un nouveau rendez-vous, d’un changement, d’un rappel ou d’une annonce, même appli fermée. Une seule fois par appareil, pour tous tes clubs.',
    steps: ['Touche la silhouette en haut à droite (Mon compte).', 'Descends jusqu’à « Notifications ».', 'Touche « Activer les notifications ».', 'Dans la fenêtre du téléphone, touche « Autoriser ». Si elles sont bloquées : réglages du téléphone ou du navigateur, puis Notifications, puis mypocketclub.'],
    extra: () => (N.state === 'off' ? '<button class="btn main" data-act="pushon">Activer maintenant</button>' : ''), show: ['[data-act=account]', '[data-act=pushon], [data-anchor=push]'], auto: () => N.state === 'on' },
  T3: { q: 'Comment dire si je viens ?', line: 'Répondre à un rendez-vous', who: () => realRole(),
    why: 'Le coach sait qui vient ; ta réponse remplit l’appel.',
    steps: ['Sur l’Accueil, la carte jaune « À répondre » ; sinon l’onglet Agenda (la pastille compte les réponses à donner).', 'Touche « Je viens » ou « Je ne viens pas » (pour un enfant : « Léo vient » ; pour un événement : « Je participe »).', 'Tu peux changer ta réponse en touchant l’autre bouton.'],
    show: [TAB(1), '[data-act=event]'], auto: () => S.resp.some((r) => r.user_id === S.me.id) },
  T4: { q: 'Comment lire et écrire dans un groupe ?', line: 'Lire le groupe de ton équipe', who: () => !onlySupporter(),
    why: 'Échanger avec l’équipe et le coach sans donner son numéro. Un mineur n’est jamais dans un groupe libre avec un adulte sans son parent ; « Signaler » sur un message gênant.',
    steps: ['Onglet Messages (la pastille compte les messages non lus).', 'Touche le groupe.', 'Écris en bas et envoie.'], show: [TAB(2), '[data-act=group]'], visit: (v) => v?.type === 'group' },
  T5: { q: 'Comment changer de club ou en rejoindre un autre ?', faq: true,
    why: 'Un même compte peut être dans plusieurs clubs.',
    steps: ['Rejoindre : la loupe en haut (« Chercher un club »), le nom du club, sa ville ou son code postal, puis « Chercher ».', 'Touche le club, puis « Rejoindre ce club », et choisis ton profil (supporteur : accès immédiat).', 'Changer : sur l’Accueil, bloc « Changer de club » ; ou Mon compte › « Mes clubs et profils ».'] },
  K1: { q: 'Comment compléter mon profil ?', line: 'Compléter ton profil',
    why: 'Ton pseudo s’affiche dans les groupes ; ton téléphone est visible de l’encadrement et des familles concernées.',
    steps: ['Mon compte (silhouette en haut à droite).', '« Mon profil » : prénom, nom, pseudo, téléphone (l’e-mail ne se change pas ici).', '« Enregistrer mon profil ».'], show: ['[data-act=account]', '#proff'], auto: () => !!S.me.phone },
  K2: { q: 'Comment demander un autre rôle ?', faq: true,
    why: 'Joueur, parent, coach ou membre du bureau dans une autre équipe du club : chaque rôle est validé par le club.',
    steps: ['Mon compte, bouton « Demander un autre rôle ».', 'Choisis : Supporteur, Parent de joueur, Joueur, Coach, Membre du bureau, puis complète (enfant, équipe, fonction).', '« Envoyer la demande ». Supporteur : immédiat. Joueur et parent : le coach, le bureau ou le président. Coach : le président, le directeur technique ou le secrétariat. Bureau : le président.'] },
  K3: { q: 'Comment passer en thème sombre ?', faq: true, why: 'Pour lire le soir ou économiser la batterie.', steps: ['Mon compte › « Apparence » : « Comme mon téléphone », « Clair » ou « Sombre ». Le choix est gardé dans ton compte.'] },
  K4: { q: 'Où sont mes accords ?', faq: true, why: 'Droit à l’image et e-mails d’information : tu les changes quand tu veux.', steps: ['Mon compte › « Mes accords ». Pour un enfant, le droit à l’image est sur sa fiche. Les e-mails nécessaires (convocations, sécurité) partent toujours.'] },
  K5: { q: 'Comment devenir bénévole ?', line: 'Devenir bénévole', who: () => adult() && (has('parent') || has('joueur') || has('supporteur')),
    why: 'Le club compte sur ses membres pour la table de marque, l’arbitrage, la buvette. Tu choisis tes missions.',
    steps: ['Touche la silhouette en haut à droite (Mon compte).', 'Descends jusqu’au cadre « Bénévolat ».', 'Coche « Je participe au bénévolat du club ».', 'Ensuite, les missions (table de marque, buvette…) apparaissent sur les rendez-vous et sur l’Accueil : touche « Je prends » sur celles qui te vont.', 'Supporteur : possible seulement si ton club l’a ouvert aux supporteurs. Le bénévolat est réservé aux adultes.'],
    show: ['[data-act=account]', '[data-anchor=benevolat]'], auto: () => S.me.volunteer === true || S.me.supporter_volunteer === true },
  K6: { q: 'Comment quitter un club ?', faq: true, why: 'Ton compte reste ; tu n’as plus accès à ce club.', steps: ['Mon compte › « Quitter [club] », puis « Confirmer ».'] },
  K7: { q: 'Mon téléphone est perdu, ou je veux changer mon mot de passe', faq: true, why: 'Pour protéger ton compte.', steps: ['Mon compte › « Sécurité » : « Me déconnecter de tous les appareils » (deux touches), la liste des appareils connus, « Changer mon mot de passe ».'] },
  K8: { q: 'Comment récupérer ou supprimer mes données ?', faq: true, why: 'Tes données t’appartiennent.', steps: ['Mon compte › « Mes données » : « Télécharger mes données » (un fichier).', '« Supprimer mon compte » (deux touches) : tu es retiré tout de suite des clubs ; 30 jours pour annuler en te reconnectant.'] },
  R1: { q: 'À quoi sert « Mes rôles » ?', line: 'Ouvrir ton espace (« Mes rôles »)', who: () => has('coach') || has('bureau') || has('president'),
    why: 'Les onglets du bas servent à consulter ; « Mes rôles » sert à agir : appel, séances, demandes, fonctions, réglages. Les pastilles jaunes sur les quatre carrés comptent ce qui attend dans tes rôles.',
    steps: ['Touche les quatre carrés en haut de l’écran (sur ordinateur : le bloc « Mes rôles » à gauche).', 'Avec plusieurs rôles, une rangée « Mes rôles » apparaît dans le bloc bleu : touche le rôle voulu.', 'En bas de l’espace d’un rôle, tu peux choisir de l’ouvrir directement.'], show: [ROLESBTN], visit: (v) => v?.type === 'espace' },
  R2: { q: 'Que veulent dire les pastilles jaunes ?', faq: true, why: 'Elles comptent ce qui t’attend.', steps: ['Sur un onglet : ce qui te concerne toi (Agenda : réponses à donner ; Messages : non lus). Elle s’efface quand tu ouvres l’onglet.', 'Sur les quatre carrés et sur chaque rôle : demandes à valider, exercices, heures à vérifier.'] },
  R4: { q: 'Comment choisir ce que les membres voient de moi ?', line: 'Choisir ce que les membres voient de toi', who: () => has('bureau') || has('president'),
    why: 'Ta fonction fait de toi un contact du club : tu choisis si ton téléphone ou ton e-mail est affiché.',
    steps: ['Mon compte, cadre « Mes coordonnées de contact ».', 'Coche ton téléphone, ton e-mail, les deux ou rien.', '« Confirmer mon choix ».'], show: ['[data-act=account]', '#contactf'], auto: () => !!S.cstate?.confirmed },
  J1: { q: 'Où voir mon équipe ?', line: 'Voir ton équipe et ton coach', who: () => has('joueur'), why: 'Ta fiche, les prochains rendez-vous, les joueurs, les coachs et le contact de l’équipe.', steps: ['Onglet Équipe.', 'Avec plusieurs équipes, des boutons en haut pour passer de l’une à l’autre.'], show: [TAB(3)], visit: (v, t) => !v && t === 3 },
  J2: { q: 'Comment vérifier ma fiche ?', line: 'Vérifier ta fiche', who: () => has('joueur'), why: 'Le club doit pouvoir te joindre en cas d’urgence.', steps: ['Onglet Équipe, « Moi », touche ta ligne.', 'Contact d’urgence, licence et cotisation (ce que le club a noté).', '« Enregistrer » si tu changes quelque chose.'], show: [TAB(3), '[data-act=player]'] },
  P1: { q: 'Où est la fiche de mon enfant ?', line: () => `Vérifier la fiche de ${myKids()[0]?.first_name || 'ton enfant'}`, who: () => has('parent'),
    why: 'Le club doit pouvoir te joindre et savoir ce que tu autorises.',
    steps: ['Onglet Équipe : « Mon enfant » (ou « Mes enfants ») est en haut.', 'Touche sa ligne.', 'Vérifie le contact d’urgence et les autorisations : droit à l’image, rentre seul, soins d’urgence, covoiturage.', '« Enregistrer ». Le refus d’un parent pour l’image l’emporte.'], show: [TAB(3), '[data-act=player]'] },
  P2: { q: 'Où voir la licence et la cotisation de mon enfant ?', faq: true, who: () => has('parent'), why: 'Savoir ce qui est dû et réglé.', steps: ['Fiche de l’enfant, cadre « Licence et cotisation » : état de la licence, ce qui est dû, réglé, reste.'] },
  P3: { q: 'J’ai plusieurs enfants, ou l’autre parent veut répondre', faq: true, who: () => has('parent'), why: 'Chacun répond pour lui.', steps: ['Une réponse par personne de la famille. La réponse d’un enfant vaut pour ses deux parents.'] },
  P4: { q: 'On me demande mon enfant en renfort', faq: true, who: () => has('parent') || has('joueur'), why: 'Une autre équipe du club a besoin de lui.', steps: ['Une carte apparaît sur l’Accueil : « Accepter » ou « Refuser ». Un « non » de la famille l’emporte.', 'L’enfant garde son équipe et ne voit que les rendez-vous où le coach l’invite.'] },
  S1: { q: 'Comment suivre une équipe ?', line: 'Suivre une équipe', who: () => has('supporteur'), why: 'Voir ses matchs dans ton agenda.', steps: ['Onglet Club, « Les équipes du club ».', 'Touche l’équipe.', '« Suivre cette équipe » (« Ne plus suivre » pour arrêter).'], show: [TAB(4), '[data-act=team]'], auto: () => S.follows.length > 0 },
  S2: { q: 'Où voir les rendez-vous du club ?', line: 'Voir l’agenda du club', who: () => has('supporteur'), why: 'Les rendez-vous ouverts à tous et ceux des équipes suivies. Pas de réponse à donner.', steps: ['Onglet Agenda.'], show: [TAB(1)], visit: (v, t) => !v && t === 1 },
  S3: { q: 'Où lire les annonces ?', line: 'Lire les annonces', who: () => has('supporteur'), why: 'Les nouvelles du club.', steps: ['Onglet Messages, section « Annonces » (et sur l’Accueil).'], show: [TAB(2)] },
  C1: { q: 'Comment valider joueurs et parents ?', line: 'Valider les joueurs et les parents', who: () => has('coach'), why: 'Tant que tu n’as pas validé, la famille ne voit rien de l’équipe.',
    steps: ['Quatre carrés (Mes rôles).', '« Effectif » (ou onglet Équipe) : « Demandes à valider ».', 'Pour un parent, choisis la fiche de l’enfant si on te la demande.', '« Valider » ou « Refuser ».'], show: [ROLESBTN, '[data-tab=effectif]'], auto: () => S.members.some((m) => m.status === 'active' && m.role !== 'coach' && coachTids().includes(m.team_id)) && !toValidate().some((m) => coachTids().includes(m.team_id)) },
  C2: { q: 'Comment ajouter mes joueurs ?', line: 'Ajouter tes joueurs', who: () => has('coach'), why: 'Les familles retrouvent leur enfant et répondent pour lui.',
    steps: ['Mes rôles.', '« Ajouter des joueurs · [équipe] ».', 'Un par un, une liste copiée, un fichier Excel ou une photo.', 'Vérifie, puis « Valider l’import ».'], show: [ROLESBTN, '[data-act=import]'], auto: () => coachTids().some((t) => playersOfTeam(t).length > 0) },
  C3: { q: 'Comment créer les entraînements de la saison ?', line: 'Créer les entraînements', who: () => has('coach'), why: 'Une fois pour toute la saison : les familles reçoivent chaque séance.',
    steps: ['Mes rôles, onglet « Planifier ».', '« Nouveau rendez-vous ».', 'Type « Entraînement », « Date et heure », lieu.', 'Coche « Répéter chaque semaine (même jour, même heure) », remplis « Répéter jusqu’au », puis « Enregistrer ».'], show: [ROLESBTN, '[data-tab=planifier]', '[data-act=evnew]'], auto: () => myEventIds().size > 0 },
  C4: { q: 'Comment faire l’appel ?', line: 'Faire l’appel', who: () => has('coach'), why: 'Une séance sans appel ne compte pas dans les statistiques.',
    steps: ['Le jour J, en haut de l’Accueil (« Aujourd’hui ») : « Faire l’appel » ; sinon Mes rôles, onglet « Pointer ».', 'L’appel est déjà rempli avec les réponses : touche un joueur pour corriger.', '« Tout le monde présent » si tous sont là.', '« Terminer l’appel » : les non pointés passent absents.'], show: [ROLESBTN, '[data-tab=pointer]'],
    auto: () => S.att.some((a) => { const e = S.events.find((x) => x.id === a.event_id); return e && (e.team_ids || []).some(coachOf); }) },
  C5: { q: 'Comment choisir un contact d’équipe ?', line: 'Choisir un contact d’équipe', who: () => has('coach'), why: 'Un adulte qui peut créer et annuler les rendez-vous de l’équipe et voir les coordonnées des familles.',
    steps: ['« Effectif » (ou onglet Équipe), cadre « Contact de l’équipe ».', '« Choisir un adulte ».', '« Nommer contact ».'], show: [ROLESBTN, '[data-tab=effectif]'], auto: () => (S.tcontacts || []).some((c) => coachOf(c.team_id)) },
  C6: { q: 'Comment préparer une séance ?', line: 'Préparer une séance', who: () => has('coach'), why: 'Arriver avec les exercices prêts.', steps: ['Onglet « Préparer ».', 'Touche une séance « À préparer », ou « Composer une séance ».', 'Ajoute des exercices (« Ajouter un exercice » pour un nouveau).'], show: [ROLESBTN, '[data-tab=preparer]'] },
  C7: { q: 'Coach : relancer, renforts, aide coach, heures, annuler', faq: true, who: () => has('coach'), why: 'Les autres gestes du coach.',
    steps: ['Relancer ceux qui n’ont pas répondu : page du rendez-vous, cadre « Relance ».', 'Renforts : « Effectif », « Renforts », « Proposer un joueur » ; dans un rendez-vous, « Équipe seule », « Avec tous les renforts » ou « Renforts choisis ».', 'Aide coach : « Effectif », cadre « Aide coach » (joueur de 15 à 17 ans).', 'Mes heures : dans l’espace coach. Annuler ou supprimer : page du rendez-vous.'] },
  M1: { q: 'Comment écrire à un joueur mineur ?', faq: true, who: () => !onlySupporter(), why: 'Un adulte n’échange avec un mineur qu’avec un de ses parents.',
    steps: ['Crée le groupe avec le joueur : l’écran « Ajouter un parent » s’ouvre.', 'Choisis un parent inscrit, ou saisis l’e-mail d’un parent (jamais demandé à l’enfant).', 'La conversation s’ouvre quand le parent accepte (onglet Messages, « Demandes de conversation »). Refus ou 14 jours sans réponse : annulée.'] },
  F1: { q: 'Comment transférer une convocation reçue ?', faq: true, who: () => isBoard() || (S.tcontacts || []).some((c) => c.user_id === S.me.id), why: 'Faire suivre un match reçu d’un autre club à des personnes du club.',
    steps: ['Convocations reçues : « Transférer ».', 'Choisis les personnes : elles reçoivent une annonce avec le jour, l’heure et le lieu, sans le contact de l’autre club.', '« Rattacher » relie un match reçu à un rendez-vous déjà dans l’agenda.'] },
  B1: { q: 'Faire le tour de ma fonction', line: 'Faire le tour de ta fonction', who: () => has('bureau') && !fnHas('Trésorier', 'Trésorier adjoint', 'Secrétaire', 'Secrétaire adjoint', 'Correspondant rencontres'),
    why: 'Chaque espace s’ouvre sur « Aperçu » : ce qui est à faire, puis tes droits.', steps: ['Mes rôles, puis ta fonction.', 'Lis l’« Aperçu », puis ouvre chaque onglet.'], show: [ROLESBTN] },
  TR1: { q: 'Comment fixer les tarifs ?', line: 'Fixer les tarifs de la saison', who: () => fnHas('Trésorier', 'Trésorier adjoint'), why: 'Le montant dû par chaque joueur se calcule tout seul (tarif de son équipe ou de sa catégorie, moins sa réduction).',
    steps: ['Mes rôles › Trésorier, onglet « Tarifs ».', '« Pour » : une catégorie, ou une équipe.', '« Montant (€) » et, si tu veux, « dont part fédération (€) ».', '« Ajouter ce tarif ». Plus vite : colle une grille ou choisis un fichier, puis « Vérifier ».'], show: [ROLESBTN], auto: () => S.fees.length > 0 },
  TR2: { q: 'Comment noter un versement ?', line: 'Noter un versement', who: () => fnHas('Trésorier', 'Trésorier adjoint'), why: 'La fiche du joueur passe à « Payée » et la famille le voit.',
    steps: ['Onglet « Cotisations » (filtre « Reste à payer »).', 'Touche le joueur.', 'Cadre « Ajouter un versement » : montant, moyen.', '« Ajouter le versement ». Le justificatif pour un comité d’entreprise se télécharge ensuite sur la même fiche.'], show: [ROLESBTN], auto: () => S.payments.length > 0 },
  TR3: { q: 'Comment relancer les cotisations ?', line: 'Relancer les cotisations non réglées', who: () => fnHas('Trésorier', 'Trésorier adjoint'), why: 'Un rappel dans l’application à chaque famille qui doit encore.',
    steps: ['Onglet « Cotisations ».', '« Relancer toutes les cotisations non réglées », puis « Confirmer ». Une famille déjà relancée cette semaine est sautée.'], show: [ROLESBTN] },
  TR4: { q: 'Trésorerie : export, heures des coachs, justificatif', faq: true, who: () => isPresident() || hasArea('tresorerie'), why: 'Les autres gestes de la trésorerie.',
    steps: ['Exporter : « Cotisations », « Exporter la liste des cotisations (Excel) ».', 'Heures des coachs : « Vérification des heures », puis « Relevés, taux et montants ».', 'Justificatif pour un comité d’entreprise : fiche du joueur, cadre « Licence et cotisation », « Justificatif d’adhésion (PDF) ». Seulement pour les versements notés.'] },
  SE1: { q: 'Comment valider les demandes ?', line: 'Valider les demandes', who: () => fnHas('Secrétaire', 'Secrétaire adjoint'), why: 'Tu valides joueurs, parents et supporteurs de toutes les équipes, et les coachs ; le bureau, c’est le président.',
    steps: ['Mes rôles › Secrétaire : les demandes sont en haut de l’« Aperçu ».', '« Valider » ou « Refuser ».'], show: [ROLESBTN], auto: () => !toValidate().length && S.members.length > 3 },
  SE2: { q: 'Comment importer la liste des licenciés ?', line: 'Importer la liste des joueurs', who: () => fnHas('Secrétaire', 'Secrétaire adjoint'), why: 'Toute la saison d’un coup, sans tout taper.',
    steps: ['Onglet « Import / export », « Ajouter des joueurs » : choisis l’équipe.', '« Coller une liste » ou choisis un fichier Excel ou CSV (le plus fiable).', '« Vérifier la liste » : retire les lignes fausses.', '« Valider l’import ».'], show: [ROLESBTN], auto: () => S.players.length > 0 },
  SE3: { q: 'Comment suivre les licences ?', line: 'Mettre les licences à jour', who: () => fnHas('Secrétaire', 'Secrétaire adjoint') || fnHas('Correspondant licences'), why: 'Savoir qui est vraiment licencié et assuré.',
    steps: ['Onglet « Licences » : filtres « Licence à finir », « Certificat manquant », « Date de naissance manquante ».', 'Touche un joueur.', 'Licence, numéro, « Certificat ou questionnaire de santé fourni » (oui ou non, jamais le document).', '« Enregistrer ». Sans date de naissance, le joueur est traité comme mineur.'], show: [ROLESBTN] },
  CR1: { q: 'Comment compléter les matchs ?', line: 'Ajouter les gymnases des matchs', who: () => fnHas('Correspondant rencontres'), why: 'Une convocation sans gymnase ne peut pas partir.',
    steps: ['Onglet « Rencontres » : les matchs des 60 prochains jours.', 'Touche une rencontre, « Modifier ».', '« Lieu », puis « Enregistrer les changements ».'], show: [ROLESBTN] },
  CR2: { q: 'Comment convoquer les clubs reçus ?', line: 'Envoyer une convocation', who: () => fnHas('Correspondant rencontres'), why: 'Un seul document pour toutes les rencontres à domicile du week-end : d’abord la pré-convocation, puis la convocation.',
    steps: ['Onglet « Convocations », « Matchs à domicile à convoquer » : touche une rencontre.', 'Cadre « Convocation des clubs reçus » : « Pré-convocation » ou « Convocation ».', 'Choisis les destinataires (club trouvé dans mypocketclub, sinon une adresse e-mail).', '« Envoyer à tous », puis « Confirmer l’envoi ». Sinon : « Imprimer ou enregistrer le PDF ».'], show: [ROLESBTN] },
  CR3: { q: 'Comment trouver des bénévoles ?', line: 'Remplir les missions de bénévoles', who: () => fnHas('Correspondant rencontres'), why: 'Table de marque, arbitrage, buvette : chacun choisit ses missions depuis l’Accueil.',
    steps: ['Onglet « Bénévoles », « Missions par défaut du club », « Enregistrer ».', '« Places à pourvoir » : « Ajouter les missions par défaut » sur une rencontre.', '« Relancer » s’il manque du monde.'], show: [ROLESBTN] },
  PR1: { q: 'Président : comment valider les demandes ?', line: 'Valider les demandes', who: () => isPresident(), why: 'Toi seul valides les membres du bureau.', steps: ['Mes rôles › Président › « Demandes ».', '« Valider » ou « Refuser ».'], show: [ROLESBTN], auto: () => !toValidate().length && S.members.length > 3 },
  PR2: { q: 'Comment donner les fonctions du bureau ?', line: 'Donner les fonctions du bureau', who: () => isPresident(), why: 'Une personne par fonction : chacune reçoit les accès qui vont avec.',
    steps: ['Mes rôles › Président, onglet « Fonctions du bureau ».', '« Nommer quelqu’un » : le membre, puis la fonction.', 'Rôle « Autre » possible : nom libre, accès choisis parmi les cinq (jamais l’accès Président).'], show: [ROLESBTN], auto: () => S.members.some((m) => m.status === 'active' && m.role === 'bureau' && m.user_id !== S.me.id) },
  PR3: { q: 'Comment créer les équipes ?', line: 'Créer les équipes', who: () => isPresident(), why: 'Les familles et les coachs choisissent leur équipe en rejoignant le club.', steps: ['Mes rôles › Président, « Vue d’ensemble ».', '« Ajouter une équipe ou des joueurs » › « Créer une équipe ».'], show: [ROLESBTN], auto: () => S.teams.length > 0 },
  PR4: { q: 'Comment régler le club ?', line: 'Régler le club', who: () => isPresident(), why: 'Logo, couleurs, recherche des clubs, droits de chacun, saison.', steps: ['Mes rôles › Président, onglet « Réglages ».', '« Apparaître dans la recherche des clubs », logo et couleurs, droits, saison.'], show: [ROLESBTN] },
  PR5: { q: 'Président : abonnement, présidence, journal, suppression', faq: true, who: () => isPresident(), why: 'Les gestes rares du président.',
    steps: ['Ce que le club paiera : « Réglages », cadre « Ton club chez mypocketclub ».', 'Transférer la présidence ou supprimer le club : « Réglages », « Zone sensible ».', 'Le journal : onglet « Journal » (qui a fait quoi).', 'Supprimer le compte d’un joueur : sa fiche (30 jours à la corbeille).'] },
};
const txt = (v) => (typeof v === 'function' ? v() : v);
const isDone = (id, d = doneSet()) => d.has(id) || !!FICHES[id]?.auto?.();

// ---------- les blocs de l'encart ----------
function blocks() {
  const out = [], used = new Set(), fresh = (m) => m.created_at && Date.now() - new Date(m.created_at) < 14 * 864e5;
  const add = (key, title, ids, m) => {
    const l = ids.filter((id) => FICHES[id] && !FICHES[id].faq && (!FICHES[id].who || FICHES[id].who()) && !used.has(id));
    l.forEach((id) => used.add(id));
    if (l.length) out.push({ key, title, ids: l, isNew: !!(m && fresh(m)) });
  };
  add('tel', 'Ton téléphone', standalone() ? ['T2'] : ['T1', 'T2']);
  const seen = new Set();
  for (const m of active()) {
    const k = m.role + (m.role === 'bureau' ? ':' + (m.fonction || '') : ''); if (seen.has(k)) continue; seen.add(k);
    const f = m.fonction || '';
    if (m.role === 'president') add(k, 'Président', ['R1', 'PR1', 'PR2', 'PR3', 'PR4', 'R4'], m);
    else if (m.role === 'coach') add(k, 'Coach' + (m.team_id ? ' · ' + teamName(m.team_id) : ''), ['R1', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'], m);
    else if (m.role === 'bureau') {
      const ids = /^Trésorier/.test(f) ? ['TR1', 'TR2', 'TR3'] : /^Secrétaire/.test(f) ? ['SE1', 'SE2', 'SE3'] : f === 'Correspondant rencontres' ? ['CR1', 'CR2', 'CR3'] : f === 'Correspondant licences' ? ['SE3'] : ['B1'];
      add(k, f === 'Correspondant rencontres' ? 'Contact rencontres' : f === 'Correspondant licences' ? 'Contact licences' : f || 'Membre du bureau', ['R1', 'R4', ...ids], m);
    } else if (m.role === 'parent') add(k, 'Parent', ['P1', 'T3', 'T4', 'K5'], m);
    else if (m.role === 'joueur') add(k, 'Joueur', ['J1', 'T3', 'T4', 'J2', 'K5'], m);
    else if (m.role === 'supporteur') add(k, 'Supporteur', ['S1', 'S2', 'S3', 'K5'], m);
  }
  add('moi', 'Ton compte', ['K1']);
  // un rôle reçu ces 14 derniers jours passe en tête, marqué « Nouveau »
  const tel = out.filter((b) => b.key === 'tel'), rest = out.filter((b) => b.key !== 'tel');
  return [...rest.filter((b) => b.isNew), ...tel, ...rest.filter((b) => !b.isNew)];
}
export const obActive = () => {
  if (!S.me || !S.clubId || meta().hidden) return false;
  const d = doneSet(); return blocks().some((b) => b.ids.some((id) => !isDone(id, d)));
};

function line(id, d) {
  const f = FICHES[id], ok = isDone(id, d);
  return `<button class="row" data-act="obfiche" data-id="${id}"><span class="obck ${ok ? 'on' : ''}" aria-hidden="true">${ok ? '✓' : ''}</span><span class="g" style="${ok ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(txt(f.line))}</span><span class="chev"></span></button>`;
}
hooks.obHome = () => {
  if (!obActive()) return '';
  const d = doneSet(), bl = blocks(), all = bl.flatMap((b) => b.ids), n = all.filter((id) => isDone(id, d)).length;
  return `<div class="card lift obcard" data-ob="1"><div style="display:flex;align-items:baseline;gap:8px"><span class="kick" style="flex:1">Pour bien démarrer</span><span class="det">${n} sur ${all.length}</span></div>
  ${bl.map((b) => { const more = (S.obMore || {})[b.key], l = more ? b.ids : b.ids.slice(0, 5);
    return `<div class="obblk"><b>${esc(b.title)}${b.isNew ? ' <span class="pill wait">Nouveau</span>' : ''}</b><div class="list">${l.map((id) => line(id, d)).join('')}</div>${b.ids.length > 5 && !more ? `<button class="linkbtn" data-act="obmore" data-v="${b.key}">Voir les ${b.ids.length - 5} autres</button>` : ''}</div>`; }).join('')}
  <div class="btns"><button class="btn small ghost" data-act="obhide">Masquer</button></div><p class="note" style="margin:0">Tu le retrouves dans Mon compte › Aide.</p></div>`;
};

// ---------- la fiche ----------
function fichePage(id) {
  const f = FICHES[id]; if (!f) return '<p class="empty">Fiche introuvable.</p>';
  const ok = isDone(id), extra = txt(f.extra) || '';
  const shot = SHOTS.has(id) ? `<figure class="obshot"><button type="button" data-act="obzoom" data-id="${id}" aria-label="Agrandir la capture"><picture><source media="(min-width:960px)" srcset="img/faq/${id}-pc.jpg"><img src="img/faq/${id}-tel.jpg" alt="Capture de l’écran : ${esc(f.q)}" loading="lazy"></picture></button><figcaption class="note">L’écran, zone à toucher en jaune${/Mobi|Android|iPhone/i.test(navigator.userAgent) ? ' · touche pour agrandir' : ''}</figcaption></figure>` : '';
  return `<div class="card lift"><div class="kick">À quoi ça sert</div><p style="margin:0">${esc(f.why)}</p></div>
  <div class="card"><div class="kick">Comment faire</div><ol class="obsteps">${f.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${shot}</div>
  <div class="btns">${f.show ? `<button class="btn main" data-act="obshow" data-id="${id}">Me montrer</button><button class="btn ghost" data-act="obgo" data-id="${id}">Y aller</button>` : ''}${extra}
  ${f.line ? (ok ? `<button class="btn ghost" data-act="obundo" data-id="${id}">Pas encore fait</button>` : `<button class="btn ${f.show ? 'ghost' : 'main'}" data-act="obdone" data-id="${id}">C’est fait</button>`) : ''}</div>`;
}
V310_VIEWS.obfiche = (v) => ({ head: header({ back: true, kicker: FICHES[v.id]?.faq ? 'Aide' : 'Pour bien démarrer', title: esc(FICHES[v.id]?.q || 'Aide') }), body: fichePage(v.id) });

// ---------- FAQ (Mon compte › Aide) ----------
function faqPage() {
  const l = Object.entries(FICHES).filter(([, f]) => !f.who || f.who());
  const q = (S.faqQ || '').toLowerCase(), shown = l.filter(([, f]) => !q || (f.q + ' ' + f.steps.join(' ')).toLowerCase().includes(q));
  return `<div class="btns"><button class="btn ghost" data-act="guide">Installer et notifications</button>${meta().hidden ? '<button class="btn ghost" data-act="obshowcard">Revoir « Pour bien démarrer »</button>' : ''}</div>
  <div class="field"><label for="faqq">Chercher une question</label><input id="faqq" type="search" data-faqq="1" value="${esc(S.faqQ || '')}" placeholder="Ex. appel, notifications, cotisation"></div>
  <div class="card"><div class="list">${shown.map(([id, f]) => `<button class="row" data-act="obfiche" data-id="${id}"><span class="g">${esc(f.q)}</span><span class="chev"></span></button>`).join('') || '<p class="empty">Aucune question ne correspond.</p>'}</div></div>
  <p class="note">Une question sans réponse ? Écris à ${esc(BRAND.contact)}.</p>`;
}
V310_VIEWS.faq = () => ({ head: header({ back: true, kicker: 'Mon compte', title: 'Aide' }), body: faqPage() });
hooks.helpAccount = () => `<button class="btn ghost" data-act="faq">${icon('msg', 20)}Aide : questions et « Pour bien démarrer »</button>`;

// ---------- « Me montrer » : un bouton entouré par écran ----------
let showBar = null;
// premier élément visible qui correspond (sur ordinateur, les quatre carrés sont cachés : c'est le bloc « Mes rôles »)
const seen = (sel) => [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null || x.getClientRects().length) || null;
function clearShow() { document.querySelectorAll('.ob-hl').forEach((x) => x.classList.remove('ob-hl')); if (showBar) { showBar.remove(); showBar = null; } }
// 5.7.0 · n° 206 : bandeau jaune ; sur ordinateur, panneau vertical avec toutes les étapes de la fiche
function barHtml(f, j, found) {
  const n = f.show.length, cur = Math.min(j, n - 1);
  const head = found ? (cur + 1 < n ? `Étape ${cur + 1} sur ${n} · touche la zone jaune` : 'Dernière étape · touche la zone jaune') : `Étape ${cur + 1} sur ${n} · ${esc(f.steps[Math.min(cur, f.steps.length - 1)])}`;
  return `<div class="obbar-q">${esc(f.q)}</div><b class="obbar-now">${head}</b><ol class="obbar-steps">${f.steps.map((t, k) => `<li class="${k === cur ? 'on' : k < cur ? 'done' : ''}">${esc(t)}</li>`).join('')}</ol><button data-act="obstop" class="btn small ink">Arrêter</button>`;
}
function paintShow() {
  clearShow();
  const s = S.obShow; if (!s) return;
  const f = FICHES[s.id]; if (!f?.show) { S.obShow = null; return; }
  // l'étape la plus avancée visible à l'écran (la personne a peut-être déjà touché le bouton d'avant)
  let j = -1; for (let k = f.show.length - 1; k >= s.i; k--) { if (seen(f.show[k])) { j = k; break; } }
  showBar = document.createElement('div'); showBar.className = 'obbar';
  // sur ordinateur, le bandeau vertical se range dans la colonne de gauche, sous les onglets et « Mes rôles »
  const side = innerWidth >= 960 && document.querySelector('.tb');
  if (side) showBar.classList.add('side');
  const put = () => (side ? side.appendChild(showBar) : document.body.appendChild(showBar));
  if (j < 0) { showBar.innerHTML = barHtml(f, s.i, false); put(); return; }
  s.i = j;
  const el = seen(f.show[j]); el.classList.add('ob-hl'); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  showBar.innerHTML = barHtml(f, j, true);
  put();
  el.addEventListener('click', () => { if (S.obShow) { S.obShow.i = j + 1; if (S.obShow.i >= f.show.length) { S.obShow = null; setTimeout(clearShow, 50); } } }, { once: true, capture: true });
}
// 5.7.0 · n° 206 : « Y aller » refait les étapes à la place de la personne et entoure la dernière zone
const tick = () => new Promise((r) => setTimeout(r, 120));
export async function goFiche(id) {
  const f = FICHES[id]; if (!f?.show) return false;
  S.obShow = { id, i: 0 }; S.view = null; S.stack = []; S.tab = 0; S.noStack = true; render(); await tick();
  for (let k = 0; k < f.show.length - 1; k++) {
    const el = seen(f.show[k]); if (!el) break;
    el.click(); await tick(); await tick();
  }
  const last = seen(f.show[f.show.length - 1]);
  if (S.obShow) { S.obShow.i = f.show.length - 1; paintShow(); }
  return !!last;
}
hooks.obAfter = () => {
  // coches automatiques à la visite (ouvrir un groupe, l'onglet Équipe, son espace…)
  const d = doneSet(); let add = [];
  for (const [id, f] of Object.entries(FICHES)) if (f.visit && !d.has(id) && f.visit(S.view, S.tab)) add.push(id);
  if (add.length && S.me) saveMeta({ done: [...d, ...add] });
  setTimeout(paintShow, 0);
};

Object.assign(ACTIONS, {
  obfiche: (el, d) => { S.obShow = null; clearShow(); S.view = { type: 'obfiche', id: d.id }; render(); }, // 5.7.0 · n° 206 : plus de reste de « Me montrer »
  obmore: (el, d) => { S.obMore = { ...(S.obMore || {}), [d.v]: true }; render(true); },
  obdone: (el, d) => { S.obShow = null; clearShow(); saveMeta({ done: [...doneSet(), d.id] }); toast('C’est noté.'); const v = (S.stack || []).pop() || null; S.view = v; S.noStack = true; render(); },
  obundo: (el, d) => { S.obShow = null; clearShow(); const s = doneSet(); s.delete(d.id); saveMeta({ done: [...s] }); render(true); },
  obhide: () => { saveMeta({ hidden: true }); toast('Masqué. Tu le retrouves dans Mon compte › Aide.'); render(true); },
  obshowcard: () => { saveMeta({ hidden: false }); S.view = null; S.stack = []; S.tab = 0; render(); },
  obshow: (el, d) => { S.obShow = { id: d.id, i: 0 }; S.view = null; S.stack = []; S.tab = 0; S.noStack = true; render(); },
  obstop: () => { S.obShow = null; clearShow(); },
  faq: () => { S.obShow = null; clearShow(); S.faqQ = ''; S.view = { type: 'faq' }; render(); },
  obgo: async (el, d) => { if (!(await goFiche(d.id))) toast('Cet écran n’est pas accessible avec tes rôles actuels.'); },
  obzoom: (el, d) => {
    if (innerWidth >= 960) return;
    const z = document.createElement('div'); z.className = 'obzoom'; z.setAttribute('role', 'dialog'); z.setAttribute('aria-label', 'Capture agrandie');
    z.innerHTML = `<img src="img/faq/${d.id}-tel.jpg" alt=""><button class="btn ink small">Fermer</button>`;
    z.addEventListener('click', () => z.remove()); document.body.appendChild(z);
  },
});
document.addEventListener('input', (e) => { if (e.target?.dataset?.faqq) { S.faqQ = e.target.value; render(true); const n = document.getElementById('faqq'); if (n) { n.focus(); const p = n.value.length; try { n.setSelectionRange(p, p); } catch { /* */ } } } });

// ---------- n° 164 · justificatif d'adhésion (comité d'entreprise) ----------
// 5.7.0 : le bouton de la fiche joueur ouvre le formulaire du n° 204 (js/v57.js)
const eur = (n) => (+n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
export function attestationPdf(d, now = new Date()) {
  const pdf = new Pdf(), L = 20, R = 190, W = R - L; let y = 30;
  pdf.text(L, y, d.club, { size: 18, bold: true }); y += 7;
  if (d.city) { pdf.text(L, y, d.city, { size: 10, color: '#4A5068' }); y += 6; }
  pdf.text(L, y, 'Association sportive · ' + (d.sport || ''), { size: 10, color: '#4A5068' }); y += 18;
  pdf.text(105, y, 'JUSTIFICATIF D’ADHÉSION', { size: 15, bold: true, align: 'center' }); y += 7;
  pdf.text(105, y, 'Saison ' + d.season, { size: 11, align: 'center', color: '#4A5068' }); y += 16;
  const who = `${d.first_name} ${d.last_name}`, born = d.birth_date ? ', né(e) le ' + new Date(d.birth_date).toLocaleDateString('fr-FR') : '';
  y = pdf.para(L, y, `Je soussigné(e) ${d.signer}, ${d.signer_role.toLowerCase()} de l’association ${d.club}, atteste que ${who}${born}, est adhérent(e) de l’association pour la saison ${d.season}${d.team ? ' (équipe ' + d.team + ')' : ''}.`, W, { size: 11 }) + 6;
  y = pdf.para(L, y, `Au titre de cette adhésion, la somme totale de ${eur(d.paid)} a été versée à l’association :`, W, { size: 11 }) + 4;
  for (const x of d.payments || []) { pdf.text(L + 6, y, `· ${new Date(x.paid_at).toLocaleDateString('fr-FR')} : ${eur(x.amount)}${x.method ? ' (' + x.method + ')' : ''}`, { size: 10.5 }); y += 6; }
  y += 6;
  y = pdf.para(L, y, 'Attestation délivrée à la demande de l’intéressé(e) ou de son représentant légal, pour servir et valoir ce que de droit, notamment auprès d’un comité social et économique.', W, { size: 10.5, color: '#4A5068' }) + 14;
  pdf.text(L, y, `Fait le ${now.toLocaleDateString('fr-FR')}`, { size: 11 }); y += 8;
  pdf.text(L, y, `${d.signer}, ${d.signer_role.toLowerCase()}`, { size: 11, bold: true }); y += 6;
  pdf.text(L, y, 'Signature et cachet de l’association :', { size: 10, color: '#4A5068' });
  pdf.rect(L, y + 3, 70, 28, null, '#D8DCEA');
  pdf.text(L, 285, `Document établi avec ${BRAND.name} à partir des versements notés par le club.`, { size: 8.5, color: '#4A5068' });
  return pdf.bytes();
}
