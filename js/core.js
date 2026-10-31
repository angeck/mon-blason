// Pocket Club · cœur de l'application : connexion à la base, état, outils, chargement des données, droits vus à l'écran.
// Rappel : l'écran n'est qu'un confort. Chaque droit est vérifié par la base (règles d'accès et fonctions).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VERSION } from '../config.js';

// N° 44 « Rester connecté » : la session est gardée sur l'appareil (localStorage) ou seulement le temps de l'onglet (sessionStorage)
export const remember = { get: () => { try { return localStorage.getItem('pc_remember') !== '0'; } catch { return true; } }, set: (v) => { try { localStorage.setItem('pc_remember', v ? '1' : '0'); } catch { /* */ } } };
const area = () => { try { return remember.get() ? localStorage : sessionStorage; } catch { return null; } };
const mem = {};
const authStorage = {
  getItem: (k) => { try { return area()?.getItem(k) ?? localStorage.getItem(k) ?? sessionStorage.getItem(k) ?? mem[k] ?? null; } catch { return mem[k] ?? null; } },
  setItem: (k, v) => { mem[k] = v; try { const a = area(); a.setItem(k, v); (a === localStorage ? sessionStorage : localStorage).removeItem(k); } catch { /* navigation privée */ } },
  removeItem: (k) => { delete mem[k]; try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* */ } },
};
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage } });
export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

export const ROLES = { president: 'Président', bureau: 'Membre du bureau', coach: 'Coach', joueur: 'Joueur', parent: 'Parent de joueur', supporteur: 'Supporteur' };
// Libellé d'un profil : « Bureau · Trésorier » pour un membre du bureau (n° 54)
export const roleLabel = (m) => (m.role === 'bureau' ? 'Bureau · ' + (m.fonction || 'Membre du bureau') : ROLES[m.role]);
export const JOIN_ROLES = ['supporteur', 'parent', 'joueur', 'coach', 'bureau'];
export const SPORTS = ['Basket-ball', 'Volley-ball'];
export const TEAM_TYPES = ['Entraînement', 'Match', 'Plateau', 'Tournoi'];
export const BCATS = ['U7 (baby)', 'U9', 'U11', 'U13', 'U15', 'U17', 'U18', 'U20', 'U21', 'Seniors', 'Loisirs', 'Vétérans'];
export const GENRES = ['Féminine', 'Masculine', 'Mixte'];
export const SEASON = '2026-2027', NEXT_SEASON = '2027-2028';
export const HOLIDAYS_ZONE_C = [['2026-10-17', '2026-11-01'], ['2026-12-19', '2027-01-03'], ['2027-02-06', '2027-02-21'], ['2027-04-03', '2027-04-18'], ['2027-07-03', '2027-08-31']];
export const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

// ---------- état ----------
export const S = {
  session: null, me: null, mems: [], clubs: {}, clubId: store.get('pc_club'), tab: 0, view: null,
  members: [], names: {}, nicks: {}, phones: {}, teams: [], events: [], resp: [], groups: [], lastMsgs: [],
  msgs: [], polls: [], votes: [], gmembers: [], roster: [], players: [], pparents: [], padmin: [], att: [], pteams: [],
  docs: [], fees: [], areas: [], annonces: [], annRead: new Set(), missions: [], signups: [], overview: [], discounts: [], hidden: [], trash: [], previews: {}, payments: [], follows: [], cteams: [], unread: {}, myGroups: [], contacts: [], myContact: null,
  authMode: 'login', onb: null, join: { code: '', role: 'supporteur', teams: [] },
  rq: { role: 'joueur', team: '', open: false }, form: null, del: null, sel: null,
  updated: null, online: navigator.onLine, channel: null,
};

// ---------- registre des écrans et des actions (rempli par chaque module) ----------
export const ACTIONS = {}, FORMS = {}, INPUTS = [], CHANGES = [];
export const hooks = { render: () => {}, refresh: async () => {} };
export const render = (keep) => hooks.render(keep);
export const refresh = (msg) => hooks.refresh(msg);

// ---------- outils ----------
export function toast(m, ms = 3200) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); }
export async function run(p, ok) {
  if (!navigator.onLine) { toast('Hors connexion : réessaie quand le réseau revient.'); return null; }
  const { data, error } = await p;
  if (error) { console.error(error); toast(error.message ? error.message.replace(/^.*?: /, '') : 'Action impossible'); return null; }
  if (ok) toast(ok);
  return data ?? true;
}
// Confirmation en deux temps : premier toucher = « Confirmer … », second = action
// (l'aiguillage des actions met de côté la confirmation en cours dans S.delPrev avant chaque toucher)
export function armed(key) { if (S.delPrev !== key) { S.del = key; render(true); return false; } S.del = null; return true; }
export const isArmed = (key) => S.del === key;

export const hm = (d = new Date()) => d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0');
export const fmtDate = (iso) => { const s = new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1) + ' · ' + hm(new Date(iso)); };
export const fmtShort = (iso) => { const d = new Date(iso); return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + hm(d); };
export const fmtDay = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export const localDay = (d) => d.toLocaleDateString('sv-SE');
export const inHolidays = (day) => HOLIDAYS_ZONE_C.some(([a, b]) => day >= a && day <= b);
export const toLocalInput = (d) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
export const num = (x) => { const s = String(x ?? '').replace(/[€\s]/g, '').replace(',', '.'); return s === '' || !isFinite(+s) ? null : +s; };
export const niceFirst = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
export const niceLast = (s) => { const t = String(s || '').trim().replace(/\s+/g, ' '); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export function lum(hex) { const n = parseInt(String(hex).slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); }
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// Texte lisible sur une couleur de club : blanc si le contraste atteint 4,5:1, sinon encre
export const onColor = (hex) => (contrast(hex, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#11162E');
export function download(blob, fname) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
export function loadJs(u) { return new Promise((ok, ko) => { if (document.querySelector(`script[src="${u}"]`) && (window.XLSX || window.Tesseract)) return ok(); const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = () => ko(new Error('Bibliothèque non chargée')); document.head.appendChild(s); }); }
export const toDataUrl = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });
export const plural = (n, one, many) => n + ' ' + (n > 1 ? many || one + 's' : one);

// ---------- qui suis-je dans le club affiché ----------
export const club = () => S.clubs[S.clubId];
export const myMem = () => S.mems.filter((m) => m.club_id === S.clubId);
export const active = () => myMem().filter((m) => m.status === 'active');
export const isActive = () => active().length > 0;
export const isBoard = () => active().some((m) => ['president', 'bureau'].includes(m.role));
export const isPresident = () => active().some((m) => m.role === 'president');
export const coachTeams = () => [...new Set(active().filter((m) => m.role === 'coach' && m.team_id).map((m) => m.team_id))];
export const coachOf = (tid) => !!tid && coachTeams().includes(tid);
export const isCoach = () => active().some((m) => m.role === 'coach');
export const isStaff = () => isBoard() || isCoach();
export const myTeamIds = () => [...new Set(active().filter((m) => m.team_id).map((m) => m.team_id).concat(myPlayers().flatMap((p) => teamsOfPlayer(p))))];
export const name = (id) => S.names[id] || 'Membre';
export const nick = (id) => S.nicks[id] || name(id);
export const shortName = (full) => { const p = String(full || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0] || ''; };
export const team = (id) => S.teams.find((t) => t.id === id);
export const teamName = (id) => team(id)?.name || '';
export const teamsLabel = (ids) => (ids || []).map(teamName).filter(Boolean).join(', ');
export const pl = (id) => S.players.find((p) => p.id === id);
export const pname = (p) => (p.first_name + ' ' + (p.last_name || '')).trim();
export const adminOf = (pid) => S.padmin.find((a) => a.player_id === pid);
export const parentsOf = (pid) => S.pparents.filter((x) => x.player_id === pid).map((x) => x.user_id);
export const isParentOf = (pid) => parentsOf(pid).includes(S.me.id);
export const teamsOfPlayer = (p) => [p.team_id, ...S.pteams.filter((x) => x.player_id === p.id).map((x) => x.team_id)].filter(Boolean);
export const inTeam = (p, tid) => teamsOfPlayer(p).includes(tid);
export const myPlayers = () => S.players.filter((p) => isParentOf(p.id) || p.user_id === S.me.id);
// n° 51 : ma propre fiche n'est jamais « un enfant », même si un lien parent existe par erreur
export const myKids = () => S.players.filter((p) => isParentOf(p.id) && p.user_id !== S.me.id);
export const mySelf = () => S.players.filter((p) => p.user_id === S.me.id);
export const myKidsIn = (tids) => myKids().filter((p) => tids.some((t) => inTeam(p, t)));
export const iPlayIn = (tids) => active().some((m) => m.role === 'joueur' && tids.includes(m.team_id)) || S.players.some((p) => p.user_id === S.me.id && tids.some((t) => inTeam(p, t)));
export const playersOfTeam = (tid) => S.players.filter((p) => inTeam(p, tid));
export const canManagePlayer = (p) => isBoard() || teamsOfPlayer(p).some(coachOf);
export function isMajor(p) {
  if (!p.birth_date) return false;   // mineur par défaut si la date manque
  const b = new Date(p.birth_date), n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0) >= 18;
}
// N° 55 : rubriques du bureau (tresorerie, secretariat, technique, communication, evenements), calculées par la base
export const hasArea = (a) => (S.areas || []).includes(a);
export const AREAS = { tresorerie: 'Trésorerie', secretariat: 'Secrétariat', technique: 'Technique', communication: 'Communication', evenements: 'Événements et buvette' };
export const FONCTIONS = ['Vice-président', 'Secrétaire', 'Secrétaire adjoint', 'Trésorier', 'Trésorier adjoint', 'Directeur sportif', 'Coordinateur', 'Correspondant licences', 'Chargé de communication', 'Responsable sponsoring', 'Responsable événements et buvette', 'Membre du bureau'];
// Casquettes de l'espace (charte du 31 octobre) : Coach, Président, chaque fonction du bureau
export function casquettes() {
  const l = [], ct = coachTeams().filter((t) => S.teams.some((x) => x.id === t));
  if (ct.length) l.push({ k: 'coach', label: 'Coach' + (ct.length === 1 ? ' ' + (S.teams.find((x) => x.id === ct[0])?.name || '') : ''), pill: 'Coach' });
  if (isPresident()) l.push({ k: 'president', label: 'Président', pill: 'Président' });
  active().filter((m) => m.role === 'bureau').forEach((m) => { const f = m.fonction || 'Membre du bureau'; if (!l.some((x) => x.k === 'f:' + f)) l.push({ k: 'f:' + f, label: f, pill: f === 'Membre du bureau' ? 'Bureau' : f.replace(/ (adjoint|et buvette)$/, '').replace('Responsable ', '').replace('Chargé de ', '') }); });
  return l;
}
export const myFonctions = () => active().filter((m) => m.role === 'bureau').map((m) => m.fonction || 'Membre du bureau');
export function canValidate(m) {
  if (m.user_id === S.me.id) return false;
  if (isPresident()) return true;
  if (['joueur', 'parent', 'supporteur'].includes(m.role) && hasArea('secretariat')) return true;
  if (m.role === 'coach' && (hasArea('secretariat') || hasArea('technique'))) return true;
  return ['joueur', 'parent'].includes(m.role) && !!m.team_id && coachOf(m.team_id);
}
export const toValidate = () => S.members.filter((m) => m.status === 'pending' && canValidate(m));
// N° 32 : rang dans le club (président 3, bureau 2, coach 1, autres 0), comme dans la base
const RANKS = { president: 3, bureau: 2, coach: 1 };
export const rankOf = (u) => Math.max(0, ...S.members.filter((m) => m.user_id === u && m.status === 'active').map((m) => RANKS[m.role] || 0));
export const myRank = () => Math.max(0, ...active().map((m) => RANKS[m.role] || 0));
export const outranks = (u) => !u || u === S.me.id || rankOf(u) < myRank();
export const canAdminPlayer = (p) => isBoard() && (!p.user_id || p.user_id === S.me.id || rankOf(p.user_id) < myRank());
export const follows = (tid) => S.follows.includes(tid);
export const evTeams = (e) => e.team_ids || [];

// ---------- chargement ----------
export async function loadNames(ids) {
  ids = [...new Set(ids)].filter((u) => u && !S.names[u]); if (!ids.length) return;
  const r = await sb.from('profiles').select('id,full_name,nickname').in('id', ids);
  (r.data || []).forEach((p) => { S.names[p.id] = p.full_name || 'Membre'; S.nicks[p.id] = p.nickname || ''; });
}
export async function loadMe() {
  const uid = S.session.user.id;
  const [prof, mems] = await Promise.all([sb.rpc('my_profile'), sb.from('memberships').select('*').eq('user_id', uid)]);
  S.me = prof.data || { id: uid, full_name: '', first_name: '', last_name: '' };
  S.mems = mems.data || [];
  const ids = [...new Set(S.mems.map((m) => m.club_id))];
  S.clubs = {};
  if (ids.length) { const { data } = await sb.from('clubs').select('*').in('id', ids); (data || []).forEach((c) => (S.clubs[c.id] = c)); }
  if (!S.clubs[S.clubId]) { const act = S.mems.find((m) => m.status === 'active'); S.clubId = act ? act.club_id : ids[0] || null; }
  if (S.clubId) store.set('pc_club', S.clubId);
}
const inList = (q, col, ids) => (ids.length ? q.in(col, ids) : Promise.resolve({ data: [] }));
export async function loadClub() {
  if (!S.clubId || !isActive()) return;
  const cid = S.clubId, since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [mem, teams, evs, grps, roster, plr, docs, fees, hid] = await Promise.all([
    sb.from('memberships').select('*').eq('club_id', cid),
    sb.from('teams').select('*').eq('club_id', cid).order('name'),
    sb.from('events').select('*').eq('club_id', cid).gte('starts_at', since).order('starts_at').limit(400),
    sb.from('groups').select('*').eq('club_id', cid).order('created_at', { ascending: false }),
    sb.rpc('club_roster', { p_club: cid }),
    sb.from('players').select('*').eq('club_id', cid).order('last_name'),
    sb.from('club_docs').select('id,kind,file_name,created_at').eq('club_id', cid),
    sb.from('fee_grid').select('*').eq('club_id', cid),
    sb.from('event_hidden').select('*').eq('user_id', S.me.id),
  ]);
  S.members = mem.data || []; S.teams = teams.data || []; S.events = evs.data || []; S.groups = grps.data || [];
  S.roster = roster.data || []; S.players = plr.data || []; S.docs = docs.data || []; S.fees = fees.data || []; S.hidden = hid.data || [];
  S.roster.forEach((x) => { if (x.user_id) S.names[x.user_id] = (x.first_name + ' ' + (x.last_name || '')).trim(); });
  const pids = S.players.map((p) => p.id), eids = S.events.map((e) => e.id), gids = S.groups.map((g) => g.id);
  const [pp, pa, at, pt, rs, lm, dc, pay, fol, ct, mg, cl, gp, mc] = await Promise.all([
    inList(sb.from('player_parents').select('*'), 'player_id', pids),
    inList(sb.from('player_admin').select('*'), 'player_id', pids),
    inList(sb.from('attendance').select('*'), 'player_id', pids),
    inList(sb.from('player_teams').select('*'), 'player_id', pids),
    inList(sb.from('event_responses').select('*'), 'event_id', eids),
    gids.length ? sb.from('messages').select('*').in('group_id', gids).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    isBoard() ? inList(sb.from('player_discount').select('*'), 'player_id', pids) : Promise.resolve({ data: [] }),
    inList(sb.from('player_payments').select('*').order('paid_at'), 'player_id', pids),
    sb.from('team_follows').select('team_id').eq('user_id', S.me.id),
    sb.rpc('club_teams', { p_club: cid }),
    gids.length ? sb.from('group_members').select('*').eq('user_id', S.me.id).in('group_id', gids) : Promise.resolve({ data: [] }),
    sb.rpc('club_contacts_list', { p_club: cid }),
    sb.rpc('group_previews', { p_club: cid }),
    sb.from('club_contacts').select('*').eq('club_id', cid).eq('user_id', S.me.id).maybeSingle(),
  ]);
  const [ar, an, anr, mis] = await Promise.all([
    sb.rpc('my_areas', { c: cid }),
    sb.from('announcements').select('*').eq('club_id', cid).is('deleted_at', null).order('created_at', { ascending: false }).limit(60),
    sb.from('announcement_reads').select('announcement_id').eq('user_id', S.me.id),
    inList(sb.from('event_missions').select('*').order('position'), 'event_id', eids),
  ]);
  S.areas = ar.data || []; S.annonces = an.data || []; S.annRead = new Set((anr.data || []).map((x) => x.announcement_id)); S.missions = mis.data || [];
  S.signups = S.missions.length ? ((await sb.from('mission_signups').select('*').in('mission_id', S.missions.map((m) => m.id))).data || []) : [];
  const clubIds = [...new Set(S.mems.filter((m) => m.status === 'active').map((m) => m.club_id))];
  S.overview = clubIds.length > 1 ? ((await sb.rpc('my_clubs_overview')).data || []) : [];
  S.payments = pay.data || []; S.follows = (fol.data || []).map((x) => x.team_id); S.cteams = ct.data || []; S.myGroups = mg.data || [];
  S.contacts = cl.data || []; S.myContact = mc.data || null;
  S.previews = {}; (gp.data || []).forEach((x) => (S.previews[x.group_id] = x));
  await loadNames((gp.data || []).map((x) => x.user_id));
  // n° 36 : messages non lus par groupe (depuis la dernière ouverture)
  S.unread = {};
  if (S.myGroups.length) {
    const since = S.myGroups.map((g) => g.last_read_at).sort()[0];
    const un = await sb.from('messages').select('id,group_id,created_at,user_id').in('group_id', S.myGroups.map((g) => g.group_id)).gt('created_at', since).neq('user_id', S.me.id).limit(500);
    (un.data || []).forEach((m) => { const g = S.myGroups.find((x) => x.group_id === m.group_id); if (g && m.created_at > g.last_read_at) S.unread[m.group_id] = (S.unread[m.group_id] || 0) + 1; });
  }
  S.pparents = pp.data || []; S.padmin = pa.data || []; S.att = at.data || []; S.pteams = pt.data || [];
  S.resp = rs.data || []; S.lastMsgs = lm.data || []; S.discounts = dc.data || [];
  const uids = S.members.map((m) => m.user_id).concat(S.pparents.map((x) => x.user_id), S.lastMsgs.map((m) => m.user_id), S.resp.map((r) => r.user_id), S.signups.map((x) => x.user_id), S.annonces.map((a) => a.created_by));
  await loadNames(uids);
  const ph = await sb.rpc('phones_for', { p_ids: [...new Set(uids)] });
  S.phones = {}; (ph.data || []).forEach((x) => (S.phones[x.id] = x.phone));
  S.updated = hm();
}
export async function loadGroup(gid) {
  const [m, p, gm] = await Promise.all([
    sb.from('messages').select('*').eq('group_id', gid).order('created_at').limit(200),
    sb.from('polls').select('*').eq('group_id', gid).order('created_at'),
    sb.from('group_members').select('*').eq('group_id', gid),
  ]);
  S.msgs = m.data || []; S.polls = p.data || []; S.gmembers = gm.data || [];
  await loadNames(S.gmembers.map((x) => x.user_id).concat(S.msgs.map((x) => x.user_id), S.polls.map((x) => x.deleted_by), S.polls.map((x) => x.created_by)));
  const pids = S.polls.filter((x) => !x.deleted_at).map((x) => x.id);
  S.votes = pids.length ? ((await sb.from('poll_votes').select('*').in('poll_id', pids)).data || []) : [];
}
// Mise à jour automatique : si une nouvelle version est en ligne, l'application se recharge seule
export async function checkVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }), j = await r.json();
    if (j.version && j.version !== VERSION && !sessionStorage.getItem('pc_rl_' + j.version)) { sessionStorage.setItem('pc_rl_' + j.version, '1'); location.reload(); return true; }
  } catch { /* hors ligne */ }
  return false;
}
