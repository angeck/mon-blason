// mypocketclub · alpha 5.10.0 · n° 161 : exercices avec l'IA (doc claude/05f, maquette https://claude.ai/artifact/N1DecmmeX3Gx3NSKcxkaY2).
// 1. Le coach décrit son exercice ; « Préparer le schéma avec l'IA » appelle la fonction Edge generer-exercice
//    (l'IA ne reçoit que le texte de l'exercice et les tags, jamais un nom).
// 2. Éditeur au doigt : étapes, joueurs à glisser, éléments à ajouter ou retirer, texte de chaque étape.
// 3. Aperçu animé : les éléments glissent d'une étape à l'autre ; les flèches montrent les déplacements (trait) et les passes (pointillés).
// Le schéma est rangé dans exercises.steps : { v, sport, items: [{ id, k, n }], frames: [{ c, p: { id: [x, y] } }] }, terrain de 360 × 500.
// L'ancien schéma fixe (exercises.diagram) reste affiché tel quel.
import { S, sb, esc, toast, render, hooks, ACTIONS, INPUTS, club, armed, isArmed } from './core.js';
import { icon } from './ui.js';
import { COACH_VIEWS, keepEx } from './coach.js';

const W = 360, H = 500, MAXI = 14, MAXF = 8;
const KIND = {
  a: { l: 'Joueur', fill: '#0E2B5C', tf: '#FFFFFF' }, d: { l: 'Défenseur', fill: '#E0522B', tf: '#FFFFFF' },
  l: { l: 'Libéro', fill: '#FFC93C', stroke: '#8A5A00', tf: '#11162E' }, e: { l: 'Coach', fill: '#11162E', tf: '#FFC93C' },
  c: { l: 'Plot' }, b: { l: 'Ballon' },
};
const sportOf = (f) => (f?.sport === 'Volley-ball' || (f?.sport === 'Tous les sports' && club()?.sport === 'Volley-ball') ? 'Volley-ball' : 'Basket-ball');
export const hasSteps = (st) => !!(st && Array.isArray(st.items) && st.items.length && Array.isArray(st.frames) && st.frames.length);
const clampXY = (x, y) => [Math.max(8, Math.min(W - 8, Math.round(x))), Math.max(8, Math.min(H - 8, Math.round(y)))];

// Remet en forme un schéma (venu de l'IA, de la base ou d'une ancienne version) : chaque élément a une position à chaque étape
export function normalize(st, sport) {
  if (!hasSteps(st)) return null;
  const items = [], seen = new Set();
  for (const it of st.items) { const id = String(it?.id || '').slice(0, 12); if (!id || seen.has(id) || !KIND[it.k]) continue; seen.add(id); items.push({ id, k: it.k, n: String(it.n || '').slice(0, 3) }); if (items.length >= MAXI) break; }
  let last = {};
  const frames = st.frames.slice(0, MAXF).map((f) => { const p = {}; for (const it of items) { const q = f?.p?.[it.id] || last[it.id]; if (q) p[it.id] = clampXY(q[0], q[1]); } last = p; return { c: String(f?.c || '').slice(0, 200), p }; });
  for (const it of items) { const first = frames.find((f) => f.p[it.id])?.p[it.id] || [W / 2, H / 2]; for (const f of frames) { if (f.p[it.id]) break; f.p[it.id] = first; } }
  return { v: 1, sport: st.sport || sport || 'Basket-ball', items, frames };
}

// ---------- dessin ----------
const LINE = 'fill="none" stroke="#9AA6C0" stroke-width="1.2"';
function court(sport) {
  if (sport === 'Volley-ball') return `<rect x="18" y="20" width="324" height="90" ${LINE}/><rect x="18" y="110" width="324" height="360" ${LINE}/><line x1="18" y1="230" x2="342" y2="230" stroke="#9AA6C0" stroke-width="1.2" stroke-dasharray="5 5"/><line x1="6" y1="110" x2="354" y2="110" stroke="#11162E" stroke-width="3.2"/>`;
  return `<rect x="14" y="10" width="332" height="470" ${LINE}/><rect x="135" y="10" width="90" height="140" ${LINE}/><path d="M135 150 A45 45 0 0 0 225 150" ${LINE}/><path d="M40 10 V70 A140 140 0 0 0 320 70 V10" ${LINE}/><line x1="160" y1="22" x2="200" y2="22" stroke="#11162E" stroke-width="2.4"/><circle cx="180" cy="36" r="11" fill="none" stroke="#E0522B" stroke-width="2.4"/>`;
}
const order = (items) => items.filter((x) => x.k === 'c').concat(items.filter((x) => x.k !== 'c' && x.k !== 'b'), items.filter((x) => x.k === 'b'));
function shape(it, edit) {
  const ring = edit ? '<circle class="stsel" r="19" fill="none" stroke="#FFC93C" stroke-width="3.5"/><circle r="24" fill="transparent"/>' : '';
  if (it.k === 'c') return `${ring}<path d="M0 -10l11 18h-22z" fill="#C47A1E"/>`;
  if (it.k === 'b') return `${ring}<circle r="7" fill="#F2A23A" stroke="#7A4A0E" stroke-width="1.2"/>`;
  const K = KIND[it.k];
  return `${ring}<circle r="13" fill="${K.fill}" stroke="${K.stroke || K.fill}" stroke-width="1"/><text y="4.5" text-anchor="middle" font-size="13" font-weight="700" fill="${K.tf}" font-family="DM Sans, sans-serif">${esc(it.n)}</text>`;
}
const tr = (q, anim) => `transform:translate(${q[0]}px,${q[1]}px)${anim ? ';transition:transform .8s ease' : ''}`;
// flèches de l'étape : déplacement d'un joueur (trait) ou passe du ballon (pointillés)
function arrows(st, i) {
  if (i < 1) return '';
  const A = st.frames[i - 1].p, B = st.frames[i].p;
  return st.items.map((it) => {
    const a = A[it.id], b = B[it.id]; if (!a || !b) return '';
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy); if (d < 20) return '';
    const s = it.k === 'b' ? 9 : 15;
    return `<line x1="${Math.round(a[0] + (dx / d) * s)}" y1="${Math.round(a[1] + (dy / d) * s)}" x2="${Math.round(b[0] - (dx / d) * (s + 2))}" y2="${Math.round(b[1] - (dy / d) * (s + 2))}" stroke="${it.k === 'b' ? '#11162E' : '#9AA6C0'}" stroke-width="2" ${it.k === 'b' ? 'stroke-dasharray="5 5" stroke-opacity=".6"' : ''} marker-end="url(#stah)"/>`;
  }).join('');
}
// tout le parcours (vue fixe : séance, impression, aperçu dans le formulaire)
function paths(st) {
  return st.items.map((it) => {
    const pts = st.frames.map((f) => f.p[it.id]).filter(Boolean).filter((q, j, l) => !j || Math.hypot(q[0] - l[j - 1][0], q[1] - l[j - 1][1]) >= 4);
    if (pts.length < 2) return '';
    return `<polyline points="${pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${it.k === 'b' ? '#11162E' : '#9AA6C0'}" stroke-width="2" ${it.k === 'b' ? 'stroke-dasharray="5 5" stroke-opacity=".6"' : ''} marker-end="url(#stah)"/>`;
  }).join('');
}
const DEFS = '<defs><marker id="stah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L9 5L1 9z" fill="#5A6280"/></marker></defs>';
export function stepsSvg(st, i = 0, o = {}) {
  const f = st.frames[Math.min(i, st.frames.length - 1)];
  const lbl = o.label || 'Schéma de l’exercice';
  return `<svg class="stsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lbl)}" ${o.edit ? 'data-sted="1"' : ''} style="${o.edit ? 'touch-action:none;' : ''}">${DEFS}${court(st.sport)}<g class="starr">${o.all ? paths(st) : arrows(st, i)}</g>${order(st.items).map((it) => `<g data-it="${esc(it.id)}" class="${o.edit && S.stEd?.sel === it.id ? 'on' : ''}" style="${tr(f.p[it.id] || [W / 2, H / 2], o.anim)}">${shape(it, o.edit)}</g>`).join('')}</svg>`;
}
// petit schéma fixe (séances, agenda, impression)
hooks.stepsMini = (x) => (hasSteps(x?.steps) ? stepsSvg(normalize(x.steps), 0, { all: true }) : '');

// ---------- lecteur animé (page de l'exercice, aperçu dans l'éditeur) ----------
const PLAYERS = {}, TIMERS = {};
let nP = 0;
export function player(st, key) {
  key = key || 'p' + ++nP; PLAYERS[key] = st;
  const n = st.frames.length;
  return `<div class="stp" data-stp="${key}" data-i="0">${stepsSvg(st, 0, { anim: true, label: 'Schéma animé de l’exercice, ' + n + ' étapes' })}
  <div class="stpbar"><button type="button" class="stbtn" data-act="stgo" data-k="${key}" data-d="-1" aria-label="Étape précédente">‹</button><button type="button" class="btn main small" data-act="stplay" data-k="${key}">Lecture</button><button type="button" class="stbtn" data-act="stgo" data-k="${key}" data-d="1" aria-label="Étape suivante">›</button><span class="stpn">Étape 1 sur ${n}</span></div>
  <p class="stpc" aria-live="polite">${esc(st.frames[0].c)}</p></div>`;
}
function setFrame(key, i) {
  const box = document.querySelector(`[data-stp="${key}"]`), st = PLAYERS[key]; if (!box || !st) return false;
  const n = st.frames.length; i = Math.max(0, Math.min(n - 1, i)); box.dataset.i = i;
  const f = st.frames[i];
  box.querySelectorAll('g[data-it]').forEach((g) => { const q = f.p[g.dataset.it]; if (q) g.style.transform = `translate(${q[0]}px,${q[1]}px)`; });
  box.querySelector('.starr').innerHTML = arrows(st, i);
  box.querySelector('.stpc').textContent = f.c; box.querySelector('.stpn').textContent = `Étape ${i + 1} sur ${n}`;
  return true;
}
function stop(key) { clearInterval(TIMERS[key]); delete TIMERS[key]; const b = document.querySelector(`[data-stp="${key}"] [data-act=stplay]`); if (b) b.textContent = 'Lecture'; }
hooks.exStepsView = (e) => (hasSteps(e?.steps) ? player(normalize(e.steps, sportOf(e)), 'ex' + e.id) : '');

// ---------- formulaire de l'exercice : bloc « Schéma animé » ----------
hooks.exAiForm = (f) => {
  const st = f.steps && hasSteps(f.steps) ? f.steps : null;
  let h = '<div class="field stform"><span class="lab">Schéma animé</span>';
  if (S.aiBusy) h += '<div class="card" role="status"><b>L’IA prépare le schéma…</b><p class="note">Cela prend 20 à 40 secondes. Reste sur cette page.</p></div>';
  else if (st) {
    h += `<div class="stmini">${stepsSvg(st, 0, { all: true })}</div><p class="note">${st.frames.length} étapes · ${st.items.length} éléments. Tu peux tout modifier.</p>
    <div class="btns"><button type="button" class="btn main small" data-act="stedit">Modifier le schéma</button><button type="button" class="btn ghost small" data-act="stai">${isArmed('stai') ? 'Touche encore : le schéma actuel sera remplacé' : 'Refaire avec l’IA'}</button><button type="button" class="btn ghost small" data-act="strm">${isArmed('strm') ? 'Touche encore pour retirer' : 'Retirer le schéma'}</button></div>`;
  } else {
    h += `<div class="btns"><button type="button" class="btn main small" data-act="stai">${icon('target', 18)}Préparer le schéma avec l’IA</button><button type="button" class="btn ghost small" data-act="stdraw">Le dessiner moi-même</button></div>`;
  }
  h += '<p class="note">L’IA lit le titre, la description et les tags. N’écris pas de nom de joueur dans la description. Le schéma est une proposition : vérifie-le.</p></div>';
  return h;
};

// éléments de départ quand le coach dessine lui-même
function starter(sport) {
  if (sport === 'Volley-ball') {
    const P = [['4', 72, 138], ['3', 180, 138], ['2', 288, 138], ['5', 72, 330], ['6', 180, 420], ['1', 288, 330]];
    return { v: 1, sport, items: P.map(([n]) => ({ id: 'v' + n, k: 'a', n })).concat([{ id: 'b1', k: 'b', n: '' }]), frames: [{ c: 'Mise en place.', p: Object.fromEntries(P.map(([n, x, y]) => ['v' + n, [x, y]]).concat([['b1', [196, 412]]])) }] };
  }
  return { v: 1, sport, items: [{ id: 'a1', k: 'a', n: '1' }, { id: 'a2', k: 'a', n: '2' }, { id: 'b1', k: 'b', n: '' }], frames: [{ c: 'Mise en place.', p: { a1: [180, 300], a2: [300, 190], b1: [192, 292] } }] };
}
const openEditor = () => { S.stEd = { i: 0, sel: null, prev: false }; S.view = { type: 'exsteps' }; render(); };

// ---------- éditeur au doigt ----------
function editor() {
  const st = S.exf?.steps; if (!hasSteps(st)) return '<p class="empty">Pas de schéma.</p>';
  const E = S.stEd = S.stEd || { i: 0, sel: null }; E.i = Math.min(E.i, st.frames.length - 1);
  const sel = st.items.find((x) => x.id === E.sel), sport = st.sport;
  if (E.prev) return `<div class="card">${player(st, 'edprev')}</div><button type="button" class="btn main" data-act="stprev">Revenir à l’édition</button>`;
  const add = [['a', '+ Joueur'], ['d', '+ Défenseur']].concat(sport === 'Volley-ball' ? [['l', '+ Libéro']] : [], [['e', '+ Coach'], ['c', '+ Plot'], ['b', '+ Ballon']]);
  return `<div class="card stedit">
  <div class="stchips" role="group" aria-label="Étapes"><span class="det">Étapes</span>${st.frames.map((_, k) => `<button type="button" class="stchip" data-act="stsel" data-i="${k}" aria-pressed="${k === E.i}" aria-label="Étape ${k + 1}">${k + 1}</button>`).join('')}${st.frames.length < MAXF ? '<button type="button" class="stchip add" data-act="stadd" aria-label="Ajouter une étape (copie de celle-ci)">+</button>' : ''}</div>
  ${stepsSvg(st, E.i, { edit: true, label: 'Terrain modifiable : touche un élément pour le choisir, glisse-le pour le déplacer' })}
  <div class="stsel-row">${sel ? `<span class="det">${esc(KIND[sel.k].l)}${sel.n ? ' ' + esc(sel.n) : ''} · glisse-le pour le déplacer</span>${'adle'.includes(sel.k) ? `<label class="stlab">Étiquette <input data-stlab="1" maxlength="3" value="${esc(sel.n)}" aria-label="Étiquette de l’élément"></label>` : ''}<button type="button" class="btn ghost small ko" data-act="stdel">Retirer</button>` : '<span class="det">Touche un élément pour le choisir</span>'}</div>
  <div class="chips">${add.map(([k, l]) => `<button type="button" class="chip" data-act="stnew" data-k="${k}" ${st.items.length >= MAXI ? 'disabled' : ''}>${l}</button>`).join('')}</div>
  <div class="field"><label for="stcap">Texte de l’étape ${E.i + 1}</label><textarea id="stcap" data-stcap="1" rows="2" maxlength="200" placeholder="Ce qui se passe à cette étape">${esc(st.frames[E.i].c)}</textarea></div>
  ${st.frames.length > 1 ? `<button type="button" class="btn ghost small" data-act="stfdel">${isArmed('stfdel' + E.i) ? 'Touche encore pour supprimer l’étape ' + (E.i + 1) : 'Supprimer l’étape ' + (E.i + 1)}</button>` : ''}
  <p class="note">Déplacer un élément à une étape le déplace aussi aux étapes suivantes où il n’avait pas encore bougé.</p></div>
  <div class="pair"><button type="button" class="btn ghost" data-act="stprev" ${st.frames.length < 2 ? 'disabled' : ''}>Aperçu animé</button><button type="button" class="btn main" data-act="back">Terminé</button></div>`;
}
COACH_VIEWS.exsteps = () => ['Exercice', 'Schéma animé', editor];

// glisser au doigt (ou à la souris)
let drag = null;
const svgXY = (svg, e) => { const r = svg.getBoundingClientRect(); return clampXY(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H); };
document.addEventListener('pointerdown', (e) => {
  const svg = e.target.closest?.('svg[data-sted]'); if (!svg || !S.exf?.steps || !S.stEd) return;
  const g = e.target.closest('g[data-it]');
  if (!g) { if (S.stEd.sel) { S.stEd.sel = null; render(true); } return; }
  e.preventDefault();
  const id = g.dataset.it, f = S.exf.steps.frames[S.stEd.i];
  drag = { id, g, svg, old: (f.p[id] || [W / 2, H / 2]).slice(), moved: false, pid: e.pointerId };
  try { svg.setPointerCapture(e.pointerId); } catch { /* ancien navigateur */ }
  if (S.stEd.sel !== id) { S.stEd.sel = id; svg.querySelectorAll('g[data-it]').forEach((x) => x.classList.toggle('on', x === g)); }
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const q = svgXY(drag.svg, e); if (!drag.moved && Math.hypot(q[0] - drag.old[0], q[1] - drag.old[1]) < 3) return;
  drag.moved = true; S.exf.steps.frames[S.stEd.i].p[drag.id] = q; drag.g.style.transform = `translate(${q[0]}px,${q[1]}px)`;
});
const endDrag = (e) => {
  if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pid)) return;
  const d = drag; drag = null;
  if (d.moved) {   // les étapes suivantes où l'élément n'avait pas encore bougé suivent
    const fr = S.exf.steps.frames, now = fr[S.stEd.i].p[d.id];
    for (let j = S.stEd.i + 1; j < fr.length; j++) { const q = fr[j].p[d.id]; if (!q || q[0] !== d.old[0] || q[1] !== d.old[1]) break; fr[j].p[d.id] = now.slice(); }
  }
  render(true);
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

INPUTS.push((t) => {
  if (t.matches?.('[data-stcap]') && S.exf?.steps && S.stEd) { S.exf.steps.frames[S.stEd.i].c = t.value.slice(0, 200); return true; }
  if (t.matches?.('[data-stlab]') && S.exf?.steps && S.stEd?.sel) {
    const it = S.exf.steps.items.find((x) => x.id === S.stEd.sel); if (!it) return true;
    it.n = t.value.replace(/\s+/g, '').slice(0, 3); const tx = document.querySelector(`svg[data-sted] g[data-it="${it.id}"] text`); if (tx) tx.textContent = it.n; return true;
  }
  return false;
});

// ---------- actions ----------
Object.assign(ACTIONS, {
  stgo: (el, d) => { stop(d.k); const box = document.querySelector(`[data-stp="${d.k}"]`); if (box) setFrame(d.k, +box.dataset.i + +d.d); },
  stplay: (el, d) => {
    if (TIMERS[d.k]) return stop(d.k);
    if (!setFrame(d.k, 0)) return;
    el.textContent = 'Pause';
    TIMERS[d.k] = setInterval(() => { const box = document.querySelector(`[data-stp="${d.k}"]`); if (!box || +box.dataset.i >= PLAYERS[d.k].frames.length - 1) return stop(d.k); setFrame(d.k, +box.dataset.i + 1); }, 1600);
  },
  stai: async () => {
    keepEx(); const f = S.exf; if (!f) return;
    if (hasSteps(f.steps) && !armed('stai')) return;
    if ((f.description || '').trim().length < 20 && (f.title || '').trim().length < 4) return toast('Écris d’abord le nom et la description de l’exercice : l’IA s’en sert.');
    S.aiBusy = true; render(true);
    let r; try { r = await sb.functions.invoke('generer-exercice', { body: { club_id: S.clubId, sport: sportOf(f), title: f.title || '', description: f.description || '', tags: f.tags || [], category: f.category || '', duration: +f.duration_min || 10, level: f.level || '' } }); } catch (err) { r = { error: err }; }
    S.aiBusy = false;
    let data = r?.data;
    // une réponse d'erreur de la fonction (ou son absence) : on lit son message, sinon le code, pour savoir où chercher
    if (r?.error && !data) { try { data = await r.error.context?.json?.(); } catch { /* */ } }
    if (!data) { render(true); const st = r?.error?.context?.status; return toast(`L’IA n’est pas joignable${st ? ' (' + st + ')' : ''}. La fonction generer-exercice est-elle déployée ? Tu peux dessiner le schéma toi-même.`); }
    if (!data.ok) { render(true); return toast(data.message || 'L’IA n’a pas pu préparer le schéma.'); }
    const st = normalize(data.steps, sportOf(f)); if (!st) { render(true); return toast('Le schéma proposé n’était pas utilisable. Réessaie.'); }
    S.exf.steps = st; S.exf.askschema = false;
    if (S.exf.origin === 'perso') { S.exf.origin = 'ia'; if (!S.exf.source) S.exf.source = 'Schéma préparé avec l’IA (Claude, d’Anthropic), revu par le coach'; }
    toast('Schéma prêt. Vérifie chaque étape et corrige ce qui ne va pas.');
    openEditor();
  },
  stdraw: () => { keepEx(); if (!S.exf) return; S.exf.steps = starter(sportOf(S.exf)); S.exf.askschema = false; openEditor(); },
  stedit: () => { keepEx(); if (!S.exf || !hasSteps(S.exf.steps)) return; openEditor(); },
  strm: () => { keepEx(); if (!armed('strm')) return; S.exf.steps = null; render(true); },
  stsel: (el, d) => { S.stEd.i = +d.i; S.stEd.sel = null; render(true); },
  stadd: () => { const fr = S.exf.steps.frames; if (fr.length >= MAXF) return; const cur = fr[S.stEd.i]; fr.splice(S.stEd.i + 1, 0, { c: '', p: JSON.parse(JSON.stringify(cur.p)) }); S.stEd.i++; S.stEd.sel = null; render(true); toast('Étape ajoutée : déplace les éléments qui bougent.'); },
  stfdel: () => { const st = S.exf.steps; if (st.frames.length < 2 || !armed('stfdel' + S.stEd.i)) return; st.frames.splice(S.stEd.i, 1); S.stEd.i = Math.max(0, S.stEd.i - 1); render(true); },
  stnew: (el, d) => {
    const st = S.exf.steps; if (st.items.length >= MAXI) return toast(`${MAXI} éléments au plus.`);
    let n = 1; while (st.items.some((x) => x.id === d.k + n)) n++;
    const same = st.items.filter((x) => x.k === d.k).length + 1;
    const it = { id: d.k + n, k: d.k, n: d.k === 'a' || d.k === 'd' ? String(same) : d.k === 'l' ? 'L' : d.k === 'e' ? 'E' : '' };
    st.items.push(it); st.frames.forEach((f) => { f.p[it.id] = [W / 2, sportOf(S.exf) === 'Volley-ball' ? 300 : 320]; });
    S.stEd.sel = it.id; render(true);
  },
  stdel: () => { const st = S.exf.steps, id = S.stEd.sel; if (!id) return; if (st.items.length <= 1) return toast('Garde au moins un élément, ou retire le schéma.'); st.items = st.items.filter((x) => x.id !== id); st.frames.forEach((f) => delete f.p[id]); S.stEd.sel = null; render(true); },
  stprev: () => { if (!S.stEd) return; S.stEd.prev = !S.stEd.prev; S.stEd.sel = null; render(true); },
});
