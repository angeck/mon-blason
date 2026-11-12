-- MAJ_ALPHA_5_7_0.sql · mypocketclub · attestations de paiement (n° 204 et 207) · à lancer une fois dans Supabase > SQL Editor > Run (après la 5.6.0).
-- Sans perte de données, relançable sans risque. Rien à redéployer. Les n° 205 et 206 n'ont besoin d'aucun script.

-- mypocketclub · alpha 5.7.0 · mise à jour d'une base 5.6.0, sans perte de données, relançable.
--   N° 204 · justificatif d'adhésion sur le modèle de Boissy : coordonnées et identifiant du club (SIRET ou RNA), pied de page,
--            image du cachet (président) ; signature en image de chaque personne qui délivre (gardée avec son compte) ;
--            demandeur choisi avant le PDF et inscrit au journal.
--   N° 207 · « Demander une attestation » depuis Mon compte : le parent (ou le joueur majeur) demande ; la trésorerie ou le président
--            délivre (PDF gardé jusqu'à la fin de la saison) ou refuse avec un motif ; une demande en attente par joueur et par saison.
--   (N° 205 et 206 : application seulement.)
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. Coordonnées du club pour les attestations (président : écrit ; président et trésorerie : lu)
-- ---------------------------------------------------------------------
create table if not exists club_legal (
  club_id uuid primary key references clubs(id) on delete cascade,
  legal_id text not null default '' check (length(legal_id) <= 30),
  address text not null default '' check (length(address) <= 200),
  phone text not null default '' check (length(phone) <= 30),
  email text not null default '' check (length(email) <= 120),
  footer text not null default '' check (length(footer) <= 400),
  stamp text check (stamp is null or (stamp like 'data:image/jpeg;base64,%' and length(stamp) <= 400000)),
  updated_at timestamptz not null default now()
);
alter table club_legal enable row level security;
revoke all on club_legal from anon, authenticated;

create or replace function attestation_settings(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l club_legal; c clubs;
begin
  if not (is_president(p_club) or has_area(p_club, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  select * into c from clubs where id = p_club;
  select * into l from club_legal where club_id = p_club;
  return jsonb_build_object('legal_id', coalesce(l.legal_id, ''), 'address', coalesce(l.address, ''), 'phone', coalesce(l.phone, ''),
    'email', coalesce(l.email, ''), 'footer', coalesce(l.footer, ''), 'stamp', l.stamp, 'city', coalesce(c.city, ''));
end $$;
revoke execute on function attestation_settings(uuid) from public, anon;
grant execute on function attestation_settings(uuid) to authenticated;

create or replace function set_attestation_settings(p_club uuid, p_legal_id text, p_address text, p_phone text, p_email text, p_footer text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Réservé au président'; end if;
  insert into club_legal(club_id, legal_id, address, phone, email, footer, updated_at)
    values (p_club, left(trim(coalesce(p_legal_id, '')), 30), left(trim(coalesce(p_address, '')), 200), left(trim(coalesce(p_phone, '')), 30),
            left(trim(coalesce(p_email, '')), 120), left(trim(coalesce(p_footer, '')), 400), now())
    on conflict (club_id) do update set legal_id = excluded.legal_id, address = excluded.address, phone = excluded.phone,
      email = excluded.email, footer = excluded.footer, updated_at = now();
  perform log_action(p_club, null, null, 'coordonnées des attestations modifiées', '{}'::jsonb);
end $$;
revoke execute on function set_attestation_settings(uuid, text, text, text, text, text) from public, anon;
grant execute on function set_attestation_settings(uuid, text, text, text, text, text) to authenticated;

-- Cachet du club (image JPEG convertie dans l'application) ; null = retiré
create or replace function set_club_stamp(p_club uuid, p_img text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Réservé au président'; end if;
  if p_img is not null and (p_img not like 'data:image/jpeg;base64,%' or length(p_img) > 400000) then raise exception 'Image du cachet trop lourde ou illisible'; end if;
  insert into club_legal(club_id, stamp, updated_at) values (p_club, p_img, now())
    on conflict (club_id) do update set stamp = excluded.stamp, updated_at = now();
  perform log_action(p_club, null, null, case when p_img is null then 'cachet du club retiré' else 'cachet du club déposé' end, '{}'::jsonb);
end $$;
revoke execute on function set_club_stamp(uuid, text) from public, anon;
grant execute on function set_club_stamp(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Signature en image, gardée avec le compte de la personne (jamais visible des autres membres)
-- ---------------------------------------------------------------------
create table if not exists user_signatures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  img text not null check (img like 'data:image/jpeg;base64,%' and length(img) <= 300000),
  updated_at timestamptz not null default now()
);
alter table user_signatures enable row level security;
revoke all on user_signatures from anon, authenticated;

create or replace function my_signature() returns text
language sql stable security definer set search_path = public as $$
  select img from user_signatures where user_id = auth.uid();
$$;
revoke execute on function my_signature() from public, anon;
grant execute on function my_signature() to authenticated;

create or replace function set_my_signature(p_img text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if p_img is null then delete from user_signatures where user_id = auth.uid(); return; end if;
  if p_img not like 'data:image/jpeg;base64,%' or length(p_img) > 300000 then raise exception 'Image de la signature trop lourde ou illisible'; end if;
  insert into user_signatures(user_id, img, updated_at) values (auth.uid(), p_img, now())
    on conflict (user_id) do update set img = excluded.img, updated_at = now();
end $$;
revoke execute on function set_my_signature(text) from public, anon;
grant execute on function set_my_signature(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Données du justificatif (remplace l'usage de membership_attestation, gardée pour les anciennes versions de l'application)
-- ---------------------------------------------------------------------
create or replace function attestation_data(p_player uuid, p_requester text, p_legal_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl players; c clubs; t teams; l club_legal; paid numeric; pays jsonb; fn text; me text; who text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into pl from players where id = p_player and deleted_at is null;
  if pl.id is null then raise exception 'Fiche introuvable'; end if;
  if not (is_president(pl.club_id) or has_area(pl.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if pl.from_partner then raise exception 'Ce joueur est licencié dans le club partenaire'; end if;
  select coalesce(sum(amount), 0), coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_at', paid_at, 'method', method) order by paid_at), '[]'::jsonb)
    into paid, pays from player_payments where player_id = pl.id;
  if paid <= 0 then raise exception 'Aucun versement noté pour ce joueur : pas de justificatif possible'; end if;
  who := nullif(left(trim(coalesce(p_requester, '')), 120), '');
  if who is null then raise exception 'Choisis la personne qui demande le justificatif'; end if;
  select * into c from clubs where id = pl.club_id;
  select * into t from teams where id = pl.team_id;
  select * into l from club_legal where club_id = pl.club_id;
  fn := case when is_president(pl.club_id) then 'Président' else 'Trésorier' end;
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Le responsable du club') into me from profiles where id = auth.uid();
  perform log_action(pl.club_id, null, pl.id, 'justificatif d''adhésion délivré', jsonb_build_object('montant', paid, 'demandeur', who));
  return jsonb_build_object('club', c.name, 'city', c.city, 'sport', c.sport, 'first_name', pl.first_name, 'last_name', pl.last_name,
    'birth_date', pl.birth_date, 'team', coalesce(t.name, ''), 'category', coalesce(t.category, t.name, ''), 'season', coalesce(t.season, season_label(now())),
    'paid', paid, 'payments', pays, 'signer', me, 'signer_role', fn, 'requester', who,
    'legal_id', coalesce(nullif(left(trim(coalesce(p_legal_id, '')), 30), ''), l.legal_id, ''),
    'address', coalesce(l.address, ''), 'phone', coalesce(l.phone, ''), 'email', coalesce(l.email, ''), 'footer', coalesce(l.footer, ''),
    'stamp', l.stamp, 'signature', (select img from user_signatures where user_id = auth.uid()));
end $$;
revoke execute on function attestation_data(uuid, text, text) from public, anon;
grant execute on function attestation_data(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. N° 207 · demandes d'attestation
-- ---------------------------------------------------------------------
create table if not exists attestation_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete cascade,
  season text not null,
  status text not null default 'attente' check (status in ('attente', 'delivree', 'refusee')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  reason text check (reason is null or length(reason) <= 200),
  pdf text check (pdf is null or length(pdf) <= 2000000)
);
create unique index if not exists attestation_requests_open on attestation_requests(player_id, season) where status = 'attente';
create index if not exists attestation_requests_club on attestation_requests(club_id, status);
alter table attestation_requests enable row level security;   -- lecture et écriture seulement par les fonctions ci-dessous
revoke all on attestation_requests from anon, authenticated;

-- Qui peut demander pour ce joueur : un parent relié, ou le joueur lui-même s'il est majeur (date de naissance connue)
create or replace function can_request_attestation(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from players p where p.id = p_player and p.deleted_at is null and not p.from_partner and (
    exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid())
    or (p.user_id = auth.uid() and p.birth_date is not null and p.birth_date <= current_date - interval '18 years')));
$$;
revoke execute on function can_request_attestation(uuid) from public, anon, authenticated;

-- Les demandes des saisons passées sont effacées (le PDF reste disponible jusqu'à la fin de la saison)
create or replace function attestation_tidy() returns void
language sql security definer set search_path = public as $$
  delete from attestation_requests where season <> season_label(now()) and created_at < season_start(now());
$$;
revoke execute on function attestation_tidy() from public, anon, authenticated;

-- Joueurs pour qui je peux demander : avec au moins un versement noté, et l'état de la demande de la saison
create or replace function my_attestation_players() returns table(player_id uuid, club_id uuid, club_name text, first_name text, last_name text, request_id uuid, status text, reason text, decided_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform attestation_tidy();
  return query select p.id, p.club_id, c.name, p.first_name, p.last_name, r.id, r.status, r.reason, r.decided_at
    from players p join clubs c on c.id = p.club_id
    left join lateral (select * from attestation_requests x where x.player_id = p.id and x.season = season_label(now()) and x.requested_by = auth.uid()
                       order by x.created_at desc limit 1) r on true
    where can_request_attestation(p.id) and c.deleted_at is null and exists(select 1 from player_payments y where y.player_id = p.id)
    order by c.name, p.first_name;
end $$;
revoke execute on function my_attestation_players() from public, anon;
grant execute on function my_attestation_players() to authenticated;

create or replace function request_attestation(p_player uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl players; rid uuid; who text; u uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  if not can_request_attestation(p_player) then raise exception 'Seul un parent relié, ou le joueur majeur, demande une attestation'; end if;
  select * into pl from players where id = p_player;
  if not exists(select 1 from player_payments where player_id = p_player) then raise exception 'Aucun versement noté pour ce joueur : le club ne peut pas encore délivrer d''attestation'; end if;
  perform attestation_tidy();
  if exists(select 1 from attestation_requests where player_id = p_player and season = season_label(now()) and status = 'attente') then
    raise exception 'Une demande est déjà en attente pour ce joueur';
  end if;
  insert into attestation_requests(club_id, player_id, requested_by, season) values (pl.club_id, p_player, auth.uid(), season_label(now())) returning id into rid;
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Un membre') into who from profiles where id = auth.uid();
  for u in select distinct m.user_id from memberships m where m.club_id = pl.club_id and m.status = 'active' and m.user_id is not null
             and (m.role = 'president' or 'tresorerie' = any(areas_of(pl.club_id, m.user_id))) loop
    perform push_enqueue(u, 'Attestation demandée', who || ' demande une attestation de paiement pour ' || pl.first_name || '.', 'attest', 'attreq:' || rid || ':' || u, './');
  end loop;
  return rid;
end $$;
revoke execute on function request_attestation(uuid) from public, anon;
grant execute on function request_attestation(uuid) to authenticated;

-- Pour la trésorerie et le président : les demandes de la saison
create or replace function club_attestation_requests(p_club uuid) returns table(id uuid, player_id uuid, first_name text, last_name text, requested_by uuid, requester_name text, status text, reason text, created_at timestamptz, decided_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not (is_president(p_club) or has_area(p_club, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  perform attestation_tidy();
  return query select r.id, r.player_id, p.first_name, p.last_name, r.requested_by,
      coalesce(nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''), 'Membre'), r.status, r.reason, r.created_at, r.decided_at
    from attestation_requests r join players p on p.id = r.player_id left join profiles pr on pr.id = r.requested_by
    where r.club_id = p_club and r.season = season_label(now())
    order by (r.status = 'attente') desc, r.created_at desc limit 100;
end $$;
revoke execute on function club_attestation_requests(uuid) from public, anon;
grant execute on function club_attestation_requests(uuid) to authenticated;

create or replace function deliver_attestation(p_id uuid, p_pdf text) returns void
language plpgsql security definer set search_path = public as $$
declare r attestation_requests; pn text;
begin
  select * into r from attestation_requests where id = p_id;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  if not (is_president(r.club_id) or has_area(r.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if r.status <> 'attente' then raise exception 'Demande déjà traitée'; end if;
  if p_pdf is null or p_pdf not like 'JVBERi0%' or length(p_pdf) > 2000000 then raise exception 'PDF illisible ou trop lourd'; end if;   -- « %PDF- » en base64
  update attestation_requests set status = 'delivree', pdf = p_pdf, decided_by = auth.uid(), decided_at = now(), reason = null where id = p_id;
  select first_name into pn from players where id = r.player_id;
  perform log_action(r.club_id, r.requested_by, r.player_id, 'attestation de paiement délivrée sur demande', '{}'::jsonb);
  if r.requested_by is not null then
    perform push_enqueue(r.requested_by, 'Attestation prête', 'L''attestation de paiement de ' || coalesce(pn, 'ton enfant') || ' est dans Mon compte.', 'attest', 'attok:' || p_id, './');
  end if;
end $$;
revoke execute on function deliver_attestation(uuid, text) from public, anon;
grant execute on function deliver_attestation(uuid, text) to authenticated;

create or replace function refuse_attestation(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r attestation_requests; why text := nullif(left(trim(coalesce(p_reason, '')), 200), '');
begin
  select * into r from attestation_requests where id = p_id;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  if not (is_president(r.club_id) or has_area(r.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if r.status <> 'attente' then raise exception 'Demande déjà traitée'; end if;
  if why is null then raise exception 'Indique un motif court'; end if;
  update attestation_requests set status = 'refusee', reason = why, decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform log_action(r.club_id, r.requested_by, r.player_id, 'demande d''attestation refusée', jsonb_build_object('motif', why));
  if r.requested_by is not null then
    perform push_enqueue(r.requested_by, 'Attestation refusée', why, 'attest', 'attno:' || p_id, './');
  end if;
end $$;
revoke execute on function refuse_attestation(uuid, text) from public, anon;
grant execute on function refuse_attestation(uuid, text) to authenticated;

-- Le PDF : pour la personne qui a demandé, et pour la trésorerie et le président du club
create or replace function attestation_pdf(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare r attestation_requests;
begin
  select * into r from attestation_requests where id = p_id;
  if r.id is null or r.status <> 'delivree' then raise exception 'Attestation introuvable'; end if;
  if not (r.requested_by = auth.uid() or is_president(r.club_id) or has_area(r.club_id, 'tresorerie')) then raise exception 'Attestation introuvable'; end if;
  return r.pdf;
end $$;
revoke execute on function attestation_pdf(uuid) from public, anon;
grant execute on function attestation_pdf(uuid) to authenticated;

select close_visitor_functions();
