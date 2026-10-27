-- Mon Blason · alpha · schéma de la base (à coller dans Supabase > SQL Editor > Run)
-- Le script peut être relancé : il supprime puis recrée tout (les données de test sont perdues).

drop table if exists attendance, event_series, player_admin, player_parents, players, poll_votes, polls, messages, group_members, groups, event_responses, events, memberships, teams, clubs, profiles cascade;
drop function if exists is_member, is_staff, is_group_member, shares_club, join_club, create_club, teams_for_code, handle_new_user, can_validate, validate_membership, is_board, coaches_team, is_parent_of, can_see_player, can_manage_player, create_player, players_guard cascade;

-- ---------- Tables ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  nickname text,
  created_at timestamptz not null default now()
);

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text default '',
  sport text not null default 'Basket-ball',
  color1 text not null default '#0B6B3A',
  color2 text not null default '#FFD400',
  logo text check (logo is null or length(logo) < 400000),
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  name text not null,
  category text default '',
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('president','bureau','coach','joueur','parent','supporteur')),
  team_id uuid references teams(id) on delete set null,
  child_name text,
  status text not null default 'pending' check (status in ('pending','active')),
  created_at timestamptz not null default now()
);
create index on memberships(user_id);
create index on memberships(club_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  type text not null default 'Événement' check (type in ('Événement','Entraînement','Match','Plateau','Tournoi')),
  title text not null,
  starts_at timestamptz not null,
  place text default '',
  opponents text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table event_responses (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer text not null check (answer in ('oui','non')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id),
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
  question text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table poll_votes (
  poll_id uuid not null references polls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer text not null check (answer in ('Présent','Absent','Je ne sais pas')),
  primary key (poll_id, user_id)
);

-- ---------- Fonctions d'aide (droits) ----------
create function is_member(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active');
$$;
create function is_staff(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role in ('president','bureau','coach'));
$$;
create function is_group_member(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from group_members where group_id = g and user_id = auth.uid());
$$;
create function shares_club(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid() or exists(
    select 1 from memberships a join memberships b on a.club_id = b.club_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = u);
$$;

-- Profil créé automatiquement à l'inscription
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Créer un club : le créateur devient président
create function create_club(p_name text, p_city text, p_sport text, p_c1 text, p_c2 text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into clubs(name, city, sport, color1, color2, created_by) values (p_name, p_city, p_sport, p_c1, p_c2, auth.uid()) returning id into cid;
  insert into memberships(club_id, user_id, role, status) values (cid, auth.uid(), 'president', 'active');
  return cid;
end $$;

-- Rejoindre un club avec son code : supporteur tout de suite, les autres rôles à valider
create function join_club(p_code text, p_role text, p_team uuid, p_child text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select id into cid from clubs where join_code = upper(trim(p_code));
  if cid is null then raise exception 'Code de club inconnu'; end if;
  if p_role not in ('bureau','coach','joueur','parent','supporteur') then raise exception 'Rôle invalide'; end if;
  insert into memberships(club_id, user_id, role, team_id, child_name, status)
    values (cid, auth.uid(), p_role, p_team, nullif(trim(p_child), ''), case when p_role = 'supporteur' then 'active' else 'pending' end);
  return cid;
end $$;

-- Lire les équipes d'un club à partir de son code (pour le formulaire « Rejoindre »)
create function teams_for_code(p_code text) returns table(id uuid, name text, club_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, c.name from teams t join clubs c on c.id = t.club_id where c.join_code = upper(trim(p_code)) order by t.name;
$$;

-- ---------- Règles d'accès (RLS) ----------
alter table profiles enable row level security;
alter table clubs enable row level security;
alter table teams enable row level security;
alter table memberships enable row level security;
alter table events enable row level security;
alter table event_responses enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table messages enable row level security;
alter table polls enable row level security;
alter table poll_votes enable row level security;

create policy "profil lisible par les membres des mêmes clubs" on profiles for select using (shares_club(id));
create policy "chacun modifie son profil" on profiles for update using (id = auth.uid());

create policy "club lisible par ses membres (même en attente)" on clubs for select using (
  exists(select 1 from memberships where club_id = clubs.id and user_id = auth.uid()));
create policy "club modifié par le président et le bureau" on clubs for update using (
  exists(select 1 from memberships where club_id = clubs.id and user_id = auth.uid() and status = 'active' and role in ('president','bureau')));
create policy "club supprimé par le président" on clubs for delete using (
  exists(select 1 from memberships where club_id = clubs.id and user_id = auth.uid() and status = 'active' and role = 'president'));

create policy "équipes lisibles par les membres" on teams for select using (is_member(club_id));
create policy "équipes gérées par l'encadrement" on teams for all using (is_staff(club_id)) with check (is_staff(club_id));

create policy "adhésions lisibles par soi et les membres" on memberships for select using (user_id = auth.uid() or is_member(club_id));

create policy "événements lisibles par les membres" on events for select using (is_member(club_id));
create policy "événements créés par l'encadrement" on events for insert with check (is_staff(club_id) and created_by = auth.uid());
create policy "événements modifiés par l'encadrement" on events for update using (is_staff(club_id));
create policy "événements supprimés par l'encadrement" on events for delete using (is_staff(club_id));

create policy "réponses lisibles par les membres" on event_responses for select using (
  exists(select 1 from events e where e.id = event_id and is_member(e.club_id)));
create policy "chacun répond pour soi" on event_responses for insert with check (
  user_id = auth.uid() and exists(select 1 from events e where e.id = event_id and is_member(e.club_id)));
create policy "chacun change sa réponse" on event_responses for update using (user_id = auth.uid());
create policy "chacun retire sa réponse" on event_responses for delete using (user_id = auth.uid());

create policy "groupes visibles par leurs membres" on groups for select using (is_group_member(id) or created_by = auth.uid());
create policy "tout membre actif crée un groupe" on groups for insert with check (is_member(club_id) and created_by = auth.uid());
create policy "groupe modifié ou supprimé par son créateur" on groups for update using (created_by = auth.uid());
create policy "groupe supprimé par son créateur" on groups for delete using (created_by = auth.uid());

create policy "membres du groupe visibles par le groupe" on group_members for select using (is_group_member(group_id));
create policy "le créateur invite des membres du club" on group_members for insert with check (
  exists(select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  and exists(select 1 from memberships m join groups g on g.club_id = m.club_id where g.id = group_id and m.user_id = group_members.user_id and m.status = 'active'));
create policy "chacun coupe ses notifications" on group_members for update using (user_id = auth.uid());
create policy "quitter ou retirer" on group_members for delete using (
  user_id = auth.uid() or exists(select 1 from groups g where g.id = group_id and g.created_by = auth.uid()));

create policy "messages lus par le groupe" on messages for select using (is_group_member(group_id));
create policy "messages écrits par le groupe" on messages for insert with check (is_group_member(group_id) and user_id = auth.uid());
create policy "message supprimé par son auteur" on messages for delete using (user_id = auth.uid());

create policy "sondages lus par le groupe" on polls for select using (is_group_member(group_id));
create policy "sondages créés par le groupe" on polls for insert with check (is_group_member(group_id) and created_by = auth.uid());
create policy "sondage supprimé par son auteur" on polls for delete using (created_by = auth.uid());

create policy "votes lus par le groupe" on poll_votes for select using (
  exists(select 1 from polls p where p.id = poll_id and is_group_member(p.group_id)));
create policy "chacun vote pour soi" on poll_votes for insert with check (
  user_id = auth.uid() and exists(select 1 from polls p where p.id = poll_id and is_group_member(p.group_id)));
create policy "chacun change son vote" on poll_votes for update using (user_id = auth.uid());

-- ---------- Temps réel (messages, votes, réponses) ----------
alter publication supabase_realtime add table messages, poll_votes, event_responses;

-- ---------- Validations (alpha 0.3) ----------

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

create or replace function validate_membership(mid uuid, p_team uuid default null) returns void language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not can_validate(mid) then raise exception 'Vous ne pouvez pas valider cette demande'; end if;
  select club_id into c from memberships where id = mid;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = c) then raise exception 'Équipe inconnue dans ce club'; end if;
  update memberships set status = 'active', team_id = coalesce(p_team, team_id) where id = mid;
  if not found then raise exception 'Demande introuvable'; end if;
end $$;

drop policy if exists "adhésions validées par l'encadrement" on memberships;
drop policy if exists "adhésion quittée par soi ou retirée par l'encadrement" on memberships;
drop policy if exists "adhésion quittée par soi ou retirée selon les droits" on memberships;
create policy "adhésion quittée par soi ou retirée selon les droits" on memberships for delete using (user_id = auth.uid() or can_validate(id));

do $$ begin
  alter publication supabase_realtime add table memberships;
exception when duplicate_object then null; end $$;

-- ---------- Alpha 1.0 ----------

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
