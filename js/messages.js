// Pocket Club · messages : groupes d'échange, messages en direct, sondages (supprimables, restaurables par le bureau).
import { S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, ROLES, isBoard, name, nick, teamName, fmtShort, loadGroup, parentsOf, playersOfTeam, plural, norm } from './core.js';
import { icon, delBtn, field } from './ui.js';

export const grp = (id) => S.groups.find((g) => g.id === id);
export function scrollEnd() { setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30); }

// N° 50 : groupes triés par dernier message (ou sondage), le plus récent en haut
const lastAt = (g) => g.last_message_at || g.created_at;
export const sortedGroups = () => S.groups.slice().sort((a, b) => (lastAt(a) < lastAt(b) ? 1 : lastAt(a) > lastAt(b) ? -1 : 0));
function when(iso) {
  const d = new Date(iso), t = new Date();
  if (d.toDateString() === t.toDateString()) return d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0');
  const y = new Date(t); y.setDate(t.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
// Le groupe remonte en haut dès qu'un message y arrive (reçu ou envoyé)
export function bump(m, kind = 'message') {
  const g = grp(m.group_id); if (!g) return;
  g.last_message_at = m.created_at; S.previews[m.group_id] = { group_id: m.group_id, user_id: m.user_id ?? m.created_by, body: m.body ?? m.question, created_at: m.created_at, kind };
}
export function messagesTab() {
  let h = `<button class="btn main" data-act="gnew">${icon('plus', 20)}Créer un groupe d'échange</button>`;
  h += `<div class="card"><div class="list">${S.groups.length ? sortedGroups().map((g) => {
    const p = S.previews[g.id], n = S.unread[g.id] || 0;
    const line = p ? (p.kind === 'sondage' ? 'Sondage : ' : (p.user_id === S.me.id ? 'Toi' : esc(nick(p.user_id)).split(' ')[0]) + ' : ') + esc(String(p.body).slice(0, 70)) : 'Pas encore de message';
    return `<button class="row" data-act="group" data-id="${g.id}"><span class="avatar">${icon('msg', 20)}</span><span class="g"><span style="display:flex;gap:8px;align-items:baseline"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${n ? ';font-weight:800' : ''}">${esc(g.name)}</span><small style="flex:none">${esc(when(lastAt(g)))}</small></span><small style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${line}</small></span>${n ? `<span class="unread" aria-label="${n} non lus">${n}</span>` : '<span class="chev"></span>'}</button>`;
  }).join('') : '<p class="empty">Tu ne fais partie d’aucun groupe pour l’instant.</p>'}</div></div>`;
  return h + '<p class="note">Les groupes remplacent WhatsApp : covoiturage, organisation, sondages. Seuls les membres invités les voient.</p>';
}

export function groupForm() {
  const f = S.form;
  const people = [...new Map(S.members.filter((m) => m.status === 'active' && m.user_id !== S.me.id).map((m) => [m.user_id, m])).values()]
    .concat(S.pparents.filter((x) => x.user_id !== S.me.id).map((x) => ({ user_id: x.user_id, role: 'parent' })))
    .reduce((a, m) => (a.some((y) => y.user_id === m.user_id) ? a : a.concat(m)), []).sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), 'fr'));
  const q = norm(f.q), shown = people.filter((m) => !q || norm(name(m.user_id)).includes(q));
  return `<div class="card lift">
  ${field('gn', 'Nom du groupe', `<input id="gn" data-f="name" value="${esc(f.name || '')}" maxlength="80" placeholder="Ex. U9 · Parents et coachs">`)}
  <div class="kick">Ajouter d'un coup</div><div class="chips">${S.teams.map((t) => `<button class="chip" data-act="gteam" data-id="${t.id}">${esc(t.name)}</button>`).join('')}<button class="chip" data-act="gstaff">Président, bureau et coachs</button></div>
  ${field('gq', `Membres invités (${f.sel.size})`, `<input id="gq" type="search" data-gq="1" value="${esc(f.q || '')}" placeholder="Rechercher un nom">`)}
  <div class="card flat" style="max-height:360px;overflow:auto;gap:0">${shown.length ? shown.map((m) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-gsel="${m.user_id}" ${f.sel.has(m.user_id) ? 'checked' : ''}><span>${esc(name(m.user_id))} <span class="det">· ${ROLES[m.role] || ''}${m.team_id ? ' ' + esc(teamName(m.team_id)) : ''}</span></span></label>`).join('') : '<p class="empty">Aucun autre membre pour le moment.</p>'}</div>
  <button class="btn main" data-act="gcreate">Créer le groupe</button></div>`;
}

const canDelPoll = (p) => p.created_by === S.me.id || isBoard() || grp(p.group_id)?.created_by === S.me.id;
function pollCard(p) {
  if (p.deleted_at) return `<div class="card flat"><div class="det">Sondage « ${esc(p.question)} » supprimé par ${esc(name(p.deleted_by))}.</div>${isBoard() || canDelPoll(p) ? `<button class="btn small ghost" data-act="pollrestore" data-id="${p.id}">Restaurer (30 jours)</button>` : ''}</div>`;
  const v = S.votes.filter((x) => x.poll_id === p.id), my = (v.find((x) => x.user_id === S.me.id) || {}).answer, k = 'poll' + p.id;
  return `<div class="card yellow" style="transform:none"><div style="display:flex;align-items:center;gap:8px"><span class="kick" style="flex:1;color:var(--pc-encre)">Sondage · ${esc(nick(p.created_by))}</span>${canDelPoll(p) ? `<button class="pill ${isArmed(k) ? 'armed' : ''}" data-act="polldel" data-id="${p.id}" aria-label="Supprimer le sondage">${isArmed(k) ? 'Confirmer la suppression' : icon('trash', 16)}</button>` : ''}</div><b style="font-size:18px">${esc(p.question)}</b>
  <div class="chips">${['Présent', 'Absent', 'Je ne sais pas'].map((a) => `<button class="chip" data-act="vote" data-id="${p.id}" data-v="${a}" aria-pressed="${my === a}" style="${my === a ? 'background:var(--pc-encre);color:#FFFFFF;border-color:var(--pc-encre)' : 'background:#FFFFFF;border-color:#FFFFFF'}">${a} · ${v.filter((x) => x.answer === a).length}</button>`).join('')}</div><div class="det">${plural(v.length, 'réponse')} sur ${S.gmembers.length}</div></div>`;
}

export function groupPage(id) {
  const g = grp(id); if (!g) return '<p class="empty">Groupe introuvable.</p>';
  const mine = S.gmembers.find((x) => x.user_id === S.me.id);
  let h = `<details class="card"><summary>${plural(S.gmembers.length, 'membre')}</summary><div class="det">${S.gmembers.map((x) => esc(name(x.user_id))).join(', ')}</div></details>`;
  h += S.polls.map(pollCard).join('');
  h += '<div class="msgs">' + (S.msgs.length ? S.msgs.map((m) => `<div class="bub ${m.user_id === S.me.id ? 'me' : ''}">${m.user_id === S.me.id ? '' : `<div class="who">${esc(nick(m.user_id))}</div>`}<div>${esc(m.body)}</div><div class="when">${esc(fmtShort(m.created_at))}</div></div>`).join('') : '<p class="empty">Écris le premier message.</p>') + '</div>';
  h += `<form id="msgf" class="compose"><input name="body" placeholder="Ton message" autocomplete="off" maxlength="2000" aria-label="Message"><button class="btn main small" type="submit">Envoyer</button></form>`;
  h += `<div class="chips"><button class="chip" data-act="pollnew">${icon('plus', 16)} Sondage</button><button class="chip" data-act="gmute" aria-pressed="${!!mine?.muted}">${mine?.muted ? 'Notifications coupées' : 'Couper les notifications'}</button>${g.created_by === S.me.id ? '' : '<button class="chip" data-act="gleave">Quitter le groupe</button>'}</div>`;
  if (g.created_by === S.me.id || isBoard()) h += delBtn('gdel', id, 'Supprimer le groupe', 'Confirmer : supprimer le groupe et ses messages', isArmed('g' + id));
  return h;
}

export async function openGroup(id) {
  S.view = { type: 'group', id }; await loadGroup(id);
  // n° 36 : le groupe ouvert est lu
  { S.unread[id] = 0; sb.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', id).eq('user_id', S.me.id).then(() => {}, () => {}); }
  render(); scrollEnd();
}

Object.assign(ACTIONS, {
  gnew: () => { S.form = { name: '', sel: new Set(), q: '' }; S.view = { type: 'gform' }; render(); },
  gteam: (el, d) => {
    S.members.filter((m) => m.status === 'active' && m.team_id === d.id && m.user_id !== S.me.id).forEach((m) => S.form.sel.add(m.user_id));
    playersOfTeam(d.id).forEach((p) => { if (p.user_id && p.user_id !== S.me.id) S.form.sel.add(p.user_id); parentsOf(p.id).filter((u) => u !== S.me.id).forEach((u) => S.form.sel.add(u)); });
    render(true);
  },
  gstaff: () => { S.members.filter((m) => m.status === 'active' && ['president', 'bureau', 'coach'].includes(m.role) && m.user_id !== S.me.id).forEach((m) => S.form.sel.add(m.user_id)); render(true); },
  gcreate: async () => {
    const nm = (S.form.name || '').trim(); if (!nm) return toast('Donne un nom au groupe.');
    const g = await run(sb.from('groups').insert({ club_id: S.clubId, name: nm, created_by: S.me.id }).select().single()); if (!g) return;
    if (await run(sb.from('group_members').insert([S.me.id, ...S.form.sel].map((u) => ({ group_id: g.id, user_id: u }))), 'Groupe créé.')) { S.groups.unshift(g); S.form = null; await openGroup(g.id); }
  },
  group: (el, d) => openGroup(d.id),
  pollnew: async () => {
    const q = prompt('Question du sondage (ex. Plateau samedi 7 novembre ?)'); if (!q || !q.trim()) return;
    const pl = await run(sb.from('polls').insert({ group_id: S.view.id, question: q.trim().slice(0, 200), created_by: S.me.id }).select().single(), 'Sondage publié.');
    if (pl) { bump(pl, 'sondage'); await loadGroup(S.view.id); render(true); }
  },
  vote: async (el, d) => { if (await run(sb.from('poll_votes').upsert({ poll_id: d.id, user_id: S.me.id, answer: d.v }))) { await loadGroup(S.view.id); render(true); } },
  polldel: async (el, d) => { if (!armed('poll' + d.id)) return; if (await run(sb.rpc('trash_item', { p_kind: 'poll', p_id: d.id }), 'Sondage supprimé (restaurable pendant 30 jours).')) { await loadGroup(S.view.id); render(true); } },
  pollrestore: async (el, d) => { if (await run(sb.rpc('restore_item', { p_kind: 'poll', p_id: d.id }), 'Sondage restauré.')) { await loadGroup(S.view.id); render(true); } },
  gmute: async () => { const mine = S.gmembers.find((x) => x.user_id === S.me.id); if (mine && await run(sb.from('group_members').update({ muted: !mine.muted }).eq('group_id', S.view.id).eq('user_id', S.me.id))) { mine.muted = !mine.muted; render(true); } },
  gleave: async () => { if (await run(sb.from('group_members').delete().eq('group_id', S.view.id).eq('user_id', S.me.id), 'Tu as quitté le groupe.')) { S.view = null; await refresh(); } },
  gdel: async (el, d) => { if (!armed('g' + d.id)) return; if (await run(sb.from('groups').delete().eq('id', d.id), 'Groupe supprimé.')) { S.view = null; await refresh(); } },
});
FORMS.msgf = async (v) => {
  const body = (v.body || '').trim(); if (!body) return;
  const m = await run(sb.from('messages').insert({ group_id: S.view.id, user_id: S.me.id, body }).select().single());
  if (m) { if (!S.msgs.some((x) => x.id === m.id)) S.msgs.push(m); S.lastMsgs.unshift(m); bump(m); render(true); scrollEnd(); document.querySelector('#msgf input')?.focus(); }
};
INPUTS.push((t) => {
  if (t.dataset.f && S.form) { S.form[t.dataset.f] = t.value; return true; }
  if (t.dataset.gq) { S.form.q = t.value; const pos = t.selectionStart; render(true); const n = document.getElementById('gq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } return true; }
  return false;
});
CHANGES.push((t) => { if (t.dataset.gsel) { S.form.sel[t.checked ? 'add' : 'delete'](t.dataset.gsel); render(true); return true; } return false; });
