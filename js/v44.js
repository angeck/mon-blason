// mypocketclub · alpha 4.4.0 · n° 114 (suite, revue du 4 novembre 2026, « oui pour tout » de Gaël le 5 novembre) :
// chaque fonction du bureau a son bandeau et ses onglets, au bas du bloc bleu de l'en-tête (comme le président) ;
// relance des cotisations en un geste ; export des membres journalisé ; passage de saison pour tout le club.
// Rappel : chaque droit est vérifié par la base (supabase/alpha_4_4_0.sql) ; l'écran n'est qu'un confort.
import {
  S, sb, esc, hooks, run, toast, render, refresh, armed, isArmed, ACTIONS, club, isBoard, isPresident, hasArea, myFonctions, fl,
  team, teamName, name, plural, fmtShort, evTeams, toValidate, NEXT_SEASON, SEASON,
} from './core.js';
import { entTag } from './core.js';
import { icon } from './ui.js';
import { upcoming } from './agenda.js';
import { pendRows, licencesBlock, namesToCheck, feesBlock, teamsBlock, membersBlock, exportMembers, exportBtn, effectifsBlock, brandBlock } from './club.js';
import { hoursCheckBlock, clubResults, partnerRequests, arrange } from './v35.js';
import { exosForCounts } from './coach.js';
import { teamToolsBlock, dupGroups } from './v38.js';
import { payTreasurerSoon } from './v310.js';
import { addPlayersBlock, tresoSummary, benevBlock, defaultMissionsBlock, rubBody, rubList, annList, missing, sw } from './vie.js';

const eur = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const live = () => S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée');
const liveIds = () => live().map((t) => t.id);
const DAY = 864e5;

// ---------- quelle présentation pour quelle fonction ----------
const FN_SET = {
  'Trésorier': 'tresorerie', 'Trésorier adjoint': 'tresorerie', 'Secrétaire': 'secretariat', 'Secrétaire adjoint': 'secretariat',
  'Correspondant licences': 'licences', 'Correspondant rencontres': 'rencontres', 'Directeur technique': 'technique', 'Chargé de communication': 'communication', 'Responsable événements': 'evenements',
};
const DESIG_SET = { licences: 'licences', rencontres: 'rencontres', evenements: 'evenements', communication: 'communication' };
// rubriques que la présentation d'une fonction contient déjà
const SET_AREAS = { tresorerie: ['tresorerie'], secretariat: ['secretariat', 'licences'], licences: ['licences'], rencontres: ['evenements'], technique: ['technique'], communication: ['communication'], evenements: ['evenements'] };
// une présentation en couvre d'autres (le Secrétariat comprend les licences ; les rencontres comprennent les bénévoles)
const COVERS = { secretariat: ['licences'], rencontres: ['evenements'] };
// n° 152 et 153 (9 novembre 2026) : le premier onglet de chaque fonction est un « Aperçu » (bandeau, à faire, droits) ;
// Directeur technique : Aperçu · Équipes (avec les coachs) · Exercices · Ententes (l'onglet Coachs faisait doublon)
const SETS = {
  tresorerie: [['ap_tresorerie', 'Aperçu'], ['cotis', 'Cotisations'], ['tarifs', 'Tarifs'], ['heures', 'Heures des coachs']],
  secretariat: [['ap_secretariat', 'Aperçu'], ['licences', 'Licences'], ['fiches', 'Fiches'], ['impexp', 'Import / export']],
  licences: [['ap_licences', 'Aperçu'], ['lic', 'Licences'], ['liccontact', 'Contact']],
  rencontres: [['ap_rencontres', 'Aperçu'], ['renc', 'Rencontres'], ['convoc', 'Convocations'], ['benev', 'Bénévoles'], ['rcontact', 'Contact']],
  technique: [['ap_technique', 'Aperçu'], ['equipes', 'Équipes'], ['exos', 'Exercices'], ['ententes', 'Ententes']],
  communication: [['ap_communication', 'Aperçu'], ['annonces', 'Annonces'], ['lecteurs', 'Lecteurs']],
  evenements: [['ap_evenements', 'Aperçu'], ['events', 'Événements']],
};

// Présentations d'une fonction ; « mine » = ma propre casquette (on ajoute ce que le président m'a confié en plus)
function setsFor(f, mine) {
  const out = [], add = (k) => { if (k && !out.includes(k) && !out.some((x) => (COVERS[x] || []).includes(k))) out.push(k); };
  add(FN_SET[f]);
  if (mine && !isPresident()) { // le président a toutes les rubriques : sa casquette de bureau garde sa seule fonction
    const prim = myFonctions().map((x) => FN_SET[x]).filter(Boolean);
    const covered = (k) => prim.includes(k) || prim.some((x) => (COVERS[x] || []).includes(k));
    (S.desig || []).filter((d) => d.user_id === S.me.id).forEach((d) => { const k = DESIG_SET[d.resp]; if (k && !covered(k)) add(k); });
  }
  // une présentation déjà comprise dans une autre n'est pas répétée (licences dans le Secrétariat, bénévoles dans les rencontres)
  return out.filter((k) => !out.some((x) => (COVERS[x] || []).includes(k)));
}

// ---------- en-tête : onglets ; corps : bandeau sur le premier onglet de chaque présentation ----------
function fnSpace(f, mine) {
  if (f === 'Vice-président') return null; // comme le président : toutes les rubriques, présentation d'avant
  const sets = setsFor(f, mine);
  if (!sets.length) return null; // Membre du bureau, Sponsoring : rubrique Commun, comme avant
  // rubriques ouvertes en plus par le président : un seul onglet « Rubriques » (pas une rangée d'onglets de plus par rubrique)
  const have = sets.flatMap((k) => SET_AREAS[k]);
  S.v44x = mine && !isPresident() ? (S.areas || []).filter((a) => !have.includes(a) && a !== 'licences') : [];
  const last = S.v44x.length ? { id: 'rubs', l: 'Accès en plus', set: '' } : { id: 'commun', l: 'Commun', set: '' };
  const tabs = sets.flatMap((k) => SETS[k].map(([id, l]) => ({ id, l, set: k }))).concat(isBoard() ? [last] : []);
  const key = (mine ? 'f:' : 'v:') + f;
  S.ftabs = S.ftabs || {};
  const cur = tabs.find((t) => t.id === S.ftabs[key]) || tabs[0];
  const nav = `<nav class="ttabs" aria-label="Espace ${esc(fl(f))}">${tabs.map((t) => `<button data-act="ftab" data-k="${esc(key)}" data-v="${t.id}" ${t.id === cur.id ? 'aria-current="page"' : ''}>${esc(t.l)}</button>`).join('')}</nav>`;
  const first = cur.set && cur.id === 'ap_' + cur.set; // le bandeau est dans l'Aperçu seulement
  const band = first && BANDS[cur.set] ? BANDS[cur.set](key) : '', b = BODY[cur.id] ? BODY[cur.id]() : '';
  // n° 131 : « Réorganiser » dans chaque onglet qui a plusieurs blocs (ordre propre à la personne, à la fonction et à l'onglet) ;
  // le bandeau reste en tête. 5.1.0 (n° 191) : plus de bouton « Gestion du club » en bas de chaque onglet (la page n'existe plus)
  const body = Array.isArray(b) ? arrange(key + ':' + cur.id, [{ id: 'bandeau', pin: true, html: band }, ...b]) : band + b;
  return { tabs: nav, body };
}
hooks.fnSpace = fnSpace;

// ---------- bandeaux ----------
const tile = (n, l, act, extra = '', state) => `<button class="tile ${state || (n ? 'wait' : 'ok')}" data-act="${act}" ${extra}><b>${n}</b><span>${l}</span></button>`;
const tiles = (l) => `<div class="tiles" style="grid-template-columns:repeat(2,1fr)">${l.join('')}</div>`;
const go = (key, id) => `data-k="${esc(key)}" data-v="${id}"`;

function feeRows() {
  return S.players.filter((p) => !p.from_partner).map((p) => ({ p, a: S.padmin.find((x) => x.player_id === p.id) })).filter((x) => x.a && !x.a.nofee && x.a.fee_amount != null);
}
const lateFees = () => feeRows().filter((x) => +x.a.fee_amount - (+x.a.fee_paid || 0) > 0);
function homeSoon(days = 30) {
  const end = Date.now() + days * DAY;
  return upcoming(S.events.filter((e) => !e.cancelled && e.at_home !== false && e.audience === 'team' && ['Match', 'Plateau', 'Tournoi'].includes(e.type) && new Date(e.starts_at) < end));
}
const clubEvs = (days = 30) => { const end = Date.now() + days * DAY; return upcoming(S.events.filter((e) => !e.cancelled && new Date(e.starts_at) < end && ['Match', 'Plateau', 'Tournoi', 'Événement', 'AG'].includes(e.type))); };
const noCoachTeams = () => live().filter((t) => !S.members.some((m) => m.role === 'coach' && m.status === 'active' && m.team_id === t.id));
const incomplete = () => S.players.filter((p) => !p.from_partner && (!p.birth_date || !p.last_name || /\s/.test(p.first_name)));

const BANDS = {
  tresorerie: (key) => {
    const r = feeRows(), due = r.reduce((s, x) => s + +x.a.fee_amount, 0), paid = r.reduce((s, x) => s + Math.min(+x.a.fee_paid || 0, +x.a.fee_amount), 0);
    const h = S.v44?.hours, cc = S.coachCounts || {};
    return tiles([
      tile(due ? Math.round((100 * paid) / due) + ' %' : '—', `Encaissé · ${eur(paid)} sur ${eur(due)}`, 'ftab', go(key, 'cotis'), 'ok'),
      tile(lateFees().length, 'Cotisations à relancer', 'ftab', go(key, 'cotis')),
      tile(h ? Math.round(h.min / 6) / 10 + ' h' : '—', h ? `Heures validées en ${h.label}${h.amount != null ? ' · ≈ ' + eur(h.amount) : ''}` : 'Heures validées le mois dernier', 'ftab', go(key, 'heures'), 'ok'),
      tile(cc.hours || 0, 'Relevés d’heures à valider', 'choursb'),
    ]);
  },
  secretariat: (key) => {
    const ad = S.players.filter((p) => !p.from_partner).map((p) => S.padmin.find((a) => a.player_id === p.id) || {});
    const lic = ad.filter((a) => a.licence_state === 'Licencié').length, fed = ad.filter((a) => a.licence_state === 'Préinscrit fédé').length, pre = ad.length - lic - fed;
    return tiles([
      tile(toValidate().length, 'Demandes à valider', 'ftab', go(key, 'fiches')),
      tile(incomplete().length, 'Fiches incomplètes', 'ftab', go(key, 'fiches')),
      tile(lic + ' / ' + ad.length, 'Licenciés', 'ftab', go(key, 'licences'), 'ok'),
      tile(fed + pre, `Préinscrits · ${fed} fédé, ${pre} club`, 'ftab', go(key, 'licences'), fed + pre ? 'wait' : 'ok'),
    ]);
  },
  rencontres: (key) => {
    const home = homeSoon(), miss = clubEvs().reduce((s, e) => s + missing(e.id), 0), noPlace = homeSoon(60).filter((e) => !(e.place || '').trim()).length;
    return tiles([
      tile(toConvoke().length, 'Convocations à envoyer (7 jours)', 'ftab', go(key, 'ap_rencontres')),
      tile(home.length, 'Matchs à domicile (30 jours)', 'ftab', go(key, 'convoc'), 'ok'),
      tile(miss, 'Places de bénévoles à pourvoir', 'ftab', go(key, 'benev')),
      tile(noPlace, 'Matchs sans gymnase', 'ftab', go(key, 'renc')),
    ]);
  },
  technique: (key) => {
    const cc = S.coachCounts || {};
    return tiles([
      tile(toValidate().filter((m) => m.role === 'coach').length, 'Demandes de coachs', 'ftab', go(key, 'equipes')),
      tile(noCoachTeams().length, 'Équipes sans coach', 'ftab', go(key, 'equipes')),
      tile(cc.exos || 0, 'Exercices à valider', 'cexos', 'data-tab="club"'),
      tile(dupGroups().length, 'Doublons d’équipes', 'ftab', go(key, 'equipes')),
    ]);
  },
};

// ---------- contenu des onglets ----------
const contactCard = (what) => `<div class="card"><p class="note" style="margin:0">Choisis les coordonnées affichées pour les questions ${what} (téléphone, e-mail) dans Mon compte › Contact du club. Les familles et les autres clubs les voient dans « Contacter le club ».</p><button class="btn small" data-act="account">${icon('user', 18)}Régler mon contact</button></div>`;
function evRow(e, extra = '') {
  const pills = [e.at_home === false ? '<span class="pill">Extérieur</span>' : '<span class="pill blue">Domicile</span>', e.at_home !== false && !(e.place || '').trim() ? '<span class="pill wait">Sans gymnase</span>' : '', extra].join('');
  return `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))}${evTeams(e).length ? ' · ' + esc(evTeams(e).map(teamName).filter(Boolean).join(', ')) : ''}${e.place ? ' · ' + esc(e.place) : ''}</small></span><span class="chips" style="gap:4px;flex:none">${pills}</span></button>`;
}
function readsBlock() {
  const mine = S.annonces.filter((a) => a.created_by === S.me.id);
  if (!mine.length) return '<p class="empty">Tu n’as pas encore écrit d’annonce.</p>';
  const r = S.v44?.reads;
  if (!r) { loadReads(mine.map((a) => a.id)); return '<p class="empty">Chargement…</p>'; }
  const members = new Set(S.members.filter((m) => m.status === 'active').map((m) => m.user_id)).size;
  return `<div class="card"><div class="list">${mine.map((a) => `<button class="row" data-act="annopen" data-id="${a.id}"><span class="g">${esc(a.title)}<small>${esc(fmtShort(a.created_at))}</small></span><span class="pill ${r[a.id] ? 'blue' : ''}" style="flex:none">Lu par ${r[a.id] || 0}</span></button>`).join('')}</div></div><p class="note">Nombre de personnes qui ont ouvert chaque annonce (${plural(members, 'membre actif', 'membres actifs')} dans le club). Ouvre une annonce pour la relancer.</p>`;
}
async function loadReads(ids) {
  S.v44 = S.v44 || {}; S.v44.reads = {};
  const { data } = await sb.from('announcement_reads').select('announcement_id').in('announcement_id', ids);
  (data || []).forEach((x) => (S.v44.reads[x.announcement_id] = (S.v44.reads[x.announcement_id] || 0) + 1));
  render(true);
}
const blk = (id, label, html) => ({ id, label, html }); // n° 131 : un bloc déplaçable
// n° 153 : liste « À faire » de l'Aperçu (chaque ligne ouvre l'onglet concerné) ; rien à faire : une ligne verte
function todo(items) {
  const key = S.casq && S.view?.type === 'espace' ? S.casq : 'v:' + (S.view?.f || '');
  const l = items.filter(([n]) => n > 0);
  if (!l.length) return '<div class="sec"><h2>À faire</h2></div><div class="card"><p class="note" style="margin:0">Rien d’urgent pour l’instant.</p></div>';
  return `<div class="sec"><h2>À faire</h2></div><div class="card"><div class="list">${l.map(([n, one, many, tab]) => `<button class="row" data-act="ftab" data-k="${esc(key)}" data-v="${tab}"><span class="g">${plural(n, one, many)}</span><span class="pill wait" style="flex:none">Voir</span></button>`).join('')}</div></div>`;
}
// n° 155 (9 novembre 2026) : les droits de la fonction affichés dans sa page ; seul le président les change (vérifié par la base)
const RIGHTS = {
  secretary_sees_fees: ['Le secrétariat voit « cotisation à jour »', 'Oui ou non pour chaque joueur, jamais les montants. Vaut aussi pour le contact licences.', false],
  tech_sees_contacts: ['Le Directeur technique voit les coordonnées des familles', 'Toutes les équipes. Sinon, seulement celles de ses propres équipes s’il est coach.', true],
  coach_sees_fees: ['Les coachs voient licences et cotisations', 'De leurs joueurs seulement, sans les réductions.', true],
};
function rights(keys) {
  const c = club() || {};
  const on = (k) => (RIGHTS[k][2] ? c[k] !== false : c[k] === true);
  if (isPresident()) return `<div class="sec"><h2>Droits</h2></div><div class="card">${keys.map((k) => sw(k, RIGHTS[k][0], RIGHTS[k][1], on(k))).join('')}<p class="note" style="margin:0">Aussi dans Président › Réglages.</p></div>`;
  return `<div class="sec"><h2>Droits</h2></div><div class="card"><div class="list">${keys.map((k) => `<div class="row static"><span class="g">${esc(RIGHTS[k][0])}<small>${esc(RIGHTS[k][1])}</small></span><span class="pill ${on(k) ? 'ok' : ''}" style="flex:none">${on(k) ? 'Oui' : 'Non'}</span></div>`).join('')}</div><p class="note" style="margin:0">Réglé par le président.</p></div>`;
}
// n° 154 (9 novembre 2026) : un match à domicile reste à convoquer à partir de 7 jours avant, tant que la convocation n'est pas partie
// (S.cstate : état des envois donné par la base, convocation_todo)
export function toConvoke() {
  const st = Object.fromEntries((S.cstate7 || []).map((x) => [x.event_id, x]));
  return homeSoon(7).filter((e) => !(st[e.id]?.c_sent));
}
function convokeBlock() {
  const l = toConvoke(), st = Object.fromEntries((S.cstate7 || []).map((x) => [x.event_id, x]));
  if (!l.length) return '<div class="sec"><h2>Convocations à envoyer</h2></div><div class="card"><p class="note" style="margin:0">Toutes les rencontres à domicile des 7 prochains jours sont convoquées.</p></div>';
  return `<div class="sec"><h2>Convocations à envoyer</h2><span class="pill wait">${l.length}</span></div><div class="card"><div class="list">${l.map((e) => `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))}${evTeams(e).length ? ' · ' + esc(evTeams(e).map(teamName).filter(Boolean).join(', ')) : ''}</small><small><b>${st[e.id]?.p_sent ? 'Convocation à envoyer' : 'Pré-convocation à envoyer'}</b>${(e.place || '').trim() ? '' : ' · sans gymnase'}</small></span><span class="pill wait" style="flex:none">Envoyer</span></button>`).join('')}</div></div><p class="note">Chaque rencontre reste ici, à partir de 7 jours avant, jusqu’à l’envoi de sa convocation (e-mail, ${esc('mypocketclub')} ou PDF envoyé à la main).</p>`;
}
const canExportMembers = () => isPresident() || myFonctions().some((f) => ['Secrétaire', 'Secrétaire adjoint'].includes(f));

const BODY = {
  // Trésorier
  cotis: () => {
    const late = lateFees();
    return [
      blk('relance', 'Relancer les cotisations', (late.length ? `<button class="btn ${isArmed('feeall') ? 'ink' : 'main'}" data-act="feeremall">${icon('mail', 20)}${isArmed('feeall') ? `Confirmer : relancer ${plural(late.length, 'cotisation non réglée', 'cotisations non réglées')}` : `Relancer toutes les cotisations non réglées (${late.length})`}</button><p class="note">Un rappel à chaque famille concernée, dans l’application. Une famille déjà relancée cette semaine, ou sans compte relié, est sautée.</p>` : '')),
      blk('resume', 'Résumé de la trésorerie', tresoSummary()),
      blk('liste', 'Licences et cotisations', licencesBlock()),
      blk('export', 'Export Excel', `${exportBtn('xlsxlic', 'Exporter la liste des cotisations (Excel)')}<p class="note">Chaque export est inscrit au journal du club.</p>`),
      blk('paiement', 'Paiement en ligne', payTreasurerSoon()),
    ];
  },
  tarifs: () => feesBlock(),
  heures: () => [blk('verif', 'Vérification des heures', hoursCheckBlock()), blk('releves', 'Relevés, taux et montants', `<button class="btn" data-act="choursb">${icon('check', 20)}Relevés, taux et montants</button>`)],
  // Secrétaire
  licences: () => [blk('effectifs', 'Effectifs par équipe', effectifsBlock()), blk('liste', 'Licences', licencesBlock())], // n° 191 : les effectifs, venus de « Gestion du club »
  fiches: () => { const vp = toValidate(); return [blk('demandes', 'Demandes à valider', vp.length ? `<div class="sec"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card lift">${pendRows(vp)}</div>` : ''), blk('noms', 'Noms à vérifier', namesToCheck()), blk('membres', 'Membres', membersBlock())]; },
  impexp: () => [blk('ajout', 'Ajouter des joueurs', addPlayersBlock(liveIds())), blk('export', 'Exporter', `<div class="sec"><h2>Exporter</h2></div><div class="card">${canExportMembers() ? `${exportBtn('xlsxmem', 'Exporter les membres et leurs coordonnées (Excel)', '')}<p class="note">Équipe, licence, parents, e-mails, téléphones, contact d’urgence. L’export est inscrit au journal du club, à ton nom.</p>` : '<p class="note" style="margin:0">L’export des coordonnées est réservé au président, au secrétaire et au secrétaire adjoint.</p>'}</div>`)],
  // Correspondant licences
  lic: () => licencesBlock(),
  liccontact: () => contactCard('de licence'),
  // Correspondant rencontres
  renc: () => {
    const l = upcoming(S.events.filter((e) => !e.cancelled && ['Match', 'Plateau', 'Tournoi'].includes(e.type) && new Date(e.starts_at) < Date.now() + 60 * DAY));
    return `<button class="btn main" data-act="evnew" data-type="Match">${icon('calplus', 20)}Nouveau match</button><div class="sec"><h2>Rencontres des 60 prochains jours</h2><span class="det">${l.length || ''}</span></div>`
      + (l.length ? `<div class="card"><div class="list">${l.map((e) => evRow(e)).join('')}</div></div><p class="note">Ouvre une rencontre pour ajouter le gymnase ou préparer la convocation.</p>` : '<p class="empty">Aucun match, plateau ni tournoi dans les 60 prochains jours.</p>');
  },
  convoc: () => {
    const home = homeSoon();
    return [blk('recues', 'Convocations reçues', hooks.receivedBlock ? hooks.receivedBlock() : ''), blk('aconvoquer', 'Matchs à domicile à convoquer', `<div class="sec"><h2>Matchs à domicile à convoquer</h2><span class="det">${home.length ? plural(home.length, 'rencontre') : ''}</span></div>`
      + (home.length ? `<div class="card"><div class="list">${home.map((e) => evRow(e)).join('')}</div></div><p class="note">Ouvre une rencontre pour envoyer la pré-convocation ou la convocation aux clubs reçus.</p>` : '<p class="empty">Aucun match à domicile dans les 30 prochains jours.</p>'))];
  },
  benev: () => [blk('places', 'Places à pourvoir', benevBlock(clubEvs())), blk('missions', 'Missions par défaut', defaultMissionsBlock())],
  rcontact: () => contactCard('sur les matchs'),
  // Directeur technique
  // n° 152 : les coachs sont dans l'onglet Équipes (demandes de coachs, coach de chaque équipe, « Nommer » sur la fiche)
  equipes: () => {
    const req = toValidate().filter((m) => m.role === 'coach');
    const rows = live().map((t) => { const cs = [...new Set(S.members.filter((m) => m.role === 'coach' && m.status === 'active' && m.team_id === t.id).map((m) => m.user_id))]; return `<button class="row" data-act="tsopen" data-id="${t.id}"><span class="g">${esc(t.name)}${entTag(t.id)}<small>${cs.length ? esc(cs.map(name).join(', ')) : 'Sans coach'}</small></span><span class="pill ${cs.length ? 'blue' : 'wait'}" style="flex:none">${cs.length ? 'Coachs' : 'Nommer'}</span></button>`; }).join('');
    return [blk('demandes', 'Demandes de coachs', req.length ? `<div class="sec"><h2>Demandes de coachs</h2><span class="pill wait">${req.length}</span></div><div class="card lift">${pendRows(req)}</div>` : ''),
      blk('coachs', 'Coachs par équipe', `<div class="sec"><h2>Coachs par équipe</h2></div><div class="card"><div class="list">${rows || '<p class="empty">Aucune équipe.</p>'}</div></div><p class="note">Touche une équipe pour nommer son coach ou un coach assistant.</p><button class="btn" data-act="choursb">${icon('check', 20)}Heures des coachs</button>`),
      blk('outils', 'Créer, importer, doublons', teamToolsBlock()), blk('equipes', 'Équipes', teamsBlock()), blk('ajout', 'Ajouter des joueurs', addPlayersBlock(liveIds()))];
  },
  // n° 141 : la banque d'exercices du club, directement dans l'onglet (les plus récents, recherche dans la banque complète)
  exos: () => {
    const cc = S.coachCounts || {}, ex = exosForCounts(), clubEx = ex ? ex.filter((e) => e.club_id === S.clubId && e.sharing !== 'me' && !e.deleted_at) : null;
    const recent = clubEx ? clubEx.slice(0, 6) : [];
    return [
      blk('avalider', 'Exercices à valider', cc.exos ? `<button class="card warn" data-act="cexos" data-tab="club" style="border:0;text-align:left;font:inherit;color:inherit"><b>${plural(cc.exos, 'exercice proposé à tous les clubs', 'exercices proposés à tous les clubs')}</b><span class="note" style="color:var(--pc-texte-ecran)">À valider avant qu’ils soient visibles des autres clubs. Touche pour les voir.</span></button>` : ''),
      blk('banque', 'Banque d’exercices du club', `<div class="sec"><h2>Banque d’exercices du club</h2><span class="det">${clubEx ? plural(clubEx.length, 'exercice') : '…'}</span></div><button class="btn main" data-act="cexos" data-tab="club">${icon('doc', 20)}Ouvrir la banque du club</button>`
        + (recent.length ? `<div class="card"><div class="list">${recent.map((e) => `<button class="row" data-act="cexo" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc([e.category, e.duration_min ? e.duration_min + ' min' : '', S.exAuthors?.[e.id]?.author || (e.created_by === S.me.id ? 'toi' : '')].filter(Boolean).join(' · '))}</small></span><span class="chev"></span></button>`).join('')}</div></div><p class="note">Les ${recent.length} derniers exercices du club. La banque complète a la recherche et les filtres.</p>` : clubEx ? '<p class="empty">Aucun exercice partagé avec le club pour l’instant.</p>' : '')),
      blk('outils', 'Ajouter et statistiques', `<div class="grid2"><button class="btn small" data-act="cexnew">${icon('plus', 18)}Ajouter un exercice</button><button class="btn small" data-act="cstats">${icon('team', 18)}Statistiques</button></div>`),
    ];
  },
  ententes: () => [blk('demandes', 'Demandes d’entente', partnerRequests() || '<p class="empty">Aucune demande d’entente.</p>'), blk('resultats', 'Résultats du club', clubResults())],
  // Communication
  annonces: () => { const mine = S.annonces.filter((x) => x.created_by === S.me.id); return `<button class="btn main" data-act="annnew">${icon('plus', 20)}Nouvelle annonce</button><div class="sec"><h2>Mes annonces</h2><span class="det">${mine.length || ''}</span></div>` + (mine.length ? annList(mine.slice(0, 12), false) : '<p class="empty">Tu n’as pas encore écrit d’annonce. Les annonces du club sont dans l’onglet Messages.</p>'); },
  lecteurs: () => readsBlock(),
  // Personne désignée pour les événements
  events: () => {
    const l = upcoming(S.events.filter((e) => !e.cancelled && ['Événement', 'AG'].includes(e.type) && new Date(e.starts_at) < Date.now() + 120 * DAY));
    return [blk('liste', 'Événements à venir', `<button class="btn main" data-act="evnew" data-type="Événement">${icon('plus', 20)}Nouvel événement</button><div class="sec"><h2>Événements à venir</h2><span class="det">${l.length || ''}</span></div>`
      + (l.length ? `<div class="card"><div class="list">${l.map((e) => `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))}${e.place ? ' · ' + esc(e.place) : ''}</small></span>${missing(e.id) ? `<span class="pill wait" style="flex:none">Il manque ${missing(e.id)}</span>` : '<span class="chev"></span>'}</button>`).join('')}</div></div>` : '<p class="empty">Aucun événement dans les quatre prochains mois.</p>')),
      blk('benevoles', 'Bénévoles', benevBlock(l.filter((e) => new Date(e.starts_at) < Date.now() + 30 * DAY)))];
  },
  // ---------- n° 153 · Aperçu de chaque fonction : ce qui est à faire, puis les droits réglés par le président (n° 155) ----------
  ap_tresorerie: () => [blk('afaire', 'À faire', todo([[lateFees().length, 'cotisation non réglée', 'cotisations non réglées', 'cotis'], [(S.coachCounts || {}).hours || 0, 'relevé d’heures à valider', 'relevés d’heures à valider', 'heures']], 'f:Trésorier'))],
  ap_secretariat: () => { const vp = toValidate(); return [blk('demandes', 'Demandes à valider', vp.length ? `<div class="sec"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card lift">${pendRows(vp)}</div>` : ''), blk('afaire', 'À faire', todo([[incomplete().length, 'fiche incomplète', 'fiches incomplètes', 'fiches']])), blk('droits', 'Droits', rights(['secretary_sees_fees']))]; },
  ap_licences: () => [blk('droits', 'Droits', rights(['secretary_sees_fees']))],
  ap_rencontres: () => [blk('convoquer', 'Convocations à envoyer', convokeBlock()), blk('afaire', 'À faire', todo([[homeSoon(60).filter((e) => !(e.place || '').trim()).length, 'match sans gymnase', 'matchs sans gymnase', 'renc'], [clubEvs().reduce((n, e) => n + missing(e.id), 0), 'place de bénévole à pourvoir', 'places de bénévoles à pourvoir', 'benev']]))],
  ap_technique: () => { const req = toValidate().filter((m) => m.role === 'coach'); return [blk('demandes', 'Demandes de coachs', req.length ? `<div class="sec"><h2>Demandes de coachs</h2><span class="pill wait">${req.length}</span></div><div class="card lift">${pendRows(req)}</div>` : ''), blk('afaire', 'À faire', todo([[noCoachTeams().length, 'équipe sans coach', 'équipes sans coach', 'equipes'], [dupGroups().length, 'doublon d’équipe', 'doublons d’équipes', 'equipes']])), blk('droits', 'Droits', rights(['tech_sees_contacts', 'coach_sees_fees']))]; },
  ap_communication: () => { const mine = S.annonces.filter((x) => x.created_by === S.me.id); return [blk('dernieres', 'Dernières annonces', `<button class="btn main" data-act="annnew">${icon('plus', 20)}Nouvelle annonce</button>` + (mine.length ? `<div class="sec"><h2>Mes dernières annonces</h2></div>` + annList(mine.slice(0, 3), false) : '')), blk('blason', 'Blason et couleurs', brandBlock())]; }, // n° 191 : le blason, venu de « Gestion du club »
  ap_evenements: () => { const l = upcoming(S.events.filter((e) => !e.cancelled && ['Événement', 'AG'].includes(e.type) && new Date(e.starts_at) < Date.now() + 30 * DAY)); return [blk('prochains', 'Dans les 30 jours', l.length ? `<div class="sec"><h2>Dans les 30 jours</h2></div><div class="card"><div class="list">${l.map((e) => evRow(e)).join('')}</div></div>` : '<p class="empty">Aucun événement dans les 30 prochains jours.</p>')]; },
  commun: () => rubBody('commun'),
  rubs: () => rubList(['commun'].concat(S.v44x || [])) + '<p class="note">Accès que le président t’a ouverts en plus de ta fonction.</p>',
};

// ---------- passage de saison pour tout le club (Président › Réglages › Saison) ----------
hooks.seasonBlock = () => {
  const l = live().filter((t) => (t.season || '') !== NEXT_SEASON), on = isArmed('season');
  if (!l.length) return `<div class="card"><p class="note" style="margin:0">Toutes les équipes sont déjà sur la saison ${esc(NEXT_SEASON)}.</p></div>`;
  return `<div class="card"><b>Passer tout le club en ${esc(NEXT_SEASON)}</b><p class="note">${plural(l.length, 'équipe', 'équipes')} de ${esc(SEASON)} : chacune est archivée (elle reste consultable) et recréée pour ${esc(NEXT_SEASON)}, en mode fantôme, avec ses coachs. Les joueurs restent dans l’équipe archivée : ajoute-les ensuite à la nouvelle. La case « Je participe au bénévolat du club » repart cochée pour les membres. Le passage est inscrit au journal.</p><button class="btn ${on ? 'danger armed' : ''}" data-act="seasonall">${on ? `Confirmer : passer ${plural(l.length, 'équipe', 'équipes')} en ${esc(NEXT_SEASON)}` : `Passer le club en ${esc(NEXT_SEASON)}`}</button><p class="note">Pour une seule équipe : Équipes › l’équipe › Effectif › « Archiver et reconduire ».</p></div>`;
};

// ---------- chargement (trésorerie : heures validées du mois dernier et leur montant) ----------
export async function loadV44() {
  S.v44 = { reads: null, hours: null };
  // n° 154 : état des pré-convocations et convocations des rencontres à domicile des 7 prochains jours
  S.cstate7 = [];
  if (S.clubId && hasArea('evenements')) { try { const r = await sb.rpc('convocation_todo', { p_club: S.clubId }); S.cstate7 = Array.isArray(r.data) ? r.data : []; } catch { S.cstate7 = []; } }
  if (!S.clubId || !hasArea('tresorerie') || !isBoard()) return;
  const m = new Date(); m.setDate(1); m.setMonth(m.getMonth() - 1);
  const ym = m.toLocaleDateString('sv-SE').slice(0, 8) + '01';
  const [st, rt] = await Promise.all([
    sb.from('coach_statements').select('user_id,total_minutes').eq('club_id', S.clubId).eq('month', ym).eq('status', 'validated'),
    sb.from('coach_rates').select('user_id,rate').eq('club_id', S.clubId),
  ]);
  const rates = Object.fromEntries((rt.data || []).map((x) => [x.user_id, +x.rate])), l = st.data || [];
  const min = l.reduce((s, x) => s + (+x.total_minutes || 0), 0), priced = l.filter((x) => rates[x.user_id] != null);
  S.v44.hours = { min, label: m.toLocaleDateString('fr-FR', { month: 'long' }), amount: priced.length ? priced.reduce((s, x) => s + ((+x.total_minutes || 0) / 60) * rates[x.user_id], 0) : null };
}

// ---------- actions ----------
Object.assign(ACTIONS, {
  ftab: (el, d) => {
    S.ftabs = S.ftabs || {}; S.ftabs[d.k] = d.v;
    if (d.v === 'lecteurs' && S.v44) S.v44.reads = null; // compte à jour à chaque ouverture
    const f = d.k.slice(2);
    if (d.k.startsWith('f:') && (S.view?.type !== 'espace' || S.casq !== d.k)) { S.casq = d.k; S.view = { type: 'espace' }; }
    else if (d.k.startsWith('v:') && S.view?.type !== 'fview') S.view = { type: 'fview', f, id: f };
    S.noStack = true; render(true);
  },
  feeremall: async () => {
    if (!armed('feeall')) return;
    const r = await run(sb.rpc('remind_fees', { p_club: S.clubId }));
    if (!r) return;
    toast(r.sent ? `${plural(r.sent, 'rappel envoyé', 'rappels envoyés')} (${plural(r.people, 'compte prévenu', 'comptes prévenus')})${r.skipped ? ' · ' + plural(r.skipped, 'joueur sauté', 'joueurs sautés') + ' (déjà relancé cette semaine ou sans compte relié)' : ''}.` : 'Aucun rappel envoyé : les familles ont déjà été relancées cette semaine, ou n’ont pas de compte relié.');
    await refresh();
  },
  xlsxmem: () => { if (armed('xlsxmem')) exportMembers(); }, // n° 178 : avertissement d'abord
  seasonall: async () => {
    if (!armed('season')) return;
    const r = await run(sb.rpc('renew_club_season', { p_club: S.clubId, p_season: NEXT_SEASON }));
    if (!r) return;
    toast(`Club passé en ${NEXT_SEASON} : ${plural(r.teams, 'équipe recréée', 'équipes recréées')} en mode fantôme${r.kept ? ', ' + plural(r.kept, 'déjà prête', 'déjà prêtes') : ''}.`);
    await refresh();
  },
});
void team;
