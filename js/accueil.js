// mypocketclub · accueil : ce qui attend une réponse, les prochains rendez-vous, les derniers messages.
import { S, sb, esc, fl, store, toValidate, plural, fmtDate, nick, active, club, run, render, ACTIONS, isBoard, hooks } from './core.js';
import { icon } from './ui.js';
import { homeEvents, needsAnswer, answerBlock, evCard, byDay, forLabel, isToday, canCallRoll } from './agenda.js';
import { grp } from './messages.js';
import { annoncesHome, missionsHome, otherClubsHome } from './vie.js';
import { pushHome } from './notif.js';
import { hoursHome, resultsHome } from './v35.js';
import { coachHome } from './v36.js';
import { adminHome } from './v37.js';
import { presidencyCard, clubTrashBanner } from './v310.js';
import { sendBanner, adminValidateHome } from './v43.js';

export function homeTitle() {
  const todo = homeEvents().filter(needsAnswer).length, first = S.me.nickname || S.me.first_name || '';
  return `Salut ${esc(first)} !<br>${todo ? plural(todo, 'réponse à donner', 'réponses à donner') + '.' : 'Tout est à jour.'}`;
}
export function homeTab() {
  const fut = homeEvents(), today = fut.filter(isToday), todo = fut.filter(needsAnswer), next = todo.find((e) => !isToday(e));
  let h = clubTrashBanner() + sendBanner() + presidencyCard() + contactAsk() + pushHome(); // n° 122 : encart jaune de la fonction reçue // n° 114 : club dans la corbeille, présidence proposée ; puis l'encart des notifications
  const vp = toValidate().length;
  // n° 94 : président et bureau → une seule touche, la page « Gestion du club » s'ouvre à l'endroit des demandes ; le coach garde l'onglet Club
  if (vp) h += isBoard() ? `<button class="btn main" data-act="gestion" data-v="demandes">${plural(vp, 'demande à valider', 'demandes à valider')}</button>` : `<button class="btn main" data-act="tab" data-i="4">${plural(vp, 'demande à valider', 'demandes à valider')}</button>`;
  h += todayHome(today); // n° 156 : le jour J, le rendez-vous passe en tête de l'Accueil (tous les rôles ; « Faire l'appel » pour le coach)
  h += adminValidateHome() + adminHome() + coachHome() + annoncesHome() + hoursHome() + resultsHome(); // n° 88 : cartes du coach en tête ; n° 96 : demandes de clubs (admin)
  if (next) {
    h += `<div class="card yellow"><span class="kick" style="color:var(--pc-texte-ecran)">À répondre${todo.length > 1 ? ` · 1 sur ${todo.length}` : ''}</span><button data-act="event" data-id="${next.id}" style="background:none;border:0;padding:0;text-align:left;color:inherit;display:flex;flex-direction:column;gap:2px"><b style="font-family:var(--pc-titre);font-size:26px;line-height:1.05">${esc(next.title)}</b><span style="font-size:17px">${esc(fmtDate(next.starts_at))}${next.place ? ' · ' + esc(next.place) : ''}</span></button>${answerBlock(next)}</div>`;
  }
  const rest = fut.filter((e) => e.id !== next?.id && !isToday(e)).slice(0, 8);
  h += `<div class="sec"><h2>Prochains rendez-vous</h2><button data-act="tab" data-i="1">Agenda</button></div>`;
  h += rest.length ? byDay(rest, (e) => evCard(e, { answer: true })) : `<p class="empty">${next || today.length ? 'Rien d’autre de prévu pour l’instant.' : 'Aucun rendez-vous à venir.'}</p>`;
  // n° 70 : supporteur, club ouvert au bénévolat des supporteurs, pas encore répondu
  if (club()?.supporters_volunteer && !active().some((m) => m.role !== 'supporteur') && S.me.supporter_volunteer == null)
    h += `<div class="card yellow"><b style="font-family:var(--pc-titre);font-size:22px">Souhaitez-vous devenir bénévole ?</b><p>Le club compte sur ses supporteurs pour l’arbitrage, la table de marque, l’aide, la buvette et les événements du club. Tu choisis tes missions.</p><div class="btns"><button class="btn small main" data-act="supvol" data-v="1">Oui</button><button class="btn small ghost" data-act="supvol" data-v="0">Non merci</button></div></div>`;
  // n° 142 (a) : membre du bureau relancé par le contact rencontres, pas encore répondu
  const asked = S.me.volunteer_asked_at, answered = S.me.volunteer_answered_at;
  if (asked && (!answered || new Date(answered) < new Date(asked)) && active().some((m) => ['president', 'bureau'].includes(m.role)))
    h += `<div class="card yellow"><b style="font-family:var(--pc-titre);font-size:22px">Souhaites-tu être bénévole ?</b><p>Le club compte sur le bureau pour l’arbitrage, la table de marque, l’aide et les événements. Tu choisis tes missions, rendez-vous par rendez-vous.</p><div class="btns"><button class="btn small main" data-act="memvol" data-v="1">Oui</button><button class="btn small ghost" data-act="memvol" data-v="0">Non merci</button></div></div>`;
  h += missionsHome() + otherClubsHome();
  const last = S.lastMsgs.slice(0, 3);
  if (last.length) h += `<div class="sec"><h2>Derniers messages</h2><button data-act="tab" data-i="2">Messages</button></div>` + last.map((m) => `<button class="card dark" data-act="group" data-id="${m.group_id}" style="flex-direction:row;align-items:center;gap:14px;border:0;text-align:left;font:inherit"><span style="width:40px;height:40px;border-radius:20px;background:var(--pc-action);display:flex;align-items:center;justify-content:center;flex:none">${icon('msg', 22, 'var(--pc-action-texte)')}</span><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(grp(m.group_id)?.name || 'Groupe')}</b><span class="det" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nick(m.user_id))} : ${esc(m.body.slice(0, 80))}</span></span></button>`).join('');
  if (!store.get('pc_hiderq_' + S.clubId) && active().length) h += `<div class="card pale"><b>Tu joues, coaches ou es parent dans une autre équipe du club ?</b><p class="note">Ajoute tes autres rôles : chacun est validé par le club.</p><div class="btns"><button class="btn small main" data-act="rqgo">Demander un autre rôle</button><button class="btn small ghost" data-act="rqhide">Ne plus afficher</button></div></div>`;
  return h;
}
// n° 156 · jour J : les rendez-vous du jour en tête, dans un cadre jaune ; le coach y fait l'appel
const ROLLT = ['Entraînement', 'Plateau', 'Match', 'Tournoi'];
hooks.todayOnHome = true; // la carte « Faire l'appel » du coach (v36) est remplacée par ce bloc
function todayHome(l) {
  if (!l.length) return '';
  return `<div class="sec"><h2>Aujourd’hui</h2></div><div class="today">${l.map((e) => evCard(e, { answer: true })
    + (ROLLT.includes(e.type) && !e.cancelled && canCallRoll(e) ? `<button class="btn ${S.att.some((x) => x.event_id === e.id) ? 'ghost' : 'main'}" data-act="appel" data-id="${e.id}">${S.att.some((x) => x.event_id === e.id) ? 'Voir l’appel' : 'Faire l’appel'}</button>` : '')).join('')}</div>`;
}
// N° 122 · encart jaune : une seule carte qui liste toutes mes fonctions du moment (dont celles reçues par défaut),
// tant que je n'ai pas confirmé ce que je montre ; « Confirmer » ouvre Mon compte à cet endroit
function contactAsk() {
  const k = S.cstate; if (!k || k.confirmed) return '';
  const extra = k.roles.filter((r) => /^Correspondant/.test(r)).map(fl), main = k.roles.filter((r) => !/^Correspondant/.test(r));
  const said = main.length ? `Tu es ${main.join(', ')}${extra.length ? ` et aussi ${extra.join(', ').toLowerCase()}` : ''}.` : `Tu es ${extra.join(', ').toLowerCase()}.`;
  return `<div class="card yellow"><span class="kick" style="color:var(--pc-texte-ecran)">Ta fonction au club</span><b style="font-family:var(--pc-titre);font-size:22px;line-height:1.1">${esc(said)}</b><p style="margin:0">Choisis ce que les membres voient de toi : ton téléphone, ton e-mail, les deux, ou rien (on t’écrira par l’application).</p><div class="btns"><button class="btn small main" data-act="contactgo">Confirmer</button></div></div>`;
}
export { forLabel };
Object.assign(ACTIONS, {
  contactgo: () => { S.view = { type: 'account' }; render(); setTimeout(() => document.getElementById('contactf')?.scrollIntoView({ block: 'start' }), 60); },
  supvol: async (el, d) => { const on = d.v === '1'; if (await run(sb.rpc('set_supporter_volunteer', { p_on: on }), on ? 'Merci ! Tu recevras les demandes de bénévoles.' : 'C’est noté. Tu peux changer d’avis dans Mon compte.')) { S.me.supporter_volunteer = on; S.me.volunteer_answered_at = new Date().toISOString(); render(true); } },
  memvol: async (el, d) => { const on = d.v === '1'; if (await run(sb.rpc('set_volunteer', { p_on: on }), on ? 'Merci ! Tu recevras les demandes de bénévoles.' : 'C’est noté. Tu peux changer d’avis dans Mon compte.')) { S.me.volunteer = on; S.me.volunteer_answered_at = new Date().toISOString(); render(true); } }, // n° 142
});
