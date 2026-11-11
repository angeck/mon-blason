-- MAJ_ALPHA_5_2_1.sql · mypocketclub · un membre du bureau qui demande à devenir coach n'est plus validé automatiquement (président ou Directeur technique) · à lancer une fois dans Supabase > SQL Editor > Run (après la 5.2.0).
-- Sans perte de données, relançable sans risque. Rien à redéployer.

-- mypocketclub · alpha 5.2.1 · mise à jour d'une base 5.2.0, sans perte de données, relançable.
--   Un membre du bureau qui demande à devenir coach n'est plus validé automatiquement : la demande attend la validation
--   du président ou du Directeur technique (le secrétariat peut aussi la valider, comme avant).
--   Seuls restent immédiats : le supporteur, et toute demande faite par le président.
create or replace function join_club(p_code text, p_role text, p_team uuid, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; auto boolean;
begin
  perform check_join_rate();
  select id into cid from clubs where join_code = upper(trim(p_code));
  if cid is null then insert into join_attempts(user_id) values (auth.uid()); return null; end if;
  if exists(select 1 from profiles where id = auth.uid() and deleted_at is not null) then raise exception 'Ton compte est en cours de suppression'; end if;
  if p_role not in ('bureau','coach','joueur','parent','supporteur') then raise exception 'Rôle invalide'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = cid and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if p_role = 'parent' and coalesce(trim(p_child_first), '') = '' then raise exception 'Indique le prénom de l''enfant'; end if;
  auto := p_role = 'supporteur' or is_president(cid);
  insert into memberships(club_id, user_id, role, team_id, child_first, child_last, status)
    values (cid, auth.uid(), p_role, p_team, nullif(nice_first(p_child_first), ''), nullif(nice_last(p_child_last), ''), 'pending') returning id into mid;
  if auto then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

select close_visitor_functions();

select 'mypocketclub alpha 5.2.1 installée' as resultat;
