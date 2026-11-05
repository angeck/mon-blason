// mypocketclub · alpha 4.2.0 · n° 112 · petit fabricant de PDF, sans bibliothèque extérieure (npm et les CDN ne sont pas nécessaires).
// Texte (Helvetica et Helvetica gras, accents français en WinAnsi), rectangles de couleur, plusieurs pages A4.
// Unités : millimètres, origine en haut à gauche (comme à l'écran). Sortie : Uint8Array (fichier PDF complet).
const MM = 72 / 25.4, W = 210, H = 297;
// Largeurs Helvetica (sur 1000) des caractères 32 à 126 ; les lettres accentuées prennent la largeur de leur lettre de base
const AW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Caractères hors Latin-1 présents dans les textes français, vers WinAnsi
const WIN = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'œ': 0x9c, 'Œ': 0x8c, ' ': 0x20, ' ': 0x20 };
export function winAnsi(s) {
  const out = [];
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (WIN[ch] !== undefined) out.push(WIN[ch]);
    else if (c === 10 || c === 13 || c === 9) out.push(32);
    else if ((c >= 32 && c <= 126) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else out.push(63); // « ? »
  }
  return out;
}
const base = (ch) => ch.normalize('NFD').charAt(0);
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (const ch of String(s ?? '')) { const b = base(ch).codePointAt(0); w += b >= 32 && b <= 126 ? AW[b - 32] : ch === '€' ? 556 : ch === '—' ? 1000 : 556; }
  return (w * (bold ? 1.06 : 1) * size) / 1000 / MM; // en mm
}
// Coupe un texte en lignes qui tiennent dans « width » mm
export function wrap(s, size, width, bold = false) {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? cur + ' ' + word : word;
      if (textWidth(t, size, bold) <= width || !cur) cur = t; else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return lines;
}
const rgb = (hex) => { const n = parseInt(String(hex || '#000000').replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(3)).join(' '); };
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
const n2 = (v) => (Math.round(v * 100) / 100).toString();

export class Pdf {
  constructor() { this.pages = []; this.page(); }
  page() { this.ops = []; this.pages.push(this.ops); return this; }
  rect(x, y, w, h, fill, stroke) {
    const Y = (H - y - h) * MM;
    if (fill) this.ops.push(`${rgb(fill)} rg ${n2(x * MM)} ${n2(Y)} ${n2(w * MM)} ${n2(h * MM)} re f`);
    if (stroke) this.ops.push(`${rgb(stroke)} RG 0.6 w ${n2(x * MM)} ${n2(Y)} ${n2(w * MM)} ${n2(h * MM)} re S`);
    return this;
  }
  line(x1, y1, x2, y2, color = '#D8DCEA', width = 0.3) { this.ops.push(`${rgb(color)} RG ${n2(width * MM)} w ${n2(x1 * MM)} ${n2((H - y1) * MM)} m ${n2(x2 * MM)} ${n2((H - y2) * MM)} l S`); return this; }
  // y = ligne de base du texte (mm depuis le haut)
  text(x, y, s, { size = 11, bold = false, color = '#11162E', align = 'left', strike = false } = {}) {
    const w = textWidth(s, size, bold), X = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${n2(X * MM)} ${n2((H - y) * MM)} Td <${hex(winAnsi(s))}> Tj ET`);
    if (strike) this.line(X, y - size * 0.12, X + w, y - size * 0.12, color, 0.3);
    return w;
  }
  // Paragraphe : renvoie la position sous le dernier trait
  para(x, y, s, width, o = {}) {
    const size = o.size || 11, lh = (o.lh || 1.35) * size / MM;
    wrap(s, size, width, o.bold).forEach((l, i) => this.text(x, y + i * lh, l, o));
    return y + wrap(s, size, width, o.bold).length * lh;
  }
  bytes() {
    const objs = [], add = (s) => { objs.push(s); return objs.length; };
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pagesId = objs.length + 1; add(''); // réservé pour /Pages
    const kids = [];
    for (const ops of this.pages) {
      const body = ops.join('\n');
      const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n2(W * MM)} ${n2(H * MM)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const b = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 255; // tout est déjà en octets (texte en hexadécimal)
    return b;
  }
}
export function toBase64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
