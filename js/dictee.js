// mypocketclub · bêta 1.2.0 (1.2.2 : n° 266, morceaux répétés sur Android) · dictée au micro (n° 265 et « Dis-le à Claude » du n° 245)
// La voix devient du texte dans le champ, grâce à la dictée du navigateur (Chrome, Samsung, Safari). Aucun son n'est gardé par mypocketclub.
// Sur Chrome et Samsung, la voix est transformée en texte par le service de Google (texte « Vos données »). Sans dictée (Firefox) : pas de bouton.
import { toast, ACTIONS } from './core.js';
import { icon } from './ui.js';

const Rec = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = () => !!Rec();
let rec = null, target = '', base = '';

// 1.2.2 · n° 266 : Chrome sur Android renvoie la même phrase en morceaux qui s'allongent (« J'ai », « J'ai commencé »…) ;
// les coller bout à bout répétait la phrase. Un morceau qui prolonge le texte le remplace, un morceau déjà dit est ignoré,
// un morceau nouveau (ordinateur : une phrase après l'autre) s'ajoute.
const flat = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
export function mergeResults(list) {
  let out = '';
  for (const raw of list) {
    const t = String(raw || '').trim(); if (!t) continue;
    const a = flat(out), b = flat(t);
    if (!b) continue;
    if (b.startsWith(a)) out = t;
    else if (a.includes(b)) continue;
    else out = out + ' ' + t;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const label = (on, txt) => (on ? 'J’écoute… touche pour arrêter' : txt);
// Bouton à poser sous un champ (input ou textarea) : data-for = l'id du champ
// 1.2.2 · n° 265 : note = une ligne sous le bouton (la voix passe par Google ou Apple ; pas de nom de joueur), une fois par écran
export function micBtn(id, txt = 'Dicter', note = false) {
  if (!canDictate()) return '';
  const on = !!rec && target === id;
  return `<button type="button" class="btn small ghost mic${on ? ' on' : ''}" data-act="mic" data-for="${id}" data-txt="${txt}" aria-pressed="${on}">${icon('mic', 18)}<span>${label(on, txt)}</span></button>${note ? '<p class="note micnote">Ta voix passe par la dictée de ton navigateur (Google ou Apple), qui la transforme en texte. Évite de dicter le nom d’un joueur.</p>' : ''}`;
}
function paint() {
  document.querySelectorAll('[data-act=mic]').forEach((b) => {
    const on = !!rec && b.dataset.for === target;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    const sp = b.querySelector('span'); if (sp) sp.textContent = label(on, b.dataset.txt || 'Dicter');
  });
}
export function stopDictation() { if (rec) { try { rec.stop(); } catch { /* déjà arrêtée */ } } }
function start(id) {
  const el = document.getElementById(id); if (!el) return;
  const R = Rec(); if (!R) return toast('La dictée n’existe pas dans ce navigateur. Utilise le micro du clavier.');
  const r = new R(); r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true;
  rec = r; target = id; base = el.value; paint();
  r.onresult = (e) => {
    const f = document.getElementById(target); if (!f) { stopDictation(); return; }
    const said = mergeResults(Array.from(e.results, (x) => x[0].transcript)); if (!said) return;
    const sep = base && !/\s$/.test(base) ? ' ' : '';
    const max = +f.getAttribute('maxlength') || 4000;
    f.value = (base + sep + said.charAt(0).toUpperCase() + said.slice(1)).slice(0, max);
    f.dispatchEvent(new Event('input', { bubbles: true }));
  };
  r.onerror = (e) => {
    const m = { 'not-allowed': 'Autorise le micro pour mypocketclub dans les réglages du navigateur.', 'service-not-allowed': 'Autorise le micro pour mypocketclub dans les réglages du navigateur.',
      'no-speech': 'Je n’ai rien entendu. Touche le micro et parle.', network: 'La dictée a besoin d’une connexion.', 'audio-capture': 'Aucun micro trouvé sur cet appareil.' }[e.error];
    if (m) toast(m);
  };
  r.onend = () => { if (rec === r) { rec = null; target = ''; paint(); } };
  try { r.start(); } catch { rec = null; target = ''; paint(); toast('La dictée n’a pas pu démarrer. Réessaie.'); }
}
ACTIONS.mic = (el, d) => { const id = d.for; if (rec && target === id) { stopDictation(); return; } if (rec) stopDictation(); start(id); };
