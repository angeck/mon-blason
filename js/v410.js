// mypocketclub · alpha 4.10.0 : suite de la revue « Légal » du 10 novembre 2026.
//   n° 184 : « Appareils connus » dans Mon compte, avec « Retirer » (la base efface seule un appareil sans connexion depuis 12 mois) ;
//   n° 185 : lien de désinscription des e-mails d'information (#desinscription=…), ouvert connecté ou non.
// (n° 181 : textes dans v310.js ; n° 182 : encart dans v43.js ; n° 183 : bouton d'accord dans joueur.js.)
import { S, sb, esc, run, toast, render, armed, isArmed, ACTIONS } from './core.js';
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
