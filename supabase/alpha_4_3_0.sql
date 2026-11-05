-- mypocketclub · alpha 4.3.0 · mise à jour d'une base 4.2.0, sans perte de données, relançable.
-- Audit de sécurité du 5 novembre 2026 (document « 09 audit securite 2026 11 05 » du projet) :
-- N° 123 (S2) : delete_announcement, trash_exercise, remind_event refusent le visiteur et l'inconnu (correctif du 5 novembre repris ici,
--               pour qu'une mise à jour ne le défasse jamais).
-- N° 124 (S1) : envoi des convocations (e-mail et dans mypocketclub) réservé aux personnes validées : le président est validé par
--               l'administrateur (décision de Gaël, 5 novembre 2026, 13 h 26 : la validation porte sur la personne et son rôle) ;
--               une autre fonction (correspondant rencontres…) est validée par l'attribution d'un président validé ;
--               chaque e-mail est réservé dans la base avant de partir (limite de 20 par club et 80 en tout par jour, enfin contraignante) ;
--               fin d'une année payée ou d'une gratuité : pas de blocage, un encart rouge (my_send_state) ; écran « Clubs à valider ».
-- N° 129 : plusieurs destinataires ; « PDF » = envoyé à la main, noté dans le suivi.
-- N° 126 (S4) : fonctions fermées au visiteur non connecté (sauf la recherche, la page publique, la demande de club, et les
--               fonctions dont les règles d'accès ont besoin) ; liste des profils de test rangée dans la base (plus dans config.js).
-- À LA FIN DE CHAQUE FUTURE MISE À JOUR : « select close_visitor_functions(); » (une nouvelle fonction est ouverte au visiteur par Supabase).

-- ---------------------------------------------------------------------
-- 1. N° 123 · S2 · trois fonctions refusent le visiteur et l'inconnu
--    Avant : « not (auteur = moi or …) » donnait « inconnu » sans connexion (ou quand l'auteur avait supprimé son compte),
--    et le refus ne se déclenchait pas.
-- ---------------------------------------------------------------------
create or replace function delete_announcement(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  if auth.uid() is null then raise exception 'Connexion demandée'; end if;
  select * into a from announcements where id = p_id and deleted_at is null;
  if a.id is null or not coalesce(a.created_by = auth.uid() or has_area(a.club_id, 'communication'), false) then raise exception 'Suppression impossible'; end if;
  update announcements set deleted_at = now() where id = p_id;
end $$;
revoke execute on function delete_announcement(uuid) from public, anon;
grant execute on function delete_announcement(uuid) to authenticated;

create or replace function trash_exercise(p_id uuid, p_restore boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare e exercises;
begin
  if auth.uid() is null then raise exception 'Connexion demandée'; end if;
  select * into e from exercises where id = p_id;
  if e.id is null or not coalesce(e.created_by = auth.uid() or (e.sharing <> 'me' and is_board(e.club_id)), false) then raise exception 'Suppression impossible'; end if;
  perform set_config('pc.exsys', 'on', true);
  if p_restore then update exercises set deleted_at = null, deleted_by = null where id = p_id;
  else update exercises set deleted_at = now(), deleted_by = auth.uid() where id = p_id and deleted_at is null; end if;
  perform set_config('pc.exsys', 'off', true);
end $$;
revoke execute on function trash_exercise(uuid, boolean) from public, anon;
grant execute on function trash_exercise(uuid, boolean) to authenticated;

create or replace function remind_event(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; who uuid[];
begin
  if auth.uid() is null then raise exception 'Connexion demandée'; end if;
  select * into e from events where id = p_event;
  if e.id is null or not coalesce(can_manage_event(p_event) or e.created_by = auth.uid(), false) then raise exception 'Seul l''organisateur relance'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est passé ou annulé'; end if;
  if e.reminded_at > now() - interval '12 hours' then raise exception 'Relance déjà faite il y a moins de 12 heures'; end if;
  who := event_missing(p_event);
  if cardinality(who) = 0 then return 0; end if;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, event_id, title, body)
    values (e.club_id, 'people', who, 'relance', e.id, 'Rappel : ta réponse est attendue',
            e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '. Réponds « Je viens » ou « Je ne viens pas ».');
  perform set_config('pc.remind', 'on', true);
  update events set reminded_at = now() where id = p_event;
  perform set_config('pc.announce', 'off', true); perform set_config('pc.remind', 'off', true);
  return cardinality(who);
end $$;
revoke execute on function remind_event(uuid) from public, anon;
grant execute on function remind_event(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. N° 124 · validation des personnes qui envoient
-- ---------------------------------------------------------------------
-- Une ligne = un président validé par l'administrateur, pour un club. Motif : payé, devis accepté, gratuité (avec sa date de fin), test.
create table if not exists sender_validations (
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('paye','devis','gratuite','test')),
  ends_at date,                          -- fin de l'année payée ou de la gratuité : encart rouge à partir de ce jour (pas de blocage)
  note text not null default '' check (length(note) <= 300),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table sender_validations enable row level security;   -- aucune règle : lecture et écriture seulement par les fonctions ci-dessous

create or replace function president_validated(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from sender_validations v join memberships m on m.club_id = v.club_id and m.user_id = v.user_id and m.role = 'president' and m.status = 'active'
    where v.club_id = c and v.user_id = u);
$$;
revoke execute on function president_validated(uuid, uuid) from public, anon, authenticated;

-- Peut envoyer les convocations (par e-mail ou dans mypocketclub) : rubrique Événements, et
--   président : validé par l'administrateur ;
--   autre personne (vice-président, correspondant rencontres…) : sa fonction vient d'un président validé (le président du club l'est).
create or replace function can_send_convocations(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and has_area(c, 'evenements') and case
    when is_president(c) then president_validated(c, auth.uid())
    else exists(select 1 from memberships m where m.club_id = c and m.role = 'president' and m.status = 'active' and president_validated(c, m.user_id)) end;
$$;
revoke execute on function can_send_convocations(uuid) from public, anon;
grant execute on function can_send_convocations(uuid) to authenticated;

-- Mon état d'envoi (boutons grisés, encart rouge) : seulement pour le président et les personnes qui ont la rubrique Événements
create or replace function my_send_state(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pres uuid; v sender_validations;
begin
  if auth.uid() is null or not (is_president(p_club) or has_area(p_club, 'evenements')) then return null; end if;
  select m.user_id into pres from memberships m where m.club_id = p_club and m.role = 'president' and m.status = 'active' order by m.created_at limit 1;
  select * into v from sender_validations where club_id = p_club and user_id = pres;
  return jsonb_build_object('can_send', can_send_convocations(p_club), 'validated', v.user_id is not null, 'me_president', pres is not distinct from auth.uid(),
    'reason', v.reason, 'ends_at', v.ends_at, 'period_over', coalesce(v.ends_at <= current_date, false));
end $$;
revoke execute on function my_send_state(uuid) from public, anon;
grant execute on function my_send_state(uuid) to authenticated;

-- Écran « Clubs à valider » (administrateur) : chaque club, son président et sa validation
create or replace function admin_clubs() returns table(club_id uuid, name text, city text, sport text, color1 text, color2 text, logo text, crest_bg text,
  created_at timestamptz, president_id uuid, president_name text, president_email text, members bigint, reason text, ends_at date, note text, validated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select c.id, c.name, c.city, c.sport, c.color1, c.color2, c.logo, c.crest_bg, c.created_at, p.user_id,
      nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''), u.email::text,
      (select count(distinct m.user_id) from memberships m where m.club_id = c.id and m.status = 'active'), v.reason, v.ends_at, v.note, v.validated_at
    from clubs c
    left join lateral (select m.user_id from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active' order by m.created_at limit 1) p on true
    left join profiles pr on pr.id = p.user_id
    left join auth.users u on u.id = p.user_id
    left join sender_validations v on v.club_id = c.id and v.user_id = p.user_id
    where c.deleted_at is null
    order by (v.user_id is null) desc, c.created_at desc;
end $$;
revoke execute on function admin_clubs() from public, anon;
grant execute on function admin_clubs() to authenticated;

create or replace function admin_validate_sender(p_club uuid, p_user uuid, p_reason text, p_ends date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare cn text;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_reason not in ('paye','devis','gratuite','test') then raise exception 'Motif inconnu'; end if;
  if p_reason = 'gratuite' and p_ends is null then raise exception 'Indique la date de fin de la gratuité'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and role = 'president' and status = 'active') then raise exception 'Cette personne n''est pas présidente de ce club'; end if;
  insert into sender_validations(club_id, user_id, reason, ends_at, note, validated_by, validated_at)
    values (p_club, p_user, p_reason, p_ends, left(coalesce(p_note, ''), 300), auth.uid(), now())
    on conflict (club_id, user_id) do update set reason = excluded.reason, ends_at = excluded.ends_at, note = excluded.note, validated_by = excluded.validated_by, validated_at = now();
  select name into cn from clubs where id = p_club;
  perform log_action(p_club, p_user, null, 'envoi des convocations ouvert par mypocketclub', jsonb_build_object('motif', p_reason, 'fin', p_ends));
  perform push_enqueue(p_user, 'Envoi des convocations ouvert', coalesce(cn, 'Ton club') || ' peut envoyer ses convocations par e-mail et dans mypocketclub', 'admin', 'presok:' || p_club || ':' || p_user);
end $$;
revoke execute on function admin_validate_sender(uuid, uuid, text, date, text) from public, anon;
grant execute on function admin_validate_sender(uuid, uuid, text, date, text) to authenticated;

create or replace function admin_unvalidate_sender(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from sender_validations where club_id = p_club and user_id = p_user;
  if found then perform log_action(p_club, p_user, null, 'envoi des convocations fermé par mypocketclub', '{}'::jsonb); end if;
end $$;
revoke execute on function admin_unvalidate_sender(uuid, uuid) from public, anon;
grant execute on function admin_unvalidate_sender(uuid, uuid) to authenticated;

-- Nouveau président (club créé, présidence transférée) : l'administrateur est prévenu s'il n'est pas validé.
-- La validation suit la personne dans son rôle : elle s'efface quand la personne n'est plus présidente.
create or replace function memberships_president_watch() returns trigger
language plpgsql security definer set search_path = public as $$
declare a uuid; cn text; nm text;
begin
  if tg_op in ('UPDATE','DELETE') and old.role = 'president' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'president' or new.status <> 'active' or new.user_id <> old.user_id) then
    delete from sender_validations where club_id = old.club_id and user_id = old.user_id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.role = 'president' and new.status = 'active'
     and (tg_op = 'INSERT' or old.role <> 'president' or old.status <> 'active')
     and not exists(select 1 from sender_validations where club_id = new.club_id and user_id = new.user_id) then
    select name into cn from clubs where id = new.club_id;
    select full_name into nm from profiles where id = new.user_id;
    for a in select user_id from app_admins loop
      perform push_enqueue(a, 'Président à valider', coalesce(cn, 'Un club') || ' · ' || coalesce(nm, 'nouveau président'), 'admin', 'presval:' || new.club_id || ':' || new.user_id, './');
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists memberships_president_watch on memberships;
create trigger memberships_president_watch after insert or update of role, status, user_id or delete on memberships for each row execute function memberships_president_watch();

-- ---------------------------------------------------------------------
-- 3. N° 124 · chaque e-mail est réservé dans la base avant de partir
--    La fonction envoyer-email appelle convocation_reserve (vérification et réservation en une seule opération), puis Resend,
--    puis convocation_finish. Toutes les tentatives d'e-mail comptent dans la limite, même ratées : un envoi déclaré « raté »
--    ne libère pas de place (sinon la limite se contournerait).
-- ---------------------------------------------------------------------
alter table convocation_sends drop constraint if exists convocation_sends_status_check;
alter table convocation_sends add constraint convocation_sends_status_check check (status in ('en_cours','envoye','echec','lu'));
alter table convocation_sends drop constraint if exists convocation_sends_channel_check;
alter table convocation_sends add constraint convocation_sends_channel_check check (channel in ('email','app','pdf'));
create index if not exists convocation_sends_mail_day on convocation_sends(sent_at) where channel = 'email';

-- E-mails encore possibles aujourd'hui pour ce club (20 par club, 80 en tout : Resend gratuit = 100 par jour)
create or replace function email_left(c uuid) returns int language sql stable security definer set search_path = public as $$
  select greatest(0, least(
    20 - (select count(*) from convocation_sends where club_id = c and channel = 'email' and sent_at > now() - interval '1 day'),
    80 - (select count(*) from convocation_sends where channel = 'email' and sent_at > now() - interval '1 day')))::int;
$$;
revoke execute on function email_left(uuid) from public, anon, authenticated;

create or replace function convocation_prepare(p_event uuid, p_step text, p_ref text, p_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events; v int; h text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not has_area(e.club_id, 'evenements') then raise exception 'Réservé au correspondant rencontres, au vice-président et au président'; end if;
  select version, doc_hash into v, h from convocation_sends where club_id = e.club_id and ref = p_ref and step = p_step and status in ('envoye','lu') order by version desc, sent_at desc limit 1;
  return jsonb_build_object('version', case when v is null then 1 when h is distinct from coalesce(p_hash, '') then v + 1 else v end,
    'email_left', email_left(e.club_id), 'can_send', can_send_convocations(e.club_id));
end $$;
revoke execute on function convocation_prepare(uuid, text, text, text) from public, anon;
grant execute on function convocation_prepare(uuid, text, text, text) to authenticated;

create or replace function convocation_reserve(p_event uuid, p_step text, p_ref text, p_version int, p_hash text, p_hint text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e events; sid uuid;
begin
  select * into e from events where id = p_event;
  if e.id is null or not has_area(e.club_id, 'evenements') then raise exception 'Réservé au correspondant rencontres, au vice-président et au président'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'La convocation vaut pour un match, un plateau ou un tournoi'; end if;
  if p_step not in ('P','C') then raise exception 'Envoi inconnu'; end if;
  if not can_send_convocations(e.club_id) then raise exception 'Envoi réservé aux comptes validés par mypocketclub'; end if;
  perform pg_advisory_xact_lock(hashtext('mypocketclub:convocation_sends'));   -- deux envois en même temps ne dépassent pas la limite
  if email_left(e.club_id) <= 0 then raise exception 'Limite d''envois du jour atteinte : réessaie demain'; end if;
  insert into convocation_sends(club_id, event_id, ref, step, version, doc_hash, channel, target_name, target_hint, status, sent_by)
    values (e.club_id, p_event, left(coalesce(p_ref, ''), 40), p_step, greatest(1, coalesce(p_version, 1)), left(coalesce(p_hash, ''), 64), 'email', '', left(coalesce(p_hint, ''), 80), 'en_cours', auth.uid())
    returning id into sid;
  return sid;
end $$;
revoke execute on function convocation_reserve(uuid, text, text, int, text, text) from public, anon;
grant execute on function convocation_reserve(uuid, text, text, int, text, text) to authenticated;

create or replace function convocation_finish(p_send uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; lab text;
begin
  select * into s from convocation_sends where id = p_send for update;
  if s.id is null or s.sent_by is distinct from auth.uid() or s.channel <> 'email' or s.status <> 'en_cours' then raise exception 'Envoi introuvable'; end if;
  update convocation_sends set status = case when p_ok then 'envoye' else 'echec' end,
    error = case when p_ok then '' else left(coalesce(nullif(p_error, ''), 'e-mail non parti'), 200) end where id = s.id;
  lab := case when s.step = 'P' then 'Pré-convocation' else 'Convocation' end || case when s.version > 1 then ' (mise à jour)' else '' end;
  perform log_action(s.club_id, null, null, case when p_ok then 'convocation envoyée' else 'convocation non envoyée' end,
    jsonb_build_object('document', lab, 'référence', s.ref || case when s.version > 1 then '-v' || s.version else '' end, 'canal', 'email', 'contact', s.target_hint));
  if not p_ok then
    perform push_enqueue(s.sent_by, lab || ' non envoyée', 'L''e-mail n''est pas parti. Ouvre le rendez-vous et touche « Renvoyer ».', 'convocation', 'convfail:' || s.id);
  end if;
end $$;
revoke execute on function convocation_finish(uuid, boolean, text) from public, anon;
grant execute on function convocation_finish(uuid, boolean, text) to authenticated;

-- Envoi dans mypocketclub (réservé aux personnes validées) et PDF envoyé à la main (n° 129, libre : simple trace dans le suivi).
-- Les e-mails ne passent plus par ici (convocation_reserve et convocation_finish).
create or replace function convocation_record(p_event uuid, p_step text, p_ref text, p_version int, p_hash text, p_channel text,
  p_target_club uuid, p_target_name text, p_target_hint text, p_status text, p_error text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e events; sid uuid; cn text; u uuid; lab text;
begin
  select * into e from events where id = p_event;
  if e.id is null or not has_area(e.club_id, 'evenements') then raise exception 'Réservé au correspondant rencontres, au vice-président et au président'; end if;
  if p_channel = 'email' then raise exception 'Les e-mails passent par la fonction d''envoi'; end if;
  if p_channel not in ('app','pdf') or p_status <> 'envoye' or p_step not in ('P','C') then raise exception 'Envoi inconnu'; end if;
  if p_channel = 'app' then
    if not can_send_convocations(e.club_id) then raise exception 'Envoi réservé aux comptes validés par mypocketclub'; end if;
    if p_target_club is null or p_target_club = e.club_id or not exists(select 1 from clubs where id = p_target_club and deleted_at is null) then raise exception 'Choisis un autre club inscrit'; end if;
    if p_payload is null then raise exception 'Document manquant'; end if;
  end if;
  select name into cn from clubs where id = e.club_id;
  insert into convocation_sends(club_id, event_id, ref, step, version, doc_hash, channel, target_club_id, target_name, target_hint, status, error, payload, sent_by)
    values (e.club_id, p_event, left(p_ref, 40), p_step, greatest(1, coalesce(p_version, 1)), left(coalesce(p_hash, ''), 64), p_channel,
      case when p_channel = 'app' then p_target_club end,
      left(coalesce(case when p_channel = 'app' then (select name from clubs where id = p_target_club) end, p_target_name, ''), 80),
      left(coalesce(p_target_hint, ''), 80), 'envoye', '', case when p_channel = 'app' then p_payload end, auth.uid())
    returning id into sid;
  lab := case when p_step = 'P' then 'Pré-convocation' else 'Convocation' end || case when coalesce(p_version, 1) > 1 then ' (mise à jour)' else '' end;
  perform log_action(e.club_id, null, null, case when p_channel = 'pdf' then 'convocation envoyée à la main (PDF)' else 'convocation envoyée' end,
    jsonb_build_object('document', lab, 'référence', p_ref || case when coalesce(p_version, 1) > 1 then '-v' || p_version else '' end, 'canal', p_channel, 'club', coalesce(cn, '')));
  if p_channel = 'app' then
    for u in select distinct m.user_id from memberships m where m.club_id = p_target_club and m.status = 'active' and m.role in ('president','bureau')
      and ('evenements' = any(areas_of(p_target_club, m.user_id)) or contact_holder(p_target_club, 'rencontres') = m.user_id) loop
      perform push_enqueue(u, lab || ' reçue', coalesce(cn, 'Un club') || ' vous a envoyé un document', 'convocation', 'convin:' || sid || ':' || u);
    end loop;
  end if;
  return sid;
end $$;
revoke execute on function convocation_record(uuid, text, text, int, text, text, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function convocation_record(uuid, text, text, int, text, text, uuid, text, text, text, text, jsonb) to authenticated;

-- Les tentatives d'e-mail restent dans le suivi (elles comptent dans la limite) : on ne les efface plus
create or replace function convocation_forget(p_send uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from convocation_sends where id = p_send and sent_by = auth.uid() and status = 'echec' and channel <> 'email';
end $$;
revoke execute on function convocation_forget(uuid) from public, anon;
grant execute on function convocation_forget(uuid) to authenticated;

-- N° 128 : le contour du blason (réglage du club) part avec les données de la convocation, pour un blason identique à l'application dans le PDF
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

-- ---------------------------------------------------------------------
-- 4. N° 126 · liste des profils de test : dans la base, plus dans config.js (dépôt public)
--    Remplie à part par Gaël (script privé du projet, jamais dans le dépôt) ; lue seulement par un compte de la liste.
-- ---------------------------------------------------------------------
create table if not exists test_profiles (
  email text primary key check (email = lower(email)),
  label text not null check (length(label) between 1 and 40),
  position int not null default 0
);
alter table test_profiles enable row level security;
create or replace function my_test_profiles() returns table(label text, email text)
language sql stable security definer set search_path = public as $$
  select t.label, t.email from test_profiles t
  where exists(select 1 from auth.users u join test_profiles x on x.email = lower(u.email) where u.id = auth.uid())
  order by t.position, t.label;
$$;
revoke execute on function my_test_profiles() from public, anon;
grant execute on function my_test_profiles() to authenticated;

-- ---------------------------------------------------------------------
-- 5. N° 126 · S4 · fonctions fermées au visiteur non connecté
--    Supabase ouvre chaque nouvelle fonction au visiteur. On ne lui laisse que la recherche des clubs, la page publique,
--    la demande d'ajout d'un club, et les fonctions appelées par les règles d'accès (sans elles, une lecture par un visiteur
--    échouerait au lieu de ne rien renvoyer). due_for, grid_for et member_rank sont fermées dans tous les cas.
--    Les personnes connectées gardent exactement les mêmes droits.
-- ---------------------------------------------------------------------
create or replace function close_visitor_functions() returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare f record; n int := 0; pol text; svc boolean := exists(select 1 from pg_roles where rolname = 'service_role');
  keep text[] := array['public_search_clubs', 'public_club', 'request_club'];
  shut text[] := array['due_for', 'grid_for', 'member_rank'];
begin
  select coalesce(string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' '), '') into pol from pg_policies;
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) loop
    continue when not has_function_privilege('anon', f.oid, 'execute');
    continue when f.proname = any(keep);
    continue when not (f.proname = any(shut)) and pol ~ ('\m' || f.proname || '\(');
    if has_function_privilege('authenticated', f.oid, 'execute') then execute format('grant execute on function %s to authenticated', f.oid::regprocedure); end if;
    if svc and has_function_privilege('service_role', f.oid, 'execute') then execute format('grant execute on function %s to service_role', f.oid::regprocedure); end if;
    execute format('revoke execute on function %s from public, anon', f.oid::regprocedure);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function close_visitor_functions() from public, anon, authenticated;

select close_visitor_functions();
