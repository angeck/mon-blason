// mypocketclub · bêta 1.1.0 · n° 244 (Gaël, 17 novembre 2026 : « vas-y pour le codage de tout 244 », maquette en trois vues
// https://claude.ai/artifact/H3xQe93rg91g7KbJMzXLx4) :
//   Espace Président « pro » : six onglets Vue d'ensemble · Demandes · Bureau · Équipes · Réglages · Journal ;
//   Vue d'ensemble = carte d'identité du club, « À traiter », chiffres du club (graphiques sur ordinateur seulement, n° 246),
//   le bureau, la semaine au club, les dernières actions ; Bureau = les fonctions (chacune ouvre sa page) ; Équipes = toutes les
//   équipes (tableau sur ordinateur) avec filtres, puis créer, importer et doublons.
//   La page de chaque fonction (Aperçu) suit le même modèle : c'est la même page pour le président et pour la personne qui a la
//   fonction (js/v44.js), à ceci près que le président voit en tête la personne qui la tient.
// Supports (n° 246) : téléphone en tuiles ; tablette (600 px) en tuiles, sans graphiques ; ordinateur (960 px) avec graphiques et
// tableaux ; dès 1200 px, la zone de contenu s'élargit pour ces pages (html.prov, style.css).
// Rappel : chaque droit est vérifié par la base ; l'écran n'est qu'un confort. Rien ici n'ouvre une donnée de plus.
import {
  S, sb, esc, hooks, ACTIONS, FORMS, render, run, toast, refresh, club, isPresident, hasArea, FONCTIONS, fl, name, plural, fmtShort,
  evTeams, team, teamName, toValidate, SEASON, catsFor, active, canAllStats,
} from './core.js';
import { icon, crest } from './ui.js';
import { missing } from './vie.js';

const DAY = 864e5;
export const eur = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export const live = () => S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée');
const ownPlayers = () => S.players.filter((p) => !p.from_partner && !p.deleted_at);
const coachIdsOf = (tid) => [...new Set(S.members.filter((m) => m.role === 'coach' && m.status === 'active' && m.team_id === tid).map((m) => m.user_id))];
export const holderOf = (f) => [...new Set(S.members.filter((m) => m.role === 'bureau' && m.status === 'active' && m.fonction === f).map((m) => m.user_id))];
const presId = () => (S.members.find((m) => m.role === 'president' && m.status === 'active') || {}).user_id;
const isVP = () => active().some((m) => m.role === 'bureau' && m.fonction === 'Vice-président');

// =====================================================================
// Briques communes (Vue d'ensemble du président et Aperçu de chaque fonction)
// =====================================================================
// « À traiter » : tuiles qui mènent à la liste concernée ; rien à traiter : une seule carte verte.
// items : { n, l, s, act, attrs, hot } ; hot (par défaut n > 0) = cadre jaune
export function todoTiles(items, { all = false } = {}) {
  const l = all ? items : items.filter((x) => x.n > 0 || x.keep);
  if (!l.length) return `<div class="card pdone"><span class="pdic">${icon('check', 20, 'var(--pc-oui-texte)')}</span><span><b>Rien à traiter</b><br><span class="det">Tout est à jour pour l’instant.</span></span></div>`;
  return `<div class="ptodo">${l.map((x) => {  const hot = x.hot ?? x.n > 0; return `<button class="tile ptile ${hot && x.n > 0 ? 'wait' : x.n > 0 ? 'neu' : 'ok'}" data-act="${x.act}" ${x.attrs || ''}><b>${esc(String(x.n))}</b><span class="pl">${esc(x.l)}</span>${x.s ? `<span class="ps">${esc(x.s)}</span>` : ''}</button>`; }).join('')}</div>`;
}
// Carte de chiffre : un grand nombre et sa légende sur les trois supports ; le graphique (gv) sur ordinateur seulement
export function kcard({ title, hero, cap, chart = '', link = '', id = '' }) {
  return `<section class="card kcard" ${id ? `data-k="${id}"` : ''}><div class="kh"><h3>${esc(title)}</h3>${link}</div><div class="khero">${esc(hero)}</div>${cap ? `<div class="kcap">${cap}</div>` : ''}${chart ? `<div class="gv">${chart}</div>` : ''}</section>`;
}
export const klink = (label, act, attrs = '') => `<button class="klink" data-act="${act}" ${attrs}>${esc(label)}</button>`;
// Barres horizontales (une seule série, bleue) ; ref = trait de moyenne (en %)
export function hbars(items, { max, suffix = '', ref = null, label = '' } = {}) {
  const mx = max || Math.max(1, ...items.map((x) => x.n || 0));
  return `<div class="hbars" role="img" aria-label="${esc(label || items.map((x) => x.l + ' ' + x.n + suffix).join(', '))}">${items.map((x) => `<div class="hb"><span class="hl">${esc(x.l)}</span><span class="ht"><span class="hf" style="width:${Math.max(0, Math.min(100, (100 * (x.n || 0)) / mx)).toFixed(1)}%"></span>${ref != null ? `<span class="href" style="left:${ref}%"></span>` : ''}</span><span class="hv">${x.n == null ? '—' : esc(String(x.n)) + suffix}</span></div>`).join('')}</div>`;
}
// Barre empilée et sa légende ; parts : { l, n, c } avec c = c-ok (payé), c-part (jaune), c-due (à payer), c-b1, c-b2, c-b3 (bleus, du plus foncé au plus clair)
export function stack(parts, label) {
  const tot = parts.reduce((a, x) => a + x.n, 0) || 1, on = parts.filter((x) => x.n > 0);
  return `<div class="stk" role="img" aria-label="${esc(label)}">${on.map((x) => `<span class="${x.c}" style="flex:${x.n} 1 0"></span>`).join('')}</div><div class="leg">${parts.map((x) => `<div><span class="sw ${x.c}"></span><span class="ll">${esc(x.l)}</span><b>${x.n}</b><span class="lp">${pct(x.n, tot)} %</span></div>`).join('')}</div>`;
}
// Colonnes (par mois)
export function vbars(items, unit, label) {
  const mx = Math.max(1, ...items.map((x) => x.n));
  return `<div class="vbars" role="img" aria-label="${esc(label)}">${items.map((x) => `<div class="vb"><span class="vv">${esc(x.v ?? String(x.n))}${unit}</span><span class="vf" style="height:${Math.round((120 * x.n) / mx)}px"></span><span class="vl">${esc(x.l)}</span></div>`).join('')}</div>`;
}
// Liste récente : tableau sur ordinateur, lignes ailleurs. cols : [titre, alignement] ; rows : { cells, act, attrs, title, sub }
export function listOrTable(title, cols, rows, { link = '', empty = 'Rien pour l’instant.', note = '' } = {}) {
  const head = `<div class="kh"><h3>${esc(title)}</h3>${link}</div>`;
  if (!rows.length) return `<section class="card">${head}<p class="empty">${esc(empty)}</p></section>`;
  const tb = `<div class="gtab"><table class="ptable"><thead><tr>${cols.map(([t, a]) => `<th scope="col" class="${a || ''}">${esc(t)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.cells.map((c, i) => `<td class="${cols[i][1] || ''}">${i === 0 && r.act ? `<button class="tlink" data-act="${r.act}" ${r.attrs || ''}>${c}</button>` : c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const li = `<div class="list notpc">${rows.map((r) => (r.act ? `<button class="row" data-act="${r.act}" ${r.attrs || ''}>` : '<div class="row static">') + `<span class="g">${r.title}<small>${r.sub}</small></span>${r.act ? '<span class="chev"></span></button>' : '</div>'}`).join('')}</div>`;
  return `<section class="card">${head}${tb}${li}${note ? `<p class="note">${note}</p>` : ''}</section>`;
}
const tag = (t, k) => `<span class="pill ${k}">${esc(t)}</span>`;
export { tag };
// « Ce que voit X » (président) / « Tes droits » (la personne) : accès, ce qui ne se voit jamais, réglages masquables
// masq : [{ k, l, d, on }] (interrupteurs du président ; Visible / Masqué pour les autres)
export function rightsCard(title, voit, { masq = [], nevoit = [] } = {}) {
  let h = `<div class="kh"><h3>${esc(title)}</h3></div><div class="rvoit">${voit.map((x) => `<div>${icon('check', 18, 'var(--pc-oui-texte)')}<span>${esc(x)}</span></div>`).join('')}</div>`;
  if (nevoit.length) h += `<div class="kick">Ne voit pas (fixé par la base)</div><div class="rvoit no">${nevoit.map((x) => `<div><span class="rx" aria-hidden="true">×</span><span>${esc(x)}</span></div>`).join('')}</div>`;
  if (masq.length) {
    h += `<div class="kick">Selon tes réglages</div>`;
    h += isPresident()
      ? masq.map((m) => `<label class="switch"><input type="checkbox" data-clubset="${m.k}" ${m.on ? 'checked' : ''}><span><b>${esc(m.l)}</b><br><span class="det">${esc(m.d)}</span></span></label>`).join('') + '<p class="note">Aussi dans Président › Réglages › Droits.</p>'
      : `<div class="list">${masq.map((m) => `<div class="row static"><span class="g">${esc(m.l)}<small>${esc(m.d)}</small></span>${tag(m.on ? 'Visible' : 'Masqué', m.on ? 'ok' : '')}</div>`).join('')}</div><p class="note">Réglé par le président.</p>`;
  }
  return `<section class="card rcard">${h}</section>`;
}
// En tête de la page d'une fonction, chez le président : qui la tient (Écrire, Changer) ou « Personne » (Désigner)
export function holderCard(f) {
  const hs = holderOf(f);
  if (!hs.length) return `<section class="card hcard none"><div class="kick">${esc(fl(f))}</div><div class="hwho"><span class="hav empty" aria-hidden="true"></span><span><b>Personne</b><br><span class="det">Sans titulaire, c’est toi qui t’en occupes ; ce que tu fais ici est inscrit au journal à ton nom.</span></span></div><button class="btn small main" data-act="fonctions">${icon('plus', 18)}Désigner quelqu’un</button></section>`;
  return `<section class="card hcard"><div class="kick">${esc(fl(f))}</div>${hs.map((u) => `<div class="hwho"><span class="hav" aria-hidden="true">${esc(initials2(name(u)))}</span><span><b>${esc(name(u))}</b><br><span class="det">tient cette fonction</span></span></div>`).join('')}<div class="btns">${hs.length === 1 ? `<button class="btn small ghost" data-act="member" data-id="${hs[0]}">${icon('msg', 18)}Écrire</button>` : ''}<button class="btn small ghost" data-act="fonctions">${icon('user', 18)}Changer</button></div><p class="note">Ce que tu fais dans cette page est inscrit au journal à ton nom.</p></section>`;
}
const initials2 = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// =====================================================================
// Calculs partagés
// =====================================================================
// Présence aux entraînements des 4 dernières semaines, par équipe (appels faits seulement) ; done = entraînements avec un appel
export function presenceByTeam(days = 28) {
  const now = Date.now(), since = now - days * DAY;
  return live().map((t) => {
    const evs = S.events.filter((e) => !e.cancelled && e.type === 'Entraînement' && evTeams(e).includes(t.id) && new Date(e.starts_at) < now && new Date(e.starts_at) >= since);
    const ids = new Set(evs.map((e) => e.id)), rec = S.att.filter((a) => ids.has(a.event_id));
    const ok = rec.filter((a) => a.status !== 'absent').length;
    return { t, trainings: evs.length, done: new Set(rec.map((a) => a.event_id)).size, rec: rec.length, ok, pct: rec.length ? pct(ok, rec.length) : null };
  });
}
export function presenceClub() {
  const l = presenceByTeam(), rec = l.reduce((a, x) => a + x.rec, 0), ok = l.reduce((a, x) => a + x.ok, 0);
  const tr = l.reduce((a, x) => a + x.trainings, 0), done = l.reduce((a, x) => a + x.done, 0);
  return { l, pct: rec ? pct(ok, rec) : null, trainings: tr, done };
}
export function presenceCard(link = '') {
  const p = presenceClub(), withData = p.l.filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
  const cap = p.trainings ? `moyenne du club · 4 dernières semaines<br>Appel fait pour ${p.done} entraînement${p.done > 1 ? 's' : ''} sur ${p.trainings}` : 'Aucun entraînement ces 4 dernières semaines';
  const chart = withData.length ? `<div class="kref"><span class="refm" aria-hidden="true"></span>trait = moyenne du club</div>` + hbars(withData.map((x) => ({ l: x.t.name, n: x.pct })), { max: 100, suffix: ' %', ref: p.pct, label: 'Présence par équipe' }) : '';
  return kcard({ id: 'presence', title: 'Présence aux entraînements', hero: p.pct == null ? '—' : p.pct + ' %', cap, chart, link });
}
// Cotisations : joueurs avec un montant dû (sans les joueurs « sans cotisation »)
export function feeStats() {
  const r = ownPlayers().map((p) => ({ p, a: S.padmin.find((x) => x.player_id === p.id) })).filter((x) => x.a && !x.a.nofee && x.a.fee_amount != null);
  const due = r.reduce((s, x) => s + +x.a.fee_amount, 0), paid = r.reduce((s, x) => s + Math.min(+x.a.fee_paid || 0, +x.a.fee_amount), 0);
  const full = r.filter((x) => (+x.a.fee_paid || 0) >= +x.a.fee_amount).length, part = r.filter((x) => (+x.a.fee_paid || 0) > 0 && (+x.a.fee_paid || 0) < +x.a.fee_amount).length;
  return { rows: r, due, paid, rest: due - paid, full, part, none: r.length - full - part, late: r.filter((x) => +x.a.fee_amount - (+x.a.fee_paid || 0) > 0) };
}
export function feeCard(link = '') {
  const f = feeStats();
  if (!f.rows.length) return kcard({ id: 'cotis', title: 'Cotisations', hero: '—', cap: 'Aucun tarif encore appliqué aux joueurs', link });
  return kcard({ id: 'cotis', title: 'Cotisations', hero: pct(f.paid, f.due) + ' %', cap: `${eur(f.paid)} encaissés sur ${eur(f.due)}`, link,
    chart: stack([{ l: 'Payé', n: f.full, c: 'c-ok' }, { l: 'Partiel', n: f.part, c: 'c-part' }, { l: 'À payer', n: f.none, c: 'c-due' }], `Cotisations : ${f.full} payées, ${f.part} partielles, ${f.none} à payer`) });
}
export function licStats() {
  const ad = ownPlayers().map((p) => S.padmin.find((a) => a.player_id === p.id) || {});
  const lic = ad.filter((a) => a.licence_state === 'Licencié').length, fed = ad.filter((a) => a.licence_state === 'Préinscrit fédé').length;
  return { n: ad.length, lic, fed, pre: ad.length - lic - fed, doc: ad.filter((a) => a.health_doc).length };
}
export function licCard(link = '') {
  const l = licStats();
  return kcard({ id: 'licences', title: 'Licences', hero: l.n ? pct(l.lic, l.n) + ' %' : '—', cap: `${l.lic} licence${l.lic > 1 ? 's' : ''} validée${l.lic > 1 ? 's' : ''} sur ${l.n}`, link,
    chart: l.n ? stack([{ l: 'Validée', n: l.lic, c: 'c-b1' }, { l: 'Préinscrit fédé', n: l.fed, c: 'c-b2' }, { l: 'Préinscrit club', n: l.pre, c: 'c-b3' }], `Licences : ${l.lic} validées, ${l.fed} préinscrits fédération, ${l.pre} préinscrits club`) : '' });
}
export function docCard(link = '') {
  const l = licStats();
  return kcard({ id: 'certificats', title: 'Certificats médicaux', hero: l.n ? pct(l.doc, l.n) + ' %' : '—', cap: 'fournis · oui ou non, jamais le contenu', link,
    chart: l.n ? stack([{ l: 'Fourni', n: l.doc, c: 'c-b1' }, { l: 'Pas fourni', n: l.n - l.doc, c: 'c-b3' }], `Certificats : ${l.doc} fournis sur ${l.n}`) : '' });
}
// Licenciés par catégorie (ordre des catégories du sport) ; « +N » : joueurs ajoutés depuis le 1er du mois
export function playersCard(link = '') {
  const pl = ownPlayers(), order = catsFor(club()?.sport), cnt = {};
  pl.forEach((p) => { const c = team(p.team_id)?.category || 'Sans équipe'; cnt[c] = (cnt[c] || 0) + 1; });
  const keys = Object.keys(cnt).sort((a, b) => { const ia = order.findIndex((x) => x.startsWith(a) || a.startsWith(x.split(' ')[0])), ib = order.findIndex((x) => x.startsWith(b) || b.startsWith(x.split(' ')[0])); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'fr', { numeric: true }); });
  const m1 = new Date(); m1.setDate(1); m1.setHours(0, 0, 0, 0);
  const plus = pl.filter((p) => p.created_at && new Date(p.created_at) >= m1).length;
  const month = m1.toLocaleDateString('fr-FR', { month: 'long' });
  return kcard({ id: 'licencies', title: 'Licenciés', hero: String(pl.length), cap: plus ? `+${plus} depuis le 1<sup>er</sup> ${esc(month)}` : 'joueurs du club', link,
    chart: keys.length ? `<div class="kick">Par catégorie</div>` + hbars(keys.map((k) => ({ l: k, n: cnt[k] })), { label: 'Licenciés par catégorie' }) : '' });
}

// =====================================================================
// Espace du président (onglets dans js/v310.js)
// =====================================================================
const TFLT = { nocoach: ['Sans coach', (t) => !coachIdsOf(t.id).length], ghost: ['Mode fantôme', (t) => t.state === 'Fantôme'] };
function gymsNow() {
  if (S.gymsClub !== S.clubId) { S.gymsClub = S.clubId; S.gyms = null; const cid = S.clubId; sb.from('club_gyms').select('id,name,address,position,created_at').eq('club_id', cid).order('position').order('created_at').then(({ data }) => { if (S.clubId === cid) { S.gyms = Array.isArray(data) ? data : []; render(true); } }, () => {}); }
  return S.gyms || [];
}
function lastActions() {
  if (S.jl5Club !== S.clubId) { S.jl5Club = S.clubId; S.jl5 = null; const cid = S.clubId; sb.rpc('club_log', { p_club: cid, p_limit: 5 }).then(({ data }) => { if (S.clubId === cid) { S.jl5 = Array.isArray(data) ? data : []; render(true); } }, () => {}); }
  return S.jl5;
}
function identityCard() {
  const c = club() || {}, g = gymsNow(), pid = presId();
  if (hooks.clientBlock) hooks.clientBlock(); // charge la vue client (statut chez mypocketclub) ; le bloc lui-même reste dans Réglages
  const v = S.cview, st = v && v.status ? ({ test: 'Test gratuit', gratuit: 'Gratuit', payant: 'Abonnement payant' }[v.status] || v.status) + (v.engaged_to ? ' jusqu’au ' + new Date(v.engaged_to).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '') : '…';
  const dep = /^\d{5}$/.test(c.postal_code || '') ? ` (${c.postal_code.slice(0, 2)})` : '';
  const canEdit = isPresident() || isVP();
  const todo = (t) => (canEdit ? `<span class="tofill">${esc(t)}</span>` : '—');
  const lic = holderOf('Correspondant licences')[0], sec = holderOf('Secrétaire')[0];
  const facts = [
    ['Président', pid ? name(pid) : '—'],
    ['Fédération', c.federation ? esc(c.federation) + (c.affiliation ? ' · n° ' + esc(c.affiliation) : ` · n° d’affiliation ${todo('à renseigner')}`) : todo('à renseigner')],
    ['Gymnases', g.length ? esc(g.map((x) => x.name).join(' · ')) : todo('à ajouter')],
    ['Contact licences', esc(lic ? name(lic) : sec ? name(sec) + ' (secrétaire)' : pid ? name(pid) + ' (président)' : '—'), 'notph'],
    ['Sur mypocketclub', c.created_at ? 'depuis le ' + new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—', 'notph'],
    ...(isPresident() ? [['Ton club chez mypocketclub', esc(st)]] : []),
  ];
  const coachs = new Set(S.members.filter((m) => m.role === 'coach' && m.status === 'active').map((m) => m.user_id)).size;
  const bureau = new Set(S.members.filter((m) => ['president', 'bureau'].includes(m.role) && m.status === 'active').map((m) => m.user_id)).size;
  const nums = [[ownPlayers().length, 'licenciés'], [live().length, 'équipes'], [coachs, 'coachs'], [bureau, 'au bureau'], [g.length, 'gymnases']];
  // bêta 1.5.0 : pour le président, « Visible dans la recherche » et « En-tête aux couleurs » mènent au réglage (en jaune)
  const go = isPresident(), wrap = (k, cls, inner) => (go ? `<button class="${cls} idgo" data-act="idgo" data-v="${k}" aria-label="${esc(inner.replace(/<[^>]+>/g, ''))} : modifier ce réglage">${inner}</button>` : `<span class="${cls}">${inner}</span>`);
  const chip = (k, t) => wrap(k, 'idchip', `${icon('check', 14, 'var(--pc-action)')}${esc(t)}`);
  const chips = [c.public_listed !== false ? chip('public_listed', 'Visible dans la recherche') : wrap('public_listed', 'idchip off', 'Absent de la recherche'), c.custom_header ? chip('custom_header', 'En-tête aux couleurs du club') : '',
    `<span class="idchip">Couleurs <span class="idsw" style="background:${esc(c.color1 || '#2F5BFF')}"></span><span class="idsw" style="background:${esc(c.color2 || '#FFC93C')}"></span></span>`].join('');
  return `<section class="card idcard" data-idcard="1"><div class="idtop"><span class="idcrest">${crest(c, 72)}</span><div class="idname"><div class="kick">Carte d’identité du club</div><h2>${esc(c.name || '')}</h2><div class="det">${esc([c.sport === 'Volley-ball' ? 'Volley' : 'Basket', (c.city || '') + dep, 'saison ' + SEASON].filter((x) => x.trim()).join(' · '))}</div><div class="idchips">${chips}</div></div>
  <dl class="idfacts">${facts.map(([a, b, cl]) => `<div${cl ? ` class="${cl}"` : ''}><dt>${esc(a)}</dt><dd>${b}</dd></div>`).join('')}</dl>${canEdit ? `<button class="idedit" data-act="pclubedit" aria-label="Modifier la fiche du club">${icon('edit', 18)}</button>` : ''}</div>
  <div class="idnums">${nums.map(([n, l]) => `<div><b>${n}</b><span>${esc(l)}</span></div>`).join('')}</div></section>`;
}
function presTodo() {
  const vp = toValidate(), byRole = {};
  vp.forEach((m) => (byRole[m.role] = (byRole[m.role] || 0) + 1));
  const RL = { joueur: ['joueur', 'joueurs'], parent: ['parent', 'parents'], coach: ['coach', 'coachs'], bureau: ['membre du bureau', 'membres du bureau'], supporteur: ['supporteur', 'supporteurs'] };
  const vs = Object.entries(byRole).map(([r, n]) => plural(n, ...(RL[r] || ['demande', 'demandes']))).join(' · ');
  const f = feeStats(), nc = live().filter(TFLT.nocoach[1]), gh = live().filter(TFLT.ghost[1]);
  const empty = ['Vice-président', 'Secrétaire', 'Trésorier'].filter((x) => !holderOf(x).length);
  const names = (l) => l.slice(0, 3).map((t) => t.name).join(' · ') + (l.length > 3 ? '…' : '');
  return todoTiles([
    { n: vp.length, l: 'Demandes à valider', s: vs, act: 'ptab', attrs: 'data-v="demandes"' },
    { n: f.late.length, l: 'Cotisations à relancer', s: f.late.length ? eur(f.rest) + ' restent dus' : '', act: 'fview', attrs: 'data-v="Trésorier" data-tab="cotis"' },
    { n: nc.length, l: nc.length > 1 ? 'Équipes sans coach' : 'Équipe sans coach', s: names(nc), act: 'tflt', attrs: 'data-v="nocoach"' },
    { n: gh.length, l: 'Équipes en mode fantôme', s: names(gh), act: 'tflt', attrs: 'data-v="ghost"', hot: false },
    { n: empty.length, l: 'Fonctions sans titulaire', s: empty.map(fl).join(' · '), act: 'ptab', attrs: 'data-v="bureau"', hot: false },
  ].map((x, i) => ({ ...x, _i: i })).sort((a, b) => ((b.hot ?? b.n > 0) && b.n > 0) - ((a.hot ?? a.n > 0) && a.n > 0) || a._i - b._i)); // bêta 1.5.0 · n° 277 : seules les tuiles à traiter, les urgentes en tête ; tout à 0 : « Rien à traiter »
}
function bureauCard() {
  const rows = FONCTIONS.filter((f) => f !== 'Membre du bureau').map((f) => ({ f, hs: holderOf(f) }));
  const held = rows.filter((x) => x.hs.length), empty = rows.filter((x) => !x.hs.length && !/adjoint$/.test(x.f) && x.f !== 'Responsable sponsoring');
  const pid = presId();
  const li = [`<div class="row static"><span class="g">${esc(pid ? name(pid) : '—')}<small>Président</small></span></div>`]
    .concat(held.map(({ f, hs }) => `<button class="row" data-act="fview" data-v="${esc(f)}"><span class="g">${esc(hs.map(name).join(', '))}<small>${esc(fl(f))}</small></span><span class="chev"></span></button>`))
    .concat(empty.length ? [`<button class="row" data-act="ptab" data-v="bureau"><span class="g"><span class="nobody">Sans titulaire · c’est toi en attendant</span><small>${esc(empty.map((x) => fl(x.f)).join(' · '))}</small></span><span class="pill wait">Désigner</span></button>`] : []);
  return `<section class="card"><div class="kh"><h3>Le bureau</h3>${klink('Toutes les fonctions', 'ptab', 'data-v="bureau"')}</div><div class="list">${li.join('')}</div></section>`;
}
const WEEK_TYPES = ['Match', 'Plateau', 'Tournoi', 'Événement', 'AG', 'Réunion'];
function weekCard() {
  const now = Date.now(), end = now + 7 * DAY;
  const l = S.events.filter((e) => !e.cancelled && WEEK_TYPES.includes(e.type) && new Date(e.starts_at) >= now - 3 * 3600e3 && new Date(e.starts_at) < end).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 6);
  const slots = (e) => (S.missions || []).filter((m) => m.event_id === e.id).reduce((a, m) => a + (+m.slots || 0), 0);
  const rows = l.map((e) => { const tot = slots(e), miss = tot ? missing(e.id) : 0; return `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(fmtShort(e.starts_at))}${e.place ? ' · ' + esc(e.place) : ''}</small></span>${tot ? tag(`Bénévoles ${tot - miss} sur ${tot}`, miss ? 'wait' : 'ok') : '<span class="chev"></span>'}</button>`; });
  return `<section class="card"><div class="kh"><h3>Cette semaine au club</h3>${klink('Agenda', 'tab', 'data-i="1"')}</div>${rows.length ? `<div class="list">${rows.join('')}</div>` : '<p class="empty">Aucun match ni événement dans les 7 prochains jours.</p>'}</section>`;
}
function actionsCard() {
  const l = lastActions();
  const body = l === null ? '<p class="empty">Chargement…</p>' : !l.length ? '<p class="empty">Aucune action pour l’instant.</p>' : `<div class="list">${l.map((x) => `<div class="row static"><span class="g">${esc(x.action)}${x.target ? ' · ' + esc(x.target) : ''}<small>${esc(new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))} · par ${esc(x.actor)}</small></span></div>`).join('')}</div>`;
  return `<section class="card"><div class="kh"><h3>Dernières actions</h3>${klink('Journal', 'ptab', 'data-v="journal"')}</div>${body}</section>`;
}
// Vue d'ensemble : carte d'identité, À traiter, chiffres, bureau, semaine, actions ; puis le suivi d'avant (ajout, heures, résultats…)
hooks.presVue = (more = '') => `<div class="dash" data-pro="1">${identityCard()}
<div class="dsec"><div class="kick">À traiter</div>${presTodo()}</div>
<div class="dsec"><div class="kick">Les chiffres du club</div><div class="kgrid">${playersCard(klink('Voir', 'fview', 'data-v="Secrétaire" data-tab="licences"'))}${feeCard(klink('Trésorerie', 'fview', 'data-v="Trésorier" data-tab="cotis"'))}${licCard(klink('Secrétariat', 'fview', 'data-v="Secrétaire" data-tab="licences"'))}${presenceCard(klink('Équipes', 'ptab', 'data-v="equipes"'))}</div></div>
<div class="dgrid">${bureauCard()}${weekCard()}</div>
<div class="dgrid one">${actionsCard()}</div>
${more ? `<div class="dsec"><div class="kick">Suivi du club</div>${more}</div>` : ''}</div>`;

// Bureau : une carte par fonction (ouvre sa page, la même que celle de la personne), puis les responsabilités et « Fonctions du bureau »
hooks.presBureau = (qui = '') => {
  const rows = FONCTIONS.filter((f) => f !== 'Membre du bureau').map((f) => ({ f, hs: holderOf(f) })).filter((x) => x.hs.length || !/adjoint$/.test(x.f));
  const key3 = ['Vice-président', 'Secrétaire', 'Trésorier']; // comptées dans « Fonctions sans titulaire »
  const card = ({ f, hs }) => `<button class="fcard ${hs.length ? '' : key3.includes(f) ? 'none' : 'none soft'}" data-act="fview" data-v="${esc(f)}"><span class="kick">${esc(fl(f))}</span><b>${hs.length ? esc(hs.map(name).join(', ')) : 'Personne'}</b><span class="det">${hs.length ? 'Ouvrir sa page' : 'C’est toi en attendant · Désigner'}</span></button>`;
  return `<div class="dash" data-pro="1"><div class="bhead"><p class="note">Chaque fonction a sa page : tu vois exactement ce que voit la personne qui la tient, sauf ce que tu lui masques dans Réglages › Droits. Ce que tu y fais est inscrit au journal à ton nom.</p><button class="btn main small" data-act="fonctions">${icon('user', 18)}Nommer, retirer, accès en plus</button></div><div class="fgrid">${rows.map(card).join('')}</div><details class="card" data-qui="1"><summary>Qui s’occupe de quoi sans titulaire</summary>${qui}</details></div>`;
};

// Équipes : filtres, tableau (ordinateur) ou liste (téléphone, tablette), puis créer, importer et doublons
hooks.presEquipes = (tools = '', add = '') => {
  const all = live(), flt = TFLT[S.tflt], l = flt ? all.filter(flt[1]) : all, pres = Object.fromEntries(presenceByTeam().map((x) => [x.t.id, x]));
  const chip = (v, lab, n) => `<button class="chip" data-act="tflt" data-v="${v}" aria-pressed="${(S.tflt || '') === v}">${esc(lab)} · ${n}</button>`;
  const head = `<div class="chips">${chip('', 'Toutes', all.length)}${chip('nocoach', 'Sans coach', all.filter(TFLT.nocoach[1]).length)}${chip('ghost', 'Mode fantôme', all.filter(TFLT.ghost[1]).length)}</div>`;
  const stat = (t) => (t.state === 'Fantôme' ? tag('Mode fantôme', '') : !coachIdsOf(t.id).length ? tag('Sans coach', 'wait') : tag('Active', 'ok'));
  const fee = (t) => { const r = ownPlayers().filter((p) => p.team_id === t.id).map((p) => S.padmin.find((a) => a.player_id === p.id)).filter((a) => a && !a.nofee && a.fee_amount != null); return r.length ? pct(r.filter((a) => (+a.fee_paid || 0) >= +a.fee_amount).length, r.length) + ' %' : '—'; };
  const lic = (t) => { const r = ownPlayers().filter((p) => p.team_id === t.id); return r.filter((p) => S.padmin.find((a) => a.player_id === p.id)?.licence_state === 'Licencié').length + ' / ' + r.length; };
  const nb = (t) => ownPlayers().filter((p) => p.team_id === t.id).length;
  const sorted = [...l].sort((a, b) => String(a.category).localeCompare(String(b.category), 'fr', { numeric: true }) || a.name.localeCompare(b.name, 'fr'));
  const bar = (t) => { const p = pres[t.id]; return p?.pct == null ? '<span class="det">—</span>' : `<span class="mbar"><span style="width:${p.pct}%"></span></span><b>${p.pct} %</b>`; };
  const table = sorted.length ? `<div class="gtab card"><table class="ptable"><thead><tr><th scope="col">Équipe</th><th scope="col">Catégorie</th><th scope="col">Coachs</th><th scope="col" class="r">Joueurs</th><th scope="col">Présence · 4 semaines</th><th scope="col" class="r">Cotisations à jour</th><th scope="col" class="r">Licences</th><th scope="col">Statut</th></tr></thead><tbody>${sorted.map((t) => `<tr><td><button class="tlink" data-act="tsopen" data-id="${t.id}">${esc(t.name)}</button></td><td>${esc(t.category || '')}</td><td>${coachIdsOf(t.id).length ? esc(coachIdsOf(t.id).map(name).join(', ')) : '<span class="nobody">Aucun coach</span>'}</td><td class="r">${nb(t)}</td><td class="pres">${bar(t)}</td><td class="r">${fee(t)}</td><td class="r">${lic(t)}</td><td>${stat(t)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const list = `<div class="card notpc"><div class="list">${sorted.map((t) => `<button class="row" data-act="tsopen" data-id="${t.id}"><span class="g">${esc(t.name)}<small>${esc([t.category !== t.name ? t.category : '', coachIdsOf(t.id).length ? coachIdsOf(t.id).map(name).join(', ') : 'sans coach', plural(nb(t), 'joueur')].filter(Boolean).join(' · '))}</small></span>${t.state === 'Fantôme' ? tag('fantôme', '') : ''}<span class="chev"></span></button>`).join('')}</div></div>`;
  const body = sorted.length ? table + list : `<p class="empty">${flt ? 'Aucune équipe dans ce cas.' : 'Aucune équipe pour l’instant.'}</p>`;
  const stats = canAllStats() ? `<button class="btn small" data-act="cstats" style="align-self:flex-start">${icon('team', 18)}Statistiques des équipes</button>` : ''; // n° 286
  return `<div class="dash" data-pro="1"><div class="eqhead"><div class="det">${plural(all.length, 'équipe')} · ${plural(ownPlayers().length, 'joueur')} · ${plural(new Set(S.members.filter((m) => m.role === 'coach' && m.status === 'active').map((m) => m.user_id)).size, 'coach', 'coachs')}</div>${head}${stats}</div>${body}<div class="dsec" id="eqtools"><div class="kick">Créer, importer, doublons</div>${tools}${add}</div></div>`;
};

// Réglages › Club : fiche du club (fédération, numéro d'affiliation) ; président et vice-président (vérifié par la base)
hooks.clubIdForm = () => {
  if (!(isPresident() || isVP())) return '';
  const c = club() || {};
  return `<form id="clubidf" class="card" data-clubid="1"><b>Fiche du club</b><p class="note" style="margin:0">Affichées sur la carte d’identité du club (Vue d’ensemble), pour les membres.</p><div class="grid2"><div class="field"><label for="cfed">Fédération</label><input id="cfed" name="federation" maxlength="40" placeholder="FFBB, FFVolley, UFOLEP…" value="${esc(c.federation || '')}"></div><div class="field"><label for="caff">N° d’affiliation</label><input id="caff" name="affiliation" maxlength="30" value="${esc(c.affiliation || '')}"></div></div><button class="btn main small" type="submit">Enregistrer la fiche</button></form>`;
};
Object.assign(FORMS, {
  clubidf: async (v) => {
    const row = { federation: String(v.federation || '').trim().slice(0, 40), affiliation: String(v.affiliation || '').trim().slice(0, 30) };
    if (await run(sb.from('clubs').update(row).eq('id', S.clubId), 'Fiche du club enregistrée.')) { Object.assign(club(), row); render(true); }
  },
});

const SHORT = { 'Chargé de communication': 'Communication', 'Responsable événements': 'Événements', 'Responsable sponsoring': 'Sponsoring' };
// ---------- bandeau de gauche (tablette et ordinateur) : sous-entrées de Bureau et Équipes ----------
// sub : le groupe des sous-onglets du rôle Président (js/v515.js) ; Bureau déplie ses fonctions, Équipes ses deux entrées
hooks.presSubs = (sub) => {
  const inF = S.view?.type === 'fview', curF = inF ? S.view.f : null, tab = inF ? 'bureau' : S.ptab || 'ensemble';
  sub.querySelectorAll('[data-act=ptab]').forEach((b) => { if (b.dataset.v === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const add = (v, items) => {
    const par = sub.querySelector(`[data-act=ptab][data-v="${v}"]`); if (!par) return;
    par.classList.add('fold'); par.setAttribute('aria-expanded', String(tab === v));
    if (tab !== v) return;
    const d = document.createElement('div'); d.className = 'rsub2'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', v === 'bureau' ? 'Fonctions du bureau' : 'Équipes');
    d.innerHTML = items.join('');
    if (d.querySelector('[aria-current=page]')) par.removeAttribute('aria-current');
    par.after(d);
  };
  const rows = FONCTIONS.filter((f) => f !== 'Membre du bureau').filter((f) => holderOf(f).length || !/adjoint$/.test(f));
  add('bureau', rows.map((f) => `<button data-act="fview" data-v="${esc(f)}" ${curF === f ? 'aria-current="page"' : ''}>${esc(SHORT[f] || fl(f))}</button>`));
  add('equipes', [`<button data-act="ptab" data-v="equipes" data-eq="liste" ${S.eqsub !== 'outils' ? 'aria-current="page"' : ''}>Toutes</button>`, `<button data-act="eqtools" ${S.eqsub === 'outils' ? 'aria-current="page"' : ''}>Créer et importer</button>`]);
};
Object.assign(ACTIONS, {
  idgo: (el, d) => {
    S.ptab = 'reglages'; S.casq = 'president'; S.view = { type: 'espace' }; render();
    setTimeout(() => {
      const sel = d.v === 'custom_header' ? 'label.switch:has(input[name=perso])' : 'label.switch:has([data-clubset=public_listed])';
      const t = document.querySelector(sel); if (!t) return;
      const det = t.closest('details'); if (det) det.open = true;
      t.classList.add('todo-hl'); t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  },
  pclubedit: () => { S.ptab = 'reglages'; S.casq = 'president'; S.view = { type: 'espace' }; render(); setTimeout(() => { const f = document.querySelector('[data-clubid]'); f?.scrollIntoView({ block: 'start', behavior: 'smooth' }); f?.querySelector('input')?.focus({ preventScroll: true }); }, 60); },
  eqtools: () => { S.ptab = 'equipes'; S.eqsub = 'outils'; S.casq = 'president'; if (S.view?.type !== 'espace') S.view = { type: 'espace' }; render(true); setTimeout(() => document.getElementById('eqtools')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); },
});
void toast; void refresh; void hasArea; void teamName;
