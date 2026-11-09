-- mypocketclub · alpha 4.6.0 · mise à jour d'une base 4.5.0, sans perte de données, relançable.
-- Récapitulatif de Gaël du 9 novembre 2026, première mise à jour du soir (« lance la première maj », 18 h 34) :
-- 1. N° 143 : une personne entrée au bureau par « Qui s'occupe de quoi » (désignation) en sort quand la désignation
--    est retirée ou donnée à quelqu'un d'autre (elle gardait la fonction « Correspondant licences »).
-- 2. N° 166 : intitulé libre d'un « Membre du bureau » (« Responsable maillots »), choisi par le président.
-- 3. N° 148 : administrateur principal ; lui seul ajoute ou retire un administrateur (admin_list, admin_add, admin_remove).
-- 4. N° 79 : « + accompagnants » (personnes sans compte) sur sa propre réponse « oui » à un événement.
-- 5. N° 160 : séances types (nommées, sans date) et durée visée d'une séance.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 143 · fonction créée par une désignation, retirée avec elle
-- ---------------------------------------------------------------------
alter table memberships add column if not exists designated_for text;
-- reprise : une fonction de correspondant qui correspond à une désignation en cours est marquée comme venue d'elle
update memberships m set designated_for = d.resp
  from club_designations d
  where m.designated_for is null and m.club_id = d.club_id and m.user_id = d.user_id and m.role = 'bureau' and m.status = 'active'
    and m.fonction = case d.resp when 'licences' then 'Correspondant licences' when 'rencontres' then 'Correspondant rencontres'
                                 when 'communication' then 'Chargé de communication' else 'Membre du bureau' end;

-- une fonction changée à la main par le président n'est plus « venue d'une désignation »
create or replace function memberships_designation_keep() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.designated_for is not null and old.fonction is distinct from new.fonction then new.designated_for := null; end if;
  return new;
end $$;
drop trigger if exists memberships_designation_keep on memberships;
create trigger memberships_designation_keep before update on memberships for each row execute function memberships_designation_keep();

create or replace function set_designation(p_club uuid, p_resp text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f text; cn text; prev uuid;
begin
  if not is_president(p_club) then raise exception 'Seul le président désigne qui s''occupe de quoi'; end if;
  if p_resp not in ('licences','rencontres','evenements','communication') then raise exception 'Responsabilité inconnue'; end if;
  select user_id into prev from club_designations where club_id = p_club and resp = p_resp;
  if p_user is null then
    delete from club_designations where club_id = p_club and resp = p_resp;
  else
    if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
    if not account_is_adult(p_club, p_user) then raise exception 'Seule une personne adulte peut être désignée'; end if;
  end if;
  -- n° 143 : l'ancienne personne quitte la fonction que la désignation lui avait donnée
  if prev is not null and prev is distinct from p_user then
    delete from memberships where club_id = p_club and user_id = prev and role = 'bureau' and designated_for = p_resp;
  end if;
  if p_user is null then
    perform log_action(p_club, null, null, 'désignation retirée', jsonb_build_object('responsabilite', p_resp));
    return;
  end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active' and role in ('bureau','president')) then
    f := case p_resp when 'licences' then 'Correspondant licences' when 'rencontres' then 'Correspondant rencontres'
                     when 'communication' then 'Chargé de communication' else 'Membre du bureau' end;
    insert into memberships(club_id, user_id, role, fonction, status, designated_for) values (p_club, p_user, 'bureau', f, 'active', p_resp);
  end if;
  insert into club_designations(club_id, resp, user_id, set_by) values (p_club, p_resp, p_user, auth.uid())
    on conflict (club_id, resp) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
  perform log_action(p_club, p_user, null, 'désignation', jsonb_build_object('responsabilite', p_resp));
  if p_user <> auth.uid() then
    select name into cn from clubs where id = p_club;
    perform push_enqueue(p_user, 'Le président compte sur toi', (case p_resp when 'licences' then 'Correspondant licences' when 'rencontres' then 'Correspondant rencontres'
      when 'evenements' then 'Événements' else 'Communication' end) || ' · ' || coalesce(cn, ''), 'fonction', 'designation:' || p_club || ':' || p_resp || ':' || p_user);
  end if;
end $$;
revoke execute on function set_designation(uuid, text, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 2. N° 166 · intitulé libre d'un « Membre du bureau »
-- ---------------------------------------------------------------------
alter table memberships add column if not exists title text;
alter table memberships drop constraint if exists memberships_title_len;
alter table memberships add constraint memberships_title_len check (title is null or length(title) between 1 and 40);

create or replace function set_bureau_title(p_membership uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; t text := nullif(left(trim(regexp_replace(coalesce(p_title, ''), '[<>]', '', 'g')), 40), '');
begin
  select * into m from memberships where id = p_membership;
  if m.id is null or not is_president(m.club_id) then raise exception 'Seul le président choisit l''intitulé'; end if;
  if m.role <> 'bureau' or coalesce(m.fonction, 'Membre du bureau') <> 'Membre du bureau' then raise exception 'Intitulé libre : seulement pour un « Membre du bureau »'; end if;
  update memberships set title = t where id = p_membership;
  perform log_action(m.club_id, m.user_id, null, 'intitulé du bureau', jsonb_build_object('intitule', coalesce(t, '—')));
end $$;
-- l'intitulé disparaît si la fonction change
create or replace function memberships_title_keep() returns trigger language plpgsql as $$
begin
  if coalesce(new.fonction, 'Membre du bureau') <> 'Membre du bureau' or new.role <> 'bureau' then new.title := null; end if;
  return new;
end $$;
drop trigger if exists memberships_title_keep on memberships;
create trigger memberships_title_keep before insert or update on memberships for each row execute function memberships_title_keep();

-- ---------------------------------------------------------------------
-- 3. N° 148 · administrateur principal
-- ---------------------------------------------------------------------
alter table app_admins add column if not exists principal boolean not null default false;
-- première installation : les administrateurs déjà en place (les deux comptes de Gaël) deviennent principaux
update app_admins set principal = true where not exists(select 1 from app_admins where principal);

create or replace function is_principal_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_admins where user_id = auth.uid() and principal);
$$;
create or replace function admin_list() returns table(user_id uuid, email text, name text, principal boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select a.user_id, u.email::text, coalesce(nullif(trim(p.full_name), ''), '')::text, a.principal
    from app_admins a join auth.users u on u.id = a.user_id left join profiles p on p.id = a.user_id
    order by a.principal desc, 3;
end $$;
create or replace function admin_add(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not is_principal_admin() then raise exception 'Seul l''administrateur principal ajoute un administrateur'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'Aucun compte avec cette adresse : la personne doit d''abord créer son compte'; end if;
  insert into app_admins(user_id, principal) values (u, false) on conflict (user_id) do nothing;
end $$;
create or replace function admin_remove(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_principal_admin() then raise exception 'Seul l''administrateur principal retire un administrateur'; end if;
  if exists(select 1 from app_admins where user_id = p_user and principal) then raise exception 'Un administrateur principal ne se retire pas depuis l''application'; end if;
  delete from app_admins where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- 4. N° 79 · accompagnants sans compte
-- ---------------------------------------------------------------------
alter table event_responses add column if not exists guests smallint not null default 0;
alter table event_responses drop constraint if exists event_responses_guests;
alter table event_responses add constraint event_responses_guests check (guests between 0 and 20);
create or replace function event_responses_guests_reset() returns trigger language plpgsql as $$
begin
  if new.answer <> 'oui' or new.player_id is not null then new.guests := 0; end if;
  return new;
end $$;
drop trigger if exists event_responses_guests_reset on event_responses;
create trigger event_responses_guests_reset before insert or update on event_responses for each row execute function event_responses_guests_reset();

create or replace function set_event_guests(p_event uuid, p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi'; end if;
  if p_n < 0 or p_n > 20 then raise exception 'Entre 0 et 20 accompagnants'; end if;
  update event_responses set guests = p_n, updated_at = now()
    where event_id = p_event and user_id = auth.uid() and player_id is null and answer = 'oui';
  if not found then raise exception 'Réponds d''abord « Je participe »'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. N° 160 · séances types et durée visée
-- ---------------------------------------------------------------------
alter table training_plans add column if not exists is_template boolean not null default false;
alter table training_plans add column if not exists target_min smallint;
alter table training_plans drop constraint if exists training_plans_target;
alter table training_plans add constraint training_plans_target check (target_min is null or target_min between 10 and 600);
-- une séance type n'est reliée à aucun rendez-vous
alter table training_plans drop constraint if exists training_plans_template_noevent;
alter table training_plans add constraint training_plans_template_noevent check (not is_template or event_id is null);

-- ---------------------------------------------------------------------
-- 6. Droits d'exécution, puis fermeture au visiteur (règle de la 4.3.0)
-- ---------------------------------------------------------------------
revoke execute on function memberships_designation_keep(), memberships_title_keep(), event_responses_guests_reset() from public, anon, authenticated;
revoke execute on function is_principal_admin() from public, anon;
grant execute on function set_designation(uuid, text, uuid), set_bureau_title(uuid, text), is_principal_admin(), admin_list(), admin_add(text),
  admin_remove(uuid), set_event_guests(uuid, int) to authenticated;

select close_visitor_functions();
