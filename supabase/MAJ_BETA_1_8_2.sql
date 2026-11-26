-- MAJ_BETA_1_8_2.sql · mypocketclub · bêta 1.8.2 (Gaël, 26 novembre 2026 : gymnases et contact du coach)
-- À lancer sur mpc-test après MAJ_BETA_1_8_0.sql, puis sur mpc avec l'accord explicite de Gaël.
-- Seuls « drop » : les règles d'accès des gymnases (bureau → président) et des déclencheurs recréés. Aucune donnée effacée.
-- mypocketclub · bêta 1.8.2 « Gymnases et contact du coach » (Gaël, 26 novembre 2026, site de test d'abord)
-- Script idempotent (se relance sans risque). Aucun « drop table », aucun « delete » de données des clubs.
--   n° 304 : un gymnase ajouté après coup se met tout seul sur les rendez-vous à venir sans lieu, à domicile seulement,
--            quand c'est le seul gymnase du club ; avec plusieurs gymnases, on choisit dans une liste (écran).
--   n° 305 : seul le président crée, modifie ou retire un gymnase ; qui prépare la convocation peut écrire le lieu d'une
--            rencontre (et le président l'ajouter à la liste du club) ; « Demander au président d'ajouter les gymnases ».
--   n° 306 : contact du coach : la demande part toute seule (une fois), une seule relance 24 h après ; plus de bouton
--            manuel ni de case « sans les coordonnées du coach » (le repli « correspondant des rencontres » est immédiat).

-- =====================================================================
-- N° 305 · gymnases gérés par le président seul (Gaël, 26 novembre)
-- =====================================================================
drop policy if exists "gymnases ajoutés par le bureau" on club_gyms;
drop policy if exists "gymnases modifiés par le bureau" on club_gyms;
drop policy if exists "gymnases supprimés par le bureau" on club_gyms;
drop policy if exists "gymnases ajoutés par le président" on club_gyms;
create policy "gymnases ajoutés par le président" on club_gyms for insert with check (is_president(club_id) and (select count(*) from club_gyms g where g.club_id = club_gyms.club_id) < 20);
drop policy if exists "gymnases modifiés par le président" on club_gyms;
create policy "gymnases modifiés par le président" on club_gyms for update using (is_president(club_id)) with check (is_president(club_id));
drop policy if exists "gymnases supprimés par le président" on club_gyms;
create policy "gymnases supprimés par le président" on club_gyms for delete using (is_president(club_id));

-- Texte du lieu d'un gymnase : « Nom, adresse » (même règle que l'écran, gymPlace)
create or replace function gym_place(p_name text, p_address text) returns text language sql immutable as $$
  select nullif(concat_ws(', ', nullif(trim(coalesce(p_name, '')), ''), nullif(trim(coalesce(p_address, '')), '')), '');
$$;

-- =====================================================================
-- N° 304 · premier gymnase du club : il se met sur les rendez-vous à venir sans lieu, à domicile
-- =====================================================================
create or replace function gyms_fill_places() returns trigger language plpgsql security definer set search_path = public as $$
declare p text; x uuid;
begin
  if (select count(*) from club_gyms g where g.club_id = new.club_id) <> 1 then return null; end if;
  p := gym_place(new.name, new.address);
  if p is null then return null; end if;
  -- un rendez-vous à la fois : si un contrôle d'un autre rendez-vous refuse la mise à jour, les autres passent quand même
  for x in select y.id from events y
           where y.club_id = new.club_id and y.starts_at > now() and not coalesce(y.cancelled, false)
             and coalesce(trim(y.place), '') = ''
             and (y.type not in ('Match','Plateau','Tournoi') or y.at_home is not false) loop
    begin
      update events set place = p where id = x;
    exception when others then raise notice 'lieu non mis sur %', x;
    end;
  end loop;
  return null;
end $$;
revoke execute on function gyms_fill_places() from public, anon, authenticated;
drop trigger if exists club_gyms_fill on club_gyms;
create trigger club_gyms_fill after insert on club_gyms for each row execute function gyms_fill_places();

-- Le lieu d'une rencontre, écrit depuis la convocation (qui la prépare : rubrique Événements) ;
-- le président peut en même temps l'ajouter à la liste des gymnases du club.
create or replace function set_event_place(p_event uuid, p_name text, p_address text, p_save boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare e events; p text; n text := left(trim(coalesce(p_name, '')), 80); a text := left(trim(coalesce(p_address, '')), 200);
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'Réservé à qui prépare la convocation'; end if;
  if e.type not in ('Match','Plateau','Tournoi') or e.at_home is false then raise exception 'Seulement pour une rencontre à domicile'; end if;
  p := gym_place(n, a);
  if p is null then raise exception 'Écris le nom ou l''adresse du lieu'; end if;
  if coalesce(p_save, false) then
    if not is_president(e.club_id) then raise exception 'Seul le président ajoute un gymnase à la liste du club'; end if;
    if n = '' then raise exception 'Donne un nom au gymnase'; end if;
    if (select count(*) from club_gyms g where g.club_id = e.club_id) >= 20 then raise exception 'Le club a déjà 20 gymnases'; end if;
    if not exists(select 1 from club_gyms g where g.club_id = e.club_id and gym_place(g.name, g.address) = p) then
      insert into club_gyms(club_id, name, address, position) values (e.club_id, n, a, (select count(*) from club_gyms g where g.club_id = e.club_id));
    end if;
  end if;
  update events set place = p where id = e.id;
  return p;
end $$;
revoke execute on function set_event_place(uuid, text, text, boolean) from public, anon;
grant execute on function set_event_place(uuid, text, text, boolean) to authenticated;

-- « Demander au président d'ajouter les gymnases » : une demande par club et par jour ; la notification ouvre ses Réglages
create table if not exists gym_asks (
  club_id uuid not null references clubs(id) on delete cascade,
  asked_by uuid,
  asked_at timestamptz not null default now()
);
create index if not exists gym_asks_club on gym_asks(club_id, asked_at desc);
alter table gym_asks enable row level security;
revoke all on gym_asks from anon, authenticated;

create or replace function gyms_ask_president(p_event uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e events; pres uuid; me text; last timestamptz;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'Réservé à qui prépare la convocation'; end if;
  if is_president(e.club_id) then raise exception 'Tu es le président : ajoute-les dans Président › Réglages'; end if;
  select max(asked_at) into last from gym_asks where club_id = e.club_id;
  if last >= date_trunc('day', now()) then raise exception 'Président déjà prévenu aujourd''hui (le %)', to_char(last at time zone 'Europe/Paris', 'DD/MM à HH24:MI'); end if;
  insert into gym_asks(club_id, asked_by) values (e.club_id, auth.uid());
  select first_name || case when coalesce(last_name, '') <> '' then ' ' || left(last_name, 1) || '.' else '' end into me from profiles where id = auth.uid();
  for pres in select m.user_id from memberships m where m.club_id = e.club_id and m.role = 'president' and m.status = 'active' and m.user_id <> auth.uid() loop
    perform push_enqueue(pres, 'Gymnases du club à ajouter',
      coalesce(me, 'Un membre du club') || ' prépare la convocation du ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM') || ' : ajoute les gymnases du club, le lieu des rencontres se remplira.',
      'gymask', 'gymask:' || e.club_id || ':' || to_char(now(), 'YYYYMMDD'), './#ouvrir=' || e.club_id || '.gyms');
  end loop;
  return now();
end $$;
revoke execute on function gyms_ask_president(uuid) from public, anon;
grant execute on function gyms_ask_president(uuid) to authenticated;

-- =====================================================================
-- N° 306 · contact du coach : demande automatique, une seule relance
-- =====================================================================
-- Le coach d'une rencontre : le même choix que la convocation (coach du club d'abord, puis celui qui partage, puis celui qui a répondu)
create or replace function event_coach(p_event uuid) returns table(club_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  select m.club_id, m.user_id
  from events x join memberships m on m.role = 'coach' and m.status = 'active' and m.team_id = any(x.team_ids)
    and (m.club_id = x.club_id or exists(select 1 from unnest(x.team_ids) tt where entente_club(tt) = m.club_id))
  join profiles p on p.id = m.user_id
  left join coach_contacts k on k.club_id = m.club_id and k.user_id = m.user_id
  where x.id = p_event
  order by (m.club_id = x.club_id) desc, (coalesce(k.show_phone, false) or coalesce(k.show_sms, false) or coalesce(k.show_email, false)) desc,
    (k.answered_at is not null) desc, p.full_name limit 1;
$$;
revoke execute on function event_coach(uuid) from public, anon, authenticated;

-- Première demande (une seule fois, pour toutes les convocations) ; rien si le coach a répondu, ou s'il a déjà été demandé.
-- Celui qui fait l'action ne se notifie pas lui-même (règle du n° 278) : la demande partira quand un autre préparera la convocation.
create or replace function coach_contact_autoask(p_event uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare e events; cc uuid; co uuid;
begin
  select * into e from events where id = p_event;
  if e.id is null or e.type not in ('Match','Plateau','Tournoi') or e.at_home is false or e.audience <> 'team' or coalesce(e.cancelled, false) then return false; end if;
  if e.starts_at < now() then return false; end if;
  select c.club_id, c.user_id into cc, co from event_coach(p_event) c;
  if co is null or co = auth.uid() then return false; end if;
  if coach_answered(cc, co) then return false; end if;
  if exists(select 1 from coach_contact_asks a where a.club_id = cc and a.user_id = co) then return false; end if;
  insert into coach_contact_asks(club_id, user_id, asked_by) values (cc, co, auth.uid());
  perform push_enqueue(co, 'Tes coordonnées pour les convocations',
    'Ton club prépare la convocation du ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM') || ' : choisis ce que les clubs reçus verront de toi. En attendant, elle renvoie au correspondant des rencontres.',
    'coachcontact', 'coachcontact:' || cc || ':' || co || ':1', './#ouvrir=' || cc || '.contact');
  return true;
end $$;
revoke execute on function coach_contact_autoask(uuid) from public, anon, authenticated;

-- À la création d'une rencontre à domicile (ou quand elle le devient, ou change d'équipe)
create or replace function events_coach_autoask() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.at_home is not distinct from old.at_home and new.team_ids is not distinct from old.team_ids
     and new.type is not distinct from old.type and new.audience is not distinct from old.audience then return null; end if;
  perform coach_contact_autoask(new.id);
  return null;
end $$;
revoke execute on function events_coach_autoask() from public, anon, authenticated;
drop trigger if exists events_coach_autoask on events;
create trigger events_coach_autoask after insert or update of at_home, team_ids, type, audience on events
  for each row execute function events_coach_autoask();

-- À l'ouverture de la convocation : demande aux coachs des rencontres du week-end qui n'ont jamais été demandés
create or replace function convocation_ask_coaches(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; d date; d0 date; d1 date; dw int; n int := 0; x uuid;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'Réservé à qui prépare la convocation'; end if;
  d := (e.starts_at at time zone 'Europe/Paris')::date; dw := extract(isodow from d)::int;
  if dw >= 6 then d0 := d - (dw - 6); d1 := d0 + 1; else d0 := d; d1 := d; end if;
  for x in select y.id from events y where y.club_id = e.club_id and y.at_home and y.type in ('Match','Plateau','Tournoi') and y.audience = 'team'
             and (y.starts_at at time zone 'Europe/Paris')::date between d0 and d1 loop
    if coach_contact_autoask(x) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function convocation_ask_coaches(uuid) from public, anon;
grant execute on function convocation_ask_coaches(uuid) to authenticated;

-- Une seule relance, 24 h après la première demande, si le coach n'a toujours pas répondu (programme automatique, chaque heure)
create or replace function coach_contact_relance() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select a.club_id, a.user_id, min(a.asked_at) as first_at, count(*) as nb from coach_contact_asks a
           group by a.club_id, a.user_id having count(*) = 1 and min(a.asked_at) <= now() - interval '24 hours' loop
    if coach_answered(r.club_id, r.user_id) then continue; end if;
    if not exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = r.user_id and m.role = 'coach' and m.status = 'active') then continue; end if;
    insert into coach_contact_asks(club_id, user_id, asked_by) values (r.club_id, r.user_id, null);
    perform push_enqueue(r.user_id, 'Rappel : tes coordonnées pour les convocations',
      'Tes convocations renvoient au correspondant des rencontres. Choisis une fois ce que les clubs reçus verront de toi (ou « rien »).',
      'coachcontact', 'coachcontact:' || r.club_id || ':' || r.user_id || ':2', './#ouvrir=' || r.club_id || '.contact');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function coach_contact_relance() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('mpc-coach-relance') where exists(select 1 from cron.job where jobname = 'mpc-coach-relance');
  perform cron.schedule('mpc-coach-relance', '17 * * * *', 'select public.coach_contact_relance()');
exception when others then raise notice 'programme automatique non créé ici : %', sqlerrm;
end $$;

-- Plus de relance à la main (le bouton disparaît) : la fonction reste, fermée à tous
revoke execute on function coach_contact_remind(uuid, uuid) from authenticated;

-- La convocation donne aussi le nombre de demandes (1 = demandé, 2 = relancé) et la date de la première
create or replace function convocation_data(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events; c clubs; d date; d0 date; d1 date; dw int; ren uuid;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'La convocation est réservée au correspondant rencontres, au vice-président et au président'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'La convocation vaut pour un match, un plateau ou un tournoi'; end if;
  d := (e.starts_at at time zone 'Europe/Paris')::date; dw := extract(isodow from d)::int;
  if dw >= 6 then d0 := d - (dw - 6); d1 := d0 + 1; else d0 := d; d1 := d; end if;
  select * into c from clubs where id = e.club_id;
  ren := contact_holder(c.id, 'rencontres');
  return jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'color1', c.color1, 'color2', c.color2, 'logo', c.logo, 'crest_bg', c.crest_bg, 'crest_outline', c.crest_outline),
    'from', d0, 'to', d1,
    'president', is_president(c.id),
    'gyms', coalesce((select jsonb_agg(jsonb_build_object('name', g.name, 'address', g.address) order by g.position, g.created_at) from club_gyms g where g.club_id = c.id), '[]'::jsonb),
    'gym_asked_at', (select max(a.asked_at) from gym_asks a where a.club_id = c.id),
    'correspondent', case when ren is null then null else (select jsonb_build_object('name', x->>'name', 'phone', x->>'phone', 'email', x->>'email') from (select contact_person(c.id, ren, 'Correspondant rencontres') x) z) end,
    'sender', (select jsonb_build_object('name', trim(p.first_name || ' ' || p.last_name), 'email', u.email) from profiles p join auth.users u on u.id = p.id where p.id = auth.uid()),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'type', x.type, 'title', x.title, 'starts_at', x.starts_at, 'place', x.place, 'opponents', x.opponents, 'cancelled', x.cancelled,
        'team', (select jsonb_build_object('name', t.name, 'category', t.category, 'gender', t.gender) from teams t where t.id = any(x.team_ids) and t.deleted_at is null order by t.name limit 1),
        'coach', (select jsonb_build_object('name', p.full_name, 'id', m.user_id,
                    'phone', case when coalesce(k.show_phone, false) or coalesce(k.show_sms, false) then nullif(p.phone, '') end,
                    'sms_only', coalesce(k.show_sms, false) and not coalesce(k.show_phone, false),
                    'email', case when coalesce(k.show_email, false) then u.email::text end,
                    'answered', coach_answered(m.club_id, m.user_id),
                    'asked_at', (select min(a.asked_at) from coach_contact_asks a where a.club_id = m.club_id and a.user_id = m.user_id),
                    'asks', (select count(*) from coach_contact_asks a where a.club_id = m.club_id and a.user_id = m.user_id))
                  from memberships m join profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id
                  left join coach_contacts k on k.club_id = m.club_id and k.user_id = m.user_id
                  where m.role = 'coach' and m.status = 'active' and m.team_id = any(x.team_ids)
                    and (m.club_id = x.club_id or exists(select 1 from unnest(x.team_ids) tt where entente_club(tt) = m.club_id))
                  order by (m.club_id = x.club_id) desc, (coalesce(k.show_phone, false) or coalesce(k.show_sms, false) or coalesce(k.show_email, false)) desc,
                    (k.answered_at is not null) desc, p.full_name limit 1))
        order by x.starts_at, x.title)
      from events x where x.club_id = e.club_id and x.at_home and x.type in ('Match','Plateau','Tournoi') and x.audience = 'team'
        and (x.starts_at at time zone 'Europe/Paris')::date between d0 and d1), '[]'::jsonb));
end $$;
revoke execute on function convocation_data(uuid) from public, anon;
grant execute on function convocation_data(uuid) to authenticated;

select close_visitor_functions();
