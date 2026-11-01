-- =====================================================================
-- Pocket Club · alpha 3.5.0 (mise à jour relançable sans risque) · nouveau look, appel en tuiles, n° 75 à 81
-- À installer APRÈS alpha_3_4_2.sql.
--   n° 75 : « Avez-vous vérifié vos heures ? » (président et trésorerie → coachs), heures figées après « C'est bon »
--   n° 76 : ordre des blocs de chaque espace, propre à chaque personne (préférences du compte)
--   n° 77 : score en fin de match, plateau ou tournoi (coach de l'équipe ou président), notification « Résultat »
--   n° 78 : équipe en entente avec un autre club (demande, invitation, joueurs du club partenaire hors trésorerie)
--   n° 80 : durée d'un rendez-vous (15 min à 6 h, ou toute la journée)
--   n° 81 : appel en tuiles : heure d'arrivée d'un retard ; statistique « sans réponse mais venu »
-- (n° 79, réponse pour toute la famille, ne demande rien à la base : la réponse d'un enfant est déjà commune aux deux parents.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 81 · appel : heure d'arrivée d'un retard
-- ---------------------------------------------------------------------
alter table attendance add column if not exists arrived_at timestamptz;

-- Statistiques : on garde la réponse au sondage et l'état final ; ajout de « sans réponse mais venu »
drop function if exists team_stats(uuid, date, date);
create function team_stats(p_team uuid, p_from date, p_to date)
returns table(player_id uuid, first_name text, last_name text, sessions int, present int, late int, absent int, answered int, yes_absent int, no_present int, unanswered_present int)
language sql stable security definer set search_path = public as $$
  select t.player_id, t.first_name, t.last_name,
    count(t.status)::int,
    count(*) filter (where t.status = 'present')::int,
    count(*) filter (where t.status = 'retard')::int,
    count(*) filter (where t.status = 'absent')::int,
    count(*) filter (where t.status is not null and t.answer is not null)::int,
    count(*) filter (where t.status = 'absent' and t.answer = 'oui')::int,
    count(*) filter (where t.status in ('present','retard') and t.answer = 'non')::int,
    count(*) filter (where t.status in ('present','retard') and t.answer is null)::int
  from team_attendance(p_team, p_from, p_to) t
  group by t.player_id, t.first_name, t.last_name
  order by t.last_name, t.first_name;
$$;

-- ---------------------------------------------------------------------
-- N° 80 · durée d'un rendez-vous et heure de fin
-- ---------------------------------------------------------------------
alter table events add column if not exists duration_min int;
alter table events add column if not exists all_day boolean not null default false;
do $$ begin
  alter table events add constraint events_duration_ok check (duration_min is null or (duration_min between 15 and 360 and duration_min % 15 = 0));
exception when duplicate_object then null; end $$;
-- Reprise sans perte : les rendez-vous déjà créés reçoivent la durée par défaut de leur type
update events set duration_min = case type when 'Entraînement' then 90 when 'Match' then 120 when 'Plateau' then 180 when 'Tournoi' then 360 else 120 end
  where duration_min is null and not all_day;

create or replace function push_ev_line(e events) returns text language sql stable set search_path = public as $$
  select e.title
         || case when e.opponents <> '' and position(lower(e.opponents) in lower(e.title)) = 0 then ' contre ' || e.opponents else '' end
         || ' · ' || push_when(e.starts_at)
         || case when e.all_day then ' (toute la journée)' when e.duration_min is not null then ' → ' || to_char((e.starts_at + make_interval(mins => e.duration_min)) at time zone 'Europe/Paris', 'HH24"h"MI') else '' end
         || case when e.place <> '' then ' · ' || e.place else '' end
         || ' (' || coalesce((select name from clubs where id = e.club_id), '') || ')';
$$;

-- Création : la durée (une série garde la même durée pour toutes ses séances)
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
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home, duration_min, all_day)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true),
           case when coalesce((p->>'all_day')::boolean, false) then null else nullif(p->>'duration_min', '')::int end, coalesce((p->>'all_day')::boolean, false)
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Une nouvelle durée refait apparaître un rendez-vous masqué, comme un changement d'heure
create or replace function events_touch() returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at or new.place is distinct from old.place or new.duration_min is distinct from old.duration_min
     or new.all_day is distinct from old.all_day or new.cancelled is distinct from old.cancelled or new.title is distinct from old.title then new.updated_at := now(); end if;
  return new;
end $$;

-- Un changement de durée prévient comme un changement d'heure
create or replace function push_on_event_update() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text; t text; b text;
begin
  if new.starts_at < now() - interval '1 hour' then return null; end if;
  if new.cancelled and not old.cancelled then
    k := 'evcancel:' || coalesce(new.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), new.id::text);
    t := 'Annulé'; b := push_ev_line(new);
  elsif not new.cancelled and old.cancelled then
    k := 'evback:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := 'De nouveau prévu'; b := push_ev_line(new);
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place
        or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := case when new.place is distinct from old.place and new.starts_at is not distinct from old.starts_at
                   and new.duration_min is not distinct from old.duration_min and new.all_day is not distinct from old.all_day
              then 'Nouveau lieu' else 'Nouvel horaire' end;
    b := push_ev_line(new);
  else return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_update on events;
create trigger push_event_update after update of cancelled, starts_at, place, duration_min, all_day on events for each row execute function push_on_event_update();

-- ---------------------------------------------------------------------
-- N° 77 · score en fin de match, plateau ou tournoi
-- ---------------------------------------------------------------------
alter table events add column if not exists scores jsonb;
alter table events add column if not exists score_by uuid references auth.users(id) on delete set null;
alter table events add column if not exists score_at timestamptz;
alter table events add column if not exists score_edited boolean not null default false;

-- Le score ne s'écrit que par set_score (coach de l'équipe ou président), jamais par une modification directe
create or replace function events_score_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('pc.score', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.scores := null; new.score_by := null; new.score_at := null; new.score_edited := false; return new; end if;
  if new.scores is distinct from old.scores or new.score_by is distinct from old.score_by or new.score_at is distinct from old.score_at or new.score_edited is distinct from old.score_edited then
    raise exception 'Le score se met avec « Mettre le score » (coach de l''équipe ou président)';
  end if;
  return new;
end $$;
drop trigger if exists events_score_guard on events;
create trigger events_score_guard before insert or update on events for each row execute function events_score_guard();

-- Personnes liées à l'équipe : joueurs, parents des joueurs, coachs de l'équipe, supporteurs qui la suivent
create or replace function team_people(ts uuid[]) returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    select m.user_id u from memberships m where m.status = 'active' and m.team_id = any(ts) and m.role in ('coach','joueur','parent')
    union select f.user_id from team_follows f where f.team_id = any(ts)
    union select p.user_id from players p where p.deleted_at is null and p.user_id is not null
      and (p.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(ts)))
    union select pp.user_id from player_parents pp join players p on p.id = pp.player_id where p.deleted_at is null
      and (p.team_id = any(ts) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(ts)))
  ) z where u is not null;
$$;
revoke execute on function team_people(uuid[]) from public, anon, authenticated;

-- p_lines : [{ "opponent": "Lardy", "us": 54, "them": 48, "forfeit": false }, …] ; tableau vide = retirer le score
create or replace function set_score(p_event uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e events; l jsonb; clean jsonb := '[]'::jsonb; u uuid; w int := 0; lo int := 0; d int := 0; body text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if not can_call_roll(p_event) then raise exception 'Le score est mis par le coach de l''équipe (ou le président)'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'Score seulement pour un match, un plateau ou un tournoi'; end if;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if e.starts_at > now() then raise exception 'Le score se met une fois la rencontre commencée'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 20 then raise exception 'Vingt rencontres au plus'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((l->>'us')::int, -1) not between 0 and 999 or coalesce((l->>'them')::int, -1) not between 0 and 999 then raise exception 'Score invalide (0 à 999)'; end if;
    if length(trim(coalesce(l->>'opponent', ''))) > 80 then raise exception 'Nom de l''adversaire trop long'; end if;
    clean := clean || jsonb_build_object('opponent', trim(coalesce(l->>'opponent', '')), 'us', (l->>'us')::int, 'them', (l->>'them')::int, 'forfeit', coalesce((l->>'forfeit')::boolean, false));
    if (l->>'us')::int > (l->>'them')::int then w := w + 1; elsif (l->>'us')::int < (l->>'them')::int then lo := lo + 1; else d := d + 1; end if;
  end loop;
  perform set_config('pc.score', 'on', true);
  update events set scores = case when jsonb_array_length(clean) = 0 then null else clean end,
    score_by = case when jsonb_array_length(clean) = 0 then null else auth.uid() end,
    score_at = case when jsonb_array_length(clean) = 0 then null else now() end,
    score_edited = (e.scores is not null and jsonb_array_length(clean) > 0)
    where id = p_event;
  perform set_config('pc.score', 'off', true);
  if e.scores is not null then perform log_action(e.club_id, null, null, 'Score modifié', jsonb_build_object('rendez_vous', e.title, 'avant', e.scores, 'après', clean)); end if;
  -- Une seule notification « Résultat » par rendez-vous (pas à la correction)
  if jsonb_array_length(clean) > 0 and e.scores is null then
    body := case when jsonb_array_length(clean) = 1
      then (case when w = 1 then 'Victoire ' when lo = 1 then 'Défaite ' else 'Nul ' end) || (clean->0->>'us') || ' – ' || (clean->0->>'them')
           || case when clean->0->>'opponent' <> '' then ' contre ' || (clean->0->>'opponent') else '' end
      else e.type || ' · ' || w || ' victoire' || case when w > 1 then 's' else '' end || ', ' || lo || ' défaite' || case when lo > 1 then 's' else '' end
           || case when d > 0 then ', ' || d || ' nul' || case when d > 1 then 's' else '' end else '' end end;
    for u in select * from team_people(e.team_ids) where team_people is distinct from auth.uid() loop
      perform push_enqueue(u, 'Résultat · ' || coalesce((select string_agg(name, ', ') from teams where id = any(e.team_ids)), e.title), body, 'score:' || e.id, 'score:' || e.id);
    end loop;
  end if;
  return jsonb_array_length(clean);
end $$;
revoke execute on function set_score(uuid, jsonb) from public, anon;

-- ---------------------------------------------------------------------
-- N° 78 · équipe en entente avec un autre club
-- ---------------------------------------------------------------------
alter table teams add column if not exists partner_club_id uuid references clubs(id) on delete set null;
alter table teams add column if not exists partner_name text not null default '';
alter table teams add column if not exists partner_contact jsonb;
alter table teams add column if not exists partner_state text not null default 'aucune';
do $$ begin
  alter table teams add constraint teams_partner_state check (partner_state in ('aucune','demandee','acceptee','refusee','invitee'));
exception when duplicate_object then null; end $$;
alter table players add column if not exists from_partner boolean not null default false;

-- L'entente ne change que par set_team_partner / answer_partner
create or replace function teams_partner_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('pc.partner', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.partner_club_id := null; new.partner_name := ''; new.partner_contact := null; new.partner_state := 'aucune'; return new; end if;
  if new.partner_club_id is distinct from old.partner_club_id or new.partner_name is distinct from old.partner_name
     or new.partner_contact is distinct from old.partner_contact or new.partner_state is distinct from old.partner_state then
    raise exception 'L''entente se règle avec « Équipe en entente »';
  end if;
  return new;
end $$;
drop trigger if exists teams_partner_guard on teams;
create trigger teams_partner_guard before insert or update on teams for each row execute function teams_partner_guard();

-- Un joueur « du club partenaire » seulement dans une équipe en entente
create or replace function players_partner_guard() returns trigger language plpgsql as $$
begin
  if new.from_partner and not exists(select 1 from teams t where t.id = new.team_id and t.partner_state <> 'aucune') then new.from_partner := false; end if;
  return new;
end $$;
drop trigger if exists players_partner_guard on players;
create trigger players_partner_guard before insert or update of from_partner, team_id on players for each row execute function players_partner_guard();

-- Qui règle une entente : le coach de l'équipe, la rubrique Technique, le président
create or replace function set_team_partner(p_team uuid, p_club uuid, p_name text, p_contact jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare t teams; st text; u uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null then raise exception 'Équipe introuvable'; end if;
  if not (coaches_team(p_team) or has_area(t.club_id, 'technique') or is_president(t.club_id)) then raise exception 'Réservé au coach de l''équipe, à la Technique et au président'; end if;
  if p_club = t.club_id then raise exception 'Choisis un autre club que le tien'; end if;
  if p_club is not null then
    if not exists(select 1 from clubs where id = p_club) then raise exception 'Club introuvable'; end if;
    st := 'demandee';
  elsif length(trim(coalesce(p_name, ''))) > 0 then
    if length(trim(p_name)) > 80 then raise exception 'Nom du club trop long'; end if;
    st := 'invitee';
  else st := 'aucune'; end if;
  perform set_config('pc.partner', 'on', true);
  update teams set partner_club_id = p_club,
    partner_name = case when st = 'aucune' then '' when p_club is not null then coalesce((select name from clubs where id = p_club), '') else trim(p_name) end,
    partner_contact = case when st = 'invitee' then jsonb_build_object('name', left(coalesce(p_contact->>'name', ''), 80), 'email', left(coalesce(p_contact->>'email', ''), 120), 'phone', left(coalesce(p_contact->>'phone', ''), 30)) else null end,
    partner_state = st
    where id = p_team;
  perform set_config('pc.partner', 'off', true);
  if st = 'aucune' then update players set from_partner = false where team_id = p_team and from_partner; end if;
  perform log_action(t.club_id, null, null, case st when 'aucune' then 'Entente retirée' when 'demandee' then 'Entente demandée' else 'Entente : club invité' end,
    jsonb_build_object('équipe', t.name, 'club', case when p_club is not null then (select name from clubs where id = p_club) else trim(coalesce(p_name, '')) end));
  if st = 'demandee' then
    for u in select distinct m.user_id from memberships m where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau') and 'technique' = any(areas_of(p_club, m.user_id)) loop
      perform push_enqueue(u, 'Entente à valider', (select name from clubs where id = t.club_id) || ' propose l''équipe ' || t.name || ' en entente avec votre club', 'entente:' || t.id, 'entente:' || t.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    end loop;
  end if;
  return st;
end $$;
revoke execute on function set_team_partner(uuid, uuid, text, jsonb) from public, anon;

-- Réponse du club partenaire (président ou rubrique Technique)
create or replace function answer_partner(p_team uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare t teams; u uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or t.partner_club_id is null or t.partner_state not in ('demandee','acceptee','refusee') then raise exception 'Aucune demande d''entente'; end if;
  if not (is_president(t.partner_club_id) or has_area(t.partner_club_id, 'technique')) then raise exception 'Réservé au président et à la Technique du club partenaire'; end if;
  perform set_config('pc.partner', 'on', true);
  update teams set partner_state = case when p_accept then 'acceptee' else 'refusee' end where id = p_team;
  perform set_config('pc.partner', 'off', true);
  perform log_action(t.partner_club_id, null, null, case when p_accept then 'Entente acceptée' else 'Entente refusée' end, jsonb_build_object('équipe', t.name, 'club porteur', (select name from clubs where id = t.club_id)));
  for u in select distinct m.user_id from memberships m where m.status = 'active' and ((m.club_id = t.club_id and m.role = 'president') or (m.team_id = t.id and m.role = 'coach')) loop
    perform push_enqueue(u, case when p_accept then 'Entente acceptée' else 'Entente refusée' end, coalesce((select name from clubs where id = t.partner_club_id), '') || ' · ' || t.name, 'entente:' || t.id, 'entente-r:' || t.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;
  return case when p_accept then 'acceptee' else 'refusee' end;
end $$;
revoke execute on function answer_partner(uuid, boolean) from public, anon;

-- Ce que voit le club partenaire : les équipes en entente avec lui (club porteur, coachs, ses joueurs en « Prénom N. »)
create or replace function partner_teams(p_club uuid) returns table(team_id uuid, team_name text, host_club text, state text, coaches text, my_players text[], players_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_president(p_club) or has_area(p_club, 'technique')) then return; end if;
  return query
    select t.id, t.name, c.name, t.partner_state,
      coalesce((select string_agg(coalesce(nullif(trim(pr.first_name || ' ' || pr.last_name), ''), 'Coach'), ', ') from memberships m join profiles pr on pr.id = m.user_id where m.team_id = t.id and m.role = 'coach' and m.status = 'active'), ''),
      coalesce((select array_agg(p.first_name || ' ' || left(p.last_name, 1) || '.' order by p.last_name) from players p where p.team_id = t.id and p.from_partner and p.deleted_at is null), '{}'),
      (select count(*)::int from players p where p.team_id = t.id and p.deleted_at is null)
    from teams t join clubs c on c.id = t.club_id
    where t.partner_club_id = p_club and t.deleted_at is null and t.partner_state in ('demandee','acceptee','refusee')
    order by t.name;
end $$;
revoke execute on function partner_teams(uuid) from public, anon;

-- Les joueurs du club partenaire n'entrent jamais dans notre trésorerie
create or replace function remind_fee(p_player uuid) returns int
language plpgsql security definer set search_path = public as $$
declare x players; a player_admin; who uuid[];
begin
  select * into x from players where id = p_player and deleted_at is null;
  if x.id is null or not has_area(x.club_id, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
  if x.from_partner then raise exception 'Joueur du club partenaire : sa cotisation se règle dans son club'; end if;
  select * into a from player_admin where player_id = p_player;
  if a.fee_amount is null or a.fee_paid >= a.fee_amount then raise exception 'Rien à régler pour ce joueur'; end if;
  if exists(select 1 from announcements n where n.kind = 'cotisation' and n.club_id = x.club_id and n.body like '%' || x.id::text || '%' and n.created_at > now() - interval '7 days') then
    raise exception 'Rappel déjà envoyé cette semaine';
  end if;
  select coalesce(array_agg(distinct u), '{}') into who from (select user_id u from player_parents where player_id = p_player union select x.user_id) z where u is not null;
  if cardinality(who) = 0 then raise exception 'Aucun compte relié à cette fiche : contacte la famille directement'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, title, body)
    values (x.club_id, 'people', who, 'cotisation', 'Cotisation de ' || x.first_name || ' : reste ' || trim(to_char(a.fee_amount - a.fee_paid, 'FM999990D00')) || ' €',
            'Merci de régler le reste de la cotisation auprès du trésorier du club. Réf. ' || x.id::text);
  perform set_config('pc.announce', 'off', true);
  return cardinality(who);
end $$;

-- Décompte facturé par Pocket Club : joueurs de notre club seulement
create or replace function billable_players(p_club uuid) returns int language sql stable security definer set search_path = public as $$
  select case when is_board(p_club) then (select count(*)::int from players where club_id = p_club and deleted_at is null and not from_partner) else null end;
$$;
revoke execute on function billable_players(uuid) from public, anon;

-- ---------------------------------------------------------------------
-- N° 75 · « Avez-vous vérifié vos heures ? »
-- ---------------------------------------------------------------------
create table if not exists hours_checks (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  done_notified boolean not null default false,
  unique (club_id, month)
);
create table if not exists hours_confirms (
  check_id uuid not null references hours_checks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes int not null default 0,
  confirmed_at timestamptz,
  relanced_at timestamptz,
  primary key (check_id, user_id)
);
alter table hours_checks enable row level security;
alter table hours_confirms enable row level security;
create or replace function hours_manager(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_president(c) or has_area(c, 'tresorerie');
$$;
create or replace function hours_asked_me(k uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_confirms where check_id = k and user_id = auth.uid());
$$;
create or replace function hours_check_manager(k uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_checks where id = k and hours_manager(club_id));
$$;
drop policy if exists "demandes d'heures lues" on hours_checks;
create policy "demandes d'heures lues" on hours_checks for select
  using (hours_manager(club_id) or hours_asked_me(id));
drop policy if exists "confirmations lues" on hours_confirms;
create policy "confirmations lues" on hours_confirms for select
  using (user_id = auth.uid() or hours_check_manager(check_id));

create or replace function month_minutes(c uuid, u uuid, m date) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)::int from coach_hours where club_id = c and user_id = u and day >= m and day < (m + interval '1 month');
$$;

-- p_users vide ou null = tous les coachs du club
create or replace function ask_hours_check(p_club uuid, p_month date, p_users uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; k uuid; u uuid; n int := 0; lbl text;
begin
  if not hours_manager(p_club) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'Choisis un mois passé ou en cours'; end if;
  if exists(select 1 from hours_checks where club_id = p_club and month = m) then raise exception 'La vérification de ce mois est déjà demandée'; end if;
  insert into hours_checks(club_id, month, created_by) values (p_club, m, auth.uid()) returning id into k;
  lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from m)::int];
  for u in select distinct ms.user_id from memberships ms where ms.club_id = p_club and ms.status = 'active' and ms.role = 'coach'
           and (p_users is null or cardinality(p_users) = 0 or ms.user_id = any(p_users)) loop
    insert into hours_confirms(check_id, user_id, minutes) values (k, u, month_minutes(p_club, u, m));
    perform push_enqueue(u, 'Heures à vérifier', 'As-tu vérifié tes heures de ' || lbl || ' ? ' || replace(trim(to_char(month_minutes(p_club, u, m) / 60.0, 'FM9990.0')), '.', ',') || ' h déclarées', 'hours:' || k, 'hours:' || k);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Aucun coach à qui demander'; end if;
  perform log_action(p_club, null, null, 'Vérification des heures demandée', jsonb_build_object('mois', lbl || ' ' || extract(year from m), 'coachs', n));
  return n;
end $$;
revoke execute on function ask_hours_check(uuid, date, uuid[]) from public, anon;

create or replace function confirm_hours(p_check uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k hours_checks; left_n int; u uuid; lbl text;
begin
  select * into k from hours_checks where id = p_check;
  if k.id is null or not exists(select 1 from hours_confirms where check_id = p_check and user_id = auth.uid()) then raise exception 'Aucune vérification demandée'; end if;
  update hours_confirms set confirmed_at = coalesce(confirmed_at, now()), minutes = month_minutes(k.club_id, auth.uid(), k.month) where check_id = p_check and user_id = auth.uid();
  select count(*) into left_n from hours_confirms where check_id = p_check and confirmed_at is null;
  if left_n = 0 and not k.done_notified then
    update hours_checks set done_notified = true where id = p_check;
    lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from k.month)::int];
    for u in select distinct m.user_id from memberships m where m.club_id = k.club_id and m.status = 'active' and m.role in ('president','bureau') and (m.role = 'president' or 'tresorerie' = any(areas_of(k.club_id, m.user_id))) loop
      perform push_enqueue(u, 'Heures vérifiées', 'Tous les coachs ont vérifié leurs heures de ' || lbl || ' : vous pouvez faire les comptes', 'hours-done:' || k.id, 'hours-done:' || k.id);
    end loop;
  end if;
  return left_n;
end $$;
revoke execute on function confirm_hours(uuid) from public, anon;

-- Relance d'un coach qui n'a pas confirmé : une fois par jour au plus
create or replace function relance_hours(p_check uuid, p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare k hours_checks; u uuid; n int := 0;
begin
  select * into k from hours_checks where id = p_check;
  if k.id is null or not hours_manager(k.club_id) then raise exception 'Réservé au président et à la trésorerie'; end if;
  for u in select user_id from hours_confirms where check_id = p_check and confirmed_at is null and (p_user is null or user_id = p_user)
           and (relanced_at is null or relanced_at < now() - interval '1 day') loop
    update hours_confirms set relanced_at = now() where check_id = p_check and user_id = u;
    perform push_enqueue(u, 'Rappel : heures à vérifier', 'Le club attend ta confirmation de tes heures', 'hours:' || k.id, 'hours-r:' || k.id || ':' || u || ':' || to_char(now(), 'YYYYMMDD'));
    n := n + 1;
  end loop;
  if n = 0 and p_user is not null then raise exception 'Relance déjà faite aujourd''hui'; end if;
  return n;
end $$;
revoke execute on function relance_hours(uuid, uuid) from public, anon;

-- Après « C'est bon », les heures du mois sont figées pour le coach (correction par le trésorier ou le président)
create or replace function hours_frozen(c uuid, u uuid, d date) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_confirms h join hours_checks k on k.id = h.check_id
                where k.club_id = c and h.user_id = u and k.month = date_trunc('month', d)::date and h.confirmed_at is not null);
$$;
create or replace function coach_hours_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and month_locked(old.club_id, old.user_id, old.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if tg_op in ('UPDATE','DELETE') and auth.uid() = old.user_id and hours_frozen(old.club_id, old.user_id, old.day) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.club_id := old.club_id; end if;
  if month_locked(new.club_id, new.user_id, new.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if auth.uid() = new.user_id and hours_frozen(new.club_id, new.user_id, new.day) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is not null and not coaches_team(new.team_id) then raise exception 'Tu n''encadres pas cette équipe'; end if;
  if new.day > current_date + 1 then raise exception 'On note les heures une fois faites'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- N° 76 · préférences du compte (ordre des blocs de chaque espace), retrouvées sur tous les appareils
-- ---------------------------------------------------------------------
create table if not exists user_prefs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 80),
  value jsonb not null default '[]'::jsonb check (length(value::text) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table user_prefs enable row level security;
drop policy if exists "préférences personnelles" on user_prefs;
create policy "préférences personnelles" on user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
