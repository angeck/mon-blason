-- Mon Blason · alpha · schéma de la base (à coller dans Supabase > SQL Editor > Run)
-- Le script peut être relancé : il supprime puis recrée tout (les données de test sont perdues).

drop table if exists poll_votes, polls, messages, group_members, groups, event_responses, events, memberships, teams, clubs, profiles cascade;
drop function if exists is_member, is_staff, is_group_member, shares_club, join_club, create_club, teams_for_code, handle_new_user cascade;

-- ---------- Tables ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
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
create policy "adhésions validées par l'encadrement" on memberships for update using (is_staff(club_id)) with check (is_staff(club_id));
create policy "adhésion quittée par soi ou retirée par l'encadrement" on memberships for delete using (user_id = auth.uid() or is_staff(club_id));

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
