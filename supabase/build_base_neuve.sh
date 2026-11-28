#!/bin/sh
# Fabrique CREER_BASE_NEUVE.sql : installe toute la base de mypocketclub (schéma 3.0 + toutes les mises à jour)
# dans un projet Supabase NEUF et vide (vraie application, n° 220). N'efface rien ; refuse de tourner sur une base déjà installée.
# À refaire à chaque nouvelle version : ajouter le fichier alpha_x_y_z.sql à la liste ci-dessous.
cd "$(dirname "$0")"
OUT=CREER_BASE_NEUVE.sql
FILES="schema.sql alpha_3_0_1.sql alpha_3_0_2.sql alpha_3_1.sql alpha_3_2.sql alpha_3_2_1.sql alpha_3_2_4.sql alpha_3_3.sql alpha_3_3_2.sql
alpha_3_4.sql alpha_3_4_1.sql alpha_3_4_2.sql alpha_3_5_0.sql alpha_3_6_0.sql alpha_3_7_0.sql alpha_3_8_0.sql alpha_3_9_0.sql alpha_3_10_0.sql
alpha_4_2_0.sql alpha_4_3_0.sql alpha_4_4_0.sql alpha_4_5_0.sql alpha_4_6_0.sql alpha_4_7_0.sql alpha_4_8_0.sql alpha_4_9_0.sql alpha_4_10_0.sql
alpha_5_1_0.sql alpha_5_2_0.sql alpha_5_2_1.sql alpha_5_3_0.sql alpha_5_4_0.sql alpha_5_5_0.sql alpha_5_6_0.sql alpha_5_7_0.sql alpha_5_9_0.sql
alpha_5_10_0.sql alpha_5_11_0.sql alpha_5_12_0.sql alpha_5_13_0.sql alpha_5_15_0.sql alpha_5_17_0.sql beta_1_1_0.sql beta_1_2_0.sql beta_1_2_2.sql beta_1_3_0.sql beta_1_5_0.sql beta_1_5_1.sql beta_1_6_0.sql beta_1_7_0.sql beta_1_7_1.sql beta_1_7_2.sql beta_1_7_3.sql beta_1_8_0.sql beta_1_8_2.sql beta_1_9_0.sql"
{
  cat <<'EOF'
-- =====================================================================
-- CREER_BASE_NEUVE.sql · mypocketclub · vraie application (n° 220) · à jour de la bêta 1.8.0
-- À lancer UNE fois dans le NOUVEAU projet Supabase (vide) : SQL Editor > coller > Run.
-- N'efface rien. Refuse de tourner si la base contient déjà mypocketclub (protection de la base de test).
-- Aucun profil de test, aucune donnée : la liste « Profil de test » n'existe donc pas sur ce site.
-- =====================================================================
do $$ begin
  if to_regclass('public.clubs') is not null then
    raise exception 'STOP : cette base contient déjà mypocketclub. Ce script est seulement pour un projet neuf.';
  end if;
end $$;

EOF
  for f in $FILES; do echo "-- ===== $f ====="; cat "$f"; echo; done
  echo "select close_visitor_functions();"
} | sed "s#https://rmdszovbpmagtvugfrpr.supabase.co/functions/v1/envoyer-notifications##g" > "$OUT"
echo "$OUT : $(wc -c < "$OUT") octets"
