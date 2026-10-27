// Mon Blason · alpha · application (une seule page, sans étape de compilation)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VERSION } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLES = { president: 'Président', bureau: 'Membre du bureau', coach: 'Coach', joueur: 'Joueur', parent: 'Parent de joueur', supporteur: 'Supporteur' };
const JOIN_ROLES = ['supporteur', 'parent', 'joueur', 'coach', 'bureau'];
const SPORTS = ['Basket-ball', 'Volley-ball', 'Tennis de table'];
const TYPES = ['Entraînement', 'Match', 'Plateau', 'Tournoi', 'Événement'];
const TABS = ['Accueil', 'Agenda', 'Messages', 'Club', 'Compte'];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const S = {
  session: null, me: null, mems: [], clubs: {}, clubId: store.get('mb_club'), tab: 0, view: null,
  members: [], names: {}, teams: [], events: [], resp: [], groups: [], lastMsgs: [], msgs: [], polls: [], votes: [], gmembers: [],
  authMode: 'login', onb: null, join: { code: '', role: 'supporteur', teams: [] }, form: null,
  updated: null, online: navigator.onLine, busy: false, channel: null,
};

// ---------- utilitaires ----------
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3000); }
function hm(d = new Date()) { return d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0'); }
function fmtDate(iso) { return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); }
function fmtShort(iso) { const d = new Date(iso); return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + hm(d); }
function lum(hex) { const n = parseInt(hex.slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); }
function onColor(hex) { return lum(hex) > 0.3 ? '#111218' : '#FFFFFF'; }
function club() { return S.clubs[S.clubId]; }
function myMem() { return S.mems.filter((m) => m.club_id === S.clubId); }
function isStaff() { return myMem().some((m) => m.status === 'active' && ['president', 'bureau', 'coach'].includes(m.role)); }
function isActive() { return myMem().some((m) => m.status === 'active'); }
function name(id) { return S.names[id] || 'Membre'; }
function teamName(id) { return (S.teams.find((t) => t.id === id) || {}).name || ''; }
function initials(n) { return n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
let crestN = 0;
const SHIELD = 'M3 3h34v20c0 11-8 18-17 21C11 41 3 34 3 23z';
function crest(c, size = 40) {
  const a = c?.color1 || '#0B6B3A', b = c?.color2 || '#FFD400', t = onColor(a);
  if (c?.logo) { const id = 'cl' + (++crestN); return `<svg class="crest" width="${size}" height="${size * 1.15}" viewBox="0 0 40 46" aria-hidden="true"><defs><clipPath id="${id}"><path d="${SHIELD}"/></clipPath></defs><path d="${SHIELD}" fill="#fff"/><image href="${esc(c.logo)}" x="5" y="5" width="30" height="34" preserveAspectRatio="xMidYMid meet" clip-path="url(#${id})"/><path d="${SHIELD}" fill="none" stroke="${b}" stroke-width="3"/></svg>`; }
  return `<svg class="crest" width="${size}" height="${size * 1.15}" viewBox="0 0 40 46" aria-hidden="true"><path d="M3 3h34v20c0 11-8 18-17 21C11 41 3 34 3 23z" fill="${a}" stroke="${b}" stroke-width="3"/><path d="M20 3h17v20H20z" fill="${b}" opacity=".9"/><text x="20" y="31" text-anchor="middle" font-family="Barlow Condensed,sans-serif" font-style="italic" font-weight="800" font-size="15" fill="${t}" stroke="${a}" stroke-width=".6">${esc(initials(c?.name || 'MB'))}</text></svg>`;
}
async function readLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const k = Math.min(1, 256 / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
    let data = cv.toDataURL('image/webp', 0.9); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/png');
    const sm = document.createElement('canvas'); sm.width = sm.height = 32; const x = sm.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data, cnt = {};
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 200) continue; const r = px[i] >> 4, g = px[i + 1] >> 4, bl = px[i + 2] >> 4, hx = '#' + [r, g, bl].map((v) => (v * 17).toString(16).padStart(2, '0')).join('').toUpperCase(); const L = lum(hx); if (L > 0.85 || L < 0.01) continue; cnt[hx] = (cnt[hx] || 0) + 1; }
    const top = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p]), dist = (p, q) => { const A = parseInt(p.slice(1), 16), B = parseInt(q.slice(1), 16); return Math.abs((A >> 16) - (B >> 16)) + Math.abs(((A >> 8) & 255) - ((B >> 8) & 255)) + Math.abs((A & 255) - (B & 255)); };
    const c1 = top[0], c2 = top.find((q) => dist(q, c1) > 120);
    return { data, colors: [c1, c2].filter(Boolean) };
  } finally { URL.revokeObjectURL(url); }
}
function previewHtml(nm, c1, c2, logo) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:${c1};color:${onColor(c1)};border-bottom:5px solid ${c2}">${crest({ name: nm, color1: c1, color2: c2, logo }, 44)}<div style="font-family:var(--titre);font-style:italic;font-weight:800;font-size:22px;text-transform:uppercase;line-height:1.05">${esc(nm || 'Mon club')}</div></div>`;
}
function updatePreview(f) {
  const p = f?.querySelector('[data-prev]'); if (!p) return;
  const v = Object.fromEntries(new FormData(f));
  const cr = f.id === 'clubf'; p.innerHTML = previewHtml(cr ? v.name : club()?.name, v.c1, v.c2, S.tmpLogo === undefined ? (cr ? null : club()?.logo) : S.tmpLogo);
}
function logoField(hasLogo) {
  return `<div class="field"><label for="lg">Logo du club (image, facultatif)</label><input id="lg" type="file" accept="image/*" data-logo="1"></div>${hasLogo ? '<button type="button" class="btn small" data-act="logorm">Retirer le logo</button>' : ''}<p class="note">Une image prise sur votre téléphone ou enregistrée depuis la page Facebook ou Instagram du club. Les couleurs du logo sont proposées automatiquement, vous pouvez les changer.</p>`;
}
function applyTheme() {
  const c = club(), r = document.documentElement.style;
  const a = c?.color1 || '#0B6B3A', b = c?.color2 || '#FFD400';
  r.setProperty('--c1', a); r.setProperty('--c2', b); r.setProperty('--on1', onColor(a));
  document.querySelector('meta[name=theme-color]').content = a;
}
async function run(p, ok) {
  if (!navigator.onLine) { toast('Hors connexion : cette action attend le retour du réseau.'); return null; }
  const { data, error } = await p;
  if (error) { console.error(error); toast('Erreur : ' + (error.message || 'action impossible')); return null; }
  if (ok) toast(ok);
  return data ?? true;
}

// ---------- chargement des données ----------
async function loadMe() {
  const uid = S.session.user.id;
  const [{ data: prof }, { data: mems }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('memberships').select('*').eq('user_id', uid),
  ]);
  S.me = prof || { id: uid, full_name: '' };
  S.mems = mems || [];
  const ids = [...new Set(S.mems.map((m) => m.club_id))];
  S.clubs = {};
  if (ids.length) { const { data: cl } = await sb.from('clubs').select('*').in('id', ids); (cl || []).forEach((c) => (S.clubs[c.id] = c)); }
  if (!S.clubs[S.clubId]) { const act = S.mems.find((m) => m.status === 'active'); S.clubId = act ? act.club_id : ids[0] || null; }
  if (S.clubId) store.set('mb_club', S.clubId);
}
async function loadClub() {
  if (!S.clubId || !isActive()) return;
  const cid = S.clubId, now = new Date(Date.now() - 6 * 3600e3).toISOString();
  const [mem, teams, evs, grps] = await Promise.all([
    sb.from('memberships').select('*').eq('club_id', cid),
    sb.from('teams').select('*').eq('club_id', cid).order('name'),
    sb.from('events').select('*').eq('club_id', cid).gte('starts_at', now).order('starts_at').limit(60),
    sb.from('groups').select('*').eq('club_id', cid).order('created_at', { ascending: false }),
  ]);
  S.members = mem.data || []; S.teams = teams.data || []; S.events = evs.data || []; S.groups = grps.data || [];
  const uids = [...new Set(S.members.map((m) => m.user_id))];
  if (uids.length) { const { data: pr } = await sb.from('profiles').select('id,full_name').in('id', uids); (pr || []).forEach((p) => (S.names[p.id] = p.full_name || 'Membre')); }
  const eids = S.events.map((e) => e.id);
  S.resp = eids.length ? ((await sb.from('event_responses').select('*').in('event_id', eids)).data || []) : [];
  const gids = S.groups.map((g) => g.id);
  S.lastMsgs = gids.length ? ((await sb.from('messages').select('*').in('group_id', gids).order('created_at', { ascending: false }).limit(8)).data || []) : [];
  S.updated = hm();
}
async function loadGroup(gid) {
  const [m, p, gm] = await Promise.all([
    sb.from('messages').select('*').eq('group_id', gid).order('created_at').limit(200),
    sb.from('polls').select('*').eq('group_id', gid).order('created_at'),
    sb.from('group_members').select('*').eq('group_id', gid),
  ]);
  S.msgs = m.data || []; S.polls = p.data || []; S.gmembers = gm.data || [];
  const pids = S.polls.map((x) => x.id);
  S.votes = pids.length ? ((await sb.from('poll_votes').select('*').in('poll_id', pids)).data || []) : [];
}
async function refresh(msg) {
  if (!navigator.onLine) { toast('Pas de réseau : vous voyez les dernières données chargées.'); return; }
  await loadMe(); await loadClub();
  if (S.view?.type === 'group') await loadGroup(S.view.id);
  render(); subscribe(); if (msg) toast('À jour.');
}

// ---------- temps réel ----------
function subscribe() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  if (!S.clubId || !isActive()) return;
  S.channel = sb.channel('club-' + S.clubId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
      const m = p.new; if (!S.groups.some((g) => g.id === m.group_id)) return;
      S.lastMsgs.unshift(m);
      if (S.view?.type === 'group' && S.view.id === m.group_id && !S.msgs.some((x) => x.id === m.id)) { S.msgs.push(m); render(true); scrollEnd(); }
      else if (m.user_id !== S.me.id) { toast((grp(m.group_id)?.name || 'Groupe') + ' : nouveau message'); if (!S.view) render(true); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, async () => { if (S.view?.type === 'group') { await loadGroup(S.view.id); render(true); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_responses' }, async () => {
      const eids = S.events.map((e) => e.id); if (!eids.length) return;
      S.resp = (await sb.from('event_responses').select('*').in('event_id', eids)).data || []; render(true);
    })
    .subscribe();
}
const grp = (id) => S.groups.find((g) => g.id === id);
function scrollEnd() { setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30); }

// ---------- écrans ----------
function syncBar() {
  return (S.online ? '' : '<div class="offline">Hors connexion · vous consultez les dernières données chargées. Les envois reprendront au retour du réseau.</div>') +
    `<div class="sync"><span style="flex:1">${S.updated ? 'Mis à jour à ' + S.updated : ''}</span><button data-act="refresh">⟳ Actualiser</button></div>`;
}
function head(title, sub, back) {
  const c = club();
  return `<header class="hd">${back ? '<button class="back" data-act="back" aria-label="Retour">‹</button>' : ''}${c ? crest(c, 38) : ''}<div class="grow"><div class="t">${esc(title)}</div><div class="s">${esc(sub || '')}</div></div></header>`;
}
function brandHead(sub) { return `<header class="hd"><div class="grow"><div class="t">Mon Blason</div><div class="s">${esc(sub || 'Mon club, mes couleurs')}</div></div></header>`; }

function authScreen() {
  const L = S.authMode === 'login';
  return brandHead() + `<main class="bd"><h1>${L ? 'Connexion' : 'Créer un compte'}</h1>
  <div class="chips"><button class="chip" data-act="authmode" data-v="login" aria-pressed="${L}">J'ai un compte</button><button class="chip" data-act="authmode" data-v="signup" aria-pressed="${!L}">Créer un compte</button></div>
  <form id="authf" class="card" style="display:flex;flex-direction:column;gap:12px">
  ${L ? '' : '<div class="field"><label for="an">Prénom et nom</label><input id="an" name="full_name" required autocomplete="name"></div>'}
  <div class="field"><label for="ae">Adresse e-mail</label><input id="ae" name="email" type="email" required autocomplete="email"></div>
  <div class="field"><label for="ap">Mot de passe${L ? '' : ' (8 caractères minimum)'}</label><div style="display:flex;gap:8px"><input id="ap" name="password" type="password" required minlength="${L ? 1 : 8}" autocomplete="${L ? 'current-password' : 'new-password'}" style="flex:1;min-width:0"><button type="button" class="btn small" data-act="pwtog" aria-label="Afficher le mot de passe" aria-pressed="false">Afficher</button></div></div>
  <button class="btn main" type="submit">${L ? 'Se connecter' : 'Créer mon compte'}</button></form>
  ${L ? '<button class="btn small" data-act="forgot" style="align-self:center;border:0">Mot de passe oublié ?</button>' : ''}
  <p class="note">Version ${VERSION} · données de test.</p></main>`;
}

function onboarding() {
  const o = S.onb, pend = S.mems.filter((m) => m.status === 'pending');
  let h = brandHead('Bienvenue ' + (S.me.full_name || '')) + '<main class="bd">';
  if (pend.length && !o) {
    h += `<div class="card hi"><div class="kick">Demande en attente</div>${pend.map((m) => `<div style="font-weight:800;margin-top:6px">${esc(S.clubs[m.club_id]?.name || 'Club')} · ${ROLES[m.role]}</div>`).join('')}<p class="note" style="margin-top:6px">Le club doit valider votre demande. Touchez « Actualiser » ensuite.</p></div>${syncBar()}`;
  }
  if (!o) {
    h += `<h1>Mon club</h1><button class="btn main" data-act="onb" data-v="join">Rejoindre un club avec son code</button><button class="btn" data-act="onb" data-v="create">Créer mon club</button><button class="btn small" data-act="logout" style="align-self:center;border:0">Se déconnecter</button>`;
  } else if (o === 'create') {
    h += `<h1>Créer mon club</h1><form id="clubf" class="card" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label for="cn">Nom du club</label><input id="cn" name="name" required></div>
      <div class="field"><label for="cv">Ville</label><input id="cv" name="city"></div>
      <div class="field"><label for="cs">Sport</label><select id="cs" name="sport">${SPORTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
      ${logoField(!!S.tmpLogo)}
      <div class="grid2"><div class="field"><label for="c1">Couleur principale</label><input id="c1" name="c1" type="color" value="#0B6B3A"></div><div class="field"><label for="c2">Seconde couleur</label><input id="c2" name="c2" type="color" value="#FFD400"></div></div>
      <div class="kick">Aperçu</div><div data-prev>${previewHtml('', '#0B6B3A', '#FFD400', S.tmpLogo)}</div>
      <button class="btn main" type="submit">Valider et créer le club (j'en suis président)</button></form><button class="btn" data-act="onb" data-v="">Retour</button>`;
  } else {
    const j = S.join;
    h += `<h1>Rejoindre un club</h1><div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label for="jc">Code du club (6 caractères)</label><input id="jc" data-j="code" value="${esc(j.code)}" autocapitalize="characters" maxlength="6"></div>
      <button class="btn small" data-act="jcheck">Vérifier le code</button>
      ${j.clubName ? `<div style="font-weight:800">Club : ${esc(j.clubName)}</div>` : ''}
      <div class="kick">Je rejoins comme</div><div class="chips">${JOIN_ROLES.map((r) => `<button class="chip" data-act="jrole" data-v="${r}" aria-pressed="${j.role === r}">${ROLES[r]}</button>`).join('')}</div>
      ${j.role === 'parent' ? `<div class="field"><label for="jk">Prénom et nom de l'enfant</label><input id="jk" data-j="child" value="${esc(j.child || '')}"></div>` : ''}
      ${['parent', 'joueur', 'coach'].includes(j.role) && j.teams.length ? `<div class="field"><label for="jt">Équipe</label><select id="jt" data-j="team"><option value="">Je ne sais pas</option>${j.teams.map((t) => `<option value="${t.id}" ${j.team === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
      <p class="note">${j.role === 'supporteur' ? 'Accès immédiat.' : "Le club valide votre demande. En attendant, vous n'avez pas encore accès."}</p>
      <button class="btn main" data-act="jsend">Envoyer</button></div><button class="btn" data-act="onb" data-v="">Retour</button>`;
  }
  return h + '</main>';
}

function respOf(eid) { const r = S.resp.filter((x) => x.event_id === eid); return { oui: r.filter((x) => x.answer === 'oui'), non: r.filter((x) => x.answer === 'non'), mine: (r.find((x) => x.user_id === S.me.id) || {}).answer }; }
function pair(eid) { const m = respOf(eid).mine; return `<div class="pair"><button class="btn oui" data-act="rsvp" data-id="${eid}" data-v="oui" aria-pressed="${m === 'oui'}">${m === 'oui' ? '✓ ' : ''}Je viens</button><button class="btn non" data-act="rsvp" data-id="${eid}" data-v="non" aria-pressed="${m === 'non'}">Je ne viens pas</button></div>`; }
function evLine(e, withPair) {
  const r = respOf(e.id);
  return `<div class="card"><button class="row" style="border:0;padding:0;min-height:44px" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(e.type)}${e.team_id ? ' · ' + esc(teamName(e.team_id)) : ''} · ${esc(fmtShort(e.starts_at))}${e.place ? ' · ' + esc(e.place) : ''}</small></span><span class="chev">›</span></button>
  <div class="chips" style="margin-top:6px"><span class="pill ok">${r.oui.length} viennent</span><span class="pill">${r.non.length} ne viennent pas</span></div>${withPair ? pair(e.id) : ''}</div>`;
}
function home() {
  const todo = S.events.filter((e) => !respOf(e.id).mine).slice(0, 5);
  let h = `<div class="kick">Bonjour ${esc((S.me.full_name || '').split(' ')[0])}</div><h1>Accueil</h1>`;
  h += `<div class="kick">À répondre${todo.length ? ' · ' + todo.length : ''}</div>` + (todo.length ? todo.map((e) => evLine(e, true)).join('') : '<p class="empty">Rien à répondre pour le moment.</p>');
  const next = S.events.filter((e) => respOf(e.id).mine).slice(0, 3);
  if (next.length) h += '<div class="kick">Mes prochains rendez-vous</div>' + next.map((e) => evLine(e, false)).join('');
  h += '<div class="kick">Dernières infos</div><div class="card">' + (S.lastMsgs.length ? S.lastMsgs.slice(0, 5).map((m) => `<button class="row" data-act="group" data-id="${m.group_id}"><span class="g">${esc(grp(m.group_id)?.name || 'Groupe')}<small>${esc(name(m.user_id))} : ${esc(m.body.slice(0, 80))}</small></span><span class="chev">›</span></button>`).join('') : '<p class="empty" style="margin:0">Aucun message.</p>') + '</div>';
  return h;
}
function agenda() {
  let h = '<h1>Agenda</h1>';
  if (isStaff()) h += '<button class="btn main" data-act="evnew">Ajouter un rendez-vous</button>';
  h += S.events.length ? S.events.map((e) => evLine(e, true)).join('') : '<p class="empty">Aucun rendez-vous à venir.</p>';
  return h;
}
function eventForm() {
  const f = S.form;
  return `<h1>${f.id ? 'Modifier' : 'Nouveau rendez-vous'}</h1><form id="evf" class="card" style="display:flex;flex-direction:column;gap:12px">
  <div class="chips">${TYPES.map((t) => `<button type="button" class="chip" data-act="evtype" data-v="${t}" aria-pressed="${f.type === t}">${t}</button>`).join('')}</div>
  <div class="field"><label for="et">Titre</label><input id="et" name="title" required value="${esc(f.title || '')}"></div>
  ${['Match', 'Plateau', 'Tournoi'].includes(f.type) ? `<div class="field"><label for="eo">${f.type === 'Match' ? 'Adversaire' : 'Adversaires (séparés par des virgules)'}</label><input id="eo" name="opponents" value="${esc(f.opponents || '')}"></div>` : ''}
  <div class="field"><label for="ed">Date et heure</label><input id="ed" name="starts_at" type="datetime-local" required value="${esc(f.starts_at || '')}"></div>
  <div class="field"><label for="el">Lieu</label><input id="el" name="place" value="${esc(f.place || '')}"></div>
  <div class="field"><label for="eq">Équipe</label><select id="eq" name="team_id"><option value="">Tout le club</option>${S.teams.map((t) => `<option value="${t.id}" ${f.team_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
  <button class="btn main" type="submit">Enregistrer</button></form>`;
}
function eventPage(id) {
  const e = S.events.find((x) => x.id === id); if (!e) return '<p class="empty">Rendez-vous introuvable.</p>';
  const r = respOf(id), list = (a) => a.length ? a.map((x) => esc(name(x.user_id))).join(', ') : '—';
  return `<h1>${esc(e.title)}</h1><div class="det">${esc(e.type)}${e.team_id ? ' · ' + esc(teamName(e.team_id)) : ''}<br>${esc(fmtDate(e.starts_at))}${e.place ? '<br>' + esc(e.place) : ''}${e.opponents ? '<br>Contre : ' + esc(e.opponents) : ''}</div>
  ${pair(id)}<div class="card"><div class="kick">Viennent (${r.oui.length})</div><div>${list(r.oui)}</div><div class="kick" style="margin-top:10px">Ne viennent pas (${r.non.length})</div><div>${list(r.non)}</div></div>
  ${isStaff() ? `<button class="btn danger" data-act="evdel" data-id="${id}">${S.delPend === id ? 'Confirmer la suppression' : 'Supprimer ce rendez-vous'}</button>` : ''}`;
}
function messagesTab() {
  let h = '<h1>Messages</h1><button class="btn main" data-act="gnew">Créer un groupe d\'échange</button>';
  h += '<div class="card">' + (S.groups.length ? S.groups.map((g) => { const last = S.lastMsgs.find((m) => m.group_id === g.id); return `<button class="row" data-act="group" data-id="${g.id}"><span class="g">${esc(g.name)}<small>${last ? esc(name(last.user_id)) + ' : ' + esc(last.body.slice(0, 60)) : 'Pas encore de message'}</small></span><span class="chev">›</span></button>`; }).join('') : '<p class="empty" style="margin:0">Vous ne faites partie d\'aucun groupe.</p>') + '</div>';
  return h + '<p class="note">Les groupes remplacent WhatsApp : covoiturage, organisation, sondages. Seuls les membres invités les voient.</p>';
}
function groupForm() {
  const f = S.form, act = S.members.filter((m) => m.status === 'active' && m.user_id !== S.me.id);
  const people = [...new Map(act.map((m) => [m.user_id, m])).values()];
  return `<h1>Nouveau groupe</h1><div class="card" style="display:flex;flex-direction:column;gap:12px">
  <div class="field"><label for="gn">Nom du groupe</label><input id="gn" data-f="name" value="${esc(f.name || '')}" placeholder="Ex. U9 · Parents et coachs"></div>
  <div class="kick">Ajouter d'un coup</div><div class="chips">${S.teams.map((t) => `<button class="chip" data-act="gteam" data-id="${t.id}">${esc(t.name)}</button>`).join('')}<button class="chip" data-act="gstaff">Président, bureau et coachs</button></div>
  <div class="kick">Membres invités (${f.sel.size})</div>${people.length ? people.map((m) => `<label class="check"><input type="checkbox" data-act="gsel" data-id="${m.user_id}" ${f.sel.has(m.user_id) ? 'checked' : ''}><span>${esc(name(m.user_id))} <span class="det">· ${ROLES[m.role]}${m.team_id ? ' ' + esc(teamName(m.team_id)) : ''}</span></span></label>`).join('') : '<p class="empty">Aucun autre membre pour le moment.</p>'}
  <button class="btn main" data-act="gcreate">Créer le groupe</button></div>`;
}
function groupPage(id) {
  const g = grp(id); if (!g) return '<p class="empty">Groupe introuvable.</p>';
  const mine = S.gmembers.find((x) => x.user_id === S.me.id);
  let h = `<div class="det">${S.gmembers.length} membres : ${S.gmembers.map((x) => esc(name(x.user_id))).join(', ')}</div>`;
  h += S.polls.map((p) => { const v = S.votes.filter((x) => x.poll_id === p.id), my = (v.find((x) => x.user_id === S.me.id) || {}).answer;
    return `<div class="card hi"><div class="kick">Sondage · ${esc(name(p.created_by))}</div><div style="font-weight:800;margin-top:4px">${esc(p.question)}</div><div class="chips" style="margin-top:8px">${['Présent', 'Absent', 'Je ne sais pas'].map((a) => `<button class="chip" data-act="vote" data-id="${p.id}" data-v="${a}" aria-pressed="${my === a}">${a} · ${v.filter((x) => x.answer === a).length}</button>`).join('')}</div><div class="det" style="margin-top:6px">${v.length} réponse${v.length > 1 ? 's' : ''} sur ${S.gmembers.length}</div></div>`; }).join('');
  h += '<div class="msgs">' + (S.msgs.length ? S.msgs.map((m) => `<div class="bub ${m.user_id === S.me.id ? 'me' : ''}">${m.user_id === S.me.id ? '' : `<div class="who">${esc(name(m.user_id))}</div>`}<div>${esc(m.body)}</div><div class="when">${esc(fmtShort(m.created_at))}</div></div>`).join('') : '<p class="empty">Écrivez le premier message.</p>') + '</div>';
  h += `<form id="msgf" class="compose"><input name="body" placeholder="Votre message" autocomplete="off" maxlength="2000" aria-label="Message"><button class="btn main small" type="submit">Envoyer</button></form>`;
  h += `<div class="chips"><button class="chip" data-act="pollnew">+ Sondage</button><button class="chip" data-act="gmute" aria-pressed="${!!mine?.muted}">${mine?.muted ? 'Notifications coupées' : 'Couper les notifications'}</button>${g.created_by === S.me.id ? `<button class="chip" data-act="gdel" data-id="${id}">${S.delPend === id ? 'Confirmer la suppression' : 'Supprimer le groupe'}</button>` : '<button class="chip" data-act="gleave">Quitter le groupe</button>'}</div>`;
  return h;
}
function clubTab() {
  const c = club(), staff = isStaff(), pend = S.members.filter((m) => m.status === 'pending'), act = S.members.filter((m) => m.status === 'active');
  let h = `<h1>${esc(c.name)}</h1><div class="det">${esc(c.sport)}${c.city ? ' · ' + esc(c.city) : ''}</div>`;
  if (myMem().some((m) => m.status === 'active' && ['president', 'bureau'].includes(m.role))) h += `<details class="card"><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">Blason et couleurs du club</summary><form id="brandf" style="display:flex;flex-direction:column;gap:12px;margin-top:10px"><div data-prev>${previewHtml(c.name, c.color1, c.color2, S.tmpLogo === undefined ? c.logo : S.tmpLogo)}</div>${logoField(S.tmpLogo === undefined ? !!c.logo : !!S.tmpLogo)}<div class="grid2"><div class="field"><label for="b1">Couleur principale</label><input id="b1" name="c1" type="color" value="${esc(c.color1.toLowerCase())}"></div><div class="field"><label for="b2">Seconde couleur</label><input id="b2" name="c2" type="color" value="${esc(c.color2.toLowerCase())}"></div></div><button class="btn main" type="submit">Enregistrer le blason</button></form></details>`;
  h += `<div class="card hi"><div class="kick">Code pour rejoindre le club</div><div style="font-family:var(--titre);font-style:italic;font-weight:800;font-size:40px;letter-spacing:.08em">${esc(c.join_code)}</div><button class="btn small" data-act="share">Partager l'invitation</button></div>`;
  if (staff && pend.length) h += `<div class="kick">Demandes à valider (${pend.length})</div><div class="card">${pend.map((m) => `<div class="row" style="cursor:default"><span class="g">${esc(name(m.user_id))}<small>${ROLES[m.role]}${m.team_id ? ' · ' + esc(teamName(m.team_id)) : ''}${m.child_name ? ' · enfant : ' + esc(m.child_name) : ''}</small></span><button class="btn small main" data-act="mok" data-id="${m.id}">Valider</button><button class="btn small" data-act="mno" data-id="${m.id}">Refuser</button></div>`).join('')}</div>`;
  h += `<div class="kick">Équipes (${S.teams.length})</div><div class="card">${S.teams.length ? S.teams.map((t) => { const n = act.filter((m) => m.team_id === t.id).length; return `<div class="row" style="cursor:default"><span class="g">${esc(t.name)}<small>${n} membre${n > 1 ? 's' : ''}</small></span>${staff ? `<button class="btn small" data-act="tdel" data-id="${t.id}">${S.delPend === t.id ? 'Confirmer' : 'Supprimer'}</button>` : ''}</div>`; }).join('') : '<p class="empty" style="margin:0">Aucune équipe.</p>'}</div>`;
  if (staff) h += `<form id="teamf" style="display:flex;gap:8px"><input name="name" placeholder="Nouvelle équipe (ex. U9)" required style="flex:1;min-height:50px;padding:10px 12px;border:2px solid var(--trait);border-radius:12px"><button class="btn small main" type="submit">Ajouter</button></form>`;
  h += `<div class="kick">Membres (${act.length})</div><div class="card">${act.map((m) => `<div class="row" style="cursor:default"><span class="g">${esc(name(m.user_id))}<small>${ROLES[m.role]}${m.team_id ? ' · ' + esc(teamName(m.team_id)) : ''}${m.child_name ? ' · enfant : ' + esc(m.child_name) : ''}</small></span>${staff && m.user_id !== S.me.id && m.role !== 'president' ? `<button class="btn small" data-act="mdel" data-id="${m.id}">${S.delPend === m.id ? 'Confirmer' : 'Retirer'}</button>` : ''}</div>`).join('')}</div>`;
  return h;
}
function compte() {
  const clubs = Object.values(S.clubs);
  return `<h1>Compte</h1><form id="proff" class="card" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="pn">Prénom et nom</label><input id="pn" name="full_name" value="${esc(S.me.full_name)}" required></div><div class="field"><label for="pt">Téléphone (visible des membres de vos clubs)</label><input id="pt" name="phone" type="tel" value="${esc(S.me.phone || '')}"></div><button class="btn main" type="submit">Enregistrer</button></form>
  <div class="kick">Mes clubs et profils</div><div class="card">${clubs.map((c) => `<button class="row" data-act="club" data-id="${c.id}">${crest(c, 30)}<span class="g">${esc(c.name)}<small>${S.mems.filter((m) => m.club_id === c.id).map((m) => ROLES[m.role] + (m.status === 'pending' ? ' (en attente)' : '')).join(', ')}</small></span>${c.id === S.clubId ? '<span class="pill ok">Affiché</span>' : '<span class="chev">›</span>'}</button>`).join('')}</div>
  <button class="btn" data-act="onbopen">Rejoindre ou créer un autre club</button>
  <button class="btn" data-act="leave">${S.delPend === 'leave' ? 'Confirmer : quitter ce club' : 'Quitter ce club'}</button>
  <button class="btn" data-act="logout">Se déconnecter</button><p class="note">${esc(S.session.user.email)} · Mon Blason ${VERSION}</p>`;
}

function render(keep) {
  const y = keep ? window.scrollY : 0, app = $('#app');
  applyTheme();
  if (!S.session) { app.innerHTML = authScreen(); return; }
  if (!S.me) { app.innerHTML = '<div class="splash"><div class="brand">Mon Blason</div></div>'; return; }
  if (!S.clubId || !isActive() || S.onb !== null) { app.innerHTML = onboarding(); return; }
  const v = S.view, c = club();
  let hd, bd;
  if (v?.type === 'event') { hd = head('Rendez-vous', c.name, true); bd = eventPage(v.id); }
  else if (v?.type === 'evform') { hd = head('Agenda', c.name, true); bd = eventForm(); }
  else if (v?.type === 'gform') { hd = head('Messages', c.name, true); bd = groupForm(); }
  else if (v?.type === 'group') { hd = head(grp(v.id)?.name || 'Groupe', 'Groupe d\'échange', true); bd = groupPage(v.id); }
  else { hd = head(c.name, myMem().filter((m) => m.status === 'active').map((m) => ROLES[m.role]).join(' · ')); bd = [home, agenda, messagesTab, clubTab, compte][S.tab](); }
  app.innerHTML = hd + `<main class="bd">${syncBar()}${bd}</main><nav class="tb" aria-label="Onglets"><div>${TABS.map((t, i) => `<button data-act="tab" data-i="${i}" ${i === S.tab && !v ? 'aria-current="page"' : ''}>${t}</button>`).join('')}</div></nav>`;
  window.scrollTo(0, y);
}

// ---------- actions ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, d = el.dataset;
  if (el.tagName === 'INPUT' && a !== 'gsel') return;
  if (a !== 'gsel') e.preventDefault();
  const keepDel = ['evdel', 'gdel', 'tdel', 'mdel', 'leave'].includes(a); if (!keepDel) S.delPend = null;
  switch (a) {
    case 'authmode': S.authMode = d.v; return render();
    case 'pwtog': { const i = $('#ap'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Masquer' : 'Afficher'; el.setAttribute('aria-pressed', show); el.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); return; }
    case 'logorm': { S.tmpLogo = null; const f = el.closest('form'); el.remove(); updatePreview(f); return; }
    case 'forgot': { const em = $('#ae')?.value; if (!em) return toast('Indiquez votre adresse e-mail.'); await run(sb.auth.resetPasswordForEmail(em, { redirectTo: location.href.split('#')[0] }), 'E-mail de réinitialisation envoyé.'); return; }
    case 'logout': await sb.auth.signOut(); return;
    case 'refresh': return refresh(true);
    case 'tab': S.tab = +d.i; S.view = null; S.tmpLogo = undefined; render(); return;
    case 'back': S.view = null; S.form = null; render(); return;
    case 'onb': S.tmpLogo = undefined; S.onb = d.v || null; if (!d.v && isActive()) S.onb = null; render(); return;
    case 'onbopen': S.onb = ''; render(); return;
    case 'jrole': S.join.role = d.v; return render(true);
    case 'jcheck': {
      const r = await run(sb.rpc('teams_for_code', { p_code: S.join.code }));
      if (r) { S.join.teams = r; S.join.clubName = r[0]?.club_name || (r.length === 0 ? 'Code accepté (le club n\'a pas encore d\'équipe)' : ''); render(true); }
      return;
    }
    case 'jsend': {
      if (!S.join.code) return toast('Indiquez le code du club.');
      if (S.join.role === 'parent' && !(S.join.child || '').trim()) return toast("Indiquez le prénom et le nom de l'enfant.");
      const cid = await run(sb.rpc('join_club', { p_code: S.join.code, p_role: S.join.role, p_team: S.join.team || null, p_child: S.join.child || null }), S.join.role === 'supporteur' ? 'Bienvenue dans le club !' : 'Demande envoyée au club.');
      if (cid) { S.clubId = cid; store.set('mb_club', cid); S.onb = null; S.join = { code: '', role: 'supporteur', teams: [] }; await refresh(); }
      return;
    }
    case 'club': S.clubId = d.id; store.set('mb_club', d.id); S.tab = 0; S.view = null; S.names = {}; await refresh(); return;
    case 'rsvp': {
      const mine = respOf(d.id).mine;
      if (mine === d.v) { await run(sb.from('event_responses').delete().eq('event_id', d.id).eq('user_id', S.me.id)); S.resp = S.resp.filter((x) => !(x.event_id === d.id && x.user_id === S.me.id)); }
      else if (await run(sb.from('event_responses').upsert({ event_id: d.id, user_id: S.me.id, answer: d.v, updated_at: new Date().toISOString() }))) { S.resp = S.resp.filter((x) => !(x.event_id === d.id && x.user_id === S.me.id)); S.resp.push({ event_id: d.id, user_id: S.me.id, answer: d.v }); }
      return render(true);
    }
    case 'event': S.view = { type: 'event', id: d.id }; return render();
    case 'evnew': { const t = new Date(Date.now() + 864e5); t.setMinutes(0); S.form = { type: 'Entraînement', starts_at: new Date(t - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) }; S.view = { type: 'evform' }; return render(); }
    case 'evtype': { const f = new FormData($('#evf')); Object.assign(S.form, Object.fromEntries(f)); S.form.type = d.v; return render(true); }
    case 'evdel': if (S.delPend !== d.id) { S.delPend = d.id; return render(true); } S.delPend = null; if (await run(sb.from('events').delete().eq('id', d.id), 'Rendez-vous supprimé.')) { S.view = null; await refresh(); } return;
    case 'gnew': S.form = { name: '', sel: new Set() }; S.view = { type: 'gform' }; return render();
    case 'gsel': { S.form.sel[el.checked ? 'add' : 'delete'](d.id); return render(true); }
    case 'gteam': S.members.filter((m) => m.status === 'active' && m.team_id === d.id && m.user_id !== S.me.id).forEach((m) => S.form.sel.add(m.user_id)); return render(true);
    case 'gstaff': S.members.filter((m) => m.status === 'active' && ['president', 'bureau', 'coach'].includes(m.role) && m.user_id !== S.me.id).forEach((m) => S.form.sel.add(m.user_id)); return render(true);
    case 'gcreate': {
      const nm = (S.form.name || '').trim(); if (!nm) return toast('Donnez un nom au groupe.');
      const g = await run(sb.from('groups').insert({ club_id: S.clubId, name: nm, created_by: S.me.id }).select().single()); if (!g) return;
      const rows = [S.me.id, ...S.form.sel].map((u) => ({ group_id: g.id, user_id: u }));
      if (await run(sb.from('group_members').insert(rows), 'Groupe créé.')) { S.groups.unshift(g); S.form = null; await openGroup(g.id); }
      return;
    }
    case 'group': return openGroup(d.id);
    case 'pollnew': { const q = prompt('Question du sondage (ex. Plateau samedi 7 novembre ?)'); if (!q || !q.trim()) return; if (await run(sb.from('polls').insert({ group_id: S.view.id, question: q.trim(), created_by: S.me.id }), 'Sondage publié.')) { await loadGroup(S.view.id); render(true); } return; }
    case 'vote': if (await run(sb.from('poll_votes').upsert({ poll_id: d.id, user_id: S.me.id, answer: d.v }))) { await loadGroup(S.view.id); render(true); } return;
    case 'gmute': { const mine = S.gmembers.find((x) => x.user_id === S.me.id); if (mine && await run(sb.from('group_members').update({ muted: !mine.muted }).eq('group_id', S.view.id).eq('user_id', S.me.id))) { mine.muted = !mine.muted; render(true); } return; }
    case 'gleave': if (await run(sb.from('group_members').delete().eq('group_id', S.view.id).eq('user_id', S.me.id), 'Vous avez quitté le groupe.')) { S.view = null; await refresh(); } return;
    case 'gdel': if (S.delPend !== d.id) { S.delPend = d.id; return render(true); } S.delPend = null; if (await run(sb.from('groups').delete().eq('id', d.id), 'Groupe supprimé.')) { S.view = null; await refresh(); } return;
    case 'share': { const c = club(), txt = `Rejoins ${c.name} sur Mon Blason : ouvre ${location.href.split('#')[0]} puis « Rejoindre un club » avec le code ${c.join_code}.`; if (navigator.share) { try { await navigator.share({ title: 'Mon Blason', text: txt }); } catch {} } else { try { await navigator.clipboard.writeText(txt); toast('Invitation copiée.'); } catch { toast(txt); } } return; }
    case 'mok': if (await run(sb.from('memberships').update({ status: 'active' }).eq('id', d.id), 'Demande validée.')) await refresh(); return;
    case 'mno': if (await run(sb.from('memberships').delete().eq('id', d.id), 'Demande refusée.')) await refresh(); return;
    case 'mdel': if (S.delPend !== d.id) { S.delPend = d.id; return render(true); } S.delPend = null; if (await run(sb.from('memberships').delete().eq('id', d.id), 'Membre retiré du club.')) await refresh(); return;
    case 'tdel': if (S.delPend !== d.id) { S.delPend = d.id; return render(true); } S.delPend = null; if (await run(sb.from('teams').delete().eq('id', d.id), 'Équipe supprimée.')) await refresh(); return;
    case 'leave': if (S.delPend !== 'leave') { S.delPend = 'leave'; return render(true); } S.delPend = null; if (await run(sb.from('memberships').delete().eq('club_id', S.clubId).eq('user_id', S.me.id), 'Vous avez quitté le club.')) { S.clubId = null; S.tab = 0; await refresh(); } return;
  }
});
async function openGroup(id) { S.view = { type: 'group', id }; await loadGroup(id); render(); scrollEnd(); }

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.j) { S.join[t.dataset.j] = t.dataset.j === 'code' ? t.value.toUpperCase() : t.value; }
  if (t.dataset.f && S.form) S.form[t.dataset.f] = t.value;
  if (t.closest('#clubf,#brandf') && t.type !== 'file') updatePreview(t.closest('form'));
});
document.addEventListener('change', async (e) => {
  const t = e.target; if (t.dataset.j) S.join[t.dataset.j] = t.value;
  if (t.dataset.logo && t.files?.[0]) {
    try {
      const r = await readLogo(t.files[0]); S.tmpLogo = r.data; const f = t.closest('form');
      if (r.colors[0]) f.querySelector('[name=c1]').value = r.colors[0].toLowerCase();
      if (r.colors[1]) f.querySelector('[name=c2]').value = r.colors[1].toLowerCase();
      updatePreview(f); toast(r.colors.length ? 'Logo ajouté. Couleurs proposées d\'après le logo.' : 'Logo ajouté.');
    } catch { toast('Image illisible. Essayez une image PNG ou JPG.'); }
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f)), btn = f.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (f.id === 'authf') {
      if (S.authMode === 'login') { await run(sb.auth.signInWithPassword({ email: v.email, password: v.password })); }
      else { const r = await run(sb.auth.signUp({ email: v.email, password: v.password, options: { data: { full_name: v.full_name.trim() } } })); if (r && !r.session) toast('Compte créé. Confirmez votre adresse depuis l\'e-mail reçu, puis connectez-vous.'); }
    } else if (f.id === 'clubf') {
      const cid = await run(sb.rpc('create_club', { p_name: v.name.trim(), p_city: v.city.trim(), p_sport: v.sport, p_c1: v.c1.toUpperCase(), p_c2: v.c2.toUpperCase() }), 'Club créé. Vous en êtes président.');
      if (cid) { if (S.tmpLogo) await run(sb.from('clubs').update({ logo: S.tmpLogo }).eq('id', cid)); S.tmpLogo = undefined; S.clubId = cid; store.set('mb_club', cid); S.onb = null; S.tab = 3; await refresh(); }
    } else if (f.id === 'brandf') {
      const row = { color1: v.c1.toUpperCase(), color2: v.c2.toUpperCase() }; if (S.tmpLogo !== undefined) row.logo = S.tmpLogo;
      if (await run(sb.from('clubs').update(row).eq('id', S.clubId), 'Blason enregistré.')) { S.tmpLogo = undefined; await refresh(); }
    } else if (f.id === 'evf') {
      const row = { club_id: S.clubId, type: S.form.type, title: v.title.trim(), starts_at: new Date(v.starts_at).toISOString(), place: v.place || '', opponents: v.opponents || '', team_id: v.team_id || null, created_by: S.me.id };
      if (await run(sb.from('events').insert(row), 'Rendez-vous ajouté.')) { S.view = null; S.form = null; S.tab = 1; await refresh(); }
    } else if (f.id === 'msgf') {
      const body = (v.body || '').trim(); if (!body) return;
      const m = await run(sb.from('messages').insert({ group_id: S.view.id, user_id: S.me.id, body }).select().single());
      if (m) { if (!S.msgs.some((x) => x.id === m.id)) S.msgs.push(m); S.lastMsgs.unshift(m); render(true); scrollEnd(); $('#msgf input')?.focus(); }
    } else if (f.id === 'teamf') {
      if (await run(sb.from('teams').insert({ club_id: S.clubId, name: v.name.trim() }), 'Équipe ajoutée.')) await refresh();
    } else if (f.id === 'proff') {
      if (await run(sb.from('profiles').update({ full_name: v.full_name.trim(), phone: v.phone.trim() || null }).eq('id', S.me.id), 'Profil enregistré.')) await refresh();
    }
  } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});

// ---------- connexion, réseau, démarrage ----------
window.addEventListener('online', () => { S.online = true; refresh(); });
window.addEventListener('offline', () => { S.online = false; render(true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session && navigator.onLine) refresh(); });

sb.auth.onAuthStateChange(async (ev, session) => {
  if (ev === 'TOKEN_REFRESHED') { S.session = session; return; }
  S.session = session;
  if (!session) { S.me = null; S.mems = []; S.clubs = {}; S.view = null; if (S.channel) { sb.removeChannel(S.channel); S.channel = null; } render(); return; }
  if (ev === 'PASSWORD_RECOVERY') { const np = prompt('Nouveau mot de passe (8 caractères minimum)'); if (np) await run(sb.auth.updateUser({ password: np }), 'Mot de passe changé.'); }
  setTimeout(() => refresh(), 0);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
