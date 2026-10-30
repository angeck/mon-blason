// Pocket Club (nom provisoire) · alpha 3.1 · point d'entrée : affichage des écrans, aiguillage des actions, connexion, temps réel.
// Organisation : js/core.js (état, données, droits), js/ui.js (logos, en-tête, onglets), puis un module par onglet.
import { BRAND, VERSION } from './config.js';
import {
  S, sb, $, run, toast, hooks, ACTIONS, FORMS, INPUTS, CHANGES, club, active, isActive, ROLES, teamName, teamsLabel, evTeams, pl, pname, team,
  loadMe, loadClub, loadGroup, checkVersion, fmtShort, hm, esc,
} from './js/core.js';
import { header, tabBar, applyTheme, wordmark, icon } from './js/ui.js';
import { authScreen, cguScreen, onboarding, legalScreen, publicHome, publicClubScreen, recoveryScreen, mountCaptcha, openPendingJoin } from './js/auth.js';
import { homeTab, homeTitle } from './js/accueil.js';
import { agendaTab, eventForm, eventPage, appelPage } from './js/agenda.js';
import { messagesTab, groupForm, groupPage, grp, scrollEnd, bump } from './js/messages.js';
import { teamTab, teamPage, importPage } from './js/equipe.js';
import { playerPage } from './js/joueur.js';
import { clubTab, memberPage } from './js/club.js';
import { accountScreen, deletedScreen } from './js/compte.js';
import { COACH_VIEWS, loadCoachCounts, loadEvPlans } from './js/coach.js';

const TAB_TITLES = ['', 'Agenda', 'Messages', 'Équipe', 'Le club'];
function profileLine() { return [...new Set(active().map((m) => ROLES[m.role] + (m.team_id ? ' ' + teamName(m.team_id) : '')))].join(' · '); }
function syncBar() {
  return (S.online ? '' : '<div class="offline">Hors connexion · tu vois les dernières données chargées. Les envois reprendront au retour du réseau.</div>')
    + `<div class="sync"><span>${S.updated ? 'Mis à jour à ' + S.updated : ''}</span><button data-act="refresh">${icon('refresh', 16)} Actualiser</button></div>`;
}
function viewScreen(v) {
  const e = ['event', 'appel'].includes(v.type) ? S.events.find((x) => x.id === v.id) : null;
  switch (v.type) {
    case 'event': return [header({ back: true, kicker: e ? e.type + (evTeams(e).length ? ' · ' + teamsLabel(evTeams(e)) : '') : 'Rendez-vous', title: esc(e?.title || 'Rendez-vous'), tags: e ? [fmtShort(e.starts_at).split(' · ')[0], hm(new Date(e.starts_at)), e.place].filter(Boolean) : [] }), eventPage(v.id)];
    case 'evform': return [header({ back: true, kicker: 'Agenda', title: S.form?.id ? 'Modifier' : 'Nouveau rendez-vous' }), eventForm()];
    case 'appel': return [header({ back: true, kicker: 'Appel', title: esc(e?.title || 'Appel'), tags: e ? [fmtShort(e.starts_at)] : [] }), appelPage(v.id)];
    case 'gform': return [header({ back: true, kicker: 'Messages', title: 'Nouveau groupe' }), groupForm()];
    case 'group': return [header({ back: true, kicker: "Groupe d'échange", title: esc(grp(v.id)?.name || 'Groupe') }), groupPage(v.id)];
    case 'player': { const p = pl(v.id); return [header({ back: true, kicker: 'Fiche joueur', title: esc(p ? pname(p) : 'Fiche') }), playerPage(v.id)]; }
    case 'team': { const t = team(v.id); return [header({ back: true, kicker: 'Équipe', title: esc(t?.name || 'Équipe'), tags: t ? [t.category !== t.name ? t.category : '', t.gender, 'Saison ' + t.season].filter(Boolean) : [] }), teamPage(v.id)]; }
    case 'member': return [header({ back: true, kicker: 'Fiche du membre', title: esc(S.names[v.id] || 'Membre') }), memberPage(v.id)];
    case 'import': return [header({ back: true, kicker: 'Ajouter des joueurs', title: esc(teamName(v.id)) }), importPage(v.id)];
    default: { const cv = COACH_VIEWS[v.type]; if (!cv) return null; const [k, t, fn] = cv(v); return [header({ back: true, kicker: k, title: t }), fn()]; }
  }
}
function render(keep) {
  const y = keep ? window.scrollY : 0, app = $('#app');
  applyTheme();
  let html;
  const vt = S.view?.type;
  if (!S.session) html = vt === 'legal' ? legalScreen() : vt === 'auth' ? authScreen() : vt === 'pclub' ? publicClubScreen(S.view.id) : publicHome();
  else if (S.recovery) html = recoveryScreen();
  else if (!S.me) html = `<div class="splash">${wordmark(52, 'Basket-ball')}<p>Chargement…</p></div>`;
  else if (vt === 'legal') html = legalScreen();
  else if (vt === 'pclub') html = publicClubScreen(S.view.id);
  else if (S.me.deleted_at) html = deletedScreen();
  else if (!S.me.cgu_version) html = cguScreen();
  else if (S.view?.type === 'account') html = accountScreen();
  else if (!S.clubId || !isActive() || S.onb !== null) html = onboarding();
  else {
    const vs = S.view && viewScreen(S.view);
    let hd, bd;
    if (vs) [hd, bd] = vs;
    else {
      const t = S.tab;
      hd = header(t === 0 ? { home: true, title: homeTitle(), sub: profileLine() } : { title: t === 3 ? esc(teamName(S.teamSel) || TAB_TITLES[t]) : TAB_TITLES[t], sub: profileLine() });
      bd = [homeTab, agendaTab, messagesTab, teamTab, clubTab][t]();
    }
    html = hd + `<main class="bd">${S.view ? '' : syncBar()}${bd}</main>` + tabBar();
  }
  app.innerHTML = html;
  window.scrollTo(0, y);
  mountCaptcha();
}
async function refresh(msg) {
  if (await checkVersion()) return;
  if (!navigator.onLine) { toast('Pas de réseau : tu vois les dernières données chargées.'); render(true); return; }
  await loadMe();
  if (!S.joinChecked) { S.joinChecked = true; await openPendingJoin(); }
  if (!S.purged) { S.purged = true; sb.rpc('purge_trash').then(() => {}, () => {}); }
  await loadClub();
  await Promise.all([loadCoachCounts(), loadEvPlans()]).catch(() => {});
  if (S.view?.type === 'group') await loadGroup(S.view.id);
  render(true); subscribe(); if (msg) toast('À jour.');
}
hooks.render = render; hooks.refresh = refresh;

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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memberships' }, () => { clearTimeout(S.mt); S.mt = setTimeout(() => refresh(), 400); })
    .subscribe();
}

// ---------- aiguillage ----------
Object.assign(ACTIONS, {
  refresh: () => refresh(true),
  tab: (el, d) => { S.tab = +d.i; S.view = null; S.stack = []; S.sel = null; S.tmpLogo = undefined; render(); },
  back: () => { S.view = (S.stack || []).pop() || null; S.form = null; S.tmpLogo = undefined; render(); },
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'INPUT') return;
  e.preventDefault();
  const a = el.dataset.act, fn = ACTIONS[a]; if (!fn) return console.warn('Action inconnue', a);
  S.delPrev = S.del; S.del = null;
  const before = S.view;
  try { await fn(el, el.dataset); } catch (err) { console.error(err); toast('Oups, une erreur. Réessaie ou actualise.'); }
  // pile des écrans pour le bouton Retour
  if (S.view && before && !['back', 'tab'].includes(a) && (S.view.type !== before.type || S.view.id !== before.id)) { S.stack = (S.stack || []).concat(before).slice(-10); }
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session && navigator.onLine) refresh(); });
sb.auth.onAuthStateChange(async (ev, session) => {
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
