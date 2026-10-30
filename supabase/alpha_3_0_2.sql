-- Pocket Club · alpha 3.0.2 · mise à jour de la base (relançable sans risque, ne supprime aucune donnée)
-- N° 49 page d'accueil publique : recherche de clubs, page d'un club pour un visiteur, rejoindre sans code
-- N° 50 groupes triés par dernier message
set client_min_messages = warning;

-- =====================================================================
-- N° 49 · réglages du club : apparaître dans la recherche (président), code postal
-- =====================================================================
alter table clubs add column if not exists public_listed boolean not null default true;
alter table clubs add column if not exists postal_code text not null default '';
do $$ begin alter table clubs add constraint clubs_postal_code check (postal_code ~ '^([0-9]{5})?$'); exception when duplicate_object then null; end $$;

create or replace function clubs_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code <> old.join_code then raise exception 'Le code du club ne se modifie pas ainsi'; end if;
  if new.custom_header is distinct from old.custom_header and auth.uid() is not null and not is_president(old.id) then
    raise exception 'Seul le président choisit l''en-tête aux couleurs du club';
  end if;
  if new.public_listed is distinct from old.public_listed and auth.uid() is not null and not is_president(old.id) then
    raise exception 'Seul le président choisit si le club apparaît dans la recherche';
  end if;
  return new;
end $$;

-- Limite des recherches publiques (anti-aspiration) : 30 par minute et par adresse
create table if not exists search_attempts (ip text not null, at timestamptz not null default now());
create index if not exists search_attempts_ip on search_attempts(ip, at);
alter table search_attempts enable row level security;   -- aucune règle : seulement par les fonctions
create or replace function request_ip() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  return coalesce(h->>'cf-connecting-ip', trim(split_part(h->>'x-forwarded-for', ',', 1)), 'inconnu');
end $$;
create or replace function check_search_rate() returns void language plpgsql security definer set search_path = public as $$
declare v_ip text := request_ip();
begin
  if (select count(*) from search_attempts s where s.ip = v_ip and s.at > now() - interval '1 minute') >= 30 then
    raise exception 'Trop de recherches. Réessaie dans une minute.';
  end if;
  insert into search_attempts(ip) values (v_ip);
  if random() < 0.02 then delete from search_attempts where at < now() - interval '1 hour'; end if;
end $$;
revoke execute on function check_search_rate() from public, anon, authenticated;

-- Recherche publique : nom, ville ou code postal ; seulement les champs publics ; jamais les tables complètes
create or replace function public_search_clubs(p_query text, p_sport text default null)
returns table(id uuid, name text, city text, postal_code text, sport text, logo text, crest_bg text, color1 text, crest_outline text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare q text := norm_name(p_query); d text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  if length(q) < 2 then return; end if;
  perform check_search_rate();
  return query
    select c.id, c.name, c.city, c.postal_code, c.sport, c.logo, c.crest_bg, c.color1, c.crest_outline
    from clubs c
    where c.public_listed and (coalesce(p_sport, '') = '' or c.sport = p_sport)
      and (norm_name(c.name) like '%' || q || '%' or norm_name(c.city) like '%' || q || '%'
           or (length(d) >= 2 and c.postal_code <> '' and c.postal_code like d || '%'))
    order by c.name limit 20;
end $$;

-- Page d'un club pour un visiteur : le club, ses équipes visibles et leurs créneaux ; aucun nombre, aucune personne, aucun match
create or replace function public_club(p_club uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform check_search_rate();
  select jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'postal_code', c.postal_code, 'sport', c.sport, 'logo', c.logo,
      'crest_bg', c.crest_bg, 'color1', c.color1, 'crest_outline', c.crest_outline,
      'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'gender', t.gender, 'slots', t.slots) order by t.name)
                         from teams t where t.club_id = c.id and t.state = 'Visible' and t.deleted_at is null), '[]'::jsonb))
    into r from clubs c where c.id = p_club and c.public_listed;
  return r;
end $$;

-- Rejoindre un club trouvé par la recherche, sans retaper son code (mêmes règles que join_club)
create or replace function join_club_by_id(p_club uuid, p_role text, p_team uuid, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select join_code into code from clubs where id = p_club and public_listed;
  if code is null then raise exception 'Ce club se rejoint seulement avec son code : demande-le au club'; end if;
  return join_club(code, p_role, p_team, p_child_first, p_child_last);
end $$;

grant execute on function public_search_clubs(text, text), public_club(uuid) to anon, authenticated;

-- =====================================================================
-- N° 50 · groupes triés par dernier message (un sondage compte comme un message)
-- =====================================================================
alter table groups add column if not exists last_message_at timestamptz;
update groups g set last_message_at = (select max(x.at) from (select created_at as at from messages m where m.group_id = g.id union all select created_at from polls p where p.group_id = g.id) x)
  where last_message_at is null;
create or replace function touch_group() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update groups set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at) where id = new.group_id;
  return null;
end $$;
drop trigger if exists touch_group_msg on messages;
create trigger touch_group_msg after insert on messages for each row execute function touch_group();
drop trigger if exists touch_group_poll on polls;
create trigger touch_group_poll after insert on polls for each row execute function touch_group();

-- Dernier message (ou sondage) de chacun de mes groupes, sans charger tous les messages
create or replace function group_previews(p_club uuid) returns table(group_id uuid, user_id uuid, body text, created_at timestamptz, kind text)
language sql stable security definer set search_path = public as $$
  select distinct on (x.group_id) x.group_id, x.user_id, x.body, x.created_at, x.kind
  from (
    select m.group_id, m.user_id, m.body, m.created_at, 'message' as kind from messages m
    union all
    select p.group_id, p.created_by, p.question, p.created_at, 'sondage' from polls p where p.deleted_at is null
  ) x join groups g on g.id = x.group_id
  where g.club_id = p_club and is_group_member(g.id)
  order by x.group_id, x.created_at desc;
$$;

-- =====================================================================
-- N° 51 · une personne n'est jamais « parent » de sa propre fiche de joueur
-- =====================================================================
delete from player_parents pp using players x where x.id = pp.player_id and x.user_id = pp.user_id;
create or replace function player_parents_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from players where id = new.player_id and user_id = new.user_id) then return null; end if;
  return new;
end $$;
drop trigger if exists player_parents_guard on player_parents;
create trigger player_parents_guard before insert on player_parents for each row execute function player_parents_guard();
