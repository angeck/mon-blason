// mypocketclub · point d'entrée : affichage des écrans, aiguillage des actions, connexion, temps réel.
// Organisation : js/core.js (état, données, droits), js/ui.js (logos, en-tête, onglets), puis un module par onglet.
import { BRAND, VERSION, CGU_VERSION } from './config.js';
import {
  S, sb, $, run, toast, hooks, ACTIONS, FORMS, INPUTS, CHANGES, club, active, isActive, ROLES, roleLabel, teamName, teamsLabel, evTeams, pl, pname, team,
  loadMe, loadClub, loadGroup, checkVersion, fmtShort, hm, esc, timeRange,
} from './js/core.js';
import { header, tabBar, applyTheme, wordmark, icon } from './js/ui.js';
import { authScreen, cguScreen, onboarding, legalScreen, publicHome, publicClubScreen, recoveryScreen, mountCaptcha, openPendingJoin, restoreForm } from './js/auth.js';
import { homeTab, homeTitle } from './js/accueil.js';
import { agendaTab, eventForm, eventPage, appelPage } from './js/agenda.js';
import { messagesTab, groupForm, groupPage, grp, scrollEnd, bump, forwardPage } from './js/messages.js';
import { teamTab, teamPage, importPage } from './js/equipe.js';
import { playerPage } from './js/joueur.js';
import { clubTab, memberPage, gestionPage } from './js/club.js';
import { accountScreen, deletedScreen } from './js/compte.js';
import { COACH_VIEWS, loadCoachCounts, loadEvPlans } from './js/coach.js';
import { VIE_VIEWS, roleKicker, casqTabs, currentCasq } from './js/vie.js';
import { syncPush } from './js/notif.js';
import './js/convoc.js';
import './js/v35.js';
import { V37_TOP, loadAdminCounts } from './js/v37.js';
import { switchBar, saveSwitch, resetUser } from './js/profils.js';
import { V310_VIEWS, syncTeamCtx, teamWrap, loadV310, clubGoneScreen } from './js/v310.js';
import { loadV43 } from './js/v43.js'; // 4.3.0 : n° 124 (validation des envois), n° 126 (profils de test)
import { loadV44 } from './js/v44.js';
import './js/v48.js'; // 4.8.0 : guide « Installer et notifications »
import { unsubToken, unsubScreen, loadDevices } from './js/v410.js'; // 4.10.0 : n° 184 (appareils connus), n° 185 (désinscription)
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
    case 'gestion': currentCasq(); return [header({ back: true, kicker: roleKicker('Président et bureau'), title: 'Gestion du club', casq: casqTabs() }), gestionPage()]; // n° 88 ; n° 101 : rappel du rôle et rangée des casquettes
    case 'msgfwd': return [header({ back: true, kicker: 'Messages', title: 'Transférer' }), forwardPage()]; // n° 84
    case 'player': { const p = pl(v.id); return [header({ back: true, kicker: 'Fiche joueur', title: esc(p ? pname(p) : 'Fiche') }), playerPage(v.id)]; }
    case 'team': { const t = team(v.id); return [header({ back: true, kicker: 'Équipe', title: esc(t?.name || 'Équipe'), tags: t ? [t.category !== t.name ? t.category : '', t.gender, 'Saison ' + t.season].filter(Boolean) : [] }), teamPage(v.id)]; }
    case 'member': return [header({ back: true, kicker: 'Fiche du membre', title: esc(S.names[v.id] || 'Membre') }), memberPage(v.id)];
    case 'import': return [header({ back: true, kicker: 'Ajouter des joueurs', title: esc(teamName(v.id)) }), importPage(v.id)];
    default: { if (V310_VIEWS[v.type]) { const o = V310_VIEWS[v.type](v); return [o.head, o.body]; } if (VIE_VIEWS[v.type]) { const o = VIE_VIEWS[v.type](v); return [o.head, o.body]; } const cv = COACH_VIEWS[v.type]; if (!cv) return null; const [k, t, fn] = cv(v); return [header({ back: true, kicker: k, title: t }), fn()]; }
  }
}
function render(keep) {
  const y = keep ? window.scrollY : 0, app = $('#app');
  applyTheme();
  let html;
  const vt = S.view?.type;
  if (notMeToken()) html = notMeScreen(); // n° 147 : lien « Ce n'était pas moi » de l'e-mail, connecté ou non
  else if (unsubToken()) html = unsubScreen(); // n° 185 : lien de désinscription des e-mails d'information, connecté ou non
  else if (!S.session) html = vt === 'legal' ? legalScreen() : vt === 'auth' ? authScreen() : vt === 'pclub' ? publicClubScreen(S.view.id) : vt === 'creq' ? V37_TOP.creq(S.view) : publicHome(); // n° 96 : demande d'ajout d'un club, aussi sans compte
  else if (S.recovery) html = recoveryScreen();
  else if (!S.me) html = `<div class="splash bigsplash">${wordmark(Math.min(92, Math.round(innerWidth * 0.145)))}</div>`; // n° 90
  else if (vt === 'legal') html = legalScreen();
  else if (vt === 'pclub') html = publicClubScreen(S.view.id);
  else if (S.me.deleted_at) html = deletedScreen();
  else if (S.me.cgu_version !== CGU_VERSION) html = cguScreen(); // n° 180 : nouvelle version des conditions présentée à la connexion
  else if (S.view?.type === 'account') html = accountScreen();
  else if (V37_TOP[vt]) html = V37_TOP[vt](S.view); // n° 96 : demande d'ajout d'un club, page Admin
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
  app.innerHTML = switchBar() + html;
  window.scrollTo(0, y);
  onScroll();
  mountCaptcha();
  restoreForm(); // n° 175 : retour de « Conditions » ou « Vos données » : l'inscription garde sa saisie
}
async function refresh(msg) {
  if (await checkVersion()) return;
  if (!navigator.onLine) { toast('Pas de réseau : tu vois les dernières données chargées.'); render(true); return; }
  await loadMe();
  if (S.me && S.devFor !== S.me.id) { S.devFor = S.me.id; registerDevice().then(loadDevices); } // n° 147 ; 4.10.0 : la liste des appareils suit : appareil connu ou nouveau (alerte par e-mail)
  if (!S.joinChecked) { S.joinChecked = true; await openPendingJoin(); }
  if (!S.purged) { S.purged = true; sb.rpc('purge_trash').then(() => {}, () => {}); }
  await loadClub();
  await Promise.all([loadCoachCounts(), loadEvPlans(), loadAdminCounts(), loadV310(), loadV43(), loadV44()]).catch(() => {});
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
  tab: (el, d) => { S.tab = +d.i; S.view = null; S.stack = []; S.sel = null; S.tmpLogo = undefined; render(); },
  // n° 101 : le bouton Retour retrouve la position de défilement de l'écran d'avant
  back: () => { const v = (S.stack || []).pop() || null, y = v?._y || 0; if (v) delete v._y; S.view = v; S.form = null; S.tmpLogo = undefined; render(); if (y) requestAnimationFrame(() => window.scrollTo(0, y)); },
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'INPUT') return;
  e.preventDefault();
  const a = el.dataset.act, fn = ACTIONS[a]; if (!fn) return console.warn('Action inconnue', a);
  S.delPrev = S.del; S.del = null;
  const before = S.view, y0 = window.scrollY;
  try { await fn(el, el.dataset); } catch (err) { console.error(err); toast('Oups, une erreur. Réessaie ou actualise.'); }
  // pile des écrans pour le bouton Retour (avec la position de défilement, n° 101)
  // (S.noStack : l'action est déjà revenue à l'écran d'avant, comme « Créer les équipes » : on n'empile pas l'écran quitté)
  if (S.view && before && !['back', 'tab'].includes(a) && !S.noStack && (S.view.type !== before.type || S.view.id !== before.id)) { S.stack = (S.stack || []).concat({ ...before, _y: y0 }).slice(-10); }
  S.noStack = false;
  if (S.delPrev && !S.del && S.delPrev !== a) render(true);
});
document.addEventListener('input', (e) => { for (const f of INPUTS) if (f(e.target)) return; });
document.addEventListener('change', async (e) => { for (const f of CHANGES) if (await f(e.target)) return; });
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, fn = FORMS[f.id]; if (!fn) return;
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try { await fn(Object.fromEntries(new FormData(f)), f); } catch (err) { console.error(err); toast('Oups, une erreur. Réessaie.'); } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});

// ---------- connexion et réseau ----------
window.addEventListener('online', () => { S.online = true; refresh(); });
window.addEventListener('offline', () => { S.online = false; render(true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session && navigator.onLine) { S.bgRefresh = true; refresh(); } });
sb.auth.onAuthStateChange(async (ev, session) => {
  if (session) { saveSwitch(session); if (S.uid && S.uid !== session.user.id) resetUser(); S.uid = session.user.id; } else S.uid = null;
  if (ev === 'TOKEN_REFRESHED') { S.session = session; return; }
  S.session = session;
  if (!session) { S.me = null; S.mems = []; S.clubs = {}; S.view = null; S.joinChecked = false; S.recovery = false; if (S.channel) { sb.removeChannel(S.channel); S.channel = null; } render(); return; }
  if (ev === 'PASSWORD_RECOVERY') S.recovery = true;   // n° 45 : nouveau mot de passe saisi deux fois
  if (ev === 'SIGNED_IN' && ['auth', 'pclub'].includes(S.view?.type)) S.view = null;
  setTimeout(() => refresh(), 0);
});
document.title = BRAND.name;
console.info(BRAND.name, VERSION);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
export { club };
