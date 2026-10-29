#!/bin/sh
# Fabrique les scripts à coller dans Supabase :
#  - RESET_ALPHA_3_0.sql : efface tout (comptes compris) puis installe le schéma complet (3.0 + mises à jour) ;
#  - MAJ_ALPHA_3_0_1.sql : met à jour une base 3.0 sans rien effacer.
cd "$(dirname "$0")"
{ cat reset_entete.sql; echo; cat schema.sql; echo; cat alpha_3_0_1.sql; echo; echo "select 'Pocket Club alpha 3.0.1 installé : base vide, crée ton compte dans l''application.' as resultat;"; } > RESET_ALPHA_3_0.sql
{ echo "-- MAJ_ALPHA_3_0_1.sql · Pocket Club · à lancer une fois dans Supabase > SQL Editor > Run."; echo "-- Met à jour la base 3.0 sans effacer de données. Peut être relancé sans risque."; echo; cat alpha_3_0_1.sql; echo; echo "select 'Pocket Club alpha 3.0.1 : mise à jour faite.' as resultat;"; } > MAJ_ALPHA_3_0_1.sql
