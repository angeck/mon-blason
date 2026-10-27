// Mon Blason · alpha 2.0 · membres, fiche équipe, import et doublons, tarifs, événements masqués,
// agenda du téléphone, mentions légales et conditions, couleurs de la marque dans Mon compte.
let S, sb, esc, run, toast, render, refresh, name, teamName, myMem, ROLES, canValidate, toValidate, pendRows, crest, fmtShort;

export const CGU_VERSION = 'alpha-2026-10';
export const PALETTES = { terrain: ['#0B6B3A', '#FFD400', 'Terrain'], parquet: ['#0F1A3A', '#FF5B14', 'Parquet'], stade: ['#1E3FFF', '#FF2E4D', 'Stade'] };
const BCATS = ['U7 (baby)', 'U9', 'U11', 'U13', 'U15', 'U17', 'U18', 'U20', 'U21', 'Seniors', 'Loisirs', 'Vétérans'];
const GENRES = ['Féminine', 'Masculine', 'Mixte'];
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

export function install(ctx) { ({ S, sb, esc, run, toast, render, refresh, name, teamName, myMem, ROLES, canValidate, toValidate, pendRows, crest, fmtShort } = ctx); }

// ---------- droits ----------
const active = () => myMem().filter((m) => m.status === 'active');
export const isBoard = () => active().some((m) => ['president', 'bureau'].includes(m.role));
export const isPresident = () => active().some((m) => m.role === 'president');
export const coachTeams = () => active().filter((m) => m.role === 'coach' && m.team_id).map((m) => m.team_id);
const coachOf = (tid) => coachTeams().includes(tid);
const team = (id) => S.teams.find((t) => t.id === id);

// ---------- noms ----------
export const niceFirst = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
export const niceLast = (s) => { const t = String(s || '').trim().replace(/\s+/g, ' '); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- inscription conforme et textes ----------
export function signupExtras() {
  return `<div class="card" style="background:#F7F9F5"><div class="kick">Vos données</div><p class="note" style="margin-top:4px;color:var(--encre)">Votre club organise sa vie (équipes, présences, messages) avec Mon Blason, qui héberge les données pour lui. Seuls les membres concernés les voient : les familles voient les autres joueurs en « Prénom N. », l'encadrement voit les coordonnées. Les données sont gardées tant que vous êtes membre, puis supprimées. Vous pouvez les consulter, les corriger ou les supprimer à tout moment depuis Mon compte.</p><button type="button" class="btn small" data-act="legal" style="margin-top:8px">Politique de confidentialité et conditions</button></div>
  <label class="check"><input type="checkbox" name="cgu" required><span>J'ai lu et j'accepte les conditions d'utilisation <b>(obligatoire)</b></span></label>
  <label class="check"><input type="checkbox" name="optin"><span>J'accepte de recevoir des e-mails d'information de Mon Blason (facultatif)</span></label>`;
}
export function cguScreen() {
  return `<main class="bd"><h1>Conditions d'utilisation</h1><p>Mon Blason évolue : pour continuer, merci de lire et d'accepter les conditions de la version alpha.</p>${legalText()}<form id="cguf" class="card" style="display:flex;flex-direction:column;gap:10px"><label class="check"><input type="checkbox" name="cgu" required><span>J'ai lu et j'accepte les conditions d'utilisation</span></label><label class="check"><input type="checkbox" name="optin"><span>J'accepte de recevoir des e-mails d'information (facultatif)</span></label><button class="btn main" type="submit">Continuer</button></form></main>`;
}
export function legalText() {
  return `<div class="card"><h2>Mentions légales</h2><p class="note" style="color:var(--encre)">Application Mon Blason, version alpha de test, éditée par Gaël Raveneau (particulier). Contact : [adresse de contact à compléter]. Application hébergée par GitHub, Inc. (88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis). Données hébergées par Supabase, Inc., dans un centre de données situé à Paris (région eu-west-3).</p>
  <h2>Confidentialité (version courte)</h2><ul class="note" style="color:var(--encre);padding-left:18px;margin:6px 0">
  <li><b>Qui ?</b> Votre club décide des données utiles à sa vie sportive ; Mon Blason les héberge et les traite pour lui.</li>
  <li><b>Quoi ?</b> Identité, contact, rôles et équipes, présences et réponses, messages, autorisations datées, état de la licence et de la cotisation. Jamais de donnée médicale : seulement « certificat fourni » oui ou non.</li>
  <li><b>Qui voit ?</b> Les familles voient les autres joueurs en « Prénom N. » ; les coachs voient leur équipe ; le bureau voit le club ; les téléphones restent entre l'encadrement et les familles concernées.</li>
  <li><b>Enfants :</b> avant 15 ans, c'est le parent qui gère le compte et les autorisations.</li>
  <li><b>Combien de temps ?</b> Tant que vous êtes membre ; ensuite, suppression, sauf ce que le club doit garder pour sa comptabilité.</li>
  <li><b>Vos droits :</b> consulter, corriger, supprimer, vous opposer : depuis Mon compte, ou en écrivant au club. Vous pouvez saisir la CNIL (cnil.fr).</li></ul>
  <h2>Conditions d'utilisation (alpha)</h2><ul class="note" style="color:var(--encre);padding-left:18px;margin:6px 0">
  <li>Version de test : des erreurs et des changements sont possibles ; ne l'utilisez pas comme seul outil du club.</li>
  <li>Le compte joueur est réservé aux 15 ans et plus ; en dessous, un parent ouvre son compte et y relie l'enfant.</li>
  <li>Chacun reste responsable de ce qu'il publie ; tout contenu signalé et contraire à la loi est retiré.</li>
  <li>Ne saisissez jamais d'information médicale (maladie, allergie, traitement).</li>
  <li>Le club certifie avoir le droit d'utiliser son logo.</li></ul><p class="note">Version ${CGU_VERSION}. Textes provisoires, à relire par un juriste avant l'ouverture à d'autres clubs.</p></div>`;
}

// ---------- membres (n° 3, n° 10) ----------
export async function loadRoster(cid) {
  const r = await sb.rpc('club_roster', { p_club: cid });
  S.roster = r.error ? null : (r.data || []);
  (S.roster || []).forEach((x) => { if (x.user_id) S.names[x.user_id] = (x.first_name + ' ' + (x.last_name || '')).trim(); });
}
function people(rows) {
  const map = new Map();
  rows.forEach((x) => {
    const key = x.user_id || 'p:' + x.ref;
    if (!map.has(key)) map.set(key, { key, name: (x.first_name + ' ' + (x.last_name || '')).trim(), first: x.first_name, last: x.last_name || '', since: x.since, tags: [], player: x.kind === 'joueur' ? x.ref : null, user: x.user_id });
    const p = map.get(key); if (x.kind === 'joueur') p.player = x.ref;
    if (x.since < p.since) p.since = x.since;
    p.tags.push(x);
  });
  return [...map.values()];
}
const RANK = { president: 0, bureau: 1, coach: 2, joueur: 3 };
function tagHtml(x, manage) {
  const lab = (x.kind === 'joueur' ? 'Joueur' : ROLES[x.role] + (x.assistant ? ' assistant' : '')) + (x.team_id ? ' ' + teamName(x.team_id) : '');
  if (manage && x.kind === 'membre' && x.role !== 'president') {
    const m = S.members.find((y) => y.id === x.ref);
    if (m && canValidate(m)) return `<button class="pill" data-act="mdel" data-id="${x.ref}" style="border:0;cursor:pointer;min-height:32px;${S.delPend === x.ref ? 'background:var(--absent);color:#fff' : ''}" aria-label="Retirer le profil ${esc(lab)}">${esc(lab)} ${S.delPend === x.ref ? '· confirmer le retrait' : '×'}</button>`;
  }
  return `<span class="pill">${esc(lab)}</span>`;
}
function personRow(p, manage) {
  const open = S.mAll || (S.mOpen || {})[p.key];
  const sub = p.tags.map((x) => x.kind === 'joueur' ? 'Joueur' : ROLES[x.role]).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return `<div class="row" style="flex-direction:column;align-items:stretch;gap:6px;cursor:default"><div style="display:flex;align-items:center;gap:8px"><button class="g" data-act="mrow" data-k="${esc(p.key)}" style="background:none;border:0;text-align:left;padding:0;cursor:pointer;min-height:44px" aria-expanded="${!!open}">${esc(p.name)}<small>${esc(sub)}${open ? '' : ' · ' + p.tags.length + ' profil' + (p.tags.length > 1 ? 's' : '')}</small></button>${p.player && (isBoard() || p.tags.some((x) => coachOf(x.team_id))) ? `<button class="btn small" data-act="player" data-id="${p.player}">Fiche</button>` : ''}</div>${open ? `<div class="chips" style="gap:6px">${p.tags.map((x) => tagHtml(x, manage)).join(' ')}</div>` : ''}</div>`;
}
export function membersBlock() {
  if (!S.roster) return '<p class="note">La liste des membres sera disponible après le script de l\'alpha 2.0.</p>';
  const board = isBoard(), coach = coachTeams().length > 0, mgmt = board || coach;
  let list = people(S.roster);
  if (!board && coach) list = list.filter((p) => p.tags.some((x) => coachOf(x.team_id) || ['president', 'bureau'].includes(x.role)));
  const q = norm(S.mq), f = S.mf || 'Tous', t = S.mt2 || '', sort = S.ms || 'nom';
  if (q) list = list.filter((p) => norm(p.name).includes(q) || norm((S.nicks || {})[p.user] || '').includes(q));
  if (f === 'Encadrement') list = list.filter((p) => p.tags.some((x) => ['president', 'bureau'].includes(x.role)));
  if (f === 'Coachs') list = list.filter((p) => p.tags.some((x) => x.role === 'coach'));
  if (f === 'Joueurs') list = list.filter((p) => p.tags.some((x) => x.kind === 'joueur'));
  if (t) list = list.filter((p) => p.tags.some((x) => x.team_id === t));
  list.sort(sort === 'arrivée' ? (a, b) => (a.since < b.since ? -1 : 1) : sort === 'rôle' ? (a, b) => Math.min(...a.tags.map((x) => RANK[x.role] ?? 9)) - Math.min(...b.tags.map((x) => RANK[x.role] ?? 9)) || a.last.localeCompare(b.last) : (a, b) => (a.last || a.first).localeCompare(b.last || b.first, 'fr') || a.first.localeCompare(b.first, 'fr'));
  let h = `<div class="kick">Membres (${people(S.roster).length})</div>`;
  h += `<div class="field"><label for="msq" class="sr">Rechercher</label><input id="msq" data-v2="mq" type="search" placeholder="Rechercher un prénom, un nom, un pseudo" value="${esc(S.mq || '')}"></div>`;
  if (mgmt) {
    h += `<div class="chips">${['Tous', 'Encadrement', 'Coachs', 'Joueurs'].map((x) => `<button class="chip" data-act="mf" data-v="${x}" aria-pressed="${f === x}">${x}</button>`).join('')}${board ? `<button class="chip" data-act="mpend" aria-pressed="${!!S.mpend}">Demandes en attente · ${toValidate().length}</button>` : ''}</div>
    <div class="grid2"><div class="field"><label for="mte">Équipe</label><select id="mte" data-v2="mt2"><option value="">Toutes</option>${S.teams.map((x) => `<option value="${x.id}" ${t === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label for="mso">Trier par</label><select id="mso" data-v2="ms">${['nom', 'arrivée', 'rôle'].map((x) => `<option ${sort === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <label class="check"><input type="checkbox" data-v2c="mAll" ${S.mAll ? 'checked' : ''}><span>Afficher les profils de chacun</span></label>`;
  }
  if (S.mpend && board) { const vp = toValidate(); return h + `<div class="card">${vp.length ? pendRows(vp) : '<p class="empty" style="margin:0">Aucune demande en attente.</p>'}</div>`; }
  h += `<div class="card">${list.length ? list.map((p) => personRow(p, mgmt)).join('') : '<p class="empty" style="margin:0">Personne ne correspond.</p>'}</div>`;
  if (board) {
    const fam = new Set(S.members.filter((m) => m.status === 'active' && ['parent', 'supporteur'].includes(m.role)).map((m) => m.user_id));
    const roleful = new Set(S.members.filter((m) => m.status === 'active' && !['parent', 'supporteur'].includes(m.role)).map((m) => m.user_id));
    h += `<p class="note">Familles et supporteurs (sans autre rôle) : ${[...fam].filter((u) => !roleful.has(u)).length}. Les parents apparaissent sur la fiche de leur enfant.</p>`;
  } else if (!mgmt) h += '<p class="note">Les autres membres apparaissent en « Prénom N. ».</p>';
  return h;
}
export function teamRoster(tid) {
  if (!S.roster) return '';
  const rows = S.roster.filter((x) => x.team_id === tid && (x.kind === 'joueur' || x.role === 'coach'));
  const ps = people(rows).sort((a, b) => (a.tags.some((x) => x.role === 'coach') ? -1 : 0) - (b.tags.some((x) => x.role === 'coach') ? -1 : 0) || a.first.localeCompare(b.first, 'fr'));
  return `<div class="kick">Effectif (${ps.length})</div><div class="card">${ps.length ? ps.map((p) => `<div class="row" style="cursor:default"><span class="g">${esc(p.name)}<small>${p.tags.map((x) => x.kind === 'joueur' ? 'Joueur' : 'Coach' + (x.assistant ? ' assistant' : '')).join(', ')}</small></span></div>`).join('') : '<p class="empty" style="margin:0">Personne pour l\'instant.</p>'}</div><p class="note">Effectif = joueurs et coachs. Les parents figurent sur la fiche de leur enfant.</p>`;
}
export function namesToCheck() {
  if (!isBoard()) return '';
  const bad = (S.players || []).filter((p) => !p.last_name || /\s/.test(p.first_name) || /\s/.test(p.last_name || ''));
  if (!bad.length) return '';
  return `<div class="kick">Noms à vérifier (${bad.length})</div><div class="card">${bad.map((p) => `<button class="row" data-act="player" data-id="${p.id}"><span class="g">${esc(p.first_name)} <b>|</b> ${esc(p.last_name || '—')}<small>Prénom | Nom découpés automatiquement : à corriger si besoin</small></span><span class="chev">›</span></button>`).join('')}</div>`;
}

// ---------- équipes (n° 2) ----------
export function teamsBlock() {
  const board = isBoard(), shown = S.teams.filter((t) => board || coachOf(t.id) || (t.state || 'Visible') === 'Visible');
  const count = (tid) => S.roster ? people(S.roster.filter((x) => x.team_id === tid && (x.kind === 'joueur' || x.role === 'coach'))).length : 0;
  let h = `<div class="kick">Équipes (${shown.length})</div><div class="card">${shown.length ? shown.map((t) => `<button class="row" data-act="team" data-id="${t.id}"><span class="g">${esc(t.name)}<small>${esc([t.category !== t.name ? t.category : '', t.gender, count(t.id) + ' joueurs et coachs'].filter(Boolean).join(' · '))}</small></span>${(t.state || 'Visible') !== 'Visible' ? `<span class="pill">${esc(t.state)}</span>` : ''}<span class="chev">›</span></button>`).join('') : '<p class="empty" style="margin:0">Aucune équipe.</p>'}</div>`;
  if (board) h += `<details class="card"><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">+ Créer une équipe</summary>${teamForm({}, 'teamnew')}</details>`;
  return h;
}
function teamForm(t, id) {
  const cat = t.category || '', gen = t.gender || '';
  return `<form id="${id}" data-id="${t.id || ''}" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"><div class="grid2"><div class="field"><label for="${id}c">Catégorie</label><select id="${id}c" name="category"><option value="">—</option>${BCATS.map((x) => `<option ${cat === x ? 'selected' : ''}>${x}</option>`).join('')}${cat && !BCATS.includes(cat) ? `<option selected>${esc(cat)}</option>` : ''}</select></div><div class="field"><label for="${id}g">Genre</label><select id="${id}g" name="gender"><option value="">—</option>${GENRES.map((x) => `<option ${gen === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div><div class="field"><label for="${id}n">Nom de l'équipe (proposé d'après la catégorie)</label><input id="${id}n" name="name" value="${esc(t.name || '')}" placeholder="Ex. U13 F, Reines"></div><div class="field"><label for="${id}s">Créneaux et gymnase</label><input id="${id}s" name="slots" value="${esc(t.slots || '')}" placeholder="Ex. Mercredi 14 h – 15 h 30, gymnase Jean-Moulin"></div><button class="btn main" type="submit">${t.id ? 'Enregistrer' : 'Créer l\'équipe'}</button></form>`;
}
export function teamPage(tid) {
  const t = team(tid); if (!t) return '<p class="empty">Équipe introuvable.</p>';
  const board = isBoard(), coach = coachOf(tid), pres = isPresident();
  const coaches = (S.roster || []).filter((x) => x.team_id === tid && x.role === 'coach');
  let h = `<h1>${esc(t.name)}</h1><div class="det">${esc([t.category, t.gender, 'saison ' + (t.season || '2026-2027')].filter(Boolean).join(' · '))}</div>${(t.state || 'Visible') !== 'Visible' ? `<span class="pill">${esc(t.state)}${t.state === 'Fantôme' ? ' : visible du bureau et des coachs seulement' : ''}</span>` : ''}`;
  h += `<div class="card"><div class="kick">Coachs</div>${coaches.length ? coaches.map((x) => `<div style="font-weight:700;margin-top:4px">${esc(x.first_name + ' ' + x.last_name)}${x.assistant ? ' · assistant' : ''}</div>`).join('') : '<p class="empty" style="margin:4px 0 0">Pas encore de coach.</p>'}<div class="kick" style="margin-top:10px">Créneaux et gymnase</div><div>${esc(t.slots || 'Non renseignés')}</div></div>`;
  const vp = toValidate().filter((m) => m.team_id === tid);
  if ((board || coach) && vp.length) h += `<div class="kick">Demandes à valider (${vp.length})</div><div class="card">${pendRows(vp)}</div>`;
  if (board || coach) {
    h += `<button class="btn main" data-act="import" data-id="${tid}">Ajouter des joueurs (un par un, liste, Excel)</button>`;
    h += `<details class="card"><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">${board ? 'Réglages de l\'équipe' : 'Créneaux de l\'équipe'}</summary>${board ? teamForm(t, 'teamedit') : `<form id="teamslots" data-id="${tid}" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"><div class="field"><label for="tsl">Créneaux et gymnase</label><input id="tsl" name="slots" value="${esc(t.slots || '')}"></div><button class="btn main" type="submit">Enregistrer</button></form>`}</details>`;
    const cands = (S.roster || []).filter((x) => x.user_id).reduce((a, x) => (a.some((y) => y.user_id === x.user_id) ? a : a.concat(x)), []);
    h += `<details class="card"><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">${board ? 'Nommer un coach ou un assistant' : 'Ajouter un coach assistant'}</summary><form id="coachf" data-id="${tid}" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"><div class="field"><label for="cfu">Membre du club</label><select id="cfu" name="user">${cands.map((x) => `<option value="${x.user_id}">${esc(x.first_name + ' ' + x.last_name)}</option>`).join('')}</select></div>${board ? '<label class="check"><input type="checkbox" name="assistant"><span>Coach assistant</span></label>' : '<input type="hidden" name="assistant" value="on">'}<button class="btn main" type="submit">Nommer</button><p class="note">La personne doit déjà être membre du club (elle a rejoint avec le code).</p></form></details>`;
  }
  if (board) {
    h += `<div class="chips">${t.state === 'Fantôme' ? `<button class="btn small" data-act="tstate" data-id="${tid}" data-v="Visible">Rendre visible</button>` : t.state === 'Visible' || !t.state ? `<button class="btn small" data-act="tstate" data-id="${tid}" data-v="Fantôme">Passer en mode fantôme</button>` : ''}${t.state !== 'Archivée' ? `<button class="btn small" data-act="trenew" data-id="${tid}">Archiver et reconduire pour 2027-2028</button>` : ''}</div>`;
  }
  if (pres) h += `<button class="btn danger" data-act="tdel" data-id="${tid}">${S.delPend === tid ? 'Confirmer la suppression de l\'équipe' : 'Supprimer l\'équipe'}</button>`;
  return h + teamRoster(tid);
}

// ---------- import de joueurs et doublons (n° 7, n° 8) ----------
function parseDate(s) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + +s * 864e5); return d.toISOString().slice(0, 10); }
  return '';
}
export function parseRows(table) {
  const rows = table.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const hd = rows[0].map((c) => norm(c)), find = (...k) => hd.findIndex((c) => k.some((x) => c.includes(x)));
  let iF = find('prenom', 'firstname'), iL = hd.findIndex((c, i) => i !== iF && (c === 'nom' || c.includes('lastname') || c.includes('nomdefamille') || (c.startsWith('nom') && !c.includes('prenom')))), iB = find('naissance', 'birth', 'nele', 'datedenaiss'), iLic = find('licence', 'license');
  let body = rows;
  if (iF >= 0 || iL >= 0) body = rows.slice(1); else { iF = 0; iL = rows[0].length > 1 ? 1 : -1; iB = rows[0].findIndex((c) => parseDate(c)); }
  return body.map((r) => {
    let first = iF >= 0 ? r[iF] : '', last = iL >= 0 ? r[iL] : '';
    if (iL < 0 && first.includes(' ')) { last = first.split(' ').slice(1).join(' '); first = first.split(' ')[0]; }
    return { first_name: niceFirst(first), last_name: niceLast(last), birth_date: iB >= 0 ? parseDate(r[iB]) : '', licence: iLic >= 0 ? r[iLic] : '' };
  }).filter((r) => r.first_name);
}
export function importPage(tid) {
  const I = S.imp || (S.imp = { tid, text: '', rows: null, matches: {} });
  let h = `<h1>Ajouter des joueurs</h1><div class="det">Équipe ${esc(teamName(tid))}</div>`;
  if (!I.rows) {
    h += `<div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label for="imt">Coller une liste (une ligne par joueur : Prénom, Nom, date de naissance, n° de licence)</label><textarea id="imt" data-v2="imptext" style="min-height:160px" placeholder="Prénom;Nom;Naissance;Licence&#10;Lily;Raveneau;12/03/2018;VT0012345">${esc(I.text)}</textarea></div>
    <div class="field"><label for="imf">Ou choisir un fichier Excel ou CSV</label><input id="imf" type="file" accept=".xlsx,.xls,.csv,text/csv" data-impfile="1"></div>
    <button class="btn main" data-act="impcheck">Vérifier la liste</button><p class="note">Rien n'est créé avant « Valider l'import ». Seuls le prénom et le nom sont obligatoires. Pour un seul joueur, écrivez simplement une ligne.</p></div>`;
    return h;
  }
  const M = I.matches;
  h += `<div class="card"><div class="kick">Vérification · ${I.rows.length} ligne${I.rows.length > 1 ? 's' : ''}</div>`;
  I.rows.forEach((r, i) => {
    const dups = M[i] || [], inFile = I.rows.findIndex((x, j) => j < i && norm(x.first_name) === norm(r.first_name) && norm(x.last_name) === norm(r.last_name)) >= 0;
    h += `<div style="border-bottom:1px solid var(--trait);padding:10px 0;display:flex;flex-direction:column;gap:6px${r.action === 'skip' ? ';opacity:.6' : ''}"><div class="grid2"><div class="field"><label for="ir${i}f">Prénom</label><input id="ir${i}f" data-imp="${i}" data-k="first_name" value="${esc(r.first_name)}"></div><div class="field"><label for="ir${i}l">Nom</label><input id="ir${i}l" data-imp="${i}" data-k="last_name" value="${esc(r.last_name)}"></div></div><div class="grid2"><div class="field"><label for="ir${i}b">Naissance</label><input id="ir${i}b" type="date" data-imp="${i}" data-k="birth_date" value="${esc(r.birth_date)}"></div><div class="field"><label for="ir${i}c">N° de licence</label><input id="ir${i}c" data-imp="${i}" data-k="licence" value="${esc(r.licence)}"></div></div>`;
    if (inFile) h += '<div class="pill ko">Doublon dans la liste elle-même</div>';
    if (dups.length) {
      const d = dups[0];
      h += `<div class="card" style="background:#FFF4D6;border-color:#E6C46A"><div style="font-weight:800">${d.kind === 'certain' ? 'Déjà dans le club' : 'Ressemble à'} : ${esc(d.label)} · ${esc(d.team_name)}</div><div class="field"><label for="ir${i}a">Que faire ?</label><select id="ir${i}a" data-impact="${i}"><option value="skip" ${r.action === 'skip' ? 'selected' : ''}>Garder l'existant (ne pas ajouter cette ligne)</option><option value="create" ${r.action === 'create' ? 'selected' : ''}>Garder les deux (ce sont deux personnes)</option><option value="complete" ${r.action === 'complete' ? 'selected' : ''}>Compléter la fiche existante</option>${d.same_team ? '' : `<option value="addteam" ${r.action === 'addteam' ? 'selected' : ''}>Ajouter aussi à l'équipe ${esc(teamName(tid))}</option>`}</select></div></div>`;
    }
    h += `<button class="btn small" data-act="impdel" data-i="${i}" style="align-self:flex-start">Retirer cette ligne</button></div>`;
  });
  return h + `</div><button class="btn main" data-act="impok">Valider l'import</button><button class="btn" data-act="impback">Modifier la liste collée</button>`;
}
async function checkImport() {
  const I = S.imp;
  if (!I.rows.length) { toast('Aucun joueur reconnu dans la liste.'); I.rows = null; return render(); }
  const r = await run(sb.rpc('match_players', { p_club: S.clubId, p_rows: I.rows.map((x) => ({ first_name: x.first_name, last_name: x.last_name, birth_date: x.birth_date || null, licence: x.licence || null, team_id: I.tid })) }));
  I.matches = {}; (r || []).forEach((m) => { (I.matches[m.idx] = I.matches[m.idx] || []).push(m); });
  I.rows.forEach((x, i) => {
    const inFile = I.rows.findIndex((y, j) => j < i && norm(y.first_name) === norm(x.first_name) && norm(y.last_name) === norm(x.last_name)) >= 0;
    x.action = I.matches[i] || inFile ? 'skip' : 'create'; x.existing = I.matches[i]?.[0]?.player_id || null;
  });
  render();
}

// ---------- tarifs (n° 6) ----------
export function feeFor(p) {
  const g = S.fees || [], t = team(p.team_id);
  return (g.find((x) => x.team_id && x.team_id === p.team_id) || g.find((x) => !x.team_id && t && x.category && x.category === (t.category || t.name)) || {}).amount ?? null;
}
export function feesBlock() {
  if (!isBoard() || !S.fees) return '';
  const g = S.fees;
  let h = `<details class="card"><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">Grille des tarifs 2026-2027 (${g.length})</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">`;
  h += g.map((x) => `<div class="row" style="cursor:default"><span class="g">${esc(x.team_id ? 'Équipe ' + teamName(x.team_id) : x.category || '—')}<small>${esc(x.amount)} €${x.fed_part != null ? ' dont ' + esc(x.fed_part) + ' € part fédération' : ''}</small></span><button class="btn small" data-act="feedel" data-id="${x.id}">Retirer</button></div>`).join('') || '<p class="empty" style="margin:0">Aucun tarif.</p>';
  h += `<form id="feef" style="display:flex;flex-direction:column;gap:8px"><div class="field"><label for="ffc">Pour</label><select id="ffc" name="target">${[...new Set(S.teams.map((t) => t.category || t.name).filter(Boolean).concat(BCATS))].map((c) => `<option value="cat:${esc(c)}">Catégorie ${esc(c)}</option>`).join('')}${S.teams.map((t) => `<option value="team:${t.id}">Équipe ${esc(t.name)} (tarif particulier)</option>`).join('')}</select></div><div class="grid2"><div class="field"><label for="ffa">Montant (€)</label><input id="ffa" name="amount" type="number" step="0.01" min="0" required inputmode="decimal"></div><div class="field"><label for="fff">dont part fédération (€, facultatif)</label><input id="fff" name="fed" type="number" step="0.01" min="0" inputmode="decimal"></div></div><button class="btn main" type="submit">Ajouter ce tarif</button></form>
  <button class="btn" data-act="feeapply">Appliquer la grille aux joueurs sans montant</button><p class="note">Le montant de chaque joueur reste modifiable sur sa fiche. Un joueur dans deux équipes paie le tarif de son équipe principale.</p></div></details>`;
  return h + `<button class="btn" data-act="xlsxlic">Exporter la liste pour le trésorier (Excel)</button>`;
}
function loadJs(u) { return new Promise((ok, ko) => { if (document.querySelector(`script[src="${u}"]`)) return ok(); const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = () => ko(new Error('Bibliothèque non chargée')); document.head.appendChild(s); }); }
function download(blob, fname) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
async function exportLicences() {
  try { await loadJs(XLSX_URL); } catch { return toast('Export impossible sans connexion.'); }
  const X = window.XLSX, c = (S.clubs[S.clubId]?.color1 || '#0B6B3A').replace('#', '').toUpperCase();
  const ad = (id) => (S.padmin || []).find((a) => a.player_id === id) || {}, di = (id) => (S.discounts || []).find((a) => a.player_id === id) || {};
  const rows = [['Mon Blason · ' + (S.clubs[S.clubId]?.name || '') + ' · licences et cotisations 2026-2027'], [], ['Équipe', 'Prénom', 'Nom', 'Naissance', 'Licence', 'N° de licence', 'Certificat', 'Montant dû (€)', 'Payé (€)', 'Reste (€)', 'Moyen', 'Réduction (€)', 'Motif']];
  (S.players || []).slice().sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)) || a.last_name.localeCompare(b.last_name)).forEach((p) => {
    const a = ad(p.id), d = di(p.id), due = a.fee_amount != null ? +a.fee_amount : null;
    rows.push([teamName(p.team_id), p.first_name, p.last_name, p.birth_date ? p.birth_date.split('-').reverse().join('/') : (p.birth_year || ''), a.licence_state || '', a.licence_number || '', a.health_doc ? 'fourni' : 'manquant', due ?? '', +a.fee_paid || 0, due != null ? Math.max(0, due - (+a.fee_paid || 0)) : '', a.fee_method || '', d.amount ? +d.amount : '', d.reason || '']);
  });
  const ws = X.utils.aoa_to_sheet(rows);
  ws.A1.s = { font: { bold: true, sz: 14, color: { rgb: c } } };
  'ABCDEFGHIJKLM'.split('').forEach((k) => { if (ws[k + '3']) ws[k + '3'].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: c } } }; });
  ws['!cols'] = [12, 14, 16, 12, 16, 16, 11, 14, 10, 10, 12, 13, 22].map((w) => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Licences et cotisations');
  download(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Mon-Blason-licences-cotisations.xlsx');
  toast('Fichier Excel prêt.');
}

// ---------- événements masqués (n° 4) et agenda du téléphone ----------
export const isHidden = (e) => (S.hidden || []).some((h) => h.event_id === e.id && new Date(h.hidden_at) >= new Date(e.updated_at || 0));
export function hideBtn(e, mine) {
  if (e.type === 'Entraînement' || mine !== 'non') return '';
  return isHidden(e) ? `<button class="btn small" data-act="unhide" data-id="${e.id}" style="margin-top:8px">Réafficher</button>` : `<button class="btn small" data-act="hide" data-id="${e.id}" style="margin-top:8px">Ne plus afficher</button>`;
}
function icsFor(e) {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const end = new Date(new Date(e.starts_at).getTime() + 90 * 6e4), clean = (s) => String(s || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, ' ');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mon Blason//FR', 'BEGIN:VEVENT', 'UID:' + e.id + '@monblason', 'DTSTAMP:' + f(Date.now()), 'DTSTART:' + f(e.starts_at), 'DTEND:' + f(end), 'SUMMARY:' + clean(e.title + ' · ' + (S.clubs[S.clubId]?.name || '')), 'LOCATION:' + clean(e.place), 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

// ---------- actions ----------
export const ACTIONS = {
  legal: () => { S.legalOpen = true; S.prevView = S.view; S.view = { type: 'legal' }; render(); },
  mrow: (el, d) => { S.mOpen = S.mOpen || {}; S.mOpen[d.k] = !S.mOpen[d.k]; render(true); },
  mf: (el, d) => { S.mf = d.v; S.mpend = false; render(true); },
  mpend: () => { S.mpend = !S.mpend; render(true); },
  team: (el, d) => { S.view = { type: 'team', id: d.id }; render(); },
  tstate: async (el, d) => { if (await run(sb.from('teams').update({ state: d.v }).eq('id', d.id), d.v === 'Visible' ? 'Équipe visible.' : 'Équipe en mode fantôme.')) await refresh(); },
  trenew: async (el, d) => { if (S.delPend !== 'rn' + d.id) { S.delPend = 'rn' + d.id; toast('Touchez encore pour confirmer : l\'équipe est archivée et recréée pour 2027-2028 avec ses coachs.'); return; } S.delPend = null; const n = await run(sb.rpc('renew_team', { p_team: d.id, p_season: '2027-2028' }), 'Équipe reconduite pour 2027-2028 (mode fantôme).'); if (n) { S.view = { type: 'team', id: n }; await refresh(); } },
  import: (el, d) => { S.imp = { tid: d.id, text: '', rows: null, matches: {} }; S.view = { type: 'import', id: d.id }; render(); },
  impcheck: async () => { const I = S.imp; I.rows = parseRows(I.text.split(/\r?\n/).map((l) => l.split(/\t|;|,(?!\d)/))); await checkImport(); },
  impdel: (el, d) => { S.imp.rows.splice(+d.i, 1); const M = {}; Object.keys(S.imp.matches).forEach((k) => { const n = +k > +d.i ? +k - 1 : +k; if (+k !== +d.i) M[n] = S.imp.matches[k]; }); S.imp.matches = M; render(true); },
  impback: () => { S.imp.rows = null; render(); },
  impok: async () => {
    const I = S.imp, rows = I.rows.map((r) => ({ first_name: niceFirst(r.first_name), last_name: niceLast(r.last_name), birth_date: r.birth_date || null, licence: r.licence || null, action: r.action || 'create', existing: r.existing || null }));
    if (rows.some((r) => !r.first_name || !r.last_name)) return toast('Chaque ligne doit avoir un prénom et un nom.');
    const n = await run(sb.rpc('import_players', { p_club: S.clubId, p_team: I.tid, p_rows: rows }));
    if (n !== null) { toast(n + ' joueur' + (n > 1 ? 's' : '') + ' ajouté' + (n > 1 ? 's' : '') + ' ou complété' + (n > 1 ? 's' : '') + '.'); S.imp = null; S.view = { type: 'team', id: I.tid }; await refresh(); }
  },
  feedel: async (el, d) => { if (await run(sb.from('fee_grid').delete().eq('id', d.id), 'Tarif retiré.')) await refresh(); },
  feeapply: async () => {
    const todo = (S.players || []).filter((p) => { const a = (S.padmin || []).find((x) => x.player_id === p.id); return (!a || a.fee_amount == null) && feeFor(p) != null; });
    if (!todo.length) return toast('Aucun joueur sans montant à qui appliquer un tarif.');
    if (await run(sb.from('player_admin').upsert(todo.map((p) => ({ player_id: p.id, fee_amount: feeFor(p), updated_by: S.me.id, updated_at: new Date().toISOString() }))), 'Tarif appliqué à ' + todo.length + ' joueur' + (todo.length > 1 ? 's' : '') + '.')) await refresh();
  },
  xlsxlic: () => exportLicences(),
  hide: async (el, d) => { if (await run(sb.from('event_hidden').upsert({ event_id: d.id, user_id: S.me.id, hidden_at: new Date().toISOString() }), 'Masqué. Votre réponse reste enregistrée ; filtre « Masqués » pour le retrouver.')) { S.hidden = (S.hidden || []).filter((h) => h.event_id !== d.id).concat({ event_id: d.id, hidden_at: new Date().toISOString() }); render(true); } },
  unhide: async (el, d) => { if (await run(sb.from('event_hidden').delete().eq('event_id', d.id).eq('user_id', S.me.id), 'Réaffiché.')) { S.hidden = (S.hidden || []).filter((h) => h.event_id !== d.id); render(true); } },
  ics: (el, d) => { const e = S.events.find((x) => x.id === d.id); download(new Blob([icsFor(e)], { type: 'text/calendar' }), 'mon-blason-' + e.starts_at.slice(0, 10) + '.ics'); toast('Ouvrez le fichier pour l\'ajouter à votre agenda.'); },
  palette: async (el, d) => { if (await run(sb.from('profiles').update({ palette: d.v }).eq('id', S.me.id))) { S.me.palette = d.v; render(true); } },
};
export const KEEP_DEL = ['trenew'];

// ---------- formulaires ----------
export const FORMS = {
  teamnew: async (v) => {
    const nm = (v.name || '').trim() || ((v.category || '').replace(' (baby)', '') + (v.gender && v.gender !== 'Mixte' ? ' ' + v.gender[0] : '')).trim();
    if (!nm) return toast('Choisissez une catégorie ou donnez un nom.');
    if (await run(sb.from('teams').insert({ club_id: S.clubId, name: nm, category: v.category || nm, gender: v.gender || '', slots: v.slots || '' }), 'Équipe créée.')) await refresh();
  },
  teamedit: async (v, f) => { if (await run(sb.from('teams').update({ name: (v.name || '').trim() || teamName(f.dataset.id), category: v.category || '', gender: v.gender || '', slots: v.slots || '' }).eq('id', f.dataset.id), 'Équipe enregistrée.')) await refresh(); },
  teamslots: async (v, f) => { if (await run(sb.from('teams').update({ slots: v.slots || '' }).eq('id', f.dataset.id), 'Créneaux enregistrés.')) await refresh(); },
  coachf: async (v, f) => { if (await run(sb.rpc('set_team_coach', { p_team: f.dataset.id, p_user: v.user, p_assistant: !!v.assistant }), 'Coach nommé.')) await refresh(); },
  feef: async (v) => {
    const [k, val] = v.target.split(/:(.*)/s);
    const row = { club_id: S.clubId, amount: +String(v.amount).replace(',', '.'), fed_part: v.fed ? +String(v.fed).replace(',', '.') : null, category: k === 'cat' ? val : null, team_id: k === 'team' ? val : null };
    if (await run(sb.from('fee_grid').insert(row), 'Tarif ajouté.')) await refresh();
  },
  cguf: async (v) => { if (await run(sb.rpc('accept_cgu', { p_version: CGU_VERSION, p_optin: !!v.optin }), 'Merci, conditions acceptées.')) await refresh(); },
};

// ---------- champs saisis ----------
export function onInput(t) {
  if (t.dataset.v2) { S[t.dataset.v2] = t.value; if (t.dataset.v2 !== 'imptext') { const pos = t.selectionStart; render(true); const n = document.getElementById(t.id); if (n && t.type === 'search') { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } } else S.imp.text = t.value; return true; }
  if (t.dataset.imp) { S.imp.rows[+t.dataset.imp][t.dataset.k] = t.value; return true; }
  return false;
}
export async function onChange(t) {
  if (t.dataset.v2c) { S[t.dataset.v2c] = t.checked; render(true); return true; }
  if (t.dataset.impact) { S.imp.rows[+t.dataset.impact].action = t.value; render(true); return true; }
  if (t.dataset.impfile && t.files?.[0]) {
    const file = t.files[0];
    try {
      let table;
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') table = (await file.text()).split(/\r?\n/).map((l) => l.split(/\t|;|,(?!\d)/));
      else { await loadJs(XLSX_URL); const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' }); table = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false }); }
      S.imp.rows = parseRows(table); await checkImport();
    } catch { toast('Fichier illisible. Essayez un fichier .xlsx ou .csv.'); }
    return true;
  }
  return false;
}
