// mypocketclub · alpha 4.3.0 · audit de sécurité du 5 novembre 2026 (document « 09 audit securite 2026 11 05 » du projet)
// N° 124 : envoi des convocations réservé aux comptes validés par mypocketclub. Le président est validé par l'administrateur
//          (écran « Clubs à valider », Mon compte › Administration) ; la validation porte sur la personne et son rôle (décision de
//          Gaël, 5 novembre 2026, 13 h 26) ; une fonction donnée par un président validé vaut validation. Fin d'une année payée ou
//          d'une gratuité : pas de blocage, un encart rouge pour le président et les personnes qui envoient.
// N° 126 : liste des profils de test lue dans la base (plus d'adresses dans config.js, qui est public).
// N° 128 : blason du club et logo mypocketclub en images JPEG pour le PDF joint (pdfArt).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_4_3_0.sql) ; l'écran n'est qu'un confort.
import { BRAND, SWITCH_PROFILES } from '../config.js';
import { S, sb, esc, run, toast, render, ACTIONS, club, isBoard, isPresident, fmtDay, plural } from './core.js';
import { header, crest, icon, ballSrc, outlineColor } from './ui.js';
import { V37_TOP } from './v37.js';
import { saveSwitch } from './profils.js';

// ---------- n° 128 · images du PDF joint ----------
const ART = {};
const loadImg = (src) => new Promise((ok, ko) => { const i = new Image(); if (/^https?:/i.test(src)) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ko(new Error('image illisible')); i.src = src; });
async function toJpeg(cv) {
  const b = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));   // lève une erreur si l'image vient d'un site qui ne l'autorise pas
  if (!b) throw new Error('JPEG impossible');
  return { bytes: new Uint8Array(await b.arrayBuffer()), w: cv.width, h: cv.height };
}
const shield = (g, x, y, w, h) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h * 0.62); g.lineTo(x + w / 2, y + h); g.lineTo(x, y + h * 0.62); g.closePath(); };
// Le blason tel qu'il est dans l'en-tête de l'application (fonction crest de js/ui.js), sur la couleur du bandeau du PDF ;
// sans logo : le ballon du sport du club, comme le document imprimé
async function crestJpeg(c) {
  const bg = c.color1 || '#2F5BFF', K = 5, cv = document.createElement('canvas'), g = cv.getContext('2d');
  if (!c.logo) {
    const im = await loadImg(ballSrc(c.sport));
    cv.width = cv.height = 62 * K; g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    return toJpeg(cv);
  }
  const size = 58, h = Math.round(size * 1.14), o = outlineColor(c, bg), W = o ? size + 6 : size, H = o ? h + 7 : h;
  cv.width = W * K; cv.height = H * K; g.scale(K, K);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (o) { g.fillStyle = o; shield(g, 0, 0, W, H); g.fill(); }
  const ix = (W - size) / 2, iy = (H - h) / 2, im = await loadImg(c.logo);
  g.save(); shield(g, ix, iy, size, h); g.clip(); g.fillStyle = c.crest_bg || '#FFFFFF'; g.fillRect(ix, iy, size, h);
  const bw = size * 0.78, bh = h * 0.66, r = Math.min(bw / (im.naturalWidth || 1), bh / (im.naturalHeight || 1)), dw = (im.naturalWidth || 1) * r, dh = (im.naturalHeight || 1) * r;
  g.drawImage(im, ix + size / 2 - dw / 2, iy + h / 2 - size * 0.05 - dh / 2, dw, dh);
  g.restore();
  return toJpeg(cv);
}
// Le logo mypocketclub de la charte (img/logo-mypocketclub.svg, en tracés : aucune police à charger), sur le fond du pied de page
async function brandJpeg() {
  const im = await loadImg('img/logo-mypocketclub.svg'), cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.width = 1040; cv.height = Math.round(1040 * 136.8 / 652.5);
  g.fillStyle = '#F7F8FC'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
  return toJpeg(cv);
}
export async function pdfArt(d) {
  const c = d?.club || {}, key = [c.logo ? c.logo.length + ':' + c.logo.slice(-40) : '', c.crest_bg, c.crest_outline, c.color1, c.sport].join('|');
  if (!ART.brand) ART.brand = brandJpeg().catch(() => null);
  // logo illisible (site qui refuse, image abîmée) : le ballon du sport à la place
  if (!ART[key]) ART[key] = crestJpeg(c).catch(() => (c.logo ? crestJpeg({ ...c, logo: null }).catch(() => null) : null));
  const [cr, br] = await Promise.all([ART[key], ART.brand]);
  return { crest: cr || undefined, brand: br || undefined };
}

// ---------- n° 124 · état d'envoi du club (boutons grisés, encart rouge) ----------
const REASON = { paye: 'Payé', devis: 'Devis accepté', gratuite: 'Gratuité', test: 'Test' };
const PERIOD = { paye: 'L’année payée', devis: 'La période du devis', gratuite: 'La période gratuite' };
export async function loadV43() {
  const jobs = [];
  if (S.clubId && (isBoard() || isPresident())) jobs.push(sb.rpc('my_send_state', { p_club: S.clubId }).then((r) => { S.sendState = r.error ? null : r.data; }, () => { S.sendState = null; }));
  else S.sendState = null;
  if (S.isAdmin) jobs.push(sb.rpc('admin_clubs').then((r) => { const l = Array.isArray(r.data) ? r.data : []; S.avalN = l.filter((x) => x.president_id && !x.reason).length; }, () => {}));
  jobs.push(loadTestProfiles());
  await Promise.all(jobs);
}
// Encart rouge : fin de l'année payée ou de la gratuité atteinte (jamais à la création ; pas de blocage pour le moment)
export function sendBanner() {
  const s = S.sendState; if (!s) return '';
  // 4.10.0 · n° 182 : club dont le président n'est pas encore validé : date limite (30 jours), puis corbeille de 90 jours
  if (s.valid_by && !s.validated) {
    const d = new Date(s.valid_by), left = Math.ceil((d.getTime() - Date.now()) / 864e5);
    return `<div class="card alert" role="alert"><b>${esc(club()?.name || 'Ton club')} n’est pas encore validé.</b><span class="note" style="color:var(--pc-texte-ecran)">Date limite : le ${esc(d.toLocaleDateString('fr-FR'))}${left > 0 ? ` (dans ${left} jour${left > 1 ? 's' : ''})` : ''}. Sans validation, le club part à la corbeille pour 90 jours, puis il est effacé. Pour le faire valider, écris à <a href="mailto:${esc(BRAND.contact)}">${esc(BRAND.contact)}</a>.</span></div>`;
  }
  if (!s.period_over || !PERIOD[s.reason]) return '';
  return `<div class="card alert" role="alert"><b>${esc(PERIOD[s.reason])} de ${esc(club()?.name || 'ton club')} est terminée depuis le ${esc(fmtDay(s.ends_at + 'T12:00:00'))}.</b><span class="note" style="color:var(--pc-texte-ecran)">Sans renouvellement, le compte du club risque d’être supprimé. Pour continuer, écris à <a href="mailto:${esc(BRAND.contact)}">${esc(BRAND.contact)}</a>.</span></div>`;
}

// ---------- n° 124 · écran « Clubs à valider » (administrateur) ----------
const today = () => new Date().toLocaleDateString('sv-SE');
function clubCard(x) {
  const over = x.ends_at && x.ends_at <= today();
  const motif = `<div class="grid2"><div class="field"><label>Motif</label><select name="reason">${Object.entries(REASON).map(([k, v]) => `<option value="${k}" ${x.reason === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Fin de la période</label><input type="date" name="ends" value="${esc(x.ends_at || '')}"></div></div>
    <div class="field"><label>Note (facultatif)</label><input name="note" maxlength="300" value="${esc(x.note || '')}" placeholder="Devis n°, échange du…"></div>`;
  let h = `<div class="card" data-club="${esc(x.club_id)}"><div style="display:flex;gap:12px;align-items:center">${crest({ name: x.name, logo: x.logo, crest_bg: x.crest_bg, color1: x.color1 }, 34, '#FFFFFF')}<span class="g" style="flex:1"><b style="font-size:18px">${esc(x.name)}</b><span class="det" style="display:block">${esc([x.city, x.sport].filter(Boolean).join(' · '))} · ${plural(+x.members || 0, 'membre')} · créé le ${esc(fmtDay(x.created_at))}</span></span></div>`;
  if (!x.president_id) return h + '<p class="note" style="margin:0">Aucun président actif : rien à valider.</p></div>';
  h += `<div class="det">Président : <b>${esc(x.president_name || 'sans nom')}</b>${x.president_email ? ` · <a href="mailto:${esc(x.president_email)}">${esc(x.president_email)}</a>` : ''}</div>`;
  if (x.reason) h += `<div class="chips"><span class="pill ok">Validé · ${esc(REASON[x.reason] || x.reason)}</span>${x.ends_at ? `<span class="pill ${over ? 'ko' : ''}">${over ? 'Terminé le ' : 'Jusqu’au '}${esc(fmtDay(x.ends_at + 'T12:00:00'))}</span>` : ''}${x.validated_at ? `<span class="pill">depuis le ${esc(fmtDay(x.validated_at))}</span>` : ''}</div>`;
  h += `<details${x.reason ? '' : ' open'}><summary>${x.reason ? 'Modifier ou retirer' : 'Valider ce président'}</summary>${motif}
    <div class="btns"><button class="btn small main" data-act="avalok" data-cid="${esc(x.club_id)}" data-user="${esc(x.president_id)}">${icon('check', 18)}${x.reason ? 'Enregistrer' : 'Valider le président'}</button>${x.reason ? `<button class="btn small ghost" data-act="avalno" data-cid="${esc(x.club_id)}" data-user="${esc(x.president_id)}">Retirer la validation</button>` : ''}</div></details>`;
  return h + '</div>';
}
function avalScreen() {
  const head = header({ brand: true, back: true, kicker: 'Administration ' + BRAND.name, title: 'Clubs à valider' });
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  const l = S.aclubs; if (!l) return head + '<main class="bd"><p class="empty">Chargement…</p></main>';
  const todo = l.filter((x) => x.president_id && !x.reason), over = l.filter((x) => x.reason && x.ends_at && x.ends_at <= today()), okL = l.filter((x) => x.reason && !(x.ends_at && x.ends_at <= today())), none = l.filter((x) => !x.president_id);
  const sec = (t, arr, empty) => `<div class="sec"><h2>${t}</h2><span class="det">${arr.length}</span></div>` + (arr.length ? arr.map(clubCard).join('') : `<p class="empty">${empty}</p>`);
  return head + `<main class="bd"><div class="card pale" style="transform:none"><b>Envoi des convocations</b><span class="note" style="color:var(--pc-texte-ecran)">Un club envoie ses convocations par e-mail et dans ${esc(BRAND.name)} seulement quand son président est validé ici (après paiement, devis accepté ou gratuité). Les fonctions données par un président validé le sont aussi. Un nouveau président (club créé, présidence transférée) doit être validé à nouveau. Fin de période : un encart rouge prévient le club, l’envoi n’est pas coupé.</span></div>
    ${sec('À valider', todo, 'Aucun président en attente.')}${over.length ? sec('Fin de période atteinte', over, '') : ''}${sec('Validés', okL, 'Aucun club validé.')}${none.length ? `<details class="card flat"><summary>Sans président (${none.length})</summary>${none.map(clubCard).join('')}</details>` : ''}</main>`;
}
async function loadAclubs() { S.aclubs = (await run(sb.rpc('admin_clubs'))) || []; S.avalN = S.aclubs.filter((x) => x.president_id && !x.reason).length; }
export function adminValidateHome() {
  if (!S.isAdmin || !S.avalN) return '';
  return `<button class="card pale" data-act="aval" style="border:0;text-align:left;font:inherit;color:inherit"><span class="kick">Administration ${esc(BRAND.name)}</span><b>${plural(S.avalN, 'président à valider', 'présidents à valider')}</b><span class="det">Sans validation, le club n’envoie pas de convocation par e-mail.</span></button>`;
}
export const adminButtons = () => `<button class="btn" data-act="aval">${icon('check', 20)}Clubs à valider${S.avalN ? ' · ' + S.avalN : ''}</button><p class="note">Président validé = envoi des convocations par e-mail et dans ${esc(BRAND.name)} ouvert pour son club (n° 124).</p>`;
Object.assign(V37_TOP, { aval: () => avalScreen() });
Object.assign(ACTIONS, {
  aval: async () => { S.view = { type: 'aval' }; S.aclubs = null; render(); await loadAclubs(); render(true); },
  avalok: async (el, d) => {
    const box = el.closest('[data-club]'), reason = box.querySelector('[name=reason]').value, ends = box.querySelector('[name=ends]').value || null, note = box.querySelector('[name=note]').value || '';
    if (reason === 'gratuite' && !ends) return toast('Indique la date de fin de la gratuité.');
    if (await run(sb.rpc('admin_validate_sender', { p_club: d.cid, p_user: d.user, p_reason: reason, p_ends: ends, p_note: note }), 'Président validé : le club peut envoyer ses convocations.')) { await loadAclubs(); render(true); }
  },
  avalno: async (el, d) => { if (await run(sb.rpc('admin_unvalidate_sender', { p_club: d.cid, p_user: d.user }), 'Validation retirée : le club n’envoie plus de convocation par e-mail.')) { await loadAclubs(); render(true); } },
});

// ---------- n° 126 · profils de test lus dans la base ----------
// La liste n'est plus dans config.js (dépôt public) : la base la donne seulement à un compte qui en fait partie.
// Elle est gardée sur l'appareil pour que le sélecteur s'affiche tout de suite à l'ouverture suivante.
const LIST_KEY = 'pc_sw_list';
const setList = (l) => { SWITCH_PROFILES.splice(0, SWITCH_PROFILES.length, ...l.filter((p) => p && p.email && p.label).map((p) => ({ label: String(p.label), email: String(p.email).toLowerCase() }))); };
try { const l = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); if (Array.isArray(l)) setList(l); } catch { /* navigation privée */ }
export async function loadTestProfiles() {
  if (!S.session) return;
  // 4.4.1 : la requête de Supabase n'a pas de .catch (seulement .then) : l'ancien .catch() cassait le chargement de la liste
  let r = null; try { r = await sb.rpc('my_test_profiles'); } catch { r = null; }
  if (!Array.isArray(r?.data) || !r.data.length) return;   // compte hors liste : on garde ce qui est connu sur l'appareil
  setList(r.data);
  try { localStorage.setItem(LIST_KEY, JSON.stringify(SWITCH_PROFILES)); } catch { /* */ }
  saveSwitch(S.session);   // la connexion du compte courant est gardée maintenant que la liste est connue
}
