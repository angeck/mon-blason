// mypocketclub · point d'entrée : affichage des écrans, aiguillage des actions, connexion, temps réel.
// Organisation : js/core.js (état, données, droits), js/ui.js (logos, en-tête, onglets), puis un module par onglet.
import { BRAND, VERSION, CGU_VERSION } from './config.js';
import {
  S, sb, $, run, toast, hooks, ACTIONS, FORMS, INPUTS, CHANGES, club, active, isActive, ROLES, roleLabel, teamName, teamsLabel, evTeams, pl, pname, team,
  loadMe, loadClub, loadGroup, checkVersion, fmtShort, hm, esc, timeRange,
} from './js/core.js';
import { header, tabBar, seeTab, applyTheme, wordmark, icon } from './js/ui.js';
import { authScreen, cguScreen, onboarding, legalScreen, publicHome, publicClubScreen, recoveryScreen, mountCaptcha, openPendingJoin, restoreForm } from './js/auth.js';
import { homeTab, homeTitle } from './js/accueil.js';
import { agendaTab, eventForm, eventPage, appelPage } from './js/agenda.js';
import { messagesTab, groupForm, groupPage, grp, scrollEnd, bump, forwardPage } from './js/messages.js';
import { teamTab, teamPage, importPage } from './js/equipe.js';
import { playerPage } from './js/joueur.js';
import { clubTab, memberPage } from './js/club.js';
import { accountScreen, deletedScreen } from './js/compte.js';
import { COACH_VIEWS, loadCoachCounts, loadEvPlans } from './js/coach.js';
import { VIE_VIEWS } from './js/vie.js';
import { syncPush } from './js/notif.js';
import './js/convoc.js';
import './js/v35.js';
import { V37_TOP, loadAdminCounts } from './js/v37.js';
import { switchBar, saveSwitch, resetUser } from './js/profils.js';
import { V310_VIEWS, syncTeamCtx, teamWrap, loadV310, clubGoneScreen } from './js/v310.js';
import { loadV43 } from './js/v43.js'; // 4.3.0 : n° 124 (validation des envois), n° 126 (profils de test)
import { loadV44 } from './js/v44.js';
import './js/v48.js'; // 4.8.0 : guide « Installer et notifications »
import './js/v52.js'; // 5.2.0 : n° 174 (contact d'équipe), n° 158 (renforts)
import { loadV57 } from './js/v57.js'; // 5.7.0 : n° 204 et 207 (attestations de paiement)
import './js/v510.js'; // 5.10.0 : n° 161 exercices avec l'IA (schéma animé, éditeur au doigt)
import './js/v511.js'; // 5.11.0 : n° 227 banque d'exercices dans le menu de gauche (ordinateur)
import './js/v56.js'; // 5.6.0 : n° 202 compte administrateur (espace admin, double vérification)
import './js/v55.js'; // 5.5.0 : onboarding « Pour bien démarrer », FAQ (Aide), n° 164 justificatif d'adhésion
import { validationReminders } from './js/v54.js'; // 5.4.0 : n° 201 (conversation avec un mineur), n° 84 (rattacher), transfert d'une convocation, n° 182
import './js/v51.js'; // 5.1.0 : n° 189 (retour du téléphone), 190 (pastilles des rôles), 191 (demandes), 196 (bienvenue)
import { unsubToken, unsubScreen, loadDevices } from './js/v410.js'; // 4.10.0 : n° 184 (appareils connus), n° 185 (désinscription)
import { captureParentToken, acceptParentInvite } from './js/joueur.js'; // 5.3.0 : invitation du parent d'un joueur de 15 à 17 ans
import { registerDevice, notMeToken, notMeScreen } from './js/v47.js'; // 4.7.0 : n° 147 et 44 // 4.4.0 : n° 114 (bandeau et onglets de chaque fonction, droits, exports, saison)

const TAB_TITLES = ['', 'Agenda', 'Messages', 'Équipe', 'Le club'];
function profileLine() { return [...new Set(active().map((m) => roleLabel(m) + (m.team_id ? ' ' + teamName(m.team_id) : '')))].join(' · '); }
function syncBar() {
  return (S.online ? '' : '<div class="offline">Hors connexion · tu vois les dernières données chargées. Les envois reprendront au retour du réseau.</div>')
    + `<div class="sync"><span>${S.updated ? 'Mis à jour à ' + S.updated : ''}</span><button data-act="refresh">${icon('refresh', 16)} Actualiser</button></div>`;
}
function viewScreen(v) {
  const e = ['event', 'appel'].includes(v.type) ? S.events.find((x) => x.id === v.id) : null;
  switch (v.type) {
    case 'event': return [header({ back: true, kicker: e ? e.type + (evTeams(e).length ? ' · ' + teamsLabel(evTeams(e)) : '') : 'Rendez-vous', title: esc(e?.title || 'Rendez-vous'), tags: e ? [fmtShort(e.starts_at).split(' · ')[0], timeRange(e), e.place].filter(Boolean) : [] }), eventPage(v.id)];
    case 'evform': return [header({ back: true, kicker: 'Agenda', title: S.form?.id ? 'Modifier' : 'Nouveau rendez-vous' }), eventForm()];
    case 'appel': if (e && !S.tsp && evTeams(e).length) S.tsp = evTeams(e)[0]; // n° 116 : l'appel est une page de l'équipe (onglets dans l'en-tête)
      return [header({ back: true, kicker: 'Appel · ' + (e?.type || ''), title: esc(e?.title || 'Appel') }), appelPage(v.id)];
    case 'gform': return [header({ back: true, kicker: 'Messages', title: 'Nouveau groupe' }), groupForm()];
    case 'group': return [header({ back: true, kicker: "Groupe d'échange", title: esc(grp(v.id)?.name || 'Groupe') }), groupPage(v.id)];
    case 'msgfwd': return [header({ back: true, kicker: 'Messages', title: 'Transférer' }), forwardPage()]; // n° 84
    case 'player': { const p = pl(v.id); return [header({ back: true, kicker: 'Fiche joueur', title: esc(p ? pname(p) : 'Fiche') }), playerPage(v.id)]; }
    case 'team': { const t = team(v.id); return [header({ back: true, kicker: 'Équipe', title: esc(t?.name || 'Équipe'), tags: t ? [t.category !== t.name ? t.category : '', t.gender, 'Saison ' + t.season, ['acceptee', 'demandee', 'invitee'].includes(t.partner_state) ? 'Entente' : ''].filter(Boolean) : [] }), teamPage(v.id)]; }
    case 'member': return [header({ back: true, kicker: 'Fiche du membre', title: esc(S.names[v.id] || 'Membre') }), memberPage(v.id)];
    case 'import': return [header({ back: true, kicker: 'Ajouter des joueurs', title: esc(teamName(v.id)) }), importPage(v.id)];
    default: { if (V310_VIEWS[v.type]) { const o = V310_VIEWS[v.type](v); return [o.head, o.body]; } if (VIE_VIEWS[v.type]) { const o = VIE_VIEWS[v.type](v); return [o.head, o.body]; } const cv = COACH_VIEWS[v.type]; if (!cv) return null; const [k, t, fn] = cv(v); return [header({ back: true, kicker: k, title: t }), fn()]; }
  }
}
const inClubNow = () => !!(S.clubId && isActive() && S.onb === null && !club()?.deleted_at);
function render(keep) {
  const y = keep ? window.scrollY : 0, app = $('#app');
  applyTheme();
  let html;
  const vt = S.view?.type;
  if (notMeToken()) html = notMeScreen(); // n° 147 : lien « Ce n'était pas moi » de l'e-mail, connecté ou non
  else if (unsubToken()) html = unsubScreen(); // n° 185 : lien de désinscription des e-mails d'information, connecté ou non
  else if (!S.session) html = vt === 'legal' ? legalScreen() : vt === 'auth' ? authScreen() : vt === 'pclub' ? publicClubScreen(S.view.id) : vt === 'creq' ? V37_TOP.creq(S.view) : publicHome(); // n° 96 : demande d'ajout d'un club, aussi sans compte
  else if (S.recovery) html = recoveryScreen();
  else if (!S.me) html = `<div class="splash bigsplash" data-ouv="1">${wordmark(Math.min(92, Math.round(innerWidth * 0.145)), null, true)}</div>`; // n° 90 ; 5.0.0 : fond encre, comme l'écran d'ouverture
  else if (vt === 'legal') html = legalScreen();
  else if (vt === 'pclub') html = publicClubScreen(S.view.id);
  else if (S.me.deleted_at) html = deletedScreen();
  else if (S.me.cgu_version !== CGU_VERSION) html = cguScreen(); // n° 180 : nouvelle version des conditions présentée à la connexion
  else if (S.view?.type === 'account') html = accountScreen() + (inClubNow() ? tabBar() : ''); // 5.7.0 · n° 206 : onglets toujours visibles
  else if (V37_TOP[vt]) html = V37_TOP[vt](S.view) + (vt === 'guide' && inClubNow() ? tabBar() : ''); // n° 96 : demande d'ajout d'un club, page Admin ; 5.7.0 : onglets sur le guide
  else if (vt === 'csearch' && !S.clubId && VIE_VIEWS.csearch) { const o = VIE_VIEWS.csearch(S.view); html = o.head + `<main class="bd">${o.body}</main>`; } // 5.7.0 · n° 205 : loupe d'un compte sans club (administrateur)
  else if (!vt && hooks.adminLanding && (html = hooks.adminLanding())) { /* 5.6.0 · n° 202 : compte administrateur sans club : espace admin ou code à 6 chiffres */ }
  else if (!S.clubId || !isActive() || S.onb !== null) html = onboarding();
  else if (club()?.deleted_at && !active().some((m) => m.role === 'president')) html = clubGoneScreen(); // n° 114 : club dans la corbeille
  else {
    syncTeamCtx(); // n° 113 : on quitte l'espace de l'équipe dès qu'on va ailleurs
    const vs = S.view && viewScreen(S.view);
    let hd, bd;
    if (vs) [hd, bd] = teamWrap(S.view, ...vs); // n° 113 ; n° 116 : onglets de l'équipe dans l'en-tête, sur toutes ses pages
    else {
      const t = S.tab;
      bd = [homeTab, agendaTab, messagesTab, teamTab, clubTab][t](); // avant l'en-tête : l'onglet Équipe choisit l'équipe affichée (titre)
      hd = header(t === 0 ? { home: true, title: homeTitle(), sub: profileLine() } : { title: t === 3 ? esc(teamName(S.teamSel) || TAB_TITLES[t]) : TAB_TITLES[t], sub: profileLine() });
    }
    html = hd + `<main class="bd">${S.view ? '' : syncBar()}${bd}</main>` + tabBar();
  }
  const ouv = html.includes('data-ouv'); document.documentElement.classList.toggle('ouv', ouv); // 5.0.0 : écran d'ouverture sur fond encre
  if (ouv) { const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = '#11162E'; }
  app.innerHTML = switchBar() + html;
  window.scrollTo(0, y);
  onScroll();
  mountCaptcha();
  restoreForm(); // n° 175 : retour de « Conditions » ou « Vos données » : l'inscription garde sa saisie
  applyDraft(); // 5.2.1 : la saisie en cours revient après un redessin (retour de l'arrière-plan, temps réel)
  dateHints();
  if (hooks.afterRender) hooks.afterRender(); // n° 189 : historique du téléphone (js/v51.js)
  if (hooks.obAfter) hooks.obAfter(); // 5.5.0 : « Me montrer » et coches à la visite (js/v55.js)
}
async function refresh(msg) {
  if (await checkVersion()) return;
  if (!navigator.onLine) { toast('Pas de réseau : tu vois les dernières données chargées.'); render(true); return; }
  await loadMe();
  if (S.me && S.devFor !== S.me.id) { S.devFor = S.me.id; registerDevice().then(loadDevices); } // n° 147 ; 4.10.0 : la liste des appareils suit : appareil connu ou nouveau (alerte par e-mail)
  if (!S.joinChecked) { S.joinChecked = true; await openPendingJoin(); await acceptParentInvite(); }
  if (!S.purged) { S.purged = true; sb.rpc('purge_trash').then(() => {}, () => {}); validationReminders().catch(() => {}); } // 5.4.0 · n° 182 : rappels de validation par e-mail
  await loadClub();
  restoreDraftScreen(); // 5.2.1 : après un rechargement, retour là où la saisie avait commencé
  await Promise.all([loadCoachCounts(), loadEvPlans(), loadAdminCounts(), loadV310(), loadV43(), loadV44(), loadV57()]).catch(() => {});
  if (S.view?.type === 'group') await loadGroup(S.view.id);
  const bg = S.bgRefresh; S.bgRefresh = false;
  renderKeep(bg); subscribe(); if (msg) toast('À jour.');
  syncPush().then(() => renderKeep(bg), () => {});
}
// n° 145 : au retour sur l'application (sélecteur de photo, autre appli), refresh() redessine l'écran ;
// les formulaires ouverts gardent ce qui est en cours de saisie (création du club, blason, etc.)
function renderKeep(keepForms) {
  if (!keepForms) return render(true);
  const l = [...document.querySelectorAll('form[id] input[id], form[id] select[id], form[id] textarea[id]')].filter((x) => x.type !== 'file' && x.type !== 'password')
    .map((x) => [x.id, x.type === 'checkbox' || x.type === 'radio' ? x.checked : x.value, x.type]);
  render(true);
  l.forEach(([id, v, t]) => { const x = document.getElementById(id); if (!x) return; if (t === 'checkbox' || t === 'radio') x.checked = v; else x.value = v; });
  document.querySelector('#clubf [name=c1], #brandf [name=c1]')?.dispatchEvent(new Event('input', { bubbles: true })); // aperçu du blason à jour
}
hooks.render = render; hooks.refresh = refresh;
// n° 139 · ordinateur : l'en-tête réduite apparaît quand le bloc bleu sort de l'écran
// (copie du retour, du logo, de la première ligne du titre et des onglets ; elle n'existe que pendant le défilement, sur grand écran)
const onScroll = () => {
  const hd = document.querySelector('header.hd'), on = !!hd && innerWidth >= 960 && scrollY > hd.offsetHeight - 8;
  let m = document.querySelector('.hdmini');
  if (on && !m) {
    m = document.createElement('div'); m.className = 'hdmini';
    [hd.querySelector('.band [data-act=back]'), hd.querySelector('.band .logo')].forEach((x) => x && m.appendChild(x.cloneNode(true)));
    const t = hd.querySelector('h1') || hd.querySelector('.who.sp b');
    if (t) { const b = document.createElement('b'); b.className = 'mt'; b.innerHTML = t.innerHTML.split(/<br\s*\/?>/i)[0]; m.appendChild(b); }
    const tabs = hd.querySelector('.ttabs'); if (tabs) m.appendChild(tabs.cloneNode(true));
    document.getElementById('app').appendChild(m);
  }
  if (!on && m) m.remove();
  document.body.classList.toggle('scrolled', on);
};
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll, { passive: true });

// ---------- temps réel ----------
function subscribe() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  if (!S.clubId || !isActive()) return;
  S.channel = sb.channel('club-' + S.clubId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
      const m = p.new; if (!S.groups.some((g) => g.id === m.group_id)) return;
      if (!S.lastMsgs.some((x) => x.id === m.id)) S.lastMsgs.unshift(m); bump(m);
      if (S.view?.type === 'group' && S.view.id === m.group_id) { if (!S.msgs.some((x) => x.id === m.id)) { S.msgs.push(m); render(true); scrollEnd(); } sb.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', m.group_id).eq('user_id', S.me.id).then(() => {}, () => {}); }
      else if (m.user_id !== S.me.id) { S.unread[m.group_id] = (S.unread[m.group_id] || 0) + 1; toast((grp(m.group_id)?.name || 'Groupe') + ' : nouveau message'); render(true); }
      else render(true);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, async () => { if (S.view?.type === 'group') { await loadGroup(S.view.id); render(true); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_responses' }, async () => {
      const ids = S.events.map((e) => e.id); if (!ids.length) return;
      S.resp = (await sb.from('event_responses').select('*').in('event_id', ids)).data || []; render(true);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => { clearTimeout(S.at); S.at = setTimeout(() => refresh(), 400); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memberships' }, () => { clearTimeout(S.mt); S.mt = setTimeout(() => refresh(), 400); })
    .subscribe();
}

// ---------- aiguillage ----------
Object.assign(ACTIONS, {
  refresh: () => refresh(true),
  tab: (el, d) => { seeTab(+d.i); S.tab = +d.i; S.view = null; S.stack = []; S.sel = null; S.tmpLogo = undefined; render(); },
  // n° 101 : le bouton Retour retrouve la position de défilement de l'écran d'avant
  back: () => { if (hooks.obBack?.()) return; /* 5.9.0 · n° 221 : pendant « Me montrer », retour à la fiche */ const v = (S.stack || []).pop() || null, y = v?._y || 0; if (v) delete v._y; S.view = v; S.form = null; S.tmpLogo = undefined; render(); if (y) requestAnimationFrame(() => window.scrollTo(0, y)); },
});
// ---------- jour de la semaine sous les champs date (5.2.1) ----------
// Le calendrier du téléphone ne dit pas quel jour on a présélectionné : on l'écrit sous le champ (« Samedi 21 novembre 2026 »), à jour à chaque choix.
const dayName = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); if (!m) return '';
  const s = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
function dateHint(x) {
  let h = x.nextElementSibling;
  if (!h || !h.classList?.contains('dayhint')) { h = document.createElement('span'); h.className = 'det dayhint'; h.setAttribute('aria-live', 'polite'); x.after(h); }
  const t = dayName(x.value); h.textContent = t; h.hidden = !t;
}
const dateHints = () => document.querySelectorAll('input[type=date], input[type=datetime-local]').forEach(dateHint);
const isDateInput = (t) => t?.tagName === 'INPUT' && (t.type === 'date' || t.type === 'datetime-local');
document.addEventListener('input', (e) => { if (isDateInput(e.target)) dateHint(e.target); });
document.addEventListener('change', (e) => { if (isDateInput(e.target)) dateHint(e.target); });
// ---------- brouillons de saisie (5.2.1) ----------
// Ce que la personne tape dans un formulaire est gardé sur l'appareil : au retour dans l'application, après un rechargement
// (mise à jour, téléphone qui ferme l'appli) et quand l'écran se redessine tout seul (temps réel, retour de l'arrière-plan).
// Jamais les mots de passe ni les fichiers. Effacé au changement d'écran, à l'envoi du formulaire et à la déconnexion (3 h au plus).
const DRAFT_KEY = 'pc_draft', DRAFT_MAX = 3 * 3600e3;
const dctx = () => [S.tab, S.view?.type || '', S.view?.id || '', S.onb || ''].join('|');
const readDraft = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.uid === S.me?.id && Date.now() - d.ts < DRAFT_MAX ? d : null; } catch { return null; } };
const writeDraft = (d) => { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch { /* stockage plein ou bloqué */ } };
const isChk = (x) => x.type === 'checkbox' || x.type === 'radio';
function noteDraft(t) {
  if (!S.me || !t?.id || !t.closest) return;
  const f = t.closest('form[id]'); if (!f || !('value' in t) || ['password', 'file', 'hidden'].includes(t.type)) return;
  let d = readDraft(); const c = dctx();
  if (!d || d.ctx !== c) d = { uid: S.me.id, ctx: c, tab: S.tab, onb: S.onb || '', view: S.view?.type || '', forms: {} };
  (d.forms[f.id] = d.forms[f.id] || {})[t.id] = isChk(t) ? t.checked : t.value;
  d.ts = Date.now(); writeDraft(d);
}
function applyDraft() {
  if (S.inAct) return; // une action de la personne redessine l'écran à sa façon : on ne touche à rien
  const d = readDraft(); if (!d || d.ctx !== dctx()) return;
  for (const [fid, fields] of Object.entries(d.forms)) {
    const f = document.getElementById(fid); if (!f) continue;
    for (const [id, v] of Object.entries(fields)) {
      const x = f.querySelector('#' + CSS.escape(id)); if (!x || (isChk(x) ? x.checked : x.value) === v) continue;
      if (isChk(x)) x.checked = v; else { x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }
}
// au démarrage de la page (rechargement) : retour sur l'écran où la saisie avait commencé (création du club, onglet, Mon compte)
function restoreDraftScreen() {
  if (S.draftBoot) return; S.draftBoot = true;
  const d = readDraft(); if (!d || S.view) return;
  if (!['', 'account'].includes(d.view)) return;
  S.tab = d.tab || 0; if (d.onb) S.onb = d.onb; if (d.view === 'account') S.view = { type: 'account' };
}
async function inAct(fn) { S.inAct = true; try { return await fn(); } finally { S.inAct = false; } }
document.addEventListener('input', (e) => noteDraft(e.target), true);
document.addEventListener('change', (e) => noteDraft(e.target), true);
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'INPUT') return;
  e.preventDefault();
  const a = el.dataset.act, fn = ACTIONS[a]; if (!fn) return console.warn('Action inconnue', a);
  S.delPrev = S.del; S.del = null;
  const before = S.view, y0 = window.scrollY;
  const ctx0 = dctx();
  try { await inAct(() => fn(el, el.dataset)); } catch (err) { console.error(err); toast('Oups, une erreur. Réessaie ou actualise.'); }
  if (S.me && dctx() !== ctx0) writeDraft(null); // autre écran : la saisie abandonnée ne revient pas
  // pile des écrans pour le bouton Retour (avec la position de défilement, n° 101)
  // (S.noStack : l'action est déjà revenue à l'écran d'avant, comme « Créer les équipes » : on n'empile pas l'écran quitté)
  if (S.view && before && !['back', 'tab'].includes(a) && !S.noStack && (S.view.type !== before.type || S.view.id !== before.id)) { S.stack = (S.stack || []).concat({ ...before, _y: y0 }).slice(-10); }
  S.noStack = false;
  if (S.delPrev && !S.del && S.delPrev !== a) render(true);
});
document.addEventListener('input', (e) => { for (const f of INPUTS) if (f(e.target)) return; });
// (un « change » de champ texte arrive aussi quand l'écran se redessine sous le doigt : ce n'est pas une action de la personne)
document.addEventListener('change', async (e) => {
  const t = e.target, run = async () => { for (const f of CHANGES) if (await f(t)) return; };
  if (t.tagName === 'SELECT' || isChk(t)) await inAct(run); else await run();
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, fn = FORMS[f.id]; if (!fn) return;
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  const ctx0 = dctx(), dr = readDraft(); if (dr?.forms[f.id]) { delete dr.forms[f.id]; writeDraft(dr); } // envoyé : la saisie de ce formulaire est effacée
  try { await inAct(() => fn(Object.fromEntries(new FormData(f)), f)); } catch (err) { console.error(err); toast('Oups, une erreur. Réessaie.'); } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  // refus (champ manquant…) : le formulaire est toujours là, on garde ce qui est tapé ; autre écran : plus de brouillon
  if (S.me && dctx() !== ctx0) writeDraft(null);
  else { const g = document.getElementById(f.id); g?.querySelectorAll('input[id], select[id], textarea[id]').forEach((x) => { if (isChk(x) ? x.checked !== x.defaultChecked : x.value !== x.defaultValue) noteDraft(x); }); }
});

// ---------- connexion et réseau ----------
window.addEventListener('online', () => { S.online = true; refresh(); });
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render(true)); } catch { /* ancien navigateur */ } // 5.0.0 : thème « Comme mon téléphone »
window.addEventListener('offline', () => { S.online = false; render(true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session && navigator.onLine) { S.bgRefresh = true; refresh(); } });
captureParentToken(); // 5.3.0 : lien #parent=… de l'e-mail d'invitation, gardé jusqu'à la connexion
sb.auth.onAuthStateChange(async (ev, session) => {
  if (session) { saveSwitch(session); if (S.uid && S.uid !== session.user.id) resetUser(); S.uid = session.user.id; } else S.uid = null;
  if (ev === 'TOKEN_REFRESHED') { S.session = session; return; }
  S.session = session;
  if (!session) { writeDraft(null); S.me = null; S.mems = []; S.clubs = {}; S.view = null; S.joinChecked = false; S.recovery = false; if (S.channel) { sb.removeChannel(S.channel); S.channel = null; } render(); return; }
  if (ev === 'PASSWORD_RECOVERY') S.recovery = true;   // n° 45 : nouveau mot de passe saisi deux fois
  if (ev === 'SIGNED_IN' && ['auth', 'pclub'].includes(S.view?.type)) S.view = null;
  setTimeout(() => refresh(), 0);
});
document.title = BRAND.name;
console.info(BRAND.name, VERSION);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
export { club };
