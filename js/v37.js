// mypocketclub · alpha 3.7.0
// n° 93 : top 5 des équipes les plus suivies (sous les équipes du club, pour qui ne suit encore aucune équipe) ;
// n° 96 : « Mon club n'est pas dans la liste » : demande d'ajout d'un club (version test, sans e-mail), page Admin de Gaël,
// aperçu du futur e-mail de démarchage au dirigeant (rien n'est envoyé tant que l'option n'est pas activée).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_7_0.sql) ; l'écran n'est qu'un confort.
import { BRAND, TURNSTILE_SITEKEY } from '../config.js';
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
// ---------- 5.13.0 · n° 236 · un seul chemin pour « Recommander mon club » (fusion des n° 96 et 162) ----------
// 1. As-tu l'e-mail d'un contact du club ?  Oui : envoi direct par la fonction « recommander-club » (Turnstile ; une recommandation par adresse
//    pour toujours, 3 par visiteur et par jour, 20 par jour ; seules des empreintes sont gardées).
//    Non : le club est décrit (nom, ville, sport) et l'administrateur reçoit une notification ; il cherche l'adresse publiée du club et écrit lui-même (n° 96).
// 2. Veux-tu donner tes coordonnées ? Au choix : sans elles, la demande reste anonyme pour le club.
const recoField = (F, k, d) => esc(F[k] || d || '');
function recoScreen() {
  const head = header({ brand: true, back: true, kicker: 'Recommander ' + BRAND.name, title: S.recoDone === 'admin' ? 'Merci !' : S.recoDone ? 'C’est parti !' : 'Recommander mon club' });
  if (S.recoDone === 'admin') return head + `<main class="bd"><div class="card lift"><b style="font-size:18px">Ta demande est bien enregistrée.</b><p class="note" style="margin:0">Nous cherchons les coordonnées publiées du club, puis nous lui écrivons nous-mêmes.${S.recoShared ? ' Ton nom lui sera transmis ; ton e-mail sert seulement à te prévenir quand le club arrivera.' : ' Tu restes anonyme pour le club.'}</p></div><button class="btn main" data-act="back">Revenir</button></main>`;
  if (S.recoDone) return head + `<main class="bd"><div class="card lift"><b style="font-size:18px">Recommandation envoyée.</b><p class="note" style="margin:0">Le contact reçoit un seul e-mail${S.recoShared ? ', avec ton prénom' : ''}. Il peut refuser tout autre envoi en un clic.</p></div><button class="btn main" data-act="back">Revenir</button></main>`;
  const F = S.reco || {}, me = S.me || {}, has = F.has, share = F.share;
  const chip = (act, val, cur, label) => `<button type="button" class="chip" data-act="${act}" data-v="${val}" aria-pressed="${cur === val}">${label}</button>`;
  let h = `<p class="note" style="margin:0">Tu veux que ton club utilise ${esc(BRAND.name)} ? Dis-nous comment le joindre : une seule demande, deux façons de faire.</p>
  <div class="field"><span class="lab">As-tu l’e-mail d’un contact du club (président, secrétaire, coach) ?</span><div class="chips" role="group" aria-label="Contact du club">${chip('recohas', 'oui', has, 'Oui, j’ai son e-mail')}${chip('recohas', 'non', has, 'Non, je n’ai pas d’e-mail')}</div></div>`;
  if (has === 'oui') {
    h += `<p class="note" style="margin:0">Nous lui envoyons <b>un seul e-mail</b> de présentation, sans passer par nous.</p>
    ${field('rcc', 'Nom de ton club', `<input id="rcc" name="club" required maxlength="80" value="${recoField(F, 'club')}">`)}
    ${field('rce', 'E-mail du contact', `<input id="rce" name="email" type="email" required maxlength="160" autocomplete="off" value="${recoField(F, 'email')}">`)}
    <label class="check"><input type="checkbox" name="knows" ${F.knows ? 'checked' : ''}><span><b>Je connais cette personne</b><br><span class="det">et je lui fais cette recommandation en mon nom. Une adresse ne reçoit qu’une recommandation, jamais deux.</span></span></label>`;
  } else if (has === 'non') {
    h += `<p class="note" style="margin:0">Nous cherchons l’adresse publiée du club (site, fédération), puis nous lui écrivons nous-mêmes.</p>
    ${field('rcc', 'Nom du club', `<input id="rcc" name="club" required maxlength="120" value="${recoField(F, 'club', S.ps?.done)}">`)}
    <div class="grid2">${field('rcv', 'Ville du club', `<input id="rcv" name="city" required maxlength="80" value="${recoField(F, 'city')}">`)}${field('rcs', 'Sport', `<select id="rcs" name="sport" required><option value="">—</option>${SPORTS.map((x) => `<option ${F.sport === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
    <p class="note" style="margin:0">La ville et le sport permettent de distinguer deux clubs qui portent le même nom.</p>
    <label class="check"><input type="checkbox" name="age" ${F.age ? 'checked' : ''}><span><b>J’ai 15 ans ou plus</b><br><span class="det">Moins de 15 ans : demande à un parent de faire la demande.</span></span></label>`;
  }
  if (has) {
    h += `<div class="field"><span class="lab">Veux-tu donner tes coordonnées, pour que le club sache qui fait la demande ?</span><div class="chips" role="group" aria-label="Tes coordonnées">${chip('recoshare', 'oui', share, 'Oui, avec mon nom')}${chip('recoshare', 'non', share, 'Non, je reste anonyme')}</div></div>`;
    if (share === 'oui') {
      h += `<div class="grid2">${field('rcf', 'Ton prénom', `<input id="rcf" name="first" required maxlength="60" autocomplete="given-name" value="${recoField(F, 'first', me.first_name)}">`)}${has === 'non' ? field('rcn', 'Ton nom', `<input id="rcn" name="last" required maxlength="60" autocomplete="family-name" value="${recoField(F, 'last', me.last_name)}">`) : ''}</div>`;
      if (has === 'non') h += `${field('rcm', 'Ton adresse e-mail', `<input id="rcm" name="pemail" type="email" required maxlength="160" autocomplete="email" value="${recoField(F, 'pemail', S.session?.user?.email)}">`)}<p class="note" style="margin:0">Ton nom est transmis au club ; ton e-mail sert seulement à te prévenir quand ton club arrive sur ${esc(BRAND.name)}.</p>`;
      else h += `<p class="note" style="margin:0">Ton prénom apparaît dans l’e-mail du contact.</p>`;
    } else if (share === 'non') h += `<p class="note" style="margin:0">Le club saura seulement « un membre de ton club ». Nous ne gardons rien sur toi.</p>`;
    if (has === 'oui' && TURNSTILE_SITEKEY) h += '<div id="ts" class="ts"></div>';
    h += `<button class="btn main" type="submit" ${S.recoBusy ? 'disabled' : ''}>${S.recoBusy ? 'Envoi…' : has === 'oui' ? 'Envoyer la recommandation' : 'Envoyer ma demande'}</button>
    <p class="note" style="margin:0">${has === 'oui' ? 'L’e-mail part de info.mypocketclub.fr. Nous ne gardons pas l’adresse : seulement une empreinte, pour ne jamais lui écrire deux fois.' : 'Nous écrivons ensuite au club à son adresse publiée, sans jamais donner ton adresse e-mail.'}</p>`;
  }
  return head + `<main class="bd"><form id="recof" class="card lift">${h}</form></main>`;
}
const EMAIL_OK = (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
FORMS.recof = async (v) => {
  const old = S.reco || {};
  const F = { has: old.has, share: old.share, club: (v.club || '').trim(), email: (v.email || '').trim(), knows: !!v.knows, city: (v.city || '').trim(), sport: v.sport || '', age: !!v.age, first: (v.first || '').trim(), last: (v.last || '').trim(), pemail: (v.pemail || '').trim() };
  S.reco = F;
  if (!F.has) return toast('Dis d’abord si tu as l’e-mail d’un contact du club.');
  if (!F.club) return toast('Indique le nom du club.');
  if (!F.share) return toast('Dis si tu veux donner tes coordonnées ou rester anonyme.');
  const share = F.share === 'oui';
  if (share && !F.first) return toast('Indique ton prénom, ou choisis de rester anonyme.');
  if (F.has === 'non') {
    if (!F.city || !F.sport) return toast('Ville et sport du club obligatoires.');
    if (!F.age) return toast('Moins de 15 ans : demande à un parent de faire la demande.');
    if (share && (!F.last || !EMAIL_OK(F.pemail))) return toast('Pour donner tes coordonnées : prénom, nom et une adresse e-mail valide.');
    S.recoBusy = true; render(true);
    const id = await run(sb.rpc('request_club', { p_first: share ? F.first : '', p_last: share ? F.last : '', p_email: share ? F.pemail : '', p_club: F.club, p_city: F.city, p_sport: F.sport, p_age_ok: true, p_consent: share }));
    S.recoBusy = false;
    if (id) { S.recoDone = 'admin'; S.recoShared = share; S.reco = null; }
    return render(true);
  }
  if (!EMAIL_OK(F.email)) return toast('Adresse e-mail à vérifier.');
  if (!F.knows) return toast('Coche « Je connais cette personne ».');
  if (TURNSTILE_SITEKEY && !S.captcha) return toast('Vérification anti-robot en cours : patiente une seconde, puis réessaie.');
  const tok = S.captcha || ''; // 5.12.1 · n° 235 : le jeton se lit AVANT de redessiner (render() remonte le widget et remet S.captcha à zéro)
  S.recoBusy = true; render(true);
  try {
    const { data, error } = await sb.functions.invoke('recommander-club', { body: { first: share ? F.first : '', club: F.club, email: F.email, knows: true, captcha: tok } });
    let why = ''; if (error) { try { why = (await error.context?.json?.())?.erreur || ''; } catch { why = ''; } }
    if (error || !data?.envoye) toast(why || 'Recommandation pas envoyée : réessaie plus tard.');
    else { S.recoDone = true; S.recoShared = share; S.reco = null; }
  } catch { toast('Recommandation pas envoyée : réessaie plus tard.'); }
  S.captcha = null; S.recoBusy = false; render(true);
};
INPUTS.push((t) => {
  const f = t.closest && t.closest('#recof'); if (!f || !t.name) return false;
  S.reco = S.reco || {}; S.reco[t.name] = t.type === 'checkbox' ? t.checked : t.value; return true;
});

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
    <div class="det">${r.first_name || r.email ? `Demandé par <b>${esc(r.first_name)} ${esc(r.last_name)}</b> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : 'Demande <b>anonyme</b> : le club ne saura pas qui l’a faite.'}</div>
    <div class="chips"><span class="pill ${r.age_ok ? 'ok' : 'ko'}">${r.age_ok ? '15 ans ou plus' : 'âge non confirmé'}</span><span class="pill ${r.consent ? 'ok' : 'ko'}">${r.consent ? 'nom transmissible au club' : 'sans accord'}</span>${r.user_id ? '<span class="pill blue">adhérent</span>' : '<span class="pill">visiteur</span>'}${outPill(o)}</div>
    ${o && o.email ? `<div class="det">Adresse du club : ${esc(o.email)} · source : ${esc(o.source)}${o.source_url ? ` (<a href="${esc(o.source_url)}" target="_blank" rel="noopener">lien</a>)` : ''}</div>` : ''}
    <div class="btns">${btn}${r.status === 'new' ? `<button class="btn small ghost" data-act="creqdone" data-id="${r.id}">Marquer comme traitée</button>` : `<button class="btn small ghost" data-act="creqreopen" data-id="${r.id}">Remettre à traiter</button>`}</div></div>`; };
  return head + `<main class="bd"><p class="note">Chaque demande t’envoie une notification. Cherche l’adresse publiée du club (l’adresse générale d’abord), puis envoie : une relance au plus, ${RELANCE_DAYS} jours après.</p><div class="sec"><h2>À traiter</h2><span class="det">${open.length}</span></div>${open.length ? open.map(card).join('') : '<p class="empty">Aucune demande en attente.</p>'}${done.length ? `<details class="card flat"><summary>Traitées (${done.length})</summary>${done.map(card).join('')}</details>` : ''}</main>`;
}
// Texte de l'e-mail au dirigeant, validé par Gaël le 13 novembre 2026 (même texte que la fonction serveur, clubOutreachMail)
function mailText(r, relance = false) {
  const n = sameClub(r).filter((x) => x.consent).length || 1, last = sameClub(r).filter((x) => x.consent)[0] || { first_name: '', last_name: '' };
  return {
    subject: `${relance ? 'Relance · ' : ''}Un membre de ton club voudrait utiliser ${BRAND.name}`,
    body: `Bonjour,
${relance ? '\nJe me permets de te relancer, une seule fois, au sujet de ce message.\n' : ''}
Un membre de ton club${last.first_name ? ', ' + last.first_name + ' ' + last.last_name + ',' : ''} voudrait que ${r.club_name}${r.city ? ' (' + r.city + ')' : ''} soit sur ${BRAND.name}.${n > 1 ? ` ${n} membres de ton club ont fait cette demande.` : ''}

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
export const V37_TOP = { creq: () => recoScreen(), creqs: () => creqsScreen(), creqmail: (v) => creqMailScreen(v), reco: () => recoScreen() };
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
  // 5.13.0 · n° 236 : « Mon club n'est pas dans la liste » ouvre le chemin unique, déjà sur « Non, pas d'e-mail », avec les mots cherchés
  creq: () => { S.recoDone = false; S.reco = { has: 'non', club: S.ps?.done || '' }; S.view = { type: 'reco' }; render(); },
  reco: () => { S.recoDone = false; S.reco = S.reco || {}; S.view = { type: 'reco' }; render(); }, // 5.12.0 · n° 162
  recohas: (el, d) => { S.reco = { ...(S.reco || {}), has: d.v }; render(true); },
  recoshare: (el, d) => { S.reco = { ...(S.reco || {}), share: d.v }; render(true); },
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
