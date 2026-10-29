// Pocket Club · connexion, inscription, conditions, premier club (créer ou rejoindre), textes légaux.
import { BRAND, VERSION, CGU_VERSION } from '../config.js';
import { S, sb, esc, run, toast, render, refresh, store, ROLES, JOIN_ROLES, SPORTS, niceFirst, niceLast, lum, onColor, isActive, club, ACTIONS, FORMS, INPUTS, CHANGES } from './core.js';
import { header, wordmark, crest, field } from './ui.js';

// ---------- Textes légaux (vouvoiement, provisoires : à relire par un juriste) ----------
export function legalText() {
  return `<div class="card"><h3>Mentions légales</h3><p class="note" style="color:var(--pc-encre)">Application ${esc(BRAND.name)} (nom provisoire), version ${esc(VERSION)} de test, éditée par ${esc(BRAND.editor)}. Contact : <a href="mailto:${esc(BRAND.contact)}">${esc(BRAND.contact)}</a>. Application hébergée par GitHub, Inc. (88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis). Données hébergées par Supabase, Inc., dans un centre de données situé à Paris (région eu-west-3).</p></div>
  <div class="card"><h3>Confidentialité (version courte)</h3><ul class="note" style="color:var(--pc-encre);padding-left:18px;margin:0;display:flex;flex-direction:column;gap:6px">
  <li><b>Qui ?</b> Votre club décide des données utiles à sa vie sportive ; ${esc(BRAND.name)} les héberge et les traite pour lui.</li>
  <li><b>Quoi ?</b> Identité, contact, rôles et équipes, présences et réponses, messages, autorisations datées, état de la licence et de la cotisation. Jamais de donnée médicale : seulement « certificat fourni » oui ou non.</li>
  <li><b>Qui voit ?</b> Les familles voient les autres joueurs en « Prénom N. » ; les coachs voient leur équipe ; le bureau voit le club ; les téléphones restent entre l'encadrement et les familles concernées.</li>
  <li><b>Enfants :</b> avant 15 ans, c'est le parent qui gère le compte et les autorisations.</li>
  <li><b>Combien de temps ?</b> Tant que vous êtes membre. Une suppression passe par une corbeille de 30 jours, puis l'effacement est définitif, sauf ce que le club doit garder pour sa comptabilité.</li>
  <li><b>Vos droits :</b> consulter et télécharger vos données, les corriger, les supprimer, vous opposer : depuis « Mon compte », en écrivant à ${esc(BRAND.contact)} ou au club. Vous pouvez saisir la CNIL (cnil.fr).</li></ul></div>
  <div class="card"><h3>Conditions d'utilisation (alpha)</h3><ul class="note" style="color:var(--pc-encre);padding-left:18px;margin:0;display:flex;flex-direction:column;gap:6px">
  <li>Version de test : des erreurs et des changements sont possibles ; ne l'utilisez pas comme seul outil du club.</li>
  <li>Le compte joueur est réservé aux 15 ans et plus ; en dessous, un parent ouvre son compte et y relie l'enfant.</li>
  <li>Chacun reste responsable de ce qu'il publie ; tout contenu signalé et contraire à la loi est retiré.</li>
  <li>Ne saisissez jamais d'information médicale (maladie, allergie, traitement).</li>
  <li>Le club certifie avoir le droit d'utiliser son logo.</li></ul><p class="note">Version ${esc(CGU_VERSION)}. Textes provisoires, à relire par un juriste avant l'ouverture à d'autres clubs.</p></div>`;
}
export const legalScreen = () => header({ back: true, kicker: 'Mentions et données', title: 'Tes données', brand: true }) + `<main class="bd">${legalText()}</main>`;

function signupExtras() {
  return `<div class="card pale"><div class="kick">Tes données</div><p class="note" style="color:var(--pc-encre)">Ton club organise sa vie (équipes, présences, messages) avec ${esc(BRAND.name)}, qui héberge les données pour lui. Seuls les membres concernés les voient : les familles voient les autres joueurs en « Prénom N. », l'encadrement voit les coordonnées. Tu peux consulter, télécharger, corriger ou supprimer tes données à tout moment depuis « Mon compte ».</p><button type="button" class="btn small ghost" data-act="legal">Confidentialité et conditions</button></div>
  <label class="check"><input type="checkbox" name="cgu" required><span>J'ai lu et j'accepte les conditions d'utilisation <b>(obligatoire)</b></span></label>
  <label class="check"><input type="checkbox" name="optin"><span>J'accepte de recevoir des e-mails d'information de ${esc(BRAND.name)} (facultatif)</span></label>`;
}

// ---------- Connexion et inscription ----------
export function authScreen() {
  const L = S.authMode === 'login';
  return `<div class="splash" style="flex:none;padding:48px 20px 8px">${wordmark(46, 'Basket-ball')}<p>${L ? 'Content de te revoir.' : 'Crée ton compte en une minute.'}</p></div><main class="bd" style="padding-top:8px">
  <div class="chips" role="tablist"><button class="chip" data-act="authmode" data-v="login" aria-pressed="${L}">J'ai un compte</button><button class="chip" data-act="authmode" data-v="signup" aria-pressed="${!L}">Créer un compte</button></div>
  <form id="authf" class="card lift">
  ${L ? '' : `<div class="grid2">${field('an', 'Prénom', '<input id="an" name="first_name" required autocomplete="given-name">')}${field('an2', 'Nom', '<input id="an2" name="last_name" required autocomplete="family-name">')}</div>`}
  ${field('ae', 'Adresse e-mail', '<input id="ae" name="email" type="email" required autocomplete="email">')}
  <div class="field"><label for="ap">Mot de passe${L ? '' : ' (8 caractères minimum)'}</label><div class="pwd"><input id="ap" name="password" type="password" required minlength="${L ? 1 : 8}" autocomplete="${L ? 'current-password' : 'new-password'}"><button type="button" class="btn small ghost" data-act="pwtog" aria-pressed="false">Afficher</button></div></div>
  ${L ? '' : signupExtras()}
  <button class="btn main" type="submit">${L ? 'Me connecter' : 'Créer mon compte'}</button></form>
  ${L ? '<button class="btn link" data-act="forgot" style="align-self:center">Mot de passe oublié ?</button>' : ''}
  <button class="btn link" data-act="legal" style="align-self:center">Mentions légales et données</button><p class="note" style="text-align:center">${esc(BRAND.name)} ${esc(VERSION)} · version de test</p></main>`;
}
export function cguScreen() {
  return header({ title: 'Avant de continuer', brand: true }) + `<main class="bd"><p style="margin:0">L'application a évolué : lis et accepte les conditions de la version ${esc(VERSION)} pour continuer.</p>${legalText()}<form id="cguf" class="card lift"><label class="check"><input type="checkbox" name="cgu" required><span>J'ai lu et j'accepte les conditions d'utilisation</span></label><label class="check"><input type="checkbox" name="optin"><span>J'accepte de recevoir des e-mails d'information (facultatif)</span></label><button class="btn main" type="submit">Continuer</button></form></main>`;
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
  return `${field('lg', 'Logo du club (image, facultatif)', '<input id="lg" type="file" accept="image/*" data-logo="1">')}${hasLogo ? '<button type="button" class="btn small ghost" data-act="logorm">Retirer le logo</button>' : ''}
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
  let h = header({ title: o === 'create' ? 'Créer mon club' : o === 'join' ? 'Rejoindre un club' : `Salut ${esc(S.me.first_name || '')} !`, brand: true }) + '<main class="bd">';
  if (!o) {
    if (pend.length) h += `<div class="card warn"><div class="kick">Demande en attente</div>${pend.map((m) => `<b>${esc(S.clubs[m.club_id]?.name || 'Club')} · ${ROLES[m.role]}</b>`).join('')}<p class="note">Le club doit valider ta demande. Touche « Actualiser » ensuite.</p><button class="btn small ghost" data-act="refresh">Actualiser</button></div>`;
    h += `<div class="card yellow"><h3>Ton club t'a donné un code ?</h3><p class="note">8 caractères, demandés au coach ou au bureau.</p><button class="btn ink" data-act="onb" data-v="join">Rejoindre un club avec son code</button></div>
    <div class="card"><h3>Tu es président d'un club ?</h3><p class="note">Crée l'espace du club : tu pourras ensuite ajouter les équipes et inviter les membres.</p><button class="btn" data-act="onb" data-v="create">Créer mon club</button></div>
    <button class="btn link" data-act="account" style="align-self:center">Mon compte</button><button class="btn link" data-act="logout" style="align-self:center">Me déconnecter</button>`;
  } else if (o === 'create') {
    h += `<form id="clubf" class="card lift">
      ${field('cn', 'Nom du club', '<input id="cn" name="name" required maxlength="80">')}
      ${field('cv', 'Ville', '<input id="cv" name="city">')}
      ${field('cs', 'Sport', `<select id="cs" name="sport">${SPORTS.map((s) => `<option>${s}</option>`).join('')}</select>`)}
      ${logoFields(!!S.tmpLogo)}
      <div class="grid2">${field('c1', 'Couleur principale', '<input id="c1" name="c1" type="color" value="#2f5bff">')}${field('c2', 'Seconde couleur', '<input id="c2" name="c2" type="color" value="#ffc93c">')}</div>
      <div class="kick">Aperçu (si tu actives l'en-tête aux couleurs du club)</div><div data-prev>${brandPreview('', '#2F5BFF', S.tmpLogo, '#FFFFFF', true)}</div>
      <button class="btn main" type="submit">Créer le club (j'en suis président)</button></form><button class="btn ghost" data-act="onb" data-v="">Retour</button>`;
  } else {
    const j = S.join;
    h += `<div class="card lift">
      ${field('jc', 'Code du club (8 caractères)', `<input id="jc" data-j="code" value="${esc(j.code)}" autocapitalize="characters" maxlength="8" autocomplete="off">`)}
      <button class="btn small ghost" data-act="jcheck">Vérifier le code</button>
      ${j.clubName ? `<div class="pill ok">Club : ${esc(j.clubName)}</div>` : ''}
      <div class="kick">Je rejoins comme</div><div class="chips">${JOIN_ROLES.map((r) => `<button class="chip" data-act="jrole" data-v="${r}" aria-pressed="${j.role === r}">${ROLES[r]}</button>`).join('')}</div>
      ${roleExtra(j, 'j', j.teams)}
      <p class="note">${j.role === 'supporteur' ? 'Accès immédiat.' : "Le club valide ta demande. En attendant, tu n'as pas encore accès."}</p>
      <button class="btn main" data-act="jsend">Envoyer</button></div><button class="btn ghost" data-act="onb" data-v="">Retour</button>`;
  }
  return h + '</main>';
}
// Champs propres au rôle demandé (enfant, âge, équipe) ; p = préfixe des champs (j : rejoindre, r : autre rôle)
export function roleExtra(st, p, teams) {
  let h = '';
  if (st.role === 'parent') h += `<div class="grid2">${field(p + 'k', "Prénom de l'enfant", `<input id="${p}k" data-${p}="childf" value="${esc(st.childf || '')}">`)}${field(p + 'k2', "Nom de l'enfant", `<input id="${p}k2" data-${p}="childl" value="${esc(st.childl || '')}">`)}</div>`;
  if (st.role === 'joueur') h += `<label class="check"><input type="checkbox" data-${p}="age" ${st.age ? 'checked' : ''}><span>J'ai 15 ans ou plus</span></label>`;
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
  pwtog: (el) => { const i = document.getElementById('ap'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Masquer' : 'Afficher'; el.setAttribute('aria-pressed', show); },
  forgot: async () => { const em = document.getElementById('ae')?.value; if (!em) return toast('Indique ton adresse e-mail.'); await run(sb.auth.resetPasswordForEmail(em, { redirectTo: location.href.split('#')[0] }), 'E-mail de réinitialisation envoyé.'); },
  logout: async () => { await sb.auth.signOut(); },
  legal: () => { S.prevView = S.view; S.view = { type: 'legal' }; render(); },
  onb: (el, d) => { S.tmpLogo = undefined; S.onb = d.v || null; if (!d.v && isActive()) S.onb = null; render(); },
  onbopen: () => { S.onb = ''; S.view = null; render(); },
  jrole: (el, d) => { S.join.role = d.v; render(true); },
  logorm: (el) => { S.tmpLogo = null; const f = el.closest('form'); el.remove(); updatePreview(f); },
  jcheck: async () => {
    const r = await run(sb.rpc('teams_for_code', { p_code: S.join.code })); if (!r) return;
    if (!r.length) { S.join.clubName = ''; toast('Code inconnu. Vérifie les 8 caractères.'); return render(true); }
    S.join.teams = r.filter((x) => x.id); S.join.clubName = r[0].club_name; render(true);
  },
  jsend: async () => {
    const j = S.join; if (!j.code) return toast('Indique le code du club.');
    if (!checkRole(j)) return;
    const cid = await run(sb.rpc('join_club', { p_code: j.code, p_role: j.role, p_team: j.team || null, p_child_first: j.childf || null, p_child_last: j.childl || null }));
    if (cid === null) return;
    if (cid === true || !cid) return toast('Code inconnu. Vérifie les 8 caractères.');
    toast(j.role === 'supporteur' ? 'Bienvenue dans le club !' : 'Demande envoyée au club.');
    S.clubId = cid; store.set('pc_club', cid); S.onb = null; S.join = { code: '', role: 'supporteur', teams: [] }; await refresh();
  },
});
Object.assign(FORMS, {
  authf: async (v) => {
    if (S.authMode === 'login') return run(sb.auth.signInWithPassword({ email: v.email, password: v.password }));
    if (!v.cgu) return toast("Merci d'accepter les conditions d'utilisation.");
    const fn = niceFirst(v.first_name), ln = niceLast(v.last_name);
    const r = await run(sb.auth.signUp({ email: v.email, password: v.password, options: { data: { first_name: fn, last_name: ln, cgu_version: CGU_VERSION, optin_emails: !!v.optin } } }));
    if (r && !r.session) toast("Compte créé. Confirme ton adresse depuis l'e-mail reçu, puis connecte-toi.");
  },
  cguf: async (v) => { if (await run(sb.rpc('accept_cgu', { p_version: CGU_VERSION, p_optin: !!v.optin }), 'Merci, conditions acceptées.')) await refresh(); },
  clubf: async (v) => {
    const cid = await run(sb.rpc('create_club', { p_name: v.name.trim(), p_city: v.city.trim(), p_sport: v.sport, p_c1: v.c1.toUpperCase(), p_c2: v.c2.toUpperCase() }), 'Club créé. Tu en es président.');
    if (!cid) return;
    if (S.tmpLogo) await run(sb.from('clubs').update({ logo: S.tmpLogo, crest_bg: (v.bg || '#ffffff').toUpperCase() }).eq('id', cid));
    S.tmpLogo = undefined; S.clubId = cid; store.set('pc_club', cid); S.onb = null; S.tab = 4; await refresh();
  },
});
INPUTS.push((t) => {
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
