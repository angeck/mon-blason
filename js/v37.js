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

// ---------- n° 96 · page Admin (Gaël) : demandes de clubs et aperçu de l'e-mail au dirigeant ----------
const SIM = `<div class="card warn" style="transform:none"><b>L’option n’est pas activée : simulation</b><span class="note" style="color:var(--pc-texte-ecran)">Aucun e-mail n’est envoyé, ni au club ni à la personne. Les coordonnées du dirigeant sont à chercher à la main.</span></div>`;
const keyOf = (r) => (String(r.club_name || '') + '|' + String(r.city || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9|]/g, '');
const sameClub = (r) => (S.creqs || []).filter((x) => keyOf(x) === keyOf(r));
function creqsScreen() {
  const head = header({ brand: true, back: true, kicker: 'Administration ' + BRAND.name, title: 'Demandes de clubs' });
  const l = S.creqs;
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  if (!l) return head + '<main class="bd"><p class="empty">Chargement…</p></main>';
  const open = l.filter((r) => r.status === 'new'), done = l.filter((r) => r.status !== 'new');
  const card = (r) => { const n = sameClub(r).length;
    return `<div class="card"><div class="kick">${esc(fmtDay(r.created_at))}${n > 1 ? ` · ${n} demandes pour ce club` : ''}</div><b style="font-size:18px">${esc(r.club_name)}</b><span class="det">${esc([r.city, r.sport].filter(Boolean).join(' · '))}</span>
    <div class="det">Demandé par <b>${esc(r.first_name)} ${esc(r.last_name)}</b> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div>
    <div class="chips"><span class="pill ${r.age_ok ? 'ok' : 'ko'}">${r.age_ok ? '15 ans ou plus' : 'âge non confirmé'}</span><span class="pill ${r.consent ? 'ok' : 'ko'}">${r.consent ? 'nom transmissible au club' : 'sans accord'}</span>${r.user_id ? '<span class="pill blue">a un compte</span>' : '<span class="pill">visiteur</span>'}</div>
    <div class="btns"><button class="btn small main" data-act="creqmail" data-id="${r.id}">${icon('mail', 18)}Aperçu de l’e-mail au dirigeant</button>${r.status === 'new' ? `<button class="btn small ghost" data-act="creqdone" data-id="${r.id}">Marquer comme traitée</button>` : `<button class="btn small ghost" data-act="creqreopen" data-id="${r.id}">Remettre à traiter</button>`}</div></div>`; };
  return head + `<main class="bd">${SIM}<div class="sec"><h2>À traiter</h2><span class="det">${open.length}</span></div>${open.length ? open.map(card).join('') : '<p class="empty">Aucune demande en attente.</p>'}${done.length ? `<details class="card flat"><summary>Traitées (${done.length})</summary>${done.map(card).join('')}</details>` : ''}</main>`;
}
// Texte du futur e-mail de démarchage (vouvoiement : texte adressé à un club)
function mailText(r) {
  const n = sameClub(r).length;
  return {
    subject: `Un membre de votre club souhaite utiliser ${BRAND.name}`,
    body: `Bonjour,

Un membre de votre club, ${r.first_name} ${r.last_name}, souhaite que le club ${r.club_name}${r.city ? ' (' + r.city + ')' : ''} soit ajouté sur ${BRAND.name}.${n > 1 ? `\n${n} membres de votre club ont fait cette demande.` : ''}

${BRAND.name} est une application pour les clubs sportifs : l’agenda avec les réponses « Je viens / Je ne viens pas », les convocations, les messages des équipes, les licences et les cotisations, au même endroit, dans la poche de chacun.

Pour en savoir plus ou inscrire votre club : https://mypocketclub.fr

Sportivement,
Gaël Raveneau, ${BRAND.name}

—
Vous recevez ce message parce qu’un membre de votre club a demandé son arrivée sur ${BRAND.name}. Pour ne plus recevoir de message de notre part : [lien de désinscription, ajouté dans la version réelle].`,
  };
}
function creqMailScreen(id) {
  const r = (S.creqs || []).find((x) => x.id === id);
  const head = header({ brand: true, back: true, kicker: 'Aperçu · aucun envoi', title: 'E-mail au dirigeant' });
  if (!r || !S.isAdmin) return head + '<main class="bd"><p class="empty">Demande introuvable.</p></main>';
  const m = mailText(r);
  return head + `<main class="bd">${SIM}<div class="card lift" style="transform:none"><div class="det">À : <i>adresse du dirigeant, à trouver à la main</i></div><div class="det">De : ${esc(BRAND.name)} &lt;contact@mypocketclub.fr&gt; (version réelle)</div><div class="det">Objet : <b>${esc(m.subject)}</b></div><hr style="border:0;border-top:1px solid var(--pc-trait);width:100%"><div style="white-space:pre-wrap;font-size:15px">${esc(m.body)}</div></div>
  <button class="btn" data-act="creqcopy" data-id="${r.id}">${icon('doc', 20)}Copier l’objet et le texte</button><p class="note">Pour l’instant, le démarchage se fait à la main depuis ta messagerie.</p></main>`;
}
async function loadCreqs() { S.creqs = (await run(sb.from('club_requests').select('*').order('created_at', { ascending: false }).limit(300))) || []; S.creqNew = S.creqs.filter((r) => r.status === 'new').length; }

// Écrans ouverts au-dessus de tout (visiteur non connecté compris pour « creq ») : lus par app.js
export const V37_TOP = { creq: () => creqScreen(), creqs: () => creqsScreen(), creqmail: (v) => creqMailScreen(v.id) };
// Carte de l'Accueil pour l'administrateur : demandes de clubs en attente
export function adminHome() {
  if (!S.isAdmin || !S.creqNew) return '';
  return `<button class="card pale" data-act="creqs" style="border:0;text-align:left;font:inherit;color:inherit"><span class="kick">Administration ${esc(BRAND.name)}</span><b>${plural(S.creqNew, 'demande de club', 'demandes de clubs')} à traiter</b><span class="det">Simulation : l’option n’est pas activée.</span></button>`;
}
export async function loadAdminCounts() {
  if (!S.isAdmin) return;
  const r = await sb.from('club_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
  S.creqNew = r.count || 0;
}

Object.assign(ACTIONS, {
  creq: () => { S.creqDone = null; S.creq = S.creq || {}; S.view = { type: 'creq' }; render(); },
  creqs: async () => { S.view = { type: 'creqs' }; S.creqs = null; render(); await loadCreqs(); render(true); },
  creqmail: (el, d) => { S.view = { type: 'creqmail', id: d.id }; render(); },
  creqdone: async (el, d) => { if (await run(sb.rpc('set_club_request', { p_id: d.id, p_status: 'done' }), 'Demande marquée comme traitée.')) { await loadCreqs(); render(true); } },
  creqreopen: async (el, d) => { if (await run(sb.rpc('set_club_request', { p_id: d.id, p_status: 'new' }), 'Demande remise à traiter.')) { await loadCreqs(); render(true); } },
  creqcopy: async (el, d) => { const r = (S.creqs || []).find((x) => x.id === d.id); if (!r) return; const m = mailText(r), t = 'Objet : ' + m.subject + '\n\n' + m.body; try { await navigator.clipboard.writeText(t); toast('Objet et texte copiés.'); } catch { toast('Copie impossible : sélectionne le texte à la main.'); } },
});
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
