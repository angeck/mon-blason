-- MAJ_ALPHA_4_10_0.sql · mypocketclub · n° 181 (club supprimé : corbeille de 90 jours, membres prévenus), n° 182 (date limite de validation du président, rappel, corbeille automatique), n° 183 (droit à l'image : un refus d'un parent s'applique), n° 184 (appareils connus : Retirer, effacement après 12 mois), n° 185 (lien de désinscription des e-mails d'information) · à lancer une fois dans Supabase > SQL Editor > Run (après la 4.9.0).
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 4.10.0. Rien à redéployer.

-- mypocketclub · alpha 4.10.0 · mise à jour d'une base 4.9.0, sans perte de données, relançable.
-- Suite de la revue « Légal » du 10 novembre 2026 (décisions dans claude/06b-decisions-legal.md) :
-- 1. N° 181 : un club supprimé reste 90 jours à la corbeille (au lieu de 30). Données gelées, seul le président peut annuler,
--    les membres sont prévenus le premier jour. La suppression d'un compte par la personne reste à 30 jours.
-- 2. N° 182 : un club dont le président n'est pas validé a 30 jours pour l'être (date limite affichée). Rappel au président
--    7 jours avant (notification ; l'e-mail de rappel demande une tâche planifiée, voir 05b). À la date, le club part à la
--    corbeille de 90 jours : rien n'est effacé d'un coup.
-- 3. N° 183 : droit à l'image d'un enfant, désaccord entre parents : dès qu'un parent refuse, le refus s'applique ; le président
--    est prévenu du désaccord, sans motif ni échange. Chaque choix est daté et rangé par personne.
-- 4. N° 184 : appareils connus : « Retirer » un appareil ; un appareil sans connexion depuis 12 mois est effacé.
-- 5. N° 185 : e-mails d'information : lien de désinscription (jeton propre à chaque compte, jamais lisible par les autres).
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 181 · corbeille de 90 jours pour un club supprimé
-- ---------------------------------------------------------------------
create or replace function delete_club(p_club uuid, p_name text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare c clubs; u uuid; fin timestamptz := now() + interval '90 days';
begin
  if not is_president(p_club) then raise exception 'Seul le président supprime le club'; end if;
  select * into c from clubs where id = p_club;
  if c.deleted_at is not null then raise exception 'Le club est déjà dans la corbeille'; end if;
  if lower(trim(coalesce(p_name, ''))) <> lower(trim(c.name)) then raise exception 'Tape exactement le nom du club pour confirmer'; end if;
  perform set_config('pc.club_delete', 'on', true);
  update clubs set deleted_at = now(), deleted_by = auth.uid(), listed_before_delete = public_listed, public_listed = false where id = p_club;
  perform set_config('pc.club_delete', '', true);
  delete from president_offers where club_id = p_club;
  perform log_action(p_club, null, null, 'club envoyé à la corbeille', jsonb_build_object('effacé_le', fin));
  -- les membres sont prévenus le premier jour
  for u in select distinct m.user_id from memberships m where m.club_id = p_club and m.status = 'active' and m.user_id is distinct from auth.uid() loop
    perform push_enqueue(u, 'Club supprimé', c.name || ' est à la corbeille. Il sera effacé le ' || to_char(fin at time zone 'Europe/Paris', 'DD/MM/YYYY')
      || ', sauf si le président le restaure.', 'clubdel:' || p_club, 'clubdel:' || p_club || ':' || floor(extract(epoch from now()))::text);
  end loop;
  return fin;
end $$;
revoke execute on function delete_club(uuid, text) from public, anon;

-- ---------------------------------------------------------------------
-- 2. N° 182 · date limite de validation du président
-- ---------------------------------------------------------------------
-- Pour les clubs déjà là, le délai part de la mise à jour (30 jours pour se faire valider) : aucun club n'est envoyé à la corbeille d'un coup.
alter table clubs add column if not exists valid_by timestamptz default (now() + interval '30 days');
alter table clubs add column if not exists valid_reminded_at timestamptz;
update clubs set valid_by = now() + interval '30 days' where valid_by is null;

-- Un nouveau président non validé reçoit un nouveau délai de 30 jours (sinon un club ancien partirait à la corbeille au transfert)
create or replace function memberships_president_watch() returns trigger
language plpgsql security definer set search_path = public as $$
declare a uuid; cn text; nm text;
begin
  if tg_op in ('UPDATE','DELETE') and old.role = 'president' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'president' or new.status <> 'active' or new.user_id <> old.user_id) then
    delete from sender_validations where club_id = old.club_id and user_id = old.user_id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.role = 'president' and new.status = 'active'
     and (tg_op = 'INSERT' or old.role <> 'president' or old.status <> 'active')
     and not exists(select 1 from sender_validations where club_id = new.club_id and user_id = new.user_id) then
    select name into cn from clubs where id = new.club_id;
    select full_name into nm from profiles where id = new.user_id;
    update clubs set valid_by = greatest(coalesce(valid_by, now()), now() + interval '30 days'), valid_reminded_at = null where id = new.club_id;
    for a in select user_id from app_admins loop
      perform push_enqueue(a, 'Président à valider', coalesce(cn, 'Un club') || ' · ' || coalesce(nm, 'nouveau président'), 'admin', 'presval:' || new.club_id || ':' || new.user_id, './');
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists memberships_president_watch on memberships;
create trigger memberships_president_watch after insert or update of role, status, user_id or delete on memberships for each row execute function memberships_president_watch();

-- Retirer une validation donne aussi 30 jours (un club ancien ne part pas à la corbeille au même instant)
create or replace function admin_unvalidate_sender(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from sender_validations where club_id = p_club and user_id = p_user;
  if found then
    update clubs set valid_by = greatest(coalesce(valid_by, now()), now() + interval '30 days'), valid_reminded_at = null where id = p_club;
    perform log_action(p_club, p_user, null, 'envoi des convocations fermé par mypocketclub', '{}'::jsonb);
  end if;
end $$;
revoke execute on function admin_unvalidate_sender(uuid, uuid) from public, anon;
grant execute on function admin_unvalidate_sender(uuid, uuid) to authenticated;

-- Le président et les personnes qui envoient voient la date limite (encart rouge)
create or replace function my_send_state(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pres uuid; v sender_validations; cl clubs;
begin
  if auth.uid() is null or not (is_president(p_club) or has_area(p_club, 'evenements')) then return null; end if;
  select m.user_id into pres from memberships m where m.club_id = p_club and m.role = 'president' and m.status = 'active' order by m.created_at limit 1;
  select * into v from sender_validations where club_id = p_club and user_id = pres;
  select * into cl from clubs where id = p_club;
  return jsonb_build_object('can_send', can_send_convocations(p_club), 'validated', v.user_id is not null, 'me_president', pres is not distinct from auth.uid(),
    'reason', v.reason, 'ends_at', v.ends_at, 'period_over', coalesce(v.ends_at <= current_date, false),
    'valid_by', case when v.user_id is null then cl.valid_by end);
end $$;
revoke execute on function my_send_state(uuid) from public, anon;
grant execute on function my_send_state(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 183 · droit à l'image : un refus d'un parent s'applique
-- ---------------------------------------------------------------------
-- Fiche : consents.image = {ok, at, by, conflict, votes:{personne:{ok, at}}}. « ok » = personne n'a refusé et quelqu'un a accepté.
create or replace function apply_image_vote(p_player uuid, p_user uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; cur jsonb; votes jsonb; eff boolean; yes boolean; no boolean; was boolean; u uuid;
begin
  select * into pl from players where id = p_player;
  if not found then return; end if;
  cur := coalesce(pl.consents->'image', '{}'::jsonb);
  votes := coalesce(cur->'votes', '{}'::jsonb) || jsonb_build_object(p_user::text, jsonb_build_object('ok', p_ok, 'at', now()));
  yes := exists(select 1 from jsonb_each(votes) v where (v.value->>'ok')::boolean);
  no := exists(select 1 from jsonb_each(votes) v where not (v.value->>'ok')::boolean);
  eff := yes and not no;
  was := coalesce((cur->>'conflict')::boolean, false);
  perform set_config('pc.consent_rpc', 'on', true);
  update players set consents = consents || jsonb_build_object('image',
    jsonb_build_object('ok', eff, 'at', now(), 'by', p_user, 'votes', votes, 'conflict', yes and no)) where id = p_player;
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
revoke execute on function apply_image_vote(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function set_player_image(p_player uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; major boolean;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into pl from players where id = p_player and deleted_at is null;
  if not found then raise exception 'Fiche introuvable'; end if;
  major := pl.birth_date is not null and pl.birth_date <= (current_date - interval '18 years')::date;
  if not (is_board(pl.club_id)
          or (major and pl.user_id = auth.uid())
          or (not major and exists(select 1 from player_parents pp where pp.player_id = p_player and pp.user_id = auth.uid()))) then
    raise exception 'Tu ne peux pas régler cet accord';
  end if;
  perform apply_image_vote(p_player, auth.uid(), p_ok);
end $$;
revoke execute on function set_player_image(uuid, boolean) from public, anon;
grant execute on function set_player_image(uuid, boolean) to authenticated;

-- Le droit à l'image d'une fiche ne change plus que par set_player_image (ou l'accord du compte, ci-dessous)
create or replace function players_image_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('pc.consent_rpc', true), '') <> 'on'
     and (new.consents->'image') is distinct from (old.consents->'image') then
    raise exception 'Le droit à l''image se règle avec le bouton d''accord de la fiche.';
  end if;
  return new;
end $$;
revoke execute on function players_image_guard() from public, anon, authenticated;
drop trigger if exists players_image_guard on players;
create trigger players_image_guard before update of consents on players for each row execute function players_image_guard();

-- L'accord du compte (Mon compte) suit sur la fiche joueur de la personne, comme un choix de plus (jamais sur celle d'un enfant)
create or replace function set_my_consents(p_image boolean, p_optin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur profiles; pid uuid;
begin
  if me is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into cur from profiles where id = me;
  if not found then raise exception 'Compte introuvable'; end if;
  update profiles set
    image_ok = coalesce(p_image, image_ok),
    image_at = case when p_image is not null and p_image is distinct from image_ok then now() else image_at end,
    optin_emails = coalesce(p_optin, optin_emails),
    optin_at = case when p_optin is not null and p_optin is distinct from optin_emails then now() else optin_at end
  where id = me;
  if p_image is not null and p_image is distinct from cur.image_ok then
    for pid in select id from players where user_id = me and deleted_at is null loop
      perform apply_image_vote(pid, me, p_image);
    end loop;
  end if;
end $$;
revoke execute on function set_my_consents(boolean, boolean) from public, anon;
grant execute on function set_my_consents(boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. N° 184 · appareils connus : Retirer
-- ---------------------------------------------------------------------
create or replace function remove_my_device(p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  delete from user_devices where user_id = auth.uid() and device_id = p_device;
end $$;
revoke execute on function remove_my_device(text) from public, anon;
grant execute on function remove_my_device(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. N° 185 · désinscription des e-mails d'information
-- ---------------------------------------------------------------------
-- Un jeton par compte, dans une table fermée (aucune règle de lecture) : seul le serveur le lit pour fabriquer le lien.
create table if not exists mail_unsub (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
alter table mail_unsub enable row level security;
insert into mail_unsub(user_id) select id from profiles on conflict do nothing;

-- Réservé au serveur (fonction envoyer-email) : donne le jeton d'une personne, en le créant au besoin
create or replace function mail_unsub_token(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  insert into mail_unsub(user_id) values (p_user) on conflict do nothing;
  select token into t from mail_unsub where user_id = p_user;
  return t;
end $$;
revoke execute on function mail_unsub_token(uuid) from public, anon, authenticated;

-- Le lien de désinscription (ouvert au visiteur : on clique depuis un e-mail, connecté ou non)
create or replace function unsubscribe_info(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select user_id into u from mail_unsub where token = p_token;
  if u is null then return false; end if;
  update profiles set optin_emails = false, optin_at = now() where id = u and optin_emails;
  return true;
end $$;
grant execute on function unsubscribe_info(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5 bis. La corbeille automatique d'un club (purge_trash) est faite par la base, pas par le président :
--        clubs_guard laisse passer la mise à la corbeille et la restauration (réglage « pc.club_delete », posé seulement
--        par delete_club, restore_club et purge_trash ; le contrôle de deleted_at reste dans clubs_guard_310).
-- ---------------------------------------------------------------------
create or replace function clubs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code <> old.join_code then raise exception 'Le code du club ne se modifie pas ainsi'; end if;
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('pc.club_delete', true), '') = 'on' then return new; end if;
  if new.custom_header is distinct from old.custom_header and not is_president(old.id) then raise exception 'Seul le président choisit l''en-tête aux couleurs du club'; end if;
  if new.public_listed is distinct from old.public_listed and not is_president(old.id) then raise exception 'Seul le président choisit si le club apparaît dans la recherche'; end if;
  if new.coach_sees_fees is distinct from old.coach_sees_fees and not is_president(old.id) then raise exception 'Réglage réservé au président'; end if;
  if new.default_missions is distinct from old.default_missions and not has_area(old.id, 'evenements') then raise exception 'Les missions par défaut se règlent dans la rubrique Événements'; end if;
  if (new.name, new.city, new.postal_code, new.sport, new.color1, new.color2, new.crest_bg, new.logo, new.crest_outline)
     is distinct from (old.name, old.city, old.postal_code, old.sport, old.color1, old.color2, old.crest_bg, old.logo, old.crest_outline)
     and not has_area(old.id, 'communication') then raise exception 'Le blason et les informations du club se règlent dans la rubrique Communication'; end if;
  if jsonb_typeof(new.default_missions) <> 'array' or jsonb_array_length(new.default_missions) > 12 then raise exception 'Liste de missions invalide'; end if;
  return new;
end $$;
revoke execute on function clubs_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Corbeille : 90 jours pour un club, 12 mois pour un appareil, club non validé à temps
-- ---------------------------------------------------------------------
create or replace function purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; u uuid; lim timestamptz := now() - interval '30 days'; lim90 timestamptz := now() - interval '90 days'; cc record; fin timestamptz;
begin
  -- N° 182 : club dont le président n'a pas été validé à temps : corbeille de 90 jours (rien n'est effacé d'un coup)
  for cc in select c.id, c.name from clubs c
            where c.deleted_at is null and c.valid_by is not null and c.valid_by < now()
              and exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active')
              and not exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active' and president_validated(c.id, m.user_id)) loop
    fin := now() + interval '90 days';
    perform set_config('pc.club_delete', 'on', true);
    update clubs set deleted_at = now(), deleted_by = null, listed_before_delete = public_listed, public_listed = false where id = cc.id;
    perform set_config('pc.club_delete', '', true);
    insert into action_log(club_id, actor, action, detail) values (cc.id, null, 'club envoyé à la corbeille (président non validé à temps)', jsonb_build_object('effacé_le', fin));
    for u in select distinct m.user_id from memberships m where m.club_id = cc.id and m.status = 'active' loop
      perform push_enqueue(u, 'Club supprimé', cc.name || ' est à la corbeille faute de validation. Il sera effacé le ' || to_char(fin at time zone 'Europe/Paris', 'DD/MM/YYYY')
        || ', sauf si le président le restaure.', 'clubdel:' || cc.id, 'clubdel:' || cc.id || ':' || floor(extract(epoch from now()))::text);
    end loop;
    n := n + 1;
  end loop;
  -- N° 182 : rappel au président, 7 jours avant la date limite (une seule fois)
  for cc in select c.id, c.name, c.valid_by from clubs c
            where c.deleted_at is null and c.valid_reminded_at is null and c.valid_by between now() and now() + interval '7 days'
              and not exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active' and president_validated(c.id, m.user_id)) loop
    for u in select m.user_id from memberships m where m.club_id = cc.id and m.role = 'president' and m.status = 'active' loop
      perform push_enqueue(u, 'Club à valider', cc.name || ' doit être validé avant le ' || to_char(cc.valid_by at time zone 'Europe/Paris', 'DD/MM/YYYY')
        || '. Sinon il part à la corbeille.', 'clubval', 'clubval:' || cc.id);
    end loop;
    update clubs set valid_reminded_at = now() where id = cc.id;
  end loop;
  -- N° 181 : un club supprimé est effacé après 90 jours
  delete from clubs where deleted_at < lim90; get diagnostics k = row_count; n := n + k;
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
  -- N° 184 : un appareil sans connexion depuis 12 mois est effacé
  delete from user_devices where last_seen < now() - interval '12 months';
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
revoke execute on function purge_trash() from public, anon;
grant execute on function purge_trash() to authenticated;

-- ---------------------------------------------------------------------
-- 6 bis. n° 84 : créer le rendez-vous depuis une convocation reçue
-- ---------------------------------------------------------------------
create table if not exists convocation_links (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references convocation_sends(id) on delete cascade,
  source_event_id uuid not null,                       -- le match dans le document du club qui reçoit chez lui
  club_id uuid not null references clubs(id) on delete cascade,   -- le club reçu (celui qui crée le rendez-vous)
  event_id uuid references events(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (send_id, source_event_id, club_id)
);
alter table convocation_links enable row level security;   -- lecture et écriture seulement par les fonctions ci-dessous

-- Les matchs d'une convocation reçue, avec le rendez-vous déjà créé (s'il existe)
create or replace function convocation_received_events(p_send uuid) returns table(source_event_id uuid, title text, starts_at timestamptz, place text, team text, linked_event uuid)
language plpgsql stable security definer set search_path = public as $$
declare s convocation_sends;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' or s.target_club_id is null or not receives_convocations(s.target_club_id) then return; end if;
  return query
    select (x->>'id')::uuid, coalesce(x->>'title', ''), (x->>'starts_at')::timestamptz, coalesce(x->>'place', ''),
           coalesce(x->'team'->>'name', ''),
           (select l.event_id from convocation_links l join events e on e.id = l.event_id
             where l.send_id = s.id and l.source_event_id = (x->>'id')::uuid and l.club_id = s.target_club_id)
    from jsonb_array_elements(coalesce(s.payload->'data'->'events', s.payload->'events', '[]'::jsonb)) x
    where coalesce((x->>'cancelled')::boolean, false) = false and x->>'id' is not null
    order by 3, 2;
end $$;
revoke execute on function convocation_received_events(uuid) from public, anon;
grant execute on function convocation_received_events(uuid) to authenticated;

-- Relie le rendez-vous créé (ou un rendez-vous existant du même club) au match de la convocation
create or replace function link_convocation(p_send uuid, p_source uuid, p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; e events;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' or s.target_club_id is null or not receives_convocations(s.target_club_id) then raise exception 'Convocation introuvable'; end if;
  select * into e from events where id = p_event;
  if e.id is null or e.club_id <> s.target_club_id or not has_area(e.club_id, 'evenements') then raise exception 'Rendez-vous introuvable dans ton club'; end if;
  insert into convocation_links(send_id, source_event_id, club_id, event_id, created_by) values (p_send, p_source, s.target_club_id, p_event, auth.uid())
    on conflict (send_id, source_event_id, club_id) do update set event_id = excluded.event_id, created_by = excluded.created_by, created_at = now();
end $$;
revoke execute on function link_convocation(uuid, uuid, uuid) from public, anon;
grant execute on function link_convocation(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6 ter. n° 167 : doublons d'exercices (signalement, puis décision)
-- ---------------------------------------------------------------------
create table if not exists exercise_duplicates (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,   -- l'exercice qui ferait doublon (il partirait à la corbeille)
  other_id uuid not null references exercises(id) on delete cascade,      -- celui qui resterait
  reported_by uuid references auth.users(id) on delete set null,
  reported_at timestamptz not null default now(),
  status text not null default 'signale' check (status in ('signale', 'fusionne', 'refuse')),   -- Signalé, Fusionné, Pas un doublon
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  check (exercise_id <> other_id)
);
create unique index if not exists exercise_duplicates_open on exercise_duplicates(least(exercise_id, other_id), greatest(exercise_id, other_id)) where status = 'signale';
alter table exercise_duplicates enable row level security;   -- lecture et écriture seulement par les fonctions ci-dessous

-- Qui décide : l'administrateur de mypocketclub pour un exercice public ; sinon le Directeur technique ou le président du club de l'exercice
create or replace function can_decide_duplicate(p_ex uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from exercises e where e.id = p_ex and (
    case when e.sharing = 'public' and e.public_state = 'validated' then is_app_admin() else (is_president(e.club_id) or has_area(e.club_id, 'technique')) end));
$$;
revoke execute on function can_decide_duplicate(uuid) from public, anon;
grant execute on function can_decide_duplicate(uuid) to authenticated;

create or replace function report_duplicate(p_exercise uuid, p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a exercises; b exercises; r exercise_duplicates;
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
  insert into exercise_duplicates(exercise_id, other_id, reported_by) values (p_exercise, p_other, auth.uid());
  perform log_action(a.club_id, null, null, 'doublon d''exercice signalé', jsonb_build_object('exercice', a.title, 'autre', b.title));
end $$;
revoke execute on function report_duplicate(uuid, uuid) from public, anon;
grant execute on function report_duplicate(uuid, uuid) to authenticated;

-- La liste : ce que j'ai signalé, et ce que je peux trancher
create or replace function duplicates_list() returns table(id uuid, exercise_id uuid, other_id uuid, title text, other_title text, status text, reported_by_name text, reported_at timestamptz, decided_at timestamptz, mine boolean, can_decide boolean)
language sql stable security definer set search_path = public as $$
  select d.id, d.exercise_id, d.other_id, a.title, b.title, d.status,
         (select p.full_name from profiles p where p.id = d.reported_by), d.reported_at, d.decided_at,
         d.reported_by = auth.uid(), d.status = 'signale' and can_decide_duplicate(d.exercise_id)
  from exercise_duplicates d join exercises a on a.id = d.exercise_id join exercises b on b.id = d.other_id
  where auth.uid() is not null and (d.reported_by = auth.uid() or can_decide_duplicate(d.exercise_id))
    and d.reported_at > now() - interval '180 days'
  order by (d.status = 'signale') desc, d.reported_at desc limit 50;
$$;
revoke execute on function duplicates_list() from public, anon;
grant execute on function duplicates_list() to authenticated;

create or replace function decide_duplicate(p_id uuid, p_merge boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d exercise_duplicates; a exercises; b exercises; t text;
begin
  select * into d from exercise_duplicates where id = p_id;
  if d.id is null or d.status <> 'signale' then raise exception 'Signalement introuvable ou déjà traité'; end if;
  if not can_decide_duplicate(d.exercise_id) then raise exception 'Seul le Directeur technique ou le président décide (un administrateur de mypocketclub pour un exercice public)'; end if;
  select * into a from exercises where id = d.exercise_id;
  select * into b from exercises where id = d.other_id;
  if p_merge then
    if a.deleted_at is not null or b.deleted_at is not null then raise exception 'Un des deux exercices a déjà été supprimé'; end if;
    -- l'exercice qui reste doit être visible partout où l'autre l'était
    if a.sharing = 'public' and not (b.sharing = 'public' and b.public_state = 'validated') then raise exception 'L''exercice public ne peut être fusionné que dans un exercice public validé'; end if;
    if a.sharing <> 'public' and not (b.club_id = a.club_id or (b.sharing = 'public' and b.public_state = 'validated')) then raise exception 'L''exercice qui reste doit être de ce club ou public'; end if;
    perform set_config('pc.exsys', 'on', true);
    update training_plans set items = (select coalesce(jsonb_agg(case when x->>'exercise_id' = a.id::text then jsonb_set(x, '{exercise_id}', to_jsonb(b.id::text)) else x end), '[]'::jsonb) from jsonb_array_elements(items) x)
      where items::text like '%' || a.id::text || '%';
    update exercise_reports set exercise_id = b.id where exercise_id = a.id;
    update exercises set deleted_at = now(), deleted_by = auth.uid() where id = a.id;
    perform set_config('pc.exsys', 'off', true);
    update exercise_duplicates set status = 'fusionne', decided_by = auth.uid(), decided_at = now() where id = d.id;
    -- les autres signalements ouverts qui touchent l'exercice parti n'ont plus d'objet
    update exercise_duplicates set status = 'refuse', decided_by = auth.uid(), decided_at = now() where status = 'signale' and id <> d.id and (exercise_id = a.id or other_id = a.id);
  else
    update exercise_duplicates set status = 'refuse', decided_by = auth.uid(), decided_at = now() where id = d.id;
  end if;
  if d.reported_by is not null and d.reported_by <> auth.uid() then
    perform push_enqueue(d.reported_by, case when p_merge then 'Doublon fusionné' else 'Pas un doublon' end,
      '« ' || a.title || ' » : ' || case when p_merge then 'fusionné avec « ' || b.title || ' ».' else 'les deux exercices restent.' end, 'exercice', 'dupdec:' || d.id);
  end if;
  perform log_action(a.club_id, null, null, case when p_merge then 'doublon d''exercice fusionné' else 'doublon d''exercice écarté' end, jsonb_build_object('exercice', a.title, 'autre', b.title));
end $$;
revoke execute on function decide_duplicate(uuid, boolean) from public, anon;
grant execute on function decide_duplicate(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Fermeture au visiteur : unsubscribe_info reste ouverte (lien de l'e-mail)
-- ---------------------------------------------------------------------
create or replace function close_visitor_functions() returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare f record; n int := 0; pol text; svc boolean := exists(select 1 from pg_roles where rolname = 'service_role');
  keep text[] := array['public_search_clubs', 'public_club', 'request_club', 'not_me_device', 'unsubscribe_info'];
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

select close_visitor_functions();

select 'mypocketclub alpha 4.10.0 installée' as resultat;
