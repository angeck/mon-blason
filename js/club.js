// Pocket Club · onglet Club : blason et en-tête, code, validations, licences et cotisations, tarifs, équipes, membres, corbeille.
import { BRAND } from '../config.js';
import {
  S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, ROLES, BCATS, SEASON, XLSX_URL, club, isBoard, isPresident,
  coachTeams, coachOf, teamName, name, pname, adminOf, toValidate, canValidate, norm, loadJs, download, toDataUrl, num, plural, onColor, contrast, rankOf, myRank, niceFirst, niceLast,
} from './core.js';
import { icon, field } from './ui.js';
import { brandPreview, logoFields, updatePreview } from './auth.js';
import { teamForm, loadXlsx } from './equipe.js';
import { decodeText, bestSheet } from './importer.js';
import { statusPills, feeState } from './joueur.js';
import { coachClubBlock } from './coach.js';

// ---------- validations ----------
function teamPick(m) {
  let h = '';
  if (!m.team_id && ['coach', 'joueur', 'parent'].includes(m.role)) {
    const v = (S.vt || {})[m.id] || '';
    h += field('vt' + m.id, 'Équipe à attribuer en validant', `<select id="vt${m.id}" data-vt="${m.id}"><option value="">Aucune pour l'instant</option>${S.teams.map((t) => `<option value="${t.id}" ${v === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}${isBoard() ? `<option value="new" ${v === 'new' ? 'selected' : ''}>+ Créer une nouvelle équipe</option>` : ''}</select>`);
    if (v === 'new') h += field('vn' + m.id, 'Nom de la nouvelle équipe', `<input id="vn${m.id}" data-vn="${m.id}" value="${esc((S.vn || {})[m.id] || '')}" placeholder="Ex. Reines">`);
  }
  if (['parent', 'joueur'].includes(m.role)) {
    S.vpl = S.vpl || {};
    const want = norm(m.role === 'parent' ? (m.child_first || '') + (m.child_last || '') : name(m.user_id)), opts = S.players.filter((x) => !m.team_id || x.team_id === m.team_id);
    if (S.vpl[m.id] === undefined) S.vpl[m.id] = (opts.find((x) => norm(pname(x)) === want) || {}).id || '';
    const child = [m.child_first, m.child_last].filter(Boolean).join(' ');
    h += field('vp' + m.id, 'Fiche joueur à relier', `<select id="vp${m.id}" data-vpl="${m.id}"><option value="">Créer une nouvelle fiche${child ? ' (' + esc(child) + ')' : ''}</option>${opts.map((x) => `<option value="${x.id}" ${S.vpl[m.id] === x.id ? 'selected' : ''}>${esc(pname(x))} · ${esc(teamName(x.team_id) || 'sans équipe')}</option>`).join('')}</select>`);
  }
  return h;
}
export function pendRows(list) {
  return `<div class="list">${list.map((m) => { const child = [m.child_first, m.child_last].filter(Boolean).join(' ');
    return `<div class="row static" style="flex-direction:column;align-items:stretch"><span class="g">${esc(name(m.user_id))}<small>${ROLES[m.role]}${m.team_id ? ' · ' + esc(teamName(m.team_id)) : ''}${child ? ' · enfant : ' + esc(child) : ''}${!m.team_id && ['coach', 'joueur', 'parent'].includes(m.role) ? ' · équipe non choisie' : ''}</small></span>${teamPick(m)}<div class="btns"><button class="btn small main" data-act="mok" data-id="${m.id}">Valider</button><button class="btn small ghost" data-act="mno" data-id="${m.id}">Refuser</button></div></div>`; }).join('')}</div>`;
}

// ---------- membres ----------
function people(rows) {
  const map = new Map();
  rows.forEach((x) => { const key = x.user_id || 'p:' + x.ref; if (!map.has(key)) map.set(key, { key, name: (x.first_name + ' ' + (x.last_name || '')).trim(), first: x.first_name, last: x.last_name || '', since: x.since, tags: [], player: null, user: x.user_id }); const p = map.get(key); if (x.kind === 'joueur') p.player = x.ref; if (x.since < p.since) p.since = x.since; p.tags.push(x); });
  return [...map.values()];
}
const RANK = { president: 0, bureau: 1, coach: 2, joueur: 3 };
function tagHtml(x, manage) {
  const lab = (x.kind === 'joueur' ? 'Joueur' : ROLES[x.role] + (x.assistant ? ' assistant' : '')) + (x.team_id ? ' ' + teamName(x.team_id) : ''), m = S.members.find((y) => y.id === x.ref);
  if (manage && x.kind === 'membre' && x.role !== 'president' && m && canValidate(m)) return `<button class="pill ${isArmed('m' + x.ref) ? 'armed' : 'blue'}" data-act="mdel" data-id="${x.ref}" aria-label="Retirer le profil ${esc(lab)}">${esc(lab)} ${isArmed('m' + x.ref) ? '· confirmer le retrait' : '×'}</button>`;
  return `<span class="pill">${esc(lab)}</span>`;
}
function membersBlock() {
  if (!S.roster.length) return '';   // n° 40 : un supporteur ne voit aucun membre
  const board = isBoard(), coach = coachTeams().length > 0, mgmt = board || coach;
  let list = people(S.roster);
  if (!board && coach) list = list.filter((p) => p.tags.some((x) => coachOf(x.team_id) || ['president', 'bureau'].includes(x.role)));
  const q = norm(S.mq), f = S.mf || 'Tous', t = S.mt2 || '', sort = S.ms || 'nom';
  if (q) list = list.filter((p) => norm(p.name).includes(q) || norm(S.nicks[p.user] || '').includes(q));
  if (f === 'Encadrement') list = list.filter((p) => p.tags.some((x) => ['president', 'bureau'].includes(x.role)));
  if (f === 'Coachs') list = list.filter((p) => p.tags.some((x) => x.role === 'coach'));
  if (f === 'Joueurs') list = list.filter((p) => p.tags.some((x) => x.kind === 'joueur'));
  if (t) list = list.filter((p) => p.tags.some((x) => x.team_id === t));
  list.sort(sort === 'arrivée' ? (a, b) => (a.since < b.since ? -1 : 1) : sort === 'rôle' ? (a, b) => Math.min(...a.tags.map((x) => RANK[x.role] ?? 9)) - Math.min(...b.tags.map((x) => RANK[x.role] ?? 9)) || a.last.localeCompare(b.last, 'fr') : (a, b) => (a.last || a.first).localeCompare(b.last || b.first, 'fr') || a.first.localeCompare(b.first, 'fr'));
  let h = `<div class="sec"><h2>${board ? 'Membres' : 'Membres de mon équipe'}</h2><span class="det">${people(S.roster).length}</span></div>${field('msq', '<span class="sr">Rechercher</span>', `<input id="msq" data-cq="mq" type="search" placeholder="Rechercher un prénom, un nom, un pseudo" value="${esc(S.mq || '')}">`)}`;
  if (mgmt) h += `<div class="chips">${['Tous', 'Encadrement', 'Coachs', 'Joueurs'].map((x) => `<button class="chip" data-act="mf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div><div class="grid2">${field('mte', 'Équipe', `<select id="mte" data-cs="mt2"><option value="">Toutes</option>${S.teams.map((x) => `<option value="${x.id}" ${t === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`)}${field('mso', 'Trier par', `<select id="mso" data-cs="ms">${['nom', 'arrivée', 'rôle'].map((x) => `<option ${sort === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div><label class="switch"><input type="checkbox" data-mall="1" ${S.mAll ? 'checked' : ''}><span>Afficher les profils de chacun</span></label>`;
  h += `<div class="card"><div class="list">${list.length ? list.map((p) => {
    const open = S.mAll || (S.mOpen || {})[p.key], sub = [...new Set(p.tags.map((x) => (x.kind === 'joueur' ? 'Joueur' : ROLES[x.role])))].join(', ');
    return `<div class="row static" style="flex-direction:column;align-items:stretch;gap:6px"><div style="display:flex;align-items:center;gap:8px"><button class="g" data-act="mrow" data-k="${esc(p.key)}" style="background:none;border:0;text-align:left;padding:0;min-height:44px;color:inherit" aria-expanded="${!!open}">${esc(p.name)}<small>${esc(sub)}${open ? '' : ' · ' + plural(p.tags.length, 'profil')}</small></button>${p.player && (board || p.tags.some((x) => coachOf(x.team_id))) ? `<button class="btn small ghost" data-act="player" data-id="${p.player}">Fiche</button>` : p.user && board && p.user !== S.me.id ? `<button class="btn small ghost" data-act="member" data-id="${p.user}">Fiche</button>` : ''}</div>${open ? `<div class="chips" style="gap:6px">${p.tags.map((x) => tagHtml(x, mgmt)).join('')}</div>` : ''}</div>`;
  }).join('') : '<p class="empty">Personne ne correspond.</p>'}</div></div>`;
  if (board) { const fam = new Set(S.members.filter((m) => m.status === 'active' && ['parent', 'supporteur'].includes(m.role)).map((m) => m.user_id)), roleful = new Set(S.members.filter((m) => m.status === 'active' && !['parent', 'supporteur'].includes(m.role)).map((m) => m.user_id)); h += `<p class="note">Familles et supporteurs (sans autre rôle) : ${[...fam].filter((u) => !roleful.has(u)).length}. Les parents figurent sur la fiche de leur enfant.</p>`; }
  else if (!mgmt) h += '<p class="note">Les autres membres apparaissent en « Prénom N. ».</p>';
  return h;
}

// ---------- licences, cotisations, dates de naissance ----------
function licencesBlock() {
  if (!isBoard()) return '';
  const all = S.players, f = S.lf || 'Tous', noBirth = all.filter((p) => !p.birth_date).length;
  const lic = all.filter((p) => adminOf(p.id)?.licence_state === 'Licencié').length, paid = all.filter((p) => feeState(adminOf(p.id)) === 'Payée').length;
  const rest = (p) => { const a = adminOf(p.id); return a?.fee_amount == null ? null : Math.max(0, a.fee_amount - (+a.fee_paid || 0)); };
  const keep = (p) => { const a = adminOf(p.id); return f === 'Tous' || (f === 'Licence à finir' && a?.licence_state !== 'Licencié') || (f === 'Reste à payer' && rest(p) > 0) || (f === 'Certificat manquant' && !a?.health_doc) || (f === 'Date de naissance manquante' && !p.birth_date); };
  const list = all.filter(keep).sort((x, y) => teamName(x.team_id).localeCompare(teamName(y.team_id)) || pname(x).localeCompare(pname(y), 'fr'));
  const eur = (x) => (x == null ? '—' : (+x).toFixed(2).replace('.00', '').replace('.', ',') + ' €');
  const tot = (k) => all.reduce((s0, p) => s0 + (+(adminOf(p.id) || {})[k] || 0), 0);
  let h = `<div class="sec"><h2>Joueurs, licences et cotisations</h2></div><div class="grid2"><div class="card"><span class="big">${lic}/${all.length}</span><span class="det">licenciés</span></div><div class="card"><span class="big">${paid}/${all.length}</span><span class="det">cotisations payées · ${eur(tot('fee_paid'))} sur ${eur(tot('fee_amount'))}</span></div></div>`;
  if (noBirth) h += `<button class="card warn" data-act="lf" data-v="Date de naissance manquante" style="border:0;text-align:left;font:inherit;color:inherit"><b>${plural(noBirth, 'joueur sans date de naissance', 'joueurs sans date de naissance')}</b><span class="note" style="color:var(--pc-encre)">À compléter : sans elle, le joueur est traité comme mineur. Touche pour voir la liste.</span></button>`;
  h += `<div class="chips">${['Tous', 'Licence à finir', 'Reste à payer', 'Certificat manquant', ...(noBirth ? ['Date de naissance manquante'] : [])].map((x) => `<button class="chip" data-act="lf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div>`;
  return h + `<details class="card" ${f !== 'Tous' ? 'open' : ''}><summary>${plural(list.length, 'joueur')}</summary><div class="list">${list.length ? list.map((p) => { const a = adminOf(p.id) || {}; return `<button class="row" data-act="player" data-id="${p.id}"><span class="g">${esc(pname(p))}<small>${esc(teamName(p.team_id) || 'Sans équipe')} · Dû ${eur(a.fee_amount)} · Réglé ${eur(a.fee_paid || 0)} · Reste ${eur(rest(p))}${p.birth_date ? '' : ' · date de naissance à compléter'}</small><span class="chips" style="gap:4px;margin-top:4px">${statusPills(p)}</span></span><span class="chev"></span></button>`; }).join('') : '<p class="empty">Aucun joueur dans ce filtre.</p>'}</div></details>`;
}
function namesToCheck() {
  if (!isBoard()) return '';
  const bad = S.players.filter((p) => !p.last_name || /\s/.test(p.first_name)); if (!bad.length) return '';
  return `<details class="card"><summary>Noms à vérifier (${bad.length})</summary><div class="list">${bad.map((p) => `<button class="row" data-act="player" data-id="${p.id}"><span class="g">${esc(p.first_name)} <b>|</b> ${esc(p.last_name || '—')}<small>Prénom | Nom découpés automatiquement : à corriger si besoin</small></span><span class="chev"></span></button>`).join('')}</div></details>`;
}

// ---------- tarifs ----------
function feesBlock() {
  const d = S.docs.find((x) => x.kind === 'tarifs');
  let h = d ? `<button class="btn ghost" data-act="docopen" data-id="${d.id}">${icon('doc', 20)}Tarifs du club : ${esc(d.file_name)}</button>` : '';
  if (!isBoard()) return h;
  const g = S.fees, imp = S.fimp;
  h += `<details class="card" ${imp ? 'open' : ''}><summary>Tarifs ${SEASON} (${g.length})</summary><div class="list">${g.map((x) => `<div class="row static"><span class="g">${esc(x.team_id ? 'Équipe ' + teamName(x.team_id) : x.category || '—')}<small>${esc(x.amount)} €${x.fed_part != null ? ' dont ' + esc(x.fed_part) + ' € part fédération' : ''}</small></span><button class="btn small ghost" data-act="feedel" data-id="${x.id}">Retirer</button></div>`).join('') || '<p class="empty">Aucun tarif.</p>'}</div>
  <form id="feef" class="stack">${field('ffc', 'Pour', `<select id="ffc" name="target">${[...new Set(S.teams.map((t) => t.category || t.name).filter(Boolean).concat(BCATS))].map((c) => `<option value="cat:${esc(c)}">Catégorie ${esc(c)}</option>`).join('')}${S.teams.map((t) => `<option value="team:${t.id}">Équipe ${esc(t.name)} (tarif particulier)</option>`).join('')}</select>`)}<div class="grid2">${field('ffa', 'Montant (€)', '<input id="ffa" name="amount" type="number" step="0.01" min="0" required inputmode="decimal">')}${field('fff', 'dont part fédération (€)', '<input id="fff" name="fed" type="number" step="0.01" min="0" inputmode="decimal">')}</div><button class="btn main" type="submit">Ajouter ce tarif</button></form>
  <p class="note">Le montant dû de chaque joueur se calcule tout seul : tarif de son équipe principale (ou de sa catégorie), moins sa réduction. Une cotisation déjà payée ne change plus.</p>
  <div class="kick">Document et import</div>${field('fdoc', `${d ? 'Remplacer' : 'Joindre'} la fiche des tarifs (PDF ou image, 4 Mo maximum)`, '<input id="fdoc" type="file" accept="application/pdf,image/*" data-doc="tarifs">')}${d ? `<button class="btn small ghost ${isArmed('doc' + d.id) ? 'danger armed' : ''}" data-act="docdel" data-id="${d.id}">${isArmed('doc' + d.id) ? 'Confirmer le retrait' : 'Retirer le document'}</button>` : ''}
  ${field('fimp', 'Importer une grille : colle un tableau (Catégorie ou « Équipe Nom » ; Prix ; Part fédération facultative)', `<textarea id="fimp" data-fimp="1" placeholder="U9;150;45&#10;U11;160;45&#10;Équipe Reines;200">${esc(S.fimpText || '')}</textarea>`)}${field('fimpf', 'ou un fichier Excel / CSV', '<input id="fimpf" type="file" accept=".csv,.xlsx,.xls,.ods,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet" data-fimpfile="1">')}<button class="btn small ghost" data-act="fimpcheck">Vérifier</button>
  ${imp ? `<div class="card flat"><div class="kick">Changements</div><div class="list">${imp.map((r, i) => `<div class="row static"><span class="g">${esc(r.label)}<small>${r.err ? '<b style="color:var(--pc-non-texte)">' + esc(r.err) + '</b>' : esc(gridDiff(r))}</small></span><button class="btn small ghost" data-act="fimprm" data-i="${i}">Retirer</button></div>`).join('') || '<p class="empty">Aucune ligne lisible.</p>'}</div><label class="check"><input type="checkbox" data-fimpdel="1" ${S.fimpDel ? 'checked' : ''}><span>Supprimer les tarifs absents du fichier (repartir de zéro)</span></label>${imp.some((r) => !r.err) ? `<button class="btn main" data-act="fimpok">Valider l'import (${imp.filter((r) => !r.err).length} lignes)</button>` : ''}</div>` : ''}</details>`;
  return h + `<button class="btn ghost" data-act="xlsxlic">${icon('down', 20)}Exporter la liste pour le trésorier (Excel)</button>`;
}
const eur0 = (x) => (+x).toFixed(2).replace('.00', '').replace('.', ',') + ' €';
const sameGrid = (r) => S.fees.find((g) => (r.team_id ? g.team_id === r.team_id : !g.team_id && (g.category || '').toLowerCase() === (r.category || '').toLowerCase()));
function gridDiff(r) { const g = sameGrid(r); if (!g) return 'nouveau · ' + eur0(r.amount); return +g.amount === +r.amount && (g.fed_part ?? null) === (r.fed ?? null) ? 'inchangé · ' + eur0(r.amount) : eur0(g.amount) + ' → ' + eur0(r.amount); }
function parseGrid(text) {
  return String(text || '').split(/\r?\n/).map((l) => (l.split(/[;\t]/).length > 1 ? l.split(/[;\t]/) : l.split(','))).map((c) => c.map((x) => x.trim()))
    .filter((c) => c[0] && !(num(c[1]) == null && /cat|équip|equip|prix|tarif/i.test(c.join(' '))))
    .map((c) => { const isTeam = /^équipe\s+/i.test(c[0]), lab = c[0].replace(/^équipe\s+/i, ''), t = isTeam ? S.teams.find((x) => x.name.toLowerCase() === lab.toLowerCase()) : null, amount = num(c[1]), fed = num(c[2]); return { label: c[0], team_id: t?.id || null, category: lab, amount, fed, err: amount == null ? 'prix illisible' : isTeam && !t ? 'équipe inconnue' : '' }; });
}
async function exportLicences() {
  try { await buildExport(); } catch (e) { console.error(e); toast("L'export a échoué. Réessaie, ou actualise l'application."); }
}
async function buildExport() {
  try { await loadXlsx(); } catch { return toast('Export impossible pour l’instant (connexion ?). Réessaie.'); }
  const X = window.XLSX, c = (club()?.color1 || '#2F5BFF').replace('#', '').toUpperCase(), di = (id) => S.discounts.find((a) => a.player_id === id) || {};
  const rows = [[BRAND.name + ' · ' + (club()?.name || '') + ' · licences et cotisations ' + SEASON], [], ['Équipe', 'Prénom', 'Nom', 'Naissance', 'Licence', 'N° de licence', 'Certificat', 'Montant dû (€)', 'Payé (€)', 'Reste (€)', 'Moyen', 'Réduction (€)', 'Motif']];
  S.players.slice().sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)) || a.last_name.localeCompare(b.last_name)).forEach((p) => {
    const a = adminOf(p.id) || {}, d = di(p.id), due = a.fee_amount != null ? +a.fee_amount : null;
    rows.push([teamName(p.team_id), p.first_name, p.last_name, p.birth_date ? p.birth_date.split('-').reverse().join('/') : '', a.licence_state || '', a.licence_number || '', a.health_doc ? 'fourni' : 'manquant', due ?? '', +a.fee_paid || 0, due != null ? Math.max(0, due - (+a.fee_paid || 0)) : '', [...new Set(S.payments.filter((x) => x.player_id === p.id).map((x) => x.method).filter(Boolean))].join(', '), d.amount ? +d.amount : '', d.reason || '']);
  });
  const ws = X.utils.aoa_to_sheet(rows);
  ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: c } } };
  'ABCDEFGHIJKLM'.split('').forEach((k) => { if (ws[k + '3']) ws[k + '3'].s = { font: { bold: true, color: { rgb: onColor('#' + c).slice(1) } }, fill: { fgColor: { rgb: c } } }; });
  ws['!cols'] = [12, 14, 16, 12, 16, 16, 11, 14, 10, 10, 12, 13, 22].map((w) => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Licences et cotisations');
  const d = new Date(), stamp = d.toLocaleDateString('sv-SE') + ' ' + String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0') + 'm' + String(d.getSeconds()).padStart(2, '0');
  download(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Cotisations ${(club()?.name || 'club').replace(/[\\/:*?"<>|]/g, '')} · ${stamp}.xlsx`);
  toast('Fichier Excel prêt.');
}

// ---------- équipes ----------
function teamsBlock() {
  const board = isBoard(), list = S.cteams;
  let h = `<div class="sec"><h2>Équipes</h2><span class="det">${board ? list.length : ''}</span></div><div class="card"><div class="list">${list.length ? list.map((t) => {
    const sub = [t.category !== t.name ? t.category : '', t.gender, t.coach ? 'Coach : ' + t.coach : '', t.slots].filter(Boolean).join(' · ');
    return `<div class="row static" style="flex-wrap:wrap"><button class="g" data-act="team" data-id="${t.id}" style="background:none;border:0;text-align:left;padding:0;min-height:44px;color:inherit">${esc(t.name)}<small>${esc(sub)}</small>${t.coaches != null ? `<small>Coachs : ${t.coaches} · Effectif : ${plural(t.players, 'joueur')}</small>` : ''}</button>${t.state === 'Fantôme' ? '<span class="pill wait">Fantôme · en attente de validation</span>' : t.state === 'Archivée' ? '<span class="pill">Archivée</span>' : t.followed ? '<span class="pill blue">Suivie</span>' : ''}</div>`;
  }).join('') : '<p class="empty">Aucune équipe.</p>'}</div></div>`;
  if (board) h += `<details class="card"><summary>${icon('plus', 18)} Créer une équipe</summary>${teamForm({}, 'teamnew')}<p class="note">Une nouvelle équipe reste en mode fantôme (invisible des familles) jusqu'à ce que son coach, le bureau ou le président la rende visible.</p></details>`;
  return h;
}

// ---------- contacts du club (n° 42) ----------
function contactsBlock() {
  const L = S.contacts.filter((x) => x.kind === 'contact'), pres = S.contacts.find((x) => x.kind === 'president');
  const one = (c) => `<div class="row static" style="flex-direction:column;align-items:stretch;gap:8px"><span class="g">${esc(c.name)}<small>${esc(c.fonction)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</small></span>${c.phone || c.email ? `<div class="btns">${c.phone ? `<a class="btn small ghost" href="tel:${esc(c.phone.replace(/\s/g, ''))}">${icon('phone', 18)}Appeler</a>` : ''}${c.email ? `<a class="btn small ghost" href="mailto:${esc(c.email)}">${icon('mail', 18)}Écrire un e-mail</a>` : ''}</div>` : '<span class="det">Pas de coordonnées publiées : écris-lui depuis Messages.</span>'}</div>`;
  const part = (lab, arr) => (arr.length ? `<div class="kick">${lab}</div><div class="list">${arr.map(one).join('')}</div>` : '');
  let h = `<details class="card"><summary>${icon('phone', 18)} Contacter le club</summary>`;
  if (L.length) h += part('Pour une licence', L.filter((c) => c.for_licence)) + part('Pour organiser un match', L.filter((c) => c.for_matches));
  else h += `<p class="note">Contact : président du club${pres ? ' (' + esc(pres.name) + ')' : ''}.</p>`;
  if (pres && pres.user_id !== S.me.id) h += `<button class="btn small ghost" data-act="msgpres">${icon('msg', 18)}Envoyer un message au président</button>`;
  if (isBoard() && !L.length) h += '<p class="note">Président et bureau : cochez « Contact du club » dans Mon compte pour apparaître ici.</p>';
  return h + '</details>';
}

// ---------- fiche d'un membre (n° 32) ----------
export function memberPage(u) {
  const ms = S.members.filter((m) => m.user_id === u && m.status === 'active'), can = isBoard() && u !== S.me.id && rankOf(u) < myRank();
  const nm = name(u), ph = S.phones[u];
  let h = `<div class="card lift"><div class="chips">${ms.map((m) => `<span class="pill blue">${esc(ROLES[m.role] + (m.team_id ? ' ' + teamName(m.team_id) : ''))}</span>`).join('')}</div>${ph ? `<a class="btn small ghost" href="tel:${esc(ph.replace(/\s/g, ''))}">${icon('phone', 18)}Appeler · ${esc(ph)}</a>` : '<span class="det">Téléphone non renseigné ou non visible.</span>'}</div>`;
  if (can) { const [f, ...l] = nm.split(' '); h += `<form id="memberf" data-id="${u}" class="card"><div class="kick">Modifier la fiche</div><div class="grid2">${field('mf1', 'Prénom', `<input id="mf1" name="first_name" value="${esc(f || '')}" required>`)}${field('mf2', 'Nom', `<input id="mf2" name="last_name" value="${esc(l.join(' '))}">`)}</div>${field('mf3', 'Téléphone', `<input id="mf3" name="phone" type="tel" value="${esc(ph || '')}">`)}<button class="btn main" type="submit">Enregistrer</button><p class="note">La modification est notée dans le journal du club (qui, quoi, quand).</p></form>`; }
  else if (isBoard()) h += '<p class="note">Cette personne est de ton niveau ou au-dessus dans le club : seul un rang supérieur peut modifier sa fiche.</p>';
  return h;
}

// ---------- corbeille ----------
async function loadTrash() { const r = await sb.rpc('club_trash', { p_club: S.clubId }); S.trash = r.data || []; }
function trashBlock() {
  if (!isBoard()) return '';
  const K = { team: 'Équipe', player: 'Fiche joueur', poll: 'Sondage', exercise: 'Exercice' };
  return `<details class="card" data-trash="1" ${S.trashOpen ? 'open' : ''}><summary>${icon('trash', 18)} Corbeille${S.trash.length ? ' (' + S.trash.length + ')' : ''}</summary>${S.trash.length ? `<div class="list">${S.trash.map((x) => `<div class="row static"><span class="g">${esc(x.label)}<small>${K[x.kind]} · supprimé le ${new Date(x.deleted_at).toLocaleDateString('fr-FR')}${x.deleted_by ? ' par ' + esc(x.deleted_by) : ''} · effacé le ${new Date(x.purge_at).toLocaleDateString('fr-FR')}</small></span><button class="btn small ghost" data-act="restore" data-k="${x.kind}" data-id="${x.id}">Restaurer</button></div>`).join('')}</div>` : '<p class="empty">La corbeille est vide.</p>'}<p class="note">Ce qui est supprimé reste ici 30 jours, puis est effacé définitivement.</p></details>`;
}

// ---------- blason et en-tête ----------
function brandBlock() {
  if (!isBoard()) return '';
  const c = club(), logo = S.tmpLogo === undefined ? c.logo : S.tmpLogo;
  return `<details class="card"><summary>Blason, couleurs et réglages du club</summary><form id="brandf" class="stack"><div data-prev>${brandPreview(c.name, c.color1, logo, c.crest_bg, c.custom_header)}</div>
  ${field('bcp', 'Code postal du club', `<input id="bcp" name="postal_code" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" value="${esc(c.postal_code || '')}">`)}
  ${isPresident() ? `<label class="switch"><input type="checkbox" name="listed" ${c.public_listed !== false ? 'checked' : ''}><span><b>Apparaître dans la recherche des clubs</b><br><span class="det">Le nom, la ville, le blason, les équipes et leurs créneaux sont visibles de tous. Sinon, on rejoint le club seulement avec son code.</span></span></label>` : `<p class="note">${c.public_listed !== false ? 'Le club apparaît dans la recherche des clubs.' : 'Le club n’apparaît pas dans la recherche.'} Seul le président change ce réglage.</p>`}
  ${isPresident() ? `<label class="switch"><input type="checkbox" name="perso" ${c.custom_header ? 'checked' : ''}><span><b>En-tête aux couleurs du club</b><br><span class="det">Sinon, l'en-tête reste bleu ${esc(BRAND.name)}. Le texte passe en blanc ou en encre pour rester lisible.</span></span></label>` : `<p class="note">${c.custom_header ? "L'en-tête est aux couleurs du club." : `L'en-tête est aux couleurs de ${esc(BRAND.name)}.`} Seul le président change ce réglage.</p>`}
  ${logoFields(!!logo, c.crest_bg)}${field('bo', 'Contour du blason', `<select id="bo" name="outline">${[['auto', 'Automatique (selon le fond)'], ['noir', 'Noir'], ['blanc', 'Blanc'], ['aucun', 'Aucun']].map(([k, l]) => `<option value="${k}" ${(c.crest_outline || 'auto') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}<div class="grid2">${field('b1', 'Couleur principale', `<input id="b1" name="c1" type="color" value="${esc(c.color1.toLowerCase())}">`)}${field('b2', 'Seconde couleur', `<input id="b2" name="c2" type="color" value="${esc(c.color2.toLowerCase())}">`)}</div>
  <button class="btn main" type="submit">Enregistrer</button></form></details>`;
}

export function clubTab() {
  const c = club(), vp = toValidate();
  let h = '';
  if (vp.length) h += `<div class="sec"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card lift">${pendRows(vp)}</div>`;
  h += `<div class="card yellow" style="transform:none"><span class="kick" style="color:var(--pc-encre)">Code pour rejoindre le club</span><span class="codebox">${esc(c.join_code)}</span><button class="btn ink small" data-act="share">${icon('share', 18, '#FFFFFF')}Partager l'invitation</button></div>`;
  h += contactsBlock() + brandBlock() + feesBlock() + licencesBlock() + namesToCheck() + teamsBlock() + coachClubBlock() + membersBlock() + trashBlock();
  return h;
}

Object.assign(ACTIONS, {
  share: async () => { const c = club(), txt = `Rejoins ${c.name} sur ${BRAND.name} : ouvre ${location.href.split('#')[0]} puis « Rejoindre un club » avec le code ${c.join_code}.`; if (navigator.share) { try { await navigator.share({ title: BRAND.name, text: txt }); } catch { /* annulé */ } } else { try { await navigator.clipboard.writeText(txt); toast('Invitation copiée.'); } catch { toast(txt); } } },
  mok: async (el, d) => {
    let t = (S.vt || {})[d.id] || null;
    if (t === 'new') { const nm = ((S.vn || {})[d.id] || '').trim(); if (!nm) return toast('Donne un nom à la nouvelle équipe.'); const x = await run(sb.from('teams').insert({ club_id: S.clubId, name: nm, category: nm, season: SEASON }).select().single()); if (!x) return; t = x.id; }
    if (await run(sb.rpc('validate_membership', { mid: d.id, p_team: t, p_player: (S.vpl || {})[d.id] || null }), 'Demande validée.')) { if (S.vt) delete S.vt[d.id]; await refresh(); }
  },
  mno: async (el, d) => { if (await run(sb.from('memberships').delete().eq('id', d.id), 'Demande refusée.')) await refresh(); },
  mdel: async (el, d) => { if (!armed('m' + d.id)) return; if (await run(sb.from('memberships').delete().eq('id', d.id), 'Profil retiré du club.')) await refresh(); },
  mrow: (el, d) => { S.mOpen = S.mOpen || {}; S.mOpen[d.k] = !S.mOpen[d.k]; render(true); },
  mf: (el, d) => { S.mf = d.v; render(true); },
  lf: (el, d) => { S.lf = S.lf === d.v && d.v !== 'Tous' ? 'Tous' : d.v; render(true); },
  feedel: async (el, d) => { if (await run(sb.from('fee_grid').delete().eq('id', d.id), 'Tarif retiré.')) await refresh(); },
  xlsxlic: () => exportLicences(),
  docopen: async (el, d) => {
    const r = await run(sb.from('club_docs').select('data,file_name').eq('id', d.id).single()); if (!r) return;
    const blob = await (await fetch(r.data)).blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; if (!/^image\//.test(blob.type)) a.download = r.file_name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  },
  docdel: async (el, d) => { if (!armed('doc' + d.id)) return; if (await run(sb.from('club_docs').delete().eq('id', d.id), 'Document retiré.')) await refresh(); },
  fimpcheck: () => { S.fimp = parseGrid(S.fimpText); render(true); },
  fimprm: (el, d) => { S.fimp.splice(+d.i, 1); render(true); },
  fimpok: async () => {
    const rows = S.fimp.filter((r) => !r.err).map((r) => ({ team_id: r.team_id, category: r.team_id ? null : r.category, amount: r.amount, fed: r.fed }));
    const r = await run(sb.rpc('import_fee_grid', { p_club: S.clubId, p_season: SEASON, p_rows: rows, p_delete_absent: !!S.fimpDel })); if (!r) return;
    toast([plural(r.updated, 'tarif mis à jour', 'tarifs mis à jour'), plural(r.added, 'ajouté'), r.deleted ? plural(r.deleted, 'supprimé') : ''].filter(Boolean).join(', ') + '.');
    S.fimp = null; S.fimpText = ''; S.fimpDel = false; await refresh();
  },
  member: (el, d) => { S.view = { type: 'member', id: d.id }; render(); },
  msgpres: async () => { const gid = await run(sb.rpc('message_president', { p_club: S.clubId })); if (gid) { await refresh(); const { openGroup } = await import('./messages.js'); await openGroup(gid); } },
  restore: async (el, d) => { if (await run(sb.rpc('restore_item', { p_kind: d.k, p_id: d.id }), 'Restauré.')) { await refresh(); await loadTrash(); render(true); } },
});
Object.assign(FORMS, {
  brandf: async (v) => {
    const row = { color1: v.c1.toUpperCase(), color2: v.c2.toUpperCase(), crest_bg: (v.bg || '#ffffff').toUpperCase() };
    if (S.tmpLogo !== undefined) row.logo = S.tmpLogo;
    if (isPresident()) { row.custom_header = !!v.perso; row.public_listed = !!v.listed; }
    if ((v.postal_code || '') !== '' && !/^\d{5}$/.test(v.postal_code)) return toast('Le code postal doit avoir 5 chiffres.');
    row.postal_code = v.postal_code || '';
    row.crest_outline = v.outline || 'auto';
    if (await run(sb.from('clubs').update(row).eq('id', S.clubId), 'Blason enregistré.')) { S.tmpLogo = undefined; await refresh(); }
  },
  feef: async (v) => {
    const [k, val] = v.target.split(/:(.*)/s);
    const row = { team_id: k === 'team' ? val : null, category: k === 'cat' ? val : null, amount: num(v.amount), fed: num(v.fed) };
    if (await run(sb.rpc('import_fee_grid', { p_club: S.clubId, p_season: SEASON, p_rows: [row], p_delete_absent: false }), 'Tarif enregistré. Les montants dus sont recalculés.')) await refresh();
  },
  memberf: async (v, f) => { if (await run(sb.rpc('update_member_profile', { p_club: S.clubId, p_user: f.dataset.id, p_first: niceFirst(v.first_name), p_last: niceLast(v.last_name), p_phone: v.phone }), 'Fiche enregistrée.')) await refresh(); },
});
INPUTS.push((t) => {
  if (t.dataset.cq) { S[t.dataset.cq] = t.value; const pos = t.selectionStart; render(true); const n = document.getElementById(t.id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } return true; }
  if (t.dataset.vn) { S.vn = S.vn || {}; S.vn[t.dataset.vn] = t.value; return true; }
  if (t.dataset.fimp) { S.fimpText = t.value; return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.fimpdel) { S.fimpDel = t.checked; return true; }
  if (t.name === 'outline' && t.closest('#brandf')) { club().crest_outline = t.value; updatePreview(t.closest('form')); return true; }
  if (t.dataset.cs) { S[t.dataset.cs] = t.value; render(true); return true; }
  if (t.dataset.mall) { S.mAll = t.checked; render(true); return true; }
  if (t.dataset.vpl) { S.vpl = S.vpl || {}; S.vpl[t.dataset.vpl] = t.value; return true; }
  if (t.dataset.vt) { S.vt = S.vt || {}; S.vt[t.dataset.vt] = t.value; render(true); return true; }
  if (t.name === 'perso' && t.closest('#brandf')) { updatePreview(t.closest('form')); return true; }
  if (t.dataset.doc && t.files?.[0]) {
    const f = t.files[0];
    if (f.size > 4 * 1024 * 1024) { toast('Fichier trop lourd (4 Mo maximum).'); return true; }
    if (!/^application\/pdf$|^image\//.test(f.type)) { toast('Seulement un PDF ou une image.'); return true; }
    const data = await toDataUrl(f), old = S.docs.filter((x) => x.kind === 'tarifs');
    if (old.length) await run(sb.from('club_docs').delete().in('id', old.map((x) => x.id)));
    if (await run(sb.from('club_docs').insert({ club_id: S.clubId, kind: 'tarifs', file_name: f.name.slice(0, 120), data, uploaded_by: S.me.id }), 'Fiche des tarifs enregistrée.')) await refresh();
    return true;
  }
  if (t.dataset.fimpfile && t.files?.[0]) {
    try { const f = t.files[0]; t.value = ''; const buf = await f.arrayBuffer(); if (/\.(xlsx?|ods)$/i.test(f.name)) { const X = await loadXlsx(); S.fimpText = bestSheet(X, X.read(buf, { type: 'array' })).map((r) => r.join(';')).join('\n'); } else S.fimpText = decodeText(buf); S.fimp = parseGrid(S.fimpText); render(true); } catch { toast('Fichier illisible : choisis un fichier Excel ou CSV.'); }
    return true;
  }
  return false;
});
// La corbeille se charge quand on l'ouvre (président et bureau)
document.addEventListener('toggle', async (e) => { if (e.target.dataset?.trash && S.trashOpen !== e.target.open) { S.trashOpen = e.target.open; if (e.target.open) { await sb.rpc('purge_trash'); await loadTrash(); render(true); } } }, true);
