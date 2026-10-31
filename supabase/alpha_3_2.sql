-- Pocket Club · alpha 3.2 · vie du club (relançable sans risque, ne supprime aucune donnée)
-- N° 54 fonctions du bureau · N° 55 rubriques par fonction (contrôlées par la base) · N° 53 bénévoles
-- Annonces officielles, convocations et relance · accueil multi-clubs · réglages du président
set client_min_messages = warning;

create table if not exists pc_migrations (name text primary key, at timestamptz not null default now());
alter table pc_migrations enable row level security;   -- aucune règle : lecture et écriture par les scripts seulement

-- =====================================================================
-- 1. N° 54 · fonctions du bureau ; N° 55 · rubriques
-- =====================================================================
alter table memberships add column if not exists fonction text;
do $$ begin alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur sportif','Coordinateur',
  'Correspondant licences','Chargé de communication','Responsable sponsoring','Responsable événements et buvette','Membre du bureau'));
exception when duplicate_object then null; end $$;
-- une seule personne pour la vice-présidence, le secrétariat et la trésorerie
create unique index if not exists memberships_fonction_unique on memberships(club_id, fonction)
  where status = 'active' and fonction in ('Vice-président','Secrétaire','Trésorier');

-- Rubriques : tresorerie, secretariat, technique, communication, evenements (« Commun » = tout le bureau)
create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['secretariat']
    when 'Directeur sportif' then array['technique']
    when 'Coordinateur' then array['technique','evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then array['communication']
    when 'Responsable événements et buvette' then array['evenements']
    else '{}'::text[] end;
$$;

create table if not exists board_areas (                                 -- rubrique ouverte en plus par le président
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null check (area in ('tresorerie','secretariat','technique','communication','evenements')),
  granted_by uuid references auth.users(id) on delete set null,
  at timestamptz not null default now(),
  primary key (club_id, user_id, area)
);
alter table board_areas enable row level security;
drop policy if exists "rubriques lues par le bureau" on board_areas;
create policy "rubriques lues par le bureau" on board_areas for select using (user_id = auth.uid() or is_board(club_id));

create or replace function areas_of(c uuid, u uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'president')
      then array['tresorerie','secretariat','technique','communication','evenements']
    when not exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'bureau') then '{}'::text[]
    else coalesce((select array_agg(distinct a order by a) from (
        select unnest(fonction_areas(m.fonction)) a from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'bureau'
        union select b.area from board_areas b where b.club_id = c and b.user_id = u) x), '{}'::text[]) end;
$$;
create or replace function has_area(c uuid, a text) returns boolean language sql stable security definer set search_path = public as $$
  select a = any(areas_of(c, auth.uid()));
$$;
create or replace function my_areas(c uuid) returns text[] language sql stable security definer set search_path = public as $$
  select areas_of(c, auth.uid());
$$;

-- Une demande de bureau = une fonction ; plusieurs fonctions = plusieurs demandes
create or replace function join_guard() returns trigger language plpgsql as $$
begin
  if new.role = 'bureau' then new.fonction := coalesce(new.fonction, 'Membre du bureau'); else new.fonction := null; end if;
  if new.role <> 'parent' and exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.user_id and m.role = new.role
       and m.team_id is not distinct from new.team_id and m.fonction is not distinct from new.fonction and m.id <> new.id) then
    raise exception 'Tu as déjà ce rôle ou une demande en attente pour ce rôle';
  end if;
  return new;
end $$;
-- reprise : les membres du bureau déjà inscrits sont « Membre du bureau » et gardent toutes leurs rubriques
-- (ouvertes par le président) jusqu'à ce que le président règle leurs fonctions
update memberships set fonction = 'Membre du bureau' where role = 'bureau' and fonction is null;
do $$ begin
  if not exists(select 1 from pc_migrations where name = '3.2-rubriques') then
    insert into board_areas(club_id, user_id, area)
      select distinct m.club_id, m.user_id, a from memberships m, unnest(array['tresorerie','secretariat','technique','communication','evenements']) a
      where m.role = 'bureau' and m.status = 'active' on conflict do nothing;
    insert into pc_migrations(name) values ('3.2-rubriques');
  end if;
end $$;

-- Demander une fonction au bureau (par le code du club, ou par l'identifiant d'un club où l'on est déjà ou qui est dans la recherche)
create or replace function request_bureau(p_club uuid, p_code text, p_fonction text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  perform check_join_rate();
  if p_code is not null and trim(p_code) <> '' then select id into cid from clubs where join_code = upper(trim(p_code));
  else select id into cid from clubs c where c.id = p_club and (c.public_listed or exists(select 1 from memberships m where m.club_id = c.id and m.user_id = auth.uid())); end if;
  if cid is null then if p_code is not null then insert into join_attempts(user_id) values (auth.uid()); end if; raise exception 'Club introuvable'; end if;
  if p_fonction is null or fonction_areas(p_fonction) is null then raise exception 'Fonction inconnue'; end if;
  insert into memberships(club_id, user_id, role, fonction, status) values (cid, auth.uid(), 'bureau', p_fonction, 'pending') returning id into mid;
  if is_president(cid) then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

-- Le président nomme, change ou retire une fonction ; il ouvre ou ferme une rubrique en plus
create or replace function set_bureau_fonction(p_club uuid, p_user uuid, p_fonction text, p_membership uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Seul le président attribue les fonctions du bureau'; end if;
  if p_fonction is null then raise exception 'Fonction manquante'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if p_membership is not null then
    update memberships set fonction = p_fonction where id = p_membership and club_id = p_club and role = 'bureau';
  else
    insert into memberships(club_id, user_id, role, fonction, status) values (p_club, p_user, 'bureau', p_fonction, 'active');
  end if;
  perform log_action(p_club, p_user, null, 'fonction du bureau', jsonb_build_object('fonction', p_fonction));
exception when unique_violation then raise exception 'Cette fonction est déjà tenue par quelqu''un : retire-la d''abord';
end $$;
create or replace function set_board_area(p_club uuid, p_user uuid, p_area text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Seul le président ouvre une rubrique en plus'; end if;
  if p_on then
    if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active' and role = 'bureau') then raise exception 'Seuls les membres du bureau reçoivent une rubrique'; end if;
    insert into board_areas(club_id, user_id, area, granted_by) values (p_club, p_user, p_area, auth.uid()) on conflict do nothing;
  else delete from board_areas where club_id = p_club and user_id = p_user and area = p_area; end if;
  perform log_action(p_club, p_user, null, case when p_on then 'rubrique ouverte' else 'rubrique fermée' end, jsonb_build_object('rubrique', p_area));
end $$;
-- une validation d'adhésion au bureau qui heurte une fonction unique : message clair
create or replace function memberships_fonction_check() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.fonction in ('Vice-président','Secrétaire','Trésorier')
     and exists(select 1 from memberships m where m.club_id = new.club_id and m.fonction = new.fonction and m.status = 'active' and m.id <> new.id) then
    raise exception 'La fonction « % » est déjà tenue : le président doit d''abord la retirer', new.fonction;
  end if;
  return new;
end $$;
drop trigger if exists memberships_fonction_check on memberships;
create trigger memberships_fonction_check before insert or update on memberships for each row execute function memberships_fonction_check();
-- les rubriques ouvertes en plus disparaissent quand la personne quitte le bureau
create or replace function board_areas_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'bureau' and not exists(select 1 from memberships where club_id = old.club_id and user_id = old.user_id and role = 'bureau' and id <> old.id) then
    delete from board_areas where club_id = old.club_id and user_id = old.user_id;
  end if;
  return null;
end $$;
drop trigger if exists board_areas_cleanup on memberships;
create trigger board_areas_cleanup after delete on memberships for each row execute function board_areas_cleanup();

-- Qui valide quoi : le président tout ; le secrétariat les joueurs, parents et supporteurs ; secrétariat ou technique les coachs ;
-- le coach les joueurs et parents de son équipe
create or replace function can_validate(mid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from memberships t
    where t.id = mid and t.user_id <> auth.uid() and is_member(t.club_id) and (
      is_president(t.club_id)
      or (t.role in ('joueur','parent','supporteur') and has_area(t.club_id, 'secretariat'))
      or (t.role = 'coach' and (has_area(t.club_id, 'secretariat') or has_area(t.club_id, 'technique')))
      or (t.role in ('joueur','parent') and t.team_id is not null and coaches_team(t.team_id))));
$$;

-- =====================================================================
-- 1 bis. Contrôles des fonctions existantes par rubrique
-- =====================================================================
-- (partie générée par gen.py à partir des fonctions existantes : seule la ligne de contrôle des droits change)

create or replace function import_fee_grid(p_club uuid, p_season text, p_rows jsonb, p_delete_absent boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; up int := 0; ad int := 0; dl int := 0; keep uuid[] := '{}'; gid uuid;
begin
  if not has_area(p_club, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(team_id uuid, category text, amount numeric, fed numeric) loop
    if r.amount is null or r.amount < 0 then continue; end if;
    if r.team_id is not null and not exists(select 1 from teams where id = r.team_id and club_id = p_club) then continue; end if;
    select id into gid from fee_grid where club_id = p_club and season = p_season
      and ((r.team_id is not null and team_id = r.team_id) or (r.team_id is null and team_id is null and lower(category) = lower(r.category))) limit 1;
    if gid is null then
      insert into fee_grid(club_id, season, team_id, category, amount, fed_part) values (p_club, p_season, r.team_id, case when r.team_id is null then r.category end, r.amount, r.fed) returning id into gid; ad := ad + 1;
    else
      update fee_grid set amount = r.amount, fed_part = r.fed where id = gid and (amount <> r.amount or fed_part is distinct from r.fed);
      if found then up := up + 1; end if;
    end if;
    keep := keep || gid; gid := null;
  end loop;
  if p_delete_absent then delete from fee_grid where club_id = p_club and season = p_season and not (id = any(keep)); get diagnostics dl = row_count; end if;
  return jsonb_build_object('updated', up, 'added', ad, 'deleted', dl);
end $$;

create or replace function mark_paid(p_player uuid, p_paid boolean) returns void language plpgsql security definer set search_path = public as $$
declare a player_admin;
begin
  if not (can_admin_player(p_player) and has_area((select club_id from players where id = p_player), 'tresorerie')) then raise exception 'Réservé à la trésorerie'; end if;
  perform touch_fees(null, p_player);
  select * into a from player_admin where player_id = p_player;
  if p_paid then
    if a.fee_amount is null then raise exception 'Montant dû inconnu : ajoute d''abord le tarif de sa catégorie dans la grille'; end if;
    if a.fee_amount > a.fee_paid then insert into player_payments(player_id, amount, method, created_by) values (p_player, a.fee_amount - a.fee_paid, 'Solde validé à la main', auth.uid()); end if;
  else
    delete from player_payments where player_id = p_player;
  end if;
end $$;

create or replace function decide_coach_month(p_statement uuid, p_ok boolean, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare s coach_statements;
begin
  select * into s from coach_statements where id = p_statement;
  if s.id is null or not has_area(s.club_id, 'technique') then raise exception 'Validation réservée au président et au bureau'; end if;
  if s.user_id = auth.uid() then raise exception 'On ne valide pas son propre relevé : un autre membre du bureau s''en charge'; end if;
  if s.status <> 'submitted' then raise exception 'Ce relevé est déjà traité'; end if;
  update coach_statements set status = case when p_ok then 'validated' else 'refused' end, decided_by = auth.uid(), decided_at = now(), comment = left(coalesce(p_comment, ''), 300)
    where id = p_statement;
  perform log_action(s.club_id, s.user_id, null, case when p_ok then 'relevé d''heures validé' else 'relevé d''heures refusé' end,
    jsonb_build_object('mois', to_char(s.month, 'YYYY-MM'), 'minutes', s.total_minutes));
end $$;

create or replace function validate_exercise(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from exercises where id = p_id and deleted_at is null and sharing = 'public';
  if c is null or not has_area(c, 'technique') then raise exception 'Seul le bureau du club valide un exercice public'; end if;
  perform set_config('pc.exsys', 'on', true);
  update exercises set public_state = case when p_ok then 'validated' else 'refused' end, validated_by = auth.uid(), validated_at = now() where id = p_id;
  update exercise_reports set handled = true where exercise_id = p_id;
  perform set_config('pc.exsys', 'off', true);
  perform log_action(c, null, null, case when p_ok then 'exercice public validé' else 'exercice public refusé' end, jsonb_build_object('exercice', p_id));
end $$;

create or replace function set_team_coach(p_team uuid, p_user uuid, p_assistant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team and deleted_at is null;
  if c is null or not (has_area(c, 'technique') or (p_assistant and coaches_team(p_team))) then raise exception 'Droit insuffisant'; end if;
  if not exists(select 1 from memberships where club_id = c and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if exists(select 1 from memberships where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team) then
    update memberships set assistant = p_assistant, status = 'active' where club_id = c and user_id = p_user and role = 'coach' and team_id = p_team;
  else
    insert into memberships(club_id, user_id, role, team_id, status, assistant) values (c, p_user, 'coach', p_team, 'active', p_assistant);
  end if;
end $$;

create or replace function renew_team(p_team uuid, p_season text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t teams; nid uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not has_area(t.club_id, 'technique') then raise exception 'Droit insuffisant'; end if;
  insert into teams(club_id, name, category, gender, state, season, slots) values (t.club_id, t.name, t.category, t.gender, 'Fantôme', p_season, t.slots) returning id into nid;
  insert into memberships(club_id, user_id, role, team_id, status, assistant)
    select club_id, user_id, 'coach', nid, 'active', assistant from memberships where team_id = p_team and role = 'coach' and status = 'active';
  update teams set state = 'Archivée' where id = p_team;
  return nid;
end $$;

create or replace function create_player(p_club uuid, p_team uuid, p_first text, p_last text, p_birth date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if coalesce(trim(p_first), '') = '' then raise exception 'Prénom obligatoire'; end if;
  insert into players(club_id, team_id, first_name, last_name, birth_date, created_by) values (p_club, p_team, trim(p_first), trim(coalesce(p_last, '')), p_birth, auth.uid()) returning id into pid;
  insert into player_admin(player_id) values (pid);
  return pid;
end $$;

create or replace function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Liste trop longue (300 lignes au plus)'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid, email text, phone text) loop
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
    insert into players(club_id, team_id, first_name, last_name, birth_date, parent_email, parent_phone, created_by)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, r.email, r.phone, auth.uid()) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function trash_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is null;
    if c is null or not is_president(c) then raise exception 'Seul le président supprime une équipe'; end if;
    update teams set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is null;
    if c is null or not has_area(c, 'secretariat') then raise exception 'Seuls le président et le secrétariat suppriment une fiche'; end if;
    update players set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'poll' then
    perform delete_poll(p_id);
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

-- =====================================================================
-- 2. N° 55 · chaque rubrique protégée par la base
-- =====================================================================
alter table clubs add column if not exists coach_sees_fees boolean not null default true;      -- réglage du président
alter table clubs add column if not exists default_missions jsonb not null
  default '[{"label":"Arbitre","slots":2},{"label":"Table de marque","slots":2},{"label":"Aide","slots":2},{"label":"Buvette","slots":2}]'::jsonb;

-- Trésorerie : tarifs, réductions, versements, documents des tarifs
drop policy if exists "tarifs lisibles par le bureau" on fee_grid;
drop policy if exists "tarifs gérés par le bureau" on fee_grid;
drop policy if exists "tarifs : trésorerie" on fee_grid;
create policy "tarifs : trésorerie" on fee_grid for all using (has_area(club_id, 'tresorerie')) with check (has_area(club_id, 'tresorerie'));
drop policy if exists "documents lisibles par le bureau" on club_docs;
drop policy if exists "documents gérés par le bureau" on club_docs;
drop policy if exists "documents : trésorerie et secrétariat" on club_docs;
create policy "documents : trésorerie et secrétariat" on club_docs for all
  using (has_area(club_id, 'tresorerie') or has_area(club_id, 'secretariat'))
  with check ((has_area(club_id, 'tresorerie') or has_area(club_id, 'secretariat')) and uploaded_by = auth.uid());
drop policy if exists "réductions : bureau seulement" on player_discount;
drop policy if exists "réductions : trésorerie" on player_discount;
create policy "réductions : trésorerie" on player_discount for all
  using (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie'))
  with check (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie'));

-- Lire licence et cotisation : le joueur, ses parents, ses coachs (si le président le permet), la trésorerie et le secrétariat
create or replace function can_see_fees(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x join clubs c on c.id = x.club_id where x.id = p and x.deleted_at is null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or has_area(x.club_id, 'tresorerie') or has_area(x.club_id, 'secretariat')
    or (c.coach_sees_fees and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))))));
$$;
drop policy if exists "dossier lisible" on player_admin;
create policy "dossier lisible" on player_admin for select using (can_see_fees(player_id));
drop policy if exists "dossier créé par le bureau" on player_admin;
drop policy if exists "dossier saisi par le bureau" on player_admin;
create policy "dossier créé par le bureau" on player_admin for insert with check (can_admin_player(player_id)
  and (has_area((select club_id from players where id = player_id), 'tresorerie') or has_area((select club_id from players where id = player_id), 'secretariat')));
create policy "dossier saisi par le bureau" on player_admin for update
  using (can_admin_player(player_id) and (has_area((select club_id from players where id = player_id), 'tresorerie') or has_area((select club_id from players where id = player_id), 'secretariat')))
  with check (can_admin_player(player_id));
-- la licence relève du secrétariat, le moyen de paiement de la trésorerie
create or replace function player_admin_area_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then return new; end if;
  select club_id into c from players where id = new.player_id;
  if (new.licence_state, new.licence_number, new.health_doc) is distinct from (old.licence_state, old.licence_number, old.health_doc) and not has_area(c, 'secretariat') then
    raise exception 'La licence se règle dans la rubrique Secrétariat';
  end if;
  if new.fee_method is distinct from old.fee_method and not has_area(c, 'tresorerie') then
    raise exception 'La cotisation se règle dans la rubrique Trésorerie';
  end if;
  return new;
end $$;
drop trigger if exists player_admin_area_guard on player_admin;
create trigger player_admin_area_guard before update on player_admin for each row execute function player_admin_area_guard();

drop policy if exists "versements lisibles" on player_payments;
drop policy if exists "versements saisis par le bureau" on player_payments;
drop policy if exists "versements retirés par le bureau" on player_payments;
create policy "versements lisibles" on player_payments for select using (can_see_fees(player_id));
create policy "versements saisis par le bureau" on player_payments for insert
  with check (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie') and created_by = auth.uid());
create policy "versements retirés par le bureau" on player_payments for delete
  using (can_admin_player(player_id) and has_area((select club_id from players where id = player_id), 'tresorerie'));

-- Technique : équipes (création, réglages ; le coach règle la sienne)
drop policy if exists "équipes créées par le bureau" on teams;
create policy "équipes créées par le bureau" on teams for insert with check (has_area(club_id, 'technique') and deleted_at is null);
drop policy if exists "équipes modifiées par le bureau ou le coach" on teams;
create policy "équipes modifiées par le bureau ou le coach" on teams for update
  using (deleted_at is null and (has_area(club_id, 'technique') or coaches_team(id))) with check (has_area(club_id, 'technique') or coaches_team(id));

-- Communication : blason, couleurs, nom ; réglages réservés : président (en-tête, recherche, cotisations vues des coachs), événements (missions par défaut)
drop policy if exists "club modifié par le président et le bureau" on clubs;
drop policy if exists "club modifié par la communication" on clubs;
create policy "club modifié par la communication" on clubs for update
  using (has_area(id, 'communication') or has_area(id, 'evenements')) with check (has_area(id, 'communication') or has_area(id, 'evenements'));
create or replace function clubs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code <> old.join_code then raise exception 'Le code du club ne se modifie pas ainsi'; end if;
  if auth.uid() is null then return new; end if;
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

-- =====================================================================
-- 3. Convocations : un match, plateau ou tournoi peut ne convoquer que certains joueurs
-- =====================================================================
alter table events add column if not exists convoked uuid[] not null default '{}';
alter table events add column if not exists reminded_at timestamptz;
create or replace function events_convoked_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if cardinality(new.convoked) > 0 then
    if new.audience <> 'team' then raise exception 'Une convocation de joueurs choisis vaut pour une équipe'; end if;
    if exists(select 1 from unnest(new.convoked) p where not exists(select 1 from players x where x.id = p and x.deleted_at is null and x.club_id = new.club_id
         and (x.team_id = any(new.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(new.team_ids))))) then
      raise exception 'Un joueur convoqué ne fait pas partie de l''équipe';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.reminded_at is distinct from old.reminded_at and coalesce(current_setting('pc.remind', true), '') <> 'on' then new.reminded_at := old.reminded_at; end if;
  return new;
end $$;
drop trigger if exists events_convoked_guard on events;
create trigger events_convoked_guard before insert or update on events for each row execute function events_convoked_guard();

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

-- =====================================================================
-- 4. Annonces officielles (et relances), avec « lu par »
-- =====================================================================
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  audience text not null default 'club' check (audience in ('club','team','board','board_coaches','coaches','people')),
  team_ids uuid[] not null default '{}',
  people uuid[] not null default '{}',
  kind text not null default 'annonce' check (kind in ('annonce','relance','missions','cotisation')),
  event_id uuid references events(id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 120),
  body text not null default '' check (length(body) <= 3000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (audience <> 'team' or cardinality(team_ids) between 1 and 20),
  check (audience <> 'people' or cardinality(people) between 1 and 500)
);
create index if not exists announcements_club on announcements(club_id, created_at desc);
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create or replace function sees_announcement(aid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from announcements a where a.id = aid and a.deleted_at is null and is_member(a.club_id) and (
    a.created_by = auth.uid()
    or a.audience = 'club'
    or (a.audience = 'team' and (exists(select 1 from unnest(a.team_ids) t where in_team(t)) or is_board(a.club_id)))
    or (a.audience = 'board' and is_board(a.club_id))
    or (a.audience in ('coaches','board_coaches') and (is_coach_in(a.club_id) or is_board(a.club_id)))
    or (a.audience = 'people' and auth.uid() = any(a.people))));
$$;
-- Qui publie : la communication (et le président) pour tout le club ; le bureau pour le bureau et les coachs ; le coach pour ses équipes
create or replace function can_announce(c uuid, aud text, ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select not exists(select 1 from unnest(coalesce(ts, '{}')) t where not exists(select 1 from teams x where x.id = t and x.club_id = c and x.deleted_at is null))
    and (has_area(c, 'communication')
      or (aud in ('board','board_coaches','coaches') and is_board(c))
      or (aud = 'team' and coaches_all(ts)));
$$;
create or replace function announcements_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.deleted_at := null;
    if coalesce(current_setting('pc.announce', true), '') <> 'on' then
      new.kind := 'annonce'; new.event_id := null;
      if new.audience = 'people' then raise exception 'Une annonce à des personnes choisies passe par une relance'; end if;
      if not can_announce(new.club_id, new.audience, new.team_ids) then raise exception 'Tu ne peux pas publier pour ces destinataires'; end if;
    end if;
  else
    if (new.club_id, new.audience, new.team_ids, new.people, new.kind, new.event_id, new.created_by) is distinct from
       (old.club_id, old.audience, old.team_ids, old.people, old.kind, old.event_id, old.created_by) then raise exception 'Seuls le titre et le texte se modifient'; end if;
  end if;
  return new;
end $$;
drop trigger if exists announcements_guard on announcements;
create trigger announcements_guard before insert or update on announcements for each row execute function announcements_guard();
alter table announcements enable row level security;
alter table announcement_reads enable row level security;
drop policy if exists "annonces lues par les destinataires" on announcements;
create policy "annonces lues par les destinataires" on announcements for select using (sees_announcement(id));
drop policy if exists "annonces publiées selon les droits" on announcements;
create policy "annonces publiées selon les droits" on announcements for insert with check (is_member(club_id));
drop policy if exists "annonce modifiée par son auteur" on announcements;
create policy "annonce modifiée par son auteur" on announcements for update using (created_by = auth.uid() or has_area(club_id, 'communication'));
drop policy if exists "lu : chacun pour soi" on announcement_reads;
create policy "lu : chacun pour soi" on announcement_reads for insert with check (user_id = auth.uid() and sees_announcement(announcement_id));
drop policy if exists "lu : lisible par soi et l'auteur" on announcement_reads;
create policy "lu : lisible par soi et l'auteur" on announcement_reads for select using (user_id = auth.uid()
  or exists(select 1 from announcements a where a.id = announcement_id and (a.created_by = auth.uid() or has_area(a.club_id, 'communication'))));
create or replace function delete_announcement(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and deleted_at is null;
  if a.id is null or not (a.created_by = auth.uid() or has_area(a.club_id, 'communication')) then raise exception 'Suppression impossible'; end if;
  update announcements set deleted_at = now() where id = p_id;
end $$;

-- Personnes qui n'ont pas répondu à un rendez-vous (convoqués seulement) : parents des enfants, joueurs avec compte, autres invités
create or replace function event_missing(p_event uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  with e as (select * from events where id = p_event),
  pl as (select x.* from players x, e where x.deleted_at is null and e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi')
           and (x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids)))
           and (cardinality(e.convoked) = 0 or x.id = any(e.convoked))
           and not exists(select 1 from event_responses r where r.event_id = p_event and (r.player_id = x.id or (r.player_id is null and x.user_id is not null and r.user_id = x.user_id)))),
  team_users as (select pp.user_id from player_parents pp join pl on pl.id = pp.player_id union select pl.user_id from pl where pl.user_id is not null),
  invited as (select distinct m.user_id from memberships m, e where m.club_id = e.club_id and m.status = 'active'
           and not (e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi'))
           and (e.audience = 'club' or (e.audience = 'board' and m.role in ('president','bureau')) or (e.audience = 'coaches' and m.role = 'coach')
             or (e.audience = 'board_coaches' and m.role in ('president','bureau','coach')) or (e.audience = 'people' and m.user_id = any(e.people))
             or (e.audience = 'team' and (m.team_id = any(e.team_ids))))
           and not exists(select 1 from event_responses r where r.event_id = p_event and r.user_id = m.user_id and r.player_id is null))
  select coalesce(array_agg(distinct u), '{}') from (select user_id u from team_users union select user_id from invited) z where u is not null and u <> auth.uid();
$$;
revoke execute on function event_missing(uuid) from public, anon, authenticated;

-- Relance des sans-réponse par l'organisateur : une annonce « Rappel » à ces seules personnes (une fois toutes les 12 heures)
create or replace function remind_event(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; who uuid[];
begin
  select * into e from events where id = p_event;
  if e.id is null or not (can_manage_event(p_event) or e.created_by = auth.uid()) then raise exception 'Seul l''organisateur relance'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est passé ou annulé'; end if;
  if e.reminded_at > now() - interval '12 hours' then raise exception 'Relance déjà faite il y a moins de 12 heures'; end if;
  who := event_missing(p_event);
  if cardinality(who) = 0 then return 0; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, event_id, title, body)
    values (e.club_id, 'people', who, 'relance', e.id, 'Rappel : ta réponse est attendue',
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Réponds « Je viens » ou « Je ne viens pas ».');
  perform set_config('pc.remind', 'on', true);
  update events set reminded_at = now() where id = p_event;
  perform set_config('pc.announce', 'off', true); perform set_config('pc.remind', 'off', true);
  return cardinality(who);
end $$;

-- =====================================================================
-- 5. N° 53 · bénévoles : missions à pourvoir sur un match, plateau, tournoi, événement ou AG
-- =====================================================================
create table if not exists event_missions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null check (length(trim(label)) between 2 and 40),
  slots int not null default 1 check (slots between 1 and 20),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_missions_event on event_missions(event_id);
create table if not exists mission_signups (
  mission_id uuid not null references event_missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  at timestamptz not null default now(),
  primary key (mission_id, user_id)
);
create or replace function can_manage_missions(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and ((e.audience = 'team' and coaches_any(e.team_ids)) or e.created_by = auth.uid() or has_area(e.club_id, 'evenements')));
$$;
-- Peuvent s'inscrire : bureau, coachs, parents de joueurs et joueurs majeurs (d'une équipe concernée pour un rendez-vous d'équipe) ; jamais les supporteurs seuls ni les mineurs
create or replace function can_volunteer(eid uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and not e.cancelled and exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active') and (
    exists(select 1 from memberships m where m.club_id = e.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau','coach'))
    or exists(select 1 from player_parents pp join players x on x.id = pp.player_id where pp.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and x.club_id = e.club_id
              and x.birth_date is not null and x.birth_date <= current_date - interval '18 years'
              and (e.audience <> 'team' or x.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = any(e.team_ids))))));
$$;
create or replace function event_missions_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from events where id = new.event_id and type in ('Match','Plateau','Tournoi','Événement','AG')) then
    raise exception 'Les missions de bénévoles valent pour un match, un plateau, un tournoi, un événement ou une AG';
  end if;
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'Mission d''un autre rendez-vous'; end if;
  if tg_op = 'UPDATE' and new.slots < (select count(*) from mission_signups where mission_id = new.id) then
    raise exception 'Des bénévoles sont déjà inscrits : retire-les avant de réduire le nombre de places';
  end if;
  return new;
end $$;
drop trigger if exists event_missions_guard on event_missions;
create trigger event_missions_guard before insert or update on event_missions for each row execute function event_missions_guard();
alter table event_missions enable row level security;
alter table mission_signups enable row level security;
drop policy if exists "missions lisibles par les destinataires" on event_missions;
create policy "missions lisibles par les destinataires" on event_missions for select using (sees_event(event_id));
drop policy if exists "missions gérées par l'organisateur" on event_missions;
create policy "missions gérées par l'organisateur" on event_missions for all using (can_manage_missions(event_id)) with check (can_manage_missions(event_id));
drop policy if exists "bénévoles lisibles par les destinataires" on mission_signups;
create policy "bénévoles lisibles par les destinataires" on mission_signups for select
  using (exists(select 1 from event_missions mi where mi.id = mission_id and sees_event(mi.event_id)));
-- écriture des inscriptions : seulement par volunteer() et assign_volunteer()

create or replace function volunteer(p_mission uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mi event_missions; e events;
begin
  select * into mi from event_missions where id = p_mission;
  select * into e from events where id = mi.event_id;
  if mi.id is null or not sees_event(e.id) then raise exception 'Mission introuvable'; end if;
  if not p_on then delete from mission_signups where mission_id = p_mission and user_id = auth.uid(); return; end if;
  if e.starts_at < now() then raise exception 'Ce rendez-vous est passé'; end if;
  if not can_volunteer(e.id, auth.uid()) then raise exception 'Les missions sont ouvertes aux parents, joueurs majeurs, coachs et au bureau concernés'; end if;
  if exists(select 1 from mission_signups s join event_missions m2 on m2.id = s.mission_id where m2.event_id = e.id and s.user_id = auth.uid()) then
    raise exception 'Tu as déjà une mission sur ce rendez-vous : l''organisateur peut t''en ajouter une autre';
  end if;
  perform 1 from event_missions where id = p_mission for update;
  if (select count(*) from mission_signups where mission_id = p_mission) >= mi.slots then raise exception 'Complet'; end if;
  insert into mission_signups(mission_id, user_id, added_by) values (p_mission, auth.uid(), auth.uid());
end $$;
create or replace function assign_volunteer(p_mission uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare mi event_missions;
begin
  select * into mi from event_missions where id = p_mission;
  if mi.id is null or not can_manage_missions(mi.event_id) then raise exception 'Seul l''organisateur inscrit ou retire un bénévole'; end if;
  if not p_on then delete from mission_signups where mission_id = p_mission and user_id = p_user; return; end if;
  if not exists(select 1 from memberships m join events e on e.club_id = m.club_id where e.id = mi.event_id and m.user_id = p_user and m.status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  perform 1 from event_missions where id = p_mission for update;
  if (select count(*) from mission_signups where mission_id = p_mission) >= mi.slots then raise exception 'Complet'; end if;
  insert into mission_signups(mission_id, user_id, added_by) values (p_mission, p_user, auth.uid()) on conflict do nothing;
end $$;
-- Ajouter les missions par défaut du club à un rendez-vous
create or replace function add_default_missions(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; n int;
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur ajoute des missions'; end if;
  insert into event_missions(event_id, label, slots, position)
    select p_event, x->>'label', greatest(1, least(20, coalesce((x->>'slots')::int, 1))), (row_number() over ())::int
    from clubs c, jsonb_array_elements(c.default_missions) x where c.id = e.club_id
      and not exists(select 1 from event_missions m where m.event_id = p_event and lower(m.label) = lower(x->>'label'));
  get diagnostics n = row_count; return n;
end $$;
-- Relance des missions vides : une annonce aux destinataires du rendez-vous
create or replace function remind_missions(p_event uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e events; txt text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not can_manage_missions(p_event) then raise exception 'Seul l''organisateur relance'; end if;
  select string_agg(n || ' ' || lower(label), ', ' order by position) into txt from (
    select m.label, m.position, m.slots - (select count(*) from mission_signups s where s.mission_id = m.id) n from event_missions m where m.event_id = p_event) z where n > 0;
  if txt is null then raise exception 'Toutes les missions sont pourvues'; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, team_ids, people, kind, event_id, title, body)
    values (e.club_id, case when e.audience in ('team','club','people') then e.audience else 'club' end, e.team_ids, e.people, 'missions', e.id,
            'Bénévoles : il manque ' || txt,
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Ouvre le rendez-vous pour t''inscrire.');
  perform set_config('pc.announce', 'off', true);
  return txt;
end $$;

-- =====================================================================
-- 6. Accueil multi-clubs : un aperçu de chacun de mes autres clubs
-- =====================================================================
create or replace function my_clubs_overview() returns table(club_id uuid, name text, sport text, color1 text, crest_bg text, logo text, crest_outline text, roles text[], next_events jsonb, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.sport, c.color1, c.crest_bg, c.logo, c.crest_outline,
    (select array_agg(distinct m.role) from memberships m where m.club_id = c.id and m.user_id = auth.uid() and m.status = 'active'),
    coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'type', e.type, 'starts_at', e.starts_at) order by e.starts_at)
      from (select * from events e where e.club_id = c.id and not e.cancelled and e.starts_at between now() and now() + interval '7 days' and sees_event(e.id) order by e.starts_at limit 3) e), '[]'::jsonb),
    (select count(*)::int from announcements a where a.club_id = c.id and a.created_at > now() - interval '30 days' and a.created_by is distinct from auth.uid()
      and sees_announcement(a.id) and not exists(select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = auth.uid()))
  from clubs c where exists(select 1 from memberships m where m.club_id = c.id and m.user_id = auth.uid() and m.status = 'active')
  order by c.name;
$$;

-- Journal des actions sensibles lisible par le président, avec les noms
create or replace function club_log(p_club uuid, p_limit int default 100) returns table(at timestamptz, actor text, target text, action text, detail jsonb)
language sql stable security definer set search_path = public as $$
  select l.at, coalesce(a.full_name, '—'), coalesce(nullif(trim(x.first_name || ' ' || x.last_name), ''), t.full_name, ''), l.action, l.detail
  from action_log l left join profiles a on a.id = l.actor left join profiles t on t.id = l.target_user left join players x on x.id = l.target_player
  where l.club_id = p_club and is_president(p_club) order by l.at desc limit least(coalesce(p_limit, 100), 500);
$$;

do $$ begin alter publication supabase_realtime add table announcements; exception when duplicate_object then null; end $$;
revoke execute on function areas_of(uuid, uuid) from public, anon, authenticated;

-- Rappel de cotisation (trésorerie) : une annonce au joueur et à ses parents seulement, une fois par semaine au plus
create or replace function remind_fee(p_player uuid) returns int
language plpgsql security definer set search_path = public as $$
declare x players; a player_admin; who uuid[];
begin
  select * into x from players where id = p_player and deleted_at is null;
  if x.id is null or not has_area(x.club_id, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
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
