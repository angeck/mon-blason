// mypocketclub · n° 102 (alpha 3.8.0) · lecture « intelligente » d'une liste d'équipes (copier-coller, Excel/CSV, texte lu sur une photo).
// Reconnaît : en-tête n'importe où dans les 10 premières lignes (équipe, catégorie, genre, gymnase, jour, heure, créneau), ou lignes libres
// (« U11 F ; Mercredi 14 h – 15 h 30 ; gymnase Jean-Moulin »). Une ligne par équipe ou par créneau : les lignes d'une même équipe sont regroupées.
// Aucune donnée n'est envoyée ici, aucun nom de personne n'est attendu. Fichier sans dépendance (testé par tests/import.test.mjs).
// 5.9.0 · n° 226 : mêmes listes que BCATS et VCATS de core.js (recopiées : ce fichier reste sans dépendance)
const BCATS = ['U7 (baby)', 'U9', 'U11', 'U13', 'U15', 'U18', 'U21', 'Seniors', 'Loisirs', 'Vétérans'];
const VCATS = ['M7', 'M9', 'M11', 'M13', 'M15', 'M18', 'M21', 'Seniors', 'Masters'];
export const CATS = [...BCATS, ...VCATS.filter((c) => !BCATS.includes(c))];
// Nom proposé d'après la catégorie et le genre (même règle que autoName de equipe.js, n° 28)
export const autoName = (cat, gen) => ((cat || '').replace(' (baby)', '') + (gen === 'Féminine' ? ' F' : gen === 'Masculine' ? ' M' : '')).trim();
const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const HEAD = {
  name: /^(equipe|nom( de l'?equipe)?|intitule|team)$/,
  category: /^(categorie|cat\.?|age|tranche d'?age|niveau)$/,
  gender: /^(genre|sexe|fille\/garcon|f\/m|m\/f)$/,
  gym: /^(gymnase|salle|lieu|terrain|equipement|installation|complexe)$/,
  day: /^(jour|jours)$/,
  time: /^(heure|heures|horaire|horaires)$/,
  slot: /^(creneau|creneaux|entrainement|entrainements|seance|seances)$/,
};
const RX_TIME = /\b\d{1,2}\s?(?:h|:)\s?(?:\d{2})?(?:\s?(?:-|–|à|a)\s?\d{1,2}\s?(?:h|:)\s?(?:\d{2})?)?/i;
const RX_GYM = /\b(gymnase|salle|complexe|halle|stade|terrain|dojo|palais des sports|cosec)\b[^,;|\t]*/i;
// Catégorie : « U13 », « U 13 », « -13 ans », « moins de 13 ans », « Seniors », « Loisirs », « Vétérans », « Baby »
export function teamCategory(t) {
  const s = strip(t);
  let m = s.match(/\bu\s?-?\s?(\d{1,2})\b/) || s.match(/\bu(\d{1,2})[fm]\b/) || s.match(/(?:^|\s)-\s?(\d{1,2})\s?ans\b/) || s.match(/\bmoins de (\d{1,2}) ans\b/);
  if (m) { const c = 'U' + +m[1]; return c === 'U7' ? 'U7 (baby)' : c === 'U17' ? 'U18' : c === 'U20' ? 'U21' : c; } // n° 226 : U17 → U18, U20 → U21
  // 5.9.0 · n° 226 : volley « M15 », « M 18 »
  m = s.match(/\bm\s?-?\s?(\d{1,2})\b/) || s.match(/\bm(\d{1,2})[fm]\b/);
  if (m && VCATS.includes('M' + +m[1])) return 'M' + +m[1];
  if (/\bmaster/.test(s)) return 'Masters';
  if (/\bbaby\b/.test(s)) return 'U7 (baby)';
  if (/\bsenior/.test(s)) return 'Seniors';
  if (/\bloisir/.test(s)) return 'Loisirs';
  if (/\bveteran/.test(s)) return 'Vétérans';
  return '';
}
export function teamGender(t) {
  const s = strip(t);
  if (/\bmixte?s?\b/.test(s)) return 'Mixte';
  if (/\b(feminine?s?|filles?|fem|dames|femmes)\b/.test(s) || /\bu\s?\d{1,2}\s?f\b/.test(s) || /(^|\s)f$/.test(s)) return 'Féminine';
  if (/\b(masculins?e?s?|garcons?|gars|masc|hommes)\b/.test(s) || /\bu\s?\d{1,2}\s?m\b/.test(s) || /(^|\s)m$/.test(s)) return 'Masculine';
  return '';
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export function teamSlot(t) {
  const s = String(t ?? '');
  const days = DAYS.filter((d) => new RegExp('\\b' + d, 'i').test(strip(s))).map(cap);
  const tm = s.match(RX_TIME);
  const time = tm ? tm[0].replace(/\s*[:h]\s*(\d{2})/gi, ' h $1').replace(/(\d)\s*[:h](?!\s*\d)/gi, '$1 h').replace(/\s*(-|–|à|a)\s*/g, ' – ').replace(/\s+/g, ' ').replace(/ h 00\b/g, ' h').trim() : '';
  return [days.join(' et '), time].filter(Boolean).join(' ');
}
const teamGym = (t) => (String(t ?? '').match(RX_GYM)?.[0] || '').replace(/\s+/g, ' ').trim();
function toRows(input) {
  if (Array.isArray(input)) return input.map((r) => (Array.isArray(r) ? r : [r]).map((c) => String(c ?? '').trim()));
  return String(input || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => (/\t/.test(l) ? l.split('\t') : /;/.test(l) ? l.split(';') : /\s\|\s/.test(l) ? l.split('|') : [l]).map((c) => c.trim()));
}
// Une ligne par équipe (ou par créneau : les lignes d'une même équipe sont regroupées, créneaux mis bout à bout)
export function parseTeams(input) {
  const rows = toRows(input).filter((r) => r.some((c) => /\p{L}{2,}|\d/u.test(c)));
  let head = -1, cols = {};
  for (let i = 0; i < Math.min(10, rows.length) && head < 0; i++) {
    const m = {}; rows[i].forEach((c, j) => { const k = Object.keys(HEAD).find((x) => HEAD[x].test(strip(c))); if (k && m[k] === undefined) m[k] = j; });
    if (Object.keys(m).length >= 2) { head = i; cols = m; }
  }
  const out = [];
  rows.slice(head + 1).forEach((r) => {
    const all = r.join(' ');
    if (/^\s*(total|sous-total)\b/i.test(strip(all))) return;
    const get = (k) => (cols[k] !== undefined ? r[cols[k]] || '' : '');
    const nameCell = head >= 0 ? get('name') : '';
    const catSrc = head >= 0 ? get('category') || nameCell : all, genSrc = head >= 0 ? get('gender') || nameCell || get('category') : all;
    const category = teamCategory(catSrc) || (head >= 0 && get('category') ? get('category').trim() : '');
    const gender = teamGender(genSrc);
    let slot = head >= 0 ? (get('slot') ? teamSlot(get('slot')) || get('slot').trim() : teamSlot(get('day') + ' ' + get('time'))) : teamSlot(all);
    const gym = head >= 0 ? get('gym').trim() || teamGym(get('slot')) : teamGym(all);
    if (head >= 0 && !get('slot') && !get('day') && !get('time')) slot = teamSlot(all);
    let name = nameCell.trim();
    if (!name) name = autoName(category, gender);
    if (!name && !category) return;
    const where = [slot, gym].filter(Boolean).join(', ');
    const key = strip(name) + '|' + category + '|' + gender;
    const prev = out.find((x) => x.key === key);
    if (prev) { if (where && !prev.slots.split(' ; ').includes(where)) prev.slots = [prev.slots, where].filter(Boolean).join(' ; '); return; }
    out.push({ key, name, category, gender, slots: where });
  });
  return out.map(({ key, ...x }) => x);
}
// Cases douteuses (en orange) : catégorie inconnue, genre absent, créneau absent
export function teamDoubts(t) {
  const d = new Set();
  if (!t.category || !CATS.includes(t.category)) d.add('category');
  if (!t.gender) d.add('gender');
  if (!t.slots) d.add('slots');
  return d;
}

