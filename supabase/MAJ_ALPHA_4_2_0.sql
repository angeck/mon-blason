-- MAJ_ALPHA_4_2_0.sql · mypocketclub · n° 117 (masquer l'entente), n° 122 (contact du club selon la fonction), n° 114 (compteur « Payer »), n° 80 (durée des séances), n° 112, 109, 107 (envoi et suivi des convocations) · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.10.0 ; rien n'était à lancer pour la 4.1.0).
-- Sans perte de données, relançable sans risque.

-- mypocketclub · alpha 4.2.0 · mise à jour d'une base 4.1.0 (= 3.10.0 pour la base), sans perte de données, relançable.
-- N° 117 : masquer l'invitation « Équipe en entente ? » (par équipe, pour tous ses coachs, réversible).
-- N° 122 : contact du club selon la fonction attribuée par le président (licences : désigné, sinon le secrétaire, sinon le président ;
--          rencontres : désigné, sinon le président) ; coordonnées montrées seulement si la personne les a confirmées pour ses fonctions
--          du moment ; « Écrire au correspondant » par l'application, avec une limite d'envois ; qui voit quoi (membres, supporteurs,
--          visiteurs connectés, clubs du même sport) ; cases « Contact pour… » abandonnées.
-- N° 114 : compteur des touchers sur « Payer · Bientôt disponible ».
-- N° 80  : « Ajouter mes séances du mois » reprend la durée de chaque rendez-vous.
-- N° 112, 109, 107 : suivi des envois de convocations (e-mail et dans mypocketclub), versions -v2, accusé de lecture, échec signalé.

-- ---------------------------------------------------------------------
-- 1. N° 117 · masquer l'invitation à l'entente
-- ---------------------------------------------------------------------
alter table teams add column if not exists partner_hidden boolean not null default false;

create or replace function set_partner_hidden(p_team uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null then raise exception 'Équipe introuvable'; end if;
  if not (coaches_team(p_team) or has_area(t.club_id, 'technique') or is_president(t.club_id)) then raise exception 'Réservé au coach de l''équipe, à la Technique et au président'; end if;
  update teams set partner_hidden = coalesce(p_hidden, false) where id = p_team;
  perform log_action(t.club_id, null, null, case when p_hidden then 'Invitation à l''entente masquée' else 'Invitation à l''entente réaffichée' end, jsonb_build_object('équipe', t.name));
end $$;
revoke execute on function set_partner_hidden(uuid, boolean) from public, anon;
grant execute on function set_partner_hidden(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. N° 122 · contact du club
-- ---------------------------------------------------------------------
alter table club_contacts add column if not exists confirmed_for text;
alter table club_contacts add column if not exists confirmed_at timestamptz;

-- Qui tient la responsabilité : la personne désignée par le président ; sinon la personne qui a la fonction (« Correspondant licences »,
-- « Correspondant rencontres ») ; sinon, pour les licences, le secrétaire (titulaire, pas l'adjoint) ; sinon le président.
create or replace function contact_holder(c uuid, r text) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.user_id from club_designations d join memberships m on m.club_id = d.club_id and m.user_id = d.user_id and m.status = 'active' and m.role in ('bureau','president')
      where d.club_id = c and d.resp = r limit 1),
    -- la personne qui a reçu la fonction du président (« Correspondant licences » ou « Correspondant rencontres »)
    (select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'bureau'
      and m.fonction = case r when 'licences' then 'Correspondant licences' when 'rencontres' then 'Correspondant rencontres' end order by m.created_at limit 1),
    case when r = 'licences' then (select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'bureau' and m.fonction = 'Secrétaire' order by m.created_at limit 1) end,
    (select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'president' order by m.created_at limit 1));
$$;
revoke execute on function contact_holder(uuid, text) from public, anon;

-- Fonctions d'une personne qui font d'elle un contact (le choix des coordonnées est attaché à cette liste)
create or replace function contact_roles(c uuid, u uuid) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x order by x), '{}'::text[]) from (
    select 'Président' x from memberships where club_id = c and user_id = u and status = 'active' and role = 'president'
    union select coalesce(nullif(fonction, ''), 'Membre du bureau') from memberships where club_id = c and user_id = u and status = 'active' and role = 'bureau'
    union select 'Correspondant licences' where contact_holder(c, 'licences') = u
    union select 'Correspondant rencontres' where contact_holder(c, 'rencontres') = u) z;
$$;
revoke execute on function contact_roles(uuid, uuid) from public, anon;
create or replace function contact_sig(c uuid, u uuid) returns text language sql stable security definer set search_path = public as $$
  select array_to_string(contact_roles(c, u), '|');
$$;
revoke execute on function contact_sig(uuid, uuid) from public, anon;

-- Fiche d'un contact : coordonnées seulement si la personne les a confirmées pour ses fonctions du moment
create or replace function contact_person(c uuid, u uuid, f text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user_id', u, 'name', trim(p.first_name || ' ' || p.last_name), 'fonction', coalesce(f, array_to_string(contact_roles(c, u), ', ')),
    'phone', case when k.confirmed_for = contact_sig(c, u) and k.show_phone then nullif(p.phone, '') end,
    'email', case when k.confirmed_for = contact_sig(c, u) and k.show_email then us.email::text end,
    'confirmed', coalesce(k.confirmed_for = contact_sig(c, u), false))
  from profiles p join auth.users us on us.id = p.id left join club_contacts k on k.club_id = c and k.user_id = u
  where p.id = u and p.deleted_at is null;
$$;
revoke execute on function contact_person(uuid, uuid, text) from public, anon;

-- Ce que je vois dans « Contacter le club » (tableau validé par Gaël le 4 novembre 2026 à 23 h 13)
create or replace function contact_card(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); cl clubs; inside boolean; supp boolean; same boolean; res jsonb := '{}'::jsonb; lic uuid; ren uuid;
begin
  if me is null then return null; end if;                                         -- visiteur non connecté : aucun contact
  select * into cl from clubs where id = p_club;
  if cl.id is null or cl.deleted_at is not null then return null; end if;
  inside := exists(select 1 from memberships where club_id = p_club and user_id = me and status = 'active' and role <> 'supporteur');
  supp := not inside and exists(select 1 from memberships where club_id = p_club and user_id = me);   -- supporteur, ou membre en attente de validation
  if not inside and not supp and not cl.public_listed then return null; end if;   -- club hors recherche : rien pour l'extérieur
  same := not inside and exists(select 1 from memberships m join clubs o on o.id = m.club_id
    where m.user_id = me and m.status = 'active' and m.role in ('president','bureau','coach') and m.club_id <> p_club and o.deleted_at is null and o.sport = cl.sport);
  lic := contact_holder(p_club, 'licences'); ren := contact_holder(p_club, 'rencontres');
  res := jsonb_build_object('view', case when inside then 'membre' when supp then 'supporteur' when same then 'club' else 'visiteur' end,
    'can_write', is_member(p_club));
  if lic is not null then res := res || jsonb_build_object('licences', contact_person(p_club, lic, 'Correspondant licences')); end if;
  if (inside or same) and ren is not null then res := res || jsonb_build_object('rencontres', contact_person(p_club, ren, 'Correspondant rencontres')); end if;
  if inside then
    res := res || jsonb_build_object('bureau', coalesce((select jsonb_agg(contact_person(p_club, u, null) order by r desc, n)
      from (select distinct m.user_id u, member_rank(p_club, m.user_id) r, (select full_name from profiles where id = m.user_id) n
            from memberships m where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau')) z), '[]'::jsonb));
  end if;
  return res;
end $$;
revoke execute on function contact_card(uuid) from public, anon;
grant execute on function contact_card(uuid) to authenticated;

-- Mon état : mes fonctions du moment et mon choix (encart jaune de l'Accueil tant que ce n'est pas confirmé)
create or replace function my_contact_state(p_club uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when cardinality(contact_roles(p_club, auth.uid())) = 0 then null else jsonb_build_object(
    'roles', to_jsonb(contact_roles(p_club, auth.uid())),
    'confirmed', coalesce((select k.confirmed_for = contact_sig(p_club, auth.uid()) from club_contacts k where k.club_id = p_club and k.user_id = auth.uid()), false),
    'show_phone', coalesce((select k.show_phone from club_contacts k where k.club_id = p_club and k.user_id = auth.uid()), false),
    'show_email', coalesce((select k.show_email from club_contacts k where k.club_id = p_club and k.user_id = auth.uid()), false)) end;
$$;
revoke execute on function my_contact_state(uuid) from public, anon;
grant execute on function my_contact_state(uuid) to authenticated;

-- Je confirme ce que je montre (téléphone, e-mail, les deux ou rien) pour toutes mes fonctions du moment
create or replace function confirm_contact(p_club uuid, p_phone boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s text := contact_sig(p_club, auth.uid());
begin
  if auth.uid() is null or s = '' then raise exception 'Réservé aux personnes qui ont une fonction au club'; end if;
  insert into club_contacts(club_id, user_id, show_phone, show_email, confirmed_for, confirmed_at, updated_at, for_licence, for_matches)
    values (p_club, auth.uid(), coalesce(p_phone, false), coalesce(p_email, false), s, now(), now(), false, false)
    on conflict (club_id, user_id) do update set show_phone = excluded.show_phone, show_email = excluded.show_email,
      confirmed_for = excluded.confirmed_for, confirmed_at = now(), updated_at = now(), for_licence = false, for_matches = false;
  perform log_action(p_club, auth.uid(), null, 'coordonnées du contact confirmées', jsonb_build_object('téléphone', coalesce(p_phone, false), 'e-mail', coalesce(p_email, false), 'fonctions', s));
end $$;
revoke execute on function confirm_contact(uuid, boolean, boolean) from public, anon;
grant execute on function confirm_contact(uuid, boolean, boolean) to authenticated;

-- « Écrire au correspondant » : un groupe d'échange à deux, réutilisé ; au plus 5 nouvelles conversations par personne et par jour
create or replace function message_contact(p_club uuid, p_resp text) returns uuid
language plpgsql security definer set search_path = public as $$
declare who uuid; gid uuid; me_name text; lab text;
begin
  if not is_member(p_club) then raise exception 'Rejoins le club (même comme supporteur) pour lui écrire'; end if;
  if p_resp not in ('licences','rencontres','president') then raise exception 'Contact inconnu'; end if;
  who := case when p_resp = 'president' then (select m.user_id from memberships m where m.club_id = p_club and m.status = 'active' and m.role = 'president' order by m.created_at limit 1)
              else contact_holder(p_club, p_resp) end;
  if who is null then raise exception 'Ce club n''a pas encore de contact'; end if;
  if who = auth.uid() then raise exception 'C''est toi le contact'; end if;
  lab := case p_resp when 'licences' then 'Message au correspondant licences' when 'rencontres' then 'Message au correspondant rencontres' else 'Message au président' end;
  select g.id into gid from groups g where g.club_id = p_club and g.created_by = auth.uid() and g.name like lab || '%'
    and exists(select 1 from group_members x where x.group_id = g.id and x.user_id = who) limit 1;
  if gid is not null then return gid; end if;
  if (select count(*) from groups g where g.created_by = auth.uid() and g.name like 'Message au %' and g.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Tu as déjà ouvert 5 conversations aujourd''hui : réessaie demain';
  end if;
  select full_name into me_name from profiles where id = auth.uid();
  insert into groups(club_id, name, created_by) values (p_club, lab || ' · ' || coalesce(me_name, 'membre'), auth.uid()) returning id into gid;
  insert into group_members(group_id, user_id) values (gid, auth.uid()), (gid, who) on conflict do nothing;
  perform push_enqueue(who, lab, coalesce(me_name, 'Un membre') || ' t''écrit', 'message', 'contact:' || gid);
  return gid;
end $$;
revoke execute on function message_contact(uuid, text) from public, anon;
grant execute on function message_contact(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 114 · compteur des touchers sur « Payer · Bientôt disponible » (un par personne, par jour)
-- ---------------------------------------------------------------------
create table if not exists feature_taps (
  feature text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid references clubs(id) on delete cascade,
  day date not null default current_date,
  primary key (feature, user_id, day)
);
alter table feature_taps enable row level security;
create or replace function tap_feature(p_feature text, p_club uuid) returns void
language sql security definer set search_path = public as $$
  insert into feature_taps(feature, user_id, club_id) select left(p_feature, 40), auth.uid(), p_club where auth.uid() is not null on conflict do nothing;
$$;
revoke execute on function tap_feature(text, uuid) from public, anon;
grant execute on function tap_feature(text, uuid) to authenticated;
create or replace function feature_tap_counts() returns table(feature text, people bigint, clubs bigint, last_day date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select f.feature, count(distinct f.user_id), count(distinct f.club_id), max(f.day) from feature_taps f group by f.feature order by 2 desc;
end $$;
revoke execute on function feature_tap_counts() from public, anon;
grant execute on function feature_tap_counts() to authenticated;

-- ---------------------------------------------------------------------
-- 4. N° 80 · « Ajouter mes séances du mois » avec la durée de chaque rendez-vous
-- ---------------------------------------------------------------------
create or replace function fill_coach_hours(p_club uuid, p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; n int;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  if month_locked(p_club, auth.uid(), m) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  insert into coach_hours(club_id, user_id, team_id, event_id, day, minutes, kind)
    select p_club, auth.uid(), (select t from unnest(e.team_ids) t where coaches_team(t) limit 1), e.id, (e.starts_at at time zone 'Europe/Paris')::date,
      coalesce(case when e.all_day then null else e.duration_min end, case e.type when 'Entraînement' then 90 when 'Match' then 120 when 'Plateau' then 180 else 240 end), e.type
    from events e
    where e.club_id = p_club and not e.cancelled and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
      and e.starts_at >= m and e.starts_at < (m + interval '1 month') and e.starts_at < now()
      and not exists(select 1 from coach_hours h where h.user_id = auth.uid() and h.event_id = e.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. N° 112, 109, 107 · envoi des convocations et suivi dans le rendez-vous
-- ---------------------------------------------------------------------
-- Le correspondant affiché sur la convocation = le correspondant rencontres (n° 122), avec ses coordonnées confirmées
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
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'color1', c.color1, 'color2', c.color2, 'logo', c.logo, 'crest_bg', c.crest_bg),
    'from', d0, 'to', d1,
    'correspondent', case when ren is null then null else (select jsonb_build_object('name', x->>'name', 'phone', x->>'phone', 'email', x->>'email') from (select contact_person(c.id, ren, 'Correspondant rencontres') x) z) end,
    'sender', (select jsonb_build_object('name', trim(p.first_name || ' ' || p.last_name), 'email', u.email) from profiles p join auth.users u on u.id = p.id where p.id = auth.uid()),
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

create table if not exists convocation_sends (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  ref text not null,                      -- référence du week-end (« BB-20261114-C »), sans le -v2
  step text not null check (step in ('P','C')),
  version int not null default 1,         -- 1, puis 2 (-v2) quand le document a changé depuis le dernier envoi
  doc_hash text not null default '',
  channel text not null check (channel in ('email','app')),
  target_club_id uuid references clubs(id) on delete set null,
  target_name text not null default '',   -- nom du club reçu
  target_hint text not null default '',   -- adresse masquée (j***@exemple.fr) : le contact saisi n'est pas gardé (décision du 5 novembre 2026)
  status text not null default 'envoye' check (status in ('envoye','echec','lu')),
  error text not null default '',
  payload jsonb,                          -- envoi dans mypocketclub : le document tel qu'il a été envoyé
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid references auth.users(id) on delete set null
);
create index if not exists convocation_sends_ref on convocation_sends(club_id, ref, step);
create index if not exists convocation_sends_target on convocation_sends(target_club_id) where target_club_id is not null;
alter table convocation_sends enable row level security;   -- lecture et écriture seulement par les fonctions ci-dessous

-- Peut recevoir les convocations d'un club dans mypocketclub : rubrique Événements, ou correspondant rencontres
create or replace function receives_convocations(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select has_area(c, 'evenements') or contact_holder(c, 'rencontres') = auth.uid();
$$;
revoke execute on function receives_convocations(uuid) from public, anon;

-- Avant l'envoi : numéro de version du document et limites du jour (Resend gratuit : 100 e-mails par jour pour tout mypocketclub)
create or replace function convocation_prepare(p_event uuid, p_step text, p_ref text, p_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events; v int; h text; today_club int; today_all int;
begin
  select * into e from events where id = p_event;
  if e.id is null or not has_area(e.club_id, 'evenements') then raise exception 'Réservé au correspondant rencontres, au vice-président et au président'; end if;
  select version, doc_hash into v, h from convocation_sends where club_id = e.club_id and ref = p_ref and step = p_step and status <> 'echec' order by version desc, sent_at desc limit 1;
  select count(*) into today_club from convocation_sends where club_id = e.club_id and channel = 'email' and status <> 'echec' and sent_at > now() - interval '1 day';
  select count(*) into today_all from convocation_sends where channel = 'email' and status <> 'echec' and sent_at > now() - interval '1 day';
  return jsonb_build_object('version', case when v is null then 1 when h is distinct from coalesce(p_hash, '') then v + 1 else v end,
    'email_left', greatest(0, least(20 - today_club, 80 - today_all)));
end $$;
revoke execute on function convocation_prepare(uuid, text, text, text) from public, anon;
grant execute on function convocation_prepare(uuid, text, text, text) to authenticated;

-- Après l'envoi (ou l'échec) : une ligne dans le suivi du rendez-vous ; l'échec prévient la personne ; l'envoi dans mypocketclub prévient le club reçu
create or replace function convocation_record(p_event uuid, p_step text, p_ref text, p_version int, p_hash text, p_channel text,
  p_target_club uuid, p_target_name text, p_target_hint text, p_status text, p_error text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e events; sid uuid; cn text; u uuid; lab text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not has_area(e.club_id, 'evenements') then raise exception 'Réservé au correspondant rencontres, au vice-président et au président'; end if;
  if p_channel not in ('email','app') or p_status not in ('envoye','echec') or p_step not in ('P','C') then raise exception 'Envoi inconnu'; end if;
  if p_channel = 'app' then
    if p_target_club is null or p_target_club = e.club_id or not exists(select 1 from clubs where id = p_target_club and deleted_at is null) then raise exception 'Choisis un autre club inscrit'; end if;
    if p_payload is null then raise exception 'Document manquant'; end if;
  end if;
  if p_channel = 'email' and p_status = 'envoye' and (select count(*) from convocation_sends where channel = 'email' and status <> 'echec' and sent_at > now() - interval '1 day') >= 80 then
    raise exception 'Limite d''envois du jour atteinte : réessaie demain';
  end if;
  select name into cn from clubs where id = e.club_id;
  insert into convocation_sends(club_id, event_id, ref, step, version, doc_hash, channel, target_club_id, target_name, target_hint, status, error, payload, sent_by)
    values (e.club_id, p_event, left(p_ref, 40), p_step, greatest(1, coalesce(p_version, 1)), left(coalesce(p_hash, ''), 64), p_channel,
      case when p_channel = 'app' then p_target_club end,
      left(coalesce(case when p_channel = 'app' then (select name from clubs where id = p_target_club) end, p_target_name, ''), 80),
      left(coalesce(p_target_hint, ''), 80), p_status, left(coalesce(p_error, ''), 200), case when p_channel = 'app' then p_payload end, auth.uid())
    returning id into sid;
  lab := case when p_step = 'P' then 'Pré-convocation' else 'Convocation' end || case when coalesce(p_version, 1) > 1 then ' (mise à jour)' else '' end;
  perform log_action(e.club_id, null, null, case when p_status = 'echec' then 'convocation non envoyée' else 'convocation envoyée' end,
    jsonb_build_object('document', lab, 'référence', p_ref || case when coalesce(p_version, 1) > 1 then '-v' || p_version else '' end, 'canal', p_channel, 'club', p_target_name));
  if p_status = 'echec' then
    perform push_enqueue(auth.uid(), lab || ' non envoyée', 'L''e-mail n''est pas parti. Ouvre le rendez-vous et touche « Renvoyer ».', 'convocation', 'convfail:' || sid);
  elsif p_channel = 'app' then
    for u in select distinct m.user_id from memberships m where m.club_id = p_target_club and m.status = 'active' and m.role in ('president','bureau')
      and ('evenements' = any(areas_of(p_target_club, m.user_id)) or contact_holder(p_target_club, 'rencontres') = m.user_id) loop
      perform push_enqueue(u, lab || ' reçue', coalesce(cn, 'Un club') || ' vous a envoyé un document', 'convocation', 'convin:' || sid || ':' || u);
    end loop;
  end if;
  return sid;
end $$;
revoke execute on function convocation_record(uuid, text, text, int, text, text, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function convocation_record(uuid, text, text, int, text, text, uuid, text, text, text, text, jsonb) to authenticated;

-- Suivi dans le rendez-vous (côté club qui envoie) : tous les envois du week-end
create or replace function convocation_sends_of(p_event uuid) returns table(id uuid, step text, version int, channel text, target_name text, target_hint text,
  status text, error text, sent_at timestamptz, read_at timestamptz, sender text, ref text)
language plpgsql stable security definer set search_path = public as $$
declare e events; d date; d0 date; d1 date; dw int;
begin
  select * into e from events where events.id = p_event;
  if e.id is null or not has_area(e.club_id, 'evenements') then return; end if;
  d := (e.starts_at at time zone 'Europe/Paris')::date; dw := extract(isodow from d)::int;
  if dw >= 6 then d0 := d - (dw - 6); d1 := d0 + 1; else d0 := d; d1 := d; end if;
  return query select s.id, s.step, s.version, s.channel, s.target_name, s.target_hint, s.status, s.error, s.sent_at, s.read_at,
      (select trim(p.first_name || ' ' || p.last_name) from profiles p where p.id = s.sent_by), s.ref
    from convocation_sends s where s.club_id = e.club_id
      and (s.event_id = e.id or s.event_id in (select x.id from events x where x.club_id = e.club_id and (x.starts_at at time zone 'Europe/Paris')::date between d0 and d1))
    order by s.sent_at desc;
end $$;
revoke execute on function convocation_sends_of(uuid) from public, anon;
grant execute on function convocation_sends_of(uuid) to authenticated;

-- Convocations reçues dans mypocketclub (côté club reçu)
create or replace function convocations_received(p_club uuid) returns table(id uuid, from_club text, step text, version int, ref text, sent_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not receives_convocations(p_club) then return; end if;
  return query select s.id, (select c.name from clubs c where c.id = s.club_id), s.step, s.version, s.ref, s.sent_at, s.read_at
    from convocation_sends s where s.target_club_id = p_club and s.channel = 'app' and s.sent_at > now() - interval '120 days' order by s.sent_at desc limit 30;
end $$;
revoke execute on function convocations_received(uuid) from public, anon;
grant execute on function convocations_received(uuid) to authenticated;

-- Ouvrir une convocation reçue : le document, et l'accusé de lecture pour le club qui l'a envoyée (une fois)
create or replace function convocation_open(p_send uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; cn text;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' then raise exception 'Document introuvable'; end if;
  if not receives_convocations(s.target_club_id) then
    if has_area(s.club_id, 'evenements') then return jsonb_build_object('step', s.step, 'version', s.version, 'data', s.payload); end if;
    raise exception 'Document réservé au correspondant rencontres du club reçu';
  end if;
  if s.read_at is null then
    update convocation_sends set read_at = now(), read_by = auth.uid(), status = 'lu' where id = s.id;
    select name into cn from clubs where id = s.target_club_id;
    if s.sent_by is not null then
      perform push_enqueue(s.sent_by, 'Convocation lue', coalesce(cn, 'Le club reçu') || ' a ouvert ' || case when s.step = 'P' then 'la pré-convocation' else 'la convocation' end, 'convocation', 'convread:' || s.id);
    end if;
  end if;
  return jsonb_build_object('step', s.step, 'version', s.version, 'data', s.payload);
end $$;
revoke execute on function convocation_open(uuid) from public, anon;
grant execute on function convocation_open(uuid) to authenticated;

-- L'envoi échoué ou ancien peut être supprimé du suivi par la personne qui l'a fait (rien d'autre ne s'efface)
create or replace function convocation_forget(p_send uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from convocation_sends where id = p_send and sent_by = auth.uid() and status = 'echec';
end $$;
revoke execute on function convocation_forget(uuid) from public, anon;
grant execute on function convocation_forget(uuid) to authenticated;

select 'mypocketclub alpha 4.2.0 installée' as resultat;
