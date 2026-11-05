-- mypocketclub · alpha 4.5.0 · mise à jour d'une base 4.4.0, sans perte de données, relançable.
-- Relecture de la 4.4.0 par Gaël (5 novembre 2026, 16 h 22 à 18 h 16), « lance la maj » à 18 h 21 :
-- 1. N° 136 : coach et coach assistant réservés aux adultes ; la liste proposée au coach est celle de tous les adultes du
--    club (coach_candidates), et plus seulement les membres que le coach voit déjà.
-- 2. N° 142 (a) : le correspondant rencontres (rubrique Événements) relance l'encart « Souhaites-tu être bénévole ? »
--    auprès des membres du bureau qui n'ont pas encore répondu et des supporteurs sans réponse (si le club leur ouvre le
--    bénévolat) : ask_volunteers, une fois toutes les 12 heures.
-- 3. N° 142 (b) : missions ouvertes aux jeunes à partir de U13 : case « jeunes dès U13 » sur une mission (cochée seulement
--    par la rubrique Événements : président, correspondant rencontres) ; jamais pour la buvette ; c'est le parent qui
--    inscrit son enfant (volunteer_youth) ; un adulte du club est présent (rappel à l'écran).
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 136 · coachs et coachs assistants : adultes seulement, liste de tous les adultes du club
-- ---------------------------------------------------------------------
create or replace function coach_candidates(p_team uuid) returns table(uid uuid, label text)
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team and deleted_at is null;
  if c is null or not (has_area(c, 'technique') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  return query
    select z.uid, z.label from (
      select distinct m.user_id as uid, coalesce(nullif(trim(p.full_name), ''), 'Membre') as label
      from memberships m join profiles p on p.id = m.user_id
      where m.club_id = c and m.status = 'active' and p.deleted_at is null and account_is_adult(c, m.user_id)
        and not exists(select 1 from memberships x where x.club_id = c and x.user_id = m.user_id and x.role = 'coach' and x.team_id = p_team and x.status = 'active')
    ) z order by z.label;
end $$;

create or replace function set_team_coach(p_team uuid, p_user uuid, p_assistant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team and deleted_at is null;
  if c is null or not (has_area(c, 'technique') or (p_assistant and coaches_team(p_team))) then raise exception 'Droit insuffisant'; end if;
  if not exists(select 1 from memberships where club_id = c and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  -- n° 136 (décision de Gaël, 5 novembre 2026) : coach et coach assistant réservés aux adultes
  if not account_is_adult(c, p_user) then raise exception 'Coach et coach assistant : réservé aux adultes (fiche joueur mineure ou sans date de naissance)'; end if;
  if exists(select 1 from memberships where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team) then
    update memberships set assistant = p_assistant, status = 'active' where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team;
  else
    insert into memberships(club_id, user_id, role, team_id, status, assistant) values (c, p_user, 'coach', p_team, 'active', p_assistant);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. N° 142 (a) · relance de l'encart bénévole
-- ---------------------------------------------------------------------
alter table profiles add column if not exists volunteer_asked_at timestamptz;     -- dernière relance reçue (affiche l'encart)
alter table profiles add column if not exists volunteer_answered_at timestamptz;  -- dernière réponse (Oui, Non, ou la case de Mon compte)
create table if not exists club_volunteer_asks (
  club_id uuid primary key references clubs(id) on delete cascade,
  asked_at timestamptz not null default now(),
  asked_by uuid references auth.users(id) on delete set null
);
alter table club_volunteer_asks enable row level security;   -- lu seulement par volunteer_ask_state()

create or replace function set_volunteer(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  update profiles set volunteer = coalesce(p_on, true), volunteer_answered_at = now() where id = auth.uid();
end $$;
create or replace function set_supporter_volunteer(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  update profiles set supporter_volunteer = p_on, volunteer_answered_at = now() where id = auth.uid();
end $$;

-- Personnes à relancer : membres du bureau (et président) adultes qui n'ont jamais répondu ; supporteurs majeurs sans réponse,
-- quand le club ouvre le bénévolat aux supporteurs. Jamais un mineur. Jamais la personne qui relance.
create or replace function volunteer_ask_targets(c uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct m.user_id from memberships m join profiles p on p.id = m.user_id
  where m.club_id = c and m.status = 'active' and p.deleted_at is null and m.user_id is distinct from auth.uid() and not is_minor_in(c, m.user_id)
    and (
      (exists(select 1 from memberships x where x.club_id = c and x.user_id = m.user_id and x.status = 'active' and x.role in ('president', 'bureau'))
       and p.volunteer_answered_at is null)
      or ((select supporters_volunteer from clubs where id = c) and not has_real_role(c, m.user_id) and p.supporter_volunteer is null));
$$;
create or replace function volunteer_ask_state(p_club uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_area(p_club, 'evenements') then raise exception 'Réservé au président et au correspondant rencontres'; end if;
  return jsonb_build_object(
    'bureau', (select count(*) from volunteer_ask_targets(p_club) t where has_real_role(p_club, t)),
    'supporters', (select count(*) from volunteer_ask_targets(p_club) t where not has_real_role(p_club, t)),
    'asked_at', (select asked_at from club_volunteer_asks where club_id = p_club));
end $$;
create or replace function ask_volunteers(p_club uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; u uuid; cname text;
begin
  if not has_area(p_club, 'evenements') then raise exception 'Réservé au président et au correspondant rencontres'; end if;
  if exists(select 1 from club_volunteer_asks where club_id = p_club and asked_at > now() - interval '12 hours') then
    raise exception 'Relance de l''encart déjà faite il y a moins de 12 heures';
  end if;
  select name into cname from clubs where id = p_club;
  for u in select * from volunteer_ask_targets(p_club) loop
    update profiles set volunteer_asked_at = now() where id = u;
    perform push_enqueue(u, 'Bénévolat', coalesce(cname, 'Ton club') || ' te demande si tu veux être bénévole : réponds sur l''Accueil.', 'vask:' || p_club, 'vask:' || p_club || ':' || to_char(now(), 'YYYYMMDDHH24'));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Personne à relancer : tout le monde a déjà répondu'; end if;
  insert into club_volunteer_asks(club_id, asked_at, asked_by) values (p_club, now(), auth.uid())
    on conflict (club_id) do update set asked_at = excluded.asked_at, asked_by = excluded.asked_by;
  perform log_action(p_club, null, null, 'relance de l''encart bénévole', jsonb_build_object('personnes', n));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3. N° 142 (b) · missions ouvertes aux jeunes à partir de U13 (jamais la buvette), le parent inscrit son enfant
-- ---------------------------------------------------------------------
alter table event_missions add column if not exists youth boolean not null default false;
create table if not exists mission_youth_signups (
  mission_id uuid not null references event_missions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  at timestamptz not null default now(),
  primary key (mission_id, player_id)
);
create index if not exists mission_youth_signups_player on mission_youth_signups(player_id);
alter table mission_youth_signups enable row level security;
drop policy if exists "jeunes bénévoles lisibles par les destinataires" on mission_youth_signups;
create policy "jeunes bénévoles lisibles par les destinataires" on mission_youth_signups for select
  using (exists(select 1 from event_missions mi where mi.id = mission_id and sees_event(mi.event_id)));
-- écriture seulement par volunteer_youth() et unassign_youth()

create or replace function is_buvette(l text) returns boolean language sql immutable as $$
  select coalesce(lower(l), '') like '%buvette%';
$$;
-- Catégorie U13 et plus (U13, U15, U17…, ou les noms : benjamins de 2e année exclus, minimes, cadets, juniors, seniors, loisirs)
create or replace function youth_category_ok(cat text) returns boolean language sql immutable as $$
  select case when coalesce(cat, '') ~* '^\s*u\s*[0-9]+' then substring(cat from '(?i)^\s*u\s*([0-9]+)')::int >= 13
              else coalesce(cat, '') ~* '(minime|cadet|junior|senior|loisir|adulte|espoir)' end;
$$;
-- Jeune qui peut aider sur ce rendez-vous : mineur du club, d'une équipe U13 et plus, concerné par le rendez-vous
create or replace function youth_can_help(eid uuid, pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e join players x on x.club_id = e.club_id
    where e.id = eid and x.id = pid and x.deleted_at is null and not e.cancelled
      and (x.birth_date is null or x.birth_date > current_date - interval '18 years')
      and exists(select 1 from teams t where t.deleted_at is null and youth_category_ok(coalesce(nullif(t.category, ''), t.name))
                 and (t.id = x.team_id or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = t.id)))
      and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))));
$$;
revoke execute on function youth_can_help(uuid, uuid), volunteer_ask_targets(uuid) from public, anon, authenticated;

-- Places prises sur une mission (adultes et jeunes)
create or replace function mission_taken(mid uuid) returns int language sql stable security definer set search_path = public as $$
  select ((select count(*) from mission_signups where mission_id = mid) + (select count(*) from mission_youth_signups where mission_id = mid))::int;
$$;
revoke execute on function mission_taken(uuid) from public, anon, authenticated;

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
  if mission_taken(p_mission) >= mi.slots then raise exception 'Complet'; end if;
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
  if mission_taken(p_mission) >= mi.slots then raise exception 'Complet'; end if;
  insert into mission_signups(mission_id, user_id, added_by) values (p_mission, p_user, auth.uid()) on conflict do nothing;
end $$;

-- Le parent inscrit (ou retire) son enfant de U13 et plus sur une mission ouverte aux jeunes
create or replace function volunteer_youth(p_mission uuid, p_player uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mi event_missions; e events;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not exists(select 1 from player_parents where player_id = p_player and user_id = auth.uid()) then raise exception 'Seul un parent inscrit son enfant'; end if;
  select * into mi from event_missions where id = p_mission;
  select * into e from events where id = mi.event_id;
  if mi.id is null or not sees_event(e.id) then raise exception 'Mission introuvable'; end if;
  if not p_on then delete from mission_youth_signups where mission_id = p_mission and player_id = p_player; return; end if;
  if not mi.youth or is_buvette(mi.label) then raise exception 'Cette mission n''est pas ouverte aux jeunes'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est passé ou annulé'; end if;
  if not youth_can_help(e.id, p_player) then raise exception 'Mission ouverte aux jeunes du club à partir de U13, concernés par ce rendez-vous'; end if;
  if exists(select 1 from mission_youth_signups s join event_missions m2 on m2.id = s.mission_id where m2.event_id = e.id and s.player_id = p_player) then
    raise exception 'Ton enfant a déjà une mission sur ce rendez-vous';
  end if;
  perform 1 from event_missions where id = p_mission for update;
  if mission_taken(p_mission) >= mi.slots then raise exception 'Complet'; end if;
  insert into mission_youth_signups(mission_id, player_id, added_by) values (p_mission, p_player, auth.uid());
end $$;
-- L'organisateur retire un jeune d'une mission
create or replace function unassign_youth(p_mission uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mi event_missions;
begin
  select * into mi from event_missions where id = p_mission;
  if mi.id is null or not can_manage_missions(mi.event_id) then raise exception 'Seul l''organisateur retire un bénévole'; end if;
  delete from mission_youth_signups where mission_id = p_mission and player_id = p_player;
end $$;

-- Missions par défaut : la case « jeunes dès U13 » est reprise, jamais pour la buvette
create or replace function add_default_missions(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; n int;
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur ajoute des missions'; end if;
  perform set_config('pc.mdefault', 'on', true);
  insert into event_missions(event_id, label, slots, position, youth)
    select p_event, x->>'label', greatest(1, least(20, coalesce((x->>'slots')::int, 1))), (row_number() over ())::int,
           coalesce((x->>'youth')::boolean, false) and not is_buvette(x->>'label')
    from clubs c, jsonb_array_elements(c.default_missions) x where c.id = e.club_id
      and not exists(select 1 from event_missions m where m.event_id = p_event and lower(m.label) = lower(x->>'label'));
  get diagnostics n = row_count;
  perform set_config('pc.mdefault', 'off', true);
  return n;
end $$;
-- Garde-fou des missions : le choix « jeunes » des missions par défaut a été fait par la rubrique Événements (seule à régler
-- les missions du club) : il est accepté quand il vient de add_default_missions, même si c'est un coach qui ajoute.
create or replace function event_missions_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from events where id = new.event_id and type in ('Match','Plateau','Tournoi','Événement','AG');
  if c is null then
    raise exception 'Les missions de bénévoles valent pour un match, un plateau, un tournoi, un événement ou une AG';
  end if;
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'Mission d''un autre rendez-vous'; end if;
  if tg_op = 'UPDATE' and new.slots < mission_taken(new.id) then
    raise exception 'Des bénévoles sont déjà inscrits : retire-les avant de réduire le nombre de places';
  end if;
  -- n° 142 : « jeunes dès U13 » coché seulement par la rubrique Événements (président, correspondant rencontres), jamais pour la buvette
  if new.youth and is_buvette(new.label) then raise exception 'La buvette reste fermée aux jeunes'; end if;
  if new.youth is distinct from (case when tg_op = 'UPDATE' then old.youth else false end)
     and auth.uid() is not null and not has_area(c, 'evenements')
     and not (tg_op = 'INSERT' and coalesce(current_setting('pc.mdefault', true), '') = 'on') then
    raise exception 'Ouvrir une mission aux jeunes : réservé au président et au correspondant rencontres';
  end if;
  if tg_op = 'UPDATE' and old.youth and not new.youth then delete from mission_youth_signups where mission_id = new.id; end if;
  return new;
end $$;
drop trigger if exists event_missions_guard on event_missions;
create trigger event_missions_guard before insert or update on event_missions for each row execute function event_missions_guard();

-- Missions par défaut : « youth » accepté dans la liste (au plus 12 missions, comme avant)
-- (la liste est déjà réservée à la rubrique Événements par le garde-fou des clubs de la 3.2)

-- ---------------------------------------------------------------------
-- 4. Droits d'exécution, puis fermeture au visiteur (règle de la 4.3.0)
-- ---------------------------------------------------------------------
revoke execute on function set_volunteer(boolean), set_supporter_volunteer(boolean) from public, anon;
revoke execute on function event_missions_guard() from public, anon, authenticated;
grant execute on function coach_candidates(uuid), set_team_coach(uuid, uuid, boolean), set_volunteer(boolean), set_supporter_volunteer(boolean),
  volunteer_ask_state(uuid), ask_volunteers(uuid), volunteer(uuid, boolean), assign_volunteer(uuid, uuid, boolean),
  volunteer_youth(uuid, uuid, boolean), unassign_youth(uuid, uuid), add_default_missions(uuid) to authenticated;

select close_visitor_functions();
