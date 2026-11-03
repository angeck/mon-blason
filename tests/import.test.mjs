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
// ---------- n° 102 (alpha 3.8.0) · lecture d'une liste d'équipes ----------
{
  const { parseTeams, teamDoubts } = await import('../js/equipes_import.js');
  const brief = (l) => l.map((t) => [t.name, t.category, t.gender, t.slots]);
  eq('équipes : lignes libres, séparateur « ; »', brief(parseTeams('U13F ; mercredi 17h-18h30 ; gymnase Jean Moulin\nSeniors filles jeudi 20 h salle Coubertin\nU11 masculins samedi 10:00 gymnase\n-15 ans mixte, mardi 18h, COSEC')), [
    ['U13 F', 'U13', 'Féminine', 'Mercredi 17 h – 18 h 30, gymnase Jean Moulin'], ['Seniors F', 'Seniors', 'Féminine', 'Jeudi 20 h, salle Coubertin'],
    ['U11 M', 'U11', 'Masculine', 'Samedi 10 h, gymnase'], ['U15', 'U15', 'Mixte', 'Mardi 18 h, COSEC']]);
  const xl = [['Planning des entraînements 2026-2027'], ['Équipe', 'Catégorie', 'Sexe', 'Jour', 'Horaire', 'Salle'],
    ['Reines', 'U18', 'F', 'Lundi', '19h-20h30', 'Gymnase Jean-Moulin'], ['Reines', 'U18', 'F', 'Jeudi', '19h', 'Gymnase Jean-Moulin'], ['', '', '', '', '', ''], ['Baby', 'U7', 'Mixte', 'Samedi', '10h-11h', 'Dojo']];
  eq('équipes : tableau Excel avec titre, créneaux regroupés', brief(parseTeams(xl)), [
    ['Reines', 'U18', 'Féminine', 'Lundi 19 h – 20 h 30, Gymnase Jean-Moulin ; Jeudi 19 h, Gymnase Jean-Moulin'], ['Baby', 'U7 (baby)', 'Mixte', 'Samedi 10 h – 11 h, Dojo']]);
  eq('équipes : colonne « Créneau » unique', brief(parseTeams('Catégorie\tGenre\tCréneau\tGymnase\nU9\tmixte\tmercredi 14h\tGymnase B')), [['U9', 'U9', 'Mixte', 'Mercredi 14 h, Gymnase B']]);
  eq('équipes : ligne sans catégorie ni nom ignorée, total ignoré', parseTeams('mercredi 14h\nTotal 3 équipes').length, 0);
  eq('équipes : cases douteuses (genre et créneau manquants)', [...teamDoubts(parseTeams('Loisirs')[0])].sort(), ['gender', 'slots']);
  eq('équipes : catégorie inconnue douteuse', teamDoubts({ name: 'Élite', category: 'Élite', gender: 'Mixte', slots: 'Lundi 20 h' }).has('category'), true);
  console.log(`${ok} réussis, ${ko} échecs (avec les tests des équipes, n° 102)`);
}
process.exit(ko ? 1 : 0);
