// mypocketclub · alpha 4.7.0 · n° 147 : e-mail « Nouvel appareil » et « Ce n'était pas moi » ; n° 44 : « Se déconnecter de tous les appareils ».
// Chaque appareil garde un identifiant au hasard (rien de personnel). À la première ouverture connectée d'un compte sur un appareil,
// la base l'enregistre (register_device) ; si le compte avait déjà un autre appareil, elle prépare une alerte et la fonction
// envoyer-email écrit au propriétaire du compte. Le lien de l'e-mail (#pasmoi=…) coupe toutes les connexions (not_me_device).
import { S, sb, esc, run, toast, render, ACTIONS, FORMS, armed, isArmed } from './core.js';
import { BRAND } from '../config.js';
import { header, icon, field } from './ui.js';
import { unlinkPush } from './notif.js';
import { captcha } from './auth.js';
const unlink = () => Promise.race([unlinkPush().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]); // comme profils.js : jamais bloquant

export function deviceId() {
  try {
    let d = localStorage.getItem('pc_device');
    if (!d || d.length < 8) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, ''); localStorage.setItem('pc_device', d); }
    return d;
  } catch { return null; } // navigation privée : pas d'identifiant, pas d'alerte
}
export function deviceLabel(ua = navigator.userAgent) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
  return `${os} · ${br}`;
}
export async function registerDevice() {
  const d = deviceId(); if (!d || !S.session) return;
  try {
    const r = await sb.rpc('register_device', { p_device: d, p_label: deviceLabel() });
    const a = r?.data?.alert;
    if (a) await sb.functions.invoke('envoyer-email', { body: { new_device: { alert: a } } });
  } catch { /* jamais bloquant */ }
}

// ---------- « Ce n'était pas moi » (lien de l'e-mail) ----------
export const notMeToken = () => { const m = /^#pasmoi=([a-f0-9]{32,80})$/.exec(location.hash || ''); return m ? m[1] : null; };
export function notMeScreen() {
  const st = S.notme || {};
  const head = header({ brand: true, title: 'Ce n’était pas moi' });
  let b;
  if (st.done === undefined) b = `<div class="card"><p style="margin:0">Quelqu’un s’est connecté à ton compte ${esc(BRAND.name)} depuis un nouvel appareil, et ce n’était pas toi ?</p><p class="note">Ce bouton déconnecte ton compte de tous les appareils, y compris celui-ci. Ensuite, choisis un nouveau mot de passe.</p><button class="btn main" data-act="notme">${icon('lock', 20)}Déconnecter tous les appareils</button><button class="btn ghost" data-act="notmeno">C’était bien moi</button></div>`;
  else if (st.done === false) b = '<div class="card"><p style="margin:0">Ce lien n’est plus valable (déjà utilisé, ou plus de 7 jours). Si tu crains un piratage, change ton mot de passe : connecte-toi, puis Mon compte › « Changer mon mot de passe », ou « Mot de passe oublié ? » sur l’écran de connexion.</p><button class="btn" data-act="notmeno">Continuer</button></div>';
  else b = `<div class="card"><b>Tous les appareils sont déconnectés.</b><p class="note">Choisis maintenant un nouveau mot de passe : nous t’envoyons un lien par e-mail.</p><form id="notmef" class="stack">${field('nme', 'Ton adresse e-mail', '<input id="nme" name="email" type="email" required autocomplete="email">')}<button class="btn main" type="submit">Recevoir le lien</button></form>${st.sent ? '<p class="note">Si un compte existe avec cette adresse, l’e-mail est parti. Pense à regarder les indésirables.</p>' : ''}<button class="btn ghost" data-act="notmeno">Terminé</button></div>`;
  return head + `<main class="bd">${b}</main>`;
}
const leave = () => { history.replaceState(null, '', location.pathname + location.search); S.notme = null; render(); };
Object.assign(ACTIONS, {
  notme: async () => {
    const t = notMeToken(); if (!t) return leave();
    const r = await sb.rpc('not_me_device', { p_token: t });
    S.notme = { done: r?.data === true };
    if (r?.data === true && S.session) { await unlink(); await sb.auth.signOut({ scope: 'local' }); }
    render();
  },
  notmeno: () => leave(),
  // n° 44 : se déconnecter de tous les appareils (Mon compte)
  logoutall: async () => {
    if (!armed('logoutall')) return;
    await unlink();
    const { error } = await sb.auth.signOut({ scope: 'global' });
    if (error) { toast('Déconnexion impossible : réessaie.'); return; }
    toast('Déconnecté de tous les appareils.');
  },
});
FORMS.notmef = async (v) => {
  const em = String(v.email || '').trim(); if (!em) return;
  await sb.auth.resetPasswordForEmail(em, { redirectTo: location.href.split('#')[0], captchaToken: captcha() });
  S.notme = { ...(S.notme || {}), sent: true }; render(true);
};
export const logoutAllBtn = () => `<div class="sec"><h2>Sécurité</h2></div><div class="card"><button class="btn ${isArmed('logoutall') ? 'danger armed' : 'ghost'}" data-act="logoutall">${icon('lock', 20)}${isArmed('logoutall') ? 'Confirmer : me déconnecter partout' : 'Me déconnecter de tous les appareils'}</button><p class="note">Téléphones, tablettes et ordinateurs : il faudra te reconnecter partout, ici compris. Un e-mail te prévient quand ton compte s’ouvre sur un nouvel appareil.</p></div>`;
