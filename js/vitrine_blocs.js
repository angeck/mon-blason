// mypocketclub · bêta 1.9.0 : blocs de la vitrine (partagés par la page publique js/vitrine.js et l'application js/b190.js)
export const BLOCKS = [
  ['presentation', 'Présentation'], ['planning', 'Planning et équipes'], ['matchs', 'Prochains matchs à domicile'], ['resultats', 'Résultats (membres seulement)'],
  ['gymnases', 'Gymnases'], ['inscrire', 'S’inscrire'], ['cherche', 'On cherche'], ['palmares', 'Palmarès'], ['partenaires', 'Nos partenaires'],
  ['liens', 'Liens et réseaux'], ['rejoindre', 'Nous rejoindre'],
];
const LABEL = Object.fromEntries(BLOCKS);
export const blockLabel = (k) => LABEL[k];
export function orderOf(layout) {
  const o = (Array.isArray(layout?.order) ? layout.order : []).filter((k) => LABEL[k]);
  return [...new Set([...o, ...BLOCKS.map(([k]) => k)])];
}
