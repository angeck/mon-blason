// Mon Blason · alpha 1.0 · fiches joueurs, autorisations, licence et cotisation, entraînements répétés, appel
// Ces fonctions reçoivent l'état et les outils de app.js (voir install()).
let S, sb, esc, run, toast, render, refresh, name, teamName, myMem, isStaff, fmtShort, fmtDate;

export const HOLIDAYS_ZONE_C = [['2026-10-17', '2026-11-01'], ['2026-12-19', '2027-01-03'], ['2027-02-06', '2027-02-21'], ['2027-04-03', '2027-04-18'], ['2027-07-03', '2027-08-31']];
const CONSENTS = [['image', 'Droit à l’image (photos et vidéos du club)'], ['alone', 'Rentre seul après la séance'], ['care', 'Soins d’urgence autorisés en cas d’accident'], ['transport', 'Transport en covoiturage par d’autres parents'], ['rgpd', 'Politique de confidentialité acceptée']];
const LIC = ['Préinscrit club', 'Préinscrit fédé', 'Licencié'];
const PAY = ['Chèque', 'Espèces', 'Virement', 'HelloAsso', 'Carte', 'Autre'];

export function install(ctx) { ({ S, sb, esc, run, toast, render, refresh, name, teamName, myMem, isStaff, fmtShort, fmtDate } = ctx); }

// ---------- outils ----------
const localDay = (d) => d.toLocaleDateString('sv-SE');
const inHolidays = (day) => HOLIDAYS_ZONE_C.some(([a, b]) => day >= a && day <= b);
export const isBoard = () => myMem().some((m) => m.status === 'active' && ['president', 'bureau'].includes(m.role));
const coachOf = (tid) => !!tid && myMem().some((m) => m.status === 'active' && m.role === 'coach' && m.team_id === tid);
const pl = (id) => (S.players || []).find((p) => p.id === id);
const adminOf = (pid) => (S.padmin || []).find((a) => a.player_id === pid);
const parentsOf = (pid) => (S.pparents || []).filter((x) => x.player_id === pid).map((x) => x.user_id);
const isParent = (pid) => parentsOf(pid).includes(S.me.id);
export const canManage = (p) => isBoard() || coachOf(p.team_id);
const canEdit = (p) => isParent(p.id) || p.user_id === S.me.id || canManage(p);
const canConsent = (p) => isParent(p.id) || p.user_id === S.me.id || isBoard();
export const myPlayers = () => (S.players || []).filter((p) => isParent(p.id) || p.user_id === S.me.id);
const pname = (p) => (p.first_name + ' ' + (p.last_name || '')).trim();
export function feeState(a) {
  if (!a || a.fee_amount == null) return a && +a.fee_paid > 0 ? 'Partielle' : 'Montant à définir';
  return +a.fee_paid >= +a.fee_amount ? 'Payée' : +a.fee_paid > 0 ? 'Partielle' : 'À payer';
}
const pillCls = (v) => (['Licencié', 'Payée'].includes(v) ? 'ok' : ['À payer', 'Préinscrit club'].includes(v) ? 'ko' : '');
function statusPills(p) {
  const a = adminOf(p.id); if (!a) return '';
  return `<span class="pill ${pillCls(a.licence_state)}">${esc(a.licence_state)}</span> <span class="pill ${pillCls(feeState(a))}">Cotisation : ${esc(feeState(a).toLowerCase())}</span>${a.health_doc ? '' : ' <span class="pill ko">Certificat manquant</span>'}`;
}
function presence(pid) {
  const r = (S.att || []).filter((x) => x.player_id === pid), ok = r.filter((x) => x.status !== 'absent').length;
  return { n: r.length, ok, late: r.filter((x) => x.status === 'retard').length };
}

// ---------- agenda ----------
export function agendaFilter() {
  const f = S.agf || 'Tous';
  return `<div class="chips">${['Tous', 'Entraînements', 'Matchs', 'Événements'].map((x) => `<button class="chip" data-act="agf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div>`;
}
export function agendaEvents() {
  const f = S.agf || 'Tous';
  return S.events.filter((e) => f === 'Tous' || (f === 'Entraînements' && e.type === 'Entraînement') || (f === 'Matchs' && ['Match', 'Plateau', 'Tournoi'].includes(e.type)) || (f === 'Événements' && e.type === 'Événement'));
}
export function repeatFields(f) {
  if (f.type !== 'Entraînement' || f.id) return '';
  return `<label class="check"><input type="checkbox" name="repeat" ${f.repeat ? 'checked' : ''}><span>Répéter chaque semaine (même jour, même heure)</span></label>
  <div class="field"><label for="eu">Jusqu'au</label><input id="eu" name="until" type="date" value="${esc(f.until || '2027-06-30')}"></div>
  <label class="check"><input type="checkbox" name="skiphol" ${f.skiphol === false ? '' : 'checked'}><span>Hors vacances scolaires (zone C : Créteil, Paris, Versailles)</span></label>`;
}
export async function saveEvent(v) {
  const base = { club_id: S.clubId, type: S.form.type, title: v.title.trim(), place: v.place || '', opponents: v.opponents || '', team_id: v.team_id || null, created_by: S.me.id };
  const start = new Date(v.starts_at);
  if (S.form.type === 'Entraînement' && v.repeat) {
    const until = new Date((v.until || '2027-06-30') + 'T23:59'), skip = !!v.skiphol;
    if (until < start) { toast('La date de fin est avant la première séance.'); return false; }
    const rows = [];
    for (const d = new Date(start); d <= until && rows.length < 60; d.setDate(d.getDate() + 7)) { if (skip && inHolidays(localDay(d))) continue; rows.push({ ...base, starts_at: d.toISOString() }); }
    if (!rows.length) { toast('Aucune séance dans cette période (vacances ?).'); return false; }
    const ser = await run(sb.from('event_series').insert({ club_id: S.clubId, team_id: base.team_id, title: base.title, place: base.place, weekday: start.getDay(), start_time: v.starts_at.slice(11, 16), until: v.until || '2027-06-30', skip_holidays: skip, created_by: S.me.id }).select().single());
    if (!ser) return false;
    return run(sb.from('events').insert(rows.map((r) => ({ ...r, series_id: ser.id }))), rows.length + ' séances créées, une par semaine' + (skip ? ', hors vacances scolaires.' : '.'));
  }
  return run(sb.from('events').insert({ ...base, starts_at: start.toISOString() }), 'Rendez-vous ajouté.');
}
export function eventStaffBlock(e) {
  let h = '';
  const team = !!e.team_id && (S.players || []).some((p) => p.team_id === e.team_id);
  if (team && ['Entraînement', 'Match', 'Plateau', 'Tournoi'].includes(e.type) && !e.cancelled && (coachOf(e.team_id) || isBoard())) h += `<button class="btn main" data-act="appel" data-id="${e.id}">Faire l'appel</button>`;
  if (!isStaff()) return h;
  h += `<button class="btn" data-act="evcancel" data-id="${e.id}">${e.cancelled ? 'Rétablir cette séance' : 'Annuler cette séance (prévient les personnes concernées)'}</button>`;
  if (e.series_id) h += `<button class="btn danger" data-act="evserdel" data-id="${e.series_id}">${S.delPend === 'ser' + e.series_id ? 'Confirmer : supprimer toutes les séances à venir' : 'Supprimer toute la série à venir'}</button>`;
  return h;
}

// ---------- appel ----------
function announced(p, eid) {
  const who = [...parentsOf(p.id), p.user_id].filter(Boolean), r = S.resp.filter((x) => x.event_id === eid && who.includes(x.user_id));
  return r.some((x) => x.answer === 'oui') ? 'oui' : r.some((x) => x.answer === 'non') ? 'non' : '';
}
export function appelPage(eid) {
  const e = S.events.find((x) => x.id === eid); if (!e) return '<p class="empty">Rendez-vous introuvable.</p>';
  const ps = (S.players || []).filter((p) => p.team_id === e.team_id);
  if (!S.ap || S.ap.eid !== eid) { S.ap = { eid, st: {} }; (S.att || []).filter((x) => x.event_id === eid).forEach((x) => (S.ap.st[x.player_id] = x.status)); }
  const st = S.ap.st, n = ps.filter((p) => st[p.id] === 'present' || st[p.id] === 'retard').length;
  let h = `<h1>Appel</h1><div class="det">${esc(e.title)} · ${esc(fmtShort(e.starts_at))}</div><div class="card" style="display:flex;justify-content:space-between;align-items:center"><div style="font-family:var(--titre);font-style:italic;font-weight:800;font-size:40px">${n} / ${ps.length}</div><div class="det" style="text-align:right">présents<br>Annoncé d'après les réponses</div></div>`;
  h += `<div class="chips"><button class="chip" data-act="appall">Tous ceux annoncés présents sont là</button></div><div class="card">`;
  h += ps.map((p) => { const a = announced(p, eid), s = st[p.id] || '';
    return `<div class="row" style="cursor:default;flex-wrap:wrap"><span class="g" style="flex:1 1 100%">${esc(pname(p))}<small>${a === 'oui' ? '<span style="color:var(--annonce);font-weight:800">● annoncé présent</span>' : a === 'non' ? '<span style="color:var(--absent);font-weight:800">✕ annoncé absent</span>' : '? sans réponse'}</small></span><div class="chips" style="gap:6px">${[['present', 'Présent', 'var(--present)'], ['retard', 'Retard', '#B86E00'], ['absent', 'Absent', 'var(--absent)']].map(([k, l, c]) => `<button class="chip" data-act="appset" data-id="${p.id}" data-v="${k}" aria-pressed="${s === k}" style="${s === k ? `background:${c};border-color:${c};color:#fff` : ''}">${l}</button>`).join('')}</div></div>`; }).join('') || '<p class="empty" style="margin:0">Aucune fiche joueur dans cette équipe.</p>';
  return h + `</div><button class="btn main" data-act="appsave">Enregistrer l'appel</button><p class="note">À l'enregistrement, les joueurs non pointés passent en absent.</p>`;
}

// ---------- équipe ----------
export function kidsBlock() {
  const mine = myPlayers(); if (!mine.length) return '';
  return `<div class="kick">${mine.some((p) => p.user_id === S.me.id) && mine.length === 1 ? 'Ma fiche' : 'Mon enfant'}</div>` + mine.map((p) => `<div class="card"><button class="row" style="border:0;padding:0" data-act="player" data-id="${p.id}"><span class="g">${esc(pname(p))}<small>${esc(teamName(p.team_id) || 'Sans équipe')} · fiche, autorisations, licence et cotisation</small></span><span class="chev">›</span></button><div class="chips" style="margin-top:6px">${statusPills(p)}</div></div>`).join('');
}
export function coachBlock(tid) {
  if (!coachOf(tid) && !isBoard()) return '';
  const ps = (S.players || []).filter((p) => p.team_id === tid);
  const next = S.events.find((e) => e.team_id === tid && !e.cancelled && ['Entraînement', 'Match', 'Plateau', 'Tournoi'].includes(e.type));
  let h = '';
  if (next) h += `<div class="card hi"><div class="kick">Prochaine séance</div><div style="font-weight:800;margin-top:4px">${esc(next.title)}</div><div class="det">${esc(fmtShort(next.starts_at))}${next.place ? ' · ' + esc(next.place) : ''}</div><button class="btn main" style="margin-top:10px" data-act="appel" data-id="${next.id}">Faire l'appel</button></div>`;
  h += `<div class="kick">Joueurs (${ps.length})</div><div class="card">${ps.length ? ps.map((p) => { const pr = presence(p.id); return `<button class="row" data-act="player" data-id="${p.id}"><span class="g">${esc(pname(p))}<small>${pr.n ? 'Présence ' + Math.round(100 * pr.ok / pr.n) + ' % · ' : ''}${esc(adminOf(p.id)?.licence_state || '')}${adminOf(p.id) ? ' · cotisation ' + esc(feeState(adminOf(p.id)).toLowerCase()) : ''}</small></span><span class="chev">›</span></button>`; }).join('') : '<p class="empty" style="margin:0">Aucune fiche joueur.</p>'}</div>`;
  h += `<details class="card"><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">+ Ajouter un joueur sans compte</summary><form id="paddf" data-team="${tid}" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"><div class="grid2"><div class="field"><label for="ap1">Prénom</label><input id="ap1" name="first" required></div><div class="field"><label for="ap2">Nom</label><input id="ap2" name="last"></div></div><div class="field"><label for="ap3">Année de naissance</label><input id="ap3" name="year" type="number" min="1930" max="2030" inputmode="numeric"></div><button class="btn main" type="submit">Ajouter à l'équipe</button><p class="note">Les parents seront reliés quand ils rejoindront le club avec le rôle « Parent de joueur ».</p></form></details>`;
  return h;
}

// ---------- fiche joueur ----------
export function playerPage(pid) {
  const p = pl(pid); if (!p) return '<p class="empty">Fiche introuvable.</p>';
  const ed = canEdit(p), cons = canConsent(p), board = isBoard(), a = adminOf(pid), c = p.consents || {}, pr = presence(pid);
  let h = `<h1>${esc(pname(p))}</h1><div class="det">${esc(teamName(p.team_id) || 'Sans équipe')}${p.birth_year ? ' · né(e) en ' + p.birth_year : ''}${pr.n ? ` · présence ${pr.ok} / ${pr.n} séances${pr.late ? ', ' + pr.late + ' retard' + (pr.late > 1 ? 's' : '') : ''}` : ''}</div>`;
  // identité
  h += `<div class="kick">Informations</div>` + (ed ? `<form id="plf" data-id="${pid}" class="card" style="display:flex;flex-direction:column;gap:10px"><div class="grid2"><div class="field"><label for="f1">Prénom</label><input id="f1" name="first_name" value="${esc(p.first_name)}" required></div><div class="field"><label for="f2">Nom</label><input id="f2" name="last_name" value="${esc(p.last_name || '')}"></div></div><div class="field"><label for="f3">Année de naissance</label><input id="f3" name="birth_year" type="number" min="1930" max="2030" inputmode="numeric" value="${esc(p.birth_year || '')}"></div>${canManage(p) ? `<div class="field"><label for="f6">Équipe</label><select id="f6" name="team_id">${S.teams.map((t) => `<option value="${t.id}" ${t.id === p.team_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}<div class="grid2"><div class="field"><label for="f4">Contact d'urgence</label><input id="f4" name="emergency_name" value="${esc(p.emergency_name || '')}" placeholder="Nom"></div><div class="field"><label for="f5">Téléphone d'urgence</label><input id="f5" name="emergency_phone" type="tel" value="${esc(p.emergency_phone || '')}"></div></div><button class="btn main" type="submit">Enregistrer les informations</button></form>`
    : `<div class="card"><div>Contact d'urgence : ${esc(p.emergency_name || '—')} ${esc(p.emergency_phone || '')}</div></div>`);
  // parents
  const par = parentsOf(pid);
  h += `<div class="kick">Parents reliés (${par.length})</div><div class="card">${par.length ? par.map((u) => { const tel = (S.phones || {})[u]; return `<div class="row" style="cursor:default"><span class="g">${esc(name(u))}<small>${esc(tel || 'Téléphone non renseigné')}</small></span>${tel && u !== S.me.id ? `<a class="btn small" href="tel:${esc(tel.replace(/\s/g, ''))}">📞 Appeler</a>` : ''}</div>`; }).join('') : '<p class="empty" style="margin:0">Aucun parent relié.</p>'}${par.length < 2 && !p.user_id ? '<p class="note" style="margin-top:8px">Second parent : il rejoint le club avec le rôle « Parent de joueur » et le nom de l\'enfant ; à la validation, sa demande est reliée à cette fiche.</p>' : ''}</div>`;
  if (p.emergency_phone && !ed) h += `<a class="btn" href="tel:${esc(p.emergency_phone.replace(/\s/g, ''))}">📞 Appeler le contact d'urgence</a>`;
  // autorisations
  h += `<div class="kick">Autorisations</div><div class="card">${CONSENTS.filter(([k]) => !(p.user_id && k === 'alone')).map(([k, l]) => { const v = c[k] || {}; return cons ? `<button class="row" data-act="consent" data-id="${pid}" data-k="${k}" aria-pressed="${!!v.ok}"><span class="g">${l}<small>${v.at ? (v.ok ? 'Accordé' : 'Retiré') + ' le ' + esc(new Date(v.at).toLocaleDateString('fr-FR')) : 'Pas encore renseigné'}</small></span><span class="pill ${v.ok ? 'ok' : 'ko'}">${v.ok ? 'Oui' : 'Non'}</span></button>` : `<div class="row" style="cursor:default"><span class="g">${l}</span><span class="pill ${v.ok ? 'ok' : 'ko'}">${v.ok ? 'Oui' : 'Non'}</span></div>`; }).join('')}</div>${cons ? '<p class="note">Touchez une ligne pour accorder ou retirer. La date est enregistrée.</p>' : ''}`;
  // licence et cotisation
  h += `<div class="kick">Licence et cotisation</div>`;
  if (board) {
    const A = a || {};
    h += `<form id="padminf" data-id="${pid}" class="card" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label for="g1">Licence</label><select id="g1" name="licence_state">${LIC.map((x) => `<option ${A.licence_state === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label for="g2">Numéro de licence</label><input id="g2" name="licence_number" value="${esc(A.licence_number || '')}"></div><label class="check"><input type="checkbox" name="health_doc" ${A.health_doc ? 'checked' : ''}><span>Certificat ou questionnaire de santé fourni</span></label><div class="grid2"><div class="field"><label for="g3">Cotisation (€)</label><input id="g3" name="fee_amount" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(A.fee_amount ?? '')}"></div><div class="field"><label for="g4">Déjà payé (€)</label><input id="g4" name="fee_paid" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(A.fee_paid ?? 0)}"></div></div><div class="field"><label for="g5">Moyen de paiement</label><select id="g5" name="fee_method"><option value="">—</option>${PAY.map((x) => `<option ${A.fee_method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="chips">${statusPills(p)}</div><button class="btn main" type="submit">Enregistrer licence et cotisation</button></form><p class="note">Saisi par le bureau. Visible du joueur ou de ses parents et du coach de l'équipe. Aucune donnée de santé n'est enregistrée : seulement « fourni » ou non.</p>`;
  } else if (a) {
    h += `<div class="card"><div class="chips">${statusPills(p)}</div><div class="det" style="margin-top:8px">${a.licence_number ? 'Licence n° ' + esc(a.licence_number) + '<br>' : ''}${a.fee_amount != null ? 'Cotisation : ' + esc(a.fee_paid) + ' € payés sur ' + esc(a.fee_amount) + ' €' + (a.fee_method ? ' (' + esc(a.fee_method) + ')' : '') : 'Montant de la cotisation à définir par le club'}</div></div>`;
  } else h += '<p class="empty">Pas encore de dossier.</p>';
  if (board) h += `<button class="btn danger" data-act="pdel" data-id="${pid}">${S.delPend === 'p' + pid ? 'Confirmer la suppression de la fiche' : 'Supprimer la fiche'}</button>`;
  return h;
}

// ---------- club : licences et cotisations ----------
export function licencesBlock() {
  if (!isBoard()) return '';
  const all = S.players || [], f = S.lf || 'Tous';
  const lic = all.filter((p) => adminOf(p.id)?.licence_state === 'Licencié').length, paid = all.filter((p) => feeState(adminOf(p.id)) === 'Payée').length;
  const keep = (p) => { const a = adminOf(p.id); return f === 'Tous' || (f === 'Licence à finir' && a?.licence_state !== 'Licencié') || (f === 'Cotisation à suivre' && feeState(a) !== 'Payée') || (f === 'Certificat manquant' && !a?.health_doc); };
  const list = all.filter(keep).sort((x, y) => (teamName(x.team_id) || '').localeCompare(teamName(y.team_id) || '') || pname(x).localeCompare(pname(y)));
  return `<div class="kick">Joueurs, licences et cotisations</div><div class="grid2"><div class="card"><div style="font-size:28px;font-weight:800">${lic} / ${all.length}</div><div class="det">licenciés</div></div><div class="card"><div style="font-size:28px;font-weight:800">${paid} / ${all.length}</div><div class="det">cotisations payées</div></div></div>
  <div class="chips">${['Tous', 'Licence à finir', 'Cotisation à suivre', 'Certificat manquant'].map((x) => `<button class="chip" data-act="lf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}</div>
  <div class="card">${list.length ? list.map((p) => `<button class="row" data-act="player" data-id="${p.id}"><span class="g">${esc(pname(p))}<small>${esc(teamName(p.team_id) || 'Sans équipe')}</small><span class="chips" style="gap:4px;margin-top:4px">${statusPills(p)}</span></span><span class="chev">›</span></button>`).join('') : '<p class="empty" style="margin:0">Aucun joueur dans ce filtre.</p>'}</div>`;
}

// ---------- validation : relier une demande à une fiche ----------
export function guessPlayer(m) {
  const want = (m.role === 'parent' ? m.child_name : name(m.user_id) || '').trim().toLowerCase();
  const p = (S.players || []).find((x) => pname(x).toLowerCase() === want && (!m.team_id || x.team_id === m.team_id));
  return p ? p.id : '';
}
export function playerPick(m) {
  if (!['parent', 'joueur'].includes(m.role) || !S.players) return '';
  S.vpl = S.vpl || {}; if (S.vpl[m.id] === undefined) S.vpl[m.id] = guessPlayer(m);
  const opts = S.players.filter((x) => !m.team_id || x.team_id === m.team_id), v = S.vpl[m.id];
  return `<div class="field"><label for="vp${m.id}">Fiche joueur à relier</label><select id="vp${m.id}" data-vpl="${m.id}"><option value="">Créer une nouvelle fiche${m.child_name ? ' (' + esc(m.child_name) + ')' : ''}</option>${opts.map((x) => `<option value="${x.id}" ${v === x.id ? 'selected' : ''}>${esc(pname(x))} · ${esc(teamName(x.team_id) || 'sans équipe')}</option>`).join('')}</select></div>`;
}

// ---------- actions ----------
export const ACTIONS = {
  agf: (el, d) => { S.agf = d.v; render(true); },
  lf: (el, d) => { S.lf = d.v; render(true); },
  player: (el, d) => { S.view = { type: 'player', id: d.id }; render(); },
  appel: (el, d) => { S.ap = null; S.view = { type: 'appel', id: d.id }; render(); },
  appset: (el, d) => { S.ap.st[d.id] = S.ap.st[d.id] === d.v ? '' : d.v; render(true); },
  appall: () => { const e = S.events.find((x) => x.id === S.ap.eid); (S.players || []).filter((p) => p.team_id === e.team_id).forEach((p) => { if (announced(p, e.id) !== 'non' && !S.ap.st[p.id]) S.ap.st[p.id] = 'present'; }); render(true); },
  appsave: async () => {
    const e = S.events.find((x) => x.id === S.ap.eid), ps = (S.players || []).filter((p) => p.team_id === e.team_id);
    const rows = ps.map((p) => ({ event_id: e.id, player_id: p.id, status: S.ap.st[p.id] || 'absent', marked_by: S.me.id, marked_at: new Date().toISOString() }));
    if (rows.length && await run(sb.from('attendance').upsert(rows), 'Appel enregistré.')) { S.view = { type: 'event', id: e.id }; await refresh(); }
  },
  consent: async (el, d) => {
    const p = pl(d.id), c = { ...(p.consents || {}) }, cur = !!(c[d.k] || {}).ok;
    c[d.k] = { ok: !cur, at: new Date().toISOString(), by: S.me.id };
    if (await run(sb.from('players').update({ consents: c }).eq('id', p.id))) { p.consents = c; render(true); }
  },
  pdel: async (el, d) => { if (S.delPend !== 'p' + d.id) { S.delPend = 'p' + d.id; return render(true); } S.delPend = null; if (await run(sb.from('players').delete().eq('id', d.id), 'Fiche supprimée.')) { S.view = null; await refresh(); } },
  evcancel: async (el, d) => { const e = S.events.find((x) => x.id === d.id); if (await run(sb.from('events').update({ cancelled: !e.cancelled }).eq('id', e.id), e.cancelled ? 'Séance rétablie.' : 'Séance annulée.')) await refresh(); },
  evserdel: async (el, d) => {
    if (S.delPend !== 'ser' + d.id) { S.delPend = 'ser' + d.id; return render(true); } S.delPend = null;
    if (await run(sb.from('events').delete().eq('series_id', d.id).gte('starts_at', new Date().toISOString()), 'Séances à venir de la série supprimées.')) { S.view = null; await refresh(); }
  },
};
export const KEEP_DEL = ['pdel', 'evserdel'];

// ---------- formulaires ----------
const num = (x) => (x === '' || x == null ? null : Number(String(x).replace(',', '.')));
export const FORMS = {
  plf: async (v, f) => {
    const row = { first_name: v.first_name.trim(), last_name: (v.last_name || '').trim(), birth_year: num(v.birth_year), emergency_name: (v.emergency_name || '').trim() || null, emergency_phone: (v.emergency_phone || '').trim() || null };
    if (v.team_id) row.team_id = v.team_id;
    if (await run(sb.from('players').update(row).eq('id', f.dataset.id), 'Informations enregistrées.')) await refresh();
  },
  padminf: async (v, f) => {
    const row = { player_id: f.dataset.id, licence_state: v.licence_state, licence_number: (v.licence_number || '').trim() || null, health_doc: !!v.health_doc, fee_amount: num(v.fee_amount), fee_paid: num(v.fee_paid) || 0, fee_method: v.fee_method || null, updated_by: S.me.id, updated_at: new Date().toISOString() };
    if (await run(sb.from('player_admin').upsert(row), 'Licence et cotisation enregistrées.')) await refresh();
  },
  paddf: async (v, f) => {
    if (await run(sb.rpc('create_player', { p_club: S.clubId, p_team: f.dataset.team, p_first: v.first, p_last: v.last || '', p_year: num(v.year) }), 'Joueur ajouté.')) await refresh();
  },
};
