-- MAJ_ALPHA_4_8_0.sql · mypocketclub · n° 170 (« Contact licences » et « Contact rencontres » : des rôles attribués seulement dans « Fonctions du bureau »), notification « Nouveau match prévu » pour toute l'équipe · à lancer une fois dans Supabase > SQL Editor > Run (après la 4.7.0).
-- Sans perte de données, relançable sans risque. À lancer APRÈS la mise en ligne du code 4.8.0. Rien à redéployer.

-- mypocketclub · alpha 4.8.0 · mise à jour d'une base 4.7.0, sans perte de données, relançable.
-- Mise à jour d'avant la bêta (« go » de Gaël, 10 novembre 2026) :
-- 1. N° 170 : « Contact licences » et « Contact rencontres » (en base : « Correspondant licences », « Correspondant rencontres »)
--    sont des rôles comme les autres. Ils s'attribuent seulement dans « Fonctions du bureau » ; la désignation de
--    « Qui s'occupe de quoi » ne sert plus pour eux (elle reste pour Événements et Communication, voir n° 172).
--    Une seule personne par rôle de contact. Sans personne : le secrétaire, sinon le président (licences) ; le président (rencontres).
--    Reprise : la personne qui est le contact aujourd'hui le reste ; les rôles en trop (cause du n° 170) sont retirés.
-- 2. Notification à la création d'un match : toute l'équipe reçoit « Nouveau match prévu » ;
--    les joueurs convoqués (et leurs parents) reçoivent en plus « Convocation : match ».
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 170 · un seul endroit pour attribuer les deux rôles de contact
-- ---------------------------------------------------------------------

-- Reprise des données. Pour chaque club et chaque rôle de contact :
--   a) la personne qui tient le rôle aujourd'hui est celle que la base donnait jusqu'ici (désignation, sinon la plus ancienne fonction) ;
--   b) les autres fonctions identiques sont retirées (la ligne part si la personne a un autre rôle au bureau ou la présidence,
--      sinon elle devient « Membre du bureau » : personne ne sort du bureau sans décision du président) ;
--   c) si la personne désignée n'avait pas la fonction et n'est pas la personne par défaut, elle la reçoit ;
--   d) la désignation est retirée (elle ne sert plus).
do $$
declare c record; r text; f text; des uuid; cur uuid; def uuid; m record;
begin
  for c in select id from clubs loop
    foreach r in array array['licences','rencontres'] loop
      f := case r when 'licences' then 'Correspondant licences' else 'Correspondant rencontres' end;
      select d.user_id into des from club_designations d
        join memberships x on x.club_id = d.club_id and x.user_id = d.user_id and x.status = 'active' and x.role in ('bureau','president')
        where d.club_id = c.id and d.resp = r limit 1;
      if not found then des := null; end if;
      cur := coalesce(des, (select x.user_id from memberships x where x.club_id = c.id and x.status = 'active' and x.role = 'bureau' and x.fonction = f order by x.created_at limit 1));
      -- b) fonctions en trop
      for m in select x.id, x.user_id from memberships x where x.club_id = c.id and x.status = 'active' and x.role = 'bureau' and x.fonction = f
                 and (cur is null or x.user_id <> cur
                      or x.id <> (select y.id from memberships y where y.club_id = c.id and y.status = 'active' and y.role = 'bureau' and y.fonction = f and y.user_id = cur order by y.created_at limit 1)) loop
        if exists(select 1 from memberships y where y.club_id = c.id and y.user_id = m.user_id and y.status = 'active' and y.role in ('bureau','president') and y.id <> m.id) then
          delete from memberships where id = m.id;
        else
          update memberships set fonction = 'Membre du bureau' where id = m.id;
        end if;
      end loop;
      -- c) la personne désignée reçoit la fonction, sauf si elle est déjà la personne par défaut
      if des is not null and not exists(select 1 from memberships x where x.club_id = c.id and x.user_id = des and x.status = 'active' and x.role = 'bureau' and x.fonction = f) then
        def := coalesce(
          case when r = 'licences' then (select x.user_id from memberships x where x.club_id = c.id and x.status = 'active' and x.role = 'bureau' and x.fonction = 'Secrétaire' order by x.created_at limit 1) end,
          (select x.user_id from memberships x where x.club_id = c.id and x.status = 'active' and x.role = 'president' order by x.created_at limit 1));
        if des is distinct from def then
          begin
            insert into memberships(club_id, user_id, role, fonction, status) values (c.id, des, 'bureau', f, 'active');
          exception when others then
            raise notice 'n° 170 : rôle « % » non repris pour le club % (%). Le contact revient à la personne par défaut.', f, c.id, sqlerrm;
          end;
        end if;
      end if;
      -- d)
      delete from club_designations where club_id = c.id and resp = r;
    end loop;
  end loop;
  update memberships set designated_for = null where designated_for in ('licences','rencontres');
end $$;

-- Une seule personne aussi pour les deux rôles de contact (comme la vice-présidence, le secrétariat et la trésorerie)
create or replace function memberships_fonction_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and new.fonction in ('Vice-président','Secrétaire','Trésorier','Correspondant licences','Correspondant rencontres')
     and exists(select 1 from memberships m where m.club_id = new.club_id and m.fonction = new.fonction and m.status = 'active' and m.id <> new.id) then
    raise exception 'La fonction « % » est déjà tenue : le président doit d''abord la retirer',
      case new.fonction when 'Correspondant licences' then 'Contact licences' when 'Correspondant rencontres' then 'Contact rencontres' else new.fonction end;
  end if;
  if new.status = 'active' and new.role in ('bureau','president')
     and (tg_op = 'INSERT' or old.status <> 'active' or old.role <> new.role or old.fonction is distinct from new.fonction)
     and not account_is_adult(new.club_id, new.user_id) then
    raise exception 'Les fonctions du bureau sont réservées aux adultes (fiche joueur mineure ou sans date de naissance)';
  end if;
  return new;
end $$;

-- Qui tient le contact : la personne qui a le rôle ; sinon, pour les licences, le secrétaire (titulaire) ; sinon le président.
create or replace function contact_holder(c uuid, r text) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'bureau'
      and m.fonction = case r when 'licences' then 'Correspondant licences' when 'rencontres' then 'Correspondant rencontres' end order by m.created_at limit 1),
    case when r = 'licences' then (select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'bureau' and m.fonction = 'Secrétaire' order by m.created_at limit 1) end,
    (select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'president' order by m.created_at limit 1));
$$;
revoke execute on function contact_holder(uuid, text) from public, anon;

-- « Qui s'occupe de quoi » ne désigne plus que pour Événements et Communication
create or replace function set_designation(p_club uuid, p_resp text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f text; cn text; prev uuid;
begin
  if not is_president(p_club) then raise exception 'Seul le président désigne qui s''occupe de quoi'; end if;
  if p_resp in ('licences','rencontres') then raise exception 'Ce rôle s''attribue dans « Fonctions du bureau »'; end if;
  if p_resp not in ('evenements','communication') then raise exception 'Responsabilité inconnue'; end if;
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
    f := case p_resp when 'communication' then 'Chargé de communication' else 'Membre du bureau' end;
    insert into memberships(club_id, user_id, role, fonction, status, designated_for) values (p_club, p_user, 'bureau', f, 'active', p_resp);
  end if;
  insert into club_designations(club_id, resp, user_id, set_by) values (p_club, p_resp, p_user, auth.uid())
    on conflict (club_id, resp) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
  perform log_action(p_club, p_user, null, 'désignation', jsonb_build_object('responsabilite', p_resp));
  if p_user <> auth.uid() then
    select name into cn from clubs where id = p_club;
    perform push_enqueue(p_user, 'Le président compte sur toi', (case p_resp when 'evenements' then 'Événements' else 'Communication' end) || ' · ' || coalesce(cn, ''),
      'fonction', 'designation:' || p_club || ':' || p_resp || ':' || p_user);
  end if;
end $$;
revoke execute on function set_designation(uuid, text, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 2. Notification à la création d'un match : toute l'équipe, puis les convoqués
-- ---------------------------------------------------------------------
-- « everyone » : sans tenir compte de la liste des convoqués (toutes les personnes qui voient le rendez-vous)
create or replace function push_event_targets(eid uuid, actor uuid, important boolean, everyone boolean) returns setof uuid
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
       and (everyone or cardinality(e.convoked) = 0 or is_board(e.club_id) or coaches_any(e.team_ids) or e.created_by = u
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
create or replace function push_event_targets(eid uuid, actor uuid, important boolean) returns setof uuid
language sql security definer set search_path = public as $$ select * from push_event_targets(eid, actor, important, false) $$;

create or replace function push_on_event_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evnew:' || coalesce(new.series_id::text, new.id::text); t text; b text;
  game boolean := new.type in ('Match','Plateau','Tournoi'); conv boolean := cardinality(new.convoked) > 0;
begin
  if new.cancelled or new.starts_at < now() then return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  if new.series_id is not null then
    t := 'Nouveaux entraînements';
    b := new.title || ' · chaque ' || (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from new.starts_at at time zone 'Europe/Paris')::int + 1]
         || ' à ' || to_char(new.starts_at at time zone 'Europe/Paris', 'HH24"h"MI') || ', dès le ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM')
         || ' (' || coalesce((select name from clubs where id = new.club_id), '') || ')';
  else
    t := case when game then 'Nouveau ' || lower(new.type) || ' prévu' else 'Nouveau : ' || lower(new.type) end;
    b := push_ev_line(new);
  end if;
  -- un match prévient toute l'équipe, même quand une liste de convoqués existe déjà
  for u in select * from push_event_targets(new.id, auth.uid(), false, game and new.series_id is null) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  -- les joueurs convoqués et leurs parents reçoivent en plus la convocation
  if game and conv and new.series_id is null then
    for u in select x from push_event_targets(new.id, auth.uid(), false, false) x
             where exists(select 1 from players p where p.id = any(new.convoked) and p.deleted_at is null
                          and (p.user_id = x or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = x))) loop
      perform push_enqueue(u, 'Convocation : ' || lower(new.type), b, 'evconv:' || new.id, 'evconv:' || new.id);
    end loop;
  end if;
  return null;
end $$;

revoke execute on function push_event_targets(uuid, uuid, boolean, boolean), push_event_targets(uuid, uuid, boolean), push_event_targets(uuid, uuid) from public, anon, authenticated;
revoke execute on function memberships_fonction_check() from public, anon, authenticated;
grant execute on function set_designation(uuid, text, uuid) to authenticated;

select close_visitor_functions();

select 'mypocketclub alpha 4.8.0 installée' as resultat;
