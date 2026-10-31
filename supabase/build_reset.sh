#!/bin/sh
# Fabrique les scripts à coller dans Supabase :
#  - RESET_ALPHA_3_0.sql : efface tout (comptes compris) puis installe le schéma complet (3.0 + mises à jour) ;
#  - MAJ_ALPHA_3_2.sql : met à jour une base 3.0 à 3.1 sans rien effacer (contient la 3.0.1, la 3.0.2 et la 3.1).
cd "$(dirname "$0")"
rm -f MAJ_ALPHA_3_0_1.sql MAJ_ALPHA_3_0_2.sql MAJ_ALPHA_3_1.sql
{ cat reset_entete.sql; echo; cat schema.sql; echo; cat alpha_3_0_1.sql; echo; cat alpha_3_0_2.sql; echo; cat alpha_3_1.sql; echo; cat alpha_3_2.sql; echo; cat alpha_3_2_1.sql; echo; echo "select 'Pocket Club alpha 3.2 installé : base vide, crée ton compte dans l''application.' as resultat;"; } > RESET_ALPHA_3_0.sql
{ echo "-- MAJ_ALPHA_3_2.sql · Pocket Club · à lancer une fois dans Supabase > SQL Editor > Run."; echo "-- Met à jour la base (3.0 à 3.1) sans effacer de données. Contient la 3.0.1, la 3.0.2 et la 3.1. Peut être relancé sans risque."; echo; cat alpha_3_0_1.sql; echo; cat alpha_3_0_2.sql; echo; cat alpha_3_1.sql; echo; cat alpha_3_2.sql; echo; echo "select 'Pocket Club alpha 3.2 : mise à jour faite.' as resultat;"; } > MAJ_ALPHA_3_2.sql
{ echo "-- MAJ_ALPHA_3_2_1.sql · Pocket Club · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.2)."; echo "-- Ajoute les vidéos des exercices, sans effacer de données. Peut être relancé sans risque."; echo; cat alpha_3_2_1.sql; echo; echo "select 'Pocket Club alpha 3.2.1 : vidéos des exercices prêtes.' as resultat;"; } > MAJ_ALPHA_3_2_1.sql
