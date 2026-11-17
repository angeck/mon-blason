// mypocketclub · bêta 1.2.0 · n° 245 et n° 202 (Gaël, 17 novembre 2026 : « tu peux coder » ; maquette en trois vues
// https://claude.ai/artifact/W2az8x3pwx1xPeJnTec9th ; cadre dans claude/71-admin-pro-crm.md) :
//   Espace admin « pro » : le cockpit (onglet Accueil) gagne des cartes (relances, entonnoir, ce qui sert et ce qui ne sert pas, objectif,
//   parc des clubs) et un nouvel onglet « Contacts » (mini-CRM : étapes, fiche, historique des échanges, relances à date).
//   La boîte mail dans l'application est EN SUSPEND (décision de Gaël, 17 novembre, 14 h 32) : rien ici ne lit ni n'envoie d'e-mail.
// Supports (n° 246) : téléphone et tablette en tuiles et en listes ; ordinateur (960 px) avec graphiques, colonnes d'étapes et tableau.
// Rappel : tout passe par des fonctions réservées à l'administrateur (is_app_admin(), session confirmée par le code à 6 chiffres) ;
// les tables du CRM ne sont lisibles par aucun compte. L'écran n'est qu'un confort. Le CRM n'est à remplir qu'avec la base du VRAI site.
import { S, sb, esc, run, render, toast, ACTIONS, FORMS, INPUTS, armed, isArmed, plural, fmtDay } from './core.js';
import { header, icon, field } from './ui.js';
import { V37_TOP } from './v37.js';
import { kcard, hbars, stack, listOrTable, tag } from './b110.js';
import { micBtn, canDictate, stopDictation } from './dictee.js';

const C = () => (S.crm = S.crm || {});
export const STAGES = [['a_contacter', 'À contacter'], ['contacte', 'Contacté'], ['presentation', 'Présentation faite'], ['test', 'En test gratuit'], ['payant', 'Payant'], ['perdu', 'Perdu']];
const STAGE = Object.fromEntries(STAGES);
const KINDS = [['presentation_live', 'Présentation en live'], ['presentation_visio', 'Présentation en visio'], ['mail_envoye', 'E-mail envoyé'], ['mail_recu', 'E-mail reçu'], ['proposition', 'Proposition'], ['devis', 'Devis'], ['appel', 'Appel'], ['note', 'Note'], ['autre', 'Autre']];
const KIND = Object.fromEntries(KINDS);
const INTEREST = ['Intérêt inconnu', '+', '++', '+++'];
const FEATS = { agenda: 'Agenda et réponses', appel: 'Appel', messages: 'Messages', convocations: 'Convocations', annonces: 'Annonces', exercices: 'Exercices', ia: 'Exercices avec l’IA', tactiques: 'Tactiques', seances: 'Séances', cotisations: 'Cotisations', benevoles: 'Bénévoles', heures: 'Heures des coachs' };
const NEED = 'La base n’est pas encore à jour : lance le script MAJ_BETA_1_2_0.sql dans Supabase.';
const GOAL = 350; // seuil estimé pour en vivre (350 à 465 clubs, claude/00-etat-actuel.md)
const DAY = 864e5;
const num = (x) => +x || 0;
const today = () => new Date().toLocaleDateString('sv-SE');
const dayLbl = (iso) => (iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
const sel = (id, name, opts, cur) => `<select id="${id}" name="${name}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

// ---------- chargements (chaque appel est refusé par la base sans la double vérification) ----------
async function rpc(name, args) {
  let r; try { r = await sb.rpc(name, args); } catch (e) { r = { error: e }; }
  if (r.error) { C().err = /function|fonction|schema cache|relation/i.test(r.error.message || '') ? NEED : (r.error.message || 'Erreur'); return null; }
  return r.data;
}
const arr = (x) => (Array.isArray(x) ? x : null);
// Accueil : relances, entonnoir, usage, parc (en même temps que le reste du cockpit)
export async function crmLoadHome() {
  const c = C(); c.err = null;
  const [ov, us, pk, ib] = await Promise.all([rpc('admin_crm_overview'), rpc('admin_usage'), rpc('admin_parc'), rpc('admin_crm_inbox_list')]);
  if (ov) c.ov = ov; if (us) c.usage = us; if (pk) c.parc = arr(pk) || []; if (ib) c.inbox = arr(ib) || [];
}
// Onglet Contacts : la liste (et le résumé pour la pastille)
export async function crmLoadList() {
  const c = C(); c.err = null;
  const l = await rpc('admin_crm_list'); if (l) c.list = arr(l) || [];
  const [ov, ib] = await Promise.all([rpc('admin_crm_overview'), rpc('admin_crm_inbox_list')]); if (ov) c.ov = ov; if (ib) c.inbox = arr(ib) || [];
}
async function loadEvents(id) { const l = await rpc('admin_crm_events', { p_contact: id }); if (l) C().events = { id, list: arr(l) || [] }; }
// Pastille de l'onglet : relances en retard ou du jour
export const crmBadge = () => { const o = C().ov; return o ? num(o.late) + num(o.today) : 0; };

// ---------- Cockpit (maquette tablette du 17 novembre : « Dis-le à Claude », tuiles, relances ; graphiques sur ordinateur) ----------
const dueLbl = (d) => { const t = today(); return d < t ? ['En retard', 'ko'] : d === t ? ['Aujourd’hui', 'wait'] : [dayLbl(d), '']; };
export const crmNeedScript = () => C().err === NEED;
// « Dis-le à Claude » : une phrase dictée ou tapée, gardée « à ranger » ; Claude la range depuis la conversation du projet, Gaël valide
export function dictCard() {
  const c = C(), inb = c.inbox || [];
  if (c.err === NEED) return `<section class="card dict"><div class="kick">Dis-le à Claude</div><p class="note">${esc(NEED)}</p></section>`;
  let h = `<section class="card dict"><div class="kick">Dis-le à Claude</div>
    <form id="crminb" class="dictf"><label class="sr" for="crmdict">Ta phrase</label><textarea id="crmdict" name="body" data-crmdict="1" rows="2" maxlength="2000" placeholder="Ex. : présentation à Lardy en live avec JP, intérêt ++, veut tester 1 équipe">${esc(c.draft || '')}</textarea>
    <div class="dictb">${micBtn('crmdict', 'Dicter')}<button class="btn main small" type="submit">${icon('check', 18)}Ranger</button></div></form>
    <p class="note">${canDictate() ? '' : 'Sur ce navigateur, utilise le micro du clavier. '}« Ranger » garde ta phrase ici. Dis-moi ensuite « range mes dictées » dans la conversation du projet : je prépare la fiche, tu valides, puis elle entre dans le CRM.</p>`;
  if (inb.length) {
    h += `<div class="kick" style="margin-top:6px">À ranger · ${inb.length}</div><div class="list">${inb.map((x) => { const on = isArmed('crminx' + x.id); return `<div class="row static"><span class="g" style="font-weight:400">${esc(x.body)}<small>${esc(fmtDay(x.at))}</small></span><button class="btn small ${on ? 'danger armed' : 'ghost'}" data-act="crminx" data-id="${esc(x.id)}">${on ? 'Retirer ?' : 'Retirer'}</button></div>`; }).join('')}</div>`;
  }
  return h + '</section>';
}
// Une tuile du cockpit : petit titre en capitales, grand nombre, une ligne dessous
const ktile = ({ l, n, sub = '', hot = false, act = '', attrs = '', subHot = false, small = '' }) =>
  `<button class="ckt${hot ? ' hot' : ''}" ${act ? `data-act="${act}"` : 'disabled'} ${attrs}><span class="ckl">${esc(l)}</span><span class="ckn">${esc(String(n))}${small ? `<small>${esc(small)}</small>` : ''}</span>${sub ? `<span class="cks${subHot ? ' warn' : ''}">${esc(sub)}</span>` : ''}</button>`;
// Données de la base admin (v56) : ov = admin_overview, ai = admin_ai_stats, mails = admin_mail_stats, money = formatage en $
export function cockpitTiles({ ov = {}, ai = null, mails = null, todo = 0, todoSub = '', money = (x) => String(x) }) {
  const c = C(), co = c.ov, u = c.usage, p = c.parc || [];
  const t = [];
  if (co) { const late = num(co.late), n = late + num(co.today); t.push({ l: 'Relances à faire', n, sub: late ? `dont ${late} en retard` : n ? 'aujourd’hui' : 'rien d’urgent', hot: n > 0, act: 'admtab', attrs: 'data-k="crm"' }); }
  t.push({ l: 'À traiter', n: todo, sub: todo ? todoSub : 'tout est à jour', act: 'admtab', attrs: 'data-k="todo"' });
  const tests = p.filter((x) => (x.status || 'test') === 'test'), asleep = tests.map((x) => (x.last_at ? Math.floor((Date.now() - new Date(x.last_at)) / DAY) : 999)).filter((d) => d > 14);
  t.push({ l: 'Clubs en test gratuit', n: num(ov.sub_test), sub: asleep.length ? (asleep.length === 1 ? `1 club dort depuis ${asleep[0] >= 999 ? 'toujours' : asleep[0] + ' j'}` : `${asleep.length} clubs dorment`) : p.length ? 'tous actifs' : '', subHot: asleep.length > 0, act: 'admtab', attrs: 'data-k="clubs"' });
  t.push({ l: 'Payants', n: num(ov.sub_paid), sub: `Objectif : ${GOAL}`, act: 'admtab', attrs: 'data-k="couts"' });
  t.push({ l: 'Comptes', n: num(ov.accounts), sub: `${num(ov.active7)} actifs sur 7 j`, act: 'admtab', attrs: 'data-k="usage"' });
  if (u) { const used = Object.fromEntries((arr(u.feats) || []).map((f) => [f.k, num(f.n)])), none = num(u.clubs) ? Object.keys(FEATS).filter((k) => !used[k]) : [];
    t.push({ l: 'Ne sert pas', n: num(u.clubs) ? none.length : '—', sub: none.length ? none.slice(0, 3).map((k) => FEATS[k]).join(', ') + (none.length > 3 ? '…' : '') : num(u.clubs) ? 'tout a servi ce mois' : 'aucun club', subHot: none.length > 0, act: 'admtab', attrs: 'data-k="usage"' }); }
  if (mails && !mails.missing) t.push({ l: 'E-mails envoyés', n: num(mails.jour), small: '/' + (num(mails.limite_jour) || 100), sub: 'aujourd’hui', subHot: num(mails.jour) >= 0.8 * (num(mails.limite_jour) || 100), act: 'admtab', attrs: 'data-k="couts"' });
  if (ai && !ai.missing) t.push({ l: 'IA · exercices', n: money(ai.spent_month), sub: `ce mois · ${plural(num(ai.count_month), 'schéma')}`, act: 'admtab', attrs: 'data-k="couts"' });
  return `<div class="cktiles">${t.map(ktile).join('')}</div>`;
}
export function relancesCard() {
  const ov = C().ov; if (!ov) return '';
  const rel = arr(ov.relances) || [];
  return `<section class="card"><div class="kh"><h3>Relances</h3><button class="klink" data-act="admtab" data-k="crm">Tout le CRM</button></div>${rel.length ? `<div class="list">${rel.map((r) => { const [l, k] = dueLbl(r.next_at); return `<div class="row static"><span class="pill ${k}" style="min-width:92px;justify-content:center">${esc(l)}</span><button class="g tlink" style="min-height:44px;font-weight:700" data-act="crmopen" data-id="${esc(r.id)}">${esc(r.org)}<small style="font-weight:400;display:block;color:var(--pc-texte-doux)">${esc(r.next_action || 'À relancer')}</small></button><button class="btn small ghost" data-act="crmdone" data-id="${esc(r.id)}">Fait</button></div>`; }).join('')}</div>` : '<p class="empty">Aucune relance dans les 14 jours.</p>'}</section>`;
}
// Entonnoir commercial et outils actuels des contacts
export function funnelCard() {
  const ov = C().ov; if (!ov) return '';
  const st = ov.stages || {}, n = (k) => num(st[k]), total = num(ov.total) - n('perdu');
  const reach = n('contacte') + n('presentation') + n('test') + n('payant'), pres = n('presentation') + n('test') + n('payant'), test = n('test') + n('payant'), paid = n('payant');
  const fun = [{ l: 'Contacts', n: total }, { l: 'Contactés', n: reach }, { l: 'Présentations', n: pres }, { l: 'En test gratuit', n: test }, { l: 'Payants', n: paid }];
  const tools = arr(ov.tools) || [];
  return kcard({ id: 'entonnoir', title: 'Entonnoir commercial', hero: `${paid} / ${total || 0}`, cap: `payants sur les contacts en cours · ${plural(num(ov.presentations30), 'présentation')} en 30 jours`,
    chart: total ? hbars(fun, { max: total, label: 'Entonnoir : ' + fun.map((x) => x.l + ' ' + x.n).join(', ') }) + (tools.length ? `<div class="kick" style="margin-top:10px">Outil actuel des contacts</div>` + stack(tools.slice(0, 6).map((x, i) => ({ l: x.tool, n: num(x.n), c: ['c-b1', 'c-b2', 'c-b3', 'c-part', 'c-ok', 'c-due'][i] })), 'Outils actuels : ' + tools.map((x) => x.tool + ' ' + x.n).join(', ')) : '') : '' })
    + (tools.length ? `<section class="card kcard notpc"><div class="kh"><h3>Outil actuel des contacts</h3></div><div class="chips">${tools.map((x) => `<span class="pill">${esc(x.tool)} · ${num(x.n)}</span>`).join('')}</div></section>` : '');
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

// ---------- Onglet Contacts ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const dueOf = (k) => (k.next_at && k.stage !== 'perdu' ? dueLbl(k.next_at) : null);
function contactRow(k) {
  const d = dueOf(k);
  return `<button class="row" data-act="crmopen" data-id="${esc(k.id)}"><span class="g">${esc(k.org)}<small>${esc([k.contact_name, k.contact_role].filter(Boolean).join(' · ') || 'Contact à compléter')}${k.current_tool ? ' · ' + esc(k.current_tool) : ''}</small>${k.next_at && k.stage !== 'perdu' ? `<small>${esc(k.next_action || 'Relance')} · ${esc(dayLbl(k.next_at))}</small>` : ''}</span>${d ? `<span class="pill ${d[1]}">${esc(d[0])}</span>` : ''}<span class="pill blue">${esc(INTEREST[num(k.interest)])}</span></button>`;
}
function contactCard(k) {
  const d = dueOf(k);
  return `<button class="card crmlead" data-act="crmopen" data-id="${esc(k.id)}"><b>${esc(k.org)}</b><small>${esc([k.contact_name, k.sport].filter(Boolean).join(' · ') || '—')}</small>${k.current_tool ? `<span class="pill">${esc(k.current_tool)}</span>` : ''}<span class="crmrow"><span class="pill blue">${esc(INTEREST[num(k.interest)])}</span>${d ? `<span class="pill ${d[1]}">${esc(d[0])}</span>` : ''}</span></button>`;
}
export function crmTab() {
  const c = C(); if (c.err === NEED) return `<div class="card alert" role="alert"><b>${esc(NEED)}</b></div>`;
  const l = c.list; if (!l) return '<p class="empty">Chargement…</p>';
  const q = norm(c.q), f = c.f || 'all';
  const FIL = [['all', 'Tous', (k) => k.stage !== 'perdu'], ['relance', 'À relancer', (k) => k.stage !== 'perdu' && k.next_at && k.next_at <= today()], ['lost', 'Perdus', (k) => k.stage === 'perdu']];
  const ff = FIL.find((x) => x[0] === f) || FIL[0];
  const vis = l.filter(ff[2]).filter((k) => !q || norm([k.org, k.contact_name, k.city, k.current_tool, k.sport].join(' ')).includes(q));
  let h = dictCard() + `<div class="btns"><button class="btn main" data-act="crmnew">${icon('plus', 20)}Nouveau contact</button></div>`;
  h += `<div class="field"><label for="crmq">Chercher un contact, un club, un outil</label><input id="crmq" type="search" data-crmq="1" value="${esc(c.q || '')}" autocomplete="off" placeholder="Nom, ville, outil…"></div><div class="chips">${FIL.map(([k, t, fn]) => `<button class="chip" data-act="crmf" data-k="${k}" aria-pressed="${k === ff[0]}">${t} · ${l.filter(fn).length}</button>`).join('')}</div>`;
  if (ff[0] === 'all' && !c.q) {
    // ordinateur : une colonne par étape ; ailleurs : une liste par étape
    h += `<div class="crmboard gv">${STAGES.filter((s) => s[0] !== 'perdu').map(([k, t]) => { const g = vis.filter((x) => x.stage === k); return `<section class="crmcol" aria-label="${esc(t)}"><div class="kick">${esc(t)} · ${g.length}</div>${g.map(contactCard).join('') || '<p class="note">Aucun.</p>'}</section>`; }).join('')}</div>`;
    h += `<div class="notpc">${STAGES.filter((s) => s[0] !== 'perdu').map(([k, t]) => { const g = vis.filter((x) => x.stage === k); return g.length ? `<div class="sec"><h2>${esc(t)}</h2><span class="det">${g.length}</span></div><section class="card"><div class="list">${g.map(contactRow).join('')}</div></section>` : ''; }).join('') || '<p class="empty">Aucun contact pour l’instant.</p>'}</div>`;
  } else h += `<section class="card"><div class="list">${vis.map(contactRow).join('') || '<p class="empty">Aucun contact.</p>'}</div></section>`;
  return h + '<p class="note">Seul l’administrateur voit cette page. Chaque contact peut être effacé avec son historique (droit d’effacement).</p>';
}

// ---------- Fiche d'un contact ----------
function contactForm(k) {
  const v = k || {}, id = k ? 'crmedit' : 'crmnewf';
  return `<form class="card" id="${id}" ${k ? `data-id="${esc(k.id)}"` : ''}>
    ${field('cro', 'Club ou organisation', `<input id="cro" name="org" required maxlength="120" value="${esc(v.org || '')}">`)}
    <div class="grid2">${field('crn', 'Contact', `<input id="crn" name="contact_name" maxlength="120" value="${esc(v.contact_name || '')}" placeholder="Ex. : JP">`)}${field('crr', 'Fonction', `<input id="crr" name="contact_role" maxlength="80" value="${esc(v.contact_role || '')}" placeholder="Ex. : président">`)}</div>
    ${field('cre', 'E-mail (facultatif)', `<input id="cre" name="contact_email" type="email" maxlength="200" value="${esc(v.contact_email || '')}">`)}
    <div class="grid2">${field('crs', 'Sport', `<input id="crs" name="sport" maxlength="40" value="${esc(v.sport || '')}" placeholder="Volley, basket…">`)}${field('crc', 'Ville', `<input id="crc" name="city" maxlength="80" value="${esc(v.city || '')}">`)}</div>
    <div class="grid2">${field('crg', 'Étape', sel('crg', 'stage', STAGES, v.stage || 'a_contacter'))}${field('cri', 'Intérêt', sel('cri', 'interest', INTEREST.map((l, i) => [i, l]), num(v.interest)))}</div>
    ${field('crt', 'Outil utilisé aujourd’hui', `<input id="crt" name="current_tool" maxlength="80" value="${esc(v.current_tool || '')}" placeholder="Sport Easy, ClickToClub, WhatsApp…">`)}
    ${field('crw', 'Ce qu’il souhaite', `<input id="crw" name="wants" maxlength="300" value="${esc(v.wants || '')}" placeholder="Ex. : tester 1 équipe 1 saison">`)}
    <div class="grid2">${field('cra', 'Prochaine relance : quoi', `<input id="cra" name="next_action" maxlength="200" value="${esc(v.next_action || '')}">`)}${field('crd', 'Prochaine relance : quand', `<input id="crd" name="next_at" type="date" value="${esc(v.next_at || '')}">`)}</div>
    ${k && v.stage === 'perdu' ? field('crl', 'Pourquoi perdu', `<input id="crl" name="lost_reason" maxlength="200" value="${esc(v.lost_reason || '')}">`) : ''}
    <button class="btn main" type="submit">${icon('check', 20)}${k ? 'Enregistrer' : 'Créer le contact'}</button></form>`;
}
function contactScreen(id) {
  const head = (t) => header({ brand: true, back: true, kicker: 'Administration · contact', title: t });
  if (!S.isAdmin) return head('Contact') + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  const c = C(), k = (c.list || []).find((x) => x.id === id);
  if (!k) return head('Contact') + `<main class="bd"><p class="empty">${c.list ? 'Contact introuvable.' : 'Chargement…'}</p></main>`;
  const ev = c.events && c.events.id === id ? c.events.list : null, d = dueOf(k);
  let h = `<div class="chips"><span class="pill blue">${esc(STAGE[k.stage] || k.stage)}</span><span class="pill">${esc(INTEREST[num(k.interest)])}</span>${k.current_tool ? `<span class="pill">${esc(k.current_tool)}</span>` : ''}${k.club_name ? `<span class="pill ok">Inscrit : ${esc(k.club_name)}</span>` : ''}</div>`;
  h += `<div class="idnums crm3"><div><b>${esc(k.contact_name || '—')}</b><span>${esc(k.contact_role || 'fonction ?')}</span></div><div><b>${esc(k.wants || '—')}</b><span>souhaite</span></div><div><b>${num(k.events_n)}</b><span>échange${num(k.events_n) > 1 ? 's' : ''}</span></div></div>`;
  h += `<section class="card ${d && d[1] ? 'warn' : ''}"><div class="kh"><h3>Prochaine relance</h3>${d ? `<span class="pill ${d[1]}">${esc(d[0])}</span>` : ''}</div>${k.next_at ? `<p><b>${esc(k.next_action || 'À relancer')}</b> · ${esc(dayLbl(k.next_at))}</p><button class="btn small main" data-act="crmdone" data-id="${esc(k.id)}">${icon('check', 18)}Fait</button>` : '<p class="note">Aucune relance prévue. Ajoute-en une avec un échange, ci-dessous.</p>'}</section>`;
  h += `<div class="sec"><h2>Historique</h2><span class="det">${ev ? ev.length : ''}</span></div><section class="card">${ev ? (ev.length ? `<div class="crmev">${ev.map((e) => `<div class="crmevr"><span class="crmd">${esc(fmtDay(e.at))}</span><span class="g"><b>${esc(KIND[e.kind] || e.kind)}</b>${e.source === 'claude' ? ' <span class="pill wait">Rangé par Claude</span>' : ''}${e.summary ? `<small>${esc(e.summary)}</small>` : ''}</span></div>`).join('')}</div>` : '<p class="empty">Aucun échange noté.</p>') : '<p class="empty">Chargement…</p>'}</section>`;
  h += `<div class="sec"><h2>Noter un échange</h2></div><form class="card" id="crmev" data-id="${esc(k.id)}">
    <div class="grid2">${field('cek', 'Type', sel('cek', 'kind', KINDS, 'note'))}${field('ced', 'Date', `<input id="ced" name="at" type="date" value="${today()}" max="${today()}">`)}</div>
    ${field('ces', 'Ce qui s’est dit ou fait', `<input id="ces" name="summary" maxlength="1000" placeholder="Ex. : live avec JP, intérêt ++, veut tester 1 équipe">`)}
    <div class="grid2">${field('cea', 'Prochaine relance : quoi (facultatif)', `<input id="cea" name="next_action" maxlength="200">`)}${field('cen', 'Quand', `<input id="cen" name="next_at" type="date" value="">`)}</div>
    ${field('cet', 'Changer l’étape', sel('cet', 'stage', [['', 'Ne pas changer'], ...STAGES], ''))}
    <button class="btn main" type="submit">${icon('check', 20)}Ajouter à l’historique</button></form>`;
  h += `<div class="sec"><h2>Fiche</h2></div>${contactForm(k)}`;
  const on = isArmed('crmdel' + k.id);
  h += `<section class="card"><button class="btn ${on ? 'danger armed' : 'ghost'}" data-act="crmdel" data-id="${esc(k.id)}">${icon('trash', 20)}${on ? 'Confirmer : effacer ce contact' : 'Effacer ce contact'}</button><p class="note">Efface la fiche et tout son historique, définitivement. Inscrit au journal admin.</p></section>`;
  return head(esc(k.org)) + `<main class="bd adm">${c.err ? `<div class="card alert" role="alert"><b>${esc(c.err)}</b></div>` : ''}<div data-pro>${h}</div></main>`;
}
function newScreen() {
  const head = header({ brand: true, back: true, kicker: 'Administration · contacts', title: 'Nouveau contact' });
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  return head + `<main class="bd adm">${C().err ? `<div class="card alert" role="alert"><b>${esc(C().err)}</b></div>` : ''}${contactForm(null)}<p class="note">Données de personnes : à remplir seulement avec la base du vrai site.</p></main>`;
}
Object.assign(V37_TOP, { crmc: (v) => contactScreen(v.id), crmn: () => newScreen() });

// ---------- actions ----------
const refreshList = async () => { await crmLoadList(); render(true); };
const fromForm = (v) => ({ org: v.org, contact_name: v.contact_name, contact_role: v.contact_role, contact_email: v.contact_email, sport: v.sport, city: v.city, stage: v.stage, interest: +v.interest || 0,
  current_tool: v.current_tool, wants: v.wants, next_action: v.next_action, next_at: v.next_at || '', ...(v.lost_reason !== undefined ? { lost_reason: v.lost_reason } : {}) });
Object.assign(ACTIONS, {
  crmf: (el, d) => { C().f = d.k; render(true); },
  crminx: async (el, d) => {
    if (!armed('crminx' + d.id)) return;
    if (await run(sb.rpc('admin_crm_inbox_delete', { p_id: d.id }), 'Phrase retirée.')) { const c = C(); c.inbox = (c.inbox || []).filter((x) => x.id !== d.id); render(true); }
  },
  crmnew: () => { S.view = { type: 'crmn' }; render(); },
  crmopen: async (el, d) => {
    const c = C(); S.view = { type: 'crmc', id: d.id }; c.events = null; render();
    if (!c.list) await crmLoadList();
    await loadEvents(d.id); render(true);
  },
  // « Fait » : sur l'Accueil, dans la liste des relances ou sur la fiche
  crmdone: async (el, d) => {
    if (await run(sb.rpc('admin_crm_relance_done', { p_contact: d.id }), 'Relance notée.')) { await crmLoadList(); await crmLoadHome(); if (S.view?.type === 'crmc') await loadEvents(d.id); render(true); }
  },
  crmdel: async (el, d) => {
    if (!armed('crmdel' + d.id)) return;
    if (await run(sb.rpc('admin_crm_delete', { p_contact: d.id }), 'Contact effacé.')) { S.view = null; S.noStack = true; C().events = null; await crmLoadList(); S.admTab = 'crm'; render(true); }
  },
});
FORMS.crminb = async (v) => {
  const body = String(v.body || '').trim(); if (!body) { toast('Écris ou dicte une phrase.'); return; }
  stopDictation();
  if (await run(sb.rpc('admin_crm_inbox_add', { p_body: body }), 'Phrase gardée. Dis-moi « range mes dictées » dans la conversation.')) {
    const c = C(); c.draft = ''; const ib = await rpc('admin_crm_inbox_list'); if (ib) c.inbox = arr(ib) || []; render(true);
  }
};
FORMS.crmnewf = async (v) => {
  const id = await run(sb.rpc('admin_crm_save', { p_id: null, p_data: fromForm(v) }), 'Contact créé.');
  if (id) { await crmLoadList(); S.view = { type: 'crmc', id }; S.noStack = true; C().events = null; render(); await loadEvents(id); render(true); }
};
FORMS.crmedit = async (v, f) => {
  if (await run(sb.rpc('admin_crm_save', { p_id: f.dataset.id, p_data: fromForm(v) }), 'Fiche enregistrée.')) { await crmLoadList(); render(true); }
};
FORMS.crmev = async (v, f) => {
  const at = v.at ? new Date(v.at + 'T12:00:00').toISOString() : null;
  if (await run(sb.rpc('admin_crm_event_add', { p_contact: f.dataset.id, p_kind: v.kind, p_summary: v.summary || '', p_at: at, p_next_at: v.next_at || null, p_next_action: v.next_action || null, p_stage: v.stage || null }), 'Échange noté.')) {
    await crmLoadList(); await loadEvents(f.dataset.id); render(true);
  }
};
INPUTS.push((t) => {
  if (t.dataset?.crmdict) { C().draft = t.value; return true; } // la phrase en cours survit aux rafraîchissements de l'écran
  if (!t.dataset.crmq) return false;
  C().q = t.value; const pos = t.selectionStart; render(true);
  const n = document.getElementById('crmq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } }
  return true;
});
