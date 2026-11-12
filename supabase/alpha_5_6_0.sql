-- mypocketclub · alpha 5.6.0 · mise à jour d'une base 5.5.0, sans perte de données, relançable.
--   N° 202 · compte administrateur, v1 pour la bêta (maquette https://claude.ai/artifact/GsSnKxT5cdMKoTAnwbnEEv) :
--   1. double vérification : toute action d'administration demande une session confirmée par un code à 6 chiffres
--      (application d'authentification, « aal2 » de Supabase) ; sans code, le compte reste un compte ordinaire ;
--   2. journal admin (ce que fait un administrateur, lu dans l'onglet Entretien) ;
--   3. accueil admin (chiffres du parc), liste des clubs avec validation et abonnement, abonnement modifiable,
--      délai de validation prolongé ;
--   4. signalements : le président transmet un message signalé à mypocketclub ; l'administrateur voit ce message seul ;
--   5. Entretien : aperçu puis lancement à la main des suppressions automatiques.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. Double vérification
--   is_app_admin() reste la seule porte des fonctions d'administration (et de la lecture des demandes de clubs) :
--   elle exige maintenant une session « aal2 » (code à 6 chiffres saisi sur cet appareil).
--   admin_account() dit seulement si le compte est administrateur, pour afficher l'écran du code.
-- ---------------------------------------------------------------------
create or replace function is_app_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_admins where user_id = auth.uid()) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
grant execute on function is_app_admin() to authenticated;
create or replace function is_principal_admin() returns boolean language sql stable security definer set search_path = public as $$
  select is_app_admin() and exists(select 1 from app_admins where user_id = auth.uid() and principal);
$$;
create or replace function admin_account() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_admins where user_id = auth.uid());
$$;
revoke execute on function admin_account() from public, anon;
grant execute on function admin_account() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Journal admin (lu seulement par admin_log_list)
-- ---------------------------------------------------------------------
create table if not exists admin_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null check (length(action) <= 120),
  club_id uuid references clubs(id) on delete set null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists admin_log_at on admin_log(at desc);
alter table admin_log enable row level security;
revoke all on admin_log from anon, authenticated;

create or replace function admin_note(p_action text, p_club uuid, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into admin_log(admin_id, action, club_id, detail) values (auth.uid(), left(p_action, 120), p_club, coalesce(p_detail, '{}'::jsonb));
$$;
revoke execute on function admin_note(text, uuid, jsonb) from public, anon, authenticated;

-- Validation d'un président (fonctions de la 4.3.0) : notée au journal admin
create or replace function sender_validations_admin_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then return null; end if;
  if tg_op = 'DELETE' then perform admin_note('validation retirée', old.club_id, jsonb_build_object('président', old.user_id));
  else perform admin_note('président validé', new.club_id, jsonb_build_object('président', new.user_id, 'motif', new.reason, 'fin', new.ends_at)); end if;
  return null;
end $$;
revoke execute on function sender_validations_admin_log() from public, anon, authenticated;
drop trigger if exists sender_validations_admin_log on sender_validations;
create trigger sender_validations_admin_log after insert or update or delete on sender_validations for each row execute function sender_validations_admin_log();

create or replace function admin_log_list() returns table(at timestamptz, admin_name text, action text, club_name text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select l.at, coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'Administrateur'), l.action, c.name, l.detail
    from admin_log l left join profiles p on p.id = l.admin_id left join clubs c on c.id = l.club_id
    order by l.at desc limit 40;
end $$;
revoke execute on function admin_log_list() from public, anon;
grant execute on function admin_log_list() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Accueil admin, clubs, abonnements
-- ---------------------------------------------------------------------
-- Joueurs facturés : tous, sauf ceux des équipes gratuites (les plus nombreuses) ; même calcul que club_client_view (5.3.0)
create or replace function paying_players(p_club uuid, p_free int) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, (select count(*) from players where club_id = p_club and deleted_at is null)::int
    - coalesce((select sum(c) from (select count(*) c from players x where x.club_id = p_club and x.deleted_at is null and x.team_id is not null
        group by x.team_id order by c desc limit greatest(coalesce(p_free, 1), 0)) f), 0)::int);
$$;
revoke execute on function paying_players(uuid, int) from public, anon, authenticated;

create or replace function admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; due bigint;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select coalesce(sum(paying_players(s.club_id, s.free_teams)::bigint * s.rate_cents), 0) into due
    from club_subscription s join clubs c on c.id = s.club_id where c.deleted_at is null and s.status = 'payant' and s.rate_cents is not null;
  select jsonb_build_object(
    'clubs', (select count(*) from clubs where deleted_at is null),
    'accounts', (select count(*) from profiles where deleted_at is null),
    'players', (select count(*) from players p join clubs c on c.id = p.club_id where p.deleted_at is null and c.deleted_at is null),
    'active7', (select count(*) from auth.users u where u.last_sign_in_at > now() - interval '7 days'),
    'to_validate', (select count(*) from clubs c where c.deleted_at is null
        and exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active')
        and not exists(select 1 from memberships m join sender_validations v on v.club_id = m.club_id and v.user_id = m.user_id
                       where m.club_id = c.id and m.role = 'president' and m.status = 'active')),
    'club_requests', (select count(*) from club_requests where status = 'new'),
    'schemas', (select count(*) from schema_requests where status = 'pending'),
    'duplicates', (select count(*) from exercise_duplicates d join exercises e on e.id = d.exercise_id
        where d.status = 'signale' and e.sharing = 'public' and e.public_state = 'validated'),
    'reports', (select count(*) from message_reports where forwarded_at is not null and admin_done_at is null),
    'sub_test', (select count(*) from clubs c left join club_subscription s on s.club_id = c.id where c.deleted_at is null and coalesce(s.status, 'test') = 'test'),
    'sub_free', (select count(*) from club_subscription s join clubs c on c.id = s.club_id where c.deleted_at is null and s.status = 'gratuit'),
    'sub_paid', (select count(*) from club_subscription s join clubs c on c.id = s.club_id where c.deleted_at is null and s.status = 'payant'),
    'due_cents', due,
    'last_purge', (select max(at) from admin_log where action = 'suppressions automatiques lancées')) into r;
  return r;
end $$;
revoke execute on function admin_overview() from public, anon;
grant execute on function admin_overview() to authenticated;

-- Tous les clubs (corbeille comprise), avec le président, sa validation et l'abonnement ; e-mail du président toujours visible
create or replace function admin_club_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select coalesce(jsonb_agg(x order by (x->>'deleted_at') is not null, (x->>'reason') is not null, x->>'created_at' desc), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'color1', c.color1, 'logo', c.logo, 'crest_bg', c.crest_bg,
      'created_at', c.created_at, 'deleted_at', c.deleted_at, 'valid_by', c.valid_by,
      'president_id', p.user_id, 'president_name', nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''), 'president_email', u.email::text,
      'members', (select count(distinct m.user_id) from memberships m where m.club_id = c.id and m.status = 'active'),
      'teams', (select count(*) from teams t where t.club_id = c.id),
      'players', (select count(*) from players x where x.club_id = c.id and x.deleted_at is null),
      'reason', v.reason, 'ends_at', v.ends_at, 'vnote', v.note, 'validated_at', v.validated_at,
      'status', coalesce(s.status, 'test'), 'engaged_from', s.engaged_from, 'engaged_to', s.engaged_to, 'rate_cents', s.rate_cents,
      'free_teams', coalesce(s.free_teams, 1), 'snote', coalesce(s.note, ''),
      'paying', paying_players(c.id, coalesce(s.free_teams, 1)),
      'due_cents', case when s.status = 'payant' and s.rate_cents is not null then paying_players(c.id, s.free_teams) * s.rate_cents end) x
    from clubs c
    left join lateral (select m.user_id from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active' order by m.created_at limit 1) p on true
    left join profiles pr on pr.id = p.user_id
    left join auth.users u on u.id = p.user_id
    left join sender_validations v on v.club_id = c.id and v.user_id = p.user_id
    left join club_subscription s on s.club_id = c.id) q;
  return r;
end $$;
revoke execute on function admin_club_list() from public, anon;
grant execute on function admin_club_list() to authenticated;

create or replace function admin_set_subscription(p_club uuid, p_status text, p_from date, p_to date, p_rate_cents int, p_free_teams int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if not exists(select 1 from clubs where id = p_club) then raise exception 'Club introuvable'; end if;
  if p_status not in ('test', 'gratuit', 'payant') then raise exception 'Statut inconnu'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'La fin est avant le début'; end if;
  if p_rate_cents is not null and (p_rate_cents < 0 or p_rate_cents > 10000) then raise exception 'Prix par joueur entre 0 et 100 €'; end if;
  if p_status = 'payant' and p_rate_cents is null then raise exception 'Indique le prix par joueur'; end if;
  if coalesce(p_free_teams, 1) not between 0 and 20 then raise exception 'Équipes gratuites : entre 0 et 20'; end if;
  insert into club_subscription(club_id, status, engaged_from, engaged_to, rate_cents, free_teams, note, updated_at)
    values (p_club, p_status, p_from, p_to, p_rate_cents, coalesce(p_free_teams, 1), left(coalesce(p_note, ''), 300), now())
    on conflict (club_id) do update set status = excluded.status, engaged_from = excluded.engaged_from, engaged_to = excluded.engaged_to,
      rate_cents = excluded.rate_cents, free_teams = excluded.free_teams, note = excluded.note, updated_at = now();
  perform admin_note('abonnement modifié', p_club, jsonb_build_object('statut', p_status, 'du', p_from, 'au', p_to, 'prix', p_rate_cents, 'gratuites', coalesce(p_free_teams, 1)));
end $$;
revoke execute on function admin_set_subscription(uuid, text, date, date, int, int, text) from public, anon;
grant execute on function admin_set_subscription(uuid, text, date, date, int, int, text) to authenticated;

-- Club pas encore validé : repousser la date limite (n° 182) de 7 à 90 jours
create or replace function admin_extend_validation(p_club uuid, p_days int) returns date
language plpgsql security definer set search_path = public as $$
declare c clubs; d timestamptz;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_days is null or p_days not between 7 and 90 then raise exception 'Entre 7 et 90 jours'; end if;
  select * into c from clubs where id = p_club;
  if c.id is null then raise exception 'Club introuvable'; end if;
  if c.deleted_at is not null then raise exception 'Ce club est dans la corbeille'; end if;
  d := greatest(coalesce(c.valid_by, now()), now()) + make_interval(days => p_days);
  update clubs set valid_by = d, valid_reminded_at = null where id = p_club;
  perform admin_note('délai de validation prolongé', p_club, jsonb_build_object('jours', p_days, 'jusqu''au', d::date));
  return d::date;
end $$;
revoke execute on function admin_extend_validation(uuid, int) from public, anon;
grant execute on function admin_extend_validation(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Signalements transmis par le président (décision de Gaël, 12 novembre, 13 h 57 : le message seul)
-- ---------------------------------------------------------------------
alter table message_reports add column if not exists forwarded_at timestamptz;
alter table message_reports add column if not exists forwarded_by uuid references auth.users(id) on delete set null;
alter table message_reports add column if not exists admin_done_at timestamptz;
alter table message_reports add column if not exists admin_note text check (admin_note is null or length(admin_note) <= 300);

create or replace function forward_report(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r message_reports; a uuid; cn text;
begin
  select * into r from message_reports where id = p_report;
  if r.id is null then raise exception 'Signalement introuvable'; end if;
  if not is_president(r.club_id) then raise exception 'Réservé au président'; end if;
  if r.forwarded_at is not null then return; end if;
  update message_reports set forwarded_at = now(), forwarded_by = auth.uid() where id = p_report;
  perform log_action(r.club_id, null, null, 'message signalé transmis à mypocketclub', '{}'::jsonb);
  select name into cn from clubs where id = r.club_id;
  for a in select user_id from app_admins loop
    perform push_enqueue(a, 'Signalement transmis', coalesce(cn, 'Un club') || ' te transmet un message signalé', 'admin', 'repfwd:' || p_report || ':' || a, './');
  end loop;
end $$;
revoke execute on function forward_report(uuid) from public, anon;
grant execute on function forward_report(uuid) to authenticated;

-- Le président voit aussi s'il a déjà transmis (nouvelle colonne : la fonction est recréée)
drop function if exists reported_messages(uuid);
create function reported_messages(p_club uuid) returns table(report_id uuid, group_name text, message_id bigint, body text, author uuid, reporter uuid, reason text, created_at timestamptz, handled_at timestamptz, forwarded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Réservé au président'; end if;
  return query select r.id, g.name, r.message_id, m.body, m.user_id, r.reporter, r.reason, r.created_at, r.handled_at, r.forwarded_at
    from message_reports r left join groups g on g.id = r.group_id left join messages m on m.id = r.message_id
    where r.club_id = p_club order by r.created_at desc limit 100;
end $$;
revoke execute on function reported_messages(uuid) from public, anon;
grant execute on function reported_messages(uuid) to authenticated;

-- L'administrateur : les signalements transmis seulement, le message signalé seul (jamais la conversation)
create or replace function admin_reports() returns table(report_id uuid, club_id uuid, club_name text, group_name text, body text, author_name text, reason text,
  created_at timestamptz, forwarded_at timestamptz, president_email text, admin_done_at timestamptz, admin_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select r.id, r.club_id, c.name, g.name, m.body,
      coalesce(nullif(trim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, '')), ''), 'Membre'), r.reason, r.created_at, r.forwarded_at,
      (select u.email::text from auth.users u where u.id = r.forwarded_by), r.admin_done_at, r.admin_note
    from message_reports r join clubs c on c.id = r.club_id left join groups g on g.id = r.group_id
      left join messages m on m.id = r.message_id left join profiles pa on pa.id = m.user_id
    where r.forwarded_at is not null
    order by (r.admin_done_at is null) desc, r.forwarded_at desc limit 100;
end $$;
revoke execute on function admin_reports() from public, anon;
grant execute on function admin_reports() to authenticated;

create or replace function admin_report_done(p_report uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  update message_reports set admin_done_at = now(), admin_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
    where id = p_report and forwarded_at is not null returning club_id into cid;
  if cid is null then raise exception 'Signalement introuvable'; end if;
  perform admin_note('signalement traité', cid, '{}'::jsonb);
end $$;
revoke execute on function admin_report_done(uuid, text) from public, anon;
grant execute on function admin_report_done(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Entretien : suppressions automatiques lancées à la main, avec aperçu (décision de Gaël, 12 novembre, 13 h 57)
--   Les comptes inactifs ne sont pas marqués « prévenus » tant que l'e-mail de prévenance n'existe pas (lot e-mails,
--   après la bêta) : sans marque, aucun compte inactif ne part à la corbeille.
-- ---------------------------------------------------------------------
create or replace function admin_purge_preview() returns table(item text, n bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select x.item, x.n from purge_expired(false) x;
  item := 'comptes inactifs à prévenir (e-mail pas encore en place)'; n := (select count(*) from warn_inactive_accounts(false)); return next;
end $$;
revoke execute on function admin_purge_preview() from public, anon;
grant execute on function admin_purge_preview() to authenticated;

create or replace function admin_purge_run() returns table(item text, n bigint)
language plpgsql security definer set search_path = public as $$
declare d jsonb := '{}'::jsonb; x record;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  for x in select * from purge_expired(true) loop
    item := x.item; n := x.n; d := d || jsonb_build_object(x.item, x.n); return next;
  end loop;
  perform admin_note('suppressions automatiques lancées', null, d);
end $$;
revoke execute on function admin_purge_run() from public, anon;
grant execute on function admin_purge_run() to authenticated;

select close_visitor_functions();
