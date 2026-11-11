// mypocketclub · vie du club (alpha 3.2) : espaces par casquette (charte du 31 octobre), rubriques du bureau (n° 55),
// fonctions (n° 54), annonces officielles et relances, bénévoles (n° 53), accueil multi-clubs, recherche connectée (n° 56).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_2.sql) ; l'écran n'est qu'un confort.
import {
  S, sb, esc, hooks, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, club, active, isBoard, isPresident, coachTeams, coachOf,
  SEASON, hasArea, AREAS, FONCTIONS, fl, casquettes, isCoachCasq, team, teamName, name, nick, plural, fmtShort, hm, evTeams, store, playersOfTeam, toValidate, myKids, loadNames,
  teamsOfPlayer, isMajor, pl,
} from './core.js';
import { icon, crest, delBtn, field, header, dayBadge, casqIcon, clubSeason } from './ui.js';
import { upcoming, teamTabs } from './agenda.js';
import { pendRows, licencesBlock, namesToCheck, feesBlock, teamsBlock, brandBlock, contactsBlock, trashBlock, membersBlock, effectifsBlock } from './club.js';
import { ensureExos, plansForEvent, planForEvent, fmtMin } from './coach.js';
import { searchBlock } from './auth.js';
import { arrange, hoursHome, hoursCheckBlock, clubResults, partnerRequests } from './v35.js';
import { teamToolsBlock, teamImportPage } from './v38.js';
import { coachHub, coachSingle, defaultAsk, defaultCasq, presidentSpace310, presidentTabs, licencesOnlyBlock, clubTrashBanner, payTreasurerSoon, rightsNote } from './v310.js';

// Rubriques de chaque fonction (même table que la base : fonction_areas)
export const FONCTION_AREAS = {
  'Vice-président': Object.keys(AREAS), 'Trésorier': ['tresorerie'], 'Trésorier adjoint': ['tresorerie'], 'Secrétaire': ['secretariat'], 'Secrétaire adjoint': ['secretariat'],
  // n° 114 : « Correspondant licences » = les licences seulement (sous-rubrique « licences », hors AREAS) ; « Correspondant rencontres » (ex-coordinateur)
  // sans la rubrique Technique ; « Directeur technique » (ex-directeur sportif) ; le sponsoring n'a pas encore d'espace
  'Correspondant licences': [], 'Directeur technique': ['technique'], 'Correspondant rencontres': ['evenements'], 'Chargé de communication': ['communication'], 'Responsable événements': ['evenements'], // 5.2.0 (n° 172)
  'Responsable sponsoring': [], 'Membre du bureau': [],
};
const AREA_ICON = { tresorerie: 'doc', secretariat: 'user', technique: 'team', communication: 'msg', evenements: 'cal', commun: 'shield' };
const eur = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';

// ---------- espaces ----------
// N° 100 : « coach » (une équipe) ou « coach:<équipe> » (plusieurs) ; un choix mémorisé qui n'existe plus retrouve la bonne casquette
// (par exemple « coach » gardé avant la 3.8.0 : l'équipe affichée dans l'onglet Équipe, sinon la première équipe coachée)
export function resolveCasq(k) {
  const l = casquettes(); if (!l.length) return null;
  if (!l.some((x) => x.k === k) && isCoachCasq(k)) { const want = l.find((x) => x.k === 'coach:' + S.teamSel) || l.find((x) => isCoachCasq(x.k)); if (want) k = want.k; }
  // n° 120 : sans choix enregistré, la fonction du bureau (Directeur technique…) s'ouvre avant la casquette « Coach »
  if (!l.some((x) => x.k === k)) k = (l.find((x) => x.k.startsWith('f:')) && isCoachCasq(l[0].k) ? l.find((x) => x.k.startsWith('f:')) : l[0]).k;
  return k;
}
export function currentCasq() {
  const l = casquettes(); if (!l.length) return null;
  const k = resolveCasq(S.casq || store.get('pc_casq_' + S.clubId));
  S.casq = k; return l.find((x) => x.k === k);
}
export function casqTabs() {
  const l = casquettes(); if (l.length < 2) return '';
  // n° 85 : rangée bien visible, reconnaissable comme des boutons de rôle (contour marqué, icône devant chaque nom)
  // n° 98 : icône « cible » pour le directeur sportif ; n° 116 : rangée dans le bloc bleu de l'en-tête, casquette ouverte
  // en jaune (style.css), sans la phrase « Tes casquettes · touche pour changer d'espace »
  // 5.1.0 : nommée « Mes rôles » (n° 194) ; chiffre de ce qui attend dans chaque rôle (n° 190)
  return `<div class="casq" role="tablist" aria-label="Mes rôles">${l.map((x) => `<button role="tab" data-act="casq" data-v="${esc(x.k)}" aria-selected="${x.k === S.casq}">${casqIcon(x.k)}<span>${esc(x.label)}</span>${hooks.roleBadge ? hooks.roleBadge(x.k) : ''}</button>`).join('')}</div>`;
}
// N° 101 : rappel du rôle dans l'en-tête des pages ouvertes depuis un espace (« Gestion du club », « Fonctions du bureau », journal)
export function roleKicker(fallback) {
  const c = currentCasq(); if (!c) return fallback;
  return 'Espace ' + (c.k === 'president' ? 'Président' : isCoachCasq(c.k) ? c.label : 'Bureau · ' + c.label);
}
function espaceView() {
  const c = currentCasq();
  if (!c) return { head: header({ back: true, title: 'Espace' }), body: '<p class="empty">Aucune fonction dans ce club.</p>' };
  // N° 116 : un seul bloc bleu (en-tête, qui, casquettes, onglets) ; le titre dit l'équipe ou le rôle, une seule fois
  const one = isCoachCasq(c.k) && c.teams.length === 1;
  let body = clubTrashBanner(), tabs = '', title = esc(c.label), under = clubSeason(SEASON);
  // n° 113 : une équipe → l'espace de l'équipe directement ; plusieurs → la liste des équipes (niveau 2)
  if (one) { const t = team(c.teams[0]); title = esc(teamName(c.teams[0])); under = clubSeason(t?.season || SEASON); tabs = teamTabs(c.teams[0], 'Pointer'); body += coachSingle(c.teams[0]); }
  else if (isCoachCasq(c.k)) { title = 'Mes équipes'; body += coachHub(c.teams); }
  else if (c.k === 'president') { title = 'Président'; tabs = presidentTabs(); body += presidentSpace310(); } // n° 114 : cinq onglets
  else { const f = c.k.slice(2), o = hooks.fnSpace ? hooks.fnSpace(f, true) : null; if (o) { tabs = o.tabs; body += o.body; } else body += fonctionSpace(f); } // 4.4.0 (n° 114) : bandeau + onglets (js/v44.js)
  body += defaultAsk(); // n° 116 : une ligne discrète en bas de page
  return { head: header({ back: true, space: true, title, under, casq: casqTabs(), tabs }), body };
}

// N° 95 · ajout de joueurs (un par un, liste, Excel, photo) dans les espaces, plus dans l'onglet Équipe ; une touche par équipe
export function addPlayersBlock(tids) {
  const l = tids.filter((t) => { const x = team(t); return x && !x.deleted_at && x.state !== 'Archivée'; });
  if (!l.length) return '';
  if (l.length === 1) return `<button class="btn" data-act="import" data-id="${l[0]}">${icon('plus', 20)}Ajouter des joueurs · ${esc(teamName(l[0]))}</button>`;
  return `<div class="sec"><h2>Ajouter des joueurs</h2></div><div class="card"><p class="note" style="margin:0">Un par un, une liste copiée, un fichier Excel ou une photo. Choisis l’équipe :</p><div class="chips">${l.map((t) => `<button class="chip" data-act="import" data-id="${t}">${icon('plus', 16)} ${esc(teamName(t))}</button>`).join('')}</div></div>`;
}
const clubTeamIds = () => S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée').map((t) => t.id);

// n° 113 (3.10.0) : l'ancien espace coach (une seule page) est remplacé par js/v310.js (liste des équipes, puis espace de l'équipe)

export function presidentOverview() {
  const fees = S.padmin.filter((a) => a.fee_amount != null), due = fees.reduce((a, x) => a + +x.fee_amount, 0), paid = fees.reduce((a, x) => a + Math.min(+x.fee_paid || 0, +x.fee_amount), 0);
  const tiles = `<div class="tiles"><button class="tile" data-act="rub" data-id="secretariat"><b>${S.players.filter((p) => !p.from_partner).length}</b><span>Licenciés</span></button><button class="tile" data-act="rub" data-id="technique"><b>${S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée').length}</b><span>Équipes</span></button><button class="tile ok" data-act="rub" data-id="tresorerie"><b>${due ? Math.round((100 * paid) / due) + ' %' : '—'}</b><span>Cotisations</span></button></div>`;
  const benev = !S.vstats ? '' : `<button class="card" data-act="rub" data-id="evenements" style="border:0;text-align:left;font:inherit;color:inherit;flex-direction:row;align-items:center;gap:12px"><span class="g" style="flex:1"><b>Bénévoles</b><span class="det" style="display:block">Membres : ${(S.vstats.members?.yes || []).length} bénévoles · ${(S.vstats.members?.no || []).length} non${S.vstats.supporters ? ` · supporteurs : ${(S.vstats.supporters.yes || []).length} · ${(S.vstats.supporters.no || []).length} non · ${(S.vstats.supporters.none || []).length} sans réponse` : ''}</span></span><span class="chev"></span></button>`;
  const todo = [], noBirth = S.players.filter((p) => !p.birth_date).length, cc = S.coachCounts || {};
  if (noBirth) todo.push(['rub', 'secretariat', plural(noBirth, 'date de naissance manquante', 'dates de naissance manquantes'), 'Secrétariat']);
  if (cc.hours) todo.push(['choursb', '', plural(cc.hours, 'relevé d’heures de coach', 'relevés d’heures de coachs'), 'À valider']);
  if (cc.exos) todo.push(['cexos', 'club', plural(cc.exos, 'exercice proposé à tous les clubs', 'exercices proposés à tous les clubs'), 'À valider']);
  const ag = upcoming(S.events.filter((e) => e.type === 'AG' && !e.cancelled))[0];
  if (ag) todo.push(['event', ag.id, 'AG du club : ' + fmtShort(ag.starts_at).split(' · ')[0], 'Dans ' + Math.max(1, Math.round((new Date(ag.starts_at) - Date.now()) / (7 * 864e5))) + ' sem.']);
  const suivre = !todo.length ? '' : `<div class="sec"><h2>À suivre</h2></div><div class="card"><div class="list">${todo.map(([a, id, t, p]) => `<button class="row" data-act="${a}" data-id="${esc(id)}" data-tab="${esc(id)}"><span class="g">${esc(t)}</span><span class="pill ${p === 'À valider' ? 'wait' : 'blue'}">${esc(p)}</span></button>`).join('')}</div></div>`;
  return arrange('president', [
    // n° 116 : plus de carte « N demandes à valider » (la tuile du bandeau le dit déjà et ouvre l'onglet Demandes)
    { id: 'chiffres', label: 'Chiffres du club', html: tiles },
    { id: 'joueurs', label: 'Ajouter une équipe ou des joueurs', html: `<button class="btn" data-act="tcreateopen">${icon('plus', 20)}Ajouter une équipe</button>` + addPlayersBlock(clubTeamIds()) }, // n° 132 : « Ajouter une équipe » juste au-dessus de « Ajouter des joueurs »
    { id: 'heures', label: 'Heures des coachs', html: hoursCheckBlock() },
    { id: 'resultats', label: 'Derniers résultats', html: clubResults() },
    { id: 'ententes', label: 'Ententes', html: partnerRequests() },
    { id: 'benevoles', label: 'Bénévoles', html: benev },
    { id: 'suivre', label: 'À suivre', html: suivre },
  ]); // 5.1.0 (n° 191) : plus de « Gestion du club » ; n° 114 : réglages, fonctions et journal sont dans leurs onglets ; n° 116 : plus de « Rubriques » (doublon du dépliant « Bureau »), « Créer des équipes » dans le dépliant « Équipes »
}
export const sw = (k, t, d, on) => `<label class="switch"><input type="checkbox" data-clubset="${k}" ${on ? 'checked' : ''}><span><b>${esc(t)}</b><br><span class="det">${esc(d)}</span></span></label>`;
export function rubList(keys) {
  keys = [...new Set(keys)].filter((a) => RUB_SUB[a]); // n° 119 : « licences » (contact licences) n'a pas de ligne à part
  return `<div class="sec"><h2>Accès</h2></div><div class="card"><div class="list">${keys.map((a) => `<button class="row" data-act="rub" data-id="${a}"><span style="width:40px;height:40px;border-radius:14px;background:var(--pc-bleu-pale);display:flex;align-items:center;justify-content:center;flex:none">${icon(AREA_ICON[a], 20, 'var(--pc-action)')}</span><span class="g">${esc(AREAS[a] || 'Commun')}<small>${esc(RUB_SUB[a])}</small></span><span class="chev"></span></button>`).join('')}</div></div>`;
}
const RUB_SUB = {
  tresorerie: 'Tarifs, réductions, cotisations, relances, export', secretariat: 'Demandes, membres, licences, dates de naissance',
  technique: 'Équipes, coachs, heures, exercices, statistiques', communication: 'Annonces, contacts, blason et couleurs',
  evenements: 'Bénévoles, missions par défaut, événements', commun: 'Agenda, messages, annonces, corbeille, journal',
};
export function fonctionSpace(f, asPresident = false) {
  const own = (FONCTION_AREAS[f] || []).filter(hasArea), extra = (S.areas || []).filter((a) => !own.includes(a));
  let h = '';
  const lic = licencesOnlyBlock(); // n° 114 : contact licences sans tout le Secrétariat
  if (!own.length && !lic) h += `<div class="card pale"><b>${esc(fl(f))}</b><p class="note">Ta fonction donne accès à la partie Commun. Le président peut t’ouvrir d’autres accès.</p></div>` + rubBody('commun');
  h += lic;
  const bl = [{ id: 'alerte', pin: true, html: h }];
  if (own.includes('tresorerie') || extra.includes('tresorerie')) bl.push({ id: 'heures', label: 'Heures des coachs', html: hoursCheckBlock() });
  if (own.includes('technique')) bl.push({ id: 'ententes', label: 'Ententes', html: partnerRequests() }, { id: 'resultats', label: 'Derniers résultats', html: clubResults() });
  own.forEach((a, i) => bl.push({ id: a, label: AREAS[a], html: (i || own.length > 1 ? `<div class="sec"><h2>${esc(AREAS[a])}</h2></div>` : '') + rubBody(a) }));
  if (['technique', 'secretariat'].some((x) => own.includes(x) || extra.includes(x))) bl.push({ id: 'joueurs', label: 'Ajouter des joueurs', html: addPlayersBlock(clubTeamIds()) }); // n° 95
  if (!asPresident) bl.push({ id: 'rubriques', label: 'Accès', html: rubList((own.length ? ['commun'] : []).concat(extra)) }); // n° 116 : le président passe par « Bureau »
  return arrange('f:' + f, bl);
}

// ---------- rubriques (n° 55) ----------
function rubView(a) {
  const ok = a === 'commun' ? isBoard() : hasArea(a);
  // n° 60 : la rangée des casquettes reste visible dans les rubriques, pour changer de casquette sans revenir en arrière
  currentCasq();
  return { head: header({ back: true, kicker: 'Accès', title: esc(AREAS[a] || 'Commun'), casq: ok ? casqTabs() : '' }), body: ok ? rubBody(a) : '<div class="card"><p class="empty">Cet accès n’est pas ouvert pour toi. Le président peut l’ouvrir dans « Fonctions du bureau ».</p></div>' };
}
export function rubBody(a) {
  if (a === 'tresorerie') return payTreasurerSoon() + tresoSummary() + feesBlock() + licencesBlock(); // n° 115
  if (a === 'secretariat') { const vp = toValidate(); return (vp.length ? `<div class="sec" id="demandes"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card lift">${pendRows(vp)}</div>` : '') + namesToCheck() + effectifsBlock() + licencesBlock() + membersBlock(); } // n° 191 : effectifs
  // n° 191 : les demandes de coachs, venues de « Gestion du club »
  if (a === 'technique') { const rq = toValidate().filter((m) => m.role === 'coach'); return (rq.length ? `<div class="sec" id="demandes"><h2>Demandes de coachs</h2><span class="pill wait">${rq.length}</span></div><div class="card lift">${pendRows(rq)}</div>` : '') + `<div class="grid2"><button class="btn small" data-act="choursb">${icon('check', 18)}Heures des coachs</button><button class="btn small" data-act="cexos" data-tab="club">${icon('doc', 18)}Exercices du club</button><button class="btn small" data-act="cstats">${icon('team', 18)}Statistiques</button><button class="btn small" data-act="evnew" data-type="Match">${icon('calplus', 18)}Nouveau match</button></div>` + teamToolsBlock() + teamsBlock(); }
  // n° 121 : dans l'espace Communication, seulement ce qui incombe à la personne (ses annonces et leurs lecteurs) ;
  // les annonces des autres fonctions restent dans l'onglet Messages, comme pour tout le monde
  if (a === 'communication') { const mine = S.annonces.filter((x) => x.created_by === S.me.id); return `<button class="btn main" data-act="annnew">${icon('plus', 20)}Nouvelle annonce</button><div class="sec"><h2>Mes annonces</h2><span class="det">${mine.length || ''}</span></div>` + (mine.length ? annList(mine.slice(0, 8), false) : '<p class="empty">Tu n’as pas encore écrit d’annonce. Les annonces du club sont dans l’onglet Messages.</p>') + '<p class="note">Ouvre une annonce pour voir qui l’a lue.</p>' + contactsBlock() + brandBlock(); }
  if (a === 'evenements') return eventsRub();
  return `<div class="grid2"><button class="btn small" data-act="tab" data-i="1">${icon('cal', 18)}Agenda</button><button class="btn small" data-act="tab" data-i="2">${icon('msg', 18)}Messages</button><button class="btn small" data-act="annlist">${icon('msg', 18)}Annonces</button>${isPresident() ? `<button class="btn small" data-act="journal">${icon('doc', 18)}Journal</button>` : ''}</div>` + trashBlock();
}
export function tresoSummary() {
  const rows = S.players.filter((p) => !p.from_partner).map((p) => ({ p, a: S.padmin.find((x) => x.player_id === p.id) })).filter((x) => x.a && x.a.fee_amount != null);
  const due = rows.reduce((s, x) => s + +x.a.fee_amount, 0), paid = rows.reduce((s, x) => s + Math.min(+x.a.fee_paid || 0, +x.a.fee_amount), 0);
  const full = rows.filter((x) => +x.a.fee_paid >= +x.a.fee_amount).length, part = rows.filter((x) => +x.a.fee_paid > 0 && +x.a.fee_paid < +x.a.fee_amount).length, none = rows.filter((x) => !(+x.a.fee_paid > 0) && +x.a.fee_amount > 0).length;
  const late = rows.filter((x) => +x.a.fee_amount - (+x.a.fee_paid || 0) > 0).sort((a, b) => (+b.a.fee_amount - b.a.fee_paid) - (+a.a.fee_amount - a.a.fee_paid));
  let h = `<div class="card lift"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="big">${eur(paid)}</span><span class="det">sur ${eur(due)} attendus</span></div><div class="progress"><span style="width:${due ? Math.round((100 * paid) / due) : 0}%"></span></div><div class="chips"><span class="pill ok">${full} payées</span><span class="pill wait">${part} partielles</span><span class="pill ko">${none} rien réglé</span></div></div>`;
  if (late.length) {
    const list = S.trAll ? late : late.slice(0, 5);
    h += `<div class="sec"><h2>À relancer</h2>${late.length > 5 ? `<button data-act="trall">${S.trAll ? 'Moins' : 'Tout voir (' + late.length + ')'}</button>` : ''}</div><div class="card"><div class="list">${list.map(({ p, a }) => `<div class="row static"><button class="g" data-act="player" data-id="${p.id}" style="background:none;border:0;text-align:left;padding:0;color:inherit">${esc(p.first_name + ' ' + p.last_name)} · ${esc(teamName(p.team_id) || 'sans équipe')}<small>Reste ${eur(+a.fee_amount - (+a.fee_paid || 0))}</small></button><button class="btn small main" style="flex:none" data-act="feerem" data-id="${p.id}">Relancer</button></div>`).join('')}</div></div><p class="note">« Relancer » affiche un rappel de cotisation à la famille seulement (une fois par semaine au plus).</p>`;
  }
  return h;
}
// n° 71 : missions à pourvoir avec relance depuis l'espace ; n° 74 : compteurs ; n° 70 : réglage des supporteurs
export function benevBlock(evs) {
  const memAll = [...new Map(S.members.filter((x) => x.status === 'active').map((x) => [x.user_id, x])).keys()].sort((a, b) => name(a).localeCompare(name(b), 'fr'));
  const off = new Set(S.optouts || []), nm = (u) => esc(name(u)) + (off.has(u) ? ' (ne souhaite pas être sollicité)' : '');
  let h = `<div class="sec"><h2>Missions à pourvoir</h2></div>`;
  h += evs.length ? evs.map((e) => {
    const m = missionsOf(e.id), miss = missing(e.id), open = S.mremOpen === e.id;
    const recent = e.missions_reminded_at && Date.now() - new Date(e.missions_reminded_at) < 12 * 3600e3;
    const det = m.length ? (miss ? 'il manque ' + m.map((x) => [x.slots - takenOf(x.id), x.label.toLowerCase()]).filter(([n]) => n > 0).map(([n, l]) => n + ' ' + l).join(', ') : 'complet') : 'aucune mission';
    let r = `<div class="card flat"><button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))} · ${esc(det)}${recent ? ' · relancé à ' + hm(new Date(e.missions_reminded_at)) + ', prochaine relance possible à ' + hm(new Date(new Date(e.missions_reminded_at).getTime() + 12 * 3600e3)) : ''}</small></span>${m.length ? (miss ? `<span class="pill wait">Il manque ${miss}</span>` : '<span class="pill ok">Complet</span>') : ''}</button>`;
    if (!m.length) r += `<button class="btn small ghost" data-act="mdef" data-id="${e.id}">Ajouter les missions par défaut</button>`;
    else if (miss && !recent) r += open ? remindBox(e, memAll.filter((u) => S.members.some((x) => x.user_id === u && x.status === 'active' && x.role !== 'supporteur') || club()?.supporters_volunteer), nm) : `<button class="btn small main" data-act="mremopen" data-id="${e.id}">Relancer</button>`;
    return r + '</div>';
  }).join('') : '<p class="empty">Aucun match ni événement dans les 30 prochains jours.</p>';
  const v = S.vstats;
  if (v) {
    const cnt = (o, k) => (o?.[k] || []).length, cats = v.members?.cats || {};
    h += `<div class="sec"><h2>Bénévoles</h2></div><div class="card"><button class="row" data-act="vlist" data-v="members"><span class="g">Membres (hors supporteurs) : ${cnt(v.members, 'yes')} bénévoles · ${cnt(v.members, 'no')} non<small>${esc(Object.entries(cats).map(([k, [y, n]]) => `${k} ${y} / ${y + n}`).join(' · '))}</small></span><span class="chev"></span></button>`
      + (v.supporters ? `<button class="row" data-act="vlist" data-v="supporters"><span class="g">Supporteurs : ${cnt(v.supporters, 'yes')} bénévoles · ${cnt(v.supporters, 'no')} non · ${cnt(v.supporters, 'none')} sans réponse</span><span class="chev"></span></button>` : '')
      + (S.vlist ? `<p class="note">${S.vlist === 'members' ? `<b>Bénévoles :</b> ${(v.members.yes || []).map((u) => esc(name(u))).join(', ') || '—'}<br><b>Non :</b> ${(v.members.no || []).map((u) => esc(name(u))).join(', ') || '—'}` : `<b>Bénévoles :</b> ${(v.supporters?.yes || []).map((u) => esc(name(u))).join(', ') || '—'}<br><b>Non :</b> ${(v.supporters?.no || []).map((u) => esc(name(u))).join(', ') || '—'}<br><b>Sans réponse :</b> ${(v.supporters?.none || []).map((u) => esc(name(u))).join(', ') || '—'}`}</p>` : '')
      + `</div>`;
  }
  h += askBlock();
  h += `<div class="card"><label class="switch"><input type="checkbox" data-supvolclub="1" ${club()?.supporters_volunteer ? 'checked' : ''}><span><b>Les supporteurs peuvent être bénévoles</b><br><span class="det">Supporteurs majeurs : événements du club et matchs des équipes qu’ils suivent. Ils répondent à un encart sur l’Accueil.</span></span></label></div>`;
  return h;
}
// n° 142 (a) : relancer l'encart « Souhaites-tu être bénévole ? » (membres du bureau sans réponse, supporteurs sans réponse)
function askBlock() {
  const k = S.vask; if (!k) return '';
  const n = (+k.bureau || 0) + (+k.supporters || 0), at = k.asked_at && new Date(k.asked_at), recent = at && Date.now() - at < 12 * 3600e3;
  const who = [k.bureau ? plural(+k.bureau, 'membre du bureau', 'membres du bureau') : '', k.supporters ? plural(+k.supporters, 'supporteur', 'supporteurs') : ''].filter(Boolean).join(' et ');
  return `<div class="sec"><h2>Encart bénévole</h2></div><div class="card"><p class="note" style="margin:0;color:var(--pc-texte-ecran)">${n ? `${esc(who)} n’${n > 1 ? 'ont' : 'a'} pas encore répondu à « Souhaites-tu être bénévole ? ».` : 'Tout le monde a répondu à « Souhaites-tu être bénévole ? ».'}${club()?.supporters_volunteer ? '' : ' Les supporteurs ne sont pas comptés : le bénévolat ne leur est pas ouvert (réglage ci-dessous).'}</p>${n ? `<button class="btn ${recent ? 'ghost' : 'main'} small" data-act="vask" ${recent ? 'disabled' : ''}>${recent ? 'Relance faite à ' + hm(at) + ' · prochaine possible à ' + hm(new Date(at.getTime() + 12 * 3600e3)) : `Relancer l’encart (${n})`}</button><p class="note">L’encart revient sur leur Accueil, avec une notification. Jamais les mineurs. Une relance toutes les 12 heures.</p>` : ''}</div>`;
}
function eventsRub() {
  const soon = Date.now() + 30 * 864e5;
  const evs = upcoming(S.events.filter((e) => !e.cancelled && new Date(e.starts_at) < soon && ['Match', 'Plateau', 'Tournoi', 'Événement', 'AG'].includes(e.type)));
  // N° 108 : matchs à domicile des 30 prochains jours, créés par un coach ou par le bureau, pour préparer la convocation des clubs reçus
  const home = upcoming(S.events.filter((e) => !e.cancelled && e.at_home !== false && e.audience === 'team' && ['Match', 'Plateau', 'Tournoi'].includes(e.type) && new Date(e.starts_at) < soon));
  let h = home.length ? `<div class="sec"><h2>Matchs à domicile à convoquer</h2><span class="det">${plural(home.length, 'rencontre')}</span></div><div class="card"><div class="list">${home.map((e) => `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))} · ${esc(teamName(evTeams(e)[0]) || '')}${e.place ? ' · ' + esc(e.place) : ''}</small></span><span class="chev"></span></button>`).join('')}</div><p class="note">Ouvre une rencontre pour préparer la pré-convocation ou la convocation des clubs reçus.</p></div>` : '';
  h += benevBlock(evs) + `<button class="btn main" data-act="evnew" data-type="Événement">${icon('plus', 20)}Nouvel événement</button>`;
  h += defaultMissionsBlock();
  return (hooks.receivedBlock ? hooks.receivedBlock() : '') + h; // n° 109 : convocations reçues des autres clubs, en tête (js/v42.js)
}

// Missions par défaut du club (rubrique Événements ; 4.4.0 : onglet Bénévoles du contact rencontres)
// N° 177 (4.9.0) : engagement du club, lu par les parents et par la personne qui ouvre une mission aux jeunes (trace datée dans la base)
export const YOUTH_ENGAGE = "Le club s'engage à ce qu'un adulte (parent ou membre du bureau) soit présent.";
export const YOUTH_MONEY = "Pas pour une mission où l'on manie de l'argent.";
export function defaultMissionsBlock() {
  const dm = S.dm || (S.dm = (club()?.default_missions || []).map((x) => ({ ...x })));
  return `<div class="sec"><h2>Missions par défaut du club</h2></div><div class="card"><div class="list">${dm.map((x, i) => `<div class="row static"><input aria-label="Mission ${i + 1}" data-dml="${i}" value="${esc(x.label)}" maxlength="40" style="flex:1;min-width:0;min-height:44px;border:2px solid var(--pc-trait);border-radius:12px;padding:4px 10px"><input type="number" aria-label="Places" data-dms="${i}" value="${esc(x.slots)}" min="1" max="20" style="width:70px;min-height:44px;border:2px solid var(--pc-trait);border-radius:12px;padding:4px 8px"><button class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="dmrm" data-i="${i}" aria-label="Retirer">${icon('trash', 18)}</button></div>${isBuvette(x.label) ? '' : `<label class="check" style="padding:0 0 6px"><input type="checkbox" data-dmy="${i}" ${x.youth ? 'checked' : ''}><span>Ouverte aux jeunes dès U13<br><span class="det">${YOUTH_MONEY}</span></span></label>`}`).join('')}</div>
  <div class="btns"><button class="btn ghost small" data-act="dmadd">${icon('plus', 18)}Ajouter</button><button class="btn main small" data-act="dmsave">Enregistrer</button></div><p class="note">Proposées en un geste sur chaque match, plateau, tournoi ou événement. « Jeunes dès U13 » : le parent inscrit son enfant (table de marque, chrono, arbitre en formation…) ; jamais la buvette. ${YOUTH_ENGAGE} En cochant, tu prends cet engagement pour le club : il est inscrit au journal, daté.</p></div>`;
}

// ---------- bénévoles (n° 53) ----------
const MISSION_TYPES = ['Match', 'Plateau', 'Tournoi', 'Événement', 'AG'];
const missionsOf = (eid) => S.missions.filter((m) => m.event_id === eid).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
const signupsOf = (mid) => S.signups.filter((x) => x.mission_id === mid);
// n° 142 : jeunes dès U13 inscrits par leur parent ; une place prise par un jeune compte comme une autre
const ysignupsOf = (mid) => (S.ysignups || []).filter((x) => x.mission_id === mid);
const takenOf = (mid) => signupsOf(mid).length + ysignupsOf(mid).length;
const isBuvette = (l) => /buvette/i.test(l || '');
export const youthCat = (t) => { const c = String(t?.category || t?.name || ''), m = c.match(/^\s*u\s*(\d+)/i); return m ? +m[1] >= 13 : /(minime|cadet|junior|senior|loisir|adulte|espoir)/i.test(c); };
// Mes enfants (mineurs, équipe U13 et plus) concernés par ce rendez-vous ; la base vérifie aussi
const youthKids = (e) => myKids().filter((p) => !isMajor(p) && teamsOfPlayer(p).some((t) => youthCat(team(t))) && (e.audience !== 'team' || teamsOfPlayer(p).some((t) => evTeams(e).includes(t))));
const youthName = (pid) => { const p = pl(pid); return p ? p.first_name + (p.last_name ? ' ' + p.last_name[0] + '.' : '') : 'Un jeune du club'; };
export const missing = (eid) => missionsOf(eid).reduce((a, m) => a + Math.max(0, m.slots - takenOf(m.id)), 0);
export const canManageMissions = (e) => (e.audience === 'team' && evTeams(e).some(coachOf)) || e.created_by === S.me.id || hasArea('evenements');
const supporterOnly = () => active().every((m) => m.role === 'supporteur');
export function myMissionLabel(e) {
  const mine = missionsOf(e.id).filter((m) => signupsOf(m.id).some((x) => x.user_id === S.me.id));
  return mine.length ? 'Toi : ' + mine.map((m) => m.label).join(', ') : '';
}
export function missionsBlock(e) {
  if (!MISSION_TYPES.includes(e.type) || e.cancelled) return '';
  const ms = missionsOf(e.id), man = canManageMissions(e), past = new Date(e.starts_at) < Date.now();
  if (!ms.length && !man) return '';
  const mineAny = ms.some((m) => signupsOf(m.id).some((x) => x.user_id === S.me.id));
  let h = `<div class="card"><div class="sec"><h2>Bénévoles</h2>${ms.length ? `<span class="det">${missing(e.id) ? 'Il manque ' + plural(missing(e.id), 'personne') : 'Complet'}</span>` : ''}</div>`;
  if (!ms.length) h += '<p class="note">Aucune mission pour ce rendez-vous.</p>';
  const kids = youthKids(e), kidOn = (pid) => ms.some((m) => ysignupsOf(m.id).some((x) => x.player_id === pid)); // n° 142
  h += ms.map((m) => {
    const su = signupsOf(m.id), ys = ysignupsOf(m.id), mine = su.some((x) => x.user_id === S.me.id), full = takenOf(m.id) >= m.slots;
    let act = '';
    if (!past) act = mine ? `<button class="btn small ghost" style="flex:none" data-act="volun" data-id="${m.id}" data-v="0">Me désinscrire</button>`
      : full ? '<span class="pill ok">Complet</span>'
      : !mineAny && !supporterOnly() ? `<button class="btn small main" style="flex:none" data-act="volun" data-id="${m.id}" data-v="1">Je m'inscris</button>` : '';
    const who = su.map((x) => `${esc(nick(x.user_id))}${man && !past ? ` <button class="pill" style="min-height:32px;border:0" data-act="vunassign" data-id="${m.id}" data-u="${x.user_id}" aria-label="Retirer ${esc(nick(x.user_id))}">✕</button>` : ''}`)
      .concat(ys.map((x) => `${esc(youthName(x.player_id))} (jeune)${!past && (man || myKids().some((k) => k.id === x.player_id)) ? ` <button class="pill" style="min-height:32px;border:0" data-act="${man ? 'yunassign' : 'yvolun'}" data-id="${m.id}" data-p="${x.player_id}" data-v="0" aria-label="Retirer ${esc(youthName(x.player_id))}">✕</button>` : ''}`)).join(', ');
    // n° 142 : le parent inscrit son enfant de U13 et plus sur une mission ouverte aux jeunes
    const ykid = m.youth && !past && !full ? kids.filter((k) => !kidOn(k.id)) : [];
    const yAct = ykid.length ? `<div class="ybtns">${ykid.map((k) => `<button class="btn small main" style="flex:none" data-act="yvolun" data-id="${m.id}" data-p="${k.id}" data-v="1">Inscrire ${esc(k.first_name)}</button>`).join('')}</div>` : '';
    const yTog = hasArea('evenements') && !past && !isBuvette(m.label) ? (isArmed('my' + m.id) && !m.youth ? `<span class="card warn" style="padding:10px;gap:6px"><span class="note" style="color:var(--pc-texte-ecran)"><b>${YOUTH_ENGAGE}</b> ${YOUTH_MONEY}</span><button class="btn small main" data-act="myouth" data-id="${m.id}">Confirmer : ouvrir aux jeunes dès U13</button></span>` : `<button class="chip" data-act="myouth" data-id="${m.id}" aria-pressed="${!!m.youth}" style="min-height:36px">Jeunes dès U13</button>`) : ''; // n° 177
    return `<div class="mission"><span class="g"><span class="ml">${esc(m.label)} <span class="pill ${full ? 'ok' : 'wait'}">${takenOf(m.id)} / ${m.slots}</span>${m.youth && !yTog ? ' <span class="pill blue">Jeunes dès U13</span>' : ''}</span><small>${who || 'Personne pour l’instant'}</small></span>${yTog}${act}${yAct}${man && !past ? `<button class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="mdelm" data-id="${m.id}" aria-label="Retirer la mission ${esc(m.label)}">${isArmed('mi' + m.id) ? '✓' : icon('trash', 18)}</button>` : ''}</div>`;
  }).join('');
  if (!past && kids.length && ms.some((m) => m.youth)) h += `<p class="note">Missions « jeunes dès U13 » : tu inscris ton enfant en son nom. ${YOUTH_ENGAGE}</p>`;
  if (man && !past) {
    const mem = [...new Map(S.members.filter((x) => x.status === 'active' && x.role !== 'supporteur').map((x) => [x.user_id, x])).keys()].sort((a, b) => name(a).localeCompare(name(b), 'fr'));
    if (!ms.length) h += `<button class="btn main small" data-act="mdef" data-id="${e.id}">Ajouter les missions du club (${(club()?.default_missions || []).map((x) => esc(x.label)).join(', ')})</button>`; // n° 125 (audit S3) : nom de mission échappé
    h += `<form id="mif" data-id="${e.id}" class="grid2" style="align-items:end">${field('mil', 'Autre mission', '<input id="mil" name="label" maxlength="40" placeholder="Ex. Photos, Accueil" required>')}${field('mis', 'Places', '<input id="mis" name="slots" type="number" min="1" max="20" value="1" required>')}<button class="btn ghost small" type="submit">${icon('plus', 18)}Ajouter la mission</button></form>`;
    const off = new Set(S.optouts || []), nm = (u) => esc(name(u)) + (off.has(u) ? ' (ne souhaite pas être sollicité)' : '');
    if (ms.length) h += `<div class="grid2" style="align-items:end">${field('mia', 'Inscrire quelqu’un', `<select id="mia" data-massign="1"><option value="">Choisir…</option>${mem.map((u) => `<option value="${u}">${nm(u)}</option>`).join('')}</select>`)}${field('mim', 'Sur la mission', `<select id="mim">${ms.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>`)}</div><div class="btns"><button class="btn small" data-act="vassign">Inscrire</button></div>`;
    if (ms.length && missing(e.id)) h += remindBox(e, mem, nm);
    if (off.size && hasArea('evenements')) { const l = mem.filter((u) => off.has(u)); if (l.length) h += `<p class="note">Ne souhaite${l.length > 1 ? 'nt' : ''} pas être sollicité${l.length > 1 ? 's' : ''} pour le bénévolat : ${l.map((u) => esc(name(u))).join(', ')}.</p>`; }
  }
  return h + '</div>';
}
// N° 67 : relance des missions vides vers le rendez-vous, tout le club, des équipes ou des personnes choisies (une fois toutes les 12 heures)
function remindBox(e, mem, nm) {
  const r = S.mrem && S.mrem.eid === e.id ? S.mrem : (S.mrem = { eid: e.id, target: 'event', teams: new Set(evTeams(e)), people: new Set() });
  const recent = e.missions_reminded_at && Date.now() - new Date(e.missions_reminded_at) < 12 * 3600e3;
  const T = [['event', 'Les concernés'], ['club', 'Tout le club'], ['teams', 'Des équipes'], ['people', 'Des personnes']];
  let h = `<div class="card flat"><div class="kick">Relancer les missions vides</div><div class="chips">${T.map(([k, l]) => `<button class="chip" data-act="mremt" data-v="${k}" aria-pressed="${r.target === k}">${l}</button>`).join('')}</div>`;
  if (r.target === 'teams') h += `<div class="chips">${S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée').map((t) => `<button class="chip" data-act="mremteam" data-id="${t.id}" aria-pressed="${r.teams.has(t.id)}">${esc(t.name)}</button>`).join('')}</div>`;
  if (r.target === 'people') h += `<div class="card flat" style="max-height:240px;overflow:auto;gap:0">${mem.map((u) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-mremp="${u}" ${r.people.has(u) ? 'checked' : ''}><span>${nm(u)}</span></label>`).join('')}</div>`;
  const note = { event: 'Les personnes qui peuvent aider sur ce rendez-vous.', club: 'Les adultes du club : bureau, coachs, parents, joueurs majeurs.', teams: 'Parents, joueurs majeurs et coachs des équipes choisies.', people: 'Seulement les personnes cochées, même si elles ont décoché le bénévolat.' }[r.target];
  h += `<p class="note">${note} Jamais les mineurs, les supporteurs ni les personnes déjà inscrites. Une relance toutes les 12 heures.</p><button class="btn small ${recent ? 'ghost' : 'main'}" data-act="mremind" data-id="${e.id}" ${recent ? 'disabled' : ''}>${recent ? 'Relance faite à ' + hm(new Date(e.missions_reminded_at)) : 'Envoyer la relance'}</button></div>`;
  return h;
}
// Accueil : missions à pourvoir (sans envahir « À répondre »)
export function missionsHome() {
  if (supporterOnly()) return '';
  // n° 142 : mon enfant (U13 et plus) peut aider sur une mission ouverte aux jeunes
  const ysoon = Date.now() + 21 * 864e5;
  const yev = upcoming(S.events.filter((e) => !e.cancelled && new Date(e.starts_at) < ysoon && youthKids(e).some((k) => !missionsOf(e.id).some((m) => ysignupsOf(m.id).some((x) => x.player_id === k.id))) && missionsOf(e.id).some((m) => m.youth && takenOf(m.id) < m.slots))).slice(0, 3);
  const yh = yev.length ? `<div class="sec"><h2>Ton enfant peut aider le club</h2></div><div class="card"><div class="list">${yev.map((e) => `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))} · ${esc(missionsOf(e.id).filter((m) => m.youth && takenOf(m.id) < m.slots).map((m) => m.label).join(', '))}</small></span><span class="pill blue">Jeunes dès U13</span></button>`).join('')}</div></div><p class="note">Tu inscris ton enfant en son nom depuis le rendez-vous. Un adulte du club est toujours présent.</p>` : '';
  return yh + missionsHomeAdults();
}
function missionsHomeAdults() {
  const soon = Date.now() + 21 * 864e5;
  const evs = upcoming(S.events.filter((e) => !e.cancelled && new Date(e.starts_at) < soon && missing(e.id) > 0 && !myMissionLabel(e))).slice(0, 3);
  if (!evs.length) return '';
  return `<div class="sec"><h2>Missions à pourvoir</h2></div><div class="card"><div class="list">${evs.map((e) => `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))} · il manque ${esc(missionsOf(e.id).map((m) => [m.slots - takenOf(m.id), m.label.toLowerCase()]).filter(([n]) => n > 0).map(([n, l]) => n + ' ' + l).join(', '))}</small></span><span class="pill wait">Bénévoles</span></button>`).join('')}</div></div>`;
}

// ---------- annonces ----------
const KIND = { relance: ['Rappel', 'wait'], missions: ['Bénévoles', 'wait'], cotisation: ['Cotisation', 'ko'], annonce: ['Annonce', 'blue'] };
const kindOf = (a) => KIND[a.kind] || KIND.annonce;
const unread = (a) => !S.annRead.has(a.id) && a.created_by !== S.me.id;
export const canAnnounce = () => hasArea('communication') || isBoard() || coachTeams().length > 0;
export function annList(list, withAll) {
  if (!list.length) return '<p class="empty">Aucune annonce pour l’instant.</p>';
  return `<div class="card"><div class="list">${list.map((a) => `<button class="ann" data-act="annopen" data-id="${a.id}"><span class="dot ${unread(a) ? '' : 'read'}" aria-hidden="true"></span><span style="display:flex;flex-direction:column;flex:1;min-width:0"><b style="${unread(a) ? '' : 'font-weight:500'}">${esc(a.title)}</b><span class="det">${esc(nick(a.created_by))} · ${esc(fmtShort(a.created_at))}</span></span><span class="pill ${kindOf(a)[1]}">${kindOf(a)[0]}</span></button>`).join('')}</div></div>${withAll && S.annonces.length > list.length ? '<button class="btn ghost small" data-act="annlist">Toutes les annonces</button>' : ''}`;
}
export function annoncesBlock() {
  const l = S.annonces.slice(0, 4), n = S.annonces.filter(unread).length;
  if (!l.length && !canAnnounce()) return '';
  return `<div class="sec"><h2>Annonces${n ? ` <span class="pill wait">${n}</span>` : ''}</h2>${canAnnounce() ? `<button data-act="annnew">${icon('plus', 18)} Nouvelle</button>` : ''}</div>` + annList(l, true);
}
// Accueil : annonces non lues (rappels en tête)
export function annoncesHome() {
  const l = S.annonces.filter(unread).sort((a, b) => (a.kind === 'annonce') - (b.kind === 'annonce')).slice(0, 3);
  return l.map((a) => `<div class="card dark"><span class="kick" style="color:var(--pc-jaune)">${kindOf(a)[0]}${a.kind === 'annonce' ? ' · ' + esc(nick(a.created_by)) : ''}</span><b style="font-size:18px">${esc(a.title)}</b>${a.body ? `<span class="det" style="white-space:pre-wrap">${esc(a.body.replace(/ Réf\. [0-9a-f-]{36}$/, '').slice(0, 220))}</span>` : ''}<div class="btns">${a.event_id ? `<button class="btn small main" data-act="annevent" data-id="${a.id}">Ouvrir le rendez-vous</button>` : `<button class="btn small main" data-act="annopen" data-id="${a.id}">Lire</button>`}<button class="btn small ghost" style="background:var(--pc-papier)" data-act="annread" data-id="${a.id}">C'est lu</button></div></div>`).join('');
}
function annoncesView() {
  return { head: header({ back: true, kicker: 'Messages', title: 'Annonces' }), body: (canAnnounce() ? `<button class="btn main" data-act="annnew">${icon('plus', 20)}Nouvelle annonce</button>` : '') + annList(S.annonces, false) };
}
function annonceView(id) {
  const a = S.annonces.find((x) => x.id === id);
  if (!a) return { head: header({ back: true, title: 'Annonce' }), body: '<p class="empty">Annonce introuvable (supprimée ?).</p>' };
  const mine = a.created_by === S.me.id || hasArea('communication'), dest = a.audience === 'club' ? 'Tout le club' : a.audience === 'team' ? teamsLabelSafe(a.team_ids) : a.audience === 'people' ? plural(a.people.length, 'personne') : { board: 'Bureau', board_coaches: 'Bureau et coachs', coaches: 'Tous les coachs' }[a.audience];
  let b = `<div class="card lift"><div class="chips"><span class="pill ${kindOf(a)[1]}">${kindOf(a)[0]}</span><span class="pill">Pour : ${esc(dest)}</span></div><div style="white-space:pre-wrap;font-size:17px">${esc((a.body || '').replace(/ Réf\. [0-9a-f-]{36}$/, ''))}</div><p class="note">${esc(name(a.created_by))} · ${esc(fmtShort(a.created_at))}</p></div>`;
  if (a.event_id) b += `<button class="btn main" data-act="event" data-id="${a.event_id}">Ouvrir le rendez-vous</button>`;
  if (mine) b += `<p class="det">${S.annReads?.[id] == null ? 'Lectures : …' : 'Lu par ' + plural(S.annReads[id], 'personne')}</p>` + delBtn('anndel', id, 'Supprimer l’annonce', 'Confirmer la suppression', isArmed('an' + id));
  return { head: header({ back: true, kicker: 'Annonce', title: esc(a.title) }), body: b };
}
function annFormView() {
  const f = S.annf, aud = annAudiences();
  const teams = hasArea('communication') ? S.teams.filter((t) => !t.deleted_at).map((t) => t.id) : coachTeams();
  let b = `<form id="annf" class="card lift"><div class="field"><span class="lab">Pour</span><div class="chips">${aud.map(([k, l]) => `<button type="button" class="chip" data-act="annaud" data-v="${k}" aria-pressed="${f.aud === k}">${l}</button>`).join('')}</div></div>`;
  if (f.aud === 'team') b += `<div class="field"><span class="lab">Équipes (${f.teams.size})</span><div class="chips">${teams.map((t) => `<button type="button" class="chip" data-act="annteam" data-id="${t}" aria-pressed="${f.teams.has(t)}">${esc(teamName(t))}</button>`).join('')}</div></div>`;
  b += `${field('ant', 'Titre', `<input id="ant" name="title" required minlength="2" maxlength="120" value="${esc(f.title || '')}" placeholder="Ex. Gymnase fermé samedi">`)}${field('anb', 'Texte', `<textarea id="anb" name="body" maxlength="3000" rows="6">${esc(f.body || '')}</textarea>`)}<button class="btn main" type="submit">Publier l'annonce</button><p class="note">Une annonce officielle s'affiche en haut de l'Accueil des destinataires jusqu'à ce qu'ils l'aient lue.</p></form>`;
  return { head: header({ back: true, kicker: 'Messages', title: 'Nouvelle annonce' }), body: b };
}
function annAudiences() {
  const l = [];
  if (hasArea('communication')) l.push(['club', 'Tout le club']);
  if (hasArea('communication') || coachTeams().length) l.push(['team', 'Une ou plusieurs équipes']);
  if (isBoard()) l.push(['board', 'Bureau'], ['board_coaches', 'Bureau et coachs'], ['coaches', 'Tous les coachs']);
  return l;
}

// ---------- fonctions du bureau et journal (président) ----------
function fonctionsView() {
  if (!isPresident()) return { head: header({ back: true, title: 'Fonctions du bureau' }), body: '<p class="empty">Réservé au président.</p>' };
  const bm = S.members.filter((m) => m.role === 'bureau' && m.status === 'active').sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), 'fr'));
  const users = [...new Set(bm.map((m) => m.user_id))], ba = S.bareas || [];
  let b = respAsk() + '<p class="note">Une fonction ouvre ses accès. Tu peux ouvrir un accès en plus à un membre ; la partie Commun est à tout le bureau.</p>';
  b += users.length ? users.map((u) => {
    const ms = bm.filter((m) => m.user_id === u), own = ms.flatMap((m) => FONCTION_AREAS[m.fonction || 'Membre du bureau'] || []);
    return `<div class="card"><b style="font-size:18px">${esc(name(u))}</b>${ms.map((m) => `<div class="grid2" style="align-items:end">${field('fo' + m.id, 'Fonction', `<select id="fo${m.id}" data-fonc="${m.id}" data-u="${u}">${FONCTIONS.map((f) => `<option ${(m.fonction || 'Membre du bureau') === f ? 'selected' : ''} value="${esc(f)}">${fl(f)}</option>`).join('')}</select>`)}${delBtn('mdel', m.id, 'Retirer', 'Confirmer', isArmed('m' + m.id))}</div>${(m.fonction || 'Membre du bureau') === 'Membre du bureau' ? field('ft' + m.id, 'Intitulé affiché (facultatif, « Autre »)', `<input id="ft${m.id}" data-ftitle="${m.id}" maxlength="40" value="${esc(m.title || '')}" placeholder="Ex. Responsable maillots">`) : ''}`).join('')}
    <div class="kick">Accès</div><div class="chips">${Object.entries(AREAS).map(([a, l]) => own.includes(a) ? `<span class="pill ok">${l}</span>` : `<button class="chip" data-act="barea" data-u="${u}" data-v="${a}" aria-pressed="${ba.some((x) => x.user_id === u && x.area === a)}">${l}</button>`).join('')}</div></div>`;
  }).join('') : '<p class="empty">Aucun membre du bureau pour l’instant.</p>';
  const cand = [...new Set(S.members.filter((m) => m.status === 'active' && m.user_id !== S.me.id).map((m) => m.user_id))].sort((a, c) => name(a).localeCompare(name(c), 'fr'));
  b += `<form id="nomf" class="card"><div class="kick">Nommer quelqu'un</div><div class="grid2">${field('nu', 'Membre du club', `<select id="nu" name="user" required><option value="">Choisir…</option>${cand.map((u) => `<option value="${u}" ${S.nomUser === u ? 'selected' : ''}>${esc(name(u))}</option>`).join('')}</select>`)}${field('nf', 'Fonction', `<select id="nf" name="fonction">${FONCTIONS.map((f) => `<option value="${esc(f)}" ${!S.nomAutre && S.nomFn === f ? 'selected' : ''}>${fl(f)}</option>`).join('')}<option value="__autre" ${S.nomAutre ? 'selected' : ''}>Autre (nom libre)…</option></select>`)}</div>${nomAutreBlock()}<button class="btn main small" type="submit">${S.nomAutre ? 'Créer le rôle' : 'Nommer'}</button><p class="note">Une seule personne pour la vice-présidence, le secrétariat, la trésorerie, le contact licences et le contact rencontres ; plusieurs pour les adjoints, les membres et les autres rôles. Chaque nomination est inscrite au journal.</p></form>`;
  b += rightsNote(); // n° 114 : les droits de chaque fonction avant de confirmer
  return { head: header({ back: true, kicker: roleKicker('Espace Président'), title: 'Fonctions du bureau', casq: casqTabs() }), body: b }; // n° 101 ; n° 116 : casquettes dans l'en-tête
}
// 5.2.0 (n° 172) : rôle « Autre » : nom libre et accès choisis parmi les cinq (jamais l'accès Président ni la modification des fonctions du bureau)
function nomAutreBlock() {
  if (!S.nomAutre) return '';
  const on = S.nomAreas || (S.nomAreas = new Set());
  return `<div class="card flat" data-autre="1">${field('otitle', 'Nom du rôle', `<input id="otitle" name="otitle" maxlength="40" placeholder="Ex. Aide-trésorier" value="${esc(S.nomTitle || '')}" data-ntitle="1">`)}
    <div class="kick">Accès</div><div class="chips">${Object.entries(AREAS).map(([a, l]) => `<button type="button" class="chip" data-act="nomarea" data-v="${a}" aria-pressed="${on.has(a)}">${l}</button>`).join('')}</div>
    <p class="note">Un rôle « Autre » est un rôle d’aide : il ne donne jamais l’accès Président, ni le droit de nommer le bureau. Les droits sont ceux des accès cochés.</p></div>`;
}
// n° 151 (Gaël, 9 novembre 2026) : en nommant un contact (rencontres, licences) ou un chargé de communication, le président
// choisit à qui vont les missions : à cette personne, à lui-même, ou à la personne qui les a aujourd'hui (rien ne change)
// n° 170 (4.8.0) : les deux contacts sont des rôles, le rôle donne les missions ; la question ne reste que pour la communication
// 5.2.0 (n° 172) : plus aucune désignation ; la fonction donne les missions. La table reste vide pour garder la mécanique de la question.
const RESP_OF = {};
function respAsk() {
  const a = S.resp151; if (!a) return '';
  const cur = (S.desig || []).find((x) => x.resp === a.resp);
  const now = cur ? name(cur.user_id) : 'la personne par défaut';
  return `<div class="card yellow"><span class="kick" style="color:var(--pc-texte-ecran)">${esc(fl(a.fonction))} · ${esc(name(a.user))}</span><b style="font-size:20px">À qui confier les missions ?</b><p style="margin:0">${esc(RESP_OF[a.fonction][1])}.</p>
    <div class="stack">${cur?.user_id === a.user ? '' : `<button class="btn main" data-act="resp151" data-v="give">Les confier à ${esc(name(a.user))}</button>`}${cur?.user_id === S.me.id ? '' : '<button class="btn" data-act="resp151" data-v="me">Je les garde</button>'}<button class="btn ghost" data-act="resp151" data-v="keep">Les laisser à ${esc(now)}</button></div></div>`;
}
function journalView() {
  const l = S.journal;
  const body = l == null ? '<p class="empty">Chargement…</p>' : l.length ? `<div class="card"><div class="list">${l.map((x) => `<div class="row static"><span class="g">${esc(x.action)}${x.target ? ' · ' + esc(x.target) : ''}<small>${esc(new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))} · par ${esc(x.actor)}${x.detail ? ' · ' + esc(Object.entries(x.detail).map(([k, v]) => k + ' : ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ').slice(0, 140)) : ''}</small></span></div>`).join('')}</div></div>` : '<p class="empty">Aucune action sensible pour l’instant.</p>';
  return { head: header({ back: true, kicker: roleKicker('Espace Président'), title: 'Journal des actions' }), body: '<p class="note">Versements, réductions, fiches modifiées, fonctions, validations d’heures… les 100 dernières actions. Lisible du seul président.</p>' + body };
}

// ---------- recherche connectée (n° 56) et accueil multi-clubs ----------
function searchView() {
  const mine = Object.values(S.clubs).filter((c) => S.mems.some((m) => m.club_id === c.id && m.status === 'active'));
  const b = `<div class="sec"><h2>Mes clubs</h2></div><div class="card"><div class="list">${mine.map((c) => `<div class="row static">${crest(c, 36, '#FFFFFF')}<span class="g">${esc(c.name)}<small>${esc([c.city, c.sport].filter(Boolean).join(' · '))}</small></span>${c.id === S.clubId ? '<span class="pill ok">Ouvert</span>' : `<button class="btn small main" style="flex:none" data-act="club" data-id="${c.id}">Ouvrir</button>`}</div>`).join('') || '<p class="empty">Aucun club.</p>'}</div></div>` + searchBlock();
  return { head: header({ back: true, kicker: 'Recherche', title: 'Chercher un club' }), body: b };
}
export function otherClubsHome() {
  // n° 150 (Gaël, 9 novembre 2026) : seulement si le compte est actif dans au moins deux clubs (supporteur compris) ;
  // logo et nom du club, rien d'autre (plus d'entraînements ni d'annonces)
  const l = (S.overview || []).filter((x) => x.club_id !== S.clubId);
  if (!l.length) return '';
  return `<div class="sec"><h2>Changer de club</h2></div><div class="card"><div class="list">${l.map((c) => `<button class="row" data-act="club" data-id="${c.club_id}">${crest({ ...c, id: c.club_id }, 36, '#FFFFFF')}<span class="g">${esc(c.name)}</span><span class="pill blue">Ouvrir</span></button>`).join('')}</div></div>`;
}

// ---------- écrans (lus par app.js) ----------
export const VIE_VIEWS = {
  espace: () => espaceView(), rub: (v) => rubView(v.id), annonces: () => annoncesView(), annonce: (v) => annonceView(v.id), annform: () => annFormView(),
  fonctions: () => fonctionsView(), journal: () => journalView(), csearch: () => searchView(),
  timport: () => { currentCasq(); return { head: header({ back: true, kicker: roleKicker('Équipes'), title: 'Importer des équipes' }), body: teamImportPage() }; }, // n° 102
};

// ---------- actions ----------
async function reloadMissions() {
  const ids = S.events.map((e) => e.id);
  S.missions = ids.length ? ((await sb.from('event_missions').select('*').in('event_id', ids).order('position')).data || []) : [];
  S.signups = S.missions.length ? ((await sb.from('mission_signups').select('*').in('mission_id', S.missions.map((m) => m.id))).data || []) : [];
  S.ysignups = S.missions.some((m) => m.youth) ? ((await sb.from('mission_youth_signups').select('*').in('mission_id', S.missions.filter((m) => m.youth).map((m) => m.id))).data || []) : [];
  await loadNames(S.signups.map((x) => x.user_id));
}
async function markRead(id) {
  if (S.annRead.has(id)) return;
  if (await run(sb.from('announcement_reads').insert({ announcement_id: id, user_id: S.me.id }))) S.annRead.add(id);
}
Object.assign(ACTIONS, {
  // n° 113 : le bouton de rôle ouvre la vue choisie par défaut, sinon le dernier espace utilisé
  espace: async () => { const def = defaultCasq(); if (def) S.casq = resolveCasq(def); S.view = { type: 'espace' }; currentCasq(); render(); if (isCoachCasq(S.casq)) { await ensureExos(); render(true); } },
  casq: async (el, d) => {
    const k = resolveCasq(d.v); S.casq = k; store.set('pc_casq_' + S.clubId, k);
    S.defAsk = k !== defaultCasq() ? k : null; // n° 113 : « Ouvrir cet espace par défaut ? »
    // n° 101 : un autre espace s'ouvre en haut de page ; la même casquette garde la position
    if (S.view?.type !== 'espace') { S.view = { type: 'espace' }; render(); } else render(true);
    if (isCoachCasq(k)) { await ensureExos(); render(true); }
  },
  rub: async (el, d) => { S.view = { type: 'rub', id: d.id }; render(); },
  cplanfor: (el, d) => { const e = S.events.find((x) => x.id === d.id); if (e) planForEvent(e); S.ctab = 'seance'; ACTIONS.cplan(); },
  csearch: () => { S.view = { type: 'csearch' }; render(); },
  trall: () => { S.trAll = !S.trAll; render(true); },
  feerem: async (el, d) => { const n = await run(sb.rpc('remind_fee', { p_player: d.id })); if (n !== null) toast('Rappel affiché à la famille (' + plural(n, 'compte') + ').'); },
  // annonces
  annnew: () => { const a = annAudiences(); S.annf = { aud: a.some((x) => x[0] === 'team') && !hasArea('communication') ? 'team' : a[0]?.[0], teams: new Set(coachTeams().length === 1 ? coachTeams() : []), title: '', body: '' }; S.view = { type: 'annform' }; render(); },
  annaud: (el, d) => { keepAnn(); S.annf.aud = d.v; render(true); },
  annteam: (el, d) => { keepAnn(); S.annf.teams[S.annf.teams.has(d.id) ? 'delete' : 'add'](d.id); render(true); },
  annlist: () => { S.view = { type: 'annonces' }; render(); },
  annopen: async (el, d) => {
    S.view = { type: 'annonce', id: d.id }; render(); await markRead(d.id);
    const a = S.annonces.find((x) => x.id === d.id);
    if (a && (a.created_by === S.me.id || hasArea('communication'))) { const r = await sb.from('announcement_reads').select('user_id', { count: 'exact', head: true }).eq('announcement_id', d.id); S.annReads = { ...(S.annReads || {}), [d.id]: r.count || 0 }; }
    render(true);
  },
  annread: async (el, d) => { await markRead(d.id); render(true); },
  annevent: async (el, d) => { const a = S.annonces.find((x) => x.id === d.id); await markRead(d.id); S.view = { type: 'event', id: a.event_id }; render(); },
  anndel: async (el, d) => { if (!armed('an' + d.id)) return; if (await run(sb.rpc('delete_announcement', { p_id: d.id }), 'Annonce supprimée.')) { S.view = null; await refresh(); } },
  // bénévoles
  volun: async (el, d) => { if (await run(sb.rpc('volunteer', { p_mission: d.id, p_on: d.v === '1' }), d.v === '1' ? 'Merci ! Tu es inscrit.' : 'Désinscription faite.')) { await reloadMissions(); render(true); } },
  vunassign: async (el, d) => { if (await run(sb.rpc('assign_volunteer', { p_mission: d.id, p_user: d.u, p_on: false }), 'Bénévole retiré.')) { await reloadMissions(); render(true); } },
  // n° 142 : le parent inscrit ou retire son enfant ; l'organisateur retire un jeune ; la rubrique Événements ouvre une mission aux jeunes
  yvolun: async (el, d) => { const k = pl(d.p); if (await run(sb.rpc('volunteer_youth', { p_mission: d.id, p_player: d.p, p_on: d.v === '1' }), d.v === '1' ? `Merci ! ${k ? k.first_name : 'Ton enfant'} est inscrit.` : 'Inscription retirée.')) { await reloadMissions(); render(true); } },
  yunassign: async (el, d) => { if (await run(sb.rpc('unassign_youth', { p_mission: d.id, p_player: d.p }), 'Bénévole retiré.')) { await reloadMissions(); render(true); } },
  myouth: async (el, d) => { const m = S.missions.find((x) => x.id === d.id); if (!m) return; if (!m.youth && !armed('my' + m.id)) return; /* n° 177 : l'engagement est lu avant d'ouvrir */ if (await run(sb.from('event_missions').update({ youth: !m.youth }).eq('id', m.id), m.youth ? 'Mission fermée aux jeunes.' : 'Mission ouverte aux jeunes dès U13 : les parents peuvent inscrire leur enfant.')) { await reloadMissions(); render(true); } },
  vask: async () => { const n = await run(sb.rpc('ask_volunteers', { p_club: S.clubId })); if (n) { toast(plural(n, 'personne relancée', 'personnes relancées') + ' : l’encart revient sur leur Accueil.'); await refresh(); } },
  vassign: async () => { const u = document.getElementById('mia')?.value, m = document.getElementById('mim')?.value; if (!u) return toast('Choisis une personne.'); if (await run(sb.rpc('assign_volunteer', { p_mission: m, p_user: u, p_on: true }), 'Bénévole inscrit.')) { await reloadMissions(); render(true); } },
  mdef: async (el, d) => { const n = await run(sb.rpc('add_default_missions', { p_event: d.id })); if (n !== null) { toast(plural(n, 'mission ajoutée', 'missions ajoutées') + '.'); await reloadMissions(); render(true); } },
  mdelm: async (el, d) => { if (!armed('mi' + d.id)) return; if (await run(sb.from('event_missions').delete().eq('id', d.id), 'Mission retirée.')) { await reloadMissions(); render(true); } },
  mremopen: (el, d) => { S.mremOpen = d.id; S.mrem = null; render(true); },
  vlist: (el, d) => { S.vlist = S.vlist === d.v ? null : d.v; render(true); },
  mremt: (el, d) => { S.mrem.target = d.v; render(true); },
  mremteam: (el, d) => { S.mrem.teams[S.mrem.teams.has(d.id) ? 'delete' : 'add'](d.id); render(true); },
  mremind: async (el, d) => {
    const r = S.mrem && S.mrem.eid === d.id ? S.mrem : { target: 'event', teams: new Set(), people: new Set() };
    if (r.target === 'teams' && !r.teams.size) return toast('Choisis au moins une équipe.');
    if (r.target === 'people' && !r.people.size) return toast('Choisis au moins une personne.');
    const t = await run(sb.rpc('remind_missions', { p_event: d.id, p_target: r.target, p_teams: r.target === 'teams' ? [...r.teams] : null, p_people: r.target === 'people' ? [...r.people] : null }));
    if (t !== null) { toast('Relance envoyée : il manque ' + t + '.'); S.mrem = null; await refresh(); }
  },
  dmadd: () => { S.dm.push({ label: '', slots: 1 }); render(true); },
  dmrm: (el, d) => { S.dm.splice(+d.i, 1); render(true); },
  dmsave: async () => { const l = S.dm.map((x) => ({ label: String(x.label || '').trim(), slots: Math.max(1, Math.min(20, +x.slots || 1)), ...(x.youth && !isBuvette(x.label) ? { youth: true } : {}) })).filter((x) => x.label.length >= 2); /* n° 142 : « jeunes dès U13 », jamais la buvette */ if (await run(sb.from('clubs').update({ default_missions: l }).eq('id', S.clubId), 'Missions par défaut enregistrées.')) { S.dm = null; await refresh(); } },
  // président
  fonctions: async () => { S.view = { type: 'fonctions' }; render(); S.bareas = (await sb.from('board_areas').select('*').eq('club_id', S.clubId)).data || []; render(true); },
  journal: async () => { S.journal = null; S.view = { type: 'journal' }; render(); S.journal = (await run(sb.rpc('club_log', { p_club: S.clubId, p_limit: 100 }))) || []; render(true); },
  resp151: async (el, d) => { // n° 151
    const a = S.resp151; if (!a) return;
    if (d.v === 'keep') { S.resp151 = null; toast('Rien ne change pour les missions.'); return render(true); }
    const u = d.v === 'give' ? a.user : S.me.id;
    if (await run(sb.rpc('set_designation', { p_club: S.clubId, p_resp: a.resp, p_user: u }), d.v === 'give' ? 'Missions confiées : la personne est prévenue.' : 'Tu gardes ces missions.')) { S.resp151 = null; await refresh(); }
  },
  nomarea: (el, d) => { const s = S.nomAreas || (S.nomAreas = new Set()); s.has(d.v) ? s.delete(d.v) : s.add(d.v); render(true); }, // 5.2.0 (n° 172)
  barea: async (el, d) => {
    const on = !(S.bareas || []).some((x) => x.user_id === d.u && x.area === d.v);
    if (await run(sb.rpc('set_board_area', { p_club: S.clubId, p_user: d.u, p_area: d.v, p_on: on }), on ? 'Accès ouvert.' : 'Accès fermé.')) { S.bareas = (await sb.from('board_areas').select('*').eq('club_id', S.clubId)).data || []; render(true); }
  },
});
function keepAnn() { const fm = document.getElementById('annf'); if (!fm) return; const v = Object.fromEntries(new FormData(fm)); S.annf.title = v.title; S.annf.body = v.body; }
FORMS.annf = async (v) => {
  const f = S.annf; keepAnn();
  if (!f.aud) return toast('Choisis les destinataires.');
  if (f.aud === 'team' && !f.teams.size) return toast('Choisis au moins une équipe.');
  const row = { club_id: S.clubId, audience: f.aud, team_ids: f.aud === 'team' ? [...f.teams] : [], title: v.title.trim(), body: (v.body || '').trim() };
  if (await run(sb.from('announcements').insert(row), 'Annonce publiée.')) { S.annf = null; S.view = { type: 'annonces' }; S.stack = (S.stack || []).filter((x) => x.type !== 'annform'); await refresh(); }
};
FORMS.mif = async (v, f) => {
  const eid = f.dataset.id, n = missionsOf(eid).length;
  if (await run(sb.from('event_missions').insert({ event_id: eid, label: v.label.trim(), slots: +v.slots || 1, position: n + 1 }), 'Mission ajoutée.')) { await reloadMissions(); render(true); }
};
FORMS.nomf = async (v) => {
  if (!v.user) return toast('Choisis un membre.');
  if (v.fonction === '__autre') { // 5.2.0 (n° 172)
    const t = String(v.otitle || '').trim();
    if (t.length < 2) return toast('Donne un nom au rôle.');
    if (await run(sb.rpc('create_other_role', { p_club: S.clubId, p_user: v.user, p_title: t, p_areas: [...(S.nomAreas || [])] }), 'Rôle créé : la personne est prévenue.')) { S.nomAutre = false; S.nomAreas = null; S.nomTitle = ''; S.bareas = (await sb.from('board_areas').select('*').eq('club_id', S.clubId)).data || []; await refresh(); }
    return;
  }
  if (await run(sb.rpc('set_bureau_fonction', { p_club: S.clubId, p_user: v.user, p_fonction: v.fonction }), 'Fonction attribuée.')) { S.resp151 = RESP_OF[v.fonction] ? { user: v.user, fonction: v.fonction, resp: RESP_OF[v.fonction][0] } : null; await refresh(); }
};
INPUTS.push((t) => {
  if (t.dataset.ntitle) { S.nomTitle = t.value; return true; } // 5.2.0 (n° 172)
  if (t.dataset.dml) { S.dm[+t.dataset.dml].label = t.value; return true; }
  if (t.dataset.dms) { S.dm[+t.dataset.dms].slots = t.value; return true; }
  if (t.dataset.dmy) { S.dm[+t.dataset.dmy].youth = t.checked; return true; } // n° 142
  if (t.form?.id === 'annf' && t.name) { S.annf[t.name] = t.value; return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.supvolclub) { const on = t.checked; if (await run(sb.rpc('set_supporters_volunteer', { p_club: S.clubId, p_on: on }), on ? 'Bénévolat ouvert aux supporteurs.' : 'Bénévolat fermé aux supporteurs.')) { club().supporters_volunteer = on; await refresh(); } else t.checked = !on; return true; }
  if (t.dataset.mremp) { S.mrem.people[t.checked ? 'add' : 'delete'](t.dataset.mremp); render(true); return true; }
  if (t.dataset.clubset) {
    const k = t.dataset.clubset, v = t.checked;
    if (await run(sb.from('clubs').update({ [k]: v }).eq('id', S.clubId), 'Réglage enregistré.')) { club()[k] = v; } else t.checked = !v;
    render(true); return true;
  }
  if (t.dataset.ftitle) { const v = t.value.trim(); if (await run(sb.rpc('set_bureau_title', { p_membership: t.dataset.ftitle, p_title: v }), v ? 'Intitulé enregistré.' : 'Intitulé retiré.')) await refresh(); return true; } // n° 166
  if (t.dataset.fonc) { if (await run(sb.rpc('set_bureau_fonction', { p_club: S.clubId, p_user: t.dataset.u, p_fonction: t.value, p_membership: t.dataset.fonc }), 'Fonction changée.')) { S.resp151 = RESP_OF[t.value] ? { user: t.dataset.u, fonction: t.value, resp: RESP_OF[t.value][0] } : null; await refresh(); window.scrollTo(0, 0); } else render(true); return true; }
  if (t.id === 'nf') { const was = !!S.nomAutre; S.nomAutre = t.value === '__autre'; S.nomUser = document.getElementById('nu')?.value || ''; S.nomFn = t.value; if (was !== S.nomAutre) render(true); return true; } // 5.2.0 (n° 172)
  if (t.dataset.massign) return true;
  return false;
});
export { playersOfTeam, myKids, team };
