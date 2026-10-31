-- MAJ_ALPHA_3_3.sql · Pocket Club · étape B 2 sur 5 (notifications) · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.2.4).
-- Ajoute les téléphones inscrits et la file des notifications, sans effacer de données. Peut être relancé sans risque.

-- =====================================================================
-- Pocket Club · alpha 3.3 · étape B 2 sur 5 : notifications (mise à jour relançable sans risque)
-- À installer APRÈS alpha_3_2_4.sql.
--   1. Les téléphones inscrits (un par appareil, rattaché au compte connecté)
--   2. La file des notifications à envoyer (vidée par la fonction d'envoi de l'étape 3)
--   3. Ce qui remplit la file : nouveaux rendez-vous, changements, annulations, annonces et relances,
--      messages et sondages des groupes
-- Règle d'or : une personne n'est prévenue que d'un rendez-vous ou d'une annonce qu'elle voit déjà dans l'application.
-- Pour le vérifier, la base pose la question « que voit cette personne ? » avec les mêmes règles que l'écran
-- (sees_event, sees_announcement), compte par compte, et seulement pour les comptes qui ont un téléphone inscrit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Téléphones inscrits
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  endpoint text primary key check (length(endpoint) between 10 and 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) between 10 and 200),
  auth text not null check (length(auth) between 8 and 100),
  agent text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;   -- aucune lecture directe : tout passe par les fonctions ci-dessous

-- L'appareil s'inscrit (ou se rattache au compte connecté s'il était inscrit pour un autre compte)
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_agent text default '') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Adresse d''envoi invalide'; end if;
  insert into push_subscriptions(endpoint, user_id, p256dh, auth, agent)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_agent, ''), 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, agent = excluded.agent, last_seen_at = now();
  -- 10 appareils au plus par compte : les plus anciens sont retirés
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by last_seen_at desc offset 10);
  return true;
end $$;
-- L'appareil se retire (« Couper », déconnexion, changement de profil de test)
create or replace function push_unsubscribe(p_endpoint text) returns boolean
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() returning true;
$$;
revoke execute on function push_subscribe(text, text, text, text) from public, anon;
revoke execute on function push_unsubscribe(text) from public, anon;
grant execute on function push_subscribe(text, text, text, text) to authenticated;
grant execute on function push_unsubscribe(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. File des notifications
-- ---------------------------------------------------------------------
create table if not exists push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default './',
  tag text not null default '',
  dedupe_key text not null,                         -- une seule notification par personne pour un même fait (ex. une série créée d'un coup)
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  tries int not null default 0,
  last_error text
);
create unique index if not exists push_queue_dedupe on push_queue(user_id, dedupe_key);
create index if not exists push_queue_key on push_queue(dedupe_key);
create index if not exists push_queue_todo on push_queue(created_at) where sent_at is null;
alter table push_queue enable row level security;   -- aucune lecture directe

-- Ajoute une notification pour une personne (seulement si elle a au moins un téléphone inscrit)
create or replace function push_enqueue(u uuid, p_title text, p_body text, p_tag text, p_key text, p_url text default './') returns void
language sql security definer set search_path = public as $$
  insert into push_queue(user_id, title, body, url, tag, dedupe_key)
  select u, left(p_title, 80), left(coalesce(p_body, ''), 180), p_url, coalesce(p_tag, ''), p_key
  where exists(select 1 from push_subscriptions s where s.user_id = u)
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- « Se mettre à la place » d'un compte, le temps de poser la question « que voit-il ? »
-- (auth.uid() de Supabase lit d'abord request.jwt.claim.sub ; la base de test lit request.uid)
create or replace function push_as(u uuid) returns void language sql volatile set search_path = public as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), true), set_config('request.uid', coalesce(u::text, ''), true);
$$;
create or replace function push_restore(sub text, uid text) returns void language sql volatile set search_path = public as $$
  select set_config('request.jwt.claim.sub', coalesce(sub, ''), true), set_config('request.uid', coalesce(uid, ''), true);
$$;

-- Petits outils de mise en forme (heure de Paris)
create or replace function push_when(t timestamptz) returns text language sql immutable as $$
  select (array['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'])[extract(dow from t at time zone 'Europe/Paris')::int + 1]
         || ' ' || to_char(t at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI');
$$;
create or replace function push_ev_line(e events) returns text language sql stable set search_path = public as $$
  select e.title || ' · ' || push_when(e.starts_at) || case when e.place <> '' then ' · ' || e.place else '' end
         || ' (' || coalesce((select name from clubs where id = e.club_id), '') || ')';
$$;

-- Comptes à prévenir pour un rendez-vous : ceux qui le voient, avec un téléphone inscrit, sauf l'auteur du geste
-- et ceux qui l'ont masqué. Convocation de joueurs choisis : les familles des joueurs non convoqués ne sont pas prévenues.
create or replace function push_event_targets(eid uuid, actor uuid) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into e from events where id = eid; if e.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = e.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_event(eid)
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

create or replace function push_announcement_targets(aid uuid, actor uuid) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare a announcements; u uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into a from announcements where id = aid; if a.id is null then return; end if;
  for u in select distinct m.user_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.club_id = a.club_id and m.status = 'active' and m.user_id is distinct from actor loop
    perform push_as(u);
    if sees_announcement(aid) then return next u; end if;
  end loop;
  perform push_restore(sub0, uid0);
end $$;

-- ---------------------------------------------------------------------
-- 3. Ce qui remplit la file
-- ---------------------------------------------------------------------
-- Nouveau rendez-vous (une seule notification pour une série créée d'un coup) ; passés ignorés
create or replace function push_on_event_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evnew:' || coalesce(new.series_id::text, new.id::text); s event_series; t text; b text;
begin
  if new.cancelled or new.starts_at < now() then return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  if new.series_id is not null then
    select * into s from event_series where id = new.series_id;
    t := 'Nouveaux entraînements';
    b := new.title || ' · chaque ' || (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from new.starts_at at time zone 'Europe/Paris')::int + 1]
         || ' à ' || to_char(new.starts_at at time zone 'Europe/Paris', 'HH24"h"MI') || ', dès le ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM')
         || ' (' || coalesce((select name from clubs where id = new.club_id), '') || ')';
  else
    t := case when new.type in ('Match','Plateau','Tournoi') and cardinality(new.convoked) > 0 then 'Convocation : ' || lower(new.type)
              else 'Nouveau : ' || lower(new.type) end;
    b := push_ev_line(new);
  end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_insert on events;
create trigger push_event_insert after insert on events for each row execute function push_on_event_insert();

-- Annulation, ou changement d'heure ou de lieu d'un rendez-vous à venir (série modifiée d'un coup : une seule notification)
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
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || to_char(now(), 'YYYYMMDDHH24MI');
    t := case when new.starts_at is distinct from old.starts_at then 'Nouvel horaire' else 'Nouveau lieu' end; b := push_ev_line(new);
  else return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  for u in select * from push_event_targets(new.id, auth.uid()) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_update on events;
create trigger push_event_update after update of cancelled, starts_at, place on events for each row execute function push_on_event_update();

-- Rendez-vous à venir supprimé : prévenu comme une annulation (suppression d'une série : une seule notification)
create or replace function push_on_event_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evdel:' || coalesce(old.series_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'), old.id::text);
begin
  if old.cancelled or old.starts_at < now() then return old; end if;
  if old.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return old; end if;
  for u in select * from push_event_targets(old.id, auth.uid()) loop
    perform push_enqueue(u, case when old.series_id is not null then 'Séances supprimées' else 'Annulé' end, push_ev_line(old), 'ev:' || old.id, k);
  end loop;
  return old;
end $$;
drop trigger if exists push_event_delete on events;
create trigger push_event_delete before delete on events for each row execute function push_on_event_delete();

-- Annonces officielles, relances des sans-réponse, missions de bénévoles, rappels de cotisation
create or replace function push_on_announcement() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; c text := coalesce((select name from clubs where id = new.club_id), '');
begin
  for u in select * from push_announcement_targets(new.id, coalesce(new.created_by, auth.uid())) loop
    perform push_enqueue(u, new.title, coalesce(nullif(left(new.body, 140), ''), c) || case when new.body <> '' then ' (' || c || ')' else '' end, 'ann:' || new.id, 'ann:' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists push_announcement on announcements;
create trigger push_announcement after insert on announcements for each row execute function push_on_announcement();

-- Messages et sondages des groupes : les membres du groupe, sauf l'auteur et ceux qui ont coupé le groupe.
-- Sur le téléphone, les messages d'un même groupe se remplacent (une seule notification par groupe à l'écran).
create or replace function push_on_message() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups; who text;
begin
  select * into g from groups where id = new.group_id; if g.id is null then return null; end if;
  select coalesce(nullif(nickname, ''), first_name, 'Quelqu''un') into who from profiles where id = new.user_id;
  perform push_enqueue(gm.user_id, g.name, coalesce(who, 'Quelqu''un') || ' : ' || left(new.body, 120), 'grp:' || g.id, 'msg:' || new.id)
    from group_members gm where gm.group_id = g.id and gm.user_id <> new.user_id and not gm.muted
      and exists(select 1 from memberships m where m.club_id = g.club_id and m.user_id = gm.user_id and m.status = 'active');
  return null;
end $$;
drop trigger if exists push_message on messages;
create trigger push_message after insert on messages for each row execute function push_on_message();

create or replace function push_on_poll() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where id = new.group_id; if g.id is null then return null; end if;
  perform push_enqueue(gm.user_id, g.name, 'Nouveau sondage : ' || left(new.question, 120), 'grp:' || g.id, 'poll:' || new.id)
    from group_members gm where gm.group_id = g.id and gm.user_id is distinct from new.created_by and not gm.muted
      and exists(select 1 from memberships m where m.club_id = g.club_id and m.user_id = gm.user_id and m.status = 'active');
  return null;
end $$;
drop trigger if exists push_poll on polls;
create trigger push_poll after insert on polls for each row execute function push_on_poll();

-- Notification d'essai envoyée à soi-même (pour l'étape 5 ; une par minute au plus)
create or replace function push_test() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select count(*) into n from push_subscriptions where user_id = auth.uid();
  if n = 0 then raise exception 'Aucun appareil inscrit : active d''abord les notifications'; end if;
  perform push_enqueue(auth.uid(), 'Essai Pocket Club', 'Les notifications marchent sur cet appareil.', 'test', 'test:' || to_char(now(), 'YYYYMMDDHH24MI'));
  return n;
end $$;
revoke execute on function push_test() from public, anon;
grant execute on function push_test() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Pour la fonction d'envoi (étape 3) : réservé à la clé de service, jamais à l'application
-- ---------------------------------------------------------------------
-- Prend les prochaines notifications à envoyer (moins de 2 jours, 5 essais au plus), une ligne par appareil
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
  select upd.id, s.endpoint, s.p256dh, s.auth, upd.title, upd.body, upd.url, upd.tag
  from upd join push_subscriptions s on s.user_id = upd.user_id;
end $$;
-- Résultat de l'envoi : envoyées, en erreur, appareils disparus (désinstallés ou notifications coupées : retirés)
create or replace function push_result(p_sent bigint[], p_failed bigint[] default '{}', p_gone text[] default '{}', p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update push_queue set sent_at = now(), last_error = null where id = any(coalesce(p_sent, '{}'));
  update push_queue set last_error = left(coalesce(p_error, 'échec'), 300) where id = any(coalesce(p_failed, '{}')) and sent_at is null;
  delete from push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
end $$;
-- Ménage : notifications envoyées depuis plus de 30 jours, ou jamais envoyées depuis plus de 3 jours
create or replace function push_cleanup() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from push_queue where (sent_at < now() - interval '30 days') or (sent_at is null and created_at < now() - interval '3 days');
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function push_claim(int), push_result(bigint[], bigint[], text[], text), push_cleanup(), push_enqueue(uuid, text, text, text, text, text),
  push_event_targets(uuid, uuid), push_announcement_targets(uuid, uuid), push_as(uuid), push_restore(text, text) from public, anon, authenticated;
do $$ begin
  grant execute on function push_claim(int), push_result(bigint[], bigint[], text[], text), push_cleanup() to service_role;
exception when undefined_object then null; end $$;   -- le rôle service_role n'existe que dans Supabase

select 'Pocket Club alpha 3.3 : notifications prêtes côté base (étape 2 sur 5).' as resultat;
