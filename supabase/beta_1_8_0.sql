-- mypocketclub · bêta 1.8.0 « Contacts, prêts et fêtes » (Gaël, 25 novembre 2026 : 1.8.0 et 1.8.1 regroupées, site de test)
-- Script idempotent (se relance sans risque). Aucun « drop table », aucun « delete » de données des clubs.
--   n° 300 : le coach a « répondu » (une seule fois, pour toutes les convocations) ; relance du coach par notification
--            (une par personne et par jour) ; la convocation sait si le coach a répondu et quand il a été relancé.
--   n° 298 : chaque prêt prévient le président de l'autre club par e-mail (et par notification s'il est sur mypocketclub).
--            Hors mypocketclub : le coach (ou le bureau) saisit le prénom, le nom et l'e-mail du président.
--            Plafond : 1 e-mail de prêt par jour pour le club qui déclare, sauf un jour à 10 par saison, accordé par Gaël seul.
--            L'adresse saisie est gardée le temps du prêt, effacée à sa fin (ou à la saison suivante).
--   n° 296 : thèmes de fêtes (Noël, galette, carnaval, Saint-Patrick) : activés par l'administrateur avec une date de début
--            et une date de fin ; un rendez-vous coché « Appliquer le thème » garde ses couleurs après la fin.

-- =====================================================================
-- N° 300 · coordonnées du coach dans les convocations
-- =====================================================================
alter table coach_contacts add column if not exists answered_at timestamptz;
-- Les coachs qui avaient déjà enregistré un choix (1.7.0) ont répondu
update coach_contacts set answered_at = updated_at where answered_at is null;

create table if not exists coach_contact_asks (
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null,
  asked_by uuid,
  asked_at timestamptz not null default now()
);
create index if not exists coach_contact_asks_user on coach_contact_asks(club_id, user_id, asked_at desc);
alter table coach_contact_asks enable row level security;
revoke all on coach_contact_asks from anon, authenticated;

create or replace function my_coach_contact(p_club uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('show_phone', coalesce(k.show_phone, false), 'show_sms', coalesce(k.show_sms, false), 'show_email', coalesce(k.show_email, false),
    'answered', k.answered_at is not null)
  from (select 1) z left join coach_contacts k on k.club_id = p_club and k.user_id = auth.uid();
$$;
create or replace function set_coach_contact(p_club uuid, p_phone boolean, p_sms boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = auth.uid() and m.role = 'coach' and m.status = 'active') then
    raise exception 'Réservé aux coachs du club';
  end if;
  insert into coach_contacts(club_id, user_id, show_phone, show_sms, show_email, updated_at, answered_at)
    values (p_club, auth.uid(), coalesce(p_phone, false), coalesce(p_sms, false), coalesce(p_email, false), now(), now())
    on conflict (club_id, user_id) do update set show_phone = excluded.show_phone, show_sms = excluded.show_sms, show_email = excluded.show_email,
      updated_at = now(), answered_at = now();
end $$;
revoke execute on function my_coach_contact(uuid), set_coach_contact(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function my_coach_contact(uuid), set_coach_contact(uuid, boolean, boolean, boolean) to authenticated;

-- Le coach a-t-il répondu ? Oui s'il a enregistré un choix, ou s'il est lui-même le contact des rencontres (un seul choix : n° 300 e)
create or replace function coach_answered(p_club uuid, p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from coach_contacts k where k.club_id = p_club and k.user_id = p_user and k.answered_at is not null)
      or contact_holder(p_club, 'rencontres') = p_user;
$$;
revoke execute on function coach_answered(uuid, uuid) from public, anon, authenticated;

-- Relancer un coach (bouton de la convocation) : une demande par coach et par jour ; la notification ouvre Mon compte
create or replace function coach_contact_remind(p_event uuid, p_coach uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e events; cc uuid; me text; last timestamptz; d text;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'Réservé à qui prépare la convocation'; end if;
  select m.club_id into cc from memberships m where m.user_id = p_coach and m.role = 'coach' and m.status = 'active' and m.team_id = any(e.team_ids)
    and (m.club_id = e.club_id or exists(select 1 from unnest(e.team_ids) tt where entente_club(tt) = m.club_id)) limit 1;
  if cc is null then raise exception 'Ce coach n''entraîne pas une équipe de ce rendez-vous'; end if;
  if p_coach = auth.uid() then raise exception 'C''est toi : choisis dans Mon compte'; end if;
  if coach_answered(cc, p_coach) then raise exception 'Ce coach a déjà choisi ses coordonnées'; end if;
  select max(asked_at) into last from coach_contact_asks where club_id = cc and user_id = p_coach;
  if last >= date_trunc('day', now()) then raise exception 'Déjà relancé aujourd''hui (le %)', to_char(last at time zone 'Europe/Paris', 'DD/MM à HH24:MI'); end if;
  insert into coach_contact_asks(club_id, user_id, asked_by) values (cc, p_coach, auth.uid());
  select first_name || case when coalesce(last_name, '') <> '' then ' ' || left(last_name, 1) || '.' else '' end into me from profiles where id = auth.uid();
  d := to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM');
  perform push_enqueue(p_coach, 'Tes coordonnées pour les convocations',
    coalesce(me, 'Le club') || ' prépare la convocation du ' || d || ' : choisis ce que les clubs reçus verront de toi.',
    'coachcontact', 'coachcontact:' || cc || ':' || p_coach || ':' || to_char(now(), 'YYYYMMDD'), './#ouvrir=' || cc || '.contact');
  return now();
end $$;
revoke execute on function coach_contact_remind(uuid, uuid) from public, anon;
grant execute on function coach_contact_remind(uuid, uuid) to authenticated;

-- La convocation : pour chaque rencontre, le coach dit s'il a répondu, et quand il a été relancé (n° 300)
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
        -- n° 295 : seulement ce que le coach a choisi de partager (rien par défaut) ; coach du club partenaire compris (n° 78)
        -- n° 300 : « answered » (il a choisi, même « rien ») et la dernière relance ; son id sert au bouton « Notifier le coach »
        'coach', (select jsonb_build_object('name', p.full_name, 'id', m.user_id,
                    'phone', case when coalesce(k.show_phone, false) or coalesce(k.show_sms, false) then nullif(p.phone, '') end,
                    'sms_only', coalesce(k.show_sms, false) and not coalesce(k.show_phone, false),
                    'email', case when coalesce(k.show_email, false) then u.email::text end,
                    'answered', coach_answered(m.club_id, m.user_id),
                    'asked_at', (select max(a.asked_at) from coach_contact_asks a where a.club_id = m.club_id and a.user_id = m.user_id))
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

-- =====================================================================
-- N° 298 · e-mail au président de l'autre club pour chaque prêt
-- =====================================================================
alter table player_loans add column if not exists pres_first text check (pres_first is null or length(pres_first) <= 60);
alter table player_loans add column if not exists pres_last text check (pres_last is null or length(pres_last) <= 60);
alter table player_loans add column if not exists pres_email text check (pres_email is null or length(pres_email) <= 160);
alter table player_loans add column if not exists mail_status text check (mail_status is null or mail_status in ('a_envoyer','reserve','envoye','echec','bloque'));
alter table player_loans add column if not exists mail_at timestamptz;
alter table player_loans add column if not exists mail_error text check (mail_error is null or length(mail_error) <= 200);
create index if not exists player_loans_mail on player_loans(club_id, mail_at);

-- « Jour à 10 » : un par club et par saison, accordé par l'administrateur (Gaël seul, 24 et 25 novembre)
create table if not exists loan_mail_days (
  club_id uuid not null references clubs(id) on delete cascade,
  season text not null,
  day date not null,
  granted_at timestamptz not null default now(),
  primary key (club_id, season)
);
alter table loan_mail_days enable row level security;
revoke all on loan_mail_days from anon, authenticated;

alter table mail_log drop constraint if exists mail_log_kind_check;
alter table mail_log add constraint mail_log_kind_check check (kind in ('test', 'nouvel_appareil', 'invitation_parent', 'rappel_validation', 'attestation',
  'prevenance_inactif', 'information', 'recommandation', 'validation', 'pret'));

-- Plafond du jour pour un club : 1, ou 10 le jour accordé
create or replace function loan_mail_cap(p_club uuid) returns int language sql stable security definer set search_path = public as $$
  select case when exists(select 1 from loan_mail_days d where d.club_id = p_club and d.day = (now() at time zone 'Europe/Paris')::date) then 10 else 1 end;
$$;
create or replace function loan_mails_today(p_club uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from player_loans l where l.club_id = p_club and l.mail_status in ('reserve','envoye','echec')
    and l.mail_at >= ((now() at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris';
$$;
revoke execute on function loan_mail_cap(uuid), loan_mails_today(uuid) from public, anon, authenticated;

-- L'adresse saisie d'un président hors mypocketclub ne sert qu'au prêt : effacée à la fin du prêt ou de la saison
create or replace function loan_contacts_purge() returns void language sql security definer set search_path = public as $$
  update player_loans set pres_first = null, pres_last = null, pres_email = null
  where pres_email is not null and (ended_at is not null or season <> season_label(now()));
$$;
revoke execute on function loan_contacts_purge() from public, anon, authenticated;

create or replace function set_player_loan(p_player uuid, p_dir text, p_club uuid, p_name text, p_city text, p_pfirst text, p_plast text, p_pemail text) returns uuid
language plpgsql security definer set search_path = public as $$
declare x players; lid uuid; oname text; ocity text; u uuid; mine text; short text; ntc text := 'email';
  pf text := left(trim(coalesce(p_pfirst, '')), 60); pl text := left(trim(coalesce(p_plast, '')), 60); pe text := lower(trim(coalesce(p_pemail, '')));
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into x from players where id = p_player and deleted_at is null;
  if x.id is null or not can_loan_player(p_player) then raise exception 'Réservé au bureau et au coach de l''équipe du joueur'; end if;
  if p_dir not in ('sortant','entrant') then raise exception 'Sens du prêt inconnu'; end if;
  if p_club = x.club_id then raise exception 'Choisis un autre club que le tien'; end if;
  if p_club is not null then
    select name, city into oname, ocity from clubs where id = p_club and deleted_at is null;
    if oname is null then raise exception 'Club introuvable'; end if;
    ntc := 'mpc'; pf := null; pl := null; pe := null;   -- le président est connu : rien à saisir
  else
    oname := left(trim(coalesce(p_name, '')), 120); ocity := left(trim(coalesce(p_city, '')), 80);
    if length(oname) < 2 or ocity = '' then raise exception 'Nom et ville de l''autre club obligatoires'; end if;
    if pf = '' or pl = '' then raise exception 'Prénom et nom du président de l''autre club obligatoires'; end if;
    if pe !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' or length(pe) > 160 then raise exception 'E-mail du président à vérifier'; end if;
  end if;
  update player_loans set ended_at = now() where player_id = p_player and ended_at is null;
  perform loan_contacts_purge();
  select name into mine from clubs where id = x.club_id;
  short := x.first_name || case when coalesce(x.last_name, '') <> '' then ' ' || left(x.last_name, 1) || '.' else '' end;
  insert into player_loans(club_id, player_id, direction, other_club_id, other_name, other_city, notice, created_by, pres_first, pres_last, pres_email, mail_status)
    values (x.club_id, p_player, p_dir, p_club, oname, ocity, ntc, auth.uid(), pf, pl, pe, 'a_envoyer') returning id into lid;
  perform log_action(x.club_id, null, null, case p_dir when 'sortant' then 'Joueur prêté' else 'Joueur en prêt' end,
    jsonb_build_object('joueur', short, 'club', oname, 'saison', season_label(now())));
  if ntc = 'mpc' then
    for u in select m.user_id from memberships m where m.club_id = p_club and m.role = 'president' and m.status = 'active' loop
      perform push_enqueue(u, case p_dir when 'sortant' then 'Joueur prêté à votre club' else 'Joueur en prêt chez ' || left(mine, 40) end,
        short || ' · ' || mine || ' · saison ' || season_label(now()), 'pret:' || p_club, 'pret:' || lid);
    end loop;
  end if;
  return lid;   -- l'application demande ensuite l'envoi de l'e-mail (envoyer-email, loan_mail)
end $$;
revoke execute on function set_player_loan(uuid, text, uuid, text, text, text, text, text) from public, anon;
grant execute on function set_player_loan(uuid, text, uuid, text, text, text, text, text) to authenticated;
-- Ancienne application (5 arguments) : un club hors mypocketclub demande maintenant le contact de son président
create or replace function set_player_loan(p_player uuid, p_dir text, p_club uuid, p_name text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if p_club is null then raise exception 'Mets à jour l''application : le contact du président de l''autre club est maintenant demandé'; end if;
  return set_player_loan(p_player, p_dir, p_club, p_name, p_city, null, null, null);
end $$;
revoke execute on function set_player_loan(uuid, text, uuid, text, text) from public, anon;
grant execute on function set_player_loan(uuid, text, uuid, text, text) to authenticated;

create or replace function end_player_loan(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_loan_player(p_player) then raise exception 'Réservé au bureau et au coach de l''équipe du joueur'; end if;
  update player_loans set ended_at = now() where player_id = p_player and ended_at is null;
  perform loan_contacts_purge();
end $$;
revoke execute on function end_player_loan(uuid) from public, anon;
grant execute on function end_player_loan(uuid) to authenticated;

-- Prêts en cours du club, avec l'état de l'e-mail (jamais l'adresse saisie)
drop function if exists club_loans(uuid);
create or replace function club_loans(p_club uuid) returns table(id uuid, player_id uuid, direction text, other_club_id uuid, other_name text, season text, notice text,
  created_at timestamptz, mail_status text, mail_at timestamptz, mail_error text, pres_name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.player_id, l.direction, l.other_club_id, l.other_name, l.season, l.notice, l.created_at, l.mail_status, l.mail_at, l.mail_error,
    case when l.other_club_id is not null then (select p.first_name || ' ' || left(coalesce(p.last_name, ''), 1) || '.' from memberships m join profiles p on p.id = m.user_id
           where m.club_id = l.other_club_id and m.role = 'president' and m.status = 'active' order by m.created_at limit 1)
         else nullif(trim(coalesce(l.pres_first, '') || ' ' || coalesce(l.pres_last, '')), '') end
  from player_loans l where l.club_id = p_club and loan_active(l) and can_loan_player(l.player_id);
$$;
revoke execute on function club_loans(uuid) from public, anon;
grant execute on function club_loans(uuid) to authenticated;

-- Réserver l'envoi (appelée par envoyer-email avec le jeton de la personne) : droits, liste noire, plafond du club, limite du jour
create or replace function loan_mail_prepare(p_loan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l player_loans; x players; mine clubs; em text; pf text; cap int; n int; rep text; ren uuid; short text;
begin
  select * into l from player_loans where id = p_loan for update;
  if l.id is null or not loan_active(l) then raise exception 'Prêt introuvable ou terminé'; end if;
  if not can_loan_player(l.player_id) then raise exception 'Réservé au bureau et au coach de l''équipe du joueur'; end if;
  if l.mail_status = 'envoye' then raise exception 'L''e-mail de ce prêt est déjà parti'; end if;
  if l.mail_status = 'reserve' and l.mail_at > now() - interval '2 minutes' then raise exception 'Envoi déjà en cours'; end if;
  select * into x from players where id = l.player_id;
  select * into mine from clubs where id = l.club_id;
  if l.other_club_id is not null then
    select u.email::text, p.first_name into em, pf from memberships m join auth.users u on u.id = m.user_id join profiles p on p.id = m.user_id
      where m.club_id = l.other_club_id and m.role = 'president' and m.status = 'active' order by m.created_at limit 1;
  else em := l.pres_email; pf := l.pres_first;
  end if;
  em := lower(trim(coalesce(em, '')));
  if em = '' then raise exception 'Pas d''adresse pour le président de l''autre club'; end if;
  if exists(select 1 from mail_blocklist where email_hash = mail_hash(em)) then
    raise exception 'Cette adresse a refusé tout envoi de mypocketclub : préviens le club autrement';
  end if;
  cap := loan_mail_cap(l.club_id); n := loan_mails_today(l.club_id);
  if n >= cap then raise exception 'Limite du jour atteinte (% e-mail% de prêt par jour pour ton club) : réessaie demain', cap, case when cap > 1 then 's' else '' end; end if;
  if mails_today(null) >= 80 then raise exception 'Limite d''e-mails du jour atteinte : réessaie demain'; end if;
  update player_loans set mail_status = 'reserve', mail_at = now(), mail_error = null where id = l.id;
  ren := contact_holder(mine.id, 'rencontres');
  if ren is not null then rep := (contact_person(mine.id, ren, 'Correspondant rencontres'))->>'email'; end if;
  short := x.first_name || case when coalesce(x.last_name, '') <> '' then ' ' || left(x.last_name, 1) || '.' else '' end;
  return jsonb_build_object('email', em, 'first_name', coalesce(pf, ''), 'player', short, 'dir', l.direction, 'season', l.season,
    'club', mine.name, 'club_id', mine.id, 'other', l.other_name, 'other_city', l.other_city, 'mpc', l.other_club_id is not null,
    'reply', nullif(rep, ''), 'token', mail_info_token(em));
end $$;
revoke execute on function loan_mail_prepare(uuid) from public, anon;
grant execute on function loan_mail_prepare(uuid) to authenticated;

-- Après Resend : « envoyé » ou « échec » (le coach le voit et peut réessayer ; la tentative compte dans le plafond)
create or replace function loan_mail_finish(p_loan uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare l player_loans;
begin
  select * into l from player_loans where id = p_loan;
  if l.id is null or not can_loan_player(l.player_id) then raise exception 'Réservé au bureau et au coach de l''équipe du joueur'; end if;
  if l.mail_status <> 'reserve' then raise exception 'Aucun envoi en cours pour ce prêt'; end if;
  update player_loans set mail_status = case when coalesce(p_ok, false) then 'envoye' else 'echec' end,
    mail_error = case when coalesce(p_ok, false) then null else left(coalesce(nullif(trim(p_error), ''), 'refus du service d''e-mails'), 200) end
  where id = l.id;
  perform log_action(l.club_id, null, null, case when coalesce(p_ok, false) then 'E-mail de prêt envoyé' else 'E-mail de prêt refusé' end,
    jsonb_build_object('club', l.other_name));
end $$;
revoke execute on function loan_mail_finish(uuid, boolean, text) from public, anon;
grant execute on function loan_mail_finish(uuid, boolean, text) to authenticated;

-- Espace admin : accorder le « jour à 10 » (une fois par saison) et voir les e-mails de prêt (garde-fou)
create or replace function admin_loan_day(p_club uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s text; old loan_mail_days;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_day is null or p_day < (now() at time zone 'Europe/Paris')::date then raise exception 'Choisis aujourd''hui ou un jour à venir'; end if;
  s := season_label((p_day + time '12:00') at time zone 'Europe/Paris');
  select * into old from loan_mail_days where club_id = p_club and season = s;
  if old.club_id is not null and old.day < (now() at time zone 'Europe/Paris')::date then
    raise exception 'Le jour à 10 de la saison % a déjà servi (le %)', s, to_char(old.day, 'DD/MM/YYYY');
  end if;
  insert into loan_mail_days(club_id, season, day) values (p_club, s, p_day)
    on conflict (club_id, season) do update set day = excluded.day, granted_at = now();
  perform admin_note('jour à 10 e-mails de prêt accordé', p_club, jsonb_build_object('jour', to_char(p_day, 'DD/MM/YYYY'), 'saison', s));
  return jsonb_build_object('season', s, 'day', p_day);
end $$;
create or replace function admin_loan_day_get(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return (select jsonb_build_object('season', season, 'day', day) from loan_mail_days where club_id = p_club and season = season_label(now()));
end $$;
create or replace function admin_loan_mails() returns table(at timestamptz, club text, other text, status text, email text, mpc boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select l.mail_at, c.name, l.other_name, l.mail_status,
      case when l.other_club_id is null then l.pres_email else null end, l.other_club_id is not null
    from player_loans l join clubs c on c.id = l.club_id
    where l.mail_at > now() - interval '30 days' order by l.mail_at desc limit 60;
end $$;
revoke execute on function admin_loan_day(uuid, date), admin_loan_day_get(uuid), admin_loan_mails() from public, anon;
grant execute on function admin_loan_day(uuid, date), admin_loan_day_get(uuid), admin_loan_mails() to authenticated;

-- =====================================================================
-- N° 296 · thèmes de fêtes
-- =====================================================================
create table if not exists app_theme (
  id int primary key default 1 check (id = 1),
  theme text check (theme is null or theme in ('noel','galette','carnaval','stpatrick')),
  starts_on date,
  ends_on date,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into app_theme(id) values (1) on conflict do nothing;
alter table app_theme enable row level security;
revoke all on app_theme from anon, authenticated;

-- Le thème du jour (null si aucun) ; lu par l'application à la connexion
create or replace function active_theme() returns text language sql stable security definer set search_path = public as $$
  select t.theme from app_theme t where t.id = 1 and t.enabled and t.theme is not null
    and (now() at time zone 'Europe/Paris')::date between coalesce(t.starts_on, '-infinity'::date) and coalesce(t.ends_on, 'infinity'::date);
$$;
revoke execute on function active_theme() from public, anon;
grant execute on function active_theme() to authenticated;

create or replace function admin_theme_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return (select jsonb_build_object('theme', theme, 'starts_on', starts_on, 'ends_on', ends_on, 'enabled', enabled, 'active', active_theme()) from app_theme where id = 1);
end $$;
create or replace function admin_theme_set(p_enabled boolean, p_theme text, p_start date, p_end date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if coalesce(p_enabled, false) then
    if p_theme is null or p_theme not in ('noel','galette','carnaval','stpatrick') then raise exception 'Choisis un thème'; end if;
    if p_start is null or p_end is null then raise exception 'Choisis la date de début et la date de fin'; end if;
    if p_end < p_start then raise exception 'La date de fin est avant la date de début'; end if;
    if p_end > p_start + 92 then raise exception 'Un thème dure trois mois au plus'; end if;
  end if;
  update app_theme set enabled = coalesce(p_enabled, false), theme = coalesce(p_theme, theme), starts_on = coalesce(p_start, starts_on), ends_on = coalesce(p_end, ends_on), updated_at = now() where id = 1;
  perform admin_note(case when coalesce(p_enabled, false) then 'thème de fête activé' else 'thème de fête coupé' end, null,
    jsonb_build_object('thème', p_theme, 'début', p_start, 'fin', p_end));
end $$;
revoke execute on function admin_theme_get(), admin_theme_set(boolean, text, date, date) from public, anon;
grant execute on function admin_theme_get(), admin_theme_set(boolean, text, date, date) to authenticated;

-- Le rendez-vous garde le thème coché à sa création, même après la fin du thème
alter table events add column if not exists theme text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'events_theme_check') then
    alter table events add constraint events_theme_check check (theme is null or theme in ('noel','galette','carnaval','stpatrick'));
  end if;
end $$;
-- On ne pose un thème que pendant qu'il est actif ; on peut toujours l'enlever ou le garder
create or replace function events_theme_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.theme is not null and new.theme is distinct from (case when tg_op = 'UPDATE' then old.theme end)
     and new.theme is distinct from active_theme() then
    raise exception 'Ce thème n''est pas actif en ce moment';
  end if;
  return new;
end $$;
drop trigger if exists events_theme_guard on events;
create trigger events_theme_guard before insert or update of theme on events for each row execute function events_theme_guard();
revoke execute on function events_theme_guard() from public, anon, authenticated;

select close_visitor_functions();
