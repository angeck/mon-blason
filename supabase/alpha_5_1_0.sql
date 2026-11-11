-- mypocketclub · alpha 5.1.0 · mise à jour d'une base 4.10.0, sans perte de données, relançable.
-- Lot « navigation figée » (« go » de Gaël, 11 novembre 2026). Côté base, un seul point :
-- N° 198 : le coach choisit ou change les convoqués APRÈS la création du match.
--   - Les joueurs ajoutés à la liste (et leurs parents) reçoivent « Convocation : match ».
--   - Les joueurs retirés de la liste (et leurs parents) reçoivent « Convocation retirée : match », avec le prénom.
--   - Une liste créée sur un match qui n'en avait pas : seuls les joueurs choisis sont prévenus (les autres
--     n'avaient jamais été convoqués nommément). Une liste vidée (retour à « toute l'équipe ») : rien ne part.
--   - Seulement pour un match, un plateau ou un tournoi à venir, hors série, non annulé.
-- Le reste du lot (n° 189, 190, 191, 194, 195, 196) est dans le code de l'application.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

create or replace function push_on_event_update() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text; t text; b text; imp boolean := false; stamp text := to_char(now(), 'YYYYMMDDHH24MI');
  added uuid[]; removed uuid[]; x record;
begin
  -- n° 198 : liste des convoqués changée après la création
  if new.type in ('Match','Plateau','Tournoi') and new.series_id is null and not new.cancelled and new.starts_at > now()
     and new.convoked is distinct from old.convoked and cardinality(new.convoked) > 0 then
    added := array(select p from unnest(new.convoked) p where not (p = any(old.convoked)));
    removed := case when cardinality(old.convoked) = 0 then '{}'::uuid[]
                    else array(select p from unnest(old.convoked) p where not (p = any(new.convoked))) end;
    b := push_ev_line(new);
    if cardinality(added) > 0 then
      for u in select y from push_event_targets(new.id, auth.uid(), false, false) y
               where exists(select 1 from players p where p.id = any(added) and p.deleted_at is null
                            and (p.user_id = y or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = y))) loop
        perform push_enqueue(u, 'Convocation : ' || lower(new.type), b, 'evconv:' || new.id, 'evconv:' || new.id || ':' || stamp);
      end loop;
    end if;
    if cardinality(removed) > 0 then
      -- « toutes les personnes qui voient le rendez-vous » : la liste ne les filtre plus, ils ne sont plus convoqués
      for x in select y as uid, string_agg(distinct p.first_name, ', ') as who from push_event_targets(new.id, auth.uid(), false, true) y
               join players p on p.id = any(removed) and p.deleted_at is null
                 and (p.user_id = y or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = y))
               group by y loop
        perform push_enqueue(x.uid, 'Convocation retirée : ' || lower(new.type), x.who || ' · ' || b, 'evconv:' || new.id, 'evunconv:' || new.id || ':' || stamp);
      end loop;
    end if;
  end if;

  -- changements d'horaire, de lieu, annulation (inchangé depuis la 4.7.0)
  if new.starts_at < now() - interval '1 hour' then return null; end if;
  if new.cancelled and not old.cancelled then
    k := 'evcancel:' || coalesce(new.series_id::text || ':' || stamp, new.id::text);
    t := 'Annulé'; b := push_ev_line(new); imp := true;
  elsif not new.cancelled and old.cancelled then
    k := 'evback:' || new.id || ':' || stamp;
    t := 'De nouveau prévu'; b := push_ev_line(new);
  elsif not new.cancelled and (new.starts_at is distinct from old.starts_at or new.place is distinct from old.place
        or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day) then
    k := 'evmod:' || coalesce(new.series_id::text, new.id::text) || ':' || stamp;
    imp := new.starts_at is distinct from old.starts_at or new.duration_min is distinct from old.duration_min or new.all_day is distinct from old.all_day;
    t := case when imp then 'Nouvel horaire' else 'Nouveau lieu' end;
    b := push_ev_line(new);
  else return null; end if;
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  for u in select * from push_event_targets(new.id, auth.uid(), imp) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  return null;
end $$;

drop trigger if exists push_event_update on events;
create trigger push_event_update after update of cancelled, starts_at, place, duration_min, all_day, convoked on events
  for each row execute function push_on_event_update();
revoke execute on function push_on_event_update() from public, anon, authenticated;

select close_visitor_functions();
