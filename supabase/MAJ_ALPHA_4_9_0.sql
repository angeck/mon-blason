-- MAJ_ALPHA_4_9_0.sql · mypocketclub · n° 173 (« Rôle déjà attribué : retire-le avant le changement. »), n° 180 (accords du compte : droit à l'image et e-mails d'information, datés ; nouvelles conditions), n° 177 (trace datée des missions ouvertes aux jeunes) · à lancer une fois dans Supabase > SQL Editor > Run (après la 4.8.0).
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 4.9.0. Rien à redéployer.

-- mypocketclub · alpha 4.9.0 · mise à jour d'une base 4.8.0, sans perte de données, relançable.
-- Mise à jour « Légal » d'avant la bêta (« go » de Gaël, 10 novembre 2026) :
-- 1. N° 173 : nouveau message quand un rôle à une seule personne est déjà tenu.
-- 2. N° 180 : accords du compte. Droit à l'image (facultatif, jamais coché d'avance) et e-mails d'information,
--    avec leur date ; version des conditions acceptée et date déjà gardées (cgu_version, cgu_at).
--    Le droit à l'image du compte s'applique aussi à la fiche joueur de la personne (pas à celle de ses enfants :
--    il se règle sur la fiche de l'enfant, par le parent).
-- 3. N° 177 : trace datée quand une mission est ouverte aux jeunes dès U13 (engagement du club lu par la personne).
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. N° 173 · « Rôle déjà attribué : retire-le avant le changement. »
-- ---------------------------------------------------------------------
create or replace function memberships_fonction_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and new.fonction in ('Vice-président','Secrétaire','Trésorier','Correspondant licences','Correspondant rencontres')
     and exists(select 1 from memberships m where m.club_id = new.club_id and m.fonction = new.fonction and m.status = 'active' and m.id <> new.id) then
    raise exception 'Rôle déjà attribué : retire-le avant le changement.';
  end if;
  if new.status = 'active' and new.role in ('bureau','president')
     and (tg_op = 'INSERT' or old.status <> 'active' or old.role <> new.role or old.fonction is distinct from new.fonction)
     and not account_is_adult(new.club_id, new.user_id) then
    raise exception 'Les fonctions du bureau sont réservées aux adultes (fiche joueur mineure ou sans date de naissance)';
  end if;
  return new;
end $$;
revoke execute on function memberships_fonction_check() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. N° 180 · accords du compte (droit à l'image, e-mails d'information), datés
-- ---------------------------------------------------------------------
alter table profiles add column if not exists image_ok boolean not null default false;
alter table profiles add column if not exists image_at timestamptz;
alter table profiles add column if not exists optin_at timestamptz;

-- Inscription : version des conditions, date, et les deux accords facultatifs (non cochés par défaut)
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare optin boolean := coalesce((new.raw_user_meta_data->>'optin_emails')::boolean, false);
        img boolean := coalesce((new.raw_user_meta_data->>'image_ok')::boolean, false);
begin
  insert into profiles(id, first_name, last_name, cgu_version, cgu_at, optin_emails, optin_at, image_ok, image_at) values (new.id,
    coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', ''), ' ', 1)),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'cgu_version',
    case when new.raw_user_meta_data->>'cgu_version' is not null then now() end,
    optin, case when optin then now() end,
    img, case when img then now() end);
  return new;
end $$;
revoke execute on function handle_new_user() from public, anon, authenticated;

-- Changer ses accords (Mon compte, ou au moment d'accepter une nouvelle version des conditions).
-- null = ne pas changer. La date change seulement quand le choix change.
create or replace function set_my_consents(p_image boolean, p_optin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur profiles;
begin
  if me is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into cur from profiles where id = me;
  if not found then raise exception 'Compte introuvable'; end if;
  update profiles set
    image_ok = coalesce(p_image, image_ok),
    image_at = case when p_image is not null and p_image is distinct from image_ok then now() else image_at end,
    optin_emails = coalesce(p_optin, optin_emails),
    optin_at = case when p_optin is not null and p_optin is distinct from optin_emails then now() else optin_at end
  where id = me;
  -- La fiche joueur de la personne elle-même suit son choix (jamais celle d'un enfant)
  if p_image is not null and p_image is distinct from cur.image_ok then
    update players set consents = consents || jsonb_build_object('image', jsonb_build_object('ok', p_image, 'at', now(), 'by', me))
      where user_id = me and deleted_at is null;
  end if;
end $$;
revoke execute on function set_my_consents(boolean, boolean) from public, anon;
grant execute on function set_my_consents(boolean, boolean) to authenticated;

-- Accepter une nouvelle version des conditions, avec les deux accords
drop function if exists accept_cgu(text, boolean, boolean);
create function accept_cgu(p_version text, p_optin boolean, p_image boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Version des conditions manquante'; end if;
  update profiles set cgu_version = left(trim(p_version), 40), cgu_at = now() where id = auth.uid();
  perform set_my_consents(p_image, p_optin);
end $$;
revoke execute on function accept_cgu(text, boolean, boolean) from public, anon;
grant execute on function accept_cgu(text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 177 · trace datée de l'ouverture d'une mission aux jeunes dès U13
-- ---------------------------------------------------------------------
create or replace function log_youth_mission() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.youth and not coalesce(old.youth, false) then
    perform log_action((select club_id from events where id = new.event_id), null, null, 'mission ouverte aux jeunes dès U13',
      jsonb_build_object('mission', new.label, 'rendez-vous', (select title from events where id = new.event_id),
        'engagement', 'Le club s''engage à ce qu''un adulte (parent ou membre du bureau) soit présent.'));
  end if;
  return null;
end $$;
revoke execute on function log_youth_mission() from public, anon, authenticated;
drop trigger if exists log_youth_mission on event_missions;
create trigger log_youth_mission after update of youth on event_missions for each row execute function log_youth_mission();

-- Missions par défaut du club : trace quand une mission « jeunes » apparaît dans la liste
create or replace function log_youth_defaults() returns trigger language plpgsql security definer set search_path = public as $$
declare added text;
begin
  select string_agg(x->>'label', ', ') into added
    from jsonb_array_elements(coalesce(new.default_missions, '[]'::jsonb)) x
    where coalesce((x->>'youth')::boolean, false)
      and not exists(select 1 from jsonb_array_elements(coalesce(old.default_missions, '[]'::jsonb)) y
                     where y->>'label' = x->>'label' and coalesce((y->>'youth')::boolean, false));
  if added is not null then
    perform log_action(new.id, null, null, 'missions par défaut ouvertes aux jeunes dès U13',
      jsonb_build_object('missions', added, 'engagement', 'Le club s''engage à ce qu''un adulte (parent ou membre du bureau) soit présent.'));
  end if;
  return null;
end $$;
revoke execute on function log_youth_defaults() from public, anon, authenticated;
drop trigger if exists log_youth_defaults on clubs;
create trigger log_youth_defaults after update of default_missions on clubs for each row execute function log_youth_defaults();

select close_visitor_functions();

select 'mypocketclub alpha 4.9.0 installée' as resultat;
