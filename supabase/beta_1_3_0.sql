-- MAJ_BETA_1_3_0.sql · mypocketclub · bêta 1.3.0 · n° 245, version 2 (Gaël, 18 novembre 2026 : « Maquette. Ok. Lance la maj »)
-- Le suivi commercial se fait par CLUB : une fiche par club (prospect, en test ou gratuit, client, perdu), ses personnes,
-- ses échanges, et les phrases dictées rangées dans un club depuis l'application (« Ranger dans un club »).
-- Maquette : https://claude.ai/artifact/GoU3FUKUhcFxSaUSbMgzq8 ; chantier : claude/71-admin-pro-crm.md.
-- À lancer une fois dans Supabase › SQL Editor › Run, d'abord sur la base de TEST. Sans perte de données, relançable sans risque.
-- Demande MAJ_BETA_1_2_0.sql déjà lancé (tables crm_contacts, crm_events, crm_inbox).
-- Les fiches restent des données de personnes : sur le VRAI site seulement pour de vraies personnes.

-- ---------- États d'un club (4 au lieu de 6 étapes) ----------
-- à contacter, contacté, présentation faite → prospect ; payant → client ; test et perdu ne changent pas
alter table crm_contacts drop constraint if exists crm_contacts_stage_check;
update crm_contacts set stage = case when stage = 'payant' then 'client' else 'prospect' end where stage in ('a_contacter', 'contacte', 'presentation', 'payant');
alter table crm_contacts alter column stage set default 'prospect';
alter table crm_contacts add constraint crm_contacts_stage_check check (stage in ('prospect', 'test', 'client', 'perdu'));

-- Contact principal : téléphone ; les autres personnes du club (nom, fonction, téléphone, e-mail), 30 au plus
alter table crm_contacts add column if not exists contact_phone text not null default '' check (char_length(contact_phone) <= 40);
alter table crm_contacts add column if not exists people jsonb not null default '[]'::jsonb;
alter table crm_contacts drop constraint if exists crm_contacts_people_check;
alter table crm_contacts add constraint crm_contacts_people_check check (jsonb_typeof(people) = 'array' and jsonb_array_length(people) <= 30);
-- Une seule fiche de suivi par club inscrit
create unique index if not exists crm_contacts_one_per_club on crm_contacts(club_id) where club_id is not null;

-- Échanges : « Visite » en plus ; une phrase rangée depuis l'application est marquée « dictee »
alter table crm_events drop constraint if exists crm_events_kind_check;
alter table crm_events add constraint crm_events_kind_check check (kind in ('mail_envoye', 'mail_recu', 'presentation_live', 'presentation_visio', 'proposition', 'devis', 'appel', 'visite', 'note', 'autre'));
alter table crm_events drop constraint if exists crm_events_source_check;
alter table crm_events add constraint crm_events_source_check check (source in ('manuel', 'claude', 'dictee'));

-- Ancienne étape envoyée par un écran pas encore à jour : traduite plutôt que refusée
create or replace function crm_state(p text) returns text language sql immutable as $$
  select case when p in ('a_contacter', 'contacte', 'presentation') then 'prospect' when p = 'payant' then 'client' else p end $$;
revoke execute on function crm_state(text) from public, anon;

-- Personnes : seulement nom, fonction, téléphone, e-mail ; lignes sans nom écartées
create or replace function crm_people_clean(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(trim(coalesce(x->>'name', '')), 120), 'role', left(trim(coalesce(x->>'role', '')), 80),
      'phone', left(trim(coalesce(x->>'phone', '')), 40), 'email', left(trim(coalesce(x->>'email', '')), 200))), '[]'::jsonb)
  from (select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x limit 30) q
  where char_length(trim(coalesce(x->>'name', ''))) > 0 $$;
revoke execute on function crm_people_clean(jsonb) from public, anon;

-- ---------- Fonctions réservées à l'administrateur (mêmes noms, mêmes droits) ----------
create or replace function admin_crm_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select coalesce(jsonb_agg(x order by (x->>'next_at') is null, x->>'next_at', x->>'updated_at' desc), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', k.id, 'org', k.org, 'contact_name', k.contact_name, 'contact_role', k.contact_role, 'contact_email', k.contact_email, 'contact_phone', k.contact_phone,
      'people', k.people, 'sport', k.sport, 'city', k.city, 'club_id', k.club_id, 'club_name', c.name, 'stage', k.stage, 'interest', k.interest,
      'current_tool', k.current_tool, 'wants', k.wants, 'next_action', k.next_action, 'next_at', k.next_at, 'lost_reason', k.lost_reason,
      'created_at', k.created_at, 'updated_at', k.updated_at,
      'events_n', (select count(*) from crm_events e where e.contact_id = k.id),
      'last_at', (select max(e.at) from crm_events e where e.contact_id = k.id),
      'last_kind', (select e.kind from crm_events e where e.contact_id = k.id order by e.at desc limit 1)) x
    from crm_contacts k left join clubs c on c.id = k.club_id) q;
  return r;
end $$;
revoke execute on function admin_crm_list() from public, anon;
grant execute on function admin_crm_list() to authenticated;

create or replace function admin_crm_save(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare k crm_contacts; d jsonb := coalesce(p_data, '{}'::jsonb); st text := crm_state(p_data->>'stage'); cl uuid;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if d ? 'stage' and st not in ('prospect', 'test', 'client', 'perdu') then raise exception 'État inconnu'; end if;
  if d ? 'interest' and (d->>'interest')::int not between 0 and 3 then raise exception 'Intérêt entre 0 et 3'; end if;
  cl := case when d ? 'club_id' then nullif(d->>'club_id', '')::uuid else null end;
  if p_id is null then
    if char_length(trim(coalesce(d->>'org', ''))) = 0 then raise exception 'Indique le nom du club'; end if;
    insert into crm_contacts(org) values (left(trim(d->>'org'), 120)) returning * into k;
    perform admin_note('fiche CRM créée', null, jsonb_build_object('contact', k.id));
  else
    select * into k from crm_contacts where id = p_id;
    if k.id is null then raise exception 'Fiche introuvable'; end if;
  end if;
  if cl is not null and exists(select 1 from crm_contacts where club_id = cl and id <> k.id) then raise exception 'Ce club a déjà une fiche de suivi'; end if;
  if cl is not null and not exists(select 1 from clubs where id = cl) then raise exception 'Club introuvable'; end if;
  update crm_contacts set
    org = case when d ? 'org' and char_length(trim(d->>'org')) > 0 then left(trim(d->>'org'), 120) else org end,
    contact_name = case when d ? 'contact_name' then left(trim(coalesce(d->>'contact_name', '')), 120) else contact_name end,
    contact_role = case when d ? 'contact_role' then left(trim(coalesce(d->>'contact_role', '')), 80) else contact_role end,
    contact_email = case when d ? 'contact_email' then left(trim(coalesce(d->>'contact_email', '')), 200) else contact_email end,
    contact_phone = case when d ? 'contact_phone' then left(trim(coalesce(d->>'contact_phone', '')), 40) else contact_phone end,
    people = case when d ? 'people' then crm_people_clean(d->'people') else people end,
    sport = case when d ? 'sport' then left(trim(coalesce(d->>'sport', '')), 40) else sport end,
    city = case when d ? 'city' then left(trim(coalesce(d->>'city', '')), 80) else city end,
    club_id = case when d ? 'club_id' then cl else club_id end,
    stage = case when d ? 'stage' then st else stage end,
    interest = case when d ? 'interest' then (d->>'interest')::smallint else interest end,
    current_tool = case when d ? 'current_tool' then left(trim(coalesce(d->>'current_tool', '')), 80) else current_tool end,
    wants = case when d ? 'wants' then left(trim(coalesce(d->>'wants', '')), 300) else wants end,
    next_action = case when d ? 'next_action' then left(trim(coalesce(d->>'next_action', '')), 200) else next_action end,
    next_at = case when d ? 'next_at' then nullif(d->>'next_at', '')::date else next_at end,
    lost_reason = case when d ? 'lost_reason' then left(trim(coalesce(d->>'lost_reason', '')), 200) else lost_reason end,
    updated_at = now()
  where id = k.id;
  return k.id;
end $$;
revoke execute on function admin_crm_save(uuid, jsonb) from public, anon;
grant execute on function admin_crm_save(uuid, jsonb) to authenticated;

create or replace function admin_crm_event_add(p_contact uuid, p_kind text, p_summary text, p_at timestamptz default now(), p_next_at date default null, p_next_action text default null, p_stage text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare id uuid; st text := crm_state(p_stage);
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if not exists(select 1 from crm_contacts where crm_contacts.id = p_contact) then raise exception 'Fiche introuvable'; end if;
  if p_kind not in ('mail_envoye', 'mail_recu', 'presentation_live', 'presentation_visio', 'proposition', 'devis', 'appel', 'visite', 'note', 'autre') then raise exception 'Type d''échange inconnu'; end if;
  if st is not null and st not in ('prospect', 'test', 'client', 'perdu') then raise exception 'État inconnu'; end if;
  insert into crm_events(contact_id, at, kind, summary) values (p_contact, coalesce(p_at, now()), p_kind, left(trim(coalesce(p_summary, '')), 1000)) returning crm_events.id into id;
  update crm_contacts set updated_at = now(),
    next_at = case when p_next_at is not null then p_next_at else next_at end,
    next_action = case when p_next_action is not null then left(trim(p_next_action), 200) else next_action end,
    stage = coalesce(st, stage)
  where crm_contacts.id = p_contact;
  return id;
end $$;
revoke execute on function admin_crm_event_add(uuid, text, text, timestamptz, date, text, text) from public, anon;
grant execute on function admin_crm_event_add(uuid, text, text, timestamptz, date, text, text) to authenticated;

-- « Ranger dans un club » : la phrase devient un échange du club (à sa date), avec en option la prochaine action ; elle quitte « À ranger »
create or replace function admin_crm_inbox_file(p_id uuid, p_contact uuid, p_kind text default 'note', p_next_action text default null, p_next_at date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i crm_inbox; id uuid;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into i from crm_inbox where crm_inbox.id = p_id and status = 'a_ranger';
  if i.id is null then raise exception 'Phrase introuvable ou déjà rangée'; end if;
  if not exists(select 1 from crm_contacts where crm_contacts.id = p_contact) then raise exception 'Fiche introuvable'; end if;
  if coalesce(p_kind, 'note') not in ('mail_envoye', 'mail_recu', 'presentation_live', 'presentation_visio', 'proposition', 'devis', 'appel', 'visite', 'note', 'autre') then raise exception 'Type d''échange inconnu'; end if;
  insert into crm_events(contact_id, at, kind, summary, source) values (p_contact, i.at, coalesce(p_kind, 'note'), left(i.body, 1000), 'dictee') returning crm_events.id into id;
  update crm_contacts set updated_at = now(),
    next_at = case when p_next_at is not null then p_next_at else next_at end,
    next_action = case when nullif(trim(coalesce(p_next_action, '')), '') is not null then left(trim(p_next_action), 200) else next_action end
  where crm_contacts.id = p_contact;
  update crm_inbox set status = 'range', contact_id = p_contact, done_at = now() where crm_inbox.id = p_id;
  return id;
end $$;
revoke execute on function admin_crm_inbox_file(uuid, uuid, text, text, date) from public, anon;
grant execute on function admin_crm_inbox_file(uuid, uuid, text, text, date) to authenticated;

select close_visitor_functions();
