// Pocket Club · onglet Équipe, fiche d'équipe, ajout et import de joueurs (n° 7, 8, 26).
import {
  S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, FORMS, INPUTS, CHANGES, BCATS, GENRES, SEASON, NEXT_SEASON, XLSX_URL,
  active, isBoard, isPresident, coachOf, team, teamName, myTeamIds, myPlayers, playersOfTeam, pname, adminOf, toValidate, niceFirst, niceLast, norm,
  loadJs, plural, fmtShort, evTeams, follows, mySelf, myKids,
} from './core.js';
export { importFile };
import { smartParse, analyse, fromMapping, doubts, COLS, decodeText, bestSheet } from './importer.js';
import { icon, delBtn, field } from './ui.js';
import { evCard, upcoming } from './agenda.js';
import { pendRows } from './club.js';
import { statusPills, presence } from './joueur.js';

// ---------- mes enfants / ma fiche ----------
// n° 51 : « Moi » (ma fiche de joueur) puis « Mes enfants », séparés
export function kidsBlock() {
  const card = (p) => `<div class="card"><button class="row" style="border:0;padding:0" data-act="player" data-id="${p.id}"><span class="avatar">${esc((p.first_name[0] || '') + (p.last_name[0] || ''))}</span><span class="g">${esc(pname(p))}<small>${esc(teamName(p.team_id) || 'Sans équipe')} · fiche, autorisations, licence</small></span><span class="chev"></span></button><div class="chips">${statusPills(p)}</div></div>`;
  const me = mySelf(), kids = myKids();
  return (me.length ? `<div class="sec"><h2>Moi</h2></div>` + me.map(card).join('') : '') + (kids.length ? `<div class="sec"><h2>${kids.length > 1 ? 'Mes enfants' : 'Mon enfant'}</h2></div>` + kids.map(card).join('') : '');
}

// ---------- effectif ----------
function people(rows) {
  const map = new Map();
  rows.forEach((x) => { const key = x.user_id || 'p:' + x.ref; if (!map.has(key)) map.set(key, { name: (x.first_name + ' ' + (x.last_name || '')).trim(), first: x.first_name, tags: [], player: null }); const p = map.get(key); if (x.kind === 'joueur') p.player = x.ref; p.tags.push(x); });
  return [...map.values()];
}
// N° 31 : coachs et joueurs comptés à part (un joueur-entraîneur apparaît dans les deux)
export function teamRoster(tid) {
  const rows = S.roster.filter((x) => x.team_id === tid), coaches = people(rows.filter((x) => x.role === 'coach')), players = people(rows.filter((x) => x.kind === 'joueur')).sort((a, b) => a.first.localeCompare(b.first, 'fr'));
  if (!coaches.length && !players.length && !isBoard() && !coachOf(tid)) return '';
  const line = (p, sub) => `<div class="row static"><span class="avatar">${esc(p.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span><span class="g">${esc(p.name)}<small>${sub}</small></span></div>`;
  return `<div class="sec"><h2>Coachs</h2><span class="det">${coaches.length}</span></div><div class="card"><div class="list">${coaches.length ? coaches.map((p) => line(p, p.tags.some((x) => x.assistant) ? 'Coach assistant' : 'Coach')).join('') : '<p class="empty">Pas encore de coach.</p>'}</div></div>
  <div class="sec"><h2>Effectif</h2><span class="det">${plural(players.length, 'joueur')}</span></div><div class="card"><div class="list">${players.length ? players.map((p) => line(p, 'Joueur')).join('') : '<p class="empty">Aucun joueur pour l’instant.</p>'}</div></div><p class="note">Les parents figurent sur la fiche de leur enfant.</p>`;
}
const cteam = (tid) => S.cteams.find((x) => x.id === tid);
// Vue d'une équipe suivie ou d'une autre équipe du club (sans les joueurs ni leur nombre, n° 41)
function followView(tid) {
  const t = cteam(tid) || team(tid); if (!t) return '<p class="empty">Équipe introuvable.</p>';
  const evs = upcoming(S.events.filter((e) => evTeams(e).includes(tid) && ['Match', 'Plateau', 'Tournoi'].includes(e.type)));
  return `<div class="card lift"><div class="kick">Coach</div><b>${esc(t.coach || 'Pas encore de coach')}</b><div class="kick">Créneaux et gymnase</div><div>${esc(t.slots || 'Non renseignés')}</div>${followBtn(tid)}</div>
  <div class="sec"><h2>Prochains matchs</h2></div>${evs.length ? evs.slice(0, 6).map((e) => evCard(e)).join('') : `<p class="empty">${follows(tid) ? 'Aucun match prévu pour l’instant.' : 'Suis l’équipe pour voir ses matchs dans ton agenda.'}</p>`}`;
}
export const followBtn = (tid) => (team(tid)?.state === 'Fantôme' ? '' : follows(tid) ? `<button class="btn small ghost" data-act="unfollow" data-id="${tid}">Ne plus suivre</button>` : `<button class="btn small main" data-act="follow" data-id="${tid}">Suivre cette équipe</button>`);
function coachBlock(tid) {
  if (!coachOf(tid) && !isBoard()) return '';
  const ps = playersOfTeam(tid).sort((a, b) => pname(a).localeCompare(pname(b), 'fr'));
  const next = upcoming(S.events.filter((e) => evTeams(e).includes(tid) && !e.cancelled && ['Entraînement', 'Match', 'Plateau', 'Tournoi'].includes(e.type)))[0];
  let h = '';
  if (next) h += `<div class="card yellow"><span class="kick" style="color:var(--pc-encre)">Prochaine séance</span><b style="font-family:var(--pc-titre);font-size:24px;line-height:1.05">${esc(next.title)}</b><span>${esc(fmtShort(next.starts_at))}${next.place ? ' · ' + esc(next.place) : ''}</span><button class="btn ink" data-act="appel" data-id="${next.id}">Faire l'appel</button></div>`;
  const lic = ps.filter((p) => adminOf(p.id)?.licence_state === 'Licencié').length, noBirth = ps.filter((p) => !p.birth_date).length;
  h += `<div class="sec"><h2>Joueurs</h2><span class="det">${ps.length} · ${lic} licenciés</span></div>`;
  if (noBirth) h += `<div class="card warn"><b>${plural(noBirth, 'date de naissance manque', 'dates de naissance manquent')}</b><span class="note" style="color:var(--pc-encre)">Sans elle, le joueur est traité comme mineur pour les autorisations.</span></div>`;
  h += `<div class="card"><div class="list">${ps.length ? ps.map((p) => { const pr = presence(p.id), a = adminOf(p.id); return `<button class="row" data-act="player" data-id="${p.id}"><span class="g">${esc(pname(p))}<small>${[pr.n ? 'présence ' + Math.round((100 * pr.ok) / pr.n) + ' %' : '', a?.licence_state || '', p.birth_date ? '' : 'date de naissance à compléter'].filter(Boolean).join(' · ')}</small></span><span class="chev"></span></button>`; }).join('') : '<p class="empty">Aucune fiche joueur.</p>'}</div></div>`;
  return h + `<button class="btn ghost" data-act="import" data-id="${tid}">${icon('plus', 20)}Ajouter des joueurs</button>`;
}
export function teamTab() {
  const mine = myTeamIds().filter((t) => team(t)), fol = S.follows.filter((t) => team(t) && !mine.includes(t)), ids = mine.concat(fol);
  if (!ids.length) return kidsBlock() + (myPlayers().length ? '' : '<div class="card"><p class="empty">Tu n’es rattaché à aucune équipe dans ce club.</p></div>') + '<button class="btn ghost" data-act="rqgo">Demander un rôle dans une équipe</button><button class="btn ghost" data-act="tab" data-i="4">Suivre une équipe du club</button>';
  if (!ids.includes(S.teamSel)) S.teamSel = ids[0];
  const tid = S.teamSel, coach = coachOf(tid);
  let h = kidsBlock();
  if (ids.length > 1) h += `<div class="chips">${ids.map((i) => `<button class="chip" data-act="teamsel" data-id="${i}" aria-pressed="${i === tid}">${esc(teamName(i))}${fol.includes(i) ? ' · Suivie' : ''}</button>`).join('')}</div>`;
  if (fol.includes(tid)) return h + '<span class="pill blue">Équipe suivie</span>' + followView(tid);
  const vp = toValidate().filter((m) => m.team_id === tid);
  if (vp.length) h += `<div class="sec"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card">${pendRows(vp)}</div>`;
  h += coachBlock(tid);
  const evs = upcoming(S.events.filter((e) => evTeams(e).includes(tid)));
  h += `<div class="sec"><h2>Prochains rendez-vous</h2>${coach ? `<button data-act="evnew" data-team="${tid}">${icon('plus', 18)} Ajouter</button>` : ''}</div>` + (evs.length ? evs.slice(0, 5).map((e) => evCard(e, { answer: true })).join('') : '<p class="empty">Aucun rendez-vous prévu pour l’équipe.</p>');
  return h + `<button class="btn ghost" data-act="team" data-id="${tid}">Fiche de l'équipe ${esc(teamName(tid))}</button>` + teamRoster(tid);
}

// ---------- fiche d'équipe ----------
export function teamForm(t, id) {
  const cat = t.category || '', gen = t.gender || '';
  return `<form id="${id}" data-id="${t.id || ''}" class="stack"><div class="grid2">${field(id + 'c', 'Catégorie', `<select id="${id}c" name="category" data-teamauto="1"><option value="">—</option>${BCATS.map((x) => `<option ${cat === x ? 'selected' : ''}>${x}</option>`).join('')}${cat && !BCATS.includes(cat) ? `<option selected>${esc(cat)}</option>` : ''}</select>`)}${field(id + 'g', 'Genre', `<select id="${id}g" name="gender" data-teamauto="1"><option value="">—</option>${GENRES.map((x) => `<option ${gen === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
  ${field(id + 'n', "Nom de l'équipe (proposé d'après la catégorie)", `<input id="${id}n" name="name" value="${esc(t.name || '')}" maxlength="60" placeholder="Ex. U13 F, Reines" data-teamname="1" ${t.id ? 'data-manual="1"' : ''}>`)}
  ${field(id + 's', 'Créneaux et gymnase', `<input id="${id}s" name="slots" value="${esc(t.slots || '')}" placeholder="Ex. Mercredi 14 h – 15 h 30, gymnase Jean-Moulin">`)}
  <button class="btn main" type="submit">${t.id ? 'Enregistrer' : "Créer l'équipe"}</button></form>`;
}
export function teamPage(tid) {
  const t = team(tid); if (!t) return '<p class="empty">Équipe introuvable.</p>';
  const board = isBoard(), coach = coachOf(tid), ct = cteam(tid);
  if (!board && !coach && !myTeamIds().includes(tid)) return followView(tid);
  let h = `<div class="card lift">${ct && ct.coaches != null ? `<div class="chips"><span class="pill blue">Coachs : ${ct.coaches}</span><span class="pill blue">Effectif : ${plural(ct.players, 'joueur')}</span></div>` : ''}<div class="kick">Créneaux et gymnase</div><div>${esc(t.slots || 'Non renseignés')}</div>${t.state === 'Fantôme' ? `<span class="pill wait">Fantôme · en attente de validation</span><p class="note">Visible du bureau et de ses coachs seulement, aucune notification. Les familles la verront une fois validée.</p><button class="btn main ${isArmed('tv' + tid) ? 'ink' : ''}" data-act="tvisible" data-id="${tid}">${isArmed('tv' + tid) ? "Confirmer : l'équipe devient visible des familles" : "Rendre l'équipe visible"}</button>` : t.state === 'Archivée' ? '<span class="pill">Archivée</span>' : ''}${!myTeamIds().includes(tid) ? followBtn(tid) : ''}</div>`;
  const vp = toValidate().filter((m) => m.team_id === tid);
  if ((board || coach) && vp.length) h += `<div class="sec"><h2>Demandes à valider</h2><span class="pill wait">${vp.length}</span></div><div class="card">${pendRows(vp)}</div>`;
  if (board || coach) {
    h += `<button class="btn main" data-act="import" data-id="${tid}">${icon('plus', 20)}Ajouter des joueurs (un par un, liste, Excel, photo)</button>`;
    h += `<details class="card"><summary>${board ? "Réglages de l'équipe" : "Créneaux de l'équipe"}</summary>${board ? teamForm(t, 'teamedit') : `<form id="teamslots" data-id="${tid}" class="stack">${field('tsl', 'Créneaux et gymnase', `<input id="tsl" name="slots" value="${esc(t.slots || '')}">`)}<button class="btn main" type="submit">Enregistrer</button></form>`}</details>`;
    const cands = S.roster.filter((x) => x.user_id).reduce((a, x) => (a.some((y) => y.user_id === x.user_id) ? a : a.concat(x)), [])
      .concat(S.members.filter((m) => m.status === 'active' && !S.roster.some((x) => x.user_id === m.user_id)).map((m) => ({ user_id: m.user_id, first_name: S.names[m.user_id] || 'Membre', last_name: '' })))
      .reduce((a, x) => (a.some((y) => y.user_id === x.user_id) ? a : a.concat(x)), []);
    h += `<details class="card"><summary>${board ? 'Nommer un coach ou un assistant' : 'Ajouter un coach assistant'}</summary><form id="coachf" data-id="${tid}" class="stack">${field('cfu', 'Membre du club', `<select id="cfu" name="user">${cands.map((x) => `<option value="${x.user_id}">${esc((x.first_name + ' ' + x.last_name).trim())}</option>`).join('')}</select>`)}${board ? '<label class="check"><input type="checkbox" name="assistant"><span>Coach assistant</span></label>' : '<input type="hidden" name="assistant" value="on">'}<button class="btn main" type="submit">Nommer</button><p class="note">La personne doit déjà être membre du club (elle a rejoint avec le code).</p></form></details>`;
  }
  if (board) h += `<div class="btns">${t.state === 'Visible' ? `<button class="btn ghost small" data-act="tstate" data-id="${tid}" data-v="Fantôme">Repasser en mode fantôme</button>` : ''}${t.state !== 'Archivée' ? `<button class="btn ghost small ${isArmed('rn' + tid) ? 'danger armed' : ''}" data-act="trenew" data-id="${tid}">${isArmed('rn' + tid) ? `Confirmer : archiver et recréer pour ${NEXT_SEASON}` : `Archiver et reconduire pour ${NEXT_SEASON}`}</button>` : ''}</div>`;
  if (isPresident()) h += delBtn('tdel', tid, "Mettre l'équipe à la corbeille", "Confirmer : l'équipe part à la corbeille (30 jours)", isArmed('t' + tid));
  return h + teamRoster(tid);
}

// ---------- ajout et import de joueurs ----------
async function checkImport() {
  const I = S.imp;
  if (!I.rows.length) { toast('Aucune ligne reconnue : vérifie que la liste contient bien des noms (un joueur par ligne).'); I.rows = null; return render(); }
  const r = await run(sb.rpc('match_players', { p_club: S.clubId, p_rows: I.rows.map((x) => ({ first_name: x.first_name, last_name: x.last_name, birth_date: x.birth_date || null, licence: x.licence || null, team_id: I.tid })) }));
  I.matches = {}; (r || []).forEach((m) => { (I.matches[m.idx] = I.matches[m.idx] || []).push(m); });
  I.rows.forEach((x, i) => {
    const inFile = I.rows.findIndex((y, j) => j < i && norm(y.first_name) === norm(x.first_name) && norm(y.last_name) === norm(x.last_name)) >= 0;
    x.action = I.matches[i] || inFile ? 'skip' : 'create'; x.existing = I.matches[i]?.[0]?.player_id || null;
  });
  render();
}
// N° 47 : lecture d'un fichier, avec un message précis à chaque étape
export const XLSX_LOCAL = 'js/vendor/xlsx.bundle.js';
export async function loadXlsx() { if (window.XLSX) return window.XLSX; await loadJs(XLSX_LOCAL); if (!window.XLSX) throw new Error('xlsx'); return window.XLSX; }
async function importFile(file) {
  let table;
  try {
    const buf = await file.arrayBuffer();
    if (/\.(csv|txt)$/i.test(file.name) || /^text\//.test(file.type)) table = decodeText(buf);
    else {
      let X; try { X = await loadXlsx(); } catch { return toast("Lecture d'Excel impossible pour l'instant (connexion ?). Réessaie, ou enregistre le fichier en .csv."); }
      table = bestSheet(X, X.read(buf, { type: 'array', cellDates: true }));
    }
  } catch (e) { console.error(e); return toast("Fichier illisible : choisis un fichier Excel (.xlsx, .xls), OpenDocument (.ods) ou CSV."); }
  S.imp.photo = false; S.imp.fileName = file.name;
  await readInput(table);
}
// Lecture d'une entrée (texte collé ou tableau Excel) : écran « Quelle colonne est quoi ? » seulement si la reconnaissance est incertaine
async function readInput(input) {
  const I = S.imp, a = analyse(input);
  if (a && a.unsure) { I.map = a; I.rows = null; return render(); }
  I.map = null; I.rows = smartParse(input, { swap: I.swap }); await checkImport();
}
function mappingScreen(I) {
  const a = I.map;
  return `<div class="card lift"><h3>Quelle colonne est quoi ?</h3><p class="note">Je ne suis pas sûr de toutes les colonnes. Vérifie la proposition, colonne par colonne. Les colonnes « Ignorer » (ville…) ne sont jamais enregistrées.</p>${a.columns.map((c, i) => `<div class="card flat"><div class="det">${c.head ? `En-tête : <b>${esc(c.head)}</b> · ` : ''}Exemples : ${c.sample.map(esc).join(' · ')}</div>${field('mc' + i, 'Cette colonne contient', `<select id="mc${i}" data-impcol="${i}" class="${c.sure ? '' : 'doubt'}">${COLS.map(([k, l]) => `<option value="${k}" ${c.k === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}</div>`).join('')}<button class="btn main" data-act="impmap">Continuer</button></div><button class="btn ghost" data-act="impback">Revenir à la liste</button>`;
}
export function importPage(tid) {
  const I = S.imp || (S.imp = { tid, text: '', rows: null, matches: {} });
  let h = '';
  if (I.map && !I.rows) return mappingScreen(I);
  if (!I.rows) {
    return `<div class="card lift">${field('imt', 'Coller une liste', `<textarea id="imt" data-imptext="1" style="min-height:160px" placeholder="Une ligne par joueur&#10;Lily RAVENEAU;12/03/2018">${esc(I.text)}</textarea>`)}
    <p class="note">Une ligne par joueur. Colonnes acceptées dans n'importe quel ordre : nom, prénom, date de naissance, n° de licence, e-mail ou téléphone du parent. Pour un seul joueur, écris simplement une ligne.</p>
    ${field('imf', 'Ou choisir un fichier Excel ou CSV (le plus fiable)', '<input id="imf" type="file" accept=".xlsx,.xls,.ods,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet" data-impfile="1">')}
    ${field('imo', "Ou une photo ou une capture d'écran de la liste", '<input id="imo" type="file" accept="image/*" data-ocr="1">')}
    <div class="card pale"><b>Le plus simple avec une photo</b><p class="note" style="color:var(--pc-encre)">Ouvre la photo avec l'appareil photo du téléphone, touche « Copier le texte » (Google Lens sur Android, « Texte en direct » sur iPhone), puis colle le texte dans la zone ci-dessus. C'est gratuit et bien plus fiable que la lecture ci-dessous.</p></div>
    <p class="note">La lecture directe de l'image est peu fiable sur les tableaux et l'écriture à la main ; l'image reste sur ton téléphone. Si tu as le fichier Excel d'origine, préfère-le.</p>
    <label class="check"><input type="checkbox" data-impswap="1" ${I.swap ? 'checked' : ''}><span>Inverser prénom et nom (listes « NOM Prénom » sans capitales)</span></label>
    <button class="btn main" data-act="impcheck">Vérifier la liste</button><p class="note">Rien n'est créé avant « Valider l'import ».</p></div>`;
  }
  const M = I.matches, hasContact = I.rows.some((r) => r.email || r.phone);
  h += `<div class="card lift"><div class="kick">Vérification · ${plural(I.rows.length, 'ligne')}</div>${I.photo ? '<p class="note">Lu sur une photo : les cases en orange sont douteuses, vérifie-les.</p>' : ''}`;
  I.rows.forEach((r, i) => {
    const dups = M[i] || [], inFile = I.rows.findIndex((x, j) => j < i && norm(x.first_name) === norm(r.first_name) && norm(x.last_name) === norm(r.last_name)) >= 0, dz = I.photo ? doubts(r, true) : new Set();
    const inp = (k, label, type = 'text') => field(`ir${i}${k}`, label, `<input id="ir${i}${k}" type="${type}" data-imp="${i}" data-k="${k}" value="${esc(r[k] || '')}" class="${dz.has(k) ? 'doubt' : ''}">`);
    h += `<div class="card flat" style="${r.action === 'skip' ? 'opacity:.6' : ''}"><div class="grid2">${inp('first_name', 'Prénom')}${inp('last_name', 'Nom')}</div><div class="grid2">${inp('birth_date', 'Naissance', 'date')}${inp('licence', 'N° de licence')}</div>${(r.email || r.phone) && !I.noContacts ? `<div class="grid2">${inp('email', 'E-mail du parent', 'email')}${inp('phone', 'Téléphone du parent', 'tel')}</div>` : ''}`;
    if (inFile) h += '<span class="pill ko">Doublon dans la liste elle-même</span>';
    if (dups.length) {
      const d = dups[0];
      h += `<div class="card warn"><b>${d.kind === 'certain' ? 'Déjà dans le club' : 'Ressemble à'} : ${esc(d.label)} · ${esc(d.team_name)}</b>${field(`ir${i}a`, 'Que faire ?', `<select id="ir${i}a" data-impact="${i}"><option value="skip" ${r.action === 'skip' ? 'selected' : ''}>Garder l'existant (ne pas ajouter cette ligne)</option><option value="create" ${r.action === 'create' ? 'selected' : ''}>Garder les deux (deux personnes différentes)</option><option value="complete" ${r.action === 'complete' ? 'selected' : ''}>Compléter la fiche existante</option>${d.same_team ? '' : `<option value="addteam" ${r.action === 'addteam' ? 'selected' : ''}>Ajouter aussi à l'équipe ${esc(teamName(tid))}</option>`}</select>`)}</div>`;
    }
    h += `<button class="btn link" data-act="impdel" data-i="${i}" style="align-self:flex-start">Retirer cette ligne</button></div>`;
  });
  h += '</div>';
  if (hasContact) h += `<label class="check"><input type="checkbox" data-impnocontact="1" ${I.noContacts ? 'checked' : ''}><span><b>Ne pas importer les coordonnées</b><br><span class="det">Sinon, l'e-mail et le téléphone du parent sont gardés sur la fiche de l'enfant pour l'inviter (visibles du parent, du coach et du bureau).</span></span></label>`;
  return h + `<button class="btn main" data-act="impok">Valider l'import</button><button class="btn ghost" data-act="impswapall">Inverser prénom et nom pour toute la liste</button><button class="btn ghost" data-act="impback">Modifier la liste</button>`;
}

Object.assign(ACTIONS, {
  teamsel: (el, d) => { S.teamSel = d.id; render(true); },
  team: (el, d) => { S.view = { type: 'team', id: d.id }; render(); },
  tvisible: async (el, d) => { if (!armed('tv' + d.id)) return; if (await run(sb.from('teams').update({ state: 'Visible' }).eq('id', d.id), 'Équipe visible : les familles peuvent la voir et la rejoindre.')) await refresh(); },
  follow: async (el, d) => { if (await run(sb.from('team_follows').insert({ user_id: S.me.id, team_id: d.id }), 'Équipe suivie : ses matchs apparaissent dans ton agenda.')) await refresh(); },
  unfollow: async (el, d) => { if (await run(sb.from('team_follows').delete().eq('user_id', S.me.id).eq('team_id', d.id), 'Tu ne suis plus cette équipe.')) await refresh(); },
  tstate: async (el, d) => { if (await run(sb.from('teams').update({ state: d.v }).eq('id', d.id), d.v === 'Visible' ? 'Équipe visible.' : 'Équipe en mode fantôme.')) await refresh(); },
  trenew: async (el, d) => { if (!armed('rn' + d.id)) return; const n = await run(sb.rpc('renew_team', { p_team: d.id, p_season: NEXT_SEASON }), `Équipe reconduite pour ${NEXT_SEASON} (mode fantôme).`); if (n) { S.view = { type: 'team', id: n }; await refresh(); } },
  tdel: async (el, d) => { if (!armed('t' + d.id)) return; if (await run(sb.rpc('trash_item', { p_kind: 'team', p_id: d.id }), 'Équipe mise à la corbeille. Le bureau peut la restaurer pendant 30 jours.')) { S.view = null; await refresh(); } },
  import: (el, d) => { S.imp = { tid: d.id, text: '', rows: null, matches: {}, map: null }; S.view = { type: 'import', id: d.id }; render(); },
  impcheck: async () => { S.imp.photo = S.imp.photo && !!S.imp.text; await readInput(S.imp.text); },
  impmap: async () => { const I = S.imp; if (!I.map.columns.some((c) => ['name', 'first', 'last'].includes(c.k))) return toast('Indique au moins la colonne du nom.'); I.rows = fromMapping(I.map.body, I.map.columns, I.swap); I.map = null; await checkImport(); },
  impdel: (el, d) => { const I = S.imp, M = {}; I.rows.splice(+d.i, 1); Object.keys(I.matches).forEach((k) => { if (+k !== +d.i) M[+k > +d.i ? +k - 1 : +k] = I.matches[k]; }); I.matches = M; render(true); },
  impback: () => { S.imp.rows = null; S.imp.map = null; render(); },
  impswapall: async () => { const I = S.imp; I.rows.forEach((r) => { [r.first_name, r.last_name] = [r.last_name, r.first_name]; }); await checkImport(); toast('Prénom et nom inversés.'); },
  impok: async () => {
    const I = S.imp, rows = I.rows.map((r) => ({ first_name: niceFirst(r.first_name), last_name: niceLast(r.last_name), birth_date: r.birth_date || null, licence: r.licence || null, action: r.action || 'create', existing: r.existing || null, email: I.noContacts ? null : r.email || null, phone: I.noContacts ? null : r.phone || null }));
    if (rows.some((r) => r.action !== 'skip' && (!r.first_name || !r.last_name))) return toast('Chaque ligne doit avoir un prénom et un nom.');
    const { data: n, error } = navigator.onLine ? await sb.rpc('import_players', { p_club: S.clubId, p_team: I.tid, p_rows: rows }) : { error: { message: 'pas de réseau' } };
    if (error) { console.error(error); return toast('Enregistrement refusé : ' + (error.message || 'erreur inconnue').replace(/^.*?: /, '') + '. Rien n’a été importé.'); }
    if (n !== null) { toast(plural(n, 'joueur ajouté ou complété', 'joueurs ajoutés ou complétés') + '.'); S.imp = null; S.view = { type: 'team', id: I.tid }; await refresh(); }
  },
});
Object.assign(FORMS, {
  teamnew: async (v) => {
    const nm = (v.name || '').trim() || autoName(v.category, v.gender);
    if (!nm) return toast('Choisis une catégorie ou donne un nom.');
    if (await run(sb.from('teams').insert({ club_id: S.clubId, name: nm, category: v.category || nm, gender: v.gender || '', slots: v.slots || '', season: SEASON }), 'Équipe créée en mode fantôme : rends-la visible quand elle est prête.')) await refresh();
  },
  teamedit: async (v, f) => { if (await run(sb.from('teams').update({ name: (v.name || '').trim() || teamName(f.dataset.id), category: v.category || '', gender: v.gender || '', slots: v.slots || '' }).eq('id', f.dataset.id), 'Équipe enregistrée.')) await refresh(); },
  teamslots: async (v, f) => { if (await run(sb.from('teams').update({ slots: v.slots || '' }).eq('id', f.dataset.id), 'Créneaux enregistrés.')) await refresh(); },
  coachf: async (v, f) => { if (await run(sb.rpc('set_team_coach', { p_team: f.dataset.id, p_user: v.user, p_assistant: !!v.assistant }), 'Coach nommé.')) await refresh(); },
});
// N° 28 : nom proposé d'après la catégorie et le genre (« U13 F », « U13 M », « U13 »), tant qu'il n'est pas modifié à la main
export const autoName = (cat, gen) => ((cat || '').replace(' (baby)', '') + (gen === 'Féminine' ? ' F' : gen === 'Masculine' ? ' M' : '')).trim();
INPUTS.push((t) => {
  if (t.dataset.teamname) { t.dataset.manual = t.value ? '1' : ''; return true; }
  if (t.dataset.imptext) { S.imp.text = t.value; return true; }
  if (t.dataset.imp) { S.imp.rows[+t.dataset.imp][t.dataset.k] = t.value; return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.teamauto) { const f = t.closest('form'), n = f.querySelector('[data-teamname]'); if (n && !n.dataset.manual) n.value = autoName(f.querySelector('[name=category]').value, f.querySelector('[name=gender]').value); return true; }
  if (t.dataset.impact) { S.imp.rows[+t.dataset.impact].action = t.value; render(true); return true; }
  if (t.dataset.impcol) { S.imp.map.columns[+t.dataset.impcol].k = t.value; S.imp.map.columns[+t.dataset.impcol].sure = true; render(true); return true; }
  if (t.dataset.impnocontact) { S.imp.noContacts = t.checked; render(true); return true; }
  if (t.dataset.impswap) { S.imp.swap = t.checked; return true; }
  if (t.dataset.impfile && t.files?.[0]) {
    const file = t.files[0]; t.value = '';   // permet de choisir à nouveau le même fichier
    await importFile(file);
    return true;
  }
  if (t.dataset.ocr && t.files?.[0]) {
    toast("Lecture de l'image… (30 secondes environ la première fois)");
    try {
      await loadJs('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
      const r = await window.Tesseract.recognize(t.files[0], 'fra');
      const lines = (r.data.text || '').split(/\r?\n/).map((l) => l.replace(/[|_[\]{}]+/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter((l) => /[A-Za-zÀ-ÿ]{2,}/.test(l));
      S.imp.text = (S.imp.text ? S.imp.text.trim() + '\n' : '') + lines.join('\n'); S.imp.photo = true; render(true);
      toast(lines.length ? lines.length + ' lignes lues : vérifie-les, puis « Vérifier la liste ».' : 'Aucun nom lu. Essaie une image plus nette.');
    } catch { toast('Lecture impossible (connexion ?). Essaie le copier-coller.'); }
    return true;
  }
  return false;
});
export { active };
