-- =====================================================================
-- Pocket Club · alpha 3.4.1 (mise à jour relançable sans risque) · n° 59 à 68
-- À installer APRÈS alpha_3_4.sql.
--   n° 59 : un compte qui n'a que le rôle supporteur (dont un membre du bureau en attente de validation) ne répond pas
--           aux rendez-vous ; il n'est prévenu que des rendez-vous publics du club et des matchs des équipes qu'il suit
--   n° 62 : notification pour chaque demande à valider ; un téléphone peut rester inscrit pour plusieurs comptes de test
--   n° 66 : « Nouveau match prévu » ; « On cherche des bénévoles » ; option « Je participe au bénévolat du club »
--   n° 67 : relance des bénévoles vers tout le club, des équipes ou des personnes choisies (une fois toutes les 12 heures)
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 59 · réponses : jamais pour un compte qui n'est que supporteur (sauf invitation nominative)
-- ---------------------------------------------------------------------
create or replace function has_real_role(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role <> 'supporteur');
$$;
revoke execute on function has_real_role(uuid, uuid) from public, anon;

create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
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
    if cardinality(e.convoked) > 0 and not p_player = any(e.convoked) then raise exception 'Ce joueur n''est pas convoqué à ce rendez-vous'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if not has_real_role(e.club_id, auth.uid()) and not (e.audience = 'people' and auth.uid() = any(e.people)) then
      raise exception 'Un supporteur n''a pas de réponse à donner (ou ta demande attend la validation du club)';
    end if;
    if e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
       and not exists(select 1 from memberships where team_id = any(e.team_ids) and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and deleted_at is null and team_id = any(e.team_ids)) then
      raise exception 'Tu encadres cette équipe : pas de réponse pour toi-même';
    end if;
    if e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi') and not exists(select 1 from unnest(e.team_ids) t where in_team(t)) then
      raise exception 'Ce rendez-vous concerne une équipe dont tu ne fais pas partie';
    end if;
    if cardinality(e.convoked) > 0 and not exists(select 1 from players x where x.user_id = auth.uid() and x.id = any(e.convoked)) then
      raise exception 'Tu n''es pas convoqué à ce rendez-vous';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- Notifications de rendez-vous : un compte qui n'est que supporteur n'est prévenu que des rendez-vous de tout le club et des matchs des équipes qu'il suit
create or replace function push_event_targets(eid uuid, actor uuid) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into e from events where id = eid; if e.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = e.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_event(eid)
       and (has_real_role(e.club_id, u) or e.audience = 'club' or (e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids)) or u = any(e.people))
       and not exists(select 1 from event_hidden h where h.event_id = eid and h.user_id = u)
       and (cardinality(e.convoked) = 0 or is_board(e.club_id) or coaches_any(e.team_ids) or e.created_by = u
            or exists(select 1 from players p where p.id = any(e.convoked) and p.deleted_at is null
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))
            or not exists(select 1 from players p where p.deleted_at is null and p.club_id = e.club_id
                      and (p.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(e.team_ids)))
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))) then
      return next u;
    end if;
  end loop;
  perform push_restore(sub0, uid0);
end $$;

-- N° 66 · texte : « U13 contre Étampes · sam. 14/11 à 14h00 · Gymnase (Club) »
create or replace function push_ev_line(e events) returns text language sql stable set search_path = public as $$
  select e.title
         || case when e.opponents <> '' and position(lower(e.opponents) in lower(e.title)) = 0 then ' contre ' || e.opponents else '' end
         || ' · ' || push_when(e.starts_at) || case when e.place <> '' then ' · ' || e.place else '' end
         || ' (' || coalesce((select name from clubs where id = e.club_id), '') || ')';
$$;
create or replace function push_on_event_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evnew:' || coalesce(new.series_id::text, new.id::text); t text; b text;
begin
  if new.cancelled or new.starts_at < now() then return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  if new.series_id is not null then
    t := 'Nouveaux entraînements';
    b := new.title || ' · chaque ' || (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from new.starts_at at time zone 'Europe/Paris')::int + 1]
         || ' à ' || to_char(new.starts_at at time zone 'Europe/Paris', 'HH24"h"MI') || ', dès le ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM')
         || ' (' || coalesce((select name from clubs where id = new.club_id), '') || ')';
  else
    t := case when new.type in ('Match','Plateau','Tournoi') and cardinality(new.convoked) > 0 then 'Convocation : ' || lower(new.type)
              when new.type in ('Match','Plateau','Tournoi') then 'Nouveau ' || lower(new.type) || ' prévu'
              else 'Nouveau : ' || lower(new.type) end;
    b := push_ev_line(new);
  end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- N° 62 · un téléphone peut rester inscrit pour plusieurs comptes (option des comptes de test) ;
--         la notification porte alors le nom du profil
-- ---------------------------------------------------------------------
alter table push_subscriptions add column if not exists label text not null default '';
do $$ begin
  if exists(select 1 from pg_constraint where conname = 'push_subscriptions_pkey' and conrelid = 'push_subscriptions'::regclass and array_length(conkey, 1) = 1) then
    alter table push_subscriptions drop constraint push_subscriptions_pkey;
    alter table push_subscriptions add primary key (endpoint, user_id);
  end if;
end $$;
drop function if exists push_subscribe(text, text, text, text);
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_agent text default '', p_keep boolean default false, p_label text default '') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Adresse d''envoi invalide'; end if;
  if not coalesce(p_keep, false) then delete from push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid(); end if;
  insert into push_subscriptions(endpoint, user_id, p256dh, auth, agent, label)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_agent, ''), 200), left(coalesce(p_label, ''), 30))
  on conflict (endpoint, user_id) do update set p256dh = excluded.p256dh, auth = excluded.auth, agent = excluded.agent, label = excluded.label, last_seen_at = now();
  update push_subscriptions set p256dh = p_p256dh, auth = p_auth where endpoint = p_endpoint;
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by last_seen_at desc offset 10);
  return true;
end $$;
revoke execute on function push_subscribe(text, text, text, text, boolean, text) from public, anon;
grant execute on function push_subscribe(text, text, text, text, boolean, text) to authenticated;

create or replace function push_claim(p_limit int default 200) returns table(queue_id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select q.id from push_queue q
    where q.sent_at is null and q.tries < 5 and q.created_at > now() - interval '2 days'
    order by q.created_at limit greatest(1, least(p_limit, 1000)) for update skip locked
  ), upd as (
    update push_queue q set tries = q.tries + 1 from picked where q.id = picked.id returning q.*
  )
  select upd.id, s.endpoint, s.p256dh, s.auth,
         case when s.label <> '' and (select count(*) from push_subscriptions s2 where s2.endpoint = s.endpoint) > 1 then left(s.label || ' · ' || upd.title, 80) else upd.title end,
         upd.body, upd.url, upd.tag
  from upd join push_subscriptions s on s.user_id = upd.user_id;
end $$;
revoke execute on function push_claim(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- N° 62 · demandes à valider : prévenir ceux qui peuvent valider (vérifié à la fin de la transaction,
--         pour ne rien envoyer quand la demande est acceptée d'office)
-- ---------------------------------------------------------------------
create or replace function push_on_join() returns trigger language plpgsql security definer set search_path = public as $$
declare m memberships; u uuid; who text; what text; cname text; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into m from memberships where id = new.id;
  if m.id is null or m.status <> 'pending' then return null; end if;
  select coalesce(nullif(full_name, ''), 'Quelqu''un') into who from profiles where id = m.user_id;
  select name into cname from clubs where id = m.club_id;
  what := case m.role when 'parent' then 'parent de joueur' when 'bureau' then lower(coalesce(m.fonction, 'membre du bureau')) else m.role end
          || coalesce(' ' || (select name from teams where id = m.team_id), '');
  for u in select distinct mm.user_id from memberships mm join push_subscriptions s on s.user_id = mm.user_id
           where mm.club_id = m.club_id and mm.status = 'active' and mm.user_id <> m.user_id loop
    perform push_as(u);
    if can_validate(m.id) then
      perform push_enqueue(u, 'Demande à valider', coalesce(who, 'Quelqu''un') || ' : ' || what || ' (' || coalesce(cname, '') || ')', 'join:' || m.club_id, 'join:' || m.id);
    end if;
  end loop;
  perform push_restore(sub0, uid0);
  return null;
end $$;
drop trigger if exists push_join on memberships;
create constraint trigger push_join after insert on memberships deferrable initially deferred for each row execute function push_on_join();

-- ---------------------------------------------------------------------
-- N° 66 · « Je participe au bénévolat du club » (coché par défaut) ; le coordinateur et le président sont prévenus d'un changement
-- ---------------------------------------------------------------------
alter table profiles add column if not exists volunteer boolean not null default true;
create or replace function set_volunteer(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  update profiles set volunteer = coalesce(p_on, true) where id = auth.uid();
end $$;
revoke execute on function set_volunteer(boolean) from public, anon;
grant execute on function set_volunteer(boolean) to authenticated;
create or replace function push_on_volunteer() returns trigger language plpgsql security definer set search_path = public as $$
declare c record; u uuid; who text := coalesce(nullif(new.full_name, ''), 'Un membre');
begin
  if new.volunteer is not distinct from old.volunteer then return null; end if;
  for c in select distinct m.club_id, cl.name from memberships m join clubs cl on cl.id = m.club_id where m.user_id = new.id and m.status = 'active' and m.role <> 'supporteur' loop
    for u in select distinct mm.user_id from memberships mm where mm.club_id = c.club_id and mm.status = 'active' and mm.user_id <> new.id and 'evenements' = any(areas_of(c.club_id, mm.user_id)) loop
      perform push_enqueue(u, 'Bénévolat', who || case when new.volunteer then ' participe de nouveau au bénévolat du club' else ' ne souhaite plus être sollicité pour le bénévolat' end || ' (' || c.name || ')',
                           'vol:' || new.id, 'vol:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
    end loop;
  end loop;
  return null;
end $$;
drop trigger if exists push_volunteer on profiles;
create trigger push_volunteer after update of volunteer on profiles for each row execute function push_on_volunteer();
-- Liste des personnes qui ne souhaitent pas être sollicitées : rubrique Événements seulement (coordinateur, vice-président, président)
create or replace function volunteer_optouts(p_club uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select case when has_area(p_club, 'evenements') then coalesce(array_agg(distinct p.id), '{}') else '{}' end
  from profiles p join memberships m on m.user_id = p.id and m.club_id = p_club and m.status = 'active' where not p.volunteer;
$$;
revoke execute on function volunteer_optouts(uuid) from public, anon;
grant execute on function volunteer_optouts(uuid) to authenticated;

-- Peut être bénévole sur ce rendez-vous : règle du n° 53, plus toute personne relancée nominativement ou par équipe pour ce rendez-vous
create or replace function can_volunteer(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and not e.cancelled and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active') and (
    exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach'))
    or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and x.birth_date is not null and x.birth_date <= current_date - interval '18 years'
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and u = any(a.people))));
$$;

-- « On cherche des bénévoles » : une notification par rendez-vous dès qu'il a des missions (vérifié à la fin de la transaction)
create or replace function push_on_missions() returns trigger language plpgsql security definer set search_path = public as $$
declare e events; u uuid; n int; free int; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true); actor uuid := auth.uid();
begin
  select * into e from events where id = new.event_id;
  if e.id is null or e.cancelled or e.starts_at < now() then return null; end if;
  if exists(select 1 from push_queue where dedupe_key = 'benev:' || e.id) then return null; end if;
  select count(*), coalesce(sum(greatest(0, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id))), 0) into n, free from event_missions m where m.event_id = e.id;
  if free = 0 then return null; end if;
  for u in select distinct mm.user_id from memberships mm join push_subscriptions s on s.user_id = mm.user_id join profiles p on p.id = mm.user_id
           where mm.club_id = e.club_id and mm.status = 'active' and mm.user_id is distinct from actor and p.volunteer loop
    perform push_as(u);
    if sees_event(e.id) and can_volunteer(e.id, u)
       and not exists(select 1 from mission_signups s join event_missions m on m.id = s.mission_id where m.event_id = e.id and s.user_id = u) then
      perform push_enqueue(u, 'On cherche des bénévoles', e.title || ' · ' || push_when(e.starts_at) || ' · ' || n || case when n > 1 then ' missions à pourvoir' else ' mission à pourvoir' end,
                           'ev:' || e.id, 'benev:' || e.id);
    end if;
  end loop;
  perform push_restore(sub0, uid0);
  return null;
end $$;
drop trigger if exists push_missions on event_missions;
create constraint trigger push_missions after insert on event_missions deferrable initially deferred for each row execute function push_on_missions();

-- ---------------------------------------------------------------------
-- N° 67 · relance des bénévoles : le rendez-vous (comme avant), tout le club, des équipes, des personnes choisies
-- ---------------------------------------------------------------------
alter table events add column if not exists missions_reminded_at timestamptz;
create or replace function events_missions_guard() returns trigger language plpgsql as $$
begin
  if new.missions_reminded_at is distinct from old.missions_reminded_at and coalesce(current_setting('pc.mremind', true), '') <> 'on' then new.missions_reminded_at := old.missions_reminded_at; end if;
  return new;
end $$;
drop trigger if exists events_missions_guard on events;
create trigger events_missions_guard before update on events for each row execute function events_missions_guard();

-- Adulte du club qui peut aider : bureau, coach, parent d'un joueur, joueur majeur (jamais un supporteur seul ni un joueur mineur)
create or replace function club_helper(c uuid, u uuid, ts uuid[] default null) returns boolean language sql stable security definer set search_path = public as $$
  select not exists(select 1 from players x where x.user_id = u and x.club_id = c and x.deleted_at is null and (x.birth_date is null or x.birth_date > current_date - interval '18 years'))
    and (
      (ts is null and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach')))
      or (ts is not null and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'coach' and m.team_id = any(ts)))
      or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = c
                and (ts is null or x.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(ts))))
      or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = c and x.birth_date <= current_date - interval '18 years'
                and (ts is null or x.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(ts)))));
$$;
revoke execute on function club_helper(uuid, uuid, uuid[]) from public, anon, authenticated;

drop function if exists remind_missions(uuid);
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
  from memberships m join profiles p on p.id = m.user_id
  where m.club_id = e.club_id and m.status = 'active' and m.user_id <> auth.uid()
    and not exists(select 1 from mission_signups s join event_missions mi on mi.id = s.mission_id where mi.event_id = e.id and s.user_id = m.user_id)
    and case coalesce(p_target, 'event')
      when 'event' then p.volunteer and can_volunteer(e.id, m.user_id) and club_helper(e.club_id, m.user_id)
      when 'club' then p.volunteer and club_helper(e.club_id, m.user_id)
      when 'teams' then p.volunteer and club_helper(e.club_id, m.user_id, p_teams)
      else m.user_id = any(p_people) and club_helper(e.club_id, m.user_id) end;
  if who is null or cardinality(who) = 0 then raise exception 'Personne à relancer pour cette cible (déjà inscrits, mineurs, supporteurs ou bénévolat décoché)'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, event_id, title, body)
    values (e.club_id, 'people', who[1:500], 'missions', e.id,
            'Il manque ' || txt || ' pour ' || e.title,
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Ouvre le rendez-vous pour t''inscrire.');
  perform set_config('pc.announce', 'off', true);
  perform set_config('pc.mremind', 'on', true);
  update events set missions_reminded_at = now() where id = e.id;
  perform set_config('pc.mremind', 'off', true);
  insert into action_log(club_id, actor, action, detail)
    values (e.club_id, auth.uid(), 'relance_benevoles', jsonb_build_object('event', e.id, 'titre', e.title, 'cible', coalesce(p_target, 'event'), 'personnes', cardinality(who)));
  return txt;
end $$;
revoke execute on function remind_missions(uuid, text, uuid[], uuid[]) from public, anon;
grant execute on function remind_missions(uuid, text, uuid[], uuid[]) to authenticated;

-- N° 67 : une personne relancée pour les bénévoles d'un rendez-vous le voit, pour pouvoir s'inscrire
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or e.audience = 'club'
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team(t)))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and auth.uid() = any(a.people))));
$$;
