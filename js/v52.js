// mypocketclub · alpha 5.2.0
// N° 174 : contact d'équipe (un adulte par équipe, droits pour son équipe seulement).
// N° 158 : renforts (joueurs d'une catégorie juste en dessous, avec accord de la famille).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_5_2_0.sql) ; l'écran n'est qu'un confort.
import { S, sb, esc, hooks, run, toast, render, refresh, ACTIONS, FORMS, isBoard, coachOf, team, teamName, name, myPlayers } from './core.js';
import { field } from './ui.js';

const STATE = { demande: 'en attente de la famille', accepte: 'accepté', refuse: 'refusé' };
const cOf = (tid) => (S.tcontacts || []).find((c) => c.team_id === tid);
export const contactOf = (tid) => cOf(tid)?.user_id || null;
const who = (uid) => name(uid);

export async function loadV52() {
  if (!S.clubId) return;
  const r = await sb.from('team_contacts').select('*').eq('club_id', S.clubId);
  S.tcontacts = r.data || [];
}

async function loadLists(tid) {
  S.rfl = S.rfl || {}; S.rfl[tid] = { cands: null, list: null };
  const [c, l] = await Promise.all([sb.rpc('reinforcement_candidates', { p_team: tid }), sb.rpc('reinforcements_of', { p_team: tid })]);
  S.rfl[tid] = { cands: !c.error && Array.isArray(c.data) ? c.data : [], list: !l.error && Array.isArray(l.data) ? l.data : [], denied: !!(c.error && l.error) };
  render(true);
}

// Bloc de la page équipe (coach, bureau) : contact d'équipe et renforts
export function teamExtra(tid) {
  const t = team(tid); if (!t) return '';
  let h = '';
  const cur = contactOf(tid), cands = (S.ccands || {})[tid];
  h += `<div class="sec"><h2>Contact de l'équipe</h2></div><div class="card"><p class="note">Un adulte de l'équipe peut créer et annuler les rendez-vous de cette équipe et voir les coordonnées de ses familles. Son droit s'arrête dès qu'il n'est plus coach, joueur majeur ou membre du bureau.</p>`;
  h += cur ? `<p><b>${esc(who(cur))}</b></p><button class="btn ghost small" data-act="tcset" data-id="${tid}" data-user="">Retirer le contact</button>` : '<p class="empty">Aucun contact pour le moment.</p>';
  h += `<form id="tcf" data-id="${tid}" class="stack">${field('tcu', 'Choisir un adulte', `<select id="tcu" name="user" ${cands && cands.length ? '' : 'disabled'}>${cands ? cands.map((x) => `<option value="${x.uid}">${esc(x.label)}</option>`).join('') || '<option value="">Aucun adulte</option>' : '<option value="">Chargement…</option>'}</select>`)}<button class="btn main" type="submit" ${cands && cands.length ? '' : 'disabled'}>Nommer contact</button></form></div>`;
  if (!(coachOf(tid) || isBoard())) return h;
  const L = (S.rfl || {})[tid];
  if (L === undefined) loadLists(tid);
  h += `<div class="sec"><h2>Renforts</h2></div><div class="card"><p class="note">Un joueur de la catégorie juste en dessous peut renforcer l'équipe. Sa famille doit accepter : le joueur garde son équipe d'origine.</p>`;
  if (!L || L.list === null) return h + '<p class="empty">Chargement…</p></div>';
  h += (L.list || []).length ? `<div class="list">${L.list.map((r) => `<div class="row"><span class="g">${esc(r.label)}<small>${esc(r.team_name || '')} · ${STATE[r.state] || esc(r.state)}</small></span>${r.state === 'demande' ? `<button class="btn ghost small" data-act="rfremind" data-id="${r.id}">Relancer</button>` : ''}<button class="btn ghost small" data-act="rfremove" data-id="${r.id}">Retirer</button></div>`).join('')}</div>` : '<p class="empty">Aucun renfort.</p>';
  h += `<form id="rff" data-id="${tid}" class="stack">${field('rfp', 'Proposer un joueur', `<select id="rfp" name="player" ${(L.cands || []).length ? '' : 'disabled'}>${(L.cands || []).map((x) => `<option value="${x.player_id}">${esc(x.label)} · ${esc(x.team_name)}</option>`).join('') || '<option value="">Aucun joueur à proposer</option>'}</select>`)}<button class="btn main" type="submit" ${(L.cands || []).length ? '' : 'disabled'}>Demander le renfort</button></form></div>`;
  return h;
}

// Accueil de la famille : demandes de renfort à valider
async function loadHome() {
  S.rfHome = null;
  const ids = myPlayers().map((p) => p.id); if (!ids.length) { S.rfHome = []; return; }
  const r = await sb.from('team_reinforcements').select('id,team_id,player_id,state').eq('state', 'demande').in('player_id', ids);
  S.rfHome = r.data || []; render(true);
}
// N° 200 : le contact d'une équipe (hors accès Événements) retrouve les convocations reçues pour son équipe en tête de l'Accueil
const contactConvocs = () => (!S.areas.includes('evenements') && (S.tcontacts || []).some((c) => c.user_id === S.me.id) && hooks.receivedBlock ? hooks.receivedBlock() : '');
hooks.renfortHome = () => {
  if (S.rfHome === undefined) loadHome();
  return contactConvocs() + (S.rfHome || []).map((r) => {
    const p = S.players.find((x) => x.id === r.player_id), t = team(r.team_id);
    return `<div class="card lift"><div class="kick">Renfort demandé</div><p><b>${esc(p ? p.first_name : '')}</b> est demandé en renfort de l'équipe ${esc(t ? teamName(t.id) : '')}. Son équipe d'origine ne change pas.</p><div class="btns"><button class="btn main" data-act="rfyes" data-id="${r.id}">Accepter</button><button class="btn ghost" data-act="rfno" data-id="${r.id}">Refuser</button></div></div>`;
  }).join('');
};
const reload = async (tid) => { if (S.rfl) delete S.rfl[tid]; S.rfHome = undefined; await refresh(); };
Object.assign(ACTIONS, {
  tcset: async (el, d) => { if (await run(sb.rpc('set_team_contact', { p_team: d.id, p_user: d.user || null }), 'Contact retiré.')) { await loadV52(); render(true); } },
  rfyes: async (el, d) => { if (await run(sb.rpc('answer_reinforcement', { p_id: d.id, p_accept: true }), 'Merci, c’est accepté.')) { S.rfHome = undefined; await refresh(); } },
  rfno: async (el, d) => { if (await run(sb.rpc('answer_reinforcement', { p_id: d.id, p_accept: false }), 'C’est refusé.')) { S.rfHome = undefined; await refresh(); } },
  rfremind: async (el, d) => { await run(sb.rpc('remind_reinforcement', { p_id: d.id }), 'Relance envoyée.'); },
  rfremove: async (el, d) => { if (await run(sb.rpc('remove_reinforcement', { p_id: d.id }), 'Renfort retiré.')) { S.rfl = {}; await refresh(); } },
});
Object.assign(FORMS, {
  tcf: async (v, f) => { if (!v.user) return toast('Choisis un adulte.'); if (await run(sb.rpc('set_team_contact', { p_team: f.dataset.id, p_user: v.user }), 'Contact nommé.')) { await loadV52(); render(true); } },
  rff: async (v, f) => { if (!v.player) return toast('Choisis un joueur.'); if (await run(sb.rpc('add_reinforcement', { p_team: f.dataset.id, p_player: v.player }), 'Demande envoyée à la famille.')) await reload(f.dataset.id); },
});
hooks.loadV52 = loadV52;
hooks.teamExtra = teamExtra;
// N° 199 : renforts de l'équipe pour l'Effectif (ids des renforts acceptés ; lignes « en attente » ou acceptées absentes de la liste)
hooks.renfortRows = (tid) => {
  const L = (S.rfl || {})[tid];
  if (L === undefined) { loadLists(tid); return { ids: new Set(), extra: () => '' }; }
  const list = L && Array.isArray(L.list) ? L.list.filter((r) => r.state !== 'refuse') : [];
  return {
    ids: new Set(list.filter((r) => r.state === 'accepte').map((r) => r.player_id)),
    extra: (present) => list.filter((r) => !present.has(r.player_id)).map((r) => `<div class="row static"><span class="avatar">${esc((r.label || '?').slice(0, 1))}</span><span class="g">${esc(r.label)}<small>Renfort · ${STATE[r.state] || esc(r.state)}</small></span></div>`).join(''),
  };
};
