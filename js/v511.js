// mypocketclub · alpha 5.11.0
//   n° 227 : « Banque d'exercices » dans le menu de gauche, sous « Mes rôles » (ordinateur seulement ; rien ne change sur téléphone).
//            L'entrée mène à tous les exercices publics (recherche et filtres), puis les sous-entrées :
//            Tous les clubs · Exercices du club · et, pour un coach ou le bureau : Mes exercices · Mes séances · Nouvel exercice.
import { S, hooks, ACTIONS, esc, isBoard, isCoach } from './core.js';
import { icon } from './ui.js';

const staff = () => isBoard() || isCoach();
// 5.15.1 · n° 247 : le bloc devient « Carnet du coach » (coachs et bureau seulement) : exercices, tactiques, séances
const SUBS = () => [['libre', 'Exercices · tous les clubs'], ['club', 'Exercices du club'], ['mine', 'Mes exercices'], ['tac', 'Tactiques'], ['plans', 'Mes séances'], ['new', 'Nouvel exercice']];

// Entrée allumée : l'écran ouvert depuis la banque
function current() {
  const t = S.view?.type;
  if (t === 'exos') return S.ctab === 'seance' ? '' : (staff() ? S.ctab || 'mine' : ['club', 'libre'].includes(S.ctab) ? S.ctab : 'libre');
  if (t === 'plans') return 'plans';
  if (['tactics', 'tac', 'tacshow', 'terrain'].includes(t)) return 'tac';
  if (t === 'exoform' && !S.exf?.id) return 'new';
  return '';
}
hooks.bankNav = () => {
  if (!S.clubId || !S.me || !staff() || (hooks.hideBank && hooks.hideBank())) return '';
  const cur = S.bank ? current() : '';
  return `<nav class="roles bank" aria-label="Carnet du coach"><button data-act="bank" data-v="tous"><span class="ic">${icon('doc', 22)}</span><span>Carnet du coach</span></button>${SUBS().map(([k, l]) =>
    `<button class="sub" data-act="bank" data-v="${k}" ${cur === k ? 'aria-current="page"' : ''}><span>${esc(l)}</span></button>`).join('')}</nav>`;
};

// La banque marque son passage (titre « Banque d'exercices », entrée allumée) ; une autre entrée vers les exercices l'efface
const cexos0 = ACTIONS.cexos, cplans0 = ACTIONS.cplans, cexnew0 = ACTIONS.cexnew;
ACTIONS.cexos = (el, d) => { S.bank = false; return cexos0(el, d); };
ACTIONS.bank = (el, d) => {
  const v = d.v === 'tous' ? 'libre' : d.v || 'libre';
  S.stack = [];
  if (v === 'plans' && staff()) { S.bank = true; return cplans0(el, d); }
  if (v === 'new' && staff()) { S.bank = true; return cexnew0(el, d); }
  if (v === 'tac' && staff()) { S.bank = true; return ACTIONS.tactics(el, d); }
  S.bank = true;
  return cexos0(el, { tab: ['libre', 'club', 'mine'].includes(v) ? v : 'libre' });
};
ACTIONS.cplans = (el, d) => { S.bank = false; return cplans0(el, d); };
