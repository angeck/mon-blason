-- Mon Blason · alpha 0.4 · valider une demande en choisissant (ou créant) l'équipe (garde toutes les données)
drop function if exists validate_membership(uuid);
create or replace function validate_membership(mid uuid, p_team uuid default null) returns void language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not can_validate(mid) then raise exception 'Vous ne pouvez pas valider cette demande'; end if;
  select club_id into c from memberships where id = mid;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = c) then raise exception 'Équipe inconnue dans ce club'; end if;
  update memberships set status = 'active', team_id = coalesce(p_team, team_id) where id = mid;
  if not found then raise exception 'Demande introuvable'; end if;
end $$;
