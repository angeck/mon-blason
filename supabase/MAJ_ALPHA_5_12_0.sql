-- MAJ_ALPHA_5_12_0.sql · mypocketclub · n° 124 (plus de validation pour envoyer les convocations), n° 162 (recommandations : P.-S. des convocations, écran d'ouverture), n° 187 (journal à 1 an, texte seulement) · à lancer une fois dans Supabase > SQL Editor > Run (après la 5.11.0).
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 5.12.0, puis redéployer « envoyer-email » et déployer la nouvelle fonction « recommander-club » (Verify JWT désactivé, secret TURNSTILE_SECRET).

-- mypocketclub · alpha 5.12.0 · mise à jour d'une base 5.11.0, sans perte de données, relançable.
--   N° 124 (décision de Gaël du 13 novembre 2026) : un envoi de convocation n'est plus refusé parce que le président du club
--            n'est pas encore validé par mypocketclub. Il faut seulement l'accès Événements du club. Les plafonds restent
--            (20 e-mails par club, 80 par jour, compteur n° 228) ; la validation sert encore à l'espace admin et à la corbeille (n° 182).
--   N° 162 (lot e-mails 3, décisions de Gaël du 13 novembre 2026) : recommander mypocketclub à un club qui ne l'utilise pas.
--     Façon 1 · convocation par e-mail : la base dit si un P.-S. peut être ajouté (club destinataire absent de mypocketclub,
--               adresse pas dans la liste noire). Une seule question par e-mail réservé ; l'adresse n'est pas gardée.
--     Façon 2 · écran d'ouverture : un visiteur saisit l'adresse d'un dirigeant de son club ; la fonction « recommander-club »
--               (anti-robots Turnstile) demande l'accord de la base : une recommandation par adresse pour toujours, 3 par visiteur
--               et par jour, 20 en tout par jour, jamais une adresse de la liste noire, d'un compte ou déjà démarchée (n° 96).
--               La base ne garde que l'empreinte de l'adresse (et celle de l'adresse IP pendant 2 jours), jamais l'adresse.
--   N° 187 : le journal des actions sensibles est déjà effacé après 1 an par le passage « Suppressions automatiques »
--            (purge_expired, 5.3.0) ; rien à changer ici, la politique « Vos données » 1.6 le dit désormais.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 124 · plus de validation pour envoyer
-- ---------------------------------------------------------------------
create or replace function can_send_convocations(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and has_area(c, 'evenements');
$$;
revoke execute on function can_send_convocations(uuid) from public, anon;
grant execute on function can_send_convocations(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. N° 162 · façon 1 · P.-S. dans une convocation envoyée à un club absent de mypocketclub
--    Appelée par la fonction envoyer-email juste après la réservation de l'e-mail (convocation_reserve), au nom de la personne
--    qui envoie, une fois par e-mail réservé. Réponse : oui (on ajoute le P.-S.) ou non. En cas de doute : non.
-- ---------------------------------------------------------------------
create or replace function convocation_ps(p_send uuid, p_email text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s convocation_sends; em text := lower(trim(coalesce(p_email, '')));
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.sent_by is distinct from auth.uid() or s.channel <> 'email' or s.status <> 'en_cours' then return false; end if;
  if em !~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$' or mail_blocked(em) then return false; end if;
  -- l'adresse est celle d'un membre d'un autre club inscrit : ce club est déjà sur mypocketclub
  if exists(select 1 from auth.users u join memberships m on m.user_id = u.id and m.status = 'active'
            join clubs c on c.id = m.club_id and c.deleted_at is null
            where lower(u.email) = em and m.club_id <> s.club_id) then return false; end if;
  -- l'adversaire du rendez-vous porte le nom d'un club inscrit
  if exists(select 1 from events e join clubs c on c.deleted_at is null and c.id <> e.club_id
            and lower(trim(c.name)) = lower(trim(coalesce(e.opponents, '')))
            where e.id = s.event_id) then return false; end if;
  return true;
end $$;
revoke execute on function convocation_ps(uuid, text) from public, anon;
grant execute on function convocation_ps(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 162 · façon 2 · recommandation depuis l'écran d'ouverture (réservée au serveur)
-- ---------------------------------------------------------------------
create table if not exists club_recommendations (
  email_hash text primary key,                 -- empreinte de l'adresse (mail_hash), jamais l'adresse
  ip_hash text,                                -- empreinte de l'adresse IP du visiteur, effacée après 2 jours
  status text not null default 'en_cours' check (status in ('en_cours', 'envoye', 'echec')),
  at timestamptz not null default now()
);
alter table club_recommendations enable row level security;
revoke all on club_recommendations from anon, authenticated;

create or replace function recommend_take(p_email text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); h text; ih text := md5('pc-recommandation:' || coalesce(nullif(p_ip, ''), 'inconnu'));
  r club_recommendations;
begin
  if em !~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$' or length(em) > 160 then raise exception 'Adresse e-mail à vérifier'; end if;
  h := mail_hash(em);
  perform pg_advisory_xact_lock(hashtext('mypocketclub:recommandations'));
  update club_recommendations set ip_hash = null where ip_hash is not null and at < now() - interval '2 days';
  delete from club_recommendations where status = 'en_cours' and at < now() - interval '1 hour';   -- envoi resté sans réponse
  -- une même réponse pour tous les refus liés à l'adresse : on ne dit pas si elle a un compte ou si elle s'est désinscrite
  select * into r from club_recommendations where email_hash = h;
  if (r.email_hash is not null and r.status <> 'echec') or mail_blocked(em)
     or exists(select 1 from auth.users u where lower(u.email) = em)
     or exists(select 1 from club_outreach o where lower(o.email) = em) then
    raise exception 'Recommandation impossible pour cette adresse';
  end if;
  if (select count(*) from club_recommendations where ip_hash = ih and at > now() - interval '1 day') >= 3 then
    raise exception 'Limite atteinte : 3 recommandations par jour. Réessaie demain.';
  end if;
  if (select count(*) from club_recommendations where at > now() - interval '1 day') >= 20 or mails_today() >= 90 then
    raise exception 'Limite du jour atteinte : réessaie demain.';
  end if;
  insert into club_recommendations(email_hash, ip_hash, status, at) values (h, ih, 'en_cours', now())
    on conflict (email_hash) do update set ip_hash = excluded.ip_hash, status = 'en_cours', at = now();
  return jsonb_build_object('token', mail_info_token(em));
end $$;

create or replace function recommend_done(p_email text, p_ok boolean) returns void
language sql security definer set search_path = public as $$
  update club_recommendations set status = case when p_ok then 'envoye' else 'echec' end
    where email_hash = mail_hash(lower(trim(coalesce(p_email, '')))) and status = 'en_cours';
$$;
revoke execute on function recommend_take(text, text), recommend_done(text, boolean) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function recommend_take(text, text), recommend_done(text, boolean) to service_role';
    execute 'grant select, insert, update, delete on club_recommendations to service_role';
  end if;
end $$;

-- Les recommandations envoyées apparaissent dans la carte « E-mails envoyés » de l'espace admin (type « recommandation », n° 228).

select close_visitor_functions();

select 'mypocketclub alpha 5.12.0 installée' as resultat;
