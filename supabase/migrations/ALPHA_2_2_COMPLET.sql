-- Mon Blason · passage à l'alpha 2.2 en UN SEUL script (contient tout l'alpha 2.0, 2.1 et 2.2).
-- Peut être lancé quel que soit le dernier script déjà lancé, même deux fois. Garde toutes les données.



alter table clubs add column if not exists logo text check (logo is null or length(logo) < 400000);

alter table profiles add column if not exists nickname text;

-- Qui peut valider ou retirer une adhésion :
-- président : tout ; bureau : joueurs, parents, coachs, supporteurs ; coach : joueurs et parents de son équipe.
create or replace function can_validate(mid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from memberships t
    join memberships me on me.club_id = t.club_id and me.user_id = auth.uid() and me.status = 'active'
    where t.id = mid and t.user_id <> auth.uid() and (
      me.role = 'president'
      or (me.role = 'bureau' and t.role in ('joueur','parent','coach','supporteur'))
      or (me.role = 'coach' and t.role in ('joueur','parent') and t.team_id is not null and t.team_id = me.team_id)));
$$;

create or replace function validate_membership(mid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_validate(mid) then raise exception 'Vous ne pouvez pas valider cette demande'; end if;
  update memberships set status = 'active' where id = mid;
end $$;

drop policy if exists "adhésions validées par l'encadrement" on memberships;
drop policy if exists "adhésion quittée par soi ou retirée par l'encadrement" on memberships;
drop policy if exists "adhésion quittée par soi ou retirée selon les droits" on memberships;
create policy "adhésion quittée par soi ou retirée selon les droits" on memberships for delete using (user_id = auth.uid() or can_validate(id));

do $$ begin
  alter publication supabase_realtime add table memberships;
exception when duplicate_object then null; end $$;

-- entraînements répétés, appel. Garde toutes les données existantes.
-- À coller en entier dans Supabase > SQL Editor > Run (une seule fois).

-- ---------- Fiches joueurs ----------
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,      -- joueur de 15 ans et plus qui a son propre compte
  first_name text not null,
  last_name text not null default '',
  birth_year int check (birth_year is null or birth_year between 1930 and 2030),
  emergency_name text,
  emergency_phone text,
  consents jsonb not null default '{}'::jsonb,                      -- {"image":{"ok":true,"at":"…","by":"…"}, …}
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists players_club on players(club_id);
create index if not exists players_team on players(team_id);

create table if not exists player_parents (
  player_id uuid not null references players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (player_id, user_id)
);

-- Licence et cotisation : saisies par le président et le bureau
create table if not exists player_admin (
  player_id uuid primary key references players(id) on delete cascade,
  licence_state text not null default 'Préinscrit club' check (licence_state in ('Préinscrit club','Préinscrit fédé','Licencié')),
  licence_number text,
  health_doc boolean not null default false,                        -- certificat ou questionnaire fourni : oui / non, jamais le contenu
  fee_amount numeric(8,2),
  fee_paid numeric(8,2) not null default 0,
  fee_method text check (fee_method is null or fee_method in ('Chèque','Espèces','Virement','HelloAsso','Carte','Autre')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table memberships add column if not exists player_id uuid references players(id) on delete set null;

-- ---------- Agenda : séries d'entraînements, annulation, appel ----------
create table if not exists event_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  title text not null,
  place text default '',
  weekday int not null check (weekday between 0 and 6),
  start_time text not null,
  until date not null,
  skip_holidays boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table events add column if not exists series_id uuid references event_series(id) on delete cascade;
alter table events add column if not exists cancelled boolean not null default false;

create table if not exists attendance (
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status text not null check (status in ('present','absent','retard')),
  marked_by uuid references auth.users(id),
  marked_at timestamptz not null default now(),
  primary key (event_id, player_id)
);

-- ---------- Fonctions de droits ----------
create or replace function is_board(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role in ('president','bureau'));
$$;
create or replace function coaches_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active' and role = 'coach');
$$;
create or replace function is_parent_of(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from player_parents where player_id = p and user_id = auth.uid());
$$;
create or replace function can_see_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and (
    x.user_id = auth.uid() or is_parent_of(x.id) or is_board(x.club_id) or coaches_team(x.team_id)));
$$;
create or replace function can_manage_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and (is_board(x.club_id) or coaches_team(x.team_id)));
$$;

-- ---------- Validation : crée ou relie la fiche joueur ----------
drop function if exists validate_membership(uuid);
drop function if exists validate_membership(uuid, uuid);
create or replace function validate_membership(mid uuid, p_team uuid default null, p_player uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; pid uuid; fn text; ln text; fullname text;
begin
  if not can_validate(mid) then raise exception 'Vous ne pouvez pas valider cette demande'; end if;
  select * into m from memberships where id = mid;
  if m.id is null then raise exception 'Demande introuvable'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = m.club_id) then raise exception 'Équipe inconnue dans ce club'; end if;
  m.team_id := coalesce(p_team, m.team_id);
  pid := p_player;
  if pid is not null and not exists(select 1 from players where id = pid and club_id = m.club_id) then raise exception 'Fiche joueur inconnue'; end if;
  if pid is null and m.role in ('parent','joueur') then
    if m.role = 'parent' then fullname := coalesce(nullif(trim(m.child_name), ''), 'Enfant');
    else select coalesce(nullif(trim(full_name), ''), 'Joueur') into fullname from profiles where id = m.user_id; end if;
    fn := split_part(fullname, ' ', 1); ln := trim(substr(fullname, length(fn) + 1));
    insert into players(club_id, team_id, user_id, first_name, last_name, created_by)
      values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, fn, ln, auth.uid()) returning id into pid;
    insert into player_admin(player_id) values (pid);
  end if;
  if m.role = 'parent' and pid is not null then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
  if m.role = 'joueur' and pid is not null then update players set user_id = m.user_id where id = pid and user_id is null; end if;
  update memberships set status = 'active', team_id = m.team_id, player_id = pid where id = mid;
end $$;

-- Fiches pour les parents et joueurs déjà validés avant cette version
do $$
declare m record; pid uuid; fullname text; fn text;
begin
  for m in select * from memberships where status = 'active' and role in ('parent','joueur') and player_id is null loop
    if m.role = 'parent' then fullname := coalesce(nullif(trim(m.child_name), ''), 'Enfant');
    else select coalesce(nullif(trim(full_name), ''), 'Joueur') into fullname from profiles where id = m.user_id; end if;
    fn := split_part(fullname, ' ', 1);
    insert into players(club_id, team_id, user_id, first_name, last_name)
      values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, fn, trim(substr(fullname, length(fn) + 1))) returning id into pid;
    insert into player_admin(player_id) values (pid);
    if m.role = 'parent' then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
    update memberships set player_id = pid where id = m.id;
  end loop;
end $$;

-- Créer une fiche joueur directement (coach de l'équipe, bureau, président)
create or replace function create_player(p_club uuid, p_team uuid, p_first text, p_last text, p_year int) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not (is_board(p_club) or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club) then raise exception 'Équipe inconnue'; end if;
  insert into players(club_id, team_id, first_name, last_name, birth_year, created_by) values (p_club, p_team, trim(p_first), trim(coalesce(p_last, '')), p_year, auth.uid()) returning id into pid;
  insert into player_admin(player_id) values (pid);
  return pid;
end $$;

-- Garde-fou : le club d'une fiche ne change jamais ; l'équipe et le compte lié changent seulement par l'encadrement
create or replace function players_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.club_id <> old.club_id then raise exception 'Le club d''une fiche ne peut pas changer'; end if;
  if new.team_id is distinct from old.team_id and not can_manage_player(old.id) then raise exception 'Seul l''encadrement change l''équipe'; end if;
  if new.user_id is distinct from old.user_id and not is_board(old.club_id) then raise exception 'Seul le bureau relie un compte'; end if;
  return new;
end $$;
drop trigger if exists players_guard on players;
create trigger players_guard before update on players for each row execute function players_guard();

-- ---------- Règles d'accès ----------
alter table players enable row level security;
alter table player_parents enable row level security;
alter table player_admin enable row level security;
alter table event_series enable row level security;
alter table attendance enable row level security;

drop policy if exists "fiche lisible" on players;
drop policy if exists "fiche modifiable" on players;
drop policy if exists "fiche supprimée par le bureau" on players;
create policy "fiche lisible" on players for select using (can_see_player(id));
create policy "fiche modifiable" on players for update using (can_see_player(id)) with check (can_see_player(id));
create policy "fiche supprimée par le bureau" on players for delete using (is_board(club_id));

drop policy if exists "parents lisibles" on player_parents;
drop policy if exists "parents gérés" on player_parents;
create policy "parents lisibles" on player_parents for select using (can_see_player(player_id));
create policy "parents gérés" on player_parents for delete using (can_manage_player(player_id));

drop policy if exists "dossier lisible" on player_admin;
drop policy if exists "dossier saisi par le bureau" on player_admin;
drop policy if exists "dossier créé par le bureau" on player_admin;
create policy "dossier lisible" on player_admin for select using (can_see_player(player_id));
create policy "dossier saisi par le bureau" on player_admin for update using (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));
create policy "dossier créé par le bureau" on player_admin for insert with check (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));

drop policy if exists "séries lisibles" on event_series;
drop policy if exists "séries gérées" on event_series;
create policy "séries lisibles" on event_series for select using (is_member(club_id));
create policy "séries gérées" on event_series for all using (is_staff(club_id)) with check (is_staff(club_id));

drop policy if exists "appel lisible" on attendance;
drop policy if exists "appel fait par l'encadrement" on attendance;
create policy "appel lisible" on attendance for select using (can_see_player(player_id));
create policy "appel fait par l'encadrement" on attendance for all using (can_manage_player(player_id)) with check (can_manage_player(player_id));



create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ---------- n° 11 : prénom et nom séparés ----------
alter table profiles add column if not exists first_name text not null default '';
alter table profiles add column if not exists last_name text not null default '';
alter table profiles add column if not exists palette text not null default 'terrain' check (palette in ('terrain','parquet','stade'));
alter table profiles add column if not exists cgu_version text;
alter table profiles add column if not exists cgu_at timestamptz;
alter table profiles add column if not exists optin_emails boolean not null default false;

create or replace function nice_first(t text) returns text language sql immutable as $$
  select initcap(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'));
$$;
create or replace function nice_last(t text) returns text language sql immutable as $$
  select case when trim(coalesce(t, '')) = '' then '' else upper(left(regexp_replace(trim(t), '\s+', ' ', 'g'), 1)) || substr(regexp_replace(trim(t), '\s+', ' ', 'g'), 2) end;
$$;
create or replace function norm_name(t text) returns text language sql immutable as $$
  select regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]', '', 'g');
$$;

update profiles set first_name = nice_first(split_part(trim(full_name), ' ', 1)),
  last_name = nice_last(trim(substr(trim(full_name), length(split_part(trim(full_name), ' ', 1)) + 1)))
  where first_name = '' and coalesce(full_name, '') <> '';

-- full_name reste calculé pour les écrans existants
create or replace function profiles_names() returns trigger language plpgsql as $$
begin
  new.first_name := nice_first(new.first_name); new.last_name := nice_last(new.last_name);
  if new.first_name <> '' then new.full_name := trim(new.first_name || ' ' || new.last_name); end if;
  return new;
end $$;
drop trigger if exists profiles_names on profiles;
create trigger profiles_names before insert or update on profiles for each row execute function profiles_names();

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, first_name, last_name, cgu_version, cgu_at, optin_emails) values (new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', ''), ' ', 1)),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'cgu_version',
    case when new.raw_user_meta_data->>'cgu_version' is not null then now() end,
    coalesce((new.raw_user_meta_data->>'optin_emails')::boolean, false));
  return new;
end $$;

-- ---------- Fiches joueurs : date de naissance, équipes secondaires ----------
alter table players add column if not exists birth_date date;
create table if not exists player_teams (
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  primary key (player_id, team_id)
);
create or replace function players_names() returns trigger language plpgsql as $$
begin
  new.first_name := nice_first(new.first_name); new.last_name := nice_last(new.last_name);
  if new.birth_date is not null then new.birth_year := extract(year from new.birth_date); end if;
  return new;
end $$;
drop trigger if exists players_names on players;
create trigger players_names before insert or update on players for each row execute function players_names();

-- ---------- Équipes : catégorie, genre, état, saison, créneaux ----------
alter table teams add column if not exists category text default '';
alter table teams add column if not exists gender text default '' check (gender in ('','Féminine','Masculine','Mixte'));
alter table teams add column if not exists state text not null default 'Visible' check (state in ('Visible','Fantôme','Archivée'));
alter table teams add column if not exists season text not null default '2026-2027';
alter table teams add column if not exists slots text default '';
alter table memberships add column if not exists assistant boolean not null default false;
alter table memberships add column if not exists child_first text;
alter table memberships add column if not exists child_last text;

-- ---------- Blason : couleur de fond de l'écu, logo image seulement ----------
alter table clubs add column if not exists crest_bg text;
alter table clubs drop constraint if exists clubs_logo_image;
alter table clubs add constraint clubs_logo_image check (logo is null or logo like 'data:image/%') not valid;

-- ---------- Tarifs et réductions (n° 6) ----------
create table if not exists fee_grid (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  season text not null default '2026-2027',
  category text,
  team_id uuid references teams(id) on delete cascade,
  amount numeric(8,2) not null check (amount >= 0),
  fed_part numeric(8,2) check (fed_part is null or fed_part >= 0),
  created_at timestamptz not null default now()
);
create table if not exists player_discount (
  player_id uuid primary key references players(id) on delete cascade,
  base_amount numeric(8,2),
  amount numeric(8,2) not null default 0,
  reason text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- ---------- Événements masqués (n° 4) ----------
alter table events add column if not exists updated_at timestamptz not null default now();
create or replace function events_touch() returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at or new.place is distinct from old.place or new.cancelled is distinct from old.cancelled or new.title is distinct from old.title then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists events_touch on events;
create trigger events_touch before update on events for each row execute function events_touch();
create table if not exists event_hidden (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ---------- Code du club : 8 caractères sans ambiguïté, essais limités ----------
create or replace function new_join_code() returns text language plpgsql volatile as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := ''; for i in 1..8 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists(select 1 from clubs where join_code = c);
  end loop;
  return c;
end $$;
alter table clubs alter column join_code set default new_join_code();
update clubs set join_code = new_join_code() where length(join_code) < 8;
create table if not exists join_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists join_attempts_user on join_attempts(user_id, at);
create or replace function check_join_rate() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if (select count(*) from join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop d''essais de code. Réessayez dans une heure.';
  end if;
end $$;

-- ---------- Fonctions de droits ----------
create or replace function is_president(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'president');
$$;
create or replace function coaches_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active' and role = 'coach');
$$;
create or replace function can_see_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and (
    x.user_id = auth.uid() or is_parent_of(x.id) or is_board(x.club_id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))));
$$;
create or replace function can_manage_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and (is_board(x.club_id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))));
$$;

-- Activation d'une adhésion (interne, appelée après contrôle des droits)
create or replace function activate_membership(mid uuid, p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; pid uuid; fn text; ln text;
begin
  select * into m from memberships where id = mid;
  if m.id is null then raise exception 'Demande introuvable'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = m.club_id) then raise exception 'Équipe inconnue dans ce club'; end if;
  m.team_id := coalesce(p_team, m.team_id);
  pid := p_player;
  if pid is not null and not exists(select 1 from players where id = pid and club_id = m.club_id) then raise exception 'Fiche joueur inconnue'; end if;
  if pid is null and m.role in ('parent','joueur') then
    if m.role = 'parent' then
      fn := coalesce(nullif(trim(m.child_first), ''), split_part(coalesce(nullif(trim(m.child_name), ''), 'Enfant'), ' ', 1));
      ln := coalesce(nullif(trim(m.child_last), ''), trim(substr(coalesce(m.child_name, ''), length(split_part(coalesce(m.child_name, ''), ' ', 1)) + 1)));
    else select first_name, last_name into fn, ln from profiles where id = m.user_id; end if;
    insert into players(club_id, team_id, user_id, first_name, last_name, created_by)
      values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, coalesce(nullif(fn, ''), 'Joueur'), coalesce(ln, ''), auth.uid()) returning id into pid;
    insert into player_admin(player_id) values (pid) on conflict do nothing;
  end if;
  if m.role = 'parent' and pid is not null then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
  if m.role = 'joueur' and pid is not null then update players set user_id = m.user_id where id = pid and user_id is null; end if;
  -- n° 12 : une fois la fiche reliée, le nom de l'enfant n'est plus copié dans l'adhésion
  update memberships set status = 'active', team_id = m.team_id, player_id = pid,
    child_name = case when pid is not null then null else child_name end,
    child_first = case when pid is not null then null else child_first end,
    child_last = case when pid is not null then null else child_last end
    where id = mid;
end $$;
revoke execute on function activate_membership(uuid, uuid, uuid) from public, anon, authenticated;

drop function if exists validate_membership(uuid);
drop function if exists validate_membership(uuid, uuid);
create or replace function validate_membership(mid uuid, p_team uuid default null, p_player uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_validate(mid) then raise exception 'Vous ne pouvez pas valider cette demande'; end if;
  perform activate_membership(mid, p_team, p_player);
end $$;

-- Rejoindre ou ajouter un rôle (n° 1 : le président obtient tout de suite ; le bureau devient coach tout de suite)
drop function if exists join_club(text, text, uuid, text);
create or replace function join_club(p_code text, p_role text, p_team uuid, p_child text, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; auto boolean;
begin
  perform check_join_rate();
  select id into cid from clubs where join_code = upper(trim(p_code));
  if cid is null then insert into join_attempts(user_id) values (auth.uid()); return null; end if;
  if p_role not in ('bureau','coach','joueur','parent','supporteur') then raise exception 'Rôle invalide'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = cid) then raise exception 'Équipe inconnue'; end if;
  auto := p_role = 'supporteur' or is_president(cid) or (p_role = 'coach' and is_board(cid));
  insert into memberships(club_id, user_id, role, team_id, child_name, child_first, child_last, status)
    values (cid, auth.uid(), p_role, p_team,
      nullif(trim(coalesce(p_child, trim(coalesce(p_child_first, '') || ' ' || coalesce(p_child_last, '')))), ''),
      nullif(nice_first(p_child_first), ''), nullif(nice_last(p_child_last), ''), 'pending') returning id into mid;
  if auto then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

drop function if exists teams_for_code(text);
create or replace function teams_for_code(p_code text) returns table(id uuid, name text, club_name text)
language plpgsql security definer set search_path = public as $$
begin
  perform check_join_rate();
  if not exists(select 1 from clubs where join_code = upper(trim(p_code))) then
    insert into join_attempts(user_id) values (auth.uid());
    return;
  end if;
  return query select t.id, t.name, c.name from clubs c left join teams t on t.club_id = c.id and t.state = 'Visible'
    where c.join_code = upper(trim(p_code)) order by t.name;
end $$;

-- Nommer un coach (bureau ou président) parmi les membres actifs
create or replace function set_team_coach(p_team uuid, p_user uuid, p_assistant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team;
  if c is null or not (is_board(c) or (p_assistant and coaches_team(p_team))) then raise exception 'Droit insuffisant'; end if;
  if not exists(select 1 from memberships where club_id = c and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if exists(select 1 from memberships where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team) then
    update memberships set assistant = p_assistant, status = 'active' where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team;
  else
    insert into memberships(club_id, user_id, role, team_id, status, assistant) values (c, p_user, 'coach', p_team, 'active', p_assistant);
  end if;
end $$;

-- Reconduire une équipe pour la saison suivante (fantôme, mêmes coachs)
create or replace function renew_team(p_team uuid, p_season text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t teams; nid uuid;
begin
  select * into t from teams where id = p_team;
  if t.id is null or not is_board(t.club_id) then raise exception 'Droit insuffisant'; end if;
  insert into teams(club_id, name, category, gender, state, season, slots) values (t.club_id, t.name, t.category, t.gender, 'Fantôme', p_season, t.slots) returning id into nid;
  insert into memberships(club_id, user_id, role, team_id, status, assistant)
    select club_id, user_id, 'coach', nid, 'active', assistant from memberships where team_id = p_team and role = 'coach' and status = 'active';
  update teams set state = 'Archivée' where id = p_team;
  return nid;
end $$;

-- Liste des membres d'un club selon les droits (n° 3, n° 10, sécurité 1.1)
-- Encadrement : noms complets ; familles : « Prénom N. ». Les parents et supporteurs ne sont pas des membres :
-- ils apparaissent sur la fiche de l'enfant (l'encadrement les compte à part).
create or replace function club_roster(p_club uuid) returns table(kind text, ref uuid, user_id uuid, first_name text, last_name text, role text, team_id uuid, assistant boolean, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare staff boolean := is_board(p_club); me_member boolean := is_member(p_club);
begin
  if not me_member then return; end if;
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
    from players x where x.club_id = p_club
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', pt.team_id, false, x.created_at
    from players x join player_teams pt on pt.player_id = x.id where x.club_id = p_club;
end $$;

-- Téléphones : entre l'encadrement et les familles concernées seulement
create or replace function phones_for(p_ids uuid[]) returns table(id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select p.id, p.phone from profiles p where p.id = any(p_ids) and p.phone is not null and (
    p.id = auth.uid()
    -- l'appelant est président ou bureau d'un club où la personne est inscrite
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where a.user_id = auth.uid() and a.status = 'active' and a.role in ('president','bureau') and b.user_id = p.id)
    -- la personne est président, bureau ou coach d'un club où l'appelant est membre actif
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where b.user_id = p.id and b.status = 'active' and b.role in ('president','bureau','coach') and a.user_id = auth.uid() and a.status = 'active' and a.role <> 'supporteur')
    -- l'appelant coache une équipe où la personne est parent d'un joueur ou joueur
    or exists(select 1 from players x left join player_parents pp on pp.player_id = x.id
      where (pp.user_id = p.id or x.user_id = p.id) and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id)))));
$$;
create or replace function my_profile() returns profiles language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid();
$$;

-- Doublons à l'ajout de joueurs (n° 8) : comparaison côté serveur, sans dévoiler plus que nécessaire
create or replace function match_players(p_club uuid, p_rows jsonb) returns table(idx int, player_id uuid, kind text, label text, team_name text, same_team boolean)
language plpgsql stable security definer set search_path = public as $$
declare r record; i int := 0;
begin
  if not (is_board(p_club) or exists(select 1 from memberships where club_id = p_club and user_id = auth.uid() and status = 'active' and role = 'coach')) then raise exception 'Droit insuffisant'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, team_id uuid) loop
    return query
      select i, x.id,
        case when norm_name(x.first_name) = norm_name(r.first_name) and norm_name(x.last_name) = norm_name(r.last_name) then 'certain'
             when r.licence is not null and r.licence <> '' and a.licence_number = r.licence then 'certain'
             else 'possible' end,
        x.first_name || ' ' || case when is_board(p_club) or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end
          || case when x.birth_date is not null and (is_board(p_club) or can_see_player(x.id)) then ' · ' || to_char(x.birth_date, 'DD/MM/YYYY') else '' end,
        coalesce(t.name, 'sans équipe'), x.team_id is not distinct from r.team_id
      from players x left join player_admin a on a.player_id = x.id left join teams t on t.id = x.team_id
      where x.club_id = p_club and (
        (norm_name(x.first_name) = norm_name(r.first_name) and norm_name(x.last_name) = norm_name(r.last_name))
        or (r.licence is not null and r.licence <> '' and a.licence_number = r.licence)
        or (norm_name(x.first_name) = norm_name(r.last_name) and norm_name(x.last_name) = norm_name(r.first_name))
        or (norm_name(x.last_name) = norm_name(r.last_name) and extensions.levenshtein(norm_name(x.first_name), norm_name(r.first_name)) <= 1)
        or (norm_name(x.first_name) = norm_name(r.first_name) and r.birth_date is not null and x.birth_date = r.birth_date));
    i := i + 1;
  end loop;
end $$;

-- Import d'une liste de joueurs (n° 7) : chaque ligne porte la décision prise à l'écran de vérification
-- action : 'create' | 'skip' | 'complete' (compléter la fiche existante) | 'addteam' (ajouter aussi à l'équipe)
create or replace function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid;
begin
  if not (is_board(p_club) or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club) then raise exception 'Équipe inconnue'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid) loop
    if coalesce(r.action, 'create') = 'skip' or coalesce(trim(r.first_name), '') = '' then continue; end if;
    if r.action in ('complete', 'addteam') then
      if not exists(select 1 from players where id = r.existing and club_id = p_club) then continue; end if;
      update players set birth_date = coalesce(birth_date, r.birth_date) where id = r.existing;
      if coalesce(r.licence, '') <> '' then
        insert into player_admin(player_id, licence_number) values (r.existing, r.licence)
          on conflict (player_id) do update set licence_number = coalesce(player_admin.licence_number, excluded.licence_number);
      end if;
      if r.action = 'addteam' and p_team is not null then
        insert into player_teams values (r.existing, p_team) on conflict do nothing;
      end if;
      n := n + 1; continue;
    end if;
    insert into players(club_id, team_id, first_name, last_name, birth_date, created_by)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, auth.uid()) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Accepter les CGU (comptes créés avant l'alpha 2.0)
create or replace function accept_cgu(p_version text, p_optin boolean) returns void language sql security definer set search_path = public as $$
  update profiles set cgu_version = p_version, cgu_at = now(), optin_emails = coalesce(p_optin, optin_emails) where id = auth.uid();
$$;

-- ---------- Règles d'accès ----------
-- Adhésions : chacun voit les siennes ; l'encadrement voit tout ; le coach voit celles de son équipe.
-- Les autres membres passent par club_roster (noms abrégés, sans noms d'enfants ni demandes en attente).
drop policy if exists "adhésions lisibles par soi et les membres" on memberships;
drop policy if exists "adhésions lisibles selon les droits" on memberships;
create policy "adhésions lisibles selon les droits" on memberships for select using (
  user_id = auth.uid() or is_board(club_id) or coaches_team(team_id));

-- Profils : pas de lecture directe du téléphone (voir phones_for)
revoke select on profiles from anon, authenticated;
grant select (id, full_name, first_name, last_name, nickname, palette, created_at) on profiles to authenticated;
grant update (full_name, first_name, last_name, nickname, phone, palette, optin_emails) on profiles to authenticated;

-- Équipes : le bureau crée ; le coach modifie son équipe ; seul le président supprime
drop policy if exists "équipes gérées par l'encadrement" on teams;
drop policy if exists "équipes créées par le bureau" on teams;
drop policy if exists "équipes modifiées par le bureau ou le coach" on teams;
drop policy if exists "équipes supprimées par le président" on teams;
create policy "équipes créées par le bureau" on teams for insert with check (is_board(club_id));
create policy "équipes modifiées par le bureau ou le coach" on teams for update using (is_board(club_id) or coaches_team(id)) with check (is_board(club_id) or coaches_team(id));
create policy "équipes supprimées par le président" on teams for delete using (is_president(club_id));

-- Rendez-vous : le bureau pour tout le club ; le coach seulement pour son équipe
drop policy if exists "événements créés par l'encadrement" on events;
drop policy if exists "événements modifiés par l'encadrement" on events;
drop policy if exists "événements supprimés par l'encadrement" on events;
drop policy if exists "rendez-vous créés selon les droits" on events;
drop policy if exists "rendez-vous modifiés selon les droits" on events;
drop policy if exists "rendez-vous supprimés selon les droits" on events;
create policy "rendez-vous créés selon les droits" on events for insert with check (created_by = auth.uid() and (is_board(club_id) or coaches_team(team_id)));
create policy "rendez-vous modifiés selon les droits" on events for update using (is_board(club_id) or coaches_team(team_id));
create policy "rendez-vous supprimés selon les droits" on events for delete using (is_board(club_id) or coaches_team(team_id));
drop policy if exists "séries gérées" on event_series;
drop policy if exists "séries gérées selon les droits" on event_series;
create policy "séries gérées selon les droits" on event_series for all using (is_board(club_id) or coaches_team(team_id)) with check (is_board(club_id) or coaches_team(team_id));

alter table player_teams enable row level security;
drop policy if exists "équipes secondaires lisibles" on player_teams;
drop policy if exists "équipes secondaires gérées" on player_teams;
create policy "équipes secondaires lisibles" on player_teams for select using (can_see_player(player_id));
create policy "équipes secondaires gérées" on player_teams for all using (can_manage_player(player_id)) with check (can_manage_player(player_id) and coaches_team(team_id) or exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));

alter table fee_grid enable row level security;
drop policy if exists "tarifs lisibles par les membres" on fee_grid;
drop policy if exists "tarifs gérés par le bureau" on fee_grid;
create policy "tarifs lisibles par les membres" on fee_grid for select using (is_member(club_id));
create policy "tarifs gérés par le bureau" on fee_grid for all using (is_board(club_id)) with check (is_board(club_id));

alter table player_discount enable row level security;
drop policy if exists "réductions : bureau seulement" on player_discount;
create policy "réductions : bureau seulement" on player_discount for all using (exists(select 1 from players x where x.id = player_id and is_board(x.club_id))) with check (exists(select 1 from players x where x.id = player_id and is_board(x.club_id)));

alter table event_hidden enable row level security;
drop policy if exists "masquage personnel" on event_hidden;
create policy "masquage personnel" on event_hidden for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table join_attempts enable row level security;

-- ---------- Reprise des données ----------
update memberships set child_name = null where player_id is not null and child_name is not null;
update teams set category = name where coalesce(category, '') = '';
update profiles set first_name = first_name;  -- recalcule full_name et la mise en forme
update players set first_name = first_name;

-- ---------- Alpha 2.1 ----------
-- n° 16 et 19 : destinataires des rendez-vous (club, équipe, bureau, bureau et coachs, tous les coachs)
alter table events add column if not exists audience text not null default 'club';
alter table events drop constraint if exists events_audience_check;
alter table events add constraint events_audience_check check (audience in ('club','team','board','board_coaches','coaches'));
update events set audience = 'team' where team_id is not null and audience = 'club';

-- n° 19 : types Réunion et AG
alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check check (type in ('Événement','Entraînement','Match','Plateau','Tournoi','Réunion','AG'));

-- Le compte fait-il partie de l'équipe (joueur, coach, parent d'un joueur, joueur adulte avec sa fiche) ?
create or replace function in_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
create or replace function is_coach_in(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'coach');
$$;
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or (e.audience = 'club' and is_member(e.club_id))
    or (e.audience = 'team' and in_team(e.team_id))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))));
$$;

drop policy if exists "événements lisibles par les membres" on events;
drop policy if exists "rendez-vous lisibles par les destinataires" on events;
create policy "rendez-vous lisibles par les destinataires" on events for select using (sees_event(id));

-- Un coach ne crée que pour son équipe et jamais de rendez-vous interne au bureau
drop policy if exists "rendez-vous créés selon les droits" on events;
create policy "rendez-vous créés selon les droits" on events for insert with check (
  created_by = auth.uid() and (is_board(club_id) or (coaches_team(team_id) and audience = 'team')));

drop policy if exists "réponses lisibles par les membres" on event_responses;
drop policy if exists "chacun répond pour soi" on event_responses;
drop policy if exists "réponses lisibles par les destinataires" on event_responses;
drop policy if exists "chacun répond pour soi s'il est invité" on event_responses;
create policy "réponses lisibles par les destinataires" on event_responses for select using (sees_event(event_id));
create policy "chacun répond pour soi s'il est invité" on event_responses for insert with check (user_id = auth.uid() and sees_event(event_id));

-- n° 17 : suppression d'un sondage (auteur, bureau, créateur du groupe), avec trace « supprimé par »
alter table polls add column if not exists deleted_by uuid references auth.users(id);
alter table polls add column if not exists deleted_at timestamptz;
create or replace function can_delete_poll(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from polls p join groups g on g.id = p.group_id where p.id = pid and (
    p.created_by = auth.uid() or g.created_by = auth.uid() or is_board(g.club_id)));
$$;
create or replace function delete_poll(pid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_delete_poll(pid) then raise exception 'Vous ne pouvez pas supprimer ce sondage'; end if;
  update polls set deleted_by = auth.uid(), deleted_at = now() where id = pid and deleted_at is null;
  delete from poll_votes where poll_id = pid;
end $$;

-- n° 18 : document des tarifs joint (PDF ou image), lisible par les membres, géré par le bureau
create table if not exists club_docs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  kind text not null default 'tarifs' check (kind in ('tarifs')),
  file_name text not null,
  data text not null check (data like 'data:application/pdf;%' or data like 'data:image/%'),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table club_docs drop constraint if exists club_docs_size;
alter table club_docs add constraint club_docs_size check (length(data) < 5600000);
alter table club_docs enable row level security;
drop policy if exists "documents lisibles par les membres" on club_docs;
drop policy if exists "documents gérés par le bureau" on club_docs;
create policy "documents lisibles par les membres" on club_docs for select using (is_member(club_id));
create policy "documents gérés par le bureau" on club_docs for all using (is_board(club_id)) with check (is_board(club_id) and uploaded_by = auth.uid());

-- ---------- Alpha 2.2 ----------
-- n° 21 : la réponse d'un parent est enregistrée au nom de l'enfant (fiche joueur), une seule réponse par enfant
alter table event_responses add column if not exists player_id uuid references players(id) on delete cascade;
alter table event_responses add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if exists(select 1 from pg_constraint where conname = 'event_responses_pkey' and conrelid = 'event_responses'::regclass
            and array_length(conkey, 1) = 2) then
    alter table event_responses drop constraint event_responses_pkey;
  end if;
  if not exists(select 1 from pg_constraint where contype = 'p' and conrelid = 'event_responses'::regclass) then
    alter table event_responses add constraint event_responses_pkey primary key (id);
  end if;
end $$;
create unique index if not exists event_responses_self on event_responses(event_id, user_id) where player_id is null;
create unique index if not exists event_responses_child on event_responses(event_id, player_id) where player_id is not null;

create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid())) then raise exception 'Ce joueur n''est pas relié à votre compte'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if e.team_id is not null and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_team(e.team_id)
       and not exists(select 1 from memberships where team_id = e.team_id and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and team_id = e.team_id) then
      raise exception 'Vous encadrez cette équipe : pas de réponse pour vous-même';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- Réponses seulement par la fonction (contrôles ci-dessus)
drop policy if exists "chacun répond pour soi" on event_responses;
drop policy if exists "chacun répond pour soi s'il est invité" on event_responses;
drop policy if exists "chacun change sa réponse" on event_responses;
drop policy if exists "chacun retire sa réponse" on event_responses;

-- n° 22 : interrupteur « Tout le club » mémorisé par compte
alter table profiles add column if not exists show_all_club boolean not null default false;
grant update (show_all_club) on profiles to authenticated;
grant select (show_all_club) on profiles to authenticated;

-- n° 23 : une demande en attente ou un rôle actif identique bloque ; rien d'autre
create or replace function join_guard() returns trigger language plpgsql as $$
begin
  if new.role <> 'parent' and exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.user_id and m.role = new.role
       and m.team_id is not distinct from new.team_id and m.id <> new.id) then
    raise exception 'Vous avez déjà ce rôle ou une demande en attente pour ce rôle';
  end if;
  return new;
end $$;
drop trigger if exists join_guard on memberships;
create trigger join_guard before insert on memberships for each row execute function join_guard();

-- Débloque les demandes restées en attente qui auraient dû être accordées tout de suite (président ; bureau qui demande coach)
do $$
declare m record;
begin
  for m in select x.id from memberships x where x.status = 'pending' and (
      exists(select 1 from memberships p where p.club_id = x.club_id and p.user_id = x.user_id and p.status = 'active' and p.role = 'president')
      or (x.role = 'coach' and exists(select 1 from memberships b where b.club_id = x.club_id and b.user_id = x.user_id and b.status = 'active' and b.role = 'bureau'))) loop
    perform activate_membership(m.id, null, null);
  end loop;
end $$;

-- Correctif (tests « vie de club ») : un second parent validé sans choisir la fiche est relié à la fiche existante
-- de l'enfant (même prénom et même nom, accents et majuscules ignorés, même équipe) au lieu d'en créer une seconde.
create or replace function activate_membership(mid uuid, p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; pid uuid; fn text; ln text;
begin
  select * into m from memberships where id = mid;
  if m.id is null then raise exception 'Demande introuvable'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = m.club_id) then raise exception 'Équipe inconnue dans ce club'; end if;
  m.team_id := coalesce(p_team, m.team_id);
  pid := p_player;
  if pid is not null and not exists(select 1 from players where id = pid and club_id = m.club_id) then raise exception 'Fiche joueur inconnue'; end if;
  if pid is null and m.role in ('parent','joueur') then
    if m.role = 'parent' then
      fn := coalesce(nullif(trim(m.child_first), ''), split_part(coalesce(nullif(trim(m.child_name), ''), 'Enfant'), ' ', 1));
      ln := coalesce(nullif(trim(m.child_last), ''), trim(substr(coalesce(m.child_name, ''), length(split_part(coalesce(m.child_name, ''), ' ', 1)) + 1)));
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id is null
        and norm_name(p.first_name) = norm_name(fn) and norm_name(p.last_name) = norm_name(ln)
        and (m.team_id is null or p.team_id = m.team_id or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = m.team_id))
        order by p.created_at limit 1;
    else
      select first_name, last_name into fn, ln from profiles where id = m.user_id;
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id = m.user_id limit 1;
    end if;
    if pid is null then
      insert into players(club_id, team_id, user_id, first_name, last_name, created_by)
        values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, coalesce(nullif(fn, ''), 'Joueur'), coalesce(ln, ''), auth.uid()) returning id into pid;
      insert into player_admin(player_id) values (pid) on conflict do nothing;
    end if;
  end if;
  if m.role = 'parent' and pid is not null then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
  if m.role = 'joueur' and pid is not null then update players set user_id = m.user_id where id = pid and user_id is null; end if;
  update memberships set status = 'active', team_id = m.team_id, player_id = pid,
    child_name = case when pid is not null then null else child_name end,
    child_first = case when pid is not null then null else child_first end,
    child_last = case when pid is not null then null else child_last end
    where id = mid;
end $$;
revoke execute on function activate_membership(uuid, uuid, uuid) from public, anon, authenticated;
