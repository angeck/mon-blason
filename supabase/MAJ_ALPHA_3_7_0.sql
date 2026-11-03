-- MAJ_ALPHA_3_7_0.sql · mypocketclub · n° 93 (top 5 des équipes suivies) et n° 96 (demandes d'ajout d'un club) · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.6.0).
-- Sans perte de données, relançable sans risque.

-- mypocketclub · alpha 3.7.0 · n° 93 (top 5 des équipes les plus suivies) et n° 96 (demandes d'ajout d'un club, version test).
-- Les n° 94, 95 et 97 ne touchent pas à la base. Sans perte de données, relançable sans risque.

-- ---------------------------------------------------------------------
-- N° 93 · top 5 des équipes les plus suivies sur l'application
-- Rien tant que l'application compte moins de 10 équipes visibles (ni fantômes, ni archivées, ni à la corbeille)
-- de clubs qui apparaissent dans la recherche des clubs. Seulement : équipe, club, nombre de personnes qui la suivent ;
-- aucun nom de personne (les équipes et les clubs sont déjà visibles dans la recherche publique).
-- ---------------------------------------------------------------------
create or replace function top_followed_teams()
returns table(team_id uuid, team_name text, category text, club_id uuid, club_name text, city text, sport text, logo text, crest_bg text, color1 text, crest_outline text, followers int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from teams t join clubs c on c.id = t.club_id
      where t.state = 'Visible' and t.deleted_at is null and c.public_listed) < 10 then return; end if;
  return query
    select t.id, t.name, t.category, c.id, c.name, c.city, c.sport, c.logo, c.crest_bg, c.color1, c.crest_outline, count(f.user_id)::int
    from teams t join clubs c on c.id = t.club_id join team_follows f on f.team_id = t.id
    where t.state = 'Visible' and t.deleted_at is null and c.public_listed
    group by t.id, t.name, t.category, c.id, c.name, c.city, c.sport, c.logo, c.crest_bg, c.color1, c.crest_outline
    order by count(f.user_id) desc, c.name, t.name
    limit 5;
end $$;
revoke execute on function top_followed_teams() from public, anon;
grant execute on function top_followed_teams() to authenticated;

-- ---------------------------------------------------------------------
-- N° 96 · « Mon club n'est pas dans la liste » : demandes d'ajout d'un club (version test, aucun e-mail envoyé)
-- Écrites seulement par request_club (visiteur non connecté compris), lues seulement par l'administrateur (Gaël).
-- L'adresse IP n'est pas gardée : seulement son empreinte, pour limiter le nombre de demandes.
-- ---------------------------------------------------------------------
create table if not exists club_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null check (length(first_name) between 1 and 60),
  last_name text not null check (length(last_name) between 1 and 60),
  email text not null check (length(email) between 5 and 160),
  club_name text not null check (length(club_name) between 2 and 120),
  city text not null default '' check (length(city) <= 80),
  sport text not null default '' check (length(sport) <= 40),
  age_ok boolean not null default false,
  consent boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  ip_hash text not null default '',
  status text not null default 'new' check (status in ('new','done')),
  done_at timestamptz
);
create index if not exists club_requests_ip on club_requests(ip_hash, created_at);
create index if not exists club_requests_email on club_requests(lower(email), created_at);
alter table club_requests enable row level security;
drop policy if exists "demandes de clubs : administrateur" on club_requests;
create policy "demandes de clubs : administrateur" on club_requests for select using (is_app_admin());

create or replace function request_club(p_first text, p_last text, p_email text, p_club text, p_city text, p_sport text, p_age_ok boolean, p_consent boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ip text := md5(request_ip()); v_email text := lower(trim(coalesce(p_email, '')));
  v_first text := left(trim(coalesce(p_first, '')), 60); v_last text := left(trim(coalesce(p_last, '')), 60);
  v_club text := left(trim(coalesce(p_club, '')), 120); v_city text := left(trim(coalesce(p_city, '')), 80); v_sport text := left(trim(coalesce(p_sport, '')), 40);
  rid uuid; a uuid;
begin
  if v_first = '' or v_last = '' then raise exception 'Prénom et nom obligatoires'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then raise exception 'Adresse e-mail à vérifier'; end if;
  if length(v_club) < 2 then raise exception 'Nom du club obligatoire'; end if;
  if v_city = '' or v_sport = '' then raise exception 'Ville et sport du club obligatoires'; end if;
  if not coalesce(p_age_ok, false) then raise exception 'Moins de 15 ans : un parent fait la demande'; end if;
  if not coalesce(p_consent, false) then raise exception 'L''accord pour transmettre ton nom au club est obligatoire'; end if;
  -- limites : 10 demandes par jour et par adresse IP, 3 par jour et par e-mail
  if (select count(*) from club_requests where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10
     or (select count(*) from club_requests where lower(email) = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Trop de demandes aujourd''hui. Réessaie demain.';
  end if;
  -- même personne, même club, moins de 30 jours : la demande existe déjà
  select id into rid from club_requests
    where lower(email) = v_email and norm_name(club_name) = norm_name(v_club) and norm_name(city) = norm_name(v_city) and created_at > now() - interval '30 days'
    order by created_at desc limit 1;
  if rid is not null then return rid; end if;
  insert into club_requests(first_name, last_name, email, club_name, city, sport, age_ok, consent, user_id, ip_hash)
    values (v_first, v_last, v_email, v_club, v_city, v_sport, true, true, auth.uid(), v_ip) returning id into rid;
  -- notification à l'administrateur (Gaël), avec toutes les informations
  for a in select user_id from app_admins loop
    perform push_enqueue(a, 'Club demandé : ' || left(v_club, 50),
      v_club || ' (' || v_city || ', ' || v_sport || ') · ' || v_first || ' ' || v_last || ' · ' || v_email || ' · simulation',
      'clubreq', 'clubreq:' || rid::text, './');
  end loop;
  return rid;
end $$;
revoke execute on function request_club(text, text, text, text, text, text, boolean, boolean) from public;
grant execute on function request_club(text, text, text, text, text, text, boolean, boolean) to anon, authenticated;

create or replace function set_club_request(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_status not in ('new', 'done') then raise exception 'État inconnu'; end if;
  update club_requests set status = p_status, done_at = case when p_status = 'done' then now() end where id = p_id;
end $$;
revoke execute on function set_club_request(uuid, text) from public, anon;
grant execute on function set_club_request(uuid, text) to authenticated;

select 'mypocketclub alpha 3.7.0 installée' as resultat;
