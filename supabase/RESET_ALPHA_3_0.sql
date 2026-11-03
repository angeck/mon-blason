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

-- Pocket Club (nom provisoire) · alpha 3.0 · schéma complet de la base
-- Ne pas lancer seul sur Supabase : utiliser supabase/RESET_ALPHA_3_0.sql, qui efface tout puis installe ce schéma.
-- Règle : chaque droit est vérifié ici, côté serveur (règles d'accès et fonctions), jamais seulement à l'écran.

create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- =====================================================================
-- 1. Tables
-- =====================================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  full_name text not null default '',              -- calculé : « Prénom Nom »
  nickname text,
  phone text,
  cgu_version text,
  cgu_at timestamptz,
  optin_emails boolean not null default false,
  show_all_club boolean not null default false,    -- n° 22 : interrupteur « Tout le club »
  deleted_at timestamptz,                          -- suppression du compte demandée (effective après 30 jours)
  deleted_snapshot jsonb,                          -- profils et groupes, pour annuler la suppression
  created_at timestamptz not null default now()
);

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  city text not null default '',
  sport text not null default 'Basket-ball' check (sport in ('Basket-ball','Volley-ball')),
  color1 text not null default '#2F5BFF' check (color1 ~ '^#[0-9A-Fa-f]{6}$'),
  color2 text not null default '#FFC93C' check (color2 ~ '^#[0-9A-Fa-f]{6}$'),
  crest_bg text check (crest_bg is null or crest_bg ~ '^#[0-9A-Fa-f]{6}$'),
  logo text check (logo is null or (logo like 'data:image/%' and length(logo) < 400000)),
  custom_header boolean not null default false,    -- en-tête aux couleurs du club (réglage du président)
  join_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  category text not null default '',
  gender text not null default '' check (gender in ('','Féminine','Masculine','Mixte')),
  state text not null default 'Visible' check (state in ('Visible','Fantôme','Archivée')),
  season text not null default '2026-2027',
  slots text not null default '',
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on teams(club_id);

create table players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,          -- équipe principale
  user_id uuid references auth.users(id) on delete set null,      -- joueur de 15 ans et plus avec son propre compte
  first_name text not null,
  last_name text not null default '',
  birth_date date check (birth_date is null or birth_date between '1930-01-01' and '2030-12-31'),
  emergency_name text,
  emergency_phone text,
  consents jsonb not null default '{}'::jsonb,                      -- {"image":{"ok":true,"at":"…","by":"…"}, …}
  parent_email text check (parent_email is null or (length(parent_email) < 200 and parent_email like '%@%')),
  parent_phone text check (parent_phone is null or length(parent_phone) < 30),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on players(club_id);
create index on players(team_id);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('president','bureau','coach','joueur','parent','supporteur')),
  team_id uuid references teams(id) on delete set null,
  player_id uuid references players(id) on delete set null,
  child_first text,                                                -- seulement tant que la demande de parent attend
  child_last text,
  assistant boolean not null default false,
  status text not null default 'pending' check (status in ('pending','active')),
  created_at timestamptz not null default now()
);
create index on memberships(user_id);
create index on memberships(club_id);
create index on memberships(team_id);

create table player_parents (
  player_id uuid not null references players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (player_id, user_id)
);

create table player_teams (                                        -- équipes en plus de l'équipe principale
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  primary key (player_id, team_id)
);

create table player_admin (                                        -- licence et cotisation (président et bureau)
  player_id uuid primary key references players(id) on delete cascade,
  licence_state text not null default 'Préinscrit club' check (licence_state in ('Préinscrit club','Préinscrit fédé','Licencié')),
  licence_number text,
  health_doc boolean not null default false,                       -- certificat fourni oui / non, jamais le contenu
  fee_amount numeric(8,2),
  fee_paid numeric(8,2) not null default 0,
  fee_method text check (fee_method is null or fee_method in ('Chèque','Espèces','Virement','HelloAsso','Carte','Autre')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table player_discount (                                     -- réductions : bureau seulement
  player_id uuid primary key references players(id) on delete cascade,
  base_amount numeric(8,2),
  amount numeric(8,2) not null default 0,
  reason text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table fee_grid (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  season text not null default '2026-2027',
  category text,
  team_id uuid references teams(id) on delete cascade,
  amount numeric(8,2) not null check (amount >= 0),
  fed_part numeric(8,2) check (fed_part is null or fed_part >= 0),
  created_at timestamptz not null default now()
);

create table club_docs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  kind text not null default 'tarifs' check (kind in ('tarifs')),
  file_name text not null,
  data text not null check ((data like 'data:application/pdf;%' or data like 'data:image/%') and length(data) < 5600000),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table event_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  title text not null,
  weekday int not null check (weekday between 0 and 6),
  start_time text not null,
  until date not null,
  skip_holidays boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Destinataires : club, team (une ou plusieurs équipes), board, board_coaches, coaches, people (personnes choisies)
create table events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  audience text not null default 'club' check (audience in ('club','team','board','board_coaches','coaches','people')),
  team_ids uuid[] not null default '{}',
  people uuid[] not null default '{}',
  type text not null default 'Événement' check (type in ('Événement','Entraînement','Match','Plateau','Tournoi','Réunion','AG')),
  title text not null check (length(trim(title)) between 1 and 120),
  starts_at timestamptz not null,
  place text not null default '',
  opponents text not null default '',
  series_id uuid references event_series(id) on delete set null,
  cancelled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (audience <> 'team' or cardinality(team_ids) between 1 and 20),
  check (audience <> 'people' or cardinality(people) between 1 and 200)
);
create index on events(club_id, starts_at);
create index on events using gin(team_ids);
create index on events using gin(people);
create index on events(series_id);

create table event_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,     -- qui a répondu
  player_id uuid references players(id) on delete cascade,               -- au nom de quel joueur (parent)
  answer text not null check (answer in ('oui','non')),
  updated_at timestamptz not null default now()
);
create unique index event_responses_self on event_responses(event_id, user_id) where player_id is null;
create unique index event_responses_child on event_responses(event_id, player_id) where player_id is not null;

create table event_hidden (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table attendance (
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status text not null check (status in ('present','absent','retard')),
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (event_id, player_id)
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  muted boolean not null default false,
  primary key (group_id, user_id)
);

create table messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on messages(group_id, created_at);

create table polls (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  question text not null check (length(trim(question)) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id) on delete set null,          -- corbeille : « supprimé par … »
  deleted_at timestamptz
);

create table poll_votes (
  poll_id uuid not null references polls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer text not null check (answer in ('Présent','Absent','Je ne sais pas')),
  primary key (poll_id, user_id)
);

create table join_attempts (user_id uuid not null, at timestamptz not null default now());
create index on join_attempts(user_id, at);

-- =====================================================================
-- 2. Mise en forme des noms
-- =====================================================================
create function nice_first(t text) returns text language sql immutable as $$
  select initcap(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'));
$$;
create function nice_last(t text) returns text language sql immutable as $$
  select case when trim(coalesce(t, '')) = '' then '' else upper(left(regexp_replace(trim(t), '\s+', ' ', 'g'), 1)) || substr(regexp_replace(trim(t), '\s+', ' ', 'g'), 2) end;
$$;
create function norm_name(t text) returns text language sql immutable as $$
  select regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]', '', 'g');
$$;

create function profiles_names() returns trigger language plpgsql as $$
begin
  new.first_name := nice_first(new.first_name); new.last_name := nice_last(new.last_name);
  new.full_name := trim(new.first_name || ' ' || new.last_name);
  return new;
end $$;
create trigger profiles_names before insert or update on profiles for each row execute function profiles_names();

create function players_names() returns trigger language plpgsql as $$
begin
  new.first_name := nice_first(new.first_name); new.last_name := nice_last(new.last_name);
  return new;
end $$;
create trigger players_names before insert or update on players for each row execute function players_names();

-- Profil créé automatiquement à l'inscription (prénom, nom, version des CGU acceptée, e-mails facultatifs)
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, first_name, last_name, cgu_version, cgu_at, optin_emails) values (new.id,
    coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', ''), ' ', 1)),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'cgu_version',
    case when new.raw_user_meta_data->>'cgu_version' is not null then now() end,
    coalesce((new.raw_user_meta_data->>'optin_emails')::boolean, false));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- =====================================================================
-- 3. Fonctions de droits
-- =====================================================================
create function is_member(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active');
$$;
create function is_board(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role in ('president','bureau'));
$$;
create function is_president(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'president');
$$;
create function is_coach_in(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'coach');
$$;
-- Coach (principal ou assistant) de cette équipe, si l'équipe n'est pas à la corbeille
create function coaches_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and exists(select 1 from memberships m join teams x on x.id = m.team_id
    where m.team_id = t and m.user_id = auth.uid() and m.status = 'active' and m.role = 'coach' and x.deleted_at is null);
$$;
create function coaches_any(ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from unnest(coalesce(ts, '{}')) t where coaches_team(t));
$$;
create function coaches_all(ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(coalesce(ts, '{}')) > 0 and not exists(select 1 from unnest(ts) t where not coaches_team(t));
$$;
create function is_parent_of(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from player_parents where player_id = p and user_id = auth.uid());
$$;
-- Le compte fait-il partie de l'équipe (coach, joueur, parent d'un joueur de l'équipe) ?
create function in_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and exists(select 1 from teams x where x.id = t and x.deleted_at is null) and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where p.deleted_at is null
              and (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
create function can_see_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and x.deleted_at is null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or is_board(x.club_id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))));
$$;
create function can_manage_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and x.deleted_at is null and (is_board(x.club_id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))));
$$;
create function is_group_member(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from group_members where group_id = g and user_id = auth.uid());
$$;
create function shares_club(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid() or exists(
    select 1 from memberships a join memberships b on a.club_id = b.club_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = u);
$$;

-- Validation d'une demande : président tout ; bureau joueurs, parents, coachs, supporteurs ; coach joueurs et parents de son équipe
create function can_validate(mid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from memberships t
    join memberships me on me.club_id = t.club_id and me.user_id = auth.uid() and me.status = 'active'
    where t.id = mid and t.user_id <> auth.uid() and (
      me.role = 'president'
      or (me.role = 'bureau' and t.role in ('joueur','parent','coach','supporteur'))
      or (me.role = 'coach' and t.role in ('joueur','parent') and t.team_id is not null and t.team_id = me.team_id and coaches_team(t.team_id))));
$$;

-- Qui voit un rendez-vous
create function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or e.audience = 'club'
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team(t)))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))));
$$;

-- Qui crée un rendez-vous : bureau et président pour tous les destinataires ; coach seulement pour ses équipes
create function can_create_event(c uuid, aud text, ts uuid[], ppl uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select
    not exists(select 1 from unnest(coalesce(ts, '{}')) t where not exists(select 1 from teams x where x.id = t and x.club_id = c and x.deleted_at is null))
    and not exists(select 1 from unnest(coalesce(ppl, '{}')) u where not exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active'))
    and (is_board(c) or (aud = 'team' and coaches_all(ts)));
$$;

-- Qui modifie ou supprime un rendez-vous : le coach d'une de ses équipes, le président et le bureau
create function can_manage_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and (
    is_board(e.club_id) or (e.audience = 'team' and coaches_any(e.team_ids))));
$$;

-- =====================================================================
-- 4. Garde-fous
-- =====================================================================
create function new_join_code() returns text language plpgsql volatile as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := ''; for i in 1..8 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists(select 1 from clubs where join_code = c);
  end loop;
  return c;
end $$;
alter table clubs alter column join_code set default new_join_code();

create function check_join_rate() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if (select count(*) from join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop d''essais de code. Réessaie dans une heure.';
  end if;
end $$;

-- Club : le code ne change pas ; seul le président active l'en-tête aux couleurs du club
create function clubs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code <> old.join_code then raise exception 'Le code du club ne se modifie pas ainsi'; end if;
  if new.custom_header is distinct from old.custom_header and auth.uid() is not null and not is_president(old.id) then
    raise exception 'Seul le président choisit l''en-tête aux couleurs du club';
  end if;
  return new;
end $$;
create trigger clubs_guard before update on clubs for each row execute function clubs_guard();

-- Fiche joueur : le club ne change jamais ; l'équipe change par l'encadrement ; le compte lié par le bureau ; corbeille par les fonctions
create function players_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.club_id <> old.club_id then raise exception 'Le club d''une fiche ne peut pas changer'; end if;
  if new.team_id is distinct from old.team_id and not can_manage_player(old.id) then raise exception 'Seul l''encadrement change l''équipe'; end if;
  if new.user_id is distinct from old.user_id and not is_board(old.club_id) and current_setting('pc.link', true) is distinct from 'on' then raise exception 'Seul le bureau relie un compte'; end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and current_setting('pc.trash', true) is distinct from 'on' then raise exception 'Passe par la corbeille'; end if;
  return new;
end $$;
create trigger players_guard before update on players for each row execute function players_guard();

create function teams_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.club_id <> old.club_id then raise exception 'Le club d''une équipe ne peut pas changer'; end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and current_setting('pc.trash', true) is distinct from 'on' then raise exception 'Passe par la corbeille'; end if;
  return new;
end $$;
create trigger teams_guard before update on teams for each row execute function teams_guard();

-- n° 23 : un rôle actif identique ou une demande en attente identique bloque ; rien d'autre
create function join_guard() returns trigger language plpgsql as $$
begin
  if new.role <> 'parent' and exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.user_id and m.role = new.role
       and m.team_id is not distinct from new.team_id and m.id <> new.id) then
    raise exception 'Tu as déjà ce rôle ou une demande en attente pour ce rôle';
  end if;
  return new;
end $$;
create trigger join_guard before insert on memberships for each row execute function join_guard();

-- Rendez-vous : date de modification (sert à refaire apparaître un rendez-vous masqué qui change)
create function events_touch() returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at or new.place is distinct from old.place
     or new.cancelled is distinct from old.cancelled or new.title is distinct from old.title then new.updated_at := now(); end if;
  return new;
end $$;
create trigger events_touch before update on events for each row execute function events_touch();

-- =====================================================================
-- 5. Club, adhésions, validations
-- =====================================================================
create function create_club(p_name text, p_city text, p_sport text, p_c1 text, p_c2 text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into clubs(name, city, sport, color1, color2, created_by)
    values (trim(p_name), trim(coalesce(p_city, '')), coalesce(p_sport, 'Basket-ball'), coalesce(p_c1, '#2F5BFF'), coalesce(p_c2, '#FFC93C'), auth.uid()) returning id into cid;
  insert into memberships(club_id, user_id, role, status) values (cid, auth.uid(), 'president', 'active');
  return cid;
end $$;

-- Équipes visibles d'un club à partir de son code (formulaire « Rejoindre »), essais limités
create function teams_for_code(p_code text) returns table(id uuid, name text, club_name text)
language plpgsql security definer set search_path = public as $$
begin
  perform check_join_rate();
  if not exists(select 1 from clubs where join_code = upper(trim(p_code))) then
    insert into join_attempts(user_id) values (auth.uid());
    return;
  end if;
  return query select t.id, t.name, c.name from clubs c
    left join teams t on t.club_id = c.id and t.state = 'Visible' and t.deleted_at is null
    where c.join_code = upper(trim(p_code)) order by t.name;
end $$;

-- Activation (interne) : crée ou relie la fiche joueur ; un second parent est relié à la fiche existante de l'enfant
create function activate_membership(mid uuid, p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; pid uuid; fn text; ln text;
begin
  select * into m from memberships where id = mid;
  if m.id is null then raise exception 'Demande introuvable'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = m.club_id and deleted_at is null) then raise exception 'Équipe inconnue dans ce club'; end if;
  m.team_id := coalesce(p_team, m.team_id);
  pid := p_player;
  if pid is not null and not exists(select 1 from players where id = pid and club_id = m.club_id and deleted_at is null) then raise exception 'Fiche joueur inconnue'; end if;
  if pid is null and m.role in ('parent','joueur') then
    if m.role = 'parent' then
      fn := coalesce(nullif(trim(m.child_first), ''), 'Enfant');
      ln := coalesce(trim(m.child_last), '');
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id is null and p.deleted_at is null
        and norm_name(p.first_name) = norm_name(fn) and norm_name(p.last_name) = norm_name(ln)
        and (m.team_id is null or p.team_id = m.team_id or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = m.team_id))
        order by p.created_at limit 1;
    else
      select first_name, last_name into fn, ln from profiles where id = m.user_id;
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id = m.user_id and p.deleted_at is null limit 1;
    end if;
    if pid is null then
      insert into players(club_id, team_id, user_id, first_name, last_name, created_by)
        values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, coalesce(nullif(fn, ''), 'Joueur'), coalesce(ln, ''), auth.uid()) returning id into pid;
      insert into player_admin(player_id) values (pid) on conflict do nothing;
    end if;
  end if;
  if m.role = 'parent' and pid is not null then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
  if m.role = 'joueur' and pid is not null then
    perform set_config('pc.link', 'on', true);
    update players set user_id = m.user_id where id = pid and user_id is null;
    perform set_config('pc.link', 'off', true);
  end if;
  -- n° 12 : une fois la fiche reliée, le nom de l'enfant n'est plus gardé dans l'adhésion
  update memberships set status = 'active', team_id = m.team_id, player_id = pid,
    child_first = case when pid is not null then null else child_first end,
    child_last = case when pid is not null then null else child_last end
    where id = mid;
end $$;

create function validate_membership(mid uuid, p_team uuid default null, p_player uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_validate(mid) then raise exception 'Tu ne peux pas valider cette demande'; end if;
  perform activate_membership(mid, p_team, p_player);
end $$;

-- Rejoindre ou ajouter un rôle : supporteur tout de suite ; président tout de suite ; bureau qui devient coach tout de suite
create function join_club(p_code text, p_role text, p_team uuid, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; auto boolean;
begin
  perform check_join_rate();
  select id into cid from clubs where join_code = upper(trim(p_code));
  if cid is null then insert into join_attempts(user_id) values (auth.uid()); return null; end if;
  if exists(select 1 from profiles where id = auth.uid() and deleted_at is not null) then raise exception 'Ton compte est en cours de suppression'; end if;
  if p_role not in ('bureau','coach','joueur','parent','supporteur') then raise exception 'Rôle invalide'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = cid and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if p_role = 'parent' and coalesce(trim(p_child_first), '') = '' then raise exception 'Indique le prénom de l''enfant'; end if;
  auto := p_role = 'supporteur' or is_president(cid) or (p_role = 'coach' and is_board(cid));
  insert into memberships(club_id, user_id, role, team_id, child_first, child_last, status)
    values (cid, auth.uid(), p_role, p_team, nullif(nice_first(p_child_first), ''), nullif(nice_last(p_child_last), ''), 'pending') returning id into mid;
  if auto then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

-- Nommer un coach (bureau ou président ; un coach peut nommer son assistant)
create function set_team_coach(p_team uuid, p_user uuid, p_assistant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team and deleted_at is null;
  if c is null or not (is_board(c) or (p_assistant and coaches_team(p_team))) then raise exception 'Droit insuffisant'; end if;
  if not exists(select 1 from memberships where club_id = c and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if exists(select 1 from memberships where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team) then
    update memberships set assistant = p_assistant, status = 'active' where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team;
  else
    insert into memberships(club_id, user_id, role, team_id, status, assistant) values (c, p_user, 'coach', p_team, 'active', p_assistant);
  end if;
end $$;

-- Reconduire une équipe pour la saison suivante (mode fantôme, mêmes coachs), l'ancienne est archivée
create function renew_team(p_team uuid, p_season text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t teams; nid uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not is_board(t.club_id) then raise exception 'Droit insuffisant'; end if;
  insert into teams(club_id, name, category, gender, state, season, slots) values (t.club_id, t.name, t.category, t.gender, 'Fantôme', p_season, t.slots) returning id into nid;
  insert into memberships(club_id, user_id, role, team_id, status, assistant)
    select club_id, user_id, 'coach', nid, 'active', assistant from memberships where team_id = p_team and role = 'coach' and status = 'active';
  update teams set state = 'Archivée' where id = p_team;
  return nid;
end $$;

-- Membres du club selon les droits : encadrement en nom complet, familles en « Prénom N. »
create function club_roster(p_club uuid) returns table(kind text, ref uuid, user_id uuid, first_name text, last_name text, role text, team_id uuid, assistant boolean, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare staff boolean := is_board(p_club);
begin
  if not is_member(p_club) then return; end if;
  return query
    select 'membre', m.id, m.user_id, p.first_name,
      case when staff or coaches_team(m.team_id) or m.user_id = auth.uid() then p.last_name else case when p.last_name = '' then '' else left(p.last_name, 1) || '.' end end,
      m.role, m.team_id, m.assistant, m.created_at
    from memberships m join profiles p on p.id = m.user_id
    where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau','coach')
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', x.team_id, false, x.created_at
    from players x where x.club_id = p_club and x.deleted_at is null
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', pt.team_id, false, x.created_at
    from players x join player_teams pt on pt.player_id = x.id where x.club_id = p_club and x.deleted_at is null;
end $$;

-- Téléphones : entre l'encadrement et les familles concernées seulement
create function phones_for(p_ids uuid[]) returns table(id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select p.id, p.phone from profiles p where p.id = any(p_ids) and p.phone is not null and p.deleted_at is null and (
    p.id = auth.uid()
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where a.user_id = auth.uid() and a.status = 'active' and a.role in ('president','bureau') and b.user_id = p.id)
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where b.user_id = p.id and b.status = 'active' and b.role in ('president','bureau','coach') and a.user_id = auth.uid() and a.status = 'active' and a.role <> 'supporteur')
    or exists(select 1 from players x left join player_parents pp on pp.player_id = x.id
      where x.deleted_at is null and (pp.user_id = p.id or x.user_id = p.id)
        and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id)))));
$$;

create function my_profile() returns profiles language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid();
$$;

create function accept_cgu(p_version text, p_optin boolean) returns void language sql security definer set search_path = public as $$
  update profiles set cgu_version = p_version, cgu_at = now(), optin_emails = coalesce(p_optin, optin_emails) where id = auth.uid();
$$;

-- =====================================================================
-- 6. Fiches joueurs, doublons, import
-- =====================================================================
create function create_player(p_club uuid, p_team uuid, p_first text, p_last text, p_birth date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not (is_board(p_club) or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if coalesce(trim(p_first), '') = '' then raise exception 'Prénom obligatoire'; end if;
  insert into players(club_id, team_id, first_name, last_name, birth_date, created_by) values (p_club, p_team, trim(p_first), trim(coalesce(p_last, '')), p_birth, auth.uid()) returning id into pid;
  insert into player_admin(player_id) values (pid);
  return pid;
end $$;

-- Doublons possibles à l'ajout de joueurs, sans dévoiler plus que nécessaire
create function match_players(p_club uuid, p_rows jsonb) returns table(idx int, player_id uuid, kind text, label text, team_name text, same_team boolean)
language plpgsql stable security definer set search_path = public as $$
declare r record; i int := 0;
begin
  if not (is_board(p_club) or is_coach_in(p_club)) then raise exception 'Droit insuffisant'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, team_id uuid) loop
    return query
      select i, x.id,
        case when norm_name(x.first_name) = norm_name(r.first_name) and norm_name(x.last_name) = norm_name(r.last_name) then 'certain'
             when coalesce(r.licence, '') <> '' and a.licence_number = r.licence then 'certain'
             else 'possible' end,
        x.first_name || ' ' || case when is_board(p_club) or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end
          || case when x.birth_date is not null and (is_board(p_club) or can_see_player(x.id)) then ' · ' || to_char(x.birth_date, 'DD/MM/YYYY') else '' end,
        coalesce(t.name, 'sans équipe'), x.team_id is not distinct from r.team_id
      from players x left join player_admin a on a.player_id = x.id left join teams t on t.id = x.team_id
      where x.club_id = p_club and x.deleted_at is null and (
        (norm_name(x.first_name) = norm_name(r.first_name) and norm_name(x.last_name) = norm_name(r.last_name))
        or (coalesce(r.licence, '') <> '' and a.licence_number = r.licence)
        or (norm_name(x.first_name) = norm_name(r.last_name) and norm_name(x.last_name) = norm_name(r.first_name))
        or (norm_name(x.last_name) = norm_name(r.last_name) and extensions.levenshtein(norm_name(x.first_name), norm_name(r.first_name)) <= 1)
        or (norm_name(x.first_name) = norm_name(r.first_name) and r.birth_date is not null and x.birth_date = r.birth_date));
    i := i + 1;
  end loop;
end $$;

-- Import d'une liste : action par ligne 'create' | 'skip' | 'complete' | 'addteam' ; e-mail et téléphone du parent facultatifs
create function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid;
begin
  if not (is_board(p_club) or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Liste trop longue (300 lignes au plus)'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid, email text, phone text) loop
    if coalesce(r.action, 'create') = 'skip' or coalesce(trim(r.first_name), '') = '' then continue; end if;
    r.email := nullif(lower(trim(coalesce(r.email, ''))), ''); if r.email is not null and r.email not like '%@%' then r.email := null; end if;
    r.phone := nullif(trim(coalesce(r.phone, '')), '');
    if r.action in ('complete', 'addteam') then
      if not exists(select 1 from players where id = r.existing and club_id = p_club and deleted_at is null) then continue; end if;
      update players set birth_date = coalesce(birth_date, r.birth_date), parent_email = coalesce(parent_email, r.email), parent_phone = coalesce(parent_phone, r.phone) where id = r.existing;
      if coalesce(r.licence, '') <> '' then
        insert into player_admin(player_id, licence_number) values (r.existing, r.licence)
          on conflict (player_id) do update set licence_number = coalesce(player_admin.licence_number, excluded.licence_number);
      end if;
      if r.action = 'addteam' and p_team is not null then insert into player_teams values (r.existing, p_team) on conflict do nothing; end if;
      n := n + 1; continue;
    end if;
    insert into players(club_id, team_id, first_name, last_name, birth_date, parent_email, parent_phone, created_by)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, r.email, r.phone, auth.uid()) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- 7. Agenda : création, réponses, suppression (n° 25)
-- =====================================================================
-- Création en une seule opération : un rendez-vous ou une série (dates calculées à l'écran, vacances exclues)
-- p = {club_id, audience, team_ids[], people[], type, title, place, opponents, starts[] , series:{weekday,start_time,until,skip_holidays} | null}
create function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid()
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Réponse « Je viens / Je ne viens pas » : au nom d'un joueur (parent ou joueur adulte) ou pour soi-même
create function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid() and deleted_at is null)) then
      raise exception 'Ce joueur n''est pas relié à ton compte';
    end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    -- n° 14 : le coach d'une équipe concernée ne répond pas pour lui-même (sauf joueur-entraîneur)
    if e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
       and not exists(select 1 from memberships where team_id = any(e.team_ids) and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and deleted_at is null and team_id = any(e.team_ids)) then
      raise exception 'Tu encadres cette équipe : pas de réponse pour toi-même';
    end if;
    if e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi') and not exists(select 1 from unnest(e.team_ids) t where in_team(t)) then
      raise exception 'Ce rendez-vous concerne une équipe dont tu ne fais pas partie';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- n° 25 : suppression d'une séance ou de toutes les séances à venir d'une série, en une seule opération.
-- Les séances passées sont gardées, sauf si aucune n'a d'appel (série créée par erreur : tout part).
-- p_dry = true : ne supprime rien, renvoie seulement le nombre (pour le message de confirmation).
create function delete_events(p_event uuid, p_mode text, p_dry boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare e events; n int; keep_past boolean;
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_event(p_event) then raise exception 'Tu ne peux pas supprimer ce rendez-vous'; end if;
  if p_mode not in ('one','series') then raise exception 'Choix inconnu'; end if;
  if p_mode = 'one' or e.series_id is null then
    if not p_dry then delete from events where id = p_event; end if;
    return 1;
  end if;
  keep_past := exists(select 1 from attendance a join events x on x.id = a.event_id where x.series_id = e.series_id and x.starts_at < now());
  select count(*) into n from events where series_id = e.series_id and (not keep_past or starts_at >= now() or id = p_event);
  if p_dry then return n; end if;
  delete from events where series_id = e.series_id and (not keep_past or starts_at >= now() or id = p_event);
  if not exists(select 1 from events where series_id = e.series_id) then delete from event_series where id = e.series_id; end if;
  return n;
end $$;

-- Sélection multiple dans l'Agenda : supprime tous les rendez-vous choisis, ou aucun si l'un n'est pas permis
create function delete_event_list(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if cardinality(coalesce(p_ids, '{}')) = 0 then return 0; end if;
  if exists(select 1 from unnest(p_ids) i where not can_manage_event(i)) then raise exception 'Un des rendez-vous choisis ne peut pas être supprimé par toi'; end if;
  create temp table if not exists _pc_series(id uuid) on commit drop;
  insert into _pc_series select distinct series_id from events where id = any(p_ids) and series_id is not null;
  delete from events where id = any(p_ids);
  get diagnostics n = row_count;
  delete from event_series s where s.id in (select id from _pc_series) and not exists(select 1 from events x where x.series_id = s.id);
  return n;
end $$;

-- =====================================================================
-- 8. Sondages (n° 17)
-- =====================================================================
create function can_delete_poll(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from polls p join groups g on g.id = p.group_id where p.id = pid and (
    p.created_by = auth.uid() or g.created_by = auth.uid() or is_board(g.club_id)));
$$;
create function delete_poll(pid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_delete_poll(pid) then raise exception 'Tu ne peux pas supprimer ce sondage'; end if;
  update polls set deleted_by = auth.uid(), deleted_at = now() where id = pid and deleted_at is null;
end $$;

-- =====================================================================
-- 9. Corbeille de 30 jours : équipes, fiches joueurs, sondages ; comptes (voir § 10)
-- =====================================================================
create function trash_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is null;
    if c is null or not is_president(c) then raise exception 'Seul le président supprime une équipe'; end if;
    update teams set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is null;
    if c is null or not is_board(c) then raise exception 'Seuls le président et le bureau suppriment une fiche'; end if;
    update players set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'poll' then
    perform delete_poll(p_id);
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

create function restore_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is not null;
    if c is null or not is_board(c) then raise exception 'Restauration réservée au président et au bureau'; end if;
    update teams set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is not null;
    if c is null or not is_board(c) then raise exception 'Restauration réservée au président et au bureau'; end if;
    update players set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'poll' then
    select g.club_id into c from polls p join groups g on g.id = p.group_id where p.id = p_id and p.deleted_at is not null;
    if c is null or not (is_board(c) or can_delete_poll(p_id)) then raise exception 'Restauration impossible'; end if;
    update polls set deleted_at = null, deleted_by = null where id = p_id;
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

-- Contenu de la corbeille d'un club (président et bureau)
create function club_trash(p_club uuid) returns table(kind text, id uuid, label text, deleted_at timestamptz, deleted_by text, purge_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_board(p_club) then return; end if;
  return query
    select 'team', t.id, t.name || coalesce(' · ' || nullif(t.season, ''), ''), t.deleted_at, pr.full_name, t.deleted_at + interval '30 days'
      from teams t left join profiles pr on pr.id = t.deleted_by where t.club_id = p_club and t.deleted_at is not null
  union all
    select 'player', x.id, trim(x.first_name || ' ' || x.last_name), x.deleted_at, pr.full_name, x.deleted_at + interval '30 days'
      from players x left join profiles pr on pr.id = x.deleted_by where x.club_id = p_club and x.deleted_at is not null
  union all
    select 'poll', p.id, p.question || ' · ' || g.name, p.deleted_at, pr.full_name, p.deleted_at + interval '30 days'
      from polls p join groups g on g.id = p.group_id left join profiles pr on pr.id = p.deleted_by where g.club_id = p_club and p.deleted_at is not null
  order by 4 desc;
end $$;

-- Effacement définitif après 30 jours (appelé par l'application ; peut aussi être planifié côté Supabase)
create function purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; u uuid; lim timestamptz := now() - interval '30 days';
begin
  -- équipes : on retire les coachs de l'équipe, les fiches restent au club sans équipe
  delete from memberships where role = 'coach' and team_id in (select id from teams where deleted_at < lim);
  update events set team_ids = (select coalesce(array_agg(t), '{}') from unnest(team_ids) t where t not in (select id from teams where deleted_at < lim))
    where team_ids && array(select id from teams where deleted_at < lim);
  delete from events where audience = 'team' and cardinality(team_ids) = 0;
  delete from teams where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from players where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from poll_votes where poll_id in (select id from polls where deleted_at < lim);
  delete from join_attempts where at < now() - interval '1 day';
  -- comptes dont la suppression a été demandée il y a plus de 30 jours
  for u in select id from profiles where deleted_at < lim loop
    begin
      delete from auth.users where id = u;
    exception when others then
      -- si la base refuse, on efface quand même toutes les données personnelles du profil
      update profiles set first_name = 'Compte', last_name = 'supprimé', nickname = null, phone = null, deleted_snapshot = null where id = u;
      delete from player_parents where user_id = u; delete from group_members where user_id = u; delete from memberships where user_id = u;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- 10. Mes données (RGPD) : export, suppression du compte, annulation
-- =====================================================================
create function export_my_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exporté_le', now(),
    'profil', (select to_jsonb(p) - 'deleted_snapshot' from profiles p where p.id = auth.uid()),
    'profils_dans_les_clubs', coalesce((select jsonb_agg(jsonb_build_object('club', c.name, 'rôle', m.role, 'équipe', t.name, 'état', m.status, 'depuis', m.created_at))
        from memberships m join clubs c on c.id = m.club_id left join teams t on t.id = m.team_id where m.user_id = auth.uid()), '[]'),
    'fiches_joueurs', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('licence_cotisation', (select to_jsonb(a) from player_admin a where a.player_id = x.id),
          'présences', (select coalesce(jsonb_agg(jsonb_build_object('rendez_vous', e.title, 'date', e.starts_at, 'statut', a2.status)), '[]') from attendance a2 join events e on e.id = a2.event_id where a2.player_id = x.id)))
        from players x where x.deleted_at is null and (x.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = x.id and pp.user_id = auth.uid()))), '[]'),
    'réponses', coalesce((select jsonb_agg(jsonb_build_object('rendez_vous', e.title, 'date', e.starts_at, 'réponse', r.answer, 'pour', x.first_name, 'le', r.updated_at))
        from event_responses r join events e on e.id = r.event_id left join players x on x.id = r.player_id where r.user_id = auth.uid()), '[]'),
    'messages_écrits', coalesce((select jsonb_agg(jsonb_build_object('groupe', g.name, 'texte', m.body, 'le', m.created_at))
        from messages m join groups g on g.id = m.group_id where m.user_id = auth.uid()), '[]'),
    'groupes', coalesce((select jsonb_agg(g.name) from group_members gm join groups g on g.id = gm.group_id where gm.user_id = auth.uid()), '[]'),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('question', p.question, 'réponse', v.answer)) from poll_votes v join polls p on p.id = v.poll_id where v.user_id = auth.uid()), '[]'));
$$;

-- Suppression du compte : effective après 30 jours ; les profils et groupes sont retirés tout de suite
create function delete_my_account() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare lone text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select string_agg(c.name, ', ') into lone from clubs c
    where exists(select 1 from memberships m where m.club_id = c.id and m.user_id = auth.uid() and m.role = 'president' and m.status = 'active')
      and not exists(select 1 from memberships m where m.club_id = c.id and m.user_id <> auth.uid() and m.role = 'president' and m.status = 'active');
  if lone is not null then raise exception 'Tu es le seul président de % : nomme un autre président ou supprime le club avant', lone; end if;
  update profiles set deleted_at = now(), deleted_snapshot = jsonb_build_object(
      'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from memberships m where m.user_id = auth.uid()),
      'parents', (select coalesce(jsonb_agg(to_jsonb(pp)), '[]') from player_parents pp where pp.user_id = auth.uid()),
      'groups', (select coalesce(jsonb_agg(to_jsonb(g)), '[]') from group_members g where g.user_id = auth.uid()))
    where id = auth.uid() and deleted_at is null;
  delete from group_members where user_id = auth.uid();
  delete from player_parents where user_id = auth.uid();
  delete from memberships where user_id = auth.uid();
  return now() + interval '30 days';
end $$;

create function cancel_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb; r jsonb;
begin
  select deleted_snapshot into s from profiles where id = auth.uid() and deleted_at is not null;
  if s is null then raise exception 'Aucune suppression en cours'; end if;
  for r in select * from jsonb_array_elements(s->'memberships') loop
    begin
      insert into memberships(id, club_id, user_id, role, team_id, player_id, child_first, child_last, assistant, status, created_at)
        select (r->>'id')::uuid, (r->>'club_id')::uuid, auth.uid(), r->>'role',
          (select id from teams where id = (r->>'team_id')::uuid), (select id from players where id = (r->>'player_id')::uuid),
          r->>'child_first', r->>'child_last', coalesce((r->>'assistant')::boolean, false), r->>'status', (r->>'created_at')::timestamptz
        where exists(select 1 from clubs where id = (r->>'club_id')::uuid);
    exception when others then null; end;
  end loop;
  insert into player_parents(player_id, user_id) select (x->>'player_id')::uuid, auth.uid() from jsonb_array_elements(s->'parents') x
    where exists(select 1 from players where id = (x->>'player_id')::uuid) on conflict do nothing;
  insert into group_members(group_id, user_id, muted) select (x->>'group_id')::uuid, auth.uid(), coalesce((x->>'muted')::boolean, false) from jsonb_array_elements(s->'groups') x
    where exists(select 1 from groups where id = (x->>'group_id')::uuid) on conflict do nothing;
  update profiles set deleted_at = null, deleted_snapshot = null where id = auth.uid();
end $$;

-- Fonctions internes : jamais appelées directement depuis l'application
revoke execute on function activate_membership(uuid, uuid, uuid) from public, anon, authenticated;

-- =====================================================================
-- 11. Règles d'accès (RLS)
-- =====================================================================
alter table profiles enable row level security;
alter table clubs enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table memberships enable row level security;
alter table player_parents enable row level security;
alter table player_teams enable row level security;
alter table player_admin enable row level security;
alter table player_discount enable row level security;
alter table fee_grid enable row level security;
alter table club_docs enable row level security;
alter table event_series enable row level security;
alter table events enable row level security;
alter table event_responses enable row level security;
alter table event_hidden enable row level security;
alter table attendance enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table messages enable row level security;
alter table polls enable row level security;
alter table poll_votes enable row level security;
alter table join_attempts enable row level security;   -- aucune règle : lecture et écriture seulement par les fonctions

-- Profils : lisibles par les membres des mêmes clubs, sans le téléphone (voir phones_for)
create policy "profil lisible par les membres des mêmes clubs" on profiles for select using (shares_club(id));
create policy "chacun modifie son profil" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "club lisible par ses membres (même en attente)" on clubs for select using (
  exists(select 1 from memberships where club_id = clubs.id and user_id = auth.uid()));
create policy "club modifié par le président et le bureau" on clubs for update using (is_board(id)) with check (is_board(id));
create policy "club supprimé par le président" on clubs for delete using (is_president(id));

create policy "équipes lisibles par les membres" on teams for select using (is_member(club_id) and deleted_at is null);
create policy "équipes créées par le bureau" on teams for insert with check (is_board(club_id) and deleted_at is null);
create policy "équipes modifiées par le bureau ou le coach" on teams for update using (deleted_at is null and (is_board(club_id) or coaches_team(id))) with check (is_board(club_id) or coaches_team(id));

create policy "fiche lisible" on players for select using (can_see_player(id));
create policy "fiche modifiable" on players for update using (can_see_player(id)) with check (can_see_player(id));

create policy "adhésions lisibles selon les droits" on memberships for select using (
  user_id = auth.uid() or is_board(club_id) or coaches_team(team_id));
create policy "adhésion quittée par soi ou retirée selon les droits" on memberships for delete using (user_id = auth.uid() or can_validate(id));
create policy "coach assistant modifié par le bureau" on memberships for update using (is_board(club_id)) with check (is_board(club_id));

create policy "parents lisibles" on player_parents for select using (can_see_player(player_id));
create policy "parents retirés par l'encadrement" on player_parents for delete using (can_manage_player(player_id));

create policy "équipes secondaires lisibles" on player_teams for select using (can_see_player(player_id));
create policy "équipes secondaires gérées" on player_teams for all using (can_manage_player(player_id))
  with check (exists(select 1 from players x join teams t on t.id = team_id where x.id = player_id and t.club_id = x.club_id and t.deleted_at is null
    and (is_board(x.club_id) or (can_manage_player(player_id) and coaches_team(team_id)))));

create policy "dossier lisible" on player_admin for select using (can_see_player(player_id));
create policy "dossier créé par le bureau" on player_admin for insert with check (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));
create policy "dossier saisi par le bureau" on player_admin for update using (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));

create policy "réductions : bureau seulement" on player_discount for all
  using (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)))
  with check (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));

create policy "tarifs lisibles par les membres" on fee_grid for select using (is_member(club_id));
create policy "tarifs gérés par le bureau" on fee_grid for all using (is_board(club_id)) with check (is_board(club_id));

create policy "documents lisibles par les membres" on club_docs for select using (is_member(club_id));
create policy "documents gérés par le bureau" on club_docs for all using (is_board(club_id)) with check (is_board(club_id) and uploaded_by = auth.uid());

create policy "séries lisibles par les membres" on event_series for select using (is_member(club_id));

create policy "rendez-vous lisibles par les destinataires" on events for select using (sees_event(id));
create policy "rendez-vous créés selon les droits" on events for insert with check (
  created_by = auth.uid() and can_create_event(club_id, audience, team_ids, people));
create policy "rendez-vous modifiés selon les droits" on events for update using (can_manage_event(id))
  with check (can_create_event(club_id, audience, team_ids, people));
create policy "rendez-vous supprimés selon les droits" on events for delete using (can_manage_event(id));

-- Réponses : lecture par les destinataires ; écriture seulement par respond_event
create policy "réponses lisibles par les destinataires" on event_responses for select using (sees_event(event_id));

create policy "masquage personnel" on event_hidden for all using (user_id = auth.uid()) with check (user_id = auth.uid() and sees_event(event_id));

create policy "appel lisible" on attendance for select using (can_see_player(player_id));
create policy "appel fait par l'encadrement" on attendance for all using (can_manage_player(player_id))
  with check (can_manage_player(player_id) and sees_event(event_id));

create policy "groupes visibles par leurs membres" on groups for select using (is_group_member(id) or created_by = auth.uid());
create policy "tout membre actif crée un groupe" on groups for insert with check (is_member(club_id) and created_by = auth.uid());
create policy "groupe modifié par son créateur" on groups for update using (created_by = auth.uid());
create policy "groupe supprimé par son créateur ou le bureau" on groups for delete using (created_by = auth.uid() or is_board(club_id));

create policy "membres du groupe visibles par le groupe" on group_members for select using (is_group_member(group_id));
create policy "le créateur invite des membres du club" on group_members for insert with check (
  exists(select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  and exists(select 1 from memberships m join groups g on g.club_id = m.club_id where g.id = group_id and m.user_id = group_members.user_id and m.status = 'active'));
create policy "chacun coupe ses notifications" on group_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "quitter ou retirer" on group_members for delete using (
  user_id = auth.uid() or exists(select 1 from groups g where g.id = group_id and g.created_by = auth.uid()));

create policy "messages lus par le groupe" on messages for select using (is_group_member(group_id));
create policy "messages écrits par le groupe" on messages for insert with check (is_group_member(group_id) and user_id = auth.uid());
create policy "message supprimé par son auteur" on messages for delete using (user_id = auth.uid());

create policy "sondages lus par le groupe" on polls for select using (is_group_member(group_id));
create policy "sondages créés par le groupe" on polls for insert with check (is_group_member(group_id) and created_by = auth.uid() and deleted_at is null);

create policy "votes lus par le groupe" on poll_votes for select using (
  exists(select 1 from polls p where p.id = poll_id and p.deleted_at is null and is_group_member(p.group_id)));
create policy "chacun vote pour soi" on poll_votes for insert with check (
  user_id = auth.uid() and exists(select 1 from polls p where p.id = poll_id and p.deleted_at is null and is_group_member(p.group_id)));
create policy "chacun change son vote" on poll_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "chacun retire son vote" on poll_votes for delete using (user_id = auth.uid());

-- Colonnes des profils : le téléphone et la suppression en cours ne se lisent pas directement
revoke select, insert, update, delete on profiles from anon, authenticated;
grant select (id, first_name, last_name, full_name, nickname, show_all_club, created_at) on profiles to authenticated;
grant update (first_name, last_name, nickname, phone, optin_emails, show_all_club) on profiles to authenticated;

-- =====================================================================
-- 12. Temps réel
-- =====================================================================
do $$ begin alter publication supabase_realtime add table messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table poll_votes; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table event_responses; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table memberships; exception when duplicate_object then null; end $$;

-- Pocket Club · alpha 3.0.1 · mise à jour de la base (relançable sans risque, ne supprime aucune donnée)
-- N° 29 équipes fantômes · 32 droits en pyramide et journal · 33 versements · 36 messages non lus · 37 contour du blason
-- 38 import de la grille · 39 tarifs réservés au bureau · 40 membres visibles selon le rôle · 41 suivre une équipe · 42 contacts du club
set client_min_messages = warning;

-- =====================================================================
-- Colonnes et tables nouvelles
-- =====================================================================
alter table teams alter column state set default 'Fantôme';                        -- n° 29
alter table group_members add column if not exists last_read_at timestamptz not null default now();   -- n° 36
alter table clubs add column if not exists crest_outline text not null default 'auto';                -- n° 37
do $$ begin alter table clubs add constraint clubs_crest_outline check (crest_outline in ('auto','noir','blanc','aucun')); exception when duplicate_object then null; end $$;

create table if not exists team_follows (                                          -- n° 41
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);
create table if not exists club_contacts (                                         -- n° 42
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  for_licence boolean not null default false,
  for_matches boolean not null default false,
  show_phone boolean not null default false,
  show_email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create table if not exists player_payments (                                       -- n° 33
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(8,2) not null check (amount > 0 and amount < 10000),
  method text check (method is null or length(method) < 40),
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists player_payments_player on player_payments(player_id);
create table if not exists action_log (                                            -- n° 32 : journal des actions sensibles
  id bigint generated always as identity primary key,
  club_id uuid references clubs(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  target_user uuid references auth.users(id) on delete set null,
  target_player uuid references players(id) on delete set null,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists action_log_club on action_log(club_id, at);

-- =====================================================================
-- N° 32 : rang dans le club (président 3, bureau 2, coach 1, autres 0)
-- =====================================================================
create or replace function member_rank(c uuid, u uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(case role when 'president' then 3 when 'bureau' then 2 when 'coach' then 1 else 0 end), 0)
  from memberships where club_id = c and user_id = u and status = 'active';
$$;
create or replace function my_rank(c uuid) returns int language sql stable security definer set search_path = public as $$
  select member_rank(c, auth.uid());
$$;
-- La personne liée à la fiche est-elle sous moi dans la pyramide ? (fiche d'enfant sans compte : toujours oui)
create or replace function outranks_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and (x.user_id is null or x.user_id = auth.uid() or member_rank(x.club_id, x.user_id) < my_rank(x.club_id)));
$$;
create or replace function can_admin_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and x.deleted_at is null and is_board(x.club_id)) and outranks_player(p);
$$;
create or replace function log_action(c uuid, tu uuid, tp uuid, act text, det jsonb) returns void language sql security definer set search_path = public as $$
  insert into action_log(club_id, actor, target_user, target_player, action, detail) values (c, auth.uid(), tu, tp, act, det);
$$;
revoke execute on function log_action(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- =====================================================================
-- N° 29 et 41 : qui fait partie d'une équipe, qui voit un rendez-vous
-- =====================================================================
-- Une équipe fantôme n'existe pas encore pour les familles : seuls ses coachs et le bureau la voient
create or replace function team_visible(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from teams x where x.id = t and x.deleted_at is null and (x.state <> 'Fantôme' or is_board(x.club_id) or coaches_team(x.id)));
$$;
create or replace function in_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and team_visible(t) and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where p.deleted_at is null
              and (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
create or replace function follows_any(ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from team_follows f join teams x on x.id = f.team_id where f.user_id = auth.uid() and f.team_id = any(ts) and x.state <> 'Fantôme' and x.deleted_at is null);
$$;
-- N° 35 : le créateur voit toujours son rendez-vous ; n° 41 : les matchs des équipes suivies
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or e.audience = 'club'
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team(t)))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))));
$$;

drop policy if exists "équipes lisibles par les membres" on teams;
create policy "équipes lisibles par les membres" on teams for select using (is_member(club_id) and deleted_at is null and (state <> 'Fantôme' or is_board(club_id) or coaches_team(id)));

alter table team_follows enable row level security;
drop policy if exists "chacun voit ses équipes suivies" on team_follows;
drop policy if exists "chacun suit une équipe visible" on team_follows;
drop policy if exists "chacun arrête de suivre" on team_follows;
create policy "chacun voit ses équipes suivies" on team_follows for select using (user_id = auth.uid());
create policy "chacun suit une équipe visible" on team_follows for insert with check (user_id = auth.uid() and exists(select 1 from teams x where x.id = team_id and x.state <> 'Fantôme' and x.deleted_at is null and is_member(x.club_id)));
create policy "chacun arrête de suivre" on team_follows for delete using (user_id = auth.uid());

-- Liste des équipes pour tous les membres : coach principal en « Prénom N. », nombres seulement pour qui y a droit (n° 31, 41)
create or replace function club_teams(p_club uuid) returns table(id uuid, name text, category text, gender text, state text, season text, slots text, coach text, coaches int, players int, followed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_club) then return; end if;
  return query
    select t.id, t.name, t.category, t.gender, t.state, t.season, t.slots,
      (select p.first_name || case when p.last_name = '' then '' else ' ' || left(p.last_name, 1) || '.' end from memberships m join profiles p on p.id = m.user_id
         where m.team_id = t.id and m.role = 'coach' and m.status = 'active' order by m.assistant, m.created_at limit 1),
      case when is_board(p_club) or coaches_team(t.id) or in_team(t.id) then (select count(distinct m.user_id)::int from memberships m where m.team_id = t.id and m.role = 'coach' and m.status = 'active') end,
      case when is_board(p_club) or coaches_team(t.id) or in_team(t.id) then (select count(*)::int from players x where x.deleted_at is null and (x.team_id = t.id or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = t.id))) end,
      exists(select 1 from team_follows f where f.team_id = t.id and f.user_id = auth.uid())
    from teams t where t.club_id = p_club and t.deleted_at is null and (t.state <> 'Fantôme' or is_board(p_club) or coaches_team(t.id))
    order by t.name;
end $$;

-- =====================================================================
-- N° 40 : qui voit quels membres
-- =====================================================================
-- Profils : soi ; le bureau de ses clubs ; les membres d'une même équipe ; les membres d'un même groupe
create or replace function can_see_profile(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid()
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
              where a.user_id = auth.uid() and a.status = 'active' and a.role in ('president','bureau') and b.user_id = u)
    or exists(select 1 from memberships b where b.user_id = u and b.team_id is not null and (coaches_team(b.team_id) or (b.status = 'active' and in_team(b.team_id))))
    or exists(select 1 from players x join player_parents pp on pp.player_id = x.id where pp.user_id = u and x.deleted_at is null
              and (coaches_team(x.team_id) or in_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and (coaches_team(pt.team_id) or in_team(pt.team_id)))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and (coaches_team(x.team_id) or in_team(x.team_id)))
    or exists(select 1 from group_members a join group_members b on a.group_id = b.group_id where a.user_id = auth.uid() and b.user_id = u);
$$;
drop policy if exists "profil lisible par les membres des mêmes clubs" on profiles;
drop policy if exists "profil lisible selon les droits" on profiles;
create policy "profil lisible selon les droits" on profiles for select using (can_see_profile(id));

-- Liste des membres : bureau tout le club ; coach ses équipes ; joueur et parent leur équipe en « Prénom N. » ; supporteur rien
create or replace function club_roster(p_club uuid) returns table(kind text, ref uuid, user_id uuid, first_name text, last_name text, role text, team_id uuid, assistant boolean, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare staff boolean := is_board(p_club);
begin
  if not is_member(p_club) then return; end if;
  return query
    select 'membre', m.id, m.user_id, p.first_name,
      case when staff or coaches_team(m.team_id) or m.user_id = auth.uid() then p.last_name else case when p.last_name = '' then '' else left(p.last_name, 1) || '.' end end,
      m.role, m.team_id, m.assistant, m.created_at
    from memberships m join profiles p on p.id = m.user_id
    where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau','coach')
      and (staff or m.user_id = auth.uid() or (m.team_id is not null and (coaches_team(m.team_id) or in_team(m.team_id))))
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', x.team_id, false, x.created_at
    from players x where x.club_id = p_club and x.deleted_at is null and (staff or can_see_player(x.id) or in_team(x.team_id))
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', pt.team_id, false, x.created_at
    from players x join player_teams pt on pt.player_id = x.id where x.club_id = p_club and x.deleted_at is null and (staff or can_see_player(x.id) or in_team(pt.team_id));
end $$;

-- =====================================================================
-- N° 39 : tarifs et documents de tarifs réservés au président et au bureau
-- =====================================================================
drop policy if exists "tarifs lisibles par les membres" on fee_grid;
drop policy if exists "tarifs lisibles par le bureau" on fee_grid;
create policy "tarifs lisibles par le bureau" on fee_grid for select using (is_board(club_id));
drop policy if exists "documents lisibles par les membres" on club_docs;
drop policy if exists "documents lisibles par le bureau" on club_docs;
create policy "documents lisibles par le bureau" on club_docs for select using (is_board(club_id));

-- =====================================================================
-- N° 32 : modification des fiches en pyramide, journal
-- =====================================================================
drop policy if exists "fiche modifiable" on players;
create policy "fiche modifiable" on players for update using (
  deleted_at is null and (user_id = auth.uid() or is_parent_of(id) or (can_manage_player(id) and outranks_player(id))))
  with check (user_id = auth.uid() or is_parent_of(id) or can_manage_player(id));
drop policy if exists "dossier créé par le bureau" on player_admin;
drop policy if exists "dossier saisi par le bureau" on player_admin;
create policy "dossier créé par le bureau" on player_admin for insert with check (can_admin_player(player_id));
create policy "dossier saisi par le bureau" on player_admin for update using (can_admin_player(player_id)) with check (can_admin_player(player_id));
drop policy if exists "réductions : bureau seulement" on player_discount;
create policy "réductions : bureau seulement" on player_discount for all using (can_admin_player(player_id)) with check (can_admin_player(player_id));

-- Fiche d'un membre (bureau, coach, supporteur…) modifiée par quelqu'un au-dessus de lui dans la pyramide
create or replace function update_member_profile(p_club uuid, p_user uuid, p_first text, p_last text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare old profiles;
begin
  if p_user = auth.uid() then raise exception 'Modifie ta propre fiche depuis « Mon compte »'; end if;
  if my_rank(p_club) < 2 or member_rank(p_club, p_user) >= my_rank(p_club) or not exists(select 1 from memberships where club_id = p_club and user_id = p_user) then
    raise exception 'Tu ne peux pas modifier la fiche de cette personne';
  end if;
  if coalesce(trim(p_first), '') = '' then raise exception 'Prénom obligatoire'; end if;
  select * into old from profiles where id = p_user;
  update profiles set first_name = p_first, last_name = coalesce(p_last, ''), phone = nullif(trim(coalesce(p_phone, '')), '') where id = p_user;
  perform log_action(p_club, p_user, null, 'fiche du membre modifiée', jsonb_build_object('avant', jsonb_build_object('prénom', old.first_name, 'nom', old.last_name, 'téléphone', old.phone is not null), 'après', jsonb_build_object('prénom', p_first, 'nom', p_last, 'téléphone', nullif(trim(coalesce(p_phone, '')), '') is not null)));
end $$;

-- Journal : toute modification d'une fiche par quelqu'un d'autre que la personne elle-même
create or replace function log_player_change() returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.player_id, old.player_id); x players;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- dossier : seules les saisies du bureau comptent (pas les recalculs automatiques du montant dû)
  if tg_table_name = 'player_admin' then
    if tg_op = 'INSERT' then return new; end if;
    if to_jsonb(new) - 'fee_amount' - 'fee_paid' - 'updated_at' - 'updated_by' = to_jsonb(old) - 'fee_amount' - 'fee_paid' - 'updated_at' - 'updated_by' then return new; end if;
  end if;
  select * into x from players where id = pid;
  if x.id is not null and x.user_id is distinct from auth.uid() then
    perform log_action(x.club_id, x.user_id, pid, tg_table_name || ' ' || lower(tg_op), case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  end if;
  return coalesce(new, old);
end $$;
create or replace function log_player_fiche() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() and current_setting('pc.trash', true) is distinct from 'on' and current_setting('pc.link', true) is distinct from 'on'
     and (new.first_name, new.last_name, new.birth_date, new.team_id, new.emergency_name, new.emergency_phone, new.consents) is distinct from (old.first_name, old.last_name, old.birth_date, old.team_id, old.emergency_name, old.emergency_phone, old.consents) then
    perform log_action(new.club_id, new.user_id, new.id, 'fiche joueur modifiée', jsonb_build_object('équipe', new.team_id <> old.team_id, 'naissance', new.birth_date is distinct from old.birth_date, 'autorisations', new.consents <> old.consents));
  end if;
  return new;
end $$;
drop trigger if exists log_player_fiche on players;
create trigger log_player_fiche after update on players for each row execute function log_player_fiche();
drop trigger if exists log_player_admin on player_admin;
create trigger log_player_admin after insert or update on player_admin for each row execute function log_player_change();
drop trigger if exists log_player_discount on player_discount;
create trigger log_player_discount after insert or update or delete on player_discount for each row execute function log_player_change();
alter table action_log enable row level security;
drop policy if exists "journal lu par le président" on action_log;
create policy "journal lu par le président" on action_log for select using (is_president(club_id));

-- =====================================================================
-- N° 33 : montant dû calculé, versements, pastille « Payé »
-- =====================================================================
-- Tarif de base : tarif de l'équipe principale s'il existe, sinon celui de sa catégorie (même saison)
create or replace function grid_for(p uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select g.amount from fee_grid g join players x on x.id = p where g.club_id = x.club_id and g.team_id = x.team_id order by g.created_at desc limit 1),
    (select g.amount from fee_grid g join players x on x.id = p join teams t on t.id = x.team_id
       where g.club_id = x.club_id and g.team_id is null and g.season = t.season and g.category = coalesce(nullif(t.category, ''), t.name) order by g.created_at desc limit 1));
$$;
create or replace function due_for(p uuid) returns numeric language sql stable security definer set search_path = public as $$
  select case when grid_for(p) is null then null else greatest(0, grid_for(p) - coalesce((select amount from player_discount where player_id = p), 0)) end;
$$;
-- Le montant dû n'est jamais saisi : il est recalculé, sauf pour une cotisation déjà payée (elle ne change plus)
create or replace function player_admin_compute() returns trigger language plpgsql security definer set search_path = public as $$
declare was_paid boolean := tg_op = 'UPDATE' and old.fee_amount is not null and old.fee_paid >= old.fee_amount;
begin
  new.fee_paid := coalesce((select sum(amount) from player_payments where player_id = new.player_id), 0);
  new.fee_amount := case when was_paid and new.fee_paid >= old.fee_amount then old.fee_amount else due_for(new.player_id) end;
  return new;
end $$;
drop trigger if exists player_admin_compute on player_admin;
create trigger player_admin_compute before insert or update on player_admin for each row execute function player_admin_compute();
-- Recalcul pour tout le club (après un changement de la grille), ou pour un joueur
create or replace function touch_fees(c uuid, p uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into player_admin(player_id) select x.id from players x where (p is null and x.club_id = c or x.id = p) and x.deleted_at is null on conflict do nothing;
  update player_admin a set updated_at = a.updated_at from players x where x.id = a.player_id and (p is null and x.club_id = c or x.id = p);
end $$;
revoke execute on function touch_fees(uuid, uuid) from public, anon, authenticated;
create or replace function fee_grid_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin perform touch_fees(coalesce(new.club_id, old.club_id), null); return null; end $$;
drop trigger if exists fee_grid_changed on fee_grid;
create trigger fee_grid_changed after insert or update or delete on fee_grid for each row execute function fee_grid_changed();
create or replace function fee_player_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'players' then
    if new.team_id is distinct from old.team_id then perform touch_fees(null, new.id); end if;
  else perform touch_fees(null, coalesce(new.player_id, old.player_id)); end if;
  return null;
end $$;
drop trigger if exists fee_player_team on players;
create trigger fee_player_team after update on players for each row execute function fee_player_changed();
drop trigger if exists fee_discount_changed on player_discount;
create trigger fee_discount_changed after insert or update or delete on player_discount for each row execute function fee_player_changed();
drop trigger if exists fee_payment_changed on player_payments;
create trigger fee_payment_changed after insert or delete on player_payments for each row execute function fee_player_changed();

alter table player_payments enable row level security;
drop policy if exists "versements lisibles" on player_payments;
drop policy if exists "versements saisis par le bureau" on player_payments;
drop policy if exists "versements retirés par le bureau" on player_payments;
create policy "versements lisibles" on player_payments for select using (can_see_player(player_id));
create policy "versements saisis par le bureau" on player_payments for insert with check (can_admin_player(player_id) and created_by = auth.uid());
create policy "versements retirés par le bureau" on player_payments for delete using (can_admin_player(player_id));
create or replace function log_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare x players;
begin
  select * into x from players where id = coalesce(new.player_id, old.player_id);
  if auth.uid() is not null then perform log_action(x.club_id, x.user_id, x.id, case when tg_op = 'INSERT' then 'versement ajouté' else 'versement retiré' end, jsonb_build_object('montant', coalesce(new.amount, old.amount))); end if;
  return null;
end $$;
drop trigger if exists log_payment on player_payments;
create trigger log_payment after insert or delete on player_payments for each row execute function log_payment();

-- Pastille « Payé » à la main : le reste est enregistré comme un dernier versement ; annulation : versements retirés
create or replace function mark_paid(p_player uuid, p_paid boolean) returns void language plpgsql security definer set search_path = public as $$
declare a player_admin;
begin
  if not can_admin_player(p_player) then raise exception 'Réservé au président et au bureau'; end if;
  perform touch_fees(null, p_player);
  select * into a from player_admin where player_id = p_player;
  if p_paid then
    if a.fee_amount is null then raise exception 'Montant dû inconnu : ajoute d''abord le tarif de sa catégorie dans la grille'; end if;
    if a.fee_amount > a.fee_paid then insert into player_payments(player_id, amount, method, created_by) values (p_player, a.fee_amount - a.fee_paid, 'Solde validé à la main', auth.uid()); end if;
  else
    delete from player_payments where player_id = p_player;
  end if;
end $$;

-- =====================================================================
-- N° 38 : import de la grille avec remplacement des prix existants
-- p_rows = [{team_id | category, amount, fed}] ; renvoie {updated, added, deleted}
-- =====================================================================
create or replace function import_fee_grid(p_club uuid, p_season text, p_rows jsonb, p_delete_absent boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; up int := 0; ad int := 0; dl int := 0; keep uuid[] := '{}'; gid uuid;
begin
  if not is_board(p_club) then raise exception 'Réservé au président et au bureau'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(team_id uuid, category text, amount numeric, fed numeric) loop
    if r.amount is null or r.amount < 0 then continue; end if;
    if r.team_id is not null and not exists(select 1 from teams where id = r.team_id and club_id = p_club) then continue; end if;
    select id into gid from fee_grid where club_id = p_club and season = p_season
      and ((r.team_id is not null and team_id = r.team_id) or (r.team_id is null and team_id is null and lower(category) = lower(r.category))) limit 1;
    if gid is null then
      insert into fee_grid(club_id, season, team_id, category, amount, fed_part) values (p_club, p_season, r.team_id, case when r.team_id is null then r.category end, r.amount, r.fed) returning id into gid; ad := ad + 1;
    else
      update fee_grid set amount = r.amount, fed_part = r.fed where id = gid and (amount <> r.amount or fed_part is distinct from r.fed);
      if found then up := up + 1; end if;
    end if;
    keep := keep || gid; gid := null;
  end loop;
  if p_delete_absent then delete from fee_grid where club_id = p_club and season = p_season and not (id = any(keep)); get diagnostics dl = row_count; end if;
  return jsonb_build_object('updated', up, 'added', ad, 'deleted', dl);
end $$;

-- =====================================================================
-- N° 42 : contacts du club
-- =====================================================================
alter table club_contacts enable row level security;
drop policy if exists "chacun voit sa fiche contact" on club_contacts;
drop policy if exists "le bureau gère sa fiche contact" on club_contacts;
create policy "chacun voit sa fiche contact" on club_contacts for select using (user_id = auth.uid());
create policy "le bureau gère sa fiche contact" on club_contacts for all using (user_id = auth.uid()) with check (user_id = auth.uid() and is_board(club_id));
-- Encadré « Contacter le club » : comptes connectés et membres ; coordonnées seulement si la personne l'a choisi
create or replace function club_contacts_list(p_club uuid) returns table(kind text, user_id uuid, name text, fonction text, for_licence boolean, for_matches boolean, phone text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists(select 1 from memberships where club_id = p_club and user_id = auth.uid()) then return; end if;
  return query
    select 'contact', c.user_id, trim(p.first_name || ' ' || p.last_name), case when member_rank(p_club, c.user_id) = 3 then 'Président' else 'Membre du bureau' end,
      c.for_licence, c.for_matches, case when c.show_phone then p.phone end, case when c.show_email then u.email::text end
    from club_contacts c join profiles p on p.id = c.user_id join auth.users u on u.id = c.user_id
    where c.club_id = p_club and (c.for_licence or c.for_matches) and member_rank(p_club, c.user_id) >= 2 and p.deleted_at is null
  union all
    select 'president', m.user_id, trim(p.first_name || ' ' || left(p.last_name, 1) || case when p.last_name = '' then '' else '.' end), 'Président', false, false, null::text, null::text
    from memberships m join profiles p on p.id = m.user_id
    where m.club_id = p_club and m.role = 'president' and m.status = 'active';
end $$;
-- Le message au président passe par un groupe d'échange à deux (créé par le demandeur)
create or replace function message_president(p_club uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare pres uuid; gid uuid; me_name text;
begin
  if not is_member(p_club) then raise exception 'Rejoins le club d''abord'; end if;
  select user_id into pres from memberships where club_id = p_club and role = 'president' and status = 'active' order by created_at limit 1;
  if pres is null then raise exception 'Ce club n''a pas encore de président'; end if;
  if pres = auth.uid() then raise exception 'Tu es le président'; end if;
  select g.id into gid from groups g where g.club_id = p_club and g.created_by = auth.uid() and g.name like 'Message au président%'
    and exists(select 1 from group_members x where x.group_id = g.id and x.user_id = pres) limit 1;
  if gid is not null then return gid; end if;
  select full_name into me_name from profiles where id = auth.uid();
  insert into groups(club_id, name, created_by) values (p_club, 'Message au président · ' || coalesce(me_name, 'membre'), auth.uid()) returning id into gid;
  insert into group_members(group_id, user_id) values (gid, auth.uid()), (gid, pres);
  return gid;
end $$;

-- =====================================================================
-- Ajustements des fonctions existantes
-- =====================================================================
-- N° 39 : le coach ne lit plus la grille, mais la validation d'équipe nouvelle reste au bureau ; rien à changer dans teams_for_code.
-- N° 33 : la création d'une fiche ouvre le dossier (le montant dû est calculé tout seul)
select touch_fees(c.id, null) from clubs c;

-- Pocket Club · alpha 3.0.2 · mise à jour de la base (relançable sans risque, ne supprime aucune donnée)
-- N° 49 page d'accueil publique : recherche de clubs, page d'un club pour un visiteur, rejoindre sans code
-- N° 50 groupes triés par dernier message
set client_min_messages = warning;

-- =====================================================================
-- N° 49 · réglages du club : apparaître dans la recherche (président), code postal
-- =====================================================================
alter table clubs add column if not exists public_listed boolean not null default true;
alter table clubs add column if not exists postal_code text not null default '';
do $$ begin alter table clubs add constraint clubs_postal_code check (postal_code ~ '^([0-9]{5})?$'); exception when duplicate_object then null; end $$;

create or replace function clubs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code <> old.join_code then raise exception 'Le code du club ne se modifie pas ainsi'; end if;
  if new.custom_header is distinct from old.custom_header and auth.uid() is not null and not is_president(old.id) then
    raise exception 'Seul le président choisit l''en-tête aux couleurs du club';
  end if;
  if new.public_listed is distinct from old.public_listed and auth.uid() is not null and not is_president(old.id) then
    raise exception 'Seul le président choisit si le club apparaît dans la recherche';
  end if;
  return new;
end $$;

-- Limite des recherches publiques (anti-aspiration) : 30 par minute et par adresse
create table if not exists search_attempts (ip text not null, at timestamptz not null default now());
create index if not exists search_attempts_ip on search_attempts(ip, at);
alter table search_attempts enable row level security;   -- aucune règle : seulement par les fonctions
create or replace function request_ip() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  return coalesce(h->>'cf-connecting-ip', trim(split_part(h->>'x-forwarded-for', ',', 1)), 'inconnu');
end $$;
create or replace function check_search_rate() returns void language plpgsql security definer set search_path = public as $$
declare v_ip text := request_ip();
begin
  if (select count(*) from search_attempts s where s.ip = v_ip and s.at > now() - interval '1 minute') >= 30 then
    raise exception 'Trop de recherches. Réessaie dans une minute.';
  end if;
  insert into search_attempts(ip) values (v_ip);
  if random() < 0.02 then delete from search_attempts where at < now() - interval '1 hour'; end if;
end $$;
revoke execute on function check_search_rate() from public, anon, authenticated;

-- Recherche publique : nom, ville ou code postal ; seulement les champs publics ; jamais les tables complètes
create or replace function public_search_clubs(p_query text, p_sport text default null)
returns table(id uuid, name text, city text, postal_code text, sport text, logo text, crest_bg text, color1 text, crest_outline text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare q text := norm_name(p_query); d text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  if length(q) < 2 then return; end if;
  perform check_search_rate();
  return query
    select c.id, c.name, c.city, c.postal_code, c.sport, c.logo, c.crest_bg, c.color1, c.crest_outline
    from clubs c
    where c.public_listed and (coalesce(p_sport, '') = '' or c.sport = p_sport)
      and (norm_name(c.name) like '%' || q || '%' or norm_name(c.city) like '%' || q || '%'
           or (length(d) >= 2 and c.postal_code <> '' and c.postal_code like d || '%'))
    order by c.name limit 20;
end $$;

-- Page d'un club pour un visiteur : le club, ses équipes visibles et leurs créneaux ; aucun nombre, aucune personne, aucun match
create or replace function public_club(p_club uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform check_search_rate();
  select jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'postal_code', c.postal_code, 'sport', c.sport, 'logo', c.logo,
      'crest_bg', c.crest_bg, 'color1', c.color1, 'crest_outline', c.crest_outline,
      'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'gender', t.gender, 'slots', t.slots) order by t.name)
                         from teams t where t.club_id = c.id and t.state = 'Visible' and t.deleted_at is null), '[]'::jsonb))
    into r from clubs c where c.id = p_club and c.public_listed;
  return r;
end $$;

-- Rejoindre un club trouvé par la recherche, sans retaper son code (mêmes règles que join_club)
create or replace function join_club_by_id(p_club uuid, p_role text, p_team uuid, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select join_code into code from clubs where id = p_club and public_listed;
  if code is null then raise exception 'Ce club se rejoint seulement avec son code : demande-le au club'; end if;
  return join_club(code, p_role, p_team, p_child_first, p_child_last);
end $$;

grant execute on function public_search_clubs(text, text), public_club(uuid) to anon, authenticated;

-- =====================================================================
-- N° 50 · groupes triés par dernier message (un sondage compte comme un message)
-- =====================================================================
alter table groups add column if not exists last_message_at timestamptz;
update groups g set last_message_at = (select max(x.at) from (select created_at as at from messages m where m.group_id = g.id union all select created_at from polls p where p.group_id = g.id) x)
  where last_message_at is null;
create or replace function touch_group() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update groups set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at) where id = new.group_id;
  return null;
end $$;
drop trigger if exists touch_group_msg on messages;
create trigger touch_group_msg after insert on messages for each row execute function touch_group();
drop trigger if exists touch_group_poll on polls;
create trigger touch_group_poll after insert on polls for each row execute function touch_group();

-- Dernier message (ou sondage) de chacun de mes groupes, sans charger tous les messages
create or replace function group_previews(p_club uuid) returns table(group_id uuid, user_id uuid, body text, created_at timestamptz, kind text)
language sql stable security definer set search_path = public as $$
  select distinct on (x.group_id) x.group_id, x.user_id, x.body, x.created_at, x.kind
  from (
    select m.group_id, m.user_id, m.body, m.created_at, 'message' as kind from messages m
    union all
    select p.group_id, p.created_by, p.question, p.created_at, 'sondage' from polls p where p.deleted_at is null
  ) x join groups g on g.id = x.group_id
  where g.club_id = p_club and is_group_member(g.id)
  order by x.group_id, x.created_at desc;
$$;

-- =====================================================================
-- N° 51 · une personne n'est jamais « parent » de sa propre fiche de joueur
-- =====================================================================
delete from player_parents pp using players x where x.id = pp.player_id and x.user_id = pp.user_id;
create or replace function player_parents_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from players where id = new.player_id and user_id = new.user_id) then return null; end if;
  return new;
end $$;
drop trigger if exists player_parents_guard on player_parents;
create trigger player_parents_guard before insert on player_parents for each row execute function player_parents_guard();

-- Pocket Club · alpha 3.1 · espace coach (relançable sans risque, ne supprime aucune donnée)
-- Banque d'exercices (Ma banque, Club, Libre) avec garde-fous de droits d'auteur, séances, statistiques de présence, heures des coachs.
set client_min_messages = warning;

-- =====================================================================
-- 1. Exercices
-- =====================================================================
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,               -- club de l'auteur
  created_by uuid references auth.users(id) on delete set null,
  sport text not null default 'Basket-ball' check (sport in ('Basket-ball','Volley-ball','Tous les sports')),
  title text not null check (length(trim(title)) between 2 and 80),
  category text not null default 'Technique' check (category in ('Échauffement','Technique','Tactique','Physique','Jeu','Retour au calme')),
  duration_min int not null default 10 check (duration_min between 1 and 120),
  level text not null default '' check (length(level) <= 40),                  -- ex. « U9 à U13 »
  description text not null default '' check (length(description) <= 4000),
  diagram jsonb not null default '[]'::jsonb check (jsonb_typeof(diagram) = 'array' and jsonb_array_length(diagram) <= 60),
  sharing text not null default 'me' check (sharing in ('me','club','public')),          -- moi seul, mon club, tous les clubs
  public_state text not null default 'none' check (public_state in ('none','pending','validated','refused')),
  origin text not null default 'perso' check (origin in ('perso','adapte','ia')),         -- création, adapté d'une source, préparé avec une IA
  source text not null default '' check (length(source) <= 300),
  certified boolean not null default false,                                     -- « J'ai le droit de partager ce contenu »
  up_count int not null default 0,
  down_count int not null default 0,
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sharing = 'me' or certified),
  check (origin <> 'adapte' or length(trim(source)) > 0)
);
create index if not exists exercises_club on exercises(club_id);
create index if not exists exercises_public on exercises(sharing, public_state) where deleted_at is null;

create table if not exists exercise_votes (
  exercise_id uuid not null references exercises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  up boolean not null,
  at timestamptz not null default now(),
  primary key (exercise_id, user_id)
);
create table if not exists exercise_reports (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 3 and 500),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Qui voit un exercice : l'auteur ; son club s'il est partagé au club ou à tous ; tout compte connecté s'il est public et validé par le bureau
create or replace function can_see_exercise(x uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from exercises e where e.id = x and e.deleted_at is null and (
    e.created_by = auth.uid()
    or (e.sharing in ('club','public') and is_member(e.club_id))
    or (e.sharing = 'public' and e.public_state = 'validated' and auth.uid() is not null)));
$$;

-- Mots qui signalent un contenu copié (droits d'auteur)
create or replace function exercise_text_ok(t text) returns boolean language sql immutable as $$
  select not (lower(coalesce(t, '')) ~ '(©|copyright|tous droits réservés|tous droits reserves|all rights reserved|reproduction interdite|reproduction strictement interdite)');
$$;

create or replace function exercises_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if auth.uid() is not null and not (is_coach_in(new.club_id) or is_board(new.club_id)) then
      raise exception 'Seuls les coachs et le bureau ajoutent des exercices';
    end if;
    new.up_count := 0; new.down_count := 0; new.validated_by := null; new.validated_at := null; new.deleted_at := null; new.deleted_by := null;
  else
    new.created_by := old.created_by; new.club_id := old.club_id; new.created_at := old.created_at;
    if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
      new.up_count := old.up_count; new.down_count := old.down_count;
      new.validated_by := old.validated_by; new.validated_at := old.validated_at;
      new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
    end if;
  end if;
  if not (exercise_text_ok(new.title) and exercise_text_ok(new.description) and exercise_text_ok(new.source)) then
    raise exception 'Texte refusé : il contient une mention de droits d''auteur (©, « tous droits réservés »…). Écris l''exercice avec tes propres mots.';
  end if;
  -- partage public : toujours revu par le bureau du club ; un contenu modifié repasse en attente
  if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
    if new.sharing <> 'public' then new.public_state := 'none';
    elsif tg_op = 'INSERT' or old.sharing <> 'public' or old.public_state = 'none'
      or (new.title, new.description, new.diagram, new.source, new.origin) is distinct from (old.title, old.description, old.diagram, old.source, old.origin) then
      new.public_state := 'pending'; new.validated_by := null; new.validated_at := null;
    else new.public_state := old.public_state;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists exercises_guard on exercises;
create trigger exercises_guard before insert or update on exercises for each row execute function exercises_guard();

-- Pouces : un avis par compte, compteurs tenus par la base
create or replace function exercise_votes_count() returns trigger language plpgsql security definer set search_path = public as $$
declare x uuid := coalesce(new.exercise_id, old.exercise_id);
begin
  perform set_config('pc.exsys', 'on', true);
  update exercises set up_count = (select count(*) from exercise_votes where exercise_id = x and up),
                       down_count = (select count(*) from exercise_votes where exercise_id = x and not up) where id = x;
  perform set_config('pc.exsys', 'off', true);
  return null;
end $$;
drop trigger if exists exercise_votes_count on exercise_votes;
create trigger exercise_votes_count after insert or update or delete on exercise_votes for each row execute function exercise_votes_count();

-- Un signalement sur un exercice public le retire des autres clubs jusqu'à une nouvelle validation du bureau
create or replace function exercise_reported() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('pc.exsys', 'on', true);
  update exercises set public_state = 'pending', validated_by = null, validated_at = null where id = new.exercise_id and public_state = 'validated';
  perform set_config('pc.exsys', 'off', true);
  return null;
end $$;
drop trigger if exists exercise_reported on exercise_reports;
create trigger exercise_reported after insert on exercise_reports for each row execute function exercise_reported();

-- Validation du partage public par le bureau du club de l'auteur
create or replace function validate_exercise(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from exercises where id = p_id and deleted_at is null and sharing = 'public';
  if c is null or not is_board(c) then raise exception 'Seul le bureau du club valide un exercice public'; end if;
  perform set_config('pc.exsys', 'on', true);
  update exercises set public_state = case when p_ok then 'validated' else 'refused' end, validated_by = auth.uid(), validated_at = now() where id = p_id;
  update exercise_reports set handled = true where exercise_id = p_id;
  perform set_config('pc.exsys', 'off', true);
  perform log_action(c, null, null, case when p_ok then 'exercice public validé' else 'exercice public refusé' end, jsonb_build_object('exercice', p_id));
end $$;

-- Suppression d'un exercice (corbeille de 30 jours) : l'auteur, ou le bureau pour un exercice partagé au club
create or replace function trash_exercise(p_id uuid, p_restore boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare e exercises;
begin
  select * into e from exercises where id = p_id;
  if e.id is null or not (e.created_by = auth.uid() or (e.sharing <> 'me' and is_board(e.club_id))) then raise exception 'Suppression impossible'; end if;
  perform set_config('pc.exsys', 'on', true);
  if p_restore then update exercises set deleted_at = null, deleted_by = null where id = p_id;
  else update exercises set deleted_at = now(), deleted_by = auth.uid() where id = p_id and deleted_at is null; end if;
  perform set_config('pc.exsys', 'off', true);
end $$;

alter table exercises enable row level security;
alter table exercise_votes enable row level security;
alter table exercise_reports enable row level security;
drop policy if exists "exercice lisible" on exercises;
create policy "exercice lisible" on exercises for select using (can_see_exercise(id) or created_by = auth.uid() or (deleted_at is not null and sharing <> 'me' and is_board(club_id)));
drop policy if exists "exercice ajouté par un coach ou le bureau" on exercises;
create policy "exercice ajouté par un coach ou le bureau" on exercises for insert with check (is_coach_in(club_id) or is_board(club_id));
drop policy if exists "exercice modifié par son auteur" on exercises;
create policy "exercice modifié par son auteur" on exercises for update using (created_by = auth.uid() and deleted_at is null);
drop policy if exists "avis lisible par son auteur" on exercise_votes;
create policy "avis lisible par son auteur" on exercise_votes for select using (user_id = auth.uid());
drop policy if exists "avis donné sur un exercice visible" on exercise_votes;
create policy "avis donné sur un exercice visible" on exercise_votes for insert with check (user_id = auth.uid() and can_see_exercise(exercise_id));
drop policy if exists "avis changé" on exercise_votes;
create policy "avis changé" on exercise_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid() and can_see_exercise(exercise_id));
drop policy if exists "avis retiré" on exercise_votes;
create policy "avis retiré" on exercise_votes for delete using (user_id = auth.uid());
drop policy if exists "signalement lu par le bureau et son auteur" on exercise_reports;
create policy "signalement lu par le bureau et son auteur" on exercise_reports for select
  using (user_id = auth.uid() or exists(select 1 from exercises e where e.id = exercise_id and is_board(e.club_id)));
drop policy if exists "signalement d'un exercice visible" on exercise_reports;
create policy "signalement d'un exercice visible" on exercise_reports for insert with check (user_id = auth.uid() and can_see_exercise(exercise_id));
drop policy if exists "signalement traité par le bureau" on exercise_reports;
create policy "signalement traité par le bureau" on exercise_reports for update using (exists(select 1 from exercises e where e.id = exercise_id and is_board(e.club_id)));

-- Nom de l'auteur et club pour la banque « Libre » (sans autre donnée personnelle)
create or replace function exercise_authors(p_ids uuid[]) returns table(id uuid, author text, club_name text)
language sql stable security definer set search_path = public as $$
  select e.id, coalesce(nullif(trim(p.first_name || ' ' || left(p.last_name, 1) || case when p.last_name <> '' then '.' else '' end), ''), 'Coach'), c.name
  from exercises e join clubs c on c.id = e.club_id left join profiles p on p.id = e.created_by
  where e.id = any(p_ids) and can_see_exercise(e.id);
$$;

-- =====================================================================
-- 2. Séances (composées depuis la banque, reliées si on veut à un entraînement)
-- =====================================================================
create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 80),
  notes text not null default '' check (length(notes) <= 2000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 30),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_plans_club on training_plans(club_id);
create index if not exists training_plans_event on training_plans(event_id);

create or replace function training_plans_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; new.club_id := old.club_id; end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is distinct from (case when tg_op = 'INSERT' then null else old.team_id end)
     and new.team_id is not null and not (coaches_team(new.team_id) or is_board(new.club_id)) then
    raise exception 'Tu n''encadres pas cette équipe';
  end if;
  if new.event_id is not null and new.event_id is distinct from (case when tg_op = 'INSERT' then null else old.event_id end) then
    if not exists(select 1 from events where id = new.event_id and club_id = new.club_id) then raise exception 'Rendez-vous d''un autre club'; end if;
    if auth.uid() is not null and not can_manage_event(new.event_id) then raise exception 'Tu ne gères pas ce rendez-vous'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists training_plans_guard on training_plans;
create trigger training_plans_guard before insert or update on training_plans for each row execute function training_plans_guard();

alter table training_plans enable row level security;
drop policy if exists "séance lisible par l'encadrement" on training_plans;
create policy "séance lisible par l'encadrement" on training_plans for select
  using (created_by = auth.uid() or is_board(club_id) or (team_id is not null and coaches_team(team_id)));
drop policy if exists "séance créée par un coach ou le bureau" on training_plans;
create policy "séance créée par un coach ou le bureau" on training_plans for insert
  with check (is_coach_in(club_id) or is_board(club_id));
drop policy if exists "séance modifiée par l'encadrement" on training_plans;
create policy "séance modifiée par l'encadrement" on training_plans for update
  using (created_by = auth.uid() or (team_id is not null and coaches_team(team_id)));
drop policy if exists "séance supprimée par l'encadrement" on training_plans;
create policy "séance supprimée par l'encadrement" on training_plans for delete
  using (created_by = auth.uid() or (team_id is not null and coaches_team(team_id)) or is_board(club_id));

-- =====================================================================
-- 3. Statistiques de présence et de réponses (coach de l'équipe et bureau)
-- =====================================================================
-- Seules les séances pointées (appel fait) comptent ; « oui mais absent » = fiabilité
create or replace function team_attendance(p_team uuid, p_from date, p_to date)
returns table(event_id uuid, starts_at timestamptz, title text, type text, player_id uuid, first_name text, last_name text, status text, answer text)
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team;
  if c is null or not (coaches_team(p_team) or is_board(c)) then raise exception 'Statistiques réservées aux coachs de l''équipe et au bureau'; end if;
  return query
    with ev as (
      select e.id, e.starts_at, e.title, e.type from events e
      where e.club_id = c and p_team = any(e.team_ids) and not e.cancelled and e.type in ('Entraînement','Match','Plateau','Tournoi')
        and e.starts_at >= p_from and e.starts_at < p_to + 1 and e.starts_at < now()
        and exists(select 1 from attendance a where a.event_id = e.id)
    ), pl as (
      select x.id, x.first_name, x.last_name, x.user_id from players x
      where x.deleted_at is null and (x.team_id = p_team or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = p_team))
    )
    select ev.id, ev.starts_at, ev.title, ev.type, pl.id, pl.first_name, pl.last_name,
      a.status,
      coalesce((select r.answer from event_responses r where r.event_id = ev.id and r.player_id = pl.id),
               (select r.answer from event_responses r where r.event_id = ev.id and r.player_id is null and pl.user_id is not null and r.user_id = pl.user_id))
    from ev cross join pl
    left join attendance a on a.event_id = ev.id and a.player_id = pl.id
    order by ev.starts_at, pl.last_name, pl.first_name;
end $$;

create or replace function team_stats(p_team uuid, p_from date, p_to date)
returns table(player_id uuid, first_name text, last_name text, sessions int, present int, late int, absent int, answered int, yes_absent int, no_present int)
language sql stable security definer set search_path = public as $$
  select t.player_id, t.first_name, t.last_name,
    count(t.status)::int,
    count(*) filter (where t.status = 'present')::int,
    count(*) filter (where t.status = 'retard')::int,
    count(*) filter (where t.status = 'absent')::int,
    count(*) filter (where t.status is not null and t.answer is not null)::int,
    count(*) filter (where t.status = 'absent' and t.answer = 'oui')::int,
    count(*) filter (where t.status in ('present','retard') and t.answer = 'non')::int
  from team_attendance(p_team, p_from, p_to) t
  group by t.player_id, t.first_name, t.last_name
  order by t.last_name, t.first_name;
$$;

-- =====================================================================
-- 4. Heures des coachs et relevé mensuel validé par le bureau
-- =====================================================================
create table if not exists coach_hours (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  day date not null,
  minutes int not null check (minutes between 5 and 720),
  kind text not null default 'Entraînement' check (kind in ('Entraînement','Match','Plateau','Tournoi','Réunion','Formation','Autre')),
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists coach_hours_user on coach_hours(club_id, user_id, day);
create unique index if not exists coach_hours_event on coach_hours(user_id, event_id) where event_id is not null;

create table if not exists coach_statements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'submitted' check (status in ('submitted','validated','refused')),
  total_minutes int not null default 0,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  comment text not null default '' check (length(comment) <= 300),
  unique (club_id, user_id, month)
);

-- Un mois envoyé au bureau (ou validé) ne se modifie plus ; un mois refusé redevient modifiable
create or replace function month_locked(c uuid, u uuid, d date) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from coach_statements s where s.club_id = c and s.user_id = u and s.month = date_trunc('month', d)::date and s.status in ('submitted','validated'));
$$;
create or replace function coach_hours_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and month_locked(old.club_id, old.user_id, old.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.club_id := old.club_id; end if;
  if month_locked(new.club_id, new.user_id, new.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is not null and not coaches_team(new.team_id) then raise exception 'Tu n''encadres pas cette équipe'; end if;
  if new.day > current_date + 1 then raise exception 'On note les heures une fois faites'; end if;
  return new;
end $$;
drop trigger if exists coach_hours_guard on coach_hours;
create trigger coach_hours_guard before insert or update or delete on coach_hours for each row execute function coach_hours_guard();

alter table coach_hours enable row level security;
alter table coach_statements enable row level security;
drop policy if exists "heures lues par le coach et le bureau" on coach_hours;
create policy "heures lues par le coach et le bureau" on coach_hours for select using (user_id = auth.uid() or is_board(club_id));
drop policy if exists "heures notées par le coach" on coach_hours;
create policy "heures notées par le coach" on coach_hours for insert with check (user_id = auth.uid() and is_coach_in(club_id));
drop policy if exists "heures modifiées par le coach" on coach_hours;
create policy "heures modifiées par le coach" on coach_hours for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "heures retirées par le coach" on coach_hours;
create policy "heures retirées par le coach" on coach_hours for delete using (user_id = auth.uid());
drop policy if exists "relevés lus par le coach et le bureau" on coach_statements;
create policy "relevés lus par le coach et le bureau" on coach_statements for select using (user_id = auth.uid() or is_board(club_id));
-- écriture des relevés : seulement par les fonctions ci-dessous

-- Pré-remplir le mois avec les séances passées de mes équipes (90 min l'entraînement, 120 le match, 240 le plateau ou le tournoi)
create or replace function fill_coach_hours(p_club uuid, p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; n int;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  if month_locked(p_club, auth.uid(), m) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  insert into coach_hours(club_id, user_id, team_id, event_id, day, minutes, kind)
    select p_club, auth.uid(), (select t from unnest(e.team_ids) t where coaches_team(t) limit 1), e.id, (e.starts_at at time zone 'Europe/Paris')::date,
      case e.type when 'Entraînement' then 90 when 'Match' then 120 else 240 end, e.type
    from events e
    where e.club_id = p_club and not e.cancelled and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
      and e.starts_at >= m and e.starts_at < (m + interval '1 month') and e.starts_at < now()
      and not exists(select 1 from coach_hours h where h.user_id = auth.uid() and h.event_id = e.id);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function submit_coach_month(p_club uuid, p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; tot int;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  select coalesce(sum(minutes), 0) into tot from coach_hours where club_id = p_club and user_id = auth.uid() and day >= m and day < m + interval '1 month';
  if tot = 0 then raise exception 'Aucune heure notée ce mois-ci'; end if;
  insert into coach_statements(club_id, user_id, month, status, total_minutes, submitted_at)
    values (p_club, auth.uid(), m, 'submitted', tot, now())
    on conflict (club_id, user_id, month) do update set status = 'submitted', total_minutes = tot, submitted_at = now(), decided_by = null, decided_at = null
    where coach_statements.status = 'refused';
  if not found then raise exception 'Ce mois est déjà envoyé au bureau'; end if;
end $$;

create or replace function decide_coach_month(p_statement uuid, p_ok boolean, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare s coach_statements;
begin
  select * into s from coach_statements where id = p_statement;
  if s.id is null or not is_board(s.club_id) then raise exception 'Validation réservée au président et au bureau'; end if;
  if s.user_id = auth.uid() then raise exception 'On ne valide pas son propre relevé : un autre membre du bureau s''en charge'; end if;
  if s.status <> 'submitted' then raise exception 'Ce relevé est déjà traité'; end if;
  update coach_statements set status = case when p_ok then 'validated' else 'refused' end, decided_by = auth.uid(), decided_at = now(), comment = left(coalesce(p_comment, ''), 300)
    where id = p_statement;
  perform log_action(s.club_id, s.user_id, null, case when p_ok then 'relevé d''heures validé' else 'relevé d''heures refusé' end,
    jsonb_build_object('mois', to_char(s.month, 'YYYY-MM'), 'minutes', s.total_minutes));
end $$;

-- =====================================================================
-- 5. Corbeille du club : les exercices partagés supprimés y apparaissent ; effacement après 30 jours
-- =====================================================================
create or replace function club_trash(p_club uuid) returns table(kind text, id uuid, label text, deleted_at timestamptz, deleted_by text, purge_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_board(p_club) then return; end if;
  return query
    select 'team', t.id, t.name || coalesce(' · ' || nullif(t.season, ''), ''), t.deleted_at, pr.full_name, t.deleted_at + interval '30 days'
      from teams t left join profiles pr on pr.id = t.deleted_by where t.club_id = p_club and t.deleted_at is not null
  union all
    select 'player', x.id, trim(x.first_name || ' ' || x.last_name), x.deleted_at, pr.full_name, x.deleted_at + interval '30 days'
      from players x left join profiles pr on pr.id = x.deleted_by where x.club_id = p_club and x.deleted_at is not null
  union all
    select 'poll', p.id, p.question || ' · ' || g.name, p.deleted_at, pr.full_name, p.deleted_at + interval '30 days'
      from polls p join groups g on g.id = p.group_id left join profiles pr on pr.id = p.deleted_by where g.club_id = p_club and p.deleted_at is not null
  union all
    select 'exercise', e.id, 'Exercice · ' || e.title, e.deleted_at, pr.full_name, e.deleted_at + interval '30 days'
      from exercises e left join profiles pr on pr.id = e.deleted_by where e.club_id = p_club and e.deleted_at is not null and e.sharing <> 'me'
  order by 4 desc;
end $$;

create or replace function restore_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if p_kind = 'exercise' then perform trash_exercise(p_id, true); return; end if;
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is not null;
    if c is null or not is_board(c) then raise exception 'Restauration réservée au président et au bureau'; end if;
    update teams set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is not null;
    if c is null or not is_board(c) then raise exception 'Restauration réservée au président et au bureau'; end if;
    update players set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'poll' then
    select g.club_id into c from polls p join groups g on g.id = p.group_id where p.id = p_id and p.deleted_at is not null;
    if c is null or not (is_board(c) or can_delete_poll(p_id)) then raise exception 'Restauration impossible'; end if;
    update polls set deleted_at = null, deleted_by = null where id = p_id;
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

create or replace function purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; u uuid; lim timestamptz := now() - interval '30 days';
begin
  delete from memberships where role = 'coach' and team_id in (select id from teams where deleted_at < lim);
  update events set team_ids = (select coalesce(array_agg(t), '{}') from unnest(team_ids) t where t not in (select id from teams where deleted_at < lim))
    where team_ids && array(select id from teams where deleted_at < lim);
  delete from events where audience = 'team' and cardinality(team_ids) = 0;
  delete from teams where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from players where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from poll_votes where poll_id in (select id from polls where deleted_at < lim);
  delete from exercises where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from training_plans where deleted_at < lim;
  delete from join_attempts where at < now() - interval '1 day';
  for u in select id from profiles where deleted_at < lim loop
    begin
      delete from auth.users where id = u;
    exception when others then
      update profiles set first_name = 'Compte', last_name = 'supprimé', nickname = null, phone = null, deleted_snapshot = null where id = u;
      delete from player_parents where user_id = u; delete from group_members where user_id = u; delete from memberships where user_id = u;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function exercise_votes_count() from public, anon, authenticated;
revoke execute on function exercise_reported() from public, anon, authenticated;

-- Pocket Club · alpha 3.2 · vie du club (relançable sans risque, ne supprime aucune donnée)
-- N° 54 fonctions du bureau · N° 55 rubriques par fonction (contrôlées par la base) · N° 53 bénévoles
-- Annonces officielles, convocations et relance · accueil multi-clubs · réglages du président
set client_min_messages = warning;

create table if not exists pc_migrations (name text primary key, at timestamptz not null default now());
alter table pc_migrations enable row level security;   -- aucune règle : lecture et écriture par les scripts seulement

-- =====================================================================
-- 1. N° 54 · fonctions du bureau ; N° 55 · rubriques
-- =====================================================================
alter table memberships add column if not exists fonction text;
do $$ begin alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur sportif','Coordinateur',
  'Correspondant licences','Chargé de communication','Responsable sponsoring','Responsable événements et buvette','Membre du bureau'));
exception when duplicate_object then null; end $$;
-- une seule personne pour la vice-présidence, le secrétariat et la trésorerie
create unique index if not exists memberships_fonction_unique on memberships(club_id, fonction)
  where status = 'active' and fonction in ('Vice-président','Secrétaire','Trésorier');

-- Rubriques : tresorerie, secretariat, technique, communication, evenements (« Commun » = tout le bureau)
create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['secretariat']
    when 'Directeur sportif' then array['technique']
    when 'Coordinateur' then array['technique','evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then array['communication']
    when 'Responsable événements et buvette' then array['evenements']
    else '{}'::text[] end;
$$;

create table if not exists board_areas (                                 -- rubrique ouverte en plus par le président
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null check (area in ('tresorerie','secretariat','technique','communication','evenements')),
  granted_by uuid references auth.users(id) on delete set null,
  at timestamptz not null default now(),
  primary key (club_id, user_id, area)
);
alter table board_areas enable row level security;
drop policy if exists "rubriques lues par le bureau" on board_areas;
create policy "rubriques lues par le bureau" on board_areas for select using (user_id = auth.uid() or is_board(club_id));

create or replace function areas_of(c uuid, u uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'president')
      then array['tresorerie','secretariat','technique','communication','evenements']
    when not exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'bureau') then '{}'::text[]
    else coalesce((select array_agg(distinct a order by a) from (
        select unnest(fonction_areas(m.fonction)) a from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'bureau'
        union select b.area from board_areas b where b.club_id = c and b.user_id = u) x), '{}'::text[]) end;
$$;
create or replace function has_area(c uuid, a text) returns boolean language sql stable security definer set search_path = public as $$
  select a = any(areas_of(c, auth.uid()));
$$;
create or replace function my_areas(c uuid) returns text[] language sql stable security definer set search_path = public as $$
  select areas_of(c, auth.uid());
$$;

-- Une demande de bureau = une fonction ; plusieurs fonctions = plusieurs demandes
create or replace function join_guard() returns trigger language plpgsql as $$
begin
  if new.role = 'bureau' then new.fonction := coalesce(new.fonction, 'Membre du bureau'); else new.fonction := null; end if;
  if new.role <> 'parent' and exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.user_id and m.role = new.role
       and m.team_id is not distinct from new.team_id and m.fonction is not distinct from new.fonction and m.id <> new.id) then
    raise exception 'Tu as déjà ce rôle ou une demande en attente pour ce rôle';
  end if;
  return new;
end $$;
-- reprise : les membres du bureau déjà inscrits sont « Membre du bureau » et gardent toutes leurs rubriques
-- (ouvertes par le président) jusqu'à ce que le président règle leurs fonctions
update memberships set fonction = 'Membre du bureau' where role = 'bureau' and fonction is null;
do $$ begin
  if not exists(select 1 from pc_migrations where name = '3.2-rubriques') then
    insert into board_areas(club_id, user_id, area)
      select distinct m.club_id, m.user_id, a from memberships m, unnest(array['tresorerie','secretariat','technique','communication','evenements']) a
      where m.role = 'bureau' and m.status = 'active' on conflict do nothing;
    insert into pc_migrations(name) values ('3.2-rubriques');
  end if;
end $$;

-- Demander une fonction au bureau (par le code du club, ou par l'identifiant d'un club où l'on est déjà ou qui est dans la recherche)
create or replace function request_bureau(p_club uuid, p_code text, p_fonction text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  perform check_join_rate();
  if p_code is not null and trim(p_code) <> '' then select id into cid from clubs where join_code = upper(trim(p_code));
  else select id into cid from clubs c where c.id = p_club and (c.public_listed or exists(select 1 from memberships m where m.club_id = c.id and m.user_id = auth.uid())); end if;
  if cid is null then if p_code is not null then insert into join_attempts(user_id) values (auth.uid()); end if; raise exception 'Club introuvable'; end if;
  if p_fonction is null or fonction_areas(p_fonction) is null then raise exception 'Fonction inconnue'; end if;
  insert into memberships(club_id, user_id, role, fonction, status) values (cid, auth.uid(), 'bureau', p_fonction, 'pending') returning id into mid;
  if is_president(cid) then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

-- Le président nomme, change ou retire une fonction ; il ouvre ou ferme une rubrique en plus
create or replace function set_bureau_fonction(p_club uuid, p_user uuid, p_fonction text, p_membership uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Seul le président attribue les fonctions du bureau'; end if;
  if p_fonction is null then raise exception 'Fonction manquante'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if p_membership is not null then
    update memberships set fonction = p_fonction where id = p_membership and club_id = p_club and role = 'bureau';
  else
    insert into memberships(club_id, user_id, role, fonction, status) values (p_club, p_user, 'bureau', p_fonction, 'active');
  end if;
  perform log_action(p_club, p_user, null, 'fonction du bureau', jsonb_build_object('fonction', p_fonction));
exception when unique_violation then raise exception 'Cette fonction est déjà tenue par quelqu''un : retire-la d''abord';
end $$;
create or replace function set_board_area(p_club uuid, p_user uuid, p_area text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Seul le président ouvre une rubrique en plus'; end if;
  if p_on then
    if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active' and role = 'bureau') then raise exception 'Seuls les membres du bureau reçoivent une rubrique'; end if;
    insert into board_areas(club_id, user_id, area, granted_by) values (p_club, p_user, p_area, auth.uid()) on conflict do nothing;
  else delete from board_areas where club_id = p_club and user_id = p_user and area = p_area; end if;
  perform log_action(p_club, p_user, null, case when p_on then 'rubrique ouverte' else 'rubrique fermée' end, jsonb_build_object('rubrique', p_area));
end $$;
-- une validation d'adhésion au bureau qui heurte une fonction unique : message clair
create or replace function memberships_fonction_check() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.fonction in ('Vice-président','Secrétaire','Trésorier')
     and exists(select 1 from memberships m where m.club_id = new.club_id and m.fonction = new.fonction and m.status = 'active' and m.id <> new.id) then
    raise exception 'La fonction « % » est déjà tenue : le président doit d''abord la retirer', new.fonction;
  end if;
  return new;
end $$;
drop trigger if exists memberships_fonction_check on memberships;
create trigger memberships_fonction_check before insert or update on memberships for each row execute function memberships_fonction_check();
-- les rubriques ouvertes en plus disparaissent quand la personne quitte le bureau
create or replace function board_areas_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'bureau' and not exists(select 1 from memberships where club_id = old.club_id and user_id = old.user_id and role = 'bureau' and id <> old.id) then
    delete from board_areas where club_id = old.club_id and user_id = old.user_id;
  end if;
  return null;
end $$;
drop trigger if exists board_areas_cleanup on memberships;
create trigger board_areas_cleanup after delete on memberships for each row execute function board_areas_cleanup();

-- Qui valide quoi : le président tout ; le secrétariat les joueurs, parents et supporteurs ; secrétariat ou technique les coachs ;
-- le coach les joueurs et parents de son équipe
create or replace function can_validate(mid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from memberships t
    where t.id = mid and t.user_id <> auth.uid() and is_member(t.club_id) and (
      is_president(t.club_id)
      or (t.role in ('joueur','parent','supporteur') and has_area(t.club_id, 'secretariat'))
      or (t.role = 'coach' and (has_area(t.club_id, 'secretariat') or has_area(t.club_id, 'technique')))
      or (t.role in ('joueur','parent') and t.team_id is not null and coaches_team(t.team_id))));
$$;

-- =====================================================================
-- 1 bis. Contrôles des fonctions existantes par rubrique
-- =====================================================================
-- (partie générée par gen.py à partir des fonctions existantes : seule la ligne de contrôle des droits change)

create or replace function import_fee_grid(p_club uuid, p_season text, p_rows jsonb, p_delete_absent boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; up int := 0; ad int := 0; dl int := 0; keep uuid[] := '{}'; gid uuid;
begin
  if not has_area(p_club, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(team_id uuid, category text, amount numeric, fed numeric) loop
    if r.amount is null or r.amount < 0 then continue; end if;
    if r.team_id is not null and not exists(select 1 from teams where id = r.team_id and club_id = p_club) then continue; end if;
    select id into gid from fee_grid where club_id = p_club and season = p_season
      and ((r.team_id is not null and team_id = r.team_id) or (r.team_id is null and team_id is null and lower(category) = lower(r.category))) limit 1;
    if gid is null then
      insert into fee_grid(club_id, season, team_id, category, amount, fed_part) values (p_club, p_season, r.team_id, case when r.team_id is null then r.category end, r.amount, r.fed) returning id into gid; ad := ad + 1;
    else
      update fee_grid set amount = r.amount, fed_part = r.fed where id = gid and (amount <> r.amount or fed_part is distinct from r.fed);
      if found then up := up + 1; end if;
    end if;
    keep := keep || gid; gid := null;
  end loop;
  if p_delete_absent then delete from fee_grid where club_id = p_club and season = p_season and not (id = any(keep)); get diagnostics dl = row_count; end if;
  return jsonb_build_object('updated', up, 'added', ad, 'deleted', dl);
end $$;

create or replace function mark_paid(p_player uuid, p_paid boolean) returns void language plpgsql security definer set search_path = public as $$
declare a player_admin;
begin
  if not (can_admin_player(p_player) and has_area((select club_id from players where id = p_player), 'tresorerie')) then raise exception 'Réservé à la trésorerie'; end if;
  perform touch_fees(null, p_player);
  select * into a from player_admin where player_id = p_player;
  if p_paid then
    if a.fee_amount is null then raise exception 'Montant dû inconnu : ajoute d''abord le tarif de sa catégorie dans la grille'; end if;
    if a.fee_amount > a.fee_paid then insert into player_payments(player_id, amount, method, created_by) values (p_player, a.fee_amount - a.fee_paid, 'Solde validé à la main', auth.uid()); end if;
  else
    delete from player_payments where player_id = p_player;
  end if;
end $$;

create or replace function decide_coach_month(p_statement uuid, p_ok boolean, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare s coach_statements;
begin
  select * into s from coach_statements where id = p_statement;
  if s.id is null or not has_area(s.club_id, 'technique') then raise exception 'Validation réservée au président et au bureau'; end if;
  if s.user_id = auth.uid() then raise exception 'On ne valide pas son propre relevé : un autre membre du bureau s''en charge'; end if;
  if s.status <> 'submitted' then raise exception 'Ce relevé est déjà traité'; end if;
  update coach_statements set status = case when p_ok then 'validated' else 'refused' end, decided_by = auth.uid(), decided_at = now(), comment = left(coalesce(p_comment, ''), 300)
    where id = p_statement;
  perform log_action(s.club_id, s.user_id, null, case when p_ok then 'relevé d''heures validé' else 'relevé d''heures refusé' end,
    jsonb_build_object('mois', to_char(s.month, 'YYYY-MM'), 'minutes', s.total_minutes));
end $$;

create or replace function validate_exercise(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from exercises where id = p_id and deleted_at is null and sharing = 'public';
  if c is null or not has_area(c, 'technique') then raise exception 'Seul le bureau du club valide un exercice public'; end if;
  perform set_config('pc.exsys', 'on', true);
  update exercises set public_state = case when p_ok then 'validated' else 'refused' end, validated_by = auth.uid(), validated_at = now() where id = p_id;
  update exercise_reports set handled = true where exercise_id = p_id;
  perform set_config('pc.exsys', 'off', true);
  perform log_action(c, null, null, case when p_ok then 'exercice public validé' else 'exercice public refusé' end, jsonb_build_object('exercice', p_id));
end $$;

create or replace function set_team_coach(p_team uuid, p_user uuid, p_assistant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team and deleted_at is null;
  if c is null or not (has_area(c, 'technique') or (p_assistant and coaches_team(p_team))) then raise exception 'Droit insuffisant'; end if;
  if not exists(select 1 from memberships where club_id = c and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if exists(select 1 from memberships where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team) then
    update memberships set assistant = p_assistant, status = 'active' where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team;
  else
    insert into memberships(club_id, user_id, role, team_id, status, assistant) values (c, p_user, 'coach', p_team, 'active', p_assistant);
  end if;
end $$;

create or replace function renew_team(p_team uuid, p_season text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t teams; nid uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not has_area(t.club_id, 'technique') then raise exception 'Droit insuffisant'; end if;
  insert into teams(club_id, name, category, gender, state, season, slots) values (t.club_id, t.name, t.category, t.gender, 'Fantôme', p_season, t.slots) returning id into nid;
  insert into memberships(club_id, user_id, role, team_id, status, assistant)
    select club_id, user_id, 'coach', nid, 'active', assistant from memberships where team_id = p_team and role = 'coach' and status = 'active';
  update teams set state = 'Archivée' where id = p_team;
  return nid;
end $$;

create or replace function create_player(p_club uuid, p_team uuid, p_first text, p_last text, p_birth date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if coalesce(trim(p_first), '') = '' then raise exception 'Prénom obligatoire'; end if;
  insert into players(club_id, team_id, first_name, last_name, birth_date, created_by) values (p_club, p_team, trim(p_first), trim(coalesce(p_last, '')), p_birth, auth.uid()) returning id into pid;
  insert into player_admin(player_id) values (pid);
  return pid;
end $$;

create or replace function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Liste trop longue (300 lignes au plus)'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid, email text, phone text) loop
    if coalesce(r.action, 'create') = 'skip' or coalesce(trim(r.first_name), '') = '' then continue; end if;
    r.email := nullif(lower(trim(coalesce(r.email, ''))), ''); if r.email is not null and r.email not like '%@%' then r.email := null; end if;
    r.phone := nullif(trim(coalesce(r.phone, '')), '');
    if r.action in ('complete', 'addteam') then
      if not exists(select 1 from players where id = r.existing and club_id = p_club and deleted_at is null) then continue; end if;
      update players set birth_date = coalesce(birth_date, r.birth_date), parent_email = coalesce(parent_email, r.email), parent_phone = coalesce(parent_phone, r.phone) where id = r.existing;
      if coalesce(r.licence, '') <> '' then
        insert into player_admin(player_id, licence_number) values (r.existing, r.licence)
          on conflict (player_id) do update set licence_number = coalesce(player_admin.licence_number, excluded.licence_number);
      end if;
      if r.action = 'addteam' and p_team is not null then insert into player_teams values (r.existing, p_team) on conflict do nothing; end if;
      n := n + 1; continue;
    end if;
    insert into players(club_id, team_id, first_name, last_name, birth_date, parent_email, parent_phone, created_by)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, r.email, r.phone, auth.uid()) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function trash_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is null;
    if c is null or not is_president(c) then raise exception 'Seul le président supprime une équipe'; end if;
    update teams set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is null;
    if c is null or not has_area(c, 'secretariat') then raise exception 'Seuls le président et le secrétariat suppriment une fiche'; end if;
    update players set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'poll' then
    perform delete_poll(p_id);
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

-- =====================================================================
-- 2. N° 55 · chaque rubrique protégée par la base
-- =====================================================================
alter table clubs add column if not exists coach_sees_fees boolean not null default true;      -- réglage du président
alter table clubs add column if not exists default_missions jsonb not null
  default '[{"label":"Arbitre","slots":2},{"label":"Table de marque","slots":2},{"label":"Aide","slots":2},{"label":"Buvette","slots":2}]'::jsonb;

-- Trésorerie : tarifs, réductions, versements, documents des tarifs
drop policy if exists "tarifs lisibles par le bureau" on fee_grid;
drop policy if exists "tarifs gérés par le bureau" on fee_grid;
drop policy if exists "tarifs : trésorerie" on fee_grid;
create policy "tarifs : trésorerie" on fee_grid for all using (has_area(club_id, 'tresorerie')) with check (has_area(club_id, 'tresorerie'));
drop policy if exists "documents lisibles par le bureau" on club_docs;
drop policy if exists "documents gérés par le bureau" on club_docs;
drop policy if exists "documents : trésorerie et secrétariat" on club_docs;
create policy "documents : trésorerie et secrétariat" on club_docs for all
  using (has_area(club_id, 'tresorerie') or has_area(club_id, 'secretariat'))
  with check ((has_area(club_id, 'tresorerie') or has_area(club_id, 'secretariat')) and uploaded_by = auth.uid());
drop policy if exists "réductions : bureau seulement" on player_discount;
drop policy if exists "réductions : trésorerie" on player_discount;
create policy "réductions : trésorerie" on player_discount for all
  using (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie'))
  with check (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie'));

-- Lire licence et cotisation : le joueur, ses parents, ses coachs (si le président le permet), la trésorerie et le secrétariat
create or replace function can_see_fees(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x join clubs c on c.id = x.club_id where x.id = p and x.deleted_at is null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or has_area(x.club_id, 'tresorerie') or has_area(x.club_id, 'secretariat')
    or (c.coach_sees_fees and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))))));
$$;
drop policy if exists "dossier lisible" on player_admin;
create policy "dossier lisible" on player_admin for select using (can_see_fees(player_id));
drop policy if exists "dossier créé par le bureau" on player_admin;
drop policy if exists "dossier saisi par le bureau" on player_admin;
create policy "dossier créé par le bureau" on player_admin for insert with check (can_admin_player(player_id)
  and (has_area((select club_id from players where id = player_id), 'tresorerie') or has_area((select club_id from players where id = player_id), 'secretariat')));
create policy "dossier saisi par le bureau" on player_admin for update
  using (can_admin_player(player_id) and (has_area((select club_id from players where id = player_id), 'tresorerie') or has_area((select club_id from players where id = player_id), 'secretariat')))
  with check (can_admin_player(player_id));
-- la licence relève du secrétariat, le moyen de paiement de la trésorerie
create or replace function player_admin_area_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then return new; end if;
  select club_id into c from players where id = new.player_id;
  if (new.licence_state, new.licence_number, new.health_doc) is distinct from (old.licence_state, old.licence_number, old.health_doc) and not has_area(c, 'secretariat') then
    raise exception 'La licence se règle dans la rubrique Secrétariat';
  end if;
  if new.fee_method is distinct from old.fee_method and not has_area(c, 'tresorerie') then
    raise exception 'La cotisation se règle dans la rubrique Trésorerie';
  end if;
  return new;
end $$;
drop trigger if exists player_admin_area_guard on player_admin;
create trigger player_admin_area_guard before update on player_admin for each row execute function player_admin_area_guard();

drop policy if exists "versements lisibles" on player_payments;
drop policy if exists "versements saisis par le bureau" on player_payments;
drop policy if exists "versements retirés par le bureau" on player_payments;
create policy "versements lisibles" on player_payments for select using (can_see_fees(player_id));
create policy "versements saisis par le bureau" on player_payments for insert
  with check (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie') and created_by = auth.uid());
create policy "versements retirés par le bureau" on player_payments for delete
  using (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie'));

-- Technique : équipes (création, réglages ; le coach règle la sienne)
drop policy if exists "équipes créées par le bureau" on teams;
create policy "équipes créées par le bureau" on teams for insert with check (has_area(club_id, 'technique') and deleted_at is null);
drop policy if exists "équipes modifiées par le bureau ou le coach" on teams;
create policy "équipes modifiées par le bureau ou le coach" on teams for update
  using (deleted_at is null and (has_area(club_id, 'technique') or coaches_team(id))) with check (has_area(club_id, 'technique') or coaches_team(id));

-- Communication : blason, couleurs, nom ; réglages réservés : président (en-tête, recherche, cotisations vues des coachs), événements (missions par défaut)
drop policy if exists "club modifié par le président et le bureau" on clubs;
drop policy if exists "club modifié par la communication" on clubs;
create policy "club modifié par la communication" on clubs for update
  using (has_area(id, 'communication') or has_area(id, 'evenements')) with check (has_area(id, 'communication') or has_area(id, 'evenements'));
create or replace function clubs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code <> old.join_code then raise exception 'Le code du club ne se modifie pas ainsi'; end if;
  if auth.uid() is null then return new; end if;
  if new.custom_header is distinct from old.custom_header and not is_president(old.id) then raise exception 'Seul le président choisit l''en-tête aux couleurs du club'; end if;
  if new.public_listed is distinct from old.public_listed and not is_president(old.id) then raise exception 'Seul le président choisit si le club apparaît dans la recherche'; end if;
  if new.coach_sees_fees is distinct from old.coach_sees_fees and not is_president(old.id) then raise exception 'Réglage réservé au président'; end if;
  if new.default_missions is distinct from old.default_missions and not has_area(old.id, 'evenements') then raise exception 'Les missions par défaut se règlent dans la rubrique Événements'; end if;
  if (new.name, new.city, new.postal_code, new.sport, new.color1, new.color2, new.crest_bg, new.logo, new.crest_outline)
     is distinct from (old.name, old.city, old.postal_code, old.sport, old.color1, old.color2, old.crest_bg, old.logo, old.crest_outline)
     and not has_area(old.id, 'communication') then raise exception 'Le blason et les informations du club se règlent dans la rubrique Communication'; end if;
  if jsonb_typeof(new.default_missions) <> 'array' or jsonb_array_length(new.default_missions) > 12 then raise exception 'Liste de missions invalide'; end if;
  return new;
end $$;

-- =====================================================================
-- 3. Convocations : un match, plateau ou tournoi peut ne convoquer que certains joueurs
-- =====================================================================
alter table events add column if not exists convoked uuid[] not null default '{}';
alter table events add column if not exists reminded_at timestamptz;
create or replace function events_convoked_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if cardinality(new.convoked) > 0 then
    if new.audience <> 'team' then raise exception 'Une convocation de joueurs choisis vaut pour une équipe'; end if;
    if exists(select 1 from unnest(new.convoked) p where not exists(select 1 from players x where x.id = p and x.deleted_at is null and x.club_id = new.club_id
         and (x.team_id = any(new.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(new.team_ids))))) then
      raise exception 'Un joueur convoqué ne fait pas partie de l''équipe';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.reminded_at is distinct from old.reminded_at and coalesce(current_setting('pc.remind', true), '') <> 'on' then new.reminded_at := old.reminded_at; end if;
  return new;
end $$;
drop trigger if exists events_convoked_guard on events;
create trigger events_convoked_guard before insert or update on events for each row execute function events_convoked_guard();

create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid() and deleted_at is null)) then
      raise exception 'Ce joueur n''est pas relié à ton compte';
    end if;
    if cardinality(e.convoked) > 0 and not p_player = any(e.convoked) then raise exception 'Ce joueur n''est pas convoqué à ce rendez-vous'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
       and not exists(select 1 from memberships where team_id = any(e.team_ids) and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and deleted_at is null and team_id = any(e.team_ids)) then
      raise exception 'Tu encadres cette équipe : pas de réponse pour toi-même';
    end if;
    if e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi') and not exists(select 1 from unnest(e.team_ids) t where in_team(t)) then
      raise exception 'Ce rendez-vous concerne une équipe dont tu ne fais pas partie';
    end if;
    if cardinality(e.convoked) > 0 and not exists(select 1 from players x where x.user_id = auth.uid() and x.id = any(e.convoked)) then
      raise exception 'Tu n''es pas convoqué à ce rendez-vous';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- =====================================================================
-- 4. Annonces officielles (et relances), avec « lu par »
-- =====================================================================
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  audience text not null default 'club' check (audience in ('club','team','board','board_coaches','coaches','people')),
  team_ids uuid[] not null default '{}',
  people uuid[] not null default '{}',
  kind text not null default 'annonce' check (kind in ('annonce','relance','missions','cotisation')),
  event_id uuid references events(id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 120),
  body text not null default '' check (length(body) <= 3000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (audience <> 'team' or cardinality(team_ids) between 1 and 20),
  check (audience <> 'people' or cardinality(people) between 1 and 500)
);
create index if not exists announcements_club on announcements(club_id, created_at desc);
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create or replace function sees_announcement(aid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from announcements a where a.id = aid and a.deleted_at is null and is_member(a.club_id) and (
    a.created_by = auth.uid()
    or a.audience = 'club'
    or (a.audience = 'team' and (exists(select 1 from unnest(a.team_ids) t where in_team(t)) or is_board(a.club_id)))
    or (a.audience = 'board' and is_board(a.club_id))
    or (a.audience in ('coaches','board_coaches') and (is_coach_in(a.club_id) or is_board(a.club_id)))
    or (a.audience = 'people' and auth.uid() = any(a.people))));
$$;
-- Qui publie : la communication (et le président) pour tout le club ; le bureau pour le bureau et les coachs ; le coach pour ses équipes
create or replace function can_announce(c uuid, aud text, ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select not exists(select 1 from unnest(coalesce(ts, '{}')) t where not exists(select 1 from teams x where x.id = t and x.club_id = c and x.deleted_at is null))
    and (has_area(c, 'communication')
      or (aud in ('board','board_coaches','coaches') and is_board(c))
      or (aud = 'team' and coaches_all(ts)));
$$;
create or replace function announcements_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.deleted_at := null;
    if coalesce(current_setting('pc.announce', true), '') <> 'on' then
      new.kind := 'annonce'; new.event_id := null;
      if new.audience = 'people' then raise exception 'Une annonce à des personnes choisies passe par une relance'; end if;
      if not can_announce(new.club_id, new.audience, new.team_ids) then raise exception 'Tu ne peux pas publier pour ces destinataires'; end if;
    end if;
  else
    if (new.club_id, new.audience, new.team_ids, new.people, new.kind, new.event_id, new.created_by) is distinct from
       (old.club_id, old.audience, old.team_ids, old.people, old.kind, old.event_id, old.created_by) then raise exception 'Seuls le titre et le texte se modifient'; end if;
  end if;
  return new;
end $$;
drop trigger if exists announcements_guard on announcements;
create trigger announcements_guard before insert or update on announcements for each row execute function announcements_guard();
alter table announcements enable row level security;
alter table announcement_reads enable row level security;
drop policy if exists "annonces lues par les destinataires" on announcements;
create policy "annonces lues par les destinataires" on announcements for select using (sees_announcement(id));
drop policy if exists "annonces publiées selon les droits" on announcements;
create policy "annonces publiées selon les droits" on announcements for insert with check (is_member(club_id));
drop policy if exists "annonce modifiée par son auteur" on announcements;
create policy "annonce modifiée par son auteur" on announcements for update using (created_by = auth.uid() or has_area(club_id, 'communication'));
drop policy if exists "lu : chacun pour soi" on announcement_reads;
create policy "lu : chacun pour soi" on announcement_reads for insert with check (user_id = auth.uid() and sees_announcement(announcement_id));
drop policy if exists "lu : lisible par soi et l'auteur" on announcement_reads;
create policy "lu : lisible par soi et l'auteur" on announcement_reads for select using (user_id = auth.uid()
  or exists(select 1 from announcements a where a.id = announcement_id and (a.created_by = auth.uid() or has_area(a.club_id, 'communication'))));
create or replace function delete_announcement(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and deleted_at is null;
  if a.id is null or not (a.created_by = auth.uid() or has_area(a.club_id, 'communication')) then raise exception 'Suppression impossible'; end if;
  update announcements set deleted_at = now() where id = p_id;
end $$;

-- Personnes qui n'ont pas répondu à un rendez-vous (convoqués seulement) : parents des enfants, joueurs avec compte, autres invités
create or replace function event_missing(p_event uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  with e as (select * from events where id = p_event),
  pl as (select x.* from players x, e where x.deleted_at is null and e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi')
           and (x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids)))
           and (cardinality(e.convoked) = 0 or x.id = any(e.convoked))
           and not exists(select 1 from event_responses r where r.event_id = p_event and (r.player_id = x.id or (r.player_id is null and x.user_id is not null and r.user_id = x.user_id)))),
  team_users as (select pp.user_id from player_parents pp join pl on pl.id = pp.player_id union select pl.user_id from pl where pl.user_id is not null),
  invited as (select distinct m.user_id from memberships m, e where m.club_id = e.club_id and m.status = 'active'
           and not (e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi'))
           and (e.audience = 'club' or (e.audience = 'board' and m.role in ('president','bureau')) or (e.audience = 'coaches' and m.role = 'coach')
             or (e.audience = 'board_coaches' and m.role in ('president','bureau','coach')) or (e.audience = 'people' and m.user_id = any(e.people))
             or (e.audience = 'team' and (m.team_id = any(e.team_ids))))
           and not exists(select 1 from event_responses r where r.event_id = p_event and r.user_id = m.user_id and r.player_id is null))
  select coalesce(array_agg(distinct u), '{}') from (select user_id u from team_users union select user_id from invited) z where u is not null and u <> auth.uid();
$$;
revoke execute on function event_missing(uuid) from public, anon, authenticated;

-- Relance des sans-réponse par l'organisateur : une annonce « Rappel » à ces seules personnes (une fois toutes les 12 heures)
create or replace function remind_event(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; who uuid[];
begin
  select * into e from events where id = p_event;
  if e.id is null or not (can_manage_event(p_event) or e.created_by = auth.uid()) then raise exception 'Seul l''organisateur relance'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est passé ou annulé'; end if;
  if e.reminded_at > now() - interval '12 hours' then raise exception 'Relance déjà faite il y a moins de 12 heures'; end if;
  who := event_missing(p_event);
  if cardinality(who) = 0 then return 0; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, event_id, title, body)
    values (e.club_id, 'people', who, 'relance', e.id, 'Rappel : ta réponse est attendue',
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Réponds « Je viens » ou « Je ne viens pas ».');
  perform set_config('pc.remind', 'on', true);
  update events set reminded_at = now() where id = p_event;
  perform set_config('pc.announce', 'off', true); perform set_config('pc.remind', 'off', true);
  return cardinality(who);
end $$;

-- =====================================================================
-- 5. N° 53 · bénévoles : missions à pourvoir sur un match, plateau, tournoi, événement ou AG
-- =====================================================================
create table if not exists event_missions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null check (length(trim(label)) between 2 and 40),
  slots int not null default 1 check (slots between 1 and 20),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_missions_event on event_missions(event_id);
create table if not exists mission_signups (
  mission_id uuid not null references event_missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  at timestamptz not null default now(),
  primary key (mission_id, user_id)
);
create or replace function can_manage_missions(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and ((e.audience = 'team' and coaches_any(e.team_ids)) or e.created_by = auth.uid() or has_area(e.club_id, 'evenements')));
$$;
-- Peuvent s'inscrire : bureau, coachs, parents de joueurs et joueurs majeurs (d'une équipe concernée pour un rendez-vous d'équipe) ; jamais les supporteurs seuls ni les mineurs
create or replace function can_volunteer(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and not e.cancelled and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active') and (
    exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach'))
    or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and x.birth_date is not null and x.birth_date <= current_date - interval '18 years'
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))));
$$;
create or replace function event_missions_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from events where id = new.event_id and type in ('Match','Plateau','Tournoi','Événement','AG')) then
    raise exception 'Les missions de bénévoles valent pour un match, un plateau, un tournoi, un événement ou une AG';
  end if;
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'Mission d''un autre rendez-vous'; end if;
  if tg_op = 'UPDATE' and new.slots < (select count(*) from mission_signups where mission_id = new.id) then
    raise exception 'Des bénévoles sont déjà inscrits : retire-les avant de réduire le nombre de places';
  end if;
  return new;
end $$;
drop trigger if exists event_missions_guard on event_missions;
create trigger event_missions_guard before insert or update on event_missions for each row execute function event_missions_guard();
alter table event_missions enable row level security;
alter table mission_signups enable row level security;
drop policy if exists "missions lisibles par les destinataires" on event_missions;
create policy "missions lisibles par les destinataires" on event_missions for select using (sees_event(event_id));
drop policy if exists "missions gérées par l'organisateur" on event_missions;
create policy "missions gérées par l'organisateur" on event_missions for all using (can_manage_missions(event_id)) with check (can_manage_missions(event_id));
drop policy if exists "bénévoles lisibles par les destinataires" on mission_signups;
create policy "bénévoles lisibles par les destinataires" on mission_signups for select
  using (exists(select 1 from event_missions mi where mi.id = mission_id and sees_event(mi.event_id)));
-- écriture des inscriptions : seulement par volunteer() et assign_volunteer()

create or replace function volunteer(p_mission uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mi event_missions; e events;
begin
  select * into mi from event_missions where id = p_mission;
  select * into e from events where id = mi.event_id;
  if mi.id is null or not sees_event(e.id) then raise exception 'Mission introuvable'; end if;
  if not p_on then delete from mission_signups where mission_id = p_mission and user_id = auth.uid(); return; end if;
  if e.starts_at < now() then raise exception 'Ce rendez-vous est passé'; end if;
  if not can_volunteer(e.id, auth.uid()) then raise exception 'Les missions sont ouvertes aux parents, joueurs majeurs, coachs et au bureau concernés'; end if;
  if exists(select 1 from mission_signups s join event_missions m2 on m2.id = s.mission_id where m2.event_id = e.id and s.user_id = auth.uid()) then
    raise exception 'Tu as déjà une mission sur ce rendez-vous : l''organisateur peut t''en ajouter une autre';
  end if;
  perform 1 from event_missions where id = p_mission for update;
  if (select count(*) from mission_signups where mission_id = p_mission) >= mi.slots then raise exception 'Complet'; end if;
  insert into mission_signups(mission_id, user_id, added_by) values (p_mission, auth.uid(), auth.uid());
end $$;
create or replace function assign_volunteer(p_mission uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mi event_missions;
begin
  select * into mi from event_missions where id = p_mission;
  if mi.id is null or not can_manage_missions(mi.event_id) then raise exception 'Seul l''organisateur inscrit ou retire un bénévole'; end if;
  if not p_on then delete from mission_signups where mission_id = p_mission and user_id = p_user; return; end if;
  if not exists(select 1 from memberships m join events e on e.club_id = m.club_id where e.id = mi.event_id and m.user_id = p_user and m.status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  perform 1 from event_missions where id = p_mission for update;
  if (select count(*) from mission_signups where mission_id = p_mission) >= mi.slots then raise exception 'Complet'; end if;
  insert into mission_signups(mission_id, user_id, added_by) values (p_mission, p_user, auth.uid()) on conflict do nothing;
end $$;
-- Ajouter les missions par défaut du club à un rendez-vous
create or replace function add_default_missions(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; n int;
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur ajoute des missions'; end if;
  insert into event_missions(event_id, label, slots, position)
    select p_event, x->>'label', greatest(1, least(20, coalesce((x->>'slots')::int, 1))), (row_number() over ())::int
    from clubs c, jsonb_array_elements(c.default_missions) x where c.id = e.club_id
      and not exists(select 1 from event_missions m where m.event_id = p_event and lower(m.label) = lower(x->>'label'));
  get diagnostics n = row_count; return n;
end $$;
-- Relance des missions vides : une annonce aux destinataires du rendez-vous
create or replace function remind_missions(p_event uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e events; txt text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur relance'; end if;
  select string_agg(n || ' ' || lower(label), ', ' order by position) into txt from (
    select m.label, m.position, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id) n from event_missions m where m.event_id = p_event) z where n > 0;
  if txt is null then raise exception 'Toutes les missions sont pourvues'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, team_ids, people, kind, event_id, title, body)
    values (e.club_id, case when e.audience in ('team','club','people') then e.audience else 'club' end, e.team_ids, e.people, 'missions', e.id,
            'Bénévoles : il manque ' || txt,
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Ouvre le rendez-vous pour t''inscrire.');
  perform set_config('pc.announce', 'off', true);
  return txt;
end $$;

-- =====================================================================
-- 6. Accueil multi-clubs : un aperçu de chacun de mes autres clubs
-- =====================================================================
create or replace function my_clubs_overview() returns table(club_id uuid, name text, sport text, color1 text, crest_bg text, logo text, crest_outline text, roles text[], next_events jsonb, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.sport, c.color1, c.crest_bg, c.logo, c.crest_outline,
    (select array_agg(distinct m.role) from memberships m where m.club_id = c.id and m.user_id = auth.uid() and m.status = 'active'),
    coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'type', e.type, 'starts_at', e.starts_at) order by e.starts_at)
      from (select * from events e where e.club_id = c.id and not e.cancelled and e.starts_at between now() and now() + interval '7 days' and sees_event(e.id) order by e.starts_at limit 3) e), '[]'::jsonb),
    (select count(*)::int from announcements a where a.club_id = c.id and a.created_at > now() - interval '30 days' and a.created_by is distinct from auth.uid()
      and sees_announcement(a.id) and not exists(select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = auth.uid()))
  from clubs c where exists(select 1 from memberships m where m.club_id = c.id and m.user_id = auth.uid() and m.status = 'active')
  order by c.name;
$$;

-- Journal des actions sensibles lisible par le président, avec les noms
create or replace function club_log(p_club uuid, p_limit int default 100) returns table(at timestamptz, actor text, target text, action text, detail jsonb)
language sql stable security definer set search_path = public as $$
  select l.at, coalesce(a.full_name, '—'), coalesce(nullif(trim(x.first_name || ' ' || x.last_name), ''), t.full_name, ''), l.action, l.detail
  from action_log l left join profiles a on a.id = l.actor left join profiles t on t.id = l.target_user left join players x on x.id = l.target_player
  where l.club_id = p_club and is_president(p_club) order by l.at desc limit least(coalesce(p_limit, 100), 500);
$$;

do $$ begin alter publication supabase_realtime add table announcements; exception when duplicate_object then null; end $$;
revoke execute on function areas_of(uuid, uuid) from public, anon, authenticated;

-- Rappel de cotisation (trésorerie) : une annonce au joueur et à ses parents seulement, une fois par semaine au plus
create or replace function remind_fee(p_player uuid) returns int
language plpgsql security definer set search_path = public as $$
declare x players; a player_admin; who uuid[];
begin
  select * into x from players where id = p_player and deleted_at is null;
  if x.id is null or not has_area(x.club_id, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
  select * into a from player_admin where player_id = p_player;
  if a.fee_amount is null or a.fee_paid >= a.fee_amount then raise exception 'Rien à régler pour ce joueur'; end if;
  if exists(select 1 from announcements n where n.kind = 'cotisation' and n.club_id = x.club_id and n.body like '%' || x.id::text || '%' and n.created_at > now() - interval '7 days') then
    raise exception 'Rappel déjà envoyé cette semaine';
  end if;
  select coalesce(array_agg(distinct u), '{}') into who from (select user_id u from player_parents where player_id = p_player union select x.user_id) z where u is not null;
  if cardinality(who) = 0 then raise exception 'Aucun compte relié à cette fiche : contacte la famille directement'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, title, body)
    values (x.club_id, 'people', who, 'cotisation', 'Cotisation de ' || x.first_name || ' : reste ' || trim(to_char(a.fee_amount - a.fee_paid, 'FM999990D00')) || ' €',
            'Merci de régler le reste de la cotisation auprès du trésorier du club. Réf. ' || x.id::text);
  perform set_config('pc.announce', 'off', true);
  return cardinality(who);
end $$;

-- =====================================================================
-- Alpha 3.2.1 · vidéos des exercices (stockage privé Supabase, vignette dans la liste)
-- Relançable sans risque.
-- =====================================================================
alter table exercises add column if not exists video_path text not null default '';
alter table exercises add column if not exists poster_path text not null default '';
do $$ begin
  alter table exercises add constraint exercises_video_len check (length(video_path) <= 200 and length(poster_path) <= 200);
exception when duplicate_object then null; end $$;

-- Espace de stockage privé : un dossier par exercice (<id de l'exercice>/video.mp4 et poster.jpg), 50 Mo par fichier
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', false, 52428800, array['video/mp4','video/quicktime','video/webm','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function exercise_of_path(p text) returns uuid language sql immutable as $$
  select case when split_part(p, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p, '/', 1)::uuid end;
$$;
-- Lecture : qui voit l'exercice voit sa vidéo ; ajout, remplacement, retrait : l'auteur seulement
drop policy if exists "video d'exercice lisible" on storage.objects;
create policy "video d'exercice lisible" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos' and (can_see_exercise(exercise_of_path(name))
         or exists(select 1 from exercises e where e.video_path = name and can_see_exercise(e.id))));
drop policy if exists "video d'exercice ajoutee par l'auteur" on storage.objects;
create policy "video d'exercice ajoutee par l'auteur" on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-videos' and exists(select 1 from exercises e where e.id = exercise_of_path(name) and e.created_by = auth.uid() and e.deleted_at is null));
drop policy if exists "video d'exercice remplacee par l'auteur" on storage.objects;
create policy "video d'exercice remplacee par l'auteur" on storage.objects for update to authenticated
  using (bucket_id = 'exercise-videos' and exists(select 1 from exercises e where e.id = exercise_of_path(name) and e.created_by = auth.uid()));
drop policy if exists "video d'exercice retiree par l'auteur" on storage.objects;
create policy "video d'exercice retiree par l'auteur" on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-videos' and exists(select 1 from exercises e where e.id = exercise_of_path(name) and e.created_by = auth.uid()));

-- Une nouvelle vidéo sur un exercice public repasse par la validation du bureau
create or replace function exercises_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if auth.uid() is not null and not (is_coach_in(new.club_id) or is_board(new.club_id)) then
      raise exception 'Seuls les coachs et le bureau ajoutent des exercices';
    end if;
    new.up_count := 0; new.down_count := 0; new.validated_by := null; new.validated_at := null; new.deleted_at := null; new.deleted_by := null;
  else
    new.created_by := old.created_by; new.club_id := old.club_id; new.created_at := old.created_at;
    if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
      new.up_count := old.up_count; new.down_count := old.down_count;
      new.validated_by := old.validated_by; new.validated_at := old.validated_at;
      new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
    end if;
  end if;
  if not (exercise_text_ok(new.title) and exercise_text_ok(new.description) and exercise_text_ok(new.source)) then
    raise exception 'Texte refusé : il contient une mention de droits d''auteur (©, « tous droits réservés »…). Écris l''exercice avec tes propres mots.';
  end if;
  -- partage public : toujours revu par le bureau du club ; un contenu modifié repasse en attente
  if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
    if new.sharing <> 'public' then new.public_state := 'none';
    elsif tg_op = 'INSERT' or old.sharing <> 'public' or old.public_state = 'none'
      or (new.title, new.description, new.diagram, new.source, new.origin, new.video_path) is distinct from (old.title, old.description, old.diagram, old.source, old.origin, old.video_path) then
      new.public_state := 'pending'; new.validated_by := null; new.validated_at := null;
    else new.public_state := old.public_state;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- Pocket Club · alpha 3.2.4 (mise à jour cumulative, relançable sans risque)
-- À installer APRÈS schema.sql, alpha_3_0_1, alpha_3_0_2, alpha_3_1, alpha_3_2 et alpha_3_2_1.
--   n° 57 : reprise des entraînements sans lien de série (recopiés, importés, créés avant la 3.1)
--   Retrait de la fonction « Responsable événements et buvette » et de la rubrique « Événements et buvette »
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 57 · Rattacher à une série les entraînements identiques restés sans lien
-- Même club, mêmes équipes, même titre, même jour de la semaine, même heure (heure de Paris), même créateur ;
-- au moins deux séances. Les séances déjà liées à une série ne sont jamais touchées.
-- Relançable : une fois rattachées, les séances ne sont plus « sans lien ».
-- ---------------------------------------------------------------------
create or replace function link_unlinked_trainings() returns int
language plpgsql set search_path = public as $$
declare g record; sid uuid; n int := 0;
begin
  for g in
    select club_id, team_ids, lower(trim(title)) as k_title, min(title) as title,
           extract(dow from starts_at at time zone 'Europe/Paris')::int as wd,
           to_char(starts_at at time zone 'Europe/Paris', 'HH24:MI') as hm,
           created_by, array_agg(id) as ids,
           max((starts_at at time zone 'Europe/Paris')::date) as last_day
    from events
    where type = 'Entraînement' and series_id is null and audience = 'team'
    group by club_id, team_ids, lower(trim(title)), extract(dow from starts_at at time zone 'Europe/Paris'),
             to_char(starts_at at time zone 'Europe/Paris', 'HH24:MI'), created_by
    having count(*) >= 2
  loop
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (g.club_id, g.title, g.wd, g.hm, g.last_day, true, g.created_by) returning id into sid;
    update events set series_id = sid where id = any(g.ids) and series_id is null;
    n := n + array_length(g.ids, 1);
  end loop;
  return n;
end $$;
revoke all on function link_unlinked_trainings() from public;
do $$ begin execute 'revoke all on function link_unlinked_trainings() from anon, authenticated'; exception when undefined_object then null; end $$;

select link_unlinked_trainings();

-- ---------------------------------------------------------------------
-- Retrait de la fonction « Responsable événements et buvette »
-- Les événements et les bénévoles relèvent du Coordinateur, du vice-président et du président.
-- La rubrique (clé interne « evenements ») reste, sous le nom « Événements ».
-- Reprise sans perte d'accès : les personnes qui avaient cette fonction passent « Membre du bureau »
-- et gardent la rubrique Événements, ouverte en plus, jusqu'à ce que le président règle leur fonction.
-- ---------------------------------------------------------------------
insert into board_areas(club_id, user_id, area)
  select distinct club_id, user_id, 'evenements' from memberships
  where fonction = 'Responsable événements et buvette' and status = 'active' and role = 'bureau'
  on conflict do nothing;
update memberships set fonction = 'Membre du bureau' where fonction = 'Responsable événements et buvette';

alter table memberships drop constraint if exists memberships_fonction;
alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur sportif','Coordinateur',
  'Correspondant licences','Chargé de communication','Responsable sponsoring','Membre du bureau'));

create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['secretariat']
    when 'Directeur sportif' then array['technique']
    when 'Coordinateur' then array['technique','evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then array['communication']
    else '{}'::text[] end;
$$;

-- =====================================================================
-- Pocket Club · alpha 3.3 · étape B 2 sur 5 : notifications (mise à jour relançable sans risque)
-- À installer APRÈS alpha_3_2_4.sql.
--   1. Les téléphones inscrits (un par appareil, rattaché au compte connecté)
--   2. La file des notifications à envoyer (vidée par la fonction d'envoi de l'étape 3)
--   3. Ce qui remplit la file : nouveaux rendez-vous, changements, annulations, annonces et relances,
--      messages et sondages des groupes
-- Règle d'or : une personne n'est prévenue que d'un rendez-vous ou d'une annonce qu'elle voit déjà dans l'application.
-- Pour le vérifier, la base pose la question « que voit cette personne ? » avec les mêmes règles que l'écran
-- (sees_event, sees_announcement), compte par compte, et seulement pour les comptes qui ont un téléphone inscrit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Téléphones inscrits
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  endpoint text primary key check (length(endpoint) between 10 and 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) between 10 and 200),
  auth text not null check (length(auth) between 8 and 100),
  agent text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;   -- aucune lecture directe : tout passe par les fonctions ci-dessous

-- L'appareil s'inscrit (ou se rattache au compte connecté s'il était inscrit pour un autre compte)
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_agent text default '') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Adresse d''envoi invalide'; end if;
  insert into push_subscriptions(endpoint, user_id, p256dh, auth, agent)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_agent, ''), 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, agent = excluded.agent, last_seen_at = now();
  -- 10 appareils au plus par compte : les plus anciens sont retirés
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by last_seen_at desc offset 10);
  return true;
end $$;
-- L'appareil se retire (« Couper », déconnexion, changement de profil de test)
create or replace function push_unsubscribe(p_endpoint text) returns boolean
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() returning true;
$$;
revoke execute on function push_subscribe(text, text, text, text) from public, anon;
revoke execute on function push_unsubscribe(text) from public, anon;
grant execute on function push_subscribe(text, text, text, text) to authenticated;
grant execute on function push_unsubscribe(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. File des notifications
-- ---------------------------------------------------------------------
create table if not exists push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default './',
  tag text not null default '',
  dedupe_key text not null,                         -- une seule notification par personne pour un même fait (ex. une série créée d'un coup)
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  tries int not null default 0,
  last_error text
);
create unique index if not exists push_queue_dedupe on push_queue(user_id, dedupe_key);
create index if not exists push_queue_key on push_queue(dedupe_key);
create index if not exists push_queue_todo on push_queue(created_at) where sent_at is null;
alter table push_queue enable row level security;   -- aucune lecture directe

-- Ajoute une notification pour une personne (seulement si elle a au moins un téléphone inscrit)
create or replace function push_enqueue(u uuid, p_title text, p_body text, p_tag text, p_key text, p_url text default './') returns void
language sql security definer set search_path = public as $$
  insert into push_queue(user_id, title, body, url, tag, dedupe_key)
  select u, left(p_title, 80), left(coalesce(p_body, ''), 180), p_url, coalesce(p_tag, ''), p_key
  where exists(select 1 from push_subscriptions s where s.user_id = u)
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- « Se mettre à la place » d'un compte, le temps de poser la question « que voit-il ? »
-- (auth.uid() de Supabase lit d'abord request.jwt.claim.sub ; la base de test lit request.uid)
create or replace function push_as(u uuid) returns void language sql volatile set search_path = public as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), true), set_config('request.uid', coalesce(u::text, ''), true);
$$;
create or replace function push_restore(sub text, uid text) returns void language sql volatile set search_path = public as $$
  select set_config('request.jwt.claim.sub', coalesce(sub, ''), true), set_config('request.uid', coalesce(uid, ''), true);
$$;

-- Petits outils de mise en forme (heure de Paris)
create or replace function push_when(t timestamptz) returns text language sql immutable as $$
  select (array['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'])[extract(dow from t at time zone 'Europe/Paris')::int + 1]
         || ' ' || to_char(t at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI');
$$;
create or replace function push_ev_line(e events) returns text language sql stable set search_path = public as $$
  select e.title || ' · ' || push_when(e.starts_at) || case when e.place <> '' then ' · ' || e.place else '' end
         || ' (' || coalesce((select name from clubs where id = e.club_id), '') || ')';
$$;

-- Comptes à prévenir pour un rendez-vous : ceux qui le voient, avec un téléphone inscrit, sauf l'auteur du geste
-- et ceux qui l'ont masqué. Convocation de joueurs choisis : les familles des joueurs non convoqués ne sont pas prévenues.
create or replace function push_event_targets(eid uuid, actor uuid) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into e from events where id = eid; if e.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = e.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_event(eid)
       and not exists(select 1 from event_hidden h where h.event_id = eid and h.user_id = u)
       and (cardinality(e.convoked) = 0 or is_board(e.club_id) or coaches_any(e.team_ids) or e.created_by = u
            or exists(select 1 from players p where p.id = any(e.convoked) and p.deleted_at is null
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))
            or not exists(select 1 from players p where p.deleted_at is null and p.club_id = e.club_id
                      and (p.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(e.team_ids)))
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))) then
      return next u;
    end if;
  end loop;
  perform push_restore(sub0, uid0);
end $$;

create or replace function push_announcement_targets(aid uuid, actor uuid) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare a announcements; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into a from announcements where id = aid; if a.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = a.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_announcement(aid) then return next u; end if;
  end loop;
  perform push_restore(sub0, uid0);
end $$;

-- ---------------------------------------------------------------------
-- 3. Ce qui remplit la file
-- ---------------------------------------------------------------------
-- Nouveau rendez-vous (une seule notification pour une série créée d'un coup) ; passés ignorés
create or replace function push_on_event_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evnew:' || coalesce(new.series_id::text, new.id::text); s event_series; t text; b text;
begin
  if new.cancelled or new.starts_at < now() then return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  if new.series_id is not null then
    select * into s from event_series where id = new.series_id;
    t := 'Nouveaux entraînements';
    b := new.title || ' · chaque ' || (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from new.starts_at at time zone 'Europe/Paris')::int + 1]
         || ' à ' || to_char(new.starts_at at time zone 'Europe/Paris', 'HH24"h"MI') || ', dès le ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM')
         || ' (' || coalesce((select name from clubs where id = new.club_id), '') || ')';
  else
    t := case when new.type in ('Match','Plateau','Tournoi') and cardinality(new.convoked) > 0 then 'Convocation : ' || lower(new.type)
              else 'Nouveau : ' || lower(new.type) end;
    b := push_ev_line(new);
  end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_insert on events;
create trigger push_event_insert after insert on events for each row execute function push_on_event_insert();

-- Annulation, ou changement d'heure ou de lieu d'un rendez-vous à venir (série modifiée d'un coup : une seule notification)
create or replace function push_on_event_update() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text; t text; b text;
begin
  if new.starts_at < now() - interval '1 hour' then return null; end if;
  if new.cancelled and not old.cancelled then
    k := 'evcancel:' || coalesce(new.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), new.id::text);
    t := 'Annulé'; b := push_ev_line(new);
  elsif not new.cancelled and old.cancelled then
    k := 'evback:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := 'De nouveau prévu'; b := push_ev_line(new);
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := case when new.starts_at is distinct from old.starts_at then 'Nouvel horaire' else 'Nouveau lieu' end; b := push_ev_line(new);
  else return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_update on events;
create trigger push_event_update after update of cancelled, starts_at, place on events for each row execute function push_on_event_update();

-- Rendez-vous à venir supprimé : prévenu comme une annulation (suppression d'une série : une seule notification)
create or replace function push_on_event_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evdel:' || coalesce(old.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), old.id::text);
begin
  if old.cancelled or old.starts_at < now() then return old; end if;
  if old.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return old; end if;
  for u in select * from push_event_targets(old.id, auth.uid()) loop
    perform push_enqueue(u, case when old.series_id is not null then 'Séances supprimées' else 'Annulé' end, push_ev_line(old), 'ev:' || old.id, k);
  end loop;
  return old;
end $$;
drop trigger if exists push_event_delete on events;
create trigger push_event_delete before delete on events for each row execute function push_on_event_delete();

-- Annonces officielles, relances des sans-réponse, missions de bénévoles, rappels de cotisation
create or replace function push_on_announcement() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; c text := coalesce((select name from clubs where id = new.club_id), '');
begin
  for u in select * from push_announcement_targets(new.id, coalesce(new.created_by, auth.uid())) loop
    perform push_enqueue(u, new.title, coalesce(nullif(left(new.body, 140), ''), c) || case when new.body <> '' then ' (' || c || ')' else '' end, 'ann:' || new.id, 'ann:' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists push_announcement on announcements;
create trigger push_announcement after insert on announcements for each row execute function push_on_announcement();

-- Messages et sondages des groupes : les membres du groupe, sauf l'auteur et ceux qui ont coupé le groupe.
-- Sur le téléphone, les messages d'un même groupe se remplacent (une seule notification par groupe à l'écran).
create or replace function push_on_message() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups; who text;
begin
  select * into g from groups where id = new.group_id; if g.id is null then return null; end if;
  select coalesce(nullif(nickname, ''), first_name, 'Quelqu''un') into who from profiles where id = new.user_id;
  perform push_enqueue(gm.user_id, g.name, coalesce(who, 'Quelqu''un') || ' : ' || left(new.body, 120), 'grp:' || g.id, 'msg:' || new.id)
    from group_members gm where gm.group_id = g.id and gm.user_id <> new.user_id and not gm.muted
      and exists(select 1 from memberships m where m.club_id = g.club_id and m.user_id = gm.user_id and m.status = 'active');
  return null;
end $$;
drop trigger if exists push_message on messages;
create trigger push_message after insert on messages for each row execute function push_on_message();

create or replace function push_on_poll() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where id = new.group_id; if g.id is null then return null; end if;
  perform push_enqueue(gm.user_id, g.name, 'Nouveau sondage : ' || left(new.question, 120), 'grp:' || g.id, 'poll:' || new.id)
    from group_members gm where gm.group_id = g.id and gm.user_id is distinct from new.created_by and not gm.muted
      and exists(select 1 from memberships m where m.club_id = g.club_id and m.user_id = gm.user_id and m.status = 'active');
  return null;
end $$;
drop trigger if exists push_poll on polls;
create trigger push_poll after insert on polls for each row execute function push_on_poll();

-- Notification d'essai envoyée à soi-même (pour l'étape 5 ; une par minute au plus)
create or replace function push_test() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select count(*) into n from push_subscriptions where user_id = auth.uid();
  if n = 0 then raise exception 'Aucun appareil inscrit : active d''abord les notifications'; end if;
  perform push_enqueue(auth.uid(), 'Essai Pocket Club', 'Les notifications marchent sur cet appareil.', 'test', 'test:' || to_char(now(), 'YYYYMMDDHH24MI'));
  return n;
end $$;
revoke execute on function push_test() from public, anon;
grant execute on function push_test() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Pour la fonction d'envoi (étape 3) : réservé à la clé de service, jamais à l'application
-- ---------------------------------------------------------------------
-- Prend les prochaines notifications à envoyer (moins de 2 jours, 5 essais au plus), une ligne par appareil
create or replace function push_claim(p_limit int default 200) returns table(queue_id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select q.id from push_queue q
    where q.sent_at is null and q.tries < 5 and q.created_at > now() - interval '2 days'
    order by q.created_at limit greatest(1, least(p_limit, 1000)) for update skip locked
  ), upd as (
    update push_queue q set tries = q.tries + 1 from picked where q.id = picked.id returning q.*
  )
  select upd.id, s.endpoint, s.p256dh, s.auth, upd.title, upd.body, upd.url, upd.tag
  from upd join push_subscriptions s on s.user_id = upd.user_id;
end $$;
-- Résultat de l'envoi : envoyées, en erreur, appareils disparus (désinstallés ou notifications coupées : retirés)
create or replace function push_result(p_sent bigint[], p_failed bigint[] default '{}', p_gone text[] default '{}', p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update push_queue set sent_at = now(), last_error = null where id = any(coalesce(p_sent, '{}'));
  update push_queue set last_error = left(coalesce(p_error, 'échec'), 300) where id = any(coalesce(p_failed, '{}')) and sent_at is null;
  delete from push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
end $$;
-- Ménage : notifications envoyées depuis plus de 30 jours, ou jamais envoyées depuis plus de 3 jours
create or replace function push_cleanup() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from push_queue where (sent_at < now() - interval '30 days') or (sent_at is null and created_at < now() - interval '3 days');
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function push_claim(int), push_result(bigint[], bigint[], text[], text), push_cleanup(), push_enqueue(uuid, text, text, text, text, text),
  push_event_targets(uuid, uuid), push_announcement_targets(uuid, uuid), push_as(uuid), push_restore(text, text) from public, anon, authenticated;
do $$ begin
  grant execute on function push_claim(int), push_result(bigint[], bigint[], text[], text), push_cleanup() to service_role;
exception when undefined_object then null; end $$;   -- le rôle service_role n'existe que dans Supabase

-- =====================================================================
-- Pocket Club · alpha 3.3.2 · étape B 4 sur 5 : envoi automatique des notifications (relançable sans risque)
-- À installer APRÈS alpha_3_3.sql.
-- Chaque minute, la base :
--   1. prépare le rappel 72 h avant un rendez-vous, pour ceux qui n'ont pas encore répondu ;
--   2. prépare, à partir de 18 h la veille, le rappel aux bénévoles inscrits sur une mission ;
--   3. vide la corbeille de plus de 30 jours (une fois par jour, à 4 h) ;
--   4. appelle la fonction d'envoi « envoyer-notifications » s'il y a quelque chose à envoyer (et une fois par heure pour le ménage).
-- =====================================================================
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponible ici : %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net indisponible ici : %', sqlerrm; end $$;

-- Adresse de la fonction d'envoi et mot de passe d'appel (lisibles de la base seulement)
create table if not exists push_settings (
  id int primary key default 1 check (id = 1),
  function_url text not null default '',
  secret text not null default ''
);
alter table push_settings enable row level security;
revoke all on push_settings from public, anon, authenticated;
insert into push_settings(id, function_url, secret)
values (1, 'https://rmdszovbpmagtvugfrpr.supabase.co/functions/v1/envoyer-notifications', 'METS_ICI_PUSH_SECRET')
on conflict (id) do update set function_url = excluded.function_url,
  secret = case when excluded.secret = 'METS_ICI_PUSH_SECRET' then push_settings.secret else excluded.secret end;

create or replace function push_tick() returns text language plpgsql security definer set search_path = public as $$
declare e events; u uuid; m record; s push_settings; paris timestamp := now() at time zone 'Europe/Paris'; called boolean := false;
begin
  -- 1. Rappel 72 h avant, à ceux qui n'ont pas encore répondu (une fois par rendez-vous et par personne)
  for e in select * from events where not cancelled and starts_at between now() + interval '70 hours' and now() + interval '72 hours'
           and created_at < now() - interval '12 hours' loop
    foreach u in array coalesce(event_missing(e.id), '{}'::uuid[]) loop
      if not exists(select 1 from event_hidden h where h.event_id = e.id and h.user_id = u) then
        perform push_enqueue(u, 'Ta réponse est attendue', push_ev_line(e), 'ev:' || e.id, 'ev72:' || e.id);
      end if;
    end loop;
  end loop;
  -- 2. Bénévoles : rappel la veille, à partir de 18 h (heure de Paris)
  if extract(hour from paris) >= 18 then
    for m in select ms.user_id, em.id as mission_id, em.label, ev as evrow
             from mission_signups ms join event_missions em on em.id = ms.mission_id join events ev on ev.id = em.event_id
             where not ev.cancelled and (ev.starts_at at time zone 'Europe/Paris')::date = paris::date + 1 loop
      perform push_enqueue(m.user_id, 'Demain, tu es ' || lower(m.label), push_ev_line(m.evrow), 'ev:' || (m.evrow).id, 'benev:' || m.mission_id || ':' || m.user_id);
    end loop;
  end if;
  -- 3. Corbeille de plus de 30 jours, une fois par jour
  if to_char(paris, 'HH24MI') = '0400' then
    begin perform purge_trash(); exception when others then raise notice 'corbeille : %', sqlerrm; end;
  end if;
  -- 4. Appel de la fonction d'envoi
  select * into s from push_settings where id = 1;
  if s.function_url <> '' and s.secret not in ('', 'METS_ICI_PUSH_SECRET')
     and (extract(minute from paris) = 0 or exists(select 1 from push_queue where sent_at is null and tries < 5 and created_at > now() - interval '2 days')) then
    perform net.http_post(url := s.function_url, body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-pocket-secret', s.secret), timeout_milliseconds := 30000);
    called := true;
  end if;
  return case when called then 'envoi demandé' else 'rien à envoyer' end;
end $$;
revoke execute on function push_tick() from public, anon, authenticated;

-- Programme automatique : chaque minute
do $$ begin
  begin perform cron.unschedule('pocket-notifications'); exception when others then null; end;
  perform cron.schedule('pocket-notifications', '* * * * *', 'select public.push_tick()');
exception when others then raise notice 'programme automatique non créé ici : %', sqlerrm; end $$;

-- =====================================================================
-- Pocket Club · alpha 3.4 · convocations inter-clubs en PDF (mise à jour relançable sans risque)
-- À installer APRÈS alpha_3_3_2.sql.
--   1. « Nous recevons » sur un match, un plateau ou un tournoi (rencontre à domicile)
--   2. Correction : les joueurs choisis (convocation) et « Nous recevons » sont enregistrés dès la création
--      (avant, les joueurs choisis n'étaient gardés qu'en modifiant le rendez-vous)
--   3. Données de la convocation d'un week-end : le club qui reçoit, son contact « planification des matchs »,
--      les rencontres à domicile du week-end, le coach de chaque équipe. Réservé à la rubrique Événements
--      (coordinateur, vice-président, président).
-- =====================================================================
alter table events add column if not exists at_home boolean not null default true;

create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true)
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Données de la convocation du week-end d'un rendez-vous (samedi + dimanche ; en semaine : ce jour-là seulement)
create or replace function convocation_data(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events; c clubs; d date; d0 date; d1 date; dw int;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'La convocation est réservée au coordinateur, au vice-président et au président'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'La convocation vaut pour un match, un plateau ou un tournoi'; end if;
  d := (e.starts_at at time zone 'Europe/Paris')::date; dw := extract(isodow from d)::int;
  if dw >= 6 then d0 := d - (dw - 6); d1 := d0 + 1; else d0 := d; d1 := d; end if;
  select * into c from clubs where id = e.club_id;
  return jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'color1', c.color1, 'color2', c.color2, 'logo', c.logo, 'crest_bg', c.crest_bg),
    'from', d0, 'to', d1,
    'correspondent', (select jsonb_build_object('name', p.full_name, 'phone', case when k.show_phone then nullif(p.phone, '') end, 'email', case when k.show_email then u.email end)
                      from club_contacts k join profiles p on p.id = k.user_id join auth.users u on u.id = k.user_id
                      join memberships m on m.user_id = k.user_id and m.club_id = k.club_id and m.status = 'active' and m.role in ('president','bureau')
                      where k.club_id = c.id and k.for_matches order by k.updated_at limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'type', x.type, 'title', x.title, 'starts_at', x.starts_at, 'place', x.place, 'opponents', x.opponents, 'cancelled', x.cancelled,
        'team', (select jsonb_build_object('name', t.name, 'category', t.category, 'gender', t.gender) from teams t where t.id = any(x.team_ids) and t.deleted_at is null order by t.name limit 1),
        'coach', (select jsonb_build_object('name', p.full_name, 'phone', nullif(p.phone, ''), 'email', u.email)
                  from memberships m join profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id
                  where m.club_id = x.club_id and m.role = 'coach' and m.status = 'active' and m.team_id = any(x.team_ids) order by p.full_name limit 1))
        order by x.starts_at, x.title)
      from events x where x.club_id = e.club_id and x.at_home and x.type in ('Match','Plateau','Tournoi') and x.audience = 'team'
        and (x.starts_at at time zone 'Europe/Paris')::date between d0 and d1), '[]'::jsonb));
end $$;
revoke execute on function convocation_data(uuid) from public, anon;
grant execute on function convocation_data(uuid) to authenticated;

-- =====================================================================
-- Pocket Club · alpha 3.4.1 (mise à jour relançable sans risque) · n° 59 à 68
-- À installer APRÈS alpha_3_4.sql.
--   n° 59 : un compte qui n'a que le rôle supporteur (dont un membre du bureau en attente de validation) ne répond pas
--           aux rendez-vous ; il n'est prévenu que des rendez-vous publics du club et des matchs des équipes qu'il suit
--   n° 62 : notification pour chaque demande à valider ; un téléphone peut rester inscrit pour plusieurs comptes de test
--   n° 66 : « Nouveau match prévu » ; « On cherche des bénévoles » ; option « Je participe au bénévolat du club »
--   n° 67 : relance des bénévoles vers tout le club, des équipes ou des personnes choisies (une fois toutes les 12 heures)
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 59 · réponses : jamais pour un compte qui n'est que supporteur (sauf invitation nominative)
-- ---------------------------------------------------------------------
create or replace function has_real_role(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role <> 'supporteur');
$$;
revoke execute on function has_real_role(uuid, uuid) from public, anon;

create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid() and deleted_at is null)) then
      raise exception 'Ce joueur n''est pas relié à ton compte';
    end if;
    if cardinality(e.convoked) > 0 and not p_player = any(e.convoked) then raise exception 'Ce joueur n''est pas convoqué à ce rendez-vous'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if not has_real_role(e.club_id, auth.uid()) and not (e.audience = 'people' and auth.uid() = any(e.people)) then
      raise exception 'Un supporteur n''a pas de réponse à donner (ou ta demande attend la validation du club)';
    end if;
    if e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
       and not exists(select 1 from memberships where team_id = any(e.team_ids) and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and deleted_at is null and team_id = any(e.team_ids)) then
      raise exception 'Tu encadres cette équipe : pas de réponse pour toi-même';
    end if;
    if e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi') and not exists(select 1 from unnest(e.team_ids) t where in_team(t)) then
      raise exception 'Ce rendez-vous concerne une équipe dont tu ne fais pas partie';
    end if;
    if cardinality(e.convoked) > 0 and not exists(select 1 from players x where x.user_id = auth.uid() and x.id = any(e.convoked)) then
      raise exception 'Tu n''es pas convoqué à ce rendez-vous';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- Notifications de rendez-vous : un compte qui n'est que supporteur n'est prévenu que des rendez-vous de tout le club et des matchs des équipes qu'il suit
create or replace function push_event_targets(eid uuid, actor uuid) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into e from events where id = eid; if e.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = e.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_event(eid)
       and (has_real_role(e.club_id, u) or e.audience = 'club' or (e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids)) or u = any(e.people))
       and not exists(select 1 from event_hidden h where h.event_id = eid and h.user_id = u)
       and (cardinality(e.convoked) = 0 or is_board(e.club_id) or coaches_any(e.team_ids) or e.created_by = u
            or exists(select 1 from players p where p.id = any(e.convoked) and p.deleted_at is null
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))
            or not exists(select 1 from players p where p.deleted_at is null and p.club_id = e.club_id
                      and (p.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(e.team_ids)))
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))) then
      return next u;
    end if;
  end loop;
  perform push_restore(sub0, uid0);
end $$;

-- N° 66 · texte : « U13 contre Étampes · sam. 14/11 à 14h00 · Gymnase (Club) »
create or replace function push_ev_line(e events) returns text language sql stable set search_path = public as $$
  select e.title
         || case when e.opponents <> '' and position(lower(e.opponents) in lower(e.title)) = 0 then ' contre ' || e.opponents else '' end
         || ' · ' || push_when(e.starts_at) || case when e.place <> '' then ' · ' || e.place else '' end
         || ' (' || coalesce((select name from clubs where id = e.club_id), '') || ')';
$$;
create or replace function push_on_event_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evnew:' || coalesce(new.series_id::text, new.id::text); t text; b text;
begin
  if new.cancelled or new.starts_at < now() then return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  if new.series_id is not null then
    t := 'Nouveaux entraînements';
    b := new.title || ' · chaque ' || (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from new.starts_at at time zone 'Europe/Paris')::int + 1]
         || ' à ' || to_char(new.starts_at at time zone 'Europe/Paris', 'HH24"h"MI') || ', dès le ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM')
         || ' (' || coalesce((select name from clubs where id = new.club_id), '') || ')';
  else
    t := case when new.type in ('Match','Plateau','Tournoi') and cardinality(new.convoked) > 0 then 'Convocation : ' || lower(new.type)
              when new.type in ('Match','Plateau','Tournoi') then 'Nouveau ' || lower(new.type) || ' prévu'
              else 'Nouveau : ' || lower(new.type) end;
    b := push_ev_line(new);
  end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- N° 62 · un téléphone peut rester inscrit pour plusieurs comptes (option des comptes de test) ;
--         la notification porte alors le nom du profil
-- ---------------------------------------------------------------------
alter table push_subscriptions add column if not exists label text not null default '';
do $$ begin
  if exists(select 1 from pg_constraint where conname = 'push_subscriptions_pkey' and conrelid = 'push_subscriptions'::regclass and array_length(conkey, 1) = 1) then
    alter table push_subscriptions drop constraint push_subscriptions_pkey;
    alter table push_subscriptions add primary key (endpoint, user_id);
  end if;
end $$;
drop function if exists push_subscribe(text, text, text, text);
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_agent text default '', p_keep boolean default false, p_label text default '') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Adresse d''envoi invalide'; end if;
  if not coalesce(p_keep, false) then delete from push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid(); end if;
  insert into push_subscriptions(endpoint, user_id, p256dh, auth, agent, label)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_agent, ''), 200), left(coalesce(p_label, ''), 30))
  on conflict (endpoint, user_id) do update set p256dh = excluded.p256dh, auth = excluded.auth, agent = excluded.agent, label = excluded.label, last_seen_at = now();
  update push_subscriptions set p256dh = p_p256dh, auth = p_auth where endpoint = p_endpoint;
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by last_seen_at desc offset 10);
  return true;
end $$;
revoke execute on function push_subscribe(text, text, text, text, boolean, text) from public, anon;
grant execute on function push_subscribe(text, text, text, text, boolean, text) to authenticated;

create or replace function push_claim(p_limit int default 200) returns table(queue_id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select q.id from push_queue q
    where q.sent_at is null and q.tries < 5 and q.created_at > now() - interval '2 days'
    order by q.created_at limit greatest(1, least(p_limit, 1000)) for update skip locked
  ), upd as (
    update push_queue q set tries = q.tries + 1 from picked where q.id = picked.id returning q.*
  )
  select upd.id, s.endpoint, s.p256dh, s.auth,
         case when s.label <> '' and (select count(*) from push_subscriptions s2 where s2.endpoint = s.endpoint) > 1 then left(s.label || ' · ' || upd.title, 80) else upd.title end,
         upd.body, upd.url, upd.tag
  from upd join push_subscriptions s on s.user_id = upd.user_id;
end $$;
revoke execute on function push_claim(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- N° 62 · demandes à valider : prévenir ceux qui peuvent valider (vérifié à la fin de la transaction,
--         pour ne rien envoyer quand la demande est acceptée d'office)
-- ---------------------------------------------------------------------
create or replace function push_on_join() returns trigger language plpgsql security definer set search_path = public as $$
declare m memberships; u uuid; who text; what text; cname text; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into m from memberships where id = new.id;
  if m.id is null or m.status <> 'pending' then return null; end if;
  select coalesce(nullif(full_name, ''), 'Quelqu''un') into who from profiles where id = m.user_id;
  select name into cname from clubs where id = m.club_id;
  what := case m.role when 'parent' then 'parent de joueur' when 'bureau' then lower(coalesce(m.fonction, 'membre du bureau')) else m.role end
          || coalesce(' ' || (select name from teams where id = m.team_id), '');
  for u in select distinct mm.user_id from memberships mm join push_subscriptions s on s.user_id = mm.user_id
           where mm.club_id = m.club_id and mm.status = 'active' and mm.user_id <> m.user_id loop
    perform push_as(u);
    if can_validate(m.id) then
      perform push_enqueue(u, 'Demande à valider', coalesce(who, 'Quelqu''un') || ' : ' || what || ' (' || coalesce(cname, '') || ')', 'join:' || m.club_id, 'join:' || m.id);
    end if;
  end loop;
  perform push_restore(sub0, uid0);
  return null;
end $$;
drop trigger if exists push_join on memberships;
create constraint trigger push_join after insert on memberships deferrable initially deferred for each row execute function push_on_join();

-- ---------------------------------------------------------------------
-- N° 66 · « Je participe au bénévolat du club » (coché par défaut) ; le coordinateur et le président sont prévenus d'un changement
-- ---------------------------------------------------------------------
alter table profiles add column if not exists volunteer boolean not null default true;
create or replace function set_volunteer(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  update profiles set volunteer = coalesce(p_on, true) where id = auth.uid();
end $$;
revoke execute on function set_volunteer(boolean) from public, anon;
grant execute on function set_volunteer(boolean) to authenticated;
create or replace function push_on_volunteer() returns trigger language plpgsql security definer set search_path = public as $$
declare c record; u uuid; who text := coalesce(nullif(new.full_name, ''), 'Un membre');
begin
  if new.volunteer is not distinct from old.volunteer then return null; end if;
  for c in select distinct m.club_id, cl.name from memberships m join clubs cl on cl.id = m.club_id where m.user_id = new.id and m.status = 'active' and m.role <> 'supporteur' loop
    for u in select distinct mm.user_id from memberships mm where mm.club_id = c.club_id and mm.status = 'active' and mm.user_id <> new.id and 'evenements' = any(areas_of(c.club_id, mm.user_id)) loop
      perform push_enqueue(u, 'Bénévolat', who || case when new.volunteer then ' participe de nouveau au bénévolat du club' else ' ne souhaite plus être sollicité pour le bénévolat' end || ' (' || c.name || ')',
                           'vol:' || new.id, 'vol:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
    end loop;
  end loop;
  return null;
end $$;
drop trigger if exists push_volunteer on profiles;
create trigger push_volunteer after update of volunteer on profiles for each row execute function push_on_volunteer();
-- Liste des personnes qui ne souhaitent pas être sollicitées : rubrique Événements seulement (coordinateur, vice-président, président)
create or replace function volunteer_optouts(p_club uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select case when has_area(p_club, 'evenements') then coalesce(array_agg(distinct p.id), '{}') else '{}' end
  from profiles p join memberships m on m.user_id = p.id and m.club_id = p_club and m.status = 'active' where not p.volunteer;
$$;
revoke execute on function volunteer_optouts(uuid) from public, anon;
grant execute on function volunteer_optouts(uuid) to authenticated;

-- Peut être bénévole sur ce rendez-vous : règle du n° 53, plus toute personne relancée nominativement ou par équipe pour ce rendez-vous
create or replace function can_volunteer(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and not e.cancelled and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active') and (
    exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach'))
    or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and x.birth_date is not null and x.birth_date <= current_date - interval '18 years'
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and u = any(a.people))));
$$;

-- « On cherche des bénévoles » : une notification par rendez-vous dès qu'il a des missions (vérifié à la fin de la transaction)
create or replace function push_on_missions() returns trigger language plpgsql security definer set search_path = public as $$
declare e events; u uuid; n int; free int; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true); actor uuid := auth.uid();
begin
  select * into e from events where id = new.event_id;
  if e.id is null or e.cancelled or e.starts_at < now() then return null; end if;
  if exists(select 1 from push_queue where dedupe_key = 'benev:' || e.id) then return null; end if;
  select count(*), coalesce(sum(greatest(0, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id))), 0) into n, free from event_missions m where m.event_id = e.id;
  if free = 0 then return null; end if;
  for u in select distinct mm.user_id from memberships mm join push_subscriptions s on s.user_id = mm.user_id join profiles p on p.id = mm.user_id
           where mm.club_id = e.club_id and mm.status = 'active' and mm.user_id is distinct from actor and p.volunteer loop
    perform push_as(u);
    if sees_event(e.id) and can_volunteer(e.id, u)
       and not exists(select 1 from mission_signups s join event_missions m on m.id = s.mission_id where m.event_id = e.id and s.user_id = u) then
      perform push_enqueue(u, 'On cherche des bénévoles', e.title || ' · ' || push_when(e.starts_at) || ' · ' || n || case when n > 1 then ' missions à pourvoir' else ' mission à pourvoir' end,
                           'ev:' || e.id, 'benev:' || e.id);
    end if;
  end loop;
  perform push_restore(sub0, uid0);
  return null;
end $$;
drop trigger if exists push_missions on event_missions;
create constraint trigger push_missions after insert on event_missions deferrable initially deferred for each row execute function push_on_missions();

-- ---------------------------------------------------------------------
-- N° 67 · relance des bénévoles : le rendez-vous (comme avant), tout le club, des équipes, des personnes choisies
-- ---------------------------------------------------------------------
alter table events add column if not exists missions_reminded_at timestamptz;
create or replace function events_missions_guard() returns trigger language plpgsql as $$
begin
  if new.missions_reminded_at is distinct from old.missions_reminded_at and coalesce(current_setting('pc.mremind', true), '') <> 'on' then new.missions_reminded_at := old.missions_reminded_at; end if;
  return new;
end $$;
drop trigger if exists events_missions_guard on events;
create trigger events_missions_guard before update on events for each row execute function events_missions_guard();

-- Adulte du club qui peut aider : bureau, coach, parent d'un joueur, joueur majeur (jamais un supporteur seul ni un joueur mineur)
create or replace function club_helper(c uuid, u uuid, ts uuid[] default null) returns boolean language sql stable security definer set search_path = public as $$
  select not exists(select 1 from players x where x.user_id = u and x.club_id = c and x.deleted_at is null and (x.birth_date is null or x.birth_date > current_date - interval '18 years'))
    and (
      (ts is null and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach')))
      or (ts is not null and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'coach' and m.team_id = any(ts)))
      or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = c
                and (ts is null or x.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(ts))))
      or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = c and x.birth_date <= current_date - interval '18 years'
                and (ts is null or x.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(ts)))));
$$;
revoke execute on function club_helper(uuid, uuid, uuid[]) from public, anon, authenticated;

drop function if exists remind_missions(uuid);
create or replace function remind_missions(p_event uuid, p_target text default 'event', p_teams uuid[] default null, p_people uuid[] default null) returns text
language plpgsql security definer set search_path = public as $$
declare e events; txt text; who uuid[];
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur relance'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est passé ou annulé'; end if;
  if e.missions_reminded_at > now() - interval '12 hours' then raise exception 'Relance des bénévoles déjà faite il y a moins de 12 heures'; end if;
  if coalesce(p_target, 'event') not in ('event','club','teams','people') then raise exception 'Cible inconnue'; end if;
  select string_agg(n || ' ' || lower(label), ', ' order by position) into txt from (
    select m.label, m.position, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id) n from event_missions m where m.event_id = p_event) z where n > 0;
  if txt is null then raise exception 'Toutes les missions sont pourvues'; end if;
  if p_target = 'teams' and (p_teams is null or cardinality(p_teams) = 0 or exists(select 1 from unnest(p_teams) t where not exists(select 1 from teams x where x.id = t and x.club_id = e.club_id and x.deleted_at is null))) then
    raise exception 'Choisis une ou plusieurs équipes du club';
  end if;
  if p_target = 'people' and (p_people is null or cardinality(p_people) = 0) then raise exception 'Choisis au moins une personne'; end if;
  select array_agg(distinct m.user_id) into who
  from memberships m join profiles p on p.id = m.user_id
  where m.club_id = e.club_id and m.status = 'active' and m.user_id <> auth.uid()
    and not exists(select 1 from mission_signups s join event_missions mi on mi.id = s.mission_id where mi.event_id = e.id and s.user_id = m.user_id)
    and case coalesce(p_target, 'event')
      when 'event' then p.volunteer and can_volunteer(e.id, m.user_id) and club_helper(e.club_id, m.user_id)
      when 'club' then p.volunteer and club_helper(e.club_id, m.user_id)
      when 'teams' then p.volunteer and club_helper(e.club_id, m.user_id, p_teams)
      else m.user_id = any(p_people) and club_helper(e.club_id, m.user_id) end;
  if who is null or cardinality(who) = 0 then raise exception 'Personne à relancer pour cette cible (déjà inscrits, mineurs, supporteurs ou bénévolat décoché)'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, event_id, title, body)
    values (e.club_id, 'people', who[1:500], 'missions', e.id,
            'Il manque ' || txt || ' pour ' || e.title,
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Ouvre le rendez-vous pour t''inscrire.');
  perform set_config('pc.announce', 'off', true);
  perform set_config('pc.mremind', 'on', true);
  update events set missions_reminded_at = now() where id = e.id;
  perform set_config('pc.mremind', 'off', true);
  insert into action_log(club_id, actor, action, detail)
    values (e.club_id, auth.uid(), 'relance_benevoles', jsonb_build_object('event', e.id, 'titre', e.title, 'cible', coalesce(p_target, 'event'), 'personnes', cardinality(who)));
  return txt;
end $$;
revoke execute on function remind_missions(uuid, text, uuid[], uuid[]) from public, anon;
grant execute on function remind_missions(uuid, text, uuid[], uuid[]) to authenticated;

-- N° 67 : une personne relancée pour les bénévoles d'un rendez-vous le voit, pour pouvoir s'inscrire
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or e.audience = 'club'
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team(t)))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and auth.uid() = any(a.people))));
$$;

-- =====================================================================
-- Pocket Club · alpha 3.4.2 (relançable sans risque) · n° 69 à 74 · À installer APRÈS alpha_3_4_1.sql.
--   n° 70 : réglage « Les supporteurs peuvent être bénévoles » (président, rubrique Événements) ; réponse du supporteur
--   n° 72 : l'appel et la convocation sont réservés aux coachs de l'équipe et au président
--   n° 73 : seul le retrait du bénévolat d'un membre (hors supporteurs) prévient le coordinateur et le président
--   n° 74 : compteurs des bénévoles (rubrique Événements)
-- =====================================================================
alter table clubs add column if not exists supporters_volunteer boolean not null default false;
alter table profiles add column if not exists supporter_volunteer boolean;   -- null = pas encore répondu

-- Le club ouvre ou ferme le bénévolat aux supporteurs (inscrit au journal) ; à l'ouverture, les supporteurs revoient l'encart une fois
create or replace function set_supporters_volunteer(p_club uuid, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_area(p_club, 'evenements') then raise exception 'Réglage réservé au président et au coordinateur'; end if;
  if (select supporters_volunteer from clubs where id = p_club) = coalesce(p_on, false) then return; end if;
  update clubs set supporters_volunteer = coalesce(p_on, false) where id = p_club;
  if p_on then
    update profiles p set supporter_volunteer = null where p.supporter_volunteer is false
      and exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p.id and m.status = 'active') and not has_real_role(p_club, p.id);
  end if;
  insert into action_log(club_id, actor, action, detail) values (p_club, auth.uid(), 'benevolat_supporteurs', jsonb_build_object('ouvert', coalesce(p_on, false)));
end $$;
create or replace function set_supporter_volunteer(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  update profiles set supporter_volunteer = p_on where id = auth.uid();
end $$;
revoke execute on function set_supporters_volunteer(uuid, boolean), set_supporter_volunteer(boolean) from public, anon;
grant execute on function set_supporters_volunteer(uuid, boolean), set_supporter_volunteer(boolean) to authenticated;

-- Mineur du club (fiche joueur de moins de 18 ans, ou date de naissance inconnue) : jamais bénévole
create or replace function is_minor_in(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.user_id = u and x.club_id = c and x.deleted_at is null and (x.birth_date is null or x.birth_date > current_date - interval '18 years'));
$$;
-- Supporteur qui peut aider sur ce rendez-vous : club ouvert, majeur, événement de tout le club ou match d'une équipe suivie
create or replace function supporter_can_help(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e join clubs c on c.id = e.club_id where e.id = eid and c.supporters_volunteer
    and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active')
    and not has_real_role(e.club_id, u) and not is_minor_in(e.club_id, u)
    and (e.audience = 'club' or (e.type in ('Match','Plateau','Tournoi') and exists(select 1 from team_follows f where f.user_id = u and f.team_id = any(e.team_ids)))));
$$;
-- Souhaite être sollicité : membre (option, cochée par défaut) ou supporteur qui a répondu oui
create or replace function wants_volunteer(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case when has_real_role(c, u) then coalesce((select volunteer from profiles where id = u), true)
              else coalesce((select supporter_volunteer from profiles where id = u), false) end;
$$;
revoke execute on function is_minor_in(uuid, uuid), supporter_can_help(uuid, uuid), wants_volunteer(uuid, uuid) from public, anon, authenticated;

create or replace function can_volunteer(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and not e.cancelled and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active') and (
    exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach'))
    or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and x.birth_date is not null and x.birth_date <= current_date - interval '18 years'
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or (has_real_role(e.club_id, u) and exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and u = any(a.people)))
    or supporter_can_help(e.id, u)));
$$;

-- Relances : les supporteurs comptent quand le club leur ouvre le bénévolat (tout le club ; équipes suivies ; nominatif)
create or replace function club_helper(c uuid, u uuid, ts uuid[] default null) returns boolean language sql stable security definer set search_path = public as $$
  select not is_minor_in(c, u)
    and (
      (ts is null and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach')))
      or (ts is not null and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'coach' and m.team_id = any(ts)))
      or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = c
                and (ts is null or x.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(ts))))
      or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = c and x.birth_date <= current_date - interval '18 years'
                and (ts is null or x.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(ts))))
      or ((select supporters_volunteer from clubs where id = c) and not has_real_role(c, u)
          and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active')
          and (ts is null or exists(select 1 from team_follows f where f.user_id = u and f.team_id = any(ts)))));
$$;
revoke execute on function club_helper(uuid, uuid, uuid[]) from public, anon, authenticated;

create or replace function remind_missions(p_event uuid, p_target text default 'event', p_teams uuid[] default null, p_people uuid[] default null) returns text
language plpgsql security definer set search_path = public as $$
declare e events; txt text; who uuid[];
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur relance'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est passé ou annulé'; end if;
  if e.missions_reminded_at > now() - interval '12 hours' then raise exception 'Relance des bénévoles déjà faite il y a moins de 12 heures'; end if;
  if coalesce(p_target, 'event') not in ('event','club','teams','people') then raise exception 'Cible inconnue'; end if;
  select string_agg(n || ' ' || lower(label), ', ' order by position) into txt from (
    select m.label, m.position, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id) n from event_missions m where m.event_id = p_event) z where n > 0;
  if txt is null then raise exception 'Toutes les missions sont pourvues'; end if;
  if p_target = 'teams' and (p_teams is null or cardinality(p_teams) = 0 or exists(select 1 from unnest(p_teams) t where not exists(select 1 from teams x where x.id = t and x.club_id = e.club_id and x.deleted_at is null))) then
    raise exception 'Choisis une ou plusieurs équipes du club';
  end if;
  if p_target = 'people' and (p_people is null or cardinality(p_people) = 0) then raise exception 'Choisis au moins une personne'; end if;
  select array_agg(distinct m.user_id) into who
  from memberships m
  where m.club_id = e.club_id and m.status = 'active' and m.user_id <> auth.uid()
    and not exists(select 1 from mission_signups s join event_missions mi on mi.id = s.mission_id where mi.event_id = e.id and s.user_id = m.user_id)
    and case coalesce(p_target, 'event')
      when 'event' then wants_volunteer(e.club_id, m.user_id) and can_volunteer(e.id, m.user_id) and club_helper(e.club_id, m.user_id)
      when 'club' then wants_volunteer(e.club_id, m.user_id) and club_helper(e.club_id, m.user_id)
      when 'teams' then wants_volunteer(e.club_id, m.user_id) and club_helper(e.club_id, m.user_id, p_teams)
      else m.user_id = any(p_people) and club_helper(e.club_id, m.user_id) end;
  if who is null or cardinality(who) = 0 then raise exception 'Personne à relancer pour cette cible (déjà inscrits, mineurs, supporteurs ou bénévolat décoché)'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, event_id, title, body)
    values (e.club_id, 'people', who[1:500], 'missions', e.id, 'Il manque ' || txt || ' pour ' || e.title,
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Ouvre le rendez-vous pour t''inscrire.');
  perform set_config('pc.announce', 'off', true);
  perform set_config('pc.mremind', 'on', true);
  update events set missions_reminded_at = now() where id = e.id;
  perform set_config('pc.mremind', 'off', true);
  insert into action_log(club_id, actor, action, detail)
    values (e.club_id, auth.uid(), 'relance_benevoles', jsonb_build_object('event', e.id, 'titre', e.title, 'cible', coalesce(p_target, 'event'), 'personnes', cardinality(who)));
  return txt;
end $$;

-- « On cherche des bénévoles » : membres qui ont gardé l'option, supporteurs qui ont dit oui
create or replace function push_on_missions() returns trigger language plpgsql security definer set search_path = public as $$
declare e events; u uuid; n int; free int; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true); actor uuid := auth.uid();
begin
  select * into e from events where id = new.event_id;
  if e.id is null or e.cancelled or e.starts_at < now() then return null; end if;
  if exists(select 1 from push_queue where dedupe_key = 'benev:' || e.id) then return null; end if;
  select count(*), coalesce(sum(greatest(0, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id))), 0) into n, free from event_missions m where m.event_id = e.id;
  if free = 0 then return null; end if;
  for u in select distinct mm.user_id from memberships mm join push_subscriptions s on s.user_id = mm.user_id
           where mm.club_id = e.club_id and mm.status = 'active' and mm.user_id is distinct from actor loop
    perform push_as(u);
    if wants_volunteer(e.club_id, u) and sees_event(e.id) and can_volunteer(e.id, u)
       and not exists(select 1 from mission_signups s join event_missions m on m.id = s.mission_id where m.event_id = e.id and s.user_id = u) then
      perform push_enqueue(u, 'On cherche des bénévoles', e.title || ' · ' || push_when(e.starts_at) || ' · ' || n || case when n > 1 then ' missions à pourvoir' else ' mission à pourvoir' end,
                           'ev:' || e.id, 'benev:' || e.id);
    end if;
  end loop;
  perform push_restore(sub0, uid0);
  return null;
end $$;

-- N° 73 : seul un retrait prévient, et seulement pour un membre (hors supporteurs)
create or replace function push_on_volunteer() returns trigger language plpgsql security definer set search_path = public as $$
declare c record; u uuid; who text := coalesce(nullif(new.full_name, ''), 'Un membre');
begin
  if new.volunteer is not distinct from old.volunteer or new.volunteer then return null; end if;
  for c in select distinct m.club_id, cl.name from memberships m join clubs cl on cl.id = m.club_id where m.user_id = new.id and m.status = 'active' and m.role <> 'supporteur' loop
    for u in select distinct mm.user_id from memberships mm where mm.club_id = c.club_id and mm.status = 'active' and mm.user_id <> new.id and 'evenements' = any(areas_of(c.club_id, mm.user_id)) loop
      perform push_enqueue(u, 'Bénévolat', who || ' ne souhaite plus être sollicité pour le bénévolat (' || c.name || ')', 'vol:' || new.id, 'vol:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
    end loop;
  end loop;
  return null;
end $$;

-- N° 74 : compteurs des bénévoles (rubrique Événements) ; listes de noms pour le coordinateur et le président
create or replace function volunteer_stats(p_club uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_area(p_club, 'evenements') then raise exception 'Réservé au président et au coordinateur'; end if;
  with u as (
    select distinct m.user_id, p.volunteer, p.supporter_volunteer, has_real_role(p_club, m.user_id) as real,
      case when exists(select 1 from memberships x where x.club_id = p_club and x.user_id = m.user_id and x.status = 'active' and x.role in ('president','bureau')) then 'bureau'
           when exists(select 1 from memberships x where x.club_id = p_club and x.user_id = m.user_id and x.status = 'active' and x.role = 'coach') then 'coachs'
           when exists(select 1 from player_parents pp join players y on y.id = pp.player_id where pp.user_id = m.user_id and y.club_id = p_club and y.deleted_at is null) then 'parents'
           else 'joueurs majeurs' end as cat
    from memberships m join profiles p on p.id = m.user_id
    where m.club_id = p_club and m.status = 'active' and not is_minor_in(p_club, m.user_id))
  select jsonb_build_object(
    'members', jsonb_build_object(
      'yes', coalesce((select jsonb_agg(user_id) from u where real and volunteer), '[]'),
      'no', coalesce((select jsonb_agg(user_id) from u where real and not volunteer), '[]'),
      'cats', coalesce((select jsonb_object_agg(cat, jsonb_build_array(y, n)) from (select cat, count(*) filter (where volunteer) y, count(*) filter (where not volunteer) n from u where real group by cat) z), '{}')),
    'supporters', case when (select supporters_volunteer from clubs where id = p_club) then jsonb_build_object(
      'yes', coalesce((select jsonb_agg(user_id) from u where not real and supporter_volunteer), '[]'),
      'no', coalesce((select jsonb_agg(user_id) from u where not real and supporter_volunteer is false), '[]'),
      'none', coalesce((select jsonb_agg(user_id) from u where not real and supporter_volunteer is null), '[]')) end) into r;
  return r;
end $$;
revoke execute on function volunteer_stats(uuid) from public, anon;
grant execute on function volunteer_stats(uuid) to authenticated;

-- N° 72 : appel et convocation réservés aux coachs de l'équipe (principal ou assistant) et au président
create or replace function can_call_roll(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and (is_president(e.club_id) or (e.audience = 'team' and coaches_any(e.team_ids))));
$$;
drop policy if exists "appel fait par l'encadrement" on attendance;
create policy "appel fait par l'encadrement" on attendance for all using (can_call_roll(event_id) and can_manage_player(player_id))
  with check (can_call_roll(event_id) and can_manage_player(player_id) and sees_event(event_id));
create or replace function events_convoke_rights() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- administrateur de la base
  if (tg_op = 'INSERT' and cardinality(new.convoked) > 0) or (tg_op = 'UPDATE' and new.convoked is distinct from old.convoked) then
    if not (is_president(new.club_id) or (new.audience = 'team' and coaches_all(new.team_ids))) then
      raise exception 'La convocation est faite par le coach de l''équipe (ou le président)';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists events_convoke_rights on events;
create trigger events_convoke_rights before insert or update on events for each row execute function events_convoke_rights();

-- =====================================================================
-- Pocket Club · alpha 3.5.0 (mise à jour relançable sans risque) · nouveau look, appel en tuiles, n° 75 à 81
-- À installer APRÈS alpha_3_4_2.sql.
--   n° 75 : « Avez-vous vérifié vos heures ? » (président et trésorerie → coachs), heures figées après « C'est bon »
--   n° 76 : ordre des blocs de chaque espace, propre à chaque personne (préférences du compte)
--   n° 77 : score en fin de match, plateau ou tournoi (coach de l'équipe ou président), notification « Résultat »
--   n° 78 : équipe en entente avec un autre club (demande, invitation, joueurs du club partenaire hors trésorerie)
--   n° 80 : durée d'un rendez-vous (15 min à 6 h, ou toute la journée)
--   n° 81 : appel en tuiles : heure d'arrivée d'un retard ; statistique « sans réponse mais venu »
-- (n° 79, réponse pour toute la famille, ne demande rien à la base : la réponse d'un enfant est déjà commune aux deux parents.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 81 · appel : heure d'arrivée d'un retard
-- ---------------------------------------------------------------------
alter table attendance add column if not exists arrived_at timestamptz;

-- Statistiques : on garde la réponse au sondage et l'état final ; ajout de « sans réponse mais venu »
drop function if exists team_stats(uuid, date, date);
create function team_stats(p_team uuid, p_from date, p_to date)
returns table(player_id uuid, first_name text, last_name text, sessions int, present int, late int, absent int, answered int, yes_absent int, no_present int, unanswered_present int)
language sql stable security definer set search_path = public as $$
  select t.player_id, t.first_name, t.last_name,
    count(t.status)::int,
    count(*) filter (where t.status = 'present')::int,
    count(*) filter (where t.status = 'retard')::int,
    count(*) filter (where t.status = 'absent')::int,
    count(*) filter (where t.status is not null and t.answer is not null)::int,
    count(*) filter (where t.status = 'absent' and t.answer = 'oui')::int,
    count(*) filter (where t.status in ('present','retard') and t.answer = 'non')::int,
    count(*) filter (where t.status in ('present','retard') and t.answer is null)::int
  from team_attendance(p_team, p_from, p_to) t
  group by t.player_id, t.first_name, t.last_name
  order by t.last_name, t.first_name;
$$;

-- ---------------------------------------------------------------------
-- N° 80 · durée d'un rendez-vous et heure de fin
-- ---------------------------------------------------------------------
alter table events add column if not exists duration_min int;
alter table events add column if not exists all_day boolean not null default false;
do $$ begin
  alter table events add constraint events_duration_ok check (duration_min is null or (duration_min between 15 and 360 and duration_min % 15 = 0));
exception when duplicate_object then null; end $$;
-- Reprise sans perte : les rendez-vous déjà créés reçoivent la durée par défaut de leur type
update events set duration_min = case type when 'Entraînement' then 90 when 'Match' then 120 when 'Plateau' then 180 when 'Tournoi' then 360 else 120 end
  where duration_min is null and not all_day;

create or replace function push_ev_line(e events) returns text language sql stable set search_path = public as $$
  select e.title
         || case when e.opponents <> '' and position(lower(e.opponents) in lower(e.title)) = 0 then ' contre ' || e.opponents else '' end
         || ' · ' || push_when(e.starts_at)
         || case when e.all_day then ' (toute la journée)' when e.duration_min is not null then ' → ' || to_char((e.starts_at + make_interval(mins => e.duration_min)) at time zone 'Europe/Paris', 'HH24"h"MI') else '' end
         || case when e.place <> '' then ' · ' || e.place else '' end
         || ' (' || coalesce((select name from clubs where id = e.club_id), '') || ')';
$$;

-- Création : la durée (une série garde la même durée pour toutes ses séances)
create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home, duration_min, all_day)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true),
           case when coalesce((p->>'all_day')::boolean, false) then null else nullif(p->>'duration_min', '')::int end, coalesce((p->>'all_day')::boolean, false)
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Une nouvelle durée refait apparaître un rendez-vous masqué, comme un changement d'heure
create or replace function events_touch() returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at or new.place is distinct from old.place or new.duration_min is distinct from old.duration_min
     or new.all_day is distinct from old.all_day or new.cancelled is distinct from old.cancelled or new.title is distinct from old.title then new.updated_at := now(); end if;
  return new;
end $$;

-- Un changement de durée prévient comme un changement d'heure
create or replace function push_on_event_update() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text; t text; b text;
begin
  if new.starts_at < now() - interval '1 hour' then return null; end if;
  if new.cancelled and not old.cancelled then
    k := 'evcancel:' || coalesce(new.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), new.id::text);
    t := 'Annulé'; b := push_ev_line(new);
  elsif not new.cancelled and old.cancelled then
    k := 'evback:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := 'De nouveau prévu'; b := push_ev_line(new);
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place
        or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := case when new.place is distinct from old.place and new.starts_at is not distinct from old.starts_at
                   and new.duration_min is not distinct from old.duration_min and new.all_day is not distinct from old.all_day
              then 'Nouveau lieu' else 'Nouvel horaire' end;
    b := push_ev_line(new);
  else return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_update on events;
create trigger push_event_update after update of cancelled, starts_at, place, duration_min, all_day on events for each row execute function push_on_event_update();

-- ---------------------------------------------------------------------
-- N° 77 · score en fin de match, plateau ou tournoi
-- ---------------------------------------------------------------------
alter table events add column if not exists scores jsonb;
alter table events add column if not exists score_by uuid references auth.users(id) on delete set null;
alter table events add column if not exists score_at timestamptz;
alter table events add column if not exists score_edited boolean not null default false;

-- Le score ne s'écrit que par set_score (coach de l'équipe ou président), jamais par une modification directe
create or replace function events_score_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('pc.score', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.scores := null; new.score_by := null; new.score_at := null; new.score_edited := false; return new; end if;
  if new.scores is distinct from old.scores or new.score_by is distinct from old.score_by or new.score_at is distinct from old.score_at or new.score_edited is distinct from old.score_edited then
    raise exception 'Le score se met avec « Mettre le score » (coach de l''équipe ou président)';
  end if;
  return new;
end $$;
drop trigger if exists events_score_guard on events;
create trigger events_score_guard before insert or update on events for each row execute function events_score_guard();

-- Personnes liées à l'équipe : joueurs, parents des joueurs, coachs de l'équipe, supporteurs qui la suivent
create or replace function team_people(ts uuid[]) returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    select m.user_id u from memberships m where m.status = 'active' and m.team_id = any(ts) and m.role in ('coach','joueur','parent')
    union select f.user_id from team_follows f where f.team_id = any(ts)
    union select p.user_id from players p where p.deleted_at is null and p.user_id is not null
      and (p.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(ts)))
    union select pp.user_id from player_parents pp join players p on p.id = pp.player_id where p.deleted_at is null
      and (p.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(ts)))
  ) z where u is not null;
$$;
revoke execute on function team_people(uuid[]) from public, anon, authenticated;

-- p_lines : [{ "opponent": "Lardy", "us": 54, "them": 48, "forfeit": false }, …] ; tableau vide = retirer le score
create or replace function set_score(p_event uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e events; l jsonb; clean jsonb := '[]'::jsonb; u uuid; w int := 0; lo int := 0; d int := 0; body text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if not can_call_roll(p_event) then raise exception 'Le score est mis par le coach de l''équipe (ou le président)'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'Score seulement pour un match, un plateau ou un tournoi'; end if;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if e.starts_at > now() then raise exception 'Le score se met une fois la rencontre commencée'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 20 then raise exception 'Vingt rencontres au plus'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((l->>'us')::int, -1) not between 0 and 999 or coalesce((l->>'them')::int, -1) not between 0 and 999 then raise exception 'Score invalide (0 à 999)'; end if;
    if length(trim(coalesce(l->>'opponent', ''))) > 80 then raise exception 'Nom de l''adversaire trop long'; end if;
    clean := clean || jsonb_build_object('opponent', trim(coalesce(l->>'opponent', '')), 'us', (l->>'us')::int, 'them', (l->>'them')::int, 'forfeit', coalesce((l->>'forfeit')::boolean, false));
    if (l->>'us')::int > (l->>'them')::int then w := w + 1; elsif (l->>'us')::int < (l->>'them')::int then lo := lo + 1; else d := d + 1; end if;
  end loop;
  perform set_config('pc.score', 'on', true);
  update events set scores = case when jsonb_array_length(clean) = 0 then null else clean end,
    score_by = case when jsonb_array_length(clean) = 0 then null else auth.uid() end,
    score_at = case when jsonb_array_length(clean) = 0 then null else now() end,
    score_edited = (e.scores is not null and jsonb_array_length(clean) > 0)
    where id = p_event;
  perform set_config('pc.score', 'off', true);
  if e.scores is not null then perform log_action(e.club_id, null, null, 'Score modifié', jsonb_build_object('rendez_vous', e.title, 'avant', e.scores, 'après', clean)); end if;
  -- Une seule notification « Résultat » par rendez-vous (pas à la correction)
  if jsonb_array_length(clean) > 0 and e.scores is null then
    body := case when jsonb_array_length(clean) = 1
      then (case when w = 1 then 'Victoire ' when lo = 1 then 'Défaite ' else 'Nul ' end) || (clean->0->>'us') || ' – ' || (clean->0->>'them')
           || case when clean->0->>'opponent' <> '' then ' contre ' || (clean->0->>'opponent') else '' end
      else e.type || ' · ' || w || ' victoire' || case when w > 1 then 's' else '' end || ', ' || lo || ' défaite' || case when lo > 1 then 's' else '' end
           || case when d > 0 then ', ' || d || ' nul' || case when d > 1 then 's' else '' end else '' end end;
    for u in select * from team_people(e.team_ids) where team_people is distinct from auth.uid() loop
      perform push_enqueue(u, 'Résultat · ' || coalesce((select string_agg(name, ', ') from teams where id = any(e.team_ids)), e.title), body, 'score:' || e.id, 'score:' || e.id);
    end loop;
  end if;
  return jsonb_array_length(clean);
end $$;
revoke execute on function set_score(uuid, jsonb) from public, anon;

-- ---------------------------------------------------------------------
-- N° 78 · équipe en entente avec un autre club
-- ---------------------------------------------------------------------
alter table teams add column if not exists partner_club_id uuid references clubs(id) on delete set null;
alter table teams add column if not exists partner_name text not null default '';
alter table teams add column if not exists partner_contact jsonb;
alter table teams add column if not exists partner_state text not null default 'aucune';
do $$ begin
  alter table teams add constraint teams_partner_state check (partner_state in ('aucune','demandee','acceptee','refusee','invitee'));
exception when duplicate_object then null; end $$;
alter table players add column if not exists from_partner boolean not null default false;

-- L'entente ne change que par set_team_partner / answer_partner
create or replace function teams_partner_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('pc.partner', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.partner_club_id := null; new.partner_name := ''; new.partner_contact := null; new.partner_state := 'aucune'; return new; end if;
  if new.partner_club_id is distinct from old.partner_club_id or new.partner_name is distinct from old.partner_name
     or new.partner_contact is distinct from old.partner_contact or new.partner_state is distinct from old.partner_state then
    raise exception 'L''entente se règle avec « Équipe en entente »';
  end if;
  return new;
end $$;
drop trigger if exists teams_partner_guard on teams;
create trigger teams_partner_guard before insert or update on teams for each row execute function teams_partner_guard();

-- Un joueur « du club partenaire » seulement dans une équipe en entente
create or replace function players_partner_guard() returns trigger language plpgsql as $$
begin
  if new.from_partner and not exists(select 1 from teams t where t.id = new.team_id and t.partner_state <> 'aucune') then new.from_partner := false; end if;
  return new;
end $$;
drop trigger if exists players_partner_guard on players;
create trigger players_partner_guard before insert or update of from_partner, team_id on players for each row execute function players_partner_guard();

-- Qui règle une entente : le coach de l'équipe, la rubrique Technique, le président
create or replace function set_team_partner(p_team uuid, p_club uuid, p_name text, p_contact jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare t teams; st text; u uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null then raise exception 'Équipe introuvable'; end if;
  if not (coaches_team(p_team) or has_area(t.club_id, 'technique') or is_president(t.club_id)) then raise exception 'Réservé au coach de l''équipe, à la Technique et au président'; end if;
  if p_club = t.club_id then raise exception 'Choisis un autre club que le tien'; end if;
  if p_club is not null then
    if not exists(select 1 from clubs where id = p_club) then raise exception 'Club introuvable'; end if;
    st := 'demandee';
  elsif length(trim(coalesce(p_name, ''))) > 0 then
    if length(trim(p_name)) > 80 then raise exception 'Nom du club trop long'; end if;
    st := 'invitee';
  else st := 'aucune'; end if;
  perform set_config('pc.partner', 'on', true);
  update teams set partner_club_id = p_club,
    partner_name = case when st = 'aucune' then '' when p_club is not null then coalesce((select name from clubs where id = p_club), '') else trim(p_name) end,
    partner_contact = case when st = 'invitee' then jsonb_build_object('name', left(coalesce(p_contact->>'name', ''), 80), 'email', left(coalesce(p_contact->>'email', ''), 120), 'phone', left(coalesce(p_contact->>'phone', ''), 30)) else null end,
    partner_state = st
    where id = p_team;
  perform set_config('pc.partner', 'off', true);
  if st = 'aucune' then update players set from_partner = false where team_id = p_team and from_partner; end if;
  perform log_action(t.club_id, null, null, case st when 'aucune' then 'Entente retirée' when 'demandee' then 'Entente demandée' else 'Entente : club invité' end,
    jsonb_build_object('équipe', t.name, 'club', case when p_club is not null then (select name from clubs where id = p_club) else trim(coalesce(p_name, '')) end));
  if st = 'demandee' then
    for u in select distinct m.user_id from memberships m where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau') and 'technique' = any(areas_of(p_club, m.user_id)) loop
      perform push_enqueue(u, 'Entente à valider', (select name from clubs where id = t.club_id) || ' propose l''équipe ' || t.name || ' en entente avec votre club', 'entente:' || t.id, 'entente:' || t.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    end loop;
  end if;
  return st;
end $$;
revoke execute on function set_team_partner(uuid, uuid, text, jsonb) from public, anon;

-- Réponse du club partenaire (président ou rubrique Technique)
create or replace function answer_partner(p_team uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare t teams; u uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or t.partner_club_id is null or t.partner_state not in ('demandee','acceptee','refusee') then raise exception 'Aucune demande d''entente'; end if;
  if not (is_president(t.partner_club_id) or has_area(t.partner_club_id, 'technique')) then raise exception 'Réservé au président et à la Technique du club partenaire'; end if;
  perform set_config('pc.partner', 'on', true);
  update teams set partner_state = case when p_accept then 'acceptee' else 'refusee' end where id = p_team;
  perform set_config('pc.partner', 'off', true);
  perform log_action(t.partner_club_id, null, null, case when p_accept then 'Entente acceptée' else 'Entente refusée' end, jsonb_build_object('équipe', t.name, 'club porteur', (select name from clubs where id = t.club_id)));
  for u in select distinct m.user_id from memberships m where m.status = 'active' and ((m.club_id = t.club_id and m.role = 'president') or (m.team_id = t.id and m.role = 'coach')) loop
    perform push_enqueue(u, case when p_accept then 'Entente acceptée' else 'Entente refusée' end, coalesce((select name from clubs where id = t.partner_club_id), '') || ' · ' || t.name, 'entente:' || t.id, 'entente-r:' || t.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;
  return case when p_accept then 'acceptee' else 'refusee' end;
end $$;
revoke execute on function answer_partner(uuid, boolean) from public, anon;

-- Ce que voit le club partenaire : les équipes en entente avec lui (club porteur, coachs, ses joueurs en « Prénom N. »)
create or replace function partner_teams(p_club uuid) returns table(team_id uuid, team_name text, host_club text, state text, coaches text, my_players text[], players_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_president(p_club) or has_area(p_club, 'technique')) then return; end if;
  return query
    select t.id, t.name, c.name, t.partner_state,
      coalesce((select string_agg(coalesce(nullif(trim(pr.first_name || ' ' || pr.last_name), ''), 'Coach'), ', ') from memberships m join profiles pr on pr.id = m.user_id where m.team_id = t.id and m.role = 'coach' and m.status = 'active'), ''),
      coalesce((select array_agg(p.first_name || ' ' || left(p.last_name, 1) || '.' order by p.last_name) from players p where p.team_id = t.id and p.from_partner and p.deleted_at is null), '{}'),
      (select count(*)::int from players p where p.team_id = t.id and p.deleted_at is null)
    from teams t join clubs c on c.id = t.club_id
    where t.partner_club_id = p_club and t.deleted_at is null and t.partner_state in ('demandee','acceptee','refusee')
    order by t.name;
end $$;
revoke execute on function partner_teams(uuid) from public, anon;

-- Les joueurs du club partenaire n'entrent jamais dans notre trésorerie
create or replace function remind_fee(p_player uuid) returns int
language plpgsql security definer set search_path = public as $$
declare x players; a player_admin; who uuid[];
begin
  select * into x from players where id = p_player and deleted_at is null;
  if x.id is null or not has_area(x.club_id, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
  if x.from_partner then raise exception 'Joueur du club partenaire : sa cotisation se règle dans son club'; end if;
  select * into a from player_admin where player_id = p_player;
  if a.fee_amount is null or a.fee_paid >= a.fee_amount then raise exception 'Rien à régler pour ce joueur'; end if;
  if exists(select 1 from announcements n where n.kind = 'cotisation' and n.club_id = x.club_id and n.body like '%' || x.id::text || '%' and n.created_at > now() - interval '7 days') then
    raise exception 'Rappel déjà envoyé cette semaine';
  end if;
  select coalesce(array_agg(distinct u), '{}') into who from (select user_id u from player_parents where player_id = p_player union select x.user_id) z where u is not null;
  if cardinality(who) = 0 then raise exception 'Aucun compte relié à cette fiche : contacte la famille directement'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, title, body)
    values (x.club_id, 'people', who, 'cotisation', 'Cotisation de ' || x.first_name || ' : reste ' || trim(to_char(a.fee_amount - a.fee_paid, 'FM999990D00')) || ' €',
            'Merci de régler le reste de la cotisation auprès du trésorier du club. Réf. ' || x.id::text);
  perform set_config('pc.announce', 'off', true);
  return cardinality(who);
end $$;

-- Décompte facturé par Pocket Club : joueurs de notre club seulement
create or replace function billable_players(p_club uuid) returns int language sql stable security definer set search_path = public as $$
  select case when is_board(p_club) then (select count(*)::int from players where club_id = p_club and deleted_at is null and not from_partner) else null end;
$$;
revoke execute on function billable_players(uuid) from public, anon;

-- ---------------------------------------------------------------------
-- N° 75 · « Avez-vous vérifié vos heures ? »
-- ---------------------------------------------------------------------
create table if not exists hours_checks (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  done_notified boolean not null default false,
  unique (club_id, month)
);
create table if not exists hours_confirms (
  check_id uuid not null references hours_checks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes int not null default 0,
  confirmed_at timestamptz,
  relanced_at timestamptz,
  primary key (check_id, user_id)
);
alter table hours_checks enable row level security;
alter table hours_confirms enable row level security;
create or replace function hours_manager(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_president(c) or has_area(c, 'tresorerie');
$$;
create or replace function hours_asked_me(k uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_confirms where check_id = k and user_id = auth.uid());
$$;
create or replace function hours_check_manager(k uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_checks where id = k and hours_manager(club_id));
$$;
drop policy if exists "demandes d'heures lues" on hours_checks;
create policy "demandes d'heures lues" on hours_checks for select
  using (hours_manager(club_id) or hours_asked_me(id));
drop policy if exists "confirmations lues" on hours_confirms;
create policy "confirmations lues" on hours_confirms for select
  using (user_id = auth.uid() or hours_check_manager(check_id));

create or replace function month_minutes(c uuid, u uuid, m date) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)::int from coach_hours where club_id = c and user_id = u and day >= m and day < (m + interval '1 month');
$$;

-- p_users vide ou null = tous les coachs du club
create or replace function ask_hours_check(p_club uuid, p_month date, p_users uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; k uuid; u uuid; n int := 0; lbl text;
begin
  if not hours_manager(p_club) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'Choisis un mois passé ou en cours'; end if;
  if exists(select 1 from hours_checks where club_id = p_club and month = m) then raise exception 'La vérification de ce mois est déjà demandée'; end if;
  insert into hours_checks(club_id, month, created_by) values (p_club, m, auth.uid()) returning id into k;
  lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from m)::int];
  for u in select distinct ms.user_id from memberships ms where ms.club_id = p_club and ms.status = 'active' and ms.role = 'coach'
           and (p_users is null or cardinality(p_users) = 0 or ms.user_id = any(p_users)) loop
    insert into hours_confirms(check_id, user_id, minutes) values (k, u, month_minutes(p_club, u, m));
    perform push_enqueue(u, 'Heures à vérifier', 'As-tu vérifié tes heures de ' || lbl || ' ? ' || replace(trim(to_char(month_minutes(p_club, u, m) / 60.0, 'FM9990.0')), '.', ',') || ' h déclarées', 'hours:' || k, 'hours:' || k);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Aucun coach à qui demander'; end if;
  perform log_action(p_club, null, null, 'Vérification des heures demandée', jsonb_build_object('mois', lbl || ' ' || extract(year from m), 'coachs', n));
  return n;
end $$;
revoke execute on function ask_hours_check(uuid, date, uuid[]) from public, anon;

create or replace function confirm_hours(p_check uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k hours_checks; left_n int; u uuid; lbl text;
begin
  select * into k from hours_checks where id = p_check;
  if k.id is null or not exists(select 1 from hours_confirms where check_id = p_check and user_id = auth.uid()) then raise exception 'Aucune vérification demandée'; end if;
  update hours_confirms set confirmed_at = coalesce(confirmed_at, now()), minutes = month_minutes(k.club_id, auth.uid(), k.month) where check_id = p_check and user_id = auth.uid();
  select count(*) into left_n from hours_confirms where check_id = p_check and confirmed_at is null;
  if left_n = 0 and not k.done_notified then
    update hours_checks set done_notified = true where id = p_check;
    lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from k.month)::int];
    for u in select distinct m.user_id from memberships m where m.club_id = k.club_id and m.status = 'active' and m.role in ('president','bureau') and (m.role = 'president' or 'tresorerie' = any(areas_of(k.club_id, m.user_id))) loop
      perform push_enqueue(u, 'Heures vérifiées', 'Tous les coachs ont vérifié leurs heures de ' || lbl || ' : vous pouvez faire les comptes', 'hours-done:' || k.id, 'hours-done:' || k.id);
    end loop;
  end if;
  return left_n;
end $$;
revoke execute on function confirm_hours(uuid) from public, anon;

-- Relance d'un coach qui n'a pas confirmé : une fois par jour au plus
create or replace function relance_hours(p_check uuid, p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare k hours_checks; u uuid; n int := 0;
begin
  select * into k from hours_checks where id = p_check;
  if k.id is null or not hours_manager(k.club_id) then raise exception 'Réservé au président et à la trésorerie'; end if;
  for u in select user_id from hours_confirms where check_id = p_check and confirmed_at is null and (p_user is null or user_id = p_user)
           and (relanced_at is null or relanced_at < now() - interval '1 day') loop
    update hours_confirms set relanced_at = now() where check_id = p_check and user_id = u;
    perform push_enqueue(u, 'Rappel : heures à vérifier', 'Le club attend ta confirmation de tes heures', 'hours:' || k.id, 'hours-r:' || k.id || ':' || u || ':' || to_char(now(), 'YYYYMMDD'));
    n := n + 1;
  end loop;
  if n = 0 and p_user is not null then raise exception 'Relance déjà faite aujourd''hui'; end if;
  return n;
end $$;
revoke execute on function relance_hours(uuid, uuid) from public, anon;

-- Après « C'est bon », les heures du mois sont figées pour le coach (correction par le trésorier ou le président)
create or replace function hours_frozen(c uuid, u uuid, d date) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_confirms h join hours_checks k on k.id = h.check_id
                where k.club_id = c and h.user_id = u and k.month = date_trunc('month', d)::date and h.confirmed_at is not null);
$$;
create or replace function coach_hours_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and month_locked(old.club_id, old.user_id, old.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if tg_op in ('UPDATE','DELETE') and auth.uid() = old.user_id and hours_frozen(old.club_id, old.user_id, old.day) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.club_id := old.club_id; end if;
  if month_locked(new.club_id, new.user_id, new.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if auth.uid() = new.user_id and hours_frozen(new.club_id, new.user_id, new.day) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is not null and not coaches_team(new.team_id) then raise exception 'Tu n''encadres pas cette équipe'; end if;
  if new.day > current_date + 1 then raise exception 'On note les heures une fois faites'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- N° 76 · préférences du compte (ordre des blocs de chaque espace), retrouvées sur tous les appareils
-- ---------------------------------------------------------------------
create table if not exists user_prefs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 80),
  value jsonb not null default '[]'::jsonb check (length(value::text) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table user_prefs enable row level security;
drop policy if exists "préférences personnelles" on user_prefs;
create policy "préférences personnelles" on user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- Pocket Club · alpha 3.6.0 (mise à jour relançable sans risque) · n° 82 à 92
-- À installer APRÈS alpha_3_5_0.sql.
--   n° 82 : taux horaire de chaque coach (président et trésorerie seulement), historique des changements
--   n° 83 : pièces jointes dans les messages des groupes (stockage privé, lisible des seuls membres du groupe)
--   n° 84 : transférer un message (mention « Transféré par … »)
--   n° 86 : exercices : tags, demande de schéma à l'administrateur Pocket Club (Gaël), qui met à jour l'exercice
--   n° 89 : rendez-vous « Tout le club » avec ou sans les supporteurs (visibilité ET notifications)
-- (n° 85, 87, 88, 90, 91 et 92 ne demandent rien à la base : les cartes refusées vont dans user_prefs, déjà en place.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 89 · « Tout le club » avec ou sans les supporteurs
-- Les rendez-vous déjà publiés restent « supporteurs compris » (rien ne change pour eux) ; les nouveaux sont
-- « membres seulement » par défaut, le créateur ouvre aux supporteurs volontairement (l'écran le propose pour les matchs).
-- ---------------------------------------------------------------------
do $$ begin
  if not exists(select 1 from information_schema.columns where table_name = 'events' and column_name = 'with_supporters') then
    alter table events add column with_supporters boolean not null default true;   -- reprise : tout l'existant « supporteurs compris »
    alter table events alter column with_supporters set default false;               -- puis défaut prudent pour la suite
  end if;
end $$;

create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or (e.audience = 'club' and (e.with_supporters or has_real_role(e.club_id, auth.uid())))
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team(t)))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and auth.uid() = any(a.people))));
$$;

-- Bénévolat des supporteurs : seulement sur les rendez-vous qu'ils voient
create or replace function supporter_can_help(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e join clubs c on c.id = e.club_id where e.id = eid and c.supporters_volunteer
    and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active')
    and not has_real_role(e.club_id, u) and not is_minor_in(e.club_id, u)
    and ((e.audience = 'club' and e.with_supporters) or (e.type in ('Match','Plateau','Tournoi') and exists(select 1 from team_follows f where f.user_id = u and f.team_id = any(e.team_ids)))));
$$;
revoke execute on function supporter_can_help(uuid, uuid) from public, anon, authenticated;

create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home, duration_min, all_day, with_supporters)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true),
           case when coalesce((p->>'all_day')::boolean, false) then null else nullif(p->>'duration_min', '')::int end, coalesce((p->>'all_day')::boolean, false),
           case when aud = 'club' then coalesce((p->>'with_supporters')::boolean, false) else true end
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- N° 82 · taux horaire de chaque coach : lu et modifié par le président et la trésorerie seulement
-- ---------------------------------------------------------------------
create table if not exists coach_rates (
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rate numeric(7,2) not null check (rate >= 0 and rate <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create table if not exists coach_rate_log (
  id bigint generated always as identity primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  old_rate numeric(7,2), new_rate numeric(7,2),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table coach_rates enable row level security;
alter table coach_rate_log enable row level security;
drop policy if exists "taux lus par président et trésorerie" on coach_rates;
create policy "taux lus par président et trésorerie" on coach_rates for select using (hours_manager(club_id));
drop policy if exists "historique des taux lu par président et trésorerie" on coach_rate_log;
create policy "historique des taux lu par président et trésorerie" on coach_rate_log for select using (hours_manager(club_id));

create or replace function set_coach_rate(p_club uuid, p_user uuid, p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
declare old numeric;
begin
  if auth.uid() is null or not hours_manager(p_club) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p_user and m.status = 'active' and m.role = 'coach') then raise exception 'Ce membre n''est pas coach du club'; end if;
  select rate into old from coach_rates where club_id = p_club and user_id = p_user;
  if p_rate is null then
    delete from coach_rates where club_id = p_club and user_id = p_user;
  else
    if p_rate < 0 or p_rate > 500 then raise exception 'Taux entre 0 et 500 € de l''heure'; end if;
    insert into coach_rates(club_id, user_id, rate, updated_by) values (p_club, p_user, round(p_rate, 2), auth.uid())
      on conflict (club_id, user_id) do update set rate = excluded.rate, updated_by = auth.uid(), updated_at = now();
  end if;
  if old is distinct from p_rate then
    insert into coach_rate_log(club_id, user_id, old_rate, new_rate, changed_by) values (p_club, p_user, old, round(p_rate, 2), auth.uid());
  end if;
end $$;
grant execute on function set_coach_rate(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- N° 83 · pièces jointes dans les messages des groupes ; n° 84 · transfert
-- Fichiers rangés dans le dossier du groupe (<id du groupe>/<nom>), lisibles des seuls membres du groupe.
-- PDF, images, documents bureautiques ; 10 Mo par fichier, 5 fichiers par message.
-- ---------------------------------------------------------------------
alter table messages add column if not exists files jsonb not null default '[]'::jsonb;
alter table messages add column if not exists forwarded_by text not null default '';
do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'messages_files_check') then
    alter table messages add constraint messages_files_check check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 5 and length(forwarded_by) <= 120);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-files', 'message-files', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/gif',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function group_of_path(p text) returns uuid language sql immutable as $$
  select case when split_part(p, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p, '/', 1)::uuid end;
$$;
drop policy if exists "pièce jointe lisible par le groupe" on storage.objects;
create policy "pièce jointe lisible par le groupe" on storage.objects for select to authenticated
  using (bucket_id = 'message-files' and is_group_member(group_of_path(name)));
drop policy if exists "pièce jointe ajoutée par un membre du groupe" on storage.objects;
create policy "pièce jointe ajoutée par un membre du groupe" on storage.objects for insert to authenticated
  with check (bucket_id = 'message-files' and is_group_member(group_of_path(name)));
drop policy if exists "pièce jointe retirée par son auteur" on storage.objects;
create policy "pièce jointe retirée par son auteur" on storage.objects for delete to authenticated
  using (bucket_id = 'message-files' and owner = auth.uid());

-- ---------------------------------------------------------------------
-- N° 86 · exercices : tags, demande de schéma à l'administrateur Pocket Club
-- ---------------------------------------------------------------------
alter table exercises add column if not exists tags text[] not null default '{}';
do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'exercises_tags_check') then
    alter table exercises add constraint exercises_tags_check check (cardinality(tags) <= 25);
  end if;
end $$;

-- Administrateurs de l'application (Gaël) : reçoivent les demandes de schéma
create table if not exists app_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table app_admins enable row level security;
insert into app_admins(user_id) select id from auth.users where lower(email) in ('raveneau.gael@yahoo.fr', 'gael.pocketclub@gmail.com') on conflict do nothing;
create or replace function is_app_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_admins where user_id = auth.uid());
$$;
grant execute on function is_app_admin() to authenticated;
drop policy if exists "admin : se voit" on app_admins;
create policy "admin : se voit" on app_admins for select using (user_id = auth.uid());

create table if not exists schema_requests (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index if not exists schema_requests_open on schema_requests(exercise_id) where status = 'pending';
alter table schema_requests enable row level security;
drop policy if exists "demandes de schéma : auteur et admin" on schema_requests;
create policy "demandes de schéma : auteur et admin" on schema_requests for select using (requested_by = auth.uid() or is_app_admin());

-- L'admin voit les exercices demandés (pour préparer le schéma)
drop policy if exists "exercice demandé lisible par l'admin" on exercises;
create policy "exercice demandé lisible par l'admin" on exercises for select
  using (is_app_admin() and exists(select 1 from schema_requests r where r.exercise_id = exercises.id));

create or replace function request_schema(p_exercise uuid, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare e exercises; rid uuid; a uuid;
begin
  select * into e from exercises where id = p_exercise and deleted_at is null;
  if e.id is null or e.created_by is distinct from auth.uid() then raise exception 'Seul l''auteur peut demander un schéma'; end if;
  select id into rid from schema_requests where exercise_id = e.id and status = 'pending';
  if rid is not null then return rid; end if;
  insert into schema_requests(exercise_id, requested_by, note) values (e.id, auth.uid(), left(coalesce(p_note, ''), 500)) returning id into rid;
  for a in select user_id from app_admins loop
    perform push_enqueue(a, 'Schéma demandé', e.title, 'schema', 'schema:' || rid::text, './');
  end loop;
  return rid;
end $$;
grant execute on function request_schema(uuid, text) to authenticated;

-- L'admin a déposé la vidéo du schéma (dans son propre dossier du stockage des vidéos) : l'exercice est mis à jour,
-- le coach est prévenu. Une vidéo désignée par l'exercice est lisible même hors du dossier de l'exercice (3.2.2).
create or replace function finish_schema(p_request uuid, p_video text, p_poster text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r schema_requests; t text;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into r from schema_requests where id = p_request and status = 'pending';
  if r.id is null then raise exception 'Demande introuvable ou déjà traitée'; end if;
  if coalesce(p_video, '') = '' or length(p_video) > 200 or length(coalesce(p_poster, '')) > 200 then raise exception 'Vidéo manquante'; end if;
  update exercises set video_path = p_video, poster_path = coalesce(p_poster, ''), updated_at = now() where id = r.exercise_id returning title into t;
  update schema_requests set status = 'done', done_at = now() where id = r.id;
  if r.requested_by is not null then perform push_enqueue(r.requested_by, 'Ton schéma est prêt', t, 'schema', 'schema-ok:' || r.id::text, './'); end if;
end $$;
grant execute on function finish_schema(uuid, text, text) to authenticated;

create or replace function cancel_schema(p_request uuid) returns void language sql security definer set search_path = public as $$
  update schema_requests set status = 'cancelled', done_at = now() where id = p_request and status = 'pending' and (requested_by = auth.uid() or is_app_admin());
$$;
grant execute on function cancel_schema(uuid) to authenticated;

-- L'admin dépose les vidéos de schéma dans le dossier « admin/ » du stockage des vidéos
drop policy if exists "video de schéma déposée par l'admin" on storage.objects;
create policy "video de schéma déposée par l'admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-videos' and split_part(name, '/', 1) = 'admin' and is_app_admin());
drop policy if exists "video de schéma lue par l'admin" on storage.objects;
create policy "video de schéma lue par l'admin" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos' and split_part(name, '/', 1) = 'admin' and is_app_admin());

-- mypocketclub · alpha 3.7.0 · n° 93 (top 5 des équipes les plus suivies) et n° 96 (demandes d'ajout d'un club, version test).
-- Les n° 94, 95 et 97 ne touchent pas à la base. Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- N° 93 · top 5 des équipes les plus suivies sur l'application
-- Rien tant que l'application compte moins de 10 équipes visibles (ni fantômes, ni archivées, ni à la corbeille)
-- de clubs qui apparaissent dans la recherche des clubs. Seulement : équipe, club, nombre de personnes qui la suivent ;
-- aucun nom de personne (les équipes et les clubs sont déjà visibles dans la recherche publique).
-- ---------------------------------------------------------------------
create or replace function top_followed_teams()
returns table(team_id uuid, team_name text, category text, club_id uuid, club_name text, city text, sport text, logo text, crest_bg text, color1 text, crest_outline text, followers int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from teams t join clubs c on c.id = t.club_id
      where t.state = 'Visible' and t.deleted_at is null and c.public_listed) < 10 then return; end if;
  return query
    select t.id, t.name, t.category, c.id, c.name, c.city, c.sport, c.logo, c.crest_bg, c.color1, c.crest_outline, count(f.user_id)::int
    from teams t join clubs c on c.id = t.club_id join team_follows f on f.team_id = t.id
    where t.state = 'Visible' and t.deleted_at is null and c.public_listed
    group by t.id, t.name, t.category, c.id, c.name, c.city, c.sport, c.logo, c.crest_bg, c.color1, c.crest_outline
    order by count(f.user_id) desc, c.name, t.name
    limit 5;
end $$;
revoke execute on function top_followed_teams() from public, anon;
grant execute on function top_followed_teams() to authenticated;

-- ---------------------------------------------------------------------
-- N° 96 · « Mon club n'est pas dans la liste » : demandes d'ajout d'un club (version test, aucun e-mail envoyé)
-- Écrites seulement par request_club (visiteur non connecté compris), lues seulement par l'administrateur (Gaël).
-- L'adresse IP n'est pas gardée : seulement son empreinte, pour limiter le nombre de demandes.
-- ---------------------------------------------------------------------
create table if not exists club_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null check (length(first_name) between 1 and 60),
  last_name text not null check (length(last_name) between 1 and 60),
  email text not null check (length(email) between 5 and 160),
  club_name text not null check (length(club_name) between 2 and 120),
  city text not null default '' check (length(city) <= 80),
  sport text not null default '' check (length(sport) <= 40),
  age_ok boolean not null default false,
  consent boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  ip_hash text not null default '',
  status text not null default 'new' check (status in ('new','done')),
  done_at timestamptz
);
create index if not exists club_requests_ip on club_requests(ip_hash, created_at);
create index if not exists club_requests_email on club_requests(lower(email), created_at);
alter table club_requests enable row level security;
drop policy if exists "demandes de clubs : administrateur" on club_requests;
create policy "demandes de clubs : administrateur" on club_requests for select using (is_app_admin());

create or replace function request_club(p_first text, p_last text, p_email text, p_club text, p_city text, p_sport text, p_age_ok boolean, p_consent boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ip text := md5(request_ip()); v_email text := lower(trim(coalesce(p_email, '')));
  v_first text := left(trim(coalesce(p_first, '')), 60); v_last text := left(trim(coalesce(p_last, '')), 60);
  v_club text := left(trim(coalesce(p_club, '')), 120); v_city text := left(trim(coalesce(p_city, '')), 80); v_sport text := left(trim(coalesce(p_sport, '')), 40);
  rid uuid; a uuid;
begin
  if v_first = '' or v_last = '' then raise exception 'Prénom et nom obligatoires'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then raise exception 'Adresse e-mail à vérifier'; end if;
  if length(v_club) < 2 then raise exception 'Nom du club obligatoire'; end if;
  if v_city = '' or v_sport = '' then raise exception 'Ville et sport du club obligatoires'; end if;
  if not coalesce(p_age_ok, false) then raise exception 'Moins de 15 ans : un parent fait la demande'; end if;
  if not coalesce(p_consent, false) then raise exception 'L''accord pour transmettre ton nom au club est obligatoire'; end if;
  -- limites : 10 demandes par jour et par adresse IP, 3 par jour et par e-mail
  if (select count(*) from club_requests where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10
     or (select count(*) from club_requests where lower(email) = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Trop de demandes aujourd''hui. Réessaie demain.';
  end if;
  -- même personne, même club, moins de 30 jours : la demande existe déjà
  select id into rid from club_requests
    where lower(email) = v_email and norm_name(club_name) = norm_name(v_club) and norm_name(city) = norm_name(v_city) and created_at > now() - interval '30 days'
    order by created_at desc limit 1;
  if rid is not null then return rid; end if;
  insert into club_requests(first_name, last_name, email, club_name, city, sport, age_ok, consent, user_id, ip_hash)
    values (v_first, v_last, v_email, v_club, v_city, v_sport, true, true, auth.uid(), v_ip) returning id into rid;
  -- notification à l'administrateur (Gaël), avec toutes les informations
  for a in select user_id from app_admins loop
    perform push_enqueue(a, 'Club demandé : ' || left(v_club, 50),
      v_club || ' (' || v_city || ', ' || v_sport || ') · ' || v_first || ' ' || v_last || ' · ' || v_email || ' · simulation',
      'clubreq', 'clubreq:' || rid::text, './');
  end loop;
  return rid;
end $$;
revoke execute on function request_club(text, text, text, text, text, text, boolean, boolean) from public;
grant execute on function request_club(text, text, text, text, text, text, boolean, boolean) to anon, authenticated;

create or replace function set_club_request(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_status not in ('new', 'done') then raise exception 'État inconnu'; end if;
  update club_requests set status = p_status, done_at = case when p_status = 'done' then now() end where id = p_id;
end $$;
revoke execute on function set_club_request(uuid, text) from public, anon;
grant execute on function set_club_request(uuid, text) to authenticated;

-- mypocketclub · alpha 3.8.0 · n° 103 (supprimer une équipe en doublon : président ou bureau qui a la rubrique Technique).
-- Les autres points de la 3.8.0 (n° 98 à 102, 104, 106, 107, contact et site) ne touchent pas à la base.
-- Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- N° 103 · une équipe part à la corbeille (30 jours, restaurable par le président et le bureau) :
-- avant, seul le président pouvait le faire ; désormais aussi le bureau qui a la rubrique Technique
-- (has_area donne toutes les rubriques au président). Joueurs et fiches : inchangé (président et secrétariat).
-- ---------------------------------------------------------------------
create or replace function trash_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is null;
    if c is null or not (is_president(c) or has_area(c, 'technique')) then raise exception 'Seuls le président et le bureau (rubrique Technique) suppriment une équipe'; end if;
    update teams set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is null;
    if c is null or not has_area(c, 'secretariat') then raise exception 'Seuls le président et le secrétariat suppriment une fiche'; end if;
    update players set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'poll' then
    perform delete_poll(p_id);
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

-- mypocketclub · alpha 3.9.0 · n° 108 (le coordinateur est prévenu d'un match à domicile créé par un coach).
-- Les autres points de la 3.9.0 (n° 109 nom du club en expéditeur, n° 111 titre automatique) ne touchent pas à la base.
-- La purge des messages et des rendez-vous (n° 110) est un script à part : PURGE_MESSAGES_RENDEZ_VOUS.sql.
-- Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- N° 108 · un coach (ou toute personne sans la rubrique Événements) crée un match, un plateau ou un tournoi
-- à domicile pour une équipe, ou coche « Match à domicile » après coup : les personnes qui ont la rubrique
-- Événements (coordinateur, vice-président, président) reçoivent une notification pour préparer la convocation
-- des clubs reçus. Une seule notification par rendez-vous et par personne (clé convhome:<id>).
-- ---------------------------------------------------------------------
create or replace function push_on_home_match() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; actor uuid := coalesce(auth.uid(), new.created_by); b text;
begin
  if new.cancelled or not new.at_home or new.audience <> 'team' or new.type not in ('Match','Plateau','Tournoi') or new.starts_at < now() then return null; end if;
  if tg_op = 'UPDATE' and old.at_home and old.type in ('Match','Plateau','Tournoi') then return null; end if;
  if actor is not null and 'evenements' = any(areas_of(new.club_id, actor)) then return null; end if;
  b := push_ev_line(new);
  for u in select distinct m.user_id from memberships m
           where m.club_id = new.club_id and m.status = 'active' and m.role in ('president','bureau')
             and m.user_id is distinct from actor and 'evenements' = any(areas_of(new.club_id, m.user_id)) loop
    perform push_enqueue(u, left('Match à domicile à convoquer : ' || coalesce(nullif(new.opponents, ''), lower(new.type)), 80), b, 'conv:' || new.id, 'convhome:' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists push_home_match on events;
create trigger push_home_match after insert or update of at_home, type on events for each row execute function push_on_home_match();

select 'mypocketclub alpha 3.9.0 installé : base vide, crée ton compte dans l''application.' as resultat;
