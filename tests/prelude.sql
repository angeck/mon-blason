-- Reproduit ce que Supabase fournit déjà (schéma auth, rôles, publication temps réel, schéma extensions)
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
