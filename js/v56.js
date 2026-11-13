// mypocketclub · alpha 5.6.0 · n° 202 : compte administrateur, v1 pour la bêta (maquette https://claude.ai/artifact/GsSnKxT5cdMKoTAnwbnEEv).
// Un compte administrateur sans club (admin@) arrive directement dans l'espace admin, sans l'accueil des clubs.
// Un compte administrateur qui a aussi un club l'ouvre depuis Mon compte › « Ouvrir l'espace admin ».
// Double vérification : la base n'accepte une action d'administration qu'avec une session confirmée par un code à 6 chiffres
// (application d'authentification ; « aal2 » de Supabase, vérifié par is_app_admin() dans supabase/alpha_5_6_0.sql).
// Onglets : Accueil · Clubs (Liste, Abonnements, fiche d'un club) · À traiter · Entretien. Les devis et les e-mails viendront après la bêta.
import { BRAND, VERSION } from '../config.js';
import { S, sb, esc, run, toast, render, refresh, hooks, ACTIONS, FORMS, INPUTS, armed, isArmed, plural, fmtDay } from './core.js';
import { header, crest, icon, field } from './ui.js';
import { V37_TOP } from './v37.js';
import { mailTestBlock } from './v38.js';
import { adminsButton } from './v46.js';

const A = () => (S.adm = S.adm || {});
const arr = (x) => (Array.isArray(x) ? x : null);
const euros = (c) => (c == null ? '—' : (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const day = (iso) => (iso ? fmtDay(String(iso).length === 10 ? iso + 'T12:00:00' : iso) : '');
const today = () => new Date().toLocaleDateString('sv-SE');
const REASON = { paye: 'Payé', devis: 'Devis accepté', gratuite: 'Gratuité', test: 'Test' };
const STATUS = { test: 'Test', gratuit: 'Gratuit', payant: 'Payant' };
const TABS = [['home', 'Accueil', 'home'], ['clubs', 'Clubs', 'shield'], ['todo', 'À traiter', 'flag'], ['tools', 'Entretien', 'refresh']];
const NEED_SCRIPT = 'La base n’est pas encore à jour : lance le script MAJ_ALPHA_5_6_0.sql dans Supabase.';

// ---------- chargements (chaque appel est refusé par la base sans la double vérification) ----------
async function rpc(name, args) {
  let r; try { r = await sb.rpc(name, args); } catch (e) { r = { error: e }; }
  if (r.error) { A().err = /function|fonction|schema cache/i.test(r.error.message || '') ? NEED_SCRIPT : (r.error.message || 'Erreur'); return null; }
  return r.data;
}
async function load(tab) {
  const a = A(); a.err = null;
  if (tab === 'home') a.ov = (await rpc('admin_overview')) || a.ov || null;
  // 5.10.0 · n° 161 : solde de l'IA (sans message d'erreur si le script 5.10.0 n'est pas encore lancé)
  if (tab === 'home') { try { const r = await sb.rpc('admin_ai_stats'); a.ai = r.error ? (/function|fonction|schema cache/i.test(r.error.message || '') ? { missing: true } : null) : r.data; } catch { a.ai = null; } }
  if (tab === 'clubs' || tab === 'todo' || tab === 'club') a.clubs = arr(await rpc('admin_club_list')) || a.clubs || [];
  if (tab === 'todo') {
    const [rep, dup, ov] = await Promise.all([rpc('admin_reports'), rpc('duplicates_list'), rpc('admin_overview')]);
    a.reports = arr(rep) || []; a.dups = (arr(dup) || []).filter((d) => d.can_decide && d.status === 'signale'); if (ov) a.ov = ov;
  }
  if (tab === 'tools') { const [pv, lg] = await Promise.all([rpc('admin_purge_preview'), rpc('admin_log_list')]); a.preview = arr(pv) || []; a.log = arr(lg) || []; }
}
const open = async (tab) => { S.admTab = tab; render(true); await load(tab); render(true); };

// ---------- aiguillage (app.js) ----------
// Sans club, ou en « mode admin » : l'espace admin ; compte administrateur sans le code : l'écran de la double vérification
export function adminLanding() {
  if (S.admOff) return '';
  if (S.adminAcct && !S.isAdmin && !S.clubId) return mfaScreen(false);
  if (S.isAdmin && !S.clubId) { if (!S.admLoaded) { S.admLoaded = true; S.admTab = S.admTab || 'home'; load(S.admTab).then(() => render(true)); } return space(false); }
  return '';
}
hooks.adminLanding = adminLanding;

// ---------- l'espace admin ----------
function nav() {
  const t = S.admTab || 'home', ov = A().ov || {}, todo = (+ov.to_validate || 0) + (+ov.club_requests || 0) + (+ov.schemas || 0) + (+ov.duplicates || 0) + (+ov.reports || 0);
  return `<div class="tb admtb"><nav aria-label="Onglets admin">${TABS.map(([k, l, ic]) => {
    const cur = k === t, n = k === 'todo' ? todo : 0;
    return `<button data-act="admtab" data-k="${k}" ${cur ? 'aria-current="page"' : ''}><span class="ic">${icon(ic, 24, 'currentColor', cur ? 2.2 : 2)}</span><span>${l}</span>${n ? `<span class="n">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
  }).join('')}</nav></div>`;
}
function space(asView) {
  const t = S.admTab || 'home', a = A();
  const titles = { home: 'Bonjour ' + esc(S.me?.first_name || ''), clubs: 'Clubs', todo: 'À traiter', tools: 'Entretien' };
  const head = header({ brand: true, back: asView, kicker: 'Administration', title: titles[t] });
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  const body = { home: homeTab, clubs: clubsTab, todo: todoTab, tools: toolsTab }[t]();
  return head + `<main class="bd adm">${a.err ? `<div class="card alert" role="alert"><b>${esc(a.err)}</b></div>` : ''}${body}</main>` + nav();
}

// ---------- Accueil ----------
function homeTab() {
  const ov = A().ov; if (!ov) return '<p class="empty">Chargement…</p>';
  const n = (k) => +ov[k] || 0;
  const rows = [['Présidents à valider', n('to_validate'), 'admgo', 'clubs:aval'], ['Signalements transmis', n('reports'), 'admtab', 'todo'], ['Doublons d’exercices publics', n('duplicates'), 'admtab', 'todo'],
    ['Demandes de clubs', n('club_requests'), 'creqs', ''], ['Demandes de schéma', n('schemas'), 'cschemas', '']];
  const total = rows.reduce((s, r) => s + r[1], 0);
  const todo = `<section class="card yellow" style="transform:none"><div style="display:flex;justify-content:space-between;align-items:center"><h3>À traiter</h3><span class="pill" style="background:var(--pc-encre);color:#fff">${total}</span></div>
    <div class="list">${rows.map(([l, k, act, arg]) => `<button class="row" data-act="${act}" ${act === 'admtab' ? `data-k="${arg}"` : act === 'admgo' ? `data-k="${arg}"` : ''}><span class="g">${l}</span><b>${k}</b></button>`).join('')}</div></section>`;
  const parc = `<section class="card"><div class="kick">Le parc</div><div class="admnums">${[['clubs', 'clubs'], ['accounts', 'comptes'], ['players', 'joueurs'], ['active7', 'actifs 7 j']].map(([k, l]) => `<div><div class="big">${n(k)}</div><div class="det">${l}</div></div>`).join('')}</div></section>`;
  const subs = `<section class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="kick">Abonnements</div><button class="btn link" data-act="admgo" data-k="clubs:subs">Voir</button></div>
    <div class="admnums three">${[['sub_test', 'en test'], ['sub_free', 'gratuits'], ['sub_paid', 'payants']].map(([k, l]) => `<div><div class="big">${n(k)}</div><div class="det">${l}</div></div>`).join('')}</div>
    <div class="row static"><span class="g">Montant prévu (clubs payants)</span><b>${euros(n('due_cents'))}</b></div></section>`;
  const purge = `<section class="card" style="flex-direction:row;align-items:center;gap:12px"><span class="g" style="flex:1;display:flex;flex-direction:column"><b>Suppressions automatiques</b><span class="det">${ov.last_purge ? 'Dernier passage le ' + esc(day(ov.last_purge)) : 'Jamais lancées depuis cet écran'}</span></span><button class="btn small ghost" data-act="admtab" data-k="tools">Voir</button></section>`;
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `<p class="note">${esc(date.charAt(0).toUpperCase() + date.slice(1))} · ${esc(VERSION)}</p>${todo}${aiCard()}${parc}${subs}${purge}${S.clubId ? '' : '<p class="note">Ce compte n’a pas de club : il n’ouvre que l’administration.</p>'}`;
}

// ---------- 5.10.0 · n° 161 : IA des exercices (estimation de l'application ; le chiffre exact est dans la Console Claude) ----------
const usd = (v, d = 2) => (+v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '\u00a0$';
const CONSOLE = 'https://platform.claude.com/';
function aiCard() {
  const x = A().ai; if (!x) return '';
  if (x.missing) return '<section class="card"><div class="kick">IA · exercices</div><p class="note">Lance le script MAJ_ALPHA_5_10_0.sql dans Supabase pour suivre le solde.</p></section>';
  const bal = +x.balance || 0, low = bal <= (+x.alert_usd || 0), avg = +x.count_total ? (+x.spent_total) / (+x.count_total) : 0, open = !!A().aiOpen;
  let h = `<section class="card ${bal <= 0 || low ? 'warn' : ''}"><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="kick">IA · exercices</div>${x.enabled ? '' : '<span class="pill ko">En pause</span>'}</div>
  <div class="row static"><span class="g"><b>Solde restant</b><small>crédit acheté ${usd(x.credit)} − dépensé ${usd(x.spent_total)}</small></span><b class="big" style="font-size:26px">${usd(bal)}</b></div>
  ${bal <= 0 ? '<p role="alert"><b>Solde épuisé : les coachs ne peuvent plus préparer de schéma avec l’IA.</b> Rachète du crédit dans la Console, puis note l’achat ici.</p>' : low ? `<p role="alert"><b>Solde bas (sous ${usd(x.alert_usd)}).</b> Pense à racheter du crédit dans la Console.</p>` : ''}
  <div class="admnums" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[[usd(x.spent_month), 'ce mois-ci'], [usd(x.spent_total), 'au total'], [String(+x.count_total || 0), 'schémas'], [usd(avg, 3), 'par schéma']].map(([v, l]) => `<div><div class="big" style="font-size:20px">${esc(v)}</div><div class="det">${l}</div></div>`).join('')}</div>
  ${+x.fails ? `<p class="note">${plural(+x.fails, 'réponse')} de l’IA inutilisable${+x.fails > 1 ? 's' : ''} (coût compté).</p>` : ''}
  <p class="note">Estimation de l’application. Le chiffre exact est dans la <a href="${CONSOLE}" target="_blank" rel="noopener">Console Claude</a>, avec sa limite de dépense mensuelle.</p>
  <button class="btn small ghost" data-act="admai">${open ? 'Fermer' : 'Noter un achat · réglages'}</button>`;
  if (open) {
    h += `<form id="admaicred" class="card" style="margin-top:8px"><b>Noter un achat de crédit</b><div class="grid2">${field('aiam', 'Montant ($)', '<input id="aiam" name="amount" type="number" min="0.01" max="1000" step="0.01" required inputmode="decimal">')}${field('aino', 'Note (facultatif)', '<input id="aino" name="note" maxlength="200" placeholder="Ex. achat du 13/11">')}</div><button class="btn main small" type="submit">Ajouter au crédit</button></form>
    <form id="admaiset" class="card"><b>Réglages</b><label class="check"><input type="checkbox" name="enabled" ${x.enabled ? 'checked' : ''}><span>Création avec l’IA ouverte aux coachs</span></label>
    <div class="grid2">${field('aial', 'Alerte sous ($)', `<input id="aial" name="alert" type="number" min="0" step="0.5" value="${esc(x.alert_usd)}">`)}${field('aicap', 'Budget par club et par saison ($)', `<input id="aicap" name="cap" type="number" min="0" step="0.5" value="${esc(x.club_cap_usd)}">`)}${field('aipd', 'Schémas par jour et par compte', `<input id="aipd" name="per_day" type="number" min="1" max="200" value="${esc(x.per_day)}">`)}</div>
    <p class="note">Le budget par club vaut pour les clubs en test et gratuits (environ 10 € pour 11 $). Un club payant a 10 % de son abonnement estimé, jamais moins.</p><button class="btn main small" type="submit">Enregistrer les réglages</button></form>`;
    if ((x.credits || []).length) h += `<div class="kick">Derniers achats</div><div class="list">${x.credits.map((c) => `<div class="row static"><span class="g">${esc(day(c.at))}${c.note ? `<small>${esc(c.note)}</small>` : ''}</span><b>${usd(c.amount)}</b></div>`).join('')}</div>`;
    if ((x.clubs || []).length) h += `<div class="kick">Clubs cette saison</div><div class="list">${x.clubs.map((c) => `<div class="row static"><span class="g">${esc(c.name)}<small>${plural(+c.n, 'schéma')} · budget ${usd(c.cap)}</small></span><b>${usd(c.spent, 3)}</b></div>`).join('')}</div>`;
  }
  return h + '</section>';
}
ACTIONS.admai = () => { A().aiOpen = !A().aiOpen; render(true); };
FORMS.admaicred = async (v) => {
  const n = +String(v.amount || '').replace(',', '.'); if (!(n > 0 && n <= 1000)) return toast('Montant entre 0,01 et 1 000 $.');
  if (await run(sb.rpc('admin_ai_credit', { p_amount: n, p_note: (v.note || '').trim() }), `Achat de ${usd(n)} noté.`)) { await load('home'); render(true); }
};
FORMS.admaiset = async (v) => {
  const num = (x) => (x === '' || x == null ? null : +String(x).replace(',', '.'));
  if (await run(sb.rpc('admin_ai_settings', { p_enabled: !!v.enabled, p_alert: num(v.alert), p_cap: num(v.cap), p_per_day: num(v.per_day) }), 'Réglages de l’IA enregistrés.')) { await load('home'); render(true); }
};

// ---------- Clubs ----------
const isTrash = (c) => !!c.deleted_at;
const toValidate = (c) => !isTrash(c) && c.president_id && !c.reason;
const validated = (c) => !isTrash(c) && !!c.reason;
const FILTERS = [['all', 'Tous', (c) => !isTrash(c)], ['aval', 'À valider', toValidate], ['ok', 'Validés', validated], ['trash', 'Corbeille', isTrash]];
function statusPill(c) {
  if (isTrash(c)) return '<span class="pill">Corbeille</span>';
  if (!c.president_id) return '<span class="pill">Sans président</span>';
  if (!c.reason) { const left = c.valid_by ? Math.ceil((new Date(c.valid_by) - Date.now()) / 864e5) : null; return `<span class="pill ko">À valider${left != null ? ' · J-' + Math.max(0, left) : ''}</span>`; }
  const over = c.ends_at && c.ends_at <= today();
  return `<span class="pill ${over ? 'wait' : 'ok'}">${over ? 'Période finie' : 'Validé'} · ${esc(REASON[c.reason] || c.reason)}</span>`;
}
const subLine = (c) => (c.status === 'payant' ? `Payant · ${c.paying} × ${euros(c.rate_cents)} = ${euros(c.due_cents)}` : c.status === 'gratuit' ? 'Gratuit' : 'Test') + (c.engaged_to ? ' · jusqu’au ' + day(c.engaged_to) : '');
const crestOf = (c) => crest({ name: c.name, logo: c.logo, crest_bg: c.crest_bg, color1: c.color1 }, 34, '#FFFFFF');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function clubsTab() {
  const a = A(), l = a.clubs; if (!l) return '<p class="empty">Chargement…</p>';
  const sub = S.admSub || 'list';
  let h = `<div class="seg" role="group" aria-label="Vue"><button data-act="admsub" data-k="list" aria-pressed="${sub === 'list'}">Liste</button><button data-act="admsub" data-k="subs" aria-pressed="${sub === 'subs'}">Abonnements</button></div>`;
  if (sub === 'subs') {
    const live = l.filter((c) => !isTrash(c)), paid = live.filter((c) => c.status === 'payant');
    h += `<section class="card"><div class="admnums three">${[['test', 'en test'], ['gratuit', 'gratuits'], ['payant', 'payants']].map(([k, t]) => `<div><div class="big">${live.filter((c) => c.status === k).length}</div><div class="det">${t}</div></div>`).join('')}</div>
      <div class="row static"><span class="g">Montant prévu<small>${plural(paid.reduce((s, c) => s + (+c.paying || 0), 0), 'joueur facturé', 'joueurs facturés')}</small></span><b>${euros(paid.reduce((s, c) => s + (+c.due_cents || 0), 0))}</b></div>
      <p class="note">Le président voit son statut et son montant (Le club › Abonnement). Les paiements et relances viendront avec les devis, après la bêta.</p></section>`;
    return h + `<section class="card"><div class="list">${live.map((c) => `<button class="row" data-act="admclub" data-id="${esc(c.id)}">${crestOf(c)}<span class="g">${esc(c.name)}<small>${esc(subLine(c))}</small></span><span class="pill ${c.status === 'payant' ? 'ok' : 'blue'}">${STATUS[c.status] || 'Test'}</span></button>`).join('') || '<p class="empty">Aucun club.</p>'}</div></section>`;
  }
  const f = FILTERS.find((x) => x[0] === S.admF) || FILTERS[0], q = norm(S.admQ);
  const list = l.filter(f[2]).filter((c) => !q || norm([c.name, c.city, c.sport, c.president_name, c.president_email].join(' ')).includes(q));
  h += `<div class="field"><label for="admq">Chercher un club, une ville, un président</label><input id="admq" type="search" data-admq="1" value="${esc(S.admQ || '')}" autocomplete="off"></div>
    <div class="chips">${FILTERS.map(([k, t, fn]) => `<button class="chip" data-act="admf" data-k="${k}" aria-pressed="${k === f[0]}">${t} · ${l.filter(fn).length}</button>`).join('')}</div>`;
  h += `<section class="card"><div class="list">${list.map((c) => `<button class="row" data-act="admclub" data-id="${esc(c.id)}">${crestOf(c)}<span class="g">${esc(c.name)}<small>${esc([c.sport, c.city].filter(Boolean).join(' · '))} · ${plural(+c.teams || 0, 'équipe')} · ${plural(+c.players || 0, 'joueur')}</small><small>${esc(c.president_name || 'Sans président')}${c.president_email ? ' · ' + esc(c.president_email) : ''}</small></span>${statusPill(c)}</button>`).join('') || '<p class="empty">Aucun club.</p>'}</div></section>`;
  return h + `<p class="note"><b>Validé</b> : le président envoie ses convocations par e-mail (motif : test, gratuité, devis accepté ou payé). <b>À valider</b> : corbeille au bout de 30 jours, rappel par e-mail 7 jours avant.</p>`;
}

// Fiche d'un club
function clubScreen(id) {
  const head = (t) => header({ brand: true, back: true, kicker: 'Administration · club', title: t });
  if (!S.isAdmin) return head('Club') + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  const c = (A().clubs || []).find((x) => x.id === id);
  if (!c) return head('Club') + `<main class="bd"><p class="empty">${A().clubs ? 'Club introuvable.' : 'Chargement…'}</p></main>`;
  let h = `<p class="note">${esc([c.sport, c.city].filter(Boolean).join(' · '))} · créé le ${esc(day(c.created_at))} · ${plural(+c.teams || 0, 'équipe')} · ${plural(+c.players || 0, 'joueur')} · ${plural(+c.members || 0, 'membre')}</p>`;
  if (isTrash(c)) h += `<div class="card alert"><b>Dans la corbeille depuis le ${esc(day(c.deleted_at))}</b><span class="note" style="color:var(--pc-texte-ecran)">Effacé 90 jours après. Le président peut le restaurer depuis l’application.</span></div>`;
  else if (toValidate(c)) h += `<div class="card alert"><b>Président pas encore validé</b><span class="note" style="color:var(--pc-texte-ecran)">${c.valid_by ? 'Corbeille le ' + esc(day(c.valid_by)) + ' · rappel par e-mail 7 jours avant.' : 'Pas de date limite.'}</span><div class="btns"><button class="btn small ghost" data-act="admext" data-id="${esc(c.id)}">Prolonger de 30 jours</button></div></div>`;
  h += `<div class="sec"><h2>Président</h2></div><div class="card">${c.president_id ? `<div class="row static"><span class="g">${esc(c.president_name || 'Sans nom')}<small>${esc(c.president_email || 'e-mail inconnu')}</small></span>${c.president_email ? `<a class="btn small ghost" href="mailto:${esc(c.president_email)}">${icon('mail', 18)}Écrire</a>` : ''}</div>` : '<p class="empty">Aucun président actif : rien à valider.</p>'}</div>`;
  if (c.president_id && !isTrash(c)) {
    h += `<div class="sec"><h2>${c.reason ? 'Validation' : 'Valider le président'}</h2></div><form class="card" id="admvalf" data-club="${esc(c.id)}" data-user="${esc(c.president_id)}">
      ${c.reason ? `<div class="chips">${statusPill(c)}${c.validated_at ? `<span class="pill">depuis le ${esc(day(c.validated_at))}</span>` : ''}</div>` : ''}
      <div class="grid2">${field('admvr', 'Motif', `<select id="admvr" name="reason">${Object.entries(REASON).map(([k, v]) => `<option value="${k}" ${(c.reason || 'test') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field('admve', 'Fin de validation', `<input id="admve" type="date" name="ends" value="${esc(c.ends_at || '')}">`)}</div>
      ${field('admvn', 'Note (pour toi seul)', `<input id="admvn" name="note" maxlength="300" value="${esc(c.vnote || '')}" placeholder="Ex. : appel du président le 14 novembre">`)}
      <div class="btns"><button class="btn main" type="submit">${icon('check', 20)}${c.reason ? 'Enregistrer' : 'Valider le président'}</button>${c.reason ? `<button class="btn ghost ${isArmed('admvno' + c.id) ? 'danger armed' : ''}" type="button" data-act="admvno" data-id="${esc(c.id)}" data-user="${esc(c.president_id)}">${isArmed('admvno' + c.id) ? 'Confirmer : retirer' : 'Retirer la validation'}</button>` : ''}</div></form>`;
  }
  h += `<div class="sec"><h2>Abonnement</h2><span class="det">${esc(STATUS[c.status] || 'Test')}</span></div><form class="card" id="admsubf" data-club="${esc(c.id)}">
    <div class="grid2">${field('admss', 'Statut', `<select id="admss" name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field('admsr', 'Prix par joueur et par an (€)', `<input id="admsr" name="rate" inputmode="decimal" value="${c.rate_cents == null ? '' : esc(String(c.rate_cents / 100).replace('.', ','))}" placeholder="2,00">`)}</div>
    <div class="grid2">${field('admsf', 'Début', `<input id="admsf" type="date" name="from" value="${esc(c.engaged_from || '')}">`)}${field('admst', 'Fin', `<input id="admst" type="date" name="to" value="${esc(c.engaged_to || '')}">`)}</div>
    ${field('admsg', 'Équipes gratuites', `<input id="admsg" type="number" name="free" min="0" max="20" value="${esc(String(c.free_teams ?? 1))}">`)}
    ${field('admsn', 'Note (lue par le président)', `<input id="admsn" name="note" maxlength="300" value="${esc(c.snote || '')}">`)}
    <div class="row static"><span class="g">Joueurs facturés<small>Tous les joueurs, sauf ceux des équipes gratuites (les plus nombreuses)</small></span><b>${+c.paying || 0}</b></div>
    ${c.status === 'payant' ? `<div class="row static"><span class="g">Montant prévu</span><b>${euros(c.due_cents)}</b></div>` : ''}
    <button class="btn main" type="submit">${icon('check', 20)}Enregistrer l’abonnement</button></form>`;
  return head(esc(c.name)) + `<main class="bd adm">${A().err ? `<div class="card alert" role="alert"><b>${esc(A().err)}</b></div>` : ''}${h}</main>`;
}

// ---------- À traiter ----------
function todoTab() {
  const a = A(); if (!a.reports || !a.clubs) return '<p class="empty">Chargement…</p>';
  const ov = a.ov || {}, aval = a.clubs.filter(toValidate), openR = a.reports.filter((r) => !r.admin_done_at), doneR = a.reports.filter((r) => r.admin_done_at);
  let h = `<div class="sec"><h2>Présidents à valider</h2><span class="det">${aval.length}</span></div>`;
  h += aval.length ? `<section class="card"><div class="list">${aval.map((c) => `<button class="row" data-act="admclub" data-id="${esc(c.id)}">${crestOf(c)}<span class="g">${esc(c.name)}<small>${esc(c.president_name || '')}${c.president_email ? ' · ' + esc(c.president_email) : ''}</small></span>${statusPill(c)}</button>`).join('')}</div></section>` : '<p class="empty">Aucun président en attente.</p>';
  const rcard = (r) => `<div class="card${r.admin_done_at ? ' flat' : ''}"><div class="kick">${esc(r.club_name)} · ${esc(r.group_name || 'Groupe')} · transmis le ${esc(day(r.forwarded_at))}</div>
    <blockquote class="admquote">${r.body ? esc(r.body) : '<i>Message effacé depuis</i>'}</blockquote><div class="det">Écrit par <b>${esc(r.author_name || 'Membre')}</b>${r.reason ? ' · motif du signalement : « ' + esc(r.reason) + ' »' : ''}</div>
    ${r.president_email ? `<div class="det">Transmis par <a href="mailto:${esc(r.president_email)}">${esc(r.president_email)}</a></div>` : ''}
    ${r.admin_done_at ? `<div class="chips"><span class="pill ok">Traité le ${esc(day(r.admin_done_at))}</span></div>${r.admin_note ? `<p class="note">${esc(r.admin_note)}</p>` : ''}` : `${field('admrn-' + esc(r.report_id), 'Note (pour toi seul)', `<input id="admrn-${esc(r.report_id)}" name="note" maxlength="300" placeholder="Ex. : président appelé, message retiré">`)}<button class="btn main" data-act="admrepdone" data-id="${esc(r.report_id)}">${icon('check', 20)}Marquer traité</button>`}</div>`;
  h += `<div class="sec"><h2>Signalements transmis</h2><span class="det">${openR.length}</span></div>${openR.length ? openR.map(rcard).join('') : '<p class="empty">Aucun signalement transmis.</p>'}`;
  if (doneR.length) h += `<details class="card flat"><summary>Déjà traités (${doneR.length})</summary>${doneR.map(rcard).join('')}</details>`;
  h += '<p class="note">Seuls les messages qu’un président te transmet arrivent ici : tu vois le message signalé, jamais la conversation.</p>';
  h += `<div class="sec"><h2>Doublons d’exercices publics</h2><span class="det">${a.dups.length}</span></div>`;
  h += a.dups.length ? `<section class="card"><div class="list">${a.dups.map((d) => { const on = isArmed('admdup' + d.id); return `<div class="row static"><span class="g">« ${esc(d.title)} » = « ${esc(d.other_title)} »<small>${esc(d.reported_by_name || '')} · ${esc(day(d.reported_at))}</small></span><button class="btn small ${on ? 'danger armed' : 'main'}" data-act="admdupm" data-id="${esc(d.id)}">${on ? 'Confirmer' : 'Fusionner'}</button><button class="btn small ghost" data-act="admdupn" data-id="${esc(d.id)}">Pas un doublon</button></div>`; }).join('')}</div><p class="note">« Fusionner » garde le second exercice ; le premier part à la corbeille.</p></section>` : '<p class="empty">Aucun doublon signalé.</p>';
  h += `<div class="sec"><h2>Demandes</h2></div><section class="card"><button class="btn" data-act="creqs">${icon('search', 20)}Demandes de clubs · ${+ov.club_requests || 0}</button><p class="note">« Mon club n’est pas dans la liste ».</p><button class="btn" data-act="cschemas">${icon('doc', 20)}Demandes de schéma · ${+ov.schemas || 0}</button><p class="note">Exercices envoyés par les coachs : dépose la vidéo du schéma.</p></section>`;
  return h;
}

// ---------- Entretien ----------
function toolsTab() {
  const a = A(), pv = a.preview; if (!pv) return '<p class="empty">Chargement…</p>';
  const on = isArmed('admpurge'), last = (a.log || []).find((x) => x.action === 'suppressions automatiques lancées');
  let h = `<section class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><h3>Suppressions automatiques</h3><span class="det">${last ? esc(day(last.at)) : ''}</span></div>
    <p class="note">Aperçu de ce que le prochain passage fera :</p><div class="list">${pv.map((x) => `<div class="row static" style="min-height:44px"><span class="g" style="font-weight:400">${esc(x.item.charAt(0).toUpperCase() + x.item.slice(1))}</span><b>${+x.n || 0}</b></div>`).join('')}</div>
    <button class="btn ${on ? 'danger armed' : 'main'}" data-act="admpurge">${on ? 'Confirmer : lancer le passage' : 'Lancer le passage'}</button>
    <p class="note">Deux touches, puis inscrit au journal admin. Les comptes inactifs ne sont ni prévenus ni effacés tant que l’e-mail de prévenance n’existe pas.</p>
    ${a.lastRun ? `<div class="card pale" style="transform:none"><b>Passage fait</b>${a.lastRun.map((x) => `<span class="det">${esc(x.item)} : ${+x.n || 0}</span>`).join('')}</div>` : ''}</section>`;
  h += `<div class="sec"><h2>E-mails</h2></div>${mailTestBlock()}`;
  h += `<div class="sec"><h2>Administrateurs</h2></div><div class="card">${adminsButton()}</div>`;
  h += `<div class="sec"><h2>Journal admin</h2><span class="det">40 dernières lignes</span></div><section class="card"><div class="list">${(a.log || []).map((x) => `<div class="row static" style="min-height:44px"><span class="g" style="font-weight:400"><b>${esc(x.action)}</b><small>${esc(new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(x.admin_name || '')}${x.club_name ? ' · ' + esc(x.club_name) : ''}</small></span></div>`).join('') || '<p class="empty">Rien pour l’instant.</p>'}</div></section>`;
  h += `<div class="sec"><h2>Santé</h2></div><section class="card"><div class="row static"><span class="g">Version de l’application</span><span class="pill ok">${esc(VERSION)}</span></div><div class="row static"><span class="g">Double vérification</span><span class="pill ok">Active sur cette session</span></div></section>`;
  return h;
}

// ---------- double vérification (code à 6 chiffres) ----------
async function mfaLoad() {
  const m = (S.mfa = { loading: true });
  try {
    const r = await sb.auth.mfa.listFactors();
    const all = r.data?.all || [], ok = (r.data?.totp || []).find((f) => f.status === 'verified') || all.find((f) => f.factor_type === 'totp' && f.status === 'verified');
    m.factor = ok?.id || null;
  } catch (e) { m.err = 'Impossible de lire la double vérification. Réessaie.'; }
  m.loading = false; render(true);
}
function mfaScreen(asView) {
  const head = header({ brand: true, back: asView, kicker: 'Administration', title: 'Double vérification' });
  const m = S.mfa; if (!m) { mfaLoad(); return head + '<main class="bd"><p class="empty">Chargement…</p></main>'; }
  if (m.loading) return head + '<main class="bd"><p class="empty">Chargement…</p></main>';
  let h = m.err ? `<div class="card alert" role="alert"><b>${esc(m.err)}</b></div>` : '';
  const codeForm = (label) => `<form class="card" id="admmfaf"><div class="field"><label for="admcode">${label}</label><input id="admcode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456" style="font-size:24px;letter-spacing:.3em;text-align:center"></div><button class="btn main" type="submit">${icon('lock', 20)}Valider le code</button></form>`;
  if (m.factor) {
    h += `<div class="card pale" style="transform:none"><b>L’administration demande un code à 6 chiffres.</b><span class="note" style="color:var(--pc-texte-ecran)">Ouvre ton application d’authentification et tape le code de « ${esc(BRAND.name)} ». Il change toutes les 30 secondes.</span></div>` + codeForm('Code à 6 chiffres');
  } else if (m.enroll) {
    h += `<div class="card"><div class="kick">Étape 2 · scanne ce QR code</div><img src="${esc(m.enroll.qr)}" alt="QR code de la double vérification" width="200" height="200" style="align-self:center;background:#fff;border-radius:12px;padding:8px">
      <p class="note">Sans appareil photo : dans l’application, choisis « Saisir une clé » et tape :</p><code class="admsecret">${esc(m.enroll.secret || '')}</code></div>` + codeForm('Étape 3 · tape le code à 6 chiffres affiché');
  } else {
    h += `<div class="card pale" style="transform:none"><b>Protège l’administration par un code à 6 chiffres.</b><span class="note" style="color:var(--pc-texte-ecran)">En plus du mot de passe, chaque connexion à l’administration demande un code donné par une application d’authentification sur ton téléphone.</span></div>
      <div class="card"><div class="kick">Étape 1 · installe une application</div><p class="note">Google Authenticator, Microsoft Authenticator ou l’application Mots de passe de l’iPhone.</p><button class="btn main" data-act="admenroll">${icon('lock', 20)}Activer la double vérification</button></div>`;
  }
  h += '<p class="note">Téléphone perdu : le code peut être effacé dans Supabase (procédure dans la liste des tâches, n° 42).</p>';
  if (!asView) h += `<button class="btn ghost" data-act="logout">${icon('back', 20)}Me déconnecter</button>`;
  return head + `<main class="bd">${h}</main>`;
}

// ---------- Mon compte : entrée de l'administration ----------
export function adminAccountBlock() {
  if (S.isAdmin) return `<button class="btn ink" data-act="adm">${icon('shield', 20)}Ouvrir l’espace admin</button><p class="note">Accueil, clubs et abonnements, signalements, entretien.</p>`;
  if (S.adminAcct) return `<div class="sec"><h2>Administration ${esc(BRAND.name)}</h2></div><div class="card"><button class="btn" data-act="admmfa">${icon('lock', 20)}Confirmer avec le code à 6 chiffres</button><p class="note">L’administration demande la double vérification sur chaque appareil.</p></div>`;
  return '';
}
hooks.adminAccount = adminAccountBlock;

Object.assign(V37_TOP, { adm: () => space(true), admclub: (v) => clubScreen(v.id), admmfa: () => (S.isAdmin ? space(true) : mfaScreen(true)) });

const verified = async () => {
  S.mfa = null; toast('Code accepté.');
  await refresh();
  if (!S.isAdmin) { toast('Code accepté, mais ce compte n’est pas administrateur.'); return; }
  if (S.view?.type === 'admmfa') { S.view = { type: 'adm' }; S.noStack = true; }
  S.admLoaded = false; render(true); await load(S.admTab = S.admTab || 'home'); render(true);
};
Object.assign(ACTIONS, {
  adm: async () => { S.view = { type: 'adm' }; S.admTab = S.admTab || 'home'; render(); await load(S.admTab); render(true); },
  admmfa: () => { S.mfa = null; S.view = { type: 'admmfa' }; render(); },
  admtab: async (el, d) => open(d.k),
  admgo: async (el, d) => { const [t, x] = String(d.k).split(':'); if (x === 'subs') S.admSub = 'subs'; else if (x) { S.admSub = 'list'; S.admF = x; } await open(t); },
  admsub: (el, d) => { S.admSub = d.k; render(true); },
  admf: (el, d) => { S.admF = d.k; render(true); },
  admclub: async (el, d) => { S.view = { type: 'admclub', id: d.id }; render(); if (!A().clubs) { await load('club'); render(true); } },
  admext: async (el, d) => { const r = await run(sb.rpc('admin_extend_validation', { p_club: d.id, p_days: 30 })); if (r) { toast('Nouvelle date limite : ' + day(r) + '.'); await load('club'); render(true); } },
  admvno: async (el, d) => {
    if (!armed('admvno' + d.id)) return;
    if (await run(sb.rpc('admin_unvalidate_sender', { p_club: d.id, p_user: d.user }), 'Validation retirée : le club n’envoie plus de convocation par e-mail.')) { await load('club'); render(true); }
  },
  admdupm: async (el, d) => { if (!armed('admdup' + d.id)) return; if (await run(sb.rpc('decide_duplicate', { p_id: d.id, p_merge: true }), 'Exercices fusionnés.')) { await load('todo'); render(true); } },
  admdupn: async (el, d) => { if (await run(sb.rpc('decide_duplicate', { p_id: d.id, p_merge: false }), 'Noté : ce n’est pas un doublon.')) { await load('todo'); render(true); } },
  admpurge: async () => {
    if (!armed('admpurge')) return;
    const r = await run(sb.rpc('admin_purge_run'), 'Passage fait.');
    if (r) { A().lastRun = Array.isArray(r) ? r : []; await load('tools'); render(true); }
  },
  admrepdone: async (el, d) => {
    const note = document.getElementById('admrn-' + d.id)?.value || '';
    if (await run(sb.rpc('admin_report_done', { p_report: d.id, p_note: note }), 'Signalement traité.')) { await load('todo'); render(true); }
  },
  admoff: () => { S.admOff = true; render(); },
  admenroll: async () => {
    const m = S.mfa || (S.mfa = {}); m.err = null;
    try {
      // un essai abandonné laisse un facteur « non vérifié » : il est retiré avant d'en créer un autre
      const l = await sb.auth.mfa.listFactors();
      for (const f of (l.data?.all || []).filter((x) => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
      const r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: BRAND.name + ' ' + new Date().toISOString().slice(0, 16) });
      if (r.error) throw r.error;
      m.enroll = { id: r.data.id, qr: r.data.totp?.qr_code || '', secret: r.data.totp?.secret || '' };
    } catch (e) { console.error(e); m.err = 'Activation impossible : ' + (e?.message || 'réessaie') + '. Vérifie dans Supabase que la double vérification (MFA, TOTP) est permise.'; }
    render(true);
  },
});
FORMS.admmfaf = async (v) => {
  const m = S.mfa || {}, code = String(v.code || '').replace(/\D/g, '');
  if (code.length !== 6) return toast('Le code a 6 chiffres.');
  const factorId = m.factor || m.enroll?.id; if (!factorId) return toast('Recommence l’activation.');
  const r = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (r.error) { toast(/invalid|expired|incorrect/i.test(r.error.message || '') ? 'Code incorrect ou expiré : tape le code affiché maintenant.' : 'Code refusé : ' + r.error.message); return; }
  await verified();
};
FORMS.admvalf = async (v, f) => {
  const reason = v.reason, ends = v.ends || null;
  if (reason === 'gratuite' && !ends) return toast('Indique la date de fin de la gratuité.');
  if (await run(sb.rpc('admin_validate_sender', { p_club: f.dataset.club, p_user: f.dataset.user, p_reason: reason, p_ends: ends, p_note: v.note || '' }), 'Président validé : le club peut envoyer ses convocations.')) { await load('club'); render(true); }
};
FORMS.admsubf = async (v, f) => {
  const raw = String(v.rate || '').trim().replace(',', '.'), rate = raw === '' ? null : Math.round(parseFloat(raw) * 100);
  if (raw !== '' && !Number.isFinite(rate)) return toast('Prix par joueur : un nombre, par exemple 2,00.');
  if (v.status === 'payant' && rate == null) return toast('Indique le prix par joueur.');
  if (await run(sb.rpc('admin_set_subscription', { p_club: f.dataset.club, p_status: v.status, p_from: v.from || null, p_to: v.to || null, p_rate_cents: rate, p_free_teams: v.free === '' ? 1 : +v.free, p_note: v.note || '' }), 'Abonnement enregistré.')) { await load('club'); render(true); }
};
INPUTS.push((t) => {
  if (!t.dataset.admq) return false;
  S.admQ = t.value; const pos = t.selectionStart; render(true);
  const n = document.getElementById('admq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } }
  return true;
});
