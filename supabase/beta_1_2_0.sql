-- MAJ_BETA_1_2_0.sql · mypocketclub · n° 245 et n° 202 (espace admin « pro » : cockpit, mini-CRM, « Dis-le à Claude », usage et parc des clubs) · n° 265 (consignes des tactiques)
-- À lancer une fois dans Supabase › SQL Editor › Run, d'abord sur la base de TEST. Sans perte de données, relançable sans risque.
-- À lancer JUSTE APRÈS la mise en ligne du code bêta 1.2.0 (avant, l'onglet Contacts affiche « lance le script »). Rien à redéployer.
-- Les contacts du CRM sont des données de personnes (nom, fonction, échanges) : ils ne vont que dans la base du VRAI site, jamais dans la base de test avec de vraies personnes.
-- Aucune table du CRM n'est lisible par l'application : tout passe par des fonctions réservées à l'administrateur (is_app_admin(), session confirmée par le code à 6 chiffres).

-- ---------- Mini-CRM : contacts ----------
create table if not exists crm_contacts (
  id uuid primary key default gen_random_uuid(),
  org text not null check (char_length(trim(org)) between 1 and 120),            -- club ou organisation contactée
  contact_name text not null default '' check (char_length(contact_name) <= 120),
  contact_role text not null default '' check (char_length(contact_role) <= 80),
  contact_email text not null default '' check (char_length(contact_email) <= 200),
  sport text not null default '' check (char_length(sport) <= 40),
  city text not null default '' check (char_length(city) <= 80),
  club_id uuid references clubs(id) on delete set null,                          -- le club une fois inscrit dans l'application
  stage text not null default 'a_contacter' check (stage in ('a_contacter', 'contacte', 'presentation', 'test', 'payant', 'perdu')),
  interest smallint not null default 0 check (interest between 0 and 3),         -- 0 inconnu · 1 faible (+) · 2 fort (++) · 3 très fort (+++)
  current_tool text not null default '' check (char_length(current_tool) <= 80), -- outil utilisé aujourd'hui (Sport Easy, ClickToClub, WhatsApp…)
  wants text not null default '' check (char_length(wants) <= 300),               -- ce que le contact souhaite (ex. « 1 équipe, 1 saison »)
  next_action text not null default '' check (char_length(next_action) <= 200),
  next_at date,
  lost_reason text not null default '' check (char_length(lost_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_contacts_next on crm_contacts(next_at) where next_at is not null;
alter table crm_contacts enable row level security;
revoke all on crm_contacts from anon, authenticated;

-- ---------- Mini-CRM : échanges (mails, présentations, propositions, notes) ----------
create table if not exists crm_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm_contacts(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('mail_envoye', 'mail_recu', 'presentation_live', 'presentation_visio', 'proposition', 'devis', 'appel', 'note', 'autre')),
  summary text not null default '' check (char_length(summary) <= 1000),
  source text not null default 'manuel' check (source in ('manuel', 'claude')),   -- 'claude' : rangé depuis une phrase de Gaël
  created_at timestamptz not null default now()
);
create index if not exists crm_events_contact on crm_events(contact_id, at desc);
alter table crm_events enable row level security;
revoke all on crm_events from anon, authenticated;

-- ---------- Fonctions réservées à l'administrateur ----------
create or replace function admin_crm_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select coalesce(jsonb_agg(x order by (x->>'next_at') is null, x->>'next_at', x->>'updated_at' desc), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', k.id, 'org', k.org, 'contact_name', k.contact_name, 'contact_role', k.contact_role, 'contact_email', k.contact_email,
      'sport', k.sport, 'city', k.city, 'club_id', k.club_id, 'club_name', c.name, 'stage', k.stage, 'interest', k.interest,
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

create or replace function admin_crm_events(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'kind', e.kind, 'summary', e.summary, 'source', e.source) order by e.at desc, e.created_at desc)
    from crm_events e where e.contact_id = p_contact), '[]'::jsonb);
end $$;
revoke execute on function admin_crm_events(uuid) from public, anon;
grant execute on function admin_crm_events(uuid) to authenticated;

-- Créer (p_id nul) ou modifier un contact : seuls les champs donnés dans p_data changent
create or replace function admin_crm_save(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare k crm_contacts; d jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_id is null then
    if char_length(trim(coalesce(d->>'org', ''))) = 0 then raise exception 'Indique le club ou l''organisation'; end if;
    insert into crm_contacts(org) values (left(trim(d->>'org'), 120)) returning * into k;
    perform admin_note('contact CRM créé', null, jsonb_build_object('contact', k.id));
  else
    select * into k from crm_contacts where id = p_id;
    if k.id is null then raise exception 'Contact introuvable'; end if;
  end if;
  if d ? 'stage' and (d->>'stage') not in ('a_contacter', 'contacte', 'presentation', 'test', 'payant', 'perdu') then raise exception 'Étape inconnue'; end if;
  if d ? 'interest' and (d->>'interest')::int not between 0 and 3 then raise exception 'Intérêt entre 0 et 3'; end if;
  update crm_contacts set
    org = case when d ? 'org' and char_length(trim(d->>'org')) > 0 then left(trim(d->>'org'), 120) else org end,
    contact_name = case when d ? 'contact_name' then left(trim(coalesce(d->>'contact_name', '')), 120) else contact_name end,
    contact_role = case when d ? 'contact_role' then left(trim(coalesce(d->>'contact_role', '')), 80) else contact_role end,
    contact_email = case when d ? 'contact_email' then left(trim(coalesce(d->>'contact_email', '')), 200) else contact_email end,
    sport = case when d ? 'sport' then left(trim(coalesce(d->>'sport', '')), 40) else sport end,
    city = case when d ? 'city' then left(trim(coalesce(d->>'city', '')), 80) else city end,
    club_id = case when d ? 'club_id' then nullif(d->>'club_id', '')::uuid else club_id end,
    stage = case when d ? 'stage' then d->>'stage' else stage end,
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

-- Ajouter un échange ; en option, fixer la prochaine relance et l'étape en même temps
create or replace function admin_crm_event_add(p_contact uuid, p_kind text, p_summary text, p_at timestamptz default now(), p_next_at date default null, p_next_action text default null, p_stage text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if not exists(select 1 from crm_contacts where crm_contacts.id = p_contact) then raise exception 'Contact introuvable'; end if;
  if p_kind not in ('mail_envoye', 'mail_recu', 'presentation_live', 'presentation_visio', 'proposition', 'devis', 'appel', 'note', 'autre') then raise exception 'Type d''échange inconnu'; end if;
  if p_stage is not null and p_stage not in ('a_contacter', 'contacte', 'presentation', 'test', 'payant', 'perdu') then raise exception 'Étape inconnue'; end if;
  insert into crm_events(contact_id, at, kind, summary) values (p_contact, coalesce(p_at, now()), p_kind, left(trim(coalesce(p_summary, '')), 1000)) returning crm_events.id into id;
  update crm_contacts set updated_at = now(),
    next_at = case when p_next_at is not null then p_next_at else next_at end,
    next_action = case when p_next_action is not null then left(trim(p_next_action), 200) else next_action end,
    stage = coalesce(p_stage, stage)
  where crm_contacts.id = p_contact;
  return id;
end $$;
revoke execute on function admin_crm_event_add(uuid, text, text, timestamptz, date, text, text) from public, anon;
grant execute on function admin_crm_event_add(uuid, text, text, timestamptz, date, text, text) to authenticated;

-- « Fait » sur une relance : un échange est noté, la relance est effacée
create or replace function admin_crm_relance_done(p_contact uuid, p_summary text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k crm_contacts;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into k from crm_contacts where id = p_contact;
  if k.id is null then raise exception 'Contact introuvable'; end if;
  insert into crm_events(contact_id, kind, summary) values (p_contact, 'note', left(coalesce(nullif(trim(p_summary), ''), 'Relance faite : ' || k.next_action), 1000));
  update crm_contacts set next_at = null, next_action = '', updated_at = now() where id = p_contact;
end $$;
revoke execute on function admin_crm_relance_done(uuid, text) from public, anon;
grant execute on function admin_crm_relance_done(uuid, text) to authenticated;

-- Effacer un contact et ses échanges (droit d'effacement d'une personne contactée)
create or replace function admin_crm_delete(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from crm_contacts where id = p_contact;
  perform admin_note('contact CRM effacé', null, jsonb_build_object('contact', p_contact));
end $$;
revoke execute on function admin_crm_delete(uuid) from public, anon;
grant execute on function admin_crm_delete(uuid) to authenticated;

-- Chiffres du cockpit : étapes, relances à venir, outils actuels, présentations des 30 derniers jours
create or replace function admin_crm_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select jsonb_build_object(
    'total', (select count(*) from crm_contacts),
    'stages', coalesce((select jsonb_object_agg(s, n) from (select stage s, count(*) n from crm_contacts group by stage) t), '{}'::jsonb),
    'late', (select count(*) from crm_contacts where next_at is not null and next_at < current_date and stage <> 'perdu'),
    'today', (select count(*) from crm_contacts where next_at = current_date and stage <> 'perdu'),
    'relances', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'org', org, 'next_at', next_at, 'next_action', next_action) order by next_at, org)
        from (select id, org, next_at, next_action from crm_contacts where next_at is not null and next_at <= current_date + 14 and stage <> 'perdu' order by next_at, org limit 8) z), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('tool', t, 'n', n) order by n desc, t) from (
        select case when trim(current_tool) = '' then 'Pas renseigné' else initcap(lower(trim(current_tool))) end t, count(*) n
        from crm_contacts where stage <> 'perdu' group by 1) q), '[]'::jsonb),
    'presentations30', (select count(*) from crm_events where kind in ('presentation_live', 'presentation_visio') and at > now() - interval '30 days')) into r;
  return r;
end $$;
revoke execute on function admin_crm_overview() from public, anon;
grant execute on function admin_crm_overview() to authenticated;

-- ---------- Ce qui sert et ce qui ne sert pas ----------
-- Pour chaque fonction : combien de clubs (non supprimés) l'ont utilisée dans les 30 derniers jours. Des nombres seulement :
-- jamais un titre, un message, un nom de joueur ou le contenu d'un club.
create or replace function admin_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '30 days'; r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  with live as (select id from clubs where deleted_at is null),
  u(k, club_id) as (
              select 'agenda',      club_id from events where created_at > since
    union all select 'appel',       e.club_id from attendance a join events e on e.id = a.event_id where a.marked_at > since
    union all select 'messages',    g.club_id from messages m join groups g on g.id = m.group_id where m.created_at > since
    union all select 'convocations', club_id from convocation_sends where sent_at > since
    union all select 'annonces',    club_id from announcements where created_at > since and deleted_at is null
    union all select 'exercices',   club_id from exercises where created_at > since and deleted_at is null
    union all select 'ia',          club_id from exercises where created_at > since and deleted_at is null and origin = 'ia'
    union all select 'tactiques',   club_id from tactics where created_at > since and deleted_at is null
    union all select 'seances',     club_id from training_plans where created_at > since and deleted_at is null
    union all select 'cotisations', p.club_id from player_payments pp join players p on p.id = pp.player_id where pp.paid_at > since
    union all select 'benevoles',   e.club_id from event_missions m join events e on e.id = m.event_id where m.created_at > since
    union all select 'heures',      club_id from coach_hours where created_at > since)
  select jsonb_build_object('clubs', (select count(*) from live),
    'feats', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k) from (
       select u.k, count(distinct u.club_id) n from u join live l on l.id = u.club_id group by u.k) q), '[]'::jsonb)) into r;
  return r;
end $$;
revoke execute on function admin_usage() from public, anon;
grant execute on function admin_usage() to authenticated;

-- ---------- Parc des clubs : une ligne par club, avec son activité des 8 dernières semaines (nombre d'actions, jamais leur contenu) ----------
create or replace function admin_parc() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  with live as (select c.id, c.name, c.sport, c.city, c.created_at from clubs c where c.deleted_at is null),
  act(club_id, at) as (
              select club_id, created_at from events where created_at > now() - interval '56 days'
    union all select e.club_id, a.marked_at from attendance a join events e on e.id = a.event_id where a.marked_at > now() - interval '56 days'
    union all select g.club_id, m.created_at from messages m join groups g on g.id = m.group_id where m.created_at > now() - interval '56 days'),
  wk as (select club_id, least(7, floor(extract(epoch from (now() - at)) / 604800)::int) w, count(*) n from act group by 1, 2)
  select coalesce(jsonb_agg(x order by (x->>'last_at') desc nulls last, x->>'name'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', l.id, 'name', l.name, 'sport', l.sport, 'city', l.city, 'created_at', l.created_at,
      'status', coalesce(s.status, 'test'), 'free_teams', coalesce(s.free_teams, 1),
      'teams', (select count(*) from teams t where t.club_id = l.id),
      'accounts', (select count(distinct m.user_id) from memberships m where m.club_id = l.id and m.status = 'active'),
      'coaches', (select count(distinct m.user_id) from memberships m where m.club_id = l.id and m.role = 'coach' and m.status = 'active'),
      'last_at', (select max(at) from act a where a.club_id = l.id),
      'weeks', (select jsonb_agg(coalesce((select n from wk where wk.club_id = l.id and wk.w = i), 0) order by i desc) from generate_series(0, 7) i)) x
    from live l left join club_subscription s on s.club_id = l.id) q;
  return r;
end $$;
revoke execute on function admin_parc() from public, anon;
grant execute on function admin_parc() to authenticated;

-- ---------- « Dis-le à Claude » : les phrases dictées ou tapées, en attente d'être rangées (Gaël, 17 novembre, 23 h 03) ----------
-- La phrase est gardée telle quelle (pas de son). Claude la lit dans la conversation du projet, prépare la fiche, Gaël valide, puis Claude
-- l'écrit dans le CRM et marque la phrase « rangée ». Rien n'est compris par l'application elle-même (pas d'IA dans l'écran).
create table if not exists crm_inbox (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  status text not null default 'a_ranger' check (status in ('a_ranger', 'range')),
  contact_id uuid references crm_contacts(id) on delete set null,
  done_at timestamptz
);
create index if not exists crm_inbox_open on crm_inbox(at desc) where status = 'a_ranger';
alter table crm_inbox enable row level security;
revoke all on crm_inbox from anon, authenticated;

create or replace function admin_crm_inbox_add(p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Écris ou dicte une phrase'; end if;
  insert into crm_inbox(body) values (left(trim(p_body), 2000)) returning crm_inbox.id into id;
  return id;
end $$;
revoke execute on function admin_crm_inbox_add(text) from public, anon;
grant execute on function admin_crm_inbox_add(text) to authenticated;

create or replace function admin_crm_inbox_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'at', i.at, 'body', i.body) order by i.at desc)
    from (select * from crm_inbox where status = 'a_ranger' order by at desc limit 50) i), '[]'::jsonb);
end $$;
revoke execute on function admin_crm_inbox_list() from public, anon;
grant execute on function admin_crm_inbox_list() to authenticated;

-- Retirer une phrase (rangée à la main, ou plus utile) : elle est effacée
create or replace function admin_crm_inbox_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from crm_inbox where id = p_id;
end $$;
revoke execute on function admin_crm_inbox_delete(uuid) from public, anon;
grant execute on function admin_crm_inbox_delete(uuid) to authenticated;

-- ---------- N° 265 : consignes d'une tactique (tapées ou dictées) ----------
alter table tactics add column if not exists notes text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tactics_notes_len') then
    alter table tactics add constraint tactics_notes_len check (char_length(notes) <= 2000);
  end if;
end $$;

select close_visitor_functions();
