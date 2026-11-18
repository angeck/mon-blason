// mypocketclub · bêta 1.2.0 · n° 245 et n° 202 : espace admin « pro » (maquette v1 https://claude.ai/artifact/W2az8x3pwx1xPeJnTec9th).
// bêta 1.3.0 · n° 245, version 2 (Gaël, 18 novembre 2026 : « Maquette. Ok. Lance la maj » ; maquette https://claude.ai/artifact/GoU3FUKUhcFxSaUSbMgzq8 ;
// chantier claude/71-admin-pro-crm.md) : le suivi se fait PAR CLUB.
//   « Vestiaire » (ex-Cockpit) : « Dis-le à Claude » (« Garder » met la phrase de côté, « Ranger dans un club » la range), actions à mener, chiffres.
//   « Clubs » (ex-« Contacts et CRM » + « Clubs et parc ») : une fiche par club, pastille d'état (Prospect · En test ou gratuit · Client · Perdu),
//   échanges, personnes, infos, compte mypocketclub une fois le club inscrit ; sur ordinateur, la fiche s'ouvre à côté de la liste.
//   Les clubs inscrits sans fiche apparaissent aussi (état déduit de l'abonnement) ; « Créer la fiche de suivi » les fait entrer dans le suivi.
// Rappel : tout passe par des fonctions réservées à l'administrateur (is_app_admin(), session confirmée par le code à 6 chiffres) ;
// les tables du CRM ne sont lisibles par aucun compte. Des personnes réelles seulement dans la base du VRAI site.
import { S, sb, esc, run, render, toast, ACTIONS, FORMS, INPUTS, armed, isArmed, plural, fmtDay } from './core.js';
import { header, icon, field } from './ui.js';
import { V37_TOP } from './v37.js';
import { kcard, hbars, listOrTable, tag } from './b110.js';
import { micBtn, canDictate, stopDictation } from './dictee.js';

const C = () => (S.crm = S.crm || {});
// [clé, nom, classe de la pastille] ; le mot est toujours écrit à côté de la couleur
export const STATES = [['prospect', 'Prospect', 'st-pr'], ['test', 'En test ou gratuit', 'st-te'], ['client', 'Client', 'st-cl'], ['perdu', 'Perdu', 'st-pe']];
const ST = Object.fromEntries(STATES.map((s) => [s[0], s]));
const OLD = { a_contacter: 'prospect', contacte: 'prospect', presentation: 'prospect', payant: 'client' }; // écran à jour avant le script
const stOf = (k) => OLD[k?.stage] || k?.stage || 'prospect';
const stPill = (st) => { const s = ST[OLD[st] || st] || ST.prospect; return `<span class="pill st ${s[2]}">${esc(s[1])}</span>`; };
const KINDS = [['note', 'Note'], ['appel', 'Appel'], ['presentation_live', 'Présentation en live'], ['presentation_visio', 'Présentation en visio'], ['visite', 'Visite'], ['mail_envoye', 'E-mail envoyé'], ['mail_recu', 'E-mail reçu'], ['proposition', 'Proposition'], ['devis', 'Devis'], ['autre', 'Autre']];
const KIND = Object.fromEntries(KINDS);
const QUICK = [['note', 'Note'], ['appel', 'Appel'], ['presentation_live', 'Présentation'], ['mail_recu', 'Mail'], ['visite', 'Visite']]; // « Ranger dans un club »
const INTEREST = ['Intérêt inconnu', '+', '++', '+++'];
const FEATS = { agenda: 'Agenda et réponses', appel: 'Appel', messages: 'Messages', convocations: 'Convocations', annonces: 'Annonces', exercices: 'Exercices', ia: 'Exercices avec l’IA', tactiques: 'Tactiques', seances: 'Séances', cotisations: 'Cotisations', benevoles: 'Bénévoles', heures: 'Heures des coachs' };
const NEED = 'La base n’est pas encore à jour : lance le script MAJ_BETA_1_3_0.sql dans Supabase.';
const GOAL = 350; // seuil estimé pour en vivre (350 à 465 clubs, claude/00-etat-actuel.md)
const DAY = 864e5;
const num = (x) => +x || 0;
const today = () => new Date().toLocaleDateString('sv-SE');
const plusDays = (iso, n) => { const d = new Date((iso && iso >= today() ? iso : today()) + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const dayLbl = (iso) => (iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const sel = (id, name, opts, cur) => `<select id="${id}" name="${name}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wide = () => window.innerWidth >= 960;

// ---------- chargements (chaque appel est refusé par la base sans la double vérification) ----------
async function rpc(name, args) {
  let r; try { r = await sb.rpc(name, args); } catch (e) { r = { error: e }; }
  if (r.error) { C().err = /function|fonction|schema cache|relation|column|colonne/i.test(r.error.message || '') ? NEED : (r.error.message || 'Erreur'); return null; }
  return r.data;
}
const arr = (x) => (Array.isArray(x) ? x : null);
// Vestiaire et Clubs : fiches, chiffres, usage, parc (comptes inscrits), phrases à ranger
export async function crmLoadHome() {
  const c = C(); c.err = null;
  const [ov, us, pk, ib, l] = await Promise.all([rpc('admin_crm_overview'), rpc('admin_usage'), rpc('admin_parc'), rpc('admin_crm_inbox_list'), rpc('admin_crm_list')]);
  if (ov) c.ov = ov; if (us) c.usage = us; if (pk) c.parc = arr(pk) || []; if (ib) c.inbox = arr(ib) || []; if (l) c.list = arr(l) || [];
}
export async function crmLoadList() {
  const c = C(); c.err = null;
  const [l, pk, ib] = await Promise.all([rpc('admin_crm_list'), rpc('admin_parc'), rpc('admin_crm_inbox_list')]);
  if (l) c.list = arr(l) || []; if (pk) c.parc = arr(pk) || []; if (ib) c.inbox = arr(ib) || [];
}
async function loadEvents(id) { if (String(id).startsWith('club:')) { C().events = { id, list: [] }; return; } const l = await rpc('admin_crm_events', { p_contact: id }); if (l) C().events = { id, list: arr(l) || [] }; }
export const crmNeedScript = () => C().err === NEED;

// ---------- les clubs suivis : fiches + clubs inscrits sans fiche (état déduit de l'abonnement) ----------
const parcOf = (k) => (k?.club_id ? (C().parc || []).find((x) => x.id === k.club_id) : null);
function rows() {
  const c = C(), l = c.list || [], linked = new Set(l.map((k) => k.club_id).filter(Boolean));
  const extra = (c.parc || []).filter((x) => !linked.has(x.id)).map((x) => ({ id: 'club:' + x.id, virt: true, org: x.name, city: x.city || '', sport: (x.sport || '').replace('-ball', ''), club_id: x.id, stage: x.status === 'payant' ? 'client' : 'test', people: [], contact_name: '' }));
  return [...l, ...extra];
}
const findRow = (id) => rows().find((k) => k.id === id);
const dueLbl = (d) => { const t = today(); return d < t ? ['En retard', 'ko'] : d === t ? ['Aujourd’hui', 'wait'] : [dayLbl(d), '']; };
const dueOf = (k) => (k.next_at && stOf(k) !== 'perdu' ? dueLbl(k.next_at) : null);
// Pastille du Vestiaire : actions en retard ou du jour
export const crmBadge = () => { const l = C().list; if (l) return l.filter((k) => k.next_at && k.next_at <= today() && stOf(k) !== 'perdu').length; const o = C().ov; return o ? num(o.late) + num(o.today) : 0; };

// ---------- « Dis-le à Claude » ----------
// « Garder » met la phrase de côté ; « Ranger dans un club » la range (échange du club, prochaine action) ; « range mes dictées » reste possible
function filePanel(x) {
  const c = C(), f = c.file || {}, q = norm(f.q), pick = f.pick ? (f.pick === 'new' ? { org: f.q } : findRow(f.pick)) : null;
  const hits = q ? rows().filter((k) => norm([k.org, k.city, k.contact_name].join(' ')).includes(q)).slice(0, 5) : [];
  let h = `<form class="crmfile" id="crmfile" data-id="${esc(x.id)}">
    ${field('crmfq', 'Ranger dans le club', `<input id="crmfq" type="search" data-crmfq="1" value="${esc(f.q || '')}" autocomplete="off" placeholder="Nom du club, ville…">`)}`;
  h += `<div class="crmhits">${hits.map((k) => `<button type="button" class="crmhit" data-act="crmfpick" data-id="${esc(k.id)}" aria-pressed="${f.pick === k.id}"><span>${esc(k.org)}${k.city ? ` · <small>${esc(k.city)}</small>` : ''}</span>${stPill(stOf(k))}</button>`).join('')}`
    + (f.q && f.q.trim() ? `<button type="button" class="crmhit new" data-act="crmfpick" data-id="new" aria-pressed="${f.pick === 'new'}">+ Nouveau prospect « ${esc(f.q.trim())} »</button>` : '<p class="note">Tape le début du nom du club.</p>') + '</div>';
  h += `<div class="chips" role="group" aria-label="C’était"><span class="chiplab">C’était :</span>${QUICK.map(([k, l]) => `<button type="button" class="chip" data-act="crmfk" data-k="${k}" aria-pressed="${(f.kind || 'note') === k}">${l}</button>`).join('')}</div>
    <div class="grid2">${field('crmfa', 'Prochaine action (facultatif)', `<input id="crmfa" name="next_action" maxlength="200" placeholder="Ex. : envoyer la présentation">`)}${field('crmfd', 'Quand', `<input id="crmfd" name="next_at" type="date">`)}</div>
    <div class="btns"><button type="button" class="btn ghost small" data-act="crmfx">Annuler</button><button class="btn main" type="submit" ${pick ? '' : 'disabled'}>${icon('check', 20)}${pick ? 'Ranger dans ' + esc(pick.org) : 'Choisis un club'}</button></div></form>`;
  return h;
}
export function dictCard() {
  const c = C(), inb = c.inbox || [];
  if (c.err === NEED) return `<section class="card dict"><div class="kick">Dis-le à Claude</div><p class="note">${esc(NEED)}</p></section>`;
  let h = `<section class="card dict"><div class="kick">Dis-le à Claude</div>
    <form id="crminb" class="dictf"><label class="sr" for="crmdict">Ta phrase</label><textarea id="crmdict" name="body" data-crmdict="1" rows="2" maxlength="2000" placeholder="Ex. : vu Saint-Chéron, présenté au président, intéressé, rappeler vendredi">${esc(c.draft || '')}</textarea>
    <div class="dictb">${micBtn('crmdict', 'Dicter')}<button class="btn main small" type="submit">${icon('check', 18)}Garder</button></div></form>
    <p class="note">${canDictate() ? '' : 'Sur ce navigateur, utilise le micro du clavier. '}« Garder » met ta phrase de côté. Range-la ensuite dans un club : elle rejoint ses échanges.</p>`;
  if (inb.length) {
    h += `<div class="kick" style="margin-top:6px">À ranger · ${inb.length}</div><div class="crminb">${inb.map((x) => {
      const on = isArmed('crminx' + x.id), open = c.file && c.file.id === x.id;
      return `<div class="crminbx${open ? ' open' : ''}"><p>${esc(x.body)}</p><small>${esc(fmtDay(x.at))}</small>${open ? filePanel(x) : `<div class="btns"><button class="btn small ${on ? 'danger armed' : 'ghost'}" data-act="crminx" data-id="${esc(x.id)}">${on ? 'Retirer ?' : 'Retirer'}</button><button class="btn small main" data-act="crmfile" data-id="${esc(x.id)}">Ranger dans un club</button></div>`}</div>`;
    }).join('')}</div><p class="note">Tu peux aussi me dire « range mes dictées » dans la conversation du projet : je découpe chaque phrase en infos, personnes et actions, tu valides.</p>`;
  }
  return h + '</section>';
}

// ---------- Vestiaire : actions à mener, chiffres ----------
const ktile = ({ l, n, sub = '', hot = false, act = '', attrs = '', subHot = false, small = '', pill = '' }) =>
  `<button class="ckt${hot ? ' hot' : ''}" ${act ? `data-act="${act}"` : 'disabled'} ${attrs}>${pill || `<span class="ckl">${esc(l)}</span>`}<span class="ckn">${esc(String(n))}${small ? `<small>${esc(small)}</small>` : ''}</span>${sub ? `<span class="cks${subHot ? ' warn' : ''}">${esc(sub)}</span>` : ''}</button>`;
export function cockpitTiles({ ov = {}, ai = null, mails = null, todo = 0, todoSub = '', money = (x) => String(x) }) {
  const c = C(), u = c.usage, all = rows(), t = [];
  for (const [k, l] of STATES) {
    const g = all.filter((x) => stOf(x) === k), asleep = k === 'test' ? g.map(parcOf).filter((p) => p && (!p.last_at || Date.now() - new Date(p.last_at) > 14 * DAY)).length : 0;
    t.push({ l, n: g.length, pill: stPill(k), act: 'crmst', attrs: `data-k="${k}"`, sub: asleep ? plural(asleep, 'club dort', 'clubs dorment') : k === 'client' ? `Objectif : ${GOAL}` : '', subHot: asleep > 0 });
  }
  t.push({ l: 'À traiter', n: todo, sub: todo ? todoSub : 'tout est à jour', act: 'admtab', attrs: 'data-k="todo"' });
  t.push({ l: 'Comptes', n: num(ov.accounts), sub: `${num(ov.active7)} actifs sur 7 j`, act: 'admtab', attrs: 'data-k="usage"' });
  if (u) { const used = Object.fromEntries((arr(u.feats) || []).map((f) => [f.k, num(f.n)])), none = num(u.clubs) ? Object.keys(FEATS).filter((k) => !used[k]) : [];
    t.push({ l: 'Ne sert pas', n: num(u.clubs) ? none.length : '—', sub: none.length ? none.slice(0, 3).map((k) => FEATS[k]).join(', ') + (none.length > 3 ? '…' : '') : num(u.clubs) ? 'tout a servi ce mois' : 'aucun club', subHot: none.length > 0, act: 'admtab', attrs: 'data-k="usage"' }); }
  if (mails && !mails.missing) t.push({ l: 'E-mails envoyés', n: num(mails.jour), small: '/' + (num(mails.limite_jour) || 100), sub: 'aujourd’hui', subHot: num(mails.jour) >= 0.8 * (num(mails.limite_jour) || 100), act: 'admtab', attrs: 'data-k="couts"' });
  if (ai && !ai.missing) t.push({ l: 'IA · exercices', n: money(ai.spent_month), sub: `ce mois · ${plural(num(ai.count_month), 'schéma')}`, act: 'admtab', attrs: 'data-k="couts"' });
  return `<div class="cktiles">${t.map(ktile).join('')}</div>`;
}
// Actions à mener : en retard, aujourd'hui, les 7 prochains jours
export function relancesCard() {
  const l = C().list; if (!l) return '';
  const t = today(), wk = plusDays(t, 7), open = l.filter((k) => k.next_at && stOf(k) !== 'perdu').sort((a, b) => a.next_at.localeCompare(b.next_at));
  const groups = [['En retard', 'late', open.filter((k) => k.next_at < t)], ['Aujourd’hui', 'today', open.filter((k) => k.next_at === t)], ['Cette semaine', 'week', open.filter((k) => k.next_at > t && k.next_at <= wk)]];
  const n = groups.reduce((s, g) => s + g[2].length, 0);
  const row = (k, done) => `<div class="crmact"><button class="g tlink" data-act="crmopen" data-id="${esc(k.id)}"><b>${esc(k.next_action || 'À relancer')}</b><small>${esc(k.org)} · ${esc(dayLbl(k.next_at))}</small></button>${stPill(stOf(k))}${done ? `<button class="btn small ghost" data-act="crmdone" data-id="${esc(k.id)}">Fait</button>` : ''}</div>`;
  return `<section class="card"><div class="kh"><h3>Actions à mener</h3><span class="det">${n}</span></div>${n ? groups.filter((g) => g[2].length).map(([lb, cl, g]) => `<div class="kick crmk ${cl}">${lb} · ${g.length}</div>${g.map((k) => row(k, cl !== 'week')).join('')}`).join('') : '<p class="empty">Rien à faire dans les 7 jours. Ajoute une prochaine action en rangeant une phrase ou depuis la fiche d’un club.</p>'}</section>`;
}
// Entonnoir par état (ordinateur)
export function funnelCard() {
  const all = rows(); if (!C().list) return '';
  const n = (k) => all.filter((x) => stOf(x) === k).length, live = all.length - n('perdu');
  const fun = [{ l: 'Clubs suivis', n: live }, { l: 'En test ou gratuit', n: n('test') + n('client') }, { l: 'Clients', n: n('client') }];
  const tools = Object.entries(all.filter((k) => !k.virt && stOf(k) !== 'perdu').reduce((o, k) => { const x = k.current_tool || 'Pas renseigné'; o[x] = (o[x] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]);
  return kcard({ id: 'entonnoir', title: 'Entonnoir', hero: `${n('client')} / ${live}`, cap: `clients sur les clubs suivis · ${plural(n('perdu'), 'perdu')}`,
    chart: live ? hbars(fun, { max: live, label: 'Entonnoir : ' + fun.map((x) => x.l + ' ' + x.n).join(', ') }) + (tools.length ? `<div class="kick" style="margin-top:10px">Outil actuel</div><div class="chips">${tools.slice(0, 6).map(([x, k]) => `<span class="pill">${esc(x)} · ${k}</span>`).join('')}</div>` : '') : '' });
}
// Ce qui sert, ce qui ne sert pas : une ligne par fonction (tuiles sur téléphone et tablette, barres sur ordinateur)
export function usageCard() {
  const u = C().usage; if (!u) return C().err === NEED ? `<p class="note">${esc(NEED)}</p>` : '<p class="empty">Chargement…</p>';
  const live = num(u.clubs), used = Object.fromEntries((arr(u.feats) || []).map((f) => [f.k, num(f.n)]));
  const rows = Object.keys(FEATS).map((k) => ({ k, l: FEATS[k], n: used[k] || 0 })).sort((a, b) => b.n - a.n), none = rows.filter((r) => !r.n);
  const pct = (r) => (live ? Math.round((100 * r.n) / live) : 0);
  return kcard({ id: 'usage', title: 'Fonctions utilisées', hero: live ? `${rows.length - none.length} sur ${rows.length}` : '—',
    cap: live ? (none.length ? `Sans usage depuis 30 jours : ${esc(none.map((r) => r.l.toLowerCase()).join(', '))}` : 'Toutes ont servi ces 30 derniers jours') : 'Aucun club pour l’instant',
    chart: live ? `<div class="kick">Part des clubs qui l’ont utilisée (30 jours)</div>` + hbars(rows.map((r) => ({ l: r.l, n: pct(r) })), { max: 100, suffix: ' %', label: 'Usage par fonction' }) : '' })
    + (live ? `<section class="card notpc"><div class="list">${rows.map((r) => `<div class="row static" style="min-height:44px"><span class="g" style="font-weight:400">${esc(r.l)}<small>${plural(r.n, 'club')} sur ${live}</small></span><span class="pill ${r.n ? 'ok' : 'ko'}">${pct(r)} %</span></div>`).join('')}</div></section>` : '')
    + '<p class="note">Mesure : au moins une action dans les 30 derniers jours. Des nombres seulement : jamais le contenu des clubs (ni messages, ni noms de joueurs).</p>';
}
export const parcBlock = () => { const p = C().parc; return p ? parcCard(p) : C().err === NEED ? `<p class="note">${esc(NEED)}</p>` : ''; };
const spark = (w) => { const mx = Math.max(1, ...w), pts = w.map((v, i) => `${(i * 110) / Math.max(1, w.length - 1)},${(24 - (22 * v) / mx).toFixed(1)}`).join(' '); return `<svg aria-hidden="true" width="110" height="26" viewBox="0 0 110 26"><polyline points="${pts}" fill="none" stroke="var(--pc-action)" stroke-width="2" stroke-linejoin="round"/></svg>`; };
function ago(iso) { if (!iso) return 'jamais'; const d = Math.floor((Date.now() - new Date(iso)) / DAY); return d <= 0 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} jours`; }
function health(iso) { const d = iso ? Math.floor((Date.now() - new Date(iso)) / DAY) : 999; return d <= 14 ? ['Actif', 'ok'] : d <= 45 ? ['Dort', 'wait'] : ['Sans activité', 'ko']; }
const FORMULA = (c) => (c.status === 'payant' ? 'Payant' : c.status === 'gratuit' ? 'Gratuit' : 'Test gratuit');
function parcCard(p) {
  const rows = p.map((c) => { const [hl, hk] = health(c.last_at); return { act: 'admclub', attrs: `data-id="${esc(c.id)}"`, title: esc(c.name), sub: `${esc(FORMULA(c))} · ${plural(num(c.teams), 'équipe')} · ${plural(num(c.accounts), 'compte')} · ${esc(ago(c.last_at))}`,
    cells: [esc(c.name), esc((c.sport || '').replace('-ball', '')), esc(FORMULA(c)), String(num(c.teams)), String(num(c.accounts)), String(num(c.coaches)), spark(c.weeks || []), esc(ago(c.last_at)), tag(hl, hk)] }; });
  return `<div class="sec"><h2>Parc des clubs</h2><span class="det">${p.length}</span></div>` + listOrTable('Clubs inscrits', [['Club'], ['Sport'], ['Formule'], ['Équipes', 'r'], ['Comptes', 'r'], ['Coachs', 'r'], ['Activité · 8 semaines'], ['Dernière action'], ['État']], rows,
    { empty: 'Aucun club inscrit.', note: 'Activité = rendez-vous créés, appels et messages : le nombre, jamais le contenu.' });
}
// Objectif : clubs payants sur le seuil pour en vivre (onglet Coûts et quotas)
export function goalCard(paid) {
  return kcard({ id: 'objectif', title: 'Objectif « en vivre »', hero: `${num(paid)} / ${GOAL}`, cap: 'clubs payants · seuil estimé de 350 à 465 clubs',
    chart: `<div class="ht" style="margin-top:8px" role="img" aria-label="${num(paid)} clubs payants sur ${GOAL}"><span class="hf" style="width:${Math.max(1, Math.min(100, (100 * num(paid)) / GOAL)).toFixed(1)}%"></span></div>` });
}

// ---------- Onglet Clubs : liste (filtres par état) ; sur ordinateur, la fiche ouverte à côté ----------
function clubRow(k, cur) {
  const d = dueOf(k), p = parcOf(k);
  const sub = [k.city, k.sport, k.contact_name || (p ? 'actif ' + ago(p.last_at) : '')].filter(Boolean).join(' · ');
  return `<button class="row crmrow${cur ? ' cur' : ''}" data-act="crmopen" data-id="${esc(k.id)}" ${cur ? 'aria-current="true"' : ''}><span class="g">${esc(k.org)}<small>${esc(sub || (k.virt ? 'inscrit, sans fiche de suivi' : '—'))}</small>${d ? `<small class="crmdue ${d[1]}">${d[1] === 'ko' ? 'En retard : ' : 'Prochaine : '}${esc(k.next_action || 'relance')} · ${esc(dayLbl(k.next_at))}</small>` : ''}</span>${stPill(stOf(k))}</button>`;
}
export function crmTab() {
  const c = C(); if (c.err === NEED) return `<div class="card alert" role="alert"><b>${esc(NEED)}</b></div>`;
  if (!c.list) return '<p class="empty">Chargement…</p>';
  const all = rows(), q = norm(c.q), f = ST[c.f] ? c.f : 'all';
  const vis = all.filter((k) => f === 'all' || stOf(k) === f).filter((k) => !q || norm([k.org, k.city, k.sport, k.contact_name, k.current_tool, ...(k.people || []).map((p) => p.name)].join(' ')).includes(q))
    .sort((a, b) => (stOf(a) === 'perdu') - (stOf(b) === 'perdu') || (a.next_at || '9').localeCompare(b.next_at || '9') || a.org.localeCompare(b.org));
  const cur = wide() ? (vis.find((k) => k.id === c.sel) || vis[0]) : null;
  let l = `<div class="crmlh"><div class="field" style="flex:1;margin:0"><label for="crmq" class="sr">Chercher</label><input id="crmq" type="search" data-crmq="1" value="${esc(c.q || '')}" autocomplete="off" placeholder="Nom, ville, personne…"></div><button class="btn main small" data-act="crmnew">${icon('plus', 18)}Prospect</button></div>`;
  l += `<div class="chips crmf">${[['all', 'Tous'], ...STATES.map((s) => [s[0], s[1].replace(' ou gratuit', '')])].map(([k, t]) => `<button class="chip${k === 'all' ? '' : ' st ' + ST[k][2]}" data-act="crmf" data-k="${k}" aria-pressed="${k === f}">${t} · ${k === 'all' ? all.length : all.filter((x) => stOf(x) === k).length}</button>`).join('')}</div>`;
  l += `<section class="card"><div class="list">${vis.map((k) => clubRow(k, cur && k.id === cur.id)).join('') || '<p class="empty">Aucun club.</p>'}</div></section>`;
  const note = '<p class="note">Seul l’administrateur voit cette page. Une fiche s’efface avec son historique (droit d’effacement).</p>';
  if (!cur) return `<div class="crmlist">${l}${note}</div>`;
  if (c.events?.id !== cur.id && c.loadingEv !== cur.id) { c.loadingEv = cur.id; loadEvents(cur.id).then(() => { c.loadingEv = null; render(true); }); }
  return `<div class="crmmd"><div class="crmlist">${l}${note}</div><section class="card crmpane crmfiche" aria-label="Fiche ${esc(cur.org)}">${ficheBody(cur, true)}</section></div>`;
}

// ---------- Fiche d'un club ----------
function ficheBody(k, pane) {
  const c = C(), ev = c.events && c.events.id === k.id ? c.events.list : null, d = dueOf(k), p = parcOf(k), st = stOf(k);
  let h = `<div class="crmhead">${pane ? `<h2>${esc(k.org)}</h2>` : ''}${stPill(st)}</div><p class="note" style="margin:0">${esc([k.city, k.sport, p ? plural(num(p.accounts), 'compte') : ''].filter(Boolean).join(' · ') || '—')}</p>`;
  if (k.virt) {
    return h + `<section class="card warn"><p>Ce club est inscrit mais n’a pas encore de fiche de suivi.</p><button class="btn main" data-act="crmmk" data-id="${esc(k.club_id)}">${icon('plus', 20)}Créer la fiche de suivi</button></section>` + compteCard(k, p);
  }
  h += `<div class="chips" role="group" aria-label="État du club"><span class="chiplab">État :</span>${STATES.map(([s, l, cl]) => `<button class="chip st ${cl}" data-act="crmset" data-id="${esc(k.id)}" data-k="${s}" aria-pressed="${s === st}">${esc(l)}</button>`).join('')}</div>`;
  const ppl = [k.contact_name ? { name: k.contact_name, role: k.contact_role, phone: k.contact_phone, email: k.contact_email } : null].filter(Boolean);
  h += `<div class="crmtop">
    <div class="crmt next"><div class="kick">Prochaine action</div>${k.next_at || k.next_action ? `<b>${esc(k.next_action || 'À relancer')}</b><span>${esc(k.next_at ? dayLbl(k.next_at) : 'sans date')}${d && d[1] ? ' · ' + esc(d[0]) : ''}</span><div class="btns"><button class="btn small main" data-act="crmdone" data-id="${esc(k.id)}">${icon('check', 18)}Fait</button><button class="btn small ghost" data-act="crmlater" data-id="${esc(k.id)}">Reporter d’une semaine</button></div>` : '<span>Rien de prévu. Ajoute-en une avec un échange.</span>'}</div>
    <div class="crmt"><div class="kick">Contact principal</div>${ppl.length ? `<b>${esc(ppl[0].name)}</b><span>${esc(ppl[0].role || '')}</span><div class="btns">${ppl[0].phone ? `<a class="btn small ghost" href="tel:${esc(ppl[0].phone.replace(/[^\d+]/g, ''))}">${icon('phone', 18)}Appeler</a>` : ''}${ppl[0].email ? `<a class="btn small ghost" href="mailto:${esc(ppl[0].email)}">${icon('mail', 18)}Écrire</a>` : ''}</div>` : '<span>À compléter dans « Infos du club ».</span>'}</div>
    <div class="crmt"><div class="kick">Intérêt et outil</div><b>${esc(INTEREST[num(k.interest)])}</b><span>${esc(k.current_tool ? 'Aujourd’hui : ' + k.current_tool : 'Outil actuel ?')}</span>${k.wants ? `<span>Souhait : ${esc(k.wants)}</span>` : ''}</div></div>`;
  // Échanges
  h += `<div class="sec"><h2>Échanges</h2><span class="det">${ev ? ev.length : ''}</span></div><section class="card">${ev ? (ev.length ? `<div class="crmev">${ev.map((e) => `<div class="crmevr"><span class="crmd">${esc(fmtDay(e.at))}</span><span class="g"><b>${esc(KIND[e.kind] || e.kind)}</b>${e.source === 'dictee' ? ' <span class="pill wait">Dictée rangée</span>' : e.source === 'claude' ? ' <span class="pill wait">Rangé par Claude</span>' : ''}${e.summary ? `<small>${esc(e.summary)}</small>` : ''}</span></div>`).join('')}</div>` : '<p class="empty">Aucun échange noté.</p>') : '<p class="empty">Chargement…</p>'}
    <form id="crmev" data-id="${esc(k.id)}" class="crmevf"><div class="kick">Noter un échange</div>
    <div class="grid2">${field('cek', 'Type', sel('cek', 'kind', KINDS, 'note'))}${field('ced', 'Date', `<input id="ced" name="at" type="date" value="${today()}" max="${today()}">`)}</div>
    ${field('ces', 'Ce qui s’est dit ou fait', `<textarea id="ces" name="summary" rows="2" maxlength="1000" placeholder="Ex. : présenté au président, veut tester l’équipe loisirs"></textarea>`)}${micBtn('ces', 'Dicter')}
    <div class="grid2">${field('cea', 'Prochaine action (facultatif)', `<input id="cea" name="next_action" maxlength="200">`)}${field('cen', 'Quand', `<input id="cen" name="next_at" type="date" value="">`)}</div>
    <button class="btn main" type="submit">${icon('check', 20)}Ajouter aux échanges</button></form></section>`;
  // Personnes
  const others = Array.isArray(k.people) ? k.people : [];
  h += `<div class="sec"><h2>Personnes</h2><span class="det">${ppl.length + others.length}</span></div><section class="card"><div class="list">${ppl.map((x) => `<div class="row static"><span class="g">${esc(x.name)}<small>${esc([x.role, 'principal'].filter(Boolean).join(' · '))}${x.phone ? ' · ' + esc(x.phone) : ''}${x.email ? ' · ' + esc(x.email) : ''}</small></span></div>`).join('')}${others.map((x, i) => { const on = isArmed('crmpx' + k.id + i); return `<div class="row static"><span class="g">${esc(x.name)}<small>${esc([x.role, x.phone, x.email].filter(Boolean).join(' · ') || '—')}</small></span><button class="btn small ${on ? 'danger armed' : 'ghost'}" data-act="crmpx" data-id="${esc(k.id)}" data-i="${i}">${on ? 'Retirer ?' : 'Retirer'}</button></div>`; }).join('')}</div>
    <form id="crmpp" data-id="${esc(k.id)}"><div class="grid2">${field('cpn', 'Nom', `<input id="cpn" name="name" required maxlength="120" placeholder="Ex. : Julie R.">`)}${field('cpr', 'Fonction', `<input id="cpr" name="role" maxlength="80" placeholder="Ex. : coach loisirs">`)}</div>
    <div class="grid2">${field('cpt', 'Téléphone', `<input id="cpt" name="phone" type="tel" maxlength="40">`)}${field('cpe', 'E-mail', `<input id="cpe" name="email" type="email" maxlength="200">`)}</div>
    <button class="btn ghost" type="submit">${icon('plus', 20)}Ajouter une personne</button></form></section>`;
  // Infos du club (et contact principal)
  h += `<div class="sec"><h2>Infos du club</h2></div>${infoForm(k)}`;
  h += compteCard(k, p);
  const on = isArmed('crmdel' + k.id);
  h += `<section class="card"><button class="btn ${on ? 'danger armed' : 'ghost'}" data-act="crmdel" data-id="${esc(k.id)}">${icon('trash', 20)}${on ? 'Confirmer : effacer cette fiche' : 'Effacer cette fiche'}</button><p class="note">Efface la fiche, ses personnes et tout son historique, définitivement. Le compte du club, s’il existe, n’est pas touché. Inscrit au journal admin.</p></section>`;
  return h;
}
function infoForm(k) {
  const v = k || {}, id = k ? 'crmedit' : 'crmnewf';
  return `<form class="card" id="${id}" ${k ? `data-id="${esc(k.id)}"` : ''}>
    ${field('cro', 'Nom du club', `<input id="cro" name="org" required maxlength="120" value="${esc(v.org || '')}">`)}
    <div class="grid2">${field('crc', 'Ville', `<input id="crc" name="city" maxlength="80" value="${esc(v.city || '')}">`)}${field('crs', 'Sport', `<input id="crs" name="sport" maxlength="40" value="${esc(v.sport || '')}" placeholder="Volley, basket…">`)}</div>
    <div class="grid2">${field('crn', 'Contact principal', `<input id="crn" name="contact_name" maxlength="120" value="${esc(v.contact_name || '')}" placeholder="Ex. : Marc D.">`)}${field('crr', 'Sa fonction', `<input id="crr" name="contact_role" maxlength="80" value="${esc(v.contact_role || '')}" placeholder="Ex. : président">`)}</div>
    <div class="grid2">${field('crp', 'Son téléphone', `<input id="crp" name="contact_phone" type="tel" maxlength="40" value="${esc(v.contact_phone || '')}">`)}${field('cre', 'Son e-mail', `<input id="cre" name="contact_email" type="email" maxlength="200" value="${esc(v.contact_email || '')}">`)}</div>
    ${k ? '' : field('crg', 'État', sel('crg', 'stage', STATES.map((s) => [s[0], s[1]]), 'prospect'))}
    <div class="grid2">${field('cri', 'Intérêt', sel('cri', 'interest', INTEREST.map((l, i) => [i, l]), num(v.interest)))}${field('crt', 'Outil utilisé aujourd’hui', `<input id="crt" name="current_tool" maxlength="80" value="${esc(v.current_tool || '')}" placeholder="WhatsApp, ClickToClub…">`)}</div>
    ${field('crw', 'Ce qu’il souhaite', `<input id="crw" name="wants" maxlength="300" value="${esc(v.wants || '')}" placeholder="Ex. : tester l’équipe loisirs">`)}
    ${k && stOf(k) === 'perdu' ? field('crl', 'Pourquoi perdu', `<input id="crl" name="lost_reason" maxlength="200" value="${esc(v.lost_reason || '')}">`) : ''}
    ${k ? '' : `<div class="grid2">${field('cra', 'Prochaine action (facultatif)', `<input id="cra" name="next_action" maxlength="200">`)}${field('crd', 'Quand', `<input id="crd" name="next_at" type="date">`)}</div>`}
    <button class="btn main" type="submit">${icon('check', 20)}${k ? 'Enregistrer' : 'Créer la fiche'}</button></form>`;
}
// Compte mypocketclub : activité, formule, équipes, comptes ; relier une fiche à un club inscrit
function compteCard(k, p) {
  let h = '<div class="sec"><h2>Compte mypocketclub</h2></div>';
  if (p) {
    const [hl, hk] = health(p.last_at);
    return h + `<section class="card"><div class="idnums crm4"><div><b>${tag(hl, hk)}</b><span>${esc(ago(p.last_at))}</span></div><div><b>${esc(FORMULA(p))}</b><span>formule</span></div><div><b>${num(p.teams)}</b><span>équipe${num(p.teams) > 1 ? 's' : ''}</span></div><div><b>${num(p.accounts)}</b><span>compte${num(p.accounts) > 1 ? 's' : ''}</span></div></div>
      <div class="row static"><span class="g">Activité des 8 dernières semaines<small>rendez-vous, appels et messages : le nombre, jamais le contenu</small></span>${spark(p.weeks || [])}</div>
      <div class="btns"><button class="btn small ghost" data-act="admclub" data-id="${esc(p.id)}">${icon('shield', 18)}Validation et abonnement</button></div></section>`;
  }
  if (k.virt) return h;
  const linked = new Set((C().list || []).map((x) => x.club_id).filter(Boolean)), free = (C().parc || []).filter((x) => !linked.has(x.id));
  return h + `<form class="card dashed" id="crmlink" data-id="${esc(k.id)}"><p class="note" style="margin:0">Pas encore inscrit. Quand le club s’inscrit, relie la fiche à son compte : son activité s’affichera ici.</p>
    ${free.length ? field('crk', 'Club inscrit', sel('crk', 'club_id', [['', 'Choisis le club…'], ...free.map((x) => [x.id, x.name + (x.city ? ' · ' + x.city : '')])], '')) + `<button class="btn ghost" type="submit">Relier au club inscrit</button>` : '<p class="note">Aucun club inscrit sans fiche pour l’instant.</p>'}</form>`;
}
function ficheScreen(id) {
  const head = (t) => header({ brand: true, back: true, kicker: 'Administration · club', title: t });
  if (!S.isAdmin) return head('Club') + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  const c = C(), k = findRow(id);
  if (!k) return head('Club') + `<main class="bd"><p class="empty">${c.list ? 'Fiche introuvable.' : 'Chargement…'}</p></main>`;
  return head(esc(k.org)) + `<main class="bd adm">${c.err ? `<div class="card alert" role="alert"><b>${esc(c.err)}</b></div>` : ''}<div data-pro><div class="crmfiche">${ficheBody(k, false)}</div></div></main>`;
}
function newScreen() {
  const head = header({ brand: true, back: true, kicker: 'Administration · clubs', title: 'Nouveau prospect' });
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  return head + `<main class="bd adm">${C().err ? `<div class="card alert" role="alert"><b>${esc(C().err)}</b></div>` : ''}${infoForm(null)}<p class="note">Données de personnes : de vraies personnes seulement sur le vrai site.</p></main>`;
}
Object.assign(V37_TOP, { crmc: (v) => ficheScreen(v.id), crmn: () => newScreen() });

// ---------- actions ----------
const reload = async (id) => { await crmLoadList(); if (id) await loadEvents(id); render(true); };
// Ouvrir une fiche : sur ordinateur dans l'onglet Clubs, à côté de la liste ; ailleurs, en plein écran
async function openFiche(id) {
  const c = C(); c.events = null;
  const inSpace = !S.view || S.view.type === 'adm'; // l'espace admin s'ouvre sans club (pas de vue) ou depuis Mon compte (vue « adm »)
  if (wide() && inSpace) { c.sel = id; S.admTab = 'clubs'; S.admSeg = 'suivi'; render(true); if (!c.list) await crmLoadList(); await loadEvents(id); render(true); return; }
  S.view = { type: 'crmc', id }; render(); if (!c.list) await crmLoadList(); await loadEvents(id); render(true);
}
const fromForm = (v) => { const o = {}; for (const k of ['org', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'sport', 'city', 'current_tool', 'wants', 'lost_reason', 'stage', 'next_action']) if (v[k] !== undefined) o[k] = v[k]; if (v.interest !== undefined) o.interest = +v.interest || 0; if (v.next_at !== undefined) o.next_at = v.next_at || ''; return o; };
Object.assign(ACTIONS, {
  crmf: (el, d) => { C().f = d.k; render(true); },
  crmst: (el, d) => { const c = C(); c.f = d.k; c.q = ''; S.admTab = 'clubs'; S.admSeg = 'suivi'; render(true); if (!c.list) reload(); },
  crminx: async (el, d) => {
    if (!armed('crminx' + d.id)) return;
    if (await run(sb.rpc('admin_crm_inbox_delete', { p_id: d.id }), 'Phrase retirée.')) { const c = C(); c.inbox = (c.inbox || []).filter((x) => x.id !== d.id); render(true); }
  },
  crmfile: async (el, d) => { const c = C(); c.file = { id: d.id, q: '', pick: null, kind: 'note' }; render(true); if (!c.list) await reload(); document.getElementById('crmfq')?.focus(); },
  crmfx: () => { C().file = null; render(true); },
  crmfpick: (el, d) => { const f = C().file; if (f) { f.pick = d.id; render(true); } },
  crmfk: (el, d) => { const f = C().file; if (f) { f.kind = d.k; render(true); } },
  crmnew: () => { S.view = { type: 'crmn' }; render(); },
  crmopen: async (el, d) => openFiche(d.id),
  crmset: async (el, d) => { if (await run(sb.rpc('admin_crm_save', { p_id: d.id, p_data: { stage: d.k } }), 'État : ' + ST[d.k][1] + '.')) await reload(); },
  crmmk: async (el, d) => {
    const p = (C().parc || []).find((x) => x.id === d.id); if (!p) return;
    const id = await run(sb.rpc('admin_crm_save', { p_id: null, p_data: { org: p.name, city: p.city || '', sport: (p.sport || '').replace('-ball', ''), club_id: p.id, stage: p.status === 'payant' ? 'client' : 'test' } }), 'Fiche de suivi créée.');
    if (id) { await crmLoadList(); if (S.view?.type === 'crmc') { S.view = { type: 'crmc', id }; S.noStack = true; } else C().sel = id; await loadEvents(id); render(true); }
  },
  crmdone: async (el, d) => { if (await run(sb.rpc('admin_crm_relance_done', { p_contact: d.id }), 'Action faite, notée dans les échanges.')) await reload(C().events?.id === d.id ? d.id : null); },
  crmlater: async (el, d) => { const k = findRow(d.id); if (k && await run(sb.rpc('admin_crm_save', { p_id: d.id, p_data: { next_at: plusDays(k.next_at, 7) } }), 'Reportée d’une semaine.')) await reload(); },
  crmpx: async (el, d) => {
    if (!armed('crmpx' + d.id + d.i)) return;
    const k = findRow(d.id); if (!k) return; const people = (k.people || []).filter((x, i) => i !== +d.i);
    if (await run(sb.rpc('admin_crm_save', { p_id: d.id, p_data: { people } }), 'Personne retirée.')) await reload();
  },
  crmdel: async (el, d) => {
    if (!armed('crmdel' + d.id)) return;
    if (await run(sb.rpc('admin_crm_delete', { p_contact: d.id }), 'Fiche effacée.')) { const c = C(); c.events = null; c.sel = null; if (S.view?.type === 'crmc') { S.view = null; S.noStack = true; } S.admTab = 'clubs'; await reload(); }
  },
});
FORMS.crminb = async (v) => {
  const body = String(v.body || '').trim(); if (!body) { toast('Écris ou dicte une phrase.'); return; }
  stopDictation();
  if (await run(sb.rpc('admin_crm_inbox_add', { p_body: body }), 'Phrase gardée : range-la dans un club.')) {
    const c = C(); c.draft = ''; const ib = await rpc('admin_crm_inbox_list'); if (ib) c.inbox = arr(ib) || []; render(true);
  }
};
FORMS.crmfile = async (v, f) => {
  const c = C(), fl = c.file; if (!fl || !fl.pick) return toast('Choisis un club.');
  let id = fl.pick;
  if (id === 'new') id = await run(sb.rpc('admin_crm_save', { p_id: null, p_data: { org: (fl.q || '').trim(), stage: 'prospect' } }));
  else if (String(id).startsWith('club:')) { const p = (c.parc || []).find((x) => 'club:' + x.id === id); id = p ? await run(sb.rpc('admin_crm_save', { p_id: null, p_data: { org: p.name, city: p.city || '', sport: (p.sport || '').replace('-ball', ''), club_id: p.id, stage: p.status === 'payant' ? 'client' : 'test' } })) : null; }
  if (!id) return;
  const org = findRow(fl.pick)?.org || fl.q;
  if (await run(sb.rpc('admin_crm_inbox_file', { p_id: fl.id, p_contact: id, p_kind: fl.kind || 'note', p_next_action: v.next_action || null, p_next_at: v.next_at || null }), 'Rangée dans ' + org + '.')) {
    c.file = null; c.inbox = (c.inbox || []).filter((x) => x.id !== fl.id); await reload();
  }
};
FORMS.crmnewf = async (v) => {
  const id = await run(sb.rpc('admin_crm_save', { p_id: null, p_data: fromForm(v) }), 'Fiche créée.');
  if (id) { await crmLoadList(); S.view = { type: 'crmc', id }; S.noStack = true; C().events = null; render(); await loadEvents(id); render(true); }
};
FORMS.crmedit = async (v, f) => { if (await run(sb.rpc('admin_crm_save', { p_id: f.dataset.id, p_data: fromForm(v) }), 'Fiche enregistrée.')) await reload(); };
FORMS.crmpp = async (v, f) => {
  const k = findRow(f.dataset.id); if (!k || !String(v.name || '').trim()) return toast('Indique au moins le nom.');
  const people = [...(k.people || []), { name: v.name, role: v.role || '', phone: v.phone || '', email: v.email || '' }];
  if (await run(sb.rpc('admin_crm_save', { p_id: k.id, p_data: { people } }), 'Personne ajoutée.')) await reload();
};
FORMS.crmlink = async (v, f) => { if (!v.club_id) return toast('Choisis le club inscrit.'); if (await run(sb.rpc('admin_crm_save', { p_id: f.dataset.id, p_data: { club_id: v.club_id } }), 'Fiche reliée au club inscrit.')) await reload(); };
FORMS.crmev = async (v, f) => {
  stopDictation();
  const at = v.at ? new Date(v.at + 'T12:00:00').toISOString() : null;
  if (await run(sb.rpc('admin_crm_event_add', { p_contact: f.dataset.id, p_kind: v.kind, p_summary: v.summary || '', p_at: at, p_next_at: v.next_at || null, p_next_action: v.next_action || null, p_stage: null }), 'Échange noté.')) await reload(f.dataset.id);
};
const keepFocus = (id, pos) => { const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } };
INPUTS.push((t) => {
  if (t.dataset?.crmdict) { C().draft = t.value; return true; } // la phrase en cours survit aux rafraîchissements de l'écran
  if (t.dataset?.crmfq) { const f = C().file; if (f) { f.q = t.value; if (f.pick === 'new') f.pick = null; } const pos = t.selectionStart; render(true); keepFocus('crmfq', pos); return true; }
  if (!t.dataset?.crmq) return false;
  C().q = t.value; const pos = t.selectionStart; render(true); keepFocus('crmq', pos);
  return true;
});
