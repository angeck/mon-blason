#!/bin/sh
# Lance les tests « vie de club » sur une base PostgreSQL locale de TEST (jamais sur Supabase).
# Prérequis : un serveur PostgreSQL 16 local ; PGHOST, PGPORT, PGUSER pointent dessus.
set -e
cd "$(dirname "$0")"
DB=${DB:-mb_vie_de_club}
psql -q -c "drop database if exists $DB" -c "create database $DB"
psql -q -d $DB -f prelude.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f ../supabase/schema.sql > /dev/null && psql -q -v ON_ERROR_STOP=1 -d $DB -f ../supabase/alpha_3_0_1.sql > /dev/null && psql -q -v ON_ERROR_STOP=1 -d $DB -f ../supabase/alpha_3_0_2.sql > /dev/null && psql -q -v ON_ERROR_STOP=1 -d $DB -f ../supabase/alpha_3_1.sql > /dev/null
python3 vie_de_club.py > /tmp/vie_de_club.sql
psql -q -d $DB -f /tmp/vie_de_club.sql 2>/dev/null | sed -n '/RAPPORT/,$p'
node import.test.mjs
python3 ecrans.py
