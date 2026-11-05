// mypocketclub · alpha 4.2.0 · envoi des convocations aux clubs reçus (document de référence : claude/09-convocations-inter-clubs.md)
// N° 109 : on cherche d'abord le club reçu dans mypocketclub ; trouvé → envoi dans l'application (le correspondant rencontres du club
//          reçu est prévenu, l'ouverture vaut accusé de lecture) ; pas trouvé → formulaire de coordonnées, envoi par e-mail (n° 112).
// N° 112 : fenêtre d'envoi : Madame ou Monsieur, prénom, nom, e-mail ; PDF fabriqué dans l'application (js/pdfmin.js) et joint ;
//          part de notifications@ au nom du club + catégories ; réponses vers la personne qui envoie, qui reçoit une copie ;
//          le contact saisi n'est pas gardé (décision de Gaël, 5 novembre 2026).
// Versions : un document modifié après un envoi part en « Mise à jour », référence suivie de -v2 (puis -v3…).
// N° 107 : un envoi raté est noté dans le suivi du rendez-vous, la personne est prévenue, bouton « Renvoyer ».
// 4.3.0 · n° 124 : envoi (e-mail et dans mypocketclub) réservé aux comptes validés par mypocketclub ; chaque e-mail est réservé dans
//          la base par la fonction envoyer-email avant de partir (limite enfin contraignante) ; le PDF reste libre.
//          n° 127 : « cette semaine » ou la date seule pour une rencontre en semaine ; n° 128 : blason du club et logo mypocketclub
//          dans le PDF ; n° 129 : plusieurs destinataires (dans mypocketclub, e-mail ou PDF envoyé à la main), « Envoyer à tous »
//          avec récapitulatif, un e-mail par destinataire, une seule copie au choix, plus de champ « Club reçu ».
import { BRAND } from '../config.js';
import { S, sb, esc, run, toast, render, ACTIONS, INPUTS, CHANGES, hooks, catGender, onColor, contrast } from './core.js';
import { icon, field } from './ui.js';
import { reference, weekendLabel, periodOf, mailSender, blocking, convocHtml } from './convoc.js';
import { Pdf, wrap, toBase64 } from './pdfmin.js';
import { pdfArt } from './v43.js';

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const paris = (iso) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
const dayLong = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const hhmm = (iso) => { const d = paris(iso); return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0'); };
const catOf = (x) => catGender(x.team) || x.team?.name || x.title;
const tint = (hex) => { const n = parseInt(String(hex).slice(1), 16), m = (v) => Math.round(v + (255 - v) * 0.9); return '#' + [m(n >> 16), m((n >> 8) & 255), m(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join(''); };
export const refOf = (d, step, version) => reference(d.club.name, d.from, step) + (version > 1 ? '-v' + version : '');
export const fileName = (d, step, version) => `${step === 'P' ? 'Pre-convocation' : 'Convocation'}-${refOf(d, step, version)}.pdf`;
// Empreinte du contenu : si elle change après un envoi, le prochain envoi est une nouvelle version (-v2)
export function docHash(d, step) {
  const s = JSON.stringify({ step, club: d.club?.name, k: d.correspondent, ev: (d.events || []).map((x) => [x.id, x.starts_at, x.place, x.opponents, x.cancelled, catOf(x), x.coach?.name, x.coach?.phone]) });
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
export const maskEmail = (e) => { const [u, dom] = String(e || '').split('@'); return dom ? (u.slice(0, 1) || '') + '***@' + dom : ''; };

// ---------- le PDF joint (même contenu que le document imprimé) ----------
// art = { crest, brand } : images JPEG fabriquées dans le navigateur (js/v43.js, pdfArt) ; sans elles, le texte seul (comme avant)
export function convocPdf(d, step, version = 1, now = new Date(), art = {}) {
  const c = d.club, c1 = c.color1 || '#2F5BFF', c2 = c.color2 || '#FFC93C', soft = tint(c1), head = contrast(c1, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#11162E';
  const pre = step === 'P', k = d.correspondent, when = weekendLabel(d.from, d.to), per = periodOf(d.from, d.to, now), ref = refOf(d, step, version), upd = version > 1;
  const pdf = new Pdf(), L = 14, R = 196, Wd = R - L;
  // n° 128 : blason du club (ou ballon du sport) à gauche du nom, comme dans l'en-tête de l'application
  const cr = art.crest, crH = 21, crW = cr ? Math.min(26, crH * cr.w / cr.h) : 0, nx = cr ? L + crW + 4 : L;
  const top = () => {
    pdf.rect(0, 0, 210, 32, c1);
    if (cr && !pdf.image(L, 5.5, crW, crH, cr.bytes)) { /* image illisible : le nom seul */ }
    pdf.text(nx, 15, c.name, { size: 18, bold: true, color: head });
    if (k) pdf.text(nx, 22.5, 'Correspondant : ' + [k.name, k.phone, k.email].filter(Boolean).join(' · '), { size: 9, color: head });
    pdf.text(R, 15, (pre ? 'Pré-convocation · Étape 1 sur 2' : 'Convocation · Étape 2 sur 2'), { size: 9, bold: true, color: head, align: 'right' });
    if (upd) pdf.text(R, 21, 'Mise à jour', { size: 9, bold: true, color: head, align: 'right' });
    pdf.rect(0, 32, 210, 3, c2);
  };
  // n° 128 : le vrai logo mypocketclub en pied de page (« my » en étiquette jaune, ballon étoile creuse, « club » en bleu)
  const br = art.brand, brW = 34, brH = br ? brW * br.h / br.w : 0;
  const foot = () => {
    pdf.rect(0, 280, 210, 17, '#F7F8FC'); pdf.line(0, 280, 210, 280);
    const logo = br && pdf.image(L, 288.5 - brH / 2, brW, brH, br.bytes);
    if (!logo) pdf.text(L, 289, BRAND.name, { size: 12, bold: true });
    pdf.text(L + (logo ? brW + 4 : 32), 289, 'Convocation créée et générée avec ' + BRAND.name, { size: 8.5, color: '#4A5068' });
    pdf.text(R, 287, 'Émise le ' + now.toLocaleDateString('fr-FR'), { size: 8.5, color: '#4A5068', align: 'right' });
    pdf.text(R, 292, 'Réf. ' + ref, { size: 8.5, color: '#4A5068', align: 'right' });
  };
  let y = 47;
  const room = (h) => { if (y + h > 272) { foot(); pdf.page(); top(); y = 47; } };
  top();
  pdf.text(L, y, pre ? per.label.toUpperCase() : 'CONVOCATION OFFICIELLE', { size: 10, bold: true, color: c1 }); y += 9;   // n° 127
  y = pdf.para(L, y, pre ? `${c.name} ${per.receive}` : `Matchs du ${when}`, Wd, { size: 19, bold: true, lh: 1.15 }) + 2;
  if (upd) { pdf.rect(L, y - 4, Wd, 8, '#FFF4D6'); pdf.text(L + 3, y + 1.2, 'Mise à jour : ce document remplace la version précédente.', { size: 9.5, bold: true }); y += 9; }
  y = pdf.para(L, y, pre ? 'Nous avons le plaisir de vous confirmer les rencontres suivantes à domicile. Le gymnase et les horaires vous seront communiqués dans la convocation définitive.'
    : `${c.name} aura le plaisir de vous accueillir aux dates et lieux suivants.`, Wd, { size: 10.5 }) + 3;
  if (pre) {
    const X = [L, L + 30, L + 92, L + 150];
    ['CATÉGORIE', 'CLUB(S) REÇU(S) · COMPÉTITION', 'COACH DE L’ÉQUIPE', 'HORAIRE'].forEach((t, i) => pdf.text(X[i], y, t, { size: 8, bold: true, color: c1 }));
    y += 2; pdf.line(L, y, R, y, c1, 0.6); y += 6;
    for (const x of d.events) {
      room(14); const st = !!x.cancelled;
      pdf.text(X[0], y, catOf(x), { size: 10, bold: true, strike: st });
      pdf.text(X[1], y, x.opponents || '—', { size: 10, strike: st });
      pdf.text(X[1], y + 4.5, x.type + (st ? ' · Annulée' : ''), { size: 8.5, color: st ? '#A52A12' : '#4A5068' });
      pdf.text(X[2], y, x.coach ? x.coach.name : '—', { size: 10 }); if (x.coach?.phone) pdf.text(X[2], y + 4.5, x.coach.phone, { size: 8.5, color: '#4A5068' });
      pdf.text(X[3], y, 'À venir', { size: 10 });
      y += 8; pdf.line(L, y, R, y, soft, 0.3); y += 5;
    }
  } else {
    for (const x of d.events) {
      room(28); const st = !!x.cancelled, y0 = y;
      pdf.rect(L, y0, Wd, 24, null, '#D8DCEA');
      pdf.rect(L + 4, y0 + 3, Math.min(60, 6 + catOf(x).length * 2.2), 5.5, c2); pdf.text(L + 6, y0 + 7, catOf(x), { size: 8.5, bold: true, color: onColor(c2) });
      pdf.text(L + 4, y0 + 13, `${c.name} – ${x.opponents || '—'}` + (st ? '   Annulée' : ''), { size: 11, bold: true, strike: st });
      pdf.text(L + 4, y0 + 17.5, [x.type, x.place].filter(Boolean).join(' · ').slice(0, 95), { size: 8.5, color: '#4A5068' });
      pdf.text(L + 4, y0 + 21.5, ('Coach : ' + (x.coach ? [x.coach.name, x.coach.phone, x.coach.email].filter(Boolean).join(' · ') : '—')).slice(0, 100), { size: 8.5, color: '#4A5068' });
      pdf.text(R - 4, y0 + 8, dayLong(paris(x.starts_at)), { size: 8.5, color: '#4A5068', align: 'right' });
      pdf.text(R - 4, y0 + 18, hhmm(x.starts_at), { size: 20, bold: true, color: c1, align: 'right' });
      y += 28;
    }
  }
  room(30);
  const box = pre ? 'Empêchement ou report ? Merci de prévenir au plus vite le coach de l’équipe, le correspondant du club et le comité.'
    : 'Merci de vous présenter 30 minutes avant la rencontre. En cas d’empêchement, prévenez au plus vite le coach de l’équipe, le correspondant du club et le comité.';
  const bl = wrap(box, 9.5, Wd - 8).length; pdf.rect(L, y, Wd, 4 + bl * 4.6, soft); pdf.rect(L, y, 1.4, 4 + bl * 4.6, c1); pdf.para(L + 5, y + 5, box, Wd - 8, { size: 9.5 }); y += 9 + bl * 4.6;
  if (pre) { y = pdf.para(L, y, 'À noter : la convocation définitive, avec le gymnase et l’horaire de chaque rencontre, suivra.', Wd, { size: 10 }) + 3; }
  room(14);
  pdf.text(L, y + 3, 'Sportivement,', { size: 10.5 }); pdf.text(L, y + 8.5, `${k ? k.name : '…………'}, correspondant de ${c.name}`, { size: 10.5, bold: true });
  foot();
  return pdf.bytes();
}

// ---------- carte « Envoyer aux clubs reçus » (n° 129 : plusieurs destinataires) ----------
let destN = 0;
const newDest = (mode) => ({ k: ++destN, mode: mode || 'app', q: '', res: null, pick: null, civ: 'Madame', first: '', last: '', email: '', err: '' });
const st = () => (S.convoc.send = S.convoc.send || { dest: [newDest()], copy: true, confirm: false, busy: false });
const canSend = () => S.convoc?.gate?.can !== false;   // n° 124 : réponse de la base (convocation_prepare) ; sans réponse, la base tranche à l'envoi
const STATUS = { envoye: ['Envoyé', 'blue'], lu: ['Lu', 'ok'], echec: ['Échec', 'ko'], en_cours: ['En cours', 'wait'] };
const CH = { app: 'Dans mypocketclub', email: 'E-mail', pdf: 'PDF' };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
function sendsList() {
  const l = S.convoc.sends || [];
  if (!l.length) return '<p class="note">Aucun envoi pour ce week-end.</p>';
  const dt = (x) => new Date(x).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  return `<div class="list">${l.map((s) => { const [lab, cls] = STATUS[s.status] || ['', ''];
    const who = s.channel === 'app' ? esc(s.target_name || 'club reçu') : s.channel === 'pdf' ? 'envoyé à la main' : esc(s.target_hint || s.target_name || 'contact');
    return `<div class="row static" style="flex-wrap:wrap"><span class="g">${s.step === 'P' ? 'Pré-convocation' : 'Convocation'}${s.version > 1 ? ' -v' + s.version : ''} · ${CH[s.channel] || ''} · ${who}<small>${esc(dt(s.sent_at))}${s.sender ? ' · ' + esc(s.sender) : ''}${s.read_at ? ' · lu le ' + esc(dt(s.read_at)) : ''}${s.error ? ' · ' + esc(s.error) : ''}</small></span><span class="pill ${cls}">${lab}</span>${s.status === 'echec' && s.channel === 'email' ? `<button class="btn small main" data-act="cvretry" data-id="${s.id}">Renvoyer</button>` : ''}</div>`; }).join('')}</div>`;
}
function destCard(x, i, n, d) {
  const off = !canSend(), chip = (m, lab) => `<button type="button" class="chip" data-act="cvmode" data-i="${i}" data-v="${m}" aria-pressed="${x.mode === m}" ${off && m !== 'pdf' ? 'disabled style="opacity:.45"' : ''}>${lab}</button>`;
  let h = `<div class="card flat" data-dest="${x.k}"${x.err ? ' style="border-color:var(--pc-non-texte)"' : ''}><div class="kick" style="display:flex;justify-content:space-between;align-items:center">Destinataire${n > 1 ? ' ' + (i + 1) : ''}${n > 1 ? `<button type="button" class="btn link small" data-act="cvdel" data-i="${i}">Retirer</button>` : ''}</div>
    <div class="chips">${chip('app', 'Dans mypocketclub')}${chip('email', 'Par e-mail')}${chip('pdf', 'PDF, je l’envoie')}</div>`;
  if (x.mode === 'app') {
    if (x.pick) h += `<div class="row static"><span class="g"><b>${esc(x.pick.name)}</b><small>${esc(x.pick.city || '')} · son correspondant rencontres est prévenu ; tu vois quand le document est ouvert.</small></span><button type="button" class="btn small ghost" data-act="cvunpick" data-i="${i}">Changer</button></div>`;
    else {
      h += field('cvq' + i, 'Chercher le club reçu', `<input id="cvq${i}" type="search" value="${esc(x.q)}" placeholder="Nom ou ville" data-cvq="${i}">`);
      if (x.res) h += x.res.length ? `<div class="list">${x.res.map((c) => `<button type="button" class="row" data-act="cvpick" data-i="${i}" data-id="${c.id}"><span class="g">${esc(c.name)}<small>${esc([c.city, c.sport].filter(Boolean).join(' · '))}</small></span><span class="pill blue">Choisir</span></button>`).join('')}</div>` : `<p class="note">Aucun club trouvé dans ${esc(BRAND.name)} : choisis « Par e-mail ».</p>`;
    }
  } else if (x.mode === 'email') {
    const f = (id, lab, inp) => field(id + i, lab, inp);
    h += `<div class="grid2">${f('cvciv', 'Madame ou Monsieur', `<select id="cvciv${i}" data-cvf="civ" data-i="${i}"><option ${x.civ === 'Madame' ? 'selected' : ''}>Madame</option><option ${x.civ === 'Monsieur' ? 'selected' : ''}>Monsieur</option></select>`)}${f('cvmail', 'E-mail du contact', `<input id="cvmail${i}" type="email" value="${esc(x.email)}" maxlength="120" data-cvf="email" data-i="${i}" autocomplete="off">`)}</div>
      <div class="grid2">${f('cvfirst', 'Prénom', `<input id="cvfirst${i}" value="${esc(x.first)}" maxlength="60" data-cvf="first" data-i="${i}" autocomplete="off">`)}${f('cvlast', 'Nom', `<input id="cvlast${i}" value="${esc(x.last)}" maxlength="60" data-cvf="last" data-i="${i}" autocomplete="off">`)}</div>`;
  } else h += `<p class="note" style="margin:0">Le PDF se télécharge : tu l’envoies toi-même (ta messagerie, WhatsApp…). L’envoi est noté « envoyé à la main » dans le suivi.</p>`;
  if (x.err) h += `<p class="note" style="margin:0;color:var(--pc-non-texte)"><b>${esc(x.err)}</b></p>`;
  return h + '</div>';
}
const label = (x) => (x.mode === 'app' ? `Dans ${BRAND.name} · ${x.pick?.name || '?'}` : x.mode === 'email' ? `E-mail · ${x.civ} ${[x.first, x.last].filter(Boolean).join(' ')} (${x.email})` : 'PDF à télécharger, envoyé à la main');
function problem(x) {
  if (x.mode === 'app') return x.pick ? '' : 'Choisis le club reçu dans la liste.';
  if (x.mode === 'email') return !x.last.trim() ? 'Indique le nom du contact.' : !EMAIL_RE.test(x.email.trim()) ? 'Adresse e-mail à vérifier.' : '';
  return '';
}
export function sendCard(d, step) {
  const s = st(), off = blocking(d, step) || !d.events.length;
  if (!canSend()) s.dest.forEach((x) => { x.mode = 'pdf'; });   // n° 124 : sans validation, seul le PDF envoyé à la main reste possible
  let h = `<div class="card"><div class="kick">Envoyer aux clubs reçus</div>`;
  if (off) return h + `<button class="btn small ghost" data-act="convpdf" disabled>${icon('down', 18)}Imprimer ou enregistrer le PDF</button><p class="note">Complète d’abord ce qui manque ci-dessus.</p></div>`;
  h += `<div class="btns"><button class="btn small ghost" data-act="convpdf">${icon('down', 18)}Imprimer ou enregistrer le PDF</button><button class="btn small ghost" data-act="cvpreview">${icon('doc', 18)}Voir le PDF joint</button></div>`;
  // n° 124 : compte non validé → envoi grisé, le PDF reste libre
  if (!canSend()) h += `<div class="card warn" style="transform:none"><b>Envoi réservé aux comptes validés par ${esc(BRAND.name)}</b><span class="note" style="color:var(--pc-encre)">Tu peux télécharger le PDF et l’envoyer toi-même. Pour ouvrir l’envoi par e-mail et dans ${esc(BRAND.name)}, écris à <a href="mailto:${esc(BRAND.contact)}">${esc(BRAND.contact)}</a>.</span></div>`;
  const n = s.dest.length, mails = s.dest.filter((x) => x.mode === 'email').length, left = S.convoc.gate?.left;
  if (s.confirm) {
    h += `<div class="card lift" style="transform:none"><b>${n > 1 ? n + ' envois' : 'Un envoi'} à faire</b><div class="list">${s.dest.map((x) => `<div class="row static"><span class="g">${esc(label(x))}</span></div>`).join('')}</div>
      ${mails ? `<p class="note" style="margin:0">${mails > 1 ? 'Un e-mail séparé par destinataire. ' : ''}${s.copy ? 'Tu reçois une copie (une seule).' : 'Sans copie pour toi.'}</p>` : ''}
      <div class="btns"><button class="btn main" data-act="cvgo" ${s.busy ? 'disabled' : ''}>${icon('mail', 20)}${s.busy ? 'Envoi…' : 'Confirmer l’envoi'}</button><button class="btn ghost small" data-act="cvedit" ${s.busy ? 'disabled' : ''}>Modifier</button></div></div>`;
  } else {
    h += s.dest.map((x, i) => destCard(x, i, n, d)).join('');
    h += `<button class="btn ghost small" data-act="cvadd">${icon('plus', 18)}Ajouter un destinataire</button>`;
    if (mails) h += `<label class="check"><input type="checkbox" data-cvcopy="1" ${s.copy ? 'checked' : ''}><span><b>M’envoyer une copie</b><br><span class="det">Une seule copie, même avec plusieurs destinataires.</span></span></label>
      <p class="note" style="margin:0">Pièce jointe : <b>${esc(fileName(d, step, S.convoc.version || 1))}</b>. Les e-mails partent de ${esc(BRAND.mailFrom)} au nom de « ${esc(mailSender(d))} » ; le club reçu répond à ton adresse (${esc(d.sender?.email || 'ton e-mail')}). Le contact saisi n’est pas gardé.</p>
      ${left != null && mails > left ? `<p class="note" style="margin:0;color:var(--pc-non-texte)"><b>Encore ${left} e-mail${left > 1 ? 's' : ''} possible${left > 1 ? 's' : ''} aujourd’hui pour le club.</b></p>` : ''}`;
    h += `<button class="btn main" data-act="cvall">${icon('mail', 20)}${n > 1 ? 'Envoyer à tous' : 'Envoyer'}</button>`;
  }
  return h + `<div class="kick" style="margin-top:8px">Suivi des envois</div>${sendsList()}</div>`;
}
// Résumé dans la page du rendez-vous (le suivi complet est dans l'écran de la convocation)
export function sendsSummary(eid) {
  const l = (S.csends || {})[eid]; if (!l?.length) return '';
  const fail = l.filter((s) => s.status === 'echec').length, read = l.filter((s) => s.read_at).length;
  return `<p class="note" style="margin:0">${l.length} envoi${l.length > 1 ? 's' : ''} ce week-end${read ? ` · ${read} lu${read > 1 ? 's' : ''}` : ''}${fail ? ` · <b style="color:var(--pc-rouge,#A52A12)">${fail} en échec</b>` : ''}</p>`;
}

export async function loadSends(eid) {
  const r = await sb.rpc('convocation_sends_of', { p_event: eid });
  S.csends = S.csends || {}; S.csends[eid] = Array.isArray(r.data) ? r.data : [];
  if (S.convoc && S.convoc.eid === eid) { S.convoc.sends = S.csends[eid]; if (S.convoc.data) await prepare(true); }
}
// Version du document, e-mails encore possibles aujourd'hui, et droit d'envoyer (n° 124)
async function prepare(quiet) {
  const v = S.convoc, d = v.data, hash = docHash(d, v.step);
  const q = sb.rpc('convocation_prepare', { p_event: v.eid, p_step: v.step, p_ref: reference(d.club.name, d.from, v.step), p_hash: hash });
  const p = quiet ? (await q).data : await run(q);
  if (!p || typeof p !== 'object') return null;
  v.version = +p.version || 1; v.gate = { can: p.can_send !== false, left: p.email_left };
  return { hash, version: v.version, left: p.email_left, can: p.can_send !== false };
}
const record = (o) => sb.rpc('convocation_record', {
  p_event: S.convoc.eid, p_step: S.convoc.step, p_ref: reference(S.convoc.data.club.name, S.convoc.data.from, S.convoc.step), p_version: o.version, p_hash: o.hash,
  p_channel: o.channel, p_target_club: o.club || null, p_target_name: o.name || '', p_target_hint: '', p_status: 'envoye', p_error: '', p_payload: o.payload || null,
});
// Message d'erreur de la fonction envoyer-email (corps JSON d'une réponse 4xx ou 5xx)
async function fnError(error, data) {
  let b = data; try { if (!b && error?.context?.json) b = await error.context.json(); } catch { /* */ }
  const m = String(b?.erreur || '');
  if (b?.code === 'non_valide' || /valid/i.test(m)) return `Envoi réservé aux comptes validés par ${BRAND.name}.`;
  if (b?.code === 'limite' || /limite/i.test(m)) return 'Limite d’e-mails du jour atteinte : réessaie demain.';
  if (/Resend/i.test(m)) return 'L’e-mail n’est pas parti (adresse refusée ou service indisponible) : vérifie l’adresse puis réessaie.';
  return m ? 'Non envoyé : ' + m : 'L’e-mail n’est pas parti : réessaie.';
}
const download = (bytes, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
async function sendAll() {
  const v = S.convoc, s = st(), d = v.data; if (s.busy) return; s.busy = true; render(true);
  let done = 0, failed = 0;
  try {
    const p = await prepare(); if (!p) return;
    const now = new Date(), art = await pdfArt(d).catch(() => ({}));
    const bytes = convocPdf(d, v.step, p.version, now, art), filename = fileName(d, v.step, p.version), b64 = toBase64(bytes);
    let copied = false, pdfDone = false;
    for (const x of s.dest) {
      x.err = '';
      if (x.mode === 'app') {
        const r = await record({ ...p, channel: 'app', club: x.pick.id, name: x.pick.name, payload: v.data });
        if (r.error) x.err = /valid/i.test(r.error.message || '') ? `Envoi réservé aux comptes validés par ${BRAND.name}.` : 'Non envoyé : ' + (r.error.message || 'réessaie');
      } else if (x.mode === 'email') {
        let ok = false;
        try {
          const { data, error } = await sb.functions.invoke('envoyer-email', { body: { convocation: { event_id: v.eid, step: v.step, version: p.version, hash: p.hash, copy: s.copy && !copied,
            to: { civ: x.civ, first: x.first.trim(), last: x.last.trim(), email: x.email.trim() }, filename, pdf: b64 } } });
          ok = !error && data?.envoye === true; if (!ok) x.err = await fnError(error, data);
        } catch { x.err = 'L’e-mail n’est pas parti : réessaie.'; }
        if (ok && s.copy) copied = true;
      } else {
        if (!pdfDone) { download(bytes, filename); pdfDone = true; }
        const r = await record({ ...p, channel: 'pdf' }); if (r.error) x.err = 'Non noté dans le suivi : ' + (r.error.message || 'réessaie');
      }
      x.err ? failed++ : done++;
    }
    s.dest = s.dest.filter((x) => x.err); if (!s.dest.length) s.dest = [newDest(canSend() ? 'app' : 'pdf')];
    s.confirm = false;
    toast(failed ? `${done} envoi${done > 1 ? 's' : ''} fait${done > 1 ? 's' : ''}, ${failed} en échec : voir le destinataire en rouge.` : `${done > 1 ? done + ' envois faits' : 'Envoi fait'}.${copied ? ' Tu reçois une copie.' : ''}`);
    await loadSends(v.eid);
  } finally { s.busy = false; render(true); }
}

Object.assign(ACTIONS, {
  cvpreview: async () => {
    const v = S.convoc; if (!v?.data) return;
    const w = window.open('', '_blank'); if (!w) return toast('Autorise les fenêtres pour voir le PDF.');
    const p = await prepare(), art = await pdfArt(v.data).catch(() => ({}));
    w.location.href = URL.createObjectURL(new Blob([convocPdf(v.data, v.step, p?.version || 1, new Date(), art)], { type: 'application/pdf' }));
  },
  cvmode: (el, d) => { const s = st(), x = s.dest[+d.i]; if (!x || (!canSend() && d.v !== 'pdf')) return; x.mode = d.v; x.err = ''; render(true); },
  cvadd: () => { const s = st(); s.dest.push(newDest(canSend() ? (s.dest.length ? 'email' : 'app') : 'pdf')); render(true); },
  cvdel: (el, d) => { const s = st(); s.dest.splice(+d.i, 1); if (!s.dest.length) s.dest = [newDest()]; render(true); },
  cvpick: (el, d) => { const x = st().dest[+d.i]; if (!x) return; x.pick = (x.res || []).find((c) => c.id === d.id) || null; x.err = ''; render(true); },
  cvunpick: (el, d) => { const x = st().dest[+d.i]; if (x) { x.pick = null; x.res = null; } render(true); },
  cvall: () => {
    const s = st(); let bad = false;
    for (const x of s.dest) { x.err = problem(x); if (x.err) bad = true; }
    if (!canSend() && s.dest.some((x) => x.mode !== 'pdf')) { toast(`Envoi réservé aux comptes validés par ${BRAND.name} : choisis « PDF, je l’envoie ».`); return render(true); }
    if (bad) { toast('À compléter : voir le destinataire en rouge.'); return render(true); }
    s.confirm = true; render(true);
  },
  cvedit: () => { st().confirm = false; render(true); },
  cvgo: () => sendAll(),
  cvretry: (el, d) => {
    const x = (S.convoc.sends || []).find((y) => y.id === d.id); if (!x) return;
    if (x.step !== S.convoc.step) S.convoc.step = x.step;
    // le contact n'est pas gardé : un destinataire « Par e-mail » vide s'ouvre, à compléter (la tentative ratée reste dans le suivi)
    const s = st(); s.confirm = false; s.dest = [newDest('email')]; render(true);
    requestAnimationFrame(() => document.getElementById('cvmail0')?.focus());
  },
  // côté club reçu : ouvrir la convocation reçue (accusé de lecture)
  cvopen: async (el, d) => {
    const r = await run(sb.rpc('convocation_open', { p_send: d.id })); if (!r?.data) return;
    const w = window.open('', '_blank'); if (!w) return toast('Autorise les fenêtres pour lire le document.');
    w.document.open(); w.document.write(convocHtml(r.data, r.step, new Date(), { version: r.version, print: false })); w.document.close();
    const x = (S.creceived || []).find((y) => y.id === d.id); if (x && !x.read_at) { x.read_at = new Date().toISOString(); render(true); }
  },
});
CHANGES.push((t) => {
  if (t.dataset?.cvcopy) { st().copy = t.checked; return true; }
  if (t.dataset?.cvf === 'civ') { const x = st().dest[+t.dataset.i]; if (x) x.civ = t.value; return true; }
  return false;
});
let qTimer = 0;
INPUTS.push((t) => {
  if (!S.convoc) return false;
  if (t.dataset?.cvf) { const x = st().dest[+t.dataset.i]; if (x) x[t.dataset.cvf] = t.value; return true; }
  if (t.dataset?.cvq == null) return false;
  const i = +t.dataset.cvq, x = st().dest[i]; if (!x) return true;
  x.q = t.value; clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const q = x.q.trim(), r = q.length >= 2 ? await sb.rpc('public_search_clubs', { p_query: q, p_sport: S.convoc.data?.club?.sport || null }) : { data: null };
    x.res = Array.isArray(r.data) ? r.data.filter((c) => c.id !== S.clubId) : q.length >= 2 ? [] : null; const pos = t.selectionStart; render(true);
    const n = document.getElementById('cvq' + i); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } }
  }, 250);
  return true;
});

// ---------- convocations reçues dans mypocketclub (rubrique Événements du club reçu) ----------
export async function loadReceived() {
  const r = await sb.rpc('convocations_received', { p_club: S.clubId }); S.creceived = Array.isArray(r.data) ? r.data : [];
}
export function receivedBlock() {
  const l = S.creceived || []; if (!l.length) return '';
  return `<div class="sec"><h2>Convocations reçues</h2><span class="det">${l.filter((x) => !x.read_at).length || ''}</span></div><div class="card"><div class="list">${l.map((x) => `<button class="row" data-act="cvopen" data-id="${x.id}"><span class="g">${x.step === 'P' ? 'Pré-convocation' : 'Convocation'}${x.version > 1 ? ' -v' + x.version : ''} · ${esc(x.from_club || '')}<small>Réf. ${esc(x.ref + (x.version > 1 ? '-v' + x.version : ''))} · ${esc(new Date(x.sent_at).toLocaleDateString('fr-FR'))}</small></span>${x.read_at ? '<span class="pill ok">Lu</span>' : '<span class="pill wait">Nouveau</span>'}</button>`).join('')}</div></div>`;
}
hooks.receivedBlock = receivedBlock;
