-- Mon Blason · passage à l'alpha 1.0 en UN SEUL script (inclut 002, 003, 004 et 005).
-- Peut être lancé même si certains de ces scripts l'ont déjà été. Garde toutes les données.

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
