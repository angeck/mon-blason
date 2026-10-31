// Pocket Club · vie du club (alpha 3.2) : espaces par casquette (charte du 31 octobre), rubriques du bureau (n° 55),
// fonctions (n° 54), annonces officielles et relances, bénévoles (n° 53), accueil multi-clubs, recherche connectée (n° 56).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_2.sql) ; l'écran n'est qu'un confort.
import {
  S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, club, active, isBoard, isPresident, coachTeams, coachOf,
  hasArea, AREAS, FONCTIONS, casquettes, team, teamName, name, nick, plural, fmtShort, hm, evTeams, store, playersOfTeam, toValidate, myKids, loadNames,
} from './core.js';
import { icon, crest, delBtn, field, header, dayBadge } from './ui.js';
import { upcoming } from './agenda.js';
import { pendRows, licencesBlock, namesToCheck, feesBlock, teamsBlock, brandBlock, contactsBlock, trashBlock, membersBlock } from './club.js';
import { ensureExos, plansForEvent, planForEvent, fmtMin } from './coach.js';
import { searchBlock } from './auth.js';

// Rubriques de chaque fonction (même table que la base : fonction_areas)
const FONCTION_AREAS = {
  'Vice-président': Object.keys(AREAS), 'Trésorier': ['tresorerie'], 'Trésorier adjoint': ['tresorerie'], 'Secrétaire': ['secretariat'], 'Secrétaire adjoint': ['secretariat'],
  'Correspondant licences': ['secretariat'], 'Directeur sportif': ['technique'], 'Coordinateur': ['technique', 'evenements'], 'Chargé de communication': ['communication'],
  'Responsable sponsoring': ['communication'], 'Responsable événements et buvette': ['evenements'], 'Membre du bureau': [],
};
const AREA_ICON = { tresorerie: 'doc', secretariat: 'user', technique: 'team', communication: 'msg', evenements: 'cal', commun: 'shield' };
const TITLES = {
  coach: 'Salut coach,<br>on prépare la suite ?', president: '{club},<br>où en est-on ?', tresorerie: 'Les cotisations,<br>en un coup d’œil',
  secretariat: 'Les membres,<br>bien rangés', technique: 'Les équipes,<br>sur le terrain', communication: 'Le club,<br>bien informé',
  evenements: 'Les bénévoles,<br>au rendez-vous', commun: 'Le bureau,<br>en commun',
};
const SEASON_LABEL = 'Saison 2026-2027';
const eur = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';

// ---------- espaces ----------
function currentCasq() {
  const l = casquettes(); if (!l.length) return null;
  let k = S.casq || store.get('pc_casq_' + S.clubId);
  if (!l.some((x) => x.k === k)) k = l[0].k;
  S.casq = k; return l.find((x) => x.k === k);
}
function casqTabs() {
  const l = casquettes(); if (l.length < 2) return '';
  return `<div class="casq" role="tablist" aria-label="Mes casquettes">${l.map((x) => `<button role="tab" data-act="casq" data-v="${esc(x.k)}" aria-selected="${x.k === S.casq}">${esc(x.label)}</button>`).join('')}</div>`;
}
const areaKey = (c) => (c.k === 'coach' || c.k === 'president' ? c.k : (FONCTION_AREAS[c.k.slice(2)] || [])[0] || 'commun');
function espaceView() {
  const c = currentCasq();
  if (!c) return { head: header({ back: true, title: 'Espace' }), body: '<p class="empty">Aucune fonction dans ce club.</p>' };
  const k = areaKey(c), title = (TITLES[k] || '').replace('{club}', esc(club()?.name || 'Le club'));
  const under = c.k === 'coach' ? teamsLabelSafe(coachTeams()) + ' · ' + (club()?.name || '') : SEASON_LABEL;
  let body = casqTabs();
  if (c.k === 'coach') body += coachSpace();
  else if (c.k === 'president') body += presidentSpace();
  else body += fonctionSpace(c.k.slice(2));
  return { head: header({ back: true, role: c.pill, title, under }), body };
}
const teamsLabelSafe = (ids) => ids.map(teamName).filter(Boolean).join(', ');

function coachSpace() {
  const ct = coachTeams(), soon = Date.now() + 14 * 864e5;
  const evs = upcoming(S.events.filter((e) => !e.cancelled && evTeams(e).some(coachOf) && ['Entraînement', 'Match', 'Plateau', 'Tournoi'].includes(e.type) && new Date(e.starts_at) < soon)).slice(0, 4);
  let h = `<button class="bigadd" data-act="cexnew">${icon('plus', 24, '#11162E', 2.6)}Ajouter un exercice</button>`;
  h += `<div class="sec"><h2>Séances à préparer</h2><button data-act="cplan">Ma séance</button></div>`;
  h += evs.length ? evs.map((e) => {
    const p = plansForEvent(e.id)[0];
    const st = p ? `<span class="pill ok">Prête</span>` : `<span class="pill ko">À préparer</span>`;
    return `<button class="card" data-act="${p ? 'pview' : 'cplanfor'}" data-id="${p ? p.id : e.id}" style="flex-direction:row;align-items:center;gap:12px;border:0;text-align:left;font:inherit;color:inherit">${dayBadge(e.starts_at)}<span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(teamsLabelSafe(evTeams(e)))} · ${esc(hm(new Date(e.starts_at)))}</b><span class="det">${p ? plural(p.items.length, 'exercice') + ' · ' + fmtMin(p.items.reduce((a, x) => a + (+x.minutes || 0), 0)) : esc(e.type + (e.title ? ' · ' + e.title : ''))}</span></span>${st}</button>`;
  }).join('') : '<p class="empty">Aucune séance dans les 14 prochains jours.</p>';
  const ex = S.exos;
  h += `<div class="sec"><h2>Banque d'exercices</h2><button data-act="cexos" data-tab="mine">Ma banque</button></div>
  <div class="tiles"><button class="tile blue" data-act="cexos" data-tab="mine"><b>${ex ? ex.filter((e) => e.created_by === S.me.id && !e.deleted_at).length : '…'}</b><span>Ma banque</span></button><button class="tile" data-act="cexos" data-tab="club"><b>${ex ? ex.filter((e) => e.club_id === S.clubId && e.sharing !== 'me' && !e.deleted_at).length : '…'}</b><span>Du club</span></button><button class="tile" data-act="cexos" data-tab="libre"><b>${ex ? ex.filter((e) => e.sharing === 'public' && e.public_state === 'validated' && !e.deleted_at).length : '…'}</b><span>Libre</span></button></div>`;
  h += `<div class="grid2"><button class="btn small" data-act="cstats">${icon('team', 18)}Statistiques</button><button class="btn small" data-act="chours">${icon('check', 18)}Mes heures</button>
  <button class="btn small" data-act="evnew" data-type="Match" data-team="${ct[0] || ''}">${icon('calplus', 18)}Convoquer un match</button><button class="btn small" data-act="annnew">${icon('msg', 18)}Annonce à l'équipe</button></div>`;
  return h;
}

function presidentSpace() {
  const vp = toValidate(), byRole = {};
  vp.forEach((m) => { const r = m.role === 'parent' ? 'parent de joueur' : m.role === 'bureau' ? 'bureau' : m.role; byRole[r] = (byRole[r] || 0) + 1; });
  let h = '';
  if (vp.length) h += `<div class="card" style="flex-direction:row;align-items:center;gap:12px;border:3px solid var(--pc-jaune)"><span style="display:flex;flex-direction:column;flex:1"><b style="font-size:18px">${plural(vp.length, 'demande à valider', 'demandes à valider')}</b><span class="det">${esc(Object.entries(byRole).map(([r, n]) => n + ' ' + r).join(', '))}</span></span><button class="btn main small" style="flex:none" data-act="tab" data-i="4">Voir</button></div>`;
  const fees = S.padmin.filter((a) => a.fee_amount != null), due = fees.reduce((a, x) => a + +x.fee_amount, 0), paid = fees.reduce((a, x) => a + Math.min(+x.fee_paid || 0, +x.fee_amount), 0);
  h += `<div class="tiles"><button class="tile" data-act="rub" data-id="secretariat"><b>${S.players.length}</b><span>Licenciés</span></button><button class="tile" data-act="rub" data-id="technique"><b>${S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée').length}</b><span>Équipes</span></button><button class="tile ok" data-act="rub" data-id="tresorerie"><b>${due ? Math.round((100 * paid) / due) + ' %' : '—'}</b><span>Cotisations</span></button></div>`;
  const todo = [], noBirth = S.players.filter((p) => !p.birth_date).length, cc = S.coachCounts || {};
  if (noBirth) todo.push(['rub', 'secretariat', plural(noBirth, 'date de naissance manquante', 'dates de naissance manquantes'), 'Secrétariat']);
  if (cc.hours) todo.push(['choursb', '', plural(cc.hours, 'relevé d’heures de coach', 'relevés d’heures de coachs'), 'À valider']);
  if (cc.exos) todo.push(['cexos', 'club', plural(cc.exos, 'exercice proposé à tous les clubs', 'exercices proposés à tous les clubs'), 'À valider']);
  const ag = upcoming(S.events.filter((e) => e.type === 'AG' && !e.cancelled))[0];
  if (ag) todo.push(['event', ag.id, 'AG du club : ' + fmtShort(ag.starts_at).split(' · ')[0], 'Dans ' + Math.max(1, Math.round((new Date(ag.starts_at) - Date.now()) / (7 * 864e5))) + ' sem.']);
  if (todo.length) h += `<div class="sec"><h2>À suivre</h2></div><div class="card"><div class="list">${todo.map(([a, id, t, p]) => `<button class="row" data-act="${a}" data-id="${esc(id)}" data-tab="${esc(id)}"><span class="g">${esc(t)}</span><span class="pill ${p === 'À valider' ? 'wait' : 'blue'}">${esc(p)}</span></button>`).join('')}</div></div>`;
  h += rubList(Object.keys(AREAS).concat('commun'));
  const c = club();
  h += `<div class="sec"><h2>Réglages du club</h2></div><div class="card">
    ${sw('custom_header', 'Aux couleurs du club', 'L’en-tête prend la couleur principale du club.', c.custom_header)}
    ${sw('public_listed', 'Apparaître dans la recherche des clubs', 'Nom, ville, équipes visibles et créneaux seulement.', c.public_listed !== false)}
    ${sw('coach_sees_fees', 'Les coachs voient licences et cotisations', 'De leurs joueurs seulement, sans les réductions.', c.coach_sees_fees !== false)}</div>`;
  h += `<div class="grid2"><button class="btn small" data-act="fonctions">${icon('user', 18)}Fonctions du bureau</button><button class="btn small" data-act="journal">${icon('doc', 18)}Journal des actions</button></div>`;
  return h;
}
const sw = (k, t, d, on) => `<label class="switch"><input type="checkbox" data-clubset="${k}" ${on ? 'checked' : ''}><span><b>${esc(t)}</b><br><span class="det">${esc(d)}</span></span></label>`;
function rubList(keys) {
  return `<div class="sec"><h2>Rubriques</h2></div><div class="card"><div class="list">${keys.map((a) => `<button class="row" data-act="rub" data-id="${a}"><span style="width:40px;height:40px;border-radius:14px;background:var(--pc-bleu-pale);display:flex;align-items:center;justify-content:center;flex:none">${icon(AREA_ICON[a], 20, 'var(--pc-bleu)')}</span><span class="g">${esc(AREAS[a] || 'Commun')}<small>${esc(RUB_SUB[a])}</small></span><span class="chev"></span></button>`).join('')}</div></div>`;
}
const RUB_SUB = {
  tresorerie: 'Tarifs, réductions, cotisations, relances, export', secretariat: 'Demandes, membres, licences, dates de naissance',
  technique: 'Équipes, coachs, heures, exercices, statistiques', communication: 'Annonces, contacts, blason et couleurs',
  evenements: 'Bénévoles, missions par défaut, événements', commun: 'Agenda, messages, annonces, corbeille, journal',
};
function fonctionSpace(f) {
  const own = (FONCTION_AREAS[f] || []).filter(hasArea), extra = (S.areas || []).filter((a) => !own.includes(a));
  let h = '';
  if (!own.length) h += `<div class="card pale"><b>${esc(f)}</b><p class="note">Ta fonction donne accès à la rubrique Commun. Le président peut t'ouvrir d'autres rubriques.</p></div>` + rubBody('commun');
  own.forEach((a, i) => { h += (i || own.length > 1 ? `<div class="sec"><h2>${esc(AREAS[a])}</h2></div>` : '') + rubBody(a); });
  return h + rubList((own.length ? ['commun'] : []).concat(extra));
}

// ---------- rubriques (n° 55) ----------
function rubView(a) {
  const ok = a === 'commun' ? isBoard() : hasArea(a);
  return { head: header({ back: true, kicker: 'Rubrique', title: esc(AREAS[a] || 'Commun') }), body: ok ? rubBody(a) : '<div class="card"><p class="empty">Cette rubrique n’est pas ouverte pour toi. Le président peut l’ouvrir dans « Fonctions du bureau ».</p></div>' };
}
function rubBody(a) {
  if (a === 'tresorerie') return tresoSummary() + feesBlock() + licencesBlock();
  if (a === 'secretariat') { const vp = toValidate(); return (vp.length ? `<div class="sec"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card lift">${pendRows(vp)}</div>` : '') + namesToCheck() + licencesBlock() + membersBlock(); }
  if (a === 'technique') return `<div class="grid2"><button class="btn small" data-act="choursb">${icon('check', 18)}Heures des coachs</button><button class="btn small" data-act="cexos" data-tab="club">${icon('doc', 18)}Exercices du club</button><button class="btn small" data-act="cstats">${icon('team', 18)}Statistiques</button><button class="btn small" data-act="evnew" data-type="Match">${icon('calplus', 18)}Nouveau match</button></div>` + teamsBlock();
  if (a === 'communication') return `<button class="btn main" data-act="annnew">${icon('plus', 20)}Nouvelle annonce</button>` + annList(S.annonces.slice(0, 8), true) + contactsBlock() + brandBlock();
  if (a === 'evenements') return eventsRub();
  return `<div class="grid2"><button class="btn small" data-act="tab" data-i="1">${icon('cal', 18)}Agenda</button><button class="btn small" data-act="tab" data-i="2">${icon('msg', 18)}Messages</button><button class="btn small" data-act="annlist">${icon('msg', 18)}Annonces</button>${isPresident() ? `<button class="btn small" data-act="journal">${icon('doc', 18)}Journal</button>` : ''}</div>` + trashBlock();
}
function tresoSummary() {
  const rows = S.players.map((p) => ({ p, a: S.padmin.find((x) => x.player_id === p.id) })).filter((x) => x.a && x.a.fee_amount != null);
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
function eventsRub() {
  const soon = Date.now() + 30 * 864e5;
  const evs = upcoming(S.events.filter((e) => !e.cancelled && new Date(e.starts_at) < soon && ['Match', 'Plateau', 'Tournoi', 'Événement', 'AG'].includes(e.type)));
  let h = `<button class="btn main" data-act="evnew" data-type="Événement">${icon('plus', 20)}Nouvel événement</button>`;
  h += `<div class="sec"><h2>Bénévoles des 30 prochains jours</h2></div>`;
  h += evs.length ? `<div class="card"><div class="list">${evs.map((e) => { const m = missionsOf(e.id), miss = missing(e.id); return `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))}${m.length ? '' : ' · aucune mission'}</small></span>${m.length ? (miss ? `<span class="pill wait">Il manque ${miss}</span>` : '<span class="pill ok">Complet</span>') : ''}</button>`; }).join('')}</div></div>` : '<p class="empty">Aucun match ni événement dans les 30 prochains jours.</p>';
  const dm = S.dm || (S.dm = (club()?.default_missions || []).map((x) => ({ ...x })));
  h += `<div class="sec"><h2>Missions par défaut du club</h2></div><div class="card"><div class="list">${dm.map((x, i) => `<div class="row static"><input aria-label="Mission ${i + 1}" data-dml="${i}" value="${esc(x.label)}" maxlength="40" style="flex:1;min-width:0;min-height:44px;border:2px solid var(--pc-trait);border-radius:12px;padding:4px 10px"><input type="number" aria-label="Places" data-dms="${i}" value="${esc(x.slots)}" min="1" max="20" style="width:70px;min-height:44px;border:2px solid var(--pc-trait);border-radius:12px;padding:4px 8px"><button class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="dmrm" data-i="${i}" aria-label="Retirer">${icon('trash', 18)}</button></div>`).join('')}</div>
  <div class="btns"><button class="btn ghost small" data-act="dmadd">${icon('plus', 18)}Ajouter</button><button class="btn main small" data-act="dmsave">Enregistrer</button></div><p class="note">Proposées en un geste sur chaque match, plateau, tournoi ou événement.</p></div>`;
  return h;
}

// ---------- bénévoles (n° 53) ----------
const MISSION_TYPES = ['Match', 'Plateau', 'Tournoi', 'Événement', 'AG'];
const missionsOf = (eid) => S.missions.filter((m) => m.event_id === eid).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
const signupsOf = (mid) => S.signups.filter((x) => x.mission_id === mid);
const missing = (eid) => missionsOf(eid).reduce((a, m) => a + Math.max(0, m.slots - signupsOf(m.id).length), 0);
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
  h += ms.map((m) => {
    const su = signupsOf(m.id), mine = su.some((x) => x.user_id === S.me.id), full = su.length >= m.slots;
    let act = '';
    if (!past) act = mine ? `<button class="btn small ghost" style="flex:none" data-act="volun" data-id="${m.id}" data-v="0">Me désinscrire</button>`
      : full ? '<span class="pill ok">Complet</span>'
      : !mineAny && !supporterOnly() ? `<button class="btn small main" style="flex:none" data-act="volun" data-id="${m.id}" data-v="1">Je m'inscris</button>` : '';
    const who = su.map((x) => `${esc(nick(x.user_id))}${man && !past ? ` <button class="pill" style="min-height:32px;border:0" data-act="vunassign" data-id="${m.id}" data-u="${x.user_id}" aria-label="Retirer ${esc(nick(x.user_id))}">✕</button>` : ''}`).join(', ');
    return `<div class="mission"><span class="g">${esc(m.label)} <span class="pill ${full ? 'ok' : 'wait'}">${su.length} / ${m.slots}</span><small>${who || 'Personne pour l’instant'}</small></span>${act}${man && !past ? `<button class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="mdelm" data-id="${m.id}" aria-label="Retirer la mission ${esc(m.label)}">${isArmed('mi' + m.id) ? '✓' : icon('trash', 18)}</button>` : ''}</div>`;
  }).join('');
  if (man && !past) {
    const mem = [...new Map(S.members.filter((x) => x.status === 'active' && x.role !== 'supporteur').map((x) => [x.user_id, x])).keys()].sort((a, b) => name(a).localeCompare(name(b), 'fr'));
    if (!ms.length) h += `<button class="btn main small" data-act="mdef" data-id="${e.id}">Ajouter les missions du club (${(club()?.default_missions || []).map((x) => x.label).join(', ')})</button>`;
    h += `<form id="mif" data-id="${e.id}" class="grid2" style="align-items:end">${field('mil', 'Autre mission', '<input id="mil" name="label" maxlength="40" placeholder="Ex. Photos, Accueil" required>')}${field('mis', 'Places', '<input id="mis" name="slots" type="number" min="1" max="20" value="1" required>')}<button class="btn ghost small" type="submit">${icon('plus', 18)}Ajouter la mission</button></form>`;
    if (ms.length) h += `<div class="grid2" style="align-items:end">${field('mia', 'Inscrire quelqu’un', `<select id="mia" data-massign="1"><option value="">Choisir…</option>${mem.map((u) => `<option value="${u}">${esc(name(u))}</option>`).join('')}</select>`)}${field('mim', 'Sur la mission', `<select id="mim">${ms.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>`)}</div><div class="btns"><button class="btn small" data-act="vassign">Inscrire</button>${missing(e.id) ? `<button class="btn small main" data-act="mremind" data-id="${e.id}">Relancer les missions vides</button>` : ''}</div>`;
  }
  return h + '</div>';
}
// Accueil : missions à pourvoir (sans envahir « À répondre »)
export function missionsHome() {
  if (supporterOnly()) return '';
  const soon = Date.now() + 21 * 864e5;
  const evs = upcoming(S.events.filter((e) => !e.cancelled && new Date(e.starts_at) < soon && missing(e.id) > 0 && !myMissionLabel(e))).slice(0, 3);
  if (!evs.length) return '';
  return `<div class="sec"><h2>Missions à pourvoir</h2></div><div class="card"><div class="list">${evs.map((e) => `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))} · il manque ${esc(missionsOf(e.id).map((m) => [m.slots - signupsOf(m.id).length, m.label.toLowerCase()]).filter(([n]) => n > 0).map(([n, l]) => n + ' ' + l).join(', '))}</small></span><span class="pill wait">Bénévoles</span></button>`).join('')}</div></div>`;
}

// ---------- annonces ----------
const KIND = { relance: ['Rappel', 'wait'], missions: ['Bénévoles', 'wait'], cotisation: ['Cotisation', 'ko'], annonce: ['Annonce', 'blue'] };
const kindOf = (a) => KIND[a.kind] || KIND.annonce;
const unread = (a) => !S.annRead.has(a.id) && a.created_by !== S.me.id;
export const canAnnounce = () => hasArea('communication') || isBoard() || coachTeams().length > 0;
function annList(list, withAll) {
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
  return l.map((a) => `<div class="card dark"><span class="kick" style="color:var(--pc-jaune)">${kindOf(a)[0]}${a.kind === 'annonce' ? ' · ' + esc(nick(a.created_by)) : ''}</span><b style="font-size:18px">${esc(a.title)}</b>${a.body ? `<span class="det" style="white-space:pre-wrap">${esc(a.body.replace(/ Réf\. [0-9a-f-]{36}$/, '').slice(0, 220))}</span>` : ''}<div class="btns">${a.event_id ? `<button class="btn small main" data-act="annevent" data-id="${a.id}">Ouvrir le rendez-vous</button>` : `<button class="btn small main" data-act="annopen" data-id="${a.id}">Lire</button>`}<button class="btn small ghost" style="background:#FFFFFF" data-act="annread" data-id="${a.id}">C'est lu</button></div></div>`).join('');
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
  let b = '<p class="note">Une fonction ouvre ses rubriques. Tu peux ouvrir une rubrique en plus à un membre ; la rubrique Commun est à tout le bureau.</p>';
  b += users.length ? users.map((u) => {
    const ms = bm.filter((m) => m.user_id === u), own = ms.flatMap((m) => FONCTION_AREAS[m.fonction || 'Membre du bureau'] || []);
    return `<div class="card"><b style="font-size:18px">${esc(name(u))}</b>${ms.map((m) => `<div class="grid2" style="align-items:end">${field('fo' + m.id, 'Fonction', `<select id="fo${m.id}" data-fonc="${m.id}" data-u="${u}">${FONCTIONS.map((f) => `<option ${(m.fonction || 'Membre du bureau') === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}${delBtn('mdel', m.id, 'Retirer', 'Confirmer', isArmed('m' + m.id))}</div>`).join('')}
    <div class="kick">Rubriques</div><div class="chips">${Object.entries(AREAS).map(([a, l]) => own.includes(a) ? `<span class="pill ok">${l}</span>` : `<button class="chip" data-act="barea" data-u="${u}" data-v="${a}" aria-pressed="${ba.some((x) => x.user_id === u && x.area === a)}">${l}</button>`).join('')}</div></div>`;
  }).join('') : '<p class="empty">Aucun membre du bureau pour l’instant.</p>';
  const cand = [...new Set(S.members.filter((m) => m.status === 'active' && m.user_id !== S.me.id).map((m) => m.user_id))].sort((a, c) => name(a).localeCompare(name(c), 'fr'));
  b += `<form id="nomf" class="card"><div class="kick">Nommer quelqu'un</div><div class="grid2">${field('nu', 'Membre du club', `<select id="nu" name="user" required><option value="">Choisir…</option>${cand.map((u) => `<option value="${u}">${esc(name(u))}</option>`).join('')}</select>`)}${field('nf', 'Fonction', `<select id="nf" name="fonction">${FONCTIONS.map((f) => `<option>${f}</option>`).join('')}</select>`)}</div><button class="btn main small" type="submit">Nommer</button><p class="note">Une seule personne pour la vice-présidence, le secrétariat et la trésorerie ; plusieurs pour les adjoints et les membres. Chaque nomination est inscrite au journal.</p></form>`;
  return { head: header({ back: true, kicker: 'Président', title: 'Fonctions du bureau' }), body: b };
}
function journalView() {
  const l = S.journal;
  const body = l == null ? '<p class="empty">Chargement…</p>' : l.length ? `<div class="card"><div class="list">${l.map((x) => `<div class="row static"><span class="g">${esc(x.action)}${x.target ? ' · ' + esc(x.target) : ''}<small>${esc(new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))} · par ${esc(x.actor)}${x.detail ? ' · ' + esc(Object.entries(x.detail).map(([k, v]) => k + ' : ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ').slice(0, 140)) : ''}</small></span></div>`).join('')}</div></div>` : '<p class="empty">Aucune action sensible pour l’instant.</p>';
  return { head: header({ back: true, kicker: 'Président', title: 'Journal des actions' }), body: '<p class="note">Versements, réductions, fiches modifiées, fonctions, validations d’heures… les 100 dernières actions. Lisible du seul président.</p>' + body };
}

// ---------- recherche connectée (n° 56) et accueil multi-clubs ----------
function searchView() {
  const mine = Object.values(S.clubs).filter((c) => S.mems.some((m) => m.club_id === c.id && m.status === 'active'));
  const b = `<div class="sec"><h2>Mes clubs</h2></div><div class="card"><div class="list">${mine.map((c) => `<div class="row static">${crest(c, 36, '#FFFFFF')}<span class="g">${esc(c.name)}<small>${esc([c.city, c.sport].filter(Boolean).join(' · '))}</small></span>${c.id === S.clubId ? '<span class="pill ok">Ouvert</span>' : `<button class="btn small main" style="flex:none" data-act="club" data-id="${c.id}">Ouvrir</button>`}</div>`).join('') || '<p class="empty">Aucun club.</p>'}</div></div>` + searchBlock();
  return { head: header({ back: true, kicker: 'Recherche', title: 'Chercher un club' }), body: b };
}
export function otherClubsHome() {
  const l = (S.overview || []).filter((x) => x.club_id !== S.clubId);
  if (!l.length) return '';
  return `<div class="sec"><h2>Mes autres clubs</h2></div>` + l.map((c) => `<div class="card"><div style="display:flex;align-items:center;gap:12px">${crest({ ...c, id: c.club_id }, 36, '#FFFFFF')}<span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(c.name)}</b><span class="det">${(c.next_events || []).length ? '' : 'Rien dans les 7 prochains jours'}</span></span>${c.unread ? `<span class="pill wait">${plural(c.unread, 'annonce', 'annonces')}</span>` : ''}</div>${(c.next_events || []).map((e) => `<div class="det">${esc(fmtShort(e.starts_at))} · ${esc(e.title)}</div>`).join('')}<button class="btn small" data-act="club" data-id="${c.club_id}">Ouvrir ${esc(c.name)}</button></div>`).join('');
}

// ---------- écrans (lus par app.js) ----------
export const VIE_VIEWS = {
  espace: () => espaceView(), rub: (v) => rubView(v.id), annonces: () => annoncesView(), annonce: (v) => annonceView(v.id), annform: () => annFormView(),
  fonctions: () => fonctionsView(), journal: () => journalView(), csearch: () => searchView(),
};

// ---------- actions ----------
async function reloadMissions() {
  const ids = S.events.map((e) => e.id);
  S.missions = ids.length ? ((await sb.from('event_missions').select('*').in('event_id', ids).order('position')).data || []) : [];
  S.signups = S.missions.length ? ((await sb.from('mission_signups').select('*').in('mission_id', S.missions.map((m) => m.id))).data || []) : [];
  await loadNames(S.signups.map((x) => x.user_id));
}
async function markRead(id) {
  if (S.annRead.has(id)) return;
  if (await run(sb.from('announcement_reads').insert({ announcement_id: id, user_id: S.me.id }))) S.annRead.add(id);
}
Object.assign(ACTIONS, {
  espace: async () => { S.view = { type: 'espace' }; currentCasq(); render(); if (S.casq === 'coach') { await ensureExos(); render(true); } },
  casq: async (el, d) => { S.casq = d.v; store.set('pc_casq_' + S.clubId, d.v); render(true); if (d.v === 'coach') { await ensureExos(); render(true); } },
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
  vassign: async () => { const u = document.getElementById('mia')?.value, m = document.getElementById('mim')?.value; if (!u) return toast('Choisis une personne.'); if (await run(sb.rpc('assign_volunteer', { p_mission: m, p_user: u, p_on: true }), 'Bénévole inscrit.')) { await reloadMissions(); render(true); } },
  mdef: async (el, d) => { const n = await run(sb.rpc('add_default_missions', { p_event: d.id })); if (n !== null) { toast(plural(n, 'mission ajoutée', 'missions ajoutées') + '.'); await reloadMissions(); render(true); } },
  mdelm: async (el, d) => { if (!armed('mi' + d.id)) return; if (await run(sb.from('event_missions').delete().eq('id', d.id), 'Mission retirée.')) { await reloadMissions(); render(true); } },
  mremind: async (el, d) => { const t = await run(sb.rpc('remind_missions', { p_event: d.id })); if (t !== null) { toast('Annonce envoyée : il manque ' + t + '.'); await refresh(); } },
  dmadd: () => { S.dm.push({ label: '', slots: 1 }); render(true); },
  dmrm: (el, d) => { S.dm.splice(+d.i, 1); render(true); },
  dmsave: async () => { const l = S.dm.map((x) => ({ label: String(x.label || '').trim(), slots: Math.max(1, Math.min(20, +x.slots || 1)) })).filter((x) => x.label.length >= 2); if (await run(sb.from('clubs').update({ default_missions: l }).eq('id', S.clubId), 'Missions par défaut enregistrées.')) { S.dm = null; await refresh(); } },
  // président
  fonctions: async () => { S.view = { type: 'fonctions' }; render(); S.bareas = (await sb.from('board_areas').select('*').eq('club_id', S.clubId)).data || []; render(true); },
  journal: async () => { S.journal = null; S.view = { type: 'journal' }; render(); S.journal = (await run(sb.rpc('club_log', { p_club: S.clubId, p_limit: 100 }))) || []; render(true); },
  barea: async (el, d) => {
    const on = !(S.bareas || []).some((x) => x.user_id === d.u && x.area === d.v);
    if (await run(sb.rpc('set_board_area', { p_club: S.clubId, p_user: d.u, p_area: d.v, p_on: on }), on ? 'Rubrique ouverte.' : 'Rubrique fermée.')) { S.bareas = (await sb.from('board_areas').select('*').eq('club_id', S.clubId)).data || []; render(true); }
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
  if (await run(sb.rpc('set_bureau_fonction', { p_club: S.clubId, p_user: v.user, p_fonction: v.fonction }), 'Fonction attribuée.')) await refresh();
};
INPUTS.push((t) => {
  if (t.dataset.dml) { S.dm[+t.dataset.dml].label = t.value; return true; }
  if (t.dataset.dms) { S.dm[+t.dataset.dms].slots = t.value; return true; }
  if (t.form?.id === 'annf' && t.name) { S.annf[t.name] = t.value; return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.clubset) {
    const k = t.dataset.clubset, v = t.checked;
    if (await run(sb.from('clubs').update({ [k]: v }).eq('id', S.clubId), 'Réglage enregistré.')) { club()[k] = v; } else t.checked = !v;
    render(true); return true;
  }
  if (t.dataset.fonc) { if (await run(sb.rpc('set_bureau_fonction', { p_club: S.clubId, p_user: t.dataset.u, p_fonction: t.value, p_membership: t.dataset.fonc }), 'Fonction changée.')) await refresh(); else render(true); return true; }
  if (t.dataset.massign) return true;
  return false;
});
export { playersOfTeam, myKids, team };
