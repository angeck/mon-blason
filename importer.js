// Mon Blason · lecture « intelligente » d'une liste de joueurs (copier-coller, Excel/CSV, texte lu sur une photo)
// Reconnaît : en-tête n'importe où dans les 10 premières lignes, colonne « Nom, prénom » combinée ou colonnes séparées,
// « Prénom NOM » comme « NOM Prénom » (le nom en capitales), noms composés (LE LAY, DA COSTA MOREIRA),
// annotations entre parenthèses, dates jj/mm/aaaa ou aa ou nombres Excel, e-mail et téléphone du parent.
// Ignore les colonnes inutiles (ville…), les lignes vides, les totaux. Aucune donnée n'est envoyée ici.

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@]/g, '');
const RX_MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RX_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/;
const RX_PHONE = /(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}/;
const RX_LIC = /\b[A-Z]{2}\d{6,8}\b/;

export function parseDate(s) {
  s = String(s ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(RX_DATE))) {
    let [, d, mo, y] = m; if (y.length === 2) y = (+y > 40 ? '19' : '20') + y;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return '';
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Math.floor(+s); if (n > 7000 && n < 60000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10); }
  return '';
}
const cap = (w) => w.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (a, b, c) => b + c.toUpperCase());
const isUpperWord = (w) => /\p{L}{2,}/u.test(w) && w === w.toUpperCase() && w !== w.toLowerCase();

// « Alice LE LAY », « LE LAY Alice », « Le Lay, Alice », « Mykeejah VARELA (garçon) »
export function splitName(raw, swap) {
  let s = String(raw ?? '').replace(/\([^)]*\)/g, ' ').replace(/[*_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.includes(',')) { const [a, b] = s.split(',').map((x) => x.trim()); if (a && b) return swap ? { first: cap(a), last: b.toUpperCase() === b ? b : cap(b) } : { first: cap(b), last: a.toUpperCase() === a ? a : cap(a) }; }
  const w = s.split(' ').filter(Boolean);
  if (w.length === 1) return { first: cap(w[0]), last: '' };
  const up = w.map(isUpperWord), nUp = up.filter(Boolean).length;
  let first, last;
  if (nUp > 0 && nUp < w.length) {
    // bloc de mots en capitales = nom de famille (au début ou à la fin)
    if (up[0]) { const k = up.findIndex((x) => !x); last = w.slice(0, k).join(' '); first = w.slice(k).join(' '); }
    else { const k = up.indexOf(true); first = w.slice(0, k).join(' '); last = w.slice(k).join(' '); }
  } else { first = w[0]; last = w.slice(1).join(' '); }
  if (swap) [first, last] = [last, first];
  return { first: cap(first), last: isUpperWord(last.replace(/[\s'-]/g, '')) ? last : cap(last) };
}

const HEAD = {
  name: (c) => (c.includes('prenom') && c.replace('prenom', '').includes('nom')) || c === 'joueur' || c === 'enfant' || c === 'identite',
  first: (c) => c.includes('prenom') && !c.replace('prenom', '').includes('nom'),
  last: (c) => (c === 'nom' || c.startsWith('nomde') || c === 'nomdefamille' || c === 'lastname' || (c.startsWith('nom') && !c.includes('prenom'))),
  birth: (c) => c.includes('naiss') || c.includes('birth') || c === 'ddn' || c === 'nele' || c === 'nee',
  email: (c) => c.includes('mail') || c.includes('courriel'),
  phone: (c) => c.includes('tel') || c.includes('portable') || c.includes('mobile'),
  licence: (c) => c.includes('licence') || c.includes('license') || c.includes('numlic'),
};
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hd = rows[i].map(strip); let hits = 0; const map = {};
    hd.forEach((c, j) => { if (!c) return; for (const k of ['name', 'first', 'last', 'birth', 'email', 'phone', 'licence']) if (map[k] === undefined && HEAD[k](c)) { if (k === 'first' && HEAD.name(c)) continue; if (k === 'last' && HEAD.name(c)) continue; map[k] = j; hits++; break; } });
    if (map.name !== undefined || ((map.first !== undefined || map.last !== undefined) && hits >= 1) || hits >= 2) return { i, map };
  }
  return null;
}
function fromLine(line, swap) {
  let s = String(line ?? '');
  const mail = (s.match(RX_MAIL) || [''])[0]; s = s.replace(mail, ' ');
  const dm = s.match(RX_DATE), date = dm ? parseDate(dm[0]) : ''; if (dm) s = s.replace(dm[0], ' ');
  const ph = (s.match(RX_PHONE) || [''])[0]; s = s.replace(ph, ' ');
  const lic = (s.match(RX_LIC) || [''])[0]; if (lic) s = s.replace(lic, ' ');
  // le nom = ce qui précède la date, l'e-mail ou le téléphone ; le reste (ville…) est ignoré
  const cut = [dm?.index, line.indexOf(mail || '\u0000'), line.indexOf(ph || '\u0000')].filter((x) => x != null && x > 0);
  let namePart = cut.length ? String(line).slice(0, Math.min(...cut)) : s;
  namePart = namePart.replace(/[;\t]+/g, ' ').replace(/\d+/g, ' ');
  const n = splitName(namePart, swap);
  return n && { first_name: n.first, last_name: n.last, birth_date: date, licence: lic, email: mail.toLowerCase(), phone: ph.replace(/[^\d+]/g, '').replace(/^\+33/, '0').replace(/(\d{2})(?=\d)/g, '$1 ').trim() };
}
const normPhone = (p) => { const d = String(p ?? '').replace(/[^\d+]/g, '').replace(/^\+33/, '0'); return /^0\d{9}$/.test(d) ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : ''; };

// Entrée : un texte (lignes) ou un tableau de lignes (cellules). Sortie : [{first_name, last_name, birth_date, licence, email, phone}]
export function smartParse(input, opts = {}) {
  const swap = !!opts.swap;
  const cell = (c) => (c instanceof Date ? new Date(c.getTime() + 12 * 3600e3).toISOString().slice(0, 10) : typeof c === 'number' && /^\d{9}$/.test(String(c)) ? '0' + c : String(c ?? '').trim());
  let rows = Array.isArray(input) ? input.map((r) => (Array.isArray(r) ? r : [r]).map(cell))
    : String(input ?? '').split(/\r?\n/).map((l) => (/[;\t]/.test(l) ? l.split(/[;\t]/) : [l]).map((c) => c.trim()));
  rows = rows.filter((r) => r.some((c) => /\p{L}{2,}/u.test(c)));
  const h = findHeader(rows), out = [];
  if (h && rows[h.i].length > 1) {
    const m = h.map;
    rows.slice(h.i + 1).forEach((r) => {
      let first = '', last = '';
      if (m.name !== undefined) { const n = splitName(r[m.name], swap); if (!n) return; first = n.first; last = n.last; }
      else { const f = splitName(r[m.first] || '', false), l = String(r[m.last] ?? '').replace(/\([^)]*\)/g, '').trim(); if (!f && !l) return; first = f ? (f.last ? f.first + ' ' + f.last : f.first) : ''; last = isUpperWord(l.replace(/[\s'-]/g, '')) ? l : cap(l); if (swap) [first, last] = [last, first]; }
      if (!/\p{L}/u.test(first + last)) return;
      const all = r.join(' ');
      out.push({ first_name: first, last_name: last, birth_date: m.birth !== undefined ? parseDate(r[m.birth]) : '', licence: m.licence !== undefined ? r[m.licence] : (all.match(RX_LIC) || [''])[0],
        email: (m.email !== undefined ? String(r[m.email]).match(RX_MAIL) : all.match(RX_MAIL))?.[0]?.toLowerCase() || '', phone: normPhone(m.phone !== undefined ? r[m.phone] : (all.match(RX_PHONE) || [''])[0]) });
    });
  } else {
    rows.slice(h ? h.i + 1 : 0).forEach((r) => {
      const line = r.join(' ');
      if (findHeader([r.map((c) => c)])) return;            // ligne d'en-tête lue sur une photo
      const x = fromLine(line, swap); if (x && x.first_name && /\p{L}{2,}/u.test(x.first_name + x.last_name)) out.push(x);
    });
  }
  return out.filter((x) => x.first_name || x.last_name);
}
