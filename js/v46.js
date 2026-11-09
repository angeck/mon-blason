// mypocketclub · alpha 4.6.0 · n° 148 : administrateurs de mypocketclub.
// Seul l'administrateur principal ajoute ou retire un administrateur (vérifié par la base : admin_add, admin_remove).
// Un administrateur ajouté n'est jamais principal : il ne peut pas créer d'autre administrateur.
import { S, sb, esc, run, render, ACTIONS, FORMS, armed, isArmed } from './core.js';
import { BRAND } from '../config.js';
import { header, icon, field, delBtn } from './ui.js';
import { V37_TOP } from './v37.js';

export const adminsButton = () => `<button class="btn" data-act="admins">${icon('user', 20)}Administrateurs</button><p class="note">Seul l’administrateur principal ajoute ou retire un administrateur.</p>`;
async function load() { const r = await run(sb.rpc('admin_list')); S.admins = Array.isArray(r) ? r : []; }
function screen() {
  const head = header({ brand: true, back: true, kicker: 'Administration ' + BRAND.name, title: 'Administrateurs' });
  if (!S.isAdmin) return head + '<main class="bd"><p class="empty">Réservé à l’administrateur.</p></main>';
  const l = S.admins; if (!l) return head + '<main class="bd"><p class="empty">Chargement…</p></main>';
  const principal = l.some((x) => x.user_id === S.me.id && x.principal);
  let b = `<div class="card"><div class="list">${l.map((x) => `<div class="row static"><span class="g">${esc(x.name || x.email || 'Compte')}<small>${esc(x.email || '')}</small></span>${x.principal ? '<span class="pill ok">Principal</span>' : principal ? delBtn('admrm', x.user_id, 'Retirer', 'Confirmer', isArmed('adm' + x.user_id), 'style="flex:none"') : '<span class="pill">Administrateur</span>'}</div>`).join('')}</div></div>`;
  b += principal
    ? `<form id="admaddf" class="card"><div class="kick">Ajouter un administrateur</div>${field('adme', 'E-mail du compte', '<input id="adme" name="email" type="email" required autocomplete="off" placeholder="prenom@exemple.fr">')}<button class="btn main" type="submit">${icon('plus', 20)}Ajouter</button><p class="note">La personne doit déjà avoir un compte ${esc(BRAND.name)}. Elle voit l’administration (clubs à valider, demandes de clubs, demandes de schéma), mais ne peut pas créer d’autre administrateur.</p></form>`
    : '<p class="note">Seul l’administrateur principal ajoute ou retire un administrateur.</p>';
  return head + `<main class="bd">${b}</main>`;
}
Object.assign(V37_TOP, { admins: () => screen() });
Object.assign(ACTIONS, {
  admins: async () => { S.view = { type: 'admins' }; S.admins = null; render(); await load(); render(true); },
  admrm: async (el, d) => { if (!armed('adm' + d.id)) return; if (await run(sb.rpc('admin_remove', { p_user: d.id }), 'Administrateur retiré.')) { await load(); render(true); } },
});
FORMS.admaddf = async (v) => {
  if (await run(sb.rpc('admin_add', { p_email: String(v.email || '').trim().toLowerCase() }), 'Administrateur ajouté.')) { await load(); render(true); }
};
