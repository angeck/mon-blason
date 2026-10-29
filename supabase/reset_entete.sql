-- =====================================================================
-- RESET_ALPHA_3_0.sql · Pocket Club (nom provisoire) · alpha 3.0
-- ATTENTION : ce script EFFACE TOUT, de façon définitive : clubs, équipes, fiches,
-- rendez-vous, messages ET TOUS LES COMPTES (chacun devra recréer le sien).
-- À lancer une seule fois dans Supabase > SQL Editor > Run (le relancer efface de nouveau tout).
-- =====================================================================

-- 1. Effacer toutes les tables et fonctions de l'application (rien d'autre)
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and not exists(select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute 'drop function if exists ' || r.f || ' cascade';
  end loop;
end $$;

-- 2. Effacer tous les comptes
drop trigger if exists on_auth_user_created on auth.users;
delete from auth.users;

-- 3. Installer le schéma 3.0
