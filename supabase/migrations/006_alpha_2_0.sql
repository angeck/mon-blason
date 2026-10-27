-- Mon Blason · alpha 2.0 · sécurité 1.1, prénom et nom séparés, équipes, tarifs, import et doublons,
-- événements masqués, blason, inscription conforme. Garde toutes les données.

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
