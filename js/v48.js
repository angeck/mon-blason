// mypocketclub · alpha 4.8.0 · guide « Installer et notifications » (mise à jour d'avant la bêta, 10 novembre 2026).
// Une page par appareil : 1) mettre l'application sur l'écran d'accueil, 2) activer les notifications.
// Elle s'ouvre depuis l'encart de l'Accueil et depuis Mon compte. Les textes sont ici (ils passeront dans la base avec la FAQ).
// Le choix « Masquer » reste sur l'appareil : l'installation se fait appareil par appareil.
import { BRAND } from '../config.js';
import { S, esc, store, toast, render, ACTIONS } from './core.js';
import { header, icon } from './ui.js';
import { V37_TOP } from './v37.js';
import { N, isIOS, standalone, pushState } from './notif.js';

// Appareil reconnu : iphone, samsung (Samsung Internet), android (Chrome), ordi
export function device() {
  const ua = navigator.userAgent || '';
  if (isIOS()) return 'iphone';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Android/i.test(ua)) return 'android';
  return 'ordi';
}
const DEVICES = [['iphone', 'iPhone ou iPad'], ['android', 'Android (Chrome)'], ['samsung', 'Samsung Internet'], ['ordi', 'Ordinateur']];
const app = () => esc(BRAND.name);
const INSTALL = {
  iphone: () => ['Ouvre ' + app() + ' dans <b>Safari</b> (pas dans Chrome, ni dans une page ouverte depuis WhatsApp ou un e-mail).', 'Touche le bouton <b>Partager</b> : le carré avec une flèche vers le haut, en bas de l’écran.', 'Fais défiler la liste et touche <b>« Sur l’écran d’accueil »</b>.', 'Touche <b>« Ajouter »</b>, en haut à droite.', 'Ferme Safari et ouvre ' + app() + ' depuis sa nouvelle icône.'],
  android: () => ['Ouvre ' + app() + ' dans <b>Chrome</b>.', 'Touche les <b>trois points ⋮</b>, en haut à droite.', 'Touche <b>« Installer l’application »</b> (ou « Ajouter à l’écran d’accueil »).', 'Touche <b>« Installer »</b>.', 'Ouvre ' + app() + ' depuis sa nouvelle icône.'],
  samsung: () => ['Ouvre ' + app() + ' dans <b>Samsung Internet</b>.', 'Touche les <b>trois traits ≡</b>, en bas à droite.', 'Touche <b>« Ajouter la page à »</b> (ou « Ajouter à »), puis <b>« Écran d’accueil »</b>.', 'Touche <b>« Ajouter »</b>.', 'Ouvre ' + app() + ' depuis sa nouvelle icône.'],
  ordi: () => ['Ouvre ' + app() + ' dans <b>Chrome</b> ou <b>Edge</b>.', 'À droite de la barre d’adresse, clique l’icône d’installation : un écran avec une flèche.', 'Clique <b>« Installer »</b>.', app() + ' s’ouvre dans sa propre fenêtre, avec une icône sur ton ordinateur.'],
};
const steps = (l) => `<ol class="steps">${l.map((x) => `<li><span>${x}</span></li>`).join("")}</ol>`;

// Android et ordinateur : le navigateur peut proposer l'installation en un toucher
let prompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; if (S.view?.type === 'guide') render(true); });
addEventListener('appinstalled', () => { prompt = null; if (S.view?.type === 'guide') render(true); });

function notifPart() {
  const st = N.state;
  if (st === 'on') return '<div class="row static"><span class="g">Activées sur cet appareil<small>Rendez-vous, rappels, annonces et messages de tes clubs.</small></span><span class="pill ok">Oui</span></div>';
  if (st === 'ios-install') return '<p class="note">Sur iPhone, les notifications ne marchent qu’une fois l’application installée. Fais d’abord l’étape 1, ouvre l’application depuis son icône, puis reviens ici.</p>';
  if (st === 'denied') return `<p class="note">Les notifications sont bloquées pour ${app()} sur cet appareil. Pour les rouvrir : réglages du téléphone ou du navigateur, puis Notifications, puis ${app()}.</p>`;
  if (st === 'unsupported') return '<p class="note">Ce navigateur ne reçoit pas les notifications. Essaie avec Chrome, Edge, Firefox ou Safari à jour.</p>';
  return steps(['Touche le bouton ci-dessous (tu le retrouves aussi dans <b>Mon compte</b>).', 'Ton téléphone demande la permission : touche <b>« Autoriser »</b>.', 'C’est bon quand tu lis <b>« Activées sur cet appareil · Oui »</b>.'])
    + `<button class="btn main" data-act="pushon">${icon('plus', 20)}Activer les notifications</button>`;
}
function screen() {
  const det = device(), d = S.guideDev || det, done = standalone();
  let b = `<p class="note">Deux étapes, à faire une seule fois sur chaque appareil. Ensuite, ${app()} s’ouvre comme une application et te prévient des rendez-vous.</p>`;
  b += `<div class="chips" role="tablist" aria-label="Mon appareil">${DEVICES.map(([k, l]) => `<button class="chip" data-act="guidedev" data-v="${k}" aria-pressed="${k === d}">${l}${k === det ? ' · le tien' : ''}</button>`).join('')}</div>`;
  b += '<div class="sec"><h2>1 · Installer l’application</h2></div><div class="card">';
  if (done && d === det) b += '<div class="row static"><span class="g">Installée sur cet appareil<small>Tu l’as ouverte depuis son icône.</small></span><span class="pill ok">Oui</span></div>';
  else {
    b += steps(INSTALL[d]());
    if (prompt && d === det) b += `<button class="btn main" data-act="guideinstall">${icon('down', 20)}Installer l’application</button>`;
  }
  b += '</div>';
  b += `<div class="sec"><h2>2 · Activer les notifications</h2></div><div class="card">${d === det ? notifPart() : steps(['Ouvre l’application depuis son icône.', 'Va dans <b>Mon compte</b> (le bonhomme, en haut à droite).', 'Touche <b>« Activer les notifications »</b>, puis <b>« Autoriser »</b>.', 'C’est bon quand tu lis <b>« Activées sur cet appareil · Oui »</b>.'])}</div>`;
  b += `<div class="sec"><h2>Ce que tu recevras</h2></div><div class="card pale"><span class="kick">${app()} · exemple</span><b>Nouveau match prévu</b><span class="det">Match contre Lardy · samedi à 14 h 00 · Gymnase</span></div>`;
  b += `<div class="sec"><h2>Ça ne marche pas ?</h2></div>
  <details class="card"><summary>Je ne trouve pas « Sur l’écran d’accueil » (iPhone)</summary><p class="note">Tu n’es pas dans Safari. Si la page s’est ouverte depuis WhatsApp, Messenger ou un e-mail, touche « Ouvrir dans Safari » (ou copie le lien dans Safari), puis recommence l’étape 1.</p></details>
  <details class="card"><summary>J’ai refusé les notifications par erreur</summary><p class="note">Ouvre les réglages du téléphone, puis Notifications, puis ${app()}, et autorise-les. Reviens ensuite dans Mon compte.</p></details>
  <details class="card"><summary>Je ne reçois rien</summary><p class="note">Vérifie dans Mon compte que tu lis « Activées sur cet appareil · Oui ». Regarde aussi si le téléphone est en mode « Ne pas déranger » ou en économie d’énergie : ces modes retardent les notifications.</p></details>
  <details class="card"><summary>J’ai changé de téléphone</summary><p class="note">Refais les deux étapes sur le nouveau téléphone. Ton compte, tes clubs et tes réponses te suivent : il suffit de te connecter.</p></details>`;
  return header({ brand: true, back: true, kicker: 'Aide', title: 'Installer et notifications' }) + `<main class="bd">${b}</main>`;
}
Object.assign(V37_TOP, { guide: () => screen() });
Object.assign(ACTIONS, {
  guide: async () => { S.guideDev = null; S.view = { type: 'guide' }; render(); await pushState(); render(true); },
  guidedev: (el, d) => { S.guideDev = d.v; render(true); },
  guideinstall: async () => {
    if (!prompt) return toast('Suis les étapes ci-dessus : ton navigateur ne propose pas l’installation en un toucher.');
    const p = prompt; prompt = null; p.prompt();
    try { await p.userChoice; } catch { /* fenêtre fermée */ }
    render(true);
  },
  installhide: () => { store.set('pc_hideinstall', '1'); toast('Message masqué. Le guide reste dans « Mon compte ».'); render(true); },
});
