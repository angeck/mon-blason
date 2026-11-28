// mypocketclub · bêta 1.9.0 · n° 311 à 314 : « Vitrine du club » dans l'application (chantier claude/74-vitrine-du-club.md,
// maquettes https://claude.ai/artifact/RzpBABgJiemheTEi7T61xg, droits validés par Gaël le 28 novembre 2026).
//   Président › onglet « Vitrine » : tout (activer ou couper, adresse, où arrivent les demandes, donner la fonction).
//   Fonction « Responsable vitrine » (ou accès « Vitrine » ouvert en plus, par ex. au contact licences) : une seule page, sans Aperçu ;
//   textes et infos, blocs montrés, créneaux et places des équipes, saison affichée, encart de rentrée.
//   La page publique elle-même (et son mode édition ↑ ↓ / œil) est dans vitrine.html + js/vitrine.js.
//   Admin › À traiter : vitrines sans blason (proposer une charte) et dates de rentrée.
import { IS_PROD } from '../config.js';
import { S, sb, esc, hooks, run, render, toast, ACTIONS, FORMS, CHANGES, armed, isArmed, isPresident, name, myFonctions, plural } from './core.js';
import { icon, field } from './ui.js';
import { BLOCKS, orderOf } from './vitrine_blocs.js';

const arr = (x) => (Array.isArray(x) ? x : []);
const NEED = 'La base n’est pas encore à jour : lance le script beta_1_9_0.sql dans Supabase.';
const pageUrl = (slug) => new URL('./' + slug, location.href.split('#')[0].replace(/[^/]*$/, '')).href;
const shownUrl = (slug) => (IS_PROD ? 'mypocketclub.fr/' + slug : pageUrl(slug).replace(/^https?:\/\//, ''));
const dayLbl = (iso) => (iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const ago = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

// ---------- chargement ----------
async function loadVit(force) {
  const cid = S.clubId; if (!cid) return;
  if (!force && S.vitClub === cid && S.vit) return;
  S.vitClub = cid;
  const r = await sb.rpc('vitrine_get', { p_club: cid });
  if (S.clubId !== cid) return;
  if (r.error) { S.vit = { error: /function|fonction|schema cache|does not exist/i.test(r.error.message || '') ? NEED : r.error.message }; return; }
  S.vit = r.data;
  const q = await sb.from('vitrine_requests').select('*').eq('club_id', cid).order('created_at', { ascending: false }).limit(60);
  S.vitReq = q.error ? [] : q.data || [];
}
const vitNow = () => {
  if (S.vitClub !== S.clubId || !S.vit) { if (!S.vitLoading) { S.vitLoading = true; loadVit(true).finally(() => { S.vitLoading = false; render(true); }); } return null; }
  return S.vit;
};
const apply = (data) => { if (data && typeof data === 'object') S.vit = data; };

// ---------- textes et infos : une ligne = un élément ----------
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30);
const two = (l, re) => { const m = re.exec(l); return m ? [m[1].trim(), m[2].trim()] : [l, '']; };
export function parseContent(v) {
  const links = lines(v.links).map((l) => { const m = /^(.*?)[\s:–-]*\s(https:\/\/\S+)$/i.exec(l) || /^()(https:\/\/\S+)$/i.exec(l); if (!m) return null; let n = m[1].replace(/[:–-]\s*$/, '').trim(); if (!n) { try { n = new URL(m[2]).hostname.replace(/^www\./, '').split('.')[0]; n = n.charAt(0).toUpperCase() + n.slice(1); } catch { n = 'Lien'; } } return [n.slice(0, 40), m[2].slice(0, 300)]; }).filter(Boolean);
  return {
    lead: String(v.lead || '').trim().slice(0, 200), presentation: String(v.presentation || '').trim().slice(0, 1500), founded: String(v.founded || '').trim().slice(0, 10),
    values: String(v.values || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => x.slice(0, 40)),
    fees: lines(v.fees).map((l) => two(l, /^(.*?)\s*:\s*(.+)$/).map((x) => x.slice(0, 80))),
    docs: lines(v.docs).map((x) => x.slice(0, 120)), when: lines(v.when).map((x) => x.slice(0, 160)), wanted: lines(v.wanted).map((x) => x.slice(0, 160)),
    palmares: lines(v.palmares).map((l) => { const p = l.split(/\s*[·|]\s*/); return p.length >= 3 ? [p[0], p[1], p.slice(2).join(' · ')] : p.length === 2 ? [p[0], '', p[1]] : ['', '', p[0]]; }).map((x) => x.map((y) => y.slice(0, 80))),
    partners: lines(v.partners).map((x) => x.slice(0, 60)), links,
  };
}
const unparse = (c = {}) => ({
  lead: c.lead || '', presentation: c.presentation || '', founded: c.founded || '', values: arr(c.values).join(', '),
  fees: arr(c.fees).map((x) => (x[1] ? `${x[0]} : ${x[1]}` : x[0])).join('\n'), docs: arr(c.docs).join('\n'), when: arr(c.when).join('\n'), wanted: arr(c.wanted).join('\n'),
  palmares: arr(c.palmares).map((x) => x.filter(Boolean).join(' · ')).join('\n'), partners: arr(c.partners).join('\n'), links: arr(c.links).map((x) => `${x[0]} : ${x[1]}`).join('\n'),
});

// ---------- encart de rentrée (page Vitrine et Accueil) ----------
function encart(v, home) {
  if (!v?.encart) return '';
  const can = +v.next_teams > 0;
  return `<div class="card yellow" data-anchor="vitenc"><span class="kick" style="color:var(--pc-texte-ecran)">Vitrine du club · rentrée</span>
    <b style="font-size:18px">Ta vitrine montre encore la saison ${esc(v.season)}</b>
    <p class="note" style="margin:0;color:inherit">${can ? `${plural(+v.next_teams, 'équipe est prête', 'équipes sont prêtes')} pour ${esc(v.next_season)} : passe la vitrine à la nouvelle saison, les familles verront les nouveaux créneaux.` : `Les familles cherchent un club en ce moment. Crée tes équipes ${esc(v.next_season)} : la vitrine montrera les nouveaux créneaux et les places.`}</p>
    <div class="btns">${can ? `<button class="btn main" data-act="vitseason" data-v="${esc(v.next_season)}">Passer à la saison ${esc(v.next_season)}</button>` : isPresident() ? `<button class="btn main" data-act="tcreateopen">Créer mes équipes ${esc(v.next_season)}</button>` : ''}
      ${home ? '<button class="btn small ghost" data-act="vitgo">Voir ma vitrine</button>' : ''}
      <button class="btn small ghost" data-act="vitlater" data-v="7">Repousser de 7 jours</button><button class="btn small ghost" data-act="vitlater" data-v="30">Repousser d’1 mois</button></div>
    ${!can && !isPresident() ? '<p class="note" style="margin:0;color:inherit">Les équipes sont créées par le président ou le directeur technique.</p>' : ''}</div>`;
}
hooks.vitrineHome = () => {
  if (!(S.areas || []).includes('vitrine') && !isPresident()) return '';
  const v = vitNow(); return v && !v.error ? encart(v, true) : '';
};

// ---------- la page « Vitrine » (président, fonction, rubrique) ----------
function statusCard(v, pres) {
  const on = v.enabled, slug = v.slug || v.suggest;
  let h = `<div class="sec"><h2>Ta vitrine</h2>${on ? '<span class="pill ok">En ligne</span>' : '<span class="pill wait">Pas activée</span>'}</div><div class="card" data-anchor="vitst">`;
  h += `<p class="note" style="margin:0">La page publique du club, remplie avec ce que tu gères déjà ici : équipes, créneaux, gymnases, matchs à domicile. Jamais un nom de joueur, jamais une coordonnée. ${IS_PROD ? '' : 'Pendant le test, elle est cachée des moteurs de recherche.'}</p>`;
  h += `<div class="row static"><span class="g">${esc(shownUrl(slug))}<small>${on ? 'Adresse de ta vitrine' : 'Adresse proposée'}</small></span>${on || v.exists ? `<button class="roundbtn" data-act="vitcopy" aria-label="Copier le lien">${icon('doc', 18)}</button>` : ''}</div>`;
  h += `<div class="btns"><a class="btn ${on ? 'main' : ''}" href="${esc(pageUrl(slug))}" target="_blank" rel="noopener">${icon('search', 20)}${on ? 'Voir la page' : 'Voir l’aperçu'}</a><a class="btn" href="${esc(pageUrl(slug))}?edit=1" target="_blank" rel="noopener">${icon('edit', 20)}Éditer la page</a></div>`;
  if (!v.exists && !on && !pres) h += '<p class="note">Le président active la vitrine quand elle est prête. Tu peux déjà la remplir et la voir en aperçu.</p>';
  if (pres) {
    h += `<label class="switch"><input type="checkbox" data-vitonoff="1" ${on ? 'checked' : ''}><span>${on ? 'Vitrine en ligne' : 'Mettre la vitrine en ligne'}</span></label>`;
    h += `<form id="vitslug" class="stack">${field('vsl', 'Adresse de la page', `<input id="vsl" name="slug" maxlength="40" required value="${esc(slug)}" pattern="[a-z0-9][a-z0-9\\-]{2,39}" autocapitalize="off" spellcheck="false">`)}
      <p class="note" style="margin:0">Lettres sans accents, chiffres et tirets. Changer l’adresse casse les liens déjà partagés.</p><div class="btns"><button class="btn small" type="submit">Enregistrer l’adresse</button></div></form>`;
  }
  return h + '</div>';
}
function whoCard(v, pres) {
  const hs = arr(v.holders);
  if (pres) {
    const others = hs.filter((u) => u !== S.me.id);
    return `<div class="sec"><h2>Qui s’occupe de la vitrine</h2></div><div class="card"><div class="list">${others.length ? others.map((u) => `<div class="row static"><span class="g">${esc(name(u))}<small>Responsable vitrine</small></span></div>`).join('') : '<div class="row static"><span class="g">Toi<small>Par défaut, le président</small></span></div>'}</div>
      <p class="note">Tu peux donner la fonction « Responsable vitrine » à un membre, ou ouvrir l’accès « Vitrine » à un membre du bureau (par exemple le contact licences). Tu gardes toujours la main.</p><button class="btn small" data-act="fonctions">${icon('team', 18)}Fonctions du bureau</button></div>`;
  }
  return `<div class="sec"><h2>Tes droits</h2></div><div class="card"><p class="note" style="margin:0">Tu remplis la page, choisis ce qui se voit et passes la vitrine à la nouvelle saison. Le président garde la mise en ligne, l’adresse et le choix de qui reçoit les demandes.</p></div>`;
}
function seasonCard(v) {
  const can = +v.next_teams > 0;
  return `<div class="sec"><h2>Saison affichée</h2><span class="pill">${esc(v.season)}</span></div><div class="card">
    <p class="note" style="margin:0">La vitrine montre les équipes et les créneaux de la saison ${esc(v.season)}.</p>
    <button class="btn ${can ? 'main' : ''}" data-act="vitseason" data-v="${esc(v.next_season)}" ${can ? '' : 'disabled'}>Passer à la saison ${esc(v.next_season)}</button>
    <p class="note" style="margin:0">${can ? plural(+v.next_teams, `équipe ${esc(v.next_season)} prête`, `équipes ${esc(v.next_season)} prêtes`) + '.' : `Possible dès qu’une équipe de la saison ${esc(v.next_season)} existe.`}</p></div>`;
}
function destCard(v, pres) {
  const opt = (k) => {
    const cur = v[k + '_to'] || '', real = v[k + '_real'];
    const people = [...new Set((S.members || []).filter((m) => m.status === 'active' && ['president', 'bureau'].includes(m.role)).map((m) => m.user_id))].sort((a, b) => name(a).localeCompare(name(b), 'fr'));
    const def = k === 'essai' ? 'Par défaut : le contact licences' : 'Par défaut : le président';
    const label = k === 'essai' ? '« Venir faire un essai »' : '« Écrire au club »';
    const row = `<span class="g">${label}<small>Arrive à ${real ? esc(real === S.me.id ? 'toi' : name(real)) : 'personne pour l’instant'}${cur ? '' : ' · réglage par défaut'}</small></span>`;
    if (!pres) return `<div class="row static">${row}</div>`;
    if (S.vitDest !== k) return `<div class="row static">${row}<button class="btn small ghost" data-act="vitdest" data-v="${k}">Changer</button></div>`;
    return `<div class="row static" style="flex-wrap:wrap">${row}<select data-vitto="${k}" aria-label="Qui reçoit ${label}" style="flex:1 1 220px"><option value="">${def}</option>${people.map((u) => `<option value="${u}" ${u === cur ? 'selected' : ''}>${esc(u === S.me.id ? 'Moi' : name(u))}</option>`).join('')}</select></div>`;
  };
  return `<div class="sec"><h2>Où arrivent les demandes</h2></div><div class="card"><div class="list">${opt('essai')}${opt('ecrire')}</div><p class="note" style="margin:0">Une notification dans mypocketclub et un e-mail. Aucune coordonnée du club n’est affichée sur la page.</p></div>`;
}
function reqCard() {
  const rs = S.vitReq || [], nw = rs.filter((r) => !r.read_at).length;
  const one = (r) => { const del = isArmed('vitdel' + r.id);
    return `<div class="card ${r.read_at ? 'flat' : ''}"><div class="kick">${r.kind === 'essai' ? 'Demande d’essai' : 'Message'} · ${esc(ago(r.created_at))}${r.read_at ? '' : ' · <b>nouveau</b>'}</div>
      <b>${esc(r.full_name)}</b><div class="det">${esc(r.contact)}</div>
      ${r.kind === 'essai' ? `<div class="det">${esc(r.team_name || 'Équipe à choisir')}${r.birth_year ? ' · né(e) en ' + esc(r.birth_year) : ''}</div>` : r.subject ? `<div class="det">${esc(r.subject)}</div>` : ''}
      ${r.message ? `<blockquote class="admquote">${esc(r.message)}</blockquote>` : ''}
      <div class="btns">${/@/.test(r.contact) ? `<a class="btn small" href="mailto:${esc(r.contact)}">${icon('mail', 18)}Répondre</a>` : /^[+0-9 .()-]{8,}$/.test(r.contact) ? `<a class="btn small" href="tel:${esc(r.contact.replace(/[^+0-9]/g, ''))}">${icon('phone', 18)}Appeler</a>` : ''}
      ${r.read_at ? '' : `<button class="btn small ghost" data-act="vitread" data-id="${r.id}">${icon('check', 18)}Traitée</button>`}<button class="btn small ${del ? 'danger armed' : 'ghost'}" data-act="vitdel" data-id="${r.id}">${del ? 'Confirmer' : 'Effacer'}</button></div></div>`; };
  return `<div class="sec" id="vitreq"><h2>Demandes reçues</h2>${nw ? `<span class="pill wait">${nw}</span>` : ''}</div>${rs.length ? rs.map(one).join('') : '<p class="empty">Aucune demande pour l’instant.</p>'}<p class="note">Chaque demande est effacée après 3 mois. Tu vois celles qui t’arrivent${isPresident() ? ' (le président les voit toutes)' : ''}.</p>`;
}
function blocksCard(v) {
  const hidden = new Set(arr(v.layout?.hidden)), order = orderOf(v.layout), lbl = Object.fromEntries(BLOCKS);
  return `<div class="sec"><h2>Ce qui se voit</h2></div><div class="card"><p class="note" style="margin:0">Pour changer l’ordre, touche « Éditer la page » : ↑ ↓ sur chaque bloc. Un bloc vide n’apparaît pas.</p>
    ${order.map((k) => `<label class="switch"><input type="checkbox" data-vitblk="${k}" ${hidden.has(k) ? '' : 'checked'}><span>${esc(lbl[k])}</span></label>`).join('')}</div>`;
}
function teamsCard(v) {
  const ts = (S.teams || []).filter((t) => t.club_id === S.clubId && !t.deleted_at && t.state !== 'Archivée' && t.season === v.season);
  if (!ts.length) return `<div class="sec"><h2>Équipes ${esc(v.season)}</h2></div><p class="empty">Aucune équipe pour cette saison.</p>`;
  const st = v.team_status || {}, sh = new Set(arr(v.slots_hidden));
  return `<div class="sec"><h2>Équipes ${esc(v.season)}</h2></div><div class="card"><div class="list">${ts.map((t) => `<div class="row static" style="flex-wrap:wrap"><span class="g">${esc(t.name)}<small>${st[t.id] === 'complet' ? 'Complet' : 'On recrute'}${sh.has(t.id) ? ' · horaires sur demande' : ''}</small></span>
    <button class="btn small ghost" data-act="vitteam" data-id="${t.id}">${st[t.id] === 'complet' ? 'Mettre « On recrute »' : 'Mettre « Complet »'}</button>
    <button class="btn small ghost" data-act="vitslots" data-id="${t.id}">${sh.has(t.id) ? 'Montrer les créneaux' : 'Cacher les créneaux'}</button></div>`).join('')}</div>
    <p class="note" style="margin:0">Les créneaux viennent des entraînements de l’agenda. « Complet » retire l’équipe du choix « Venir faire un essai ».</p></div>`;
}
function textCard(v) {
  const c = S.vitForm || unparse(v.content || {});
  const ta = (id, k, lab, ph, rows = 3) => field(id, lab, `<textarea id="${id}" name="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(c[k])}</textarea>`);
  return `<div class="sec"><h2>Textes et infos</h2></div><form id="vittxt" class="card stack">
    ${field('vtl', 'Phrase d’accueil (sous le nom du club)', `<input id="vtl" name="lead" maxlength="200" value="${esc(c.lead)}" placeholder="Ex. Le basket pour tout le monde, de 5 à 77 ans.">`)}
    ${ta('vtp', 'presentation', 'Présentation du club', 'Qui vous êtes, l’esprit du club…', 4)}
    <div class="grid2">${field('vtf', 'Année de création', `<input id="vtf" name="founded" inputmode="numeric" maxlength="10" value="${esc(c.founded)}" placeholder="Ex. 1978">`)}${field('vtv', 'Valeurs (séparées par des virgules)', `<input id="vtv" name="values" maxlength="300" value="${esc(c.values)}" placeholder="Ex. Convivialité, Formation">`)}</div>
    <div class="kick">S’inscrire</div>
    ${ta('vtfe', 'fees', 'Cotisation (une ligne par tarif : catégorie : prix)', 'U7 à U11 : 120 €\nU13 à U18 : 150 €\nSeniors : 180 €')}
    ${ta('vtd', 'docs', 'Pièces à fournir (une par ligne)', 'Certificat médical ou questionnaire de santé\nPhoto d’identité')}
    ${ta('vtw', 'when', 'Quand ? (une ligne par info)', 'Essais gratuits pendant 2 semaines\nInscriptions toute l’année')}
    <div class="kick">Le reste</div>
    ${ta('vtc', 'wanted', 'On cherche (une ligne par besoin)', 'Des coachs bénévoles pour les U9\nDes arbitres')}
    ${ta('vtpa', 'palmares', 'Palmarès (une ligne : année · niveau · titre)', '2024 · Régional 2 · Champion\n2019 · Départemental · Coupe')}
    ${ta('vtpt', 'partners', 'Partenaires (un nom par ligne)', 'Boulangerie du Centre')}
    ${ta('vtli', 'links', 'Liens et réseaux (une ligne : nom : lien en https)', 'Instagram : https://instagram.com/monclub\nTikTok : https://tiktok.com/@monclub\nFacebook : https://facebook.com/monclub')}
    <p class="note" style="margin:0">Jamais de nom, de photo ou de coordonnée d’une personne. Les liens s’ouvrent hors de mypocketclub.</p>
    <div class="btns"><button class="btn main" type="submit">${icon('check', 20)}Enregistrer les textes</button></div></form>`;
}
function vitrineSpace(mode) {
  const v = vitNow();
  if (!v) return '<p class="empty">Chargement…</p>';
  if (v.error) return `<p class="empty">${esc(v.error)}</p>`;
  const pres = !!v.president;
  return encart(v, false) + statusCard(v, pres) + reqCard() + whoCard(v, pres) + destCard(v, pres) + seasonCard(v) + blocksCard(v) + teamsCard(v) + textCard(v)
    + (mode === 'president' && !v.has_logo ? '<p class="note">Sans blason enregistré, la vitrine prend le logo et les couleurs de mypocketclub. Ajoute le blason du club dans Réglages.</p>' : '');
}
hooks.vitrineSpace = vitrineSpace;

// ---------- actions ----------
const save = async (patch, ok) => { const d = await run(sb.rpc('vitrine_save', { p_club: S.clubId, p_patch: patch }), ok); if (d) { apply(d); render(true); } return d; };
const keepText = () => { const f = document.getElementById('vittxt'); if (f) S.vitForm = Object.fromEntries(new FormData(f)); };
Object.assign(ACTIONS, {
  vitgo: () => { // notification « #ouvrir=<club>.vitrine » et bouton de l'Accueil
    S.vit = null;
    if (isPresident()) return ACTIONS.ptab(null, { v: 'vitrine' });
    const f = myFonctions().includes('Responsable vitrine') ? 'Responsable vitrine' : myFonctions()[0];
    if (!f) return;
    S.ftabs = S.ftabs || {}; S.ftabs['f:' + f] = 'vitrinep';
    return ACTIONS.casq(null, { v: 'f:' + f });
  },
  vitcopy: async () => { const v = S.vit; if (!v) return; try { await navigator.clipboard.writeText(pageUrl(v.slug || v.suggest)); toast('Lien copié.'); } catch { toast(pageUrl(v.slug || v.suggest)); } },
  vitdest: (el, d) => { S.vitDest = d.v; render(true); },
  vitseason: async (el, d) => { const r = await run(sb.rpc('vitrine_set_season', { p_club: S.clubId, p_season: d.v }), `Vitrine passée à la saison ${d.v}.`); if (r) { apply(r); render(true); } },
  vitlater: async (el, d) => { const r = await run(sb.rpc('vitrine_postpone', { p_club: S.clubId, p_days: +d.v }), +d.v === 30 ? 'Rappel dans 1 mois.' : 'Rappel dans 7 jours.'); if (r) { apply(r); render(true); } },
  vitread: async (el, d) => { if (await run(sb.rpc('vitrine_request_read', { p_id: d.id }), 'Demande marquée traitée.')) { const r = (S.vitReq || []).find((x) => x.id === d.id); if (r) r.read_at = new Date().toISOString(); render(true); } },
  vitdel: async (el, d) => { if (!armed('vitdel' + d.id)) return; if (await run(sb.rpc('vitrine_request_delete', { p_id: d.id }), 'Demande effacée.')) { S.vitReq = (S.vitReq || []).filter((x) => x.id !== d.id); render(true); } },
  vitteam: async (el, d) => { keepText(); const st = { ...(S.vit?.team_status || {}) }; if (st[d.id] === 'complet') delete st[d.id]; else st[d.id] = 'complet'; await save({ team_status: st }, 'Équipe mise à jour.'); },
  vitslots: async (el, d) => { keepText(); const s = new Set(arr(S.vit?.slots_hidden)); s.has(d.id) ? s.delete(d.id) : s.add(d.id); await save({ slots_hidden: [...s] }, s.has(d.id) ? 'Créneaux cachés : « horaires sur demande ».' : 'Créneaux montrés.'); },
});
FORMS.vittxt = async (v) => { S.vitForm = v; if (await save({ content: parseContent(v) }, 'Textes enregistrés.')) S.vitForm = null; render(true); };
FORMS.vitslug = async (v) => { keepText(); await save({ slug: String(v.slug || '').trim().toLowerCase() }, 'Adresse enregistrée.'); };
CHANGES.push(async (t) => {
  if (t.dataset.vitonoff) { keepText(); const on = t.checked; if (!(await save({ enabled: on }, on ? 'Vitrine en ligne.' : 'Vitrine coupée : la page n’est plus visible.'))) t.checked = !on; return true; }
  if (t.dataset.vitto) { keepText(); const k = t.dataset.vitto; if (await save({ [k + '_to']: t.value || null }, 'Destinataire enregistré.')) S.vitDest = null; render(true); return true; }
  if (t.dataset.vitblk) {
    keepText(); const k = t.dataset.vitblk, h = new Set(arr(S.vit?.layout?.hidden));
    t.checked ? h.delete(k) : h.add(k);
    if (!(await save({ layout: { order: orderOf(S.vit?.layout), hidden: [...h] } }, t.checked ? 'Bloc montré.' : 'Bloc caché.'))) t.checked = !t.checked;
    return true;
  }
  return false;
});

// ---------- admin › À traiter : vitrines sans blason, dates de rentrée (n° 314) ----------
hooks.adminVitrines = () => {
  const a = S.admVit; if (a === undefined) { S.admVit = null; sb.rpc('admin_vitrines').then((r) => { S.admVit = r.error ? { error: true } : r.data; render(true); }); return ''; }
  if (!a || a.error) return '';
  const nl = arr(a.nologo), rs = arr(a.rentrees), y = new Date().getFullYear();
  return `<div class="sec"><h2>Vitrines sans blason</h2><span class="det">${nl.length}</span></div>
    ${nl.length ? `<section class="card"><div class="list">${nl.map((c) => `<a class="row" href="${esc(pageUrl(c.slug))}" target="_blank" rel="noopener"><span class="g">${esc(c.name)}<small>${esc([c.city, c.president].filter(Boolean).join(' · '))}</small></span></a>`).join('')}</div><p class="note">Ces clubs ont une vitrine en ligne aux couleurs de mypocketclub : à qui proposer une charte graphique.</p></section>` : '<p class="empty">Toutes les vitrines en ligne ont un blason.</p>'}
    <p class="note">${plural(+a.enabled || 0, 'vitrine en ligne', 'vitrines en ligne')}.</p>
    <div class="sec"><h2>Rentrée scolaire</h2></div><section class="card"><div class="list">${rs.map((r) => `<div class="row static"><span class="g">Rentrée ${esc(r.year)} : ${esc(dayLbl(r.day))}<small>Encart des vitrines le ${esc(dayLbl(r.monday))}</small></span></div>`).join('')}</div>
    <form id="admrent" class="grid2" style="align-items:end">${field('arY', 'Année', `<input id="arY" name="year" type="number" min="${y}" max="${y + 3}" value="${y + 1}" required>`)}${field('arD', 'Jour de la rentrée', `<input id="arD" name="day" type="date" required>`)}<button class="btn small" type="submit">Enregistrer</button></form>
    <p class="note">L’encart « nouvelle saison » s’affiche aux responsables vitrine le premier lundi après la rentrée.</p></section>`;
};
FORMS.admrent = async (v) => { if (await run(sb.rpc('admin_rentree_set', { p_year: +v.year, p_day: v.day }), 'Date de rentrée enregistrée.')) { S.admVit = undefined; render(true); } };

// changement de club : on recharge
export async function loadB190() { if (S.vit && S.vitClub === S.clubId && !S.vit.error) await loadVit(true).catch(() => {}); }
hooks.vitrineReset = () => { S.vit = null; S.vitReq = null; S.vitClub = null; S.vitForm = null; S.vitDest = null; };
