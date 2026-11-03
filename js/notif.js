// mypocketclub · notifications sur le téléphone (étape B, partie application).
// Chaque appareil s'inscrit une fois (« Activer les notifications ») ; l'inscription est rangée dans la base
// (fonction push_subscribe, ajoutée par le script de l'étape 2) et rattachée au compte connecté.
// Une seule activation vaut pour tous les profils et tous les clubs du compte.
import { VAPID_PUBLIC_KEY, BRAND, SWITCH_PROFILES } from '../config.js';
import { S, sb, store, toast, render, ACTIONS, CHANGES } from './core.js';
import { icon } from './ui.js';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = (b64) => { const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
// Le service worker peut ne jamais être prêt (navigation privée, test) : on n'attend pas plus de 4 secondes
const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, ko) => setTimeout(() => ko(new Error('sw')), 4000))]);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const N = { state: 'loading', sub: null, saved: false };

// État de cet appareil : ios-install (iPhone non installé), unsupported, denied, on, off
export async function pushState() {
  if (!VAPID_PUBLIC_KEY) N.state = 'unsupported';
  else if (isIOS() && !standalone()) N.state = 'ios-install';
  else if (!supported()) N.state = 'unsupported';
  else if (Notification.permission === 'denied') N.state = 'denied';
  else {
    try { const reg = await ready(); N.sub = await reg.pushManager.getSubscription(); N.state = N.sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch { N.sub = null; N.state = 'unsupported'; }
  }
  return N.state;
}

// Range l'inscription de cet appareil dans la base, pour le compte connecté.
// Tant que le script de l'étape 2 n'est pas lancé, la fonction n'existe pas : on réessaiera à la prochaine ouverture.
// N° 62 : comptes de test (liste « Profil de test ») ; option « Garder ce téléphone inscrit pour tous mes profils de test »
const testProfile = () => SWITCH_PROFILES.find((p) => p.email.toLowerCase() === (S.session?.user?.email || '').toLowerCase());
export const keepAll = () => !!testProfile() && store.get('pc_push_keep') === '1';
// Inscription vérifiée auprès de la base à chaque ouverture (une fois par compte et par session de l'application) :
// avant, une inscription gardée en mémoire sur le téléphone pouvait avoir été remplacée par un autre profil de test.
async function save(sub) {
  if (!S.me || !sub) return false;
  const j = sub.toJSON(), k = S.me.id + '|' + j.endpoint + '|' + keepAll();
  if (N.savedKey === k) return (N.saved = true);
  const { error } = await sb.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh || b64(sub.getKey('p256dh')), p_auth: j.keys?.auth || b64(sub.getKey('auth')), p_agent: navigator.userAgent.slice(0, 200), p_keep: keepAll(), p_label: keepAll() ? testProfile().label : '' });
  if (error) { console.info('Notifications : inscription en attente côté serveur', error.message); return (N.saved = false); }
  N.savedKey = k; return (N.saved = true);
}

// À chaque ouverture : si l'appareil est inscrit, on s'assure qu'il est bien rattaché au compte connecté
export async function syncPush() {
  if ((await pushState()) === 'on') await save(N.sub);
}

// Avant de se déconnecter : l'appareil cesse de recevoir les notifications de ce compte
export async function unlinkPush() {
  try {
    if (!supported()) return;
    const reg = await ready(), sub = await reg.pushManager.getSubscription(); if (!sub) return;
    if (keepAll()) return;   // option des comptes de test : le téléphone reste inscrit pour chaque profil
    await sb.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
    N.savedKey = null;
  } catch { /* hors ligne : la base nettoiera les inscriptions périmées */ }
}

// Encadré dans Mon compte
export function pushCard() {
  const st = N.state;
  let body;
  if (st === 'loading') body = '<p class="note">Vérification…</p>';
  else if (st === 'on') body = `<div class="row static"><span class="g">Activées sur cet appareil<small>Rendez-vous, rappels, annonces et messages de tes clubs.</small></span><span class="pill ok">Oui</span></div><button class="btn small ghost" data-act="pushoff">Couper sur cet appareil</button>`
    + (testProfile() ? `<label class="check"><input type="checkbox" data-pushkeep="1" ${keepAll() ? 'checked' : ''}><span>Garder ce téléphone inscrit pour tous mes profils de test<small class="det" style="display:block">Chaque profil ouvert au moins une fois ici reçoit ses notifications, avec son nom en tête (« Président · … »).</small></span></label>` : '');
  else if (st === 'off') body = `<p class="note">Reçois les nouveaux rendez-vous, les rappels et les annonces même quand ${BRAND.name} est fermé. Une seule fois sur cet appareil, pour tous tes clubs.</p><button class="btn main" data-act="pushon">${icon('plus', 20)}Activer les notifications</button>`;
  else if (st === 'ios-install') body = `<p class="note">Sur iPhone, installe d'abord ${BRAND.name} sur l'écran d'accueil : bouton Partager, puis « Sur l'écran d'accueil ». Ouvre ensuite l'application depuis son icône et reviens ici.</p>`;
  else if (st === 'denied') body = `<p class="note">Les notifications sont bloquées pour ${BRAND.name} sur cet appareil. Pour les rouvrir : réglages du téléphone ou du navigateur, puis Notifications, puis ${BRAND.name}.</p>`;
  else body = '<p class="note">Ce navigateur ne reçoit pas les notifications. Essaie avec Chrome, Edge, Firefox ou Safari à jour.</p>';
  return `<div class="sec"><h2>Notifications</h2></div><div class="card">${body}</div>`;
}

// Encart en tête de l'Accueil, à chaque ouverture, tant que la personne n'a fait aucun choix sur cet appareil :
// activer (l'encart disparaît) ou « Masquer le message » (pc_hidepush, l'encart disparaît aussi).
// Ensuite, les notifications restent réglables dans Mon compte.
export function pushHome() {
  if (!['off', 'ios-install'].includes(N.state) || store.get('pc_hidepush')) return '';
  const msg = N.state === 'off' ? 'Active les notifications pour ne rater aucun rendez-vous.' : `Installe ${BRAND.name} sur l'écran d'accueil pour recevoir les notifications.`;
  return `<div class="card pale"><b>${msg}</b><div class="btns">${N.state === 'off' ? '<button class="btn small main" data-act="pushon">Activer</button>' : '<button class="btn small main" data-act="account">Comment faire</button>'}<button class="btn small ghost" data-act="pushhide">Masquer le message</button></div></div>`;
}

CHANGES.push(async (t) => {
  if (!t.dataset.pushkeep) return false;
  store.set('pc_push_keep', t.checked ? '1' : ''); N.savedKey = null;
  await syncPush(); toast(t.checked ? 'Ce téléphone reste inscrit pour chaque profil de test que tu ouvres ici.' : 'Ce téléphone ne suit plus que le profil ouvert.'); render(true);
  return true;
});
Object.assign(ACTIONS, {
  pushon: async () => {
    if (!supported()) return toast('Ce navigateur ne reçoit pas les notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { await pushState(); render(true); return toast(perm === 'denied' ? 'Notifications refusées. Tu peux les rouvrir dans les réglages du téléphone.' : 'Pas de changement.'); }
    try {
      const reg = await ready();
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
      N.sub = sub; N.state = 'on';
      toast((await save(sub)) ? 'Notifications activées sur cet appareil.' : 'Activé sur cet appareil. Les envois démarreront bientôt.');
    } catch (e) { console.error(e); toast("L'activation n'a pas abouti. Réessaie dans un instant."); }
    render(true);
  },
  pushoff: async () => {
    await unlinkPush();
    try { await N.sub?.unsubscribe(); } catch { /* */ }
    N.sub = null; N.state = 'off'; store.set('pc_hidepush', '1'); toast('Notifications coupées sur cet appareil.'); render(true);
  },
  pushhide: () => { store.set('pc_hidepush', '1'); toast('Message masqué. Tu pourras activer les notifications quand tu veux dans « Mon compte ».'); render(true); },
});
