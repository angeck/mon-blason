// Pocket Club · espace coach (alpha 3.1) : banque d'exercices (Ma banque, Club, Libre, Ma séance), séances,
// statistiques de présence et de fiabilité, exports Excel et PDF, heures des coachs et relevé validé par le bureau.
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_1.sql) ; l'écran n'est qu'un confort.
import { BRAND } from '../config.js';
import {
  S, sb, esc, run, toast, render, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, club, isBoard, isCoach, coachTeams, coachOf,
  team, teamName, name, plural, download, norm, fmtShort, onColor, evTeams, store, loadNames,
} from './core.js';
import { icon, delBtn, field } from './ui.js';
import { loadXlsx } from './equipe.js';

export const CATS = ['Échauffement', 'Technique', 'Tactique', 'Physique', 'Jeu', 'Retour au calme'];
const SHARE = { me: 'Moi seul', club: 'Mon club', public: 'Tous les clubs' };
const ORIGINS = { perso: 'Ma création', adapte: "Adapté d'une source", ia: 'Préparé avec une IA' };
const KINDS_H = ['Entraînement', 'Match', 'Plateau', 'Tournoi', 'Réunion', 'Formation', 'Autre'];
export const fmtMin = (m) => { m = Math.round(+m || 0); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ' ' + String(r).padStart(2, '0') : ''}` : `${r} min`; };
const ymd = (d) => d.toLocaleDateString('sv-SE');
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthLabel = (d) => { const s = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const stamp = () => { const d = new Date(); return d.toLocaleDateString('sv-SE') + ' ' + String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0'); };
const cleanFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '');
const staffTeams = () => (isBoard() ? S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée').map((t) => t.id) : coachTeams().filter((t) => team(t)));
export const canCoachSpace = () => isBoard() || isCoach();

// ---------- chargement ----------
async function loadExos() {
  const [ex, vo, rp] = await Promise.all([
    sb.from('exercises').select('*').order('updated_at', { ascending: false }).limit(500),
    sb.from('exercise_votes').select('exercise_id,up').eq('user_id', S.me.id),
    isBoard() ? sb.from('exercise_reports').select('*').eq('handled', false) : Promise.resolve({ data: [] }),
  ]);
  S.exos = ex.data || []; S.myVotes = {}; (vo.data || []).forEach((v) => (S.myVotes[v.exercise_id] = v.up)); S.exReports = rp.data || [];
  const others = S.exos.filter((e) => e.created_by !== S.me.id).map((e) => e.id);
  S.exAuthors = {};
  if (others.length) { const a = await sb.rpc('exercise_authors', { p_ids: others }); (a.data || []).forEach((x) => (S.exAuthors[x.id] = x)); }
}
export async function loadEvPlans() { S.evPlans = canCoachSpace() ? ((await sb.from('training_plans').select('id,title,event_id,team_id,items,notes').not('event_id', 'is', null).is('deleted_at', null).limit(300)).data || []) : []; }
export async function ensureExos() { if (!S.exos) await loadExos(); }
export function planForEvent(e) { const t = evTeams(e).find((x) => coachOf(x)) || evTeams(e)[0] || ''; S.plan = { club: S.clubId, id: null, title: e.title + ' · ' + new Date(e.starts_at).toLocaleDateString('fr-FR'), team_id: t, event_id: e.id, notes: '', items: [] }; savePlanLocal(); }
async function loadPlans() { S.plans = (await sb.from('training_plans').select('*').is('deleted_at', null).order('updated_at', { ascending: false }).limit(200)).data || []; }
// Compteurs pour l'onglet Club (bureau) : relevés d'heures et exercices publics à valider
export async function loadCoachCounts() {
  S.coachCounts = { hours: 0, exos: 0 };
  if (!isBoard()) return;
  const [h, e] = await Promise.all([
    sb.from('coach_statements').select('id', { count: 'exact', head: true }).eq('club_id', S.clubId).eq('status', 'submitted').neq('user_id', S.me.id),
    sb.from('exercises').select('id', { count: 'exact', head: true }).eq('club_id', S.clubId).eq('public_state', 'pending').is('deleted_at', null),
  ]);
  S.coachCounts = { hours: h.count || 0, exos: e.count || 0 };
}
async function open(view, loader) { S.view = view; S.cload = true; render(); try { await loader(); } finally { S.cload = false; render(true); } }
const loading = () => (S.cload ? '<p class="empty">Chargement…</p>' : '');

// ---------- entrée « Espace coach » (onglet Équipe et onglet Club) ----------
export function coachEntry() {
  if (!canCoachSpace()) return '';
  return `<div class="card pale"><div class="kick">Espace coach</div><div class="grid2">
    <button class="btn small" data-act="cexos">${icon('doc', 18)}Exercices</button>
    <button class="btn small" data-act="cplan">${icon('cal', 18)}Ma séance</button>
    <button class="btn small" data-act="cstats">${icon('team', 18)}Statistiques</button>
    ${isCoach() ? `<button class="btn small" data-act="chours">${icon('check', 18)}Mes heures</button>` : `<button class="btn small" data-act="choursb">${icon('check', 18)}Heures des coachs</button>`}
  </div></div>`;
}
export function coachClubBlock() {
  if (!isBoard()) return '';
  const c = S.coachCounts || { hours: 0, exos: 0 };
  return `<div class="sec"><h2>Espace coach</h2></div><div class="card"><div class="list">
    <button class="row" data-act="choursb"><span class="g">Heures des coachs<small>Relevés mensuels envoyés par les coachs, à valider</small></span>${c.hours ? `<span class="pill wait">${c.hours} à valider</span>` : ''}</button>
    <button class="row" data-act="cexos" data-tab="club"><span class="g">Exercices du club<small>Partages publics à valider, avis négatifs, signalements</small></span>${c.exos ? `<span class="pill wait">${c.exos} à valider</span>` : ''}</button>
    <button class="row" data-act="cstats"><span class="g">Statistiques des équipes<small>Assiduité, retards, fiabilité des réponses</small></span></button>
  </div></div>`;
}

// ---------- schéma (terrain, joueurs, plots, flèches) ----------
const TOOLS = [['a', 'Attaquant'], ['d', 'Défenseur'], ['c', 'Plot'], ['b', 'Ballon'], ['p', 'Passe'], ['m', 'Déplacement']];
function courtLines(sport) {
  const L = 'stroke="#B9C2D6" stroke-width=".6" fill="none"';
  if (sport === 'Volley-ball') return `<rect x="4" y="4" width="92" height="62" ${L}/><line x1="50" y1="2" x2="50" y2="68" stroke="#0B2416" stroke-width="1.2"/><line x1="35" y1="4" x2="35" y2="66" ${L}/><line x1="65" y1="4" x2="65" y2="66" ${L}/>`;
  return `<rect x="4" y="4" width="92" height="62" ${L}/><rect x="38" y="4" width="24" height="24" ${L}/><circle cx="50" cy="28" r="7" ${L}/><path d="M12 4v12a38 38 0 0 0 76 0V4" ${L}/><circle cx="50" cy="9" r="1.6" stroke="#E2711D" stroke-width=".7" fill="none"/><line x1="46" y1="6.5" x2="54" y2="6.5" stroke="#0B2416" stroke-width=".8"/><path d="M38 66a12 12 0 0 1 24 0" ${L}/>`;
}
function itemSvg(it, i, all) {
  const n = all.slice(0, i + 1).filter((x) => x.k === it.k).length;
  switch (it.k) {
    case 'a': return `<circle cx="${it.x}" cy="${it.y}" r="3.2" fill="#2F5BFF"/><text x="${it.x}" y="${it.y + 1.3}" font-size="3.6" text-anchor="middle" fill="#FFFFFF" font-weight="700">${n}</text>`;
    case 'd': return `<path d="M${it.x - 2.6} ${it.y - 2.6}l5.2 5.2M${it.x + 2.6} ${it.y - 2.6}l-5.2 5.2" stroke="#D2263B" stroke-width="1.3"/>`;
    case 'c': return `<path d="M${it.x} ${it.y - 2.6}l2.4 4.4h-4.8z" fill="#FF8A00"/>`;
    case 'b': return `<circle cx="${it.x}" cy="${it.y}" r="1.8" fill="#E2711D" stroke="#0B2416" stroke-width=".4"/>`;
    case 'p': case 'm': return `<line x1="${it.x}" y1="${it.y}" x2="${it.x2}" y2="${it.y2}" stroke="#0B2416" stroke-width=".8" ${it.k === 'p' ? 'stroke-dasharray="2 1.4"' : ''} marker-end="url(#ah)"/>`;
    default: return '';
  }
}
export function courtSvg(sport, items, edit) {
  const pend = edit && S.dg?.from ? `<circle cx="${S.dg.from.x}" cy="${S.dg.from.y}" r="1.4" fill="#0B2416"/>` : '';
  return `<svg ${edit ? 'data-court="1"' : ''} viewBox="0 0 100 70" role="img" aria-label="Schéma de l'exercice" style="width:100%;background:#F7F4EC;border-radius:16px;${edit ? 'cursor:crosshair;touch-action:manipulation' : ''}"><defs><marker id="ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6z" fill="#0B2416"/></marker></defs>${courtLines(sport)}${(items || []).map(itemSvg).join('')}${pend}</svg>`;
}
function diagramEditor(f) {
  S.dg = S.dg || { tool: 'a', from: null };
  return `<div class="field"><span class="lab">Schéma (touche le terrain pour placer ; une flèche = deux touchers)</span><div class="chips">${TOOLS.map(([k, l]) => `<button type="button" class="chip" data-act="dgtool" data-v="${k}" aria-pressed="${S.dg.tool === k}">${l}</button>`).join('')}</div>
  ${courtSvg(f.sport, f.diagram, true)}<div class="btns"><button type="button" class="btn ghost small" data-act="dgundo" ${f.diagram.length ? '' : 'disabled'}>Annuler le dernier</button><button type="button" class="btn ghost small" data-act="dgclear" ${f.diagram.length ? '' : 'disabled'}>Tout effacer</button></div></div>`;
}
document.addEventListener('click', (e) => {
  const svg = e.target.closest && e.target.closest('svg[data-court]'); if (!svg || !S.exf) return;
  const r = svg.getBoundingClientRect(), x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y = Math.round(((e.clientY - r.top) / r.height) * 700) / 10;
  const d = S.exf.diagram, t = S.dg.tool;
  if (d.length >= 60) return toast('Schéma complet (60 éléments).');
  if (t === 'p' || t === 'm') { if (!S.dg.from) S.dg.from = { x, y }; else { d.push({ k: t, x: S.dg.from.x, y: S.dg.from.y, x2: x, y2: y }); S.dg.from = null; } } else d.push({ k: t, x, y });
  render(true);
});

// ---------- banque d'exercices ----------
const tooNegative = (e) => e.up_count + e.down_count >= 5 && e.down_count / (e.up_count + e.down_count) > 0.6;
function sharePill(e) {
  if (e.sharing === 'me') return '<span class="pill">Moi seul</span>';
  if (e.sharing === 'club') return '<span class="pill blue">Club</span>';
  return { pending: '<span class="pill wait">Public · en attente du bureau</span>', validated: '<span class="pill ok">Public</span>', refused: '<span class="pill ko">Public refusé</span>' }[e.public_state] || '';
}
function exCard(e) {
  const inPlan = (S.plan?.items || []).some((x) => x.exercise_id === e.id), a = S.exAuthors?.[e.id];
  const sub = [e.category, fmtMin(e.duration_min), e.sport === 'Tous les sports' ? 'Tous sports' : e.sport, e.level, a ? a.author + (a.club_name !== club()?.name ? ' · ' + a.club_name : '') : ''].filter(Boolean).join(' · ');
  return `<div class="ev"><button class="head" data-act="cexo" data-id="${e.id}"><span class="info"><span class="t">${esc(e.title)}</span><span class="s">${esc(sub)}</span><span class="chips" style="gap:6px;margin-top:4px">${sharePill(e)}${e.up_count || e.down_count ? `<span class="pill">👍 ${e.up_count} · 👎 ${e.down_count}</span>` : ''}${tooNegative(e) ? '<span class="pill ko">À revoir</span>' : ''}</span></span></button>
  <button class="btn small ${inPlan ? 'ghost' : 'main'}" data-act="cadd" data-id="${e.id}">${inPlan ? 'Dans ma séance ✓' : icon('plus', 18) + 'Ajouter à ma séance'}</button></div>`;
}
function filters(list) {
  const f = S.cf || (S.cf = { sport: '', cat: '', q: '' });
  const sp = club()?.sport;
  const out = list.filter((e) => (!f.sport || e.sport === f.sport || e.sport === 'Tous les sports') && (!f.cat || e.category === f.cat) && (!f.q || norm(e.title + ' ' + e.description).includes(norm(f.q))));
  const h = `<div class="field"><label for="cfq">Rechercher</label><input id="cfq" type="search" data-cfq="1" value="${esc(f.q)}" placeholder="Nom ou mot de la description"></div>
  <div class="chips">${[['', 'Tous les sports'], [sp, sp === 'Volley-ball' ? 'Volley' : 'Basket'], [sp === 'Volley-ball' ? 'Basket-ball' : 'Volley-ball', sp === 'Volley-ball' ? 'Basket' : 'Volley']].map(([v, l]) => `<button class="chip" data-act="cfsport" data-v="${v}" aria-pressed="${f.sport === v}">${l}</button>`).join('')}</div>
  <div class="chips">${['', ...CATS].map((c) => `<button class="chip" data-act="cfcat" data-v="${c}" aria-pressed="${f.cat === c}">${c || 'Toutes'}</button>`).join('')}</div>`;
  return [h, out];
}
function boardTodo() {
  if (!isBoard() || !S.exos) return '';
  const mine = S.exos.filter((e) => e.club_id === S.clubId && !e.deleted_at);
  const pend = mine.filter((e) => e.sharing === 'public' && e.public_state === 'pending'), neg = mine.filter(tooNegative), rep = S.exReports || [];
  if (!pend.length && !neg.length && !rep.length) return '';
  let h = '<div class="card warn"><b>À traiter par le bureau</b>';
  if (pend.length) h += `<p class="note" style="color:var(--pc-encre)">${plural(pend.length, 'exercice proposé à tous les clubs attend', 'exercices proposés à tous les clubs attendent')} ta validation.</p>`;
  if (neg.length) h += `<p class="note" style="color:var(--pc-encre)">${plural(neg.length, 'exercice « À revoir » (avis surtout négatifs)', 'exercices « À revoir » (avis surtout négatifs)')}.</p>`;
  if (rep.length) h += `<p class="note" style="color:var(--pc-encre)">${plural(rep.length, 'signalement à lire', 'signalements à lire')} : l'exercice est retiré des autres clubs jusqu'à ta décision.</p>`;
  h += `<div class="list">${[...new Set([...pend, ...neg, ...rep.map((r) => mine.find((e) => e.id === r.exercise_id)).filter(Boolean)])].map((e) => `<button class="row" data-act="cexo" data-id="${e.id}"><span class="g">${esc(e.title)}<small>${esc(name(e.created_by))}</small></span>${sharePill(e)}</button>`).join('')}</div></div>`;
  return h;
}
export function exosPage() {
  const tab = S.ctab || 'mine';
  let h = `<div class="chips">${[['mine', 'Ma banque'], ['club', 'Club'], ['libre', 'Libre'], ['seance', `Ma séance${S.plan?.items?.length ? ' (' + S.plan.items.length + ')' : ''}`]].map(([k, l]) => `<button class="chip" data-act="ctab" data-v="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>`;
  if (tab === 'seance') return h + planEditor();
  if (!S.exos) return h + loading();
  h += `<button class="btn main" data-act="cexnew">${icon('plus', 20)}Nouvel exercice</button>`;
  let list = S.exos.filter((e) => !e.deleted_at);
  if (tab === 'mine') list = list.filter((e) => e.created_by === S.me.id);
  else if (tab === 'club') { h += boardTodo(); list = list.filter((e) => e.club_id === S.clubId && e.sharing !== 'me'); }
  else list = list.filter((e) => e.sharing === 'public' && e.public_state === 'validated');
  const [fh, out] = filters(list);
  h += fh + (out.length ? out.map(exCard).join('') : `<p class="empty">${tab === 'mine' ? 'Ta banque est vide : ajoute ton premier exercice.' : tab === 'club' ? 'Aucun exercice partagé au club pour l’instant.' : 'Aucun exercice public validé pour l’instant.'}</p>`);
  if (tab === 'libre') h += '<p class="note">Banque libre : exercices proposés par des coachs de tous les clubs, chacun validé par le bureau de son club. Un exercice signalé est retiré jusqu’à une nouvelle validation.</p>';
  if (tab === 'mine') {
    const del = S.exos.filter((e) => e.deleted_at && e.created_by === S.me.id);
    if (del.length) h += `<details class="card"><summary>Corbeille (${del.length})</summary><div class="list">${del.map((e) => `<div class="row static"><span class="g">${esc(e.title)}<small>Effacé définitivement 30 jours après la suppression</small></span><button class="btn small ghost" style="flex:none" data-act="cexrest" data-id="${e.id}">Restaurer</button></div>`).join('')}</div></details>`;
  }
  return h;
}
export function exoPage(id) {
  const e = (S.exos || []).find((x) => x.id === id); if (!e) return loading() || '<p class="empty">Exercice introuvable (supprimé ?).</p>';
  const mine = e.created_by === S.me.id, a = S.exAuthors?.[e.id], my = S.myVotes?.[e.id];
  let h = `<div class="card lift"><div class="chips">${sharePill(e)}<span class="pill blue">${esc(e.category)}</span><span class="pill">${fmtMin(e.duration_min)}</span>${e.level ? `<span class="pill">${esc(e.level)}</span>` : ''}${tooNegative(e) ? '<span class="pill ko">À revoir</span>' : ''}</div>
  ${e.diagram?.length ? courtSvg(e.sport === 'Tous les sports' ? club()?.sport : e.sport, e.diagram, false) : ''}
  ${e.description ? `<div style="white-space:pre-wrap">${esc(e.description)}</div>` : '<p class="note">Pas de description.</p>'}
  <p class="note">${esc(ORIGINS[e.origin])}${e.source ? ' · Source : ' + esc(e.source) : ''}${mine ? ' · par toi' : a ? ' · par ' + esc(a.author) + ' (' + esc(a.club_name) + ')' : ''}</p></div>`;
  const inPlan = (S.plan?.items || []).some((x) => x.exercise_id === e.id);
  h += `<button class="btn ${inPlan ? 'ghost' : 'main'}" data-act="cadd" data-id="${e.id}">${inPlan ? 'Déjà dans ma séance ✓' : icon('plus', 20) + 'Ajouter à ma séance'}</button>`;
  if (!mine) h += `<div class="card"><div class="kick">Ton avis</div><div class="pair"><button class="btn yes" data-act="cvote" data-id="${e.id}" data-v="1" aria-pressed="${my === true}">👍 Utile (${e.up_count})</button><button class="btn no" data-act="cvote" data-id="${e.id}" data-v="0" aria-pressed="${my === false}">👎 À revoir (${e.down_count})</button></div></div>`;
  if (isBoard() && e.club_id === S.clubId && e.sharing === 'public' && e.public_state !== 'validated') {
    h += `<div class="card warn"><b>Partage à tous les clubs : décision du bureau</b><p class="note" style="color:var(--pc-encre)">Vérifie que le texte et le schéma ne sont pas copiés d'un livre, d'un site ou d'une vidéo, et que la source est citée.</p><div class="btns"><button class="btn main small" data-act="cexval" data-id="${e.id}" data-v="1">Valider</button><button class="btn ghost small" data-act="cexval" data-id="${e.id}" data-v="0">Refuser</button></div></div>`;
  }
  const reps = (S.exReports || []).filter((r) => r.exercise_id === e.id);
  if (reps.length) h += `<div class="card warn"><b>Signalements</b>${reps.map((r) => `<p class="note" style="color:var(--pc-encre)">« ${esc(r.reason)} »</p>`).join('')}</div>`;
  if (mine) h += `<button class="btn ghost" data-act="cexedit" data-id="${e.id}">Modifier</button>`;
  else h += S.exRep === e.id
    ? `<form id="exrepf" class="card"><div class="field"><label for="exr">Pourquoi signales-tu cet exercice ?</label><input id="exr" name="reason" required minlength="3" maxlength="500" placeholder="Ex. copié d'un livre, contenu inadapté"></div><button class="btn main small" type="submit">Envoyer le signalement</button></form>`
    : `<button class="btn ghost" data-act="cexrep" data-id="${e.id}">Signaler</button>`;
  if (mine || (isBoard() && e.club_id === S.clubId && e.sharing !== 'me')) h += delBtn('cexdel', e.id, 'Supprimer cet exercice', 'Confirmer la suppression', isArmed('ex' + e.id));
  return h;
}

// ---------- formulaire d'exercice ----------
const AI_PROMPT = (sp) => `Propose un exercice de ${sp === 'Volley-ball' ? 'volley' : 'basket'} pour [catégorie, ex. U11] sur [thème, ex. la passe]. Écris-le avec tes propres mots, sans recopier de livre ni de site. Réponds exactement ainsi :
Nom : …
Catégorie : Échauffement, Technique, Tactique, Physique, Jeu ou Retour au calme
Durée : … minutes
Niveau : …
Description : mise en place, déroulement, consignes, variantes.`;
function parseAi(txt) {
  const get = (re) => { const m = txt.match(re); return m ? m[1].trim() : ''; };
  const o = {}, nm = get(/^\s*(?:nom|titre)\s*:\s*(.+)$/im), cat = get(/^\s*cat[ée]gorie\s*:\s*(.+)$/im), du = get(/^\s*dur[ée]e\s*:\s*(\d+)/im), lv = get(/^\s*niveau\s*:\s*(.+)$/im);
  if (nm) o.title = nm.slice(0, 80);
  const c = CATS.find((x) => norm(cat).includes(norm(x))); if (c) o.category = c;
  if (du) o.duration_min = Math.min(120, Math.max(1, +du));
  if (lv) o.level = lv.slice(0, 40);
  const d = txt.match(/^\s*description\s*:\s*([\s\S]+)$/im); if (d) o.description = d[1].trim().slice(0, 4000);
  return o;
}
export function exoForm() {
  const f = S.exf, sp = club()?.sport || 'Basket-ball';
  const dup = !f.id && f.title && (S.exos || []).find((e) => !e.deleted_at && norm(e.title) === norm(f.title) && (e.sport === f.sport || e.sport === 'Tous les sports'));
  return `<form id="exf" class="card lift">
  ${f.id ? '' : `<details class="card flat"><summary><b>Préparer avec une IA</b></summary><p class="note">1. Copie la consigne et colle-la dans l'IA de ton choix. 2. Colle sa réponse dans « Description » puis touche « Remplir depuis la description ». Relis toujours : tu restes l'auteur.</p><div class="btns"><button type="button" class="btn small" data-act="cexai">Copier la consigne</button><button type="button" class="btn small ghost" data-act="cexparse">Remplir depuis la description</button></div></details>`}
  ${field('exn', 'Nom', `<input id="exn" name="title" required minlength="2" maxlength="80" value="${esc(f.title || '')}" placeholder="Ex. Passe et va en deux colonnes">`)}
  ${dup ? `<div class="card warn"><b>Un exercice « ${esc(dup.title)} » existe déjà.</b><span class="note" style="color:var(--pc-encre)">Vérifie que ce n'est pas un doublon avant d'enregistrer.</span></div>` : ''}
  <div class="grid2">${field('exs', 'Sport', `<select id="exs" name="sport" data-exre="1">${[sp, sp === 'Volley-ball' ? 'Basket-ball' : 'Volley-ball', 'Tous les sports'].map((x) => `<option ${f.sport === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
  ${field('exc', 'Catégorie', `<select id="exc" name="category">${CATS.map((x) => `<option ${f.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
  ${field('exd', 'Durée (minutes)', `<input id="exd" name="duration_min" type="number" min="1" max="120" required value="${esc(f.duration_min || 10)}">`)}
  ${field('exl', 'Niveau (facultatif)', `<input id="exl" name="level" maxlength="40" value="${esc(f.level || '')}" placeholder="Ex. U9 à U13">`)}</div>
  ${field('exde', 'Description', `<textarea id="exde" name="description" maxlength="4000" rows="7" placeholder="Mise en place, déroulement, consignes, variantes">${esc(f.description || '')}</textarea>`)}
  ${diagramEditor(f)}
  <div class="field"><span class="lab">Origine</span><div class="chips">${Object.entries(ORIGINS).map(([k, l]) => `<label class="chip" style="display:flex;align-items:center;gap:6px"><input type="radio" name="origin" value="${k}" data-exre="1" ${f.origin === k ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
  ${f.origin === 'adapte' ? field('exso', 'Source (livre, site, formation, auteur)', `<input id="exso" name="source" required maxlength="300" value="${esc(f.source || '')}">`) : ''}
  <div class="field"><span class="lab">Partage</span><div class="chips">${Object.entries(SHARE).map(([k, l]) => `<label class="chip" style="display:flex;align-items:center;gap:6px"><input type="radio" name="sharing" value="${k}" data-exre="1" ${f.sharing === k ? 'checked' : ''}>${l}</label>`).join('')}</div>
  ${f.sharing === 'public' ? '<p class="note">Tous les clubs le verront après validation par le bureau de ton club. Toute modification du contenu repasse par cette validation.</p>' : ''}</div>
  ${f.sharing !== 'me' ? `<label class="check"><input type="checkbox" name="certified" ${f.certified ? 'checked' : ''} required><span>Je certifie avoir le droit de partager ce contenu : il est de moi, ou adapté avec mes mots en citant la source. Pas de copie de livre, de site ou de vidéo.</span></label>` : ''}
  <button class="btn main" type="submit">${f.id ? 'Enregistrer les changements' : "Enregistrer l'exercice"}</button></form>`;
}
function keepEx() { const fm = document.getElementById('exf'); if (!fm) return; const v = Object.fromEntries(new FormData(fm)); Object.assign(S.exf, v); S.exf.certified = !!v.certified; }

// ---------- séance ----------
function savePlanLocal() { try { store.set('pc_plan_' + S.clubId, JSON.stringify(S.plan)); } catch { /* */ } }
export function ensurePlan() {
  if (S.plan && S.plan.club === S.clubId) return S.plan;
  try { const p = JSON.parse(store.get('pc_plan_' + S.clubId) || 'null'); if (p && p.club === S.clubId) return (S.plan = p); } catch { /* */ }
  const t = staffTeams()[0] || '';
  return (S.plan = { club: S.clubId, id: null, title: 'Séance du ' + new Date().toLocaleDateString('fr-FR'), team_id: coachTeams()[0] || t, event_id: '', notes: '', items: [] });
}
const planTotal = (p) => p.items.reduce((a, x) => a + (+x.minutes || 0), 0);
function trainingsOf(tid) { return S.events.filter((e) => evTeams(e).includes(tid) && !e.cancelled && e.type === 'Entraînement' && new Date(e.starts_at) > Date.now() - 864e5).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 12); }
export function planEditor() {
  const p = ensurePlan(), tot = planTotal(p), teams = staffTeams();
  let h = `<form id="planf" class="card lift">
  ${field('pt', 'Nom de la séance', `<input id="pt" name="title" required maxlength="80" value="${esc(p.title)}">`)}
  <div class="grid2">${field('pte', 'Équipe', `<select id="pte" name="team_id" data-planre="1"><option value="">—</option>${teams.map((t) => `<option value="${t}" ${p.team_id === t ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select>`)}
  ${field('pev', 'Pour l’entraînement du', `<select id="pev" name="event_id"><option value="">Aucun pour l’instant</option>${trainingsOf(p.team_id).map((e) => `<option value="${e.id}" ${p.event_id === e.id ? 'selected' : ''}>${esc(fmtShort(e.starts_at))}</option>`).join('')}</select>`)}</div>
  <div class="sec"><h2>Exercices</h2><span class="det">${plural(p.items.length, 'exercice')} · ${fmtMin(tot)}</span></div>`;
  h += p.items.length ? `<div class="list">${p.items.map((x, i) => `<div class="row static" style="flex-wrap:wrap"><span class="g" style="flex:1 1 60%">${i + 1}. ${esc(x.title)}<small>${esc(x.category || '')}</small></span>
    <input type="number" min="1" max="120" value="${esc(x.minutes)}" data-pmin="${i}" aria-label="Durée de ${esc(x.title)} en minutes" style="width:76px;min-height:44px;border:2px solid var(--pc-trait);border-radius:12px;padding:4px 8px"> min
    <button type="button" class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="pmove" data-i="${i}" data-v="-1" aria-label="Monter" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="pmove" data-i="${i}" data-v="1" aria-label="Descendre" ${i < p.items.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="prm" data-i="${i}" aria-label="Retirer">${icon('trash', 18)}</button></div>`).join('')}</div>`
    : '<p class="empty">Ajoute des exercices depuis « Ma banque », « Club » ou « Libre ».</p>';
  h += `${field('pn', 'Notes (matériel, consignes)', `<textarea id="pn" name="notes" maxlength="2000" rows="3">${esc(p.notes)}</textarea>`)}
  <div class="btns"><button class="btn main" type="submit">${p.id ? 'Enregistrer la séance' : 'Enregistrer la séance'}</button>${p.items.length ? '<button type="button" class="btn ghost" data-act="pprint">Imprimer / PDF</button>' : ''}</div>
  <div class="btns"><button type="button" class="btn ghost small" data-act="pnew">Nouvelle séance vide</button><button type="button" class="btn ghost small" data-act="cplans">Mes séances enregistrées</button></div></form>`;
  return h;
}
function keepPlan() { const fm = document.getElementById('planf'); if (!fm) return; const v = Object.fromEntries(new FormData(fm)); Object.assign(S.plan, { title: v.title, team_id: v.team_id, event_id: v.event_id || '', notes: v.notes }); savePlanLocal(); }
export function plansPage() {
  if (!S.plans) return loading();
  if (!S.plans.length) return '<p class="empty">Aucune séance enregistrée.</p><button class="btn main" data-act="cplan">Composer une séance</button>';
  return `<div class="card"><div class="list">${S.plans.map((p) => { const e = S.events.find((x) => x.id === p.event_id); return `<div class="row static" style="flex-wrap:wrap"><button class="g" style="background:none;border:0;text-align:left;padding:0;flex:1" data-act="popen" data-id="${p.id}">${esc(p.title)}<small>${[teamName(p.team_id), e ? fmtShort(e.starts_at) : '', plural(p.items.length, 'exercice'), fmtMin(planTotal(p))].filter(Boolean).map(esc).join(' · ')}</small></button>${delBtn('pldel', p.id, 'Supprimer', 'Confirmer', isArmed('pl' + p.id), 'style="flex:none;min-height:44px"')}</div>`; }).join('')}</div></div>`;
}
export const plansForEvent = (eid) => (S.evPlans || []).filter((p) => p.event_id === eid);
function printHtml(title, body) {
  const w = window.open('', '_blank'); if (!w) { toast('Autorise les fenêtres pour imprimer ou enregistrer en PDF.'); return; }
  const c = club()?.color1 || '#2F5BFF';
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Figtree,Arial,sans-serif;color:#0B2416;margin:24px}h1{font-size:22px;margin:0 0 4px;color:${c}}p{margin:4px 0}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px}th{background:${c};color:${onColor(c)};text-align:left}th,td{border:1px solid #CCD3E0;padding:4px 6px}td.P{background:#C8F0D4}td.R{background:#FFE8A3}td.A{background:#FFC9C9}.ex{border:1px solid #CCD3E0;border-radius:10px;padding:10px;margin:10px 0;page-break-inside:avoid}.ex svg{max-width:360px}.foot{margin-top:16px;font-size:11px;color:#667}@page{margin:12mm}</style></head><body>${body}<p class="foot">${esc(BRAND.name)} · ${esc(club()?.name || '')} · imprimé le ${new Date().toLocaleDateString('fr-FR')}</p><script>setTimeout(function(){print()},300)<\/script></body></html>`);
  w.document.close();
}
function printPlan(p) {
  const e = S.events.find((x) => x.id === p.event_id);
  printHtml(p.title, `<h1>${esc(p.title)}</h1><p>${[teamName(p.team_id), e ? fmtShort(e.starts_at) : '', fmtMin(planTotal(p))].filter(Boolean).map(esc).join(' · ')}</p>${p.notes ? `<p><b>Notes :</b> ${esc(p.notes)}</p>` : ''}${p.items.map((x, i) => `<div class="ex"><b>${i + 1}. ${esc(x.title)}</b> · ${esc(x.category || '')} · ${fmtMin(x.minutes)}${x.diagram?.length ? courtSvg(x.sport === 'Tous les sports' ? club()?.sport : x.sport, x.diagram, false) : ''}<p style="white-space:pre-wrap">${esc(x.description || '')}</p></div>`).join('')}`);
}

// ---------- statistiques ----------
function periodOf(k) {
  const now = new Date(), to = ymd(now);
  if (k === 'mois') return [ymd(monthStart(now)), to];
  if (k === '3mois') return [ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to];
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; return [`${y}-08-15`, to];
}
async function loadStats() {
  const st = S.st; if (!st?.team) return;
  const [f, t] = periodOf(st.period);
  const [a, b] = await Promise.all([sb.rpc('team_stats', { p_team: st.team, p_from: f, p_to: t }), sb.rpc('team_attendance', { p_team: st.team, p_from: f, p_to: t })]);
  if (a.error) { toast(a.error.message); st.rows = []; st.detail = []; return; }
  st.rows = a.data || []; st.detail = b.data || [];
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) + ' %' : '—');
export function statsPage() {
  const teams = staffTeams(); S.st = S.st || { team: teams[0] || '', period: 'saison' };
  const st = S.st;
  if (!teams.length) return '<p class="empty">Aucune équipe à suivre.</p>';
  let h = `<div class="chips">${teams.map((t) => `<button class="chip" data-act="stteam" data-id="${t}" aria-pressed="${st.team === t}">${esc(teamName(t))}</button>`).join('')}</div>
  <div class="chips">${[['mois', 'Ce mois'], ['3mois', '3 derniers mois'], ['saison', 'Saison']].map(([k, l]) => `<button class="chip" data-act="stper" data-v="${k}" aria-pressed="${st.period === k}">${l}</button>`).join('')}</div>`;
  if (S.cload || !st.rows) return h + '<p class="empty">Chargement…</p>';
  const sessions = new Set(st.detail.map((d) => d.event_id)).size;
  if (!sessions) return h + '<div class="card"><p class="empty">Aucune séance pointée sur cette période.</p><p class="note">Seules les séances dont l’appel est fait comptent. Fais l’appel depuis le rendez-vous.</p></div>';
  const tot = st.rows.reduce((o, r) => ({ s: o.s + r.sessions, p: o.p + r.present + r.late, l: o.l + r.late, ya: o.ya + r.yes_absent, an: o.an + r.answered }), { s: 0, p: 0, l: 0, ya: 0, an: 0 });
  h += `<div class="grid2"><div class="card lift"><span class="big">${pct(tot.p, tot.s)}</span><span class="det">assiduité · ${plural(sessions, 'séance pointée', 'séances pointées')}</span></div><div class="card lift"><span class="big">${pct(tot.an, tot.s)}</span><span class="det">réponses données avant la séance</span></div></div>`;
  h += `<div class="btns"><button class="btn" data-act="stxlsx">${icon('down', 20)}Excel</button><button class="btn ghost" data-act="stpdf">${icon('doc', 20)}PDF</button></div>`;
  h += `<div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Joueur</th><th>Présence</th><th>Retards</th><th>Absences</th><th>A répondu</th><th>Oui mais absent</th><th>Non mais venu</th></tr></thead><tbody>${st.rows.map((r) => `<tr><td><b>${esc(r.first_name)} ${esc(r.last_name)}</b></td><td>${pct(r.present + r.late, r.sessions)}</td><td>${r.late}</td><td>${r.absent}</td><td>${pct(r.answered, r.sessions)}</td><td>${r.yes_absent ? `<span class="pill ko">${r.yes_absent}</span>` : 0}</td><td>${r.no_present}</td></tr>`).join('')}</tbody></table></div>`;
  h += '<p class="note">Fiabilité : « Oui mais absent » = a répondu « Je viens » puis n’est pas venu. Un retard compte comme une présence. Une séance sans appel ne compte pas.</p>';
  return h;
}
const sheetName = (s, used) => { let b = cleanFile(s).replace(/[[\]]/g, '').slice(0, 28) || 'Joueur', n = b, i = 2; while (used.has(n)) n = b.slice(0, 25) + ' ' + i++; used.add(n); return n; };
const ST = { present: ['P', 'C8F0D4'], retard: ['R', 'FFE8A3'], absent: ['A', 'FFC9C9'] };
async function statsXlsx() {
  let X; try { X = await loadXlsx(); } catch { return toast('Export impossible pour l’instant. Réessaie.'); }
  const st = S.st, c = (club()?.color1 || '#2F5BFF').replace('#', '').toUpperCase(), on = onColor('#' + c).slice(1), head = { font: { bold: true, color: { rgb: on } }, fill: { fgColor: { rgb: c } } };
  const evs = [...new Map(st.detail.map((d) => [d.event_id, d])).values()].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const dd = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const rows = [[`${BRAND.name} · ${club()?.name || ''} · présences ${teamName(st.team)}`], [], ['Joueur', ...evs.map((e) => dd(e.starts_at) + (e.type !== 'Entraînement' ? ' ' + e.type : '')), 'Présent', 'Retard', 'Absent', 'Assiduité', 'A répondu', 'Oui mais absent']];
  st.rows.forEach((r) => rows.push([`${r.first_name} ${r.last_name}`, ...evs.map((e) => ST[(st.detail.find((d) => d.event_id === e.event_id && d.player_id === r.player_id) || {}).status]?.[0] || ''), r.present, r.late, r.absent, r.sessions ? Math.round((100 * (r.present + r.late)) / r.sessions) / 100 : '', r.sessions ? Math.round((100 * r.answered) / r.sessions) / 100 : '', r.yes_absent]));
  const ws = X.utils.aoa_to_sheet(rows), enc = X.utils.encode_cell;
  ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: c } } };
  rows[2].forEach((_, j) => { const k = enc({ r: 2, c: j }); if (ws[k]) ws[k].s = head; });
  st.rows.forEach((r, i) => evs.forEach((e, j) => { const k = enc({ r: 3 + i, c: 1 + j }), v = ws[k]?.v, m = Object.values(ST).find((x) => x[0] === v); if (m) ws[k].s = { fill: { fgColor: { rgb: m[1] } }, alignment: { horizontal: 'center' } }; }));
  st.rows.forEach((r, i) => [evs.length + 4, evs.length + 5].forEach((j) => { const k = enc({ r: 3 + i, c: j }); if (ws[k] && ws[k].v !== '') ws[k].z = '0%'; }));
  ws['!cols'] = [{ wch: 24 }, ...evs.map(() => ({ wch: 7 })), { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 11 }, { wch: 15 }];
  ws['!freeze'] = { xSplit: 1, ySplit: 3 };
  const wb = X.utils.book_new(), used = new Set(['Liste']); X.utils.book_append_sheet(wb, ws, 'Liste');
  st.rows.forEach((r) => {
    const lines = st.detail.filter((d) => d.player_id === r.player_id).map((d) => [new Date(d.starts_at).toLocaleDateString('fr-FR'), d.title, d.type, d.answer === 'oui' ? 'Je viens' : d.answer === 'non' ? 'Je ne viens pas' : 'Sans réponse', { present: 'Présent', retard: 'Retard', absent: 'Absent' }[d.status] || 'Non pointé']);
    const s2 = X.utils.aoa_to_sheet([[`${r.first_name} ${r.last_name} · ${teamName(st.team)}`], [], ['Date', 'Rendez-vous', 'Type', 'Réponse', 'Présence'], ...lines]);
    s2.A1.s = { font: { bold: true, sz: 13, color: { rgb: c } } }; ['A3', 'B3', 'C3', 'D3', 'E3'].forEach((k) => (s2[k].s = head));
    lines.forEach((l, i) => { const m = { Présent: ST.present, Retard: ST.retard, Absent: ST.absent }[l[4]]; if (m) s2['E' + (4 + i)].s = { fill: { fgColor: { rgb: m[1] } } }; });
    s2['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 13 }, { wch: 16 }, { wch: 12 }];
    X.utils.book_append_sheet(wb, s2, sheetName(`${r.first_name} ${r.last_name}`, used));
  });
  download(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Présences ${cleanFile(teamName(st.team))} · ${stamp()}.xlsx`);
  toast('Fichier Excel prêt : un onglet « Liste » et un onglet par joueur.');
}
function statsPdf() {
  const st = S.st, evs = [...new Map(st.detail.map((d) => [d.event_id, d])).values()].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const dd = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  printHtml('Présences ' + teamName(st.team), `<h1>Présences · ${esc(teamName(st.team))}</h1><p>${plural(evs.length, 'séance pointée', 'séances pointées')} · P présent, R retard, A absent</p><table><thead><tr><th>Joueur</th>${evs.map((e) => `<th>${dd(e.starts_at)}</th>`).join('')}<th>Assiduité</th><th>Oui mais absent</th></tr></thead><tbody>${st.rows.map((r) => `<tr><td>${esc(r.first_name)} ${esc(r.last_name)}</td>${evs.map((e) => { const s = ST[(st.detail.find((d) => d.event_id === e.event_id && d.player_id === r.player_id) || {}).status]; return `<td class="${s ? s[0] : ''}">${s ? s[0] : ''}</td>`; }).join('')}<td>${pct(r.present + r.late, r.sessions)}</td><td>${r.yes_absent}</td></tr>`).join('')}</tbody></table>`);
}

// ---------- heures des coachs ----------
async function loadHours() {
  const h = S.hr, m = monthStart(h.month), next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  let q = sb.from('coach_hours').select('*').eq('club_id', S.clubId).gte('day', ymd(m)).lt('day', ymd(next)).order('day');
  let q2 = sb.from('coach_statements').select('*').eq('club_id', S.clubId).eq('month', ymd(m));
  if (!h.board) { q = q.eq('user_id', S.me.id); q2 = q2.eq('user_id', S.me.id); }
  const [a, b] = await Promise.all([q, q2]);
  h.lines = a.data || []; h.stmts = b.data || [];
  await loadNames(h.lines.map((x) => x.user_id).concat(h.stmts.map((x) => x.user_id), h.stmts.map((x) => x.decided_by)));
}
const monthNav = (h) => `<div class="btns" style="align-items:center"><button class="btn ghost small" style="flex:none;width:52px;padding:0" data-act="hmonth" data-v="-1" aria-label="Mois précédent">‹</button><b style="flex:1;text-align:center;font-size:18px">${monthLabel(h.month)}</b><button class="btn ghost small" style="flex:none;width:52px;padding:0" data-act="hmonth" data-v="1" aria-label="Mois suivant" ${monthStart(h.month) >= monthStart(new Date()) ? 'disabled' : ''}>›</button></div>`;
const STATE = { submitted: '<span class="pill wait">Envoyé au bureau</span>', validated: '<span class="pill ok">Validé</span>', refused: '<span class="pill ko">Refusé</span>' };
function byTeam(lines) { const m = {}; lines.forEach((l) => { const k = l.team_id ? teamName(l.team_id) || 'Équipe supprimée' : 'Sans équipe'; m[k] = (m[k] || 0) + l.minutes; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
export function hoursPage() {
  const h = S.hr; if (!h.lines) return monthNav(h) + loading();
  const st = h.stmts[0], locked = st && st.status !== 'refused', tot = h.lines.reduce((a, l) => a + l.minutes, 0);
  let out = monthNav(h) + `<div class="card lift" style="flex-direction:row;align-items:center;justify-content:space-between"><span class="big">${fmtMin(tot)}</span><span>${st ? STATE[st.status] : '<span class="pill">Pas encore envoyé</span>'}</span></div>`;
  if (st?.status === 'refused' && st.comment) out += `<div class="card warn"><b>Refusé par ${esc(name(st.decided_by))}</b><span class="note" style="color:var(--pc-encre)">« ${esc(st.comment)} » · corrige puis renvoie.</span></div>`;
  if (st?.status === 'validated') out += `<p class="note">Validé par ${esc(name(st.decided_by))} le ${new Date(st.decided_at).toLocaleDateString('fr-FR')}.</p>`;
  const bt = byTeam(h.lines);
  if (bt.length > 1) out += `<div class="chips">${bt.map(([k, v]) => `<span class="pill blue">${esc(k)} : ${fmtMin(v)}</span>`).join('')}</div>`;
  out += `<div class="card"><div class="list">${h.lines.length ? h.lines.map((l) => `<div class="row static"><span class="g">${new Date(l.day + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${esc(l.kind)}<small>${[teamName(l.team_id), l.note].filter(Boolean).map(esc).join(' · ')}</small></span><b>${fmtMin(l.minutes)}</b>${locked ? '' : `<button class="btn ghost small" style="flex:none;width:48px;padding:0" data-act="hdel" data-id="${l.id}" aria-label="Retirer">${icon('trash', 18)}</button>`}</div>`).join('') : '<p class="empty">Aucune heure ce mois-ci.</p>'}</div></div>`;
  if (!locked) {
    out += `<button class="btn" data-act="hfill">${icon('refresh', 20)}Ajouter mes séances du mois</button><p class="note">Ajoute les entraînements (1 h 30), matchs (2 h), plateaux et tournois (4 h) passés de tes équipes. Ajuste ensuite si besoin.</p>`;
    const teams = coachTeams().filter((t) => team(t));
    out += `<form id="hf" class="card"><div class="kick">Ajouter une ligne</div><div class="grid2">${field('hd', 'Date', `<input id="hd" name="day" type="date" required value="${ymd(new Date() < new Date(monthStart(h.month).getFullYear(), monthStart(h.month).getMonth() + 1, 1) ? new Date() : new Date(monthStart(h.month).getFullYear(), monthStart(h.month).getMonth() + 1, 0))}" max="${ymd(new Date())}">`)}
    ${field('hk', 'Type', `<select id="hk" name="kind">${KINDS_H.map((k) => `<option>${k}</option>`).join('')}</select>`)}
    ${field('ht', 'Équipe', `<select id="ht" name="team_id"><option value="">Sans équipe</option>${teams.map((t) => `<option value="${t}">${esc(teamName(t))}</option>`).join('')}</select>`)}
    ${field('hm', 'Durée (minutes)', `<input id="hm" name="minutes" type="number" min="5" max="720" step="5" required value="90">`)}</div>
    ${field('hn', 'Note (facultatif)', `<input id="hn" name="note" maxlength="200" placeholder="Ex. réunion parents">`)}<button class="btn main small" type="submit">Ajouter</button></form>`;
    if (h.lines.length) out += `<button class="btn main ${isArmed('hsend') ? 'armed' : ''}" data-act="hsend">${isArmed('hsend') ? 'Confirmer l’envoi (' + fmtMin(tot) + ')' : 'Envoyer ' + monthLabel(h.month).toLowerCase() + ' au bureau'}</button><p class="note">Une fois envoyé, le mois ne se modifie plus, sauf si le bureau le refuse.</p>`;
  }
  if (h.lines.length) out += `<button class="btn ghost" data-act="hxlsx">${icon('down', 20)}Exporter en Excel</button>`;
  return out;
}
export function hoursBoardPage() {
  const h = S.hr; if (!h.lines) return monthNav(h) + loading();
  const coaches = [...new Set(h.lines.map((l) => l.user_id).concat(h.stmts.map((s) => s.user_id)))].sort((a, b) => name(a).localeCompare(name(b), 'fr'));
  let out = monthNav(h);
  if (!coaches.length) return out + '<p class="empty">Aucune heure notée ce mois-ci.</p>';
  out += coaches.map((u) => {
    const ls = h.lines.filter((l) => l.user_id === u), st = h.stmts.find((s) => s.user_id === u), tot = ls.reduce((a, l) => a + l.minutes, 0), opened = S.hOpen === u;
    let c = `<div class="card"><button class="row" data-act="hopen" data-id="${u}" style="border:0"><span class="g">${esc(name(u))}<small>${byTeam(ls).map(([k, v]) => `${esc(k)} ${fmtMin(v)}`).join(' · ') || '—'}</small></span><b>${fmtMin(st && st.status !== 'refused' ? st.total_minutes : tot)}</b></button><div class="chips">${st ? STATE[st.status] : '<span class="pill">Pas encore envoyé</span>'}</div>`;
    if (opened) c += `<div class="list">${ls.map((l) => `<div class="row static"><span class="g">${new Date(l.day + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${esc(l.kind)}<small>${[teamName(l.team_id), l.note].filter(Boolean).map(esc).join(' · ')}</small></span><b>${fmtMin(l.minutes)}</b></div>`).join('')}</div>`;
    if (st?.status === 'submitted' && u !== S.me.id) c += `<div class="field"><label for="hc${u}">Commentaire (obligatoire pour refuser)</label><input id="hc${u}" data-hcom="${u}" maxlength="300" value="${esc((S.hCom || {})[u] || '')}"></div><div class="btns"><button class="btn main small" data-act="hok" data-id="${st.id}" data-v="1">Valider</button><button class="btn ghost small" data-act="hok" data-id="${st.id}" data-u="${u}" data-v="0">Refuser</button></div>`;
    else if (st?.status === 'submitted') c += '<p class="note">Ton propre relevé est validé par un autre membre du bureau.</p>';
    if (st?.status === 'refused' && st.comment) c += `<p class="note">Refusé : « ${esc(st.comment)} »</p>`;
    return c + '</div>';
  }).join('');
  out += `<button class="btn" data-act="hxlsx">${icon('down', 20)}Exporter le mois en Excel</button><p class="note">Onglet « Résumé » (coach, équipe, heures, état) et un onglet par coach.</p>`;
  return out;
}
async function hoursXlsx() {
  let X; try { X = await loadXlsx(); } catch { return toast('Export impossible pour l’instant. Réessaie.'); }
  const h = S.hr, c = (club()?.color1 || '#2F5BFF').replace('#', '').toUpperCase(), head = { font: { bold: true, color: { rgb: onColor('#' + c).slice(1) } }, fill: { fgColor: { rgb: c } } };
  const coaches = [...new Set(h.lines.map((l) => l.user_id))].sort((a, b) => name(a).localeCompare(name(b), 'fr'));
  const sum = [[`${BRAND.name} · ${club()?.name || ''} · heures des coachs · ${monthLabel(h.month)}`], [], ['Coach', 'Équipe', 'Heures', 'Minutes', 'État du relevé']];
  coaches.forEach((u) => { const st = h.stmts.find((s) => s.user_id === u); byTeam(h.lines.filter((l) => l.user_id === u)).forEach(([k, v]) => sum.push([name(u), k, Math.round((v / 60) * 100) / 100, v, st ? { submitted: 'Envoyé', validated: 'Validé', refused: 'Refusé' }[st.status] : 'Pas envoyé'])); });
  const ws = X.utils.aoa_to_sheet(sum); ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: c } } }; ['A3', 'B3', 'C3', 'D3', 'E3'].forEach((k) => (ws[k].s = head));
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 9 }, { wch: 14 }];
  const wb = X.utils.book_new(), used = new Set(['Résumé']); X.utils.book_append_sheet(wb, ws, 'Résumé');
  coaches.forEach((u) => {
    const ls = h.lines.filter((l) => l.user_id === u);
    const s2 = X.utils.aoa_to_sheet([[`${name(u)} · ${monthLabel(h.month)}`], [], ['Date', 'Type', 'Équipe', 'Minutes', 'Note'], ...ls.map((l) => [new Date(l.day + 'T12:00').toLocaleDateString('fr-FR'), l.kind, teamName(l.team_id), l.minutes, l.note]), [], ['Total', '', '', ls.reduce((a, l) => a + l.minutes, 0), fmtMin(ls.reduce((a, l) => a + l.minutes, 0))]]);
    s2.A1.s = { font: { bold: true, sz: 13, color: { rgb: c } } }; ['A3', 'B3', 'C3', 'D3', 'E3'].forEach((k) => (s2[k].s = head));
    s2['!cols'] = [{ wch: 12 }, { wch: 13 }, { wch: 18 }, { wch: 9 }, { wch: 30 }];
    X.utils.book_append_sheet(wb, s2, sheetName(name(u), used));
  });
  download(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Heures des coachs ${cleanFile(club()?.name)} · ${ymd(monthStart(h.month)).slice(0, 7)} · ${stamp()}.xlsx`);
  toast('Fichier Excel prêt.');
}

// ---------- titres des écrans (lus par app.js) ----------
export const COACH_VIEWS = {
  exos: () => ['Espace coach', 'Exercices', exosPage],
  exo: (v) => ['Exercice', esc((S.exos || []).find((x) => x.id === v.id)?.title || 'Exercice'), () => exoPage(v.id)],
  exoform: () => ['Exercices', S.exf?.id ? 'Modifier l’exercice' : 'Nouvel exercice', exoForm],
  plans: () => ['Espace coach', 'Mes séances', plansPage],
  stats: () => ['Espace coach', 'Statistiques', statsPage],
  hours: () => ['Espace coach', 'Mes heures', hoursPage],
  hoursb: () => ['Bureau', 'Heures des coachs', hoursBoardPage],
};

// ---------- actions ----------
const exById = (id) => (S.exos || []).find((x) => x.id === id);
function addToPlan(e) {
  const p = ensurePlan();
  if (p.items.some((x) => x.exercise_id === e.id)) { p.items = p.items.filter((x) => x.exercise_id !== e.id); toast('Retiré de ta séance.'); }
  else { if (p.items.length >= 30) return toast('30 exercices au plus par séance.'); p.items.push({ exercise_id: e.id, title: e.title, category: e.category, minutes: e.duration_min, sport: e.sport, description: e.description, diagram: e.diagram }); toast(`Ajouté à ta séance (${plural(p.items.length, 'exercice')}, ${fmtMin(planTotal(p))}).`); }
  savePlanLocal(); render(true);
}
Object.assign(ACTIONS, {
  cexos: (el, d) => { if (d.tab) S.ctab = d.tab; else if (!S.ctab || S.ctab === 'seance') S.ctab = 'mine'; return open({ type: 'exos' }, loadExos); },
  ctab: async (el, d) => { if (d.v === 'seance') keepPlan(); S.ctab = d.v; render(true); if (!S.exos && d.v !== 'seance') { await loadExos(); render(true); } },
  cfsport: (el, d) => { S.cf.sport = d.v; render(true); },
  cfcat: (el, d) => { S.cf.cat = d.v; render(true); },
  cexo: (el, d) => { S.exRep = null; S.view = { type: 'exo', id: d.id }; render(); },
  cadd: (el, d) => { const e = exById(d.id); if (e) addToPlan(e); },
  cexnew: () => { S.exf = { sport: club()?.sport || 'Basket-ball', category: 'Technique', duration_min: 10, origin: 'perso', sharing: 'me', diagram: [], certified: false }; S.dg = { tool: 'a', from: null }; S.view = { type: 'exoform' }; render(); },
  cexedit: (el, d) => { const e = exById(d.id); S.exf = { ...e, diagram: (e.diagram || []).slice() }; S.dg = { tool: 'a', from: null }; S.view = { type: 'exoform', id: d.id }; render(); },
  dgtool: (el, d) => { keepEx(); S.dg = { tool: d.v, from: null }; render(true); },
  dgundo: () => { keepEx(); S.exf.diagram.pop(); S.dg.from = null; render(true); },
  dgclear: () => { keepEx(); S.exf.diagram = []; S.dg.from = null; render(true); },
  cexai: async () => { const t = AI_PROMPT(S.exf?.sport); try { await navigator.clipboard.writeText(t); toast('Consigne copiée : colle-la dans ton IA.'); } catch { keepEx(); S.exf.description = t; render(true); toast('Copie impossible : la consigne est dans « Description ».'); } },
  cexparse: () => { keepEx(); const o = parseAi(S.exf.description || ''); if (!Object.keys(o).length) return toast('Rien reconnu : la réponse doit contenir « Nom : », « Durée : », « Description : ».'); Object.assign(S.exf, o, { origin: 'ia' }); render(true); toast('Champs remplis. Relis avant d’enregistrer.'); },
  cvote: async (el, d) => {
    const up = d.v === '1', cur = S.myVotes[d.id];
    const q = cur === up ? sb.from('exercise_votes').delete().eq('exercise_id', d.id).eq('user_id', S.me.id) : sb.from('exercise_votes').upsert({ exercise_id: d.id, user_id: S.me.id, up, at: new Date().toISOString() });
    if (await run(q)) { await loadExos(); render(true); }
  },
  cexrep: (el, d) => { S.exRep = d.id; render(true); },
  cexval: async (el, d) => { if (await run(sb.rpc('validate_exercise', { p_id: d.id, p_ok: d.v === '1' }), d.v === '1' ? 'Exercice validé : visible de tous les clubs.' : 'Partage public refusé.')) { await loadExos(); await loadCoachCounts(); render(true); } },
  cexdel: async (el, d) => { if (!armed('ex' + d.id)) return; if (await run(sb.rpc('trash_exercise', { p_id: d.id }), 'Exercice supprimé (corbeille 30 jours).')) { await loadExos(); S.view = { type: 'exos' }; S.stack = (S.stack || []).filter((v) => v.type !== 'exo'); render(); } },
  cexrest: async (el, d) => { if (await run(sb.rpc('trash_exercise', { p_id: d.id, p_restore: true }), 'Exercice restauré.')) { await loadExos(); render(true); } },
  cplan: () => { ensurePlan(); S.ctab = 'seance'; return open({ type: 'exos' }, async () => { if (!S.exos) await loadExos(); }); },
  pmove: (el, d) => { keepPlan(); const p = S.plan, i = +d.i, j = i + +d.v; [p.items[i], p.items[j]] = [p.items[j], p.items[i]]; savePlanLocal(); render(true); },
  prm: (el, d) => { keepPlan(); S.plan.items.splice(+d.i, 1); savePlanLocal(); render(true); },
  pnew: () => { S.plan = null; try { localStorage.removeItem('pc_plan_' + S.clubId); } catch { /* */ } ensurePlan(); render(true); },
  pprint: () => { keepPlan(); printPlan(S.plan); },
  cplans: () => { keepPlan(); return open({ type: 'plans' }, loadPlans); },
  popen: (el, d) => { const p = S.plans.find((x) => x.id === d.id); S.plan = { club: S.clubId, id: p.id, title: p.title, team_id: p.team_id || '', event_id: p.event_id || '', notes: p.notes, items: p.items }; savePlanLocal(); S.ctab = 'seance'; S.view = { type: 'exos' }; render(); },
  pldel: async (el, d) => { if (!armed('pl' + d.id)) return; if (await run(sb.from('training_plans').delete().eq('id', d.id), 'Séance supprimée.')) { if (S.plan?.id === d.id) S.plan.id = null; await loadPlans(); render(true); } },
  pview: (el, d) => { const p = (S.evPlans || []).find((x) => x.id === d.id); if (p) printPlan(p); },
  cstats: () => { S.st = null; statsPage(); return open({ type: 'stats' }, loadStats); },
  stteam: (el, d) => { S.st.team = d.id; return open({ type: 'stats' }, loadStats); },
  stper: (el, d) => { S.st.period = d.v; return open({ type: 'stats' }, loadStats); },
  stxlsx: () => statsXlsx(),
  stpdf: () => statsPdf(),
  chours: () => { S.hr = { month: new Date(), board: false }; return open({ type: 'hours' }, loadHours); },
  choursb: () => { S.hr = { month: new Date(), board: true }; S.hOpen = null; return open({ type: 'hoursb' }, loadHours); },
  hmonth: (el, d) => { const m = monthStart(S.hr.month); S.hr.month = new Date(m.getFullYear(), m.getMonth() + +d.v, 1); S.hr.lines = null; return open(S.view, loadHours); },
  hfill: async () => { const n = await run(sb.rpc('fill_coach_hours', { p_club: S.clubId, p_month: ymd(monthStart(S.hr.month)) })); if (n !== null) { toast(n ? plural(n, 'séance ajoutée', 'séances ajoutées') + '.' : 'Rien à ajouter : tes séances passées sont déjà notées.'); await loadHours(); render(true); } },
  hdel: async (el, d) => { if (await run(sb.from('coach_hours').delete().eq('id', d.id), 'Ligne retirée.')) { await loadHours(); render(true); } },
  hsend: async () => { if (!armed('hsend')) return; if (await run(sb.rpc('submit_coach_month', { p_club: S.clubId, p_month: ymd(monthStart(S.hr.month)) }), 'Relevé envoyé au bureau.')) { await loadHours(); render(true); } },
  hopen: (el, d) => { S.hOpen = S.hOpen === d.id ? null : d.id; render(true); },
  hok: async (el, d) => {
    const ok = d.v === '1', com = ((S.hCom || {})[d.u] || '').trim();
    if (!ok && !com) return toast('Écris un commentaire pour expliquer le refus.');
    if (await run(sb.rpc('decide_coach_month', { p_statement: d.id, p_ok: ok, p_comment: com }), ok ? 'Relevé validé.' : 'Relevé refusé : le coach peut corriger et renvoyer.')) { await loadHours(); await loadCoachCounts(); render(true); }
  },
  hxlsx: () => hoursXlsx(),
});
FORMS.exf = async () => {
  keepEx(); const f = S.exf;
  const row = { title: (f.title || '').trim(), sport: f.sport, category: f.category, duration_min: +f.duration_min || 10, level: (f.level || '').trim(), description: (f.description || '').trim(), diagram: f.diagram, origin: f.origin, source: f.origin === 'adapte' ? (f.source || '').trim() : (f.source || '').trim(), sharing: f.sharing, certified: f.sharing !== 'me' && !!f.certified };
  if (f.sharing !== 'me' && !row.certified) return toast('Coche la case sur tes droits pour partager.');
  const r = f.id ? await run(sb.from('exercises').update(row).eq('id', f.id).select().single()) : await run(sb.from('exercises').insert({ ...row, club_id: S.clubId }).select().single());
  if (!r) return;
  toast(r.public_state === 'pending' ? 'Enregistré. Le bureau de ton club doit valider le partage à tous les clubs.' : 'Exercice enregistré.');
  S.exf = null; await loadExos(); S.stack = (S.stack || []).filter((v) => v.type !== 'exoform'); S.view = { type: 'exo', id: r.id }; render();
};
FORMS.exrepf = async (v) => { if (await run(sb.from('exercise_reports').insert({ exercise_id: S.exRep, user_id: S.me.id, reason: v.reason.trim() }), 'Signalement envoyé au bureau du club de l’auteur. Merci.')) { S.exRep = null; await loadExos(); render(true); } };
FORMS.planf = async () => {
  keepPlan(); const p = S.plan;
  if (!p.items.length) return toast('Ajoute au moins un exercice.');
  const row = { title: p.title.trim() || 'Séance', team_id: p.team_id || null, event_id: p.event_id || null, notes: p.notes || '', items: p.items.map((x) => ({ ...x, minutes: Math.min(120, Math.max(1, +x.minutes || 1)) })) };
  const r = p.id ? await run(sb.from('training_plans').update(row).eq('id', p.id).select().single()) : await run(sb.from('training_plans').insert({ ...row, club_id: S.clubId }).select().single());
  if (r) { p.id = r.id; savePlanLocal(); toast(r.event_id ? 'Séance enregistrée et reliée à l’entraînement.' : 'Séance enregistrée.'); S.evPlans = null; render(true); }
};
FORMS.hf = async (v) => {
  const row = { club_id: S.clubId, user_id: S.me.id, day: v.day, kind: v.kind, team_id: v.team_id || null, minutes: +v.minutes, note: (v.note || '').trim() };
  if (await run(sb.from('coach_hours').insert(row), 'Ligne ajoutée.')) { const d = new Date(v.day + 'T12:00'); if (monthStart(d).getTime() !== monthStart(S.hr.month).getTime()) S.hr.month = d; await loadHours(); render(true); }
};
INPUTS.push((t) => {
  if (t.form?.id === 'exf' && t.name && t.type !== 'radio' && t.type !== 'checkbox') { S.exf[t.name] = t.value; return true; }
  if (t.dataset.pmin) { S.plan.items[+t.dataset.pmin].minutes = t.value; savePlanLocal(); return true; }
  if (t.form?.id === 'planf' && t.name) { S.plan[t.name] = t.value; savePlanLocal(); return true; }
  if (t.dataset.cfq) { S.cf.q = t.value; const pos = t.selectionStart; render(true); const n = document.getElementById('cfq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } return true; }
  if (t.dataset.hcom) { S.hCom = S.hCom || {}; S.hCom[t.dataset.hcom] = t.value; return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.exre) { keepEx(); render(true); return true; }
  if (t.dataset.planre) { keepPlan(); S.plan.event_id = ''; savePlanLocal(); render(true); return true; }
  if (t.dataset.pmin) { render(true); return true; }
  return false;
});
export { coachOf };
