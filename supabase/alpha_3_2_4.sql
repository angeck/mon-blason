-- =====================================================================
-- Pocket Club · alpha 3.2.4 (mise à jour cumulative, relançable sans risque)
-- À installer APRÈS schema.sql, alpha_3_0_1, alpha_3_0_2, alpha_3_1, alpha_3_2 et alpha_3_2_1.
--   n° 57 : reprise des entraînements sans lien de série (recopiés, importés, créés avant la 3.1)
--   Retrait de la fonction « Responsable événements et buvette » et de la rubrique « Événements et buvette »
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 57 · Rattacher à une série les entraînements identiques restés sans lien
-- Même club, mêmes équipes, même titre, même jour de la semaine, même heure (heure de Paris), même créateur ;
-- au moins deux séances. Les séances déjà liées à une série ne sont jamais touchées.
-- Relançable : une fois rattachées, les séances ne sont plus « sans lien ».
-- ---------------------------------------------------------------------
create or replace function link_unlinked_trainings() returns int
language plpgsql set search_path = public as $$
declare g record; sid uuid; n int := 0;
begin
  for g in
    select club_id, team_ids, lower(trim(title)) as k_title, min(title) as title,
           extract(dow from starts_at at time zone 'Europe/Paris')::int as wd,
           to_char(starts_at at time zone 'Europe/Paris', 'HH24:MI') as hm,
           created_by, array_agg(id) as ids,
           max((starts_at at time zone 'Europe/Paris')::date) as last_day
    from events
    where type = 'Entraînement' and series_id is null and audience = 'team'
    group by club_id, team_ids, lower(trim(title)), extract(dow from starts_at at time zone 'Europe/Paris'),
             to_char(starts_at at time zone 'Europe/Paris', 'HH24:MI'), created_by
    having count(*) >= 2
  loop
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (g.club_id, g.title, g.wd, g.hm, g.last_day, true, g.created_by) returning id into sid;
    update events set series_id = sid where id = any(g.ids) and series_id is null;
    n := n + array_length(g.ids, 1);
  end loop;
  return n;
end $$;
revoke all on function link_unlinked_trainings() from public;
do $$ begin execute 'revoke all on function link_unlinked_trainings() from anon, authenticated'; exception when undefined_object then null; end $$;

select link_unlinked_trainings();

-- ---------------------------------------------------------------------
-- Retrait de la fonction « Responsable événements et buvette »
-- Les événements et les bénévoles relèvent du Coordinateur, du vice-président et du président.
-- La rubrique (clé interne « evenements ») reste, sous le nom « Événements ».
-- Reprise sans perte d'accès : les personnes qui avaient cette fonction passent « Membre du bureau »
-- et gardent la rubrique Événements, ouverte en plus, jusqu'à ce que le président règle leur fonction.
-- ---------------------------------------------------------------------
insert into board_areas(club_id, user_id, area)
  select distinct club_id, user_id, 'evenements' from memberships
  where fonction = 'Responsable événements et buvette' and status = 'active' and role = 'bureau'
  on conflict do nothing;
update memberships set fonction = 'Membre du bureau' where fonction = 'Responsable événements et buvette';

alter table memberships drop constraint if exists memberships_fonction;
alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur sportif','Coordinateur',
  'Correspondant licences','Chargé de communication','Responsable sponsoring','Membre du bureau'));

create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['secretariat']
    when 'Directeur sportif' then array['technique']
    when 'Coordinateur' then array['technique','evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then array['communication']
    else '{}'::text[] end;
$$;
