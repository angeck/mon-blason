// mypocketclub · alpha 5.1.0 · lot « navigation figée » (« go » de Gaël, 11 novembre 2026)
//   n° 190 : ce qui dépend d'un rôle fait une pastille sur le bouton « Mes rôles » (quatre carrés) et sur le rôle concerné ;
//            ce qui dépend du compte reste sur l'onglet (Messages : non lus ; Agenda : réponses à donner).
//   n° 191 : « Gestion du club » n'existe plus ; « vdem » mène là où la personne valide les demandes.
//   n° 196 : encart de bienvenue sur l'Accueil quand un profil vient d'être validé (bouton du tutoriel grisé).
//   n° 189 : le bouton ou le geste « retour » du téléphone revient à l'écran d'avant au lieu de quitter l'application.
// Rappel : chaque droit est vérifié par la base ; l'écran n'est qu'un confort.
import { S, hooks, ACTIONS, render, esc, store, active, casquettes, isCoachCasq, toValidate, isPresident, hasArea, myFonctions, teamName, fonctionLabel, ROLES } from './core.js';
import { homeEvents, needsAnswer } from './agenda.js';
import { FONCTION_AREAS } from './vie.js';

// ---------- n° 190 · pastilles ----------
// Onglet Agenda : rendez-vous qui attendent une réponse de ce compte (les mêmes que « À répondre » de l'Accueil)
hooks.toAnswer = () => { try { return homeEvents().filter(needsAnswer).length; } catch { return 0; } };

// Rubriques que couvre un rôle du bureau : celles de sa fonction ; « Membre du bureau » (ou une fonction sans rubrique) :
// celles que le président a ouvertes en plus, hors celles de mes autres fonctions
function areasOf(k) {
  const f = k.slice(2), own = FONCTION_AREAS[f] || [];
  if (own.length) return own.filter(hasArea);
  const others = new Set(myFonctions().filter((x) => x !== f).flatMap((x) => FONCTION_AREAS[x] || []));
  return (S.areas || []).filter((a) => !others.has(a));
}
// 5.2.0 (n° 190) : coachs qui n'ont pas encore confirmé le dernier relevé d'heures demandé (trésorerie et président)
function lateHours() {
  const k = (S.hchecks || [])[0]; if (!k) return 0;
  return (S.hconf || []).filter((c) => c.check_id === k.id && !c.confirmed_at).length;
}
// Ce qui attend la personne dans un rôle : demandes à valider (par identifiant, pour ne rien compter deux fois),
// exercices à valider, heures à vérifier
function itemsOf(k) {
  const vp = toValidate(), out = { dem: new Set(), exos: 0, hours: 0 };
  if (k === 'president') { vp.forEach((m) => out.dem.add(m.id)); out.hours = lateHours(); return out; } // 5.2.0 : coachs qui n'ont pas confirmé leurs heures
  if (isCoachCasq(k)) {
    const ts = casquettes().find((x) => x.k === k)?.teams || [];
    vp.filter((m) => m.team_id && ts.includes(m.team_id) && ['joueur', 'parent'].includes(m.role)).forEach((m) => out.dem.add(m.id));
    out.hours = hooks.hoursPending ? hooks.hoursPending() : 0;
    return out;
  }
  const a = areasOf(k);
  if (a.includes('tresorerie')) out.hours = lateHours(); // 5.2.0 (n° 190) : relevé d'heures en attente de confirmation des coachs
  if (a.includes('secretariat')) vp.filter((m) => ['joueur', 'parent', 'supporteur', 'coach'].includes(m.role)).forEach((m) => out.dem.add(m.id));
  if (a.includes('technique')) { vp.filter((m) => m.role === 'coach').forEach((m) => out.dem.add(m.id)); out.exos = (S.coachCounts || {}).exos || 0; }
  return out;
}
export function roleCount(k) { const o = itemsOf(k); return o.dem.size + o.exos + o.hours; }
export function rolesTotal() {
  const l = casquettes(); if (!l.length) return 0;
  const dem = new Set(); let exos = 0, hours = 0;
  l.forEach((x) => { const o = itemsOf(x.k); o.dem.forEach((id) => dem.add(id)); exos = Math.max(exos, o.exos); hours = Math.max(hours, o.hours); });
  return dem.size + exos + hours;
}
hooks.roleCount = roleCount; hooks.rolesTotal = rolesTotal;
export const badge = (n, cls = 'n') => (n ? `<span class="${cls}" aria-label="${n} à traiter">${n > 99 ? '99+' : n}</span>` : '');
hooks.roleBadge = (k) => badge(roleCount(k));

// ---------- n° 191 · « Voir les demandes » : là où la personne valide ----------
const openFn = (k, tab) => { S.casq = k; S.ftabs = S.ftabs || {}; if (tab) S.ftabs[k] = tab; S.view = { type: 'espace' }; };
ACTIONS.vdem = () => {
  const l = casquettes(), has = (k) => l.some((x) => x.k === k), fns = myFonctions();
  if (isPresident()) { S.casq = 'president'; S.ptab = 'demandes'; S.view = { type: 'espace' }; }
  else if (fns.some((f) => ['Secrétaire', 'Secrétaire adjoint'].includes(f))) openFn('f:' + fns.find((f) => ['Secrétaire', 'Secrétaire adjoint'].includes(f)), 'ap_secretariat');
  else if (hasArea('secretariat')) S.view = { type: 'rub', id: 'secretariat' };
  else if (toValidate().some((m) => m.role === 'coach') && has('f:Directeur technique')) openFn('f:Directeur technique', 'equipes');
  else if (toValidate().some((m) => m.role === 'coach') && hasArea('technique')) S.view = { type: 'rub', id: 'technique' };
  else if (l.some((x) => isCoachCasq(x.k))) { S.casq = l.find((x) => isCoachCasq(x.k)).k; S.view = { type: 'espace' }; }
  else { S.view = { type: 'espace' }; }
  render();
};

// ---------- n° 196 · encart de bienvenue à chaque nouveau profil validé ----------
// Profils déjà vus, par club et sur ce téléphone. Au premier passage, les profils de plus de 14 jours sont marqués vus sans encart
// (les comptes existants ne voient pas une pluie d'encarts après la mise à jour).
const WK = () => 'pc_welcome_' + S.clubId;
function seenList() {
  const raw = store.get(WK());
  if (raw) { try { return JSON.parse(raw); } catch { /* valeur abîmée : on repart */ } }
  const l = active().filter((m) => !m.created_at || Date.now() - new Date(m.created_at) > 14 * 864e5).map((m) => m.id);
  store.set(WK(), JSON.stringify(l)); return l;
}
const KID = (m) => S.players.find((p) => p.id === m.player_id) || null;
function welcomeLine(m) {
  const t = m.team_id ? teamName(m.team_id) : '';
  switch (m.role) {
    case 'joueur': return [t ? `Bienvenue dans l’équipe ${t} !` : 'Bienvenue au club !', 'Tu reçois les rendez-vous de ton équipe. Réponds « présent » ou « absent » depuis l’Accueil ou l’Agenda.'];
    case 'parent': { const k = KID(m); return [k ? `Tu es relié à ${k.first_name}` : 'Bienvenue, parent de joueur !', `Tu vois les rendez-vous${t ? ' de ' + t : ''} et tu réponds pour ton enfant. Sa fiche est dans l’onglet Équipe.`]; }
    case 'coach': return [t ? `Tu es coach de ${t}` : 'Tu es coach au club', 'Ton espace de coach (appel, séances, effectif) s’ouvre avec le bouton « Mes rôles », les quatre carrés en haut de l’écran.'];
    case 'bureau': return [`Tu es au bureau : ${fonctionLabel(m)}`, 'Ce que ta fonction te permet de faire est dans « Mes rôles », les quatre carrés en haut de l’écran.'];
    case 'president': return ['Tu es président du club', 'Tout ce qui se gère (demandes, fonctions, réglages) est dans « Mes rôles », les quatre carrés en haut de l’écran.'];
    default: return ['Bienvenue au club !', 'Tu vois la vie du club, ses équipes et ses rendez-vous ouverts à tous.'];
  }
}
hooks.welcomeHome = () => {
  if (!S.clubId) return '';
  const seen = seenList(), fresh = active().filter((m) => !seen.includes(m.id));
  if (!fresh.length) return '';
  const lines = fresh.map(welcomeLine), profile = (m) => (m.role === 'bureau' ? 'membre du bureau' : (ROLES[m.role] || '').toLowerCase());
  return `<div class="card yellow" data-welcome="1"><span class="kick" style="color:var(--pc-texte-ecran)">Bienvenue</span>${lines.map(([t, d]) => `<b style="font-family:var(--pc-titre);font-size:22px;line-height:1.1">${esc(t)}</b><p style="margin:0">${esc(d)}</p>`).join('')}
    <div class="btns"><button class="btn small ghost" aria-disabled="true" disabled style="opacity:.55" title="Ce que tu peux faire en tant que ${esc(profile(fresh[0]))} : le tutoriel arrive bientôt" aria-label="Tutoriel : ce que tu peux faire en tant que ${esc(profile(fresh[0]))}, bientôt disponible">Tutoriel · bientôt</button><button class="btn small main" data-act="welcomeok">Ne plus afficher</button></div></div>`;
};
ACTIONS.welcomeok = () => { const s = new Set(seenList()); active().forEach((m) => s.add(m.id)); store.set(WK(), JSON.stringify([...s])); render(true); };

// ---------- n° 189 · bouton « retour » du téléphone ----------
// Une entrée d'historique « garde » tant qu'une page est ouverte : le retour du téléphone revient à l'écran d'avant
// (comme la flèche en haut). Sur un onglet sans page ouverte, rien n'est retenu : le retour quitte l'application.
let guard = false, ignore = false;
hooks.afterRender = () => {
  try {
    if (S.view && S.session && !guard) { history.pushState({ mpc: 1 }, ''); guard = true; }
    else if (!S.view && guard) { guard = false; ignore = true; history.back(); }
  } catch { /* navigateur sans historique */ }
};
addEventListener('popstate', () => {
  if (ignore) { ignore = false; return; }
  if (!guard) return;
  guard = false;
  if (S.view && ACTIONS.back) ACTIONS.back();
});
