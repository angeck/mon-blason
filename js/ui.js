// Pocket Club · éléments d'interface communs : logos, icônes, blason du club, en-tête, onglets, thème.
import { BRAND } from '../config.js';
import { S, esc, club, onColor, contrast, lum, initials, isActive, toValidate, myTeamIds, casquettes, store } from './core.js';

// ---------- Ballon (identique dans les deux logos ; seules les coutures changent selon le sport) ----------
const SEAMS = {
  'Basket-ball': 'M28 6V50M6 28H50M12 11C21 20 21 36 12 45M44 11C35 20 35 36 44 45',
  'Volley-ball': 'M9 21C20 26 33 24 43 9M26 6C22 18 27 31 41 43M11 41C21 33 34 35 49 30',
};
const ballInner = (sport) => `<circle cx="28" cy="28" r="25" fill="#FFC93C" stroke="#11162E" stroke-width="6"/><g fill="none" stroke="#11162E" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"><path d="${SEAMS[sport] || SEAMS['Basket-ball']}"/></g>`;
export const ball = (size, sport) => `<svg width="${size}" height="${size}" viewBox="0 0 56 56" aria-hidden="true">${ballInner(sport)}</svg>`;
// Logo C (mot-symbole) : quand il y a de la place
export function wordmark(px, sport) {
  const b = Math.round(px * 0.62);
  return `<span class="wordmark" role="img" aria-label="${esc(BRAND.name)}" style="font-size:${px}px">${esc(BRAND.word1)}${ball(b, sport)}${esc(BRAND.word2)}<span style="width:${Math.round(px * 0.22)}px"></span><span class="club">${esc(BRAND.word3)}</span></span>`;
}
// Logo E (symbole « P ballon ») : en-têtes serrés, icône, onglet
export const symbol = (size, sport, stem = '#11162E') => `<svg width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="${esc(BRAND.name)}"><rect x="10" y="6" width="13" height="44" rx="6.5" fill="${stem}"/><svg x="17" y="6" width="32" height="32" viewBox="0 0 56 56">${ballInner(sport)}</svg></svg>`;

// ---------- Icônes au trait ----------
const P = {
  home: '<path d="M4 11l8-7 8 7v9H4z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  calplus: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M12 13v4M10 15h4"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="10" r="2"/><path d="M17 15c2.2 0 4 1.8 4 4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  pin: '<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  sms: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
};
export const icon = (n, size = 22, stroke = 'currentColor', w = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

// ---------- Blason du club : logo dans l'écu, ou initiales aux couleurs du club ----------
// N° 37 : contour noir ou blanc pour faire ressortir le blason ; automatique selon le fond, ou choisi par le bureau
export function outlineColor(c, bg) {
  const m = c?.crest_outline || 'auto';
  if (m === 'aucun') return null; if (m === 'noir') return '#11162E'; if (m === 'blanc') return '#FFFFFF';
  const base = c?.logo ? c.crest_bg || '#FFFFFF' : '#FFFFFF';
  return lum(bg || '#2F5BFF') < 0.35 || lum(base) < 0.35 ? '#FFFFFF' : '#11162E';
}
export function crest(c, size = 44, bg) {
  const h = Math.round(size * 1.14), clip = 'clip-path:polygon(0 0,100% 0,100% 62%,50% 100%,0 62%)';
  let inner;
  if (c?.logo) inner = `<span class="ecu" style="width:${size}px;height:${h}px;background:${esc(c.crest_bg || '#FFFFFF')};${clip}"><img src="${esc(c.logo)}" alt="" style="width:78%;height:66%;object-fit:contain;margin-top:-10%"></span>`;
  else { const a = c?.color1 || '#2F5BFF'; inner = `<span class="ecu" style="width:${size}px;height:${h}px;background:#FFFFFF;${clip};color:${esc(contrast(a, '#FFFFFF') >= 3 ? a : '#11162E')};font-size:${Math.round(size * 0.36)}px"><span style="margin-top:-14%">${esc(initials(c?.name || 'PC'))}</span></span>`; }
  const o = outlineColor(c, bg || S.headerBg);
  if (!o) return `<span aria-hidden="true" style="flex:none;display:flex">${inner}</span>`;
  return `<span aria-hidden="true" style="flex:none;display:flex;align-items:center;justify-content:center;width:${size + 6}px;height:${h + 7}px;background:${o};${clip}">${inner}</span>`;
}

// ---------- Thème : en-tête Pocket Club, ou aux couleurs du club si le président l'a activé ----------
export function brandMode() { return !S.session || !S.me || !S.clubId || !isActive() || S.onb !== null || ['account', 'legal', 'cgu'].includes(S.view?.type); }
export function applyTheme() {
  const c = club(), r = document.documentElement.style, perso = !brandMode() && c?.custom_header;
  const bg = perso ? c.color1 : '#2F5BFF';
  S.headerBg = bg; r.setProperty('--pc-entete', bg); r.setProperty('--pc-entete-texte', onColor(bg));
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = bg;
  document.title = BRAND.name;
}

// ---------- En-tête ----------
export const accountBtn = () => `<button class="roundbtn" data-act="account" aria-label="Mon compte">${icon('user', 22, '#11162E')}</button>`;
export const backBtn = () => `<button class="roundbtn" data-act="back" aria-label="Retour">${icon('back', 22, '#11162E', 2.4)}</button>`;
// opts : { title, kicker, sub, back, tags[], brand }
// N° 27 : même en-tête partout. Bande du haut : (retour) · logo C · Mon compte, alignés ; dessous le club ; dessous le titre.
// Picto « Espace » (charte du 31 octobre) : quatre carrés aux symboles des rôles ; seulement pour qui a une fonction
const ESPACE_SVG = '<svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="12.5" height="12.5" rx="4" fill="#FFC93C"/><path d="M5 11.5V3.8l5 1.8-5 1.8" stroke="#11162E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="14.5" y="1" width="12.5" height="12.5" rx="4" fill="#C9F5E4"/><circle cx="20.75" cy="7.25" r="3" stroke="#0B5C43" stroke-width="1.5" fill="none"/><path d="M20.75 5.9v2.7" stroke="#0B5C43" stroke-width="1.5" stroke-linecap="round" fill="none"/><rect x="1" y="14.5" width="12.5" height="12.5" rx="4" fill="#DCE4FF"/><circle cx="7.25" cy="18.8" r="1.8" stroke="#2F5BFF" stroke-width="1.5" fill="none"/><path d="M4 24.5c0-2 1.4-3 3.25-3s3.25 1 3.25 3" stroke="#2F5BFF" stroke-width="1.5" stroke-linecap="round" fill="none"/><rect x="14.5" y="14.5" width="12.5" height="12.5" rx="4" fill="#11162E"/><path d="M20.75 16.6l3.2 1.2v2.8c0 1.9-1.3 3.2-3.2 3.8-1.9-.6-3.2-1.9-3.2-3.8v-2.8z" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round" fill="none"/></svg>';
export const espaceBtn = () => `<button class="roundbtn" data-act="espace" aria-label="Mes espaces">${ESPACE_SVG}</button>`;
export const searchBtn = () => `<button class="roundbtn" data-act="csearch" aria-label="Chercher un club">${icon('search', 22, '#11162E', 2.2)}</button>`;
// opts : { title, kicker, sub, back, tags[], brand, role }
// N° 27 : même en-tête partout. Bande du haut : (retour) · logo C · loupe (n° 56) · Espace · Mon compte ;
// dans un espace : (retour) · pastille du rôle · logo E · Mon compte (charte : logo E quand la place manque)
export function header(o = {}) {
  const c = club(), br = o.brand || brandMode(), sport = c?.sport;
  const acc = S.session && S.me && S.view?.type !== 'account' && S.me.cgu_version && !S.me.deleted_at;
  const inClub = acc && S.clubId && isActive() && S.onb === null;
  let h;
  if (o.role) h = `<div class="band">${o.back ? backBtn() : ''}<span class="rolepill">${esc(o.role)}</span><span style="flex:1"></span><span class="roundbtn" style="cursor:default">${symbol(28, sport)}</span>${acc ? accountBtn() : ''}</div>`;
  else h = `<div class="band">${o.back ? backBtn() : ''}<span class="logo">${wordmark(22, sport)}</span>${acc && S.view?.type !== 'csearch' ? searchBtn() : ''}${inClub && !o.back && casquettes().length ? espaceBtn() : ''}${acc ? accountBtn() : '<span style="width:44px"></span>'}</div>`;
  if (!br && c && !o.role) h += `<div class="top">${crest(c, 44)}<div class="who"><b>${esc(c.name)}</b><span>${esc(o.kicker || o.sub || '')}</span></div></div>`;
  else if (o.kicker) h += `<div class="kicker">${esc(o.kicker)}</div>`;
  const tags = o.tags?.length ? `<div class="tags">${o.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : '';
  return `<header class="hd">${h}${o.title ? `<h1>${o.title}</h1>` : ''}${o.under ? `<span class="under">${esc(o.under)}</span>` : ''}${tags}</header>`;
}

// ---------- Onglets ----------
const TABS = [['Accueil', 'home'], ['Agenda', 'cal'], ['Messages', 'msg'], ['Équipe', 'team'], ['Club', 'shield']];
export function tabBar() {
  const v = toValidate(), mine = myTeamIds();
  const counts = { Club: v.length, Équipe: v.filter((m) => mine.includes(m.team_id)).length, Messages: Object.values(S.unread || {}).reduce((a, b) => a + b, 0) };
  return `<div class="tb"><nav aria-label="Onglets">${TABS.map(([t, ic], i) => {
    const cur = i === S.tab && !S.view, n = counts[t] || 0;
    return `<button data-act="tab" data-i="${i}" ${cur ? 'aria-current="page"' : ''}><span class="ic">${icon(ic, 24, 'currentColor', cur ? 2.2 : 2)}</span><span>${t}</span>${n ? `<span class="n" aria-label="${n} ${t === 'Messages' ? 'non lus' : 'à valider'}">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
  }).join('')}</nav></div>`;
}

// ---------- Petits éléments ----------
export function dayBadge(iso, cls = '') {
  const d = new Date(iso);
  return `<span class="daybadge ${cls}" aria-hidden="true"><span>${esc(d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''))}</span><b>${d.getDate()}</b></span>`;
}
export const delBtn = (act, id, label, confirmLabel, armedNow, extra = '') => `<button class="btn danger ${armedNow ? 'armed' : ''}" data-act="${act}" data-id="${esc(id)}" ${extra}>${icon('trash', 20)}${esc(armedNow ? confirmLabel : label)}</button>`;
export const field = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
