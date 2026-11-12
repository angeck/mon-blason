// mypocketclub · alpha 5.4.0 · lot A du 12 novembre 2026 (« go » de Gaël, 10 h 03).
// N° 201 : conversation avec un mineur : l'adulte ajoute un parent (choisi parmi les parents inscrits, ou invité par e-mail) ;
//          la conversation n'existe qu'une fois le parent d'accord (bloc « Demandes de conversation » de l'onglet Messages).
// N° 84  : rattacher un match d'une convocation reçue à un rendez-vous déjà dans l'agenda (même jour).
// Transfert d'une convocation reçue à des personnes choisies du club (date, heure, lieu ; jamais le contact de l'autre club).
// N° 182 : rappel par e-mail au président d'un club pas encore validé (déclenché à l'ouverture de l'application, voir app.js).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_5_4_0.sql) ; l'écran n'est qu'un confort.
import { S, sb, esc, hooks, run, toast, render, ACTIONS, FORMS, INPUTS, CHANGES, name, norm, plural, ROLES, teamName, fmtShort, hm } from './core.js';
import { header, field } from './ui.js';
import { V310_VIEWS } from './v310.js';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// ---------- n° 201 · demandes de conversation ----------
export async function loadV54() {
  if (!S.clubId) { S.grq = []; return; }
  const r = await sb.rpc('my_group_requests', { p_club: S.clubId });
  S.grq = !r.error && Array.isArray(r.data) ? r.data : [];
}
hooks.loadV54 = loadV54;

// Avant de créer un groupe libre : un mineur choisi sans son parent ? (true = le parcours du n° 201 prend la main)
hooks.minorStep = async (nm, ids) => {
  const r = await sb.rpc('group_minor_check', { p_club: S.clubId, p_users: ids });
  const l = !r.error && Array.isArray(r.data) ? r.data : [];
  if (!l.length) return false;
  if (l.length > 1) { toast(`Une conversation avec ${plural(l.length, 'mineur', 'mineurs')} : ajoute à la liste un parent de chacun (${l.map((x) => x.first_name).join(', ')}).`); return true; }
  const m = l[0], par = Array.isArray(m.parents) ? m.parents : [];
  S.grqForm = { name: nm, minor: m, members: ids.filter((u) => u !== m.user_id), parent: par.length === 1 ? par[0].user_id : '', mode: par.length ? 'liste' : 'email', email: '', prev: S.form };
  S.view = { type: 'grpreq' }; render();   // l'écran d'avant (le formulaire du groupe) est empilé par app.js
  return true;
};

function grqPage() {
  const f = S.grqForm; if (!f) return '<p class="empty">Rien à demander.</p>';
  const par = Array.isArray(f.minor.parents) ? f.minor.parents : [], first = esc(f.minor.first_name || 'Ce joueur');
  let h = `<div class="card lift"><div class="kick">Conversation avec un mineur</div>
  <p><b>${first}</b> est mineur. Une conversation avec un adulte n'est possible qu'avec un de ses parents.</p>
  <p class="note">La conversation « ${esc(f.name)} » sera créée quand le parent aura accepté. S'il refuse, ou sans réponse sous 14 jours, elle est annulée et tu es prévenu.</p></div>`;
  if (par.length) h += `<div class="chips"><button class="chip" data-act="grqmode" data-v="liste" aria-pressed="${f.mode === 'liste'}">Son parent inscrit</button><button class="chip" data-act="grqmode" data-v="email" aria-pressed="${f.mode === 'email'}">Inviter un parent par e-mail</button></div>`;
  if (f.mode === 'liste' && par.length) {
    h += `<div class="card">${par.map((x) => `<label class="check" style="padding:6px 0"><input type="radio" name="grqpar" data-grqpar="${x.user_id}" ${f.parent === x.user_id ? 'checked' : ''}><span>${esc(x.name || 'Parent')}</span></label>`).join('')}
    <button class="btn main" data-act="grqsend">Demander l'accord de ce parent</button></div>`;
  } else {
    h += `<div class="card">${field('grqm', `E-mail d'un parent de ${first}`, `<input id="grqm" type="email" data-grqm="1" value="${esc(f.email || '')}" autocomplete="off" placeholder="parent@exemple.fr">`)}
    <p class="note">Le parent reçoit un lien pour créer son compte ; le président valide son lien avec ${first}, puis le parent accepte ou refuse la conversation. L'adresse ne sert qu'à cette invitation et elle est effacée après 30 jours sans inscription. Ne la demande pas à l'enfant.</p>
    <button class="btn main" data-act="grqsend">Envoyer l'invitation</button></div>`;
  }
  return h;
}
V310_VIEWS.grpreq = () => ({ head: header({ back: true, kicker: 'Messages', title: 'Ajouter un parent' }), body: grqPage() });

const STATE = { attente: 'en attente du parent', acceptee: 'acceptée', refusee: 'refusée par le parent', annulee: 'annulée', expiree: 'sans réponse sous 14 jours' };
const recent = (x) => x.state === 'attente' || Date.now() - new Date(x.created_at).getTime() < 15 * 864e5;
hooks.grpReqBlock = () => {
  const l = (S.grq || []).filter((x) => x.to_answer || (x.mine && recent(x)));
  if (!l.length) return '';
  return `<div class="sec"><h2>Demandes de conversation</h2></div><div class="card"><div class="list">${l.map((x) => {
    const with_ = (x.members || []).filter(Boolean);
    if (x.to_answer) return `<div class="row static" style="display:block"><p style="margin:0"><b>${esc(x.creator)}</b> souhaite échanger avec <b>${esc(x.child_first)}</b> dans « ${esc(x.name)} ».</p>
      <p class="note" style="margin:4px 0 8px">${with_.length ? 'Avec ' + esc(with_.join(', ')) + ', toi' : 'Toi'} et ${esc(x.child_first)} y serez. La conversation n'existe qu'avec ton accord.</p>
      <div class="btns"><button class="btn small" data-act="grqyes" data-id="${x.id}">Accepter</button><button class="btn ghost small" data-act="grqno" data-id="${x.id}">Refuser</button></div></div>`;
    const wait = x.state === 'attente';
    return `<div class="row static" style="display:block"><p style="margin:0">« ${esc(x.name)} » avec ${esc(x.child_first)}</p>
      <p class="note" style="margin:4px 0 ${wait || x.group_id ? '8px' : '0'}">${STATE[x.state] || esc(x.state)}${wait && x.parent_label ? ' · ' + esc(x.parent_label) : ''}${wait && x.waiting_signup ? ' · le parent ne s’est pas encore inscrit' : ''}</p>
      ${wait ? `<div class="btns">${x.waiting_signup ? '' : `<button class="btn ghost small" data-act="grqrem" data-id="${x.id}">Relancer</button>`}<button class="btn ghost small" data-act="grqcancel" data-id="${x.id}">Annuler</button></div>`
        : x.group_id ? `<div class="btns"><button class="btn small" data-act="group" data-id="${x.group_id}">Ouvrir</button></div>` : ''}</div>`;
  }).join('')}</div></div>`;
};

Object.assign(ACTIONS, {
  grqmode: (el, d) => { S.grqForm.mode = d.v; render(true); },
  grqsend: async () => {
    const f = S.grqForm; if (!f) return;
    const viaMail = f.mode !== 'liste' || !f.parent, em = (f.email || '').trim();
    if (viaMail && !EMAIL.test(em)) return toast('Indique l’e-mail d’un parent.');
    const r = await run(sb.rpc('request_minor_group', { p_club: S.clubId, p_name: f.name, p_player: f.minor.player_id, p_parent: viaMail ? null : f.parent, p_email: viaMail ? em : null, p_members: f.members }));
    if (!r) return;
    if (r.invitation_id) {
      const m = await sb.functions.invoke('envoyer-email', { body: { parent_invite: { id: r.invitation_id } } });
      if (m.error) toast('La demande est notée, mais l’e-mail n’est pas parti. Réessaie plus tard ou préviens le parent.');
      else toast('Invitation envoyée. La conversation s’ouvrira quand le parent aura accepté.');
    } else toast('Demande envoyée au parent. La conversation s’ouvrira quand il aura accepté.');
    S.grqForm = null; S.form = null; S.stack = []; S.view = null; S.tab = 2; await loadV54(); render();
  },
  grqyes: async (el, d) => { const g = await run(sb.rpc('answer_group_request', { p_id: d.id, p_accept: true }), 'Conversation ouverte.'); if (g) { await loadV54(); if (ACTIONS.refresh) await ACTIONS.refresh(); if (ACTIONS.group) await ACTIONS.group(el, { id: g }); } },
  grqno: async (el, d) => { if (await run(sb.rpc('answer_group_request', { p_id: d.id, p_accept: false }), 'Conversation refusée : la personne qui l’a demandée est prévenue.') !== null) { await loadV54(); render(true); } },
  grqrem: async (el, d) => { if (await run(sb.rpc('remind_group_request', { p_id: d.id }), 'Relance envoyée au parent.') !== null) { await loadV54(); render(true); } },
  grqcancel: async (el, d) => { if (await run(sb.rpc('cancel_group_request', { p_id: d.id }), 'Demande annulée.') !== null) { await loadV54(); render(true); } },
});
INPUTS.push((t) => { if (t.dataset?.grqm && S.grqForm) { S.grqForm.email = t.value; return true; } if (t.dataset?.cvfq != null && S.cvf) { S.cvf.q = t.value; render(true); const n = document.getElementById('cvfq'); if (n) { n.focus(); const p = t.value.length; try { n.setSelectionRange(p, p); } catch { /* */ } } return true; } return false; });
CHANGES.push((t) => {
  if (t.dataset?.grqpar && S.grqForm) { S.grqForm.parent = t.dataset.grqpar; return true; }
  if (t.dataset?.cvfsel && S.cvf) { S.cvf.sel[t.checked ? 'add' : 'delete'](t.dataset.cvfsel); render(true); return true; }
  return false;
});

// ---------- n° 84 · rattacher un match reçu à un rendez-vous déjà créé ----------
const day = (d) => new Date(d).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
hooks.cvLinkBtns = (x, m) => {
  const c = S.events.filter((e) => !e.cancelled && ['Match', 'Plateau', 'Tournoi'].includes(e.type) && day(e.starts_at) === day(m.starts_at)).slice(0, 3);
  return c.map((e) => `<button class="btn ghost small" data-act="cvlink" data-send="${x.id}" data-src="${m.source_event_id}" data-ev="${e.id}">Rattacher à « ${esc(e.title)} » ${esc(hm(new Date(e.starts_at)))}</button>`).join('');
};
ACTIONS.cvlink = async (el, d) => {
  if (!await run(sb.rpc('link_convocation', { p_send: d.send, p_source: d.src, p_event: d.ev }), 'Match rattaché à ton rendez-vous.')) return;
  const r = await sb.rpc('convocation_received_events', { p_send: d.send });
  S.cvev = { id: d.send, list: Array.isArray(r.data) ? r.data : [] }; render(true);
};

// ---------- transférer une convocation reçue à des personnes du club ----------
hooks.cvFwdBtn = (x) => `<button class="row" data-act="cvfwd" data-id="${x.id}"><span class="g">Transférer<small>À des personnes du club : date, heure et lieu des matchs</small></span></button>`;
function people() {
  const m = new Map();
  S.members.filter((x) => x.status === 'active' && x.user_id !== S.me.id).forEach((x) => { if (!m.has(x.user_id)) m.set(x.user_id, x); });
  return [...m.values()].sort((a, b) => name(a.user_id).localeCompare(name(b.user_id), 'fr'));
}
function cvfPage() {
  const f = S.cvf; if (!f) return '<p class="empty">Document introuvable.</p>';
  const q = norm(f.q || ''), l = people().filter((x) => !q || norm(name(x.user_id)).includes(q));
  return `<div class="card lift"><p class="note">Les personnes choisies reçoivent une annonce avec les matchs (titre, jour, heure, lieu). Le contact de l'autre club n'y figure pas.</p>
  ${field('cvfq', `Personnes choisies (${f.sel.size})`, `<input id="cvfq" type="search" data-cvfq="1" value="${esc(f.q || '')}" placeholder="Rechercher un nom">`)}
  <div class="card flat" style="max-height:360px;overflow:auto;gap:0">${l.map((x) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-cvfsel="${x.user_id}" ${f.sel.has(x.user_id) ? 'checked' : ''}><span>${esc(name(x.user_id))} <span class="det">· ${ROLES[x.role] || ''}${x.team_id ? ' ' + esc(teamName(x.team_id)) : ''}</span></span></label>`).join('') || '<p class="empty">Personne.</p>'}</div>
  <button class="btn main" data-act="cvfsend">Transférer${f.sel.size ? ' à ' + plural(f.sel.size, 'personne', 'personnes') : ''}</button></div>`;
}
V310_VIEWS.cvfwd = () => ({ head: header({ back: true, kicker: 'Convocation reçue', title: 'Transférer' }), body: cvfPage() });
Object.assign(ACTIONS, {
  cvfwd: (el, d) => { S.cvf = { id: d.id, sel: new Set(), q: '' }; S.view = { type: 'cvfwd' }; render(); },
  cvfsend: async () => {
    const f = S.cvf; if (!f || !f.sel.size) return toast('Choisis au moins une personne.');
    const n = await run(sb.rpc('forward_convocation', { p_send: f.id, p_users: [...f.sel] }));
    if (n) { toast(`Convocation transférée à ${plural(n, 'personne', 'personnes')}.`); S.cvf = null; const v = (S.stack || []).pop() || null; if (v) delete v._y; S.view = v; S.noStack = true; render(); }
  },
});

// ---------- n° 182 · rappel de validation (la base dit seulement oui ou non ; la fonction d'envoi fait le reste) ----------
export async function validationReminders() {
  const r = await sb.rpc('validation_reminders_pending');
  if (r.data === true) await sb.functions.invoke('envoyer-email', { body: { validation_reminders: true } }).catch(() => {});
}
