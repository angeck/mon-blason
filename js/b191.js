// mypocketclub · bêta 1.9.1 (Gaël, 28 novembre 2026, 9 h 58 : « Go »)
//   « Création de votre logo » : tuile dépliable dans « Blason, couleurs et réglages du club » (président seulement) :
//   un texte et des pièces jointes, bouton « Envoyer la demande à mpc » (fonction Edge demande-logo → e-mail à l'administrateur).
//   Admin › À traiter : les demandes de logo reçues, et « Fait ».
// Le formulaire ne redessine pas l'écran (la tuile resterait fermée) : la liste des fichiers est mise à jour sur place.
import { S, sb, esc, hooks, run, render, toast, ACTIONS, FORMS, CHANGES } from './core.js';
import { field } from './ui.js';

const arr = (x) => (Array.isArray(x) ? x : []);
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf'];
const MAX_FILES = 6, MAX_ONE = 4 * 1024 * 1024, MAX_ALL = 10 * 1024 * 1024;
const size = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' ko');
const when = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const files = () => (S.lrClub === S.clubId ? (S.lrFiles ||= []) : ((S.lrClub = S.clubId), (S.lrFiles = []), (S.lrSent = undefined), S.lrFiles));

function fileList() {
  const f = files();
  return f.length ? f.map((x, i) => `<div class="row static"><span class="g">${esc(x.name)}<small>${esc(size(x.size))}</small></span><button type="button" class="btn small ghost" data-act="lrdel" data-id="${i}">Retirer</button></div>`).join('') : '<p class="empty">Aucune pièce jointe.</p>';
}
const redraw = () => { const l = document.getElementById('lrlist'); if (l) l.innerHTML = fileList(); };

hooks.logoReq = () => {
  files();
  if (S.lrSent === undefined) { S.lrSent = null; sb.rpc('my_logo_requests', { p_club: S.clubId }).then((r) => { S.lrSent = r.error ? [] : r.data || []; const s = document.getElementById('lrsent'); if (s) s.innerHTML = sentList(); }); }
  return `<details class="card flat" id="logoreq" style="margin-top:12px"><summary>Création de votre logo</summary>
  <p class="note">Pas encore de logo, ou envie d’en changer ? mypocketclub crée pour vous le logo et les couleurs de base du club, puis vous les renvoie. Ils serviront à l’appli, aux convocations et à la vitrine.</p>
  <form id="logoreqf" class="stack">
    ${field('lrmsg', 'Votre demande', '<textarea id="lrmsg" name="message" rows="5" maxlength="3000" placeholder="L’histoire du club, ses valeurs, les couleurs des maillots, ce qu’il faut garder de l’ancien logo, vos pages Instagram ou Facebook…"></textarea>')}
    ${field('lrfile', 'Pièces jointes (anciens logos, couleurs, captures…)', `<input id="lrfile" type="file" multiple accept="${TYPES.join(',')}">`)}
    <p class="note" style="margin:0">Images ou PDF, ${MAX_FILES} au plus, 4 Mo chacune. Pas de photo d’enfant : des logos, des couleurs, des maillots seuls.</p>
    <div class="list" id="lrlist">${fileList()}</div>
    <button class="btn main" type="submit">Envoyer la demande à mpc</button>
  </form><div id="lrsent">${sentList()}</div></details>`;
};
function sentList() {
  const s = arr(S.lrSent); if (!s.length) return '';
  return `<p class="note">${s.map((r) => `Demande envoyée le ${esc(when(r.at))}${r.files ? ` (${r.files} pièce${r.files > 1 ? 's' : ''} jointe${r.files > 1 ? 's' : ''})` : ''}${r.done ? ' · traitée' : ' · en cours'}`).join('<br>')}</p>`;
}

const readB64 = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = ko; r.readAsDataURL(f); });
CHANGES.push(async (t) => {
  if (t.id !== 'lrfile') return false;
  const f = files(), picked = [...(t.files || [])]; t.value = '';
  for (const x of picked) {
    if (f.length >= MAX_FILES) { toast(`${MAX_FILES} pièces jointes au plus.`); break; }
    if (!TYPES.includes(x.type)) { toast(`« ${x.name} » : seulement des images ou des PDF.`); continue; }
    if (x.size > MAX_ONE) { toast(`« ${x.name} » dépasse 4 Mo.`); continue; }
    if (f.reduce((s, y) => s + y.size, 0) + x.size > MAX_ALL) { toast('10 Mo en tout au plus.'); break; }
    try { f.push({ name: x.name, type: x.type, size: x.size, data: await readB64(x) }); } catch { toast(`« ${x.name} » est illisible.`); }
  }
  redraw();
  return true;
});
ACTIONS.lrdel = (el, d) => { files().splice(+d.id, 1); redraw(); };

FORMS.logoreqf = async (v, form) => {
  const message = String(v.message || '').trim(), f = files();
  if (message.length < 2 && !f.length) return toast('Écris quelques mots ou ajoute une pièce jointe.');
  const btn = form?.querySelector('[type=submit]'); if (btn) btn.textContent = 'Envoi…';
  let why = '';
  const { data, error } = await sb.functions.invoke('demande-logo', { body: { club: S.clubId, message, files: f.map((x) => ({ name: x.name, type: x.type, data: x.data })) } });
  if (error) { try { why = (await error.context?.json?.())?.erreur || ''; } catch { why = ''; } }
  if (btn) btn.textContent = 'Envoyer la demande à mpc';
  if (error || !data?.envoye) return toast(why || 'Demande pas envoyée : réessaie plus tard.');
  S.lrFiles = []; redraw();
  const m = document.getElementById('lrmsg'); if (m) { m.value = ''; m.defaultValue = ''; }
  toast('Demande envoyée à mypocketclub. Réponse par e-mail.');
  const r = await sb.rpc('my_logo_requests', { p_club: S.clubId }); S.lrSent = r.error ? S.lrSent : r.data || [];
  const s = document.getElementById('lrsent'); if (s) s.innerHTML = sentList();
};

// ---------- Admin › À traiter : demandes de logo ----------
hooks.adminLogos = () => {
  const a = S.admLogo; if (a === undefined) { S.admLogo = null; sb.rpc('admin_logo_requests').then((r) => { S.admLogo = r.error ? [] : r.data || []; render(true); }); return ''; }
  const l = arr(a); if (!l.length) return '';
  return `<div class="sec"><h2>Demandes de logo</h2><span class="det">${l.length}</span></div><section class="card"><div class="list">${l.map((r) => `<div class="row static"><span class="g">${esc(r.club)}${r.city ? ' · ' + esc(r.city) : ''}<small>${esc(when(r.at))} · ${esc(r.president || 'président')}${arr(r.files).length ? ' · ' + esc(arr(r.files).join(', ')) : ''}${r.message ? '<br>' + esc(String(r.message).slice(0, 300)) : ''}</small></span><button class="btn small" data-act="admlogodone" data-id="${esc(r.id)}">Fait</button></div>`).join('')}</div><p class="note">Les pièces jointes sont dans l’e-mail « Demande de logo ». « Répondre » écrit au président.</p></section>`;
};
ACTIONS.admlogodone = async (el, d) => { if (await run(sb.rpc('admin_logo_done', { p_id: d.id }), 'Demande marquée comme faite.')) { S.admLogo = undefined; render(true); } };
