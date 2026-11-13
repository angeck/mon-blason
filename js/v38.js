// mypocketclub · alpha 3.8.0
// n° 101 : création d'équipe dans l'espace (Président, rubrique Technique), plus dans l'onglet Club ;
// n° 102 : créer des équipes par import d'un fichier Excel ou CSV, d'une liste collée ou d'une photo (catégorie, genre, gymnase, créneau) ;
// n° 103 : supprimer une équipe en doublon sans l'archiver (corbeille 30 jours, restaurable) ;
// n° 107 : e-mail de test envoyé depuis notifications@mypocketclub.fr (fonction serveur « envoyer-email », administrateur seulement).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_3_8_0.sql) ; l'écran n'est qu'un confort.
import { BRAND } from '../config.js';
import {
  S, sb, esc, run, toast, render, refresh, armed, isArmed, ACTIONS, INPUTS, CHANGES, catsFor, club, GENRES, SEASON, hasArea, isPresident, team, norm, loadJs, plural,
} from './core.js';
import { icon, field } from './ui.js';
import { teamForm, autoName, loadXlsx } from './equipe.js';
import { decodeText, bestSheet } from './importer.js';

import { parseTeams, teamDoubts } from './equipes_import.js';
export { parseTeams, teamDoubts };

// ---------- n° 103 · doublons ----------
const liveTeams = () => S.teams.filter((t) => !t.deleted_at && t.state !== 'Archivée');
const sameTeam = (a, b) => norm(a.name) === norm(b.name) && (a.season || SEASON) === (b.season || SEASON);
export function dupGroups() {
  const l = liveTeams(), seen = new Set(), g = [];
  l.forEach((t) => { if (seen.has(t.id)) return; const same = l.filter((x) => sameTeam(x, t)); if (same.length > 1) { same.forEach((x) => seen.add(x.id)); g.push(same); } });
  return g;
}
export const canTrashTeam = () => isPresident() || hasArea('technique');
const cteam = (tid) => (S.cteams || []).find((x) => x.id === tid);
const teamUse = (tid) => { const ct = cteam(tid), ev = S.events.filter((e) => (e.team_ids || []).includes(tid) && !e.cancelled).length; return { players: ct?.players ?? S.players.filter((p) => p.team_id === tid).length, events: ev }; };
// Bouton « Supprimer (doublon) » : corbeille 30 jours, restaurable par le bureau (même fonction que l'ancienne « Mettre à la corbeille »)
export function dupBtn(tid) {
  if (!canTrashTeam()) return '';
  const on = isArmed('td' + tid), u = teamUse(tid);
  const warn = on && (u.players || u.events) ? `<p class="note" style="color:var(--pc-non-texte)">${esc(plural(u.players, 'joueur'))} et ${esc(plural(u.events, 'rendez-vous', 'rendez-vous'))} sont rattachés à cette équipe : vérifie que l'équipe gardée les a bien avant de confirmer.</p>` : '';
  return `<button class="btn danger small ${on ? 'armed' : ''}" data-act="tdup" data-id="${esc(tid)}">${icon('trash', 18)}${on ? "Confirmer : l'équipe part à la corbeille (30 jours)" : 'Supprimer (doublon)'}</button>${warn}`;
}
function dupBlock() {
  if (!canTrashTeam()) return '';
  const g = dupGroups(); if (!g.length) return '';
  return `<div class="card warn" style="transform:none"><b>${plural(g.length, 'doublon possible', 'doublons possibles')}</b><p class="note" style="margin:0;color:var(--pc-texte-ecran)">Même nom pour la même saison. Supprime celle en trop : elle part à la corbeille pendant 30 jours, le bureau peut la restaurer. Pour une équipe de la saison passée, utilise plutôt « Archiver ».</p>${g.map((same) => same.map((t) => { const u = teamUse(t.id); return `<div class="row static" style="flex-wrap:wrap;gap:8px"><button class="g" data-act="team" data-id="${esc(t.id)}" style="background:none;border:0;text-align:left;padding:0;min-height:44px;color:inherit">${esc(t.name)}<small>${esc([t.category !== t.name ? t.category : '', t.gender, t.state, plural(u.players, 'joueur'), plural(u.events, 'rendez-vous', 'rendez-vous')].filter(Boolean).join(' · '))}</small></button>${dupBtn(t.id)}</div>`; }).join('')).join('<hr style="border:0;border-top:1px solid var(--pc-trait);margin:4px 0">')}</div>`;
}

// ---------- n° 101 · bloc « Équipes » des espaces (Président, rubrique Technique) ----------
export function teamToolsBlock(inFold = false) {
  if (!(isPresident() || hasArea('technique'))) return '';
  // n° 116 : dans le dépliant « Équipes » du président, sans titre à part
  return `${inFold ? '' : '<div class="sec"><h2>Créer des équipes</h2></div>'}${dupBlock()}<details class="card" data-tcreate="1" ${S.tcreate ? 'open' : ''}><summary>${icon('plus', 18)} Créer une équipe</summary>${teamForm({}, 'teamnew')}<p class="note">Une nouvelle équipe reste en mode fantôme (invisible des familles) jusqu'à ce que son coach, le bureau ou le président la rende visible.</p></details><button class="btn" data-act="timport">${icon('down', 20)}Importer des équipes (Excel, liste ou photo)</button>`;
}

// ---------- n° 102 · page « Importer des équipes » ----------
const BLANK = () => ({ text: '', rows: null, photo: false });
export function teamImportPage() {
  if (!(isPresident() || hasArea('technique'))) return '<p class="empty">Réservé au président et au bureau (accès Technique).</p>';
  const I = S.timp || (S.timp = BLANK());
  if (!I.rows) {
    return `<div class="card lift">${field('tit', 'Coller une liste', `<textarea id="tit" data-timptext="1" style="min-height:160px" placeholder="Une ligne par équipe ou par créneau&#10;U11 F ; Mercredi 14 h – 15 h 30 ; gymnase Jean-Moulin&#10;Seniors M ; Jeudi 20 h ; salle Coubertin">${esc(I.text)}</textarea>`)}
    <p class="note">Une ligne par équipe, ou une ligne par créneau (les lignes d'une même équipe sont regroupées). Colonnes reconnues, dans n'importe quel ordre : équipe, catégorie, genre, gymnase, jour, heure ou créneau. Ce qui manque se complète à la main avant de créer.</p>
    ${field('tif', 'Ou choisir un fichier Excel ou CSV (le plus fiable)', '<input id="tif" type="file" accept=".xlsx,.xls,.ods,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet" data-timpfile="1">')}
    ${field('tio', "Ou une photo ou une capture d'écran du tableau des créneaux", '<input id="tio" type="file" accept="image/*" data-timpocr="1">')}
    <p class="note">La photo est lue dans ton téléphone (aucune image n'est envoyée) ; la lecture est approximative : vérifie chaque ligne. Le plus fiable avec une photo : « Copier le texte » dans l'appareil photo (Google Lens, Texte en direct), puis coller ci-dessus.</p>
    <button class="btn main" data-act="timpcheck">Vérifier la liste</button><p class="note">Rien n'est créé avant « Créer les équipes ».</p></div>`;
  }
  const opt = (l, v) => `<option value="">—</option>${l.map((x) => `<option ${v === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}${v && !l.includes(v) ? `<option selected>${esc(v)}</option>` : ''}`;
  const n = I.rows.filter((r) => !r.exists && !r.skip).length;
  let h = `<div class="card lift"><div class="kick">Vérification · ${plural(I.rows.length, 'équipe')}</div><p class="note">Les cases en orange sont à vérifier ou à compléter. Les équipes créées restent en mode fantôme (invisibles des familles).</p>`;
  I.rows.forEach((r, i) => {
    const dz = teamDoubts(r), cls = (k) => (dz.has(k) ? 'doubt' : '');
    h += `<div class="card flat" style="${r.exists || r.skip ? 'opacity:.6' : ''}"><div class="grid2">${field(`ti${i}c`, 'Catégorie', `<select id="ti${i}c" data-timp="${i}" data-k="category" class="${cls('category')}">${opt(catsFor(club()?.sport), r.category)}</select>`)}${field(`ti${i}g`, 'Genre', `<select id="ti${i}g" data-timp="${i}" data-k="gender" class="${cls('gender')}">${opt(GENRES, r.gender)}</select>`)}</div>
    ${field(`ti${i}n`, "Nom de l'équipe", `<input id="ti${i}n" data-timp="${i}" data-k="name" value="${esc(r.name)}" maxlength="60">`)}
    ${field(`ti${i}s`, 'Créneaux et gymnase', `<input id="ti${i}s" data-timp="${i}" data-k="slots" value="${esc(r.slots)}" class="${cls('slots')}" placeholder="Ex. Mercredi 14 h – 15 h 30, gymnase Jean-Moulin">`)}
    ${r.exists ? `<span class="pill ko">Déjà dans le club : « ${esc(r.exists)} » · ne sera pas créée</span>` : r.skip ? '<span class="pill">Ne sera pas créée</span>' : ''}
    <button class="btn link" data-act="timpdel" data-i="${i}" style="align-self:flex-start">Retirer cette ligne</button></div>`;
  });
  h += '</div>';
  return h + `<button class="btn main" data-act="timpok" ${n ? '' : 'disabled'}>${n ? `Créer ${plural(n, 'équipe')} (mode fantôme)` : 'Aucune équipe à créer'}</button><button class="btn ghost" data-act="timpback">Modifier la liste</button>`;
}
// Une équipe de même nom, catégorie et genre déjà dans le club (saison en cours) n'est jamais créée deux fois
function markExisting() {
  const l = liveTeams();
  S.timp.rows.forEach((r) => {
    const cat = r.category || String(r.name || '').trim();
    const t = l.find((x) => norm(x.name) === norm(r.name) && norm(x.category || x.name) === norm(cat) && (x.gender || '') === (r.gender || ''));
    r.exists = t ? t.name : '';
  });
}
async function timpRead(input) {
  const rows = parseTeams(input);
  if (!rows.length) return toast('Aucune équipe reconnue : une ligne par équipe, avec au moins la catégorie (U9, U13, Seniors…).');
  S.timp.rows = rows; markExisting(); render();
}

Object.assign(ACTIONS, {
  timport: () => { S.timp = BLANK(); S.view = { type: 'timport' }; render(); },
  timpcheck: async () => { await timpRead(S.timp.text); },
  timpdel: (el, d) => { S.timp.rows.splice(+d.i, 1); if (!S.timp.rows.length) S.timp.rows = null; render(true); },
  timpback: () => { S.timp.rows = null; render(); },
  timpok: async () => {
    const I = S.timp, l = I.rows.filter((r) => !r.exists && !r.skip);
    if (l.some((r) => !(r.name || '').trim())) return toast('Chaque équipe doit avoir un nom (ou une catégorie).');
    const rows = l.map((r) => ({ club_id: S.clubId, name: r.name.trim(), category: r.category || r.name.trim(), gender: r.gender || '', slots: r.slots || '', season: SEASON }));
    if (await run(sb.from('teams').insert(rows), plural(rows.length, 'équipe créée', 'équipes créées') + ' en mode fantôme : rends-les visibles quand elles sont prêtes.')) {
      S.timp = null; S.view = (S.stack || []).pop() || { type: 'espace' }; delete S.view._y; S.noStack = true; await refresh();
    }
  },
  tdup: async (el, d) => {
    if (!armed('td' + d.id)) return;
    if (await run(sb.rpc('trash_item', { p_kind: 'team', p_id: d.id }), 'Équipe supprimée : elle est à la corbeille pendant 30 jours, le bureau peut la restaurer.')) {
      if (S.view?.type === 'team' && S.view.id === d.id) { S.view = (S.stack || []).pop() || null; if (S.view) delete S.view._y; S.noStack = true; }
      await refresh();
    }
  },
  // n° 107 · e-mail de test (administrateur) : la fonction serveur l'envoie à l'adresse du compte, depuis notifications@
  mailtest: async () => {
    if (!navigator.onLine) return toast('Hors connexion : réessaie quand le réseau revient.');
    S.mailTest = 'envoi'; render(true);
    try {
      const { data, error } = await sb.functions.invoke('envoyer-email', { body: { test: true } });
      S.mailTest = error ? 'erreur' : 'ok';
      toast(error ? "Envoi impossible : la fonction « envoyer-email » n'est pas encore en place, ou la clé de Resend manque." : 'E-mail de test envoyé à ' + (data?.to || 'ton adresse') + '.');
    } catch { S.mailTest = 'erreur'; toast("Envoi impossible : la fonction « envoyer-email » n'est pas encore en place."); }
    render(true);
  },
});
INPUTS.push((t) => {
  if (t.dataset.timptext) { S.timp.text = t.value; return true; }
  if (t.dataset.timp !== undefined && t.tagName === 'INPUT') { S.timp.rows[+t.dataset.timp][t.dataset.k] = t.value; return true; }
  return false;
});
CHANGES.push(async (t) => {
  if (t.dataset.timp !== undefined && t.tagName === 'SELECT') {
    const r = S.timp.rows[+t.dataset.timp], was = autoName(r.category, r.gender);
    r[t.dataset.k] = t.value;
    if (!r.name || r.name === was) r.name = autoName(r.category, r.gender); // nom proposé d'après la catégorie, tant qu'il n'est pas modifié (n° 28)
    markExisting(); render(true); return true;
  }
  if (t.dataset.timpfile && t.files?.[0]) {
    const file = t.files[0]; t.value = '';
    let table;
    try {
      const buf = await file.arrayBuffer();
      if (/\.(csv|txt)$/i.test(file.name) || /^text\//.test(file.type)) table = decodeText(buf);
      else { let X; try { X = await loadXlsx(); } catch { toast("Lecture d'Excel impossible pour l'instant (connexion ?). Réessaie, ou enregistre le fichier en .csv."); return true; } table = bestSheet(X, X.read(buf, { type: 'array', cellDates: true })); }
    } catch { toast('Fichier illisible : choisis un fichier Excel (.xlsx, .xls), OpenDocument (.ods) ou CSV.'); return true; }
    await timpRead(table); return true;
  }
  if (t.dataset.timpocr && t.files?.[0]) {
    toast("Lecture de l'image… (30 secondes environ la première fois)");
    try {
      await loadJs('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
      const r = await window.Tesseract.recognize(t.files[0], 'fra');
      const lines = (r.data.text || '').split(/\r?\n/).map((l) => l.replace(/[|_[\]{}]+/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter((l) => /\p{L}{2,}|\bU\s?\d/u.test(l));
      S.timp.text = (S.timp.text ? S.timp.text.trim() + '\n' : '') + lines.join('\n'); S.timp.photo = true; render(true);
      toast(lines.length ? lines.length + ' lignes lues : vérifie-les, puis « Vérifier la liste ».' : 'Rien de lisible. Essaie une image plus nette.');
    } catch { toast('Lecture impossible (connexion ?). Essaie le copier-coller.'); }
    return true;
  }
  return false;
});

// ---------- n° 107 · administration : e-mail de test depuis notifications@ ----------
export function mailTestBlock() {
  if (!S.isAdmin) return '';
  const st = S.mailTest === 'envoi' ? 'Envoi en cours…' : S.mailTest === 'ok' ? 'Envoyé : regarde ta boîte (et les indésirables).' : S.mailTest === 'erreur' ? 'Échec : vérifie que la fonction « envoyer-email » est déployée et que le secret RESEND_API_KEY est posé dans Supabase.' : '';
  return `<div class="card"><button class="btn" data-act="mailtest" ${S.mailTest === 'envoi' ? 'disabled' : ''}>${icon('mail', 20)}Envoyer un e-mail de test</button><p class="note">Un e-mail part de ${esc(BRAND.mailFrom)} vers l'adresse de ton compte, pour vérifier la chaîne d'envoi (Supabase, Resend, domaine). Il n'est envoyé à personne d'autre.</p>${st ? `<p class="note"><b>${esc(st)}</b></p>` : ''}</div>`;
}

// ---------- contact et site mypocketclub (affichés même si le site est encore vide) ----------
export const contactLine = () => `<p class="note" style="text-align:center">Contact : <a href="mailto:${esc(BRAND.contact)}">${esc(BRAND.contact)}</a> · Site : <a href="${esc(BRAND.siteUrl)}" target="_blank" rel="noopener">${esc(BRAND.site)}</a></p>`;
export { team };
