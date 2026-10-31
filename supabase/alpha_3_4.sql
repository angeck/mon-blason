-- =====================================================================
-- Pocket Club · alpha 3.4 · convocations inter-clubs en PDF (mise à jour relançable sans risque)
-- À installer APRÈS alpha_3_3_2.sql.
--   1. « Nous recevons » sur un match, un plateau ou un tournoi (rencontre à domicile)
--   2. Correction : les joueurs choisis (convocation) et « Nous recevons » sont enregistrés dès la création
--      (avant, les joueurs choisis n'étaient gardés qu'en modifiant le rendez-vous)
--   3. Données de la convocation d'un week-end : le club qui reçoit, son contact « planification des matchs »,
--      les rencontres à domicile du week-end, le coach de chaque équipe. Réservé à la rubrique Événements
--      (coordinateur, vice-président, président).
-- =====================================================================
alter table events add column if not exists at_home boolean not null default true;

create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true)
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Données de la convocation du week-end d'un rendez-vous (samedi + dimanche ; en semaine : ce jour-là seulement)
create or replace function convocation_data(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events; c clubs; d date; d0 date; d1 date; dw int;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'La convocation est réservée au coordinateur, au vice-président et au président'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'La convocation vaut pour un match, un plateau ou un tournoi'; end if;
  d := (e.starts_at at time zone 'Europe/Paris')::date; dw := extract(isodow from d)::int;
  if dw >= 6 then d0 := d - (dw - 6); d1 := d0 + 1; else d0 := d; d1 := d; end if;
  select * into c from clubs where id = e.club_id;
  return jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'color1', c.color1, 'color2', c.color2, 'logo', c.logo, 'crest_bg', c.crest_bg),
    'from', d0, 'to', d1,
    'correspondent', (select jsonb_build_object('name', p.full_name, 'phone', case when k.show_phone then nullif(p.phone, '') end, 'email', case when k.show_email then u.email end)
                      from club_contacts k join profiles p on p.id = k.user_id join auth.users u on u.id = k.user_id
                      join memberships m on m.user_id = k.user_id and m.club_id = k.club_id and m.status = 'active' and m.role in ('president','bureau')
                      where k.club_id = c.id and k.for_matches order by k.updated_at limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'type', x.type, 'title', x.title, 'starts_at', x.starts_at, 'place', x.place, 'opponents', x.opponents, 'cancelled', x.cancelled,
        'team', (select jsonb_build_object('name', t.name, 'category', t.category, 'gender', t.gender) from teams t where t.id = any(x.team_ids) and t.deleted_at is null order by t.name limit 1),
        'coach', (select jsonb_build_object('name', p.full_name, 'phone', nullif(p.phone, ''), 'email', u.email)
                  from memberships m join profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id
                  where m.club_id = x.club_id and m.role = 'coach' and m.status = 'active' and m.team_id = any(x.team_ids) order by p.full_name limit 1))
        order by x.starts_at, x.title)
      from events x where x.club_id = e.club_id and x.at_home and x.type in ('Match','Plateau','Tournoi') and x.audience = 'team'
        and (x.starts_at at time zone 'Europe/Paris')::date between d0 and d1), '[]'::jsonb));
end $$;
revoke execute on function convocation_data(uuid) from public, anon;
grant execute on function convocation_data(uuid) to authenticated;
