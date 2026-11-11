-- mypocketclub · alpha 5.2.0 · mise à jour d'une base 5.1.0, sans perte de données, relançable.
-- « Très grosse mise à jour » du 11 novembre 2026 (plan en trois mises à jour de Gaël). Cette première partie :
--   N° 198 (reste) : liste des convoqués vidée = retour à « toute l'équipe » ; les joueurs qui n'étaient pas sur la liste, désormais
--                    convoqués, reçoivent « Convocation : match » ; les autres restent convoqués, sans notification.
--   N° 184 : « Retirer » un appareil coupe aussi sa session (la base retient la session de chaque appareil à sa connexion).
--   N° 171 : les notifications de fonction disent « Contact licences / rencontres » (la valeur en base reste « Correspondant »).
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 198 · liste vidée
-- ---------------------------------------------------------------------
create or replace function push_on_event_update() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text; t text; b text; imp boolean := false; stamp text := to_char(now(), 'YYYYMMDDHH24MI');
  added uuid[]; removed uuid[]; x record;
begin
  -- n° 198 : liste des convoqués changée après la création
  if new.type in ('Match','Plateau','Tournoi') and new.series_id is null and not new.cancelled and new.starts_at > now()
     and new.convoked is distinct from old.convoked and (cardinality(new.convoked) > 0 or cardinality(old.convoked) > 0) then
    if cardinality(new.convoked) > 0 then
      added := array(select p from unnest(new.convoked) p where not (p = any(old.convoked)));
      removed := case when cardinality(old.convoked) = 0 then '{}'::uuid[]
                      else array(select p from unnest(old.convoked) p where not (p = any(new.convoked))) end;
    else
      -- 5.2.0 (n° 198, reste) : liste vidée = retour à « toute l'équipe » : les joueurs qui n'étaient pas sur la liste sont maintenant
      -- convoqués ; ceux qui y étaient le restent, personne n'est « retiré »
      added := array(select p.id from players p where p.team_id = any(new.team_ids) and p.deleted_at is null and not (p.id = any(old.convoked)));
      removed := '{}'::uuid[];
    end if;
    b := push_ev_line(new);
    if cardinality(added) > 0 then
      for u in select y from push_event_targets(new.id, auth.uid(), false, false) y
               where exists(select 1 from players p where p.id = any(added) and p.deleted_at is null
                            and (p.user_id = y or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = y))) loop
        perform push_enqueue(u, 'Convocation : ' || lower(new.type), b, 'evconv:' || new.id, 'evconv:' || new.id || ':' || stamp);
      end loop;
    end if;
    if cardinality(removed) > 0 then
      -- « toutes les personnes qui voient le rendez-vous » : la liste ne les filtre plus, ils ne sont plus convoqués
      for x in select y as uid, string_agg(distinct p.first_name, ', ') as who from push_event_targets(new.id, auth.uid(), false, true) y
               join players p on p.id = any(removed) and p.deleted_at is null
                 and (p.user_id = y or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = y))
               group by y loop
        perform push_enqueue(x.uid, 'Convocation retirée : ' || lower(new.type), x.who || ' · ' || b, 'evconv:' || new.id, 'evunconv:' || new.id || ':' || stamp);
      end loop;
    end if;
  end if;

  -- changements d'horaire, de lieu, annulation (inchangé depuis la 4.7.0)
  if new.starts_at < now() - interval '1 hour' then return null; end if;
  if new.cancelled and not old.cancelled then
    k := 'evcancel:' || coalesce(new.series_id::text || ':' || stamp, new.id::text);
    t := 'Annulé'; b := push_ev_line(new); imp := true;
  elsif not new.cancelled and old.cancelled then
    k := 'evback:' || new.id || ':' || stamp;
    t := 'De nouveau prévu'; b := push_ev_line(new);
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place
        or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || stamp;
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

drop trigger if exists push_event_update on events;
create trigger push_event_update after update of cancelled, starts_at, place, duration_min, all_day, convoked on events
  for each row execute function push_on_event_update();
revoke execute on function push_on_event_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. N° 184 · retirer un appareil coupe sa session
--    La session (claim « session_id » du jeton) est retenue à chaque ouverture connectée. « Retirer » coupe la session de l'appareil
--    retiré, sauf si c'est l'appareil qui retire (il resterait déconnecté en pleine action). Si la base refuse (droits sur le schéma auth),
--    l'appareil est quand même retiré de la liste, avec un avertissement.
-- ---------------------------------------------------------------------
alter table user_devices add column if not exists session_id uuid;

create or replace function current_session_id() returns uuid language plpgsql stable as $$
declare c text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if c is null then return null; end if;
  return nullif(c::jsonb ->> 'session_id', '')::uuid;
exception when others then return null;
end $$;

create or replace function register_device(p_device text, p_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); had boolean; a uuid; sid uuid := current_session_id();
begin
  if u is null then raise exception 'Connecte-toi'; end if;
  if p_device is null or length(p_device) not between 8 and 64 then raise exception 'Appareil inconnu'; end if;
  if exists(select 1 from user_devices where user_id = u and device_id = p_device) then
    update user_devices set last_seen = now(), session_id = coalesce(sid, session_id) where user_id = u and device_id = p_device;
    return jsonb_build_object('new', false);
  end if;
  had := exists(select 1 from user_devices where user_id = u);
  insert into user_devices(user_id, device_id, label, session_id) values (u, p_device, left(coalesce(p_label, ''), 80), sid);
  if not had or (select count(*) from device_alerts where user_id = u and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('new', had, 'alert', null);
  end if;
  insert into device_alerts(user_id, device_label, token) values (u, left(coalesce(p_label, ''), 80), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) returning id into a;
  return jsonb_build_object('new', true, 'alert', a);
end $$;
revoke execute on function register_device(text, text) from public, anon;
grant execute on function register_device(text, text) to authenticated;

create or replace function remove_my_device(p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select session_id into sid from user_devices where user_id = auth.uid() and device_id = p_device;
  delete from user_devices where user_id = auth.uid() and device_id = p_device;
  if sid is not null and sid is distinct from current_session_id() then
    begin
      delete from auth.refresh_tokens where session_id = sid and user_id = auth.uid()::text;
      delete from auth.sessions where id = sid and user_id = auth.uid();
    exception when others then
      raise warning 'remove_my_device : session non coupée (%)', sqlerrm;
    end;
  end if;
end $$;
revoke execute on function remove_my_device(text) from public, anon;
grant execute on function remove_my_device(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 171 · « Contact licences / rencontres » dans les notifications de fonction
-- ---------------------------------------------------------------------
create or replace function memberships_fonction_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare cn text;
begin
  if tg_op = 'DELETE' then
    if old.role = 'bureau' and old.status = 'active' and old.user_id is distinct from auth.uid() then
      select name into cn from clubs where id = old.club_id;
      perform push_enqueue(old.user_id, 'Fonction retirée', replace(coalesce(old.title, old.fonction, 'Membre du bureau'), 'Correspondant ', 'Contact ') || ' · ' || coalesce(cn, ''), 'fonction', 'fonction-retiree:' || old.id);
    end if;
    return old;
  end if;
  if new.role = 'bureau' and new.status = 'active' and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.status <> 'active' or old.fonction is distinct from new.fonction) then
    select name into cn from clubs where id = new.club_id;
    perform push_enqueue(new.user_id, 'Nouvelle fonction', replace(coalesce(new.title, new.fonction, 'Membre du bureau'), 'Correspondant ', 'Contact ') || ' · ' || coalesce(cn, ''), 'fonction', 'fonction:' || new.id || ':' || coalesce(new.fonction, ''));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. N° 172 · Événements et Communication deviennent des rôles ; le président peut créer un rôle « Autre »
--    - « Responsable événements » (accès Événements) est une fonction, comme « Chargé de communication » (accès Communication).
--    - Reprise : la personne désignée dans « Qui s'occupe de quoi » reçoit la fonction ; les désignations sont retirées.
--    - Rôle « Autre » : un « Membre du bureau » avec un intitulé libre (aide-trésorier, aide-secrétaire…) et des accès choisis parmi
--      les cinq existants, par le président seul. Il ne donne jamais l'accès Président ni la modification des fonctions du bureau
--      (ces droits n'existent que pour le président). Pas de réglage de niveau : les droits sont ceux des accès cochés.
-- ---------------------------------------------------------------------
alter table memberships drop constraint if exists memberships_fonction;
alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur technique','Correspondant rencontres',
  'Correspondant licences','Chargé de communication','Responsable événements','Responsable sponsoring','Membre du bureau'));

create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['licences']
    when 'Directeur technique' then array['technique']
    when 'Correspondant rencontres' then array['evenements']
    when 'Responsable événements' then array['evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then '{}'::text[]
    when 'Membre du bureau' then '{}'::text[]
    when 'Directeur sportif' then array['technique'] when 'Coordinateur' then array['evenements']
    else '{}'::text[] end;
$$;

-- Reprise des désignations « événements » et « communication » : la personne désignée a la fonction correspondante
do $$
declare d record; f text;
begin
  for d in select * from club_designations where resp in ('evenements','communication') loop
    f := case d.resp when 'evenements' then 'Responsable événements' else 'Chargé de communication' end;
    if exists(select 1 from memberships m where m.club_id = d.club_id and m.user_id = d.user_id and m.status = 'active' and m.role = 'president') then
      null;  -- le président a déjà tous les accès
    elsif exists(select 1 from memberships m where m.club_id = d.club_id and m.user_id = d.user_id and m.status = 'active' and m.role = 'bureau' and m.fonction = f) then
      null;
    elsif exists(select 1 from memberships m where m.club_id = d.club_id and m.user_id = d.user_id and m.status = 'active' and m.role = 'bureau' and m.designated_for = d.resp) then
      update memberships set fonction = f, designated_for = null
        where club_id = d.club_id and user_id = d.user_id and status = 'active' and role = 'bureau' and designated_for = d.resp;
    else
      begin
        insert into memberships(club_id, user_id, role, fonction, status) values (d.club_id, d.user_id, 'bureau', f, 'active');
      exception when others then
        raise notice 'n° 172 : rôle « % » non repris pour le club % (%).', f, d.club_id, sqlerrm;
      end;
    end if;
  end loop;
  delete from club_designations where resp in ('evenements','communication');
  update memberships set designated_for = null where designated_for in ('evenements','communication');
end $$;

-- « Qui s'occupe de quoi » ne désigne plus personne : tout s'attribue dans « Fonctions du bureau »
create or replace function set_designation(p_club uuid, p_resp text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Ce rôle s''attribue dans « Fonctions du bureau »';
end $$;
revoke execute on function set_designation(uuid, text, uuid) from public, anon;

-- Création d'un rôle « Autre » : intitulé libre et accès choisis, en un seul geste, par le président
create or replace function create_other_role(p_club uuid, p_user uuid, p_title text, p_areas text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare t text := nullif(left(trim(regexp_replace(coalesce(p_title, ''), '[<>]', '', 'g')), 40), ''); a text; mid uuid;
begin
  if not is_president(p_club) then raise exception 'Seul le président crée un rôle'; end if;
  if t is null or length(t) < 2 then raise exception 'Donne un nom au rôle (2 lettres au moins)'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if p_areas is not null then
    foreach a in array p_areas loop
      if a not in ('tresorerie','secretariat','technique','communication','evenements') then raise exception 'Accès inconnu : un rôle « Autre » ne peut pas donner plus que les cinq accès du bureau'; end if;
    end loop;
  end if;
  insert into memberships(club_id, user_id, role, fonction, title, status) values (p_club, p_user, 'bureau', 'Membre du bureau', t, 'active') returning id into mid;
  if p_areas is not null then
    foreach a in array p_areas loop
      insert into board_areas(club_id, user_id, area, granted_by) values (p_club, p_user, a, auth.uid()) on conflict do nothing;
    end loop;
  end if;
  perform log_action(p_club, p_user, null, 'rôle créé', jsonb_build_object('intitule', t, 'acces', coalesce(array_to_string(p_areas, ', '), 'aucun')));
  return mid;
end $$;
revoke execute on function create_other_role(uuid, uuid, text, text[]) from public, anon;
grant execute on function create_other_role(uuid, uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 5. N° 174 · contact d'équipe, choisi par le coach
--    Un adulte par équipe : le coach de l'équipe, un joueur majeur de l'équipe ou un membre du bureau (jamais un parent seul).
--    Choisi par le coach de l'équipe, le contact rencontres du club ou le président (qui peuvent aussi le retirer).
--    Droits, POUR SON ÉQUIPE SEULEMENT : créer, modifier et annuler les matchs, entraînements, plateaux et tournois ;
--    recevoir et envoyer les convocations de ces rendez-vous ; voir les coordonnées des familles et des joueurs de l'équipe.
--    Le droit se calcule à chaque usage : il tombe dès que la personne n'est plus éligible (plus coach, plus joueur, plus au bureau).
--    L'équipe est prévenue de qui est son contact ; le journal garde la trace.
-- ---------------------------------------------------------------------
create table if not exists team_contacts (
  team_id uuid primary key references teams(id) on delete cascade,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now()
);
alter table team_contacts enable row level security;
drop policy if exists "contacts d'équipe lus par les membres" on team_contacts;
create policy "contacts d'équipe lus par les membres" on team_contacts for select using (is_member(club_id));

-- Éligibilité : adulte ; coach de l'équipe, joueur majeur de l'équipe (équipe principale ou en plus), ou membre du bureau / président du club
create or replace function team_contact_eligible(t uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and u is not null and exists(select 1 from teams x where x.id = t and x.deleted_at is null)
    and (select account_is_adult(x.club_id, u) from teams x where x.id = t)
    and (
      exists(select 1 from memberships m where m.team_id = t and m.user_id = u and m.status = 'active' and m.role = 'coach')
      or exists(select 1 from players p where p.user_id = u and p.deleted_at is null and p.birth_date is not null and p.birth_date <= current_date - interval '18 years'
                and (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t)))
      or exists(select 1 from memberships m join teams x on x.club_id = m.club_id where x.id = t and m.user_id = u and m.status = 'active' and m.role in ('bureau','president'))
    );
$$;
revoke execute on function team_contact_eligible(uuid, uuid) from public, anon;

-- Suis-je (encore) le contact de cette équipe ?
create or replace function is_team_contact(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from team_contacts c where c.team_id = t and c.user_id = auth.uid()) and team_contact_eligible(t, auth.uid());
$$;
create or replace function is_team_contact_all(ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(coalesce(ts, '{}')) > 0 and not exists(select 1 from unnest(ts) t where not is_team_contact(t));
$$;
create or replace function is_team_contact_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and e.audience = 'team' and is_team_contact_all(e.team_ids));
$$;
revoke execute on function is_team_contact(uuid), is_team_contact_all(uuid[]), is_team_contact_event(uuid) from public, anon;

-- Choisir ou retirer le contact (p_user null = retirer)
create or replace function set_team_contact(p_team uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t teams; prev uuid; who text; tn text; cn text;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null then raise exception 'Équipe introuvable'; end if;
  if not (coaches_team(p_team) or has_area(t.club_id, 'evenements') or is_president(t.club_id)) then
    raise exception 'Le contact d''équipe est choisi par le coach de l''équipe, le contact rencontres ou le président';
  end if;
  select user_id into prev from team_contacts where team_id = p_team;
  if p_user is null then
    delete from team_contacts where team_id = p_team;
    if prev is not null then perform log_action(t.club_id, prev, null, 'contact d''équipe retiré', jsonb_build_object('equipe', t.name)); end if;
    return;
  end if;
  if not team_contact_eligible(p_team, p_user) then
    raise exception 'Le contact d''équipe est un adulte : le coach de l''équipe, un joueur majeur de l''équipe ou un membre du bureau';
  end if;
  insert into team_contacts(team_id, club_id, user_id, set_by) values (p_team, t.club_id, p_user, auth.uid())
    on conflict (team_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
  perform log_action(t.club_id, p_user, null, 'contact d''équipe', jsonb_build_object('equipe', t.name));
  if prev is distinct from p_user then
    select coalesce(nullif(trim(full_name), ''), 'Quelqu''un') into who from profiles where id = p_user;
    select name into cn from clubs where id = t.club_id;
    if p_user is distinct from auth.uid() then
      perform push_enqueue(p_user, 'Contact d''équipe', t.name || ' · ' || coalesce(cn, ''), 'tcontact', 'tcontact:' || p_team || ':' || p_user);
    end if;
    -- l'équipe est prévenue de qui est son contact
    perform push_enqueue(u, 'Contact de l''équipe ' || t.name, who || ' est le contact de l''équipe.', 'tcontact', 'tcontactinfo:' || p_team || ':' || p_user || ':' || u)
      from (select distinct x as u from team_people(array[p_team]) x where x is distinct from p_user and x is distinct from auth.uid()) q;
  end if;
end $$;
revoke execute on function set_team_contact(uuid, uuid) from public, anon;
grant execute on function set_team_contact(uuid, uuid) to authenticated;

-- Rendez-vous : le contact crée, modifie, annule pour son équipe
create or replace function can_create_event(c uuid, aud text, ts uuid[], ppl uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select
    not exists(select 1 from unnest(coalesce(ts, '{}')) t where not exists(select 1 from teams x where x.id = t and x.club_id = c and x.deleted_at is null))
    and not exists(select 1 from unnest(coalesce(ppl, '{}')) u where not exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active'))
    and (is_board(c) or (aud = 'team' and (coaches_all(ts) or is_team_contact_all(ts))));
$$;
create or replace function can_manage_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and (
    is_board(e.club_id) or (e.audience = 'team' and (coaches_any(e.team_ids) or is_team_contact_all(e.team_ids)))));
$$;
-- Le droit du contact ne vaut que pour matchs, entraînements, plateaux et tournois
create or replace function events_team_contact_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_board(new.club_id) then return new; end if;
  if new.audience = 'team' and coaches_all(new.team_ids) then return new; end if;
  if new.audience = 'team' and is_team_contact_all(new.team_ids) and new.type not in ('Match','Entraînement','Plateau','Tournoi') then
    raise exception 'Le contact d''équipe crée seulement des matchs, des entraînements, des plateaux et des tournois';
  end if;
  return new;
end $$;
drop trigger if exists events_team_contact_guard on events;
create trigger events_team_contact_guard before insert or update on events for each row execute function events_team_contact_guard();
revoke execute on function events_team_contact_guard() from public, anon, authenticated;

-- Coordonnées : le contact voit celles des joueurs et des familles de son équipe
create or replace function player_contacts(p_club uuid) returns table(id uuid, parent_email text, parent_phone text, emergency_name text, emergency_phone text)
language sql stable security definer set search_path = public as $$
  select x.id, x.parent_email, x.parent_phone, x.emergency_name, x.emergency_phone
  from players x
  where x.club_id = p_club and x.deleted_at is null and auth.uid() is not null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))
    or is_team_contact(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and is_team_contact(pt.team_id))
    or (is_board(x.club_id) and not contacts_hidden_for_me(x.club_id)));
$$;
create or replace function phones_for(p_ids uuid[]) returns table(id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select p.id, p.phone from profiles p where p.id = any(p_ids) and p.phone is not null and p.deleted_at is null and (
    p.id = auth.uid()
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where a.user_id = auth.uid() and a.status = 'active' and a.role in ('president','bureau') and b.user_id = p.id and not contacts_hidden_for_me(a.club_id))
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where b.user_id = p.id and b.status = 'active' and b.role in ('president','bureau','coach') and a.user_id = auth.uid() and a.status = 'active' and a.role <> 'supporteur')
    or exists(select 1 from players x left join player_parents pp on pp.player_id = x.id
      where x.deleted_at is null and (pp.user_id = p.id or x.user_id = p.id)
        and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))
             or is_team_contact(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and is_team_contact(pt.team_id)))));
$$;
revoke execute on function player_contacts(uuid), phones_for(uuid[]) from public, anon;
grant execute on function player_contacts(uuid), phones_for(uuid[]) to authenticated;

-- Convocations : mêmes droits que « Événements », pour les rendez-vous de l'équipe dont on est le contact.
-- Les fonctions de convocation sont récrites à partir de leur définition en place (la condition « has_area(e.club_id, 'evenements') »
-- reçoit « ou contact de l'équipe »). Relançable : une fonction déjà récrite est laissée telle quelle.
do $$
declare r record; def text; n int := 0;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname like 'convocation\_%' and p.prosrc like '%has_area(e.club_id, ''evenements'')%'
             and p.prosrc not like '%is_team_contact_all(e.team_ids)%' loop
    def := replace(pg_get_functiondef(r.oid), 'has_area(e.club_id, ''evenements'')', '(has_area(e.club_id, ''evenements'') or is_team_contact_all(e.team_ids))');
    execute def; n := n + 1;
  end loop;
  raise notice 'n° 174 : % fonction(s) de convocation étendues au contact d''équipe', n;
end $$;

-- ---------------------------------------------------------------------
-- 6. N° 158 · renforts
--    Le coach d'une équipe (ou le président, ou la Technique) ajoute en renfort un joueur du club : même catégorie que l'équipe,
--    ou la catégorie juste en dessous (règles de surclassement de la fédération non vérifiées). Un renfort est un statut pour la saison.
--    La famille (les comptes parents reliés, ou le joueur s'il est majeur) reçoit la demande ; un joueur de 15 à 17 ans est informé, ses
--    parents valident. Sans parent relié : « en attente de la famille », jamais de validation par défaut.
--    Le premier « oui » valide ; un « non » l'emporte, même après un « oui », et retire le renfort. Le coach est prévenu à chaque réponse.
--    Un renfort accepté rejoint l'équipe comme un joueur en « équipe en plus » (agenda, appel, convocations) ; il ne compte dans aucune
--    statistique de licenciés ni dans les cotisations (sa fiche reste dans son équipe d'origine). Le statut tombe quand l'équipe est archivée.
-- ---------------------------------------------------------------------
create table if not exists team_reinforcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  season text not null,
  state text not null default 'demande' check (state in ('demande','accepte','refuse')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz,
  last_reminded_at timestamptz,
  unique (team_id, player_id)
);
create index if not exists team_reinforcements_player on team_reinforcements(player_id);
alter table team_reinforcements enable row level security;
drop policy if exists "renforts lus par l'encadrement et la famille" on team_reinforcements;
create policy "renforts lus par l'encadrement et la famille" on team_reinforcements for select using (
  can_see_player(player_id) or coaches_team(team_id) or is_board(club_id));

-- Échelle des catégories : le renfort vient de la même catégorie ou de celle juste en dessous
create or replace function category_rank(c text) returns int language sql immutable as $$
  select case c when 'U7 (baby)' then 1 when 'U9' then 2 when 'U11' then 3 when 'U13' then 4 when 'U15' then 5 when 'U17' then 6
                when 'U18' then 7 when 'U20' then 8 when 'U21' then 9 when 'Seniors' then 10 else null end;
$$;
create or replace function reinforcement_category_ok(team_cat text, player_cat text) returns boolean language sql immutable as $$
  select coalesce(team_cat, '') <> '' and (team_cat = player_cat
    or (category_rank(team_cat) is not null and category_rank(player_cat) is not null and category_rank(player_cat) = category_rank(team_cat) - 1));
$$;

-- Qui reçoit la demande : les comptes parents reliés ; le joueur lui-même s'il a un compte (majeur : il valide ; mineur : informé)
create or replace function reinforcement_family(p_player uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  select pp.user_id from player_parents pp where pp.player_id = p_player
  union select p.user_id from players p where p.id = p_player and p.user_id is not null;
$$;
revoke execute on function reinforcement_family(uuid) from public, anon, authenticated;

create or replace function add_reinforcement(p_team uuid, p_player uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t teams; pl players; mt teams; rid uuid; cn text; u uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null and state <> 'Archivée';
  if t.id is null then raise exception 'Équipe introuvable'; end if;
  if not (coaches_team(p_team) or is_president(t.club_id) or has_area(t.club_id, 'technique')) then
    raise exception 'Le renfort est ajouté par le coach de l''équipe, la Technique ou le président';
  end if;
  select * into pl from players where id = p_player and deleted_at is null;
  if pl.id is null or pl.club_id <> t.club_id then raise exception 'Joueur introuvable dans ce club'; end if;
  if pl.team_id is null then raise exception 'Ce joueur n''a pas d''équipe : il ne peut pas être renfort'; end if;
  if pl.team_id = p_team or exists(select 1 from player_teams x where x.player_id = p_player and x.team_id = p_team) then
    raise exception 'Ce joueur fait déjà partie de cette équipe';
  end if;
  select * into mt from teams where id = pl.team_id;
  if not reinforcement_category_ok(t.category, mt.category) then
    raise exception 'Un renfort vient de la même catégorie que l''équipe ou de la catégorie juste en dessous';
  end if;
  if exists(select 1 from team_reinforcements where team_id = p_team and player_id = p_player and state = 'refuse') then
    raise exception 'La famille a refusé ce renfort : pas de nouvelle demande cette saison';
  end if;
  insert into team_reinforcements(club_id, team_id, player_id, season, added_by) values (t.club_id, p_team, p_player, t.season, auth.uid())
    on conflict (team_id, player_id) do nothing returning id into rid;
  if rid is null then raise exception 'Une demande existe déjà pour ce joueur dans cette équipe'; end if;
  select name into cn from clubs where id = t.club_id;
  for u in select distinct x from reinforcement_family(p_player) x where x is distinct from auth.uid() loop
    perform push_enqueue(u, 'Renfort demandé', pl.first_name || ' · renfort de ' || t.name || ' · ' || coalesce(cn, ''), 'renfort', 'renfort:' || rid || ':' || u);
  end loop;
  perform log_action(t.club_id, null, p_player, 'renfort demandé', jsonb_build_object('equipe', t.name));
  return rid;
end $$;
revoke execute on function add_reinforcement(uuid, uuid) from public, anon;
grant execute on function add_reinforcement(uuid, uuid) to authenticated;

-- Réponse de la famille : un parent relié, ou le joueur s'il est majeur
create or replace function answer_reinforcement(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare r team_reinforcements; pl players; t teams; u uuid; adult boolean; res text;
begin
  select * into r from team_reinforcements where id = p_id;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  select * into pl from players where id = r.player_id and deleted_at is null;
  select * into t from teams where id = r.team_id and deleted_at is null and state <> 'Archivée';
  if pl.id is null or t.id is null then raise exception 'Demande introuvable'; end if;
  adult := pl.birth_date is not null and pl.birth_date <= current_date - interval '18 years';
  if not (is_parent_of(r.player_id) or (pl.user_id = auth.uid() and adult)) then
    raise exception 'Seuls les parents du joueur (ou le joueur s''il est majeur) répondent à cette demande';
  end if;
  if p_accept then
    if r.state = 'refuse' then raise exception 'Cette demande a été refusée par la famille'; end if;
    if r.state = 'accepte' then return 'accepte'; end if;
    update team_reinforcements set state = 'accepte', answered_by = auth.uid(), answered_at = now() where id = r.id;
    insert into player_teams(player_id, team_id) values (r.player_id, r.team_id) on conflict do nothing;
    res := 'accepte';
  else
    update team_reinforcements set state = 'refuse', answered_by = auth.uid(), answered_at = now() where id = r.id;
    delete from player_teams where player_id = r.player_id and team_id = r.team_id;
    res := 'refuse';
  end if;
  for u in select distinct m.user_id from memberships m where m.team_id = r.team_id and m.role = 'coach' and m.status = 'active' and m.user_id is distinct from auth.uid() loop
    perform push_enqueue(u, case when p_accept then 'Renfort accepté' else 'Renfort refusé' end, pl.first_name || ' · ' || t.name, 'renfort', 'renfort-rep:' || r.id || ':' || res || ':' || u);
  end loop;
  perform log_action(t.club_id, null, r.player_id, case when p_accept then 'renfort accepté' else 'renfort refusé' end, jsonb_build_object('equipe', t.name));
  return res;
end $$;
revoke execute on function answer_reinforcement(uuid, boolean) from public, anon;
grant execute on function answer_reinforcement(uuid, boolean) to authenticated;

-- Retirer un renfort (coach de l'équipe, Technique, président) ; la famille est informée
create or replace function remove_reinforcement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r team_reinforcements; t teams; pl players; u uuid;
begin
  select * into r from team_reinforcements where id = p_id;
  if r.id is null then raise exception 'Renfort introuvable'; end if;
  select * into t from teams where id = r.team_id;
  if not (coaches_team(r.team_id) or is_president(r.club_id) or has_area(r.club_id, 'technique')) then
    raise exception 'Le renfort est retiré par le coach de l''équipe, la Technique ou le président';
  end if;
  select * into pl from players where id = r.player_id;
  delete from player_teams where player_id = r.player_id and team_id = r.team_id;
  delete from team_reinforcements where id = r.id;
  if r.state = 'accepte' then
    for u in select distinct x from reinforcement_family(r.player_id) x where x is distinct from auth.uid() loop
      perform push_enqueue(u, 'Renfort terminé', coalesce(pl.first_name, '') || ' n''est plus renfort de ' || coalesce(t.name, ''), 'renfort', 'renfort-fin:' || r.id || ':' || u);
    end loop;
  end if;
  perform log_action(r.club_id, null, r.player_id, 'renfort retiré', jsonb_build_object('equipe', coalesce(t.name, '')));
end $$;
revoke execute on function remove_reinforcement(uuid) from public, anon;
grant execute on function remove_reinforcement(uuid) to authenticated;

-- Relance de la famille : au plus toutes les 12 heures
create or replace function remind_reinforcement(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r team_reinforcements; t teams; pl players; u uuid; n int := 0;
begin
  select * into r from team_reinforcements where id = p_id;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  if not (coaches_team(r.team_id) or is_president(r.club_id) or has_area(r.club_id, 'technique')) then raise exception 'Réservé au coach de l''équipe, à la Technique et au président'; end if;
  if r.state <> 'demande' then raise exception 'Cette demande a déjà une réponse'; end if;
  if r.last_reminded_at is not null and r.last_reminded_at > now() - interval '12 hours' then raise exception 'Relance déjà faite il y a moins de 12 heures'; end if;
  select * into t from teams where id = r.team_id; select * into pl from players where id = r.player_id;
  update team_reinforcements set last_reminded_at = now() where id = r.id;
  for u in select distinct x from reinforcement_family(r.player_id) x loop
    perform push_enqueue(u, 'Renfort : réponse attendue', pl.first_name || ' · renfort de ' || t.name, 'renfort', 'renfort-rel:' || r.id || ':' || to_char(now(), 'YYYYMMDDHH24') || ':' || u);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function remind_reinforcement(uuid) from public, anon;
grant execute on function remind_reinforcement(uuid) to authenticated;

-- Pour l'écran du coach : joueurs du club qu'il peut proposer en renfort (« Prénom N. », équipe d'origine, catégorie) et renforts de l'équipe.
-- Le coach ne voit pas les fiches des autres équipes : la base ne donne que ce qui sert à choisir.
create or replace function reinforcement_candidates(p_team uuid) returns table(player_id uuid, label text, team_name text, category text)
language plpgsql stable security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and deleted_at is null and state <> 'Archivée';
  if t.id is null or not (coaches_team(p_team) or is_president(t.club_id) or has_area(t.club_id, 'technique')) then raise exception 'Réservé au coach de l''équipe, à la Technique et au président'; end if;
  return query
    select p.id, p.first_name || ' ' || upper(left(coalesce(nullif(p.last_name, ''), ' '), 1)) || '.', x.name, x.category
    from players p join teams x on x.id = p.team_id
    where p.club_id = t.club_id and p.deleted_at is null and x.deleted_at is null and x.state <> 'Archivée' and x.id <> p_team
      and reinforcement_category_ok(t.category, x.category)
      and not exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = p_team)
      and not exists(select 1 from team_reinforcements r where r.team_id = p_team and r.player_id = p.id)
    order by p.first_name, p.last_name;
end $$;
create or replace function reinforcements_of(p_team uuid) returns table(id uuid, player_id uuid, label text, team_name text, state text, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams tt where tt.id = p_team and tt.deleted_at is null;
  if t.id is null or not (coaches_team(p_team) or is_board(t.club_id) or is_team_contact(p_team)) then raise exception 'Réservé à l''encadrement de l''équipe'; end if;
  return query
    select r.id, r.player_id, p.first_name || ' ' || upper(left(coalesce(nullif(p.last_name, ''), ' '), 1)) || '.', x.name, r.state, r.last_reminded_at
    from team_reinforcements r join players p on p.id = r.player_id left join teams x on x.id = p.team_id
    where r.team_id = p_team and p.deleted_at is null order by r.created_at;
end $$;
revoke execute on function reinforcement_candidates(uuid), reinforcements_of(uuid) from public, anon;
grant execute on function reinforcement_candidates(uuid), reinforcements_of(uuid) to authenticated;

-- Le statut tombe quand l'équipe est archivée (fin de saison) ou supprimée
create or replace function teams_reinforcement_end() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.state = 'Archivée' and old.state is distinct from 'Archivée') or (new.deleted_at is not null and old.deleted_at is null) then
    delete from player_teams pt using team_reinforcements r where r.team_id = new.id and r.state = 'accepte' and pt.team_id = r.team_id and pt.player_id = r.player_id;
    delete from team_reinforcements where team_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists teams_reinforcement_end on teams;
create trigger teams_reinforcement_end after update of state, deleted_at on teams for each row execute function teams_reinforcement_end();
revoke execute on function teams_reinforcement_end() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. N° 78 · colonne « Club » à l'import : dans une équipe en entente, une ligne dont le club est celui du partenaire
--    (même nom, sans tenir compte des majuscules) est notée « joueur du club partenaire ». Autre valeur ou vide : « Notre club ».
-- ---------------------------------------------------------------------
create or replace function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid; pname text;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Liste trop longue (300 lignes au plus)'; end if;
  select case when partner_state <> 'aucune' then nullif(lower(trim(partner_name)), '') end into pname from teams where id = p_team;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid, email text, phone text, club text) loop
    if coalesce(r.action, 'create') = 'skip' or coalesce(trim(r.first_name), '') = '' then continue; end if;
    r.email := nullif(lower(trim(coalesce(r.email, ''))), ''); if r.email is not null and r.email not like '%@%' then r.email := null; end if;
    r.phone := nullif(trim(coalesce(r.phone, '')), '');
    if r.action in ('complete', 'addteam') then
      if not exists(select 1 from players where id = r.existing and club_id = p_club and deleted_at is null) then continue; end if;
      update players set birth_date = coalesce(birth_date, r.birth_date), parent_email = coalesce(parent_email, r.email), parent_phone = coalesce(parent_phone, r.phone) where id = r.existing;
      if coalesce(r.licence, '') <> '' then
        insert into player_admin(player_id, licence_number) values (r.existing, r.licence)
          on conflict (player_id) do update set licence_number = coalesce(player_admin.licence_number, excluded.licence_number);
      end if;
      if r.action = 'addteam' and p_team is not null then insert into player_teams values (r.existing, p_team) on conflict do nothing; end if;
      n := n + 1; continue;
    end if;
    insert into players(club_id, team_id, first_name, last_name, birth_date, parent_email, parent_phone, created_by, from_partner)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, r.email, r.phone, auth.uid(),
              pname is not null and lower(trim(coalesce(r.club, ''))) = pname) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function import_players(uuid, uuid, jsonb) from public, anon;
grant execute on function import_players(uuid, uuid, jsonb) to authenticated;

select close_visitor_functions();
