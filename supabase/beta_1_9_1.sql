-- mypocketclub · bêta 1.9.1 « Corrections de la vitrine et contact du coach » (Gaël, 28 novembre 2026, 9 h 58 : « Go »)
-- Script idempotent (se relance sans risque). Aucun « drop table », aucun « delete » de données des clubs. À lancer après beta_1_9_0.sql.
--   Vitrine : la cotisation vient des tarifs du trésorier, équipe par équipe (plus de saisie à la main) ; le blason est dans
--             l'écusson du club, comme sur la convocation (contour compris).
--   Demande de logo : le président envoie à mypocketclub un texte et des pièces jointes (Blason, couleurs et réglages du club) ;
--             la demande est gardée (sans les fichiers, qui partent par e-mail à l'administrateur) et l'administrateur est notifié.
--   N° 307 : contact du coach en trois états (coordonnées / refus explicite / rien fait) ; « Relancer le coach » (une fois par jour)
--             et « Envoyer avec le correspondant » ; l'envoi et le PDF attendent ce choix ; la relance automatique à 24 h reste.

-- =====================================================================
-- 1. Vitrine : cotisation équipe par équipe, contour du blason
-- =====================================================================
create or replace function vitrine_public(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v club_vitrines; c clubs; s text; logged boolean := auth.uid() is not null; slots jsonb; w0 timestamptz := now() - interval '7 days'; w1 timestamptz := now() + interval '42 days';
begin
  select * into v from club_vitrines where slug = lower(trim(coalesce(p_slug, '')));
  if v.club_id is null then return null; end if;
  select * into c from clubs where id = v.club_id;
  if c.id is null or c.deleted_at is not null then return null; end if;
  if not v.enabled and not (logged and has_area(c.id, 'vitrine')) then return null; end if;
  s := coalesce(v.season, vitrine_latest_season(c.id));
  -- créneaux d'entraînement de la semaine type : entraînements des 6 prochaines semaines (sinon des 5 prochains mois)
  for i in 1..2 loop
    select coalesce(jsonb_agg(x order by x->>'day', x->>'start'), '[]'::jsonb) into slots from (
      select distinct jsonb_build_object('team', tid, 'day', extract(isodow from e.starts_at at time zone 'Europe/Paris')::int,
        'start', to_char(e.starts_at at time zone 'Europe/Paris', 'HH24:MI'), 'min', coalesce(e.duration_min, 90),
        'gym', nullif(trim(split_part(e.place, ',', 1)), '')) x
      from events e cross join unnest(e.team_ids) tid
      join teams t on t.id = tid and t.club_id = c.id and t.deleted_at is null and t.state = 'Visible' and t.season = s
      where e.club_id = c.id and e.type = 'Entraînement' and not e.cancelled and e.audience = 'team' and not coalesce(e.all_day, false)
        and e.starts_at between w0 and w1 and not (tid = any(v.slots_hidden))) z;
    exit when jsonb_array_length(slots) > 0;
    w0 := now(); w1 := now() + interval '150 days';
  end loop;
  return jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'postal_code', c.postal_code,
      'logo', c.logo, 'color1', case when c.logo is null then '#2F5BFF' else c.color1 end, 'color2', case when c.logo is null then '#FFC93C' else c.color2 end,
      'crest_bg', c.crest_bg, 'crest_outline', c.crest_outline, 'mpc', c.logo is null),
    'slug', v.slug, 'enabled', v.enabled, 'season', s, 'logged', logged,
    'can_edit', logged and has_area(c.id, 'vitrine'),
    'content', v.content, 'layout', v.layout,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
        'players', (select count(*) from players p where p.team_id = t.id and p.deleted_at is null),
        'status', coalesce(v.team_status->>(t.id::text), 'recrute'), 'slots_hidden', t.id = any(v.slots_hidden),
        -- cotisation : celle de l'équipe si elle a un tarif particulier, sinon celle de sa catégorie (comme grid_for), jamais la part fédération
        'fee', coalesce((select g.amount from fee_grid g where g.club_id = c.id and g.team_id = t.id order by g.created_at desc limit 1),
                        (select g.amount from fee_grid g where g.club_id = c.id and g.team_id is null and g.season = t.season and g.category = coalesce(nullif(t.category, ''), t.name) order by g.created_at desc limit 1))) order by t.category, t.name)
      from teams t where t.club_id = c.id and t.deleted_at is null and t.state = 'Visible' and t.season = s), '[]'::jsonb),
    'slots', slots,
    'counts', jsonb_build_object(
      'teams', (select count(*) from teams t where t.club_id = c.id and t.deleted_at is null and t.state = 'Visible' and t.season = s),
      'players', (select count(*) from players p where p.club_id = c.id and p.deleted_at is null and not p.from_partner),
      'gyms', (select count(*) from club_gyms g where g.club_id = c.id)),
    'gyms', coalesce((select jsonb_agg(jsonb_build_object('name', g.name, 'address', g.address) order by g.position, g.name) from club_gyms g where g.club_id = c.id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('at', e.starts_at, 'type', e.type, 'opponents', e.opponents,
        'teams', (select string_agg(t.name, ' · ') from teams t where t.id = any(e.team_ids)), 'gym', nullif(trim(split_part(e.place, ',', 1)), '')) order by e.starts_at)
      from (select * from events e where e.club_id = c.id and e.type in ('Match','Plateau','Tournoi') and e.at_home and not e.cancelled and e.audience = 'team'
              and e.starts_at between now() and now() + interval '31 days' order by e.starts_at limit 6) e), '[]'::jsonb),
    'results', case when logged then coalesce((select jsonb_agg(jsonb_build_object('at', e.starts_at, 'type', e.type, 'home', e.at_home,
        'teams', (select string_agg(t.name, ' · ') from teams t where t.id = any(e.team_ids)), 'scores', e.scores) order by e.starts_at desc)
      from (select * from events e where e.club_id = c.id and e.scores is not null and jsonb_array_length(e.scores) > 0 and not e.cancelled and e.starts_at < now()
              order by e.starts_at desc limit 5) e), '[]'::jsonb) end);
end $$;
revoke execute on function vitrine_public(text) from public;
grant execute on function vitrine_public(text) to anon, authenticated;

-- =====================================================================
-- 2. Demande de création de logo (président → mypocketclub)
-- =====================================================================
create table if not exists logo_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid,
  message text not null default '' check (length(message) <= 3000),
  files text[] not null default '{}',
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists logo_requests_club on logo_requests(club_id, created_at desc);
alter table logo_requests enable row level security;
revoke all on logo_requests from anon, authenticated;

alter table mail_log drop constraint if exists mail_log_kind_check;
alter table mail_log add constraint mail_log_kind_check check (kind in ('test', 'nouvel_appareil', 'invitation_parent', 'rappel_validation', 'attestation',
  'prevenance_inactif', 'information', 'recommandation', 'validation', 'pret', 'vitrine', 'logo'));

-- Appelée par la fonction Edge « demande-logo » (clé du serveur), après avoir vérifié le compte : seul le président du club,
-- 3 demandes par club et par jour. Rend les adresses des administrateurs (jamais au navigateur).
create or replace function logo_request_take(p_user uuid, p_club uuid, p_message text, p_files text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c clubs; rid uuid; ms text := left(trim(regexp_replace(coalesce(p_message, ''), '[<>]', ' ', 'g')), 3000); a uuid;
  fs text[] := coalesce((select array_agg(left(regexp_replace(f, '[<>\r\n"]', ' ', 'g'), 120)) from unnest(coalesce(p_files, '{}'::text[])) f), '{}');
begin
  select * into c from clubs where id = p_club;
  if c.id is null or c.deleted_at is not null then raise exception 'Club introuvable'; end if;
  if not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p_user and m.role = 'president' and m.status = 'active') then
    raise exception 'Réservé au président du club';
  end if;
  if length(ms) < 2 and coalesce(array_length(fs, 1), 0) = 0 then raise exception 'Écris quelques mots ou ajoute une pièce jointe.'; end if;
  if (select count(*) from logo_requests where club_id = p_club and created_at >= now() - interval '1 day') >= 3 then
    raise exception 'Limite atteinte : 3 demandes par jour. Réessaie demain.';
  end if;
  delete from logo_requests where created_at < now() - interval '1 year'; -- gardée 1 an (Vos données 1.19)
  insert into logo_requests(club_id, user_id, message, files) values (p_club, p_user, ms, fs) returning id into rid;
  for a in select user_id from app_admins loop
    perform push_enqueue(a, 'Demande de logo', c.name || ' demande la création de son logo.', 'logoreq', 'logoreq:' || rid, './');
  end loop;
  return jsonb_build_object('id', rid, 'club', c.name, 'city', c.city, 'sport', c.sport,
    'president', (select full_name from profiles where id = p_user), 'president_email', (select email from auth.users where id = p_user),
    'admins', coalesce((select jsonb_agg(u.email) from app_admins x join auth.users u on u.id = x.user_id where u.email is not null), '[]'::jsonb),
    'mail_ok', mails_today() < 90);
end $$;
revoke execute on function logo_request_take(uuid, uuid, text, text[]) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function logo_request_take(uuid, uuid, text, text[]) to service_role';
  end if;
end $$;

-- Le président voit ses demandes déjà envoyées
create or replace function my_logo_requests(p_club uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Réservé au président du club'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', r.created_at, 'files', coalesce(array_length(r.files, 1), 0), 'done', r.done_at is not null) order by r.created_at desc)
    from (select * from logo_requests where club_id = p_club order by created_at desc limit 5) r), '[]'::jsonb);
end $$;
revoke execute on function my_logo_requests(uuid) from public, anon;
grant execute on function my_logo_requests(uuid) to authenticated;

-- Espace admin : les demandes de logo à traiter, et « Fait »
create or replace function admin_logo_requests() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'club', c.name, 'city', c.city, 'at', r.created_at, 'message', r.message, 'files', r.files,
      'president', (select full_name from profiles where id = r.user_id)) order by r.created_at desc)
    from logo_requests r join clubs c on c.id = r.club_id where r.done_at is null), '[]'::jsonb);
end $$;
create or replace function admin_logo_done(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  update logo_requests set done_at = now() where id = p_id;
end $$;
revoke execute on function admin_logo_requests(), admin_logo_done(uuid) from public, anon;
grant execute on function admin_logo_requests(), admin_logo_done(uuid) to authenticated;

-- =====================================================================
-- 3. N° 307 · contact du coach : trois états
-- =====================================================================
alter table coach_contacts add column if not exists refused boolean not null default false;
-- Tout décoché sans refus = « n'a rien fait » (avant la 1.9.1, tout décocher valait refus)
update coach_contacts set answered_at = null
  where not refused and not (show_phone or show_sms or show_email) and answered_at is not null;

create or replace function my_coach_contact(p_club uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('show_phone', coalesce(k.show_phone, false), 'show_sms', coalesce(k.show_sms, false), 'show_email', coalesce(k.show_email, false),
    'refused', coalesce(k.refused, false), 'answered', k.answered_at is not null)
  from (select 1) z left join coach_contacts k on k.club_id = p_club and k.user_id = auth.uid();
$$;
-- Cocher une case enlève le refus ; tout décocher remet le coach dans « n'a rien fait »
create or replace function set_coach_contact(p_club uuid, p_phone boolean, p_sms boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public as $$
declare anyon boolean := coalesce(p_phone, false) or coalesce(p_sms, false) or coalesce(p_email, false);
begin
  if not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = auth.uid() and m.role = 'coach' and m.status = 'active') then
    raise exception 'Réservé aux coachs du club';
  end if;
  insert into coach_contacts(club_id, user_id, show_phone, show_sms, show_email, refused, updated_at, answered_at)
    values (p_club, auth.uid(), coalesce(p_phone, false), coalesce(p_sms, false), coalesce(p_email, false), false, now(), case when anyon then now() end)
    on conflict (club_id, user_id) do update set show_phone = excluded.show_phone, show_sms = excluded.show_sms, show_email = excluded.show_email,
      refused = false, updated_at = now(), answered_at = excluded.answered_at;
end $$;
-- Refus explicite : la convocation renvoie au correspondant des rencontres, sans relance ; « Revenir sur mon refus » l'enlève
create or replace function set_coach_refuse(p_club uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = auth.uid() and m.role = 'coach' and m.status = 'active') then
    raise exception 'Réservé aux coachs du club';
  end if;
  insert into coach_contacts(club_id, user_id, show_phone, show_sms, show_email, refused, updated_at, answered_at)
    values (p_club, auth.uid(), false, false, false, coalesce(p_on, false), now(), case when p_on then now() end)
    on conflict (club_id, user_id) do update set show_phone = false, show_sms = false, show_email = false,
      refused = coalesce(p_on, false), updated_at = now(), answered_at = case when p_on then now() end;
end $$;
revoke execute on function my_coach_contact(uuid), set_coach_contact(uuid, boolean, boolean, boolean), set_coach_refuse(uuid, boolean) from public, anon;
grant execute on function my_coach_contact(uuid), set_coach_contact(uuid, boolean, boolean, boolean), set_coach_refuse(uuid, boolean) to authenticated;

-- « Envoyer avec le correspondant » : choisi pour une rencontre par qui prépare la convocation
create table if not exists coach_contact_skips (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null,
  chosen_by uuid,
  chosen_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table coach_contact_skips enable row level security;
revoke all on coach_contact_skips from anon, authenticated;
create or replace function coach_contact_skip(p_event uuid, p_coach uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'Réservé à qui prépare la convocation'; end if;
  insert into coach_contact_skips(event_id, user_id, chosen_by) values (p_event, p_coach, auth.uid()) on conflict (event_id, user_id) do nothing;
end $$;
revoke execute on function coach_contact_skip(uuid, uuid) from public, anon;
grant execute on function coach_contact_skip(uuid, uuid) to authenticated;

-- « Relancer le coach » revient (une fois par jour et par coach, contrôlé dans la fonction de la 1.8.0)
grant execute on function coach_contact_remind(uuid, uuid) to authenticated;

-- La relance automatique à 24 h reste : une seule, même si quelqu'un a relancé à la main entre-temps
create or replace function coach_contact_relance() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select a.club_id, a.user_id from coach_contact_asks a
           group by a.club_id, a.user_id
           having count(*) filter (where a.asked_by is null) = 0 and min(a.asked_at) <= now() - interval '24 hours' and min(a.asked_at) > now() - interval '30 days' loop
    if coach_answered(r.club_id, r.user_id) then continue; end if;
    if not exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = r.user_id and m.role = 'coach' and m.status = 'active') then continue; end if;
    insert into coach_contact_asks(club_id, user_id, asked_by) values (r.club_id, r.user_id, null);
    perform push_enqueue(r.user_id, 'Rappel : tes coordonnées pour les convocations',
      'Tes convocations attendent ton choix. Choisis une fois ce que les clubs reçus verront de toi, ou refuse.',
      'coachcontact', 'coachcontact:' || r.club_id || ':' || r.user_id || ':auto', './#ouvrir=' || r.club_id || '.contact');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function coach_contact_relance() from public, anon, authenticated;

-- La convocation donne aussi le refus, le choix « avec le correspondant » et la dernière demande
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
                    'refused', coalesce(k.refused, false),
                    'skip', exists(select 1 from coach_contact_skips s where s.event_id = x.id and s.user_id = m.user_id),
                    'asked_at', (select min(a.asked_at) from coach_contact_asks a where a.club_id = m.club_id and a.user_id = m.user_id),
                    'last_at', (select max(a.asked_at) from coach_contact_asks a where a.club_id = m.club_id and a.user_id = m.user_id),
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
