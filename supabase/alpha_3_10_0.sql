-- mypocketclub · alpha 3.10.0 · n° 114 (président et bureau : fonctions renommées et attribuables, « Qui s'occupe de quoi »,
-- transfert de la présidence accepté par le nouveau président, suppression du club en corbeille de 30 jours).
-- Le n° 113 (espace coach en deux niveaux) et le n° 115 (« Payer · Bientôt disponible ») ne touchent pas à la base.
-- Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- 1. Renommages (décision de Gaël du 4 novembre 2026)
--    « Coordinateur » → « Correspondant rencontres » : matchs, plateaux, tournois, convocations, bénévoles ;
--    la rubrique Technique lui est retirée par défaut (le président peut la rouvrir en plus).
--    « Directeur sportif » → « Directeur technique ».
--    « Correspondant licences » : les licences seulement (rubrique « licences »), plus tout le Secrétariat.
-- ---------------------------------------------------------------------
alter table memberships drop constraint if exists memberships_fonction;
update memberships set fonction = 'Correspondant rencontres' where fonction = 'Coordinateur';
update memberships set fonction = 'Directeur technique' where fonction = 'Directeur sportif';
alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur technique','Correspondant rencontres',
  'Correspondant licences','Chargé de communication','Responsable sponsoring','Membre du bureau'));

-- « licences » = sous-rubrique du Secrétariat : état, numéro et certificat (fourni ou non) des licences
create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['licences']
    when 'Directeur technique' then array['technique']
    when 'Correspondant rencontres' then array['evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then '{}'::text[]
    when 'Membre du bureau' then '{}'::text[]
    -- anciens noms (téléphone pas encore mis à jour) : mêmes droits que les nouveaux
    when 'Directeur sportif' then array['technique'] when 'Coordinateur' then array['evenements']
    else '{}'::text[] end;
$$;
-- Un téléphone resté en 3.9.0 envoie encore les anciens noms : on les traduit
create or replace function memberships_fonction_rename() returns trigger language plpgsql as $$
begin
  if new.fonction = 'Coordinateur' then new.fonction := 'Correspondant rencontres'; end if;
  if new.fonction = 'Directeur sportif' then new.fonction := 'Directeur technique'; end if;
  return new;
end $$;
drop trigger if exists a_memberships_fonction_rename on memberships;
create trigger a_memberships_fonction_rename before insert or update on memberships for each row execute function memberships_fonction_rename();

-- ---------------------------------------------------------------------
-- 2. Adultes seulement au bureau et à la présidence (garde-fou du n° 114)
--    Une personne dont le compte est relié à une fiche joueur mineure (ou sans date de naissance) ne reçoit pas de fonction.
-- ---------------------------------------------------------------------
create or replace function account_is_adult(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select not exists(select 1 from players p where p.club_id = c and p.user_id = u and p.deleted_at is null
                    and (p.birth_date is null or p.birth_date > current_date - interval '18 years'));
$$;
revoke execute on function account_is_adult(uuid, uuid) from public, anon;

create or replace function memberships_fonction_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and new.fonction in ('Vice-président','Secrétaire','Trésorier')
     and exists(select 1 from memberships m where m.club_id = new.club_id and m.fonction = new.fonction and m.status = 'active' and m.id <> new.id) then
    raise exception 'La fonction « % » est déjà tenue : le président doit d''abord la retirer', new.fonction;
  end if;
  if new.status = 'active' and new.role in ('bureau','president')
     and (tg_op = 'INSERT' or old.status <> 'active' or old.role <> new.role or old.fonction is distinct from new.fonction)
     and not account_is_adult(new.club_id, new.user_id) then
    raise exception 'Les fonctions du bureau sont réservées aux adultes (fiche joueur mineure ou sans date de naissance)';
  end if;
  return new;
end $$;

-- Prévenir la personne quand une fonction lui est attribuée ou retirée (n° 114)
create or replace function memberships_fonction_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare cn text;
begin
  if tg_op = 'DELETE' then
    if old.role = 'bureau' and old.status = 'active' and old.user_id is distinct from auth.uid() then
      select name into cn from clubs where id = old.club_id;
      perform push_enqueue(old.user_id, 'Fonction retirée', coalesce(old.fonction, 'Membre du bureau') || ' · ' || coalesce(cn, ''), 'fonction', 'fonction-retiree:' || old.id);
    end if;
    return old;
  end if;
  if new.role = 'bureau' and new.status = 'active' and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.status <> 'active' or old.fonction is distinct from new.fonction) then
    select name into cn from clubs where id = new.club_id;
    perform push_enqueue(new.user_id, 'Nouvelle fonction', coalesce(new.fonction, 'Membre du bureau') || ' · ' || coalesce(cn, ''), 'fonction', 'fonction:' || new.id || ':' || coalesce(new.fonction, ''));
  end if;
  return new;
end $$;
drop trigger if exists memberships_fonction_notify on memberships;
create trigger memberships_fonction_notify after insert or update or delete on memberships for each row execute function memberships_fonction_notify();

-- ---------------------------------------------------------------------
-- 3. « Qui s'occupe de quoi » (n° 114) : le président désigne une personne adulte du club pour chaque responsabilité.
--    Sans désignation : licences = le secrétaire (sinon le président), rencontres = le président et le vice-président,
--    événements = le président, communication = le président.
--    Une personne qui n'est pas au bureau y entre (fonction correspondante), pour garder un seul modèle de droits.
-- ---------------------------------------------------------------------
create table if not exists club_designations (
  club_id uuid not null references clubs(id) on delete cascade,
  resp text not null check (resp in ('licences','rencontres','evenements','communication')),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (club_id, resp)
);
alter table club_designations enable row level security;
drop policy if exists "désignations lues par les membres" on club_designations;
create policy "désignations lues par les membres" on club_designations for select using (is_member(club_id));

create or replace function designation_area(r text) returns text language sql immutable as $$
  select case r when 'licences' then 'licences' when 'rencontres' then 'evenements' when 'evenements' then 'evenements' when 'communication' then 'communication' end;
$$;

create or replace function areas_of(c uuid, u uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'president')
      then array['tresorerie','secretariat','technique','communication','evenements','licences']
    when not exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'bureau') then '{}'::text[]
    else coalesce((select array_agg(distinct a order by a) from (
        select unnest(fonction_areas(m.fonction)) a from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'bureau'
        union select b.area from board_areas b where b.club_id = c and b.user_id = u
        union select designation_area(d.resp) from club_designations d where d.club_id = c and d.user_id = u
        -- le Secrétariat comprend les licences
        union select 'licences' where exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'bureau' and 'secretariat' = any(fonction_areas(m.fonction)))
           or exists(select 1 from board_areas b where b.club_id = c and b.user_id = u and b.area = 'secretariat')) x), '{}'::text[]) end;
$$;

create or replace function set_designation(p_club uuid, p_resp text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f text; cn text;
begin
  if not is_president(p_club) then raise exception 'Seul le président désigne qui s''occupe de quoi'; end if;
  if p_resp not in ('licences','rencontres','evenements','communication') then raise exception 'Responsabilité inconnue'; end if;
  if p_user is null then
    delete from club_designations where club_id = p_club and resp = p_resp;
    perform log_action(p_club, null, null, 'désignation retirée', jsonb_build_object('responsabilite', p_resp));
    return;
  end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if not account_is_adult(p_club, p_user) then raise exception 'Seule une personne adulte peut être désignée'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active' and role in ('bureau','president')) then
    f := case p_resp when 'licences' then 'Correspondant licences' when 'rencontres' then 'Correspondant rencontres'
                     when 'communication' then 'Chargé de communication' else 'Membre du bureau' end;
    insert into memberships(club_id, user_id, role, fonction, status) values (p_club, p_user, 'bureau', f, 'active');
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

-- Une désignation disparaît quand la personne quitte le club ou le bureau
create or replace function designations_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from memberships where club_id = old.club_id and user_id = old.user_id and status = 'active' and role in ('bureau','president') and id <> old.id) then
    delete from club_designations where club_id = old.club_id and user_id = old.user_id;
  end if;
  return old;
end $$;
drop trigger if exists designations_cleanup on memberships;
create trigger designations_cleanup after delete on memberships for each row execute function designations_cleanup();

-- ---------------------------------------------------------------------
-- 4. Licences (n° 114) : le trésorier change l'état de la licence sur la ligne de la cotisation ;
--    numéro et certificat restent au Secrétariat et au correspondant licences.
-- ---------------------------------------------------------------------
create or replace function can_see_fees(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x join clubs c on c.id = x.club_id where x.id = p and x.deleted_at is null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or has_area(x.club_id, 'tresorerie') or has_area(x.club_id, 'secretariat') or has_area(x.club_id, 'licences')
    or (c.coach_sees_fees and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))))));
$$;
drop policy if exists "dossier saisi par le bureau" on player_admin;
create policy "dossier saisi par le bureau" on player_admin for update
  using (can_admin_player(player_id) and (has_area((select club_id from players where id = player_id), 'tresorerie')
    or has_area((select club_id from players where id = player_id), 'secretariat') or has_area((select club_id from players where id = player_id), 'licences')))
  with check (can_admin_player(player_id));
create or replace function player_admin_area_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then return new; end if;
  select club_id into c from players where id = new.player_id;
  if (new.licence_number, new.health_doc) is distinct from (old.licence_number, old.health_doc) and not has_area(c, 'licences') then
    raise exception 'La licence se règle dans la rubrique Secrétariat';
  end if;
  if new.licence_state is distinct from old.licence_state and not (has_area(c, 'licences') or has_area(c, 'tresorerie')) then
    raise exception 'L''état de la licence se règle au Secrétariat ou à la Trésorerie';
  end if;
  if new.fee_method is distinct from old.fee_method and not has_area(c, 'tresorerie') then
    raise exception 'La cotisation se règle dans la rubrique Trésorerie';
  end if;
  -- le correspondant licences seul ne touche pas aux montants (les recalculs faits par la base restent possibles)
  if pg_trigger_depth() = 1 and (new.fee_amount, new.fee_paid) is distinct from (old.fee_amount, old.fee_paid)
     and not has_area(c, 'tresorerie') and not has_area(c, 'secretariat') and not has_area(c, 'technique') then
    raise exception 'La cotisation se règle dans la rubrique Trésorerie';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Informations du club (nom, blason, couleurs) : président et vice-président seulement (n° 114)
-- ---------------------------------------------------------------------
create or replace function is_vice_president(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'bureau' and fonction = 'Vice-président');
$$;
create or replace function clubs_guard_310() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.name, new.city, new.postal_code, new.sport, new.color1, new.color2, new.crest_bg, new.logo, new.crest_outline)
     is distinct from (old.name, old.city, old.postal_code, old.sport, old.color1, old.color2, old.crest_bg, old.logo, old.crest_outline)
     and not (is_president(old.id) or is_vice_president(old.id)) then
    raise exception 'Le blason et les informations du club sont réglés par le président';
  end if;
  if (new.deleted_at, new.deleted_by) is distinct from (old.deleted_at, old.deleted_by) and coalesce(current_setting('pc.club_delete', true), '') <> 'on' then
    raise exception 'La suppression du club passe par « Supprimer le club »';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Transfert de la présidence : le nouveau président doit accepter (n° 114)
-- ---------------------------------------------------------------------
create table if not exists president_offers (
  club_id uuid primary key references clubs(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table president_offers enable row level security;
drop policy if exists "proposition lue par les deux personnes" on president_offers;
create policy "proposition lue par les deux personnes" on president_offers for select using (from_user = auth.uid() or to_user = auth.uid());

create or replace function offer_presidency(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cn text;
begin
  if not is_president(p_club) then raise exception 'Seul le président transfère la présidence'; end if;
  if p_user is null then delete from president_offers where club_id = p_club; perform log_action(p_club, null, null, 'transfert de la présidence annulé', '{}'::jsonb); return; end if;
  if p_user = auth.uid() then raise exception 'Choisis une autre personne'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if not account_is_adult(p_club, p_user) then raise exception 'La présidence revient à une personne adulte'; end if;
  insert into president_offers(club_id, from_user, to_user) values (p_club, auth.uid(), p_user)
    on conflict (club_id) do update set from_user = excluded.from_user, to_user = excluded.to_user, created_at = now();
  perform log_action(p_club, p_user, null, 'présidence proposée', '{}'::jsonb);
  select name into cn from clubs where id = p_club;
  perform push_enqueue(p_user, 'Présidence du club', 'On te propose de devenir président de ' || coalesce(cn, 'ton club') || ' : accepte ou refuse dans Mon compte', 'presidence', 'presidence:' || p_club || ':' || p_user);
end $$;
revoke execute on function offer_presidency(uuid, uuid) from public, anon;

create or replace function answer_presidency(p_club uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o president_offers;
begin
  select * into o from president_offers where club_id = p_club and to_user = auth.uid();
  if o.club_id is null then raise exception 'Aucune proposition de présidence pour toi'; end if;
  if o.created_at < now() - interval '14 days' then delete from president_offers where club_id = p_club; raise exception 'La proposition a expiré (14 jours) : demande au président de la refaire'; end if;
  delete from president_offers where club_id = p_club;
  if not p_accept then
    perform log_action(p_club, o.from_user, null, 'présidence refusée', '{}'::jsonb);
    perform push_enqueue(o.from_user, 'Présidence refusée', 'La personne a refusé la présidence du club', 'presidence', 'presidence-refus:' || p_club || ':' || now());
    return;
  end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = o.from_user and role = 'president' and status = 'active') then raise exception 'La proposition n''est plus valable'; end if;
  if not account_is_adult(p_club, auth.uid()) then raise exception 'La présidence revient à une personne adulte'; end if;
  -- l'ancien président reste au bureau, comme membre ; le président le règle ensuite
  update memberships set role = 'bureau', fonction = 'Membre du bureau' where club_id = p_club and user_id = o.from_user and role = 'president';
  if exists(select 1 from memberships where club_id = p_club and user_id = auth.uid() and role = 'president') then
    update memberships set status = 'active' where club_id = p_club and user_id = auth.uid() and role = 'president';
  else
    insert into memberships(club_id, user_id, role, status) values (p_club, auth.uid(), 'president', 'active');
  end if;
  perform log_action(p_club, o.from_user, null, 'présidence transférée', '{}'::jsonb);
  perform push_enqueue(o.from_user, 'Présidence transférée', 'Ta proposition est acceptée : tu restes au bureau', 'presidence', 'presidence-ok:' || p_club || ':' || now());
end $$;
revoke execute on function answer_presidency(uuid, boolean) from public, anon;

-- ---------------------------------------------------------------------
-- 7. Supprimer le club : corbeille de 30 jours, nom du club à taper (n° 114)
--    Pendant 30 jours, seul le président voit encore le club et peut le restaurer ; ensuite tout est effacé.
-- ---------------------------------------------------------------------
alter table clubs add column if not exists deleted_at timestamptz;
alter table clubs add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table clubs add column if not exists listed_before_delete boolean;
drop trigger if exists clubs_guard_310 on clubs;
create trigger clubs_guard_310 before update on clubs for each row execute function clubs_guard_310();
drop policy if exists "club supprimé par le président" on clubs;   -- plus d'effacement direct : la corbeille d'abord

create or replace function club_alive(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from clubs where id = c and deleted_at is null);
$$;
create or replace function is_member(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and (role = 'president' or club_alive(c)));
$$;
create or replace function is_board(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and (role = 'president' or (role = 'bureau' and club_alive(c))));
$$;
create or replace function is_coach_in(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select club_alive(c) and exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'coach');
$$;

create or replace function delete_club(p_club uuid, p_name text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare c clubs;
begin
  if not is_president(p_club) then raise exception 'Seul le président supprime le club'; end if;
  select * into c from clubs where id = p_club;
  if c.deleted_at is not null then raise exception 'Le club est déjà dans la corbeille'; end if;
  if lower(trim(coalesce(p_name, ''))) <> lower(trim(c.name)) then raise exception 'Tape exactement le nom du club pour confirmer'; end if;
  perform set_config('pc.club_delete', 'on', true);
  update clubs set deleted_at = now(), deleted_by = auth.uid(), listed_before_delete = public_listed, public_listed = false where id = p_club;
  perform set_config('pc.club_delete', '', true);
  delete from president_offers where club_id = p_club;
  perform log_action(p_club, null, null, 'club envoyé à la corbeille', '{}'::jsonb);
  return now() + interval '30 days';
end $$;
revoke execute on function delete_club(uuid, text) from public, anon;

create or replace function restore_club(p_club uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Seul le président restaure le club'; end if;
  perform set_config('pc.club_delete', 'on', true);
  update clubs set deleted_at = null, deleted_by = null, public_listed = coalesce(listed_before_delete, public_listed), listed_before_delete = null where id = p_club and deleted_at is not null;
  perform set_config('pc.club_delete', '', true);
  perform log_action(p_club, null, null, 'club restauré', '{}'::jsonb);
end $$;
revoke execute on function restore_club(uuid) from public, anon;

-- Personne ne rejoint un club dans la corbeille
create or replace function memberships_club_alive() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not club_alive(new.club_id) and new.role <> 'president' then raise exception 'Ce club a été supprimé'; end if;
  return new;
end $$;
drop trigger if exists memberships_club_alive on memberships;
create trigger memberships_club_alive before insert on memberships for each row execute function memberships_club_alive();

-- La corbeille efface aussi les clubs supprimés depuis plus de 30 jours (suite de la purge habituelle)
create or replace function purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; u uuid; lim timestamptz := now() - interval '30 days';
begin
  delete from clubs where deleted_at < lim; get diagnostics k = row_count; n := n + k;
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
