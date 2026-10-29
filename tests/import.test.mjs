// Tests de lecture de listes (données fictives, même forme que les listes réelles des clubs)
import { smartParse, splitName } from '../js/importer.js';
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

// ---------- alpha 3.0 : « Quelle colonne est quoi ? » et cases douteuses ----------
{
  const { analyse, fromMapping, doubts } = await import('../js/importer.js');
  const a = analyse('DURAND;Léo;12/03/2018;Évry\nMARTIN;Zoé;02/05/2017;Ris');
  eq('sans en-tête : reconnaissance incertaine', a.unsure, true);
  eq('sans en-tête : nom, prénom, date, ville ignorée', a.columns.map((c) => c.k), ['last', 'first', 'birth', 'skip']);
  eq('sans en-tête : lignes reconstruites', pick(fromMapping(a.body, a.columns, false)), [['Léo', 'DURAND', '2018-03-12', '', ''], ['Zoé', 'MARTIN', '2017-05-02', '', '']]);
  const b = analyse([['Nom, prénom', 'Date de naissance', 'Mail', 'Ville'], ['LE BRAS Anna', '16/08/2018', 'p@exemple.fr', 'Évry']]);
  eq('avec en-tête complet : pas d’écran des colonnes', b.unsure, false);
  eq('cases douteuses : mot sans voyelle, e-mail sans point', [...doubts({ first_name: 'Mrc', last_name: 'DURAND', email: 'a@b' }, true)].sort(), ['email', 'first_name']);
  eq('cases douteuses : ligne propre', doubts({ first_name: 'Lucie', last_name: 'DURAND', email: 'a@b.fr', phone: '06 12 34 56 78', birth_date: '2017-01-02' }, true).size, 0);
  console.log(`${ok} réussis, ${ko} échecs (avec les tests 3.0)`);
}
process.exit(ko ? 1 : 0);
