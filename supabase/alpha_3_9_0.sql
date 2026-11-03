-- mypocketclub · alpha 3.9.0 · n° 108 (le coordinateur est prévenu d'un match à domicile créé par un coach).
-- Les autres points de la 3.9.0 (n° 109 nom du club en expéditeur, n° 111 titre automatique) ne touchent pas à la base.
-- La purge des messages et des rendez-vous (n° 110) est un script à part : PURGE_MESSAGES_RENDEZ_VOUS.sql.
-- Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- N° 108 · un coach (ou toute personne sans la rubrique Événements) crée un match, un plateau ou un tournoi
-- à domicile pour une équipe, ou coche « Match à domicile » après coup : les personnes qui ont la rubrique
-- Événements (coordinateur, vice-président, président) reçoivent une notification pour préparer la convocation
-- des clubs reçus. Une seule notification par rendez-vous et par personne (clé convhome:<id>).
-- ---------------------------------------------------------------------
create or replace function push_on_home_match() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; actor uuid := coalesce(auth.uid(), new.created_by); b text;
begin
  if new.cancelled or not new.at_home or new.audience <> 'team' or new.type not in ('Match','Plateau','Tournoi') or new.starts_at < now() then return null; end if;
  if tg_op = 'UPDATE' and old.at_home and old.type in ('Match','Plateau','Tournoi') then return null; end if;
  if actor is not null and 'evenements' = any(areas_of(new.club_id, actor)) then return null; end if;
  b := push_ev_line(new);
  for u in select distinct m.user_id from memberships m
           where m.club_id = new.club_id and m.status = 'active' and m.role in ('president','bureau')
             and m.user_id is distinct from actor and 'evenements' = any(areas_of(new.club_id, m.user_id)) loop
    perform push_enqueue(u, left('Match à domicile à convoquer : ' || coalesce(nullif(new.opponents, ''), lower(new.type)), 80), b, 'conv:' || new.id, 'convhome:' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists push_home_match on events;
create trigger push_home_match after insert or update of at_home, type on events for each row execute function push_on_home_match();
