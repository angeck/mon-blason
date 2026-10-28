// Tests de lecture de listes (données fictives, même forme que les listes réelles des clubs)
import { smartParse, splitName } from '../importer.js';
let ok = 0, ko = 0;
const eq = (name, got, exp) => { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g === e) ok++; else { ko++; console.log('ÉCHEC', name, '\n  obtenu ', g, '\n  attendu', e); } };
const pick = (r) => r.map((x) => [x.first_name, x.last_name, x.birth_date, x.email, x.phone]);

// 1. Tableau Excel : titre « Nom, prénom » combiné, en-tête sur plusieurs lignes, colonne Ville, cellule « 20 » en trop
const xl = [
  ['Nom, prénom', 'Date\nDe\nnaissance', 'Mail', 'Numéro\nde\nTéléphone', 'Ville', '20'],
  ['Anna LE BRAS', '16/08/2018', 'parent.un@exemple.fr', '06 11 22 33 44', 'Testville'],
  ['Bruno DA SILVA COSTA', '03/08/2018', 'p2@exemple.fr', '0611223345', 'Autreville'],
  ['Zoé MARTIN (fille)', '26/11/2019', 'P3@Exemple.FR', '+33 6 11 22 33 46', 'Testville'],
  ['', '', '', '', ''],
];
eq('excel combiné', pick(smartParse(xl)), [
  ['Anna', 'LE BRAS', '2018-08-16', 'parent.un@exemple.fr', '06 11 22 33 44'],
  ['Bruno', 'DA SILVA COSTA', '2018-08-03', 'p2@exemple.fr', '06 11 22 33 45'],
  ['Zoé', 'MARTIN', '2019-11-26', 'p3@exemple.fr', '06 11 22 33 46']]);
// 2. Ligne de titre au-dessus de l'en-tête
eq('titre avant en-tête', smartParse([['Liste U9 saison 2026'], ...xl]).length, 3);
// 3. Colonnes séparées, NOM d'abord
eq('colonnes séparées', pick(smartParse([['NOM', 'Prénom', 'Né le'], ['DUPONT', 'jean-pierre', '05/06/2017']])), [['Jean-Pierre', 'DUPONT', '2017-06-05', '', '']]);
// 4. Texte lu sur une photo (pas de séparateurs)
const ocr = `Nom, prénom Date De naissance Mail Numéro de Téléphone Ville
Anna LE BRAS 16/08/2018 parent.un@exemple.fr 06 11 22 33 44 Testville
Bruno DA SILVA COSTA 03/08/2018 p2@exemple.fr 06 11 22 33 45 Autreville
Zoé MARTIN (fille) 26/11/2019 p3@exemple.fr 06 11 22 33 46 Testville`;
eq('photo', pick(smartParse(ocr)), [
  ['Anna', 'LE BRAS', '2018-08-16', 'parent.un@exemple.fr', '06 11 22 33 44'],
  ['Bruno', 'DA SILVA COSTA', '2018-08-03', 'p2@exemple.fr', '06 11 22 33 45'],
  ['Zoé', 'MARTIN', '2019-11-26', 'p3@exemple.fr', '06 11 22 33 46']]);
// 5. Copier-coller simple
eq('copier-coller', pick(smartParse('Lily;Martin;12/03/2018\nLéo Dubois')), [['Lily', 'Martin', '2018-03-12', '', ''], ['Léo', 'Dubois', '', '', '']]);
// 6. NOM Prénom sans en-tête
eq('NOM Prénom', splitName('LE BRAS Anna'), { first: 'Anna', last: 'LE BRAS' });
eq('inversion demandée', splitName('Martin Lily', true), { first: 'Lily', last: 'Martin' });
// 7. Nombre Excel pour la date
eq('date Excel', smartParse([['Prénom', 'Nom', 'Naissance'], ['Lou', 'Petit', '43300']])[0].birth_date, '2018-07-19');
console.log(`${ok} réussis, ${ko} échecs`);
process.exit(ko ? 1 : 0);
