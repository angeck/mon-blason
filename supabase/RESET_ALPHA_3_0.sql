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

select 'Pocket Club alpha 3.0.2 installé : base vide, crée ton compte dans l''application.' as resultat;
