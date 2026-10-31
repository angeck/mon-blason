// Pocket Club · accueil : ce qui attend une réponse, les prochains rendez-vous, les derniers messages.
import { S, esc, store, toValidate, plural, fmtDate, nick, active } from './core.js';
import { icon } from './ui.js';
import { homeEvents, needsAnswer, answerBlock, evCard, byDay, forLabel } from './agenda.js';
import { grp } from './messages.js';
import { annoncesHome, missionsHome, otherClubsHome } from './vie.js';

export function homeTitle() {
  const todo = homeEvents().filter(needsAnswer).length, first = S.me.nickname || S.me.first_name || '';
  return `Salut ${esc(first)} !<br>${todo ? plural(todo, 'réponse à donner', 'réponses à donner') + '.' : 'Tout est à jour.'}`;
}
export function homeTab() {
  const fut = homeEvents(), todo = fut.filter(needsAnswer), next = todo[0];
  let h = '';
  const vp = toValidate().length;
  if (vp) h += `<button class="btn main" data-act="tab" data-i="4">${plural(vp, 'demande à valider', 'demandes à valider')}</button>`;
  h += annoncesHome();
  if (next) {
    h += `<div class="card yellow"><span class="kick" style="color:var(--pc-encre)">À répondre${todo.length > 1 ? ` · 1 sur ${todo.length}` : ''}</span><button data-act="event" data-id="${next.id}" style="background:none;border:0;padding:0;text-align:left;color:inherit;display:flex;flex-direction:column;gap:2px"><b style="font-family:var(--pc-titre);font-size:26px;line-height:1.05">${esc(next.title)}</b><span style="font-size:17px">${esc(fmtDate(next.starts_at))}${next.place ? ' · ' + esc(next.place) : ''}</span></button>${answerBlock(next)}</div>`;
  }
  const rest = fut.filter((e) => e.id !== next?.id).slice(0, 8);
  h += `<div class="sec"><h2>Prochains rendez-vous</h2><button data-act="tab" data-i="1">Agenda</button></div>`;
  h += rest.length ? byDay(rest, (e) => evCard(e, { answer: true })) : `<p class="empty">${next ? 'Rien d’autre de prévu pour l’instant.' : 'Aucun rendez-vous à venir.'}</p>`;
  h += missionsHome() + otherClubsHome();
  const last = S.lastMsgs.slice(0, 3);
  if (last.length) h += `<div class="sec"><h2>Derniers messages</h2><button data-act="tab" data-i="2">Messages</button></div>` + last.map((m) => `<button class="card dark" data-act="group" data-id="${m.group_id}" style="flex-direction:row;align-items:center;gap:14px;border:0;text-align:left;font:inherit"><span style="width:40px;height:40px;border-radius:20px;background:var(--pc-bleu);display:flex;align-items:center;justify-content:center;flex:none">${icon('msg', 22, '#FFFFFF')}</span><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(grp(m.group_id)?.name || 'Groupe')}</b><span class="det" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nick(m.user_id))} : ${esc(m.body.slice(0, 80))}</span></span></button>`).join('');
  if (!store.get('pc_hiderq_' + S.clubId) && active().length) h += `<div class="card pale"><b>Tu joues, coaches ou es parent dans une autre équipe du club ?</b><p class="note">Ajoute tes autres rôles : chacun est validé par le club.</p><div class="btns"><button class="btn small main" data-act="rqgo">Demander un autre rôle</button><button class="btn small ghost" data-act="rqhide">Ne plus afficher</button></div></div>`;
  return h;
}
export { forLabel };
