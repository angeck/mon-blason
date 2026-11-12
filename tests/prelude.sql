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
-- pg_net (forme minimale) : les appels sont notés dans net.calls au lieu de partir sur le réseau
create schema if not exists net;
create table if not exists net.calls(id bigserial primary key, url text, body jsonb, headers jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
language sql as $$ insert into net.calls(url, body, headers) values (url, body, headers) returning id $$;
-- 4.7.0 (n° 147) : connexions de Supabase, pour vérifier « Ce n'était pas moi »
create table if not exists auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
create table if not exists auth.refresh_tokens(id bigserial primary key, user_id varchar(255), session_id uuid);
-- 5.6.0 (n° 202) : jeton de la session (niveau de vérification « aal ») et facteurs de double vérification
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
