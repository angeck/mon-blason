// Tests de la fusion des morceaux de dictée (1.2.2 · n° 266). Lancer : node tests/dictee.test.mjs
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../js/dictee.js', import.meta.url), 'utf8');
const code = src.slice(src.indexOf('const flat ='), src.indexOf('const label ='));
const mergeResults = new Function(code.replace('export function', 'function') + '; return mergeResults;')();
let ok = 0, ko = 0;
const eq = (name, got, want) => { if (got === want) ok++; else { ko++; console.log('ÉCHEC', name, '\n  obtenu :', got, '\n  voulu  :', want); } };
// Android (capture de Gaël) : morceaux qui s'allongent
eq('android', mergeResults(['J\'ai', 'J\'ai', 'J\'ai commencé', 'j\'ai commencé la séance']), 'j\'ai commencé la séance');
eq('android répété', mergeResults(['J\'ai commencé', 'J\'ai commencé', 'J\'ai commencé']), 'J\'ai commencé');
// Ordinateur : une phrase après l'autre
eq('ordinateur', mergeResults(['Deux équipes de quatre', ' passes à une main']), 'Deux équipes de quatre passes à une main');
eq('morceau déjà dit', mergeResults(['Tir en course à droite', 'à droite']), 'Tir en course à droite');
eq('vide', mergeResults(['', '  ', null]), '');
eq('ponctuation', mergeResults(['Bonjour', 'Bonjour, à tous']), 'Bonjour, à tous');
eq('deux phrases puis prolongement', mergeResults(['Échauffement', 'Échauffement dix minutes', 'puis matchs']), 'Échauffement dix minutes puis matchs');
console.log(`Dictée : ${ok} réussis, ${ko} échoués`);
if (ko) process.exit(1);
