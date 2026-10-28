import * as V2 from './v2.js';
// Mon Blason · alpha 2.1 · destinataires des rendez-vous, ordre chronologique, coach encadrant, sondages supprimables, document et import des tarifs
let S, sb, esc, run, toast, render, refresh, name, teamName, myMem, isBoard, coachTeams;

export function install(ctx) { ({ S, sb, esc, run, toast, render, refresh, name, teamName, myMem, isBoard, coachTeams } = ctx); }

const active = () => myMem().filter((m) => m.status === 'active');
const TEAM_TYPES = ['Entraînement', 'Match', 'Plateau', 'Tournoi'];
export const AUD = { club: 'tout le club', board: 'Bureau', board_coaches: 'Bureau et coachs', coaches: 'tous les coachs' };
const INTERNAL = ['board', 'board_coaches', 'coaches'];
const pname = (p) => (p.first_name + ' ' + (p.last_name || '')).trim();
const inTeam = (p, tid) => p.team_id === tid || (S.pteams || []).some((x) => x.player_id === p.id && x.team_id === tid);
const myKids = (tid) => (S.players || []).filter((p) => inTeam(p, tid) && (S.pparents || []).some((x) => x.player_id === p.id && x.user_id === S.me.id));
const iPlay = (tid) => active().some((m) => m.role === 'joueur' && m.team_id === tid) || (S.players || []).some((p) => p.user_id === S.me.id && inTeam(p, tid));

// ---------- types et destinataires (n° 16, 19) ----------
export function types() { return isBoard() ? ['Entraînement', 'Match', 'Plateau', 'Tournoi', 'Événement', 'Réunion', 'AG'] : ['Entraînement', 'Match', 'Plateau', 'Tournoi']; }
export function audienceField(f) {
  const cur = f.audience && f.audience !== 'team' ? f.audience : f.team_id ? 'team:' + f.team_id : isBoard() ? 'club' : '';
  const teams = S.teams.filter((t) => isBoard() || coachTeams().includes(t.id));
  const opt = (v, l) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  return `<div class="field"><label for="eq">Pour</label><select id="eq" name="aud">${isBoard() ? opt('club', 'Tout le club') : ''}${teams.map((t) => opt('team:' + t.id, 'Équipe ' + esc(t.name))).join('')}${isBoard() ? opt('board', '🔒 Bureau (président et bureau)') + opt('board_coaches', '🔒 Bureau et coachs') + opt('coaches', '🔒 Tous les coachs') : ''}</select></div>`;
}
export function parseAudience(v) {
  const a = v.aud || 'club';
  return a.startsWith('team:') ? { team_id: a.slice(5), audience: 'team' } : { team_id: null, audience: a };
}
export function forLabel(e) {
  const a = e.audience || (e.team_id ? 'team' : 'club');
  const txt = a === 'team' ? teamName(e.team_id) || 'équipe' : AUD[a] || 'tout le club';
  let h = `<span class="pill">${INTERNAL.includes(a) ? '🔒 ' : ''}Pour : ${esc(txt)}</span>`;
  if (active().length > 1) { const r = reason(e); if (r) h += ` <span class="det">Vous : ${esc(r)}</span>`; }
  return `<div style="margin-top:4px">${h}</div>`;
}
function reason(e) {
  const a = e.audience || (e.team_id ? 'team' : 'club');
  if (a === 'team') {
    const k = myKids(e.team_id);
    if (coachTeams().includes(e.team_id)) return 'coach ' + teamName(e.team_id);
    if (iPlay(e.team_id)) return 'joueur ' + teamName(e.team_id);
    if (k.length) return 'parent de ' + k.map((p) => p.first_name).join(' et ') + ' (' + teamName(e.team_id) + ')';
  }
  if (isBoard()) return 'bureau';
  if (INTERNAL.includes(a)) return 'coach';
  return '';
}
export function invitedCount(e) {
  const a = e.audience || (e.team_id ? 'team' : 'club'), act = (S.members || []).filter((m) => m.status === 'active'), ids = new Set();
  const board = act.filter((m) => ['president', 'bureau'].includes(m.role)).map((m) => m.user_id);
  if (a === 'club') act.forEach((m) => ids.add(m.user_id));
  else if (a === 'board') board.forEach((u) => ids.add(u));
  else if (a === 'coaches' || a === 'board_coaches') { act.filter((m) => m.role === 'coach').forEach((m) => ids.add(m.user_id)); if (a === 'board_coaches') board.forEach((u) => ids.add(u)); }
  else { act.filter((m) => m.team_id === e.team_id).forEach((m) => ids.add(m.user_id)); (S.players || []).filter((p) => inTeam(p, e.team_id)).forEach((p) => { if (p.user_id) ids.add(p.user_id); (S.pparents || []).filter((x) => x.player_id === p.id).forEach((x) => ids.add(x.user_id)); }); }
  return ids.size;
}

// ---------- le coach encadre, il ne répond pas (n° 14) ----------
export function coachOnly(e) { return !!e.team_id && TEAM_TYPES.includes(e.type) && coachTeams().includes(e.team_id) && !iPlay(e.team_id) && !myKids(e.team_id).length; }
export function answer(e, pairFn, counts) {
  if (!e.team_id || !TEAM_TYPES.includes(e.type)) return pairFn(null);
  const k = myKids(e.team_id), coach = coachTeams().includes(e.team_id), me = iPlay(e.team_id);
  const kids = k.map((p) => `<div class="det" style="margin-top:8px;font-weight:800">${esc(p.first_name)} ·</div>` + pairFn(p.id)).join('');
  if (coach && !me) return `<div class="card" style="background:#F7F9F6;margin-top:8px"><div class="kick">Vous encadrez</div><div class="det">${counts.oui} annoncés présents · ${counts.non} absents · ${Math.max(0, counts.inv - counts.oui - counts.non)} sans réponse</div><button class="btn small main" style="margin-top:8px" data-act="appel" data-id="${e.id}">Faire l'appel</button></div>` + kids;
  return (me || !k.length ? pairFn(null) : '') + kids;
}
// Reste-t-il une réponse à donner (pour soi ou pour un enfant) ?
export function needsAnswer(e, R) {
  if (!e.team_id || !TEAM_TYPES.includes(e.type)) return !R.mine;
  const k = myKids(e.team_id), coach = coachTeams().includes(e.team_id), me = iPlay(e.team_id);
  if (k.some((p) => !R.kid(p.id))) return true;
  if (me) return !R.mine;
  return !coach && !k.length && !R.mine;
}
// Nom affiché pour une réponse : l'enfant, et « répondu par » pour l'encadrement
export function respName(x) {
  if (!x.player_id) return esc(name(x.user_id));
  const p = (S.players || []).find((y) => y.id === x.player_id), staff = isBoard() || coachTeams().length > 0;
  const nm = p ? p.first_name + ' ' + (p.last_name ? p.last_name[0] + '.' : '') : 'Un joueur';
  return esc(nm.trim()) + (staff && p ? ` <span class="det">(répondu par ${esc(name(x.user_id))})</span>` : '');
}

// ---------- interrupteur « Tout le club » du président et du bureau (n° 22) ----------
const personal = (tid) => coachTeams().includes(tid) || iPlay(tid) || myKids(tid).length > 0;
const hiddenByToggle = (e) => isBoard() && !S.me.show_all_club && (e.audience || (e.team_id ? 'team' : 'club')) === 'team' && !personal(e.team_id);
export const visible = (list) => list.filter((e) => !hiddenByToggle(e));
export function clubToggle(list) {
  if (!isBoard()) return '';
  const n = list.filter(hiddenByToggle).length;
  return `<label class="check" style="border:0"><input type="checkbox" data-clubtog="1" ${S.me.show_all_club ? 'checked' : ''}><span><b>Tout le club</b> · afficher les rendez-vous de toutes les équipes</span></label>${!S.me.show_all_club && n ? `<p class="note" style="margin:0">${n} rendez-vous d'autres équipes non affichés · cochez « Tout le club » pour les voir.</p>` : ''}`;
}

// ---------- ordre chronologique et regroupement par jour (n° 15) ----------
export function sortEvents(list) { return list.slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || (teamName(a.team_id) || '').localeCompare(teamName(b.team_id) || '')); }
const soon = () => Date.now() - 2 * 3600e3;
export const upcoming = (list) => sortEvents(list.filter((e) => new Date(e.starts_at).getTime() >= soon()));
export const past = (list) => sortEvents(list.filter((e) => new Date(e.starts_at).getTime() < soon())).reverse();
function dayTitle(d) {
  const k = d.toLocaleDateString('sv-SE'), t = new Date(), tm = new Date(Date.now() + 864e5);
  if (k === t.toLocaleDateString('sv-SE')) return 'Aujourd’hui';
  if (k === tm.toLocaleDateString('sv-SE')) return 'Demain';
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1);
}
export function byDay(list, fn) {
  let h = '', last = '';
  list.forEach((e) => { const d = new Date(e.starts_at), k = d.toLocaleDateString('sv-SE'); if (k !== last) { h += `<div class="kick" style="margin-top:6px">${esc(dayTitle(d))}</div>`; last = k; } h += fn(e); });
  return h;
}

// ---------- sondages supprimables (n° 17) ----------
const canDelPoll = (p) => p.created_by === S.me.id || isBoard() || (S.groups || []).some((g) => g.id === p.group_id && g.created_by === S.me.id);
export function pollCard(p) {
  if (p.deleted_at) return `<div class="card" style="opacity:.7"><div class="det">Sondage « ${esc(p.question)} » supprimé par ${esc(name(p.deleted_by))}.</div></div>`;
  const v = S.votes.filter((x) => x.poll_id === p.id), my = (v.find((x) => x.user_id === S.me.id) || {}).answer, k = 'poll' + p.id;
  return `<div class="card hi"><div style="display:flex;align-items:center;gap:8px"><div class="kick" style="flex:1">Sondage · ${esc(name(p.created_by))}</div>${canDelPoll(p) ? `<button class="chip" data-act="polldel" data-id="${p.id}" aria-label="Supprimer le sondage" style="${S.delPend === k ? 'background:var(--absent);color:#fff;border-color:var(--absent)' : ''}">${S.delPend === k ? 'Confirmer la suppression' : '✕'}</button>` : ''}</div><div style="font-weight:800;margin-top:4px">${esc(p.question)}</div><div class="chips" style="margin-top:8px">${['Présent', 'Absent', 'Je ne sais pas'].map((a) => `<button class="chip" data-act="vote" data-id="${p.id}" data-v="${a}" aria-pressed="${my === a}">${a} · ${v.filter((x) => x.answer === a).length}</button>`).join('')}</div><div class="det" style="margin-top:6px">${v.length} réponse${v.length > 1 ? 's' : ''} sur ${S.gmembers.length}</div></div>`;
}

// ---------- tarifs : document joint et import (n° 18) ----------
export function docLink() {
  const d = (S.docs || []).find((x) => x.kind === 'tarifs');
  return d ? `<button class="btn" data-act="docopen" data-id="${d.id}">📄 Tarifs du club : ${esc(d.file_name)}</button>` : '';
}
export function feesExtra() {
  if (!isBoard()) return '';
  const d = (S.docs || []).find((x) => x.kind === 'tarifs'), imp = S.fimp;
  let h = `<details class="card" ${imp ? 'open' : ''}><summary style="font-weight:800;min-height:44px;display:flex;align-items:center;cursor:pointer">Tarifs : document et import</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">`;
  h += `<div class="field"><label for="fdoc">${d ? 'Remplacer' : 'Joindre'} la fiche des tarifs (PDF ou image, 4 Mo maximum)</label><input id="fdoc" type="file" accept="application/pdf,image/*" data-doc="tarifs"></div>${d ? `<button class="btn small" data-act="docdel" data-id="${d.id}">${S.delPend === 'doc' + d.id ? 'Confirmer le retrait' : 'Retirer le document'}</button>` : ''}<p class="note">Les familles le voient dans l'onglet Club.</p>`;
  h += `<div class="field"><label for="fimp">Importer une grille : collez un tableau (Catégorie ou équipe ; Prix ; Part fédération facultative)</label><textarea id="fimp" data-fimp="1" placeholder="U9;150;45&#10;U11;160;45&#10;Équipe Reines;200">${esc(S.fimpText || '')}</textarea></div><div class="field"><label for="fimpf">ou un fichier Excel / CSV</label><input id="fimpf" type="file" accept=".csv,.xlsx,.xls,text/csv" data-fimpfile="1"></div><button class="btn small" data-act="fimpcheck">Vérifier</button>`;
  if (imp) h += `<div class="card">${imp.map((r, i) => `<div class="row" style="cursor:default"><span class="g">${esc(r.label)}<small>${r.team_id ? 'Équipe' : 'Catégorie'} · ${esc(r.amount)} €${r.fed != null ? ' dont ' + esc(r.fed) + ' € fédération' : ''}${r.err ? ' · <span style="color:var(--absent)">' + esc(r.err) + '</span>' : ''}</small></span><button class="btn small" data-act="fimprm" data-i="${i}">Retirer</button></div>`).join('') || '<p class="empty" style="margin:0">Aucune ligne lisible.</p>'}</div>${imp.some((r) => !r.err) ? `<button class="btn main" data-act="fimpok">Valider l'import (${imp.filter((r) => !r.err).length} lignes)</button>` : ''}`;
  return h + '</div></details>';
}
function num(x) { const n = Number(String(x ?? '').replace(/[€\s]/g, '').replace(',', '.')); return isFinite(n) && String(x ?? '').trim() !== '' ? n : null; }
function parseGrid(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.split(/[;\t]/).length > 1 ? l.split(/[;\t]/) : l.split(',')).map((c) => c.map((x) => x.trim()))
    .filter((c) => c[0] && !(num(c[1]) == null && /cat|équip|equip|prix|tarif/i.test(c.join(' '))))
    .map((c) => {
      const isTeam = /^équipe\s+/i.test(c[0]), lab = c[0].replace(/^équipe\s+/i, ''), t = isTeam ? S.teams.find((x) => x.name.toLowerCase() === lab.toLowerCase()) : null, amount = num(c[1]), fed = num(c[2]);
      return { label: c[0], team_id: t?.id || null, category: lab, amount, fed, err: amount == null ? 'prix illisible' : isTeam && !t ? 'équipe inconnue' : '' };
    });
}
async function fileToText(f) {
  if (/\.xlsx?$/i.test(f.name)) {
    await new Promise((ok, ko) => { if (window.XLSX) return ok(); const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
    const wb = window.XLSX.read(await f.arrayBuffer()); return window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ';' });
  }
  return f.text();
}
const toDataUrl = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });

export async function onChange(t) {
  if (t.dataset.clubtog) { const v = t.checked; if (await run(sb.from('profiles').update({ show_all_club: v }).eq('id', S.me.id))) { S.me.show_all_club = v; } render(true); return true; }
  if (t.name === 'repeat' && t.closest('#evf')) { const f = new FormData(t.closest('form')); Object.assign(S.form, Object.fromEntries(f)); S.form.repeat = t.checked; if (!t.checked) S.form.until = ''; render(true); return true; }
  if (t.dataset.ocr && t.files?.[0]) {
    toast('Lecture de l\'image… (30 secondes environ la première fois)');
    try {
      if (!window.Tesseract) await new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
      const r = await window.Tesseract.recognize(t.files[0], 'fra');
      const lines = (r.data.text || '').split(/\r?\n/).map((l) => l.replace(/[|_]+/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter((l) => /[A-Za-zÀ-ÿ]{2,}/.test(l));
      S.imp.text = (S.imp.text ? S.imp.text.trim() + '\n' : '') + lines.join('\n'); render(true);
      toast(lines.length ? lines.length + ' lignes lues : vérifiez-les, puis « Vérifier la liste ».' : 'Aucun nom lu. Essayez une image plus nette.');
    } catch { toast('Lecture impossible (connexion ?). Essayez le copier-coller.'); }
    return true;
  }
  if (t.dataset.doc && t.files?.[0]) {
    const f = t.files[0];
    if (f.size > 4 * 1024 * 1024) { toast('Fichier trop lourd (4 Mo maximum).'); return true; }
    if (!/^application\/pdf$|^image\//.test(f.type)) { toast('Seulement un PDF ou une image.'); return true; }
    const data = await toDataUrl(f), old = (S.docs || []).filter((x) => x.kind === 'tarifs');
    if (old.length) await run(sb.from('club_docs').delete().in('id', old.map((x) => x.id)));
    if (await run(sb.from('club_docs').insert({ club_id: S.clubId, kind: 'tarifs', file_name: f.name.slice(0, 120), data, uploaded_by: S.me.id }), 'Fiche des tarifs enregistrée.')) await refresh();
    return true;
  }
  if (t.dataset.fimpfile && t.files?.[0]) { try { S.fimpText = await fileToText(t.files[0]); S.fimp = parseGrid(S.fimpText); render(true); } catch { toast('Fichier illisible.'); } return true; }
  return false;
}
export function onInput(t) { if (t.dataset.fimp) { S.fimpText = t.value; return true; } return false; }

// ---------- actions ----------
export const ACTIONS = {
  impswap: async () => {
    const I = S.imp; if (!I) return;
    I.text = String(I.text || '').split(/\r?\n/).map((l) => { const sep = l.includes(';') ? ';' : l.includes('\t') ? '\t' : null; if (sep) { const c = l.split(sep); if (c.length > 1) [c[0], c[1]] = [c[1], c[0]]; return c.join(sep); } const w = l.trim().split(/\s+/); if (w.length < 2) return l; const parts = l.includes(',') ? l.split(',') : null; if (parts && parts.length > 1) { [parts[0], parts[1]] = [parts[1], parts[0]]; return parts.join(','); } [w[0], w[1]] = [w[1], w[0]]; return w.join(' '); }).join('\n');
    if (I.rows) { I.rows = null; await V2.ACTIONS.impcheck(); toast('Prénom et nom inversés.'); } else render(true);
  },
  polldel: async (el, d) => { const k = 'poll' + d.id; if (S.delPend !== k) { S.delPend = k; return render(true); } S.delPend = null; if (await run(sb.rpc('delete_poll', { pid: d.id }), 'Sondage supprimé.')) { const p = S.polls.find((x) => x.id === d.id); if (p) { p.deleted_at = new Date().toISOString(); p.deleted_by = S.me.id; } S.votes = S.votes.filter((x) => x.poll_id !== d.id); render(true); } },
  docopen: async (el, d) => {
    const r = await run(sb.from('club_docs').select('data,file_name').eq('id', d.id).single()); if (!r) return;
    const blob = await (await fetch(r.data)).blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; if (!/^image\//.test(blob.type)) a.download = r.file_name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  },
  docdel: async (el, d) => { const k = 'doc' + d.id; if (S.delPend !== k) { S.delPend = k; return render(true); } S.delPend = null; if (await run(sb.from('club_docs').delete().eq('id', d.id), 'Document retiré.')) await refresh(); },
  fimpcheck: () => { S.fimp = parseGrid(S.fimpText); render(true); },
  fimprm: (el, d) => { S.fimp.splice(+d.i, 1); render(true); },
  fimpok: async () => {
    const rows = S.fimp.filter((r) => !r.err).map((r) => ({ club_id: S.clubId, season: '2026-2027', team_id: r.team_id, category: r.team_id ? null : r.category, amount: r.amount, fed_part: r.fed }));
    if (rows.length && await run(sb.from('fee_grid').insert(rows), rows.length + ' tarifs ajoutés à la grille.')) { S.fimp = null; S.fimpText = ''; await refresh(); }
  },
};
export const KEEP_DEL = ['polldel', 'docdel'];
