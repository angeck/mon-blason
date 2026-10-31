// Pocket Club · Mon compte : profil, autres rôles, clubs, mes données (export, suppression), déconnexion.
import { BRAND, VERSION } from '../config.js';
import { S, sb, esc, roleLabel, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, ROLES, JOIN_ROLES, club, myMem, isBoard, isPresident, teamName, niceFirst, niceLast, download, fmtDay, store } from './core.js';
import { header, crest, icon, delBtn, field } from './ui.js';
import { roleExtra, checkRole, newPwdFields } from './auth.js';

function roleRequest() {
  const r = S.rq, c = club(); if (!c) return '';
  const mine = myMem(), auto = r.role === 'supporteur' || isPresident() || (r.role === 'coach' && isBoard());
  return `<details id="rqbox" class="card lift" ${r.open ? 'open' : ''}><summary data-act="rqopen">Demander un autre rôle dans ${esc(c.name)}</summary>
  <div class="det">Mes rôles : ${mine.filter((m) => m.status === 'active').map((m) => esc(roleLabel(m)) + (m.team_id ? ' ' + esc(teamName(m.team_id)) : '')).join(', ') || '—'}</div>
  ${mine.filter((m) => m.status === 'pending').map((m) => `<div class="row static"><span class="g">Demande en attente<small>${esc(roleLabel(m))}${m.team_id ? ' ' + esc(teamName(m.team_id)) : ''}</small></span><button class="btn small ghost" data-act="mcancel" data-id="${m.id}">Annuler la demande</button></div>`).join('')}
  <div class="chips">${JOIN_ROLES.map((x) => `<button class="chip" data-act="rqrole" data-v="${x}" aria-pressed="${r.role === x}">${ROLES[x]}</button>`).join('')}</div>
  ${roleExtra(r, 'r', S.teams)}
  <p class="note">${auto ? 'Accès immédiat.' : r.role === 'bureau' ? 'Validé par le président.' : r.role === 'coach' ? 'Validé par le bureau ou le président.' : "Validé par le coach de l'équipe, le bureau ou le président."}</p>
  <button class="btn main" data-act="rqsend">Envoyer la demande</button></details>`;
}

export function accountScreen() {
  const clubs = Object.values(S.clubs), c = club(), me = S.me;
  let h = header({ back: !!S.clubId, kicker: 'Mon compte', title: esc(me.full_name || 'Mon compte'), brand: true }) + '<main class="bd">';
  if (c) h += `<button class="btn main" data-act="rqgo">${icon('plus', 20)}Demander un autre rôle dans ${esc(c.name)}</button>`;
  h += `<div class="sec"><h2>Mon profil</h2></div><form id="proff" class="card"><div class="grid2">${field('pn', 'Prénom', `<input id="pn" name="first_name" value="${esc(me.first_name || '')}" required>`)}${field('pn2', 'Nom', `<input id="pn2" name="last_name" value="${esc(me.last_name || '')}" required>`)}</div>
  ${field('pp', 'Pseudo (affiché dans les groupes)', `<input id="pp" name="nickname" value="${esc(me.nickname || '')}" maxlength="30">`)}
  ${field('pm', 'Adresse e-mail', `<input id="pm" value="${esc(S.session.user.email)}" readonly>`)}
  ${field('pt', "Téléphone (visible de l'encadrement et des familles concernées)", `<input id="pt" name="phone" type="tel" value="${esc(me.phone || '')}">`)}
  <label class="check"><input type="checkbox" name="optin" ${me.optin_emails ? 'checked' : ''}><span>Recevoir les e-mails d'information de ${esc(BRAND.name)}</span></label>
  <button class="btn main" type="submit">Enregistrer mon profil</button></form>`;
  h += roleRequest();
  // n° 42 : le président et les membres du bureau peuvent se déclarer contacts du club
  if (c && isBoard()) {
    const k = S.myContact || {}, box = (n, l) => `<label class="check"><input type="checkbox" data-contact="${n}" ${k[n] ? 'checked' : ''}><span>${l}</span></label>`;
    h += `<details class="card" ${k.for_licence || k.for_matches ? 'open' : ''}><summary>Contact du club (${esc(c.name)})</summary>${box('for_licence', 'Contact pour les demandes de licence')}${box('for_matches', 'Contact pour la planification des matchs')}<div class="kick">Moyens visibles</div>${box('show_phone', 'Mon téléphone' + (S.me.phone ? ' · ' + esc(S.me.phone) : ''))}${box('show_email', 'Mon adresse e-mail · ' + esc(S.session.user.email))}${(k.for_licence || k.for_matches) && k.show_phone && !S.me.phone ? '<div class="card warn"><b>Ajoute ton téléphone dans « Mon profil » ci-dessus pour qu’il apparaisse.</b></div>' : ''}<p class="note">Tes coordonnées seront visibles des membres et des autres clubs connectés. Tu peux les retirer à tout moment.</p></details>`;
  }
  h += `<div class="sec"><h2>Mes clubs et profils</h2></div><div class="card"><div class="list">${clubs.map((x) => `<button class="row" data-act="club" data-id="${x.id}">${crest(x, 30)}<span class="g">${esc(x.name)}<small>${S.mems.filter((m) => m.club_id === x.id).map((m) => ROLES[m.role] + (m.status === 'pending' ? ' (en attente)' : '')).join(', ')}</small></span>${x.id === S.clubId ? '<span class="pill ok">Affiché</span>' : '<span class="chev"></span>'}</button>`).join('') || '<p class="empty">Aucun club pour l’instant.</p>'}</div></div>
  <button class="btn ghost" data-act="onbopen">Rejoindre ou créer un autre club</button>`;
  if (c) h += `<button class="btn ghost ${isArmed('leave') ? 'danger armed' : ''}" data-act="leave">${isArmed('leave') ? `Confirmer : quitter ${esc(c.name)}` : `Quitter ${esc(c.name)}`}</button>`;
  h += `<details class="card"><summary>Changer mon mot de passe</summary><form id="npwf" class="stack">${newPwdFields('cp')}<button class="btn main" type="submit">Changer le mot de passe</button></form></details>
  <button class="btn" data-act="logout">${icon('back', 20)}Me déconnecter</button>`;
  h += `<div class="sec"><h2>Mes données</h2></div><div class="card"><button class="btn ghost" data-act="export">${icon('down', 20)}Télécharger mes données</button><p class="note">Un fichier avec ton profil, tes rôles, les fiches de tes enfants, tes réponses, tes messages et tes votes.</p>
  ${delBtn('delacc', 'me', 'Supprimer mon compte', 'Confirmer : supprimer mon compte dans 30 jours', isArmed('delacc'))}<p class="note">Tu es retiré tout de suite de tes clubs et groupes. Pendant 30 jours, tu peux annuler en te reconnectant ; ensuite tout est effacé. Les fiches de joueurs restent au club.</p></div>
  <button class="btn ghost" data-act="legal">Mentions légales, confidentialité et conditions</button>
  <p class="note" style="text-align:center">${esc(S.session.user.email)} · ${esc(BRAND.name)} ${esc(VERSION)}</p></main>`;
  return h;
}
// Compte dont la suppression est demandée
export function deletedScreen() {
  const when = new Date(new Date(S.me.deleted_at).getTime() + 30 * 864e5);
  return header({ title: 'Compte en cours de suppression', brand: true }) + `<main class="bd"><div class="card warn"><b>Ton compte sera effacé le ${esc(fmtDay(when))}.</b><p class="note" style="color:var(--pc-encre)">Tu as été retiré de tes clubs et groupes. Tu peux encore tout annuler : tes profils et tes groupes reviennent.</p><button class="btn main" data-act="undelacc">Annuler la suppression</button></div><button class="btn ghost" data-act="export">${icon('down', 20)}Télécharger mes données</button><button class="btn ghost" data-act="logout">Me déconnecter</button></main>`;
}

Object.assign(ACTIONS, {
  account: () => { S.view = { type: 'account' }; render(); },
  rqgo: () => { S.rq.open = true; S.view = { type: 'account' }; render(); setTimeout(() => document.getElementById('rqbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); },
  rqopen: () => { S.rq.open = !S.rq.open; render(true); },
  rqrole: (el, d) => { S.rq.role = d.v; render(true); },
  rqhide: () => { store.set('pc_hiderq_' + S.clubId, '1'); toast('Rappel masqué. Le bouton reste dans « Mon compte ».'); render(true); },
  mcancel: async (el, d) => { if (await run(sb.from('memberships').delete().eq('id', d.id).eq('user_id', S.me.id).eq('status', 'pending'), 'Demande annulée. Tu peux en faire une nouvelle.')) await refresh(); },
  rqsend: async () => {
    const r = S.rq; if (!checkRole(r)) return;
    const same = r.role !== 'parent' && myMem().find((m) => m.role === r.role && (m.team_id || '') === (r.team || '') && (r.role !== 'bureau' || (m.fonction || 'Membre du bureau') === (r.fonction || 'Membre du bureau')));
    if (same) return toast(same.status === 'active' ? `Tu es déjà ${ROLES[r.role].toLowerCase()}${r.team ? ' ' + teamName(r.team) : ''}.` : `Une demande est déjà en attente pour ${ROLES[r.role].toLowerCase()}${r.team ? ' ' + teamName(r.team) : ''} : tu peux l'annuler juste au-dessus.`);
    const auto = r.role === 'supporteur' || isPresident() || (r.role === 'coach' && isBoard());
    if (r.role === 'bureau') { if (await run(sb.rpc('request_bureau', { p_club: S.clubId, p_code: null, p_fonction: r.fonction || 'Membre du bureau' }), isPresident() ? 'Fonction ajoutée.' : 'Demande envoyée au président.')) { S.rq = { role: 'joueur', team: '', open: false }; await refresh(); } return; }
    if (await run(sb.rpc('join_club', { p_code: club().join_code, p_role: r.role, p_team: r.team || null, p_child_first: r.childf || null, p_child_last: r.childl || null }), auto ? 'Rôle ajouté.' : 'Demande envoyée.')) { S.rq = { role: 'joueur', team: '', open: false }; await refresh(); }
  },
  club: async (el, d) => { S.clubId = d.id; store.set('pc_club', d.id); S.tab = 0; S.view = null; S.names = {}; await refresh(); },
  leave: async () => { if (!armed('leave')) return; if (await run(sb.from('memberships').delete().eq('club_id', S.clubId).eq('user_id', S.me.id), 'Tu as quitté le club.')) { S.clubId = null; S.tab = 0; S.view = null; await refresh(); } },
  export: async () => {
    const d = await run(sb.rpc('export_my_data')); if (!d) return;
    download(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }), 'mes-donnees-' + new Date().toISOString().slice(0, 10) + '.json');
    toast('Fichier de tes données prêt.');
  },
  delacc: async () => { if (!armed('delacc')) return; const r = await run(sb.rpc('delete_my_account')); if (r) { toast('Suppression demandée. Tu peux annuler pendant 30 jours.'); S.view = null; await refresh(); } },
  undelacc: async () => { if (await run(sb.rpc('cancel_account_deletion'), 'Suppression annulée. Bon retour !')) await refresh(); },
});
FORMS.proff = async (v) => {
  if (!v.first_name.trim() || !v.last_name.trim()) return toast('Le prénom et le nom sont obligatoires.');
  if (await run(sb.from('profiles').update({ first_name: niceFirst(v.first_name), last_name: niceLast(v.last_name), nickname: (v.nickname || '').trim() || null, phone: (v.phone || '').trim() || null, optin_emails: !!v.optin }).eq('id', S.me.id), 'Profil enregistré.')) await refresh();
};
INPUTS.push((t) => { if (t.dataset.r && t.type !== 'checkbox') { S.rq[t.dataset.r] = t.value; return true; } return false; });
CHANGES.push(async (t) => {
  if (!t.dataset.contact) return false;
  const k = t.dataset.contact, first = !S.myContact || (!S.myContact.for_licence && !S.myContact.for_matches);
  const row = { ...(S.myContact || { for_licence: false, for_matches: false, show_phone: false, show_email: false }), club_id: S.clubId, user_id: S.me.id, [k]: t.checked, updated_at: new Date().toISOString() };
  // n° 48 : téléphone et e-mail visibles par défaut quand on devient contact (décochables)
  if (t.checked && first && ['for_licence', 'for_matches'].includes(k) && !row.show_phone && !row.show_email) { row.show_phone = true; row.show_email = true; }
  if (await run(sb.from('club_contacts').upsert(row), t.checked ? 'Enregistré.' : 'Retiré.')) { S.myContact = row; const cl = await sb.rpc('club_contacts_list', { p_club: S.clubId }); if (!cl.error) S.contacts = cl.data || []; render(true); if (t.checked && row.show_phone && !S.me.phone) toast('Ajoute ton téléphone dans « Mon profil » pour qu’il apparaisse.'); } else t.checked = !t.checked;
  return true;
});
CHANGES.push((t) => { if (t.dataset.r) { S.rq[t.dataset.r] = t.type === 'checkbox' ? t.checked : t.value; return true; } return false; });
