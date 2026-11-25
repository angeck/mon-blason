// mypocketclub · bêta 1.8.0 « Contacts, prêts et fêtes » (Gaël, 25 novembre 2026 : 1.8.0 et 1.8.1 regroupées, site de test d'abord)
//   n° 298 : e-mail au président de l'autre club pour chaque prêt (état sur la fiche, « Réessayer » si le service d'e-mails refuse) ;
//            espace admin : « jour à 10 » d'un club (une fois par saison) et liste des e-mails de prêt (garde-fou).
//   n° 300 : encart de l'Accueil pour le coach qui n'a pas encore choisi ses coordonnées de convocation.
//   n° 296 : thème de fête du jour (chapeau sur les ballons, icône d'onglet), case « Appliquer le thème » d'un rendez-vous,
//            réglage de l'administrateur (case à cocher, thème, date de début et de fin).
// Chaque droit est vérifié par la base (supabase/beta_1_8_0.sql) ; l'écran n'est qu'un confort.
import { S, sb, esc, run, toast, render, ACTIONS, FORMS, hooks, coachTeams, plural } from './core.js';
import { icon, FETES, hatG, field } from './ui.js';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '');
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const parisToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ

// ---------------------------------------------------------------------
// N° 296 · thème de fête du jour
// ---------------------------------------------------------------------
const ICONS0 = [];
async function setFavicon(fete) {
  const links = [...document.querySelectorAll('link[rel="icon"]')];
  if (!ICONS0.length) links.forEach((l) => ICONS0.push(l.cloneNode()));
  if (!fete) { if (links.some((l) => l.dataset.fete)) { links.forEach((l) => l.remove()); ICONS0.forEach((l) => document.head.appendChild(l.cloneNode())); } return; }
  try {
    const txt = await (await fetch('img/ballon-mypocketclub-etoile.svg')).text();
    const inner = txt.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -24 80 80">${inner}${hatG(fete, null)}</svg>`;
    links.forEach((l) => l.remove());
    const l = document.createElement('link'); l.rel = 'icon'; l.type = 'image/svg+xml'; l.dataset.fete = fete;
    l.href = 'data:image/svg+xml,' + encodeURIComponent(svg); document.head.appendChild(l);
  } catch { /* l'icône d'origine reste */ }
}
let feteAt = 0;
export async function loadB180() {
  if (!S.session) return;
  if (Date.now() - feteAt > 10 * 60e3) { // relu au plus toutes les 10 minutes
    feteAt = Date.now();
    const { data, error } = await sb.rpc('active_theme');
    const f = !error && FETES[data] ? data : null;
    if (f !== S.fete) { S.fete = f; document.documentElement.dataset.fete = f || ''; setFavicon(f); }
  }
  // n° 300 : état du contact de convocation d'un coach (encart de l'Accueil, étape « Pour bien démarrer »)
  if (S.clubId && coachTeams().length && (!S.cc || S.cc.club !== S.clubId)) {
    S.cc = { club: S.clubId, v: null };
    const { data } = await sb.rpc('my_coach_contact', { p_club: S.clubId });
    if (S.cc?.club === S.clubId) S.cc.v = data || {};
  }
}
// Case du formulaire de rendez-vous (tous les créateurs, seulement quand un thème est actif ; un rendez-vous déjà thématisé la garde)
hooks.themeField = (f) => {
  const cur = f.theme || (f.id ? (S.events.find((x) => x.id === f.id)?.theme || null) : null), fete = S.fete || null;
  if (!fete && !cur) return '';
  const k = cur && cur !== fete ? cur : fete, on = f.evtheme ?? !!cur;
  return `<label class="check fetebox"><input type="checkbox" name="evtheme" ${on ? 'checked' : ''}><span><b>Appliquer le thème ${esc(FETES[k].label)}</b> : la carte du rendez-vous prend les couleurs de la fête${cur && cur !== fete ? ' (thème terminé : décocher l’enlève pour de bon)' : ''}.</span></label>`;
};
hooks.themeOf = (f, checked) => { const cur = f.id ? (S.events.find((x) => x.id === f.id)?.theme || null) : null; return checked ? (cur || S.fete || null) : null; };
hooks.evThemeClass = (e) => (e?.theme && FETES[e.theme] ? ' th-' + e.theme : '');

// ---------------------------------------------------------------------
// N° 300 · encart de l'Accueil : le coach choisit ce que les convocations montrent de lui
// ---------------------------------------------------------------------
hooks.coachContactHome = () => {
  const v = S.cc?.club === S.clubId ? S.cc.v : null;
  if (!v || v.answered || !coachTeams().length) return '';
  return `<div class="card yellow"><span class="kick" style="color:var(--pc-texte-ecran)">Convocations des matchs</span><b style="font-family:var(--pc-titre);font-size:22px;line-height:1.1">Choisis ce que les clubs reçus voient de toi</b><p style="margin:0">Une seule fois, pour toutes les convocations : téléphone, SMS, e-mail, ou rien.</p><div class="btns"><button class="btn main small" data-act="ccgo">Choisir</button></div></div>`;
};
ACTIONS.ccgo = () => { if (S.view?.type === 'convoc' && S.convoc) { S.convRet = { eid: S.convoc.eid, step: S.convoc.step }; S.convoc.reload = true; } S.view = { type: 'account' }; render(); setTimeout(() => document.getElementById('ccard')?.scrollIntoView({ block: 'start' }), 80); };

// ---------------------------------------------------------------------
// N° 298 · e-mail du prêt au président de l'autre club
// ---------------------------------------------------------------------
const MAILST = { a_envoyer: 'E-mail au président : pas encore parti', reserve: 'E-mail au président : envoi en cours', envoye: 'E-mail envoyé au président', echec: 'E-mail au président : refusé par le service d’e-mails', bloque: 'E-mail impossible : cette adresse a refusé les e-mails de mypocketclub' };
hooks.loanMailLine = (l) => {
  if (!l.mail_status) return '';
  const st = S.loanMailing === l.id ? 'reserve' : l.mail_status, ok = st === 'envoye';
  const who = l.pres_name ? ` (${esc(l.pres_name)})` : '';
  const retry = ['a_envoyer', 'echec'].includes(st) || (st === 'reserve' && S.loanMailing !== l.id && l.mail_at && Date.now() - new Date(l.mail_at) > 2 * 60e3);
  return `<div class="loanmail ${ok ? 'ok' : 'wait'}"><span>${icon(ok ? 'check' : 'mail', 18)} ${esc(MAILST[st] || '')}${who}${ok && l.mail_at ? ' · ' + esc(day(l.mail_at)) : ''}</span>${st === 'echec' && l.mail_error ? `<small>${esc(l.mail_error)}</small>` : ''}${l.mail_note ? `<small>${esc(l.mail_note)}</small>` : ''}${retry ? `<button class="btn small ghost" data-act="loanmail" data-id="${esc(l.id)}">${st === 'a_envoyer' ? 'Envoyer l’e-mail' : 'Réessayer'}</button>` : ''}</div>`;
};
hooks.loanMailSend = async (id, auto) => {
  if (S.loanMailing) return; S.loanMailing = id; render(true);
  let why = '', ok = false;
  try {
    const { data, error } = await sb.functions.invoke('envoyer-email', { body: { loan_mail: { loan: id } } });
    if (error) { try { why = (await error.context?.json?.())?.erreur || ''; } catch { why = ''; } }
    ok = !error && !!data?.envoye;
  } catch { why = 'réseau indisponible'; }
  S.loanMailing = null;
  // n° 298 : le coach voit le résultat à l'écran (Gaël, 25 novembre : « refus visible »)
  if (ok) toast('E-mail envoyé au président de l’autre club.');
  else toast((auto ? 'Prêt enregistré, mais l’e-mail n’est pas parti' : 'E-mail pas parti') + (why ? ' : ' + why : '.') , 6000);
  S.loansClub = null; // relit l'état des prêts (fiche du joueur)
  const { data } = await sb.rpc('club_loans', { p_club: S.clubId });
  S.loans = Array.isArray(data) ? data : S.loans; S.loansClub = S.clubId;
  if (!ok && why) { const l = (S.loans || []).find((x) => x.id === id); if (l && !l.mail_error) l.mail_note = why; }
  render(true);
};
ACTIONS.loanmail = (el, d) => hooks.loanMailSend(d.id, false);

// ---------------------------------------------------------------------
// Espace admin : thème de fête, jour à 10, e-mails de prêt
// ---------------------------------------------------------------------
const ADM = { theme: null, mails: null, days: {} };
const admRpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) { toast(error.message || 'Refusé.'); return undefined; } return data; };
hooks.admThemeCard = () => {
  if (ADM.theme === null) { ADM.theme = false; admRpc('admin_theme_get').then((d) => { ADM.theme = d || {}; render(true); }); admRpc('admin_loan_mails').then((d) => { ADM.mails = d || []; render(true); }); }
  const t = ADM.theme || {}, today = parisToday();
  const opts = Object.entries(FETES).map(([k, v]) => `<option value="${k}" ${t.theme === k ? 'selected' : ''}>${esc(v.label.charAt(0).toUpperCase() + v.label.slice(1))}</option>`).join('');
  const state = t.active ? `Actif aujourd’hui : ${esc(FETES[t.active]?.label || t.active)}` : t.enabled ? `Programmé du ${esc(day(t.starts_on))} au ${esc(day(t.ends_on))}` : 'Aucun thème';
  let h = `<div class="sec"><h2>Thème de fête</h2><span class="det">${state}</span></div><form class="card" id="admthemef">
    <label class="check"><input type="checkbox" name="enabled" ${t.enabled ? 'checked' : ''}><span><b>Activer un thème spécial</b> : chapeau sur les ballons, icône de l’onglet, case « Appliquer le thème » à la création d’un rendez-vous.</span></label>
    ${field('admtht', 'Thème', `<select id="admtht" name="theme"><option value="">Choisir</option>${opts}</select>`)}
    <div class="grid2">${field('admths', 'Début', `<input id="admths" type="date" name="start" value="${esc(t.starts_on || today)}">`)}${field('admthe', 'Fin', `<input id="admthe" type="date" name="end" value="${esc(t.ends_on || '')}">`)}</div>
    <p class="note" style="margin:0">Le thème s’éteint tout seul après la date de fin. Un rendez-vous coché garde ses couleurs. Le blason des clubs ne change jamais.</p>
    <button class="btn main" type="submit">${icon('check', 20)}Enregistrer le thème</button></form>`;
  const M = ADM.mails;
  h += `<div class="sec"><h2>E-mails de prêt</h2><span class="det">30 derniers jours</span></div><section class="card">${!M ? '<p class="empty">Chargement…</p>' : !M.length ? '<p class="empty">Aucun e-mail de prêt.</p>' : `<div class="list">${M.map((m) => `<div class="row static" style="min-height:44px"><span class="g">${esc(m.club)} → ${esc(m.other)}<small>${esc(day(m.at))} à ${esc(hm(m.at))} · ${esc({ envoye: 'envoyé', echec: 'échec', reserve: 'en cours', a_envoyer: 'pas parti', bloque: 'liste noire' }[m.status] || m.status)}${m.mpc ? ' · club sur mypocketclub' : m.email ? ' · ' + esc(m.email) : ''}</small></span></div>`).join('')}</div>`}<p class="note">Un e-mail par prêt, 1 par jour et par club (10 le jour que tu accordes, dans la fiche du club). L’adresse saisie est effacée à la fin du prêt.</p></section>`;
  return h;
};
FORMS.admthemef = async (v) => {
  const on = !!v.enabled;
  if (on && !v.theme) return toast('Choisis un thème.');
  if (on && (!v.start || !v.end)) return toast('Choisis la date de début et la date de fin.');
  const r = await admRpc('admin_theme_set', { p_enabled: on, p_theme: v.theme || null, p_start: v.start || null, p_end: v.end || null });
  if (r === undefined) return;
  toast(on ? 'Thème enregistré.' : 'Thème coupé.');
  ADM.theme = (await admRpc('admin_theme_get')) || {}; feteAt = 0; await loadB180(); render();
};
hooks.admLoanDayCard = (c) => {
  if (!c?.id) return '';
  if (!(c.id in ADM.days)) { ADM.days[c.id] = undefined; admRpc('admin_loan_day_get', { p_club: c.id }).then((d) => { ADM.days[c.id] = d || null; render(true); }); }
  const d = ADM.days[c.id], today = parisToday();
  const used = d && d.day < today, set = d && d.day >= today;
  return `<div class="sec"><h2>E-mails de prêt</h2><span class="det">1 par jour</span></div><form class="card" id="admloandayf" data-club="${esc(c.id)}">
    <p class="note" style="margin:0;color:var(--pc-texte-ecran)">${d === undefined ? 'Chargement…' : used ? `Jour à 10 déjà utilisé cette saison (${esc(day(d.day))}).` : set ? `Jour à 10 accordé : ${esc(day(d.day))}.` : 'Un jour à 10 e-mails de prêt peut être accordé une fois par saison (début de saison).'}</p>
    ${used ? '' : `${field('admld', 'Jour à 10 e-mails', `<input id="admld" type="date" name="day" min="${today}" value="${esc(set ? d.day : today)}">`)}<button class="btn" type="submit">${icon('check', 20)}${set ? 'Changer le jour' : 'Accorder ce jour'}</button>`}</form>`;
};
FORMS.admloandayf = async (v, form) => {
  const club = form?.dataset?.club || document.getElementById('admloandayf')?.dataset.club; if (!club || !v.day) return toast('Choisis un jour.');
  const r = await admRpc('admin_loan_day', { p_club: club, p_day: v.day });
  if (r === undefined) return;
  toast('Jour à 10 accordé.'); ADM.days[club] = r; render(true);
};
hooks.loadB180 = loadB180;
export { plural };
