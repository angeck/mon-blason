// mypocketclub · alpha 5.15.0 (Gaël, 14 novembre 2026 : « c'est parti »)
//   N° 239 : en arrivant dans un rôle, la demande à traiter est en jaune (cadre jaune) jusqu'à la validation ou jusqu'au « retour »
//            (retour sans valider = « vu, pas urgent » : le jaune s'éteint ; la pastille reste tant que la demande attend).
//   N° 246 : tablette et ordinateur, bandeau à gauche dès 600 px ; « Mes rôles » en menu déroulant : le rôle ouvert déplie
//            ses sous-onglets, et seul le sous-onglet en cours est encadré de jaune (style.css).
//   N° 242 et 243 : carnet du coach (Exercices / Tactiques) à la place de l'onglet « Préparer » ; banque de tactiques
//            (même éditeur au doigt et même animation que les schémas d'exercices, table tactics) ; terrain en direct ;
//            dans un entraînement : la séance et les tactiques ; dans un match : les tactiques.
// Rappel : chaque droit est vérifié par la base ; l'écran n'est qu'un confort.
import { S, sb, esc, hooks, ACTIONS, INPUTS, render, toast, run, club, armed, isArmed, store, toValidate, casquettes, isCoachCasq } from './core.js';
import { icon, SPACE_VIEWS } from './ui.js';
import { COACH_VIEWS, thumb, exosForCounts, plansForEvent, loadPlans } from './coach.js';
import { canCallRoll, homeEvents, needsAnswer } from './agenda.js';
import { normalize, stepsSvg, player, hasSteps } from './v510.js';

// ---------- n° 239 et 250 · toute pastille mène à l'élément en jaune ; une fois vu, pastille et jaune s'enlèvent ----------
// « Vu » gardé dans le compte (métadonnées, comme l'onboarding) : d = demandes de rôle, e = rendez-vous à répondre,
// g = { groupe: non lus vus }, x = { rôle: { exos, hours } } (compteurs sans identifiant)
const VK = 'vus515';
export function vus() { const v = S.session?.user?.user_metadata?.[VK] || {}; return { d: v.d || [], e: v.e || [], g: v.g || {}, x: v.x || {} }; }
let vusTimer = 0;
function saveVus(v) {
  const u = S.session?.user; if (!u) return;
  const keepD = new Set(toValidate().map((m) => String(m.id)));
  const keepE = new Set(homeEvents().filter(needsAnswer).map((e) => String(e.id)));
  const o = { d: v.d.filter((id) => keepD.has(String(id))).slice(-300), e: v.e.filter((id) => keepE.has(String(id))).slice(-300), g: v.g, x: v.x };
  u.user_metadata = { ...(u.user_metadata || {}), [VK]: o };
  clearTimeout(vusTimer); vusTimer = setTimeout(() => sb.auth.updateUser({ data: { [VK]: o } }).catch(() => {}), 800);
}
// ce que comptent les pastilles des onglets, sans ce qui a été vu
hooks.toAnswerIds = () => { try { return homeEvents().filter(needsAnswer).map((e) => String(e.id)); } catch { return []; } };
hooks.unseenAnswers = () => { const seen = new Set(vus().e); return hooks.toAnswerIds().filter((id) => !seen.has(id)).length; };
hooks.unseenMessages = () => { const g = vus().g; return Object.entries(S.unread || {}).reduce((a, [gid, n]) => a + (n > (g[gid] || 0) ? n - (g[gid] || 0) : 0), 0); };
hooks.demSeen = (id) => vus().d.includes(String(id));
hooks.numSeen = (k, what) => (vus().x[k] || {})[what] || 0;

const viewKeyOf = () => JSON.stringify([S.tab, S.view?.type || '', S.view?.id || '', S.view?.tab || '', S.casq || '', S.ptab || '', (S.ftabs || {})[S.casq] || '', S.tsp || '']);
const ROLE_VIEWS = ['espace', 'rub', 'fonctions', 'fview', 'tspace', 'team'];
// Onglets ou tuiles qui mènent aux demandes, quand on n'y est pas encore
const LEADS = ['[data-act=ptab][data-v=demandes]', '[data-act=tsgo][data-tab=effectif]', '[data-act=ftab][data-v=fiches]', '[data-act=ftab][data-v=ap_secretariat]', '[data-act=ftab][data-v=equipes]', '.tile.wait[data-act]'];
function paintTodo() {
  const key = viewKeyOf();
  if (!S.hlVisit || S.hlVisit.key !== key) S.hlVisit = { key, ids: new Set() };
  const visit = S.hlVisit.ids, v = vus(); let changed = false;
  const show = (el, id) => { el.classList.add('todo-hl'); visit.add(id); };
  // Agenda : les rendez-vous qui attendent ta réponse
  if (S.tab === 1 && !S.view) {
    const ids = new Set(hooks.toAnswerIds()), seen = new Set(v.e);
    document.querySelectorAll('main .ev [data-act=event][data-id]').forEach((b) => {
      const id = b.dataset.id; if (!ids.has(id) || (seen.has(id) && !visit.has('e:' + id))) return;
      show(b.closest('.ev'), 'e:' + id); if (!seen.has(id)) { v.e.push(id); changed = true; }
    });
  }
  // une conversation lue (non lus revenus sous le « vu ») : le « vu » redescend, pour qu'un nouveau message refasse la pastille
  Object.keys(v.g).forEach((gid) => { const n = (S.unread || {})[gid] || 0; if (n < v.g[gid]) { v.g[gid] = n; changed = true; } });
  // Messages : les conversations non lues
  if (S.tab === 2 && !S.view) {
    document.querySelectorAll('main [data-act=group][data-id]').forEach((b) => {
      const gid = b.dataset.id, n = (S.unread || {})[gid] || 0; if (!n) return;
      if (n <= (v.g[gid] || 0) && !visit.has('g:' + gid)) return;
      show(b, 'g:' + gid); if (n > (v.g[gid] || 0)) { v.g[gid] = n; changed = true; }
    });
  }
  // Rôles : demandes à valider (par identifiant), puis ce que comptent les tuiles en attente (heures, exercices, attestations)
  if (S.view && ROLE_VIEWS.includes(S.view.type)) {
    const seenD = new Set(v.d.map(String));
    const wait = toValidate().map((m) => String(m.id)).filter((id) => !seenD.has(id) || visit.has('d:' + id));
    const rows = [...document.querySelectorAll('main [data-act=mok][data-id]')].filter((b) => wait.includes(b.dataset.id));
    rows.forEach((b) => { const id = b.dataset.id; show(b.closest('.row') || b, 'd:' + id); if (!seenD.has(id)) { v.d.push(id); changed = true; } });
    const k = S.casq || '', cnt = k && hooks.roleRaw ? hooks.roleRaw(k) : null, x = (v.x[k] = v.x[k] || {});
    const numNew = cnt && ((cnt.exos > (x.exos || 0)) || (cnt.hours > (x.hours || 0)));
    if (!rows.length && (wait.length || numNew || visit.has('lead'))) {
      LEADS.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
        if (el.closest('.tb') || el.getAttribute('aria-current') === 'page') return;
        if (sel === '[data-act=tsgo][data-tab=effectif]' && !wait.length) return;
        show(el, 'lead');
      }));
    }
    if (numNew && visit.has('lead')) { x.exos = Math.max(x.exos || 0, cnt.exos); x.hours = Math.max(x.hours || 0, cnt.hours); changed = true; }
  }
  // chemin : sur téléphone, le rôle qui a une pastille (rangée « Mes rôles » de l'en-tête) est en jaune
  document.querySelectorAll('.hd .casq [data-act=casq]').forEach((b) => { if (b.querySelector('.n') && b.getAttribute('aria-selected') !== 'true') b.classList.add('todo-hl'); });
  if (changed) { saveVus(v); setTimeout(() => render(true), 0); }   // la pastille s'enlève : on redessine (le jaune reste pendant la visite)
}
// « Retour » sans valider : vu, pas urgent ; en quittant les écrans de tactique, le brouillon est oublié.
// app.js définit ACTIONS.back après ce module : on l'enveloppe au premier dessin.
function wrapBack() {
  const b0 = ACTIONS.back; if (!b0 || b0.w515) return;
  const b = (...a) => {
    if (['tac', 'terrain', 'tactics'].includes(S.view?.type)) dropTac();
    return b0(...a);
  };
  b.w515 = true; ACTIONS.back = b;
}

// ---------- n° 246 · sous-onglets du rôle ouvert, dans le bandeau de gauche ----------
const wide = matchMedia('(min-width:600px)');
// 5.16.0 · n° 252 : sous « Carnet du coach », trois entrées (Exercices, Tactiques, Séances types) ; seule l'entrée en cours est en jaune
const CARNET_CUR = { exos: 'ex', exo: 'ex', exoform: 'ex', expick: 'ex', tactics: 'tac', tac: 'tac', tacshow: 'tac', terrain: 'tac', plans: 'tpl' };
function carnetSubs(sub, key) {
  if (!isCoachCasq(key)) return;
  const par = sub.querySelector('[data-act=tsgo][data-tab=preparer]'); if (!par) return;
  const cur = CARNET_CUR[S.view?.type] || '';
  const items = [['ex', 'Exercices', 'data-act="cexos" data-tab="mine"'], ['tac', 'Tactiques', 'data-act="tactics"'], ['tpl', 'Séances types', 'data-act="cplans"']];
  const d = document.createElement('div');
  d.className = 'rsub2'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Carnet du coach');
  d.innerHTML = items.map(([k, l, a]) => `<button ${a} ${cur === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
  if (cur) par.removeAttribute('aria-current');
  par.after(d);
}
function roleSubs() {
  const root = document.documentElement;
  root.classList.remove('rsubon');
  document.querySelectorAll('.tb .rsub').forEach((x) => x.remove());
  document.querySelectorAll('.tb nav.roles button.ropen').forEach((x) => x.classList.remove('ropen'));
  if (!wide.matches) return;
  const inRole = SPACE_VIEWS.includes(S.view?.type) || !!S.tsp;
  if (!inRole) return;
  let key = S.casq;
  if (S.tsp) { const c = casquettes().find((x) => isCoachCasq(x.k) && (x.teams || []).includes(S.tsp)); if (c) key = c.k; }   // espace d'une équipe : le rôle Coach
  if (!key) return;
  const btn = [...document.querySelectorAll('.tb nav.roles [data-act=casq]')].find((b) => b.dataset.v === key);
  if (!btn) return;
  btn.classList.add('ropen');
  const tt = [...document.querySelectorAll('nav.ttabs')].find((n) => !n.closest('.tb'));
  if (!tt) return;
  const sub = document.createElement('div');
  sub.className = 'rsub'; sub.setAttribute('role', 'group'); sub.setAttribute('aria-label', 'Sous-onglets du rôle');
  sub.innerHTML = tt.innerHTML;
  carnetSubs(sub, key);
  btn.after(sub);
  root.classList.add('rsubon');
}
wide.addEventListener?.('change', () => render(true));

hooks.after515 = () => { for (const f of [wrapBack, paintTodo, roleSubs, terrainMode]) { try { f(); } catch (e) { console.warn('5.15', f.name, e); } } };

// ---------- n° 242 · tactiques ----------
const SPORT = () => (club()?.sport === 'Volley-ball' ? 'Volley-ball' : 'Basket-ball');
const W = 360, H = 500;
function starter(sport) {
  if (sport === 'Volley-ball') {
    const P = [['4', 72, 138], ['3', 180, 138], ['2', 288, 138], ['5', 72, 330], ['6', 180, 420], ['1', 288, 330]];
    return { v: 1, sport, items: P.map(([n]) => ({ id: 'a' + n, k: 'a', n })).concat([{ id: 'b1', k: 'b', n: '' }]), frames: [{ c: '', p: Object.fromEntries(P.map(([n, x, y]) => ['a' + n, [x, y]]).concat([['b1', [196, 412]]])) }] };
  }
  const P = [['1', 180, 420], ['2', 70, 330], ['3', 290, 330], ['4', 110, 200], ['5', 250, 200]];
  return { v: 1, sport, items: P.map(([n]) => ({ id: 'a' + n, k: 'a', n })).concat([{ id: 'b1', k: 'b', n: '' }]), frames: [{ c: '', p: Object.fromEntries(P.map(([n, x, y]) => ['a' + n, [x, y]]).concat([['b1', [194, 410]]])) }] };
}
export async function loadTactics(force) {
  if (S.tactics && S.tacticsClub === S.clubId && !force) return S.tactics;
  const { data } = await sb.from('tactics').select('*').eq('club_id', S.clubId).is('deleted_at', null).order('updated_at', { ascending: false });
  S.tactics = (Array.isArray(data) ? data : []).filter((t) => hasSteps(t.steps)); S.tacticsClub = S.clubId;
  return S.tactics;
}
function tacticsNow() {
  if (S.tactics && S.tacticsClub === S.clubId) return S.tactics;
  if (!S.tacLoading) { S.tacLoading = true; loadTactics().then(() => { S.tacLoading = false; render(true); }, () => { S.tacLoading = false; }); }
  return null;
}
const mini = (st) => { const n = normalize(st, SPORT()); return n ? stepsSvg(n, 0, { all: true }) : ''; };
const tacTile = (t, act = 'tacopen') => `<button class="ctile" data-act="${act}" data-id="${t.id}"><span class="cthumb">${mini(t.steps)}</span><span class="ct">${esc(t.title)}</span><span class="cs">${t.steps.frames.length > 1 ? t.steps.frames.length + ' étapes' : '1 étape'}${t.sharing === 'club' ? ' · club' : ''}</span></button>`;
const exTile = (e) => `<button class="ctile" data-act="cexo" data-id="${e.id}"><span class="cthumb">${thumb(e)}</span><span class="ct">${esc(e.title)}</span><span class="cs">${esc([e.minutes ? e.minutes + ' min' : '', e.category].filter(Boolean).join(' · '))}</span></button>`;
const addTile = (act, label, extra = '') => `<button class="ctile add" data-act="${act}" ${extra}>${icon('plus', 26)}<span class="ct">${label}</span></button>`;

// Le carnet du coach (onglet de l'espace de l'équipe) : Exercices / Tactiques, l'un sous l'autre sur téléphone, côte à côte au-delà
// 5.16.0 · n° 252 : troisième partie du carnet, les séances types (modèles sans date)
function tplHtml() {
  if (!S.plans) {
    if (!S.plLoading) { S.plLoading = true; loadPlans().then(() => { S.plLoading = false; render(true); }, () => { S.plLoading = false; }); }
    return '<p class="det">Chargement…</p>';
  }
  const l = S.plans.filter((p) => p.is_template && p.created_by === S.me.id).slice(0, 5);
  if (!l.length) return '<p class="det">Aucune séance type pour l’instant.</p>';
  return `<div class="card"><div class="list">${l.map((p) => `<button class="row" data-act="ptpluse" data-id="${p.id}"><span class="g">${esc(p.title || 'Séance type')}<small>${(p.items || []).length} exercice${(p.items || []).length > 1 ? 's' : ''}</small></span><span class="chev"></span></button>`).join('')}</div></div>`;
}
// 5.16.0 · n° 252 : outils du jour J (bandeau « Aujourd'hui » de l'espace Coach et carte du jour de l'Accueil)
hooks.dayTools = (e) => {
  if (!e || e.cancelled || !canCallRoll(e)) return '';
  if (e.type === 'Entraînement') {
    const p = plansForEvent(e.id)[0];
    return `<button class="btn ghost" data-act="${p ? 'pview' : 'cplanfor'}" data-id="${p ? p.id : e.id}">${icon('doc', 20)}Gérer la séance</button><button class="btn ghost" data-act="terrain" data-ev="${e.id}">${icon('target', 20)}Tactiques</button>`;
  }
  if (['Match', 'Plateau', 'Tournoi'].includes(e.type)) return `<button class="btn ghost" data-act="terrain" data-ev="${e.id}">${icon('target', 20)}Tactique</button>`;
  return '';
};
// n° 252 : le bloc séparé « Carnet du coach » du bandeau de gauche disparaît pour un coach (le carnet est dans le rôle Coach)
hooks.hideBank = () => casquettes().some((x) => isCoachCasq(x.k));
hooks.carnetBody = () => {
  const ex = exosForCounts(), tac = tacticsNow();
  const myEx = ex ? ex.filter((e) => !e.deleted_at).sort((a, b) => (a.created_by === S.me.id ? -1 : 0) - (b.created_by === S.me.id ? -1 : 0)).slice(0, 5) : null;
  const exHtml = myEx === null ? '<p class="det">Chargement…</p>' : myEx.map(exTile).join('') + addTile('cexnew', 'Nouvel exercice');
  const tacHtml = tac === null ? '<p class="det">Chargement…</p>' : tac.slice(0, 5).map((t) => tacTile(t)).join('') + addTile('tacnew', 'Nouvelle tactique');
  return `<div class="carnet">
  <section class="cblk"><div class="sec"><h2>Exercices</h2><button class="linkbtn" data-act="cexos" data-tab="mine">Tout voir</button></div><div class="ctiles">${exHtml}</div></section>
  <section class="cblk"><div class="sec"><h2>Tactiques</h2><button class="linkbtn" data-act="tactics">Tout voir</button></div><div class="ctiles">${tacHtml}</div>
  <button class="terrainbtn" data-act="terrain"><span class="tbic">${icon('target', 26, '#11162E')}</span><span><b>Ouvrir le terrain</b><small>Dessiner en direct, ou montrer une tactique</small></span></button></section>
  <section class="cblk"><div class="sec"><h2>Séances types</h2><button class="linkbtn" data-act="cplans">Tout voir</button></div>${tplHtml()}</section></div>
  <p class="note">Une séance se prépare dans l’entraînement (Planifier › l’entraînement › « Gérer la séance ») ; « Enregistrer comme séance type » la range ici.</p>`;
};

// Toutes les tactiques
function tacticsPage() {
  const tac = tacticsNow(); if (tac === null) return '<p class="det">Chargement…</p>';
  const mine = tac.filter((t) => t.created_by === S.me.id), club_ = tac.filter((t) => t.created_by !== S.me.id);
  let h = `<div class="btns"><button class="btn main" data-act="tacnew">${icon('plus', 20)}Nouvelle tactique</button><button class="btn ghost" data-act="terrain">Ouvrir le terrain</button></div>`;
  h += `<div class="sec"><h2>Mes tactiques</h2></div>${mine.length ? `<div class="ctiles wide">${mine.map((t) => tacTile(t)).join('')}</div>` : '<p class="empty">Pas encore de tactique. Exemple : « Remise en jeu ».</p>'}`;
  if (club_.length) h += `<div class="sec"><h2>Partagées par le club</h2></div><div class="ctiles wide">${club_.map((t) => tacTile(t, 'tacshow')).join('')}</div>`;
  return h;
}

// Éditeur d'une tactique : le même éditeur au doigt que les schémas d'exercices (v510.js), rangé dans S.exf le temps de l'édition
function tacEditPage() {
  const f = S.exf; if (!f?.tac) return '<p class="empty">Tactique introuvable.</p>';
  const ed = COACH_VIEWS.exsteps()[2]().replace(/<button type="button" class="btn main" data-act="back">Terminé<\/button>/, `<button type="button" class="btn main" data-act="tacsave">Enregistrer la tactique</button>`);
  return `<div class="card lift"><div class="field"><label for="tactitle">Nom de la tactique</label><input id="tactitle" data-tactitle="1" maxlength="80" value="${esc(f.title || '')}" placeholder="Ex. Remise en jeu"></div>
  <label class="check"><input type="checkbox" data-tacshare="1" ${f.sharing === 'club' ? 'checked' : ''}><span>Partager avec les coachs du club</span></label></div>${ed}
  ${f.id ? `<button class="btn danger ${isArmed('tacdel') ? 'armed' : ''}" data-act="tacdel">${icon('trash', 20)}${isArmed('tacdel') ? 'Confirmer la suppression' : 'Supprimer la tactique'}</button>` : ''}`;
}

// Montrer une tactique enregistrée (animée), en grand
function tacShowPage(v) {
  const t = (S.tactics || []).find((x) => x.id === v.id); if (!t) return '<p class="empty">Tactique introuvable.</p>';
  const st = normalize(t.steps, t.sport || SPORT());
  return `<div class="card tacbig">${player(st, 'tac' + t.id)}</div>${t.created_by === S.me.id ? `<button class="btn ghost" data-act="tacopen" data-id="${t.id}">Modifier</button>` : ''}`;
}

// Le terrain en direct (avant ou pendant un match) : dessiner sans rien enregistrer, ou rejouer une tactique
function terrainPage() {
  const tac = tacticsNow() || [];
  if (!S.exf?.live) { S.exf = { live: true, tac: true, sport: SPORT(), steps: starter(SPORT()), title: '' }; S.stEd = { i: 0, sel: null, prev: false }; }
  const ed = COACH_VIEWS.exsteps()[2]().replace(/<button type="button" class="btn main" data-act="back">Terminé<\/button>/, `<button type="button" class="btn main" data-act="tackeep">Enregistrer comme tactique</button>`);
  const pick = tac.length ? `<div class="sec"><h2>Montrer une tactique</h2></div><div class="chips">${tac.map((t) => `<button class="chip" data-act="tacshow" data-id="${t.id}">${esc(t.title)}</button>`).join('')}</div>` : '';
  return `${pick}<div class="sec"><h2>Dessiner en direct</h2><button class="linkbtn" data-act="tacreset">Tout remettre en place</button></div>${ed}<p class="note">Rien n’est enregistré tant que tu ne touches pas « Enregistrer comme tactique ».</p>`;
}
// Grand écran : le terrain prend la place de l'en-tête ; sur téléphone, le paysage est conseillé
function terrainMode() {
  const on = ['terrain', 'tacshow', 'tac'].includes(S.view?.type);
  document.documentElement.classList.toggle('tacfull', on);
}

COACH_VIEWS.tactics = () => ['Carnet du coach', 'Tactiques', tacticsPage];
COACH_VIEWS.tac = () => ['Tactiques', S.exf?.id ? 'Modifier la tactique' : 'Nouvelle tactique', tacEditPage];
COACH_VIEWS.tacshow = (v) => ['Tactique', esc((S.tactics || []).find((x) => x.id === v.id)?.title || 'Tactique'), () => tacShowPage(v)];
COACH_VIEWS.terrain = () => ['Tactiques', 'Terrain', terrainPage];

INPUTS.push((t) => {
  if (t.matches?.('[data-tactitle]') && S.exf?.tac) { S.exf.title = t.value.slice(0, 80); return true; }
  if (t.matches?.('[data-tacshare]') && S.exf?.tac) { S.exf.sharing = t.checked ? 'club' : 'me'; return true; }
  return false;
});
const openView = (v) => { S.view = v; render(); };
const dropTac = () => { if (S.exf?.tac) S.exf = null; S.stEd = null; };

// ---------- n° 243 · dans un entraînement : la séance et les tactiques ; dans un match : les tactiques ----------
hooks.evCoachTools = (e) => {
  if (!e || e.cancelled || !canCallRoll(e)) return '';
  if (e.type === 'Entraînement') {
    const p = plansForEvent(e.id)[0];
    return `<div class="card pale evtools"><div class="kick">Séance</div><span class="det">${p ? `${p.items.length} exercice${p.items.length > 1 ? 's' : ''} · ${p.items.reduce((a, x) => a + (+x.minutes || 0), 0)} min` : 'Pas encore préparée'}</span>
    <div class="btns"><button class="btn main" data-act="${p ? 'pview' : 'cplanfor'}" data-id="${p ? p.id : e.id}">${icon('doc', 20)}Gérer la séance</button><button class="btn ghost" data-act="terrain" data-ev="${e.id}">${icon('target', 20)}Tactiques</button></div></div>`;
  }
  if (['Match', 'Plateau', 'Tournoi'].includes(e.type)) return `<button class="btn tacbtn" data-act="terrain" data-ev="${e.id}">${icon('target', 22, '#11162E')}Tactique</button>`;
  return '';
};

Object.assign(ACTIONS, {
  tactics: () => { dropTac(); openView({ type: 'tactics' }); },
  tacnew: () => { S.exf = { tac: true, sport: SPORT(), title: '', sharing: 'me', steps: starter(SPORT()) }; S.stEd = { i: 0, sel: null, prev: false }; openView({ type: 'tac' }); },
  tacopen: async (el, d) => {
    await loadTactics(); const t = S.tactics.find((x) => x.id === d.id); if (!t) return toast('Tactique introuvable.');
    if (t.created_by !== S.me.id) return openView({ type: 'tacshow', id: t.id });
    S.exf = { tac: true, id: t.id, sport: t.sport, title: t.title, sharing: t.sharing, steps: normalize(t.steps, t.sport) }; S.stEd = { i: 0, sel: null, prev: false };
    openView({ type: 'tac' });
  },
  tacshow: async (el, d) => { await loadTactics(); openView({ type: 'tacshow', id: d.id }); },
  terrain: (el, d) => { S.tacEv = d?.ev || null; if (!S.exf?.live) dropTac(); openView({ type: 'terrain' }); },
  tacreset: () => { if (!S.exf?.live) return; S.exf.steps = starter(S.exf.sport); S.stEd = { i: 0, sel: null, prev: false }; render(true); },
  tackeep: () => { if (!S.exf?.live) return; const st = S.exf.steps; S.exf = { tac: true, sport: st.sport, title: '', sharing: 'me', steps: st }; S.stEd = { i: 0, sel: null, prev: false }; S.noStack = true; openView({ type: 'tac' }); },
  tacsave: async () => {
    const f = S.exf; if (!f?.tac) return;
    const title = (f.title || '').trim(); if (!title) { toast('Donne un nom à la tactique.'); document.getElementById('tactitle')?.focus(); return; }
    const row = { title, sport: f.sport || SPORT(), steps: f.steps, sharing: f.sharing === 'club' ? 'club' : 'me', updated_at: new Date().toISOString() };
    const q = f.id ? sb.from('tactics').update(row).eq('id', f.id) : sb.from('tactics').insert({ ...row, club_id: S.clubId });
    if (!(await run(q, 'Tactique enregistrée.'))) return;
    await loadTactics(true); dropTac(); S.noStack = true; openView({ type: 'tactics' });
  },
  tacdel: async () => {
    const f = S.exf; if (!f?.id || !armed('tacdel')) return;
    if (!(await run(sb.from('tactics').delete().eq('id', f.id), 'Tactique supprimée.'))) return;
    await loadTactics(true); dropTac(); S.noStack = true; openView({ type: 'tactics' });
  },
});
