#!/bin/sh
# Fabrique RESET_ALPHA_3_0.sql : effacement complet + schéma 3.0, en un seul fichier à coller dans Supabase.
cd "$(dirname "$0")"
{ cat reset_entete.sql; echo; cat schema.sql; echo; echo "select 'Pocket Club alpha 3.0 installé : base vide, crée ton compte dans l''application.' as resultat;"; } > RESET_ALPHA_3_0.sql
