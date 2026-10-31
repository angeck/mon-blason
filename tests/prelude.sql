-- Reproduit ce que Supabase fournit déjà (schéma auth, rôles, publication temps réel, schéma extensions)
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
-- Stockage (forme minimale de storage.buckets et storage.objects de Supabase)
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
