-- mypocketclub · alpha 5.11.0 · mise à jour d'une base 5.10.0, sans perte de données utiles, relançable.
--   N° 229 · mise en conformité (décisions de Gaël du 13 novembre 2026, transparence) :
--     1. les touchers sur « Payer · Bientôt disponible » ne sont plus comptés (table et fonctions retirées) ;
--     2. l'adresse IP des recherches de club n'est plus gardée en clair : seulement son empreinte (anciennes lignes effacées).
--   N° 230 · coordonnées des familles visibles seulement du président, du secrétariat, de la trésorerie, du directeur technique
--            (si le président ne les a pas masquées), du contact licences et du contact rencontres ; les coachs et le contact
--            d'équipe gardent celles de leur équipe. Plus pour le vice-président, la communication, le sponsoring, les événements
--            ni le rôle « Autre ».
--   Lot e-mails 1 :
--     n° 185 · liste noire : une désinscription est définitive (empreinte de l'adresse, jamais l'adresse en clair) ;
--             jeton de désinscription pour une adresse qui n'a pas de compte (servira au n° 96, lot 2) ;
--     n° 207 · l'attestation délivrée peut aussi partir par e-mail au demandeur (choix du trésorier, une seule fois) ;
--     n° 187 · e-mail de prévenance des comptes inactifs (lancé par l'administrateur, 40 au plus par passage) ;
--     n° 228 · compteur des e-mails (journal sans adresse ni contenu) et vue dans l'espace admin.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 229 · plus de comptage des touchers sur « Payer »
-- ---------------------------------------------------------------------
drop function if exists feature_tap_counts();
drop function if exists tap_feature(text, uuid);
drop table if exists feature_taps;

-- ---------------------------------------------------------------------
-- 2. N° 229 · adresse IP des recherches : empreinte seulement
-- ---------------------------------------------------------------------
create or replace function check_search_rate() returns void language plpgsql security definer set search_path = public as $$
declare v_ip text := md5('pc-recherche:' || request_ip());
begin
  if (select count(*) from search_attempts s where s.ip = v_ip and s.at > now() - interval '1 minute') >= 30 then
    raise exception 'Trop de recherches. Réessaie dans une minute.';
  end if;
  insert into search_attempts(ip) values (v_ip);
  if random() < 0.02 then delete from search_attempts where at < now() - interval '1 hour'; end if;
end $$;
revoke execute on function check_search_rate() from public, anon, authenticated;
delete from search_attempts where length(ip) <> 32 or ip !~ '^[0-9a-f]{32}$';   -- les adresses gardées en clair

-- ---------------------------------------------------------------------
-- 3. N° 230 · qui voit les coordonnées des familles
-- ---------------------------------------------------------------------
create or replace function sees_family_contacts(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    is_president(c)
    or exists(select 1 from memberships m where m.club_id = c and m.user_id = auth.uid() and m.status = 'active' and m.role = 'bureau'
      and (m.fonction in ('Secrétaire', 'Secrétaire adjoint', 'Trésorier', 'Trésorier adjoint', 'Correspondant licences', 'Correspondant rencontres')
           or (m.fonction in ('Directeur technique', 'Directeur sportif') and exists(select 1 from clubs k where k.id = c and k.tech_sees_contacts))))
    or exists(select 1 from club_designations d join memberships m on m.club_id = d.club_id and m.user_id = d.user_id and m.status = 'active'
      where d.club_id = c and d.user_id = auth.uid() and d.resp in ('licences', 'rencontres')));
$$;
revoke execute on function sees_family_contacts(uuid) from public, anon, authenticated;

create or replace function player_contacts(p_club uuid) returns table(id uuid, parent_email text, parent_phone text, emergency_name text, emergency_phone text)
language sql stable security definer set search_path = public as $$
  select x.id, x.parent_email, x.parent_phone, x.emergency_name, x.emergency_phone
  from players x
  where x.club_id = p_club and x.deleted_at is null and auth.uid() is not null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))
    or is_team_contact(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and is_team_contact(pt.team_id))
    or sees_family_contacts(x.club_id));
$$;
-- Téléphones : l'encadrement (président, bureau, coachs) reste joignable par les membres ;
-- les familles ne le sont que des fonctions ci-dessus, de leurs coachs et du contact de leur équipe
create or replace function phones_for(p_ids uuid[]) returns table(id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select p.id, p.phone from profiles p where p.id = any(p_ids) and p.phone is not null and p.deleted_at is null and (
    p.id = auth.uid()
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where a.user_id = auth.uid() and a.status = 'active' and a.role in ('president','bureau') and b.user_id = p.id and sees_family_contacts(a.club_id))
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
      where b.user_id = p.id and b.status = 'active' and b.role in ('president','bureau','coach') and a.user_id = auth.uid() and a.status = 'active' and a.role <> 'supporteur')
    or exists(select 1 from players x left join player_parents pp on pp.player_id = x.id
      where x.deleted_at is null and (pp.user_id = p.id or x.user_id = p.id)
        and (coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))
             or is_team_contact(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and is_team_contact(pt.team_id)))));
$$;
revoke execute on function player_contacts(uuid), phones_for(uuid[]) from public, anon;
grant execute on function player_contacts(uuid), phones_for(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. N° 228 · journal des e-mails (type, club, réussite ; jamais l'adresse ni le contenu)
-- ---------------------------------------------------------------------
create table if not exists mail_log (
  id bigserial primary key,
  kind text not null check (kind in ('test', 'nouvel_appareil', 'invitation_parent', 'rappel_validation', 'attestation', 'prevenance_inactif', 'information')),
  club_id uuid references clubs(id) on delete set null,
  ok boolean not null default true,
  at timestamptz not null default now()
);
create index if not exists mail_log_at on mail_log(at);
alter table mail_log enable row level security;   -- aucune règle : seulement par les fonctions

-- Réservée à la fonction envoyer-email (clé du serveur)
create or replace function mail_log_add(p_kind text, p_club uuid, p_ok boolean) returns void
language sql security definer set search_path = public as $$
  insert into mail_log(kind, club_id, ok) values (p_kind, p_club, coalesce(p_ok, true));
  delete from mail_log where at < now() - interval '400 days' and random() < 0.05;
$$;
revoke execute on function mail_log_add(text, uuid, boolean) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mail_log_add(text, uuid, boolean) to service_role';
  end if;
end $$;

-- Nombre d'e-mails partis aujourd'hui (journal + convocations), pour les limites
create or replace function mails_today(p_club uuid default null) returns int language sql stable security definer set search_path = public as $$
  select ((select count(*) from mail_log l where l.at >= date_trunc('day', now()) and (p_club is null or l.club_id = p_club))
        + (select count(*) from convocation_sends s where s.channel = 'email' and s.sent_at >= date_trunc('day', now()) and (p_club is null or s.club_id = p_club)))::int;
$$;
revoke execute on function mails_today(uuid) from public, anon, authenticated;

-- Espace admin : e-mails du jour et du mois, par type, face aux limites de Resend (100 par jour, 3 000 par mois)
create or replace function admin_mail_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d timestamptz := date_trunc('day', now()); m timestamptz := date_trunc('month', now()); k jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select coalesce(jsonb_object_agg(kind, jsonb_build_object('jour', jour, 'mois', mois, 'echecs', echecs)), '{}'::jsonb) into k from (
    select kind, count(*) filter (where at >= d) jour, count(*) mois, count(*) filter (where not ok) echecs from mail_log where at >= m group by kind
    union all
    select 'convocation', count(*) filter (where sent_at >= d), count(*), count(*) filter (where status = 'echec') from convocation_sends where channel = 'email' and sent_at >= m having count(*) > 0
  ) q;
  return jsonb_build_object('jour', mails_today(null),
    'mois', (select count(*) from mail_log where at >= m) + (select count(*) from convocation_sends where channel = 'email' and sent_at >= m),
    'limite_jour', 100, 'limite_mois', 3000, 'types', k);
end $$;
revoke execute on function admin_mail_stats() from public, anon;
grant execute on function admin_mail_stats() to authenticated;

-- ---------------------------------------------------------------------
-- 5. N° 185 · liste noire : une désinscription est définitive (empreinte de l'adresse)
-- ---------------------------------------------------------------------
create table if not exists mail_blocklist (
  email_hash text primary key,
  at timestamptz not null default now()
);
alter table mail_blocklist enable row level security;
create or replace function mail_hash(p_email text) returns text language sql immutable as $$
  select md5('pc-liste-noire:' || lower(trim(coalesce(p_email, ''))));
$$;
-- Jetons de désinscription pour une adresse sans compte (e-mail au dirigeant d'un club absent, lot 2)
create table if not exists mail_info_tokens (
  email_hash text primary key,
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table mail_info_tokens enable row level security;

-- Réservées au serveur : le jeton d'une adresse, et « cette adresse a-t-elle refusé ? »
create or replace function mail_info_token(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare t text; h text := mail_hash(p_email);
begin
  insert into mail_info_tokens(email_hash) values (h) on conflict do nothing;
  select token into t from mail_info_tokens where email_hash = h;
  return t;
end $$;
create or replace function mail_blocked(p_email text) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from mail_blocklist where email_hash = mail_hash(p_email));
$$;
revoke execute on function mail_info_token(text), mail_blocked(text), mail_hash(text) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mail_info_token(text), mail_blocked(text) to service_role';
  end if;
end $$;

-- Le lien de désinscription (ouvert au visiteur) : compte ou adresse seule ; l'adresse entre dans la liste noire
create or replace function unsubscribe_info(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid; h text;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select user_id into u from mail_unsub where token = p_token;
  if u is not null then
    update profiles set optin_emails = false, optin_at = now() where id = u and optin_emails;
    select mail_hash(email) into h from auth.users where id = u;
  else
    select email_hash into h from mail_info_tokens where token = p_token;
    if h is null then return false; end if;
  end if;
  if h is not null then insert into mail_blocklist(email_hash) values (h) on conflict do nothing; end if;
  return true;
end $$;
grant execute on function unsubscribe_info(text) to anon, authenticated;

-- Une personne qui se réinscrit elle-même dans Mon compte sort de la liste noire (son choix explicite)
create or replace function profiles_optin_unblock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.optin_emails and not coalesce(old.optin_emails, false) then
    delete from mail_blocklist where email_hash = (select mail_hash(email) from auth.users where id = new.id);
  end if;
  return new;
end $$;
revoke execute on function profiles_optin_unblock() from public, anon, authenticated;
drop trigger if exists profiles_optin_unblock on profiles;
create trigger profiles_optin_unblock after update of optin_emails on profiles for each row execute function profiles_optin_unblock();

-- ---------------------------------------------------------------------
-- 6. N° 207 · l'attestation délivrée envoyée aussi par e-mail (choix du trésorier, une seule fois)
-- ---------------------------------------------------------------------
alter table attestation_requests add column if not exists mailed_at timestamptz;

-- La fonction envoyer-email la demande au nom du trésorier (ou du président) : adresse du demandeur lue ici, jamais par l'application
create or replace function attestation_mail_take(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r attestation_requests; mail text; pn text; cn text; rn text;
begin
  select * into r from attestation_requests where id = p_id for update;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  if not (is_president(r.club_id) or has_area(r.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if r.status <> 'delivree' or r.pdf is null then raise exception 'Attestation pas encore délivrée'; end if;
  if r.mailed_at is not null then raise exception 'Attestation déjà envoyée par e-mail'; end if;
  if r.requested_by is null then raise exception 'Le demandeur n''a plus de compte'; end if;
  if mails_today(r.club_id) >= 20 or mails_today(null) >= 80 then raise exception 'Limite d''e-mails du jour atteinte : le demandeur la trouve dans Mon compte'; end if;
  select email::text into mail from auth.users where id = r.requested_by;
  if mail is null then raise exception 'Adresse du demandeur introuvable'; end if;
  update attestation_requests set mailed_at = now() where id = p_id;
  select first_name into pn from players where id = r.player_id;
  select name into cn from clubs where id = r.club_id;
  select first_name into rn from profiles where id = r.requested_by;
  perform log_action(r.club_id, r.requested_by, r.player_id, 'attestation de paiement envoyée par e-mail au demandeur', '{}'::jsonb);
  return jsonb_build_object('email', mail, 'first_name', coalesce(rn, ''), 'player', coalesce(pn, ''), 'club', coalesce(cn, ''), 'club_id', r.club_id,
    'season', r.season, 'pdf', r.pdf);
end $$;
revoke execute on function attestation_mail_take(uuid) from public, anon;
grant execute on function attestation_mail_take(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. N° 187 · prévenance des comptes inactifs (e-mail de service, lancé par l'administrateur)
-- ---------------------------------------------------------------------
-- Réservée au serveur : remet au plus p_limit comptes à prévenir et les marque « prévenus » (corbeille 30 jours plus tard)
create or replace function inactive_warnings_take(p_limit int) returns table(email text, first_name text, until date)
language plpgsql security definer set search_path = public as $$
begin
  return query with pick as (
      select u.id from auth.users u join profiles pr on pr.id = u.id
      where pr.deleted_at is null and pr.inactive_warned_at is null
        and coalesce(u.last_sign_in_at, u.created_at) < (season_start(now()) - interval '1 year') + interval '30 days'
      order by coalesce(u.last_sign_in_at, u.created_at) limit greatest(0, least(coalesce(p_limit, 0), 40)))
    , done as (update profiles pr set inactive_warned_at = now() from pick where pr.id = pick.id returning pr.id, pr.first_name)
    select u.email::text, d.first_name, (now() + interval '30 days')::date from done d join auth.users u on u.id = d.id;
end $$;
revoke execute on function inactive_warnings_take(int) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function inactive_warnings_take(int) to service_role';
  end if;
end $$;

-- L'aperçu de l'Entretien dit combien de comptes seront prévenus par e-mail
create or replace function admin_purge_preview() returns table(item text, n bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return query select x.item, x.n from purge_expired(false) x;
  item := 'comptes inactifs à prévenir par e-mail'; n := (select count(*) from warn_inactive_accounts(false)); return next;
end $$;
revoke execute on function admin_purge_preview() from public, anon;
grant execute on function admin_purge_preview() to authenticated;

-- Une trace au journal admin quand l'administrateur lance la prévenance (la fonction d'envoi l'appelle à son nom)
create or replace function admin_inactive_warn_note(p_sent int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  perform admin_note('comptes inactifs prévenus par e-mail', null, jsonb_build_object('e-mails', greatest(coalesce(p_sent, 0), 0)));
end $$;
revoke execute on function admin_inactive_warn_note(int) from public, anon;
grant execute on function admin_inactive_warn_note(int) to authenticated;

select close_visitor_functions();
