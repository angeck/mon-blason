// mypocketclub · test du petit fabricant de PDF (n° 112), sans navigateur.
// Usage : node tests/pdf.test.mjs
import { Pdf, winAnsi, wrap, textWidth, toBase64 } from '../js/pdfmin.js';
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ok    · ' : '  ÉCHEC · ') + n); };
const p = new Pdf();
p.rect(0, 0, 210, 30, '#C2410C'); p.text(14, 15, 'BC Testville · Pré-convocation « U9 F » – l’équipe', { size: 16, bold: true, color: '#FFFFFF' });
p.para(14, 40, 'Nous avons le plaisir de vous confirmer les rencontres suivantes à domicile. '.repeat(4), 182, { size: 10 });
p.page(); p.text(14, 20, 'Deuxième page', { size: 12 });
const b = p.bytes(), s = Buffer.from(b).toString('latin1');
check('commence par %PDF et finit par %%EOF', s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
check('deux pages A4', /\/Count 2/.test(s) && (s.match(/\/MediaBox \[0 0 595.28 841.89\]/g) || []).length === 2);
check('polices Helvetica et Helvetica gras en WinAnsi (accents)', /\/BaseFont \/Helvetica /.test(s) && /\/BaseFont \/Helvetica-Bold /.test(s) && /WinAnsiEncoding/.test(s));
// table des renvois : chaque décalage pointe sur « N 0 obj »
const xref = +/startxref\n(\d+)/.exec(s)[1], rows = s.slice(xref).split('\n').slice(3).filter((l) => / 00000 n $/.test(l));
check('table des renvois exacte (le fichier s’ouvre partout)', s.slice(xref).startsWith('xref') && rows.every((l, i) => s.slice(+l.slice(0, 10)).startsWith(`${i + 1} 0 obj`)));
check('é, è, à, ç, «, », –, ’ en WinAnsi', JSON.stringify(winAnsi('éèàç«»–’')) === JSON.stringify([0xe9, 0xe8, 0xe0, 0xe7, 0xab, 0xbb, 0x96, 0x92]));
check('caractère inconnu remplacé par « ? »', winAnsi('😀')[0] === 63);
check('coupe des lignes à la largeur demandée', wrap('un deux trois quatre cinq six sept huit neuf dix', 12, 30).every((l) => textWidth(l, 12) <= 30) && wrap('un deux trois quatre cinq six sept huit neuf dix', 12, 30).length > 1);
check('texte du PDF en hexadécimal (pas d’injection possible)', !/\(BC Testville/.test(s) && /<4243205465737476696c6c65/i.test(s));
check('base64 commence par JVBERi0 (« %PDF- »)', toBase64(b).startsWith('JVBERi0'));
console.log(`\n   ${ok} réussis sur ${ok + ko} tests du PDF`);
if (ko) process.exitCode = 1;
