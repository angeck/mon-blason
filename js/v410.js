// mypocketclub · alpha 4.10.0 : suite de la revue « Légal » du 10 novembre 2026.
//   n° 184 : « Appareils connus » dans Mon compte, avec « Retirer » (la base efface seule un appareil sans connexion depuis 12 mois) ;
//   n° 167 : doublons d’exercices (« Signaler un doublon », liste, « Fusionner » / « Pas un doublon ») ;
//   n° 185 : lien de désinscription des e-mails d'information (#desinscription=…), ouvert connecté ou non.
// (n° 181 : textes dans v310.js ; n° 182 : encart dans v43.js ; n° 183 : bouton d'accord dans joueur.js.)
import { S, sb, esc, run, toast, render, armed, isArmed, ACTIONS, INPUTS, norm } from './core.js';
import { BRAND } from '../config.js';
import { header, icon } from './ui.js';
import { deviceId } from './v47.js';

const dt = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// ---------- n° 184 · appareils connus ----------
export async function loadDevices() {
  if (!S.session) { S.devices = null; return; }
  try {
    const r = await sb.from('user_devices').select('device_id,label,first_seen,last_seen').order('last_seen', { ascending: false });
    S.devices = r.error ? null : (Array.isArray(r.data) ? r.data : []);
  } catch { S.devices = null; }
}
export function devicesCard() {
  const l = S.devices; if (!Array.isArray(l) || !l.length) return '';
  const me = deviceId();
  const rows = l.map((x) => {
    const id = String(x.device_id || '');
    const here = me && id === me;
    const on = isArmed('dev' + id);
    return `<div class="row static"><span class="g">${esc(x.label || 'Appareil')}${here ? ' · le tien' : ''}<small>Dernière connexion le ${esc(dt(x.last_seen))}</small></span><button class="btn small ${on ? 'danger armed' : 'ghost'}" data-act="devremove" data-id="${esc(id)}">${on ? 'Confirmer' : 'Retirer'}</button></div>`;
  }).join('');
  return `<div class="sec"><h2>Appareils connus</h2></div><div class="card"><div class="list">${rows}</div><p class="note">Un appareil qui ne s’est pas connecté depuis 12 mois est retiré de cette liste. « Retirer » l’enlève de la liste : il ne sera plus reconnu et pourra déclencher l’e-mail « Nouvel appareil » à sa prochaine connexion. Pour déconnecter tes appareils, utilise « Me déconnecter de tous les appareils ».</p></div>`;
}
Object.assign(ACTIONS, {
  devremove: async (el, d) => {
    if (!armed('dev' + d.id)) return;
    if (await run(sb.rpc('remove_my_device', { p_device: d.id }), 'Appareil retiré de la liste.')) { await loadDevices(); render(true); }
  },
});

// ---------- n° 185 · lien de désinscription des e-mails d'information ----------
export const unsubToken = () => { const m = /^#desinscription=([a-f0-9]{32,80})$/.exec(location.hash || ''); return m ? m[1] : null; };
export function unsubScreen() {
  const st = S.unsub || {};
  const head = header({ brand: true, title: 'E-mails d’information' });
  let b;
  if (st.done === undefined) b = `<div class="card"><p style="margin:0">Tu ne veux plus recevoir les e-mails d’information de ${esc(BRAND.name)} (rappels, nouveautés, relances) ?</p><p class="note">Les e-mails nécessaires (convocation, sécurité, changement d’un rendez-vous) continueront de partir.</p><button class="btn main" data-act="unsubgo">${icon('check', 20)}Me désinscrire</button><button class="btn ghost" data-act="unsubno">Garder ces e-mails</button></div>`;
  else if (st.done === false) b = `<div class="card"><p style="margin:0">Ce lien n’est pas valable. Tu peux régler ce choix dans l’application : Mon compte › « Mes accords » › « E-mails d’information ».</p><button class="btn" data-act="unsubno">Continuer</button></div>`;
  else b = `<div class="card"><b>C’est fait.</b><p class="note">Tu ne recevras plus les e-mails d’information. Tu peux changer d’avis à tout moment dans Mon compte › « Mes accords ».</p><button class="btn" data-act="unsubno">Terminé</button></div>`;
  return head + `<main class="bd">${b}</main>`;
}
const leave = () => { history.replaceState(null, '', location.pathname + location.search); S.unsub = null; render(); };
Object.assign(ACTIONS, {
  unsubgo: async () => {
    const t = unsubToken(); if (!t) return leave();
    let ok = false;
    try { const r = await sb.rpc('unsubscribe_info', { p_token: t }); ok = r?.data === true; } catch { ok = false; }
    S.unsub = { done: ok };
    if (ok) toast('Désinscription enregistrée.');
    render();
  },
  unsubno: () => leave(),
});

// ---------- n° 167 · doublons d'exercices : signalement, puis décision ----------
const DUPST = { signale: '<span class="pill wait">Signalé</span>', fusionne: '<span class="pill ok">Fusionné</span>', refuse: '<span class="pill">Pas un doublon</span>' };
export async function loadDuplicates() {
  const r = await sb.rpc('duplicates_list'); S.dups = Array.isArray(r.data) ? r.data : [];
}
// Sur la fiche d'un exercice : le bouton, puis le choix de l'autre exercice
export function dupBlock(e) {
  if (!S.exos || e.deleted_at) return '';
  if (S.dupFor !== e.id) return `<button class="btn ghost" data-act="dupstart" data-id="${e.id}">Signaler un doublon</button>`;
  const q = norm(S.dupQ || ''), words = norm(e.title).split(/\s+/).filter((w) => w.length > 3);
  const score = (x) => words.filter((w) => norm(x.title).includes(w)).length;
  const list = S.exos.filter((x) => x.id !== e.id && !x.deleted_at && (!q || norm(x.title).includes(q))).sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title)).slice(0, 8);
  return `<div class="card"><div class="kick">Quel exercice est le même ?</div>
    <div class="field"><label for="dupq">Chercher par nom</label><input id="dupq" type="search" data-dupq="1" value="${esc(S.dupQ || '')}" placeholder="Nom de l’autre exercice"></div>
    <div class="list">${list.map((x) => `<button class="row" data-act="dupsend" data-id="${e.id}" data-other="${x.id}"><span class="g">${esc(x.title)}<small>${esc(x.category)}${x.level ? ' · ' + esc(x.level) : ''}</small></span></button>`).join('') || '<p class="note">Aucun exercice trouvé.</p>'}</div>
    <p class="note">Le bureau (Directeur technique ou président) décide : fusionner ou « pas un doublon ». Tu verras sa décision ici.</p>
    <button class="btn ghost small" data-act="dupcancel">Annuler</button></div>`;
}
// Sur la page Exercices : les signalements à trancher et ceux que j'ai faits
export function dupListBlock() {
  const l = S.dups || []; if (!l.length) return '';
  const todo = l.filter((d) => d.can_decide).length;
  return `<div class="card${todo ? ' warn' : ''}"><b>Doublons signalés</b>${todo ? `<p class="note" style="color:var(--pc-encre)">${todo} à trancher.</p>` : ''}<div class="list">${l.map((d) => {
    const on = isArmed('dup' + d.id);
    return `<div class="row static"><span class="g">« ${esc(d.title)} » = « ${esc(d.other_title)} »<small>${esc(d.reported_by_name || '')} · ${esc(dt(d.reported_at))}</small></span>${DUPST[d.status] || ''}${d.can_decide ? `<button class="btn small ${on ? 'danger armed' : 'main'}" data-act="dupmerge" data-id="${d.id}">${on ? 'Confirmer la fusion' : 'Fusionner'}</button><button class="btn small ghost" data-act="dupno" data-id="${d.id}">Pas un doublon</button>` : ''}</div>`;
  }).join('')}</div><p class="note" style="color:var(--pc-encre)">« Fusionner » garde le second exercice : les séances qui utilisaient le premier pointent vers lui, et le premier part à la corbeille.</p></div>`;
}
Object.assign(ACTIONS, {
  dupstart: (el, d) => { S.dupFor = d.id; S.dupQ = ''; render(true); },
  dupcancel: () => { S.dupFor = null; render(true); },
  dupsend: async (el, d) => {
    if (await run(sb.rpc('report_duplicate', { p_exercise: d.id, p_other: d.other }), 'Doublon signalé. Le bureau décidera.')) { S.dupFor = null; await loadDuplicates(); render(true); }
  },
  dupmerge: async (el, d) => {
    if (!armed('dup' + d.id)) return;
    if (await run(sb.rpc('decide_duplicate', { p_id: d.id, p_merge: true }), 'Exercices fusionnés.')) { await loadDuplicates(); S.exosKey = null; await (await import('./coach.js')).ensureExos(); render(true); }
  },
  dupno: async (el, d) => {
    if (await run(sb.rpc('decide_duplicate', { p_id: d.id, p_merge: false }), 'Noté : ce n’est pas un doublon.')) { await loadDuplicates(); render(true); }
  },
});
INPUTS.push((t) => {
  if (!t.dataset.dupq) return false;
  S.dupQ = t.value; const pos = t.selectionStart; render(true);
  const n = document.getElementById('dupq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } }
  return true;
});
