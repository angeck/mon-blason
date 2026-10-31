// Pocket Club · alpha 3.2.5 · profils de test : une liste déroulante pour passer d'un compte de test à l'autre.
// Visible seulement quand on est connecté avec un des comptes de la liste SWITCH_PROFILES (config.js).
// Les comptes restent de vrais comptes : la base applique leurs vrais droits. Les connexions sont gardées sur CET appareil seulement.
import { SWITCH_PROFILES } from '../config.js';
import { S, sb, esc, toast, render, CHANGES } from './core.js';
import { unlinkPush } from './notif.js';

const KEY = (email) => 'pc_sw_' + email.toLowerCase();
const mail = () => (S.session?.user?.email || '').toLowerCase();
const listed = () => SWITCH_PROFILES.some((p) => p.email.toLowerCase() === mail());
const read = (email) => { try { const v = JSON.parse(localStorage.getItem(KEY(email)) || 'null'); return v && v.access_token && v.refresh_token ? v : null; } catch { return null; } };
const forget = (email) => { try { localStorage.removeItem(KEY(email)); } catch { /* */ } };

// Garde la connexion du compte courant (à chaque connexion et chaque renouvellement) s'il fait partie de la liste
export function saveSwitch(session) {
  try {
    const e = (session?.user?.email || '').toLowerCase();
    if (!e || !session.refresh_token || !SWITCH_PROFILES.some((p) => p.email.toLowerCase() === e)) return;
    localStorage.setItem(KEY(e), JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
  } catch { /* navigation privée : le sélecteur demandera le mot de passe */ }
}

// Quand le compte change, on efface ce qui appartenait à l'ancien compte
export function resetUser() {
  Object.assign(S, { me: null, mems: [], clubs: {}, names: {}, nicks: {}, phones: {}, view: null, stack: [], tab: 0, joinChecked: false, recovery: false, onb: null, sel: null, form: null });
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
}

export function switchBar() {
  if (!S.session || !listed()) return '';
  const cur = mail();
  return `<div class="swbar"><label for="swsel">Profil de test</label><select id="swsel" data-sw="1" aria-label="Changer de profil de test">${SWITCH_PROFILES.map((p) => {
    const e = p.email.toLowerCase();
    return `<option value="${esc(e)}" ${e === cur ? 'selected' : ''}>${esc(p.label)}${e !== cur && !read(e) ? ' (se connecter)' : ''}</option>`;
  }).join('')}</select></div>`;
}

export async function switchTo(email) {
  const e = email.toLowerCase();
  if (e === mail()) return;
  saveSwitch(S.session);
  await Promise.race([unlinkPush(), new Promise((r) => setTimeout(r, 1500))]);                        // le téléphone cesse de recevoir les notifications de l'ancien profil ; il sera rattaché au nouveau à l'ouverture
  const saved = read(e);
  if (saved) {
    const { error } = await sb.auth.setSession(saved);
    if (!error) return;                      // la connexion change : l'application se recharge toute seule
    forget(e);
  }
  // Pas de connexion gardée (ou expirée) : écran de connexion avec l'adresse déjà remplie. « local » : ne coupe pas les autres appareils.
  await sb.auth.signOut({ scope: 'local' });
  S.authEmail = e; S.authMode = 'login'; S.view = { type: 'auth' }; render();
  toast('Connecte-toi une fois à ce profil : la prochaine fois, un choix dans la liste suffira.');
}

CHANGES.push(async (t) => { if (!t.dataset.sw) return false; await switchTo(t.value); render(true); return true; });
