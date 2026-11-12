// mypocketclub · alpha 5.7.0
//   N° 204 · justificatif d'adhésion sur le modèle de Boissy : coordonnées, identifiant (SIRET ou RNA), pied de page et cachet du club
//            (Président › Réglages) ; signature en image de la personne qui délivre ; formulaire avant le PDF (demandeur, identifiant).
//   N° 207 · « Demander une attestation » (Mon compte) : la trésorerie ou le président délivre (PDF gardé jusqu'à la fin de la saison)
//            ou refuse avec un motif court.
// Rappel : chaque droit est vérifié par la base (supabase/alpha_5_7_0.sql) ; l'écran n'est qu'un confort.
import {
  S, sb, esc, hooks, run, toast, render, ACTIONS, FORMS, CHANGES, club, isPresident, hasArea, pl, pname, download, isMajor, name, plural,
} from './core.js';
import { header, icon, field } from './ui.js';
import { V310_VIEWS } from './v310.js';
import { pdfArt } from './v43.js';
import { Pdf } from './pdfmin.js';
import { BRAND } from '../config.js';

const issuer = () => isPresident() || hasArea('tresorerie');
const eur = (n) => (+n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const dfr = (d) => new Date(d).toLocaleDateString('fr-FR');
const b64bytes = (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const dataBytes = (d) => (d && d.startsWith('data:image/jpeg;base64,') ? b64bytes(d.slice(23)) : null);
const bytesB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
// Identifiant : SIRET (14 chiffres) ou RNA (W + 9 chiffres) ; avertissement seulement
export const legalKind = (v) => { const x = String(v || '').replace(/\s/g, ''); return /^\d{14}$/.test(x) ? 'SIRET' : /^W\d{9}$/i.test(x) ? 'RNA' : x ? '?' : ''; };

// ---------- image → JPEG (fond blanc, taille réduite) ----------
async function toJpegData(file, maxW, maxH) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('image')); i.src = url; });
    const r = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight), w = Math.max(1, Math.round(im.naturalWidth * r)), h = Math.max(1, Math.round(im.naturalHeight * r));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

// ---------- n° 204 · réglages du club (Président › Réglages) ----------
async function loadSettings() {
  if (!S.clubId || !issuer()) return;
  const r = await sb.rpc('attestation_settings', { p_club: S.clubId });
  S.attSet = r.error ? { err: true } : (r.data || {}); S.attSetClub = S.clubId;
}
hooks.attestSettings = () => {
  if (!isPresident()) return '';
  if (S.attSetClub !== S.clubId) { S.attSetClub = S.clubId; S.attSet = null; loadSettings().then(() => render(true)); }
  const s = S.attSet; if (!s) return '<div class="sec"><h2>Attestations de paiement</h2></div><p class="empty">Chargement…</p>';
  if (s.err) return '';
  const k = legalKind(s.legal_id);
  return `<div class="sec"><h2>Attestations de paiement</h2></div><form id="attsetf" class="card">
    <p class="note" style="margin:0">Ces informations apparaissent sur les attestations délivrées par le président ou la trésorerie.</p>
    ${field('asid', 'Numéro SIRET ou RNA de l’association', `<input id="asid" name="legal_id" maxlength="30" value="${esc(s.legal_id || '')}" placeholder="14 chiffres (SIRET) ou W + 9 chiffres (RNA)">`)}
    ${k === '?' ? '<p class="note" style="color:var(--pc-attente-texte)">Format inhabituel : un SIRET a 14 chiffres, un RNA commence par W suivi de 9 chiffres.</p>' : ''}
    ${field('asad', 'Adresse du club', `<textarea id="asad" name="address" rows="2" maxlength="200">${esc(s.address || '')}</textarea>`)}
    <div class="grid2">${field('asph', 'Téléphone', `<input id="asph" name="phone" type="tel" maxlength="30" value="${esc(s.phone || '')}">`)}${field('asem', 'E-mail', `<input id="asem" name="email" type="email" maxlength="120" value="${esc(s.email || '')}">`)}</div>
    ${field('asft', 'Bas de page (facultatif)', `<textarea id="asft" name="footer" rows="3" maxlength="400" placeholder="Association loi 1901 · reconnue d’utilité publique…">${esc(s.footer || '')}</textarea>`)}
    <button class="btn main" type="submit">${icon('check', 20)}Enregistrer</button>
    <div class="kick" style="margin-top:6px">Cachet du club</div>
    ${s.stamp ? `<img src="${esc(s.stamp)}" alt="Cachet du club" style="max-width:140px;max-height:140px;border-radius:8px;background:#fff">` : '<p class="note" style="margin:0">Aucun cachet : une photo nette du tampon, sur fond blanc.</p>'}
    <div class="btns"><label class="btn small ghost">${icon('plus', 18)}${s.stamp ? 'Remplacer le cachet' : 'Ajouter le cachet'}<input type="file" accept="image/*" data-attstamp="1" hidden></label>${s.stamp ? '<button class="btn small ghost" type="button" data-act="attstampdel">Retirer</button>' : ''}</div></form>`;
};
FORMS.attsetf = async (v) => {
  if (await run(sb.rpc('set_attestation_settings', { p_club: S.clubId, p_legal_id: v.legal_id || '', p_address: v.address || '', p_phone: v.phone || '', p_email: v.email || '', p_footer: v.footer || '' }), 'Enregistré.')) { await loadSettings(); render(true); }
};
CHANGES.push(async (t) => {
  if (t.dataset.attstamp && t.files?.[0]) {
    try { const d = await toJpegData(t.files[0], 500, 500); if (await run(sb.rpc('set_club_stamp', { p_club: S.clubId, p_img: d }), 'Cachet enregistré.')) { await loadSettings(); render(true); } } catch { toast('Image illisible. Essaie une photo JPEG ou PNG.'); }
    return true;
  }
  if (t.dataset.attsig && t.files?.[0]) {
    try { const d = await toJpegData(t.files[0], 600, 240); if (await run(sb.rpc('set_my_signature', { p_img: d }), 'Signature enregistrée.')) { S.mySig = d; render(true); } } catch { toast('Image illisible. Essaie une photo JPEG ou PNG.'); }
    return true;
  }
  return false;
});

// ---------- n° 204 · formulaire avant le PDF ----------
// Personnes proposées : les membres du club ; par défaut le parent relié au joueur, sinon le joueur majeur
function candidates(p) {
  const ids = [...new Set(S.members.filter((m) => m.status === 'active' && m.user_id).map((m) => m.user_id))];
  const parents = (S.pparents || []).filter((x) => x.player_id === p.id).map((x) => x.user_id);
  const def = parents[0] || (p.user_id && isMajor(p) ? p.user_id : '');
  const list = ids.map((u) => ({ u, n: name(u) })).sort((a, b) => (parents.includes(b.u) - parents.includes(a.u)) || a.n.localeCompare(b.n));
  return { list, def, parents };
}
function formPage(v) {
  const p = pl(v.id); if (!p) return '<p class="empty">Fiche introuvable.</p>';
  if (!issuer()) return '<p class="empty">Réservé au président et à la trésorerie.</p>';
  if (S.attSetClub !== S.clubId) { S.attSetClub = S.clubId; S.attSet = null; loadSettings().then(() => render(true)); }
  if (S.mySig === undefined) { S.mySig = null; sb.rpc('my_signature').then((r) => { S.mySig = r.data || ''; render(true); }, () => { S.mySig = ''; }); }
  const s = S.attSet || {}, req = v.req ? (S.attReqs || []).find((x) => x.id === v.req) : null, c = candidates(p);
  const def = req?.requested_by || c.def, pays = S.payments.filter((x) => x.player_id === p.id), paid = pays.reduce((n, x) => n + +x.amount, 0);
  let h = `<div class="card pale" style="transform:none"><b>${esc(pname(p))}</b><span class="note" style="color:var(--pc-texte-ecran)">${plural(pays.length, 'versement')} noté${pays.length > 1 ? 's' : ''} · ${eur(paid)}</span>${req ? `<span class="note" style="color:var(--pc-texte-ecran)">Demandée par ${esc(req.requester_name)} le ${esc(dfr(req.created_at))}</span>` : ''}</div>`;
  h += `<form id="attf" class="card" data-id="${p.id}" data-req="${esc(v.req || '')}">
    <div class="grid2">${field('atciv', 'Civilité', '<select id="atciv" name="civ"><option value="">—</option><option>Mme</option><option>M.</option></select>')}${field('atwho', 'Demandeur', `<select id="atwho" name="who" required><option value="">Choisir…</option>${c.list.map((x) => `<option value="${x.u}" ${x.u === def ? 'selected' : ''}>${esc(x.n)}${c.parents.includes(x.u) ? ' (parent)' : ''}</option>`).join('')}</select>`)}</div>
    ${field('atid', 'Numéro SIRET ou RNA', `<input id="atid" name="legal" maxlength="30" value="${esc(s.legal_id || '')}" placeholder="Rempli depuis les réglages du club">`)}
    ${!s.legal_id ? `<p class="note">${isPresident() ? 'Astuce : renseigne-le une fois dans Président › Réglages › « Attestations de paiement ».' : 'Le président peut le renseigner une fois pour toutes dans ses réglages.'}</p>` : ''}
    <div class="kick">Signature et cachet</div>
    <div class="btns" style="align-items:center">${S.mySig ? `<img src="${esc(S.mySig)}" alt="Ma signature" style="max-height:56px;background:#fff;border-radius:6px">` : '<span class="note">Pas encore de signature.</span>'}<label class="btn small ghost">${S.mySig ? 'Changer ma signature' : 'Ajouter ma signature (image)'}<input type="file" accept="image/*" data-attsig="1" hidden></label></div>
    <p class="note" style="margin:0">${s.stamp ? 'Le cachet du club sera posé à côté.' : 'Pas de cachet : le président peut l’ajouter dans ses réglages.'} Ta signature reste dans ton compte : personne d’autre ne la voit.</p>
    <div class="btns"><button class="btn ${req ? 'ghost' : 'main'}" type="button" data-act="attmake" data-mode="dl">${icon('down', 20)}Télécharger le PDF</button>${req ? `<button class="btn main" type="button" data-act="attmake" data-mode="send">${icon('check', 20)}Délivrer au demandeur</button>` : ''}</div>
    <p class="note" style="margin:0">Chaque attestation est inscrite au journal, avec le nom du demandeur.</p></form>`;
  if (req) h += `<form id="attnof" class="card flat" data-req="${esc(req.id)}">${field('atno', 'Ou refuser, avec un motif court', '<input id="atno" name="why" maxlength="200" required placeholder="Ex. : cotisation pas encore réglée en entier">')}<button class="btn ghost" type="submit">Refuser la demande</button></form>`;
  return h;
}
V310_VIEWS.attform = (v) => ({ head: header({ back: true, kicker: 'Attestation de paiement', title: esc(pl(v.id) ? pname(pl(v.id)) : 'Attestation') }), body: formPage(v) });

// Le PDF, sur le modèle remis par Boissy (12 novembre 2026)
export async function attestationPdf2(d, c, now = new Date()) {
  const pdf = new Pdf(), L = 20, R = 190, W = R - L;
  let art = {}; try { art = await pdfArt({ club: { ...(c || {}), color1: '#FFFFFF' } }); } catch { art = {}; }
  if (art.crest) pdf.image(L, 12, 24, 28, art.crest.bytes);
  pdf.text(118, 28, String(d.club || '').toUpperCase(), { size: 17, bold: true, align: 'center' });
  pdf.text(R, 52, `Fait à ${d.city || '…'}, le ${now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`, { size: 10.5, align: 'right' });
  let y = 66;
  const left = [d.club, ...String(d.address || '').split(/\r?\n/), d.phone ? 'Tél. : ' + d.phone : '', d.email ? 'E-mail : ' + d.email : ''].filter((x) => x && x.trim());
  for (const x of left) { pdf.text(L, y, x.trim(), { size: 9.5, color: '#2F3A8F' }); y += 5; }
  y = Math.max(y + 10, 100);
  pdf.text(105, y, 'ATTESTATION DE PAIEMENT', { size: 14, bold: true, align: 'center' }); y += 7;
  pdf.text(105, y, 'SAISON ' + String(d.season || '').replace('-', '/'), { size: 12, bold: true, align: 'center' }); y += 16;
  const role = d.signer_role === 'Président' ? 'président(e)' : 'trésorier(ère)';
  const who = `${d.first_name} ${d.last_name}`, cat = d.category || d.team;
  y = pdf.para(L, y, `Je soussigné(e) ${d.signer}, agissant en tant que ${role} de l’association ${d.club},`, W, { size: 11.5 }) + 3;
  y = pdf.para(L, y, `atteste par la présente avoir reçu de la part de ${d.requester} la somme de ${eur(d.paid)} pour la licence de ${who}${cat ? ' – catégorie ' + cat + ' –' : ''} pour la saison ${d.season}.`, W, { size: 11.5 }) + 6;
  if ((d.payments || []).length > 1) {
    pdf.text(L, y, 'Détail des versements :', { size: 10, color: '#4A5068' }); y += 5.5;
    for (const x of d.payments) { pdf.text(L + 5, y, `· ${dfr(x.paid_at)} : ${eur(x.amount)}${x.method ? ' (' + x.method + ')' : ''}`, { size: 10, color: '#4A5068' }); y += 5; }
    y += 4;
  }
  y = Math.max(y + 8, 180);
  pdf.text(R, y, `${d.signer}, ${role} ${d.club}`, { size: 11, align: 'right' }); y += 6;
  const st = dataBytes(d.stamp), sg = dataBytes(d.signature);
  if (st) pdf.image(R - 95, y, 32, 32, st);
  if (sg) pdf.image(R - 58, y + 4, 58, 23, sg);
  if (!st && !sg) pdf.rect(R - 70, y, 70, 28, null, '#D8DCEA');
  let fy = 262;
  const kind = legalKind(d.legal_id), foot = [...String(d.footer || '').split(/\r?\n/), d.legal_id ? `${kind === 'RNA' ? 'RNA' : kind === 'SIRET' ? 'SIRET' : 'Identifiant'} : ${d.legal_id}` : ''].filter((x) => x && x.trim());
  for (const x of foot.slice(0, 5)) { pdf.text(L, fy, x.trim(), { size: 8.5, bold: true, color: '#2F3A8F' }); fy += 4.2; }
  pdf.text(R, 289, `Document établi avec ${BRAND.name} à partir des versements notés par le club.`, { size: 7.5, color: '#4A5068', align: 'right' });
  return pdf.bytes();
}
// Fiche joueur : le bouton ouvre le formulaire (au lieu du PDF immédiat de la 5.5.0)
hooks.attestBtn = (p) => {
  if (!p || p.from_partner || !issuer()) return '';
  if (!S.payments.some((x) => x.player_id === p.id)) return '';
  return `<button class="btn ghost" data-act="attopen" data-id="${p.id}">${icon('down', 20)}Attestation de paiement (PDF)</button><p class="note">Pour un comité d’entreprise : elle atteste les sommes réellement versées au club. Chaque attestation est inscrite au journal.</p>`;
};
ACTIONS.attopen = (el, d) => { S.view = { type: 'attform', id: d.id, req: d.req || '' }; render(); };
ACTIONS.attest = ACTIONS.attopen;   // ancien bouton (5.5.0)
ACTIONS.attmake = async (el, d) => {
  const f = document.getElementById('attf'); if (!f) return;
  const v = Object.fromEntries(new FormData(f)), p = pl(f.dataset.id), mode = d.mode;
  if (!v.who) return toast('Choisis le demandeur.');
  const who = [v.civ, name(v.who)].filter(Boolean).join(' ');
  if (legalKind(v.legal) === '?') toast('Numéro inhabituel : vérifie-le sur le PDF.');
  const r = await run(sb.rpc('attestation_data', { p_player: f.dataset.id, p_requester: who, p_legal_id: v.legal || '' })); if (!r) return;
  const bytes = await attestationPdf2(r, club());
  if (mode === 'send' && f.dataset.req) {
    if (await run(sb.rpc('deliver_attestation', { p_id: f.dataset.req, p_pdf: bytesB64(bytes) }), 'Attestation délivrée : le demandeur est prévenu.')) { await loadV57(); const b = (S.stack || []).pop() || null; S.view = b; S.noStack = true; render(); }
    return;
  }
  download(new Blob([bytes], { type: 'application/pdf' }), `Attestation-paiement-${(p ? pname(p) : 'joueur').replace(/[^\p{L}\p{N}]+/gu, '-')}-${r.season}.pdf`);
  toast('Attestation téléchargée.');
};
FORMS.attnof = async (v, f) => {
  if (await run(sb.rpc('refuse_attestation', { p_id: f.dataset.req, p_reason: v.why || '' }), 'Demande refusée : le demandeur voit le motif.')) { await loadV57(); const b = (S.stack || []).pop() || null; S.view = b; S.noStack = true; render(); }
};

// ---------- n° 207 · demandes reçues (trésorerie, président) ----------
export async function loadV57() {
  if (!S.clubId || !issuer()) { S.attReqs = []; return; }
  try { const r = await sb.rpc('club_attestation_requests', { p_club: S.clubId }); S.attReqs = Array.isArray(r.data) ? r.data : []; } catch { S.attReqs = []; }
}
hooks.attestCount = () => (issuer() ? (S.attReqs || []).filter((x) => x.status === 'attente').length : 0);
hooks.attestReqBlock = () => {
  if (!issuer()) return '';
  const l = (S.attReqs || []).filter((x) => x.status === 'attente'); if (!l.length) return '';
  return `<div class="sec"><h2>Attestations demandées</h2><span class="pill wait">${l.length}</span></div><div class="card lift"><div class="list">${l.map((x) => `<button class="row" data-act="attopen" data-id="${x.player_id}" data-req="${x.id}"><span class="g">${esc(x.first_name)} ${esc(x.last_name)}<small>Demandée par ${esc(x.requester_name)} · ${esc(dfr(x.created_at))}</small></span><span class="chev"></span></button>`).join('')}</div></div>`;
};

// ---------- n° 207 · Mon compte : « Demander une attestation » ----------
async function loadMine() { try { const r = await sb.rpc('my_attestation_players'); S.attMine = Array.isArray(r.data) ? r.data : []; } catch { S.attMine = []; } }
hooks.attestAccount = () => {
  if (S.attMine === undefined) { S.attMine = null; loadMine().then(() => render(true)); }
  const l = S.attMine || []; if (!l.length) return '';
  const st = (x) => {
    if (x.status === 'attente') return '<span class="pill wait">Demandée</span>';
    if (x.status === 'delivree') return `<button class="btn small main" data-act="attget" data-id="${x.request_id}" data-n="${esc(x.first_name)}">${icon('down', 18)}PDF</button>`;
    return `<button class="btn small ghost" data-act="attask" data-id="${x.player_id}">Redemander</button>`;
  };
  return `<div class="sec"><h2>Attestation de paiement</h2></div><div class="card" data-anchor="attest"><p class="note" style="margin:0">Pour un comité d’entreprise : le club atteste ce que tu as versé pour la licence. La trésorerie la prépare, tu la retrouves ici jusqu’à la fin de la saison.</p>
    <div class="list">${l.map((x) => `<div class="row static"><span class="g">${esc(x.first_name)} ${esc(x.last_name)}<small>${esc(x.club_name)}${x.status === 'refusee' && x.reason ? ' · refusée : ' + esc(x.reason) : x.status === 'delivree' ? ' · délivrée le ' + esc(dfr(x.decided_at)) : ''}</small></span>${x.status ? st(x) : `<button class="btn small main" data-act="attask" data-id="${x.player_id}">Demander</button>`}</div>`).join('')}</div></div>`;
};
Object.assign(ACTIONS, {
  attask: async (el, d) => { if (await run(sb.rpc('request_attestation', { p_player: d.id }), 'Demande envoyée : la trésorerie est prévenue.')) { await loadMine(); render(true); } },
  attget: async (el, d) => {
    const r = await run(sb.rpc('attestation_pdf', { p_id: d.id })); if (!r || typeof r !== 'string') return;
    download(new Blob([b64bytes(r)], { type: 'application/pdf' }), `Attestation-paiement-${String(d.n || 'joueur').replace(/[^\p{L}\p{N}]+/gu, '-')}.pdf`);
  },
  attstampdel: async () => { if (await run(sb.rpc('set_club_stamp', { p_club: S.clubId, p_img: null }), 'Cachet retiré.')) { await loadSettings(); render(true); } },
});
