// Pocket Club · agenda : rendez-vous (une ou plusieurs équipes, personnes choisies), réponses, appel, séries, suppression.
import {
  S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, CHANGES, INPUTS, TEAM_TYPES, club, active, isBoard, coachOf, coachTeams,
  teamName, teamsLabel, evTeams, name, pl, pname, parentsOf, myKidsIn, iPlayIn, inTeam, playersOfTeam, fmtDate, hm, localDay, inHolidays,
  toLocalInput, fmtDay, plural, download, norm, follows,
} from './core.js';
import { icon, dayBadge, delBtn, field } from './ui.js';

const INTERNAL = { board: 'Bureau', board_coaches: 'Bureau et coachs', coaches: 'Tous les coachs' };
const SUB_TYPES = { Entraînements: ['Entraînement'], Matchs: ['Match', 'Plateau', 'Tournoi'], Événements: ['Événement', 'Réunion', 'AG'] };
export const types = () => (isBoard() ? ['Entraînement', 'Match', 'Plateau', 'Tournoi', 'Événement', 'Réunion', 'AG'] : ['Entraînement', 'Match', 'Plateau', 'Tournoi']);
export const canManageEvent = (e) => isBoard() || (e.audience === 'team' && evTeams(e).some(coachOf));

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
export function isOpen(e) {
  if (!e.series_id) return true;
  const t = new Date(e.starts_at).getTime();
  if (t <= Date.now() + OPEN_DAYS * 864e5) return true;
  const next = S.events.filter((x) => x.series_id === e.series_id && !x.cancelled && new Date(x.starts_at).getTime() >= Date.now() - 2 * 3600e3)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
  return !next || next.id === e.id;
}
export const opensOn = (e) => new Date(new Date(e.starts_at).getTime() - OPEN_DAYS * 864e5);
export function needsAnswer(e) {
  if (e.cancelled || new Date(e.starts_at) < Date.now() - 2 * 3600e3 || !isOpen(e)) return false;
  const R = respOf(e.id);
  if (!isTeamType(e)) return !R.mine;
  const k = myKidsIn(evTeams(e)), me = iPlayIn(evTeams(e));
  if (k.some((p) => !R.kid(p.id))) return true;
  if (me) return !R.mine;
  if (followOnly(e) || notInvited(e)) return false;
  return !coachOnly(e) && !k.length && !R.mine;
}
function pair(e, pid) {
  const R = respOf(e.id), m = pid ? R.kid(pid) : R.mine, p = pid && pl(pid);
  const yes = p ? `${esc(p.first_name)} vient` : 'Je viens', no = p ? `${esc(p.first_name)} ne vient pas` : 'Je ne viens pas';
  return `<div class="pair"><button class="btn yes" data-act="rsvp" data-id="${e.id}" data-p="${pid || ''}" data-v="oui" aria-pressed="${m === 'oui'}">${m === 'oui' ? icon('check', 20, 'currentColor', 3) : ''}${yes}</button><button class="btn no" data-act="rsvp" data-id="${e.id}" data-p="${pid || ''}" data-v="non" aria-pressed="${m === 'non'}">${no}</button></div>`;
}
export function invitedCount(e) {
  const act = S.members.filter((m) => m.status === 'active'), ids = new Set(), board = act.filter((m) => ['president', 'bureau'].includes(m.role)).map((m) => m.user_id);
  if (e.audience === 'club') act.forEach((m) => ids.add(m.user_id));
  else if (e.audience === 'board') board.forEach((u) => ids.add(u));
  else if (e.audience === 'coaches' || e.audience === 'board_coaches') { act.filter((m) => m.role === 'coach').forEach((m) => ids.add(m.user_id)); if (e.audience === 'board_coaches') board.forEach((u) => ids.add(u)); }
  else if (e.audience === 'people') (e.people || []).forEach((u) => ids.add(u));
  else evTeams(e).forEach((t) => { act.filter((m) => m.team_id === t).forEach((m) => ids.add(m.user_id)); playersOfTeam(t).forEach((p) => { if (p.user_id) ids.add(p.user_id); parentsOf(p.id).forEach((u) => ids.add(u)); }); });
  return ids.size;
}
// Nombre de joueurs concernés (match, plateau, tournoi, entraînement : on compte des joueurs)
const playersOf = (e) => { const m = new Map(); evTeams(e).forEach((t) => playersOfTeam(t).forEach((p) => m.set(p.id, p))); return [...m.values()]; };
export function answerBlock(e) {
  if (e.cancelled) return '';
  if (notInvited(e)) return '<p class="note">Tu as créé ce rendez-vous pour des personnes choisies : tu n’en fais pas partie.</p>';
  if (!isTeamType(e)) return pair(e, null);
  if (followOnly(e)) return '<p class="note">Tu suis cette équipe : pas de réponse à donner.</p>';
  const k = myKidsIn(evTeams(e)), me = iPlayIn(evTeams(e)), kids = k.map((p) => pair(e, p.id)).join('');
  if (coachOnly(e)) {
    const R = respOf(e.id), n = playersOf(e).length, oui = R.oui.filter((x) => x.player_id || !k.length).length, non = R.non.length;
    const rest = isOpen(e) ? `<span class="pill">${Math.max(0, n - oui - non)} sans réponse</span>` : `<span class="det">Réponses demandées à partir du ${esc(fmtDay(opensOn(e)))}</span>`;
    return `<div class="card pale"><div class="kick">Tu encadres</div><div class="chips"><span class="pill ok">${oui} oui</span><span class="pill ko">${non} non</span>${rest}</div><button class="btn main small" data-act="appel" data-id="${e.id}">Faire l'appel</button></div>` + kids;
  }
  return (me || !k.length ? pair(e, null) : '') + kids;
}
function respName(x) {
  if (!x.player_id) return esc(name(x.user_id));
  const p = pl(x.player_id), staff = isBoard() || coachTeams().length > 0;
  const nm = p ? (p.first_name + ' ' + (p.last_name ? p.last_name[0] + '.' : '')).trim() : 'Un joueur';
  return esc(nm) + (staff && p ? ` <span class="det">(répondu par ${esc(name(x.user_id))})</span>` : '');
}
export function forLabel(e) {
  const txt = e.audience === 'team' ? teamsLabel(evTeams(e)) || 'équipe' : e.audience === 'people' ? plural((e.people || []).length, 'personne choisie', 'personnes choisies') : INTERNAL[e.audience] || 'tout le club';
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
const hiddenByToggle = (e) => isBoard() && !S.me.show_all_club && e.audience === 'team' && !personal(e);
export const sortEvents = (l) => l.slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || teamsLabel(evTeams(a)).localeCompare(teamsLabel(evTeams(b))));
const soon = () => Date.now() - 2 * 3600e3;
export const upcoming = (l) => sortEvents(l.filter((e) => new Date(e.starts_at).getTime() >= soon()));
const past = (l) => sortEvents(l.filter((e) => new Date(e.starts_at).getTime() < soon())).reverse();
export const visibleEvents = () => S.events.filter((e) => !hiddenByToggle(e));
export const homeEvents = () => upcoming(visibleEvents().filter((e) => !hiddenByMe(e)));
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
function statusPill(e) {
  if (e.cancelled) return '<span class="pill ko">Annulé</span>';
  const R = respOf(e.id), k = isTeamType(e) ? myKidsIn(evTeams(e)) : [];
  if (needsAnswer(e)) return '<span class="pill wait">À répondre</span>';
  if (followOnly(e)) return '<span class="pill blue">Suivie</span>';
  if (coachOnly(e) && !k.length) return `<span class="pill blue">${R.oui.length} oui</span>`;
  const a = k.length ? R.kid(k[0].id) : R.mine;
  return a === 'oui' ? '<span class="pill ok">Oui</span>' : a === 'non' ? '<span class="pill ko">Non</span>' : '';
}
// Carte d'un rendez-vous ; opts : { answer: boutons si une réponse manque, select: mode sélection }
export function evCard(e, o = {}) {
  const sub = [hm(new Date(e.starts_at)), e.place, e.audience !== 'club' && e.audience !== 'team' ? '' : teamsLabel(evTeams(e))].filter(Boolean).join(' · ');
  const sel = o.select && canManageEvent(e), checked = S.sel?.has(e.id);
  const badgeCls = new Date(e.starts_at) < Date.now() ? 'past' : needsAnswer(e) ? 'wait' : '';
  return `<div class="ev ${e.cancelled ? 'cancel' : ''}">${sel
    ? `<label class="head" style="cursor:pointer"><input type="checkbox" class="sel" data-evsel="${e.id}" ${checked ? 'checked' : ''} aria-label="Sélectionner ${esc(e.title)}">${dayBadge(e.starts_at, badgeCls)}<span class="info"><span class="t">${esc(e.title)}</span><span class="s">${esc(sub)}</span></span></label>`
    : `<button class="head" data-act="event" data-id="${e.id}">${dayBadge(e.starts_at, badgeCls)}<span class="info"><span class="t">${esc(e.title)}</span><span class="s">${esc(e.type)} · ${esc(sub)}</span></span>${statusPill(e)}</button>`}${o.answer && !o.select && needsAnswer(e) ? answerBlock(e) : ''}</div>`;
}

export function clubToggle(list) {
  if (!isBoard()) return '';
  const n = list.filter(hiddenByToggle).length;
  return `<label class="switch"><input type="checkbox" data-clubtog="1" ${S.me.show_all_club ? 'checked' : ''}><span><b>Tout le club</b><br><span class="det">${S.me.show_all_club ? 'Les rendez-vous de toutes les équipes sont affichés.' : n ? plural(n, "rendez-vous d'autres équipes non affiché", "rendez-vous d'autres équipes non affichés") + '.' : 'Afficher aussi les équipes où tu n’as pas de rôle.'}</span></span></label>`;
}
export function agendaTab() {
  const f = S.agf || 'Tous', base = upcoming(S.events);
  let list = visibleEvents();
  list = f === 'Masqués' ? list.filter(hiddenByMe) : list.filter((e) => !hiddenByMe(e)).filter((e) => f === 'Tous' || SUB_TYPES[f].includes(e.type));
  const fut = upcoming(list), old = past(list), selMode = !!S.sel, canSel = S.events.some(canManageEvent);
  let h = '';
  if (isBoard() || coachTeams().length) h += `<div class="btns"><button class="btn main" data-act="evnew">${icon('plus', 20)}Ajouter un rendez-vous</button>${canSel ? `<button class="btn ghost small" data-act="selmode" aria-pressed="${selMode}">${selMode ? 'Terminer' : 'Sélectionner'}</button>` : ''}</div>`;
  h += clubToggle(base) + `<div class="chips">${['Tous', 'Entraînements', 'Matchs', 'Événements', 'Masqués'].map((x) => `<button class="chip" data-act="agf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div>`;
  h += fut.length ? byDay(fut, (e) => evCard(e, { answer: true, select: selMode })) : '<p class="empty">Aucun rendez-vous à venir.</p>';
  if (old.length) h += `<details class="card"><summary>Passés (${old.length}, 30 derniers jours)</summary><div class="stack">${byDay(old, (e) => evCard(e, { select: selMode }))}</div></details>`;
  if (selMode) { const n = S.sel.size; h += `<div class="selbar"><div><span>${plural(n, 'rendez-vous sélectionné', 'rendez-vous sélectionnés')}</span><button class="btn small ${isArmed('sel') ? 'danger armed' : 'ghost'}" data-act="seldel" ${n ? '' : 'disabled'} style="${isArmed('sel') ? '' : 'background:#FFFFFF'}">${isArmed('sel') ? 'Confirmer la suppression' : 'Supprimer'}</button></div></div>`; }
  return h;
}

// ---------- formulaire ----------
function audienceField(f) {
  const myTeams = S.teams.filter((t) => isBoard() || coachOf(t.id));
  const opts = isBoard() ? [['club', 'Tout le club'], ['team', 'Une ou plusieurs équipes'], ['board', 'Bureau'], ['board_coaches', 'Bureau et coachs'], ['coaches', 'Tous les coachs'], ['people', 'Personnes choisies']] : [['team', myTeams.length > 1 ? 'Une ou plusieurs de mes équipes' : 'Mon équipe']];
  let h = `<div class="field"><span class="lab">Pour</span><div class="chips">${opts.map(([v, l]) => `<button type="button" class="chip" data-act="evaud" data-v="${v}" aria-pressed="${f.aud === v}">${INTERNAL[v] || v === 'people' ? icon('lock', 14) + ' ' : ''}${l}</button>`).join('')}</div></div>`;
  if (f.aud === 'team') h += `<div class="field"><span class="lab">Équipes (${f.teams.size})</span><div class="chips">${myTeams.map((t) => `<button type="button" class="chip" data-act="evteam" data-id="${t.id}" aria-pressed="${f.teams.has(t.id)}">${esc(t.name)}</button>`).join('') || '<p class="empty">Aucune équipe.</p>'}</div></div>`;
  if (f.aud === 'people') {
    const ppl = [...new Map(S.members.filter((m) => m.status === 'active').map((m) => [m.user_id, m])).keys()].filter((u) => u !== S.me.id).sort((a, b) => name(a).localeCompare(name(b), 'fr'));
    const q = norm(f.pq), shown = ppl.filter((u) => !q || norm(name(u)).includes(q));
    h += `<div class="field"><label for="epq">Personnes choisies (${f.people.size})</label><input id="epq" type="search" data-evpq="1" value="${esc(f.pq || '')}" placeholder="Rechercher un nom"></div><div class="card flat" style="max-height:320px;overflow:auto;gap:0">${shown.map((u) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-evpeople="${u}" ${f.people.has(u) ? 'checked' : ''}><span>${esc(name(u))}</span></label>`).join('') || '<p class="empty">Personne.</p>'}</div><p class="note">Seules ces personnes voient le rendez-vous (et le bureau).</p>`;
  }
  return h;
}
function repeatFields(f) {
  if (f.type !== 'Entraînement' || f.id) return '';
  return `<label class="check"><input type="checkbox" name="repeat" data-evrep="1" ${f.repeat ? 'checked' : ''}><span>Répéter chaque semaine (même jour, même heure)</span></label>
  ${f.repeat ? `${field('eu', "Répéter jusqu'au (obligatoire)", `<input id="eu" name="until" type="date" required value="${esc(f.until || '')}">`)}<label class="check"><input type="checkbox" name="skiphol" ${f.skiphol === false ? '' : 'checked'}><span>Hors vacances scolaires (zone C : Créteil, Paris, Versailles)</span></label>` : ''}`;
}
export function eventForm() {
  const f = S.form;
  return `<form id="evf" class="card lift">
  <div class="field"><span class="lab">Type</span><div class="chips">${types().map((t) => `<button type="button" class="chip" data-act="evtype" data-v="${t}" aria-pressed="${f.type === t}">${t}</button>`).join('')}</div></div>
  ${field('et', 'Titre', `<input id="et" name="title" required maxlength="120" value="${esc(f.title || '')}" placeholder="${f.type === 'Match' ? 'Ex. Match contre Val Vert' : 'Ex. ' + esc(f.type)}">`)}
  ${['Match', 'Plateau', 'Tournoi'].includes(f.type) ? field('eo', f.type === 'Match' ? 'Adversaire' : 'Adversaires (séparés par des virgules)', `<input id="eo" name="opponents" value="${esc(f.opponents || '')}">`) : ''}
  ${field('ed', 'Date et heure', `<input id="ed" name="starts_at" type="datetime-local" required value="${esc(f.starts_at || '')}">`)}
  ${repeatFields(f)}
  ${field('el', 'Lieu', `<input id="el" name="place" value="${esc(f.place || '')}" placeholder="Ex. Gymnase de Boissy">`)}
  ${audienceField(f)}
  <button class="btn main" type="submit">${f.id ? 'Enregistrer les changements' : 'Enregistrer'}</button></form>`;
}
function keepForm() { const fm = document.getElementById('evf'); if (!fm) return; const v = Object.fromEntries(new FormData(fm)); Object.assign(S.form, v); S.form.repeat = !!v.repeat; S.form.skiphol = !!v.skiphol; }

// ---------- page d'un rendez-vous ----------
export function eventPage(id) {
  const e = S.events.find((x) => x.id === id); if (!e) return '<p class="empty">Rendez-vous introuvable (supprimé ?).</p>';
  const R = respOf(id), list = (a) => (a.length ? a.map(respName).join(', ') : '—'), man = canManageEvent(e);
  let h = `<div class="card lift">${e.cancelled ? '<span class="pill ko">Rendez-vous annulé</span>' : ''}<div>${forLabel(e)}</div>${e.opponents ? `<div class="det">Contre : ${esc(e.opponents)}</div>` : ''}${man ? `<div class="det">${plural(invitedCount(e), 'personne prévenue', 'personnes prévenues')}${isTeamType(e) ? ' · ' + plural(playersOf(e).length, 'joueur concerné', 'joueurs concernés') : ''}</div>` : ''}
  ${e.cancelled ? '' : `<b style="font-family:var(--pc-titre);font-size:22px">${coachOnly(e) && !myKidsIn(evTeams(e)).length ? 'Ton équipe' : 'Tu viens ?'}</b>${answerBlock(e)}${!isOpen(e) && !coachOnly(e) && !followOnly(e) ? `<p class="note">Tu peux répondre dès maintenant. Sinon, cette séance arrivera dans « À répondre » le ${esc(fmtDay(opensOn(e)))}.</p>` : ''}`}</div>`;
  const tot = R.oui.length + R.non.length, base = Math.max(tot, isTeamType(e) ? playersOf(e).length : invitedCount(e));
  h += `<div class="card"><div class="sec"><h2>Qui vient ?</h2><span class="det">${plural(R.all.length, 'réponse')}</span></div>${base ? `<div class="bar"><span style="width:${(100 * R.oui.length) / base}%"></span><span style="width:${(100 * R.non.length) / base}%"></span></div>` : ''}
  <div class="chips"><span class="pill ok">${R.oui.length} oui</span><span class="pill ko">${R.non.length} non</span>${base > tot && isOpen(e) ? `<span class="pill">${base - tot} sans réponse</span>` : ''}</div><div><b>Viennent :</b> ${list(R.oui)}</div><div><b>Ne viennent pas :</b> ${list(R.non)}</div></div>`;
  h += `<div class="btns"><button class="btn" data-act="ics" data-id="${id}">${icon('calplus', 20)}Ajouter à mon agenda</button>${e.place ? `<a class="btn small" style="flex:none;width:52px;padding:0" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.place)}" target="_blank" rel="noopener" aria-label="Itinéraire">${icon('pin', 22)}</a>` : ''}</div>`;
  if (!coachOnly(e) && e.type !== 'Entraînement' && R.mine === 'non') h += `<button class="btn ghost" data-act="${hiddenByMe(e) ? 'unhide' : 'hide'}" data-id="${id}">${hiddenByMe(e) ? 'Réafficher dans mon agenda' : 'Ne plus afficher dans mon agenda'}</button>`;
  const plans = (S.evPlans || []).filter((p) => p.event_id === id);
  if (plans.length) h += `<div class="card pale"><div class="kick">Séance prévue</div>${plans.map((p) => `<button class="row" data-act="pview" data-id="${p.id}"><span class="g">${esc(p.title)}<small>${plural(p.items.length, 'exercice')} · ${p.items.reduce((a, x) => a + (+x.minutes || 0), 0)} min · imprimer ou PDF</small></span></button>`).join('')}</div>`;
  if (man) {
    if (isTeamType(e) && !e.cancelled && !coachOnly(e)) h += `<button class="btn main" data-act="appel" data-id="${id}">Faire l'appel</button>`;
    h += `<div class="btns"><button class="btn ghost" data-act="evedit" data-id="${id}">Modifier</button><button class="btn ghost" data-act="evcancel" data-id="${id}">${e.cancelled ? 'Rétablir' : 'Annuler le rendez-vous'}</button></div>`;
    if (e.series_id) {
      const k1 = 'ev1' + id, k2 = 'evs' + id;
      h += `<div class="card flat"><div class="kick">Ce rendez-vous fait partie d'une série</div>${delBtn('evdel', id, 'Supprimer cette séance', 'Confirmer : supprimer cette séance', isArmed(k1), 'data-m="one"')}${delBtn('evdel', id, 'Supprimer toutes les séances à venir', `Confirmer : ${S.delCount ?? '…'} séance${S.delCount > 1 ? 's' : ''} supprimée${S.delCount > 1 ? 's' : ''}`, isArmed(k2), 'data-m="series"')}<p class="note">Les séances passées restent, avec leur appel. Si aucune séance passée n'a d'appel, toute la série est supprimée.</p></div>`;
    } else h += delBtn('evdel', id, 'Supprimer ce rendez-vous', 'Confirmer la suppression', isArmed('ev1' + id), 'data-m="one"');
  }
  return h;
}

// ---------- appel ----------
function announced(p, eid) {
  const own = S.resp.filter((x) => x.event_id === eid && x.player_id === p.id);
  const r = own.length ? own : S.resp.filter((x) => x.event_id === eid && !x.player_id && x.user_id === p.user_id);
  return r.some((x) => x.answer === 'oui') ? 'oui' : r.some((x) => x.answer === 'non') ? 'non' : '';
}
export function appelPage(eid) {
  const e = S.events.find((x) => x.id === eid); if (!e) return '<p class="empty">Rendez-vous introuvable.</p>';
  const ps = playersOf(e).sort((a, b) => pname(a).localeCompare(pname(b), 'fr'));
  if (!S.ap || S.ap.eid !== eid) { S.ap = { eid, st: {} }; S.att.filter((x) => x.event_id === eid).forEach((x) => (S.ap.st[x.player_id] = x.status)); }
  const st = S.ap.st, n = ps.filter((p) => ['present', 'retard'].includes(st[p.id])).length;
  let h = `<div class="card lift" style="flex-direction:row;align-items:center;justify-content:space-between"><span class="big">${n} / ${ps.length}</span><span class="det" style="text-align:right">présents<br>prérempli d'après les réponses</span></div>`;
  h += `<button class="btn ghost" data-act="appall">Tous ceux annoncés présents sont là</button><div class="card"><div class="list">`;
  h += ps.map((p) => {
    const a = announced(p, eid), s = st[p.id] || '';
    return `<div class="row static" style="flex-wrap:wrap"><span class="g" style="flex:1 1 100%">${esc(pname(p))}<small>${a === 'oui' ? '<span style="color:var(--pc-bleu);font-weight:700">● annoncé présent</span>' : a === 'non' ? '<span style="color:var(--pc-non-texte);font-weight:700">✕ annoncé absent</span>' : 'sans réponse'}</small></span><div class="chips" style="gap:6px">${[['present', 'Présent', 'ok'], ['retard', 'Retard', 'wait'], ['absent', 'Absent', 'ko']].map(([k, l, c]) => `<button class="pill ${s === k ? c : ''}" data-act="appset" data-id="${p.id}" data-v="${k}" aria-pressed="${s === k}" style="min-height:44px;padding:6px 14px;${s === k ? '' : 'background:#FFFFFF;border:2px solid var(--pc-trait)'}">${l}</button>`).join('')}</div></div>`;
  }).join('') || '<p class="empty">Aucune fiche joueur dans cette équipe.</p>';
  return h + `</div></div><button class="btn main" data-act="appsave">Enregistrer l'appel</button><p class="note">À l'enregistrement, les joueurs non pointés passent en absent. Une séance sans appel ne compte pas dans les statistiques.</p>`;
}

// ---------- agenda du téléphone ----------
function icsFor(e) {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), end = new Date(new Date(e.starts_at).getTime() + 90 * 6e4);
  const clean = (s) => String(s || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, ' ');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket Club//FR', 'BEGIN:VEVENT', 'UID:' + e.id + '@pocketclub', 'DTSTAMP:' + f(Date.now()), 'DTSTART:' + f(e.starts_at), 'DTEND:' + f(end), 'SUMMARY:' + clean(e.title + ' · ' + (club()?.name || '')), 'LOCATION:' + clean(e.place), 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

// ---------- actions ----------
const today = () => { const t = new Date(Date.now() + 864e5); t.setMinutes(0, 0, 0); return toLocalInput(t); };
Object.assign(ACTIONS, {
  agf: (el, d) => { S.agf = d.v; render(true); },
  event: (el, d) => { S.view = { type: 'event', id: d.id }; render(); },
  evnew: (el, d) => {
    const coachT = coachTeams(), team = d.team || (!isBoard() && coachT.length === 1 ? coachT[0] : '');
    S.form = { type: 'Entraînement', starts_at: today(), aud: team || !isBoard() ? 'team' : 'club', teams: new Set(team ? [team] : []), people: new Set(), pq: '' };
    S.view = { type: 'evform' }; render();
  },
  evedit: (el, d) => {
    const e = S.events.find((x) => x.id === d.id);
    S.form = { id: e.id, type: e.type, title: e.title, opponents: e.opponents, place: e.place, starts_at: toLocalInput(new Date(e.starts_at)), aud: e.audience, teams: new Set(evTeams(e)), people: new Set(e.people || []), pq: '' };
    S.view = { type: 'evform' }; render();
  },
  evtype: (el, d) => { keepForm(); S.form.type = d.v; render(true); },
  evaud: (el, d) => { keepForm(); S.form.aud = d.v; render(true); },
  evteam: (el, d) => { keepForm(); S.form.teams[S.form.teams.has(d.id) ? 'delete' : 'add'](d.id); render(true); },
  rsvp: async (el, d) => {
    const R = respOf(d.id), pid = d.p || null, cur = pid ? R.kid(pid) : R.mine;
    if (await run(sb.rpc('respond_event', { p_event: d.id, p_player: pid, p_answer: cur === d.v ? null : d.v }))) {
      const rr = await sb.from('event_responses').select('*').eq('event_id', d.id); S.resp = S.resp.filter((x) => x.event_id !== d.id).concat(rr.data || []);
    }
    render(true);
  },
  evcancel: async (el, d) => { const e = S.events.find((x) => x.id === d.id); if (await run(sb.from('events').update({ cancelled: !e.cancelled }).eq('id', e.id), e.cancelled ? 'Rendez-vous rétabli.' : 'Rendez-vous annulé.')) await refresh(); },
  evdel: async (el, d) => {
    const mode = d.m || 'one', key = (mode === 'one' ? 'ev1' : 'evs') + d.id;
    if (!isArmed(key) && mode === 'series') { const n = await run(sb.rpc('delete_events', { p_event: d.id, p_mode: 'series', p_dry: true })); if (n === null) return; S.delCount = n; }
    if (!armed(key)) return;
    const n = await run(sb.rpc('delete_events', { p_event: d.id, p_mode: mode, p_dry: false }));
    if (n !== null) { toast(mode === 'one' ? 'Rendez-vous supprimé.' : plural(n, 'séance supprimée', 'séances supprimées') + '.'); S.view = null; S.tab = 1; await refresh(); }
  },
  selmode: () => { S.sel = S.sel ? null : new Set(); S.del = null; render(true); },
  seldel: async () => {
    if (!S.sel?.size || !armed('sel')) return;
    const n = await run(sb.rpc('delete_event_list', { p_ids: [...S.sel] }));
    if (n !== null) { toast(plural(n, 'rendez-vous supprimé', 'rendez-vous supprimés') + '.'); S.sel = null; await refresh(); }
  },
  hide: async (el, d) => { if (await run(sb.from('event_hidden').upsert({ event_id: d.id, user_id: S.me.id, hidden_at: new Date().toISOString() }), 'Masqué. Ta réponse reste enregistrée ; filtre « Masqués » pour le retrouver.')) { S.hidden = S.hidden.filter((h) => h.event_id !== d.id).concat({ event_id: d.id, hidden_at: new Date().toISOString() }); render(true); } },
  unhide: async (el, d) => { if (await run(sb.from('event_hidden').delete().eq('event_id', d.id).eq('user_id', S.me.id), 'Réaffiché.')) { S.hidden = S.hidden.filter((h) => h.event_id !== d.id); render(true); } },
  ics: (el, d) => { const e = S.events.find((x) => x.id === d.id); download(new Blob([icsFor(e)], { type: 'text/calendar' }), 'rendez-vous-' + e.starts_at.slice(0, 10) + '.ics'); toast("Ouvre le fichier pour l'ajouter à ton agenda."); },
  appel: (el, d) => { S.ap = null; S.view = { type: 'appel', id: d.id }; render(); },
  appset: (el, d) => { S.ap.st[d.id] = S.ap.st[d.id] === d.v ? '' : d.v; render(true); },
  appall: () => { const e = S.events.find((x) => x.id === S.ap.eid); playersOf(e).forEach((p) => { if (announced(p, e.id) !== 'non' && !S.ap.st[p.id]) S.ap.st[p.id] = 'present'; }); render(true); },
  appsave: async () => {
    const e = S.events.find((x) => x.id === S.ap.eid);
    const rows = playersOf(e).map((p) => ({ event_id: e.id, player_id: p.id, status: S.ap.st[p.id] || 'absent', marked_by: S.me.id, marked_at: new Date().toISOString() }));
    if (rows.length && await run(sb.from('attendance').upsert(rows), 'Appel enregistré.')) { S.view = { type: 'event', id: e.id }; await refresh(); }
  },
});
FORMS.evf = async (v) => {
  const f = S.form, aud = f.aud;
  if (aud === 'team' && !f.teams.size) return toast('Choisis au moins une équipe.');
  if (aud === 'people' && !f.people.size) return toast('Choisis au moins une personne.');
  const base = { club_id: S.clubId, audience: aud, team_ids: aud === 'team' ? [...f.teams] : [], people: aud === 'people' ? [...f.people] : [], type: f.type, title: v.title.trim(), place: (v.place || '').trim(), opponents: (v.opponents || '').trim() };
  const start = new Date(v.starts_at);
  if (f.id) {
    if (await run(sb.from('events').update({ ...base, starts_at: start.toISOString() }).eq('id', f.id), 'Rendez-vous modifié.')) { S.view = { type: 'event', id: f.id }; S.form = null; await refresh(); }
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
  const n = await run(sb.rpc('create_events', { p: { ...base, starts, series } }));
  if (n !== null) { toast(n > 1 ? plural(n, 'séance créée', 'séances créées') + ', une par semaine.' : 'Rendez-vous ajouté.'); S.view = null; S.form = null; S.tab = 1; await refresh(); }
};
CHANGES.push(async (t) => {
  if (t.dataset.clubtog) { const v = t.checked; if (await run(sb.from('profiles').update({ show_all_club: v }).eq('id', S.me.id))) S.me.show_all_club = v; render(true); return true; }
  if (t.dataset.evrep) { keepForm(); S.form.repeat = t.checked; if (!t.checked) S.form.until = ''; render(true); return true; }
  if (t.dataset.evpeople) { keepForm(); S.form.people[t.checked ? 'add' : 'delete'](t.dataset.evpeople); render(true); return true; }
  if (t.dataset.evsel) { S.sel[t.checked ? 'add' : 'delete'](t.dataset.evsel); S.del = null; render(true); return true; }
  return false;
});
INPUTS.push((t) => {
  if (t.dataset.evpq) { keepForm(); S.form.pq = t.value; const pos = t.selectionStart; render(true); const n = document.getElementById('epq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } return true; }
  return false;
});
export { fmtDate };
