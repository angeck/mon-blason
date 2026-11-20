-- MAJ_BETA_1_5_0.sql · mypocketclub · bêta 1.5.0 · n° 276 (Gaël, 19 novembre 2026)
-- Heures des coachs : « Je corrige » puis « Envoyer » compte comme réponse (la carte et la pastille disparaissent) ;
-- un coach de plusieurs équipes reçoit UNE demande par équipe, qui s'effacent chacune leur tour.
-- À lancer une fois dans Supabase › SQL Editor › Run, d'abord sur la base de TEST. Sans perte de données, relançable sans risque.

-- ---------- Une ligne de confirmation par coach ET par équipe (équipe vide = ancienne ligne « tout le mois ») ----------
alter table hours_confirms add column if not exists team_id uuid references teams(id) on delete cascade;
alter table hours_confirms drop constraint if exists hours_confirms_pkey;
create unique index if not exists hours_confirms_uniq on hours_confirms (check_id, user_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- minutes d'un coach sur un mois, pour une équipe (équipe vide : tout le mois)
create or replace function month_minutes_team(c uuid, u uuid, m date, t uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)::int from coach_hours where club_id = c and user_id = u and day >= m and day < (m + interval '1 month') and (t is null or team_id = t);
$$;

-- ---------- Demande : une ligne par équipe encadrée, une seule notification par coach ----------
create or replace function ask_hours_check(p_club uuid, p_month date, p_users uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; k uuid; u uuid; t uuid; n int := 0; nt int; lbl text;
begin
  if not hours_manager(p_club) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'Choisis un mois passé ou en cours'; end if;
  if exists(select 1 from hours_checks where club_id = p_club and month = m) then raise exception 'La vérification de ce mois est déjà demandée'; end if;
  insert into hours_checks(club_id, month, created_by) values (p_club, m, auth.uid()) returning id into k;
  lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from m)::int];
  for u in select distinct ms.user_id from memberships ms where ms.club_id = p_club and ms.status = 'active' and ms.role = 'coach'
           and (p_users is null or cardinality(p_users) = 0 or ms.user_id = any(p_users)) loop
    nt := 0;
    for t in select distinct ms.team_id from memberships ms join teams x on x.id = ms.team_id
             where ms.club_id = p_club and ms.user_id = u and ms.status = 'active' and ms.role = 'coach' and x.deleted_at is null loop
      insert into hours_confirms(check_id, user_id, team_id, minutes) values (k, u, t, month_minutes_team(p_club, u, m, t));
      nt := nt + 1;
    end loop;
    if nt = 0 then insert into hours_confirms(check_id, user_id, team_id, minutes) values (k, u, null, month_minutes(p_club, u, m)); nt := 1; end if;
    perform push_enqueue(u, 'Heures à vérifier', 'As-tu vérifié tes heures de ' || lbl || ' ? ' || replace(trim(to_char(month_minutes(p_club, u, m) / 60.0, 'FM9990.0')), '.', ',') || ' h déclarées' || case when nt > 1 then ' (' || nt || ' équipes)' else '' end, 'hours:' || k, 'hours:' || k);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Aucun coach à qui demander'; end if;
  perform log_action(p_club, null, null, 'Vérification des heures demandée', jsonb_build_object('mois', lbl || ' ' || extract(year from m), 'coachs', n));
  return n;
end $$;
revoke execute on function ask_hours_check(uuid, date, uuid[]) from public, anon;

-- Quand plus personne n'attend : une notification au président et à la trésorerie (une seule fois)
create or replace function hours_after_confirm(p_check uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k hours_checks; left_n int; u uuid; lbl text;
begin
  select * into k from hours_checks where id = p_check;
  if k.id is null then return 0; end if;
  select count(distinct user_id) into left_n from hours_confirms where check_id = p_check and confirmed_at is null;
  if left_n = 0 and not k.done_notified then
    update hours_checks set done_notified = true where id = p_check;
    lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from k.month)::int];
    for u in select distinct m.user_id from memberships m where m.club_id = k.club_id and m.status = 'active' and m.role in ('president','bureau') and (m.role = 'president' or 'tresorerie' = any(areas_of(k.club_id, m.user_id))) loop
      perform push_enqueue(u, 'Heures vérifiées', 'Tous les coachs ont vérifié leurs heures de ' || lbl || ' : vous pouvez faire les comptes', 'hours-done:' || k.id, 'hours-done:' || k.id);
    end loop;
  end if;
  return left_n;
end $$;
revoke execute on function hours_after_confirm(uuid) from public, anon, authenticated;

-- « C'est bon » : pour une équipe (p_team) ou pour toutes les équipes du coach (p_team vide)
drop function if exists confirm_hours(uuid);
create or replace function confirm_hours(p_check uuid, p_team uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare k hours_checks;
begin
  select * into k from hours_checks where id = p_check;
  if k.id is null or not exists(select 1 from hours_confirms where check_id = p_check and user_id = auth.uid()) then raise exception 'Aucune vérification demandée'; end if;
  update hours_confirms set confirmed_at = coalesce(confirmed_at, now()), minutes = month_minutes_team(k.club_id, auth.uid(), k.month, team_id)
    where check_id = p_check and user_id = auth.uid() and (p_team is null or team_id = p_team);
  return hours_after_confirm(p_check);
end $$;
revoke execute on function confirm_hours(uuid, uuid) from public, anon;

-- Envoyer son relevé au bureau (après « Je corrige ») répond à toutes les demandes de ce mois
create or replace function submit_coach_month(p_club uuid, p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; tot int; k uuid;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  select coalesce(sum(minutes), 0) into tot from coach_hours where club_id = p_club and user_id = auth.uid() and day >= m and day < m + interval '1 month';
  if tot = 0 then raise exception 'Aucune heure notée ce mois-ci'; end if;
  insert into coach_statements(club_id, user_id, month, status, total_minutes, submitted_at)
    values (p_club, auth.uid(), m, 'submitted', tot, now())
    on conflict (club_id, user_id, month) do update set status = 'submitted', total_minutes = tot, submitted_at = now(), decided_by = null, decided_at = null
    where coach_statements.status = 'refused';
  if not found then raise exception 'Ce mois est déjà envoyé au bureau'; end if;
  for k in select c.id from hours_checks c where c.club_id = p_club and c.month = m and exists(select 1 from hours_confirms h where h.check_id = c.id and h.user_id = auth.uid()) loop
    update hours_confirms set confirmed_at = coalesce(confirmed_at, now()), minutes = month_minutes_team(p_club, auth.uid(), m, team_id)
      where check_id = k and user_id = auth.uid();
    perform hours_after_confirm(k);
  end loop;
end $$;

-- ---------- n° 278 · une action qui crée une pastille chez un autre le prévient, en direct ----------
-- Relevé d'heures envoyé au bureau : le président et la trésorerie (pas l'envoyeur) ; la notification ouvre l'onglet Heures
create or replace function notify_statement_sent() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; who text; lbl text;
begin
  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then return new; end if;
  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'Un coach') into who from profiles p where p.id = new.user_id;
  lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from new.month)::int];
  for u in select distinct m.user_id from memberships m where m.club_id = new.club_id and m.status = 'active' and m.role in ('president','bureau')
           and (m.role = 'president' or 'tresorerie' = any(areas_of(new.club_id, m.user_id))) and m.user_id <> new.user_id loop
    perform push_enqueue(u, 'Relevé d''heures à valider', coalesce(who, 'Un coach') || ' a envoyé ses heures de ' || lbl, 'hours-stmt', 'stmt:' || new.id || ':' || extract(epoch from coalesce(new.submitted_at, now()))::bigint, './#ouvrir=' || new.club_id || '.heures');
  end loop;
  return new;
end $$;
drop trigger if exists notify_statement_sent on coach_statements;
create trigger notify_statement_sent after insert or update on coach_statements for each row execute function notify_statement_sent();

-- Exercice partagé en public, à valider : le président et la direction technique (pas l'auteur) ; ouvre les exercices du club
create or replace function notify_exercise_pending() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.public_state <> 'pending' or (tg_op = 'UPDATE' and old.public_state = 'pending') then return new; end if;
  for u in select distinct m.user_id from memberships m where m.club_id = new.club_id and m.status = 'active' and m.role in ('president','bureau')
           and (m.role = 'president' or 'technique' = any(areas_of(new.club_id, m.user_id))) and m.user_id is distinct from new.created_by loop
    perform push_enqueue(u, 'Exercice à valider', left(new.title, 80), 'exo-pending', 'exval:' || new.id || ':' || extract(epoch from now())::bigint, './#ouvrir=' || new.club_id || '.exos');
  end loop;
  return new;
end $$;
drop trigger if exists notify_exercise_pending on exercises;
create trigger notify_exercise_pending after insert or update on exercises for each row execute function notify_exercise_pending();

-- ---------- Heures figées : pour l'équipe confirmée (ou toute ancienne confirmation « tout le mois ») ----------
drop function if exists hours_frozen(uuid, uuid, date);
create or replace function hours_frozen(c uuid, u uuid, d date, t uuid default null) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from hours_confirms h join hours_checks k on k.id = h.check_id
                where k.club_id = c and h.user_id = u and k.month = date_trunc('month', d)::date and h.confirmed_at is not null
                  and (h.team_id is null or t is null or h.team_id = t));
$$;
create or replace function coach_hours_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and month_locked(old.club_id, old.user_id, old.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if tg_op in ('UPDATE','DELETE') and auth.uid() = old.user_id and hours_frozen(old.club_id, old.user_id, old.day, old.team_id) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.club_id := old.club_id; end if;
  if month_locked(new.club_id, new.user_id, new.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if auth.uid() = new.user_id and hours_frozen(new.club_id, new.user_id, new.day, new.team_id) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is not null and not coaches_team(new.team_id) then raise exception 'Tu n''encadres pas cette équipe'; end if;
  if new.day > current_date + 1 then raise exception 'On note les heures une fois faites'; end if;
  return new;
end $$;

-- ---------- Notification d'essai : le nom de l'application (plus « Pocket Club ») ----------
create or replace function push_test() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select count(*) into n from push_subscriptions where user_id = auth.uid();
  if n = 0 then raise exception 'Aucun appareil inscrit : active d''abord les notifications'; end if;
  perform push_enqueue(auth.uid(), 'Essai mypocketclub', 'Les notifications marchent sur cet appareil.', 'test', 'test:' || to_char(now(), 'YYYYMMDDHH24MI'));
  return n;
end $$;
revoke execute on function push_test() from public, anon;
grant execute on function push_test() to authenticated;

select close_visitor_functions();
