// mypocketclub · Mon compte : profil, autres rôles, clubs, mes données (export, suppression), déconnexion.
import { BRAND, VERSION } from '../config.js';
import { hooks, S, sb, esc, fl, roleLabel, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, ROLES, JOIN_ROLES, club, myMem, active, isBoard, isPresident, teamName, niceFirst, niceLast, download, fmtDay, store, coachTeams } from './core.js';
import { header, crest, icon, delBtn, field, THEMES, themeChoice, setThemeChoice } from './ui.js';
import { adminButtons } from './v43.js'; // n° 124 : « Clubs à valider »
import { adminsButton } from './v46.js'; // n° 148 : administrateurs
import { logoutAllBtn } from './v47.js'; // n° 44 et 147
import { devicesCard, loadDevices } from './v410.js'; // 4.10.0 : n° 184
import { mailTestBlock, contactLine } from './v38.js';
import { prepOff } from './v36.js';
import { roleExtra, checkRole, newPwdFields } from './auth.js';
import { pushCard } from './notif.js';
import { legalLinks, LEGAL } from './legal.js';

function roleRequest() {
  const r = S.rq, c = club(); if (!c) return '';
  const mine = myMem(), auto = r.role === 'supporteur' || isPresident();
  return `<details id="rqbox" class="card lift" ${r.open ? 'open' : ''}><summary data-act="rqopen">Demander un autre rôle dans ${esc(c.name)}</summary>
  <div class="det">Mes rôles : ${mine.filter((m) => m.status === 'active').map((m) => esc(roleLabel(m)) + (m.team_id ? ' ' + esc(teamName(m.team_id)) : '')).join(', ') || '—'}</div>
  ${mine.filter((m) => m.status === 'pending').map((m) => `<div class="row static"><span class="g">Demande en attente<small>${esc(roleLabel(m))}${m.team_id ? ' ' + esc(teamName(m.team_id)) : ''}</small></span><button class="btn small ghost" data-act="mcancel" data-id="${m.id}">Annuler la demande</button></div>`).join('')}
  <div class="chips">${JOIN_ROLES.map((x) => `<button class="chip" data-act="rqrole" data-v="${x}" aria-pressed="${r.role === x}">${ROLES[x]}</button>`).join('')}</div>
  ${roleExtra(r, 'r', S.teams)}
  <p class="note">${auto ? 'Accès immédiat.' : r.role === 'bureau' ? 'Validé par le président.' : r.role === 'coach' ? 'Validé par le président, le directeur technique ou le secrétariat.' : "Validé par le coach de l'équipe, le bureau ou le président."}</p>
  <button class="btn main" data-act="rqsend">Envoyer la demande</button></details>`;
}

export function accountScreen() {
  const clubs = Object.values(S.clubs), c = club(), me = S.me;
  let h = header({ back: !!S.clubId || S.isAdmin || S.adminAcct, kicker: 'Mon compte', title: esc(me.full_name || 'Mon compte'), brand: true }) + '<main class="bd">';
  if (c) h += `<button class="btn main" data-act="rqgo">${icon('plus', 20)}Demander un autre rôle dans ${esc(c.name)}</button>`;
  if (hooks.helpAccount) h += hooks.helpAccount(); // 5.5.0 : Aide (FAQ et « Pour bien démarrer »)
  if (hooks.attestAccount) h += hooks.attestAccount(); // 5.7.0 · n° 207 : demander une attestation de paiement
  h += `<div class="sec"><h2>Mon profil</h2></div><form id="proff" class="card"><div class="grid2">${field('pn', 'Prénom', `<input id="pn" name="first_name" value="${esc(me.first_name || '')}" required>`)}${field('pn2', 'Nom', `<input id="pn2" name="last_name" value="${esc(me.last_name || '')}" required>`)}</div>
  ${field('pp', 'Pseudo (affiché dans les groupes)', `<input id="pp" name="nickname" value="${esc(me.nickname || '')}" maxlength="30">`)}
  ${field('pm', 'Adresse e-mail', `<input id="pm" value="${esc(S.session.user.email)}" readonly>`)}
  ${field('pt', "Téléphone (visible de l'encadrement et des familles concernées)", `<input id="pt" name="phone" type="tel" value="${esc(me.phone || '')}">`)}
  <button class="btn main" type="submit">Enregistrer mon profil</button></form>`;
  h += themeCard(); // 5.0.0 : n° 168
  h += consentsCard(me); // n° 180
  h += roleRequest();
  h += benevolatCard();
  h += pushCard();
  // n° 42 : le président et les membres du bureau peuvent se déclarer contacts du club
  if (c && S.cstate) h += contactChoice(c); // n° 122 : la fonction décide du contact, je choisis seulement ce que je montre
  h += `<div class="sec"><h2>Mes clubs et profils</h2></div><div class="card"><div class="list">${clubs.map((x) => `<button class="row" data-act="club" data-id="${x.id}">${crest(x, 30)}<span class="g">${esc(x.name)}<small>${S.mems.filter((m) => m.club_id === x.id).map((m) => (m.role === 'bureau' && m.fonction ? fl(m.fonction) : ROLES[m.role]) + (m.status === 'pending' ? ' (en attente)' : '')).join(', ')}</small></span>${x.id === S.clubId ? '<span class="pill ok">Affiché</span>' : '<span class="chev"></span>'}</button>`).join('') || '<p class="empty">Aucun club pour l’instant.</p>'}</div></div>
  <button class="btn ghost" data-act="onbopen">Rejoindre ou créer un autre club</button>`;
  if (c) h += `<button class="btn ghost ${isArmed('leave') ? 'danger armed' : ''}" data-act="leave">${isArmed('leave') ? `Confirmer : quitter ${esc(c.name)}` : `Quitter ${esc(c.name)}`}</button>`;
  h += logoutAllBtn(); // n° 44
  h += devicesCard(); // 4.10.0 : n° 184, appareils connus
  h += `<details class="card"><summary>Changer mon mot de passe</summary><form id="npwf" class="stack">${newPwdFields('cp')}<button class="btn main" type="submit">Changer le mot de passe</button></form></details>
  <button class="btn" data-act="logout">${icon('back', 20)}Me déconnecter</button>`;
  if (coachTeams().length) h += `<div class="sec"><h2>Coach</h2></div><div class="card"><label class="check"><input type="checkbox" data-act="prepoff" ${prepOff() ? '' : 'checked'}><span>Me proposer « Prépare ta séance » sur l’Accueil, 3 jours avant chaque entraînement</span></label></div>`; // n° 88
  if (!S.isAdmin && hooks.adminAccount) h += hooks.adminAccount(); // 5.6.0 · n° 202 : compte administrateur sans le code à 6 chiffres
  if (S.isAdmin) h += `<div class="sec"><h2>Administration mypocketclub</h2></div><div class="card">${hooks.adminAccount ? hooks.adminAccount() : ''}${adminButtons()}${adminsButton()}<button class="btn" data-act="cschemas">${icon('doc', 20)}Demandes de schéma</button><p class="note">Exercices envoyés par les coachs : dépose la vidéo du schéma, l’exercice est mis à jour et le coach prévenu.</p><button class="btn" data-act="creqs">${icon('search', 20)}Demandes de clubs${S.creqNew ? ' · ' + S.creqNew + ' à traiter' : ''}</button><p class="note">« Mon club n’est pas dans la liste » : clubs demandés par les visiteurs et les membres ; tu contactes le club par e-mail.</p></div>` + mailTestBlock(); // n° 86, n° 107
  h += `<div class="sec"><h2>Mes données</h2></div><div class="card"><button class="btn ghost" data-act="export">${icon('down', 20)}Télécharger mes données</button><p class="note">Un fichier avec ton profil, tes rôles, les fiches de tes enfants, tes réponses, tes messages et tes votes.</p>
  ${delBtn('delacc', 'me', 'Supprimer mon compte', 'Confirmer : supprimer mon compte dans 30 jours', isArmed('delacc'))}<p class="note">Tu es retiré tout de suite de tes clubs et groupes. Pendant 30 jours, tu peux annuler en te reconnectant ; ensuite tout est effacé. Les fiches de joueurs restent au club.</p></div>
  <div class="sec"><h2>Mentions et données</h2></div>${legalLinks()}
  <p class="note" style="text-align:center">${esc(S.session.user.email)} · ${esc(BRAND.name)} ${esc(VERSION)}</p>${contactLine()}</main>`;
  return h;
}
// 5.0.0 · n° 168 : apparence, trois choix gardés sur l'appareil et dans le compte
const themeCard = () => `<div class="sec"><h2>Apparence</h2></div><div class="card" role="group" aria-label="Apparence de l'application"><div class="chips">${THEMES.map(([v, l]) => `<button type="button" class="chip" data-act="theme" data-v="${v}" aria-pressed="${themeChoice() === v}">${l}</button>`).join('')}</div><p class="note">« Comme mon téléphone » suit le réglage clair ou sombre de ton téléphone. Ton choix est gardé dans ton compte.</p></div>`;
Object.assign(ACTIONS, { theme: (el, d) => { setThemeChoice(d.v); render(true); } });
// N° 180 (4.9.0) : mes accords, datés ; enregistrés dès qu'on coche ou décoche
const dt = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
function consentsCard(me) {
  const line = (k, on, at, lab, sub) => `<label class="check"><input type="checkbox" data-consent="${k}" ${on ? 'checked' : ''}><span><b>${lab}</b><br><span class="det">${sub}${at ? ` · ${on ? 'accordé' : 'retiré'} le ${esc(dt(at))}` : ''}</span></span></label>`;
  return `<div class="sec"><h2>Mes accords</h2></div><div class="card">${line('image', me.image_ok, me.image_at, "Droit à l'image", "Mon club peut publier des photos ou vidéos où j'apparais. Pour un enfant, l'accord se donne sur sa fiche.")}${line('optin', me.optin_emails, me.optin_at, "E-mails d'information", 'Rappels, nouveautés, relances. Les e-mails nécessaires (convocation, sécurité, changement d’un rendez-vous) partent toujours.')}
  <p class="note">Conditions d'utilisation acceptées${me.cgu_at ? ' le ' + esc(dt(me.cgu_at)) : ''} (version ${esc(me.cgu_version || '')}). Textes en vigueur : version ${LEGAL.version} du ${LEGAL.date}.</p></div>`;
}
CHANGES.push(async (t) => {
  if (!t.dataset.consent) return false;
  const k = t.dataset.consent, on = t.checked;
  if (await run(sb.rpc('set_my_consents', { p_image: k === 'image' ? on : null, p_optin: k === 'optin' ? on : null }), on ? 'Accord enregistré.' : 'Accord retiré.')) await refresh();
  else t.checked = !on;
  return true;
});

// n° 69, 70 : rubrique Bénévolat toujours visible ; ligne grisée qui dit pourquoi quand on ne peut pas être bénévole
function benevolatCard() {
  const c = club(); if (!c) return '';
  const real = active().some((m) => m.role !== 'supporteur'), minor = S.players.some((p) => p.user_id === S.me.id && (!p.birth_date || new Date(p.birth_date) > new Date(Date.now() - 18 * 365.25 * 864e5)));
  let body;
  if (minor) body = '<p class="note">Le bénévolat est réservé aux adultes.</p>';
  else if (real) body = `<label class="check"><input type="checkbox" data-volunteer="1" ${S.me.volunteer === false ? '' : 'checked'}><span>Je participe au bénévolat du club<small class="det" style="display:block">Tu reçois les demandes « On cherche des bénévoles » et les relances.</small></span></label>`;
  else if (c.supporters_volunteer) body = `<label class="check"><input type="checkbox" data-supvol="1" ${S.me.supporter_volunteer ? 'checked' : ''}><span>Je participe au bénévolat du club<small class="det" style="display:block">Événements du club et matchs des équipes que tu suis.</small></span></label>`;
  else body = '<p class="note">Le club n’ouvre pas le bénévolat aux supporteurs.</p>';
  return `<div class="sec"><h2>Bénévolat</h2></div><div class="card" data-anchor="benevolat">${body}</div>`;
}
// Compte dont la suppression est demandée
export function deletedScreen() {
  const when = new Date(new Date(S.me.deleted_at).getTime() + 30 * 864e5);
  return header({ title: 'Compte en cours de suppression', brand: true }) + `<main class="bd"><div class="card warn"><b>Ton compte sera effacé le ${esc(fmtDay(when))}.</b><p class="note" style="color:var(--pc-texte-ecran)">Tu as été retiré de tes clubs et groupes. Tu peux encore tout annuler : tes profils et tes groupes reviennent.</p><button class="btn main" data-act="undelacc">Annuler la suppression</button></div><button class="btn ghost" data-act="export">${icon('down', 20)}Télécharger mes données</button><button class="btn ghost" data-act="logout">Me déconnecter</button></main>`;
}

Object.assign(ACTIONS, {
  account: () => { S.view = { type: 'account' }; S.attMine = undefined; render(); loadDevices().then(() => { if (S.view?.type === 'account') render(true); }); }, // 4.10.0 : la liste des appareils se charge à l'ouverture
  rqgo: () => { S.rq.open = true; S.view = { type: 'account' }; render(); setTimeout(() => document.getElementById('rqbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); },
  rqopen: () => { S.rq.open = !S.rq.open; render(true); },
  rqrole: (el, d) => { S.rq.role = d.v; render(true); },
  rqhide: () => { store.set('pc_hiderq_' + S.clubId, '1'); toast('Rappel masqué. Le bouton reste dans « Mon compte ».'); render(true); },
  mcancel: async (el, d) => { if (await run(sb.from('memberships').delete().eq('id', d.id).eq('user_id', S.me.id).eq('status', 'pending'), 'Demande annulée. Tu peux en faire une nouvelle.')) await refresh(); },
  rqsend: async () => {
    const r = S.rq; if (!checkRole(r)) return;
    const same = r.role !== 'parent' && myMem().find((m) => m.role === r.role && (m.team_id || '') === (r.team || '') && (r.role !== 'bureau' || (m.fonction || 'Membre du bureau') === (r.fonction || 'Membre du bureau')));
    if (same) return toast(same.status === 'active' ? `Tu es déjà ${ROLES[r.role].toLowerCase()}${r.team ? ' ' + teamName(r.team) : ''}.` : `Une demande est déjà en attente pour ${ROLES[r.role].toLowerCase()}${r.team ? ' ' + teamName(r.team) : ''} : tu peux l'annuler juste au-dessus.`);
    const auto = r.role === 'supporteur' || isPresident();
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
  if (await run(sb.from('profiles').update({ first_name: niceFirst(v.first_name), last_name: niceLast(v.last_name), nickname: (v.nickname || '').trim() || null, phone: (v.phone || '').trim() || null}).eq('id', S.me.id), 'Profil enregistré.')) await refresh();
};
INPUTS.push((t) => { if (t.dataset.r && t.type !== 'checkbox') { S.rq[t.dataset.r] = t.value; return true; } return false; });
// n° 66 : décocher le bénévolat demande confirmation ; le contact rencontres et le président sont prévenus (par la base)
CHANGES.push(async (t) => {
  if (!t.dataset.supvol) return false;
  if (await run(sb.rpc('set_supporter_volunteer', { p_on: t.checked }), t.checked ? 'Merci ! Tu participes au bénévolat du club.' : 'C’est noté.')) S.me.supporter_volunteer = t.checked; else t.checked = !t.checked;
  return true;
});
CHANGES.push(async (t) => {
  if (!t.dataset.volunteer) return false;
  const on = t.checked;
  if (!on && !confirm('Le club compte sur chacun pour aider au moins une fois dans la saison. Ne plus être sollicité ?')) { t.checked = true; return true; }
  if (await run(sb.rpc('set_volunteer', { p_on: on }), on ? 'Merci ! Tu participes au bénévolat du club.' : 'C’est noté : tu ne seras plus sollicité. Le contact rencontres et le président sont prévenus.')) S.me.volunteer = on; else t.checked = !on;
  return true;
});
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

// ---------- n° 122 · mes coordonnées de contact ----------
// Le président attribue la fonction ; la personne confirme ici ce qu'elle montre (téléphone, e-mail, les deux ou rien).
// Le choix vaut pour toutes ses fonctions du moment ; une nouvelle fonction demande une nouvelle confirmation.
function contactChoice(c) {
  const k = S.cstate, roles = k.roles.map(fl).join(', ');
  const box = (n, l, on) => `<label class="check"><input type="checkbox" name="${n}" ${on ? 'checked' : ''}><span>${l}</span></label>`;
  return `<form id="contactf" class="card ${k.confirmed ? '' : 'yellow'}" data-anchor="moncontact"><div class="kick">${k.confirmed ? 'Mes coordonnées de contact' : 'À confirmer'} · ${esc(c.name)}</div><b>${esc(roles)}</b>
  <p class="note" style="margin:0;color:var(--pc-texte-ecran)"><b>Choisis ce que les gens voient de toi :</b></p>
  ${box('phone', 'Mon téléphone' + (S.me.phone ? ' · ' + esc(S.me.phone) : ' (à ajouter dans « Mon profil »)'), k.show_phone)}${box('email', 'Mon adresse e-mail · ' + esc(S.session.user.email), k.show_email)}
  <button class="btn main" type="submit">${k.confirmed ? 'Enregistrer mon choix' : 'Confirmer mon choix'}</button><p class="note">Rien de coché : aucune coordonnée, on t’écrit par l’application. Tu peux changer à tout moment.</p>
  <p class="note" style="margin:0"><b>Qui le voit :</b> les membres du club (pas les supporteurs) voient le bureau ; les supporteurs et les visiteurs connectés voient le contact licences ; les clubs du même sport voient aussi le contact rencontres.</p></form>`; // n° 137 : d'abord le choix, ensuite qui le voit
}
Object.assign(FORMS, {
  contactf: async (v) => {
    if (await run(sb.rpc('confirm_contact', { p_club: S.clubId, p_phone: !!v.phone, p_email: !!v.email }), 'C’est noté.')) {
      if (v.phone && !S.me.phone) toast('Ajoute ton téléphone dans « Mon profil » pour qu’il apparaisse.');
      await refresh();
    }
  },
});
