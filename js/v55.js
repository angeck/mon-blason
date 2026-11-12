// mypocketclub · alpha 5.5.0 · onboarding « Pour bien démarrer » et FAQ (document claude/16-onboarding-fiches.md, piste B,
// décisions de Gaël du 12 novembre 2026). Une fiche sert deux fois : ligne de l'encart et question de la FAQ (Mon compte › Aide).
// Progression gardée dans les métadonnées du compte (clé « onboarding », comme le thème) : même liste sur tous les appareils.
// N° 164 : justificatif d'adhésion pour un comité d'entreprise (PDF délivré par le président ou la trésorerie).
// 5.8.0 (n° 208) : « Me montrer » suit toutes les étapes de la fiche, sur le bon rôle ; menu des rôles pour le président ; FAQ par profil.
import { BRAND } from '../config.js';
import {
  S, sb, esc, hooks, run, toast, render, ACTIONS, active, isBoard, isPresident, hasArea, coachOf, coachTeams, toValidate, playersOfTeam,
  myFonctions, isMajor, myKids, mySelf, teamName, pl, pname, download, plural, casquettes, isCoachCasq,
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

// ---------- sélecteurs de « Me montrer » ----------
// 5.8.0 · n° 208 e : l'onglet du bas seulement (le raccourci « Agenda » de l'Accueil a le même data-act)
const TAB = (i) => `.tb > nav [data-act=tab][data-i="${i}"]`;
const ACC = '[data-act=account]';
const FTAB = (...v) => v.map((x) => `[data-act=ftab][data-v="${x}"]`).join(', ');
const PTAB = (v) => `[data-act=ptab][data-v="${v}"]`;
const TS = (t) => `.hd [data-act=tsgo][data-tab="${t}"]`;
const HUB = '[data-act=tsopen]'; // coach de plusieurs équipes : la liste des équipes
// 5.8.0 · n° 208 g : le rôle de la fiche (Trésorier, Secrétaire…), pas le premier de la liste
const RK = {
  any: () => true, coach: isCoachCasq, pres: (k) => k === 'president', tres: (k) => /^f:Trésorier/.test(k), sec: (k) => /^f:Secrétaire/.test(k),
  seclic: (k) => /^f:Secrétaire/.test(k) || k === 'f:Correspondant licences', ren: (k) => k === 'f:Correspondant rencontres', dt: (k) => k === 'f:Directeur technique',
  bur: (k) => k.startsWith('f:'),
};
const keyOf = (w) => casquettes().find((x) => w(x.k))?.k;
// téléphone : les quatre carrés, puis le rôle dans la rangée « Mes rôles » (si un autre rôle s'est ouvert) ; ordinateur : le rôle à gauche
const ROLE = (w) => () => { const k = keyOf(w); if (!k) return null; const q = `[data-act=casq][data-v="${k}"]`; return `[data-act=espace], .tb nav.roles ${q}, .hd .casq ${q}[aria-selected=false]`; };

// ---------- les fiches (textes du document 16) ----------
// show : [sélecteur, n° de l'étape de « Comment faire », options] ; options « z » = une zone (« Y aller » ne la touche pas),
// « + » = sur le même écran que la ligne d'avant (on avance au toucher). auto : coche automatique ; faq : FAQ seulement.
// role : le rôle dont la fiche a besoin pour « Me montrer ». 5.8.0 · n° 208 h : « Me montrer » suit toutes les étapes.
export const FICHES = {
  T1: { q: 'Comment installer mypocketclub sur mon téléphone ?', line: () => (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Installer l’appli sur ton téléphone · 1 min' : 'Mettre l’appli sur ton téléphone'),
    why: 'L’appli s’ouvre depuis une icône, comme les autres, et peut te prévenir des rendez-vous. Sur iPhone, c’est obligatoire pour recevoir les notifications.',
    steps: ['iPhone (Safari) : Partager, puis « Sur l’écran d’accueil », puis « Ajouter ».', 'Android (Chrome) : menu ⋮, puis « Installer l’application ».', 'Samsung Internet : menu ≡, « Ajouter la page à », « Écran d’accueil ».', 'Ordinateur : icône d’installation dans la barre d’adresse.'],
    extra: '<button class="btn main" data-act="guide">Ouvrir le guide pas à pas</button>', auto: () => standalone() },
  T2: { q: 'Comment recevoir les notifications ?', line: () => (N.state === 'ios-install' ? 'Activer les notifications (installe d’abord l’appli)' : 'Activer les notifications'),
    why: 'Être prévenu d’un nouveau rendez-vous, d’un changement, d’un rappel ou d’une annonce, même appli fermée. Une seule fois par appareil, pour tous tes clubs.',
    steps: ['Touche la silhouette en haut à droite (Mon compte).', 'Descends jusqu’à « Notifications ».', 'Touche « Activer les notifications ».', 'Dans la fenêtre du téléphone, touche « Autoriser ». Si elles sont bloquées : réglages du téléphone ou du navigateur, puis Notifications, puis mypocketclub.'],
    extra: () => (N.state === 'off' ? '<button class="btn main" data-act="pushon">Activer maintenant</button>' : ''),
    show: [[ACC, 0], ['[data-anchor=push]', 1, 'z'], ['main.bd [data-act=pushon]', 2, '+']], auto: () => N.state === 'on' },
  T3: { q: 'Comment dire si je viens ?', line: 'Répondre à un rendez-vous', who: () => realRole(),
    why: 'Le coach sait qui vient ; ta réponse remplit l’appel.',
    steps: ['Sur l’Accueil, la carte jaune « À répondre » ; sinon l’onglet Agenda (la pastille compte les réponses à donner).', 'Touche « Je viens » ou « Je ne viens pas » (pour un enfant : « Léo vient » ; pour un événement : « Je participe »).', 'Tu peux changer ta réponse en touchant l’autre bouton.'],
    show: [[TAB(1), 0], ['.pair', 1, 'z']], auto: () => S.resp.some((r) => r.user_id === S.me.id) },
  T4: { q: 'Comment lire et écrire dans un groupe ?', line: 'Lire le groupe de ton équipe', who: () => !onlySupporter(),
    why: 'Échanger avec l’équipe et le coach sans donner son numéro. Un mineur n’est jamais dans un groupe libre avec un adulte sans son parent ; « Signaler » sur un message gênant.',
    steps: ['Onglet Messages (la pastille compte les messages non lus).', 'Touche le groupe.', 'Écris en bas et envoie.'], show: [[TAB(2), 0], ['[data-act=group]', 1], ['#msgf', 2, 'z']], visit: (v) => v?.type === 'group' },
  T5: { q: 'Comment changer de club ou en rejoindre un autre ?', faq: true,
    why: 'Un même compte peut être dans plusieurs clubs.',
    steps: ['Rejoindre : la loupe en haut (« Chercher un club »), le nom du club, sa ville ou son code postal, puis « Chercher ».', 'Touche le club, puis « Rejoindre ce club », et choisis ton profil (supporteur : accès immédiat).', 'Changer : sur l’Accueil, bloc « Changer de club » ; ou Mon compte › « Mes clubs et profils ».'] },
  K1: { q: 'Comment compléter mon profil ?', line: 'Compléter ton profil',
    why: 'Ton pseudo s’affiche dans les groupes ; ton téléphone est visible de l’encadrement et des familles concernées.',
    steps: ['Mon compte (silhouette en haut à droite).', '« Mon profil » : prénom, nom, pseudo, téléphone (l’e-mail ne se change pas ici).', '« Enregistrer mon profil ».'],
    show: [[ACC, 0], ['#proff', 1, 'z'], ['#proff [type=submit]', 2, '+']], auto: () => !!S.me.phone },
  K2: { q: 'Comment demander un autre rôle ?', faq: true,
    why: 'Joueur, parent, coach ou membre du bureau dans une autre équipe du club : chaque rôle est validé par le club.',
    steps: ['Mon compte, bouton « Demander un autre rôle ».', 'Choisis : Supporteur, Parent de joueur, Joueur, Coach, Membre du bureau, puis complète (enfant, équipe, fonction).', '« Envoyer la demande ». Supporteur : immédiat. Joueur et parent : le coach, le bureau ou le président. Coach : le président, le directeur technique ou le secrétariat. Bureau : le président.'] },
  K3: { q: 'Comment passer en thème sombre ?', faq: true, why: 'Pour lire le soir ou économiser la batterie.', steps: ['Mon compte › « Apparence » : « Comme mon téléphone », « Clair » ou « Sombre ». Le choix est gardé dans ton compte.'] },
  K4: { q: 'Où sont mes accords ?', faq: true, why: 'Droit à l’image et e-mails d’information : tu les changes quand tu veux.', steps: ['Mon compte › « Mes accords ». Pour un enfant, le droit à l’image est sur sa fiche. Les e-mails nécessaires (convocations, sécurité) partent toujours.'] },
  K5: { q: 'Comment devenir bénévole ?', line: 'Devenir bénévole', who: () => adult() && (has('parent') || has('joueur') || has('supporteur')),
    why: 'Le club compte sur ses membres pour la table de marque, l’arbitrage, la buvette. Tu choisis tes missions.',
    steps: ['Touche la silhouette en haut à droite (Mon compte).', 'Descends jusqu’au cadre « Bénévolat ».', 'Coche « Je participe au bénévolat du club ».', 'Ensuite, les missions (table de marque, buvette…) apparaissent sur les rendez-vous et sur l’Accueil : touche « Je prends » sur celles qui te vont.', 'Supporteur : possible seulement si ton club l’a ouvert aux supporteurs. Le bénévolat est réservé aux adultes.'],
    show: [[ACC, 0], ['[data-anchor=benevolat]', 1, 'z'], ['[data-anchor=benevolat] label.check', 2, 'z+']], auto: () => S.me.volunteer === true || S.me.supporter_volunteer === true },
  K6: { q: 'Comment quitter un club ?', faq: true, why: 'Ton compte reste ; tu n’as plus accès à ce club.', steps: ['Mon compte › « Quitter [club] », puis « Confirmer ».'] },
  K7: { q: 'Mon téléphone est perdu, ou je veux changer mon mot de passe', faq: true, why: 'Pour protéger ton compte.', steps: ['Mon compte › « Sécurité » : « Me déconnecter de tous les appareils » (deux touches), la liste des appareils connus, « Changer mon mot de passe ».'] },
  K8: { q: 'Comment récupérer ou supprimer mes données ?', faq: true, why: 'Tes données t’appartiennent.', steps: ['Mon compte › « Mes données » : « Télécharger mes données » (un fichier).', '« Supprimer mon compte » (deux touches) : tu es retiré tout de suite des clubs ; 30 jours pour annuler en te reconnectant.'] },
  R1: { q: 'À quoi sert « Mes rôles » ?', line: 'Ouvrir ton espace (« Mes rôles »)', who: () => has('coach') || has('bureau') || has('president'),
    why: 'Les onglets du bas servent à consulter ; « Mes rôles » sert à agir : appel, séances, demandes, fonctions, réglages. Les pastilles jaunes sur « Mes rôles » comptent ce qui attend dans tes rôles.',
    steps: ['Touche « Mes rôles » en haut de l’écran (sur ordinateur : le bloc « Mes rôles » à gauche).', 'Avec plusieurs rôles, une rangée « Mes rôles » apparaît dans le bloc bleu : touche le rôle voulu.', 'En bas de l’espace d’un rôle, tu peux choisir de l’ouvrir directement.'],
    role: RK.any, show: [[ROLE(RK.any), 0], ['.hd .casq, .tb nav.roles', 1, 'z+']], visit: (v) => v?.type === 'espace' },
  R2: { q: 'Que veulent dire les pastilles jaunes ?', faq: true, why: 'Elles comptent ce qui t’attend.', steps: ['Sur un onglet : ce qui te concerne toi (Agenda : réponses à donner ; Messages : non lus). Elle s’efface quand tu ouvres l’onglet.', 'Sur « Mes rôles » et sur chaque rôle : demandes à valider, exercices, heures à vérifier.'] },
  R4: { q: 'Comment choisir ce que les membres voient de moi ?', line: 'Choisir ce que les membres voient de toi', who: () => has('bureau') || has('president'),
    why: 'Ta fonction fait de toi un contact du club : tu choisis si ton téléphone ou ton e-mail est affiché.',
    steps: ['Mon compte, cadre « Mes coordonnées de contact ».', 'Coche ton téléphone, ton e-mail, les deux ou rien.', '« Confirmer mon choix ».'],
    show: [[ACC, 0], ['#contactf', 1, 'z'], ['#contactf [type=submit]', 2, '+']], auto: () => !!S.cstate?.confirmed },
  J1: { q: 'Où voir mon équipe ?', line: 'Voir ton équipe et ton coach', who: () => has('joueur'), why: 'Ta fiche, les prochains rendez-vous, les joueurs, les coachs et le contact de l’équipe.', steps: ['Onglet Équipe.', 'Avec plusieurs équipes, des boutons en haut pour passer de l’une à l’autre.'], show: [[TAB(3), 0]], visit: (v, t) => !v && t === 3 },
  J2: { q: 'Comment vérifier ma fiche ?', line: 'Vérifier ta fiche', who: () => has('joueur'), why: 'Le club doit pouvoir te joindre en cas d’urgence.',
    steps: ['Onglet Équipe, « Moi », touche ta ligne.', 'Contact d’urgence, licence et cotisation (ce que le club a noté).', '« Enregistrer » si tu changes quelque chose.'],
    show: [[TAB(3), 0], ['[data-act=player]', 0], ['#plf', 1, 'z'], ['#plf [type=submit]', 2, '+']] },
  P1: { q: 'Où est la fiche de mon enfant ?', line: () => `Vérifier la fiche de ${myKids()[0]?.first_name || 'ton enfant'}`, who: () => has('parent'),
    why: 'Le club doit pouvoir te joindre et savoir ce que tu autorises.',
    steps: ['Onglet Équipe : « Mon enfant » (ou « Mes enfants ») est en haut.', 'Touche sa ligne.', 'Vérifie le contact d’urgence et les autorisations : droit à l’image, rentre seul, soins d’urgence, covoiturage.', '« Enregistrer ». Le refus d’un parent pour l’image l’emporte.'],
    show: [[TAB(3), 0], ['[data-act=player]', 1], ['#plf', 2, 'z'], ['#plf [type=submit]', 3, '+']] },
  P2: { q: 'Où voir la licence et la cotisation de mon enfant ?', faq: true, who: () => has('parent'), why: 'Savoir ce qui est dû et réglé.', steps: ['Fiche de l’enfant, cadre « Licence et cotisation » : état de la licence, ce qui est dû, réglé, reste.'] },
  P3: { q: 'J’ai plusieurs enfants, ou l’autre parent veut répondre', faq: true, who: () => has('parent'), why: 'Chacun répond pour lui.', steps: ['Une réponse par personne de la famille. La réponse d’un enfant vaut pour ses deux parents.'] },
  P4: { q: 'On me demande mon enfant en renfort', faq: true, who: () => has('parent') || has('joueur'), why: 'Une autre équipe du club a besoin de lui.', steps: ['Une carte apparaît sur l’Accueil : « Accepter » ou « Refuser ». Un « non » de la famille l’emporte.', 'L’enfant garde son équipe et ne voit que les rendez-vous où le coach l’invite.'] },
  S1: { q: 'Comment suivre une équipe ?', line: 'Suivre une équipe', who: () => has('supporteur'), why: 'Voir ses matchs dans ton agenda.',
    steps: ['Onglet Club, cadre « Équipes ».', 'Touche l’équipe.', '« Suivre cette équipe » (« Ne plus suivre » pour arrêter).'],
    show: [[TAB(4), 0], ['[data-act=team]', 1], ['[data-act=follow]', 2, '+']], auto: () => S.follows.length > 0 },
  S2: { q: 'Où voir les rendez-vous du club ?', line: 'Voir l’agenda du club', who: () => has('supporteur'), why: 'Les rendez-vous ouverts à tous et ceux des équipes suivies. Pas de réponse à donner.', steps: ['Onglet Agenda.'], show: [[TAB(1), 0]], visit: (v, t) => !v && t === 1 },
  S3: { q: 'Où lire les annonces ?', line: 'Lire les annonces', who: () => has('supporteur'), why: 'Les nouvelles du club.', steps: ['Onglet Messages, section « Annonces » (et sur l’Accueil).'], show: [[TAB(2), 0]] },
  C1: { q: 'Comment valider joueurs et parents ?', line: 'Valider les joueurs et les parents', who: () => has('coach'), why: 'Tant que tu n’as pas validé, la famille ne voit rien de l’équipe.',
    steps: ['« Mes rôles » › Coach (avec plusieurs équipes, touche l’équipe).', 'Onglet « Effectif » : cadre « Demandes à valider ».', 'Pour un parent, choisis la fiche de l’enfant si on te la demande.', '« Valider » ou « Refuser ».'],
    role: RK.coach, show: [[ROLE(RK.coach), 0], [HUB, 0], [TS('effectif'), 1], ['[data-act=mok]', 3, 'z']],
    auto: () => S.members.some((m) => m.status === 'active' && m.role !== 'coach' && coachTids().includes(m.team_id)) && !toValidate().some((m) => coachTids().includes(m.team_id)) },
  C2: { q: 'Comment ajouter mes joueurs ?', line: 'Ajouter tes joueurs', who: () => has('coach'), why: 'Les familles retrouvent leur enfant et répondent pour lui.',
    steps: ['« Mes rôles » › Coach, onglet « Effectif ».', '« Ajouter des joueurs » (équipe [équipe]).', 'Colle une liste, choisis un fichier Excel ou prends une photo, puis « Vérifier la liste ».', 'Vérifie les lignes, puis « Valider l’import ».'],
    role: RK.coach, show: [[ROLE(RK.coach), 0], [HUB, 0], [TS('effectif'), 0], ['[data-act=import]', 1], ['#imt', 2, 'z'], ['[data-act=impcheck]', 2, '+'], ['[data-act=impok]', 3, 'z']],
    auto: () => coachTids().some((t) => playersOfTeam(t).length > 0) },
  C3: { q: 'Comment créer les entraînements de la saison ?', line: 'Créer les entraînements', who: () => has('coach'), why: 'Une fois pour toute la saison : les familles reçoivent chaque séance.',
    steps: ['« Mes rôles » › Coach, onglet « Planifier ».', '« Nouveau rendez-vous ».', 'Type « Entraînement », « Date et heure », lieu.', 'Coche « Répéter chaque semaine (même jour, même heure) », remplis « Répéter jusqu’au », puis « Enregistrer ».'],
    role: RK.coach, show: [[ROLE(RK.coach), 0], [HUB, 0], [TS('planifier'), 0], ['main.bd [data-act=evnew]', 1], ['#ed', 2, 'z'], ['#el', 2, 'z+'], ['#evf label.check:has([data-evrep])', 3, 'z+'], ['#evf [type=submit]', 3, 'z+']],
    auto: () => myEventIds().size > 0 },
  C4: { q: 'Comment faire l’appel ?', line: 'Faire l’appel', who: () => has('coach'), why: 'Une séance sans appel ne compte pas dans les statistiques.',
    steps: ['Le jour J, en haut de l’Accueil (« Aujourd’hui ») : « Faire l’appel » ; sinon « Mes rôles » › Coach, onglet « Pointer ».', 'L’appel est déjà rempli avec les réponses : touche un joueur pour corriger.', '« Les annoncés présents sont là » si tous sont venus.', '« Terminer l’appel » : les non pointés passent absents.'],
    role: RK.coach, show: [[ROLE(RK.coach), 0], [HUB, 0], [TS('pointer'), 0], ['.tiles9', 1, 'z'], ['[data-act=appall]', 2, 'z+'], ['[data-act=appsave]', 3, 'z+']],
    auto: () => S.att.some((a) => { const e = S.events.find((x) => x.id === a.event_id); return e && (e.team_ids || []).some(coachOf); }) },
  C5: { q: 'Comment choisir un contact d’équipe ?', line: 'Choisir un contact d’équipe', who: () => has('coach'), why: 'Un adulte qui peut créer et annuler les rendez-vous de l’équipe et voir les coordonnées des familles.',
    steps: ['« Mes rôles » › Coach, onglet « Effectif » : cadre « Contact de l’équipe ».', '« Choisir un adulte ».', '« Nommer contact ».'],
    role: RK.coach, show: [[ROLE(RK.coach), 0], [HUB, 0], [TS('effectif'), 0], ['#tcu', 1, 'z'], ['#tcf [type=submit]', 2, 'z+']], auto: () => (S.tcontacts || []).some((c) => coachOf(c.team_id)) },
  C6: { q: 'Comment préparer une séance ?', line: 'Préparer une séance', who: () => has('coach'), why: 'Arriver avec les exercices prêts.',
    steps: ['« Mes rôles » › Coach, onglet « Préparer ».', 'Touche une séance « À préparer », ou « Composer une séance ».', 'Ajoute des exercices (« Ajouter un exercice » pour un nouveau), puis enregistre.'],
    role: RK.coach, show: [[ROLE(RK.coach), 0], [HUB, 0], [TS('preparer'), 0], ['main.bd [data-act=cplan]', 1], ['#planf', 2, 'z']] },
  C7: { q: 'Coach : relancer, renforts, aide coach, heures, annuler', faq: true, who: () => has('coach'), why: 'Les autres gestes du coach.',
    steps: ['Relancer ceux qui n’ont pas répondu : page du rendez-vous, cadre « Relance ».', 'Renforts : « Effectif », « Renforts », « Proposer un joueur » ; dans un rendez-vous, « Équipe seule », « Avec tous les renforts » ou « Renforts choisis ».', 'Aide coach : « Effectif », cadre « Aide coach » (joueur de 15 à 17 ans).', 'Mes heures : dans l’espace coach. Annuler ou supprimer : page du rendez-vous.'] },
  M1: { q: 'Comment écrire à un joueur mineur ?', faq: true, who: () => !onlySupporter(), why: 'Un adulte n’échange avec un mineur qu’avec un de ses parents.',
    steps: ['Crée le groupe avec le joueur : l’écran « Ajouter un parent » s’ouvre.', 'Choisis un parent inscrit, ou saisis l’e-mail d’un parent (jamais demandé à l’enfant).', 'La conversation s’ouvre quand le parent accepte (onglet Messages, « Demandes de conversation »). Refus ou 14 jours sans réponse : annulée.'] },
  F1: { q: 'Comment transférer une convocation reçue ?', faq: true, who: () => isBoard() || (S.tcontacts || []).some((c) => c.user_id === S.me.id), why: 'Faire suivre un match reçu d’un autre club à des personnes du club.',
    steps: ['Convocations reçues : « Transférer ».', 'Choisis les personnes : elles reçoivent une annonce avec le jour, l’heure et le lieu, sans le contact de l’autre club.', '« Rattacher » relie un match reçu à un rendez-vous déjà dans l’agenda.'] },
  B1: { q: 'Faire le tour de ma fonction', line: 'Faire le tour de ta fonction', who: () => has('bureau') && !fnHas('Trésorier', 'Trésorier adjoint', 'Secrétaire', 'Secrétaire adjoint', 'Correspondant rencontres', 'Directeur technique'),
    why: 'Chaque espace s’ouvre sur « Aperçu » : ce qui est à faire, puis tes droits.', steps: ['« Mes rôles », puis ta fonction.', 'Lis l’« Aperçu », puis ouvre chaque onglet.'],
    role: RK.bur, show: [[ROLE(RK.bur), 0], ['.hd .ttabs', 1, 'z']] },
  // 5.8.0 · n° 208 f : le directeur technique a sa fiche (les onglets un à un, à quoi chacun sert)
  DT1: { q: 'Directeur technique : à quoi servent tes onglets ?', line: 'Découvrir ton espace de directeur technique', who: () => fnHas('Directeur technique'),
    why: 'Tu t’occupes des équipes, des coachs et des exercices du club. Chaque onglet a une tâche.',
    steps: ['« Mes rôles » › Directeur technique : l’« Aperçu » dit ce qui est à faire (demandes de coachs, équipes sans coach).', 'Onglet « Équipes » : les équipes et leurs coachs. Touche une équipe pour nommer son coach ; valide les demandes de coachs en haut.', 'Onglet « Exercices » : la banque d’exercices du club, et ceux proposés à tous les clubs, à valider.', 'Onglet « Ententes » : les équipes jouées avec un autre club, et les demandes d’entente reçues.'],
    role: RK.dt, show: [[ROLE(RK.dt), 0], [FTAB('equipes'), 1], [FTAB('exos'), 2, '+'], [FTAB('ententes'), 3, '+']] },
  TR1: { q: 'Comment fixer les tarifs ?', line: 'Fixer les tarifs de la saison', who: () => fnHas('Trésorier', 'Trésorier adjoint'), why: 'Le montant dû par chaque joueur se calcule tout seul (tarif de son équipe ou de sa catégorie, moins sa réduction).',
    steps: ['« Mes rôles » › Trésorier, onglet « Tarifs ».', '« Pour » : une catégorie, ou une équipe.', '« Montant (€) » et, si tu veux, « dont part fédération (€) ».', '« Ajouter ce tarif ». Plus vite : colle une grille ou choisis un fichier, puis « Vérifier ».'],
    role: RK.tres, show: [[ROLE(RK.tres), 0], [FTAB('tarifs'), 0], ['#ffc', 1, 'z'], ['#ffa', 2, 'z+'], ['#feef [type=submit]', 3, 'z+']], auto: () => S.fees.length > 0 },
  TR2: { q: 'Comment noter un versement ?', line: 'Noter un versement', who: () => fnHas('Trésorier', 'Trésorier adjoint'), why: 'La fiche du joueur passe à « Cotisation payée » et la famille le voit.',
    steps: ['« Mes rôles » › Trésorier, onglet « Cotisations », filtre « Reste à payer ».', 'Touche le joueur.', 'Cadre « Ajouter un versement » : montant, moyen.', '« Ajouter le versement ». L’attestation pour un comité d’entreprise se fait ensuite sur la même fiche.'],
    role: RK.tres, show: [[ROLE(RK.tres), 0], [FTAB('cotis'), 0], ['[data-act=lf][data-v="Reste à payer"]', 0, '+'], ['details[open] [data-act=player]', 1], ['#pa1', 2, 'z'], ['#payf [type=submit]', 3, 'z+']], auto: () => S.payments.length > 0 },
  TR3: { q: 'Comment relancer les cotisations ?', line: 'Relancer les cotisations non réglées', who: () => fnHas('Trésorier', 'Trésorier adjoint'), why: 'Un rappel dans l’application à chaque famille qui doit encore.',
    steps: ['« Mes rôles » › Trésorier, onglet « Cotisations ».', '« Relancer toutes les cotisations non réglées », puis « Confirmer ». Une famille déjà relancée cette semaine est sautée.'],
    role: RK.tres, show: [[ROLE(RK.tres), 0], [FTAB('cotis'), 0], ['[data-act=feeremall]', 1, 'z']] },
  TR4: { q: 'Trésorerie : export, heures des coachs, attestation', faq: true, who: () => isPresident() || hasArea('tresorerie'), why: 'Les autres gestes de la trésorerie.',
    steps: ['Exporter : « Cotisations », « Exporter la liste des cotisations (Excel) ».', 'Heures des coachs : « Vérification des heures », puis « Relevés, taux et montants ».', 'Attestation pour un comité d’entreprise : fiche du joueur, cadre « Licence et cotisation ». Seulement pour les versements notés.'] },
  SE1: { q: 'Comment valider les demandes ?', line: 'Valider les demandes', who: () => fnHas('Secrétaire', 'Secrétaire adjoint'), why: 'Tu valides joueurs, parents et supporteurs de toutes les équipes, et les coachs ; le bureau, c’est le président.',
    steps: ['« Mes rôles » › Secrétaire : les demandes sont en haut de l’« Aperçu ».', '« Valider » ou « Refuser ».'],
    role: RK.sec, show: [[ROLE(RK.sec), 0], [FTAB('ap_secretariat'), 0], ['[data-act=mok]', 1, 'z']], auto: () => !toValidate().length && S.members.length > 3 },
  SE2: { q: 'Comment importer la liste des licenciés ?', line: 'Importer la liste des joueurs', who: () => fnHas('Secrétaire', 'Secrétaire adjoint'), why: 'Toute la saison d’un coup, sans tout taper.',
    steps: ['« Mes rôles » › Secrétaire, onglet « Import / export ».', '« Ajouter des joueurs » : choisis l’équipe.', 'Colle une liste ou choisis un fichier Excel ou CSV (le plus fiable), puis « Vérifier la liste ».', 'Retire les lignes fausses, puis « Valider l’import ».'],
    role: RK.sec, show: [[ROLE(RK.sec), 0], [FTAB('impexp'), 0], ['[data-act=import]', 1], ['#imt', 2, 'z'], ['[data-act=impcheck]', 2, '+'], ['[data-act=impok]', 3, 'z']], auto: () => S.players.length > 0 },
  SE3: { q: 'Comment suivre les licences ?', line: 'Mettre les licences à jour', who: () => fnHas('Secrétaire', 'Secrétaire adjoint') || fnHas('Correspondant licences'), why: 'Savoir qui est vraiment licencié et assuré.',
    steps: ['« Mes rôles » › ta fonction, onglet « Licences ».', 'Filtre « Licence à finir » (ou « Certificat manquant »), puis touche un joueur.', 'Licence, numéro, « Certificat ou questionnaire de santé fourni » (oui ou non, jamais le document).', '« Enregistrer ». Sans date de naissance, le joueur est traité comme mineur.'],
    role: RK.seclic, show: [[ROLE(RK.seclic), 0], [FTAB('licences', 'lic'), 0], ['[data-act=lf][data-v="Licence à finir"]', 1, '+'], ['details[open] [data-act=player]', 1], ['#padminf', 2, 'z'], ['#padminf [type=submit]', 3, 'z+']] },
  CR1: { q: 'Comment compléter les matchs ?', line: 'Ajouter les gymnases des matchs', who: () => fnHas('Correspondant rencontres'), why: 'Une convocation sans gymnase ne peut pas partir.',
    steps: ['« Mes rôles » › Contact rencontres, onglet « Rencontres » : les matchs des 60 prochains jours.', 'Touche une rencontre, puis « Modifier ».', '« Lieu », puis « Enregistrer les changements ».'],
    role: RK.ren, show: [[ROLE(RK.ren), 0], [FTAB('renc'), 0], ['main.bd button.row[data-act=event]', 1], ['[data-act=evedit]', 1], ['#el', 2, 'z'], ['#evf [type=submit]', 2, 'z+']] },
  CR2: { q: 'Comment convoquer les clubs reçus ?', line: 'Envoyer une convocation', who: () => fnHas('Correspondant rencontres'), why: 'Un seul document pour toutes les rencontres à domicile du week-end : d’abord la pré-convocation, puis la convocation.',
    steps: ['« Mes rôles » › Contact rencontres, onglet « Convocations », « Matchs à domicile à convoquer » : touche une rencontre.', 'Cadre « Convocation des clubs reçus » : « Pré-convocation » ou « Convocation ».', 'Choisis les destinataires (club trouvé dans mypocketclub, sinon une adresse e-mail).', '« Envoyer à tous », puis « Confirmer l’envoi ». Sinon : « Imprimer ou enregistrer le PDF ».'],
    role: RK.ren, show: [[ROLE(RK.ren), 0], [FTAB('convoc'), 0], ['[data-blk=aconvoquer] button.row[data-act=event]', 0], ['[data-act=convoc]', 1], ['main.bd [data-act=convstep]', 1, 'z'], ['[data-dest]', 2, 'z'], ['[data-act=cvsend], [data-act=cvall]', 3, 'z+']] },
  CR3: { q: 'Comment trouver des bénévoles ?', line: 'Remplir les missions de bénévoles', who: () => fnHas('Correspondant rencontres'), why: 'Table de marque, arbitrage, buvette : chacun choisit ses missions depuis l’Accueil.',
    steps: ['« Mes rôles » › Contact rencontres, onglet « Bénévoles ».', '« Missions par défaut du club » : écris les missions, puis « Enregistrer ».', '« Places à pourvoir » : « Ajouter les missions par défaut » sur une rencontre.', '« Relancer » s’il manque du monde.'],
    role: RK.ren, show: [[ROLE(RK.ren), 0], [FTAB('benev'), 0], ['[data-act=dmsave]', 1, 'z'], ['[data-act=mdef]', 2, 'z+'], ['[data-act=mremopen]', 3, 'z+']] },
  PR1: { q: 'Président : comment valider les demandes ?', line: 'Valider les demandes', who: () => isPresident(), why: 'Toi seul valides les membres du bureau.',
    steps: ['« Mes rôles » › Président, onglet « Demandes ».', '« Valider » ou « Refuser ».'],
    role: RK.pres, show: [[ROLE(RK.pres), 0], [PTAB('demandes'), 0], ['[data-act=mok]', 1, 'z']], auto: () => !toValidate().length && S.members.length > 3 },
  PR2: { q: 'Comment donner les fonctions du bureau ?', line: 'Donner les fonctions du bureau', who: () => isPresident(), why: 'Une personne par fonction : chacune reçoit les accès qui vont avec.',
    steps: ['« Mes rôles » › Président, onglet « Fonctions du bureau », puis « Fonctions du bureau (nommer, retirer, accès en plus) ».', 'Cadre « Nommer quelqu’un » : le membre, puis la fonction.', '« Nommer ». Rôle « Autre » possible : nom libre, accès choisis parmi les cinq (jamais l’accès Président).'],
    role: RK.pres, show: [[ROLE(RK.pres), 0], [PTAB('qui'), 0], ['main.bd [data-act=fonctions]', 0], ['#nomf', 1, 'z'], ['#nomf [type=submit]', 2, 'z+']],
    auto: () => S.members.some((m) => m.status === 'active' && m.role === 'bureau' && m.user_id !== S.me.id) },
  PR3: { q: 'Comment créer les équipes ?', line: 'Créer les équipes', who: () => isPresident(), why: 'Les familles et les coachs choisissent leur équipe en rejoignant le club.',
    steps: ['« Mes rôles » › Président, onglet « Vue d’ensemble ».', '« Ajouter une équipe ».', 'Le nom, la catégorie et le créneau, puis « Créer l’équipe ».'],
    role: RK.pres, show: [[ROLE(RK.pres), 0], [PTAB('ensemble'), 0], ['[data-act=tcreateopen]', 1], ['details[data-tcreate][open] form', 2, 'z']], auto: () => S.teams.length > 0 },
  PR4: { q: 'Comment régler le club ?', line: 'Régler le club', who: () => isPresident(), why: 'Logo, couleurs, recherche des clubs, droits de chacun, saison.',
    steps: ['« Mes rôles » › Président, onglet « Réglages ».', '« Apparaître dans la recherche des clubs », logo et couleurs, droits, saison.'],
    role: RK.pres, show: [[ROLE(RK.pres), 0], [PTAB('reglages'), 0], ['label.switch:has([data-clubset=public_listed])', 1, 'z']] },
  PR5: { q: 'Président : abonnement, présidence, journal, suppression', faq: true, who: () => isPresident(), why: 'Les gestes rares du président.',
    steps: ['Ce que le club paiera : « Réglages », cadre « Ton club chez mypocketclub ».', 'Transférer la présidence ou supprimer le club : « Réglages », « Zone sensible ».', 'Le journal : onglet « Journal » (qui a fait quoi).', 'Supprimer le compte d’un joueur : sa fiche (30 jours à la corbeille).'] },
};
const txt = (v) => (typeof v === 'function' ? v() : v);
const isDone = (id, d = doneSet()) => d.has(id) || !!FICHES[id]?.auto?.();
// 5.8.0 · n° 208 d : « [équipe] » et « [club] » remplacés par les vrais noms
const sub = (s) => s.replace(/\[équipe\]/g, () => (coachTids()[0] ? teamName(coachTids()[0]) : 'de ton choix')).replace(/\[club\]/g, () => S.clubs?.[S.clubId]?.name || 'ton club');
const stepsOf = (f) => f.steps.map(sub);
const showOf = (f) => (f.show || []).map(([sel, s, o = '']) => ({ sel, s, z: o.includes('z'), same: o.includes('+') }));
const selOf = (e) => (typeof e.sel === 'function' ? e.sel() : e.sel);
// « Me montrer » n'a de sens que si le compte a le rôle de la fiche
const canShow = (f) => !!f.show && (!f.role || !!keyOf(f.role));

// ---------- les blocs de l'encart ----------
// 5.8.0 · n° 208 i : le président voit l'onboarding de chaque rôle (menu), compté dans sa progression
const ROLE_MENU = [
  ['coach', 'Coach', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']], ['tres', 'Trésorier', ['TR1', 'TR2', 'TR3']], ['sec', 'Secrétaire', ['SE1', 'SE2', 'SE3']],
  ['ren', 'Contact rencontres', ['CR1', 'CR2', 'CR3']], ['dt', 'Directeur technique', ['DT1']], ['joueur', 'Joueur', ['J1', 'J2']], ['parent', 'Parent', ['P1']], ['sup', 'Supporteur', ['S1', 'S2', 'S3']],
];
const RANK = { president: 0, bureau: 1, coach: 2, joueur: 3, parent: 4, supporteur: 5 };
function blocks() {
  const out = [], used = new Set(), fresh = (m) => m.created_at && Date.now() - new Date(m.created_at) < 14 * 864e5;
  const ok = (id) => FICHES[id] && !FICHES[id].faq && !used.has(id);
  const add = (key, title, ids, m) => {
    const l = ids.filter((id) => ok(id) && (!FICHES[id].who || FICHES[id].who()));
    l.forEach((id) => used.add(id));
    if (l.length) out.push({ key, title, ids: l, isNew: !!(m && fresh(m)) });
  };
  add('tel', 'Ton téléphone', standalone() ? ['T2'] : ['T1', 'T2']);
  // 5.8.0 · n° 217 : le rôle d'abord (président, fonction du bureau), puis coach, puis joueur, parent, supporteur
  const seen = new Set(), mems = [...active()].sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9));
  for (const m of mems) {
    const k = m.role + (m.role === 'bureau' ? ':' + (m.fonction || '') : ''); if (seen.has(k)) continue; seen.add(k);
    const f = m.fonction || '';
    if (m.role === 'president') add(k, 'Président', ['R1', 'PR1', 'PR2', 'PR3', 'PR4', 'R4'], m);
    else if (m.role === 'coach') add(k, 'Coach' + (coachTids().length === 1 ? ' · ' + teamName(coachTids()[0]) : ''), ['R1', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'], m);
    else if (m.role === 'bureau') {
      const ids = /^Trésorier/.test(f) ? ['TR1', 'TR2', 'TR3'] : /^Secrétaire/.test(f) ? ['SE1', 'SE2', 'SE3'] : f === 'Correspondant rencontres' ? ['CR1', 'CR2', 'CR3'] : f === 'Correspondant licences' ? ['SE3'] : f === 'Directeur technique' ? ['DT1'] : ['B1'];
      add(k, f === 'Correspondant rencontres' ? 'Contact rencontres' : f === 'Correspondant licences' ? 'Contact licences' : f || 'Membre du bureau', ['R1', 'R4', ...ids], m);
    } else if (m.role === 'parent') add(k, 'Parent', ['P1', 'T3', 'T4', 'K5'], m);
    else if (m.role === 'joueur') add(k, 'Joueur', ['J1', 'T3', 'T4', 'J2', 'K5'], m);
    else if (m.role === 'supporteur') add(k, 'Supporteur', ['S1', 'S2', 'S3', 'K5'], m);
  }
  add('moi', 'Ton compte', ['K1']);
  if (isPresident()) {
    const groups = ROLE_MENU.map(([k, l, ids]) => ({ k, l, ids: ids.filter(ok) })).filter((g) => g.ids.length);
    if (groups.length) { const ids = groups.flatMap((g) => g.ids); ids.forEach((id) => used.add(id)); out.push({ key: 'menu', title: 'Les autres rôles du club', ids, groups, menu: true }); }
  }
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
function menuBlock(b, d) {
  const g = b.groups.find((x) => x.k === S.obRole) || b.groups[0], all = g.ids.every((id) => isDone(id, d)), more = (S.obMore || {})['menu:' + g.k], l = more ? g.ids : g.ids.slice(0, 5);
  const undo = S.obUndo && S.obUndo.k === g.k ? `<button class="linkbtn" data-act="obroleundo">Annuler</button>` : '';
  return `<div class="obblk" data-obmenu="1"><b>${esc(b.title)}</b><p class="note" style="margin:0">Pour aider les membres du bureau et les coachs : leurs lignes comptent dans ta progression.</p>
  <div class="obrole"><label class="sr" for="obrole">Rôle</label><select id="obrole" data-obrole="1">${b.groups.map((x) => `<option value="${x.k}" ${x.k === g.k ? 'selected' : ''}>${esc(x.l)} · ${x.ids.filter((id) => isDone(id, d)).length} sur ${x.ids.length}</option>`).join('')}</select>
  ${all ? '<span class="obok">✓ C’est fait</span>' : `<button class="btn small ghost" data-act="obroledone" data-v="${g.k}">C’est fait</button>`}${undo}</div>
  <div class="list">${l.map((id) => line(id, d)).join('')}</div>${g.ids.length > 5 && !more ? `<button class="linkbtn" data-act="obmore" data-v="menu:${g.k}">${g.ids.length === 6 ? 'Voir la dernière ligne' : `Voir les ${g.ids.length - 5} autres`}</button>` : ''}</div>`;
}
hooks.obHome = () => {
  if (!obActive()) return '';
  const d = doneSet(), bl = blocks(), all = bl.flatMap((b) => b.ids), n = all.filter((id) => isDone(id, d)).length;
  return `<div class="card lift obcard" data-ob="1"><div style="display:flex;align-items:baseline;gap:8px"><span class="kick" style="flex:1">Pour bien démarrer</span><span class="det">${n} sur ${all.length}</span></div>
  ${bl.map((b) => { if (b.menu) return menuBlock(b, d); const more = (S.obMore || {})[b.key], l = more ? b.ids : b.ids.slice(0, 5);
    return `<div class="obblk"><b>${esc(b.title)}${b.isNew ? ' <span class="pill wait">Nouveau</span>' : ''}</b><div class="list">${l.map((id) => line(id, d)).join('')}</div>${b.ids.length > 5 && !more ? `<button class="linkbtn" data-act="obmore" data-v="${b.key}">${b.ids.length === 6 ? 'Voir la dernière ligne' : `Voir les ${b.ids.length - 5} autres`}</button>` : ''}</div>`; }).join('')}
  <div class="btns"><button class="btn small ghost" data-act="obhide">Masquer</button></div><p class="note" style="margin:0">Tu le retrouves dans Mon compte › Aide.</p></div>`;
};

// ---------- la fiche ----------
// 5.8.0 · n° 208 b : depuis l'encart, « Me montrer » seulement ; « Y aller » reste dans la FAQ (outil d'aide)
// n° 208 c : une ligne faite affiche « C'est fait » coché (jamais « Pas encore fait »)
function fichePage(id, faq) {
  const f = FICHES[id]; if (!f) return '<p class="empty">Fiche introuvable.</p>';
  const ok = isDone(id), manual = doneSet().has(id) && !f.auto?.(), extra = txt(f.extra) || '', show = canShow(f);
  const shot = SHOTS.has(id) ? `<figure class="obshot"><button type="button" data-act="obzoom" data-id="${id}" aria-label="Agrandir la capture"><picture><source media="(min-width:960px)" srcset="img/faq/${id}-pc.jpg"><img src="img/faq/${id}-tel.jpg" alt="Capture de l’écran : ${esc(f.q)}" loading="lazy"></picture></button><figcaption class="note">L’écran, zone à toucher en jaune</figcaption></figure>` : '';
  const done = !f.line ? '' : ok ? `<span class="obok" role="status">✓ C’est fait</span>${manual ? `<button class="linkbtn" data-act="obundo" data-id="${id}">Annuler</button>` : ''}` : `<button class="btn ${show ? 'ghost' : 'main'}" data-act="obdone" data-id="${id}">C’est fait</button>`;
  const noRole = f.show && !show ? '<p class="note">« Me montrer » sert à la personne qui a ce rôle : tu ne l’as pas dans ce club.</p>' : '';
  return `<div class="card lift"><div class="kick">À quoi ça sert</div><p style="margin:0">${esc(f.why)}</p></div>
  <div class="card"><div class="kick">Comment faire</div><ol class="obsteps">${stepsOf(f).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${shot}</div>${noRole}
  <div class="btns">${show ? `<button class="btn main" data-act="obshow" data-id="${id}">Me montrer</button>${faq ? `<button class="btn ghost" data-act="obgo" data-id="${id}">Y aller</button>` : ''}` : ''}${extra}${done}</div>`;
}
V310_VIEWS.obfiche = (v) => ({ head: header({ back: true, kicker: v.faq || FICHES[v.id]?.faq ? 'Aide' : 'Pour bien démarrer', title: esc(FICHES[v.id]?.q || 'Aide') }), body: fichePage(v.id, v.faq || FICHES[v.id]?.faq) });

// ---------- FAQ (Mon compte › Aide) ----------
// 5.8.0 · n° 218 : questions rangées par profil, recherche en direct (sans redessiner la page)
const FAQ_GROUPS = [
  ['Pour tout le monde', ['T1', 'T2', 'T3', 'T4', 'T5', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'M1']], ['Mes rôles', ['R1', 'R2', 'R4']],
  ['Joueur', ['J1', 'J2', 'P4']], ['Parent', ['P1', 'P2', 'P3', 'P4']], ['Supporteur', ['S1', 'S2', 'S3']], ['Coach', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']],
  ['Président', ['PR1', 'PR2', 'PR3', 'PR4', 'PR5']], ['Trésorier', ['TR1', 'TR2', 'TR3', 'TR4']], ['Secrétaire et licences', ['SE1', 'SE2', 'SE3']],
  ['Contact rencontres', ['CR1', 'CR2', 'CR3', 'F1']], ['Directeur technique', ['DT1']], ['Autres fonctions du bureau', ['B1']],
];
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function faqPage() {
  const used = new Set(), mine = (id) => FICHES[id] && (isPresident() || !FICHES[id].who || FICHES[id].who());
  const groups = FAQ_GROUPS.map(([t, ids]) => [t, ids.filter((id) => mine(id) && !used.has(id) && used.add(id))]).filter(([, l]) => l.length);
  return `<div class="btns"><button class="btn ghost" data-act="guide">Installer et notifications</button>${meta().hidden ? '<button class="btn ghost" data-act="obshowcard">Revoir « Pour bien démarrer »</button>' : ''}</div>
  <div class="field"><label for="faqq">Chercher une question</label><input id="faqq" type="search" data-faqq="1" value="${esc(S.faqQ || '')}" placeholder="Ex. appel, notifications, cotisation" autocomplete="off"></div>
  ${groups.map(([t, l]) => `<div class="faqgrp"><div class="sec"><h2>${esc(t)}</h2><span class="det">${l.length}</span></div><div class="card"><div class="list">${l.map((id) => `<button class="row" data-act="obfiche" data-faq="1" data-id="${id}" data-s="${esc(norm(FICHES[id].q + ' ' + stepsOf(FICHES[id]).join(' ') + ' ' + t))}"><span class="g">${esc(FICHES[id].q)}</span><span class="chev"></span></button>`).join('')}</div></div></div>`).join('')}
  <p class="empty" data-faqnone="1" style="display:none">Aucune question ne correspond.</p>
  <p class="note">Une question sans réponse ? Écris à ${esc(BRAND.contact)}.</p>`;
}
function faqFilter() {
  const q = norm(S.faqQ || '').trim(); let any = false;
  // style.display plutôt que hidden : les lignes ont un display:flex qui l'emporterait
  document.querySelectorAll('.faqgrp').forEach((g) => { let n = 0; g.querySelectorAll('[data-s]').forEach((r) => { const on = !q || r.dataset.s.includes(q); r.style.display = on ? '' : 'none'; if (on) n++; }); g.style.display = n ? '' : 'none'; const c = g.querySelector('.det'); if (c) c.textContent = n; if (n) any = true; });
  const none = document.querySelector('[data-faqnone]'); if (none) none.style.display = any ? 'none' : '';
}
V310_VIEWS.faq = () => ({ head: header({ back: true, kicker: 'Mon compte', title: 'Aide' }), body: faqPage() });
hooks.helpAccount = () => `<button class="btn ghost" data-act="faq">${icon('msg', 20)}Aide : questions et « Pour bien démarrer »</button>`;

// ---------- « Me montrer » : la zone à toucher en jaune, étape par étape ----------
let showBar = null;
// premier élément visible qui correspond (sur ordinateur, les quatre carrés sont cachés : c'est le bloc « Mes rôles »)
const seen = (sel) => { if (!sel) return null; try { return [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null || x.getClientRects().length) || null; } catch { return null; } };
function clearShow() { document.querySelectorAll('.ob-hl').forEach((x) => x.classList.remove('ob-hl')); if (showBar) { showBar.remove(); showBar = null; } }
// 5.8.0 · n° 208 j : « Étape 1 sur 2 · » suivi du texte de l'étape ; n° 208 a : à la fin, le bandeau reste avec « Revenir à la fiche »
function barHtml(f, id, st, cur, found) {
  const steps = stepsOf(f), n = steps.length;
  let head;
  if (st.end) head = isDone(id) ? 'C’est fait. Bravo !' : 'Tu as vu toutes les étapes. Reviens à la fiche et touche « C’est fait » quand c’est fini.';
  else head = `Étape ${cur + 1} sur ${n} · ${esc(steps[cur])}${found ? '' : ' <span class="obbar-hint">(ouvre cet écran)</span>'}`;
  const back = st.end || f.line ? `<button data-act="obfiche" data-id="${id}" class="btn small ink">Revenir à la fiche</button>` : '';
  return `<div class="obbar-q">${esc(f.q)}</div><b class="obbar-now">${head}</b><ol class="obbar-steps">${steps.map((t, k) => `<li class="${!st.end && k === cur ? 'on' : st.end || k < cur ? 'done' : ''}">${esc(t)}</li>`).join('')}</ol><div class="obbar-btns">${st.end ? back : ''}<button data-act="obstop" class="btn small ${st.end ? 'ghost' : 'ink'}">${st.end ? 'Fermer' : 'Arrêter'}</button></div>`;
}
const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= 60 && r.bottom <= innerHeight - 140; };
function paintShow() {
  clearShow();
  const s = S.obShow; if (!s) return;
  const f = FICHES[s.id], L = showOf(f); if (!L.length) { S.obShow = null; return; }
  showBar = document.createElement('div'); showBar.className = 'obbar' + (s.end ? ' end' : '');
  // sur ordinateur, le bandeau vertical se range dans la colonne de gauche, sous les onglets et « Mes rôles »
  const side = innerWidth >= 960 && document.querySelector('.tb');
  if (side) showBar.classList.add('side');
  const put = () => (side ? side.appendChild(showBar) : document.body.appendChild(showBar));
  if (s.end) { showBar.innerHTML = barHtml(f, s.id, s, 0, true); put(); return; }
  // l'étape la plus avancée visible ; sur un même écran (« + »), on avance au toucher
  const vis = L.map((e) => seen(selOf(e)));
  let j = -1; for (let k = L.length - 1; k >= 0; k--) if (vis[k]) { j = k; break; }
  if (j < 0) { showBar.innerHTML = barHtml(f, s.id, s, L[Math.min(s.i, L.length - 1)].s, false); put(); return; }
  // les étapes restantes, sur ce même écran, n'y sont pas (rien à relancer, par exemple) : c'est la fin
  if (s.i > j && L.slice(j + 1).every((e) => e.same)) { s.end = true; showBar.classList.add('end'); showBar.innerHTML = barHtml(f, s.id, s, 0, true); put(); return; }
  let g = j; for (let k = j; k > 0 && L[k].same; k--) if (vis[k - 1]) g = k - 1;
  const cur = s.i >= g && s.i <= j && vis[s.i] ? s.i : g; s.i = cur;
  const el = vis[cur]; el.classList.add('ob-hl'); if (!inView(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  showBar.innerHTML = barHtml(f, s.id, s, L[cur].s, true);
  put();
  // au toucher : l'étape suivante (sur le même écran, la prochaine zone présente) ; après la dernière, le bandeau de fin
  const next = () => { if (S.obShow !== s || s.i !== cur) return; let n = cur + 1; while (n <= j && !vis[n] && L[n].same) n++; if (n > L.length - 1) s.end = true; else s.i = n; setTimeout(paintShow, 250); };
  el.addEventListener('click', next, { once: true, capture: true });
  if (L[cur].z) el.addEventListener('focusin', next, { once: true });
}
// « Y aller » (FAQ, captures) refait les étapes à la place de la personne et entoure la dernière zone atteinte
const tick = () => new Promise((r) => setTimeout(r, 120));
export async function goFiche(id) {
  const f = FICHES[id]; if (!f?.show || !canShow(f)) return false;
  const L = showOf(f), last = L.length - 1, clicked = new Set();
  // pendant le trajet, pas d'entourage (sinon nos propres touches feraient avancer le bandeau)
  S.obShow = null; clearShow(); S.view = null; S.stack = []; S.tab = 0; S.noStack = true; render(); await tick();
  for (let n = 0; n < 16; n++) {
    let k = -1, el = null; for (let x = last; x >= 0; x--) { el = seen(selOf(L[x])); if (el) { k = x; break; } }
    if (k < 0 || k === last) break;
    // sur un même écran, on passe les zones sans les toucher
    let m = k; while (m < last && L[m + 1].same && seen(selOf(L[m + 1]))) m++;
    if (m === last || L[k].z || clicked.has(el)) break;
    clicked.add(el); el.click(); await tick(); await tick();
  }
  let at = 0; for (let x = last; x >= 0; x--) if (seen(selOf(L[x]))) { at = x; break; }
  S.obShow = { id, i: at }; paintShow();
  return !!document.querySelector('.ob-hl');
}
hooks.obAfter = () => {
  // coches automatiques à la visite (ouvrir un groupe, l'onglet Équipe, son espace…)
  const d = doneSet(); let add = [];
  for (const [id, f] of Object.entries(FICHES)) if (f.visit && !d.has(id) && f.visit(S.view, S.tab)) add.push(id);
  if (add.length && S.me) saveMeta({ done: [...d, ...add] });
  setTimeout(paintShow, 0);
  if (S.view?.type === 'faq') setTimeout(faqFilter, 0);
};

Object.assign(ACTIONS, {
  obfiche: (el, d) => { S.obShow = null; clearShow(); S.view = { type: 'obfiche', id: d.id, faq: d.faq === '1' }; render(); },
  obmore: (el, d) => { S.obMore = { ...(S.obMore || {}), [d.v]: true }; render(true); },
  obdone: (el, d) => { S.obShow = null; clearShow(); saveMeta({ done: [...doneSet(), d.id] }); toast('C’est noté.'); const v = (S.stack || []).pop() || null; S.view = v; S.noStack = true; render(); },
  obundo: (el, d) => { S.obShow = null; clearShow(); const s = doneSet(); s.delete(d.id); saveMeta({ done: [...s] }); render(true); },
  // n° 208 i : « C'est fait » sur un rôle du menu valide toutes ses lignes ; « Annuler » rétablit la liste d'avant
  obroledone: (el, d) => { const g = ROLE_MENU.find(([k]) => k === d.v); if (!g) return; const prev = [...doneSet()]; S.obUndo = { k: d.v, prev }; saveMeta({ done: [...new Set([...prev, ...g[2].filter((id) => !isDone(id))])] }); toast(`Lignes « ${g[1]} » cochées.`); render(true); },
  obroleundo: () => { if (!S.obUndo) return; saveMeta({ done: S.obUndo.prev }); S.obUndo = null; render(true); },
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
document.addEventListener('input', (e) => { if (e.target?.dataset?.faqq) { S.faqQ = e.target.value; faqFilter(); } });
document.addEventListener('change', (e) => { if (e.target?.dataset?.obrole) { S.obRole = e.target.value; S.obUndo = null; render(true); } });

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
// 5.8.0 · outil des captures (tools/captures_faq.py) : jusqu'où « Y aller » est arrivé
export const obProgress = (id) => { const L = showOf(FICHES[id] || {}), s = S.obShow; return { at: s && s.id === id ? s.i : null, last: L.length - 1, reached: !!s && s.id === id && s.i === L.length - 1 && !!document.querySelector('.ob-hl') }; };
