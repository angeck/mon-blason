// mypocketclub · éléments d'interface communs : logos, icônes, blason du club, en-tête, onglets, thème.
import { BRAND, CGU_VERSION } from '../config.js';
import { S, sb, esc, club, onColor, contrast, lum, initials, isActive, toValidate, myTeamIds, casquettes, store, hooks } from './core.js';

// ---------- Ballons (n° 97 · charte mypocketclub validée le 3 novembre 2026 · fichiers dans img/, copies de claude/logos/mypocketclub/) ----------
// Une seule famille, jaune et encre. Hors club, ou club d'un autre sport (ou omnisports) : ballon de la marque « étoile creuse » (n° 106) ;
// dans un club de basket, foot, volley ou rugby : le ballon du sport (en-tête, espaces, convocations, blason de secours, « o » du logo).
const BALLS = { 'Basket-ball': 'basket', 'Basketball': 'basket', 'Volley-ball': 'volley', 'Volleyball': 'volley', 'Football': 'foot', 'Rugby': 'rugby' };
export const BRAND_BALL = 'mypocketclub-etoile';
export const ballName = (sport) => (!sport ? BRAND_BALL : BALLS[sport] || (/basket/i.test(sport) ? 'basket' : /volley/i.test(sport) ? 'volley' : /foot/i.test(sport) ? 'foot' : /rugby/i.test(sport) ? 'rugby' : BRAND_BALL));
export const ballSrc = (sport) => `img/ballon-${ballName(sport)}.svg`;
export const ball = (size, sport) => `<img class="ball" src="${ballSrc(sport)}" width="${size}" height="${size}" alt="" aria-hidden="true" style="display:inline-block;vertical-align:middle">`;
// Mot-symbole « mypocketclub » : « my » en étiquette jaune inclinée, « p●cket » encre (ballon dans le « o »), « club » bleu, sans espace.
// Les tailles sont en em (règles de 04-jetons-design.css), le style est dans style.css (.wordmark).
export function wordmark(px, sport, ink = false) {
  return `<span class="wordmark${ink ? ' ink' : ''}" role="img" aria-label="${esc(BRAND.aria || BRAND.name)}" style="font-size:${px}px"><span class="my">my</span><span class="pocket">p${ball(Math.round(px * 0.62), sport)}cket</span><span class="club">club</span></span>`;
}

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
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
  crown: '<path d="M4 18h16M5 18L3.5 8l5 4L12 5l3.5 7 5-4L19 18"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', // n° 98 : directeur technique (ex-directeur sportif, n° 114)
  swap: '<path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/>', // 5.9.0 · n° 225 : changer de club
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

// ---------- Thème : en-tête mypocketclub, ou aux couleurs du club si le président l'a activé ----------
export function brandMode() { return !S.session || !S.me || !S.clubId || !isActive() || S.onb !== null || ['account', 'legal', 'cgu', 'creq', 'creqs', 'creqmail'].includes(S.view?.type); }
// 5.0.0 · n° 168 : thème clair, sombre, ou celui du téléphone (choix gardé sur l'appareil et dans le compte)
export const THEMES = [['auto', 'Comme mon téléphone'], ['clair', 'Clair'], ['sombre', 'Sombre']];
export const themeChoice = () => { const v = store.get('pc_theme'); return THEMES.some((t) => t[0] === v) ? v : 'auto'; };
export const isDark = () => { const c = themeChoice(); return c === 'sombre' || (c === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches); };
export function setThemeChoice(v) { store.set('pc_theme', v); const u = S.session?.user; if (u) { u.user_metadata = { ...(u.user_metadata || {}), theme: v }; sb.auth.updateUser({ data: { theme: v } }).catch(() => {}); } }
export function applyTheme(ouv = false) {
  const root = document.documentElement, mt = S.session?.user?.user_metadata?.theme;
  if (mt && THEMES.some((t) => t[0] === mt) && !store.get('pc_theme')) store.set('pc_theme', mt); // thème du compte, sur un nouvel appareil
  const ch = themeChoice(); if (ch === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', ch);
  root.classList.toggle('ouv', ouv);
  const c = club(), r = root.style, perso = !brandMode() && c?.custom_header;
  root.setAttribute('data-club-perso', perso ? 'on' : 'off');
  const bg = perso ? c.color1 : isDark() ? '#11162E' : '#2F5BFF';
  S.headerBg = bg; r.setProperty('--pc-entete', bg); r.setProperty('--pc-entete-texte', onColor(bg));
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = ouv ? '#11162E' : bg;
  document.title = BRAND.title || BRAND.name; // n° 91 : nom en minuscules, comme le logo
}

// ---------- En-tête ----------
export const accountBtn = () => `<button class="roundbtn" data-act="account" aria-label="Mon compte">${icon('user', 22, '#11162E')}</button>`;
export const backBtn = () => `<button class="roundbtn" data-act="back" aria-label="Retour">${icon('back', 22, '#11162E', 2.4)}</button>`;
// opts : { title, kicker, sub, back, tags[], brand }
// N° 27 : même en-tête partout. Bande du haut : (retour) · logo C · Mon compte, alignés ; dessous le club ; dessous le titre.
// Picto « Espace » (charte du 31 octobre) : quatre carrés aux symboles des rôles ; seulement pour qui a une fonction
const ESPACE_SVG = '<svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="12.5" height="12.5" rx="4" fill="#FFC93C"/><path d="M5 11.5V3.8l5 1.8-5 1.8" stroke="#11162E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="14.5" y="1" width="12.5" height="12.5" rx="4" fill="#C9F5E4"/><circle cx="20.75" cy="7.25" r="3" stroke="#0B5C43" stroke-width="1.5" fill="none"/><path d="M20.75 5.9v2.7" stroke="#0B5C43" stroke-width="1.5" stroke-linecap="round" fill="none"/><rect x="1" y="14.5" width="12.5" height="12.5" rx="4" fill="#DCE4FF"/><circle cx="7.25" cy="18.8" r="1.8" stroke="#2F5BFF" stroke-width="1.5" fill="none"/><path d="M4 24.5c0-2 1.4-3 3.25-3s3.25 1 3.25 3" stroke="#2F5BFF" stroke-width="1.5" stroke-linecap="round" fill="none"/><rect x="14.5" y="14.5" width="12.5" height="12.5" rx="4" fill="#11162E"/><path d="M20.75 16.6l3.2 1.2v2.8c0 1.9-1.3 3.2-3.2 3.8-1.9-.6-3.2-1.9-3.2-3.8v-2.8z" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round" fill="none"/></svg>';
// 5.9.0 · n° 224 : l'icône seule (le libellé de la 5.8.0 est retiré, le nom reste lu par les lecteurs d'écran) ; 5.1.0 : « Mes rôles » (n° 194, même nom que sur ordinateur) ; pastille = ce qui attend dans tous mes rôles (n° 190)
export const espaceBtn = () => { const n = hooks.rolesTotal ? hooks.rolesTotal() : 0; return `<button class="roundbtn roles" data-act="espace" aria-label="Mes rôles${n ? ' · ' + n + ' à traiter' : ''}">${ESPACE_SVG.replace(/width="30" height="30"/, 'width="24" height="24"')}${n ? `<span class="dot" aria-hidden="true">${n > 99 ? '99+' : n}</span>` : ''}</button>`; };
export const searchBtn = () => `<button class="roundbtn" data-act="csearch" aria-label="Chercher un club">${icon('search', 22, '#11162E', 2.2)}</button>`;
// opts : { title, kicker, sub, back, tags[], brand, role }
// N° 27 : même en-tête partout. Bande du haut : (retour) · logo C · loupe (n° 56) · Espace · Mon compte ;
// 5.2.1 : « Mes rôles » reste visible dans les sous-pages aussi (retour direct à ses rôles), sauf sur l'écran « Mes rôles » lui-même
// dans un espace : (retour) · Mon compte (n° 85 : plus de logo ; n° 99 : plus de pastille du rôle)
export function header(o = {}) {
  const c = club(), br = o.brand || brandMode(), sport = br ? null : (c?.sport || null); // hors club : ballon de la marque, étoile creuse (n° 106)
  const acc = S.session && S.me && S.view?.type !== 'account' && S.me.cgu_version === CGU_VERSION && !S.me.deleted_at; // n° 180
  const inClub = acc && S.clubId && isActive() && S.onb === null;
  let h = `<div class="band">${o.back ? backBtn() : ''}<span class="logo">${wordmark(22, sport)}</span>${acc && S.view?.type !== 'csearch' ? searchBtn() : ''}${inClub && S.view?.type !== 'espace' && casquettes().length ? espaceBtn() : ''}${acc ? accountBtn() : '<span style="width:44px"></span>'}</div>`;
  const tags = o.tags?.length ? `<div class="tags">${o.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : '';
  // N° 116 (alpha 4.1.0) : un seul bloc bleu dans les espaces : en-tête, puis qui (blason, équipe ou rôle, « club · saison »),
  // puis la rangée des casquettes, puis les onglets de l'espace. Chaque information n'apparaît qu'une fois.
  // N° 139 · ordinateur : la version réduite de l'en-tête (retour, logo, titre, onglets) est fabriquée au défilement (app.js)
  if (o.space) {
    h += `<div class="top">${c ? crest(c, 44) : ''}<div class="who sp"><b>${o.title || ''}</b>${o.under ? `<span>${esc(o.under)}</span>` : ''}</div></div>`;
    return `<header class="hd${o.tabs ? ' tabbed' : ''}">${h}${o.casq || ''}${o.tabs || ''}</header>`;
  }
  // 5.9.0 · n° 225 : le bouton « Changer de club » suit le nom du club, pour un compte présent dans plusieurs clubs
  const sw = inClub && (S.overview || []).some((x) => x.club_id !== S.clubId) ? `<button class="clubsw" data-act="clubsw" aria-label="Changer de club">${icon('swap', 16, 'currentColor', 2.2)}</button>` : '';
  if (!br && c) h += `<div class="top">${crest(c, 44)}<div class="who"><div class="nmrow"><b>${esc(c.name)}</b>${sw}</div><span>${esc(o.kicker || o.sub || '')}</span></div></div>`;
  else if (o.kicker) h += `<div class="kicker">${esc(o.kicker)}</div>`;
  return `<header class="hd${o.tabs ? ' tabbed' : ''}">${h}${o.title ? `<h1>${o.title}</h1>` : ''}${o.under ? `<span class="under">${esc(o.under)}</span>` : ''}${tags}${o.casq || ''}${o.tabs || ''}</header>`;
}
// N° 116 : la saison affichée sous le nom (« Boissy Basket 91 · saison 2026-2027 »)
export const clubSeason = (season) => [club()?.name, season ? 'saison ' + season : ''].filter(Boolean).join(' · ');

// ---------- Icônes des casquettes (n° 85, n° 98) ----------
export const casqIcon = (k, size = 20) => icon(k === 'coach' || String(k).startsWith('coach:') ? 'flag' : k === 'president' ? 'crown' : (k === 'f:Directeur technique' || k === 'f:Directeur sportif') ? 'target' : 'user', size);
// Écrans qui font partie d'un espace (le rôle ouvert est allumé dans « Mes rôles » sur ordinateur)
export const SPACE_VIEWS = ['espace', 'rub', 'fonctions', 'journal', 'timport', 'fview']; // n° 133 : l'espace d'une fonction ouvert par le président garde « Président » allumé (Mes rôles, sur ordinateur)

// ---------- Onglets ----------
const TABS = [['Accueil', 'home'], ['Agenda', 'cal'], ['Messages', 'msg'], ['Équipe', 'team'], ['Club', 'shield']];
const tabCounts = () => ({ Messages: Object.values(S.unread || {}).reduce((a, b) => a + b, 0), Agenda: hooks.toAnswer ? hooks.toAnswer() : 0 });
export function seeTab(i) { const t = TABS[i]?.[0], c = tabCounts(); if (t && c[t]) (S.tabSeen = S.tabSeen || {})[t] = c[t]; }
export function tabBar() {
  // 5.1.0 (n° 190) : les onglets ne comptent que ce qui touche le compte (messages non lus, réponses à donner) ;
  // les demandes à valider et les heures à vérifier passent sur le bouton « Mes rôles » et sur chaque rôle
  const counts = tabCounts(), seen = (S.tabSeen = S.tabSeen || {});
  // 5.2.1 : toucher un onglet efface sa pastille, que l'action soit faite ou non ; elle revient seulement si le nombre augmente
  Object.keys(counts).forEach((t) => { if (seen[t] > counts[t]) seen[t] = counts[t]; });
  return `<div class="tb"><nav aria-label="Onglets">${TABS.map(([t, ic], i) => {
    const cur = i === S.tab && !S.view, n = (counts[t] || 0) > (seen[t] || 0) ? counts[t] : 0;
    return `<button data-act="tab" data-i="${i}" ${cur ? 'aria-current="page"' : ''}><span class="ic">${icon(ic, 24, 'currentColor', cur ? 2.2 : 2)}</span><span>${t}</span>${n ? `<span class="n" aria-label="${n} ${t === 'Messages' ? 'non lus' : 'à répondre'}">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
  }).join('')}</nav>${rolesNav()}${hooks.bankNav ? hooks.bankNav() : ''}</div>`; // n° 227 : banque d'exercices sous « Mes rôles » (ordinateur)
}
// N° 104 · ordinateur : sous les onglets (consulter et répondre), un bloc « Mes rôles » (agir), un bouton par casquette ;
// il remplace le bouton aux quatre carrés et la rangée « Tes casquettes » (cachés sur grand écran par style.css).
// Sur téléphone et tablette étroite, ce bloc est caché : rien ne change.
function rolesNav() {
  const l = casquettes(); if (!l.length) return '';
  const inSpace = SPACE_VIEWS.includes(S.view?.type);
  return `<nav class="roles" aria-label="Mes rôles"><span class="rolestitle">Mes rôles</span>${l.map((x) => {
    const cur = inSpace && x.k === S.casq;
    return `<button data-act="casq" data-v="${esc(x.k)}" ${cur ? 'aria-current="page"' : ''}><span class="ic">${casqIcon(x.k, 22)}</span><span>${esc(x.label)}</span>${hooks.roleBadge ? hooks.roleBadge(x.k) : ''}</button>`; // n° 190
  }).join('')}</nav>`;
}

// ---------- Petits éléments ----------
export function dayBadge(iso, cls = '') {
  const d = new Date(iso);
  return `<span class="daybadge ${cls}" aria-hidden="true"><span>${esc(d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''))}</span><b>${d.getDate()}</b></span>`;
}
export const delBtn = (act, id, label, confirmLabel, armedNow, extra = '') => `<button class="btn danger ${armedNow ? 'armed' : ''}" data-act="${act}" data-id="${esc(id)}" ${extra}>${icon('trash', 20)}${esc(armedNow ? confirmLabel : label)}</button>`;
export const field = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
