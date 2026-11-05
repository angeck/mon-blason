-- mypocketclub · alpha 4.4.0 · mise à jour d'une base 4.3.0, sans perte de données, relançable.
-- N° 114 (suite, revue du 4 novembre 2026, « oui pour tout » de Gaël le 5 novembre, 13 h 26) :
-- 1. Cotisations : le Secrétariat et le correspondant licences ne lisent plus les montants ; ils lisent les licences par
--    club_licences() et les modifient par set_licence() ; « cotisation à jour » (oui / non, jamais un montant) seulement
--    si le président l'active (clubs.secretary_sees_fees, non par défaut).
-- 2. Directeur technique : coordonnées des parents et des joueurs visibles par défaut ; le président peut les masquer
--    (clubs.tech_sees_contacts). Les coordonnées des fiches (contact du parent importé, contact d'urgence) ne sont plus
--    lisibles dans la table : player_contacts() les donne à ceux qui voient la fiche, sauf ce cas.
-- 3. Exports journalisés : export_members() (coordonnées : président, secrétaire et secrétaire adjoint seulement) et
--    log_export() (liste des cotisations du trésorier) écrivent au journal des actions.
-- 4. Relance des cotisations non réglées en un geste (remind_fees).
-- 5. Passage de saison pour tout le club (renew_club_season) : chaque équipe est archivée et recréée, et la case
--    « Je participe au bénévolat du club » repart cochée pour les membres du club.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. Réglages du président
-- ---------------------------------------------------------------------
alter table clubs add column if not exists secretary_sees_fees boolean not null default false;
alter table clubs add column if not exists tech_sees_contacts boolean not null default true;

create or replace function clubs_guard_440() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.secretary_sees_fees, new.tech_sees_contacts) is distinct from (old.secretary_sees_fees, old.tech_sees_contacts) and not is_president(old.id) then
    raise exception 'Réglage réservé au président';
  end if;
  return new;
end $$;
drop trigger if exists clubs_guard_440 on clubs;
create trigger clubs_guard_440 before update on clubs for each row execute function clubs_guard_440();

-- ---------------------------------------------------------------------
-- 2. Cotisations : plus de montants pour le Secrétariat et le correspondant licences
-- ---------------------------------------------------------------------
create or replace function can_see_fees(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x join clubs c on c.id = x.club_id where x.id = p and x.deleted_at is null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or has_area(x.club_id, 'tresorerie')
    or (c.coach_sees_fees and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))))));
$$;

-- Licences du club pour le Secrétariat et le correspondant licences ; fee_ok = « cotisation à jour » (oui / non) si le président
-- l'a activé, sinon null ; jamais un montant
create or replace function club_licences(p_club uuid) returns table(player_id uuid, licence_state text, licence_number text, health_doc boolean, fee_ok boolean)
language sql stable security definer set search_path = public as $$
  select x.id, coalesce(a.licence_state, 'Préinscrit club'), a.licence_number, coalesce(a.health_doc, false),
    case when c.secretary_sees_fees or has_area(p_club, 'tresorerie') then (a.fee_amount is not null and coalesce(a.fee_paid, 0) >= a.fee_amount) end
  from players x join clubs c on c.id = x.club_id left join player_admin a on a.player_id = x.id
  where x.club_id = p_club and x.deleted_at is null and auth.uid() is not null
    and (has_area(p_club, 'secretariat') or has_area(p_club, 'licences'));
$$;

-- Modifier la licence sans lire la cotisation : état (Secrétariat, licences ou Trésorerie), numéro et certificat (licences)
create or replace function set_licence(p_player uuid, p_state text, p_number text, p_health boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select club_id into c from players where id = p_player and deleted_at is null;
  if c is null or not can_admin_player(p_player) or not (has_area(c, 'licences') or has_area(c, 'tresorerie')) then raise exception 'Droit insuffisant'; end if;
  if p_state not in ('Préinscrit club', 'Préinscrit fédé', 'Licencié') then raise exception 'État de licence inconnu'; end if;
  insert into player_admin(player_id, licence_state, licence_number, health_doc, updated_by, updated_at)
    values (p_player, p_state, nullif(trim(coalesce(p_number, '')), ''), coalesce(p_health, false), auth.uid(), now())
    on conflict (player_id) do update set licence_state = excluded.licence_state, licence_number = excluded.licence_number,
      health_doc = excluded.health_doc, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- ---------------------------------------------------------------------
-- 3. Coordonnées des fiches et réglage du président pour le Directeur technique
-- ---------------------------------------------------------------------
-- Vrai seulement pour un Directeur technique (sans Secrétariat, Trésorerie ni licences) quand le président a masqué les coordonnées
create or replace function contacts_hidden_for_me(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and exists(select 1 from clubs where id = c and not tech_sees_contacts)
    and not is_president(c)
    and exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'bureau' and fonction = 'Directeur technique')
    and not (areas_of(c, auth.uid()) && array['secretariat', 'tresorerie', 'licences']);
$$;

-- La table ne donne plus les coordonnées : une lecture « select * » est remplacée par la liste des colonnes dans l'application
revoke select on players from anon, authenticated;
grant select (id, club_id, team_id, user_id, first_name, last_name, birth_date, consents, deleted_at, deleted_by, created_by, created_at, from_partner) on players to authenticated;

create or replace function player_contacts(p_club uuid) returns table(id uuid, parent_email text, parent_phone text, emergency_name text, emergency_phone text)
language sql stable security definer set search_path = public as $$
  select x.id, x.parent_email, x.parent_phone, x.emergency_name, x.emergency_phone
  from players x
  where x.club_id = p_club and x.deleted_at is null and auth.uid() is not null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))
    or (is_board(x.club_id) and not contacts_hidden_for_me(x.club_id)));
$$;

-- Téléphones des comptes : l'encadrement (président, bureau, coachs) reste joignable ; les familles ne le sont plus
-- pour un Directeur technique quand le président a masqué les coordonnées (sauf les familles de ses propres équipes)
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
        and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id)))));
$$;

-- ---------------------------------------------------------------------
-- 4. Exports journalisés
-- ---------------------------------------------------------------------
create or replace function is_secretary_or_president(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_president(c) or exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active'
    and role = 'bureau' and fonction in ('Secrétaire', 'Secrétaire adjoint') and club_alive(c));
$$;

-- Liste des membres avec coordonnées (Secrétariat › Import / export) : président, secrétaire et secrétaire adjoint ; inscrite au journal
create or replace function export_members(p_club uuid) returns table(team text, first_name text, last_name text, birth_date date,
  licence_state text, licence_number text, health_doc boolean, parents text, emails text, phones text, emergency text)
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not is_secretary_or_president(p_club) then raise exception 'Export réservé au président, au secrétaire et au secrétaire adjoint'; end if;
  select count(*) into n from players where club_id = p_club and deleted_at is null and not from_partner;
  perform log_action(p_club, null, null, 'export des membres (coordonnées)', jsonb_build_object('lignes', n));
  return query
    select coalesce(t.name, ''), x.first_name, coalesce(x.last_name, ''), x.birth_date,
      coalesce(a.licence_state, 'Préinscrit club'), coalesce(a.licence_number, ''), coalesce(a.health_doc, false),
      coalesce((select string_agg(coalesce(pr.full_name, ''), ', ' order by pr.full_name) from player_parents pp join profiles pr on pr.id = pp.user_id where pp.player_id = x.id), ''),
      concat_ws(', ', nullif((select string_agg(u.email::text, ', ' order by u.email) from player_parents pp join auth.users u on u.id = pp.user_id where pp.player_id = x.id), ''),
        (select u.email::text from auth.users u where u.id = x.user_id), x.parent_email),
      concat_ws(', ', nullif((select string_agg(pr.phone, ', ') from player_parents pp join profiles pr on pr.id = pp.user_id where pp.player_id = x.id and coalesce(pr.phone, '') <> ''), ''),
        (select nullif(pr.phone, '') from profiles pr where pr.id = x.user_id), x.parent_phone),
      trim(concat_ws(' ', x.emergency_name, x.emergency_phone))
    from players x left join teams t on t.id = x.team_id left join player_admin a on a.player_id = x.id
    where x.club_id = p_club and x.deleted_at is null and not x.from_partner
    order by t.name nulls last, x.last_name, x.first_name;
end $$;

-- Autres exports faits dans l'application (liste des cotisations du trésorier) : inscrits au journal avant le fichier
create or replace function log_export(p_club uuid, p_kind text, p_rows int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_kind = 'cotisations' then
    if not has_area(p_club, 'tresorerie') then raise exception 'Export réservé à la trésorerie'; end if;
  else raise exception 'Export inconnu'; end if;
  perform log_action(p_club, null, null, 'export des cotisations', jsonb_build_object('lignes', greatest(coalesce(p_rows, 0), 0)));
end $$;

-- ---------------------------------------------------------------------
-- 5. Relance des cotisations non réglées en un geste (trésorerie) : chaque joueur une fois par semaine au plus
-- ---------------------------------------------------------------------
create or replace function remind_fees(p_club uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x record; sent int := 0; people int := 0; skipped int := 0; k int;
begin
  if auth.uid() is null or not has_area(p_club, 'tresorerie') then raise exception 'Réservé à la trésorerie'; end if;
  for x in select p.id from players p join player_admin a on a.player_id = p.id
           where p.club_id = p_club and p.deleted_at is null and not p.from_partner and a.fee_amount is not null and a.fee_paid < a.fee_amount loop
    begin
      k := remind_fee(x.id); sent := sent + 1; people := people + k;
    exception when others then skipped := skipped + 1;
    end;
  end loop;
  if sent > 0 then perform log_action(p_club, null, null, 'relance des cotisations', jsonb_build_object('joueurs', sent)); end if;
  return jsonb_build_object('sent', sent, 'people', people, 'skipped', skipped);
end $$;

-- ---------------------------------------------------------------------
-- 6. Passage de saison pour tout le club (président)
--    Chaque équipe d'une autre saison est archivée et recréée pour la nouvelle saison, en mode fantôme, avec ses coachs
--    (comme « Archiver et reconduire » équipe par équipe). Une équipe déjà recréée n'est pas recréée une deuxième fois.
--    Les joueurs restent dans l'équipe archivée (comme aujourd'hui). La case « Je participe au bénévolat du club » repart cochée.
-- ---------------------------------------------------------------------
create or replace function renew_club_season(p_club uuid, p_season text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t teams; nid uuid; made int := 0; kept int := 0; vol int;
begin
  if auth.uid() is null or not is_president(p_club) then raise exception 'Seul le président fait le passage de saison du club'; end if;
  if coalesce(p_season, '') !~ '^\d{4}-\d{4}$' then raise exception 'Saison illisible (ex. 2027-2028)'; end if;
  for t in select * from teams where club_id = p_club and deleted_at is null and state <> 'Archivée' and coalesce(season, '') <> p_season order by name loop
    if exists(select 1 from teams n where n.club_id = p_club and n.deleted_at is null and n.season = p_season and n.name = t.name
              and n.category is not distinct from t.category and n.gender is not distinct from t.gender) then
      kept := kept + 1;
    else
      insert into teams(club_id, name, category, gender, state, season, slots) values (t.club_id, t.name, t.category, t.gender, 'Fantôme', p_season, t.slots) returning id into nid;
      insert into memberships(club_id, user_id, role, team_id, status, assistant)
        select club_id, user_id, 'coach', nid, 'active', assistant from memberships where team_id = t.id and role = 'coach' and status = 'active';
      made := made + 1;
    end if;
    update teams set state = 'Archivée' where id = t.id;
  end loop;
  update profiles set volunteer = true where volunteer = false
    and id in (select user_id from memberships where club_id = p_club and status = 'active' and role <> 'supporteur');
  get diagnostics vol = row_count;
  perform log_action(p_club, null, null, 'passage de saison du club', jsonb_build_object('saison', p_season, 'equipes', made, 'deja_creees', kept, 'benevoles', vol));
  return jsonb_build_object('teams', made, 'kept', kept, 'volunteers', vol);
end $$;

-- ---------------------------------------------------------------------
-- 7. Droits d'exécution, puis fermeture au visiteur (règle de la 4.3.0)
-- ---------------------------------------------------------------------
revoke execute on function contacts_hidden_for_me(uuid) from public, anon;
revoke execute on function is_secretary_or_president(uuid) from public, anon;
revoke execute on function clubs_guard_440() from public, anon, authenticated;
grant execute on function club_licences(uuid), set_licence(uuid, text, text, boolean), player_contacts(uuid), export_members(uuid),
  log_export(uuid, text, int), remind_fees(uuid), renew_club_season(uuid, text) to authenticated;

select close_visitor_functions();
