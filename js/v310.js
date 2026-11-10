// mypocketclub · alpha 3.10.0
// N° 113 : espace coach en deux niveaux (liste des équipes, puis espace de l'équipe avec bandeau et onglets
//          Pointer · Planifier · Préparer · Stats · Effectif, toujours visibles) ; vue par défaut du bouton de rôle.
// N° 114 : espace du président en cinq onglets, dépliants « Bureau » et « Équipes », « Fonctions »,
//          transfert de la présidence accepté par le nouveau président, suppression du club en corbeille.
// N° 115 : « Payer · Bientôt disponible ».
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_10_0.sql) ; l'écran n'est qu'un confort.
import {
  S, sb, esc, hooks, run, toast, render, refresh, armed, isArmed, ACTIONS, club, active, isBoard, isPresident, coachTeams, coachOf,
  SEASON, team, teamName, name, plural, fmtShort, hm, evTeams, store, toValidate, playersOfTeam, isMajor, myKids, mySelf, FONCTIONS, hasArea, fl,
} from './core.js';
import { icon, header, dayBadge, field, clubSeason, casqIcon } from './ui.js';
import { upcoming, evCard, canCallRoll, appelPage, teamTabs, cancelBtn } from './agenda.js';
import { plansForEvent, fmtMin, exosForCounts } from './coach.js';
import { casqTabs, currentCasq, roleKicker, fonctionSpace, presidentOverview, sw, FONCTION_AREAS } from './vie.js';
import { pendRows, brandBlock, contactsBlock, licencesBlock, trashBlock } from './club.js';
import { teamToolsBlock } from './v38.js';
import { arrange, hoursHome } from './v35.js';

const ROLL = ['Entraînement', 'Match', 'Plateau', 'Tournoi'];
const live = (t) => { const x = team(t); return x && !x.deleted_at; };

// ---------- chargement (après loadClub) ----------
export async function loadV310() {
  if (!S.clubId) return;
  const [d, o] = await Promise.all([
    sb.from('club_designations').select('*').eq('club_id', S.clubId),
    sb.from('president_offers').select('*').eq('club_id', S.clubId),
  ]);
  S.desig = d.data || []; S.poffer = (o.data || [])[0] || null;
}

// ---------- n° 113 · contexte « espace de l'équipe » ----------
// Pages qui gardent le bandeau de l'équipe quand on y arrive depuis l'espace de l'équipe (S.tsp = identifiant de l'équipe)
const TEAM_CTX = { tspace: '', appel: 'Pointer', event: 'Planifier', evform: 'Planifier', team: 'Effectif', player: 'Effectif', import: 'Effectif', stats: 'Stats', plans: 'Préparer', exos: 'Préparer', exo: 'Préparer', exoform: 'Préparer', expick: 'Préparer' };
const TAB_LABEL = { pointer: 'Pointer', planifier: 'Planifier', preparer: 'Préparer', stats: 'Stats', effectif: 'Effectif' };
function inCtx(v) {
  if (!S.tsp || !v || !(v.type in TEAM_CTX)) return false;
  if (v.type === 'tspace') return v.id === S.tsp;
  if (v.type === 'team' || v.type === 'import') return v.id === S.tsp;
  if (v.type === 'event' || v.type === 'appel') { const e = S.events.find((x) => x.id === v.id); return !e || evTeams(e).includes(S.tsp); }
  return true;
}
// Appelé au début de chaque affichage : on quitte l'espace de l'équipe dès qu'on va ailleurs (onglet du bas, autre espace)
export function syncTeamCtx() { if (!inCtx(S.view)) S.tsp = null; }
// N° 116 : les onglets de l'équipe sont au bas du bloc bleu de l'en-tête (plus de bandeau de l'équipe dans la page)
export function teamWrap(v, head, body) {
  if (!inCtx(v) || v.type === 'tspace' || String(head).includes('class="ttabs"')) return [head, body];
  return [String(head).replace(/<header class="hd([^"]*)">/, '<header class="hd$1 tabbed">').replace(/<\/header>\s*$/, teamTabs(S.tsp, TEAM_CTX[v.type]) + '</header>'), body];
}
const nextRoll = (tid) => upcoming(S.events.filter((e) => !e.cancelled && evTeams(e).includes(tid) && ROLL.includes(e.type) && canCallRoll(e) && new Date(e.starts_at) > Date.now() - 6 * 3600e3))[0];

// Onglet « Pointer » : l'appel du prochain rendez-vous (avec son bandeau), sinon un bandeau et une invitation à planifier
export function teamPointer(tid) {
  const e = nextRoll(tid);
  if (e) return appelPage(e.id, false);
  return `<div class="card"><p class="empty">Aucun entraînement ni match à pointer pour l’instant.</p><button class="btn main" data-act="tsgo" data-id="${tid}" data-tab="planifier">${icon('calplus', 20)}Planifier un rendez-vous</button></div>`;
}
function planifierBody(tid) {
  const list = S.events.filter((e) => evTeams(e).includes(tid) && !e.cancelled), fut = upcoming(list).slice(0, 40), sel = !!S.sel;
  let h = `<div class="btns"><button class="btn main" data-act="evnew" data-team="${tid}">${icon('plus', 20)}Nouveau rendez-vous</button>${fut.length ? `<button class="btn ghost small" data-act="selmode">${sel ? 'Annuler la sélection' : 'Sélectionner'}</button>` : ''}</div>`;
  if (sel) { const n = S.sel.size; h += `<div class="selbar"><div><span>${plural(n, 'rendez-vous sélectionné', 'rendez-vous sélectionnés')}</span><button class="btn small ${isArmed('sel') ? 'danger armed' : 'ghost'}" data-act="seldel" ${n ? '' : 'disabled'}>${isArmed('sel') ? 'Confirmer la suppression' : 'Supprimer'}</button></div></div>`; }
  h += fut.length ? `<div class="stack">${fut.map((e) => evCard(e, { select: sel })).join('')}</div>` : '<p class="empty">Aucun rendez-vous à venir pour cette équipe.</p>';
  return h;
}
function preparerBody(tid) {
  const soon = Date.now() + 14 * 864e5;
  const evs = upcoming(S.events.filter((e) => !e.cancelled && evTeams(e).includes(tid) && ROLL.includes(e.type) && new Date(e.starts_at) < soon)).slice(0, 6);
  let h = `<div class="chips"><button class="chip" aria-pressed="true">Séances de l’équipe</button><button class="chip" data-act="cplans">Mes séances</button><button class="chip" data-act="cexos" data-tab="mine">Exercices</button></div>`;
  h += evs.length ? evs.map((e) => {
    const p = plansForEvent(e.id)[0];
    return `<div class="stack"><button class="card" data-act="${p ? 'pview' : 'cplanfor'}" data-id="${p ? p.id : e.id}" style="flex-direction:row;align-items:center;gap:12px;border:0;text-align:left;font:inherit;color:inherit">${dayBadge(e.starts_at)}<span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(e.type)} · ${esc(hm(new Date(e.starts_at)))}</b><span class="det">${p ? plural(p.items.length, 'exercice') + ' · ' + fmtMin(p.items.reduce((a, x) => a + (+x.minutes || 0), 0)) : esc(e.title || '')}</span></span>${p ? '<span class="pill ok">Prête</span>' : '<span class="pill ko">À préparer</span>'}</button>${cancelBtn(e)}</div>`;
  }).join('') : '<p class="empty">Aucune séance dans les 14 prochains jours.</p>';
  h += `<div class="grid2"><button class="btn small" data-act="cplan">${icon('doc', 18)}Composer une séance</button><button class="btn small" data-act="cexnew">${icon('plus', 18)}Ajouter un exercice</button></div>`;
  return h;
}
// N° 116 : même bloc bleu que l'espace : en-tête, équipe et « club · saison », casquettes, onglets de l'équipe
function tspaceView(v) {
  const t = team(v.id), tab = v.tab || 'pointer';
  S.tsp = v.id; currentCasq();
  const head = header({ back: true, space: true, title: esc(t?.name || 'Équipe'), under: clubSeason(t?.season || SEASON), casq: casqTabs(), tabs: t ? teamTabs(v.id, TAB_LABEL[tab]) : '' });
  if (!t) return { head, body: '<p class="empty">Équipe introuvable.</p>' };
  const body = tab === 'pointer' ? teamPointer(v.id) : tab === 'planifier' ? planifierBody(v.id) : preparerBody(v.id);
  return { head, body };
}

// ---------- n° 113 · niveau 2 : « Espace coach » (toutes les équipes du coach) ----------
function answers(e) {
  const r = { oui: 0, non: 0 }; (S.answers || S.rsvps || []).filter((a) => a.event_id === e.id).forEach((a) => { if (a.answer === 'oui' || a.status === 'oui') r.oui++; else if (a.answer === 'non' || a.status === 'non') r.non++; });
  return r;
}
export function coachHub(ids) {
  const tids = ids.filter(live);
  const cards = tids.map((t) => {
    const e = upcoming(S.events.filter((x) => !x.cancelled && evTeams(x).includes(t))).find(() => true);
    const vp = toValidate().filter((m) => m.team_id === t).length;
    return `<button class="card" data-act="tsopen" data-id="${t}" style="flex-direction:row;align-items:center;gap:12px;border:0;text-align:left;font:inherit;color:inherit">${e ? dayBadge(e.starts_at) : `<span style="width:52px;height:52px;border-radius:16px;background:var(--pc-bleu-pale);display:flex;align-items:center;justify-content:center;flex:none">${icon('team', 24, 'var(--pc-bleu)')}</span>`}<span style="display:flex;flex-direction:column;flex:1;min-width:0"><b style="font-size:18px">${esc(teamName(t))}</b><span class="det">${e ? esc(e.type + ' · ' + fmtShort(e.starts_at)) : 'Aucun rendez-vous à venir'} · ${plural(playersOfTeam(t).length, 'joueur')}</span></span>${vp ? `<span class="pill wait">${vp}</span>` : ''}<span class="chev"></span></button>`;
  }).join('');
  // « À faire » : alertes de toutes les équipes ; un toucher ouvre la bonne équipe
  const todo = [];
  tids.forEach((t) => {
    const vp = toValidate().filter((m) => m.team_id === t).length;
    if (vp) todo.push(['tsgo', t, 'effectif', plural(vp, 'demande à valider', 'demandes à valider') + ' · ' + teamName(t)]);
    const soon = Date.now() + 7 * 864e5;
    const todoPlans = upcoming(S.events.filter((e) => !e.cancelled && evTeams(e).includes(t) && e.type === 'Entraînement' && new Date(e.starts_at) < soon)).filter((e) => !plansForEvent(e.id).length).length;
    if (todoPlans) todo.push(['tsgo', t, 'preparer', plural(todoPlans, 'séance à préparer', 'séances à préparer') + ' · ' + teamName(t)]);
  });
  const todoH = `${hoursHome()}${todo.length ? `<div class="card"><div class="list">${todo.map(([a, id, tab, l]) => `<button class="row" data-act="${a}" data-id="${id}" data-tab="${tab}"><span class="g">${esc(l)}</span><span class="chev"></span></button>`).join('')}</div></div>` : ''}`;
  const ex = exosForCounts(); // n° 135 : plus de « 0 » trompeur avant le chargement
  const bank = `<div class="sec"><h2>Mes exercices</h2><button data-act="cexos" data-tab="mine">Ma banque</button></div><div class="tiles"><button class="tile blue" data-act="cexos" data-tab="mine"><b>${ex ? ex.filter((e) => e.created_by === S.me.id && !e.deleted_at).length : '…'}</b><span>Ma banque</span></button><button class="tile" data-act="cexos" data-tab="club"><b>${ex ? ex.filter((e) => e.club_id === S.clubId && e.sharing !== 'me' && !e.deleted_at).length : '…'}</b><span>Du club</span></button><button class="tile" data-act="cexos" data-tab="libre"><b>${ex ? ex.filter((e) => e.sharing === 'public' && e.public_state === 'validated' && !e.deleted_at).length : '…'}</b><span>Libre</span></button></div><button class="bigadd" data-act="cexnew">${icon('plus', 24, '#11162E', 2.6)}Ajouter un exercice</button>`;
  return arrange('coach2', [
    { id: 'equipes', pin: true, html: cards || '<p class="empty">Aucune équipe.</p>' }, // n° 116 : « Mes équipes » est le titre de l'en-tête
    { id: 'afaire', label: 'À faire', html: todoH.trim() ? `<div class="sec"><h2>À faire</h2></div>${todoH}` : '' },
    { id: 'exercices', label: 'Mes exercices', html: bank },
    { id: 'heures', label: 'Mes heures', html: `<button class="btn" data-act="chours">${icon('check', 20)}Mes heures · relevé du mois</button>` },
  ]);
}
// Coach d'une seule équipe : l'espace de l'équipe directement (onglet Pointer) ; les onglets sont dans l'en-tête (n° 116)
export function coachSingle(tid) {
  S.tsp = tid;
  const vp = toValidate().filter((m) => m.team_id === tid).length;
  // alertes au-dessus ; « Mes heures » et « Mes exercices » (à la personne) sous le contenu de l'onglet (n° 116)
  return hoursHome() + (vp ? `<button class="btn main" data-act="tsgo" data-id="${tid}" data-tab="effectif">${plural(vp, 'demande à valider', 'demandes à valider')}</button>` : '')
    + teamPointer(tid) + `<div class="grid2"><button class="btn small" data-act="chours">${icon('check', 18)}Mes heures</button><button class="btn small" data-act="cexos" data-tab="mine">${icon('doc', 18)}Mes exercices</button></div>`;
}

// ---------- vue par défaut du bouton de rôle (n° 113) ----------
const defKey = () => 'pc_casqdef_' + S.clubId;
export const defaultCasq = () => store.get(defKey());
export function defaultAsk() {
  const c = currentCasq(); if (!c || !S.defAsk || S.defAsk !== c.k) return '';
  // n° 116 : une ligne discrète en bas de page, plus un encart en haut
  return `<p class="defline">Ouvrir « ${esc(c.label)} » directement avec le bouton de rôle ? <button data-act="casqdef" data-v="${esc(c.k)}">Oui, par défaut</button> · <button data-act="casqdefno">Non merci</button></p>`;
}

// ---------- n° 114 · espace du président ----------
const RESP = [
  ['licences', 'Contact licences', 'Licences et contact licences affiché sur le site'],
  ['rencontres', 'Contact rencontres', 'Matchs, plateaux, tournois, convocations, bénévoles'],
  ['evenements', 'Événements', 'Événements du club, participants, bénévoles'],
  ['communication', 'Communication', 'Annonces, « lu par », relances'],
];
const holder = (f) => S.members.filter((m) => m.role === 'bureau' && m.status === 'active' && m.fonction === f).map((m) => name(m.user_id));
const presName = () => name((S.members.find((m) => m.role === 'president' && m.status === 'active') || {}).user_id);
function defaultHolder(r) {
  if (r === 'licences') return holder('Secrétaire')[0] || presName();
  if (r === 'rencontres') return [presName(), holder('Vice-président')[0]].filter(Boolean).join(' et ');
  return presName();
}
// Adultes du club : on écarte les comptes reliés à une fiche joueur mineure (la base vérifie aussi)
export function adultMembers() {
  const minors = new Set(S.players.filter((p) => p.user_id && !isMajor(p)).map((p) => p.user_id));
  return [...new Set(S.members.filter((m) => m.status === 'active').map((m) => m.user_id))].filter((u) => !minors.has(u)).sort((a, b) => name(a).localeCompare(name(b), 'fr'));
}
// Ce que donne chaque fonction (garde-fou : le président voit les droits avant de confirmer)
export const FONCTION_RIGHTS = {
  'Vice-président': 'Toutes les rubriques, comme le président, sauf supprimer le club, transférer la présidence, nommer le bureau, régler la visibilité et les droits des coachs',
  'Trésorier': 'Trésorerie : cotisations, versements, relances, tarifs, réductions, heures des coachs, état des licences', 'Trésorier adjoint': 'Comme le trésorier',
  'Secrétaire': 'Secrétariat : demandes, fiches, licences, import et export', 'Secrétaire adjoint': 'Comme le secrétaire',
  'Correspondant licences': 'Licences (état, numéro, certificat fourni) et contact licences', 'Directeur technique': 'Technique : toutes les équipes, coachs, exercices, ententes',
  'Correspondant rencontres': 'Événements : matchs, plateaux, tournois, convocations, bénévoles', 'Chargé de communication': 'Communication : annonces et lecteurs',
  'Responsable sponsoring': 'Pas d’espace pour l’instant (rubrique Commun)', 'Membre du bureau': 'Rubrique Commun, et les rubriques que tu ouvres en plus',
};
export function rightsNote() {
  return `<details class="card"><summary>Ce que donne chaque fonction</summary><div class="list">${FONCTIONS.map((f) => `<div class="row static"><span class="g">${esc(fl(f))}<small>${esc(FONCTION_RIGHTS[f] || '')}</small></span></div>`).join('')}</div><p class="note">Les droits s’additionnent quand une personne a plusieurs fonctions. Seuls les adultes reçoivent une fonction.</p></details>`;
}

function presBand() {
  const vp = toValidate().length, live2 = S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée');
  const noCoach = live2.filter((t) => !S.members.some((m) => m.role === 'coach' && m.status === 'active' && m.team_id === t.id)).length;
  const fees = S.padmin.filter((a) => a.fee_amount != null && +a.fee_amount - (+a.fee_paid || 0) > 0).length;
  const empty = ['Vice-président', 'Secrétaire', 'Trésorier'].filter((f) => !holder(f).length).length;
  const tile = (n, l, act, extra = '') => `<button class="tile ${n ? 'wait' : 'ok'}" data-act="${act}" ${extra}><b>${n}</b><span>${l}</span></button>`;
  return `<div class="tiles" style="grid-template-columns:repeat(2,1fr)">${tile(vp, 'Demandes à valider', 'ptab', 'data-v="demandes"')}${tile(noCoach, 'Équipes sans coach', 'ptab', 'data-v="ensemble"')}${tile(fees, 'Cotisations à relancer', 'rub', 'data-id="tresorerie"')}${tile(empty, 'Fonctions sans titulaire', 'ptab', 'data-v="qui"')}</div>`;
}
function bureauFold() {
  const rows = FONCTIONS.filter((f) => f !== 'Membre du bureau').map((f) => { const h = holder(f); return `<button class="row" data-act="fview" data-v="${esc(f)}"><span class="g">${esc(fl(f))}<small>${h.length ? esc(h.join(', ')) : 'Personne : c’est toi'}</small></span><span class="chev"></span></button>`; }).join('');
  return `<details class="card" ${S.pfold === 'bureau' ? 'open' : ''} data-pfold="bureau"><summary>${icon('user', 18)} Bureau</summary><div class="list">${rows}</div></details>`;
}
export function teamsFold() {
  const l = S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée');
  const cats = [...new Set(l.map((t) => t.category || 'Autres'))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  const many = l.length > 8;
  const row = (t) => `<button class="row" data-act="tsopen" data-id="${t.id}"><span class="g">${esc(t.name)}<small>${esc([t.category !== t.name ? t.category : '', t.gender].filter(Boolean).join(' · '))}</small></span><span class="chev"></span></button>`;
  const inner = !l.length ? '<p class="empty">Aucune équipe.</p>' : many ? cats.map((c) => `<div class="kick" style="margin-top:8px">${esc(c)}</div><div class="list">${l.filter((t) => (t.category || 'Autres') === c).map(row).join('')}</div>`).join('') : `<div class="list">${l.map(row).join('')}</div>`;
  // n° 116 : créer, importer et doublons dans le même dépliant (plus de bloc « Créer des équipes » à part)
  return `<details class="card" ${S.pfold === 'equipes' ? 'open' : ''} data-pfold="equipes"><summary>${icon('team', 18)} Équipes</summary>${inner}${teamToolsBlock(true)}</details>`;
}
const PTABS = [['ensemble', 'Vue d’ensemble'], ['demandes', 'Demandes'], ['qui', 'Fonctions'], ['reglages', 'Réglages'], ['journal', 'Journal']];
// N° 116 : les cinq onglets du président au bas du bloc bleu de l'en-tête, juste sous les casquettes
export function presidentTabs() {
  const t = S.ptab || 'ensemble';
  return `<nav class="ttabs" aria-label="Espace du président">${PTABS.map(([k, l]) => `<button data-act="ptab" data-v="${k}" ${t === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>`;
}
export function presidentSpace310() {
  const t = S.ptab || 'ensemble';
  let h = '';
  // n° 116 : bandeau et dépliants « Bureau » et « Équipes » dans « Vue d'ensemble »
  if (t === 'ensemble') h += presBand() + bureauFold() + teamsFold() + presidentOverview();
  else if (t === 'demandes') { const vp = toValidate(); h += vp.length ? `<div class="card lift">${pendRows(vp)}</div><p class="note">Toi seul valides les demandes des membres du bureau. Le secrétariat et les coachs valident aussi les autres.</p>` : '<p class="empty">Aucune demande à valider.</p>'; }
  else if (t === 'qui') h += quiView();
  else if (t === 'reglages') h += reglagesView();
  else h += journalBody();
  return h;
}
// n° 170 (4.8.0) : « Contact licences » et « Contact rencontres » sont des rôles. Ils s'attribuent seulement dans
// « Fonctions du bureau » ; ici, un aperçu en lecture seule avec un lien. Événements et Communication gardent le choix.
const ROLE_OF = { licences: 'Correspondant licences', rencontres: 'Correspondant rencontres' };
function quiView() {
  const ad = adultMembers();
  let h = '<p class="note">Une personne par responsabilité. Sans choix, c’est la personne indiquée par défaut. Les deux contacts sont des rôles : ils s’attribuent dans « Fonctions du bureau ». Tout est inscrit au journal.</p>';
  h += RESP.map(([k, l, d]) => {
    if (ROLE_OF[k]) {
      const who = holder(ROLE_OF[k])[0];
      return `<div class="card" data-role-view="${k}"><b style="font-size:18px">${esc(l)}</b><span class="det">${esc(d)}</span><div class="row static"><span class="g">${esc(who || defaultHolder(k) || 'Personne')}<small>${who ? 'A le rôle « ' + esc(l) + ' »' : 'Par défaut : personne n’a ce rôle'}</small></span></div><button class="btn small" data-act="fonctions">${icon('user', 18)}Modifier dans « Fonctions du bureau »</button></div>`;
    }
    const cur = (S.desig || []).find((x) => x.resp === k);
    return `<div class="card"><b style="font-size:18px">${esc(l)}</b><span class="det">${esc(d)}</span>${field('ds' + k, cur ? 'Désigné' : 'Par défaut : ' + defaultHolder(k), `<select id="ds${k}" data-desig="${k}"><option value="">${esc('Par défaut · ' + defaultHolder(k))}</option>${ad.map((u) => `<option value="${u}" ${cur?.user_id === u ? 'selected' : ''}>${esc(name(u))}</option>`).join('')}</select>`)}</div>`;
  }).join('');
  h += `<button class="btn" data-act="fonctions">${icon('user', 20)}Fonctions du bureau (nommer, retirer, rubriques en plus)</button>` + rightsNote();
  return h;
}
function reglagesView() {
  const c = club(), ad = adultMembers().filter((u) => u !== S.me.id), off = S.poffer;
  let h = `<div class="sec"><h2>Club</h2></div><div class="card">${sw('public_listed', 'Apparaître dans la recherche des clubs', 'Nom, ville, équipes visibles et créneaux seulement.', c.public_listed !== false)}</div>` + brandBlock() + contactsBlock();
  // 4.4.0 (n° 114) : « cotisation à jour » pour le Secrétariat (non par défaut) ; coordonnées des familles pour le Directeur technique (oui par défaut)
  h += `<div class="sec"><h2>Droits</h2></div><div class="card">${sw('coach_sees_fees', 'Les coachs voient licences et cotisations', 'De leurs joueurs seulement, sans les réductions.', c.coach_sees_fees !== false)}${sw('secretary_sees_fees', 'Le secrétariat voit « cotisation à jour »', 'Oui ou non pour chaque joueur, jamais les montants. Vaut aussi pour le contact licences.', c.secretary_sees_fees === true)}${sw('tech_sees_contacts', 'Le Directeur technique voit les coordonnées des familles', 'Parents et joueurs : téléphone, e-mail, contact d’urgence. Celles de ses propres équipes restent visibles s’il est aussi coach.', c.tech_sees_contacts !== false)}${sw('custom_header', 'Aux couleurs du club', 'L’en-tête prend la couleur principale du club.', c.custom_header)}</div>`;
  h += `<div class="sec"><h2>Saison</h2></div>` + (hooks.seasonBlock ? hooks.seasonBlock() : '');
  // Zone sensible
  h += `<div class="sec"><h2>Zone sensible</h2></div><div class="card" style="border:2px solid var(--pc-erreur, #D93A3A)"><b>Transférer la présidence</b>`;
  if (off) h += `<p class="note">Proposée à <b>${esc(name(off.to_user))}</b> le ${esc(new Date(off.created_at).toLocaleDateString('fr-FR'))}. Tu restes président tant que la personne n’a pas accepté (14 jours au plus).</p><button class="btn ghost small" data-act="poffercancel">Annuler la proposition</button>`;
  else h += `<p class="note">La personne choisie doit accepter. Ensuite, tu restes au bureau comme membre.</p><div class="grid2" style="align-items:end">${field('pto', 'Nouveau président', `<select id="pto"><option value="">Choisir…</option>${ad.map((u) => `<option value="${u}">${esc(name(u))}</option>`).join('')}</select>`)}<button class="btn small ${isArmed('poffer') ? 'danger armed' : ''}" data-act="poffer">${isArmed('poffer') ? 'Confirmer la proposition' : 'Proposer'}</button></div>`;
  h += `<hr style="border:0;border-top:1px solid var(--pc-ligne, #E3E6F0);margin:12px 0"><b>Supprimer le club</b><p class="note">Le club part à la corbeille pendant 30 jours : les membres ne le voient plus, toi seul peux le restaurer. Ensuite, tout est effacé. Tape le nom du club pour confirmer.</p>${field('cdel', 'Nom du club', `<input id="cdel" autocomplete="off" placeholder="${esc(c.name)}">`)}<button class="btn ghost small danger" data-act="clubdel">Supprimer le club</button></div>`;
  // n° 116 : la corbeille du club (30 jours), venue de l'ancienne rubrique « Commun »
  h += trashBlock();
  return h;
}
function journalBody() {
  const l = S.journal;
  if (l === undefined) { S.journal = null; run(sb.rpc('club_log', { p_club: S.clubId, p_limit: 100 })).then((r) => { S.journal = r || []; render(true); }); }
  if (!l) return '<p class="empty">Chargement…</p>';
  if (!l.length) return '<p class="empty">Aucune action pour l’instant.</p>';
  return `<p class="note">Les 100 dernières actions, avec le nom de la personne qui les a faites.</p><div class="card"><div class="list">${l.map((x) => `<div class="row static"><span class="g">${esc(x.action)}${x.target ? ' · ' + esc(x.target) : ''}<small>${esc(new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))} · par ${esc(x.actor)}</small></span></div>`).join('')}</div></div>`;
}

// Espace d'une fonction vu par le président (dépliant « Bureau ») : ses actions restent à son nom
function fviewView(v) {
  const f = v.f;
  const o = hooks.fnSpace ? hooks.fnSpace(f, false) : null; // 4.4.0 (n° 114) : même présentation que la personne qui a la fonction
  // n° 133 : la casquette « Président » reste allumée (en jaune) : on voit tout de suite qu'on est ici grâce à elle
  if (isPresident()) S.casq = 'president';
  return { head: header({ back: true, kicker: 'Espace Président · Bureau', title: esc(fl(f)), casq: casqTabs() || (isPresident() ? `<div class="casq" role="tablist" aria-label="Mes casquettes"><button role="tab" data-act="casq" data-v="president" aria-selected="true">${casqIcon('president')}<span>Président</span></button></div>` : ''), tabs: o?.tabs || '' }), body: `<div class="card pale"><p class="note" style="margin:0">Tu vois l’espace « ${esc(fl(f))} » avec ton compte : ce que tu fais ici est inscrit au journal <b>à ton nom</b>.${holder(f).length ? ' Titulaire : ' + esc(holder(f).join(', ')) + '.' : ' Personne n’a cette fonction : c’est toi qui t’en occupes.'}</p></div>` + (o ? o.body : fonctionSpace(f, true)) };
}

// ---------- contact licences (sans tout le Secrétariat) ----------
export function licencesOnlyBlock() {
  if (!hasArea('licences') || hasArea('secretariat')) return '';
  return `<div class="sec"><h2>Licences</h2></div>${licencesBlock()}<div class="sec"><h2>Contact licences</h2></div><div class="card"><p class="note" style="margin:0">Choisis les coordonnées affichées pour les questions de licence (téléphone, e-mail) dans Mon compte › Contact du club.</p><button class="btn small" data-act="account">${icon('user', 18)}Régler mon contact licences</button></div>`;
}

// ---------- n° 114 · présidence proposée (Accueil de la personne choisie) ----------
export function presidencyCard() {
  const o = S.poffer; if (!o || o.to_user !== S.me.id) return '';
  return `<div class="card" style="border:3px solid var(--pc-jaune)"><b style="font-size:18px">Présidence du club</b><p class="note" style="margin:0">${esc(name(o.from_user))} te propose de devenir président de ${esc(club()?.name || 'ton club')}. Tu recevras tous les droits du président ; ${esc(name(o.from_user))} restera au bureau.</p><div class="btns"><button class="btn main small" data-act="panswer" data-v="1">Accepter</button><button class="btn ghost small" data-act="panswer" data-v="0">Refuser</button></div></div>`;
}
// ---------- n° 114 · club dans la corbeille ----------
export function clubTrashBanner() {
  const c = club(); if (!c?.deleted_at) return '';
  const end = new Date(new Date(c.deleted_at).getTime() + 30 * 864e5).toLocaleDateString('fr-FR');
  return `<div class="card" style="border:3px solid var(--pc-erreur, #D93A3A)"><b>Club dans la corbeille</b><p class="note" style="margin:0">Les membres ne le voient plus. Il sera effacé le ${esc(end)}.</p><button class="btn main small" data-act="clubrestore">Restaurer le club</button></div>`;
}
export function clubGoneScreen() {
  const c = club();
  return `<main class="bd"><div class="card"><b style="font-size:20px">${esc(c?.name || 'Ce club')} a été supprimé</b><p class="note">Le président a envoyé le club à la corbeille. Il sera effacé dans 30 jours, sauf si le président le restaure.</p><button class="btn" data-act="account">${icon('user', 20)}Mon compte</button></div></main>`;
}

// ---------- n° 115 · paiement en ligne : bientôt ----------
export function payFamilySoon(p) {
  if (!p || !(myKids().some((k) => k.id === p.id) || mySelf().some((k) => k.id === p.id))) return '';
  // n° 114 (décision du 5 novembre 2026) : le bouton reste « bientôt », mais chaque toucher est compté pour mesurer l'intérêt
  return `<button class="btn ghost" data-act="paytap" aria-disabled="true" style="opacity:.6">${icon('doc', 20)}Payer ma cotisation · Bientôt disponible</button>`;
}
export const payTreasurerSoon = () => `<div class="card pale" style="flex-direction:row;align-items:center;gap:12px"><span class="g" style="flex:1"><b>Paiement en ligne</b><br><span class="det">Bientôt disponible. L’argent ira directement sur le compte du club.</span></span><span class="pill">Bientôt</span></div>`;

export const V310_VIEWS = { tspace: tspaceView, fview: fviewView };

// ---------- actions ----------
Object.assign(ACTIONS, {
  // n° 132 : ouvre le dépliant « Équipes » de la vue d'ensemble, formulaire « Créer une équipe » déplié
  tcreateopen: () => { S.ptab = 'ensemble'; S.pfold = 'equipes'; S.tcreate = true; render(true); const d = document.querySelector('details[data-tcreate]'); if (d) { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); d.querySelector('select,input')?.focus({ preventScroll: true }); } },
  // Ouvrir l'espace d'une équipe (depuis la liste des équipes du coach ou le dépliant « Équipes » du président)
  tsopen: (el, d) => { S.sel = null; S.tsp = d.id; S.view = { type: 'tspace', id: d.id, tab: 'pointer' }; render(); },
  // Onglets du bandeau : Pointer · Planifier · Préparer · Stats · Effectif (sans empiler les onglets dans le bouton Retour)
  tsgo: async (el, d) => {
    const tid = d.id, tab = d.tab || 'pointer', wasIn = !!S.tsp && S.tsp === tid;
    S.tsp = tid; S.sel = null; if (wasIn) S.noStack = true;
    if (tab === 'stats') { S.st = { team: tid, period: S.st?.period || 'saison' }; S.view = { type: 'stats' }; render(); await ACTIONS.stteam(el, { id: tid }); return; }
    if (tab === 'effectif') { S.view = { type: 'team', id: tid }; render(); return; }
    S.view = { type: 'tspace', id: tid, tab }; render();
  },
  paytap: async () => { await sb.rpc('tap_feature', { p_feature: 'payer', p_club: S.clubId }); toast('Le paiement en ligne arrive bientôt. Merci, ton intérêt est noté.'); },
  tapcounts: async () => { const r = await run(sb.rpc('feature_tap_counts')); if (!r) return; const p = (Array.isArray(r) ? r : []).find((x) => x.feature === 'payer'); toast(p ? `« Payer » : ${p.people} personne${p.people > 1 ? 's' : ''}, ${p.clubs} club${p.clubs > 1 ? 's' : ''} (dernier toucher le ${new Date(p.last_day + 'T12:00').toLocaleDateString('fr-FR')}).` : '« Payer » : aucun toucher pour l’instant.'); },
  casqdef: (el, d) => { store.set(defKey(), d.v); S.defAsk = null; toast('C’est noté : cet espace s’ouvrira par défaut.'); render(true); },
  casqdefno: () => { S.defAsk = null; render(true); },
  ptab: (el, d) => { S.ptab = d.v; if (d.v === 'journal') S.journal = undefined; if (S.view?.type !== 'espace' || S.casq !== 'president') { S.casq = 'president'; S.view = { type: 'espace' }; } render(true); },
  fview: (el, d) => { S.view = { type: 'fview', f: d.v, id: d.v }; render(); },
  poffer: async () => {
    const u = document.getElementById('pto')?.value; if (!u) return toast('Choisis la personne.');
    if (!armed('poffer')) return;
    if (await run(sb.rpc('offer_presidency', { p_club: S.clubId, p_user: u }), 'Proposition envoyée : la personne doit accepter.')) { await loadV310(); render(true); }
  },
  poffercancel: async () => { if (await run(sb.rpc('offer_presidency', { p_club: S.clubId, p_user: null }), 'Proposition annulée.')) { await loadV310(); render(true); } },
  panswer: async (el, d) => { if (await run(sb.rpc('answer_presidency', { p_club: S.clubId, p_accept: d.v === '1' }), d.v === '1' ? 'Tu es président du club.' : 'Proposition refusée.')) await refresh(); },
  clubdel: async () => {
    const v = document.getElementById('cdel')?.value || '';
    if (v.trim().toLowerCase() !== (club()?.name || '').trim().toLowerCase()) return toast('Tape exactement le nom du club pour confirmer.');
    const r = await run(sb.rpc('delete_club', { p_club: S.clubId, p_name: v }));
    if (r) { toast('Club envoyé à la corbeille pour 30 jours.'); await refresh(); }
  },
  clubrestore: async () => { if (await run(sb.rpc('restore_club', { p_club: S.clubId }), 'Club restauré.')) await refresh(); },
});
// Choix d'une personne dans « Fonctions »
document.addEventListener('change', async (e) => {
  const k = e.target?.dataset?.desig; if (!k) return;
  const u = e.target.value || null;
  if (await run(sb.rpc('set_designation', { p_club: S.clubId, p_resp: k, p_user: u }), u ? 'C’est noté : la personne est prévenue.' : 'Retour à la personne par défaut.')) { await refresh(); }
  else render(true);
});
// Dépliants « Bureau » et « Équipes » : on garde celui qui est ouvert
document.addEventListener('toggle', (e) => { const f = e.target?.dataset?.pfold; if (f) S.pfold = e.target.open ? f : (S.pfold === f ? null : S.pfold); }, true);
