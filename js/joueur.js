// Pocket Club · fiche joueur : informations, parents, autorisations datées, licence et cotisation, corbeille.
import { BRAND } from '../config.js';
import { S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, club, isBoard, team, teamName, pl, pname, adminOf, parentsOf, isParentOf, canManagePlayer, isMajor, name, num } from './core.js';
import { icon, delBtn, field } from './ui.js';

const CONSENTS = [['image', "Droit à l'image (photos et vidéos du club)"], ['alone', 'Rentre seul après la séance'], ['care', "Soins d'urgence autorisés en cas d'accident"], ['transport', 'Covoiturage par les parents'], ['rgpd', 'Politique de confidentialité acceptée']];
const LIC = ['Préinscrit club', 'Préinscrit fédé', 'Licencié'];
const PAY = ['Chèque', 'Espèces', 'Virement', 'HelloAsso', 'Carte', 'Autre'];
const canEdit = (p) => isParentOf(p.id) || p.user_id === S.me.id || canManagePlayer(p);
// n° 9 : un majeur donne ses autorisations lui-même ; un mineur, par un parent (mineur par défaut sans date de naissance)
const canConsent = (p) => (isMajor(p) ? p.user_id === S.me.id : isParentOf(p.id)) || isBoard();

export function feeState(a) {
  if (!a || a.fee_amount == null) return a && +a.fee_paid > 0 ? 'Partielle' : 'Montant à définir';
  return +a.fee_paid >= +a.fee_amount ? 'Payée' : +a.fee_paid > 0 ? 'Partielle' : 'À payer';
}
const cls = (v) => (['Licencié', 'Payée'].includes(v) ? 'ok' : ['À payer', 'Préinscrit club'].includes(v) ? 'ko' : 'wait');
export function statusPills(p) {
  const a = adminOf(p.id); if (!a) return '';
  return `<span class="pill ${cls(a.licence_state)}">${esc(a.licence_state)}</span><span class="pill ${cls(feeState(a))}">Cotisation : ${esc(feeState(a).toLowerCase())}</span>${a.health_doc ? '' : '<span class="pill ko">Certificat manquant</span>'}`;
}
export function presence(pid) {
  const r = S.att.filter((x) => x.player_id === pid), ok = r.filter((x) => x.status !== 'absent').length;
  return { n: r.length, ok, late: r.filter((x) => x.status === 'retard').length };
}
export function feeFor(p) {
  const g = S.fees, t = team(p.team_id);
  return (g.find((x) => x.team_id && x.team_id === p.team_id) || g.find((x) => !x.team_id && t && x.category && x.category === (t.category || t.name)) || {}).amount ?? null;
}
const tel = (n) => String(n || '').replace(/\s/g, '');

export function playerPage(pid) {
  const p = pl(pid); if (!p) return '<p class="empty">Fiche introuvable (à la corbeille ?).</p>';
  const ed = canEdit(p), cons = canConsent(p), board = isBoard(), a = adminOf(pid), c = p.consents || {}, pr = presence(pid), par = parentsOf(pid);
  let h = `<div class="card lift"><div class="det">${esc(teamName(p.team_id) || 'Sans équipe')}${p.birth_date ? ' · né(e) le ' + p.birth_date.split('-').reverse().join('/') : ' · <b>date de naissance à compléter</b>'}${isMajor(p) ? ' · majeur' : ''}</div>${pr.n ? `<div class="chips"><span class="pill blue">Présence ${pr.ok} / ${pr.n}</span>${pr.late ? `<span class="pill wait">${pr.late} retard${pr.late > 1 ? 's' : ''}</span>` : ''}</div>` : ''}<div class="chips">${statusPills(p)}</div></div>`;
  // informations
  h += '<div class="sec"><h2>Informations</h2></div>';
  if (ed) {
    const em = (p.emergency_name || '').split(' ');
    h += `<form id="plf" data-id="${pid}" class="card"><div class="grid2">${field('f1', 'Prénom', `<input id="f1" name="first_name" value="${esc(p.first_name)}" required>`)}${field('f2', 'Nom', `<input id="f2" name="last_name" value="${esc(p.last_name || '')}" required>`)}</div>
    ${field('f3', 'Date de naissance', `<input id="f3" name="birth_date" type="date" value="${esc(p.birth_date || '')}">`)}
    ${canManagePlayer(p) ? field('f6', 'Équipe principale', `<select id="f6" name="team_id">${S.teams.map((t) => `<option value="${t.id}" ${t.id === p.team_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`) : ''}
    <div class="kick">Contact d'urgence</div><div class="grid2">${field('f4', 'Prénom', `<input id="f4" name="em_first" value="${esc(em[0] || '')}">`)}${field('f4b', 'Nom', `<input id="f4b" name="em_last" value="${esc(em.slice(1).join(' '))}">`)}</div>
    ${field('f5', "Téléphone d'urgence", `<input id="f5" name="emergency_phone" type="tel" value="${esc(p.emergency_phone || '')}">`)}
    <p class="note">Ne saisis aucune information médicale (maladie, allergie, traitement).</p><button class="btn main" type="submit">Enregistrer</button></form>`;
  } else h += `<div class="card"><div>Contact d'urgence : ${esc(p.emergency_name || '—')} ${esc(p.emergency_phone || '')}</div></div>`;
  if (p.emergency_phone && !ed) h += `<a class="btn" href="tel:${esc(tel(p.emergency_phone))}">${icon('phone', 20)}Appeler le contact d'urgence</a>`;
  // contact importé et invitation
  if ((p.parent_email || p.parent_phone) && (canManagePlayer(p) || isParentOf(p.id))) {
    const c0 = club(), inv = `Bonjour, ${c0.name} utilise ${BRAND.name} pour les convocations et les messages. Ouvre ${location.href.split('#')[0]}, crée ton compte puis « Rejoindre un club » avec le code ${c0.join_code} et le rôle « Parent de joueur » pour ${p.first_name}.`;
    h += `<div class="card"><div class="kick">Contact du parent (importé)</div><div class="det">${esc(p.parent_email || '')}${p.parent_email && p.parent_phone ? ' · ' : ''}${esc(p.parent_phone || '')}</div>${par.length ? '' : `<div class="btns">${p.parent_email ? `<a class="btn small ghost" href="mailto:${esc(p.parent_email)}?subject=${encodeURIComponent(BRAND.name + ' · ' + c0.name)}&body=${encodeURIComponent(inv)}">${icon('mail', 18)}Inviter par e-mail</a>` : ''}${p.parent_phone ? `<a class="btn small ghost" href="sms:${esc(tel(p.parent_phone))}?body=${encodeURIComponent(inv)}">${icon('sms', 18)}Inviter par SMS</a><a class="btn small ghost" href="tel:${esc(tel(p.parent_phone))}">${icon('phone', 18)}Appeler</a>` : ''}</div>`}</div>`;
  }
  // parents
  h += `<div class="sec"><h2>Parents reliés</h2><span class="det">${par.length}</span></div><div class="card"><div class="list">${par.length ? par.map((u) => { const t = S.phones[u]; return `<div class="row static"><span class="g">${esc(name(u))}<small>${esc(t || 'Téléphone non renseigné')}</small></span>${t && u !== S.me.id ? `<a class="btn small ghost" href="tel:${esc(tel(t))}">${icon('phone', 18)}Appeler</a>` : ''}</div>`; }).join('') : '<p class="empty">Aucun parent relié.</p>'}</div>${par.length < 2 && !p.user_id ? '<p class="note">Second parent : il rejoint le club avec le rôle « Parent de joueur » et le nom de l’enfant ; à la validation, sa demande est reliée à cette fiche.</p>' : ''}</div>`;
  // autorisations
  h += `<div class="sec"><h2>Autorisations</h2></div><div class="card"><div class="list">${CONSENTS.filter(([k]) => !(isMajor(p) && k === 'alone')).map(([k, l]) => {
    if (k === 'transport' && isMajor(p)) l = 'Covoiturage';
    const v = c[k] || {}, sub = v.at ? (v.ok ? 'Accordé' : 'Retiré') + ' le ' + new Date(v.at).toLocaleDateString('fr-FR') : 'Pas encore renseigné', pill = `<span class="pill ${v.ok ? 'ok' : 'ko'}">${v.ok ? 'Oui' : 'Non'}</span>`;
    return cons ? `<button class="row" data-act="consent" data-id="${pid}" data-k="${k}" aria-pressed="${!!v.ok}"><span class="g">${l}<small>${sub}</small></span>${pill}</button>` : `<div class="row static"><span class="g">${l}<small>${sub}</small></span>${pill}</div>`;
  }).join('')}</div></div>${cons ? '<p class="note">Touche une ligne pour accorder ou retirer. La date est enregistrée.</p>' : ''}<p class="note">${isMajor(p) ? 'Joueur majeur : il donne lui-même ses autorisations.' : 'Joueur mineur : les autorisations sont données par un parent' + (p.birth_date ? '.' : ' (date de naissance à compléter).')}</p>`;
  // licence et cotisation
  h += '<div class="sec"><h2>Licence et cotisation</h2></div>';
  if (board) {
    const A = a || {}, D = S.discounts.find((x) => x.player_id === pid) || {}, g = feeFor(p);
    h += `<form id="padminf" data-id="${pid}" class="card">${field('g1', 'Licence', `<select id="g1" name="licence_state">${LIC.map((x) => `<option ${A.licence_state === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}${field('g2', 'Numéro de licence', `<input id="g2" name="licence_number" value="${esc(A.licence_number || '')}">`)}
    <label class="check"><input type="checkbox" name="health_doc" ${A.health_doc ? 'checked' : ''}><span>Certificat ou questionnaire de santé fourni</span></label>
    <div class="grid2">${field('g6', `Tarif de base (€)${g != null ? ' · grille : ' + g + ' €' : ''}`, `<input id="g6" name="base_amount" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(D.base_amount ?? g ?? '')}">`)}${field('g7', 'Réduction (€)', `<input id="g7" name="disc" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(D.amount ?? '')}">`)}</div>
    ${field('g8', 'Motif de la réduction (visible du bureau seulement)', `<input id="g8" name="disc_reason" value="${esc(D.reason || '')}" placeholder="Fratrie, Pass'Sport, aide de la mairie…">`)}
    <div class="grid2">${field('g3', 'Montant dû (€)', `<input id="g3" name="fee_amount" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(A.fee_amount ?? '')}">`)}${field('g4', 'Déjà payé (€)', `<input id="g4" name="fee_paid" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(A.fee_paid ?? 0)}">`)}</div>
    ${field('g5', 'Moyen de paiement', `<select id="g5" name="fee_method"><option value="">—</option>${PAY.map((x) => `<option ${A.fee_method === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
    <button class="btn main" type="submit">Enregistrer licence et cotisation</button></form><p class="note">Saisi par le bureau. Visible du joueur ou de ses parents et du coach de l'équipe. Aucune donnée de santé : seulement « fourni » ou non.</p>`;
  } else if (a) {
    h += `<div class="card"><div class="det">${a.licence_number ? 'Licence n° ' + esc(a.licence_number) + '<br>' : ''}${a.fee_amount != null ? `Montant dû : ${esc(a.fee_amount)} € · payé : ${esc(a.fee_paid)} € · reste : ${Math.max(0, a.fee_amount - a.fee_paid).toFixed(2).replace('.00', '')} €${a.fee_method ? ' (' + esc(a.fee_method) + ')' : ''}` : 'Montant de la cotisation à définir par le club'}</div></div>`;
  } else h += '<p class="empty">Pas encore de dossier.</p>';
  if (board) h += delBtn('pdel', pid, 'Mettre la fiche à la corbeille', 'Confirmer : la fiche part à la corbeille (30 jours)', isArmed('p' + pid));
  return h;
}

Object.assign(ACTIONS, {
  player: (el, d) => { S.view = { type: 'player', id: d.id }; render(); },
  consent: async (el, d) => {
    const p = pl(d.id), c = { ...(p.consents || {}) }, cur = !!(c[d.k] || {}).ok;
    c[d.k] = { ok: !cur, at: new Date().toISOString(), by: S.me.id };
    if (await run(sb.from('players').update({ consents: c }).eq('id', p.id))) { p.consents = c; render(true); }
  },
  pdel: async (el, d) => { if (!armed('p' + d.id)) return; if (await run(sb.rpc('trash_item', { p_kind: 'player', p_id: d.id }), 'Fiche mise à la corbeille. Restaurable pendant 30 jours (onglet Club).')) { S.view = null; await refresh(); } },
});
Object.assign(FORMS, {
  plf: async (v, f) => {
    if (!v.first_name.trim() || !(v.last_name || '').trim()) return toast('Le prénom et le nom sont obligatoires.');
    const em = ((v.em_first || '').trim() + ' ' + (v.em_last || '').trim()).trim();
    const row = { first_name: v.first_name.trim(), last_name: v.last_name.trim(), birth_date: v.birth_date || null, emergency_name: em || null, emergency_phone: (v.emergency_phone || '').trim() || null };
    if (v.team_id) row.team_id = v.team_id;
    if (await run(sb.from('players').update(row).eq('id', f.dataset.id), 'Informations enregistrées.')) await refresh();
  },
  padminf: async (v, f) => {
    const base = num(v.base_amount), disc = num(v.disc) || 0, due = base != null ? Math.max(0, base - disc) : num(v.fee_amount);
    const row = { player_id: f.dataset.id, licence_state: v.licence_state, licence_number: (v.licence_number || '').trim() || null, health_doc: !!v.health_doc, fee_amount: due, fee_paid: num(v.fee_paid) || 0, fee_method: v.fee_method || null, updated_by: S.me.id, updated_at: new Date().toISOString() };
    if (!await run(sb.from('player_admin').upsert(row))) return;
    if (base != null || disc || (v.disc_reason || '').trim()) { if (!await run(sb.from('player_discount').upsert({ player_id: f.dataset.id, base_amount: base, amount: disc, reason: (v.disc_reason || '').trim() || null, updated_by: S.me.id, updated_at: new Date().toISOString() }))) return; }
    toast('Licence et cotisation enregistrées.'); await refresh();
  },
});
