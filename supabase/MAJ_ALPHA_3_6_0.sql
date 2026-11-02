-- MAJ_ALPHA_3_6_0.sql · Pocket Club · n° 82 à 92 · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.5.0).
-- Sans perte de données, relançable sans risque.

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

select 'Pocket Club alpha 3.6.0 installée' as resultat;
