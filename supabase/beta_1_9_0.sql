-- mypocketclub · bêta 1.9.0 « Vitrine du club » (Gaël, 28 novembre 2026 : « Go pour tout coder », site de test d'abord)
-- Script idempotent (se relance sans risque). Aucun « drop table », aucun « delete » de données des clubs.
--   n° 311 : la vitrine publique du club (mypocketclub.fr/nom-du-club) : fonction « Responsable vitrine » (accès « vitrine »,
--            le président l'a toujours), réglages, page publique lue par une fonction qui ne rend que ce que le club montre,
--            deux formulaires (« Venir faire un essai », « Écrire au club ») reçus dans mpc et par e-mail, gardés 3 mois.
--   n° 312 : ordre et blocs cachés, créneaux cachés par équipe, « On recrute » / « Complet ».
--   n° 313 : saison affichée, « Passer à la nouvelle saison », encart de rentrée (premier lundi après les grandes vacances),
--            date de la rentrée saisie par l'administrateur.
--   n° 314 : espace admin : vitrines sans logo (pour proposer une charte), dates de rentrée.

-- =====================================================================
-- 1. Fonction « Responsable vitrine » et accès « vitrine »
-- =====================================================================
alter table memberships drop constraint if exists memberships_fonction;
alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur technique','Correspondant rencontres',
  'Correspondant licences','Chargé de communication','Responsable événements','Responsable sponsoring','Responsable vitrine','Membre du bureau'));

create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['licences']
    when 'Directeur technique' then array['technique']
    when 'Correspondant rencontres' then array['evenements']
    when 'Responsable événements' then array['evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then '{}'::text[]
    when 'Responsable vitrine' then array['vitrine']
    when 'Membre du bureau' then '{}'::text[]
    when 'Directeur sportif' then array['technique'] when 'Coordinateur' then array['evenements']
    else '{}'::text[] end;
$$;

-- Le président a toujours l'accès « vitrine » ; un membre du bureau peut le recevoir en plus (« Accès » dans « Fonctions du bureau »)
create or replace function areas_of(c uuid, u uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'president')
      then array['tresorerie','secretariat','technique','communication','evenements','licences','vitrine']
    when not exists(select 1 from memberships where club_id = c and user_id = u and status = 'active' and role = 'bureau') then '{}'::text[]
    else coalesce((select array_agg(distinct a order by a) from (
        select unnest(fonction_areas(m.fonction)) a from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'bureau'
        union select b.area from board_areas b where b.club_id = c and b.user_id = u
        union select designation_area(d.resp) from club_designations d where d.club_id = c and d.user_id = u
        -- le Secrétariat comprend les licences
        union select 'licences' where exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'bureau' and 'secretariat' = any(fonction_areas(m.fonction)))
           or exists(select 1 from board_areas b where b.club_id = c and b.user_id = u and b.area = 'secretariat')) x), '{}'::text[]) end;
$$;

alter table board_areas drop constraint if exists board_areas_area_check;
alter table board_areas add constraint board_areas_area_check check (area in ('tresorerie','secretariat','technique','communication','evenements','vitrine'));

-- Rôle « Autre » : l'accès « vitrine » peut aussi être coché
create or replace function create_other_role(p_club uuid, p_user uuid, p_title text, p_areas text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare t text := nullif(left(trim(regexp_replace(coalesce(p_title, ''), '[<>]', '', 'g')), 40), ''); a text; mid uuid;
begin
  if not is_president(p_club) then raise exception 'Seul le président crée un rôle'; end if;
  if t is null or length(t) < 2 then raise exception 'Donne un nom au rôle (2 lettres au moins)'; end if;
  if not exists(select 1 from memberships where club_id = p_club and user_id = p_user and status = 'active') then raise exception 'Cette personne n''est pas membre du club'; end if;
  if p_areas is not null then
    foreach a in array p_areas loop
      if a not in ('tresorerie','secretariat','technique','communication','evenements','vitrine') then raise exception 'Accès inconnu : un rôle « Autre » ne peut pas donner plus que les accès du bureau'; end if;
    end loop;
  end if;
  insert into memberships(club_id, user_id, role, fonction, title, status) values (p_club, p_user, 'bureau', 'Membre du bureau', t, 'active') returning id into mid;
  if p_areas is not null then
    foreach a in array p_areas loop
      insert into board_areas(club_id, user_id, area, granted_by) values (p_club, p_user, a, auth.uid()) on conflict do nothing;
    end loop;
  end if;
  perform log_action(p_club, p_user, null, 'rôle créé', jsonb_build_object('intitule', t, 'acces', coalesce(array_to_string(p_areas, ', '), 'aucun')));
  return mid;
end $$;
revoke execute on function create_other_role(uuid, uuid, text, text[]) from public, anon;
grant execute on function create_other_role(uuid, uuid, text, text[]) to authenticated;

-- =====================================================================
-- 2. Réglages de la vitrine (une ligne par club)
-- =====================================================================
create table if not exists club_vitrines (
  club_id uuid primary key references clubs(id) on delete cascade,
  enabled boolean not null default false,
  slug text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  season text check (season is null or season ~ '^[0-9]{4}-[0-9]{4}$'),         -- saison affichée (null = la plus récente des équipes)
  content jsonb not null default '{}'::jsonb check (length(content::text) < 30000), -- textes, tarifs, pièces, palmarès, partenaires, liens
  layout jsonb not null default '{}'::jsonb check (length(layout::text) < 4000),    -- {"order":[…], "hidden":[…]}
  slots_hidden uuid[] not null default '{}',                                        -- équipes dont les créneaux sont « sur demande »
  team_status jsonb not null default '{}'::jsonb check (length(team_status::text) < 8000), -- {équipe: "complet"} (sinon « On recrute »)
  essai_to uuid references auth.users(id) on delete set null,                        -- null = contact licences, sinon le président
  ecrire_to uuid references auth.users(id) on delete set null,                       -- null = le président
  remind_after date,                                                                 -- encart de rentrée repoussé jusqu'à cette date
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table club_vitrines enable row level security;
revoke all on club_vitrines from anon;
drop policy if exists "vitrine lue par son responsable" on club_vitrines;
create policy "vitrine lue par son responsable" on club_vitrines for select using (has_area(club_id, 'vitrine'));
-- aucune écriture directe : tout passe par vitrine_save, vitrine_set_season, vitrine_postpone

-- Dates de rentrée (une par année), saisies par l'administrateur ; sans date : le 1er septembre
create table if not exists school_starts (
  year int primary key check (year between 2025 and 2100),
  day date not null,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now()
);
alter table school_starts enable row level security;
revoke all on school_starts from anon, authenticated;
insert into school_starts(year, day) values (2026, '2026-09-01'), (2027, '2027-09-01') on conflict do nothing;

-- Premier lundi après les grandes vacances (le jour de la rentrée s'il tombe un lundi)
create or replace function vitrine_rentree_monday(p_year int) returns date language sql stable security definer set search_path = public as $$
  select d + ((8 - extract(isodow from d)::int) % 7) from (select coalesce((select day from school_starts where year = p_year), make_date(p_year, 9, 1)) d) x;
$$;
revoke execute on function vitrine_rentree_monday(int) from public, anon;

-- Adresse proposée : nom du club en minuscules sans accents ni espaces, puis le département (2 premiers chiffres du code postal)
create or replace function vitrine_slug_suggest(p_club uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare n text; d text; s text; i int := 1;
begin
  select lower(translate(name, 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿŒœÆæ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyyOoAa')),
         left(regexp_replace(coalesce(postal_code, ''), '[^0-9]', '', 'g'), 2)
    into n, d from clubs where id = p_club;
  n := left(regexp_replace(coalesce(n, ''), '[^a-z0-9]', '', 'g'), 34);
  if length(n) < 3 then n := 'club' || n; end if;
  s := n || coalesce(d, '');
  while exists(select 1 from club_vitrines v where v.slug = s and v.club_id <> p_club) loop i := i + 1; s := n || coalesce(d, '') || '-' || i; end loop;
  return s;
end $$;
revoke execute on function vitrine_slug_suggest(uuid) from public, anon;

-- Mots réservés (fichiers et dossiers du site)
create or replace function vitrine_slug_reserved(p text) returns boolean language sql immutable as $$
  select p = any(array['js','img','index','vitrine','causerie','tests','supabase','tools','donnees','faq','admin','app','api','aide','www',
    'mypocketclub','mpc','connexion','inscription','compte','club','clubs','test','manifest','icon','favicon','sw','config','style','legal','cgu','vrai-site','404']);
$$;

-- Saison affichée par défaut : la saison en cours si le club y a des équipes, sinon la plus récente
create or replace function vitrine_latest_season(p_club uuid) returns text language sql stable security definer set search_path = public as $$
  select case when exists(select 1 from teams where club_id = p_club and deleted_at is null and state <> 'Archivée' and season = season_label(now()))
    then season_label(now())
    else coalesce((select max(season) from teams where club_id = p_club and deleted_at is null and state <> 'Archivée'), season_label(now())) end;
$$;
revoke execute on function vitrine_latest_season(uuid) from public, anon;

-- Qui tient la vitrine : les membres du bureau qui ont l'accès « vitrine » (hors président) ; à défaut, le président
create or replace function vitrine_holders(p_club uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select array_agg(distinct m.user_id) from memberships m
      where m.club_id = p_club and m.status = 'active' and m.role = 'bureau' and 'vitrine' = any(areas_of(p_club, m.user_id))
        and not exists(select 1 from memberships x where x.club_id = p_club and x.user_id = m.user_id and x.status = 'active' and x.role = 'president')), '{}'),
    (select array_agg(m.user_id) from memberships m where m.club_id = p_club and m.status = 'active' and m.role = 'president'), '{}');
$$;
revoke execute on function vitrine_holders(uuid) from public, anon;

-- Destinataire réel d'un formulaire : choisi par le président, sinon le contact licences (essai) ou le président
create or replace function vitrine_recipient(p_club uuid, p_kind text) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p_kind = 'essai' then v.essai_to else v.ecrire_to end from club_vitrines v
      where v.club_id = p_club and exists(select 1 from memberships m where m.club_id = p_club and m.status = 'active'
        and m.user_id = case when p_kind = 'essai' then v.essai_to else v.ecrire_to end)),
    case when p_kind = 'essai' then contact_holder(p_club, 'licences') end,
    (select m.user_id from memberships m where m.club_id = p_club and m.status = 'active' and m.role = 'president' order by m.created_at limit 1));
$$;
revoke execute on function vitrine_recipient(uuid, text) from public, anon;

-- =====================================================================
-- 3. Demandes reçues par les formulaires (gardées 3 mois)
-- =====================================================================
create table if not exists vitrine_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  kind text not null check (kind in ('essai','ecrire')),
  to_user uuid references auth.users(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  team_name text not null default '' check (char_length(team_name) <= 80),
  birth_year int check (birth_year is null or birth_year between 1930 and 2030),
  full_name text not null check (char_length(full_name) between 2 and 80),
  contact text not null check (char_length(contact) between 3 and 120),
  subject text not null default '' check (char_length(subject) <= 60),
  message text not null default '' check (char_length(message) <= 1000),
  ip_hash text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists vitrine_requests_club on vitrine_requests(club_id, created_at desc);
alter table vitrine_requests enable row level security;
revoke all on vitrine_requests from anon;
revoke insert, update, delete on vitrine_requests from authenticated;
drop policy if exists "demandes de la vitrine lues par leur destinataire" on vitrine_requests;
create policy "demandes de la vitrine lues par leur destinataire" on vitrine_requests for select
  using (to_user = auth.uid() or is_president(club_id));

create or replace function vitrine_purge() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from vitrine_requests where created_at < now() - interval '3 months';
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function vitrine_purge() from public, anon, authenticated;

create or replace function vitrine_request_read(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update vitrine_requests set read_at = coalesce(read_at, now()) where id = p_id and (to_user = auth.uid() or is_president(club_id));
end $$;
revoke execute on function vitrine_request_read(uuid) from public, anon;
grant execute on function vitrine_request_read(uuid) to authenticated;

create or replace function vitrine_request_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r vitrine_requests;
begin
  select * into r from vitrine_requests where id = p_id;
  if r.id is null or not (r.to_user = auth.uid() or is_president(r.club_id)) then raise exception 'Demande introuvable'; end if;
  delete from vitrine_requests where id = p_id;
end $$;
revoke execute on function vitrine_request_delete(uuid) from public, anon;
grant execute on function vitrine_request_delete(uuid) to authenticated;

-- Prise d'une demande par la fonction Edge « vitrine-demande » (clé du serveur seulement, après Turnstile) :
-- limites (20 par club et par jour, 5 par visiteur et par jour, 90 e-mails par jour pour tout mypocketclub), enregistrement,
-- notification au destinataire. Rend de quoi écrire l'e-mail (adresse du destinataire, noms).
alter table mail_log drop constraint if exists mail_log_kind_check;
alter table mail_log add constraint mail_log_kind_check check (kind in ('test', 'nouvel_appareil', 'invitation_parent', 'rappel_validation', 'attestation',
  'prevenance_inactif', 'information', 'recommandation', 'validation', 'pret', 'vitrine'));

create or replace function vitrine_request_take(p_slug text, p_kind text, p_team uuid, p_birth int, p_name text, p_contact text,
  p_subject text, p_message text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v club_vitrines; c clubs; u uuid; rid uuid; tn text := ''; ih text := md5('pc-vitrine:' || coalesce(p_ip, ''));
  nm text := left(trim(regexp_replace(coalesce(p_name, ''), '[<>\r\n]', ' ', 'g')), 80);
  ct text := left(trim(regexp_replace(coalesce(p_contact, ''), '[<>\r\n]', ' ', 'g')), 120);
  sj text := left(trim(regexp_replace(coalesce(p_subject, ''), '[<>\r\n]', ' ', 'g')), 60);
  ms text := left(trim(regexp_replace(coalesce(p_message, ''), '[<>]', ' ', 'g')), 1000);
begin
  perform vitrine_purge();
  select * into v from club_vitrines where slug = lower(trim(coalesce(p_slug, '')));
  select * into c from clubs where id = v.club_id;
  if v.club_id is null or not v.enabled or c.deleted_at is not null then raise exception 'Vitrine introuvable'; end if;
  if p_kind not in ('essai','ecrire') then raise exception 'Demande inconnue'; end if;
  if length(nm) < 2 then raise exception 'Indique ton prénom et ton nom.'; end if;
  if length(ct) < 3 then raise exception 'Indique un téléphone ou un e-mail pour la réponse.'; end if;
  if p_kind = 'ecrire' and length(ms) < 2 then raise exception 'Écris ton message.'; end if;
  if p_kind = 'essai' then
    if p_team is not null then
      select name into tn from teams where id = p_team and club_id = c.id and deleted_at is null and state = 'Visible';
      if tn is null then raise exception 'Équipe introuvable'; end if;
    end if;
    if p_birth is not null and (p_birth < 1930 or p_birth > extract(year from now())::int) then raise exception 'Année de naissance à vérifier.'; end if;
  end if;
  if (select count(*) from vitrine_requests where club_id = c.id and created_at >= now() - interval '1 day') >= 20 then raise exception 'Limite du jour atteinte pour ce club : réessaie demain.'; end if;
  if (select count(*) from vitrine_requests where ip_hash = ih and created_at >= now() - interval '1 day') >= 5 then raise exception 'Limite du jour atteinte : réessaie demain.'; end if;
  u := vitrine_recipient(c.id, p_kind);
  insert into vitrine_requests(club_id, kind, to_user, team_id, team_name, birth_year, full_name, contact, subject, message, ip_hash)
    values (c.id, p_kind, u, case when p_kind = 'essai' then p_team end, coalesce(tn, ''), case when p_kind = 'essai' then p_birth end, nm, ct,
            case when p_kind = 'ecrire' then sj else '' end, ms, ih)
    returning id into rid;
  if u is not null then
    perform push_enqueue(u, case when p_kind = 'essai' then 'Demande d''essai' else 'Message reçu par la vitrine' end,
      case when p_kind = 'essai' then coalesce(nullif(tn, ''), 'Nouvel essai') else coalesce(nullif(sj, ''), 'Message') end || ' · ' || c.name,
      'vitrine', 'vitrine:' || rid, './#ouvrir=' || c.id || '.vitrine');
  end if;
  return jsonb_build_object('id', rid, 'club', c.name, 'club_id', c.id, 'team', tn,
    'to_email', (select email from auth.users where id = u), 'to_name', (select full_name from profiles where id = u),
    'mail_ok', u is not null and mails_today() < 90);
end $$;
revoke execute on function vitrine_request_take(text, text, uuid, int, text, text, text, text, text) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function vitrine_request_take(text, text, uuid, int, text, text, text, text, text) to service_role';
  end if;
end $$;

-- =====================================================================
-- 4. Réglages : lecture, enregistrement, saison, encart de rentrée
-- =====================================================================
create or replace function vitrine_get(p_club uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v club_vitrines; s text; cur text := season_label(now()); nxt text; holders uuid[]; mon date; enc boolean;
begin
  if not has_area(p_club, 'vitrine') then raise exception 'Droit insuffisant'; end if;
  perform vitrine_purge();
  select * into v from club_vitrines where club_id = p_club;
  s := coalesce(v.season, vitrine_latest_season(p_club));
  nxt := (split_part(s, '-', 1)::int + 1) || '-' || (split_part(s, '-', 1)::int + 2);
  holders := vitrine_holders(p_club);
  mon := vitrine_rentree_monday(extract(year from now() at time zone 'Europe/Paris')::int);
  enc := coalesce(v.enabled, false) and auth.uid() = any(holders) and s < cur and current_date >= mon
         and (v.remind_after is null or v.remind_after <= current_date);
  return jsonb_build_object(
    'exists', v.club_id is not null, 'enabled', coalesce(v.enabled, false),
    'slug', v.slug, 'suggest', vitrine_slug_suggest(p_club),
    'season', s, 'next_season', nxt,
    'next_teams', (select count(*) from teams where club_id = p_club and deleted_at is null and state <> 'Archivée' and season = nxt),
    'seasons', coalesce((select jsonb_agg(distinct season order by season) from teams where club_id = p_club and deleted_at is null and state <> 'Archivée'), '[]'::jsonb),
    'content', coalesce(v.content, '{}'::jsonb), 'layout', coalesce(v.layout, '{}'::jsonb),
    'slots_hidden', coalesce(to_jsonb(v.slots_hidden), '[]'::jsonb), 'team_status', coalesce(v.team_status, '{}'::jsonb),
    'essai_to', v.essai_to, 'ecrire_to', v.ecrire_to,
    'essai_real', vitrine_recipient(p_club, 'essai'), 'ecrire_real', vitrine_recipient(p_club, 'ecrire'),
    'holders', to_jsonb(holders), 'president', is_president(p_club),
    'encart', enc, 'rentree_monday', mon, 'remind_after', v.remind_after,
    'has_logo', (select logo is not null from clubs where id = p_club));
end $$;
revoke execute on function vitrine_get(uuid) from public, anon;
grant execute on function vitrine_get(uuid) to authenticated;

-- Enregistrement : le président règle tout ; le responsable seulement le contenu, l'ordre, les blocs cachés, les créneaux et les places
create or replace function vitrine_save(p_club uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare pres boolean := is_president(p_club); k text; sl text; t uuid; ids uuid[];
  allowed text[] := array['content','layout','slots_hidden','team_status'];
  presonly text[] := array['enabled','slug','essai_to','ecrire_to'];
begin
  if not has_area(p_club, 'vitrine') then raise exception 'Droit insuffisant'; end if;
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then raise exception 'Réglage illisible'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = any(presonly) and not pres then raise exception 'Réservé au président'; end if;
    if not (k = any(allowed) or k = any(presonly)) then raise exception 'Réglage inconnu : %', k; end if;
  end loop;
  insert into club_vitrines(club_id, slug) values (p_club, null) on conflict (club_id) do nothing;
  if p_patch ? 'slug' then
    sl := lower(trim(coalesce(p_patch->>'slug', '')));
    if sl !~ '^[a-z0-9][a-z0-9-]{2,39}$' then raise exception 'Adresse : 3 à 40 caractères, lettres sans accents, chiffres et tirets'; end if;
    if vitrine_slug_reserved(sl) then raise exception 'Cette adresse est réservée : choisis-en une autre'; end if;
    if exists(select 1 from club_vitrines where slug = sl and club_id <> p_club) then raise exception 'Cette adresse est déjà prise : choisis-en une autre'; end if;
    update club_vitrines set slug = sl where club_id = p_club;
  end if;
  if p_patch ? 'enabled' then
    if (p_patch->>'enabled')::boolean then
      update club_vitrines set slug = coalesce(slug, vitrine_slug_suggest(p_club)) where club_id = p_club;
    end if;
    update club_vitrines set enabled = (p_patch->>'enabled')::boolean where club_id = p_club;
  end if;
  foreach k in array array['essai_to','ecrire_to'] loop
    if p_patch ? k then
      t := nullif(p_patch->>k, '')::uuid;
      if t is not null and not (exists(select 1 from memberships where club_id = p_club and user_id = t and status = 'active') and account_is_adult(p_club, t)) then
        raise exception 'Choisis une personne adulte du club';
      end if;
      if k = 'essai_to' then update club_vitrines set essai_to = t where club_id = p_club; else update club_vitrines set ecrire_to = t where club_id = p_club; end if;
    end if;
  end loop;
  if p_patch ? 'content' then
    if jsonb_typeof(p_patch->'content') <> 'object' then raise exception 'Contenu illisible'; end if;
    update club_vitrines set content = p_patch->'content' where club_id = p_club;
  end if;
  if p_patch ? 'layout' then
    if jsonb_typeof(p_patch->'layout') <> 'object' then raise exception 'Mise en page illisible'; end if;
    update club_vitrines set layout = p_patch->'layout' where club_id = p_club;
  end if;
  if p_patch ? 'slots_hidden' then
    select coalesce(array_agg(x::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(p_patch->'slots_hidden', '[]'::jsonb)) x;
    update club_vitrines set slots_hidden = (select coalesce(array_agg(id), '{}') from teams where club_id = p_club and id = any(ids)) where club_id = p_club;
  end if;
  if p_patch ? 'team_status' then
    if jsonb_typeof(p_patch->'team_status') <> 'object' then raise exception 'Places illisibles'; end if;
    update club_vitrines set team_status = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each_text(p_patch->'team_status') e
      where e.value in ('complet','recrute') and exists(select 1 from teams where club_id = p_club and id::text = e.key)) where club_id = p_club;
  end if;
  update club_vitrines set updated_at = now(), updated_by = auth.uid() where club_id = p_club;
  perform log_action(p_club, null, null, 'vitrine modifiée', jsonb_build_object('reglages', (select array_to_string(array_agg(x), ', ') from jsonb_object_keys(p_patch) x)));
  return vitrine_get(p_club);
end $$;
revoke execute on function vitrine_save(uuid, jsonb) from public, anon;
grant execute on function vitrine_save(uuid, jsonb) to authenticated;

-- Passer à la nouvelle saison (la saison doit avoir au moins une équipe)
create or replace function vitrine_set_season(p_club uuid, p_season text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not has_area(p_club, 'vitrine') then raise exception 'Droit insuffisant'; end if;
  if not exists(select 1 from teams where club_id = p_club and deleted_at is null and state <> 'Archivée' and season = p_season) then
    raise exception 'Crée d''abord une équipe de la saison %', p_season;
  end if;
  insert into club_vitrines(club_id) values (p_club) on conflict (club_id) do nothing;
  update club_vitrines set season = p_season, remind_after = null, updated_at = now(), updated_by = auth.uid() where club_id = p_club;
  perform log_action(p_club, null, null, 'vitrine : nouvelle saison', jsonb_build_object('saison', p_season));
  return vitrine_get(p_club);
end $$;
revoke execute on function vitrine_set_season(uuid, text) from public, anon;
grant execute on function vitrine_set_season(uuid, text) to authenticated;

-- Encart de rentrée repoussé de 7 jours ou d'un mois
create or replace function vitrine_postpone(p_club uuid, p_days int) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not has_area(p_club, 'vitrine') then raise exception 'Droit insuffisant'; end if;
  if p_days not in (7, 30) then raise exception 'Report de 7 jours ou d''un mois seulement'; end if;
  insert into club_vitrines(club_id) values (p_club) on conflict (club_id) do nothing;
  update club_vitrines set remind_after = current_date + case when p_days = 30 then interval '1 month' else interval '7 days' end where club_id = p_club;
  return vitrine_get(p_club);
end $$;
revoke execute on function vitrine_postpone(uuid, int) from public, anon;
grant execute on function vitrine_postpone(uuid, int) to authenticated;

-- =====================================================================
-- 5. Page publique : seulement ce que le club montre (jamais un nom de joueur, jamais une coordonnée)
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
      'crest_bg', c.crest_bg, 'mpc', c.logo is null),
    'slug', v.slug, 'enabled', v.enabled, 'season', s, 'logged', logged,
    'can_edit', logged and has_area(c.id, 'vitrine'),
    'content', v.content, 'layout', v.layout,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
        'players', (select count(*) from players p where p.team_id = t.id and p.deleted_at is null),
        'status', coalesce(v.team_status->>(t.id::text), 'recrute'), 'slots_hidden', t.id = any(v.slots_hidden)) order by t.category, t.name)
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

-- Le visiteur garde l'accès à la page publique (liste des fonctions ouvertes au visiteur)
create or replace function close_visitor_functions() returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare f record; n int := 0; pol text; svc boolean := exists(select 1 from pg_roles where rolname = 'service_role');
  keep text[] := array['public_search_clubs', 'public_club', 'request_club', 'not_me_device', 'unsubscribe_info', 'vitrine_public'];
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

-- =====================================================================
-- 6. Espace admin (n° 314) : vitrines sans logo, dates de rentrée
-- =====================================================================
create or replace function admin_vitrines() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return jsonb_build_object(
    'enabled', (select count(*) from club_vitrines v join clubs c on c.id = v.club_id where v.enabled and c.deleted_at is null),
    'nologo', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'slug', v.slug,
        'president', (select p.full_name from memberships m join profiles p on p.id = m.user_id where m.club_id = c.id and m.role = 'president' and m.status = 'active' limit 1))
        order by c.name)
      from club_vitrines v join clubs c on c.id = v.club_id where v.enabled and c.deleted_at is null and c.logo is null), '[]'::jsonb),
    'rentrees', coalesce((select jsonb_agg(jsonb_build_object('year', year, 'day', day, 'monday', vitrine_rentree_monday(year)) order by year) from school_starts), '[]'::jsonb));
end $$;
revoke execute on function admin_vitrines() from public, anon;
grant execute on function admin_vitrines() to authenticated;

create or replace function admin_rentree_set(p_year int, p_day date) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_day is null or extract(year from p_day)::int <> p_year or extract(month from p_day)::int not in (8, 9) then raise exception 'La rentrée tombe fin août ou en septembre de l''année choisie'; end if;
  insert into school_starts(year, day, set_by) values (p_year, p_day, auth.uid())
    on conflict (year) do update set day = excluded.day, set_by = excluded.set_by, set_at = now();
  perform admin_note('date de rentrée', null, jsonb_build_object('annee', p_year, 'jour', p_day));
end $$;
revoke execute on function admin_rentree_set(int, date) from public, anon;
grant execute on function admin_rentree_set(int, date) to authenticated;

select close_visitor_functions();
