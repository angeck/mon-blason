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
