// mypocketclub · bêta 1.7.0 (Gaël, 23 novembre 2026) · maquettes : https://claude.ai/artifact/55iSQXMWLmzBZWSrZzpWBx
//   n° 292 : « Signaler un problème » depuis un rendez-vous (matériel ou humain), lu dans les stats ;
//   n° 295 : le coach choisit une fois pour toutes ce que la convocation montre de lui ;
//   n° 293 : joueur prêté (il joue ailleurs, licence chez nous) / joueur en prêt (il joue chez nous, licence ailleurs) ;
//   n° 78 suites : sondages partagés entre les deux clubs d'une entente, coordonnées des joueurs de l'autre club pour le coach.
// Chaque droit est vérifié par la base (supabase/beta_1_7_0.sql) ; l'écran n'est qu'un confort.
import { S, sb, esc, run, toast, render, refresh, ACTIONS, FORMS, INPUTS, CHANGES, hooks, coachTeams, isPresident, isVP, hasArea, evTeams, teamName, teamsLabel, playersOfTeam, plural } from './core.js';
import { icon, header } from './ui.js';
import { V310_VIEWS } from './v310.js';
import { canCallRoll } from './agenda.js';
import { micBtn } from './dictee.js';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

// ---------------------------------------------------------------------
// N° 292 · signaler un problème
// ---------------------------------------------------------------------
const canReport = (e) => !!e && !e.cancelled && (canCallRoll(e) || isPresident() || isVP() || hasArea('technique'));
// bouton dans la page du rendez-vous (agenda.js)
hooks.reportBtn = (e) => (canReport(e) ? `<button class="btn ghost repbtn" data-act="repnew" data-id="${e.id}">${icon('flag', 20)}Signaler un problème</button>` : '');
const keepRep = () => { const t = document.getElementById('repbody'), p = document.getElementById('repplayer'); if (S.rep) { if (t) S.rep.body = t.value; if (p) S.rep.player = p.value; } };
INPUTS.push((t) => { if (t.id === 'repbody' && S.rep) { S.rep.body = t.value; return true; } return false; });
function reportPage() {
  const R = S.rep, e = R && S.events.find((x) => x.id === R.eid); if (!e) return '<p class="empty">Rendez-vous introuvable.</p>';
  const pres = isPresident(), dt = !pres && hasArea('technique'), hum = R.kind === 'humain';
  const kids = [...new Map(evTeams(e).flatMap((t) => playersOfTeam(t)).map((p) => [p.id, p])).values()].sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));
  let h = `<div class="card lift"><div class="det">${esc(e.title)} · ${esc(day(e.starts_at))}${evTeams(e).length ? ' · ' + esc(teamsLabel(evTeams(e))) : ''}</div>
  <div class="stseg repseg" role="group" aria-label="Type de problème"><button type="button" data-act="repkind" data-k="materiel" aria-pressed="${!hum}">Matériel</button><button type="button" data-act="repkind" data-k="humain" aria-pressed="${hum}">Humain</button></div>`;
  if (hum) h += `<div class="field"><label for="repplayer">Enfant concerné (liste de l’équipe)</label><select id="repplayer"><option value="">Choisir dans l’équipe</option>${kids.map((p) => `<option value="${p.id}" ${R.player === p.id ? 'selected' : ''}>${esc(p.first_name)} ${esc((p.last_name || '').slice(0, 1))}${p.last_name ? '.' : ''}</option>`).join('')}</select></div>`;
  h += `<div class="field"><label for="repbody">${hum ? 'Ce qui s’est passé' : 'Le problème'}</label><textarea id="repbody" rows="4" maxlength="2000" placeholder="${hum ? 'Décris les faits, sans jugement.' : 'Ex. : filet déchiré, ballons manquants, salle fermée'}">${esc(R.body || '')}</textarea>${micBtn('repbody', 'Dicter')}</div>`;
  if (hum) h += '<p class="note repmed">Pas d’information médicale ici (ni maladie, ni blessure, ni traitement).</p>';
  const send = pres ? '' : dt
    ? '<p class="note">L’envoi va au président.</p>'
    : `<div class="field"><span class="lab">Envoyer à</span><div class="chips"><button type="button" class="chip" data-act="repdest" data-v="dt_president" aria-pressed="${R.dest !== 'president'}">DT et président</button><button type="button" class="chip" data-act="repdest" data-v="president" aria-pressed="${R.dest === 'president'}">Président seul</button></div></div>`;
  h += send;
  h += '<div class="btns">';
  if (hum || pres) h += `<button class="btn ${pres ? 'main' : 'ghost'}" data-act="repsave">${hum ? 'Enregistrer dans les stats' : 'Enregistrer'}</button>`;
  if (!pres) h += `<button class="btn main" data-act="repsend">${icon('check', 18)}Envoyer</button>`;
  h += '</div>';
  h += `<p class="note">${pres ? 'Tu es président : rien n’est envoyé. Le signalement reste dans les stats ; à toi de décider de la suite.' : hum ? '« Enregistrer » : le signalement va dans les stats, lu seulement par le coach de l’équipe, le directeur technique, le vice-président et le président.' : 'Les destinataires reçoivent une notification (sans le texte).'}</p></div>`;
  return h;
}
V310_VIEWS.evreport = () => ({ head: header({ back: true, kicker: 'Rendez-vous', title: 'Signaler un problème' }), body: reportPage() });
async function sendReport(dest) {
  keepRep(); const R = S.rep; if (!R) return;
  if (R.kind === 'humain' && !R.player) return toast('Choisis l’enfant dans la liste de l’équipe.');
  if (!(R.body || '').trim()) return toast('Écris ce qui s’est passé.');
  const id = await run(sb.rpc('report_event', { p_event: R.eid, p_kind: R.kind, p_player: R.kind === 'humain' ? R.player : null, p_body: R.body.trim(), p_send: dest }));
  if (id) { toast(dest ? 'Signalement envoyé.' : 'Signalement enregistré dans les stats.'); S.rep = null; S.reps = null; ACTIONS.back ? ACTIONS.back() : render(); }
}
Object.assign(ACTIONS, {
  repnew: (el, d) => { S.rep = { eid: d.id, kind: 'materiel', body: '', player: '', dest: 'dt_president' }; S.view = { type: 'evreport', id: d.id }; render(); },
  repkind: (el, d) => { keepRep(); S.rep.kind = d.k; render(true); },
  repdest: (el, d) => { keepRep(); S.rep.dest = d.v; render(true); },
  repsave: () => sendReport(null),
  repsend: () => sendReport(isPresident() ? null : hasArea('technique') ? 'president' : S.rep?.dest || 'dt_president'),
});
// Liste des signalements, en bas des stats d'une équipe (coach.js) : seulement ce que la personne peut lire (vérifié par la base)
hooks.reportsBlock = (team) => {
  if (!team || !S.clubId) return '';
  if (!S.reps || S.reps.team !== team) {
    S.reps = { team, list: null };
    sb.rpc('event_reports_list', { p_club: S.clubId, p_team: team }).then(({ data }) => { if (S.reps?.team === team) { S.reps.list = data || []; render(true); } });
    return '';
  }
  const L = S.reps.list; if (!L?.length) return '';
  return `<div class="sec"><h2>Signalements</h2><span class="det">${L.length}</span></div><div class="card"><div class="list">${L.map((r) => `<div class="row static"><span class="g"><b>${r.kind === 'humain' ? 'Humain' : 'Matériel'}${r.player_name ? ' · ' + esc(r.player_name) : ''}</b> · ${esc(r.event_title)} · ${esc(day(r.event_at))}<small style="white-space:pre-line">${esc(r.body)}</small><small>${esc(r.author_name)} · ${r.sent_to === 'president' ? 'envoyé au président' : r.sent_to === 'dt_president' ? 'envoyé au DT et au président' : 'enregistré'}</small></span></div>`).join('')}</div><p class="note">Visible du coach de l’équipe, du directeur technique, du vice-président et du président.</p></div>`;
};

// ---------------------------------------------------------------------
// N° 295 · mon contact dans les convocations (Mon compte, à côté des autres coordonnées, et page « Mes équipes » du coach)
// ---------------------------------------------------------------------
hooks.coachContactCard = () => {
  if (!S.clubId || !coachTeams().length) return '';
  if (!S.cc || S.cc.club !== S.clubId) {
    S.cc = { club: S.clubId, v: null };
    sb.rpc('my_coach_contact', { p_club: S.clubId }).then(({ data }) => { if (S.cc?.club === S.clubId) { S.cc.v = data || {}; render(true); } });
    return '';
  }
  const v = S.cc.v; if (!v) return '';
  const box = (k, ic, l, val) => `<label class="check"><input type="checkbox" data-ccset="${k}" ${v[k] ? 'checked' : ''}><span>${icon(ic, 18)} <b>${l}</b>${val ? ' · ' + esc(val) : ''}</span></label>`;
  const any = v.show_phone || v.show_sms || v.show_email;
  return `<div class="card" id="ccard" data-anchor="contactconvoc"><div class="kick">Mon contact dans les convocations</div><p class="note" style="margin:0">Rien n’est partagé tant que tu ne coches pas. Ton choix vaut pour toutes tes convocations ; tu peux le changer à tout moment.</p>
  ${box('show_phone', 'phone', 'Téléphone', S.me.phone || 'à ajouter dans « Mon profil »')}${box('show_sms', 'sms', 'SMS', S.me.phone || '')}${box('show_email', 'mail', 'E-mail', S.session?.user?.email || '')}
  <p class="note" style="margin:0">${any ? 'La convocation envoyée aux clubs reçus donne ces coordonnées à côté de ton nom.' : 'Aujourd’hui : la convocation donne ton nom et renvoie au correspondant des rencontres.'}</p></div>`;
};
CHANGES.push(async (t) => {
  if (!t.dataset.ccset || !S.cc?.v) return false;
  const v = { ...S.cc.v, [t.dataset.ccset]: t.checked };
  if (await run(sb.rpc('set_coach_contact', { p_club: S.clubId, p_phone: !!v.show_phone, p_sms: !!v.show_sms, p_email: !!v.show_email }), 'Enregistré.')) {
    S.cc.v = v; render(true);
    if ((v.show_phone || v.show_sms) && !S.me.phone) toast('Ajoute ton téléphone dans « Mon profil » pour qu’il apparaisse.');
  } else t.checked = !t.checked;
  return true;
});

export { canReport, plural, teamName, refresh, FORMS };
