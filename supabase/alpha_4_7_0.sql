-- mypocketclub · alpha 4.7.0 · mise à jour d'une base 4.6.0, sans perte de données, relançable.
-- Récapitulatif de Gaël du 9 novembre 2026, seconde mise à jour du soir (« go pour tous les numéros + 147 », 20 h 05) :
-- 1. N° 165 : un rendez-vous masqué avec la réponse « oui » prévient quand même d'une annulation, d'une suppression
--    ou d'un changement de date ou d'heure (masqué sans réponse ou avec « non » : rien, comme avant).
-- 2. N° 154 : état des pré-convocations et convocations des rencontres à domicile des 7 prochains jours (convocation_todo).
-- 3. N° 147 : appareils connus de chaque compte ; un appareil nouveau prépare une alerte (e-mail « Nouvel appareil »
--    envoyé par la fonction envoyer-email) ; « Ce n'était pas moi » coupe toutes les connexions du compte (not_me_device).
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0) ; not_me_device reste ouverte au visiteur
-- (la personne qui touche le lien de l'e-mail n'est pas forcément connectée ; elle n'agit qu'avec le jeton de l'e-mail).

-- ---------------------------------------------------------------------
-- 1. N° 165 · rendez-vous masqué : « oui » garde l'annulation et le changement d'horaire
-- ---------------------------------------------------------------------
create or replace function push_event_targets(eid uuid, actor uuid, important boolean) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into e from events where id = eid; if e.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = e.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_event(eid)
       and (has_real_role(e.club_id, u) or e.audience = 'club' or (e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids)) or u = any(e.people))
       and (not exists(select 1 from event_hidden h where h.event_id = eid and h.user_id = u)
            or (important and exists(select 1 from event_responses r where r.event_id = eid and r.answer = 'oui'
                  and (r.user_id = u or exists(select 1 from player_parents pp where pp.player_id = r.player_id and pp.user_id = u)))))
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
create or replace function push_event_targets(eid uuid, actor uuid) returns setof uuid
language sql security definer set search_path = public as $$ select * from push_event_targets(eid, actor, false) $$;

create or replace function push_on_event_update() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text; t text; b text; imp boolean := false;
begin
  if new.starts_at < now() - interval '1 hour' then return null; end if;
  if new.cancelled and not old.cancelled then
    k := 'evcancel:' || coalesce(new.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), new.id::text);
    t := 'Annulé'; b := push_ev_line(new); imp := true;
  elsif not new.cancelled and old.cancelled then
    k := 'evback:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := 'De nouveau prévu'; b := push_ev_line(new);
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place
        or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    imp := new.starts_at is distinct from old.starts_at or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day;
    t := case when imp then 'Nouvel horaire' else 'Nouveau lieu' end;
    b := push_ev_line(new);
  else return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  for u in select * from push_event_targets(new.id, auth.uid(), imp) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;

create or replace function push_on_event_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evdel:' || coalesce(old.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), old.id::text);
begin
  if old.cancelled or old.starts_at < now() then return old; end if;
  if old.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return old; end if;
  for u in select * from push_event_targets(old.id, auth.uid(), true) loop
    perform push_enqueue(u, case when old.series_id is not null then 'Séances supprimées' else 'Annulé' end, push_ev_line(old), 'ev:' || old.id, k);
  end loop;
  return old;
end $$;

-- ---------------------------------------------------------------------
-- 2. N° 154 · rencontres à domicile des 7 prochains jours : pré-convocation et convocation envoyées ?
--    Une convocation vaut pour toutes les rencontres à domicile de la même semaine (référence du week-end).
-- ---------------------------------------------------------------------
create or replace function convocation_todo(p_club uuid) returns table(event_id uuid, p_sent boolean, c_sent boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_area(p_club, 'evenements') then raise exception 'Réservé au correspondant rencontres et au président'; end if;
  return query
    select e.id,
      exists(select 1 from convocation_sends s join events x on x.id = s.event_id where s.club_id = p_club and s.step = 'P' and s.status <> 'echec'
             and date_trunc('week', x.starts_at at time zone 'Europe/Paris') = date_trunc('week', e.starts_at at time zone 'Europe/Paris')),
      exists(select 1 from convocation_sends s join events x on x.id = s.event_id where s.club_id = p_club and s.step = 'C' and s.status <> 'echec'
             and date_trunc('week', x.starts_at at time zone 'Europe/Paris') = date_trunc('week', e.starts_at at time zone 'Europe/Paris'))
    from events e
    where e.club_id = p_club and not e.cancelled and e.at_home and e.audience = 'team' and e.type in ('Match','Plateau','Tournoi')
      and e.starts_at >= now() - interval '2 hours' and e.starts_at < now() + interval '7 days';
end $$;

-- ---------------------------------------------------------------------
-- 3. N° 147 · appareils connus et alerte « Nouvel appareil »
-- ---------------------------------------------------------------------
create table if not exists user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 64),
  label text not null default '' check (length(label) <= 80),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table user_devices enable row level security;
drop policy if exists "appareils : les siens" on user_devices;
create policy "appareils : les siens" on user_devices for select using (user_id = auth.uid());

create table if not exists device_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null default '',
  token text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  used_at timestamptz
);
alter table device_alerts enable row level security;   -- lecture et écriture seulement par les fonctions ci-dessous

-- Appelée à chaque ouverture connectée. Premier appareil d'un compte : enregistré sans alerte.
-- Appareil nouveau d'un compte qui en a déjà un : alerte préparée (5 au plus par jour et par compte).
create or replace function register_device(p_device text, p_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); had boolean; a uuid;
begin
  if u is null then raise exception 'Connecte-toi'; end if;
  if p_device is null or length(p_device) not between 8 and 64 then raise exception 'Appareil inconnu'; end if;
  if exists(select 1 from user_devices where user_id = u and device_id = p_device) then
    update user_devices set last_seen = now() where user_id = u and device_id = p_device;
    return jsonb_build_object('new', false);
  end if;
  had := exists(select 1 from user_devices where user_id = u);
  insert into user_devices(user_id, device_id, label) values (u, p_device, left(coalesce(p_label, ''), 80));
  if not had or (select count(*) from device_alerts where user_id = u and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('new', had, 'alert', null);
  end if;
  insert into device_alerts(user_id, device_label, token) values (u, left(coalesce(p_label, ''), 80), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) returning id into a;
  return jsonb_build_object('new', true, 'alert', a);
end $$;

-- Lue une seule fois, par la fonction envoyer-email, au nom du compte concerné : de quoi écrire l'e-mail
create or replace function device_alert_take(p_alert uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r device_alerts;
begin
  update device_alerts set sent_at = now() where id = p_alert and user_id = auth.uid() and sent_at is null and created_at > now() - interval '1 hour' returning * into r;
  if r.id is null then return null; end if;
  return jsonb_build_object('token', r.token, 'label', r.device_label, 'at', r.created_at);
end $$;

-- « Ce n'était pas moi » : coupe toutes les connexions du compte, oublie ses appareils connus.
-- Ensuite, la personne choisit un nouveau mot de passe (« Mot de passe oublié ? »).
create or replace function not_me_device(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r device_alerts;
begin
  select * into r from device_alerts where token = p_token and used_at is null and created_at > now() - interval '7 days';
  if r.id is null then return false; end if;
  update device_alerts set used_at = now() where id = r.id;
  delete from user_devices where user_id = r.user_id;
  begin
    delete from auth.sessions where user_id = r.user_id;
    delete from auth.refresh_tokens where user_id = r.user_id::text;
  exception when others then
    raise warning 'not_me_device : connexions non coupées (%)', sqlerrm;
  end;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 4. Droits d'exécution, puis fermeture au visiteur (not_me_device reste ouverte : lien de l'e-mail)
-- ---------------------------------------------------------------------
create or replace function close_visitor_functions() returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare f record; n int := 0; pol text; svc boolean := exists(select 1 from pg_roles where rolname = 'service_role');
  keep text[] := array['public_search_clubs', 'public_club', 'request_club', 'not_me_device'];
  shut text[] := array['due_for', 'grid_for', 'member_rank'];
begin
  select coalesce(string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' '), '') into pol from pg_policies;
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) loop
    continue when not has_function_privilege('anon', f.oid, 'execute');
    continue when f.proname = any(keep);
    continue when not (f.proname = any(shut)) and pol ~ ('\m' || f.proname || '\(');
    if has_function_privilege('authenticated', f.oid, 'execute') then execute format('grant execute on function %s to authenticated', f.oid::regprocedure); end if;
    if svc and has_function_privilege('service_role', f.oid, 'execute') then execute format('grant execute on function %s to service_role', f.oid::regprocedure); end if;
    execute format('revoke execute on function %s from public, anon', f.oid::regprocedure);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function close_visitor_functions() from public, anon, authenticated;

revoke execute on function push_event_targets(uuid, uuid, boolean), push_event_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function convocation_todo(uuid), register_device(text, text), device_alert_take(uuid) to authenticated;
grant execute on function not_me_device(text) to anon, authenticated;

select close_visitor_functions();
