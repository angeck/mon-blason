// mypocketclub · alpha 3.7.0
// n° 93 : top 5 des équipes les plus suivies (sous les équipes du club, pour qui ne suit encore aucune équipe) ;
// n° 96 : « Mon club n'est pas dans la liste » : demande d'ajout d'un club (version test, sans e-mail), page Admin de Gaël,
// aperçu du futur e-mail de démarchage au dirigeant (rien n'est envoyé tant que l'option n'est pas activée).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_7_0.sql) ; l'écran n'est qu'un confort.
import { BRAND } from '../config.js';
import { S, sb, esc, run, toast, render, ACTIONS, FORMS, INPUTS, plural, fmtDay } from './core.js';
import { header, crest, icon, field } from './ui.js';

// ---------- n° 93 · top 5 des équipes les plus suivies ----------
// La base ne renvoie rien tant que l'application compte moins de 10 équipes visibles (pas fantômes, pas archivées)
// de clubs qui apparaissent dans la recherche des clubs. Aucun nom de personne : équipe, club, nombre de personnes qui la suivent.
export function topFollowed() {
  if (S.top5 === undefined) {
    S.top5 = null;
    sb.rpc('top_followed_teams').then(({ data }) => { S.top5 = Array.isArray(data) ? data : []; if (S.top5.length) render(true); }, () => { S.top5 = []; });
    return '';
  }
  const l = S.top5 || [];
  if (!l.length) return '';
  return `<div class="sec"><h2>Les plus suivies</h2><span class="det">sur ${esc(BRAND.name)}</span></div><div class="card"><div class="list">${l.map((t, i) => `<button class="row" data-act="pclub" data-id="${esc(t.club_id)}"><b style="width:22px;flex:none;font-family:var(--pc-titre);font-size:20px;color:var(--pc-action)">${i + 1}</b>${crest({ name: t.club_name, logo: t.logo, crest_bg: t.crest_bg, color1: t.color1, crest_outline: t.crest_outline }, 30, '#FFFFFF')}<span class="g">${esc(t.team_name)}<small>${esc([t.club_name, t.city, t.sport].filter(Boolean).join(' · '))} · suivie par ${plural(+t.followers || 0, 'personne')}</small></span><span class="chev"></span></button>`).join('')}</div></div>`;
}

// ---------- n° 96 · « Mon club n'est pas dans la liste » ----------
const SPORTS = ['Basket-ball', 'Volley-ball', 'Football', 'Rugby', 'Handball', 'Autre sport'];
export function notListedLine(words, many) {
  if (!words) return '';
  if (many) return `<button class="btn link" data-act="creq" style="align-self:center">Mon club n’est pas dans la liste</button>`;
  return `<button class="card" data-act="creq" style="border:2px dashed var(--pc-action);text-align:left;font:inherit;color:inherit;background:var(--pc-bleu-pale)"><span class="kick" style="color:var(--pc-action)">Mon club n’est pas dans la liste</span><b style="font-size:18px">« ${esc(words)} »</b><span class="det">Touche ici pour demander son arrivée sur ${esc(BRAND.name)}.</span></button>`;
}
function creqForm() {
  const F = S.creq || {}, me = S.me || {};
  const v = (k, d) => esc(F[k] ?? d ?? '');
  return `<form id="creqf" class="card lift">
  <p class="note" style="margin:0">Dis-nous quel club tu veux retrouver sur ${esc(BRAND.name)}. On s’occupe de prendre contact avec ses dirigeants.</p>
  <div class="grid2">${field('cqf', 'Prénom', `<input id="cqf" name="first" required maxlength="60" autocomplete="given-name" value="${v('first', me.first_name)}">`)}${field('cql', 'Nom', `<input id="cql" name="last" required maxlength="60" autocomplete="family-name" value="${v('last', me.last_name)}">`)}</div>
  ${field('cqe', 'Ton adresse e-mail', `<input id="cqe" name="email" type="email" required maxlength="160" autocomplete="email" value="${v('email', S.session?.user?.email)}">`)}
  ${field('cqc', 'Nom du club', `<input id="cqc" name="club" required maxlength="120" value="${v('club', S.ps?.done)}">`)}
  <div class="grid2">${field('cqv', 'Ville du club', `<input id="cqv" name="city" required maxlength="80" value="${v('city')}">`)}${field('cqs', 'Sport', `<select id="cqs" name="sport" required><option value="">—</option>${SPORTS.map((x) => `<option ${F.sport === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
  <p class="note" style="margin:0">La ville et le sport permettent de distinguer deux clubs qui portent le même nom.</p>
  <label class="check"><input type="checkbox" name="age" ${F.age ? 'checked' : ''}><span><b>J’ai 15 ans ou plus</b><br><span class="det">Moins de 15 ans : demande à un parent de faire la demande.</span></span></label>
  <label class="check"><input type="checkbox" name="consent" ${F.consent ? 'checked' : ''}><span><b>J’accepte que mon nom soit transmis au club</b><br><span class="det">Obligatoire : le club saura qu’un de ses membres a fait la demande. Ton e-mail sert seulement à te prévenir quand ton club arrive sur ${esc(BRAND.name)}.</span></span></label>
  <div class="card pale" style="transform:none"><b>Version de test</b><span class="note" style="color:var(--pc-texte-ecran)">Ta demande est enregistrée, mais rien n’est encore envoyé au club ni à toi par e-mail.</span></div>
  <button class="btn main" type="submit">Envoyer ma demande</button></form>`;
}
function creqScreen() {
  const head = header({ brand: true, back: true, kicker: 'Recherche des clubs', title: S.creqDone ? 'Merci !' : 'Mon club n’est pas dans la liste' });
  if (S.creqDone) return head + `<main class="bd"><div class="card lift"><b style="font-size:18px">Ta demande pour « ${esc(S.creqDone)} » est bien enregistrée.</b><p class="note" style="margin:0">Nous allons prendre contact avec le club. Tu seras prévenu quand il arrivera sur ${esc(BRAND.name)}.</p></div><button class="btn main" data-act="back">Revenir à la recherche</button></main>`;
  return head + `<main class="bd">${creqForm()}</main>`;
}

// ---------- n° 96 · page Admin (Gaël) : demandes de clubs et e-mail au dirigeant ----------
// 5.11.0 (décision de Gaël du 13 novembre 2026) : la demande d'un membre fait une notification à l'administrateur, qui cherche
// l'adresse PUBLIÉE du club, note d'où elle vient, puis envoie (deux touches). Une relance au plus, 14 jours après.
// La base refuse une adresse de la liste noire, un club déjà inscrit ou déjà contacté, et au-delà de 10 e-mails par jour.
const keyOf = (r) => (String(r.club_name || '') + '|' + String(r.city || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9|]/g, '');
const sameClub = (r) => (S.creqs || []).filter((x) => keyOf(x) === keyOf(r));
const outOf = (r) => (S.creqOut || []).find((o) => keyOf(o) === keyOf(r));
const SOURCES = ['Site du club', 'Annuaire de la fédération', 'Comité ou ligue', 'Réseaux sociaux du club', 'Autre page publique'];
const RELANCE_DAYS = 14;
const canRelance = (o) => o && o.status === 'envoye' && o.sent_at && Date.now() - new Date(o.sent_at).getTime() >= RELANCE_DAYS * 864e5;
function outPill(o) {
  if (!o || o.status === 'pret') return '';
  if (o.status === 'refuse') return '<span class="pill ko">Désinscrit : plus aucun envoi</span>';
  if (o.status === 'echec') return '<span class="pill ko">Échec de l’envoi : réessaie</span>';
  if (o.status === 'relance') return `<span class="pill">Contacté le ${esc(fmtDay(o.sent_at))} · relancé le ${esc(fmtDay(o.relance_at))}</span>`;
  return `<span class="pill ok">Contacté le ${esc(fmtDay(o.sent_at))}</span>`;
}
function creqsScreen() {
  const head = header({ brand: true, back: true, kicker: 'Administration ' + BRAND.name, title: 'Demandes de clubs' });
  const l = S.creqs;
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  if (!l) return head + '<main class="bd"><p class="empty">Chargement…</p></main>';
  const open = l.filter((r) => r.status === 'new'), done = l.filter((r) => r.status !== 'new');
  const card = (r) => { const n = sameClub(r).length, o = outOf(r), sent = o && ['envoye', 'relance', 'refuse'].includes(o.status);
    const btn = !sent ? `<button class="btn small main" data-act="creqmail" data-id="${r.id}">${icon('mail', 18)}Contacter le club</button>`
      : canRelance(o) ? `<button class="btn small" data-act="creqmail" data-id="${r.id}" data-relance="1">${icon('mail', 18)}Relancer (une seule fois)</button>` : '';
    return `<div class="card"><div class="kick">${esc(fmtDay(r.created_at))}${n > 1 ? ` · ${n} demandes pour ce club` : ''}</div><b style="font-size:18px">${esc(r.club_name)}</b><span class="det">${esc([r.city, r.sport].filter(Boolean).join(' · '))}</span>
    <div class="det">Demandé par <b>${esc(r.first_name)} ${esc(r.last_name)}</b> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div>
    <div class="chips"><span class="pill ${r.age_ok ? 'ok' : 'ko'}">${r.age_ok ? '15 ans ou plus' : 'âge non confirmé'}</span><span class="pill ${r.consent ? 'ok' : 'ko'}">${r.consent ? 'nom transmissible au club' : 'sans accord'}</span>${r.user_id ? '<span class="pill blue">adhérent</span>' : '<span class="pill">visiteur</span>'}${outPill(o)}</div>
    ${o && o.email ? `<div class="det">Adresse du club : ${esc(o.email)} · source : ${esc(o.source)}${o.source_url ? ` (<a href="${esc(o.source_url)}" target="_blank" rel="noopener">lien</a>)` : ''}</div>` : ''}
    <div class="btns">${btn}${r.status === 'new' ? `<button class="btn small ghost" data-act="creqdone" data-id="${r.id}">Marquer comme traitée</button>` : `<button class="btn small ghost" data-act="creqreopen" data-id="${r.id}">Remettre à traiter</button>`}</div></div>`; };
  return head + `<main class="bd"><p class="note">Chaque demande t’envoie une notification. Cherche l’adresse publiée du club (l’adresse générale d’abord), puis envoie : une relance au plus, ${RELANCE_DAYS} jours après.</p><div class="sec"><h2>À traiter</h2><span class="det">${open.length}</span></div>${open.length ? open.map(card).join('') : '<p class="empty">Aucune demande en attente.</p>'}${done.length ? `<details class="card flat"><summary>Traitées (${done.length})</summary>${done.map(card).join('')}</details>` : ''}</main>`;
}
// Texte de l'e-mail au dirigeant, validé par Gaël le 13 novembre 2026 (même texte que la fonction serveur, clubOutreachMail)
function mailText(r, relance = false) {
  const n = sameClub(r).filter((x) => x.consent).length || 1, last = sameClub(r).filter((x) => x.consent)[0] || r;
  return {
    subject: `${relance ? 'Relance · ' : ''}Un membre de ton club voudrait utiliser ${BRAND.name}`,
    body: `Bonjour,
${relance ? '\nJe me permets de te relancer, une seule fois, au sujet de ce message.\n' : ''}
Un membre de ton club, ${last.first_name} ${last.last_name}, voudrait que ${r.club_name}${r.city ? ' (' + r.city + ')' : ''} soit sur ${BRAND.name}.${n > 1 ? ` ${n} membres de ton club ont fait cette demande.` : ''}

${BRAND.name} est une application pour les clubs sportifs : l’agenda avec les réponses « Je viens / Je ne viens pas », les convocations, les messages des équipes, les licences et les cotisations, au même endroit, dans la poche de chacun.

C’est gratuit pour l’essayer : jusqu’à la fin de la saison pour tout ton club, ou pendant une saison complète pour une seule équipe.

Pour en savoir plus ou inscrire ton club : https://mypocketclub.fr
Une question ? Réponds simplement à ce message.

Sportivement,
Gaël Raveneau, ${BRAND.name}

—
Tu reçois ce message parce qu’un membre de ton club a demandé son arrivée sur ${BRAND.name} ; nous avons trouvé cette adresse ici : [source choisie]. Tu ne recevras rien d’autre sans ton accord. Pour ne plus rien recevoir : [lien de désinscription personnel].`,
  };
}
function creqMailScreen(v) {
  const r = (S.creqs || []).find((x) => x.id === v.id), relance = !!v.relance;
  const head = header({ brand: true, back: true, kicker: relance ? 'Relance du club' : 'Contacter le club', title: 'E-mail au dirigeant' });
  if (!r || !S.isAdmin) return head + '<main class="bd"><p class="empty">Demande introuvable.</p></main>';
  const m = mailText(r, relance), o = outOf(r), on = S.creqArm === r.id, kv = S.creqVals || {};
  const form = relance ? `<form id="creqsend" class="card" data-id="${r.id}" data-relance="1"><div class="det">À : <b>${esc(o?.email || '')}</b> (même adresse que le premier envoi)</div>`
    : `<form id="creqsend" class="card" data-id="${r.id}">${field('cqem', 'Adresse publiée du club', `<input id="cqem" name="email" type="email" required maxlength="160" placeholder="contact@club.fr" autocomplete="off" value="${esc(kv.email || '')}">`)}
    <p class="note" style="margin:0">L’adresse générale du club d’abord. Jamais une adresse reçue avec une convocation.</p>
    ${field('cqsrc', 'D’où vient l’adresse', `<select id="cqsrc" name="source" required><option value="">Choisir…</option>${SOURCES.map((x) => `<option ${kv.source === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
    ${field('cqurl', 'Lien de la page (facultatif)', `<input id="cqurl" name="url" type="url" maxlength="300" placeholder="https://…" value="${esc(kv.url || '')}">`)}`;
  return head + `<main class="bd">${form}<button class="btn ${on ? 'danger armed' : 'main'}" type="submit" ${S.creqSending ? 'disabled' : ''}>${S.creqSending ? 'Envoi…' : on ? 'Confirmer : envoyer l’e-mail' : (relance ? 'Relancer le club' : 'Envoyer l’e-mail')}</button><p class="note" style="margin:0">Part de info.mypocketclub.fr ; les réponses arrivent sur contact@. Inscrit au journal admin.</p></form>
  <div class="card lift" style="transform:none"><div class="det">Objet : <b>${esc(m.subject)}</b></div><hr style="border:0;border-top:1px solid var(--pc-trait);width:100%"><div style="white-space:pre-wrap;font-size:15px">${esc(m.body)}</div></div></main>`;
}
async function loadCreqs() {
  S.creqs = (await run(sb.from('club_requests').select('*').order('created_at', { ascending: false }).limit(300))) || []; S.creqNew = S.creqs.filter((r) => r.status === 'new').length;
  try { const o = await sb.from('club_outreach').select('*').limit(500); S.creqOut = o.error ? [] : o.data || []; } catch { S.creqOut = []; } // 5.11.0 (avant le script : liste vide)
}

// Écrans ouverts au-dessus de tout (visiteur non connecté compris pour « creq ») : lus par app.js
export const V37_TOP = { creq: () => creqScreen(), creqs: () => creqsScreen(), creqmail: (v) => creqMailScreen(v) };
// Carte de l'Accueil pour l'administrateur : demandes de clubs en attente
export function adminHome() {
  if (!S.isAdmin || !S.creqNew) return '';
  return `<button class="card pale" data-act="creqs" style="border:0;text-align:left;font:inherit;color:inherit"><span class="kick">Administration ${esc(BRAND.name)}</span><b>${plural(S.creqNew, 'demande de club', 'demandes de clubs')} à traiter</b><span class="det">Prises de contact demandées par des membres.</span></button>`;
}
export async function loadAdminCounts() {
  if (!S.isAdmin) return;
  const r = await sb.from('club_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
  S.creqNew = r.count || 0;
}

Object.assign(ACTIONS, {
  creq: () => { S.creqDone = null; S.creq = S.creq || {}; S.view = { type: 'creq' }; render(); },
  creqs: async () => { S.view = { type: 'creqs' }; S.creqs = null; render(); await loadCreqs(); render(true); },
  creqmail: (el, d) => { S.creqArm = null; S.creqVals = null; S.view = { type: 'creqmail', id: d.id, relance: !!d.relance }; render(); },
  creqdone: async (el, d) => { if (await run(sb.rpc('set_club_request', { p_id: d.id, p_status: 'done' }), 'Demande marquée comme traitée.')) { await loadCreqs(); render(true); } },
  creqreopen: async (el, d) => { if (await run(sb.rpc('set_club_request', { p_id: d.id, p_status: 'new' }), 'Demande remise à traiter.')) { await loadCreqs(); render(true); } },
});
// 5.11.0 · n° 96 : envoi par la fonction envoyer-email (deux touches)
FORMS.creqsend = async (v, f) => {
  const id = f.dataset.id, relance = !!f.dataset.relance;
  if (!relance && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v.email || '').trim()) || !v.source)) return toast('Adresse du club et source obligatoires.');
  S.creqVals = { email: (v.email || '').trim(), source: v.source || '', url: (v.url || '').trim() };   // gardées au second toucher
  if (S.creqArm !== id) { S.creqArm = id; render(true); return; }
  S.creqArm = null; S.creqSending = true; render(true);
  try {
    const { data, error } = await sb.functions.invoke('envoyer-email', { body: { club_outreach: { request: id, email: (v.email || '').trim(), source: v.source || '', url: (v.url || '').trim(), relance } } });
    let why = ''; if (error) { try { why = (await error.context?.json?.())?.erreur || ''; } catch { why = ''; } }
    if (error || !data?.envoye) toast('Pas envoyé' + (why ? ' : ' + why : ' : redéploie la fonction « envoyer-email » (5.11.0).'));
    else { toast(relance ? 'Relance envoyée.' : 'E-mail envoyé au club.'); S.creqVals = null; S.view = { type: 'creqs' }; }
  } catch { toast('Envoi impossible.'); }
  S.creqSending = false; await loadCreqs(); render(true);
};
FORMS.creqf = async (v) => {
  const F = { first: (v.first || '').trim(), last: (v.last || '').trim(), email: (v.email || '').trim(), club: (v.club || '').trim(), city: (v.city || '').trim(), sport: v.sport || '' };
  S.creq = { ...F, age: !!v.age, consent: !!v.consent };
  if (!F.first || !F.last || !F.email || !F.club || !F.city || !F.sport) return toast('Remplis tous les champs, s’il te plaît.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(F.email)) return toast('Adresse e-mail à vérifier.');
  if (!v.age) return toast('Moins de 15 ans : demande à un parent de faire la demande.');
  if (!v.consent) return toast('Coche « J’accepte que mon nom soit transmis au club » pour envoyer la demande.');
  const id = await run(sb.rpc('request_club', { p_first: F.first, p_last: F.last, p_email: F.email, p_club: F.club, p_city: F.city, p_sport: F.sport, p_age_ok: true, p_consent: true }));
  if (!id) return;
  S.creqDone = F.club; S.creq = null; render();
};
INPUTS.push((t) => {
  const f = t.closest && t.closest('#creqf'); if (!f || !t.name) return false;
  S.creq = S.creq || {}; S.creq[t.name] = t.type === 'checkbox' ? t.checked : t.value; return true;
});
