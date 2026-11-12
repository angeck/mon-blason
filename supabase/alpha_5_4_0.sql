-- mypocketclub · alpha 5.4.0 · mise à jour d'une base 5.3.1, sans perte de données, relançable.
-- Lot A du 12 novembre 2026 (« go » de Gaël, 10 h 03) :
--   1. Saison : la valeur par défaut d'une équipe ou d'un tarif suit la date (1er juillet au 30 juin), plus « 2026-2027 » écrit en dur.
--   2. N° 158 (suite) · renforts ciblés : un renfort accepté ne voit plus tous les rendez-vous de l'équipe qu'il renforce,
--      seulement ceux où le coach l'invite (« avec tous les renforts », renforts choisis, ou convoqué nommément).
--      Les annonces de l'équipe ne lui parviennent plus non plus.
--   3. N° 167 · un doublon d'exercice signalé prévient ceux qui décident (Directeur technique et président, ou l'administrateur).
--   4. N° 183 · droit à l'image : le choix d'un parent qui n'est plus relié à l'enfant ne compte plus.
--   5. N° 182 · rappel par e-mail au président, 7 jours avant la date limite de validation (envoyé par la fonction envoyer-email).
--   6. Transférer une convocation reçue à des personnes choisies du club (date, heure, lieu ; jamais le contact de l'autre club).
--   7. N° 201 · conversation avec un mineur : l'adulte ajoute un parent (choisi ou invité par e-mail) ; la conversation
--      n'est créée qu'une fois le parent inscrit et d'accord. Refus ou silence de 14 jours : annulée, le créateur est prévenu.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. Saison par défaut (season_label vient de la 5.3.0)
-- ---------------------------------------------------------------------
alter table teams alter column season set default season_label(now());
alter table fee_grid alter column season set default season_label(now());

-- ---------------------------------------------------------------------
-- 2. N° 158 (suite) · renforts ciblés
-- ---------------------------------------------------------------------
-- reinforcements : 'aucun' (l'équipe seule), 'tous' (avec tous les renforts acceptés), 'choisis' (reinforcement_players)
alter table events add column if not exists reinforcements text not null default 'aucun';
alter table events add column if not exists reinforcement_players uuid[] not null default '{}';
do $$ begin
  alter table events add constraint events_reinforcements_check check (reinforcements in ('aucun','tous','choisis'));
exception when duplicate_object then null; end $$;

create or replace function events_reinforcements_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.audience <> 'team' then new.reinforcements := 'aucun'; new.reinforcement_players := '{}'; return new; end if;
  if new.reinforcements <> 'choisis' then new.reinforcement_players := '{}'; end if;
  -- seuls les renforts acceptés de l'équipe restent (un renfort retiré depuis ne bloque pas une modification)
  if tg_op = 'INSERT' or new.reinforcement_players is distinct from old.reinforcement_players then
    if exists(select 1 from unnest(new.reinforcement_players) x
              where (tg_op = 'INSERT' or not (x = any(old.reinforcement_players)))
                and not exists(select 1 from team_reinforcements r where r.player_id = x and r.team_id = any(new.team_ids) and r.state = 'accepte')) then
      raise exception 'Un renfort choisi n''est pas un renfort accepté de l''équipe';
    end if;
  end if;
  new.reinforcement_players := array(select distinct x from unnest(new.reinforcement_players) x
    where exists(select 1 from team_reinforcements r where r.player_id = x and r.team_id = any(new.team_ids) and r.state = 'accepte'));
  if new.reinforcements = 'choisis' and cardinality(new.reinforcement_players) = 0 then new.reinforcements := 'aucun'; end if;
  return new;
end $$;
drop trigger if exists events_reinforcements_guard on events;
create trigger events_reinforcements_guard before insert or update on events for each row execute function events_reinforcements_guard();

-- Comme in_team, sans le lien d'un renfort : le renfort n'est pas « dans l'équipe » pour ses rendez-vous et ses annonces
create or replace function in_team_regular(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and team_visible(t) and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where p.deleted_at is null
              and (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t
                                           and not exists(select 1 from team_reinforcements r where r.player_id = p.id and r.team_id = t and r.state = 'accepte')))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
-- Le compte (joueur ou parent) est-il invité à ce rendez-vous au titre d'un renfort ?
create or replace function reinforcement_invited(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e
    join team_reinforcements r on r.team_id = any(e.team_ids) and r.state = 'accepte'
    join players p on p.id = r.player_id and p.deleted_at is null
    where e.id = eid and e.audience = 'team'
      and (e.reinforcements = 'tous' or r.player_id = any(e.reinforcement_players) or r.player_id = any(e.convoked))
      and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid())));
$$;
revoke execute on function in_team_regular(uuid), reinforcement_invited(uuid) from public, anon;
grant execute on function in_team_regular(uuid), reinforcement_invited(uuid) to authenticated;

-- Reprise de la 3.6.0 : seule la ligne « équipe » change (in_team_regular, plus l'invitation des renforts)
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or (e.audience = 'club' and (e.with_supporters or has_real_role(e.club_id, auth.uid())))
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team_regular(t)))
    or (e.audience = 'team' and reinforcement_invited(e.id))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and auth.uid() = any(a.people))));
$$;

-- Reprise de la 3.2 : les annonces d'une équipe ne vont pas à ses renforts
create or replace function sees_announcement(aid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from announcements a where a.id = aid and a.deleted_at is null and is_member(a.club_id) and (
    a.created_by = auth.uid()
    or a.audience = 'club'
    or (a.audience = 'team' and (exists(select 1 from unnest(a.team_ids) t where in_team_regular(t)) or is_board(a.club_id)))
    or (a.audience = 'board' and is_board(a.club_id))
    or (a.audience in ('coaches','board_coaches') and (is_coach_in(a.club_id) or is_board(a.club_id)))
    or (a.audience = 'people' and auth.uid() = any(a.people))));
$$;

-- Reprise de la 3.6.0, avec le choix des renforts
create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  rf uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'reinforcement_players', '[]'))::uuid), '{}');
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
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home, duration_min, all_day, with_supporters,
                     reinforcements, reinforcement_players)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true),
           case when coalesce((p->>'all_day')::boolean, false) then null else nullif(p->>'duration_min', '')::int end, coalesce((p->>'all_day')::boolean, false),
           case when aud = 'club' then coalesce((p->>'with_supporters')::boolean, false) else true end,
           coalesce(nullif(p->>'reinforcements', ''), 'aucun'), rf
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Renforts ajoutés après la création : leurs familles sont prévenues (une fois par rendez-vous)
create or replace function push_on_event_reinforcements() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; b text; added uuid[];
begin
  if new.cancelled or new.starts_at < now() or new.audience <> 'team' then return null; end if;
  added := array(select r.player_id from team_reinforcements r
                 where r.team_id = any(new.team_ids) and r.state = 'accepte'
                   and (new.reinforcements = 'tous' or r.player_id = any(new.reinforcement_players))
                   and not (old.audience = 'team' and (old.reinforcements = 'tous' or r.player_id = any(old.reinforcement_players) or r.player_id = any(old.convoked))));
  if cardinality(added) = 0 then return null; end if;
  b := push_ev_line(new);
  for u in select y from push_event_targets(new.id, auth.uid(), false, true) y
           where exists(select 1 from players p where p.id = any(added) and p.deleted_at is null
                        and (p.user_id = y or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = y))) loop
    perform push_enqueue(u, 'Renfort : ' || lower(new.type), b, 'ev:' || new.id, 'evreinf:' || new.id || ':' || u);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_reinforcements on events;
create trigger push_event_reinforcements after update of reinforcements, reinforcement_players on events
  for each row execute function push_on_event_reinforcements();
revoke execute on function push_on_event_reinforcements(), events_reinforcements_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 167 · un doublon signalé prévient ceux qui décident
-- ---------------------------------------------------------------------
create or replace function report_duplicate(p_exercise uuid, p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a exercises; b exercises; did uuid; u uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi'; end if;
  if p_exercise = p_other then raise exception 'Choisis un autre exercice'; end if;
  select * into a from exercises where id = p_exercise and deleted_at is null;
  select * into b from exercises where id = p_other and deleted_at is null;
  if a.id is null or b.id is null or not can_see_exercise(a.id) or not can_see_exercise(b.id) then raise exception 'Exercice introuvable'; end if;
  if not exists(select 1 from memberships m where m.user_id = auth.uid() and m.status = 'active' and m.role in ('coach', 'president', 'bureau')) then
    raise exception 'Seuls les coachs et le bureau signalent un doublon';
  end if;
  if exists(select 1 from exercise_duplicates d where d.status = 'signale' and least(d.exercise_id, d.other_id) = least(p_exercise, p_other) and greatest(d.exercise_id, d.other_id) = greatest(p_exercise, p_other)) then
    raise exception 'Ce doublon est déjà signalé';
  end if;
  insert into exercise_duplicates(exercise_id, other_id, reported_by) values (p_exercise, p_other, auth.uid()) returning id into did;
  perform log_action(a.club_id, null, null, 'doublon d''exercice signalé', jsonb_build_object('exercice', a.title, 'autre', b.title));
  -- 5.4.0 · n° 167 : même règle que can_decide_duplicate (administrateur pour un exercice public validé, sinon DT et président du club)
  for u in
    select x.user_id from app_admins x where a.sharing = 'public' and a.public_state = 'validated'
    union
    select m.user_id from memberships m
     where not (a.sharing = 'public' and a.public_state = 'validated') and m.club_id = a.club_id and m.status = 'active'
       and (m.role = 'president' or 'technique' = any(areas_of(a.club_id, m.user_id)))
  loop
    if u is distinct from auth.uid() then
      perform push_enqueue(u, 'Doublon d''exercice signalé', left(a.title, 60) || ' ressemble à ' || left(b.title, 60) || '. À trancher dans Exercices.', 'doublon', 'dup:' || did || ':' || u);
    end if;
  end loop;
end $$;
revoke execute on function report_duplicate(uuid, uuid) from public, anon;
grant execute on function report_duplicate(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. N° 183 · droit à l'image : seuls comptent les choix des personnes qui ont encore le droit de décider
-- ---------------------------------------------------------------------
-- Compte : un parent relié à l'enfant, le joueur lui-même (sa propre fiche) ou le bureau du club (réglage fait pour la famille).
create or replace function image_voter_valid(pl players, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = pl.user_id
      or exists(select 1 from player_parents pp where pp.player_id = pl.id and pp.user_id = u)
      or exists(select 1 from memberships m where m.club_id = pl.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau'));
$$;
revoke execute on function image_voter_valid(players, uuid) from public, anon, authenticated;

-- Recalcule l'accord d'une fiche à partir des choix encore valables (p_new : le choix qui vient d'être fait, ou null)
create or replace function image_recompute(p_player uuid, p_user uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; cur jsonb; votes jsonb; eff boolean; yes boolean; no boolean; was boolean; u uuid; okv jsonb;
begin
  select * into pl from players where id = p_player;
  if not found then return; end if;
  cur := coalesce(pl.consents->'image', '{}'::jsonb);
  votes := coalesce(cur->'votes', '{}'::jsonb);
  if p_user is not null then votes := votes || jsonb_build_object(p_user::text, jsonb_build_object('ok', p_ok, 'at', now())); end if;
  -- les choix des personnes qui n'ont plus le droit de décider sont retirés (parent qui a quitté la famille, n° 183)
  select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb) into okv from jsonb_each(votes) v
    where v.key ~ '^[0-9a-f-]{36}$' and image_voter_valid(pl, v.key::uuid);
  yes := exists(select 1 from jsonb_each(okv) v where (v.value->>'ok')::boolean);
  no := exists(select 1 from jsonb_each(okv) v where not (v.value->>'ok')::boolean);
  eff := yes and not no;
  was := coalesce((cur->>'conflict')::boolean, false);
  if p_user is null and okv = votes then return; end if;   -- rien n'a changé
  perform set_config('pc.consent_rpc', 'on', true);
  update players set consents = consents || jsonb_build_object('image',
    jsonb_build_object('ok', eff, 'at', now(), 'by', coalesce(p_user, (cur->>'by')::uuid), 'votes', okv, 'conflict', yes and no)) where id = p_player;
  perform set_config('pc.consent_rpc', '', true);
  -- le président est prévenu d'un désaccord, sans motif ni échange
  if yes and no and not was then
    perform log_action(pl.club_id, null, p_player, 'désaccord sur le droit à l''image', '{}'::jsonb);
    for u in select m.user_id from memberships m where m.club_id = pl.club_id and m.role = 'president' and m.status = 'active' loop
      perform push_enqueue(u, 'Droit à l''image : désaccord', 'Les parents de ' || pl.first_name || ' ne sont pas d''accord. Le refus s''applique.',
        'imgdis', 'imgdis:' || p_player || ':' || floor(extract(epoch from now()))::text);
    end loop;
  end if;
end $$;
revoke execute on function image_recompute(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function apply_image_vote(p_player uuid, p_user uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform image_recompute(p_player, p_user, p_ok);
end $$;
revoke execute on function apply_image_vote(uuid, uuid, boolean) from public, anon, authenticated;

-- Un parent qui n'est plus relié à l'enfant : son choix ne compte plus
create or replace function player_parents_image_recompute() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform image_recompute(old.player_id, null, null);
  return null;
end $$;
drop trigger if exists player_parents_image_recompute on player_parents;
create trigger player_parents_image_recompute after delete on player_parents for each row execute function player_parents_image_recompute();
revoke execute on function player_parents_image_recompute() from public, anon, authenticated;

-- Reprise une seule fois : les fiches où un ancien parent avait voté
do $$ declare r record; begin
  for r in select p.id from players p where p.consents ? 'image' and jsonb_typeof(p.consents->'image'->'votes') = 'object' loop
    perform image_recompute(r.id, null, null);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. N° 182 · rappel par e-mail au président (7 jours avant la date limite)
-- ---------------------------------------------------------------------
-- Pas de tâche planifiée : à chaque ouverture de l'application par n'importe qui, l'écran demande s'il y a des rappels
-- à envoyer (oui / non, rien d'autre) ; si oui, il appelle envoyer-email, qui lit les adresses avec la clé du serveur.
alter table clubs add column if not exists valid_mailed_at timestamptz;
-- Le président qui change reçoit un nouveau rappel
create or replace function clubs_valid_mail_reset() returns trigger language plpgsql as $$
begin
  if new.valid_by is distinct from old.valid_by and new.valid_by > coalesce(old.valid_by, '-infinity'::timestamptz) then new.valid_mailed_at := null; end if;
  return new;
end $$;
drop trigger if exists clubs_valid_mail_reset on clubs;
create trigger clubs_valid_mail_reset before update of valid_by on clubs for each row execute function clubs_valid_mail_reset();

create or replace function validation_reminders_due() returns table(club_id uuid) language sql stable security definer set search_path = public as $$
  select c.id from clubs c
  where c.deleted_at is null and c.valid_mailed_at is null and c.valid_by between now() and now() + interval '7 days'
    and exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active')
    and not exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active' and president_validated(c.id, m.user_id));
$$;
revoke execute on function validation_reminders_due() from public, anon, authenticated;
-- Pour l'écran : oui ou non, sans aucune autre information
create or replace function validation_reminders_pending() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from validation_reminders_due());
$$;
revoke execute on function validation_reminders_pending() from public, anon;
grant execute on function validation_reminders_pending() to authenticated;
-- Pour la fonction envoyer-email seulement (clé du serveur) : chaque rappel n'est remis qu'une fois
create or replace function validation_reminders_take() returns table(club text, valid_by timestamptz, email text, first_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    with due as (
      update clubs c set valid_mailed_at = now() where c.id in (select d.club_id from validation_reminders_due() d)
      returning c.id, c.name, c.valid_by)
    select due.name, due.valid_by, lower(u.email)::text, coalesce(pr.first_name, '')::text
    from due join memberships m on m.club_id = due.id and m.role = 'president' and m.status = 'active'
    join auth.users u on u.id = m.user_id left join profiles pr on pr.id = m.user_id
    where u.email is not null;
end $$;
revoke execute on function validation_reminders_take() from public, anon, authenticated;
do $$ begin grant execute on function validation_reminders_take() to service_role; exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- 6. Transférer une convocation reçue à des personnes choisies du club
-- ---------------------------------------------------------------------
-- Ceux qui reçoivent le document (contact rencontres, président, contact de l'équipe concernée) le font suivre
-- dans le club : une annonce privée avec les matchs (titre, jour, heure, lieu). Le nom et les coordonnées du contact
-- de l'autre club n'y sont pas : ils restent dans le document, que lisent le coach et le bureau.
create or replace function forward_convocation(p_send uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; full_access boolean; lines text; who text; frm text; ppl uuid[];
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' or s.target_club_id is null then raise exception 'Document introuvable'; end if;
  full_access := receives_convocations(s.target_club_id);
  if not full_access and not contact_gets_send(p_send) then raise exception 'Document introuvable'; end if;
  ppl := array(select distinct u from unnest(coalesce(p_users, '{}')) u where u is distinct from auth.uid());
  if cardinality(ppl) = 0 then raise exception 'Choisis au moins une personne'; end if;
  if cardinality(ppl) > 100 then raise exception 'Cent personnes au plus'; end if;
  if exists(select 1 from unnest(ppl) u where not exists(select 1 from memberships m where m.club_id = s.target_club_id and m.user_id = u and m.status = 'active')) then
    raise exception 'Une personne choisie n''est pas membre du club';
  end if;
  select string_agg('• ' || coalesce(nullif(x->>'title', ''), 'Match')
           || coalesce(' (' || nullif(x->'team'->>'name', '') || ')', '')
           || ' · ' || push_when((x->>'starts_at')::timestamptz)
           || coalesce(' · ' || nullif(x->>'place', ''), ''), E'\n' order by (x->>'starts_at'))
    into lines
    from jsonb_array_elements(convocation_events_of(s.payload)) x
    where coalesce((x->>'cancelled')::boolean, false) = false and x->>'starts_at' is not null
      and (full_access or contact_matches_event(s.target_club_id, x));
  if lines is null then raise exception 'Aucun match à transmettre'; end if;
  select coalesce(first_name, 'Un membre du club') into who from profiles where id = auth.uid();
  select name into frm from clubs where id = s.club_id;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, title, body)
    values (s.target_club_id, 'people', ppl, 'annonce',
            left((case when s.step = 'P' then 'Pré-convocation' else 'Convocation' end) || ' de ' || coalesce(frm, 'un autre club'), 120),
            left(lines || E'\n\nTransmis par ' || coalesce(who, 'un membre du club') || '.', 3000));
  perform set_config('pc.announce', '', true);
  perform log_action(s.target_club_id, null, null, 'convocation transférée', jsonb_build_object('ref', s.ref, 'personnes', cardinality(ppl)));
  return cardinality(ppl);
end $$;
revoke execute on function forward_convocation(uuid, uuid[]) from public, anon;
grant execute on function forward_convocation(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 7. N° 201 · conversation avec un mineur : demande au parent
-- ---------------------------------------------------------------------
alter table parent_invitations add column if not exists purpose text not null default 'joueur';
alter table parent_invitations add column if not exists requested_by_name text;

create table if not exists group_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  player_id uuid not null references players(id) on delete cascade,      -- la fiche du mineur
  minor_user uuid not null references auth.users(id) on delete cascade,  -- son compte
  members uuid[] not null default '{}',                                   -- les autres adultes invités
  parent_user uuid references auth.users(id) on delete set null,          -- le parent choisi (sinon : tout parent relié)
  invitation_id uuid references parent_invitations(id) on delete set null,
  state text not null default 'attente' check (state in ('attente','acceptee','refusee','annulee','expiree')),
  group_id uuid references groups(id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references auth.users(id) on delete set null,
  last_reminded_at timestamptz
);
create index if not exists group_requests_player on group_requests(player_id) where state = 'attente';
alter table group_requests enable row level security;   -- aucune lecture directe : tout passe par les fonctions

-- Le parent qui peut répondre : relié à l'enfant, membre actif du club, et le parent choisi s'il y en a un
create or replace function group_request_answerer(r group_requests, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (r.parent_user is null or r.parent_user = u)
     and exists(select 1 from player_parents pp where pp.player_id = r.player_id and pp.user_id = u)
     and exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = u and m.status = 'active');
$$;
revoke execute on function group_request_answerer(group_requests, uuid) from public, anon, authenticated;

-- Le prénom d'un compte, pour les notifications
create or replace function first_name_of(u uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select first_name from profiles where id = u), ''), 'Un membre du club');
$$;
revoke execute on function first_name_of(uuid) from public, anon, authenticated;

-- Pour l'écran, avant de créer un groupe : les mineurs choisis qui n'ont aucun parent dans la liste, et leurs parents inscrits
create or replace function group_minor_check(p_club uuid, p_users uuid[]) returns table(user_id uuid, player_id uuid, first_name text, parents jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(p_club) then raise exception 'Connexion requise'; end if;
  if minor_account(p_club, auth.uid()) then return; end if;   -- un mineur qui écrit : la base vérifie seule (deux mineurs : libre)
  if supporter_only(p_club, auth.uid()) then return; end if;  -- un supporteur n'écrit jamais à un mineur : il n'apprend rien
  if cardinality(coalesce(p_users, '{}')) > 200 then raise exception 'Deux cents personnes au plus'; end if;
  return query
    select p.user_id, p.id, p.first_name,
           coalesce((select jsonb_agg(jsonb_build_object('user_id', pp.user_id, 'name', coalesce(pr.full_name, pr.first_name, 'Parent')) order by pr.first_name)
                     from player_parents pp left join profiles pr on pr.id = pp.user_id
                     where pp.player_id = p.id and exists(select 1 from memberships m where m.club_id = p_club and m.user_id = pp.user_id and m.status = 'active')), '[]'::jsonb)
    from players p
    where p.club_id = p_club and p.deleted_at is null and p.user_id = any(coalesce(p_users, '{}'))
      and exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p.user_id and m.status = 'active')
      and minor_account(p_club, p.user_id)
      and not exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = any(coalesce(p_users, '{}') || auth.uid()));
end $$;
revoke execute on function group_minor_check(uuid, uuid[]) from public, anon;
grant execute on function group_minor_check(uuid, uuid[]) to authenticated;

-- Créer la demande : un parent choisi (relié et inscrit) ou l'e-mail d'un parent à inviter
create or replace function request_minor_group(p_club uuid, p_name text, p_player uuid, p_parent uuid, p_email text, p_members uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl players; nm text := trim(coalesce(p_name, '')); em text := lower(trim(coalesce(p_email, ''))); own text; k int; rid uuid; iid uuid;
  mem uuid[]; me text;
begin
  if auth.uid() is null or not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'Connexion requise';
  end if;
  if minor_account(p_club, auth.uid()) then raise exception 'Cette demande est faite par un adulte'; end if;
  if supporter_only(p_club, auth.uid()) then raise exception 'Un supporteur ne peut pas échanger avec un mineur'; end if;
  if length(nm) not between 1 and 80 then raise exception 'Donne un nom au groupe'; end if;
  select * into pl from players where id = p_player and club_id = p_club and deleted_at is null;
  if pl.id is null or pl.user_id is null or not minor_account(p_club, pl.user_id)
     or not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = pl.user_id and m.status = 'active') then
    raise exception 'Ce joueur mineur n''a pas de compte dans le club';
  end if;
  mem := array(select distinct u from unnest(coalesce(p_members, '{}')) u where u is distinct from auth.uid() and u is distinct from pl.user_id and u is distinct from p_parent);
  if cardinality(mem) > 50 then raise exception 'Cinquante personnes au plus'; end if;
  if exists(select 1 from unnest(mem) u where not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = u and m.status = 'active')) then
    raise exception 'Une personne choisie n''est pas membre du club';
  end if;
  if exists(select 1 from unnest(mem) u where minor_account(p_club, u)) then raise exception 'Une demande concerne un seul mineur'; end if;
  if exists(select 1 from unnest(mem) u where supporter_only(p_club, u)) then raise exception 'Un supporteur ne peut pas être dans un groupe avec un mineur.'; end if;
  if exists(select 1 from group_requests r where r.created_by = auth.uid() and r.player_id = pl.id and r.state = 'attente') then
    raise exception 'Une demande pour ce joueur attend déjà la réponse du parent';
  end if;
  select count(*) into k from group_requests r where r.created_by = auth.uid() and r.state = 'attente';
  if k >= 10 then raise exception 'Dix demandes en attente au plus'; end if;
  if p_parent is not null then
    if not exists(select 1 from player_parents pp where pp.player_id = pl.id and pp.user_id = p_parent)
       or not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p_parent and m.status = 'active') then
      raise exception 'Ce parent n''est pas relié à ce joueur dans le club';
    end if;
  else
    if em !~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$' then raise exception 'Adresse e-mail non valide'; end if;
    select lower(email) into own from auth.users where id = auth.uid();
    if own = em then raise exception 'Indique l''e-mail d''un parent, pas le tien'; end if;
    if exists(select 1 from auth.users u where lower(u.email) = em and u.id = pl.user_id) then raise exception 'Indique l''e-mail d''un parent, pas celui du joueur'; end if;
    select count(*) into k from parent_invitations where player_id = pl.id and created_at > now() - interval '24 hours';
    if k >= 3 then raise exception 'Trois invitations par jour au maximum pour ce joueur : réessaie demain'; end if;
    me := first_name_of(auth.uid());
    insert into parent_invitations(club_id, player_id, email, token, created_by, purpose, requested_by_name)
      values (p_club, pl.id, em, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), auth.uid(), 'conversation', me)
      returning id into iid;
  end if;
  insert into group_requests(club_id, created_by, name, player_id, minor_user, members, parent_user, invitation_id)
    values (p_club, auth.uid(), nm, pl.id, pl.user_id, mem, p_parent, iid) returning id into rid;
  if p_parent is not null then
    perform push_enqueue(p_parent, 'Conversation avec ' || pl.first_name, first_name_of(auth.uid()) || ' souhaite échanger avec ' || pl.first_name
      || ' dans « ' || left(nm, 40) || ' ». Ton accord est demandé (onglet Messages).', 'grpreq', 'grpreq:' || rid);
  end if;
  perform log_action(p_club, p_parent, pl.id, 'conversation avec un mineur demandée', jsonb_build_object('groupe', nm, 'invitation', iid is not null));
  return jsonb_build_object('id', rid, 'invitation_id', iid);
end $$;
revoke execute on function request_minor_group(uuid, text, uuid, uuid, text, uuid[]) from public, anon;
grant execute on function request_minor_group(uuid, text, uuid, uuid, text, uuid[]) to authenticated;

-- Demandes sans réponse depuis 14 jours (durée du lien d'invitation) : annulées, le créateur est prévenu.
-- Les demandes finies sont effacées 30 jours après (comme l'adresse d'un parent invité).
create or replace function group_requests_tidy() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in update group_requests g set state = 'expiree', answered_at = now()
           where g.state = 'attente' and g.created_at < now() - interval '14 days'
           returning g.id, g.created_by, (select first_name from players where id = g.player_id) as child loop
    perform push_enqueue(r.created_by, 'Conversation annulée', 'Le parent de ' || coalesce(r.child, 'ce joueur') || ' n''a pas répondu sous 14 jours.', 'grpreq', 'grpexp:' || r.id);
  end loop;
  delete from group_requests where state <> 'attente' and coalesce(answered_at, created_at) < now() - interval '30 days';
end $$;
revoke execute on function group_requests_tidy() from public, anon, authenticated;

-- Ce que je vois : mes demandes (envoyées) et celles qui attendent ma réponse de parent
create or replace function my_group_requests(p_club uuid) returns table(id uuid, mine boolean, to_answer boolean, name text, child_first text, creator text,
  members text[], state text, created_at timestamptz, parent_label text, waiting_signup boolean, group_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(p_club) then return; end if;
  perform group_requests_tidy();
  return query
    select r.id, r.created_by = auth.uid(), r.state = 'attente' and group_request_answerer(r, auth.uid()), r.name, pl.first_name, first_name_of(r.created_by),
           array(select coalesce(pr.full_name, pr.first_name, '') from unnest(r.members) u left join profiles pr on pr.id = u),
           r.state, r.created_at,
           case when r.parent_user is not null then (select coalesce(pr.full_name, pr.first_name) from profiles pr where pr.id = r.parent_user)
                when r.invitation_id is not null then 'parent invité par e-mail' end,
           r.state = 'attente' and not exists(select 1 from player_parents pp join memberships m on m.user_id = pp.user_id and m.club_id = r.club_id and m.status = 'active'
                                               where pp.player_id = r.player_id and (r.parent_user is null or pp.user_id = r.parent_user)),
           r.group_id
    from group_requests r join players pl on pl.id = r.player_id
    where r.club_id = p_club and (r.created_by = auth.uid() or (r.state = 'attente' and group_request_answerer(r, auth.uid())))
    order by r.created_at desc;
end $$;
revoke execute on function my_group_requests(uuid) from public, anon;
grant execute on function my_group_requests(uuid) to authenticated;

-- Le parent répond. Oui : le groupe est créé avec le créateur, le parent, le mineur et les autres adultes.
create or replace function answer_group_request(p_id uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare r group_requests; gid uuid; child text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  perform group_requests_tidy();
  select * into r from group_requests where id = p_id for update;
  if r.id is null or r.state <> 'attente' then raise exception 'Cette demande n''attend plus de réponse'; end if;
  if not group_request_answerer(r, auth.uid()) then raise exception 'Seul un parent du joueur répond à cette demande'; end if;
  select first_name into child from players where id = r.player_id;
  if not coalesce(p_accept, false) then
    update group_requests set state = 'refusee', answered_at = now(), answered_by = auth.uid() where id = r.id;
    perform push_enqueue(r.created_by, 'Conversation annulée', 'Le parent de ' || coalesce(child, 'ce joueur') || ' a refusé la conversation « ' || left(r.name, 40) || ' ».', 'grpreq', 'grpno:' || r.id);
    perform log_action(r.club_id, r.created_by, r.player_id, 'conversation avec un mineur refusée par le parent', jsonb_build_object('groupe', r.name));
    return null;
  end if;
  if not exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = r.created_by and m.status = 'active') then
    update group_requests set state = 'annulee', answered_at = now(), answered_by = auth.uid() where id = r.id;
    raise exception 'La personne qui a fait la demande n''est plus dans le club';
  end if;
  insert into groups(club_id, name, created_by) values (r.club_id, r.name, r.created_by) returning id into gid;
  -- une seule requête : les règles du n° 186 sont vérifiées une fois tout le monde ajouté (parent compris)
  insert into group_members(group_id, user_id)
    select gid, u from (select distinct u from unnest(array[r.created_by, auth.uid(), r.minor_user] || array(
        select x from unnest(r.members) x where exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = x and m.status = 'active'))) u) z;
  update group_requests set state = 'acceptee', answered_at = now(), answered_by = auth.uid(), group_id = gid where id = r.id;
  perform push_enqueue(r.created_by, 'Conversation ouverte', 'Le parent de ' || coalesce(child, 'ce joueur') || ' a accepté : « ' || left(r.name, 40) || ' » est ouverte.', 'grpreq', 'grpyes:' || r.id);
  perform log_action(r.club_id, r.created_by, r.player_id, 'conversation avec un mineur acceptée par le parent', jsonb_build_object('groupe', r.name));
  return gid;
end $$;
revoke execute on function answer_group_request(uuid, boolean) from public, anon;
grant execute on function answer_group_request(uuid, boolean) to authenticated;

create or replace function cancel_group_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update group_requests set state = 'annulee', answered_at = now(), answered_by = auth.uid() where id = p_id and created_by = auth.uid() and state = 'attente';
  if not found then raise exception 'Cette demande n''attend plus de réponse'; end if;
end $$;
revoke execute on function cancel_group_request(uuid) from public, anon;
grant execute on function cancel_group_request(uuid) to authenticated;

-- Relance : notification au parent relié (au plus toutes les 12 heures)
create or replace function remind_group_request(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r group_requests; child text; u uuid; n int := 0;
begin
  select * into r from group_requests where id = p_id and created_by = auth.uid();
  if r.id is null or r.state <> 'attente' then raise exception 'Cette demande n''attend plus de réponse'; end if;
  if r.last_reminded_at > now() - interval '12 hours' then raise exception 'Relance déjà faite : réessaie dans quelques heures'; end if;
  select first_name into child from players where id = r.player_id;
  for u in select pp.user_id from player_parents pp where pp.player_id = r.player_id and group_request_answerer(r, pp.user_id) loop
    perform push_enqueue(u, 'Conversation avec ' || coalesce(child, 'ton enfant'), first_name_of(r.created_by) || ' attend ta réponse pour « ' || left(r.name, 40) || ' » (onglet Messages).',
      'grpreq', 'grprem:' || r.id || ':' || floor(extract(epoch from now()))::text);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Le parent n''est pas encore inscrit dans le club : il a reçu l''invitation par e-mail'; end if;
  update group_requests set last_reminded_at = now() where id = r.id;
  return n;
end $$;
revoke execute on function remind_group_request(uuid) from public, anon;
grant execute on function remind_group_request(uuid) to authenticated;

-- Un parent relié à l'enfant après coup (invitation acceptée, validée par le président) : il est prévenu des demandes en attente
create or replace function player_parents_group_requests() returns trigger language plpgsql security definer set search_path = public as $$
declare r group_requests;
begin
  for r in select * from group_requests g where g.player_id = new.player_id and g.state = 'attente' and (g.parent_user is null or g.parent_user = new.user_id) loop
    perform push_enqueue(new.user_id, 'Conversation avec ' || coalesce((select first_name from players where id = r.player_id), 'ton enfant'),
      first_name_of(r.created_by) || ' souhaite échanger avec ton enfant dans « ' || left(r.name, 40) || ' ». Ton accord est demandé (onglet Messages).', 'grpreq', 'grpreq:' || r.id || ':' || new.user_id);
  end loop;
  return null;
end $$;
drop trigger if exists player_parents_group_requests on player_parents;
create trigger player_parents_group_requests after insert on player_parents for each row execute function player_parents_group_requests();
revoke execute on function player_parents_group_requests() from public, anon, authenticated;

-- L'invitation par e-mail (5.3.0) sait maintenant dire pourquoi : joueur de 15 à 17 ans, ou conversation demandée par un adulte du club
create or replace function parent_invitation_take(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i parent_invitations; r jsonb;
begin
  select * into i from parent_invitations where id = p_id and created_by = auth.uid() and sent_at is null and used_at is null and expires_at > now();
  if i.id is null then return null; end if;
  update parent_invitations set sent_at = now() where id = i.id;
  select jsonb_build_object('email', i.email, 'token', i.token, 'expires_at', i.expires_at,
           'child_first', pl.first_name, 'club', c.name, 'purpose', i.purpose, 'requested_by', i.requested_by_name) into r
    from players pl join clubs c on c.id = pl.club_id where pl.id = i.player_id;
  return r;
end $$;
revoke execute on function parent_invitation_take(uuid) from public, anon;
grant execute on function parent_invitation_take(uuid) to authenticated;

select close_visitor_functions();
