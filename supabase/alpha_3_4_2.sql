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
