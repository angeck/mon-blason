// mypocketclub · alpha 3.5.0 : vérification des heures (n° 75), ordre des blocs des espaces (n° 76),
// résultats sur l'Accueil (n° 77), équipe en entente (n° 78).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_5_0.sql) ; l'écran n'est qu'un confort.
import {
  S, sb, esc, run, toast, render, refresh, ACTIONS, FORMS, CHANGES, club, isPresident, hasArea, coachOf, coachTeams, follows, iPlayIn, myKidsIn,
  evTeams, teamName, teamsLabel, name, plural, store, fmtShort, team,
} from './core.js';
import { BRAND } from '../config.js';
import { icon, field } from './ui.js';
import { scoreSum } from './agenda.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthOf = (d) => { const x = new Date(d + (String(d).length === 10 ? 'T12:00' : '')); return MONTHS[x.getMonth()]; };
const de = (m) => (/^[aeiouy]/.test(m) ? 'd’' : 'de ') + m;
const hFmt = (min) => { const h = Math.floor(min / 60), r = min % 60; return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : ''); };
const ymd = (d) => d.toLocaleDateString('sv-SE');

// ---------- n° 76 · ordre des blocs, propre à la personne et à la casquette ----------
// blocks : [{ id, label, html, pin }] ; les cartes d'alerte (pin) restent toujours en tête
export function arrange(key, blocks) {
  blocks = blocks.filter((b) => b.html);
  const saved = S.prefs?.['order:' + key] || [], pins = blocks.filter((b) => b.pin), rest = blocks.filter((b) => !b.pin);
  // n° 76 (9 novembre 2026) : un bloc peu utile se masque (œil barré) en mode « Réorganiser » ; il revient de la même façon
  const hid = new Set(S.prefs?.['hide:' + key] || []);
  rest.sort((a, b) => { const ia = saved.indexOf(a.id), ib = saved.indexOf(b.id); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
  const on = S.reorg === key, nh = rest.filter((b) => hid.has(b.id)).length;
  let h = pins.map((b) => b.html).join('');
  if (rest.length > 1) h += `<div class="btns" style="justify-content:flex-end">${on ? `<button class="btn ghost small" data-act="reorgreset" data-id="${esc(key)}">Remettre l’ordre par défaut</button><button class="btn main small" data-act="reorg" data-id="">Terminé</button>` : `${nh ? `<span class="det" style="align-self:center">${plural(nh, 'bloc masqué', 'blocs masqués')}</span>` : ''}<button class="btn ghost small" data-act="reorg" data-id="${esc(key)}">Réorganiser</button>`}</div>`;
  h += rest.map((b, i) => (on
    ? `<div class="blk${hid.has(b.id) ? ' off' : ''}"><div class="blkbar"><b>${esc(b.label)}${hid.has(b.id) ? ' · masqué' : ''}</b><button data-act="blkhide" data-id="${esc(b.id)}" aria-pressed="${hid.has(b.id)}" aria-label="${hid.has(b.id) ? 'Réafficher' : 'Masquer'} ${esc(b.label)}">${eye(hid.has(b.id))}</button><button data-act="blkmv" data-id="${esc(b.id)}" data-v="-1" aria-label="Monter ${esc(b.label)}" ${i ? '' : 'disabled'}>▲</button><button data-act="blkmv" data-id="${esc(b.id)}" data-v="1" aria-label="Descendre ${esc(b.label)}" ${i < rest.length - 1 ? '' : 'disabled'}>▼</button></div>${hid.has(b.id) ? '' : b.html}</div>`
    : hid.has(b.id) ? '' : `<div class="blk" data-blk="${esc(b.id)}">${b.html}</div>`)).join('');
  S.reorgIds = on ? rest.map((b) => b.id) : S.reorgIds;
  return h;
}
// œil ouvert (bloc visible : toucher pour masquer) ou barré (bloc masqué : toucher pour réafficher)
const eye = (off) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${off ? '<path d="M3 3l18 18"/>' : ''}</svg>`;
async function saveHidden(key, ids) {
  S.prefs = S.prefs || {}; S.prefs['hide:' + key] = ids;
  await run(sb.from('user_prefs').upsert({ user_id: S.me.id, key: 'hide:' + key, value: ids, updated_at: new Date().toISOString() }));
}
async function saveOrder(key, ids) {
  S.prefs = S.prefs || {}; S.prefs['order:' + key] = ids;
  try { store.set('pc_order_' + key, JSON.stringify(ids)); } catch { /* */ }
  await run(sb.from('user_prefs').upsert({ user_id: S.me.id, key: 'order:' + key, value: ids, updated_at: new Date().toISOString() }));
}

// ---------- n° 75 · « As-tu vérifié tes heures ? » ----------
const myPending = () => S.hconf.filter((c) => c.user_id === S.me.id && !c.confirmed_at).map((c) => ({ c, k: S.hchecks.find((k) => k.id === c.check_id) })).filter((x) => x.k);
export function hoursHome() {
  return myPending().map(({ c, k }) => {
    const m = monthOf(k.month);
    return `<div class="card yellow"><span class="kick" style="color:var(--pc-texte-ecran)">Heures des coachs</span><b style="font-family:var(--pc-titre);font-size:22px;line-height:1.1">As-tu vérifié tes heures ${de(m)} ?</b><button class="btn ghost small" data-act="hcdetail" data-id="${k.month}" style="align-self:flex-start">${hFmt(c.minutes)} déclarées · voir le détail</button><div class="btns"><button class="btn main small" data-act="hcok" data-id="${k.id}">${icon('check', 18, 'currentColor', 3)}C’est bon</button><button class="btn ghost small" data-act="hcdetail" data-id="${k.month}">Je corrige</button></div><p class="note">Après « C’est bon », les heures ${de(m)} sont figées : une correction passe par le trésorier ou le président.</p></div>`;
  }).join('');
}
const managers = () => isPresident() || hasArea('tresorerie');
export function hoursCheckBlock() {
  if (!managers()) return '';
  const last = new Date(); last.setDate(1); last.setMonth(last.getMonth() - 1);
  const k = S.hchecks[0];
  let h = `<div class="sec"><h2>Heures des coachs</h2><button data-act="choursb">Relevés</button></div><div class="card">`;
  if (k) {
    const rows = S.hconf.filter((c) => c.check_id === k.id), ok = rows.filter((c) => c.confirmed_at), late = rows.filter((c) => !c.confirmed_at);
    h += `<div class="sec" style="margin:0"><b>${monthOf(k.month)[0].toUpperCase() + monthOf(k.month).slice(1)} ${String(k.month).slice(0, 4)}</b><span class="pill ${late.length ? 'wait' : 'ok'}">${ok.length} / ${rows.length} coachs ont confirmé</span></div>`;
    if (late.length) h += `<div class="list">${late.map((c) => `<div class="row static"><span class="g">${esc(name(c.user_id))}<small>${hFmt(c.minutes)} déclarées${c.relanced_at ? ' · relancé le ' + new Date(c.relanced_at).toLocaleDateString('fr-FR') : ''}</small></span><button class="btn small ghost" style="flex:none" data-act="hcrel" data-id="${k.id}" data-u="${c.user_id}" ${c.relanced_at && Date.now() - new Date(c.relanced_at) < 864e5 ? 'disabled' : ''}>Relancer</button></div>`).join('')}</div>`;
    else h += '<p class="note">Tous les coachs ont vérifié leurs heures : tu peux faire les comptes.</p>';
  }
  const S0 = S.hcform || { month: ymd(last).slice(0, 7), who: 'all', users: [] };
  const coaches = [...new Set(S.members.filter((m) => m.status === 'active' && m.role === 'coach').map((m) => m.user_id))];
  if (S.hcform) {
    h += `<form id="hcf" class="card flat">${field('hcm', 'Période', `<input id="hcm" name="month" type="month" value="${esc(S0.month)}" max="${ymd(new Date()).slice(0, 7)}" required>`)}
    <div class="field"><span class="lab">Coachs</span><div class="chips"><button type="button" class="chip" data-act="hcwho" data-v="all" aria-pressed="${S0.who === 'all'}">Tous les coachs (${coaches.length})</button><button type="button" class="chip" data-act="hcwho" data-v="some" aria-pressed="${S0.who === 'some'}">Coachs choisis</button></div></div>
    ${S0.who === 'some' ? `<div class="card flat" style="gap:0">${coaches.map((u) => `<label class="check" style="padding:6px 0"><input type="checkbox" data-hcu="${u}" ${S0.users.includes(u) ? 'checked' : ''}><span>${esc(name(u))}</span></label>`).join('')}</div>` : ''}
    <div class="btns"><button class="btn main" type="submit">Envoyer la demande</button><button type="button" class="btn ghost" data-act="hcform" data-v="0">Annuler</button></div></form>`;
  } else h += `<button class="btn ${k ? 'ghost' : 'main'} small" data-act="hcform" data-v="1">${icon('check', 18)}Demander la vérification des heures</button>`;
  return h + '<p class="note">Chaque coach reçoit une notification et une carte « As-tu vérifié tes heures ? ». Tu es prévenu une seule fois, quand tous ont répondu.</p></div>';
}
FORMS.hcf = async (v) => {
  const f = S.hcform, users = f.who === 'some' ? f.users : null;
  if (f.who === 'some' && !users.length) return toast('Choisis au moins un coach.');
  const n = await run(sb.rpc('ask_hours_check', { p_club: S.clubId, p_month: v.month + '-01', p_users: users }));
  if (n !== null) { toast(plural(n, 'coach prévenu', 'coachs prévenus') + '.'); S.hcform = null; await refresh(); }
};

// ---------- n° 77 · résultats ----------
const linked = (e) => evTeams(e).some((t) => coachOf(t) || iPlayIn([t]) || myKidsIn([t]).length || follows(t));
const fresh = (e) => e.scores?.length && e.score_at && Date.now() - new Date(e.score_at) < 3 * 864e5;
export function resultsHome() {
  const list = S.events.filter((e) => fresh(e) && linked(e) && !store.get('pc_sr_' + e.id)).sort((a, b) => b.score_at.localeCompare(a.score_at)).slice(0, 3);
  return list.map((e) => { const s = scoreSum(e), d = new Date(e.starts_at).toLocaleDateString('fr-FR', { weekday: 'long' }); return `<button class="card" data-act="scread" data-id="${e.id}" style="border:0;text-align:left;font:inherit;color:inherit;border-left:6px solid ${s.k === 'v' ? 'var(--pc-oui-texte)' : s.k === 'd' ? 'var(--pc-non-texte)' : 'var(--pc-trait)'}"><span class="kick">Résultat · ${esc(teamsLabel(evTeams(e)))} · ${esc(d)}</span><b style="font-family:var(--pc-titre);font-size:20px">${esc(e.type === 'Match' ? s.text : e.type + ' · ' + s.text)}</b><span class="det">Toucher pour le détail</span></button>`; }).join('');
}
export function clubResults() {
  const list = S.events.filter((e) => e.scores?.length).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 5);
  if (!list.length) return '';
  return `<div class="sec"><h2>Derniers résultats du club</h2></div><div class="card"><div class="list">${list.map((e) => { const s = scoreSum(e); return `<button class="row" data-act="event" data-id="${e.id}"><span class="g">${esc(teamsLabel(evTeams(e)))} · ${esc(fmtShort(e.starts_at).split(' · ')[0])}<small>${esc(s.text)}</small></span><span class="pill res-${s.k}">${s.k === 'v' ? 'V' : s.k === 'd' ? 'D' : 'N'}</span></button>`; }).join('')}</div></div>`;
}

// ---------- n° 78 · équipe en entente ----------
const PSTATE = { demandee: ['En attente du club partenaire', 'wait'], acceptee: ['Entente confirmée', 'ok'], refusee: ['Entente non confirmée', 'ko'], invitee: ['Club invité', 'blue'] };
const canPartner = (t) => coachOf(t.id) || hasArea('technique') || isPresident();
export function partnerBlock(t) {
  if (!t) return '';
  const st = t.partner_state || 'aucune', mine = S.players.filter((p) => p.team_id === t.id && !p.deleted_at), partners = mine.filter((p) => p.from_partner);
  let h = `<div class="sec"><h2>Entente</h2></div><div class="card">`;
  if (st === 'aucune' && !S.pf && t.partner_hidden) return ''; // n° 117 : invitation masquée (réaffichable dans les réglages de l'équipe)
  if (st === 'aucune' && !S.pf) {
    h += '<p class="note">Une équipe en entente réunit des joueurs de deux clubs. Ton club porte l’équipe (agenda, matchs, convocations) ; les joueurs du club partenaire n’entrent jamais dans ta trésorerie.</p>';
    return h + (canPartner(t) ? `<div class="btns"><button class="btn ghost small" data-act="pfopen" data-id="${t.id}">Équipe en entente</button><button class="btn ghost small" data-act="pfhide" data-id="${t.id}">Masquer</button></div><p class="note">« Masquer » retire cette invitation pour tous les coachs de l’équipe. Tu peux la réafficher dans les réglages de l’équipe.</p>` : '') + '</div>';
  }
  if (S.pf?.tid === t.id) {
    const P = S.pf;
    h += `<div class="chips"><button type="button" class="chip" data-act="pfmode" data-v="in" aria-pressed="${P.mode === 'in'}">Club sur ${esc(BRAND.name)}</button><button type="button" class="chip" data-act="pfmode" data-v="out" aria-pressed="${P.mode === 'out'}">Club absent</button></div>`;
    if (P.mode === 'in') {
      h += field('pfq', 'Chercher le club partenaire', `<input id="pfq" type="search" value="${esc(P.q || '')}" placeholder="Nom ou ville" data-pfq="1">`);
      h += (P.res || []).length ? `<div class="list">${P.res.filter((c) => c.id !== S.clubId).map((c) => `<button class="row" data-act="pfpick" data-id="${c.id}"><span class="g">${esc(c.name)}<small>${esc(c.city || '')}</small></span><span class="pill blue">Choisir</span></button>`).join('')}</div>` : P.q ? '<p class="note">Aucun club trouvé. Essaie « Club absent » pour l’inviter.</p>' : '';
    } else {
      h += `<form id="pff" class="card flat">${field('pfn', 'Nom du club partenaire', '<input id="pfn" name="name" required maxlength="80">')}${field('pfr', 'Responsable (nom)', '<input id="pfr" name="rname" maxlength="80">')}<div class="grid2">${field('pfe', 'E-mail', '<input id="pfe" name="email" type="email" maxlength="120">')}${field('pfp', 'Téléphone', '<input id="pfp" name="phone" type="tel" maxlength="30">')}</div><p class="note">Ces coordonnées ne servent qu’à cette invitation.</p><button class="btn main" type="submit">Enregistrer et inviter</button></form>`;
    }
    return h + '<button class="btn ghost small" data-act="pfclose">Annuler</button></div>';
  }
  const [lab, cls] = PSTATE[st] || ['', ''];
  h += `<div class="sec" style="margin:0"><b>${esc(t.partner_name || 'Club partenaire')}</b><span class="pill ${cls}">${esc(lab)}</span></div>`;
  h += `<div class="det">${plural(mine.length - partners.length, 'joueur de notre club', 'joueurs de notre club')} · ${plural(partners.length, 'joueur du club partenaire', 'joueurs du club partenaire')}</div>`;
  if (st === 'invitee' && canPartner(t)) h += `<button class="btn main small" data-act="pfshare" data-id="${t.id}">${icon('share', 18)}Envoyer l’invitation</button>`;
  if (canPartner(t)) h += `<button class="btn ghost small" data-act="pfoff" data-id="${t.id}">Retirer l’entente</button>`;
  return h + '<p class="note">Sur la fiche de chaque joueur, choisis son club : « Notre club » (par défaut) ou le club partenaire.</p></div>';
}
const inviteText = (t) => `${club()?.name || 'Notre club'} a créé l’équipe ${t.name} en entente avec votre club sur ${BRAND.name} ; rejoignez-la pour suivre vos joueurs : ${location.origin + location.pathname}`;
// Demandes reçues par le club partenaire (président et Technique)
export function partnerRequests() {
  const L = S.partnerTeams || []; if (!L.length) return '';
  return `<div class="sec"><h2>Ententes avec d’autres clubs</h2></div><div class="card"><div class="list">${L.map((x) => `<div class="row static" style="flex-wrap:wrap"><span class="g" style="flex:1 1 100%">${esc(x.team_name)} · porté par ${esc(x.host_club)}<small>${x.coaches ? 'Coach : ' + esc(x.coaches) + ' · ' : ''}${plural(x.players_count, 'joueur')}${(x.my_players || []).length ? ' · de chez nous : ' + esc(x.my_players.join(', ')) : ''}</small></span>${x.state === 'demandee' ? `<button class="btn small main" data-act="pfans" data-id="${x.team_id}" data-v="1">Accepter</button><button class="btn small ghost" data-act="pfans" data-id="${x.team_id}" data-v="0">Refuser</button>` : `<span class="pill ${PSTATE[x.state]?.[1] || ''}">${esc(PSTATE[x.state]?.[0] || '')}</span>`}</div>`).join('')}</div></div>`;
}
FORMS.pff = async (v) => {
  const t = team(S.pf.tid);
  const st = await run(sb.rpc('set_team_partner', { p_team: t.id, p_club: null, p_name: v.name.trim(), p_contact: { name: v.rname || '', email: v.email || '', phone: v.phone || '' } }));
  if (st) { S.pf = null; await refresh(); ACTIONS.pfshare(null, { id: t.id, email: v.email, phone: v.phone }); }
};

Object.assign(ACTIONS, {
  reorg: (el, d) => { S.reorg = d.id || null; render(true); },
  reorgreset: async (el, d) => { await saveOrder(d.id, []); await saveHidden(d.id, []); toast('Ordre par défaut remis, tous les blocs réaffichés.'); render(true); },
  blkhide: async (el, d) => { const l = new Set(S.prefs?.['hide:' + S.reorg] || []); l.has(d.id) ? l.delete(d.id) : l.add(d.id); await saveHidden(S.reorg, [...l]); render(true); },
  blkmv: async (el, d) => { const ids = [...(S.reorgIds || [])], i = ids.indexOf(d.id), j = i + +d.v; if (i < 0 || j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await saveOrder(S.reorg, ids); render(true); },
  hcok: async (el, d) => { const n = await run(sb.rpc('confirm_hours', { p_check: d.id }), 'Merci, c’est noté.'); if (n !== null) { const c = S.hconf.find((x) => x.check_id === d.id && x.user_id === S.me.id); if (c) c.confirmed_at = new Date().toISOString(); render(true); } },
  hcdetail: (el, d) => ACTIONS.chours(null, { month: d.id }),
  hcform: (el, d) => { const last = new Date(); last.setDate(1); last.setMonth(last.getMonth() - 1); S.hcform = d.v === '1' ? { month: ymd(last).slice(0, 7), who: 'all', users: [] } : null; render(true); },
  hcwho: (el, d) => { const m = document.getElementById('hcm'); if (m) S.hcform.month = m.value; S.hcform.who = d.v; render(true); },
  hcrel: async (el, d) => { const n = await run(sb.rpc('relance_hours', { p_check: d.id, p_user: d.u })); if (n !== null) { toast('Relance envoyée.'); const c = S.hconf.find((x) => x.check_id === d.id && x.user_id === d.u); if (c) c.relanced_at = new Date().toISOString(); render(true); } },
  scread: (el, d) => { store.set('pc_sr_' + d.id, '1'); S.view = { type: 'event', id: d.id }; render(); },
  pfhide: async (el, d) => { if (await run(sb.rpc('set_partner_hidden', { p_team: d.id, p_hidden: true }), 'Invitation masquée pour l’équipe.')) await refresh(); },
  pfshow: async (el, d) => { if (await run(sb.rpc('set_partner_hidden', { p_team: d.id, p_hidden: false }), 'Invitation réaffichée.')) await refresh(); },
  pfopen: (el, d) => { S.pf = { tid: d.id, mode: 'in', q: '', res: [] }; render(true); },
  pfclose: () => { S.pf = null; render(true); },
  pfmode: (el, d) => { S.pf.mode = d.v; render(true); },
  pfpick: async (el, d) => { const st = await run(sb.rpc('set_team_partner', { p_team: S.pf.tid, p_club: d.id, p_name: null, p_contact: null }), 'Demande envoyée au président du club partenaire.'); if (st) { S.pf = null; await refresh(); } },
  pfoff: async (el, d) => { if (!confirm('Retirer l’entente ? Les joueurs du club partenaire redeviennent « Notre club ».')) return; if (await run(sb.rpc('set_team_partner', { p_team: d.id, p_club: null, p_name: null, p_contact: null }), 'Entente retirée.')) await refresh(); },
  pfans: async (el, d) => { if (await run(sb.rpc('answer_partner', { p_team: d.id, p_accept: d.v === '1' }), d.v === '1' ? 'Entente acceptée.' : 'Entente refusée.')) await refresh(); },
  pfshare: async (el, d) => {
    const t = team(d.id); if (!t) return; const txt = inviteText(t), c = t.partner_contact || {};
    if (navigator.share) { try { await navigator.share({ title: 'Équipe en entente', text: txt }); return; } catch { /* annulé */ } }
    const mail = d.email || c.email, tel = d.phone || c.phone;
    if (mail) location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent('Équipe ' + t.name + ' en entente')}&body=${encodeURIComponent(txt)}`;
    else if (tel) location.href = `sms:${tel.replace(/\s/g, '')}?body=${encodeURIComponent(txt)}`;
    else { try { await navigator.clipboard.writeText(txt); toast('Invitation copiée : colle-la dans un SMS ou un e-mail.'); } catch { toast(txt); } }
  },
});
let pfTimer = null;
CHANGES.push(async (t) => {
  if (t.dataset.hcu) { const u = t.dataset.hcu, L = S.hcform.users; S.hcform.users = t.checked ? [...L, u] : L.filter((x) => x !== u); return true; }
  return false;
});
document.addEventListener('input', (ev) => {
  const t = ev.target; if (!t.dataset?.pfq) return;
  S.pf.q = t.value; clearTimeout(pfTimer);
  pfTimer = setTimeout(async () => {
    const r = S.pf.q.trim().length >= 2 ? await sb.rpc('public_search_clubs', { p_query: S.pf.q.trim(), p_sport: null }) : { data: [] };
    if (!S.pf) return; S.pf.res = Array.isArray(r.data) ? r.data.slice(0, 8) : []; const pos = t.selectionStart; render(true);
    const n = document.getElementById('pfq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } }
  }, 300);
});
