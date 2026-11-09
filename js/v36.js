// mypocketclub · alpha 3.6.0 · n° 88 : cartes du coach sur l'Accueil (raccourcis vers l'Espace, pas des pages en double)
// « Prépare ta séance » : 3 jours avant chaque entraînement de ses équipes, tant que la séance n'est pas préparée
// et que le coach n'a pas touché « Non merci » (pour cette séance seulement ; « Ne plus jamais proposer » dans Mon compte).
// « Faire l'appel » : le jour de l'entraînement, du match, du plateau ou du tournoi.
import { S, sb, esc, run, render, ACTIONS, coachOf, evTeams, teamsLabel, hooks } from './core.js';
import { dayBadge } from './ui.js';

const PREP_DAYS = 3;
const TEAM_TYPES = ['Entraînement', 'Match', 'Plateau', 'Tournoi'];
const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const mine = (e) => !e.cancelled && evTeams(e).some(coachOf);
const prepared = (e) => (S.evPlans || []).some((p) => p.event_id === e.id);
export const prepOff = () => S.prefs?.['prep:off'] === true;

async function savePref(key, value) {
  S.prefs = S.prefs || {}; S.prefs[key] = value;
  await run(sb.from('user_prefs').upsert({ user_id: S.me.id, key, value, updated_at: new Date().toISOString() }));
}

export function coachHome() {
  const now = new Date(), until = Date.now() + PREP_DAYS * 864e5, no = new Set(S.prefs?.['prep:no'] || []);
  const evs = (S.events || []).filter(mine).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  let h = '';
  const roll = evs.find((e) => TEAM_TYPES.includes(e.type) && sameDay(new Date(e.starts_at), now) && new Date(e.starts_at) > Date.now() - 6 * 3600e3);
  if (roll && !hooks.todayOnHome) h += `<button class="card yellow" data-act="appel" data-id="${roll.id}" style="border:0;text-align:left;font:inherit;color:inherit"><span class="kick" style="color:var(--pc-encre)">Aujourd’hui · ${esc(hm(new Date(roll.starts_at)))}</span><b style="font-family:var(--pc-titre);font-size:22px">Faire l’appel</b><span>${esc(teamsLabel(evTeams(roll)))} · ${esc(roll.title)}</span></button>`;
  if (!prepOff()) {
    const prep = evs.filter((e) => e.type === 'Entraînement' && new Date(e.starts_at) > now && new Date(e.starts_at) < until && !prepared(e) && !no.has(e.id));
    h += prep.slice(0, 3).map((e) => `<div class="card pale" style="flex-direction:row;align-items:center;gap:12px">${dayBadge(e.starts_at)}<span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>Prépare ta séance</b><span class="det">${esc(teamsLabel(evTeams(e)))} · ${esc(hm(new Date(e.starts_at)))}</span><span class="btns" style="margin-top:6px"><button class="btn small main" data-act="cplanfor" data-id="${e.id}">Préparer</button><button class="btn small ghost" data-act="prepno" data-id="${e.id}">Non merci</button></span></span></div>`).join('');
  }
  return h;
}

Object.assign(ACTIONS, {
  prepno: async (el, d) => { const l = new Set(S.prefs?.['prep:no'] || []); l.add(d.id); await savePref('prep:no', [...l].slice(-60)); render(true); },
  prepoff: async () => { await savePref('prep:off', !prepOff()); render(true); },
});
