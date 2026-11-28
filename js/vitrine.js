// mypocketclub · bêta 1.9.0 · n° 311, 312, 313 : vitrine publique d'un club (mypocketclub.fr/nom-du-club, ou vitrine.html?c=nom-du-club).
// Page légère, hors de l'application : elle lit vitrine_public (seulement ce que le club montre : jamais un nom de joueur,
// jamais une coordonnée) ; les deux formulaires passent par la fonction Edge « vitrine-demande » (Turnstile).
// Le président et le responsable vitrine connectés (même session que l'application) ont « Éditer la page » :
// ↑ ↓ et un œil sur chaque bloc, un œil sur les créneaux de chaque équipe, « On recrute » / « Complet ».
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, TURNSTILE_SITEKEY } from '../config.js';

// même rangement de la session que l'application (js/core.js) : la personne connectée dans l'application l'est ici
const area = () => { try { return localStorage.getItem('pc_remember') !== '0' ? localStorage : sessionStorage; } catch { return null; } };
const mem = {};
const storage = {
  getItem: (k) => { try { return area()?.getItem(k) ?? localStorage.getItem(k) ?? sessionStorage.getItem(k) ?? mem[k] ?? null; } catch { return mem[k] ?? null; } },
  setItem: (k, v) => { mem[k] = v; try { area().setItem(k, v); } catch { /* navigation privée */ } },
  removeItem: (k) => { delete mem[k]; try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* */ } },
};
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage } });

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;
const APP = document.baseURI; // racine de l'application (base posée par la page)
const arr = (x) => (Array.isArray(x) ? x : []);
const txt = (x) => (typeof x === 'string' ? x.trim() : '');

// ---------- blocs ----------
import { BLOCKS, orderOf } from './vitrine_blocs.js';
const LABEL = Object.fromEntries(BLOCKS);

// Cotisation : prise équipe par équipe dans les tarifs du trésorier (Club › Tarifs, jamais saisie dans la vitrine).
// Tarif particulier de l'équipe, sinon celui de sa catégorie ; équipes au même prix regroupées ; sans tarif, pas de ligne.
const eur = (n) => (+n).toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 }) + ' €';
function feeRows(d) {
  const by = new Map();
  arr(d.teams).filter((t) => t.fee != null).forEach((t) => { const k = +t.fee; by.set(k, [...(by.get(k) || []), t.name]); });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, names]) => [names.join(' · '), eur(k)]);
}
// Écusson : même dessin que crest() de js/ui.js (n° 37 et n° 92). La vitrine est une page à part : elle ne charge pas ui.js.
const lum = (hex) => { const n = parseInt(String(hex || '#2F5BFF').slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
function ecu(c, size, bg) {
  const h = Math.round(size * 1.14), clip = 'clip-path:polygon(0 0,100% 0,100% 62%,50% 100%,0 62%)', m = c.crest_outline || 'auto', base = c.crest_bg || '#FFFFFF';
  const o = m === 'aucun' ? null : m === 'noir' ? '#11162E' : m === 'blanc' ? '#FFFFFF' : lum(bg) < 0.35 || lum(base) < 0.35 ? '#FFFFFF' : '#11162E';
  const inner = `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${h}px;background:${esc(base)};${clip}"><img src="${esc(c.logo)}" alt="Blason du club" style="width:78%;height:66%;object-fit:contain;margin-top:-10%"></span>`;
  return `<span class="vecu" style="flex:none;display:flex;align-items:center;justify-content:center;${o ? `width:${size + 6}px;height:${h + 7}px;background:${o};${clip}` : ''}">${inner}</span>`;
}
const V = { d: null, slug: '', ed: false, draft: null, open: 'fees', form: null, busy: false, captcha: null };

function slugOf() {
  const q = new URLSearchParams(location.search).get('c');
  if (q) return q.trim().toLowerCase();
  const segs = location.pathname.split('/').filter(Boolean);
  const last = decodeURIComponent(segs[segs.length - 1] || '').toLowerCase();
  return last.replace(/\.html$/, '');
}

function toast(m) { const t = $('#vtoast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000); }

// couleur du texte posée sur la couleur du club (contraste)
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (1.05) / (L + 0.05) >= 4.5 ? '#FFFFFF' : '#11162E';
}

const ICON = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', link: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>',
};
const ic = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// ---------- planning ----------
const hmOf = (min) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`; };
const hmC = (min) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`; };
const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const PALETTE = ['#2F5BFF', '#0B5C43', '#8A5A00', '#6A2FD6', '#A52A12', '#11162E'];
function gymColors(slots, club) {
  const names = [...new Set(slots.map((s) => s.gym || 'Lieu à préciser'))];
  const pal = [club, ...PALETTE.filter((c) => c.toLowerCase() !== String(club).toLowerCase())];
  return Object.fromEntries(names.map((n, i) => [n, pal[i % pal.length]]));
}
function planning(d) {
  const slots = arr(d.slots), teams = Object.fromEntries(arr(d.teams).map((t) => [t.id, t])), club = d.club.color1;
  const hidden = arr(d.teams).filter((t) => t.slots_hidden).map((t) => t.name);
  if (!slots.length) return `<div class="carte" style="padding:20px"><p class="empty">${hidden.length ? 'Horaires sur demande : écris au club.' : 'Le planning de la saison sera bientôt en ligne.'}</p></div>`;
  const col = gymColors(slots, club), days = [...new Set(slots.map((s) => +s.day))].sort();
  const show = [1, 2, 3, 4, 5].concat(days.filter((x) => x > 5)).filter((x) => days.includes(x) || x <= 5);
  const t0 = Math.floor(Math.min(...slots.map((s) => toMin(s.start))) / 60), t1 = Math.ceil(Math.max(...slots.map((s) => toMin(s.start) + (+s.min || 90))) / 60);
  const pxH = innerWidth < 960 ? 44 : 52, H = (t1 - t0) * pxH;
  const short = innerWidth < 960;
  const cal = `<div class="carte cal"><div class="calrow"><div class="ax"></div>${show.map((x) => `<div class="calday"><h4>${short ? DAYS[x - 1].slice(0, 3) + '.' : DAYS[x - 1]}</h4></div>`).join('')}</div>
    <div class="calrow"><div class="ax" style="height:${H}px">${Array.from({ length: t1 - t0 }, (_, i) => `<span class="calax" style="top:${i * pxH - 8}px">${t0 + i} h</span>`).join('')}</div>
    ${show.map((x) => `<div class="calday"><div class="calcol" style="height:${H}px">${slots.filter((s) => +s.day === x).map((s) => { const a = toMin(s.start), b = a + (+s.min || 90);
      return `<div class="slot" style="top:${(a / 60 - t0) * pxH + 2}px;height:${((b - a) / 60) * pxH - 4}px;background:${col[s.gym || 'Lieu à préciser']}"><b>${esc(teams[s.team]?.name || 'Équipe')}</b><span>${hmC(a)}–${hmC(b)}</span></div>`; }).join('')}</div></div>`).join('')}</div></div>`;
  const list = `<div class="carte callist">${days.map((x) => `<div class="d"><b>${DAYS[x - 1]}</b>${slots.filter((s) => +s.day === x).map((s) => { const a = toMin(s.start), b = a + (+s.min || 90);
    return `<div class="l"><span class="dot" style="background:${col[s.gym || 'Lieu à préciser']}"></span><span style="flex:0 0 130px">${hmOf(a)} – ${hmOf(b)}</span><b style="flex:1;min-width:0">${esc(teams[s.team]?.name || 'Équipe')}</b></div>`; }).join('')}</div>`).join('')}</div>`;
  const legend = `<div class="legend">${Object.entries(col).map(([g, c]) => `<span><span class="dot" style="background:${c}"></span>${esc(g)}</span>`).join('')}${hidden.length ? `<span>${esc(hidden.join(', '))} : horaires sur demande</span>` : ''}</div>`;
  return cal + list + legend;
}
function teamsBlock(d) {
  const ts = arr(d.teams); if (!ts.length) return '';
  const ed = V.ed, st = (t) => (ed ? V.draft.team_status[t.id] || 'recrute' : t.status), sh = (t) => (ed ? V.draft.slots_hidden.includes(t.id) : t.slots_hidden);
  return `<h3 class="h3">Nos équipes</h3><div class="teams">${ts.map((t) => `<div class="carte team"><div class="g"><b>${esc(t.name)}</b><small>${t.players ? `${t.players} joueur${t.players > 1 ? 's' : ''}` : esc(t.category || '')}${sh(t) && !ed ? ' · horaires sur demande' : ''}</small></div>
    ${ed ? `<button class="pill ${st(t) === 'complet' ? 'ko' : 'ok'}" style="border:0;cursor:pointer" data-a="status" data-id="${t.id}" title="Changer">${st(t) === 'complet' ? 'Complet' : 'On recrute'}</button><button class="rb" data-a="slots" data-id="${t.id}" aria-pressed="${sh(t)}" aria-label="${sh(t) ? 'Montrer les créneaux de cette équipe' : 'Cacher les créneaux de cette équipe'}">${ic(sh(t) ? 'eyeoff' : 'eye', 18)}</button>`
      : `<span class="pill ${st(t) === 'complet' ? 'ko' : 'ok'}">${st(t) === 'complet' ? 'Complet' : 'On recrute'}</span>`}</div>`).join('')}</div>`;
}
const when = (iso) => { const d = new Date(iso); const s = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }); const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ').replace(/ h 00$/, ' h'); return `${s.charAt(0).toUpperCase() + s.slice(1)} · ${h}`; };

// ---------- contenu de chaque bloc (vide = rien en public, « à remplir » en édition) ----------
function body(k, d) {
  const c = d.content || {}, club = d.club;
  if (k === 'presentation') {
    const p = txt(c.presentation), vals = arr(c.values).map(txt).filter(Boolean);
    if (!p && !vals.length) return '';
    return `<div class="grid2" style="align-items:start"><div><h2 class="h2">Le club</h2><p style="margin:0" class="doux">${esc(p)}</p></div>${vals.length ? `<div class="chips" style="align-content:flex-start">${vals.map((v) => `<span class="chip">${esc(v)}</span>`).join('')}</div>` : '<div></div>'}</div>`;
  }
  if (k === 'planning') return `<div class="vhead"><div><h2 class="h2" style="margin-bottom:4px">Planning de la semaine</h2><div class="doux" style="font-size:15px">Entraînements de la saison ${esc(d.season)}</div></div></div>${planning(d)}${teamsBlock(d)}`;
  if (k === 'matchs') {
    const m = arr(d.matches); if (!m.length) return '';
    return `<h2 class="h2">Viens nous encourager</h2><div class="carte rows">${m.map((x) => `<div class="r"><div class="a">${esc(when(x.at))}</div><div class="b">${esc(x.teams || x.type)}${x.opponents ? ` reçoi${/·/.test(x.teams || '') ? 'vent' : 't'} ${esc(x.opponents)}` : ` · ${esc(x.type)}`}</div><div class="doux" style="font-size:14px">${esc(x.gym || '')}</div></div>`).join('')}</div>`;
  }
  if (k === 'resultats') {
    if (d.results == null) return `<h2 class="h2">Derniers résultats</h2><div class="carte lock"><div class="flou" aria-hidden="true"><div>Seniors · 78 – 64 · Victoire</div><div>U13 · 42 – 45 · Défaite</div><div>U11 · 30 – 22 · Victoire</div></div><div class="sur"><strong style="font-size:18px">Les résultats sont réservés aux membres</strong><div class="vbtns" style="justify-content:center"><a class="btn bleu petit" href="${esc(APP)}">Se connecter</a><a class="btn blanc petit" href="${esc(APP)}">Devenir supporteur</a></div></div></div>`;
    const r = arr(d.results); if (!r.length) return `<h2 class="h2">Derniers résultats</h2><div class="carte" style="padding:20px"><p class="empty">Pas encore de résultat cette saison.</p></div>`;
    return `<h2 class="h2">Derniers résultats</h2><div class="carte rows">${r.map((x) => arr(x.scores).map((l) => { const v = +l.us > +l.them ? 'Victoire' : +l.us < +l.them ? 'Défaite' : 'Nul';
      return `<div class="r"><div class="a">${esc(when(x.at).split(' · ')[0])}</div><div class="b">${esc(x.teams || '')} · <b>${+l.us} – ${+l.them}</b> ${l.opponent ? 'contre ' + esc(l.opponent) : ''}</div><span class="pill ${v === 'Défaite' ? 'ko' : 'ok'}">${v}</span></div>`; }).join('')).join('')}</div>`;
  }
  if (k === 'gymnases') {
    const g = arr(d.gyms); if (!g.length) return '';
    const col = gymColors(arr(d.slots), club.color1);
    return `<h2 class="h2">Nos gymnases</h2><div class="grid2">${g.map((x) => { const q = encodeURIComponent([x.name, x.address].filter(Boolean).join(', '));
      return `<div class="carte gym"><a class="map" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ic('pin', 22)}Voir sur la carte</a><div class="in">${col[x.name] ? `<span class="dot" style="background:${col[x.name]}"></span>` : ''}<div style="flex:1;min-width:0"><b>${esc(x.name)}</b><div class="doux" style="font-size:14px">${esc(x.address || '')}</div></div><a href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank" rel="noopener" style="font-weight:700;text-decoration:none;flex:none">Itinéraire</a></div></div>`; }).join('')}</div>`;
  }
  if (k === 'inscrire') {
    const tiles = [
      ['fees', 'Cotisation', feeRows(d)],
      ['docs', 'Pièces à fournir', arr(c.docs).map(txt).filter(Boolean).map((x) => [x, ''])],
      ['when', 'Quand ?', arr(c.when).map(txt).filter(Boolean).map((x) => [x, ''])],
    ].filter((t) => t[2].length);
    if (!tiles.length) return '';
    const sum = (t) => (t[0] === 'fees' ? (t[2].length > 1 ? `${t[2].length} tarifs selon l’âge` : t[2][0].join(' · ')) : t[2][0][0] + (t[2].length > 1 ? '…' : ''));
    return `<h2 class="h2">S’inscrire</h2><div class="grid3">${tiles.map((t) => `<div class="carte acc ${V.open === t[0] ? 'on' : ''}"><button data-a="acc" data-id="${t[0]}" aria-expanded="${V.open === t[0]}"><span class="g"><b>${t[1]}</b><span class="doux" style="font-size:15px">${esc(sum(t))}</span></span><span class="chev">${ic('chev', 18)}</span></button>${V.open === t[0] ? `<div class="det">${t[2].map(([a, b]) => `<div><span>${esc(a)}</span>${b ? `<b>${esc(b)}</b>` : ''}</div>`).join('')}</div>` : ''}</div>`).join('')}</div>`;
  }
  if (k === 'cherche') {
    const w = arr(c.wanted).map(txt).filter(Boolean); if (!w.length) return '';
    return `<div class="carte cherche"><div style="flex:1 1 280px"><h2 class="h2" style="margin-bottom:8px">On cherche du monde</h2><div style="font-size:15px">${w.map((x) => '· ' + esc(x)).join('<br>')}</div></div><button class="btn encre" data-a="form" data-k="ecrire" data-s="Aider le club">Je veux aider</button></div>`;
  }
  if (k === 'palmares') {
    const p = arr(c.palmares).filter((x) => txt(x?.[2]) || txt(x?.[1])); if (!p.length) return '';
    return `<h2 class="h2">Palmarès</h2><div class="carte rows">${p.map((x) => `<div class="r"><span class="doux" style="flex:0 0 110px;font-size:14px">${esc(txt(x[0]))}</span><b style="flex:0 0 140px">${esc(txt(x[1]))}</b><span style="flex:1 1 200px">${esc(txt(x[2]))}</span></div>`).join('')}</div>`;
  }
  if (k === 'partenaires') {
    const p = arr(c.partners).map(txt).filter(Boolean); if (!p.length) return '';
    const ini = (s) => s.split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || s[0].toUpperCase();
    return `<h2 class="h2">Ils soutiennent le club</h2><div class="grid4">${p.map((x) => `<div class="carte partner"><i>${esc(ini(x))}</i><span style="font-weight:700;font-size:15px">${esc(x)}</span></div>`).join('')}</div>`;
  }
  if (k === 'liens') {
    const l = arr(c.links).filter((x) => /^https:\/\//i.test(txt(x?.[1]))); if (!l.length) return '';
    return `<h2 class="h2">Nous suivre</h2><div class="chips">${l.map((x) => `<a class="btn blanc petit" href="${esc(txt(x[1]))}" target="_blank" rel="noopener nofollow">${ic('link', 18)}${esc(txt(x[0]) || 'Lien')}</a>`).join('')}</div>`;
  }
  if (k === 'rejoindre') return `<div class="rejoindre"><div style="flex:1 1 260px"><h2 class="h2" style="margin-bottom:6px">Envie de nous rejoindre ?</h2><div style="opacity:.92">Ta demande arrive directement au club.</div></div><button class="btn jaune" data-a="form" data-k="essai">Venir faire un essai</button><button class="btn contour" data-a="form" data-k="ecrire">Écrire au club</button></div>`;
  return '';
}

function blocks(d) {
  const order = V.ed ? V.draft.order : orderOf(d.layout), hidden = new Set(V.ed ? V.draft.hidden : arr(d.layout?.hidden));
  return order.map((k, i) => {
    const h = body(k, d), off = hidden.has(k);
    if (!V.ed) return off || !h ? '' : `<section class="blk" data-b="${k}">${h}</section>`;
    const bar = `<div class="bar"><span class="l">${esc(LABEL[k])}${off ? ' <em>· caché du public</em>' : ''}</span><button class="rb" data-a="up" data-k="${k}" aria-label="Monter le bloc" ${i ? '' : 'disabled'}>${ic('up')}</button><button class="rb" data-a="down" data-k="${k}" aria-label="Descendre le bloc" ${i < order.length - 1 ? '' : 'disabled'}>${ic('down')}</button><button class="rb" data-a="eye" data-k="${k}" aria-pressed="${off}" aria-label="${off ? 'Montrer le bloc' : 'Cacher le bloc'}">${ic(off ? 'eyeoff' : 'eye')}</button></div>`;
    return `<section class="blk ed ${off ? 'off' : ''}" data-b="${k}">${bar}${h || `<p class="empty">Rien à montrer pour l’instant : à remplir dans « Mes rôles › Vitrine › Textes et infos ».</p>`}</section>`;
  }).join('');
}

function page() {
  const d = V.d, c = d.club, txtc = inkOn(c.color1);
  document.documentElement.style.setProperty('--club', c.color1);
  document.documentElement.style.setProperty('--club-txt', txtc);
  document.title = c.name + ' · mypocketclub';
  $('meta[name=theme-color]')?.setAttribute('content', c.color1);
  const ball = c.sport === 'Volley-ball' ? 'img/ballon-volley.svg' : 'img/ballon-basket.svg';
  // Blason du club dans son écusson, comme dans l'appli et sur la convocation (même forme, même fond, même contour) ; sans logo : ballon mpc
  const crest = c.logo ? ecu(c, 76, c.color1) : `<div class="vblason"><img src="${ball}" alt=""></div>`;
  const n = d.counts || {}, cc = d.content || {};
  const url = (location.host + location.pathname).replace(/\/$/, '');
  const lead = txt(cc.lead) || `Le ${c.sport === 'Volley-ball' ? 'volley' : 'basket'} pour tout le monde${c.city ? ', à ' + c.city : ''}. Viens essayer avant de t’inscrire.`;
  const sub = [c.sport === 'Volley-ball' ? 'Volley' : 'Basket', c.city ? `${c.city}${c.postal_code ? ' (' + String(c.postal_code).slice(0, 2) + ')' : ''}` : ''].filter(Boolean).join(' · ');
  const edbar = V.ed ? `<div class="vedbar"><div class="wrap"><div class="t"><strong style="font-family:var(--titre)">Mode édition</strong><span> · ↑ ↓ pour l’ordre, l’œil pour cacher. L’en-tête et le bas de page restent fixes.</span></div><button class="btn contour petit" data-a="cancel">Annuler</button><button class="btn jaune petit" data-a="save" ${V.busy ? 'disabled' : ''}>Enregistrer</button></div></div>` : '';
  const pre = !d.enabled ? '<div class="preview">Aperçu : la vitrine n’est pas encore activée, seuls le président et le responsable la voient.</div>' : '';
  $('#vit').innerHTML = `${edbar}${pre}<header class="vhd ${txtc === '#11162E' ? 'ink' : ''}"><div class="wrap"><div class="vtop"><span class="url">${esc(url)}</span>${d.can_edit && !V.ed ? '<button class="btn contour petit" data-a="edit" style="min-height:40px">Éditer la page</button>' : ''}${d.logged ? '' : `<a href="${esc(APP)}">Se connecter</a>`}</div>
    <div class="vhero"><div class="txt"><div class="vid">${crest}<div style="font-size:15px;opacity:.9">${esc(sub)}${txt(cc.founded) ? `<br>Club fondé en ${esc(txt(cc.founded))}` : ''}</div></div>
    <h1 class="vh1">${esc(c.name)}</h1><p class="vlead">${esc(lead)}</p><div class="vbtns"><button class="btn jaune" data-a="form" data-k="essai">Venir faire un essai</button><button class="btn contour" data-a="form" data-k="ecrire">Écrire au club</button></div></div>
    <div class="vnums"><div class="vnum"><b>${+n.teams || 0}</b><span>équipe${+n.teams > 1 ? 's' : ''}</span></div><div class="vnum"><b>${+n.players || 0}</b><span>licencié${+n.players > 1 ? 's' : ''}</span></div><div class="vnum"><b>${+n.gyms || 0}</b><span>gymnase${+n.gyms > 1 ? 's' : ''}</span></div></div></div></div></header>
    <main class="wrap vmain">${blocks(d)}</main>
    <footer class="vft"><div class="wrap"><div class="by">Propulsé par <a href="https://mypocketclub.fr" aria-label="my pocket club" class="wm" style="color:#FFFFFF"><span class="my">my</span>p<img src="img/ballon-mypocketclub-etoile.svg" alt="">cket<span class="cl">club</span></a></div><a href="https://mypocketclub.fr">Teste gratuitement pour ton club</a><small><a href="${esc(APP)}" style="color:#A9AFC9;font-weight:400">Vos données · Mentions légales</a></small></div></footer>
    ${V.form ? formHtml() : ''}`;
  if (V.form) mountCaptcha();
}

// ---------- formulaires ----------
function formHtml() {
  const f = V.form, d = V.d, essai = f.k === 'essai', y = new Date().getFullYear();
  const teams = arr(d.teams), open = teams.filter((t) => t.status !== 'complet'), list = open.length ? open : teams;
  if (f.done) return `<div class="vmodal" role="dialog" aria-modal="true" aria-labelledby="vft"><div class="vform"><div class="fh"><button class="x" data-a="close" aria-label="Fermer">${ic('x')}</button><strong>${esc(d.club.name)}</strong></div><div class="fb ok"><h2 id="vft">Merci !</h2><p class="doux" style="margin:0">${essai ? 'Ta demande d’essai est arrivée au club. Il te répond vite.' : 'Ton message est arrivé au club. Il te répond vite.'}</p><button class="btn bleu" data-a="close">Fermer</button></div></div></div>`;
  return `<div class="vmodal" role="dialog" aria-modal="true" aria-labelledby="vft"><form class="vform" id="vf"><div class="fh"><button type="button" class="x" data-a="close" aria-label="Fermer">${ic('x')}</button><strong>${esc(d.club.name)}</strong></div><div class="fb">
    <div><h2 id="vft">${essai ? 'Venir faire un essai' : 'Écrire au club'}</h2><p class="doux" style="margin:0;font-size:15px">${essai ? 'Quelques séances pour découvrir le club. Le nom de l’enfant n’est pas demandé ici.' : 'Une question, une envie d’aider ou de devenir partenaire ? Écris-nous.'}</p></div>
    ${essai ? `<div><label class="lab" for="vteam">Pour quelle équipe ?</label><select id="vteam" name="team"><option value="">Je ne sais pas</option>${list.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>${open.length && open.length < teams.length ? '<div class="doux" style="font-size:13px;margin-top:6px">Seules les équipes qui recrutent sont proposées.</div>' : ''}</div>
      <div><label class="lab" for="vbirth">Année de naissance du joueur ou de la joueuse</label><select id="vbirth" name="birth"><option value="">Choisir…</option>${Array.from({ length: y - 1949 - 3 }, (_, i) => y - 3 - i).map((a) => `<option>${a}</option>`).join('')}</select></div>` : ''}
    <div><label class="lab" for="vname">Ton prénom et ton nom</label><input id="vname" name="name" type="text" maxlength="80" autocomplete="name" required placeholder="Ex. Camille Dupont"></div>
    <div><label class="lab" for="vcontact">${essai ? 'Téléphone ou e-mail' : 'Ton e-mail ou ton téléphone'}</label><input id="vcontact" name="contact" type="text" maxlength="120" autocomplete="email" required placeholder="Pour que le club te réponde"></div>
    ${essai ? '' : `<div><label class="lab" for="vsubj">C’est à propos de…</label><select id="vsubj" name="subject">${['Une question', 'Aider le club', 'Devenir partenaire', 'Autre chose'].map((s) => `<option ${f.s === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>`}
    <div><label class="lab" for="vmsg">${essai ? 'Un mot pour le club (facultatif)' : 'Ton message'}</label><textarea id="vmsg" name="message" maxlength="1000" ${essai ? '' : 'required'} placeholder="${essai ? 'Ex. il a déjà joué deux ans dans un autre club' : 'Écris ton message ici'}"></textarea></div>
    <label class="chk"><input type="checkbox" name="consent" required><span>J’accepte que le club me recontacte. Ma demande est gardée 3 mois. <a href="${esc(APP)}" target="_blank" rel="noopener">Vos données</a></span></label>
    ${TURNSTILE_SITEKEY ? '<div id="ts" class="ts"></div>' : ''}
    <button class="btn jaune" type="submit" ${V.busy ? 'disabled' : ''}>${V.busy ? 'Envoi…' : essai ? 'Envoyer ma demande d’essai' : 'Envoyer mon message'}</button>
    <div class="info">${ic('info', 18)}<span>${essai ? 'Ta demande arrive au club, dans mypocketclub et par e-mail. Aucune coordonnée du club n’est affichée.' : 'Ton message arrive au club, dans mypocketclub et par e-mail.'}</span></div>
  </div></form></div>`;
}
let tsW = null;
async function mountCaptcha() {
  const box = document.getElementById('ts'); if (!TURNSTILE_SITEKEY || !box || box.dataset.on) return;
  box.dataset.on = '1';
  if (!window.turnstile) await new Promise((ok) => { const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); });
  if (!window.turnstile || !document.body.contains(box)) return;
  V.captcha = null;
  tsW = window.turnstile.render(box, { sitekey: TURNSTILE_SITEKEY, language: 'fr', appearance: 'interaction-only', callback: (t) => { V.captcha = t; }, 'expired-callback': () => { V.captcha = null; } });
}
async function send(fd) {
  if (TURNSTILE_SITEKEY && !V.captcha) return toast('Vérification anti-robot en cours : patiente une seconde, puis réessaie.');
  const tok = V.captcha; V.busy = true;
  const keep = Object.fromEntries(fd); page(); refill(keep);
  try {
    const { data, error } = await sb.functions.invoke('vitrine-demande', { body: { slug: V.slug, kind: V.form.k, team: keep.team || null, birth: keep.birth ? +keep.birth : null, name: keep.name, contact: keep.contact, subject: keep.subject || '', message: keep.message || '', consent: !!keep.consent, captcha: tok } });
    let why = ''; if (error) { try { why = (await error.context?.json?.())?.erreur || ''; } catch { why = ''; } }
    if (error || !data?.envoye) { toast(why || 'Demande pas envoyée : réessaie plus tard.'); V.busy = false; V.captcha = null; try { if (tsW !== null) window.turnstile.reset(tsW); } catch { /* */ } page(); refill(keep); return; }
    V.form.done = true;
  } catch { toast('Demande pas envoyée : réessaie plus tard.'); }
  V.busy = false; V.captcha = null; page();
}
function refill(v) { const f = $('#vf'); if (!f) return; Object.entries(v).forEach(([k, x]) => { const el = f.elements[k]; if (!el) return; if (el.type === 'checkbox') el.checked = !!x; else el.value = x; }); }

// ---------- édition ----------
function startEdit() {
  const d = V.d;
  V.draft = { order: orderOf(d.layout), hidden: arr(d.layout?.hidden).filter((k) => LABEL[k]), slots_hidden: arr(d.teams).filter((t) => t.slots_hidden).map((t) => t.id),
    team_status: Object.fromEntries(arr(d.teams).map((t) => [t.id, t.status === 'complet' ? 'complet' : 'recrute'])) };
  V.ed = true; page(); scrollTo(0, 0);
}
async function save() {
  V.busy = true; page();
  const d = V.d, ts = Object.fromEntries(Object.entries(V.draft.team_status).filter(([, v]) => v === 'complet'));
  const { error } = await sb.rpc('vitrine_save', { p_club: d.club.id, p_patch: { layout: { order: V.draft.order, hidden: V.draft.hidden }, slots_hidden: V.draft.slots_hidden, team_status: ts } });
  V.busy = false;
  if (error) { toast(error.message || 'Pas enregistré : réessaie.'); page(); return; }
  V.ed = false; toast('Vitrine enregistrée.'); await load();
}

// ---------- actions ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, k = b.dataset.k, id = b.dataset.id;
  if (a === 'form') { V.form = { k, s: b.dataset.s || '' }; V.captcha = null; tsW = null; page(); setTimeout(() => $('#vf select, #vf input')?.focus(), 30); return; }
  if (a === 'close') { V.form = null; page(); return; }
  if (a === 'acc') { V.open = V.open === id ? null : id; page(); return; }
  if (a === 'edit') { startEdit(); return; }
  if (a === 'cancel') { V.ed = false; V.draft = null; page(); return; }
  if (a === 'save') { save(); return; }
  if (!V.ed) return;
  const o = V.draft.order, i = o.indexOf(k);
  if (a === 'up' && i > 0) { [o[i - 1], o[i]] = [o[i], o[i - 1]]; }
  else if (a === 'down' && i >= 0 && i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]]; }
  else if (a === 'eye') { const h = V.draft.hidden; V.draft.hidden = h.includes(k) ? h.filter((x) => x !== k) : [...h, k]; }
  else if (a === 'slots') { const s = V.draft.slots_hidden; V.draft.slots_hidden = s.includes(id) ? s.filter((x) => x !== id) : [...s, id]; }
  else if (a === 'status') { V.draft.team_status[id] = V.draft.team_status[id] === 'complet' ? 'recrute' : 'complet'; }
  else return;
  const y = scrollY; page(); scrollTo(0, y);
  document.querySelector(`[data-b="${k}"] [data-a="${a}"]`)?.focus();
});
document.addEventListener('submit', (e) => { if (e.target.id !== 'vf') return; e.preventDefault(); send(new FormData(e.target)); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && V.form) { V.form = null; page(); } });
let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (V.d && !V.form) page(); }, 200); });

function notFound() {
  document.title = 'Hors-jeu ! · mypocketclub';
  $('#vit').innerHTML = `<div class="v404"><h1>4<img src="img/ballon-mypocketclub-etoile.svg" alt="0">4</h1><b style="font-family:var(--titre);font-size:28px">Hors-jeu !</b><p>Cette page n’existe pas, ou la vitrine de ce club n’est pas ouverte.</p><a class="btn jaune" href="${esc(APP)}">Retour à l’accueil</a><p style="font-size:14px">Une question ? <a href="mailto:contact@mypocketclub.fr" style="color:#FFC93C">contact@mypocketclub.fr</a></p></div>`;
}
async function load() {
  V.slug = slugOf();
  if (!SLUG.test(V.slug)) return notFound();
  const { data, error } = await sb.rpc('vitrine_public', { p_slug: V.slug });
  if (error || !data) return notFound();
  V.d = data;
  if (new URLSearchParams(location.search).get('edit') === '1' && data.can_edit && !V.ed) { startEdit(); return; }
  page();
}
load();
