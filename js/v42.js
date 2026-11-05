// mypocketclub · alpha 4.2.0 · envoi des convocations aux clubs reçus (document de référence : claude/09-convocations-inter-clubs.md)
// N° 109 : on cherche d'abord le club reçu dans mypocketclub ; trouvé → envoi dans l'application (le correspondant rencontres du club
//          reçu est prévenu, l'ouverture vaut accusé de lecture) ; pas trouvé → formulaire de coordonnées, envoi par e-mail (n° 112).
// N° 112 : fenêtre d'envoi : Madame ou Monsieur, prénom, nom, e-mail ; PDF fabriqué dans l'application (js/pdfmin.js) et joint ;
//          part de notifications@ au nom du club + catégories ; réponses vers la personne qui envoie, qui reçoit une copie ;
//          le contact saisi n'est pas gardé (décision de Gaël, 5 novembre 2026).
// Versions : un document modifié après un envoi part en « Mise à jour », référence suivie de -v2 (puis -v3…).
// N° 107 : un envoi raté est noté dans le suivi du rendez-vous, la personne est prévenue, bouton « Renvoyer ».
import { S, sb, esc, run, toast, render, ACTIONS, FORMS, INPUTS, hooks, catGender, onColor, contrast } from './core.js';
import { icon, field } from './ui.js';
import { reference, weekendLabel, mailSender, blocking, convocHtml } from './convoc.js';
import { Pdf, wrap, toBase64 } from './pdfmin.js';

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

// ---------- le PDF joint (même contenu que le document imprimé, sans le blason) ----------
export function convocPdf(d, step, version = 1, now = new Date()) {
  const c = d.club, c1 = c.color1 || '#2F5BFF', c2 = c.color2 || '#FFC93C', soft = tint(c1), head = contrast(c1, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#11162E';
  const pre = step === 'P', k = d.correspondent, when = weekendLabel(d.from, d.to), ref = refOf(d, step, version), upd = version > 1;
  const pdf = new Pdf(), L = 14, R = 196, Wd = R - L;
  const top = () => {
    pdf.rect(0, 0, 210, 32, c1);
    pdf.text(L, 15, c.name, { size: 18, bold: true, color: head });
    if (k) pdf.text(L, 22.5, 'Correspondant : ' + [k.name, k.phone, k.email].filter(Boolean).join(' · '), { size: 9, color: head });
    pdf.text(R, 15, (pre ? 'Pré-convocation · Étape 1 sur 2' : 'Convocation · Étape 2 sur 2'), { size: 9, bold: true, color: head, align: 'right' });
    if (upd) pdf.text(R, 21, 'Mise à jour', { size: 9, bold: true, color: head, align: 'right' });
    pdf.rect(0, 32, 210, 3, c2);
  };
  const foot = () => {
    pdf.rect(0, 280, 210, 17, '#F7F8FC'); pdf.line(0, 280, 210, 280);
    pdf.text(L, 289, 'mypocketclub', { size: 12, bold: true });
    pdf.text(L + 32, 289, 'Convocation créée et générée avec mypocketclub', { size: 8.5, color: '#4A5068' });
    pdf.text(R, 287, 'Émise le ' + now.toLocaleDateString('fr-FR'), { size: 8.5, color: '#4A5068', align: 'right' });
    pdf.text(R, 292, 'Réf. ' + ref, { size: 8.5, color: '#4A5068', align: 'right' });
  };
  let y = 47;
  const room = (h) => { if (y + h > 272) { foot(); pdf.page(); top(); y = 47; } };
  top();
  pdf.text(L, y, pre ? `WEEK-END DU ${when.toUpperCase()}` : 'CONVOCATION OFFICIELLE', { size: 10, bold: true, color: c1 }); y += 9;
  y = pdf.para(L, y, pre ? `${c.name} vous reçoit ce week-end` : `Matchs du ${when}`, Wd, { size: 19, bold: true, lh: 1.15 }) + 2;
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

// ---------- carte « Envoyer aux clubs reçus » ----------
const st = () => (S.convoc.send = S.convoc.send || { q: '', res: null, pick: null, mail: null, busy: false });
const STATUS = { envoye: ['Envoyé', 'blue'], lu: ['Lu', 'ok'], echec: ['Échec', 'ko'] };
function sendsList() {
  const l = S.convoc.sends || [];
  if (!l.length) return '<p class="note">Aucun envoi pour ce week-end.</p>';
  return `<div class="list">${l.map((s) => { const [lab, cls] = STATUS[s.status] || ['', '']; const when = new Date(s.sent_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    return `<div class="row static" style="flex-wrap:wrap"><span class="g">${s.step === 'P' ? 'Pré-convocation' : 'Convocation'}${s.version > 1 ? ' -v' + s.version : ''} · ${esc(s.target_name || 'club reçu')}<small>${s.channel === 'app' ? 'Dans mypocketclub' : 'E-mail ' + esc(s.target_hint || '')} · ${esc(when)}${s.sender ? ' · ' + esc(s.sender) : ''}${s.read_at ? ' · lu le ' + esc(new Date(s.read_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })) : ''}${s.error ? ' · ' + esc(s.error) : ''}</small></span><span class="pill ${cls}">${lab}</span>${s.status === 'echec' ? `<button class="btn small main" data-act="cvretry" data-id="${s.id}">Renvoyer</button>` : ''}</div>`; }).join('')}</div>`;
}
export function sendCard(d, step) {
  const s = st(), off = blocking(d, step) || !d.events.length;
  let h = `<div class="card"><div class="kick">Envoyer aux clubs reçus</div>`;
  if (off) return h + `<button class="btn small ghost" data-act="convpdf" disabled>${icon('down', 18)}Imprimer ou enregistrer le PDF</button><p class="note">Complète d’abord ce qui manque ci-dessus.</p></div>`;
  h += `<div class="btns"><button class="btn small ghost" data-act="convpdf">${icon('down', 18)}Imprimer ou enregistrer le PDF</button><button class="btn small ghost" data-act="cvpreview">${icon('doc', 18)}Voir le PDF joint</button></div>`;
  if (s.mail) {
    const m = s.mail;
    h += `<form id="cvmailf" class="card flat"><div class="kick">Par e-mail${m.club ? ' · ' + esc(m.club) : ''}</div>
      <div class="grid2">${field('cvciv', 'Madame ou Monsieur', `<select id="cvciv" name="civ"><option ${m.civ === 'Madame' ? 'selected' : ''}>Madame</option><option ${m.civ === 'Monsieur' ? 'selected' : ''}>Monsieur</option></select>`)}${field('cvclub', 'Club reçu', `<input id="cvclub" name="club" value="${esc(m.club || '')}" maxlength="80" required>`)}</div>
      <div class="grid2">${field('cvfirst', 'Prénom', `<input id="cvfirst" name="first" value="${esc(m.first || '')}" maxlength="60" required>`)}${field('cvlast', 'Nom', `<input id="cvlast" name="last" value="${esc(m.last || '')}" maxlength="60" required>`)}</div>
      ${field('cvmail', 'E-mail du contact', `<input id="cvmail" name="email" type="email" value="${esc(m.email || '')}" maxlength="120" required>`)}
      <p class="note" style="margin:0">Pièce jointe : <b>${esc(fileName(d, step, S.convoc.version || 1))}</b>. L’e-mail part de notifications@mypocketclub.fr au nom de « ${esc(mailSender(d))} » ; le club reçu répond à ton adresse (${esc(d.sender?.email || 'ton e-mail')}) et tu reçois une copie. Le contact saisi n’est pas gardé.</p>
      <button class="btn main" type="submit" ${s.busy ? 'disabled' : ''}>${icon('mail', 20)}${s.busy ? 'Envoi…' : 'Envoyer'}</button><button class="btn ghost small" type="button" data-act="cvcancel">Annuler</button></form>`;
  } else if (s.pick) {
    h += `<div class="card flat"><b>${esc(s.pick.name)}</b><span class="det">${esc(s.pick.city || '')} · le correspondant rencontres du club est prévenu ; tu vois quand le document est ouvert.</span><button class="btn main" data-act="cvapp" ${s.busy ? 'disabled' : ''}>${icon('msg', 20)}${s.busy ? 'Envoi…' : 'Envoyer dans mypocketclub'}</button><button class="btn ghost small" data-act="cvmail" data-v="${esc(s.pick.name)}">Envoyer plutôt par e-mail</button><button class="btn ghost small" data-act="cvcancel">Choisir un autre club</button></div>`;
  } else {
    h += field('cvq', 'Chercher le club reçu', `<input id="cvq" type="search" value="${esc(s.q)}" placeholder="Nom ou ville" data-cvq="1">`);
    if (s.res) h += s.res.length ? `<div class="list">${s.res.map((c) => `<button class="row" data-act="cvpick" data-id="${c.id}"><span class="g">${esc(c.name)}<small>${esc([c.city, c.sport].filter(Boolean).join(' · '))}</small></span><span class="pill blue">Choisir</span></button>`).join('')}</div>` : '<p class="note">Aucun club trouvé dans mypocketclub.</p>';
    h += `<button class="btn ghost small" data-act="cvmail" data-v="${esc(s.q || (d.events.length === 1 ? d.events[0].opponents || '' : ''))}">${icon('mail', 18)}Le club n’est pas dans mypocketclub : envoyer par e-mail</button>`;
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
  if (S.convoc && S.convoc.eid === eid) S.convoc.sends = S.csends[eid];
}
async function prepare() {
  const v = S.convoc, d = v.data, hash = docHash(d, v.step);
  const p = await run(sb.rpc('convocation_prepare', { p_event: v.eid, p_step: v.step, p_ref: reference(d.club.name, d.from, v.step), p_hash: hash }));
  if (!p || typeof p !== 'object') return null;
  v.version = +p.version || 1; return { hash, version: v.version, left: p.email_left };
}
const record = (o) => sb.rpc('convocation_record', {
  p_event: S.convoc.eid, p_step: S.convoc.step, p_ref: reference(S.convoc.data.club.name, S.convoc.data.from, S.convoc.step), p_version: o.version, p_hash: o.hash,
  p_channel: o.channel, p_target_club: o.club || null, p_target_name: o.name || '', p_target_hint: o.hint || '', p_status: o.status, p_error: o.error || '', p_payload: o.payload || null,
});
async function sendMail(m) {
  const v = S.convoc, s = st(), d = v.data; s.busy = true; render(true);
  try {
    const p = await prepare(); if (!p) return;
    if (p.left === 0) { toast('Limite d’envois du jour atteinte : réessaie demain.'); return; }
    const bytes = convocPdf(d, v.step, p.version), filename = fileName(d, v.step, p.version);
    let ok = false, err = '';
    try {
      const { data, error } = await sb.functions.invoke('envoyer-email', { body: { convocation: { event_id: v.eid, step: v.step, version: p.version, to: { civ: m.civ, first: m.first, last: m.last, email: m.email }, club: m.club, filename, pdf: toBase64(bytes) } } });
      ok = !error && data?.envoye === true; err = error ? 'e-mail non parti' : data?.erreur || '';
    } catch { err = 'e-mail non parti'; }
    await record({ ...p, channel: 'email', name: m.club, hint: maskEmail(m.email), status: ok ? 'envoye' : 'echec', error: ok ? '' : err || 'e-mail non parti' });
    toast(ok ? `E-mail envoyé à ${m.civ} ${m.last}. Tu reçois une copie.` : 'L’e-mail n’est pas parti : l’échec est noté dans le suivi, touche « Renvoyer ».');
    if (ok) s.mail = null;
    await loadSends(v.eid);
  } finally { s.busy = false; render(true); }
}

Object.assign(ACTIONS, {
  cvpreview: async () => {
    const v = S.convoc; if (!v?.data) return;
    const p = await prepare(); const bytes = convocPdf(v.data, v.step, p?.version || 1);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); const w = window.open(url, '_blank'); if (!w) toast('Autorise les fenêtres pour voir le PDF.');
  },
  cvmail: async (el, d) => { const s = st(); s.mail = { civ: 'Madame', club: d.v || '', first: '', last: '', email: '' }; await prepare(); render(true); },
  cvcancel: () => { const s = st(); s.mail = null; s.pick = null; render(true); },
  cvpick: (el, d) => { const s = st(); s.pick = (s.res || []).find((c) => c.id === d.id) || null; render(true); },
  cvapp: async () => {
    const v = S.convoc, s = st(); if (!s.pick || s.busy) return; s.busy = true; render(true);
    try {
      const p = await prepare(); if (!p) return;
      const r = await run(record({ ...p, channel: 'app', club: s.pick.id, name: s.pick.name, status: 'envoye', payload: v.data }), `Envoyé à ${s.pick.name}. Son correspondant est prévenu.`);
      if (r) { s.pick = null; s.q = ''; s.res = null; await loadSends(v.eid); }
    } finally { s.busy = false; render(true); }
  },
  cvretry: async (el, d) => {
    const x = (S.convoc.sends || []).find((s) => s.id === d.id); if (!x) return;
    if (x.step !== S.convoc.step) S.convoc.step = x.step;
    // le contact n'est pas gardé : le formulaire s'ouvre avec le nom du club, à compléter
    st().mail = { civ: 'Madame', club: x.target_name || '', first: '', last: '', email: '' }; await prepare(); render(true);
    await sb.rpc('convocation_forget', { p_send: x.id }); await loadSends(S.convoc.eid); render(true);
  },
  // côté club reçu : ouvrir la convocation reçue (accusé de lecture)
  cvopen: async (el, d) => {
    const r = await run(sb.rpc('convocation_open', { p_send: d.id })); if (!r?.data) return;
    const w = window.open('', '_blank'); if (!w) return toast('Autorise les fenêtres pour lire le document.');
    w.document.open(); w.document.write(convocHtml(r.data, r.step, new Date(), { version: r.version, print: false })); w.document.close();
    const x = (S.creceived || []).find((y) => y.id === d.id); if (x && !x.read_at) { x.read_at = new Date().toISOString(); render(true); }
  },
});
Object.assign(FORMS, { cvmailf: async (v) => { if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v.email || '')) return toast('Adresse e-mail à vérifier.'); st().mail = { ...v }; await sendMail(v); } });
let qTimer = 0;
INPUTS.push((t) => {
  if (!t.dataset?.cvq || !S.convoc) return false;
  const s = st(); s.q = t.value; clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const r = s.q.trim().length >= 2 ? await sb.rpc('public_search_clubs', { p_query: s.q.trim(), p_sport: S.convoc.data?.club?.sport || null }) : { data: null };
    s.res = Array.isArray(r.data) ? r.data.filter((c) => c.id !== S.clubId) : s.q.trim().length >= 2 ? [] : null; const pos = t.selectionStart; render(true);
    const n = document.getElementById('cvq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } }
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
