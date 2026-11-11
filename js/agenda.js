// mypocketclub · agenda : rendez-vous (une ou plusieurs équipes, personnes choisies), réponses, appel, séries, suppression.
import {
  S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, CHANGES, INPUTS, TEAM_TYPES, club, active, isBoard, coachOf, coachTeams,
  teamName, teamsLabel, catsLabel, evTeams, name, pl, pname, parentsOf, myKidsIn, iPlayIn, inTeam, playersOfTeam, fmtDate, hm, localDay, inHolidays,
  toLocalInput, fmtDay, plural, download, norm, follows, hooks, hasArea, myMem, isPresident,
  SEASON, durOf, endOf, timeRange, fmtDur, DEF_DUR, fmtShort,
} from './core.js';
import { icon, dayBadge, delBtn, field, crest, ball } from './ui.js';
import { plansForEvent, fmtMin, courtSvg, openPlanForEvent } from './coach.js';
import { missionsBlock, myMissionLabel } from './vie.js';

const INTERNAL = { board: 'Bureau', board_coaches: 'Bureau et coachs', coaches: 'Tous les coachs' };
const SUB_TYPES = { Entraînements: ['Entraînement'], Matchs: ['Match', 'Plateau', 'Tournoi'], Événements: ['Événement', 'Réunion', 'AG'] };
export const types = () => (isBoard() ? ['Entraînement', 'Match', 'Plateau', 'Tournoi', 'Événement', 'Réunion', 'AG'] : ['Entraînement', 'Match', 'Plateau', 'Tournoi']);
export const canManageEvent = (e) => isBoard() || (e.audience === 'team' && evTeams(e).some(coachOf));
// n° 72 : l'appel et la convocation reviennent aux coachs de l'équipe et au président
export const canCallRoll = (e) => isPresident() || (e.audience === 'team' && evTeams(e).some(coachOf));

// ---------- réponses ----------
export function respOf(eid) {
  const r = S.resp.filter((x) => x.event_id === eid);
  return { all: r, oui: r.filter((x) => x.answer === 'oui'), non: r.filter((x) => x.answer === 'non'), mine: (r.find((x) => x.user_id === S.me.id && !x.player_id) || {}).answer, kid: (pid) => (r.find((x) => x.player_id === pid) || {}).answer };
}
const isTeamType = (e) => evTeams(e).length && TEAM_TYPES.includes(e.type);
// N° 41 : rendez-vous vu seulement parce qu'on suit l'équipe (pas de réponse : suivre n'est pas être convoqué)
// créateur d'un rendez-vous pour des personnes choisies sans lui : il le voit, sans y répondre
const notInvited = (e) => e.audience === 'people' && !(e.people || []).includes(S.me.id);
export const followOnly = (e) => isTeamType(e) && !evTeams(e).some(coachOf) && !iPlayIn(evTeams(e)) && !myKidsIn(evTeams(e)).length && evTeams(e).some(follows) && !isBoard();
// Le coach d'une équipe concernée encadre : il ne répond pas pour lui-même (sauf joueur-entraîneur)
export const coachOnly = (e) => isTeamType(e) && evTeams(e).some(coachOf) && !iPlayIn(evTeams(e));
// N° 52 : une séance d'une série n'entre dans « À répondre » que si c'est la prochaine séance de la série, ou 7 jours avant sa date
export const OPEN_DAYS = 7;
// N° 57 : une « série » = les séances liées par series_id ; pour les entraînements sans lien (recopiés, importés, anciens),
// les séances identiques (mêmes équipes, même titre, même jour de la semaine, même heure, même créateur) comptent comme une série.
export function serieKey(e) {
  if (e.series_id) return 's:' + e.series_id;
  if (e.type !== 'Entraînement') return null;
  const d = new Date(e.starts_at);
  return ['t', [...(e.team_ids || [])].sort().join(','), (e.title || '').trim().toLowerCase(), d.getDay(), d.getHours() + ':' + d.getMinutes(), e.created_by || ''].join('|');
}
export function isOpen(e) {
  const key = serieKey(e);
  if (!key) return true;
  const now = Date.now(), t = new Date(e.starts_at).getTime();
  if (t <= now + OPEN_DAYS * 864e5) return true;
  let next = null;
  for (const x of S.events) {
    if (x.cancelled || serieKey(x) !== key) continue;
    const tx = new Date(x.starts_at).getTime();
    if (tx >= now - 2 * 3600e3 && (!next || tx < new Date(next.starts_at).getTime())) next = x;
  }
  return !next || next.id === e.id;
}
export const opensOn = (e) => new Date(new Date(e.starts_at).getTime() - OPEN_DAYS * 864e5);
// Convocation : un match peut ne convoquer que certains joueurs (3.2)
export const convoked = (e, pid) => !(e.convoked || []).length || e.convoked.includes(pid);
const myFiche = () => S.players.find((p) => p.user_id === S.me.id);
const meConvoked = (e) => !(e.convoked || []).length || (myFiche() && e.convoked.includes(myFiche().id));
// N° 59 : un compte qui n'est que supporteur (ou dont la demande attend la validation) n'a pas de réponse à donner, sauf invitation nominative
export const supporterOnly = () => !active().some((m) => m.role !== 'supporteur');
const noAnswerRole = (e) => supporterOnly() && !(e.audience === 'people' && (e.people || []).includes(S.me.id));
// N° 65 : sur un rendez-vous d'équipe, seuls les joueurs de l'équipe (et les parents pour un mineur) répondent ;
// le créateur, le coordinateur, le bureau et les coachs le voient sans « À répondre »
const outsider = (e) => isTeamType(e) && !iPlayIn(evTeams(e)) && !myKidsIn(evTeams(e)).length && !coachOnly(e) && !followOnly(e);
export function needsAnswer(e) {
  if (e.cancelled || new Date(e.starts_at) < Date.now() - 2 * 3600e3 || !isOpen(e)) return false;
  const R = respOf(e.id);
  if (noAnswerRole(e)) return false;
  if (!isTeamType(e)) { if (notInvited(e)) return false; return !R.mine || famKids(e).some((p) => !p.user_id && !R.kid(p.id)); }
  const k = myKidsIn(evTeams(e)).filter((p) => convoked(e, p.id)), me = iPlayIn(evTeams(e)) && meConvoked(e);
  if (k.some((p) => !R.kid(p.id))) return true;
  if (me) return !R.mine;
  return false;
}
// N° 79 : sur un événement ouvert au-delà d'une équipe, une ligne par personne du foyer : « Moi » et chaque enfant concerné.
// La réponse d'un enfant est commune aux deux parents ; un joueur avec son propre compte répond pour lui-même.
export function famKids(e) {
  if (isTeamType(e) || !['club', 'team'].includes(e.audience)) return [];
  const ts = e.audience === 'club' ? S.teams.map((t) => t.id) : evTeams(e);
  return myKidsIn(ts).filter((p) => p.user_id !== S.me.id);
}
function pair(e, pid) {
  const R = respOf(e.id), m = pid ? R.kid(pid) : R.mine, p = pid && pl(pid), ev = !isTeamType(e);
  const yes = p ? `${esc(p.first_name)} ${ev ? 'participe' : 'vient'}` : ev ? 'Je participe' : 'Je viens', no = p ? `${esc(p.first_name)} ${ev ? 'ne participe pas' : 'ne vient pas'}` : ev ? 'Je ne participe pas' : 'Je ne viens pas';
  return `<div class="pair"><button class="btn yes" data-act="rsvp" data-id="${e.id}" data-p="${pid || ''}" data-v="oui" aria-pressed="${m === 'oui'}">${m === 'oui' ? icon('check', 20, 'currentColor', 3) : ''}${yes}</button><button class="btn no" data-act="rsvp" data-id="${e.id}" data-p="${pid || ''}" data-v="non" aria-pressed="${m === 'non'}">${no}</button></div>`;
}
// n° 79 : après « Je participe », le nombre d'accompagnants sans compte (famille, amis), compté par l'organisateur
const myRow = (e) => S.resp.find((x) => x.event_id === e.id && x.user_id === S.me.id && !x.player_id);
export const guestsOf = (e) => S.resp.filter((x) => x.event_id === e.id && x.answer === 'oui').reduce((a, x) => a + (+x.guests || 0), 0);
function guestsLine(e) {
  const r = myRow(e); if (!r || r.answer !== 'oui') return '';
  const n = +r.guests || 0;
  return `<div class="guests"><span class="g">+ accompagnants<small>Personnes sans compte qui viennent avec toi</small></span><button class="btn small ghost" data-act="guests" data-id="${e.id}" data-v="${n - 1}" ${n ? '' : 'disabled'} aria-label="Un accompagnant de moins">−</button><b aria-live="polite">${n}</b><button class="btn small ghost" data-act="guests" data-id="${e.id}" data-v="${n + 1}" ${n >= 20 ? 'disabled' : ''} aria-label="Un accompagnant de plus">+</button></div>`;
}
export function invitedCount(e) {
  const act = S.members.filter((m) => m.status === 'active'), ids = new Set(), board = act.filter((m) => ['president', 'bureau'].includes(m.role)).map((m) => m.user_id);
  if (e.audience === 'club') { const real = new Set(act.filter((m) => m.role !== 'supporteur').map((m) => m.user_id)); act.forEach((m) => { if (e.with_supporters !== false || real.has(m.user_id)) ids.add(m.user_id); }); } // n° 89
  else if (e.audience === 'board') board.forEach((u) => ids.add(u));
  else if (e.audience === 'coaches' || e.audience === 'board_coaches') { act.filter((m) => m.role === 'coach').forEach((m) => ids.add(m.user_id)); if (e.audience === 'board_coaches') board.forEach((u) => ids.add(u)); }
  else if (e.audience === 'people') (e.people || []).forEach((u) => ids.add(u));
  else evTeams(e).forEach((t) => { act.filter((m) => m.team_id === t).forEach((m) => ids.add(m.user_id)); playersOfTeam(t).forEach((p) => { if (p.user_id) ids.add(p.user_id); parentsOf(p.id).forEach((u) => ids.add(u)); }); });
  return ids.size;
}
// Nombre de joueurs concernés (match, plateau, tournoi, entraînement : on compte des joueurs)
export const playersOf = (e) => { const m = new Map(); evTeams(e).forEach((t) => playersOfTeam(t).forEach((p) => { if (convoked(e, p.id)) m.set(p.id, p); })); return [...m.values()]; };
export function answerBlock(e) {
  if (e.cancelled) return '';
  if (notInvited(e)) return '<p class="note">Tu as créé ce rendez-vous pour des personnes choisies : tu n’en fais pas partie.</p>';
  if (noAnswerRole(e)) return `<p class="note">${myMem().some((m) => m.status === 'pending') ? 'Ta demande attend la validation du club : pas de réponse à donner pour l’instant.' : 'En supporteur, pas de réponse à donner : tu suis la vie du club.'}</p>`;
  if (outsider(e)) return '<p class="note">Tu ne fais pas partie de cette équipe : seuls ses joueurs (ou leurs parents) répondent.</p>';
  if (!isTeamType(e)) {
    const ks = famKids(e); if (!ks.length) return pair(e, null) + guestsLine(e);
    const R = respOf(e.id);
    return `<p class="note" style="margin:0">Une réponse pour chaque personne de ta famille. La réponse d'un enfant vaut pour ses deux parents.</p><div class="kick">Moi</div>${pair(e, null)}${guestsLine(e)}` + ks.map((p) => p.user_id
      ? `<p class="note"><b>${esc(p.first_name)}</b> a son propre compte et répond pour lui-même : ${R.kid(p.id) === 'oui' ? 'participe' : R.kid(p.id) === 'non' ? 'ne participe pas' : 'pas encore de réponse'}.</p>`
      : `<div class="kick">${esc(p.first_name)}</div>${pair(e, p.id)}`).join('');
  }
  if (followOnly(e)) return '<p class="note">Tu suis cette équipe : pas de réponse à donner.</p>';
  const all = myKidsIn(evTeams(e)), k = all.filter((p) => convoked(e, p.id)), me = iPlayIn(evTeams(e)) && meConvoked(e);
  const kids = k.map((p) => pair(e, p.id)).join('') + all.filter((p) => !convoked(e, p.id)).map((p) => `<p class="note">${esc(p.first_name)} n'est pas convoqué${p.first_name.endsWith('e') ? '(e)' : ''} à ce rendez-vous.</p>`).join('');
  if (coachOnly(e)) {
    const R = respOf(e.id), n = playersOf(e).length, oui = R.oui.filter((x) => x.player_id || !k.length).length, non = R.non.length;
    const rest = isOpen(e) ? `<span class="pill">${Math.max(0, n - oui - non)} sans réponse</span>` : `<span class="det">Réponses demandées à partir du ${esc(fmtDay(opensOn(e)))}</span>`;
    return `<div class="card pale"><div class="kick">Tu encadres</div><div class="chips"><span class="pill ok">${oui} oui</span><span class="pill ko">${non} non</span>${rest}</div><button class="btn main small" data-act="appel" data-id="${e.id}">Faire l'appel</button></div>` + kids;
  }
  if (iPlayIn(evTeams(e)) && !me) return '<p class="note">Tu n\'es pas convoqué à ce rendez-vous.</p>' + kids;
  return (me || !all.length ? pair(e, null) : '') + kids;
}
function respName(x) {
  if (!x.player_id) return esc(name(x.user_id));
  const p = pl(x.player_id), staff = isBoard() || coachTeams().length > 0;
  const nm = p ? (p.first_name + ' ' + (p.last_name ? p.last_name[0] + '.' : '')).trim() : 'Un joueur';
  return esc(nm) + (staff && p ? ` <span class="det">(répondu par ${esc(name(x.user_id))})</span>` : '');
}
export function forLabel(e) {
  const txt = e.audience === 'team' ? teamsLabel(evTeams(e)) || 'équipe' : e.audience === 'people' ? plural((e.people || []).length, 'personne choisie', 'personnes choisies') : INTERNAL[e.audience] || (e.with_supporters === false ? 'membres du club' : 'tout le club, supporteurs compris');
  let h = `<span class="pill ${INTERNAL[e.audience] || e.audience === 'people' ? 'wait' : 'blue'}">${INTERNAL[e.audience] || e.audience === 'people' ? icon('lock', 14) : ''}Pour : ${esc(txt)}</span>`;
  if (active().length > 1) { const r = reason(e); if (r) h += ` <span class="det">Toi : ${esc(r)}</span>`; }
  return h;
}
function reason(e) {
  if (e.audience === 'team') {
    const t = evTeams(e), mine = t.filter(coachOf);
    if (mine.length) return 'coach ' + teamsLabel(mine);
    if (iPlayIn(t)) return 'joueur';
    const k = myKidsIn(t); if (k.length) return 'parent de ' + k.map((p) => p.first_name).join(' et ');
  }
  if (e.audience === 'people') return 'invité';
  if (isBoard()) return 'bureau';
  if (INTERNAL[e.audience]) return 'coach';
  return '';
}

// ---------- liste ----------
const hiddenByMe = (e) => S.hidden.some((h) => h.event_id === e.id && new Date(h.hidden_at) >= new Date(e.updated_at || 0));
// n° 35 : le créateur voit toujours son rendez-vous ; n° 41 : les matchs des équipes suivies comptent comme les miens
const personal = (e) => e.created_by === S.me.id || evTeams(e).some((t) => coachOf(t) || iPlayIn([t]) || myKidsIn([t]).length || (follows(t) && ['Match', 'Plateau', 'Tournoi'].includes(e.type)));
// n° 22 : sans « Tout le club », le président et le bureau ne voient pas les rendez-vous des équipes où ils n'ont aucun rôle
// n° 61 : la rubrique Événements (coordinateur, vice-président, président) voit toujours les matchs, plateaux et tournois, pour les bénévoles
const hiddenByToggle = (e) => isBoard() && !S.me.show_all_club && e.audience === 'team' && !personal(e) && !(hasArea('evenements') && ['Match', 'Plateau', 'Tournoi'].includes(e.type));
export const sortEvents = (l) => l.slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || teamsLabel(evTeams(a)).localeCompare(teamsLabel(evTeams(b))));
const soon = () => Date.now() - 2 * 3600e3;
export const upcoming = (l) => sortEvents(l.filter((e) => new Date(e.starts_at).getTime() >= soon()));
const past = (l) => sortEvents(l.filter((e) => new Date(e.starts_at).getTime() < soon())).reverse();
export const visibleEvents = () => S.events.filter((e) => !hiddenByToggle(e));
// n° 157 (Gaël, 9 novembre 2026) : un rendez-vous quitte l'Accueil quand il est fini ; s'il attend l'appel de son coach
// (ou du président), il reste ce jour-là jusqu'à ce que l'appel soit validé
const rollPending = (e) => ROLL_TYPES.includes(e.type) && !e.cancelled && canCallRoll(e) && !S.att.some((x) => x.event_id === e.id) && localDay(new Date(e.starts_at)) === localDay(new Date());
export const onHome = (e) => Date.now() <= endOf(e).getTime() || rollPending(e);
export const homeEvents = () => sortEvents(visibleEvents().filter((e) => !hiddenByMe(e) && onHome(e)));
export const isToday = (e) => localDay(new Date(e.starts_at)) === localDay(new Date());
export { rollPending };
function dayTitle(d) {
  const k = localDay(d);
  if (k === localDay(new Date())) return 'Aujourd’hui';
  if (k === localDay(new Date(Date.now() + 864e5))) return 'Demain';
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1);
}
export function byDay(list, fn) {
  let h = '', last = '';
  list.forEach((e) => { const d = new Date(e.starts_at), k = localDay(d); if (k !== last) { h += `<div class="kick day">${esc(dayTitle(d))}</div>`; last = k; } h += fn(e); });
  return h;
}
// ---------- n° 77 · score ----------
export function scoreSum(e) {
  const L = e.scores || []; if (!L.length) return null;
  const w = L.filter((l) => l.us > l.them).length, lo = L.filter((l) => l.us < l.them).length, d = L.length - w - lo;
  if (L.length === 1) { const l = L[0], k = w ? 'v' : lo ? 'd' : 'n'; return { k, text: (w ? 'Victoire ' : lo ? 'Défaite ' : 'Nul ') + l.us + ' – ' + l.them + (l.opponent ? ' contre ' + l.opponent : '') + (l.forfeit ? ' (forfait)' : '') }; }
  return { k: w > lo ? 'v' : lo > w ? 'd' : 'n', text: plural(w, 'victoire') + ', ' + plural(lo, 'défaite') + (d ? ', ' + plural(d, 'nul') : '') };
}
const canScore = (e) => ['Match', 'Plateau', 'Tournoi'].includes(e.type) && !e.cancelled && canCallRoll(e) && new Date(e.starts_at) <= Date.now();
function scoreBlock(e) {
  if (!['Match', 'Plateau', 'Tournoi'].includes(e.type) || e.cancelled) return '';
  const sum = scoreSum(e), team = teamsLabel(evTeams(e)) || 'Nous';
  if (S.score?.eid === e.id) {
    const L = S.score.lines;
    return `<form id="scoref" class="card lift"><div class="kick">Score · ${esc(team)}</div>${L.map((l, i) => `<div class="score-l"><input name="o${i}" value="${esc(l.opponent || '')}" placeholder="Adversaire" aria-label="Adversaire ${i + 1}" maxlength="80"><input name="u${i}" type="number" min="0" max="999" inputmode="numeric" value="${esc(l.us ?? '')}" aria-label="Score de ${esc(team)}" required><span>–</span><input name="t${i}" type="number" min="0" max="999" inputmode="numeric" value="${esc(l.them ?? '')}" aria-label="Score de l'adversaire" required><button type="button" class="btn ghost small" style="width:48px;padding:0" data-act="scrm" data-i="${i}" aria-label="Retirer cette ligne" ${L.length > 1 ? '' : 'disabled'}>${icon('trash', 18)}</button></div><label class="check" style="margin-top:-4px"><input type="checkbox" name="f${i}" ${l.forfeit ? 'checked' : ''}><span>Forfait</span></label>`).join('')}
      <button type="button" class="btn ghost small" data-act="scadd">${icon('plus', 18)}+ 1 rencontre</button><div class="btns"><button class="btn main" type="submit">Valider</button><button type="button" class="btn ghost" data-act="sccancel">Annuler</button></div></form>`;
  }
  let h = '';
  if (sum) h += `<div class="card"><div class="kick">Résultat${e.score_edited ? ' · modifié' : ''}</div><span class="pill res-${sum.k}" style="font-size:16px;align-self:flex-start">${esc(sum.text)}</span>${(e.scores || []).length > 1 ? `<div class="list">${e.scores.map((l) => `<div class="row static"><span class="g">${esc(team)} ${l.us} – ${l.them} ${esc(l.opponent || 'adversaire')}${l.forfeit ? ' · forfait' : ''}</span><span class="pill res-${l.us > l.them ? 'v' : l.us < l.them ? 'd' : 'n'}">${l.us > l.them ? 'V' : l.us < l.them ? 'D' : 'N'}</span></div>`).join('')}</div>` : ''}${canScore(e) ? `<button class="btn ghost small" data-act="scedit" data-id="${e.id}">Corriger le score</button>` : ''}</div>`;
  else if (canScore(e)) h += `<button class="btn main" data-act="scedit" data-id="${e.id}">Mettre le score</button>`;
  return h;
}
function keepScore() {
  const fm = document.getElementById('scoref'); if (!fm || !S.score) return; const v = Object.fromEntries(new FormData(fm));
  S.score.lines = S.score.lines.map((l, i) => ({ opponent: v['o' + i] || '', us: v['u' + i] === '' ? '' : +v['u' + i], them: v['t' + i] === '' ? '' : +v['t' + i], forfeit: !!v['f' + i] }));
}
FORMS.scoref = async () => {
  keepScore(); const L = S.score.lines;
  if (L.some((l) => l.us === '' || l.them === '')) return toast('Indique les deux scores de chaque rencontre.');
  const n = await run(sb.rpc('set_score', { p_event: S.score.eid, p_lines: L }));
  if (n !== null) { const e = S.events.find((x) => x.id === S.score.eid); if (e) { e.score_edited = !!e.scores; e.scores = L; } S.score = null; toast('Score enregistré : les joueurs, les familles et les supporteurs de l’équipe le voient sur leur Accueil.'); await refresh(); }
};
Object.assign(ACTIONS, {
  scedit: (el, d) => { const e = S.events.find((x) => x.id === d.id), opp = (e.opponents || '').split(',').map((x) => x.trim()).filter(Boolean); S.score = { eid: e.id, lines: e.scores?.length ? e.scores.map((l) => ({ ...l })) : (opp.length ? opp : ['']).map((o) => ({ opponent: o, us: '', them: '', forfeit: false })) }; render(true); },
  scadd: () => { keepScore(); if (S.score.lines.length >= 20) return toast('Vingt rencontres au plus.'); const e = S.events.find((x) => x.id === S.score.eid), opp = (e.opponents || '').split(',').map((x) => x.trim()).filter(Boolean); S.score.lines.push({ opponent: opp[S.score.lines.length] || '', us: '', them: '', forfeit: false }); render(true); },
  scrm: (el, d) => { keepScore(); S.score.lines.splice(+d.i, 1); render(true); },
  sccancel: () => { S.score = null; render(true); },
});

function statusPill(e) {
  if (e.cancelled) return '<span class="pill ko">Annulé</span>';
  const sc = scoreSum(e); if (sc) return `<span class="pill res-${sc.k}">${sc.k === 'v' ? 'Victoire' : sc.k === 'd' ? 'Défaite' : 'Nul'}</span>`;
  const R = respOf(e.id), k = isTeamType(e) ? myKidsIn(evTeams(e)) : [];
  if (needsAnswer(e)) return '<span class="pill wait">À répondre</span>';
  if ((e.convoked || []).length && isTeamType(e) && !coachOnly(e) && myKidsIn(evTeams(e)).length && !myKidsIn(evTeams(e)).some((p) => convoked(e, p.id))) return '<span class="pill">Non convoqué</span>';
  if (followOnly(e)) return '<span class="pill blue">Suivie</span>';
  if (coachOnly(e) && !k.length) return `<span class="pill blue">${R.oui.length} oui</span>`;
  const a = k.length ? R.kid(k[0].id) : R.mine;
  return a === 'oui' ? '<span class="pill ok">Oui</span>' : a === 'non' ? '<span class="pill ko">Non</span>' : '';
}
// Bouton « Annuler cette séance » (agenda et onglet Préparer) : deux touches, comme une suppression ; la séance reste dans l'agenda, barrée, et peut être rétablie depuis sa page
export function cancelBtn(e) {
  if (e.cancelled || !canManageEvent(e) || new Date(e.ends_at || e.starts_at) < Date.now()) return '';
  const k = 'evc' + e.id, lab = isTeamType(e) && e.type === 'Entraînement' ? 'Annuler cette séance' : 'Annuler ce rendez-vous';
  return `<button type="button" class="btn small ${isArmed(k) ? 'danger armed' : 'ghost'}" data-act="evcancelq" data-id="${e.id}">${esc(isArmed(k) ? 'Confirmer : ' + lab.toLowerCase() : lab)}</button>`;
}
// Carte d'un rendez-vous ; opts : { answer: boutons si une réponse manque, select: mode sélection }
export function evCard(e, o = {}) {
  const sub = [timeRange(e), e.place, e.audience !== 'club' && e.audience !== 'team' ? '' : teamsLabel(evTeams(e)), myMissionLabel(e)].filter(Boolean).join(' · ');
  const sel = o.select && canManageEvent(e), checked = S.sel?.has(e.id);
  const badgeCls = new Date(e.starts_at) < Date.now() ? 'past' : needsAnswer(e) ? 'wait' : '';
  return `<div class="ev ${e.cancelled ? 'cancel' : ''}">${sel
    ? `<label class="head" style="cursor:pointer"><input type="checkbox" class="sel" data-evsel="${e.id}" ${checked ? 'checked' : ''} aria-label="Sélectionner ${esc(e.title)}">${dayBadge(e.starts_at, badgeCls)}<span class="info"><span class="t">${esc(e.title)}</span><span class="s">${esc(sub)}</span></span></label>`
    : `<button class="head" data-act="event" data-id="${e.id}">${dayBadge(e.starts_at, badgeCls)}<span class="info"><span class="t">${esc(e.title)}</span><span class="s">${esc(e.type)} · ${esc(sub)}</span></span>${statusPill(e)}</button>`}${o.answer && !o.select && needsAnswer(e) ? answerBlock(e) : ''}${!o.select ? cancelBtn(e) : ''}</div>`;
}

export function clubToggle(list) {
  if (!isBoard()) return '';
  const n = list.filter(hiddenByToggle).length;
  return `<label class="switch"><input type="checkbox" data-clubtog="1" ${S.me.show_all_club ? 'checked' : ''}><span><b>Tout le club</b><br><span class="det">${S.me.show_all_club ? 'Les rendez-vous de toutes les équipes sont affichés, passés compris.' : n ? plural(n, "rendez-vous d'autres équipes non affiché", "rendez-vous d'autres équipes non affichés") + ' (à venir et passés).' : 'Afficher aussi les équipes où tu n’as pas de rôle.'}</span></span></label>`;
}
export function agendaTab() {
  const f = S.agf || 'Tous', base = S.events; // n° 134 : le compteur de « Tout le club » compte aussi les passés (30 derniers jours)
  let list = visibleEvents();
  list = f === 'Masqués' ? list.filter(hiddenByMe) : list.filter((e) => !hiddenByMe(e)).filter((e) => f === 'Tous' || SUB_TYPES[f].includes(e.type));
  const fut = upcoming(list), old = past(list), selMode = !!S.sel, canSel = S.events.some(canManageEvent);
  let h = '';
  if (isBoard() || coachTeams().length) h += `<div class="btns"><button class="btn main" data-act="evnew">${icon('plus', 20)}Ajouter un rendez-vous</button>${canSel ? `<button class="btn ghost small" data-act="selmode" aria-pressed="${selMode}">${selMode ? 'Terminer' : 'Sélectionner'}</button>` : ''}</div>`;
  h += clubToggle(base) + `<div class="chips">${['Tous', 'Entraînements', 'Matchs', 'Événements', 'Masqués'].map((x) => `<button class="chip" data-act="agf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div>`;
  h += fut.length ? byDay(fut, (e) => evCard(e, { answer: true, select: selMode })) : '<p class="empty">Aucun rendez-vous à venir.</p>';
  const hidOld = isBoard() && !S.me.show_all_club ? past(S.events.filter(hiddenByToggle)).length : 0; // n° 134
  if (selMode && isBoard() && !S.me.show_all_club && S.events.some(hiddenByToggle)) h += `<p class="note">Les rendez-vous des équipes où tu n’as pas de rôle ne sont pas affichés : allume « Tout le club » pour les sélectionner aussi.</p>`;
  if (old.length || hidOld) h += `<details class="card" data-past="1"${selMode && (S.pastOpen || old.some((e) => S.sel.has(e.id))) ? ' open' : ''}><summary>Passés (${old.length}, 30 derniers jours)${hidOld ? ` · ${plural(hidOld, 'autre masqué', 'autres masqués')} par « Tout le club »` : ''}</summary><div class="stack">${old.length ? byDay(old, (e) => evCard(e, { select: selMode })) : ''}${hidOld ? `<p class="note">${plural(hidOld, 'rendez-vous passé', 'rendez-vous passés')} d’équipes où tu n’as pas de rôle : allume « Tout le club » pour ${hidOld > 1 ? 'les' : 'le'} voir et ${hidOld > 1 ? 'les' : 'le'} supprimer.</p>` : ''}</div></details>`;
  if (selMode) { const n = S.sel.size; h += `<div class="selbar"><div><span>${plural(n, 'rendez-vous sélectionné', 'rendez-vous sélectionnés')}</span><button class="btn small ${isArmed('sel') ? 'danger armed' : 'ghost'}" data-act="seldel" ${n ? '' : 'disabled'} style="${isArmed('sel') ? '' : 'background:var(--pc-papier)'}">${isArmed('sel') ? 'Confirmer la suppression' : 'Supprimer'}</button></div></div>`; }
  return h;
}

// ---------- formulaire ----------
// N° 89 · « Tout le club » : supporteurs compris par défaut pour un match, un plateau ou un tournoi ; membres seulement sinon (AG, fête…)
const supDefault = (t) => ['Match', 'Plateau', 'Tournoi'].includes(t);
function audienceField(f) {
  const myTeams = S.teams.filter((t) => isBoard() || coachOf(t.id));
  const opts = isBoard() ? [['club', 'Tout le club'], ['team', 'Une ou plusieurs équipes'], ['board', 'Bureau'], ['board_coaches', 'Bureau et coachs'], ['coaches', 'Tous les coachs'], ['people', 'Personnes choisies']] : [['team', myTeams.length > 1 ? 'Une ou plusieurs de mes équipes' : 'Mon équipe']];
  let h = `<div class="field"><span class="lab">Pour</span><div class="chips">${opts.map(([v, l]) => `<button type="button" class="chip" data-act="evaud" data-v="${v}" aria-pressed="${f.aud === v}">${INTERNAL[v] || v === 'people' ? icon('lock', 14) + ' ' : ''}${l}</button>`).join('')}</div></div>`;
  if (f.aud === 'club') h += `<div class="field"><span class="lab">Supporteurs</span><div class="chips"><button type="button" class="chip" data-act="evsup" data-v="0" aria-pressed="${!f.sup}">${icon('lock', 14)} Membres du club seulement</button><button type="button" class="chip" data-act="evsup" data-v="1" aria-pressed="${!!f.sup}">Tout le club, supporteurs compris</button></div><p class="note">${f.sup ? 'Les supporteurs le voient dans l’Agenda et en sont prévenus.' : 'Les supporteurs ne le voient pas et ne sont pas prévenus.'}</p></div>`; // n° 89
  if (f.aud === 'team') h += `<div class="field"><span class="lab">Équipes (${f.teams.size})</span><div class="chips">${myTeams.map((t) => `<button type="button" class="chip" data-act="evteam" data-id="${t.id}" aria-pressed="${f.teams.has(t.id)}">${esc(t.name)}</button>`).join('') || '<p class="empty">Aucune équipe.</p>'}</div></div>`;
  if (f.aud === 'people') {
    const ppl = [...new Map(S.members.filter((m) => m.status === 'active').map((m) => [m.user_id, m])).keys()].filter((u) => u !== S.me.id).sort((a, b) => name(a).localeCompare(name(b), 'fr'));
    const q = norm(f.pq), shown = ppl.filter((u) => !q || norm(name(u)).includes(q));
    h += `<div class="field"><label for="epq">Personnes choisies (${f.people.size})</label><input id="epq" type="search" data-evpq="1" value="${esc(f.pq || '')}" placeholder="Rechercher un nom"></div><div class="card flat" style="max-height:320px;overflow:auto;gap:0">${shown.map((u) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-evpeople="${u}" ${f.people.has(u) ? 'checked' : ''}><span>${esc(name(u))}</span></label>`).join('') || '<p class="empty">Personne.</p>'}</div><p class="note">Seules ces personnes voient le rendez-vous (et le bureau).</p>`;
  }
  return h;
}
// Convocation de joueurs choisis : match, plateau ou tournoi d'une seule équipe
function convField(f) {
  if (!['Match', 'Plateau', 'Tournoi'].includes(f.type) || f.aud !== 'team' || f.teams.size !== 1) return '';
  if (!isPresident() && ![...f.teams].every(coachOf)) return '<p class="note">La convocation des joueurs est faite par le coach de l’équipe.</p>';
  const tid = [...f.teams][0], ps = playersOfTeam(tid).sort((a, b) => pname(a).localeCompare(pname(b), 'fr'));
  let h = `<div class="field"><span class="lab">Convoquer</span><div class="chips"><button type="button" class="chip" data-act="evconvm" data-v="all" aria-pressed="${f.convMode !== 'some'}">Toute l'équipe</button><button type="button" class="chip" data-act="evconvm" data-v="some" aria-pressed="${f.convMode === 'some'}">Joueurs choisis${f.convMode === 'some' ? ' (' + f.conv.size + ')' : ''}</button></div></div>`;
  if (f.convMode === 'some') h += `<div class="card flat" style="max-height:320px;overflow:auto;gap:0">${ps.map((p) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-evconv="${p.id}" ${f.conv.has(p.id) ? 'checked' : ''}><span>${esc(pname(p))}</span></label>`).join('') || '<p class="empty">Aucune fiche joueur.</p>'}</div><p class="note">Seuls les joueurs choisis (et leurs parents) répondent ; les autres voient le rendez-vous sans être convoqués.</p>`;
  return h;
}
function repeatFields(f) {
  if (f.type !== 'Entraînement' || f.id) return '';
  return `<label class="check"><input type="checkbox" name="repeat" data-evrep="1" ${f.repeat ? 'checked' : ''}><span>Répéter chaque semaine (même jour, même heure)</span></label>
  ${f.repeat ? `${field('eu', "Répéter jusqu'au (obligatoire)", `<input id="eu" name="until" type="date" required value="${esc(f.until || '')}">`)}<label class="check"><input type="checkbox" name="skiphol" ${f.skiphol === false ? '' : 'checked'}><span>Hors vacances scolaires (zone C : Créteil, Paris, Versailles)</span></label>` : ''}`;
}
// N° 80 : durée par quarts d'heure (15 min à 6 h) ou toute la journée ; l'heure de fin est calculée tout de suite
export function usualDur(type, teams) {
  const last = S.events.filter((x) => x.type === type && x.duration_min && (!teams?.size || evTeams(x).some((t) => teams.has(t)))).sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
  return last ? last.duration_min : DEF_DUR[type] || 120;
}
function durField(f) {
  const cur = f.dur || String(usualDur(f.type, f.teams)), opts = [];
  for (let m = 15; m <= 360; m += 15) opts.push(`<option value="${m}" ${String(m) === cur ? 'selected' : ''}>${fmtDur(m)}</option>`);
  opts.push(`<option value="jour" ${cur === 'jour' ? 'selected' : ''}>Toute la journée</option>`);
  let end = '';
  if (f.starts_at) { const st = new Date(f.starts_at); if (!isNaN(st)) end = cur === 'jour' ? `${st.toLocaleDateString('fr-FR', { weekday: 'long' })} · toute la journée` : `${st.toLocaleDateString('fr-FR', { weekday: 'long' })} ${hm(st)} → ${hm(new Date(st.getTime() + +cur * 60000))}`; }
  return field('edu', 'Durée', `<select id="edu" name="dur" data-evdur="1">${opts.join('')}</select>`) + (end ? `<p class="note" id="evend" style="margin-top:-6px">${esc(end)}</p>` : '');
}
// N° 111 · titre écrit tout seul à partir du type, de l'adversaire (ou de la catégorie) et de la date ; il reste modifiable.
// Entraînement : catégorie et genre de l'équipe (jamais son nom interne), jour et heure, « chaque mercredi » si la séance se répète.
const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export function autoTitle(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(f.starts_at || ''), opp = String(f.opponents || '').trim().replace(/\s*,\s*/g, ', ');
  const date = m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : '', hour = m ? `${+m[4]}h${m[5]}` : '';
  const dash = (a, ...b) => [a, ...b.filter(Boolean)].join(' - ');
  if (f.type === 'Entraînement') {
    const cats = f.aud === 'team' ? catsLabel([...(f.teams || [])]) : '';
    const when = !m ? '' : f.repeat && !f.id ? `chaque ${WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]} ${hour}` : `${date} ${hour}`;
    return dash(['Entraînement', cats].filter(Boolean).join(' '), when).slice(0, 120);
  }
  if (['Match', 'Plateau', 'Tournoi'].includes(f.type)) return dash(opp ? `${f.type} vs ${opp}` : f.type, opp ? '' : String(f.place || '').trim(), date).slice(0, 120);
  return dash(f.type || 'Événement', String(f.place || '').trim(), date).slice(0, 120);
}
const isAuto = (f) => f.titleAuto !== false;
function titleField(f) {
  const val = isAuto(f) ? autoTitle(f) : f.title || '';
  return `<div class="field evtitle"><label for="et">Titre</label><input id="et" name="title" required maxlength="120" data-evtitle="1" value="${esc(val)}" placeholder="Rempli tout seul avec l'adversaire et la date">
  <p class="note" id="etnote">${isAuto(f) ? 'Écrit tout seul. Tu peux le modifier.' : `Modifié à la main. <button type="button" class="linkbtn" data-act="evtauto">Revenir au titre automatique</button>`}</p></div>`;
}
export function eventForm() {
  const f = S.form, matchy = ['Match', 'Plateau', 'Tournoi'].includes(f.type);
  // N° 108 : la case « Match à domicile » se voit dès qu'on choisit un match, un plateau ou un tournoi, quel que soit son rôle
  return `<form id="evf" class="card lift">
  <div class="field"><span class="lab">Type</span><div class="chips">${types().map((t) => `<button type="button" class="chip" data-act="evtype" data-v="${t}" aria-pressed="${f.type === t}">${t}</button>`).join('')}</div></div>
  ${audienceField(f)}
  ${matchy ? field('eo', f.type === 'Match' ? 'Adversaire' : 'Adversaires (séparés par des virgules)', `<input id="eo" name="opponents" data-evauto="1" value="${esc(f.opponents || '')}" placeholder="${f.type === 'Match' ? 'Ex. Palaiseau' : 'Ex. Palaiseau, Massy'}">`) : ''}
  ${matchy ? `<label class="check homebox"><input type="checkbox" name="at_home" data-evhome="1" ${f.at_home === false ? '' : 'checked'}><span><b>Match à domicile</b> (nous recevons)</span></label>` : ''}
  ${field('ed', 'Date et heure', `<input id="ed" name="starts_at" type="datetime-local" required value="${esc(f.starts_at || '')}" data-evdur="1">`)}
  ${durField(f)}
  ${repeatFields(f)}
  ${titleField(f)}
  ${field('el', 'Lieu', `<input id="el" name="place" data-evauto="1" value="${esc(f.place || '')}" placeholder="Ex. Gymnase de Boissy">`)}
  ${convField(f)}
  ${!f.id && matchy && f.at_home !== false && f.aud === 'team' && hasArea('evenements') ? `<label class="check"><input type="checkbox" name="mkconv" ${f.mkconv ? 'checked' : ''}><span>Préparer la convocation des clubs reçus après l'enregistrement</span></label>` : ''}
  ${!f.id && matchy && f.at_home !== false && f.aud === 'team' && !hasArea('evenements') ? '<p class="note">Le contact rencontres du club sera prévenu pour préparer la convocation des clubs reçus.</p>' : ''}
  <button class="btn main" type="submit">${f.id ? 'Enregistrer les changements' : 'Enregistrer'}</button></form>`;
}
function keepForm() {
  const fm = document.getElementById('evf'); if (!fm) return; const v = Object.fromEntries(new FormData(fm)); Object.assign(S.form, v); S.form.repeat = !!v.repeat; S.form.skiphol = !!v.skiphol;
  if (fm.querySelector('[data-evhome]')) S.form.at_home = !!v.at_home;
  S.form.mkconv = !!v.mkconv;
}

// ---------- page d'un rendez-vous ----------
export function eventPage(id) {
  const e = S.events.find((x) => x.id === id); if (!e) return '<p class="empty">Rendez-vous introuvable (supprimé ?).</p>';
  const R = respOf(id), list = (a) => (a.length ? a.map(respName).join(', ') : '—'), man = canManageEvent(e);
  let h = `<div class="card lift">${e.cancelled ? '<span class="pill ko">Rendez-vous annulé</span>' : ''}<div>${forLabel(e)}</div>${e.opponents ? `<div class="det">Contre : ${esc(e.opponents)}</div>` : ''}${man ? `<div class="det">${plural(invitedCount(e), 'personne prévenue', 'personnes prévenues')}${isTeamType(e) ? ' · ' + plural(playersOf(e).length, 'joueur concerné', 'joueurs concernés') : ''}</div>` : ''}
  ${e.cancelled ? '' : `<b style="font-family:var(--pc-titre);font-size:22px">${coachOnly(e) && !myKidsIn(evTeams(e)).length ? 'Ton équipe' : outsider(e) || noAnswerRole(e) ? 'Ce rendez-vous' : 'Tu viens ?'}</b>${answerBlock(e)}${!isOpen(e) && !coachOnly(e) && !followOnly(e) && !outsider(e) && !noAnswerRole(e) ? `<p class="note">Tu peux répondre dès maintenant. Sinon, cette séance arrivera dans « À répondre » le ${esc(fmtDay(opensOn(e)))}.</p>` : ''}`}</div>`;
  const tot = R.oui.length + R.non.length, base = Math.max(tot, isTeamType(e) ? playersOf(e).length : invitedCount(e));
  h += `<div class="card"><div class="sec"><h2>Qui vient ?</h2><span class="det">${plural(R.all.length, 'réponse')}</span></div>${base ? `<div class="bar"><span style="width:${(100 * R.oui.length) / base}%"></span><span style="width:${(100 * R.non.length) / base}%"></span></div>` : ''}
  <div class="chips"><span class="pill ok">${R.oui.length} oui</span><span class="pill ko">${R.non.length} non</span>${base > tot && isOpen(e) ? `<span class="pill">${base - tot} sans réponse</span>` : ''}</div>${!isTeamType(e) && (R.oui.some((x) => x.player_id) || guestsOf(e)) ? `<div class="det">${plural(R.oui.length + guestsOf(e), 'participant')} · ${plural(R.oui.filter((x) => !x.player_id).length, 'adulte')}, ${plural(R.oui.filter((x) => x.player_id).length, 'enfant')}${guestsOf(e) ? ', ' + plural(guestsOf(e), 'accompagnant') + ' sans compte' : ''}</div>` : ''}<div><b>Viennent :</b> ${list(R.oui)}</div><div><b>Ne viennent pas :</b> ${list(R.non)}</div></div>`;
  h += `<div class="btns"><button class="btn" data-act="ics" data-id="${id}">${icon('calplus', 20)}Ajouter à mon agenda</button>${e.place ? `<a class="btn small" style="flex:none;width:52px;padding:0" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.place)}" target="_blank" rel="noopener" aria-label="Itinéraire">${icon('pin', 22)}</a>` : ''}</div>`;
  // n° 165 (Gaël, 9 novembre 2026) : répondre « non » ne masque rien ; une case à part masque le rendez-vous, quelle que soit la réponse.
  // Masqué avec « oui » : la personne est quand même prévenue d'une annulation ou d'un changement de date ou d'heure (vérifié par la base).
  if (!coachOnly(e)) h += `<div class="card flat"><label class="check"><input type="checkbox" data-hideev="${id}" ${hiddenByMe(e) ? 'checked' : ''}><span><b>Masquer ce rendez-vous de mon agenda</b><br><span class="det">${R.mine === 'oui' || myKidsIn(evTeams(e)).some((p) => R.kid(p.id) === 'oui') ? 'Tu as répondu « oui » : tu seras quand même prévenu s’il est annulé ou si sa date ou son heure change.' : 'Tu ne recevras plus de notification pour ce rendez-vous. Filtre « Masqués » de l’Agenda pour le retrouver.'}</span></span></label></div>`;
  if (man && !e.cancelled && new Date(e.starts_at) > Date.now()) {
    const recent = e.reminded_at && Date.now() - new Date(e.reminded_at) < 12 * 3600e3;
    h += `<div class="card flat"><div class="kick">Relance</div>${(e.convoked || []).length ? `<span class="pill blue">${plural(e.convoked.length, 'joueur convoqué', 'joueurs convoqués')}</span>` : ''}<button class="btn small ${recent ? 'ghost' : 'main'}" data-act="evremind" data-id="${id}" ${recent ? 'disabled' : ''}>${recent ? 'Relance faite à ' + hm(new Date(e.reminded_at)) : 'Relancer les sans-réponse'}</button><p class="note">Un rappel s'affiche en haut de l'Accueil des personnes qui n'ont pas répondu (une relance toutes les 12 heures).</p></div>`;
  }
  h += scoreBlock(e);
  h += (hooks.convocBlock || (() => ''))(e);
  h += missionsBlock(e);
  const plans = (S.evPlans || []).filter((p) => p.event_id === id);
  if (plans.length) h += `<div class="card pale"><div class="kick">Séance prévue</div>${plans.map((p) => `<button class="row" data-act="pview" data-id="${p.id}"><span class="g">${esc(p.title)}<small>${plural(p.items.length, 'exercice')} · ${p.items.reduce((a, x) => a + (+x.minutes || 0), 0)} min · imprimer ou PDF</small></span></button>`).join('')}</div>`;
  if (man) {
    if (isTeamType(e) && !e.cancelled && !coachOnly(e) && canCallRoll(e)) h += `<button class="btn main" data-act="appel" data-id="${id}">Faire l'appel</button>`;
    h += `<div class="btns"><button class="btn ghost" data-act="evedit" data-id="${id}">Modifier</button><button class="btn ghost" data-act="evcancel" data-id="${id}">${e.cancelled ? 'Rétablir' : 'Annuler le rendez-vous'}</button></div>`;
    if (e.series_id) {
      const k1 = 'ev1' + id, k2 = 'evs' + id;
      h += `<div class="card flat"><div class="kick">Ce rendez-vous fait partie d'une série</div>${delBtn('evdel', id, 'Supprimer cette séance', 'Confirmer : supprimer cette séance', isArmed(k1), 'data-m="one"')}${delBtn('evdel', id, 'Supprimer toutes les séances à venir', `Confirmer : ${S.delCount ?? '…'} séance${S.delCount > 1 ? 's' : ''} supprimée${S.delCount > 1 ? 's' : ''}`, isArmed(k2), 'data-m="series"')}<p class="note">Les séances passées restent, avec leur appel. Si aucune séance passée n'a d'appel, toute la série est supprimée.</p></div>`;
    } else h += delBtn('evdel', id, 'Supprimer ce rendez-vous', 'Confirmer la suppression', isArmed('ev1' + id), 'data-m="one"');
  }
  return h;
}

// ---------- appel en tuiles (n° 81 · claude/10-appel-en-tuiles.md) ----------
function announced(p, eid) {
  const own = S.resp.filter((x) => x.event_id === eid && x.player_id === p.id);
  const r = own.length ? own : S.resp.filter((x) => x.event_id === eid && !x.player_id && x.user_id === p.user_id);
  return r.some((x) => x.answer === 'oui') ? 'oui' : r.some((x) => x.answer === 'non') ? 'non' : '';
}
const ROLL_TYPES = ['Entraînement', 'Plateau', 'Match', 'Tournoi'];
// Catégorie d'âge affichée sur la tuile : U + (année de fin de saison − année de naissance)
function ageCat(p) {
  if (!p.birth_date) return '';
  const t = S.teams.find((x) => x.id === p.team_id), end = +(String(t?.season || SEASON).split('-')[1] || new Date().getFullYear());
  const n = end - +p.birth_date.slice(0, 4);
  return n > 0 && n < 21 ? 'U' + n : '';
}
// Six états, toujours couleur + icône : oui (jaune) · non (gris) · sans réponse (pointillé orange) · présent (bleu) · retard (bleu pâle) · absent (fin)
function tileState(p, eid, ended) {
  const s = S.ap.st[p.id];
  if (s === 'present') return 'pres';
  if (s === 'retard') return 'late';
  if (S.ap.done && ended) return 'abs';
  const a = announced(p, eid);
  return a === 'oui' ? 'yes' : a === 'non' ? 'no' : 'wait';
}
const TILE_ICON = { yes: '✓', no: '✕', wait: '?', pres: '✓', late: '', abs: '✕' };
const TILE_LABEL = { yes: 'a répondu présent', no: 'a répondu absent', wait: 'sans réponse', pres: 'présent', late: 'arrivé en retard', abs: 'absent' };
const CLOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function rollEvents(e) {
  const t = evTeams(e)[0];
  return S.events.filter((x) => !x.cancelled && evTeams(x).includes(t) && ROLL_TYPES.includes(x.type) && canCallRoll(x)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
function initAp(eid) {
  const rows = S.att.filter((x) => x.event_id === eid);
  S.ap = { eid, st: {}, arr: {}, done: rows.length > 0, open: rows.length === 0, reopened: false, late: null, editTime: false };
  rows.forEach((x) => { if (x.status !== 'absent') S.ap.st[x.player_id] = x.status; if (x.arrived_at) S.ap.arr[x.player_id] = x.arrived_at; });
}
export function teamStrip(e, cur) { return teamBand(evTeams(e)[0], cur, teamsLabel(evTeams(e))); }
// N° 113 : bandeau de l'espace de l'équipe, toujours visible ; « Programme » disparaît (il ouvrait seulement la page du rendez-vous)
export function teamBand(tid, cur, fallback = '') {
  const t = S.teams.find((x) => x.id === tid), c = club();
  const logo = c?.logo ? crest(c, 40, '#FFFFFF') : ball(44, c?.sport);
  return `<div class="tstrip"><div class="tsid">${logo}<span><b>${esc(t?.name || fallback)}</b><small>${esc(c?.name || '')} · saison ${esc(t?.season || SEASON)}</small></span></div>
  ${teamTabs(tid, cur)}</div>`;
}
// N° 116 : les cinq onglets de l'équipe, placés au bas du bloc bleu de l'en-tête dans l'espace de l'équipe
const TEAM_TABS = [['Pointer', 'pointer'], ['Planifier', 'planifier'], ['Préparer', 'preparer'], ['Stats', 'stats'], ['Effectif', 'effectif']];
export function teamTabs(tid, cur) {
  return `<nav class="ttabs" aria-label="Équipe">${TEAM_TABS.map(([l, k]) => `<button data-act="tsgo" data-id="${esc(tid || '')}" data-tab="${k}" ${l === cur ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>`;
}
// strip : bandeau de l'équipe dans la page ; jamais dans l'espace de l'équipe, où les onglets sont dans l'en-tête (n° 116)
export function appelPage(eid, strip) {
  const e = S.events.find((x) => x.id === eid); if (!e) return '<p class="empty">Rendez-vous introuvable.</p>';
  if (strip === undefined) strip = !(S.tsp && evTeams(e).includes(S.tsp));
  const ps = playersOf(e).sort((a, b) => pname(a).localeCompare(pname(b), 'fr'));
  if (!S.ap || S.ap.eid !== eid) initAp(eid);
  const A = S.ap, ended = Date.now() > endOf(e).getTime(), N = ps.length;
  const states = ps.map((p) => [p, tileState(p, eid, ended)]);
  const nPres = states.filter(([, s]) => s === 'pres' || s === 'late').length, nLate = states.filter(([, s]) => s === 'late').length;
  const ann = { oui: 0, non: 0, '': 0 }; ps.forEach((p) => ann[announced(p, eid)]++);
  // Navigation : séance précédente / suivante de l'équipe, type de rendez-vous
  const list = rollEvents(e), i = list.findIndex((x) => x.id === eid), prev = list[i - 1], next = list[i + 1];
  let h = strip ? teamStrip(e, 'Pointer') : '';
  h += `<div class="rollnav"><button class="roundbtn" data-act="appgo" data-id="${prev?.id || ''}" ${prev ? '' : 'disabled'} aria-label="Séance précédente">${icon('back', 20, '#11162E', 2.4)}</button><span><b>${esc(new Date(e.starts_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</b><small>${esc(timeRange(e))}${e.place ? ' · ' + esc(e.place) : ''}</small></span><button class="roundbtn" data-act="appgo" data-id="${next?.id || ''}" ${next ? '' : 'disabled'} aria-label="Séance suivante" style="transform:scaleX(-1)">${icon('back', 20, '#11162E', 2.4)}</button></div>`;
  h += `<div class="seg" role="group" aria-label="Type">${ROLL_TYPES.map((t) => { const near = list.filter((x) => x.type === t).sort((a, b) => Math.abs(new Date(a.starts_at) - new Date(e.starts_at)) - Math.abs(new Date(b.starts_at) - new Date(e.starts_at)))[0]; return `<button data-act="appgo" data-id="${near?.id || ''}" aria-pressed="${e.type === t}" ${near || e.type === t ? '' : 'disabled'}>${t}</button>`; }).join('')}</div>`;
  if (!N) return h + '<div class="card"><p class="empty">Aucune fiche joueur dans cette équipe.</p></div>';
  // Après « Terminer l'appel » : bandeau réduit
  if (A.done && !A.open) {
    const abs = states.filter(([p, s]) => !['pres', 'late'].includes(s) && announced(p, eid)).length, wait = states.filter(([p, s]) => !['pres', 'late'].includes(s) && !announced(p, eid)).length;
    h += `<button class="rollband" data-act="appopen" aria-label="Rouvrir l'appel"><span class="rb1"><b>${nPres} présent${nPres > 1 ? 's' : ''}</b> · ${abs} absent${abs > 1 ? 's' : ''} · ${wait} sans réponse${nLate ? ` · dont ${nLate} en retard` : ''}</span><span class="minibar">${states.map(([, s]) => `<i class="t-${s}"></i>`).join('')}</span><span class="det">Toucher pour rouvrir l'appel (retards)</span></button>`;
    return h + deroule(e);
  }
  h += `<div class="card rollcount"><span class="big">${nPres}<small> / ${N}</small></span><span class="rclab">présent${nPres > 1 ? 's' : ''}${nLate ? `, dont ${nLate} en retard` : ''}</span><span class="det">${ann.oui} annoncé${ann.oui > 1 ? 's' : ''} · ${ann.non} excusé${ann.non > 1 ? 's' : ''} · ${ann['']} sans réponse</span></div>`;
  if (!A.done) h += `<button class="btn main" data-act="appall">${icon('check', 20, 'currentColor', 3)}Les annoncés présents sont là</button><div class="btns"><button class="btn ghost small" data-act="appnone">Tout décocher</button><button class="btn ghost small" data-act="appevery">Tout le monde présent</button></div>`;
  else h += `<p class="note">Appel rouvert : touche un joueur arrivé après l'appel pour le noter en retard (heure du toucher). Un second toucher annule.</p>`;
  h += `<div class="tiles9" role="group" aria-label="Joueurs">${states.map(([p, s]) => {
    const cat = ageCat(p), arr = s === 'late' && A.arr[p.id] ? hm(new Date(A.arr[p.id])) : '';
    return `<button class="tile9 t-${s}" data-act="apptap" data-id="${p.id}" aria-pressed="${s === 'pres' || s === 'late'}" aria-label="${esc(pname(p))} · ${TILE_LABEL[s]}${arr ? ' à ' + arr : ''}"><span class="ti">${s === 'late' ? CLOCK : TILE_ICON[s]}</span>${cat ? `<span class="tc">${esc(cat)}</span>` : ''}<b>${esc(p.first_name)}</b><small>${esc(p.last_name || '')}</small>${arr ? `<span class="ta">Arrivé ${esc(arr)}</span>` : ''}</button>`;
  }).join('')}</div>`;
  if (A.late) {
    const p = pl(A.late), t = A.arr[A.late] ? new Date(A.arr[A.late]) : new Date();
    if (p) h += `<div class="card pale latemsg"><span><b>${esc(pname(p))}</b> en retard · arrivé à ${esc(hm(t))}</span>${A.editTime ? `<input type="time" id="lateat" value="${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}" aria-label="Heure d'arrivée"><button class="btn small main" data-act="applateok">Valider l'heure</button>` : '<button class="btn small ghost" data-act="applateedit">Changer l\'heure</button>'}</div>`;
  }
  if (A.done) h += `<div class="btns"><button class="btn ghost" data-act="appfold">Réduire</button><button class="btn ghost" data-act="appclose" data-id="${eid}">Fermer l'appel</button></div>`;
  else h += `<div class="rollfoot"><button class="btn main" data-act="appsave">Terminer l'appel · ${nPres} / ${N}</button></div><p class="note">À « Terminer l'appel », les joueurs non pointés passent en absent. Une séance sans appel ne compte pas dans les statistiques.</p>`;
  return h + (A.done ? deroule(e) : '');
}
// Déroulé de la séance, sous l'appel terminé (entraînement seulement)
function deroule(e) {
  if (e.type !== 'Entraînement') return '';
  const p = plansForEvent(e.id)[0], items = p?.items || [], tot = items.reduce((a, x) => a + (+x.minutes || 0), 0), dur = durOf(e);
  let h = `<div class="sec"><h2>Déroulé de la séance</h2><span class="det">${fmtMin(tot)}${dur ? ' / ' + fmtMin(dur) : ''}</span></div>`;
  h += items.length ? `<div class="card"><div class="list">${items.map((x, i) => `<div class="row static deroule"><span class="dnum">${i + 1}</span><span class="g">${esc(x.title)}<small>${esc([x.category, (x.description || '').split(/[.\n]/)[0]].filter(Boolean).join(' · ').slice(0, 90))}</small></span>${x.diagram?.length ? `<span class="dmini">${courtSvg(x.sport === 'Tous les sports' ? club()?.sport : x.sport || club()?.sport, x.diagram)}</span>` : ''}<span class="pill blue">${fmtMin(x.minutes)}</span></div>`).join('')}</div></div>` : '<div class="card"><p class="empty">Aucun exercice prévu pour cette séance.</p></div>';
  return h + `<button class="bigadd" data-act="appex" data-id="${e.id}">${icon('plus', 24, '#11162E', 2.6)}Ajouter un exercice</button>`;
}

// ---------- agenda du téléphone ----------
function icsFor(e) {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), end = endOf(e);
  const clean = (s) => String(s || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, ' ');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mypocketclub//FR', 'BEGIN:VEVENT', 'UID:' + e.id + '@mypocketclub.fr', 'DTSTAMP:' + f(Date.now()), 'DTSTART:' + f(e.starts_at), 'DTEND:' + f(end), 'SUMMARY:' + clean(e.title + ' · ' + (club()?.name || '')), 'LOCATION:' + clean(e.place), 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

// ---------- actions ----------
const today = () => { const t = new Date(Date.now() + 864e5); t.setMinutes(0, 0, 0); return toLocalInput(t); };
Object.assign(ACTIONS, {
  agf: (el, d) => { S.agf = d.v; render(true); },
  event: (el, d) => { S.view = { type: 'event', id: d.id }; render(); },
  evnew: (el, d) => {
    const coachT = coachTeams(), team = d.team || (!isBoard() && coachT.length === 1 ? coachT[0] : '');
    S.form = { type: d.type || 'Entraînement', starts_at: today(), aud: team || !isBoard() ? 'team' : 'club', sup: supDefault(d.type || 'Entraînement'), teams: new Set(team ? [team] : []), people: new Set(), pq: '', conv: new Set(), convMode: 'all' };
    S.view = { type: 'evform' }; render();
  },
  // n° 84 : créer notre rendez-vous (match à l'extérieur) depuis une convocation reçue
  cvmake: async (el, d) => {
    const m = (S.cvev?.list || []).find((x) => x.source_event_id === d.src); if (!m) return;
    const from = (S.creceived || []).find((x) => x.id === d.send);
    const cat = (m.team || '').trim().toLowerCase();
    const mine = S.teams.filter((t) => cat && (String(t.category || '').toLowerCase() === cat || String(t.name || '').toLowerCase() === cat));
    const team = mine.length === 1 ? mine[0].id : '';
    S.form = { type: 'Match', title: '', titleAuto: true, opponents: from?.from_club || '', place: m.place || '', at_home: false, starts_at: toLocalInput(new Date(m.starts_at)), aud: 'team', sup: supDefault('Match'), teams: new Set(team ? [team] : []), people: new Set(), pq: '', conv: new Set(), convMode: 'all', fromConvoc: { send: d.send, src: d.src } };
    S.view = { type: 'evform' }; render();
  },
  evedit: (el, d) => {
    const e = S.events.find((x) => x.id === d.id);
    S.form = { id: e.id, type: e.type, title: e.title, opponents: e.opponents, place: e.place, starts_at: toLocalInput(new Date(e.starts_at)), aud: e.audience, sup: e.with_supporters !== false, supSet: true, teams: new Set(evTeams(e)), people: new Set(e.people || []), pq: '', conv: new Set(e.convoked || []), convMode: (e.convoked || []).length ? 'some' : 'all', at_home: e.at_home !== false, dur: e.all_day ? 'jour' : String(durOf(e)), titleAuto: false };
    S.view = { type: 'evform' }; render();
  },
  evtype: (el, d) => { keepForm(); S.form.type = d.v; if (!S.form.supSet && !S.form.id) S.form.sup = supDefault(d.v); S.form.dur = String(usualDur(d.v, S.form.teams)); render(true); },
  evaud: (el, d) => { keepForm(); S.form.aud = d.v; render(true); },
  evtauto: () => { keepForm(); S.form.titleAuto = true; render(true); },
  evsup: (el, d) => { keepForm(); S.form.sup = d.v === '1'; S.form.supSet = true; render(true); },
  evteam: (el, d) => { keepForm(); S.form.teams[S.form.teams.has(d.id) ? 'delete' : 'add'](d.id); S.form.conv = new Set(); render(true); },
  evconvm: (el, d) => { keepForm(); S.form.convMode = d.v; render(true); },
  evremind: async (el, d) => { const n = await run(sb.rpc('remind_event', { p_event: d.id })); if (n !== null) { toast(n ? plural(n, 'personne relancée', 'personnes relancées') + ' : un rappel apparaît en haut de leur Accueil.' : 'Tout le monde a déjà répondu.'); await refresh(); } },
  rsvp: async (el, d) => {
    const R = respOf(d.id), pid = d.p || null, cur = pid ? R.kid(pid) : R.mine;
    if (await run(sb.rpc('respond_event', { p_event: d.id, p_player: pid, p_answer: cur === d.v ? null : d.v }))) {
      const rr = await sb.from('event_responses').select('*').eq('event_id', d.id); S.resp = S.resp.filter((x) => x.event_id !== d.id).concat(rr.data || []);
    }
    render(true);
  },
  guests: async (el, d) => { // n° 79
    const n = Math.max(0, Math.min(20, +d.v || 0));
    if (await run(sb.rpc('set_event_guests', { p_event: d.id, p_n: n }))) { const r = myRow({ id: d.id }); if (r) r.guests = n; }
    render(true);
  },
  evcancelq: async (el, d) => { // agenda et onglet Préparer : première touche = demande de confirmation
    const e = S.events.find((x) => x.id === d.id); if (!e || !armed('evc' + d.id)) return;
    if (await run(sb.from('events').update({ cancelled: true }).eq('id', e.id), 'Rendez-vous annulé.')) await refresh();
  },
  evcancel: async (el, d) => { const e = S.events.find((x) => x.id === d.id); if (await run(sb.from('events').update({ cancelled: !e.cancelled }).eq('id', e.id), e.cancelled ? 'Rendez-vous rétabli.' : 'Rendez-vous annulé.')) await refresh(); },
  evdel: async (el, d) => {
    const mode = d.m || 'one', key = (mode === 'one' ? 'ev1' : 'evs') + d.id;
    if (!isArmed(key) && mode === 'series') { const n = await run(sb.rpc('delete_events', { p_event: d.id, p_mode: 'series', p_dry: true })); if (n === null) return; S.delCount = n; }
    if (!armed(key)) return;
    const n = await run(sb.rpc('delete_events', { p_event: d.id, p_mode: mode, p_dry: false }));
    if (n !== null) { toast(mode === 'one' ? 'Rendez-vous supprimé.' : plural(n, 'séance supprimée', 'séances supprimées') + '.'); S.view = null; S.tab = 1; await refresh(); }
  },
  selmode: () => { S.sel = S.sel ? null : new Set(); S.del = null; S.pastOpen = false; render(true); }, // n° 130 : la barre des passés se referme seulement en sortant de la sélection
  seldel: async () => {
    if (!S.sel?.size || !armed('sel')) return;
    const n = await run(sb.rpc('delete_event_list', { p_ids: [...S.sel] }));
    if (n !== null) { toast(plural(n, 'rendez-vous supprimé', 'rendez-vous supprimés') + '.'); S.sel = null; await refresh(); }
  },
  hide: async (el, d) => { if (await run(sb.from('event_hidden').upsert({ event_id: d.id, user_id: S.me.id, hidden_at: new Date().toISOString() }), 'Masqué. Ta réponse reste enregistrée ; filtre « Masqués » pour le retrouver.')) { S.hidden = S.hidden.filter((h) => h.event_id !== d.id).concat({ event_id: d.id, hidden_at: new Date().toISOString() }); render(true); } },
  unhide: async (el, d) => { if (await run(sb.from('event_hidden').delete().eq('event_id', d.id).eq('user_id', S.me.id), 'Réaffiché.')) { S.hidden = S.hidden.filter((h) => h.event_id !== d.id); render(true); } },
  ics: (el, d) => { const e = S.events.find((x) => x.id === d.id); download(new Blob([icsFor(e)], { type: 'text/calendar' }), 'rendez-vous-' + e.starts_at.slice(0, 10) + '.ics'); toast("Ouvre le fichier pour l'ajouter à ton agenda."); },
  appel: (el, d) => { S.ap = null; const e = S.events.find((x) => x.id === d.id); if (e && !S.tsp) S.tsp = evTeams(e)[0] || null; S.view = { type: 'appel', id: d.id }; render(); },
  appgo: (el, d) => { if (!d.id || d.id === S.ap?.eid) return; S.ap = null; S.view = { type: 'appel', id: d.id }; render(); },
  apptap: async (el, d) => {
    const A = S.ap, e = S.events.find((x) => x.id === A.eid);
    if (!A.done) { A.st[d.id] = A.st[d.id] === 'present' ? '' : 'present'; return render(true); }
    // Appel rouvert : un non-présent passe en retard (heure du toucher) ; un second toucher annule ; enregistré tout de suite
    const was = A.st[d.id], now = new Date().toISOString();
    const row = was ? { status: 'absent', arrived_at: null } : { status: 'retard', arrived_at: now };
    if (await run(sb.from('attendance').upsert({ event_id: e.id, player_id: d.id, marked_by: S.me.id, marked_at: now, ...row }))) {
      if (was) { delete A.st[d.id]; delete A.arr[d.id]; A.late = null; } else { A.st[d.id] = 'retard'; A.arr[d.id] = now; A.late = d.id; A.editTime = false; }
      const r = S.att.find((x) => x.event_id === e.id && x.player_id === d.id); if (r) Object.assign(r, row); else S.att.push({ event_id: e.id, player_id: d.id, ...row });
      render(true);
    }
  },
  applateedit: () => { S.ap.editTime = true; render(true); },
  applateok: async () => {
    const A = S.ap, v = document.getElementById('lateat')?.value; if (!v || !A.late) return;
    const e = S.events.find((x) => x.id === A.eid), t = new Date(e.starts_at); t.setHours(+v.slice(0, 2), +v.slice(3, 5), 0, 0);
    if (await run(sb.from('attendance').update({ arrived_at: t.toISOString() }).eq('event_id', e.id).eq('player_id', A.late), 'Heure d’arrivée changée.')) { A.arr[A.late] = t.toISOString(); A.editTime = false; render(true); }
  },
  appall: () => { const e = S.events.find((x) => x.id === S.ap.eid); playersOf(e).forEach((p) => { if (announced(p, e.id) === 'oui') S.ap.st[p.id] = 'present'; }); render(true); },
  appnone: () => { S.ap.st = {}; render(true); },
  appevery: () => { const e = S.events.find((x) => x.id === S.ap.eid); playersOf(e).forEach((p) => (S.ap.st[p.id] = 'present')); render(true); },
  appopen: () => { S.ap.open = true; S.ap.reopened = true; render(true); },
  appfold: () => { S.ap.open = false; S.ap.late = null; render(true); },
  appclose: (el, d) => { S.ap = null; S.view = { type: 'event', id: d.id }; render(); },
  appex: (el, d) => { const e = S.events.find((x) => x.id === d.id); if (e) { openPlanForEvent(e); ACTIONS.cplan(); } },
  appsave: async () => {
    const A = S.ap, e = S.events.find((x) => x.id === A.eid), at = new Date().toISOString();
    const rows = playersOf(e).map((p) => ({ event_id: e.id, player_id: p.id, status: A.st[p.id] || 'absent', arrived_at: A.st[p.id] === 'retard' ? A.arr[p.id] || at : null, marked_by: S.me.id, marked_at: at }));
    if (rows.length && await run(sb.from('attendance').upsert(rows), 'Appel terminé.')) {
      rows.forEach((r) => { const x = S.att.find((y) => y.event_id === r.event_id && y.player_id === r.player_id); if (x) Object.assign(x, r); else S.att.push(r); });
      A.done = true; A.open = false; render(true); window.scrollTo(0, 0);
    }
  },
});
// N° 58 : garde-fou — le titre cite une heure (« exceptionnellement à 12h », « 18h30 ») différente de l'heure choisie dans le formulaire
export function titleHour(t) {
  const m = /(?:^|[^\d])([01]?\d|2[0-3])\s*(?:h|H|:)\s*([0-5]\d)?(?!\d)/.exec(t || '');
  return m ? { h: +m[1], mi: m[2] ? +m[2] : 0 } : null;
}
FORMS.evf = async (v) => {
  const f = S.form, aud = f.aud;
  if (aud === 'team' && !f.teams.size) return toast('Choisis au moins une équipe.');
  if (aud === 'people' && !f.people.size) return toast('Choisis au moins une personne.');
  const conv = ['Match', 'Plateau', 'Tournoi'].includes(f.type) && aud === 'team' && f.teams.size === 1 && f.convMode === 'some' ? [...f.conv] : [];
  if (f.convMode === 'some' && conv.length === 0 && ['Match', 'Plateau', 'Tournoi'].includes(f.type) && aud === 'team' && f.teams.size === 1) return toast('Choisis au moins un joueur à convoquer.');
  const base = { club_id: S.clubId, audience: aud, team_ids: aud === 'team' ? [...f.teams] : [], people: aud === 'people' ? [...f.people] : [], convoked: conv, type: f.type, title: v.title.trim(), place: (v.place || '').trim(), opponents: (v.opponents || '').trim(), at_home: ['Match', 'Plateau', 'Tournoi'].includes(f.type) ? !!v.at_home : true, with_supporters: aud === 'club' ? !!f.sup : true };
  const allDay = v.dur === 'jour'; base.all_day = allDay; base.duration_min = allDay ? null : +v.dur || DEF_DUR[f.type] || 120;
  const start = new Date(v.starts_at), th = titleHour(v.title);
  if (th && (th.h !== start.getHours() || th.mi !== start.getMinutes()) && !confirm(`Le titre parle de ${th.h} h ${String(th.mi).padStart(2, '0')}, mais l’heure choisie est ${hm(start)}. Enregistrer quand même ?`)) return;
  if (f.id) {
    const e0 = S.events.find((x) => x.id === f.id);
    if (await run(sb.from('events').update({ ...base, starts_at: start.toISOString() }).eq('id', f.id), 'Rendez-vous modifié.')) {
      // Une série garde la même durée : les séances à venir suivent
      if (e0?.series_id && (e0.duration_min !== base.duration_min || !!e0.all_day !== allDay)) await run(sb.from('events').update({ duration_min: base.duration_min, all_day: allDay }).eq('series_id', e0.series_id).gte('starts_at', new Date().toISOString()).neq('id', f.id), 'Durée appliquée aux séances à venir de la série.');
      S.view = { type: 'event', id: f.id }; S.form = null; await refresh();
    }
    return;
  }
  let starts = [start.toISOString()], series = null;
  if (f.type === 'Entraînement' && v.repeat) {
    if (!v.until) return toast("Indique jusqu'à quand répéter.");
    const until = new Date(v.until + 'T23:59'), skip = !!v.skiphol;
    if (until < start) return toast('La date de fin est avant la première séance.');
    starts = [];
    for (const d = new Date(start); d <= until && starts.length < 60; d.setDate(d.getDate() + 7)) { if (!(skip && inHolidays(localDay(d)))) starts.push(d.toISOString()); }
    if (!starts.length) return toast('Aucune séance dans cette période (vacances ?).');
    if (!confirm(`${plural(starts.length, 'séance sera créée', 'séances seront créées')}, du ${fmtDay(starts[0])} au ${fmtDay(starts[starts.length - 1])}${skip ? ' (vacances scolaires exclues)' : ''}. Confirmer ?`)) return;
    series = { weekday: start.getDay(), start_time: v.starts_at.slice(11, 16), until: v.until, skip_holidays: skip };
  }
  const fc = f.fromConvoc;
  const n = await run(sb.rpc('create_events', { p: { ...base, starts, series } }));
  if (n !== null) {
    toast(n > 1 ? plural(n, 'séance créée', 'séances créées') + ', une par semaine.' : 'Rendez-vous ajouté.'); S.view = null; S.form = null; S.tab = 1; await refresh();
    // n° 84 : on relie le rendez-vous créé au match du document reçu
    if (fc) { const e = S.events.filter((x) => x.created_by === S.me.id && x.title === base.title && Math.abs(new Date(x.starts_at) - start) < 6e4).pop(); if (e && await run(sb.rpc('link_convocation', { p_send: fc.send, p_source: fc.src, p_event: e.id }))) S.cvev = null; }
    // Convocation demandée à la création : on retrouve le rendez-vous qu'on vient de créer
    if (v.mkconv && base.at_home && ACTIONS.convoc) { const e = S.events.filter((x) => x.created_by === S.me.id && x.title === base.title && Math.abs(new Date(x.starts_at) - start) < 6e4).pop(); if (e) await ACTIONS.convoc(null, { id: e.id, v: 'P' }); }
  }
};
CHANGES.push(async (t) => { // n° 165 : case « Masquer ce rendez-vous »
  if (!t.dataset.hideev) return false;
  await ACTIONS[t.checked ? 'hide' : 'unhide'](t, { id: t.dataset.hideev }); return true;
});
CHANGES.push(async (t) => {
  if (t.dataset.clubtog) { const v = t.checked; if (await run(sb.from('profiles').update({ show_all_club: v }).eq('id', S.me.id))) S.me.show_all_club = v; render(true); return true; }
  if (t.dataset.evhome) { keepForm(); render(true); return true; }
  if (t.dataset.evdur) { keepForm(); render(true); return true; }
  if (t.dataset.evrep) { keepForm(); S.form.repeat = t.checked; if (!t.checked) S.form.until = ''; render(true); return true; }
  if (t.dataset.evconv) { keepForm(); S.form.conv[t.checked ? 'add' : 'delete'](t.dataset.evconv); render(true); return true; }
  if (t.dataset.evpeople) { keepForm(); S.form.people[t.checked ? 'add' : 'delete'](t.dataset.evpeople); render(true); return true; }
  if (t.dataset.evsel) { S.sel[t.checked ? 'add' : 'delete'](t.dataset.evsel); S.del = null; if (t.closest('details[data-past]')) S.pastOpen = true; render(true); return true; } // n° 130 : la barre des passés reste ouverte pendant la sélection
  return false;
});
INPUTS.push((t) => {
  if (t.dataset.evtitle && S.form) { S.form.title = t.value; const was = isAuto(S.form); S.form.titleAuto = !t.value.trim(); if (was !== isAuto(S.form)) { const n = document.getElementById('etnote'); if (n) n.innerHTML = isAuto(S.form) ? 'Écrit tout seul : il se remplira avec les autres champs.' : 'Modifié à la main. <button type="button" class="linkbtn" data-act="evtauto">Revenir au titre automatique</button>'; } return true; }
  if (t.dataset.evauto && S.form) { S.form[t.name] = t.value; if (isAuto(S.form)) { const n = document.getElementById('et'); if (n) n.value = autoTitle(S.form); } return true; }
  if (t.dataset.evpq) { keepForm(); S.form.pq = t.value; const pos = t.selectionStart; render(true); const n = document.getElementById('epq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } return true; }
  return false;
});
export { fmtDate };
