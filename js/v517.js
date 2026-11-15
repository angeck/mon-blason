// mypocketclub · alpha 5.17.0
//   N° 254 · gymnases du club : le président enregistre un ou plusieurs gymnases (Président › Réglages) ; le lieu des rendez-vous
//            à domicile (entraînements, autres rendez-vous, matchs « à domicile ») se met tout seul (un gymnase) ou se choisit dans
//            une liste (plusieurs ; le premier est présélectionné) ; « Autre lieu » pour une adresse libre. Le lieu reste modifiable.
//            Un toucher sur l'adresse ouvre l'application de cartes : Plans (iPhone), l'application par défaut (Android, lien geo:),
//            Google Maps dans le navigateur (ordinateur). Aucun service payant.
//   N° 257 · après l'envoi d'une demande pour rejoindre un club (ou la création d'un club), un panneau propose d'activer les
//            notifications (sur iPhone non installé : installer d'abord). « Plus tard » : un rappel reste sur l'Accueil tant que la
//            demande attend. Sans notification, la base met un e-mail « ta demande est validée » en attente : l'application de la
//            personne qui valide demande son envoi juste après (envoyer-email, branche « validated »).
// Rappel : chaque droit est vérifié par la base (supabase/alpha_5_17_0.sql) ; l'écran n'est qu'un confort.
import { S, sb, esc, hooks, ACTIONS, FORMS, CHANGES, render, toast, run, isPresident, armed, isArmed, isActive } from './core.js';
import { icon, field } from './ui.js';
import { keepForm } from './agenda.js';
import { N, isIOS, pushState } from './notif.js';

// ---------- n° 254 · gymnases ----------
async function loadGyms() {
  const cid = S.clubId; if (!cid) return;
  const { data } = await sb.from('club_gyms').select('id,name,address,position,created_at').eq('club_id', cid).order('position').order('created_at');
  if (S.clubId === cid) S.gyms = Array.isArray(data) ? data : [];
}
const gymsNow = () => {
  if (!S.clubId || !isActive()) return [];
  if (S.gymsClub !== S.clubId) { S.gymsClub = S.clubId; S.gyms = null; loadGyms().then(() => render(true)); }
  return S.gyms;
};
export const gymPlace = (g) => [String(g.name || '').trim(), String(g.address || '').trim()].filter(Boolean).join(', ');
const gymOf = (place) => (S.gyms || []).find((g) => gymPlace(g) === String(place || '').trim());
// Titre automatique : le nom du gymnase seul (sans l'adresse)
hooks.placeShort = (place) => gymOf(place)?.name || String(place || '').trim();

export function mapsUrl(place) {
  const q = encodeURIComponent(String(place || '').trim());
  if (isIOS()) return 'https://maps.apple.com/?q=' + q;
  if (/android/i.test(navigator.userAgent)) return 'geo:0,0?q=' + q;
  return 'https://www.google.com/maps/search/?api=1&query=' + q;
}
const desk = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const linkAttrs = (place) => { const u = mapsUrl(place); return `href="${esc(u)}"${u.startsWith('https:') ? ' target="_blank" rel="noopener"' : ''}`; };
hooks.goBtn = (place) => `<a class="btn small gobtn" ${linkAttrs(place)} data-go="1">${icon('pin', 20)}${desk() ? 'Ouvrir la carte' : 'Y aller'}</a>`;
hooks.placeLine = (place) => {
  const g = gymOf(place);
  return `<div class="card placecard"><div class="kick">Lieu</div>${g ? `<b>${esc(g.name)}</b>` : ''}<a class="placelink" ${linkAttrs(place)}>${icon('pin', 16)}${esc(g ? g.address || g.name : place)}</a></div>`;
};

// Champ « Lieu » du formulaire d'un rendez-vous
hooks.placeField = (f, matchy) => {
  const home = !matchy || f.at_home !== false, gyms = home ? gymsNow() || [] : [];
  const free = (note = '') => field('el', 'Lieu', `<input id="el" name="place" data-evauto="1" value="${esc(f.place || '')}" placeholder="Ex. Gymnase de Boissy">`) + note;
  if (!gyms.length) return free(home && isPresident() && gymsNow() ? '<p class="note">Astuce : enregistre les gymnases du club dans Président › Réglages, le lieu se mettra tout seul.</p>' : '');
  // nouveau rendez-vous sans lieu : le premier gymnase (le seul, s'il n'y en a qu'un)
  if (!f.id && !String(f.place || '').trim() && !f.gymOther) f.place = gymPlace(gyms[0]);
  const cur = gyms.findIndex((g) => gymPlace(g) === String(f.place || '').trim());
  const other = f.gymOther || (cur < 0 && String(f.place || '').trim());
  if (gyms.length === 1 && !other) return free('<p class="note">Gymnase du club, mis tout seul. Tu peux le modifier.</p>');
  const opts = gyms.map((g, i) => `<option value="${i}" ${!other && i === cur ? 'selected' : ''}>${esc(g.name)}</option>`).join('') + `<option value="autre" ${other ? 'selected' : ''}>Autre lieu (écrire l’adresse)</option>`;
  return `<div class="field"><label for="elg">Lieu</label><select id="elg" data-evgym="1">${opts}</select>
    ${other ? `<input id="el" name="place" data-evauto="1" value="${esc(f.place || '')}" placeholder="Adresse du lieu" aria-label="Adresse du lieu" style="margin-top:8px">` : `<input type="hidden" name="place" value="${esc(f.place || '')}"><p class="note">${esc(gyms[cur]?.address || '')}</p>`}</div>`;
};
CHANGES.push(async (t) => {
  if (!t.dataset.evgym) return false;
  keepForm();
  const g = (S.gyms || [])[+t.value];
  if (t.value === 'autre' || !g) { S.form.gymOther = true; if (gymOf(S.form.place)) S.form.place = ''; }
  else { S.form.gymOther = false; S.form.place = gymPlace(g); }
  render(true);
  return true;
});

// Président › Réglages › « Gymnases du club »
hooks.gymSettings = () => {
  if (!isPresident()) return '';
  const gyms = gymsNow();
  if (!gyms) return '<div class="sec"><h2>Gymnases du club</h2></div><p class="empty">Chargement…</p>';
  const ed = gyms.find((g) => g.id === S.gymEdit);
  const rows = gyms.map((g) => `<div class="row static"><span class="g">${esc(g.name)}<small>${esc(g.address || 'Adresse non renseignée')}</small></span>
    <button class="roundbtn" data-act="gymedit" data-id="${g.id}" aria-label="Modifier ${esc(g.name)}">${icon('edit', 18)}</button>
    <button class="btn small ${isArmed('gymdel' + g.id) ? 'danger armed' : 'ghost'}" data-act="gymdel" data-id="${g.id}">${isArmed('gymdel' + g.id) ? 'Confirmer' : 'Retirer'}</button></div>`).join('');
  return `<div class="sec"><h2>Gymnases du club</h2></div><div class="card" data-anchor="gyms">
    <p class="note" style="margin:0">Le lieu des entraînements et des rendez-vous à domicile se remplit tout seul avec ces gymnases. Un toucher sur l’adresse ouvre le GPS.</p>
    ${rows ? `<div class="list">${rows}</div>` : ''}
    <form id="gymf" class="stack">${ed ? `<div class="kick">Modifier ${esc(ed.name)}</div>` : `<div class="kick">${gyms.length ? 'Ajouter un gymnase' : 'Premier gymnase'}</div>`}
      ${field('gyn', 'Nom', `<input id="gyn" name="name" required maxlength="80" value="${esc(ed?.name || '')}" placeholder="Ex. Gymnase du Parc">`)}
      ${field('gya', 'Adresse', `<input id="gya" name="address" maxlength="200" value="${esc(ed?.address || '')}" placeholder="Numéro, rue, code postal, ville" autocomplete="street-address">`)}
      <div class="btns"><button class="btn main" type="submit">${icon(ed ? 'check' : 'plus', 20)}${ed ? 'Enregistrer' : 'Ajouter le gymnase'}</button>${ed ? '<button class="btn ghost" type="button" data-act="gymedit" data-id="">Annuler</button>' : ''}</div></form></div>`;
};
FORMS.gymf = async (v) => {
  const name = String(v.name || '').trim().slice(0, 80), address = String(v.address || '').trim().slice(0, 200);
  if (!name) return toast('Donne un nom au gymnase.');
  const q = S.gymEdit ? sb.from('club_gyms').update({ name, address }).eq('id', S.gymEdit)
    : sb.from('club_gyms').insert({ club_id: S.clubId, name, address, position: (S.gyms || []).length });
  if (await run(q, S.gymEdit ? 'Gymnase modifié.' : 'Gymnase ajouté.')) { S.gymEdit = null; await loadGyms(); render(true); }
};
Object.assign(ACTIONS, {
  gymedit: (el, d) => { S.gymEdit = d.id || null; render(true); },
  gymdel: async (el, d) => {
    if (!armed('gymdel' + d.id)) return;
    if (await run(sb.from('club_gyms').delete().eq('id', d.id), 'Gymnase retiré. Les rendez-vous déjà créés gardent leur lieu.')) { await loadGyms(); render(true); }
  },
});

// ---------- n° 257 · proposer les notifications après une demande ----------
const pending = () => (S.mems || []).filter((m) => m.status === 'pending');
const clubName = (id) => S.clubs?.[id]?.name || 'ton club';
function sheetHtml(kind, cid) {
  const ios = N.state === 'ios-install', club = esc(clubName(cid));
  const title = kind === 'club' ? 'Ton club est créé' : 'Ta demande est partie au club';
  const why = kind === 'club' ? `mypocketclub doit valider <b>${club}</b>.` : `Le président de <b>${club}</b> doit la valider.`;
  const body = ios
    ? `<h2>Sur iPhone, installe d’abord mypocketclub</h2><p>${why} Les notifications ne marchent qu’une fois l’application sur ton écran d’accueil :</p>
       <ol><li>touche ${icon('iosshare', 16)} <b>Partager</b> en bas de Safari ;</li><li>choisis <b>Sur l’écran d’accueil</b> ;</li><li>ouvre mypocketclub depuis l’icône.</li></ol>
       <div class="btns"><button class="btn main" data-act="nasklater">J’ai compris</button></div>
       <p class="note">Tu peux aussi attendre : un e-mail te prévient quand ${kind === 'club' ? 'ton club est validé' : 'ta demande est validée'}.</p>`
    : `<h2>${title}</h2><p>${why} Active les notifications pour le savoir tout de suite, sans rouvrir l’application.</p>
       <div class="btns"><button class="btn ghost" data-act="nasklater">Plus tard</button><button class="btn main" data-act="naskon">${icon('bell', 20)}Activer les notifications</button></div>
       <p class="note">Sans notification, tu reçois un e-mail quand ${kind === 'club' ? 'ton club est validé' : 'ta demande est validée'}.</p>`;
  return `<div class="nask-bg" data-act="nasklater"></div><div class="nask-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="nask-grip"></span><div class="nask-row"><span class="nask-bell">${icon('bell', 28, '#11162E')}</span><div class="nask-txt">${body}</div></div></div>`;
}
function closeSheet() { document.getElementById('nask')?.remove(); document.documentElement.classList.remove('naskopen'); }
async function openSheet(kind, cid, state) {
  if (state) N.state = state; else await pushState();
  if (!['off', 'ios-install'].includes(N.state)) return;   // déjà activées, refusées ou impossibles : l'e-mail prend le relais
  closeSheet();
  const d = document.createElement('div'); d.id = 'nask'; d.innerHTML = sheetHtml(kind, cid);
  document.body.appendChild(d); document.documentElement.classList.add('naskopen');
  d.querySelector('.nask-sheet .btn.main')?.focus();
}
hooks.openNotifAsk = openSheet;   // pour les tests
Object.assign(ACTIONS, {
  naskon: async (el) => { closeSheet(); await ACTIONS.pushon?.(el, {}); },
  nasklater: () => { closeSheet(); render(true); },
});
// Rappel sur l'Accueil (et l'écran d'attente) tant qu'une demande attend et que les notifications ne sont pas activées
hooks.pendNotif = () => {
  if (!pending().length || !['off', 'ios-install'].includes(N.state)) return '';
  const mail = esc(S.session?.user?.email || 'ton adresse');
  return `<div class="card nask-card"><div class="nask-row"><span class="nask-ic">${icon('mail', 24)}</span><div><b>On te prévient par e-mail</b>
    <p class="note" style="margin:2px 0 0">Tu n’as pas activé les notifications : quand ta demande sera validée, un e-mail arrivera sur ${mail}.</p>
    ${N.state === 'off' ? '<button class="linkbtn" data-act="pushon">Activer les notifications</button>' : '<button class="linkbtn" data-act="guide">Installer l’application pour les notifications</button>'}</div></div></div>`;
};
// Après une demande envoyée (premier club, autre rôle) ou un club créé : le panneau
const wrapAsk = (obj, key, kindOf) => {
  const fn = obj[key]; if (!fn) return;
  obj[key] = async (...a) => {
    const before = new Set(pending().map((m) => m.id)), club0 = S.clubId;
    const r = await fn(...a);
    const added = pending().find((m) => !before.has(m.id));
    const kind = kindOf(club0);
    if (added || kind === 'club') openSheet(kind === 'club' ? 'club' : 'adhesion', added?.club_id || S.clubId);
    return r;
  };
};
wrapAsk(ACTIONS, 'jsend', () => 'adhesion');
wrapAsk(ACTIONS, 'rqsend', () => 'adhesion');
// club créé : le président attend la validation de mypocketclub
wrapAsk(FORMS, 'clubf', (club0) => (S.clubId && S.clubId !== club0 && isPresident() ? 'club' : ''));

// La personne qui valide demande l'envoi des e-mails en attente (seulement pour ceux qui n'ont pas les notifications)
const sendValidated = () => sb.functions.invoke('envoyer-email', { body: { validated: true } }).catch(() => {});
const wrapSend = (obj, key) => { const fn = obj[key]; if (!fn) return; obj[key] = async (...a) => { const r = await fn(...a); sendValidated(); return r; }; };
wrapSend(ACTIONS, 'mok');      // adhésion validée (président, bureau, coach selon les droits)
wrapSend(ACTIONS, 'avalok');   // président validé par admin@ (écran « À valider »)
wrapSend(FORMS, 'admvalf');    // président validé par admin@ (fiche du club)
