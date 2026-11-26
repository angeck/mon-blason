// mypocketclub · alpha 3.4 · convocations inter-clubs (document de référence : claude/09-convocations-inter-clubs.md)
// Le club qui reçoit envoie aux clubs reçus un document commun pour le week-end : pré-convocation (étape 1 sur 2,
// sans gymnase ni horaire) puis convocation (étape 2 sur 2, avec gymnase, adresse, date et heure).
// Réservé à la rubrique Événements (coordinateur, vice-président, président) ; la base le vérifie (convocation_data).
import { BRAND } from '../config.js';
import { showDoc } from './docview.js'; // bêta 1.5.1 · n° 285
import { S, sb, esc, run, toast, render, ACTIONS, CHANGES, hooks, hasArea, onColor, contrast, catGender } from './core.js';
import { header, icon, crest, ballSrc } from './ui.js';
import { VIE_VIEWS } from './vie.js';
import { sendCard, loadSends, sendsSummary } from './v42.js'; // n° 112, 109, 107

const MATCHY = ['Match', 'Plateau', 'Tournoi'];
// bêta 1.7.0 · n° 295 : le coach choisit ce qu'il partage (rien par défaut) ; sans partage, on renvoie au correspondant des rencontres
function coachCell(x, sep) {
  const k = x.coach; if (!k) return '—';
  const bits = [k.phone ? esc(k.phone) + (k.sms_only ? ' (SMS)' : '') : '', k.email ? esc(k.email) : ''].filter(Boolean);
  return esc(k.name) + sep + (bits.length ? '<small>' + bits.join(' · ') + '</small>' : '<small>contact : correspondant des rencontres</small>');
}
export const canConvoke = (e) => !!e && MATCHY.includes(e.type) && e.at_home !== false && e.audience === 'team' && hasArea('evenements');

// Encadré sur la page d'un match à domicile
export function convocBlock(e) {
  if (!canConvoke(e)) return '';
  return `<div class="card flat"><div class="kick">Convocation des clubs reçus</div><p class="note">Un seul document pour toutes les rencontres à domicile du week-end, à envoyer aux clubs reçus.</p>
  <div class="btns"><button class="btn small ghost" data-act="convoc" data-id="${e.id}" data-v="P">${icon('doc', 18)}Pré-convocation</button><button class="btn small main" data-act="convoc" data-id="${e.id}" data-v="C">${icon('doc', 18)}Convocation</button></div>${sendsSummary(e.id)}</div>`;
}

const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
const ballSvg = (px, sport) => `<img src="${abs(ballSrc(sport))}" width="${px}" height="${px}" alt="" style="vertical-align:-0.1em">`;
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateOf = (s) => new Date(s + 'T12:00:00');
const paris = (iso) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
const dayLong = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const hhmm = (iso) => { const d = paris(iso); return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0'); };
export function weekendLabel(from, to) {
  const a = dateOf(from), b = dateOf(to);
  if (from === to) return `${dayLong(a)} ${a.getFullYear()}`;
  return a.getMonth() === b.getMonth() ? `${a.getDate()} et ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}` : `${a.getDate()} ${MONTHS[a.getMonth()]} et ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}
// N° 127 (décision de Gaël, 5 novembre 2026) : samedi ou dimanche → « Week-end du 14 et 15 novembre 2026 » ;
// du lundi au vendredi → « Cette semaine · jeudi 5 novembre 2026 » si c'est la semaine où le document est fait (lundi à dimanche,
// heure de Paris), sinon « Jeudi 12 novembre 2026 ». Même règle dans la fonction serveur envoyer-email (whenPhrase).
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export function periodOf(from, to, now = new Date()) {
  const a = dateOf(from), dw = a.getDay(), when = weekendLabel(from, to);
  if (from !== to || dw === 0 || dw === 6) return { weekend: true, label: `Week-end du ${when}`, receive: 'vous reçoit ce week-end', phrase: `le week-end du ${when}` };
  const today = paris(now.toISOString()), monday = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).toDateString();
  const same = monday(a) === monday(today);
  return { weekend: false, same, label: same ? `Cette semaine · ${when}` : cap(when), receive: same ? 'vous reçoit cette semaine' : `vous reçoit le ${dayLong(a)}`, phrase: same ? `cette semaine, le ${when}` : `le ${when}` };
}
export function reference(clubName, from, step) {
  const ini = String(clubName || 'PC').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3) || 'PC';
  return `${ini}-${from.replace(/-/g, '')}-${step}`;
}
// Teinte claire de la couleur principale (90 % de blanc)
const tint = (hex) => { const n = parseInt(hex.slice(1), 16), m = (v) => Math.round(v + (255 - v) * 0.9); return '#' + [m(n >> 16), m((n >> 8) & 255), m(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join(''); };
// N° 109 : catégorie et genre (« U9 F ») dans les documents envoyés aux autres clubs, jamais le nom interne de l'équipe (« Les Reines »)
const catOf = (x) => catGender(x.team) || x.team?.name || x.title;
// N° 109 · point 4 : nom affiché de l'expéditeur de l'e-mail = nom du club (réglé par le président) + catégories et genres du document.
// Même règle que la fonction serveur envoyer-email (senderName) ; l'adresse reste notifications@mypocketclub.fr.
export function mailSender(d) {
  const cats = [...new Set((d.events || []).filter((x) => !x.cancelled).map((x) => catGender(x.team)).filter(Boolean))];
  return [String(d.club?.name || '').trim(), cats.join(', ')].filter(Boolean).join(' ').replace(/["<>\r\n]/g, '').slice(0, 70) || 'mypocketclub';
}
const competition = (x) => (x.type === 'Match' ? 'Match' : x.type);

// 5.13.0 · n° 234 : le nom, le prénom et l'e-mail du contact sont obligatoires (PDF et e-mail bloqués tant qu'il en manque un)
export function contactMissing(d) {
  const k = d.correspondent, m = [];
  if (!k) return ['le contact rencontres : le président le choisit dans Espace › Président › Fonctions'];
  if (String(k.name || '').trim().split(/\s+/).filter(Boolean).length < 2) m.push('le nom et le prénom du contact (Mon compte › Mon profil)');
  if (!String(k.email || '').trim()) m.push('l’e-mail du contact : il le montre dans Mon compte › « Mes coordonnées de contact » (case « Mon adresse e-mail »)');
  return m;
}
// Ce qui manque avant l'envoi (le contact complet et, à l'étape 2, le gymnase bloquent le PDF et l'envoi ; le reste n'est qu'un avertissement)
export function missing(d, step) {
  const m = [], live = d.events.filter((x) => !x.cancelled);
  if (!d.club.logo) m.push('le logo du club (onglet Club → Blason)');
  m.push(...contactMissing(d));
  live.filter((x) => !x.coach).forEach((x) => m.push(`le coach de ${catOf(x)}`));
  live.filter((x) => !x.opponents).forEach((x) => m.push(`le club reçu pour ${catOf(x)} (champ Adversaire du rendez-vous)`));
  if (step === 'C') live.filter((x) => !String(x.place || '').trim()).forEach((x) => m.push(`le gymnase de ${catOf(x)}`));
  return m;
}
// bêta 1.8.0 · n° 300 : coachs des rencontres qui n'ont pas encore choisi leurs coordonnées (une seule fois, pour toutes les convocations).
// bêta 1.8.2 · n° 306 : ils ne bloquent plus rien : la demande part toute seule (une relance 24 h après), et en attendant la convocation
// renvoie au correspondant des rencontres (repli provisoire, définitif si le coach répond « rien »).
export const coachPending = (d) => [...new Map((d.events || []).filter((x) => !x.cancelled && x.coach && x.coach.answered === false).map((x) => [x.coach.id || x.coach.name, x])).values()];
export const noPlace = (d) => d.events.filter((x) => !x.cancelled && !String(x.place || '').trim());
export const blocking = (d, step) => (step === 'C' && noPlace(d).length > 0) || contactMissing(d).length > 0;

// Le document A4 (HTML imprimé en PDF par le téléphone ou l'ordinateur)
export function convocHtml(d, step, now = new Date(), o = {}) {
  // n° 112 : version (-v2 « Mise à jour ») et sans impression automatique pour la lecture d'une convocation reçue
  const ver = o.version || 1, upd = ver > 1;
  const c = d.club, c1 = c.color1 || '#2F5BFF', c2 = c.color2 || '#FFC93C', txt = onColor(c1), soft = tint(c1), ref = reference(c.name, d.from, step) + (upd ? '-v' + ver : '');
  const k = d.correspondent, when = weekendLabel(d.from, d.to), pre = step === 'P', per = periodOf(d.from, d.to, now);
  // n° 92 : le blason du club tel qu'il est dans l'application (même fonction crest, mêmes réglages) ;
  // n° 97 : sans logo, le ballon du sport du club (ou le ballon de la marque mypocketclub, étoile creuse, pour un autre sport : n° 106)
  const logo = c.logo ? `<span class="lg">${crest(c, 58, c1)}</span>` : `<span class="lg"><img src="${abs(ballSrc(c.sport))}" width="62" height="62" alt=""></span>`;
  const corr = k ? [esc(k.name), k.phone ? esc(k.phone) : '', k.email ? esc(k.email) : ''].filter(Boolean).join(' · ') : '';
  const strike = (x, s) => (x.cancelled ? `<s>${s}</s>` : s);
  const status = (x) => (x.cancelled ? '<span class="st">Annulée</span>' : '');
  let body;
  if (pre) {
    body = `<h2>${esc(per.label)}</h2><h1>${esc(c.name)} ${esc(per.receive)}</h1>
    <p>Nous avons le plaisir de vous confirmer les rencontres suivantes à domicile. Le gymnase et les horaires vous seront communiqués dans la convocation définitive.</p>
    <table><thead><tr><th>Catégorie</th><th>Club(s) reçu(s) · compétition</th><th>Coach de l'équipe</th><th>Horaire</th></tr></thead><tbody>
    ${d.events.map((x) => `<tr><td><b>${strike(x, esc(catOf(x)))}</b></td><td>${strike(x, esc(x.opponents || '—'))}<br><small>${esc(competition(x))}</small> ${status(x)}</td><td>${coachCell(x, '<br>')}</td><td>À venir</td></tr>`).join('')}</tbody></table>
    <div class="box"><b>Empêchement ou report ?</b> Merci de prévenir au plus vite le coach de l'équipe, le contact du club et le comité.</div>
    <p class="note"><b>À noter :</b> la convocation définitive, avec le gymnase et l'horaire de chaque rencontre, suivra.</p>`;
  } else {
    body = `<h2>Convocation officielle</h2><h1>Matchs du ${esc(when)}</h1><p>${esc(c.name)} aura le plaisir de vous accueillir aux dates et lieux suivants.</p>
    <div class="cards">${d.events.map((x) => `<div class="cv${x.cancelled ? ' off' : ''}"><div class="cvl"><span class="cat">${esc(catOf(x))}</span><b>${strike(x, esc(c.name) + ' – ' + esc(x.opponents || '—'))}</b> ${status(x)}
      <div class="sm">${esc(competition(x))}${x.place ? ' · ' + esc(x.place) : ''}</div>
      <div class="sm">Coach : ${coachCell(x, ' · ')}</div></div>
      <div class="cvr"><div class="sm">${esc(dayLong(paris(x.starts_at)))}</div><div class="hr">${hhmm(x.starts_at)}</div></div></div>`).join('')}</div>
    <div class="box"><b>Merci de vous présenter 30 minutes avant la rencontre.</b> En cas d'empêchement, prévenez au plus vite le coach de l'équipe, le contact du club et le comité.</div>`;
  }
  const head = contrast(c1, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#11162E';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${pre ? 'Pré-convocation' : 'Convocation'} ${esc(c.name)} ${esc(when)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:wght@400;500;700&display=swap">
<style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',Arial,sans-serif;color:#11162E;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;display:flex;flex-direction:column}
.hd{background:${c1};color:${head};padding:14mm 14mm 8mm;display:flex;gap:14px;align-items:center}.lg{display:flex;align-items:center;justify-content:center;flex:none}.lg .ecu{display:flex;align-items:center;justify-content:center}
.hd .nm{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:22px;line-height:1.1}.hd .co{font-size:11.5px;opacity:.92;margin-top:3px}.tag{margin-left:auto;border:1.5px solid ${head};border-radius:20px;padding:5px 12px;font-weight:700;font-size:11px;white-space:nowrap}
.lis{height:8px;background:${c2}}.ct{padding:9mm 14mm;flex:1}h2{margin:0;font-size:13px;color:${c1};text-transform:uppercase;letter-spacing:.06em}h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:26px;margin:4px 0 10px;line-height:1.1}
table{border-collapse:collapse;width:100%;margin:12px 0}th{color:${c1};text-align:left;font-size:11px;text-transform:uppercase;border-bottom:2px solid ${c1};padding:6px}td{border-bottom:1px solid ${soft};padding:8px 6px;vertical-align:top}small,.sm{color:#4A5068;font-size:11.5px}
.box{background:${soft};border-left:4px solid ${c1};padding:10px 12px;border-radius:6px;margin:14px 0}.note{margin-top:10px}.st{display:inline-block;align-self:flex-start;background:#FFE1DA;color:#A52A12;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700}
.cards{display:flex;flex-direction:column;gap:10px;margin:12px 0}.cv{display:flex;gap:12px;border:1px solid #D8DCEA;border-radius:12px;padding:12px;page-break-inside:avoid}.cv.off{opacity:.65}.cvl{flex:1;display:flex;flex-direction:column;gap:3px}.cvr{text-align:right;flex:none}
.cat{align-self:flex-start;background:${c2};color:${onColor(c2)};border-radius:10px;padding:2px 10px;font-weight:700;font-size:11px}.hr{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:30px;color:${c1}}
.sig{margin-top:18px}.ft{background:#F7F8FC;border-top:1px solid #D8DCEA;padding:5mm 14mm;display:flex;align-items:center;gap:12px;font-size:10.5px;color:#4A5068}.wm{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:16px;letter-spacing:-.04em;color:#11162E;white-space:nowrap}.wm .my{display:inline-block;background:#FFC93C;color:#11162E;border-radius:.2em;padding:0 .09em .12em;letter-spacing:-.03em;transform:rotate(-5deg);margin-right:.07em}.wm .cl{color:#2F5BFF}.ft .r{margin-left:auto;text-align:right}
@media screen{body{background:#E9ECF5}.page{margin:12px auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.12)}}</style></head><body><div class="page">
<div class="hd">${logo}<div><div class="nm">${esc(c.name)}</div>${corr ? `<div class="co">Contact : ${corr}</div>` : ''}</div><span class="tag">${pre ? 'Pré-convocation · Étape 1 sur 2' : 'Convocation · Étape 2 sur 2'}${upd ? ' · Mise à jour' : ''}</span></div><div class="lis"></div>
<div class="ct">${body}<p class="sig">Sportivement,<br><b>${k ? esc(k.name) : '…………'}</b>, contact de ${esc(c.name)}</p></div>
<div class="ft"><span class="wm" role="img" aria-label="${esc(BRAND.aria)}"><span class="my">my</span>p${ballSvg(13, c.sport)}cket<span class="cl">club</span></span><span>Convocation créée et générée avec ${esc(BRAND.name)}</span><span class="r">Émise le ${now.toLocaleDateString('fr-FR')}<br>Réf. ${esc(ref)}</span></div>
</div>${o.print === false ? '' : '<script>document.fonts&&document.fonts.ready.then(function(){setTimeout(function(){print()},300)})</script>'}</body></html>`;
}

hooks.convocBlock = convocBlock;

// ---------- écran d'aperçu ----------
function convocScreen() {
  const v = S.convoc; if (!v?.data) return '<p class="empty">Chargement…</p>';
  const d = v.data, step = v.step, miss = missing(d, step), block = blocking(d, step);
  let h = `<div class="card lift"><div class="chips"><button class="chip" data-act="convstep" data-v="P" aria-pressed="${step === 'P'}">Pré-convocation</button><button class="chip" data-act="convstep" data-v="C" aria-pressed="${step === 'C'}">Convocation</button></div>
  <b style="font-family:var(--pc-titre);font-size:22px">${step === 'P' ? 'Étape 1 sur 2 · sans gymnase ni horaire' : 'Étape 2 sur 2 · gymnase, date et heure'}</b>
  <div class="det">${esc(periodOf(d.from, d.to).label)} · ${d.events.length} rencontre${d.events.length > 1 ? 's' : ''} à domicile · réf. ${esc(reference(d.club.name, d.from, step))}</div></div>`;
  h += `<div class="card"><div class="list">${d.events.map((x) => `<div class="row static"><span class="g">${esc(catOf(x))} · ${esc(x.opponents || 'club reçu à préciser')}<small>${esc(dayLong(paris(x.starts_at)))} à ${hhmm(x.starts_at)}${x.place ? ' · ' + esc(x.place) : ''}${x.coach ? ' · coach ' + esc(x.coach.name) : ''}</small></span>${x.cancelled ? '<span class="pill ko">Annulée</span>' : ''}</div>`).join('') || '<p class="empty">Aucune rencontre à domicile ce week-end.</p>'}</div></div>`;
  const cm = contactMissing(d);
  if (miss.length) h += `<div class="card warn"><b>${block ? 'À compléter avant l’envoi et le PDF :' : 'À compléter avant l’envoi (le document reste possible) :'}</b><ul style="margin:6px 0 0 18px;padding:0">${miss.map((m) => (m.startsWith('le gymnase de ') ? `<li><button type="button" class="linkbtn" data-act="convgymfocus">${esc(m)} : compléter ›</button></li>` : `<li>${esc(m)}</li>`)).join('')}</ul>${d.correspondent && cm.length ? `<div class="btns" style="margin-top:10px"><button type="button" class="btn small main" data-act="convfill">Aller les compléter</button><button type="button" class="btn small ghost" data-act="convrefresh">Actualiser</button></div><p class="note">Le contact complète ses coordonnées dans Mon compte, puis revient ici avec le bouton « Revenir à la convocation ».</p>` : ''}</div>`; // 5.13.0 · n° 234
  if (step === 'C') h += gymCard(d); // bêta 1.8.2 · n° 304, 305
  h += coachAskCard(d); // bêta 1.8.0 · n° 300 ; 1.8.2 · n° 306 (information seulement)
  // N° 109, 112 : chercher le club reçu (envoi dans mypocketclub), sinon e-mail avec le PDF joint ; suivi des envois du week-end
  h += sendCard(d, step);
  return h;
}
// bêta 1.8.0 · n° 299 : après un passage par Mon compte (ou un retour par la flèche), la convocation relit les coordonnées dans la base,
// sans rafraîchir la page ; le bouton « Actualiser » fait de même à la demande.
async function reloadConvoc() {
  const v = S.convoc; if (!v || v.loading) return;
  v.loading = true; v.reload = false;
  try { const { data, error } = await sb.rpc('convocation_data', { p_event: v.eid }); if (!error && data && S.convoc === v) { v.data = data; await loadSends(v.eid); } }
  finally { v.loading = false; if (S.convoc === v && S.view?.type === 'convoc') render(true); }
}
const stamp = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
// bêta 1.8.2 · n° 306 : le coach est prévenu tout seul (une demande, puis une seule relance 24 h après) ; rien ne bloque.
// Plus de bouton « Notifier le coach » ni de case « sans les coordonnées du coach » (décision de Gaël, 26 novembre).
function coachAskCard(d) {
  const P = coachPending(d); if (!P.length) return '';
  const st = (k) => (k.asks >= 2 ? `Demande envoyée le ${stamp(k.asked_at)}, relancé une fois` : k.asked_at ? `Demande envoyée le ${stamp(k.asked_at)} · une relance partira 24 h après` : 'Demande envoyée dès qu’un autre que lui prépare la convocation');
  return `<div class="card flat coachask"><div class="kick">Coordonnées du coach</div><p class="note" style="margin:0">En attendant sa réponse, la convocation indique « contact : correspondant des rencontres ». Le coach choisit lui-même dans Mon compte ; s’il choisit « rien », ça reste ainsi.</p>
  <div class="list">${P.map((x) => `<div class="row static"><span class="g">${esc(x.coach.name)} · ${esc(catOf(x))}<small>${esc(st(x.coach))}</small></span></div>`).join('')}</div>
  <div class="btns"><button type="button" class="btn small ghost" data-act="convrefresh">Actualiser</button></div></div>`;
}
// bêta 1.8.2 · n° 304, 305 : compléter le gymnase des rencontres sans lieu, depuis la convocation (étape 2).
// Plusieurs gymnases : liste déroulante ; aucun (ou « Autre lieu ») : saisie à la main. Le président peut ajouter le lieu à la liste
// du club ; les autres peuvent demander au président d'ajouter les gymnases. La base vérifie chaque droit (set_event_place).
function gymCard(d) {
  const L = noPlace(d); if (!L.length) return '';
  const v = S.convoc, gyms = d.gyms || [], pres = !!d.president, man = v.manual || {};
  const gp = (g) => [String(g.name || '').trim(), String(g.address || '').trim()].filter(Boolean).join(', ');
  const row = (x) => {
    const own = gyms.length && !man[x.id];
    const sel = gyms.length ? `<select data-convgym="${x.id}" aria-label="Gymnase de ${esc(catOf(x))}"><option value="">Choisir le gymnase…</option>${gyms.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join('')}<option value="autre" ${man[x.id] ? 'selected' : ''}>Autre lieu (écrire l’adresse)</option></select>` : '';
    const form = own ? '' : `<div class="stack" style="margin-top:8px"><input id="cvn-${x.id}" maxlength="80" placeholder="Nom du lieu (ex. Gymnase du Parc)" aria-label="Nom du lieu"><input id="cva-${x.id}" maxlength="200" placeholder="Numéro, rue, code postal, ville" aria-label="Adresse du lieu" autocomplete="street-address">
      ${pres ? `<label class="check"><input type="checkbox" id="cvs-${x.id}" checked><span>Ajouter à la liste des gymnases du club</span></label>` : ''}
      <div class="btns"><button type="button" class="btn small main" data-act="convplace" data-id="${x.id}">${icon('check', 18)}Enregistrer le lieu</button></div></div>`;
    return `<div class="gymrow" data-gym="${x.id}"><b>${esc(catOf(x))} · ${esc(x.opponents || 'club reçu à préciser')}</b><small class="det">${esc(dayLong(paris(x.starts_at)))} à ${hhmm(x.starts_at)}</small>${sel}${form}</div>`;
  };
  let h = `<div class="card gymcard" id="convgym"><div class="kick">Gymnase des rencontres</div>${L.map(row).join('')}`;
  if (pres) h += `<div class="btns"><button type="button" class="btn small ghost" data-act="gymgo">${icon('pin', 18)}${gyms.length ? 'Gérer les gymnases du club' : 'Ajouter les gymnases du club'}</button></div>`;
  else if (!gyms.length) h += `<p class="note">Aucun gymnase enregistré dans le club : écris le lieu, ou demande au président de les ajouter (le lieu se remplira tout seul ensuite).</p>
    <div class="btns"><button type="button" class="btn small ghost" data-act="convgymask">${icon('bell', 18)}Demander au président d’ajouter les gymnases</button></div>${d.gym_asked_at ? `<p class="note">Président prévenu le ${esc(stamp(d.gym_asked_at))}.</p>` : ''}`;
  return h + '</div>';
}
VIE_VIEWS.convoc = () => { if (S.convoc?.reload) setTimeout(reloadConvoc, 0); return { head: header({ back: true, kicker: 'Convocation', title: S.convoc?.step === 'P' ? 'Pré-convocation' : 'Convocation' }), body: convocScreen() }; };

export async function openConvoc(eid, step) {
  S.convRet = null;
  S.convoc = { eid, step: step || 'P', data: null }; S.view = { type: 'convoc', id: eid }; render();
  const d = await run(sb.rpc('convocation_data', { p_event: eid }));
  if (!d) { S.view = { type: 'event', id: eid }; render(); return; }
  S.convoc.data = d; await loadSends(eid); render(true);
  // bêta 1.8.2 · n° 306 : la demande part toute seule aux coachs du week-end jamais demandés (pas de doublon : la base le vérifie)
  if (coachPending(d).some((x) => !x.coach.asked_at)) { const { data: n } = await sb.rpc('convocation_ask_coaches', { p_event: eid }); if (n > 0 && S.convoc?.eid === eid) reloadConvoc(); }
}
// bêta 1.8.2 · n° 304 : choix d'un gymnase de la liste (ou « Autre lieu » : saisie à la main)
CHANGES.push(async (t) => {
  const eid = t.dataset.convgym; if (!eid || !S.convoc?.data) return false;
  const v = S.convoc; v.manual = v.manual || {};
  if (t.value === 'autre') { v.manual[eid] = true; render(true); return true; }
  const g = (v.data.gyms || [])[+t.value]; if (!g || t.value === '') return true;
  if (await run(sb.rpc('set_event_place', { p_event: eid, p_name: g.name, p_address: g.address || '' }), 'Gymnase enregistré sur la rencontre.')) { delete v.manual[eid]; await reloadConvoc(); }
  return true;
});
Object.assign(ACTIONS, {
  convoc: (el, d) => openConvoc(d.id, d.v),
  // 5.13.0 · n° 234 : aller compléter les coordonnées du contact (Mon compte), puis revenir à la convocation en cours
  convrefresh: () => reloadConvoc(),
  // bêta 1.8.2 · n° 304, 305 : gymnase des rencontres
  convgymfocus: () => { const c = document.getElementById('convgym'); c?.scrollIntoView({ block: 'center', behavior: 'smooth' }); c?.querySelector('select,input')?.focus({ preventScroll: true }); },
  convplace: async (el, d) => {
    const v = S.convoc; if (!v) return;
    const n = document.getElementById('cvn-' + d.id)?.value.trim() || '', a = document.getElementById('cva-' + d.id)?.value.trim() || '', save = !!document.getElementById('cvs-' + d.id)?.checked;
    if (!n && !a) return toast('Écris le nom ou l’adresse du lieu.');
    if (save && !n) return toast('Donne un nom au gymnase pour l’ajouter à la liste du club.');
    if (await run(sb.rpc('set_event_place', { p_event: d.id, p_name: n, p_address: a, p_save: save }), save ? 'Lieu enregistré et ajouté aux gymnases du club.' : 'Lieu enregistré sur la rencontre.')) { if (v.manual) delete v.manual[d.id]; S.gymsClub = null; await reloadConvoc(); }
  },
  convgymask: async () => { const v = S.convoc; if (!v) return; if (await run(sb.rpc('gyms_ask_president', { p_event: v.eid }), 'Président prévenu par notification.')) reloadConvoc(); },
  convfill: () => { const v = S.convoc; if (!v) return; v.reload = true; S.convRet = { eid: v.eid, step: v.step }; S.view = { type: 'account' }; render(); setTimeout(() => document.getElementById('contactf')?.scrollIntoView({ block: 'start' }), 60); },
  convback: () => { const r = S.convRet; S.convRet = null; if (!r) return; S.stack = (S.stack || []).filter((x) => x.type !== 'convoc'); S.noStack = true; return openConvoc(r.eid, r.step); },
  convstep: async (el, d) => { S.convoc.step = d.v; S.convoc.version = 0; if (S.convoc.send) S.convoc.send.confirm = false; render(true); await loadSends(S.convoc.eid); render(true); },
  convpdf: () => {
    const v = S.convoc; if (!v?.data || blocking(v.data, v.step)) return;
    showDoc(convocHtml(v.data, v.step, new Date(), { version: v.version || 1, print: false }), { title: 'Convocation' }); // bêta 1.5.1 · n° 285 : dans l'appli
  },
});
