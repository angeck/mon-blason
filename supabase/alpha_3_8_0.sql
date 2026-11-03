-- mypocketclub · alpha 3.8.0 · n° 103 (supprimer une équipe en doublon : président ou bureau qui a la rubrique Technique).
-- Les autres points de la 3.8.0 (n° 98 à 102, 104, 106, 107, contact et site) ne touchent pas à la base.
-- Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- N° 103 · une équipe part à la corbeille (30 jours, restaurable par le président et le bureau) :
-- avant, seul le président pouvait le faire ; désormais aussi le bureau qui a la rubrique Technique
-- (has_area donne toutes les rubriques au président). Joueurs et fiches : inchangé (président et secrétariat).
-- ---------------------------------------------------------------------
create or replace function trash_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is null;
    if c is null or not (is_president(c) or has_area(c, 'technique')) then raise exception 'Seuls le président et le bureau (rubrique Technique) suppriment une équipe'; end if;
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
