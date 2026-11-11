// mypocketclub · connexion, inscription, conditions, premier club (créer ou rejoindre), textes légaux.
import { contactCardHtml } from './club.js'; // n° 122
import { BRAND, VERSION, CGU_VERSION, TURNSTILE_SITEKEY } from '../config.js';
import { notListedLine } from './v37.js';
import { S, sb, esc, run, toast, render, refresh, store, remember, fl, ROLES, JOIN_ROLES, SPORTS, FONCTIONS, niceFirst, niceLast, lum, onColor, isActive, club, ACTIONS, FORMS, INPUTS, CHANGES } from './core.js';
import { header, wordmark, crest, field, icon } from './ui.js';
import { unlinkPush } from './notif.js';
import { legalBody, legalTitle, legalLinks, LEGAL } from './legal.js';

// ---------- Textes légaux (n° 175, alpha 4.9.0) : js/legal.js ; ici, les écrans et les accords ----------
export const legalScreen = () => { const id = S.view?.id; return header({ back: true, kicker: id ? 'Mentions et données' : 'Informations', title: esc(legalTitle(id)), brand: true }) + `<main class="bd legal">${legalBody(id)}</main>`; };
// N° 180 : deux accords facultatifs, jamais cochés d'avance à l'inscription ; modifiables dans Mon compte
export const consentBoxes = (img = false, opt = false) => `<label class="check"><input type="checkbox" name="image" ${img ? 'checked' : ''}><span><b>Droit à l'image (facultatif)</b><br><span class="det">J'accepte que mon club publie des photos ou vidéos où j'apparais. Pour un enfant, l'accord se donne sur sa fiche.</span></span></label>
  <label class="check"><input type="checkbox" name="optin" ${opt ? 'checked' : ''}><span><b>E-mails d'information (facultatif)</b><br><span class="det">Rappels, nouveautés, relances. Les e-mails nécessaires (convocation, sécurité, changement d'un rendez-vous) partent toujours.</span></span></label>`;
const cguBox = () => `<label class="check"><input type="checkbox" name="cgu" required><span>J'ai lu et j'accepte les <button type="button" class="btn link inl" data-act="legal" data-v="cgu">conditions d'utilisation</button> <b>(obligatoire)</b></span></label>`;
function signupExtras() {
  return `<div class="card pale"><div class="kick">Tes données</div><p class="note" style="color:var(--pc-texte-ecran)">Ton club organise sa vie (équipes, présences, messages) avec ${esc(BRAND.name)}, qui héberge les données pour lui, dans l'Union européenne. Jamais de publicité ni de revente. Tu peux consulter, corriger ou supprimer tes données depuis « Mon compte ».</p><button type="button" class="btn small ghost" data-act="legal" data-v="donnees">Lire « Vos données »</button></div>
  ${cguBox()}
  ${consentBoxes()}`;
}

// Liens en bas des écrans publics (connexion, inscription, accueil)
const legalFoot = () => `<p class="legal-foot"><button class="btn link" data-act="legal" data-v="mentions">Mentions légales</button><span aria-hidden="true">·</span><button class="btn link" data-act="legal" data-v="donnees">Vos données</button><span aria-hidden="true">·</span><button class="btn link" data-act="legal" data-v="cgu">Conditions</button></p>`;

export function restoreForm() {
  const k = S.formKeep, f = k && document.getElementById(k.id); if (!f) return;
  S.formKeep = null;
  k.v.forEach(([n, v]) => { const x = f.querySelector(`input[name="${n}"]`); if (!x) return; if (x.type === 'checkbox') x.checked = v; else x.value = v; });
}

// ---------- Mots de passe (n° 45) ----------
export function pwdIssues(p) { const r = []; if ((p || '').length < 8) r.push('8 caractères au moins'); if (!/\p{L}/u.test(p || '')) r.push('une lettre'); if (!/\d/.test(p || '')) r.push('un chiffre'); return r; }
export function pwdStrength(p) {
  if (!p) return ['', ''];
  if (pwdIssues(p).length) return ['faible', 'Faible · il faut ' + pwdIssues(p).join(', ')];
  return p.length >= 12 && ((/[a-z]/.test(p) && /[A-Z]/.test(p)) || /[^\p{L}\d]/u.test(p)) ? ['solide', 'Solide'] : ['correct', 'Correct · plus long ou avec un symbole, il serait solide'];
}
const pwdInput = (id, name, label, auto, hint) => `<div class="field"><label for="${id}">${label}</label><div class="pwd"><input id="${id}" name="${name}" type="password" required autocomplete="${auto}" ${hint ? `data-pw="${hint}"` : ''}><button type="button" class="btn small ghost" data-act="pwtog" data-for="${id}" aria-pressed="false">Afficher</button></div>${hint ? `<div class="pwmeter" id="${id}m" aria-live="polite"></div>` : ''}</div>`;
// Nouveau mot de passe saisi deux fois (inscription, changement, mot de passe oublié)
export const newPwdFields = (p = 'np') => `${pwdInput(p + '1', 'password', 'Mot de passe (8 caractères au moins, avec des lettres et des chiffres)', 'new-password', 'strength')}${pwdInput(p + '2', 'password2', 'Confirmer le mot de passe', 'new-password', 'confirm')}`;
export function checkNewPwd(v) {
  const iss = pwdIssues(v.password); if (iss.length) { toast('Mot de passe trop faible : il faut ' + iss.join(', ') + '.'); return false; }
  if (v.password !== v.password2) { toast('Les deux mots de passe ne sont pas identiques.'); return false; }
  return true;
}
// Messages de connexion en français
export function authMessage(e) {
  const m = String(e?.message || e || '');
  if (/invalid login/i.test(m)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/not confirmed/i.test(m)) return "Confirme d'abord ton adresse e-mail avec le lien reçu, puis reconnecte-toi.";
  if (/already registered|already been registered/i.test(m)) return 'Un compte existe déjà avec cette adresse : connecte-toi, ou utilise « Mot de passe oublié ».';
  if (/captcha/i.test(m)) return 'La vérification anti-robot a échoué : réessaie.';
  if (/pwned|leaked|compromised/i.test(m)) return 'Ce mot de passe est trop courant (il a déjà circulé sur internet) : choisis-en un autre.';
  if (/password/i.test(m) && /(weak|should|least|characters)/i.test(m)) return 'Mot de passe trop faible : 8 caractères au moins, avec des lettres et des chiffres.';
  if (/rate limit|too many|security purposes/i.test(m)) return "Trop d'essais : réessaie dans quelques minutes.";
  if (/same.*password|different from the old/i.test(m)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  return m || 'Action impossible.';
}
async function authRun(p, ok) {
  if (!navigator.onLine) { toast('Hors connexion : réessaie quand le réseau revient.'); return null; }
  const { data, error } = await p; resetCaptcha();
  if (error) { console.error(error); toast(authMessage(error)); return null; }
  if (ok) toast(ok); return data ?? true;
}

// ---------- Anti-robots : Cloudflare Turnstile (n° 46), actif seulement si la clé est dans config.js ----------
let tsWidget = null;
const captchaBox = () => (TURNSTILE_SITEKEY ? '<div id="ts" class="ts"></div>' : '');
export const captcha = () => (TURNSTILE_SITEKEY ? S.captcha || undefined : undefined); // 4.7.0 : aussi pour « Ce n’'était pas moi » (n° 147)
function resetCaptcha() { S.captcha = null; try { if (window.turnstile && tsWidget !== null) window.turnstile.reset(tsWidget); } catch { /* */ } }
export async function mountCaptcha() {
  const box = document.getElementById('ts'); if (!TURNSTILE_SITEKEY || !box || box.dataset.on) return;
  box.dataset.on = '1';
  if (!window.turnstile) await new Promise((ok) => { const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); });
  if (!window.turnstile || !document.body.contains(box)) return;
  S.captcha = null;
  tsWidget = window.turnstile.render(box, { sitekey: TURNSTILE_SITEKEY, language: 'fr', appearance: 'interaction-only', callback: (t) => { S.captcha = t; }, 'expired-callback': () => { S.captcha = null; } });
}
const needCaptcha = () => { if (TURNSTILE_SITEKEY && !S.captcha) { toast('Vérification anti-robot en cours : patiente une seconde, puis réessaie.'); return true; } return false; };

// ---------- Accueil public : recherche de clubs (n° 49) ----------
const pubHeader = (o = {}) => header({ brand: true, back: o.back, kicker: o.kicker, title: o.title });
const memberOf = (id) => !!S.session && (S.mems || []).some((m) => m.club_id === id && m.status === 'active');
export function searchBlock(part = '') {
  const P = S.ps || (S.ps = { q: '', sport: '', res: null });
  const form = `<form id="psf" class="card lift" role="search">${field('psq', 'Chercher un club', `<input id="psq" type="search" data-psq="1" value="${esc(P.q)}" placeholder="Nom du club, ville ou code postal" autocomplete="off" minlength="2">`)}
  <div class="chips">${[['', 'Tous les sports'], ['Basket-ball', 'Basket'], ['Volley-ball', 'Volley']].map(([v, l]) => `<button type="button" class="chip" data-act="pssport" data-v="${v}" aria-pressed="${P.sport === v}">${l}</button>`).join('')}</div>
  <button class="btn main" type="submit">Chercher</button></form>`;
  const res = `${P.res === null ? '' : P.res.length ? `<div class="stack">${P.res.map((c) => `<button class="card" data-act="pclub" data-id="${c.id}" style="flex-direction:row;align-items:center;gap:14px;border:0;text-align:left;font:inherit;color:inherit">${crest(c, 40, '#FFFFFF')}<span style="display:flex;flex-direction:column;min-width:0;flex:1"><b>${esc(c.name)}</b><span class="det">${esc([c.city, c.postal_code].filter(Boolean).join(' · '))}${c.city || c.postal_code ? ' · ' : ''}${esc(c.sport)}</span></span>${memberOf(c.id) ? '<span class="pill ok">Déjà membre</span>' : '<span class="chev"></span>'}</button>`).join('')}</div>` : '<p class="empty">Aucun club trouvé. Essaie la ville, ou demande le code du club à ton coach.</p>'}${P.res === null ? '' : notListedLine(P.done, P.res.length > 0)}`;
  return part === 'form' ? form : part === 'results' ? res : form + res;
}
// 5.0.0 · n° 197 : écran d'ouverture de l'identité (fond encre, « club » bleu clair, slogan), avec la recherche d'un club sous le slogan
export function publicHome() {
  return `<div class="ouvert" data-ouv="1"><div class="splash" style="flex:none;padding:calc(36px + env(safe-area-inset-top)) 20px 4px">${wordmark(44, null, true)}<p class="slog">Tout ton club dans ta poche.</p></div><main class="bd" style="padding-top:12px">
  ${searchBlock('form')}
  <div class="btns"><button class="btn main" data-act="auth" data-v="login">Se connecter</button></div>
  <button class="btn link jaune" data-act="auth" data-v="signup">Je n'ai pas encore de compte</button>
  ${searchBlock('results')}
  ${legalFoot()}<p class="note" style="text-align:center">${esc(BRAND.name)} ${esc(VERSION)} · version de test</p><p class="note" style="text-align:center">Contact : <a href="mailto:${esc(BRAND.contact)}">${esc(BRAND.contact)}</a> · Site : <a href="${esc(BRAND.siteUrl)}" target="_blank" rel="noopener">${esc(BRAND.site)}</a></p></main></div>`;
}
export function publicClubScreen(id) {
  const c = (S.pclubs || {})[id];
  if (c === undefined) return pubHeader({ back: true, kicker: 'Club' }) + '<main class="bd"><p class="empty">Chargement…</p></main>';
  if (!c) return pubHeader({ back: true, kicker: 'Club' }) + '<main class="bd"><p class="empty">Ce club n’est pas visible dans la recherche. Demande son code au club pour le rejoindre.</p></main>';
  const teams = c.teams || [];
  return pubHeader({ back: true, kicker: c.sport, title: esc(c.name) }) + `<main class="bd"><div class="card lift" style="flex-direction:row;align-items:center;gap:14px">${crest(c, 52, '#FFFFFF')}<span style="display:flex;flex-direction:column"><b style="font-size:18px">${esc(c.name)}</b><span class="det">${esc([c.city, c.postal_code].filter(Boolean).join(' · ') || 'Ville non renseignée')} · ${esc(c.sport)}</span></span></div>
  ${memberOf(c.id) ? `<span class="pill ok">Déjà membre</span><button class="btn main" data-act="club" data-id="${c.id}">Ouvrir le club</button>` : `<button class="btn main" data-act="pjoin" data-id="${c.id}">Rejoindre ce club</button>`}
  <div class="sec"><h2>Équipes</h2></div><div class="card"><div class="list">${teams.length ? teams.map((t) => `<div class="row static"><span class="g">${esc(t.name)}<small>${esc([t.category !== t.name ? t.category : '', t.gender].filter(Boolean).join(' · '))}</small>${t.slots ? `<small>${icon('cal', 14)} ${esc(t.slots)}</small>` : ''}</span></div>`).join('') : '<p class="empty">Pas encore d’équipe affichée.</p>'}</div></div>
  ${S.session && !memberOf(c.id) && (S.pcards || {})[c.id] ? `<div class="sec"><h2>Contacter le club</h2></div><div class="card">${contactCardHtml(S.pcards[c.id])}</div>` : ''}
  <p class="note">${S.session ? '' : 'Les matchs, les messages et les contacts du club sont réservés aux membres connectés.'}</p></main>`;
}

// ---------- Connexion et inscription ----------
export function authScreen() {
  const L = S.authMode === 'login', pj = pendingJoin();
  return pubHeader({ back: true, kicker: L ? 'Connexion' : 'Nouveau compte', title: L ? 'Content de te revoir.' : 'Crée ton compte.' }) + `<main class="bd">
  ${pj ? `<div class="card pale"><b>${L ? 'Connecte-toi' : 'Crée ton compte'} pour rejoindre ${esc(pj.name)}.</b><span class="note">Ta demande s'ouvrira juste après, sans code à taper.</span></div>` : ''}
  <div class="chips" role="tablist"><button class="chip" data-act="authmode" data-v="login" aria-pressed="${L}">J'ai un compte</button><button class="chip" data-act="authmode" data-v="signup" aria-pressed="${!L}">Créer un compte</button></div>
  <form id="authf" class="card lift">
  ${L ? '' : `<div class="grid2">${field('an', 'Prénom', '<input id="an" name="first_name" required autocomplete="given-name">')}${field('an2', 'Nom', '<input id="an2" name="last_name" required autocomplete="family-name">')}</div>`}
  ${field('ae', 'Adresse e-mail', `<input id="ae" name="email" type="email" required autocomplete="email" value="${esc(S.authEmail || '')}" data-authmail="1">`)}
  ${L ? pwdInput('ap', 'password', 'Mot de passe', 'current-password') : newPwdFields('ap')}
  <label class="check"><input type="checkbox" name="remember" ${remember.get() ? 'checked' : ''}><span><b>Rester connecté</b><br><span class="det">Décoche sur un téléphone ou un ordinateur partagé.</span></span></label>
  ${L ? '' : signupExtras()}
  ${captchaBox()}
  <button class="btn main" type="submit">${L ? 'Me connecter' : 'Créer mon compte'}</button></form>
  ${L ? '<button class="btn link" data-act="forgot" style="align-self:center">Mot de passe oublié ?</button>' : ''}
  ${legalFoot()}</main>`;
}
// Nouveau mot de passe après le lien « Mot de passe oublié »
export function recoveryScreen() {
  return header({ title: 'Choisis un nouveau mot de passe', brand: true }) + `<main class="bd"><form id="npwf" class="card lift">${newPwdFields('np')}<button class="btn main" type="submit">Enregistrer le mot de passe</button></form></main>`;
}
const pendingJoin = () => { try { return JSON.parse(store.get('pc_join') || 'null'); } catch { return null; } };
export async function loadPublicClub(id) {
  S.pclubs = S.pclubs || {};
  const { data, error } = await sb.rpc('public_club', { p_club: id });
  if (error) { toast(error.message || 'Club introuvable.'); S.pclubs[id] = null; } else S.pclubs[id] = data || null;
  // n° 122 : visiteur connecté (autre club ou autre sport) : contact licences ; clubs du même sport : aussi le contact rencontres
  if (S.session && S.pclubs[id]) { const k = await sb.rpc('contact_card', { p_club: id }); S.pcards = S.pcards || {}; S.pcards[id] = k.data && typeof k.data === 'object' ? k.data : null; }
}
// Après connexion : ouvrir la demande d'adhésion au club choisi dans la recherche
export async function openPendingJoin() {
  const pj = pendingJoin(); if (!pj || !S.me) return;
  if (S.mems.some((m) => m.club_id === pj.id)) { store.set('pc_join', ''); return; }
  if (!(S.pclubs || {})[pj.id]) await loadPublicClub(pj.id);
  const c = S.pclubs[pj.id]; if (!c) { store.set('pc_join', ''); return; }
  S.join = { byId: c.id, clubName: c.name, role: 'supporteur', teams: c.teams || [] }; S.onb = 'join'; S.view = null;
}

// N° 180 : nouvelle version des conditions (ou première acceptation) : présentée à la connexion, accord redemandé
export function cguScreen() {
  const me = S.me || {}, again = !!me.cgu_version;
  return header({ title: 'Avant de continuer', brand: true }) + `<main class="bd"><p style="margin:0">${again ? `Les conditions d'utilisation et la page « Vos données » ont changé (version ${esc(LEGAL.version)} du ${esc(LEGAL.date)}). Lis-les, puis accepte les conditions pour continuer.` : "Lis et accepte les conditions d'utilisation pour continuer."}</p>${legalLinks()}<form id="cguf" class="card lift">${cguBox()}${consentBoxes(!!me.image_ok, !!me.optin_emails)}<button class="btn main" type="submit">Continuer</button></form></main>`;
}

// ---------- Logo du club : lecture, réduction, couleurs proposées ----------
export async function readLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const k = Math.min(1, 256 / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
    let data = cv.toDataURL('image/webp', 0.9); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/png');
    const sm = document.createElement('canvas'); sm.width = sm.height = 32; const x = sm.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data, cnt = {};
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const hx = '#' + [px[i], px[i + 1], px[i + 2]].map((v) => ((v >> 4) * 17).toString(16).padStart(2, '0')).join('').toUpperCase(), L = lum(hx);
      if (L > 0.85 || L < 0.01) continue; cnt[hx] = (cnt[hx] || 0) + 1;
    }
    const top = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p]);
    const dist = (p, q) => { const A = parseInt(p.slice(1), 16), B = parseInt(q.slice(1), 16); return Math.abs((A >> 16) - (B >> 16)) + Math.abs(((A >> 8) & 255) - ((B >> 8) & 255)) + Math.abs((A & 255) - (B & 255)); };
    const c1 = top[0], c2 = top.find((q) => dist(q, c1) > 120);
    let n = 0, op = 0, rs = 0, gs = 0, bs = 0;
    for (let i = 0; i < 32; i++) for (const [xx, yy] of [[i, 0], [i, 31], [0, i], [31, i]]) { const o = (yy * 32 + xx) * 4; n++; if (px[o + 3] > 200) { op++; rs += px[o]; gs += px[o + 1]; bs += px[o + 2]; } }
    const bg = op > n * 0.7 ? '#' + [rs, gs, bs].map((v) => Math.round(v / op).toString(16).padStart(2, '0')).join('').toUpperCase() : '#FFFFFF';
    return { data, colors: [c1, c2].filter(Boolean), bg };
  } finally { URL.revokeObjectURL(url); }
}
// Aperçu de l'en-tête aux couleurs du club
export function brandPreview(nm, c1, logo, bg, perso) {
  const h = perso ? c1 : '#2F5BFF';
  return `<div class="hd" style="border-radius:24px;--pc-entete:${esc(h)};--pc-entete-texte:${onColor(h)};background:${esc(h)};color:${onColor(h)}"><div class="top">${crest({ name: nm, color1: c1, logo, crest_bg: bg }, 44)}<div class="who"><b>${esc(nm || 'Mon club')}</b><span>Aperçu de l'en-tête</span></div></div></div>`;
}
export function logoFields(hasLogo, bg) {
  // 5.2.1 : pipette : on touche le logo pour prendre une couleur exacte (principale, seconde, fond de l'écu)
  const pip = hasLogo ? `<div class="chips" role="group" aria-label="Pipette : prendre une couleur sur le logo"><button type="button" class="chip" data-act="pipette" data-v="c1">${icon('target', 16)} Pipette : couleur principale</button><button type="button" class="chip" data-act="pipette" data-v="c2">${icon('target', 16)} Pipette : seconde couleur</button><button type="button" class="chip" data-act="pipette" data-v="bg">${icon('target', 16)} Pipette : fond de l'écu</button></div>` : '';
  return `${field('lg', 'Logo du club (image, facultatif)', '<input id="lg" type="file" accept="image/*" data-logo="1">')}${hasLogo ? '<button type="button" class="btn small ghost" data-act="logorm">Retirer le logo</button>' : ''}${pip}
  ${field('lbg', "Fond de l'écu derrière le logo", `<input id="lbg" name="bg" type="color" value="${esc((bg || '#ffffff').toLowerCase())}">`)}
  <p class="note">Une image prise sur ton téléphone ou enregistrée depuis la page du club. Les couleurs du logo sont proposées automatiquement, tu peux les changer. En enregistrant un logo, le club certifie avoir le droit de l'utiliser.</p>`;
}
export function updatePreview(f) {
  const p = f?.querySelector('[data-prev]'); if (!p) return;
  const v = Object.fromEntries(new FormData(f)), cr = f.id === 'clubf', c = club();
  p.innerHTML = brandPreview(cr ? v.name : c?.name, v.c1, S.tmpLogo === undefined ? (cr ? null : c?.logo) : S.tmpLogo, v.bg, cr ? true : !!f.querySelector('[name=perso]')?.checked || c?.custom_header);
}

// ---------- Premier club : rejoindre ou créer ----------
export function onboarding() {
  const o = S.onb, pend = S.mems.filter((m) => m.status === 'pending');
  let h = header({ title: o === 'create' ? 'Créer mon club' : o === 'join' ? (S.join.byId ? 'Rejoindre ' + esc(S.join.clubName) : 'Rejoindre un club') : o === 'search' ? 'Chercher un club' : `Salut ${esc(S.me.first_name || '')} !`, brand: true }) + '<main class="bd">';
  if (!o) {
    if (pend.length) h += `<div class="card warn"><div class="kick">Demande en attente</div>${pend.map((m) => `<b>${esc(S.clubs[m.club_id]?.name || 'Club')} · ${ROLES[m.role]}</b>`).join('')}<p class="note">Le club doit valider ta demande. Touche « Actualiser » ensuite.</p><button class="btn small ghost" data-act="refresh">Actualiser</button></div>`;
    h += `<div class="card"><h3>Chercher ton club</h3><p class="note">Par son nom, sa ville ou son code postal.</p><button class="btn main" data-act="onb" data-v="search">Chercher un club</button></div>
    <div class="card yellow"><h3>Ton club t'a donné un code ?</h3><p class="note">8 caractères, demandés au coach ou au bureau.</p><button class="btn ink" data-act="onb" data-v="join">Rejoindre un club avec son code</button></div>
    <div class="card"><h3>Tu es président d'un club ?</h3><p class="note">Crée l'espace du club : tu pourras ensuite ajouter les équipes et inviter les membres.</p><button class="btn" data-act="onb" data-v="create">Créer mon club</button></div>
    <button class="btn link" data-act="account" style="align-self:center">Mon compte</button><button class="btn link" data-act="logout" style="align-self:center">Me déconnecter</button>`;
  } else if (o === 'search') {
    h += searchBlock() + '<button class="btn ghost" data-act="onb" data-v="">Retour</button>';
  } else if (o === 'create') {
    h += `<form id="clubf" class="card lift">
      ${field('cn', 'Nom du club', '<input id="cn" name="name" required maxlength="80">')}
      <div class="grid2">${field('cv', 'Ville', '<input id="cv" name="city">')}${field('cp', 'Code postal', '<input id="cp" name="postal_code" inputmode="numeric" pattern="[0-9]{5}" maxlength="5">')}</div>
      ${field('cs', 'Sport', `<select id="cs" name="sport">${SPORTS.map((s) => `<option>${s}</option>`).join('')}</select>`)}
      ${logoFields(!!S.tmpLogo)}
      <div class="grid2">${field('c1', 'Couleur principale', '<input id="c1" name="c1" type="color" value="#2f5bff">')}${field('c2', 'Seconde couleur', '<input id="c2" name="c2" type="color" value="#ffc93c">')}</div>
      <div class="kick">Aperçu (si tu actives l'en-tête aux couleurs du club)</div><div data-prev>${brandPreview('', '#2F5BFF', S.tmpLogo, '#FFFFFF', true)}</div>
      <button class="btn main" type="submit">Créer le club (j'en suis président)</button></form><button class="btn ghost" data-act="onb" data-v="">Retour</button>`;
  } else {
    const j = S.join;
    h += `<div class="card lift">
      ${j.byId ? '' : `${field('jc', 'Code du club (8 caractères)', `<input id="jc" data-j="code" value="${esc(j.code || '')}" autocapitalize="characters" maxlength="8" autocomplete="off">`)}<button class="btn small ghost" data-act="jcheck">Vérifier le code</button>`}
      ${j.clubName ? `<div class="pill ok">Club : ${esc(j.clubName)}</div>` : ''}
      <div class="kick">Je rejoins comme</div><div class="chips">${JOIN_ROLES.map((r) => `<button class="chip" data-act="jrole" data-v="${r}" aria-pressed="${j.role === r}">${ROLES[r]}</button>`).join('')}</div>
      ${roleExtra(j, 'j', j.teams)}
      <p class="note">${j.role === 'supporteur' ? 'Accès immédiat.' : "Le club valide ta demande. En attendant, tu n'as pas encore accès."}</p>
      <button class="btn main" data-act="jsend">Envoyer</button></div><button class="btn ghost" data-act="joincancel">Retour</button>`;
  }
  return h + '</main>';
}
// Champs propres au rôle demandé (enfant, âge, équipe) ; p = préfixe des champs (j : rejoindre, r : autre rôle)
export function roleExtra(st, p, teams) {
  let h = '';
  if (st.role === 'parent') h += `<div class="grid2">${field(p + 'k', "Prénom de l'enfant", `<input id="${p}k" data-${p}="childf" value="${esc(st.childf || '')}">`)}${field(p + 'k2', "Nom de l'enfant", `<input id="${p}k2" data-${p}="childl" value="${esc(st.childl || '')}">`)}</div>`;
  if (st.role === 'joueur') h += `<label class="check"><input type="checkbox" data-${p}="age" ${st.age ? 'checked' : ''}><span>J'ai 15 ans ou plus</span></label>`;
  if (st.role === 'bureau') h += field(p + 'f', 'Fonction demandée (une par demande ; pour plusieurs fonctions, refais une demande)', `<select id="${p}f" data-${p}="fonction">${FONCTIONS.map((f) => `<option ${(st.fonction || 'Membre du bureau') === f ? 'selected' : ''} value="${esc(f)}">${fl(f)}</option>`).join('')}</select>`) + '<p class="note">Le président valide chaque fonction séparément.</p>';
  if (['parent', 'joueur', 'coach'].includes(st.role) && teams.length) h += field(p + 't', 'Équipe', `<select id="${p}t" data-${p}="team"><option value="">Je ne sais pas</option>${teams.map((t) => `<option value="${t.id}" ${st.team === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`);
  return h;
}
export function checkRole(st) {
  if (st.role === 'parent' && (!(st.childf || '').trim() || !(st.childl || '').trim())) { toast("Indique le prénom et le nom de l'enfant."); return false; }
  if (st.role === 'joueur' && !st.age) { toast("Le compte joueur est réservé aux 15 ans et plus. En dessous, un parent suit l'enfant depuis son compte."); return false; }
  return true;
}

// ---------- Actions ----------
Object.assign(ACTIONS, {
  authmode: (el, d) => { S.authMode = d.v; render(); },
  pwtog: (el) => { const i = document.getElementById(el.dataset.for || 'ap'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Masquer' : 'Afficher'; el.setAttribute('aria-pressed', show); },
  forgot: async () => {
    const em = document.getElementById('ae')?.value; if (!em) return toast('Indique ton adresse e-mail.'); if (needCaptcha()) return;
    // même message que l'adresse ait un compte ou non
    await authRun(sb.auth.resetPasswordForEmail(em, { redirectTo: location.href.split('#')[0], captchaToken: captcha() }), "Si un compte existe avec cette adresse, un e-mail vient d'être envoyé.");
  },
  auth: (el, d) => { S.authMode = d.v; S.view = { type: 'auth' }; render(); },
  pssport: (el, d) => { S.ps.sport = d.v; if ((S.ps.q || '').trim().length >= 2) doSearch(); else render(true); },
  pclub: async (el, d) => { S.view = { type: 'pclub', id: d.id }; render(); await loadPublicClub(d.id); render(true); },
  pjoin: async (el, d) => {
    const c = (S.pclubs || {})[d.id]; store.set('pc_join', JSON.stringify({ id: d.id, name: c?.name || 'ce club' }));
    if (!S.session) { S.authMode = 'signup'; S.view = { type: 'auth' }; return render(); }
    await openPendingJoin(); render();
  },
  joincancel: () => { store.set('pc_join', ''); S.join = { code: '', role: 'supporteur', teams: [] }; S.onb = isActive() ? null : ''; render(); },
  logout: async () => { await unlinkPush(); await sb.auth.signOut(); },
  legal: (el, d) => { // n° 175 : la saisie de l'inscription (sauf les mots de passe) est gardée le temps de lire les textes
    const f = el?.closest?.('form[id]') || document.querySelector('#authf, #cguf');
    if (f && S.view?.type !== 'legal') S.formKeep = { id: f.id, v: [...f.querySelectorAll('input[name]')].filter((x) => x.type !== 'password' && x.type !== 'file').map((x) => [x.name, x.type === 'checkbox' ? x.checked : x.value]) };
    S.view = { type: 'legal', id: d?.v || null }; render();
  },
  onb: (el, d) => { S.tmpLogo = undefined; S.onb = d.v || null; if (!d.v && isActive()) S.onb = null; render(); },
  onbopen: () => { S.onb = ''; S.view = null; render(); },
  jrole: (el, d) => { S.join.role = d.v; render(true); },
  // 5.2.1 : pipette. Le logo s'affiche en grand dans une fenêtre ; un toucher prend la couleur du point touché.
  pipette: (el, d) => {
    const f = el.closest('form'), input = f?.querySelector(`[name=${d.v}]`), src = S.tmpLogo === undefined ? club()?.logo : S.tmpLogo;
    if (!input || !src) return toast('Ajoute d’abord un logo.');
    const ov = document.createElement('div'); ov.className = 'pipov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Pipette');
    const lab = { c1: 'la couleur principale', c2: 'la seconde couleur', bg: 'le fond de l’écu' }[d.v];
    ov.innerHTML = `<div class="pipbox"><b>Touche le logo pour choisir ${lab}</b><canvas></canvas><span class="det pipsw" aria-live="polite">Touche un point du logo</span><button type="button" class="btn ghost" data-pipclose="1">Annuler</button></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), sw = ov.querySelector('.pipsw'), img = new Image();
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-pipclose]')) close(); });
    img.onload = () => {
      const k = Math.min(1, 300 / img.width, 300 / img.height);
      cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, cv.width, cv.height);
      const pick = (e) => {
        const r = cv.getBoundingClientRect(), x = Math.min(cv.width - 1, Math.max(0, Math.floor((e.clientX - r.left) * cv.width / r.width))), y = Math.min(cv.height - 1, Math.max(0, Math.floor((e.clientY - r.top) * cv.height / r.height)));
        const [R, G, B, A] = cx.getImageData(x, y, 1, 1).data;
        if (A < 128) { sw.textContent = 'Zone transparente : touche une partie colorée.'; return; }
        const hex = '#' + [R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('');
        input.value = hex; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
        updatePreview(f); close(); toast('Couleur prise sur le logo : ' + hex.toUpperCase() + '.');
      };
      cv.addEventListener('click', pick);
    };
    img.onerror = () => { close(); toast('Logo illisible.'); };
    img.src = src;
  },
  logorm: (el) => { S.tmpLogo = null; const f = el.closest('form'); el.remove(); updatePreview(f); },
  jcheck: async () => {
    const r = await run(sb.rpc('teams_for_code', { p_code: S.join.code })); if (!r) return;
    if (!r.length) { S.join.clubName = ''; toast('Code inconnu. Vérifie les 8 caractères.'); return render(true); }
    S.join.teams = r.filter((x) => x.id); S.join.clubName = r[0].club_name; render(true);
  },
  jsend: async () => {
    const j = S.join; if (!j.byId && !j.code) return toast('Indique le code du club.');
    if (!checkRole(j)) return;
    const args = { p_role: j.role, p_team: j.team || null, p_child_first: j.childf || null, p_child_last: j.childl || null };
    const cid = await run(j.role === 'bureau' ? sb.rpc('request_bureau', { p_club: j.byId || null, p_code: j.byId ? null : j.code, p_fonction: j.fonction || 'Membre du bureau' })
      : j.byId ? sb.rpc('join_club_by_id', { p_club: j.byId, ...args }) : sb.rpc('join_club', { p_code: j.code, ...args }));
    if (j.byId && cid) store.set('pc_join', '');
    if (cid === null) return;
    if (cid === true || !cid) return toast('Code inconnu. Vérifie les 8 caractères.');
    toast(j.role === 'supporteur' ? 'Bienvenue dans le club !' : 'Demande envoyée au club.');
    S.clubId = cid; store.set('pc_club', cid); S.onb = null; S.join = { code: '', role: 'supporteur', teams: [] }; await refresh();
  },
});
Object.assign(FORMS, {
  authf: async (v) => {
    remember.set(!!v.remember);
    if (needCaptcha()) return;
    if (S.authMode === 'login') return authRun(sb.auth.signInWithPassword({ email: v.email, password: v.password, options: { captchaToken: captcha() } }));
    if (!checkNewPwd(v)) return;
    if (!v.cgu) return toast("Merci d'accepter les conditions d'utilisation.");
    const fn = niceFirst(v.first_name), ln = niceLast(v.last_name);
    const r = await authRun(sb.auth.signUp({ email: v.email, password: v.password, options: { captchaToken: captcha(), emailRedirectTo: location.href.split('#')[0], data: { first_name: fn, last_name: ln, cgu_version: CGU_VERSION, optin_emails: !!v.optin, image_ok: !!v.image } } }));
    if (r && !r.session) { S.authMode = 'login'; render(); toast("Compte créé. Ouvre le lien reçu par e-mail pour confirmer ton adresse, puis connecte-toi."); }
  },
  npwf: async (v, f) => {
    if (!checkNewPwd(v)) return;
    if (await authRun(sb.auth.updateUser({ password: v.password }), 'Mot de passe changé.')) { S.recovery = false; f.reset(); await refresh(); }
  },
  cguf: async (v) => { if (await run(sb.rpc('accept_cgu', { p_version: CGU_VERSION, p_optin: !!v.optin, p_image: !!v.image }), 'Merci, conditions acceptées.')) await refresh(); },
  clubf: async (v) => {
    const cid = await run(sb.rpc('create_club', { p_name: v.name.trim(), p_city: v.city.trim(), p_sport: v.sport, p_c1: v.c1.toUpperCase(), p_c2: v.c2.toUpperCase() }), 'Club créé. Tu en es président.');
    if (!cid) return;
    const extra = { postal_code: /^\d{5}$/.test(v.postal_code || '') ? v.postal_code : '' };
    if (S.tmpLogo) Object.assign(extra, { logo: S.tmpLogo, crest_bg: (v.bg || '#ffffff').toUpperCase() });
    await run(sb.from('clubs').update(extra).eq('id', cid));
    S.tmpLogo = undefined; S.clubId = cid; store.set('pc_club', cid); S.onb = null; S.tab = 4; await refresh();
  },
});
async function doSearch() {
  const P = S.ps, q = (P.q || '').trim(); if (q.length < 2) return toast('Tape au moins 2 lettres ou chiffres.');
  const { data, error } = await sb.rpc('public_search_clubs', { p_query: q, p_sport: P.sport || null });
  if (error) return toast(error.message || 'Recherche impossible pour le moment.');
  P.res = data || []; P.done = q; render(true); // n° 96 : les mots tapés, repris tels quels dans « Mon club n'est pas dans la liste »
}
FORMS.psf = () => doSearch();
INPUTS.push((t) => {
  if (t.dataset.psq) { S.ps.q = t.value; return true; }
  if (t.dataset.authmail) { S.authEmail = t.value; return true; }
  if (t.dataset.pw) {
    const f = t.closest('form'), p1 = f.querySelector('[data-pw=strength]'), p2 = f.querySelector('[data-pw=confirm]'), m1 = document.getElementById(p1.id + 'm'), m2 = document.getElementById(p2.id + 'm'), [k, txt] = pwdStrength(p1.value);
    m1.className = 'pwmeter ' + k; m1.textContent = txt;
    m2.className = 'pwmeter ' + (p2.value && p2.value !== p1.value ? 'faible' : p2.value ? 'solide' : ''); m2.textContent = p2.value ? (p2.value === p1.value ? 'Identiques' : 'Les deux mots de passe ne sont pas identiques') : '';
    return true;
  }
  if (t.dataset.j && t.type !== 'checkbox') { S.join[t.dataset.j] = t.dataset.j === 'code' ? t.value.toUpperCase() : t.value; return true; }
  if (t.closest('#clubf,#brandf') && t.type !== 'file') { updatePreview(t.closest('form')); return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.j) { S.join[t.dataset.j] = t.type === 'checkbox' ? t.checked : t.value; return true; }
  if (t.dataset.logo && t.files?.[0]) {
    try {
      const r = await readLogo(t.files[0]), f = t.closest('form'); S.tmpLogo = r.data;
      if (r.colors[0]) f.querySelector('[name=c1]').value = r.colors[0].toLowerCase();
      if (r.colors[1] && f.querySelector('[name=c2]')) f.querySelector('[name=c2]').value = r.colors[1].toLowerCase();
      if (r.bg && f.querySelector('[name=bg]')) f.querySelector('[name=bg]').value = r.bg.toLowerCase();
      updatePreview(f); toast(r.colors.length ? "Logo ajouté. Couleurs proposées d'après le logo." : 'Logo ajouté.');
    } catch { toast('Image illisible. Essaie une image PNG ou JPG.'); }
    return true;
  }
  return false;
});
