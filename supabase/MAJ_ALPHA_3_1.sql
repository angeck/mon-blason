-- MAJ_ALPHA_3_1.sql · Pocket Club · à lancer une fois dans Supabase > SQL Editor > Run.
-- Met à jour la base (3.0, 3.0.1 ou 3.0.2) sans effacer de données. Contient la 3.0.1 et la 3.0.2. Peut être relancé sans risque.

-- Pocket Club · alpha 3.0.1 · mise à jour de la base (relançable sans risque, ne supprime aucune donnée)
-- N° 29 équipes fantômes · 32 droits en pyramide et journal · 33 versements · 36 messages non lus · 37 contour du blason
-- 38 import de la grille · 39 tarifs réservés au bureau · 40 membres visibles selon le rôle · 41 suivre une équipe · 42 contacts du club
set client_min_messages = warning;

-- =====================================================================
-- Colonnes et tables nouvelles
-- =====================================================================
alter table teams alter column state set default 'Fantôme';                        -- n° 29
alter table group_members add column if not exists last_read_at timestamptz not null default now();   -- n° 36
alter table clubs add column if not exists crest_outline text not null default 'auto';                -- n° 37
do $$ begin alter table clubs add constraint clubs_crest_outline check (crest_outline in ('auto','noir','blanc','aucun')); exception when duplicate_object then null; end $$;

create table if not exists team_follows (                                          -- n° 41
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);
create table if not exists club_contacts (                                         -- n° 42
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  for_licence boolean not null default false,
  for_matches boolean not null default false,
  show_phone boolean not null default false,
  show_email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create table if not exists player_payments (                                       -- n° 33
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  amount numeric(8,2) not null check (amount > 0 and amount < 10000),
  method text check (method is null or length(method) < 40),
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists player_payments_player on player_payments(player_id);
create table if not exists action_log (                                            -- n° 32 : journal des actions sensibles
  id bigint generated always as identity primary key,
  club_id uuid references clubs(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  target_user uuid references auth.users(id) on delete set null,
  target_player uuid references players(id) on delete set null,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists action_log_club on action_log(club_id, at);

-- =====================================================================
-- N° 32 : rang dans le club (président 3, bureau 2, coach 1, autres 0)
-- =====================================================================
create or replace function member_rank(c uuid, u uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(case role when 'president' then 3 when 'bureau' then 2 when 'coach' then 1 else 0 end), 0)
  from memberships where club_id = c and user_id = u and status = 'active';
$$;
create or replace function my_rank(c uuid) returns int language sql stable security definer set search_path = public as $$
  select member_rank(c, auth.uid());
$$;
-- La personne liée à la fiche est-elle sous moi dans la pyramide ? (fiche d'enfant sans compte : toujours oui)
create or replace function outranks_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and (x.user_id is null or x.user_id = auth.uid() or member_rank(x.club_id, x.user_id) < my_rank(x.club_id)));
$$;
create or replace function can_admin_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and x.deleted_at is null and is_board(x.club_id)) and outranks_player(p);
$$;
create or replace function log_action(c uuid, tu uuid, tp uuid, act text, det jsonb) returns void language sql security definer set search_path = public as $$
  insert into action_log(club_id, actor, target_user, target_player, action, detail) values (c, auth.uid(), tu, tp, act, det);
$$;
revoke execute on function log_action(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- =====================================================================
-- N° 29 et 41 : qui fait partie d'une équipe, qui voit un rendez-vous
-- =====================================================================
-- Une équipe fantôme n'existe pas encore pour les familles : seuls ses coachs et le bureau la voient
create or replace function team_visible(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from teams x where x.id = t and x.deleted_at is null and (x.state <> 'Fantôme' or is_board(x.club_id) or coaches_team(x.id)));
$$;
create or replace function in_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and team_visible(t) and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where p.deleted_at is null
              and (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
create or replace function follows_any(ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from team_follows f join teams x on x.id = f.team_id where f.user_id = auth.uid() and f.team_id = any(ts) and x.state <> 'Fantôme' and x.deleted_at is null);
$$;
-- N° 35 : le créateur voit toujours son rendez-vous ; n° 41 : les matchs des équipes suivies
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or e.audience = 'club'
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team(t)))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))));
$$;

drop policy if exists "équipes lisibles par les membres" on teams;
create policy "équipes lisibles par les membres" on teams for select using (is_member(club_id) and deleted_at is null and (state <> 'Fantôme' or is_board(club_id) or coaches_team(id)));

alter table team_follows enable row level security;
drop policy if exists "chacun voit ses équipes suivies" on team_follows;
drop policy if exists "chacun suit une équipe visible" on team_follows;
drop policy if exists "chacun arrête de suivre" on team_follows;
create policy "chacun voit ses équipes suivies" on team_follows for select using (user_id = auth.uid());
create policy "chacun suit une équipe visible" on team_follows for insert with check (user_id = auth.uid() and exists(select 1 from teams x where x.id = team_id and x.state <> 'Fantôme' and x.deleted_at is null and is_member(x.club_id)));
create policy "chacun arrête de suivre" on team_follows for delete using (user_id = auth.uid());

-- Liste des équipes pour tous les membres : coach principal en « Prénom N. », nombres seulement pour qui y a droit (n° 31, 41)
create or replace function club_teams(p_club uuid) returns table(id uuid, name text, category text, gender text, state text, season text, slots text, coach text, coaches int, players int, followed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_club) then return; end if;
  return query
    select t.id, t.name, t.category, t.gender, t.state, t.season, t.slots,
      (select p.first_name || case when p.last_name = '' then '' else ' ' || left(p.last_name, 1) || '.' end from memberships m join profiles p on p.id = m.user_id
         where m.team_id = t.id and m.role = 'coach' and m.status = 'active' order by m.assistant, m.created_at limit 1),
      case when is_board(p_club) or coaches_team(t.id) or in_team(t.id) then (select count(distinct m.user_id)::int from memberships m where m.team_id = t.id and m.role = 'coach' and m.status = 'active') end,
      case when is_board(p_club) or coaches_team(t.id) or in_team(t.id) then (select count(*)::int from players x where x.deleted_at is null and (x.team_id = t.id or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = t.id))) end,
      exists(select 1 from team_follows f where f.team_id = t.id and f.user_id = auth.uid())
    from teams t where t.club_id = p_club and t.deleted_at is null and (t.state <> 'Fantôme' or is_board(p_club) or coaches_team(t.id))
    order by t.name;
end $$;

-- =====================================================================
-- N° 40 : qui voit quels membres
-- =====================================================================
-- Profils : soi ; le bureau de ses clubs ; les membres d'une même équipe ; les membres d'un même groupe
create or replace function can_see_profile(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid()
    or exists(select 1 from memberships a join memberships b on a.club_id = b.club_id
              where a.user_id = auth.uid() and a.status = 'active' and a.role in ('president','bureau') and b.user_id = u)
    or exists(select 1 from memberships b where b.user_id = u and b.team_id is not null and (coaches_team(b.team_id) or (b.status = 'active' and in_team(b.team_id))))
    or exists(select 1 from players x join player_parents pp on pp.player_id = x.id where pp.user_id = u and x.deleted_at is null
              and (coaches_team(x.team_id) or in_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and (coaches_team(pt.team_id) or in_team(pt.team_id)))))
    or exists(select 1 from players x where x.user_id = u and x.deleted_at is null and (coaches_team(x.team_id) or in_team(x.team_id)))
    or exists(select 1 from group_members a join group_members b on a.group_id = b.group_id where a.user_id = auth.uid() and b.user_id = u);
$$;
drop policy if exists "profil lisible par les membres des mêmes clubs" on profiles;
drop policy if exists "profil lisible selon les droits" on profiles;
create policy "profil lisible selon les droits" on profiles for select using (can_see_profile(id));

-- Liste des membres : bureau tout le club ; coach ses équipes ; joueur et parent leur équipe en « Prénom N. » ; supporteur rien
create or replace function club_roster(p_club uuid) returns table(kind text, ref uuid, user_id uuid, first_name text, last_name text, role text, team_id uuid, assistant boolean, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare staff boolean := is_board(p_club);
begin
  if not is_member(p_club) then return; end if;
  return query
    select 'membre', m.id, m.user_id, p.first_name,
      case when staff or coaches_team(m.team_id) or m.user_id = auth.uid() then p.last_name else case when p.last_name = '' then '' else left(p.last_name, 1) || '.' end end,
      m.role, m.team_id, m.assistant, m.created_at
    from memberships m join profiles p on p.id = m.user_id
    where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau','coach')
      and (staff or m.user_id = auth.uid() or (m.team_id is not null and (coaches_team(m.team_id) or in_team(m.team_id))))
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', x.team_id, false, x.created_at
    from players x where x.club_id = p_club and x.deleted_at is null and (staff or can_see_player(x.id) or in_team(x.team_id))
  union all
    select 'joueur', x.id, x.user_id, x.first_name,
      case when staff or can_see_player(x.id) then x.last_name else case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end end,
      'joueur', pt.team_id, false, x.created_at
    from players x join player_teams pt on pt.player_id = x.id where x.club_id = p_club and x.deleted_at is null and (staff or can_see_player(x.id) or in_team(pt.team_id));
end $$;

-- =====================================================================
-- N° 39 : tarifs et documents de tarifs réservés au président et au bureau
-- =====================================================================
drop policy if exists "tarifs lisibles par les membres" on fee_grid;
drop policy if exists "tarifs lisibles par le bureau" on fee_grid;
create policy "tarifs lisibles par le bureau" on fee_grid for select using (is_board(club_id));
drop policy if exists "documents lisibles par les membres" on club_docs;
drop policy if exists "documents lisibles par le bureau" on club_docs;
create policy "documents lisibles par le bureau" on club_docs for select using (is_board(club_id));

-- =====================================================================
-- N° 32 : modification des fiches en pyramide, journal
-- =====================================================================
drop policy if exists "fiche modifiable" on players;
create policy "fiche modifiable" on players for update using (
  deleted_at is null and (user_id = auth.uid() or is_parent_of(id) or (can_manage_player(id) and outranks_player(id))))
  with check (user_id = auth.uid() or is_parent_of(id) or can_manage_player(id));
drop policy if exists "dossier créé par le bureau" on player_admin;
drop policy if exists "dossier saisi par le bureau" on player_admin;
create policy "dossier créé par le bureau" on player_admin for insert with check (can_admin_player(player_id));
create policy "dossier saisi par le bureau" on player_admin for update using (can_admin_player(player_id)) with check (can_admin_player(player_id));
drop policy if exists "réductions : bureau seulement" on player_discount;
create policy "réductions : bureau seulement" on player_discount for all using (can_admin_player(player_id)) with check (can_admin_player(player_id));

-- Fiche d'un membre (bureau, coach, supporteur…) modifiée par quelqu'un au-dessus de lui dans la pyramide
create or replace function update_member_profile(p_club uuid, p_user uuid, p_first text, p_last text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare old profiles;
begin
  if p_user = auth.uid() then raise exception 'Modifie ta propre fiche depuis « Mon compte »'; end if;
  if my_rank(p_club) < 2 or member_rank(p_club, p_user) >= my_rank(p_club) or not exists(select 1 from memberships where club_id = p_club and user_id = p_user) then
    raise exception 'Tu ne peux pas modifier la fiche de cette personne';
  end if;
  if coalesce(trim(p_first), '') = '' then raise exception 'Prénom obligatoire'; end if;
  select * into old from profiles where id = p_user;
  update profiles set first_name = p_first, last_name = coalesce(p_last, ''), phone = nullif(trim(coalesce(p_phone, '')), '') where id = p_user;
  perform log_action(p_club, p_user, null, 'fiche du membre modifiée', jsonb_build_object('avant', jsonb_build_object('prénom', old.first_name, 'nom', old.last_name, 'téléphone', old.phone is not null), 'après', jsonb_build_object('prénom', p_first, 'nom', p_last, 'téléphone', nullif(trim(coalesce(p_phone, '')), '') is not null)));
end $$;

-- Journal : toute modification d'une fiche par quelqu'un d'autre que la personne elle-même
create or replace function log_player_change() returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.player_id, old.player_id); x players;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- dossier : seules les saisies du bureau comptent (pas les recalculs automatiques du montant dû)
  if tg_table_name = 'player_admin' then
    if tg_op = 'INSERT' then return new; end if;
    if to_jsonb(new) - 'fee_amount' - 'fee_paid' - 'updated_at' - 'updated_by' = to_jsonb(old) - 'fee_amount' - 'fee_paid' - 'updated_at' - 'updated_by' then return new; end if;
  end if;
  select * into x from players where id = pid;
  if x.id is not null and x.user_id is distinct from auth.uid() then
    perform log_action(x.club_id, x.user_id, pid, tg_table_name || ' ' || lower(tg_op), case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  end if;
  return coalesce(new, old);
end $$;
create or replace function log_player_fiche() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() and current_setting('pc.trash', true) is distinct from 'on' and current_setting('pc.link', true) is distinct from 'on'
     and (new.first_name, new.last_name, new.birth_date, new.team_id, new.emergency_name, new.emergency_phone, new.consents) is distinct from (old.first_name, old.last_name, old.birth_date, old.team_id, old.emergency_name, old.emergency_phone, old.consents) then
    perform log_action(new.club_id, new.user_id, new.id, 'fiche joueur modifiée', jsonb_build_object('équipe', new.team_id <> old.team_id, 'naissance', new.birth_date is distinct from old.birth_date, 'autorisations', new.consents <> old.consents));
  end if;
  return new;
end $$;
drop trigger if exists log_player_fiche on players;
create trigger log_player_fiche after update on players for each row execute function log_player_fiche();
drop trigger if exists log_player_admin on player_admin;
create trigger log_player_admin after insert or update on player_admin for each row execute function log_player_change();
drop trigger if exists log_player_discount on player_discount;
create trigger log_player_discount after insert or update or delete on player_discount for each row execute function log_player_change();
alter table action_log enable row level security;
drop policy if exists "journal lu par le président" on action_log;
create policy "journal lu par le président" on action_log for select using (is_president(club_id));

-- =====================================================================
-- N° 33 : montant dû calculé, versements, pastille « Payé »
-- =====================================================================
-- Tarif de base : tarif de l'équipe principale s'il existe, sinon celui de sa catégorie (même saison)
create or replace function grid_for(p uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select g.amount from fee_grid g join players x on x.id = p where g.club_id = x.club_id and g.team_id = x.team_id order by g.created_at desc limit 1),
    (select g.amount from fee_grid g join players x on x.id = p join teams t on t.id = x.team_id
       where g.club_id = x.club_id and g.team_id is null and g.season = t.season and g.category = coalesce(nullif(t.category, ''), t.name) order by g.created_at desc limit 1));
$$;
create or replace function due_for(p uuid) returns numeric language sql stable security definer set search_path = public as $$
  select case when grid_for(p) is null then null else greatest(0, grid_for(p) - coalesce((select amount from player_discount where player_id = p), 0)) end;
$$;
-- Le montant dû n'est jamais saisi : il est recalculé, sauf pour une cotisation déjà payée (elle ne change plus)
create or replace function player_admin_compute() returns trigger language plpgsql security definer set search_path = public as $$
declare was_paid boolean := tg_op = 'UPDATE' and old.fee_amount is not null and old.fee_paid >= old.fee_amount;
begin
  new.fee_paid := coalesce((select sum(amount) from player_payments where player_id = new.player_id), 0);
  new.fee_amount := case when was_paid and new.fee_paid >= old.fee_amount then old.fee_amount else due_for(new.player_id) end;
  return new;
end $$;
drop trigger if exists player_admin_compute on player_admin;
create trigger player_admin_compute before insert or update on player_admin for each row execute function player_admin_compute();
-- Recalcul pour tout le club (après un changement de la grille), ou pour un joueur
create or replace function touch_fees(c uuid, p uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into player_admin(player_id) select x.id from players x where (p is null and x.club_id = c or x.id = p) and x.deleted_at is null on conflict do nothing;
  update player_admin a set updated_at = a.updated_at from players x where x.id = a.player_id and (p is null and x.club_id = c or x.id = p);
end $$;
revoke execute on function touch_fees(uuid, uuid) from public, anon, authenticated;
create or replace function fee_grid_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin perform touch_fees(coalesce(new.club_id, old.club_id), null); return null; end $$;
drop trigger if exists fee_grid_changed on fee_grid;
create trigger fee_grid_changed after insert or update or delete on fee_grid for each row execute function fee_grid_changed();
create or replace function fee_player_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'players' then
    if new.team_id is distinct from old.team_id then perform touch_fees(null, new.id); end if;
  else perform touch_fees(null, coalesce(new.player_id, old.player_id)); end if;
  return null;
end $$;
drop trigger if exists fee_player_team on players;
create trigger fee_player_team after update on players for each row execute function fee_player_changed();
drop trigger if exists fee_discount_changed on player_discount;
create trigger fee_discount_changed after insert or update or delete on player_discount for each row execute function fee_player_changed();
drop trigger if exists fee_payment_changed on player_payments;
create trigger fee_payment_changed after insert or delete on player_payments for each row execute function fee_player_changed();

alter table player_payments enable row level security;
drop policy if exists "versements lisibles" on player_payments;
drop policy if exists "versements saisis par le bureau" on player_payments;
drop policy if exists "versements retirés par le bureau" on player_payments;
create policy "versements lisibles" on player_payments for select using (can_see_player(player_id));
create policy "versements saisis par le bureau" on player_payments for insert with check (can_admin_player(player_id) and created_by = auth.uid());
create policy "versements retirés par le bureau" on player_payments for delete using (can_admin_player(player_id));
create or replace function log_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare x players;
begin
  select * into x from players where id = coalesce(new.player_id, old.player_id);
  if auth.uid() is not null then perform log_action(x.club_id, x.user_id, x.id, case when tg_op = 'INSERT' then 'versement ajouté' else 'versement retiré' end, jsonb_build_object('montant', coalesce(new.amount, old.amount))); end if;
  return null;
end $$;
drop trigger if exists log_payment on player_payments;
create trigger log_payment after insert or delete on player_payments for each row execute function log_payment();

-- Pastille « Payé » à la main : le reste est enregistré comme un dernier versement ; annulation : versements retirés
create or replace function mark_paid(p_player uuid, p_paid boolean) returns void language plpgsql security definer set search_path = public as $$
declare a player_admin;
begin
  if not can_admin_player(p_player) then raise exception 'Réservé au président et au bureau'; end if;
  perform touch_fees(null, p_player);
  select * into a from player_admin where player_id = p_player;
  if p_paid then
    if a.fee_amount is null then raise exception 'Montant dû inconnu : ajoute d''abord le tarif de sa catégorie dans la grille'; end if;
    if a.fee_amount > a.fee_paid then insert into player_payments(player_id, amount, method, created_by) values (p_player, a.fee_amount - a.fee_paid, 'Solde validé à la main', auth.uid()); end if;
  else
    delete from player_payments where player_id = p_player;
  end if;
end $$;

-- =====================================================================
-- N° 38 : import de la grille avec remplacement des prix existants
-- p_rows = [{team_id | category, amount, fed}] ; renvoie {updated, added, deleted}
-- =====================================================================
create or replace function import_fee_grid(p_club uuid, p_season text, p_rows jsonb, p_delete_absent boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; up int := 0; ad int := 0; dl int := 0; keep uuid[] := '{}'; gid uuid;
begin
  if not is_board(p_club) then raise exception 'Réservé au président et au bureau'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(team_id uuid, category text, amount numeric, fed numeric) loop
    if r.amount is null or r.amount < 0 then continue; end if;
    if r.team_id is not null and not exists(select 1 from teams where id = r.team_id and club_id = p_club) then continue; end if;
    select id into gid from fee_grid where club_id = p_club and season = p_season
      and ((r.team_id is not null and team_id = r.team_id) or (r.team_id is null and team_id is null and lower(category) = lower(r.category))) limit 1;
    if gid is null then
      insert into fee_grid(club_id, season, team_id, category, amount, fed_part) values (p_club, p_season, r.team_id, case when r.team_id is null then r.category end, r.amount, r.fed) returning id into gid; ad := ad + 1;
    else
      update fee_grid set amount = r.amount, fed_part = r.fed where id = gid and (amount <> r.amount or fed_part is distinct from r.fed);
      if found then up := up + 1; end if;
    end if;
    keep := keep || gid; gid := null;
  end loop;
  if p_delete_absent then delete from fee_grid where club_id = p_club and season = p_season and not (id = any(keep)); get diagnostics dl = row_count; end if;
  return jsonb_build_object('updated', up, 'added', ad, 'deleted', dl);
end $$;

-- =====================================================================
-- N° 42 : contacts du club
-- =====================================================================
alter table club_contacts enable row level security;
drop policy if exists "chacun voit sa fiche contact" on club_contacts;
drop policy if exists "le bureau gère sa fiche contact" on club_contacts;
create policy "chacun voit sa fiche contact" on club_contacts for select using (user_id = auth.uid());
create policy "le bureau gère sa fiche contact" on club_contacts for all using (user_id = auth.uid()) with check (user_id = auth.uid() and is_board(club_id));
-- Encadré « Contacter le club » : comptes connectés et membres ; coordonnées seulement si la personne l'a choisi
create or replace function club_contacts_list(p_club uuid) returns table(kind text, user_id uuid, name text, fonction text, for_licence boolean, for_matches boolean, phone text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists(select 1 from memberships where club_id = p_club and user_id = auth.uid()) then return; end if;
  return query
    select 'contact', c.user_id, trim(p.first_name || ' ' || p.last_name), case when member_rank(p_club, c.user_id) = 3 then 'Président' else 'Membre du bureau' end,
      c.for_licence, c.for_matches, case when c.show_phone then p.phone end, case when c.show_email then u.email::text end
    from club_contacts c join profiles p on p.id = c.user_id join auth.users u on u.id = c.user_id
    where c.club_id = p_club and (c.for_licence or c.for_matches) and member_rank(p_club, c.user_id) >= 2 and p.deleted_at is null
  union all
    select 'president', m.user_id, trim(p.first_name || ' ' || left(p.last_name, 1) || case when p.last_name = '' then '' else '.' end), 'Président', false, false, null::text, null::text
    from memberships m join profiles p on p.id = m.user_id
    where m.club_id = p_club and m.role = 'president' and m.status = 'active';
end $$;
-- Le message au président passe par un groupe d'échange à deux (créé par le demandeur)
create or replace function message_president(p_club uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare pres uuid; gid uuid; me_name text;
begin
  if not is_member(p_club) then raise exception 'Rejoins le club d''abord'; end if;
  select user_id into pres from memberships where club_id = p_club and role = 'president' and status = 'active' order by created_at limit 1;
  if pres is null then raise exception 'Ce club n''a pas encore de président'; end if;
  if pres = auth.uid() then raise exception 'Tu es le président'; end if;
  select g.id into gid from groups g where g.club_id = p_club and g.created_by = auth.uid() and g.name like 'Message au président%'
    and exists(select 1 from group_members x where x.group_id = g.id and x.user_id = pres) limit 1;
  if gid is not null then return gid; end if;
  select full_name into me_name from profiles where id = auth.uid();
  insert into groups(club_id, name, created_by) values (p_club, 'Message au président · ' || coalesce(me_name, 'membre'), auth.uid()) returning id into gid;
  insert into group_members(group_id, user_id) values (gid, auth.uid()), (gid, pres);
  return gid;
end $$;

-- =====================================================================
-- Ajustements des fonctions existantes
-- =====================================================================
-- N° 39 : le coach ne lit plus la grille, mais la validation d'équipe nouvelle reste au bureau ; rien à changer dans teams_for_code.
-- N° 33 : la création d'une fiche ouvre le dossier (le montant dû est calculé tout seul)
select touch_fees(c.id, null) from clubs c;

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

-- Pocket Club · alpha 3.1 · espace coach (relançable sans risque, ne supprime aucune donnée)
-- Banque d'exercices (Ma banque, Club, Libre) avec garde-fous de droits d'auteur, séances, statistiques de présence, heures des coachs.
set client_min_messages = warning;

-- =====================================================================
-- 1. Exercices
-- =====================================================================
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,               -- club de l'auteur
  created_by uuid references auth.users(id) on delete set null,
  sport text not null default 'Basket-ball' check (sport in ('Basket-ball','Volley-ball','Tous les sports')),
  title text not null check (length(trim(title)) between 2 and 80),
  category text not null default 'Technique' check (category in ('Échauffement','Technique','Tactique','Physique','Jeu','Retour au calme')),
  duration_min int not null default 10 check (duration_min between 1 and 120),
  level text not null default '' check (length(level) <= 40),                  -- ex. « U9 à U13 »
  description text not null default '' check (length(description) <= 4000),
  diagram jsonb not null default '[]'::jsonb check (jsonb_typeof(diagram) = 'array' and jsonb_array_length(diagram) <= 60),
  sharing text not null default 'me' check (sharing in ('me','club','public')),          -- moi seul, mon club, tous les clubs
  public_state text not null default 'none' check (public_state in ('none','pending','validated','refused')),
  origin text not null default 'perso' check (origin in ('perso','adapte','ia')),         -- création, adapté d'une source, préparé avec une IA
  source text not null default '' check (length(source) <= 300),
  certified boolean not null default false,                                     -- « J'ai le droit de partager ce contenu »
  up_count int not null default 0,
  down_count int not null default 0,
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sharing = 'me' or certified),
  check (origin <> 'adapte' or length(trim(source)) > 0)
);
create index if not exists exercises_club on exercises(club_id);
create index if not exists exercises_public on exercises(sharing, public_state) where deleted_at is null;

create table if not exists exercise_votes (
  exercise_id uuid not null references exercises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  up boolean not null,
  at timestamptz not null default now(),
  primary key (exercise_id, user_id)
);
create table if not exists exercise_reports (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 3 and 500),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Qui voit un exercice : l'auteur ; son club s'il est partagé au club ou à tous ; tout compte connecté s'il est public et validé par le bureau
create or replace function can_see_exercise(x uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from exercises e where e.id = x and e.deleted_at is null and (
    e.created_by = auth.uid()
    or (e.sharing in ('club','public') and is_member(e.club_id))
    or (e.sharing = 'public' and e.public_state = 'validated' and auth.uid() is not null)));
$$;

-- Mots qui signalent un contenu copié (droits d'auteur)
create or replace function exercise_text_ok(t text) returns boolean language sql immutable as $$
  select not (lower(coalesce(t, '')) ~ '(©|copyright|tous droits réservés|tous droits reserves|all rights reserved|reproduction interdite|reproduction strictement interdite)');
$$;

create or replace function exercises_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if auth.uid() is not null and not (is_coach_in(new.club_id) or is_board(new.club_id)) then
      raise exception 'Seuls les coachs et le bureau ajoutent des exercices';
    end if;
    new.up_count := 0; new.down_count := 0; new.validated_by := null; new.validated_at := null; new.deleted_at := null; new.deleted_by := null;
  else
    new.created_by := old.created_by; new.club_id := old.club_id; new.created_at := old.created_at;
    if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
      new.up_count := old.up_count; new.down_count := old.down_count;
      new.validated_by := old.validated_by; new.validated_at := old.validated_at;
      new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
    end if;
  end if;
  if not (exercise_text_ok(new.title) and exercise_text_ok(new.description) and exercise_text_ok(new.source)) then
    raise exception 'Texte refusé : il contient une mention de droits d''auteur (©, « tous droits réservés »…). Écris l''exercice avec tes propres mots.';
  end if;
  -- partage public : toujours revu par le bureau du club ; un contenu modifié repasse en attente
  if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
    if new.sharing <> 'public' then new.public_state := 'none';
    elsif tg_op = 'INSERT' or old.sharing <> 'public' or old.public_state = 'none'
      or (new.title, new.description, new.diagram, new.source, new.origin) is distinct from (old.title, old.description, old.diagram, old.source, old.origin) then
      new.public_state := 'pending'; new.validated_by := null; new.validated_at := null;
    else new.public_state := old.public_state;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists exercises_guard on exercises;
create trigger exercises_guard before insert or update on exercises for each row execute function exercises_guard();

-- Pouces : un avis par compte, compteurs tenus par la base
create or replace function exercise_votes_count() returns trigger language plpgsql security definer set search_path = public as $$
declare x uuid := coalesce(new.exercise_id, old.exercise_id);
begin
  perform set_config('pc.exsys', 'on', true);
  update exercises set up_count = (select count(*) from exercise_votes where exercise_id = x and up),
                       down_count = (select count(*) from exercise_votes where exercise_id = x and not up) where id = x;
  perform set_config('pc.exsys', 'off', true);
  return null;
end $$;
drop trigger if exists exercise_votes_count on exercise_votes;
create trigger exercise_votes_count after insert or update or delete on exercise_votes for each row execute function exercise_votes_count();

-- Un signalement sur un exercice public le retire des autres clubs jusqu'à une nouvelle validation du bureau
create or replace function exercise_reported() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('pc.exsys', 'on', true);
  update exercises set public_state = 'pending', validated_by = null, validated_at = null where id = new.exercise_id and public_state = 'validated';
  perform set_config('pc.exsys', 'off', true);
  return null;
end $$;
drop trigger if exists exercise_reported on exercise_reports;
create trigger exercise_reported after insert on exercise_reports for each row execute function exercise_reported();

-- Validation du partage public par le bureau du club de l'auteur
create or replace function validate_exercise(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from exercises where id = p_id and deleted_at is null and sharing = 'public';
  if c is null or not is_board(c) then raise exception 'Seul le bureau du club valide un exercice public'; end if;
  perform set_config('pc.exsys', 'on', true);
  update exercises set public_state = case when p_ok then 'validated' else 'refused' end, validated_by = auth.uid(), validated_at = now() where id = p_id;
  update exercise_reports set handled = true where exercise_id = p_id;
  perform set_config('pc.exsys', 'off', true);
  perform log_action(c, null, null, case when p_ok then 'exercice public validé' else 'exercice public refusé' end, jsonb_build_object('exercice', p_id));
end $$;

-- Suppression d'un exercice (corbeille de 30 jours) : l'auteur, ou le bureau pour un exercice partagé au club
create or replace function trash_exercise(p_id uuid, p_restore boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare e exercises;
begin
  select * into e from exercises where id = p_id;
  if e.id is null or not (e.created_by = auth.uid() or (e.sharing <> 'me' and is_board(e.club_id))) then raise exception 'Suppression impossible'; end if;
  perform set_config('pc.exsys', 'on', true);
  if p_restore then update exercises set deleted_at = null, deleted_by = null where id = p_id;
  else update exercises set deleted_at = now(), deleted_by = auth.uid() where id = p_id and deleted_at is null; end if;
  perform set_config('pc.exsys', 'off', true);
end $$;

alter table exercises enable row level security;
alter table exercise_votes enable row level security;
alter table exercise_reports enable row level security;
drop policy if exists "exercice lisible" on exercises;
create policy "exercice lisible" on exercises for select using (can_see_exercise(id) or created_by = auth.uid() or (deleted_at is not null and sharing <> 'me' and is_board(club_id)));
drop policy if exists "exercice ajouté par un coach ou le bureau" on exercises;
create policy "exercice ajouté par un coach ou le bureau" on exercises for insert with check (is_coach_in(club_id) or is_board(club_id));
drop policy if exists "exercice modifié par son auteur" on exercises;
create policy "exercice modifié par son auteur" on exercises for update using (created_by = auth.uid() and deleted_at is null);
drop policy if exists "avis lisible par son auteur" on exercise_votes;
create policy "avis lisible par son auteur" on exercise_votes for select using (user_id = auth.uid());
drop policy if exists "avis donné sur un exercice visible" on exercise_votes;
create policy "avis donné sur un exercice visible" on exercise_votes for insert with check (user_id = auth.uid() and can_see_exercise(exercise_id));
drop policy if exists "avis changé" on exercise_votes;
create policy "avis changé" on exercise_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid() and can_see_exercise(exercise_id));
drop policy if exists "avis retiré" on exercise_votes;
create policy "avis retiré" on exercise_votes for delete using (user_id = auth.uid());
drop policy if exists "signalement lu par le bureau et son auteur" on exercise_reports;
create policy "signalement lu par le bureau et son auteur" on exercise_reports for select
  using (user_id = auth.uid() or exists(select 1 from exercises e where e.id = exercise_id and is_board(e.club_id)));
drop policy if exists "signalement d'un exercice visible" on exercise_reports;
create policy "signalement d'un exercice visible" on exercise_reports for insert with check (user_id = auth.uid() and can_see_exercise(exercise_id));
drop policy if exists "signalement traité par le bureau" on exercise_reports;
create policy "signalement traité par le bureau" on exercise_reports for update using (exists(select 1 from exercises e where e.id = exercise_id and is_board(e.club_id)));

-- Nom de l'auteur et club pour la banque « Libre » (sans autre donnée personnelle)
create or replace function exercise_authors(p_ids uuid[]) returns table(id uuid, author text, club_name text)
language sql stable security definer set search_path = public as $$
  select e.id, coalesce(nullif(trim(p.first_name || ' ' || left(p.last_name, 1) || case when p.last_name <> '' then '.' else '' end), ''), 'Coach'), c.name
  from exercises e join clubs c on c.id = e.club_id left join profiles p on p.id = e.created_by
  where e.id = any(p_ids) and can_see_exercise(e.id);
$$;

-- =====================================================================
-- 2. Séances (composées depuis la banque, reliées si on veut à un entraînement)
-- =====================================================================
create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 80),
  notes text not null default '' check (length(notes) <= 2000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 30),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_plans_club on training_plans(club_id);
create index if not exists training_plans_event on training_plans(event_id);

create or replace function training_plans_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; new.club_id := old.club_id; end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is distinct from (case when tg_op = 'INSERT' then null else old.team_id end)
     and new.team_id is not null and not (coaches_team(new.team_id) or is_board(new.club_id)) then
    raise exception 'Tu n''encadres pas cette équipe';
  end if;
  if new.event_id is not null and new.event_id is distinct from (case when tg_op = 'INSERT' then null else old.event_id end) then
    if not exists(select 1 from events where id = new.event_id and club_id = new.club_id) then raise exception 'Rendez-vous d''un autre club'; end if;
    if auth.uid() is not null and not can_manage_event(new.event_id) then raise exception 'Tu ne gères pas ce rendez-vous'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists training_plans_guard on training_plans;
create trigger training_plans_guard before insert or update on training_plans for each row execute function training_plans_guard();

alter table training_plans enable row level security;
drop policy if exists "séance lisible par l'encadrement" on training_plans;
create policy "séance lisible par l'encadrement" on training_plans for select
  using (created_by = auth.uid() or is_board(club_id) or (team_id is not null and coaches_team(team_id)));
drop policy if exists "séance créée par un coach ou le bureau" on training_plans;
create policy "séance créée par un coach ou le bureau" on training_plans for insert
  with check (is_coach_in(club_id) or is_board(club_id));
drop policy if exists "séance modifiée par l'encadrement" on training_plans;
create policy "séance modifiée par l'encadrement" on training_plans for update
  using (created_by = auth.uid() or (team_id is not null and coaches_team(team_id)));
drop policy if exists "séance supprimée par l'encadrement" on training_plans;
create policy "séance supprimée par l'encadrement" on training_plans for delete
  using (created_by = auth.uid() or (team_id is not null and coaches_team(team_id)) or is_board(club_id));

-- =====================================================================
-- 3. Statistiques de présence et de réponses (coach de l'équipe et bureau)
-- =====================================================================
-- Seules les séances pointées (appel fait) comptent ; « oui mais absent » = fiabilité
create or replace function team_attendance(p_team uuid, p_from date, p_to date)
returns table(event_id uuid, starts_at timestamptz, title text, type text, player_id uuid, first_name text, last_name text, status text, answer text)
language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  select club_id into c from teams where id = p_team;
  if c is null or not (coaches_team(p_team) or is_board(c)) then raise exception 'Statistiques réservées aux coachs de l''équipe et au bureau'; end if;
  return query
    with ev as (
      select e.id, e.starts_at, e.title, e.type from events e
      where e.club_id = c and p_team = any(e.team_ids) and not e.cancelled and e.type in ('Entraînement','Match','Plateau','Tournoi')
        and e.starts_at >= p_from and e.starts_at < p_to + 1 and e.starts_at < now()
        and exists(select 1 from attendance a where a.event_id = e.id)
    ), pl as (
      select x.id, x.first_name, x.last_name, x.user_id from players x
      where x.deleted_at is null and (x.team_id = p_team or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = p_team))
    )
    select ev.id, ev.starts_at, ev.title, ev.type, pl.id, pl.first_name, pl.last_name,
      a.status,
      coalesce((select r.answer from event_responses r where r.event_id = ev.id and r.player_id = pl.id),
               (select r.answer from event_responses r where r.event_id = ev.id and r.player_id is null and pl.user_id is not null and r.user_id = pl.user_id))
    from ev cross join pl
    left join attendance a on a.event_id = ev.id and a.player_id = pl.id
    order by ev.starts_at, pl.last_name, pl.first_name;
end $$;

create or replace function team_stats(p_team uuid, p_from date, p_to date)
returns table(player_id uuid, first_name text, last_name text, sessions int, present int, late int, absent int, answered int, yes_absent int, no_present int)
language sql stable security definer set search_path = public as $$
  select t.player_id, t.first_name, t.last_name,
    count(t.status)::int,
    count(*) filter (where t.status = 'present')::int,
    count(*) filter (where t.status = 'retard')::int,
    count(*) filter (where t.status = 'absent')::int,
    count(*) filter (where t.status is not null and t.answer is not null)::int,
    count(*) filter (where t.status = 'absent' and t.answer = 'oui')::int,
    count(*) filter (where t.status in ('present','retard') and t.answer = 'non')::int
  from team_attendance(p_team, p_from, p_to) t
  group by t.player_id, t.first_name, t.last_name
  order by t.last_name, t.first_name;
$$;

-- =====================================================================
-- 4. Heures des coachs et relevé mensuel validé par le bureau
-- =====================================================================
create table if not exists coach_hours (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  day date not null,
  minutes int not null check (minutes between 5 and 720),
  kind text not null default 'Entraînement' check (kind in ('Entraînement','Match','Plateau','Tournoi','Réunion','Formation','Autre')),
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists coach_hours_user on coach_hours(club_id, user_id, day);
create unique index if not exists coach_hours_event on coach_hours(user_id, event_id) where event_id is not null;

create table if not exists coach_statements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'submitted' check (status in ('submitted','validated','refused')),
  total_minutes int not null default 0,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  comment text not null default '' check (length(comment) <= 300),
  unique (club_id, user_id, month)
);

-- Un mois envoyé au bureau (ou validé) ne se modifie plus ; un mois refusé redevient modifiable
create or replace function month_locked(c uuid, u uuid, d date) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from coach_statements s where s.club_id = c and s.user_id = u and s.month = date_trunc('month', d)::date and s.status in ('submitted','validated'));
$$;
create or replace function coach_hours_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and month_locked(old.club_id, old.user_id, old.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.club_id := old.club_id; end if;
  if month_locked(new.club_id, new.user_id, new.day) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is not null and not coaches_team(new.team_id) then raise exception 'Tu n''encadres pas cette équipe'; end if;
  if new.day > current_date + 1 then raise exception 'On note les heures une fois faites'; end if;
  return new;
end $$;
drop trigger if exists coach_hours_guard on coach_hours;
create trigger coach_hours_guard before insert or update or delete on coach_hours for each row execute function coach_hours_guard();

alter table coach_hours enable row level security;
alter table coach_statements enable row level security;
drop policy if exists "heures lues par le coach et le bureau" on coach_hours;
create policy "heures lues par le coach et le bureau" on coach_hours for select using (user_id = auth.uid() or is_board(club_id));
drop policy if exists "heures notées par le coach" on coach_hours;
create policy "heures notées par le coach" on coach_hours for insert with check (user_id = auth.uid() and is_coach_in(club_id));
drop policy if exists "heures modifiées par le coach" on coach_hours;
create policy "heures modifiées par le coach" on coach_hours for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "heures retirées par le coach" on coach_hours;
create policy "heures retirées par le coach" on coach_hours for delete using (user_id = auth.uid());
drop policy if exists "relevés lus par le coach et le bureau" on coach_statements;
create policy "relevés lus par le coach et le bureau" on coach_statements for select using (user_id = auth.uid() or is_board(club_id));
-- écriture des relevés : seulement par les fonctions ci-dessous

-- Pré-remplir le mois avec les séances passées de mes équipes (90 min l'entraînement, 120 le match, 240 le plateau ou le tournoi)
create or replace function fill_coach_hours(p_club uuid, p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; n int;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  if month_locked(p_club, auth.uid(), m) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  insert into coach_hours(club_id, user_id, team_id, event_id, day, minutes, kind)
    select p_club, auth.uid(), (select t from unnest(e.team_ids) t where coaches_team(t) limit 1), e.id, (e.starts_at at time zone 'Europe/Paris')::date,
      case e.type when 'Entraînement' then 90 when 'Match' then 120 else 240 end, e.type
    from events e
    where e.club_id = p_club and not e.cancelled and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
      and e.starts_at >= m and e.starts_at < (m + interval '1 month') and e.starts_at < now()
      and not exists(select 1 from coach_hours h where h.user_id = auth.uid() and h.event_id = e.id);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function submit_coach_month(p_club uuid, p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; tot int;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  select coalesce(sum(minutes), 0) into tot from coach_hours where club_id = p_club and user_id = auth.uid() and day >= m and day < m + interval '1 month';
  if tot = 0 then raise exception 'Aucune heure notée ce mois-ci'; end if;
  insert into coach_statements(club_id, user_id, month, status, total_minutes, submitted_at)
    values (p_club, auth.uid(), m, 'submitted', tot, now())
    on conflict (club_id, user_id, month) do update set status = 'submitted', total_minutes = tot, submitted_at = now(), decided_by = null, decided_at = null
    where coach_statements.status = 'refused';
  if not found then raise exception 'Ce mois est déjà envoyé au bureau'; end if;
end $$;

create or replace function decide_coach_month(p_statement uuid, p_ok boolean, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare s coach_statements;
begin
  select * into s from coach_statements where id = p_statement;
  if s.id is null or not is_board(s.club_id) then raise exception 'Validation réservée au président et au bureau'; end if;
  if s.user_id = auth.uid() then raise exception 'On ne valide pas son propre relevé : un autre membre du bureau s''en charge'; end if;
  if s.status <> 'submitted' then raise exception 'Ce relevé est déjà traité'; end if;
  update coach_statements set status = case when p_ok then 'validated' else 'refused' end, decided_by = auth.uid(), decided_at = now(), comment = left(coalesce(p_comment, ''), 300)
    where id = p_statement;
  perform log_action(s.club_id, s.user_id, null, case when p_ok then 'relevé d''heures validé' else 'relevé d''heures refusé' end,
    jsonb_build_object('mois', to_char(s.month, 'YYYY-MM'), 'minutes', s.total_minutes));
end $$;

-- =====================================================================
-- 5. Corbeille du club : les exercices partagés supprimés y apparaissent ; effacement après 30 jours
-- =====================================================================
create or replace function club_trash(p_club uuid) returns table(kind text, id uuid, label text, deleted_at timestamptz, deleted_by text, purge_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_board(p_club) then return; end if;
  return query
    select 'team', t.id, t.name || coalesce(' · ' || nullif(t.season, ''), ''), t.deleted_at, pr.full_name, t.deleted_at + interval '30 days'
      from teams t left join profiles pr on pr.id = t.deleted_by where t.club_id = p_club and t.deleted_at is not null
  union all
    select 'player', x.id, trim(x.first_name || ' ' || x.last_name), x.deleted_at, pr.full_name, x.deleted_at + interval '30 days'
      from players x left join profiles pr on pr.id = x.deleted_by where x.club_id = p_club and x.deleted_at is not null
  union all
    select 'poll', p.id, p.question || ' · ' || g.name, p.deleted_at, pr.full_name, p.deleted_at + interval '30 days'
      from polls p join groups g on g.id = p.group_id left join profiles pr on pr.id = p.deleted_by where g.club_id = p_club and p.deleted_at is not null
  union all
    select 'exercise', e.id, 'Exercice · ' || e.title, e.deleted_at, pr.full_name, e.deleted_at + interval '30 days'
      from exercises e left join profiles pr on pr.id = e.deleted_by where e.club_id = p_club and e.deleted_at is not null and e.sharing <> 'me'
  order by 4 desc;
end $$;

create or replace function restore_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if p_kind = 'exercise' then perform trash_exercise(p_id, true); return; end if;
  perform set_config('pc.trash', 'on', true);
  if p_kind = 'team' then
    select club_id into c from teams where id = p_id and deleted_at is not null;
    if c is null or not is_board(c) then raise exception 'Restauration réservée au président et au bureau'; end if;
    update teams set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'player' then
    select club_id into c from players where id = p_id and deleted_at is not null;
    if c is null or not is_board(c) then raise exception 'Restauration réservée au président et au bureau'; end if;
    update players set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_kind = 'poll' then
    select g.club_id into c from polls p join groups g on g.id = p.group_id where p.id = p_id and p.deleted_at is not null;
    if c is null or not (is_board(c) or can_delete_poll(p_id)) then raise exception 'Restauration impossible'; end if;
    update polls set deleted_at = null, deleted_by = null where id = p_id;
  else raise exception 'Élément inconnu';
  end if;
  perform set_config('pc.trash', 'off', true);
end $$;

create or replace function purge_trash() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; u uuid; lim timestamptz := now() - interval '30 days';
begin
  delete from memberships where role = 'coach' and team_id in (select id from teams where deleted_at < lim);
  update events set team_ids = (select coalesce(array_agg(t), '{}') from unnest(team_ids) t where t not in (select id from teams where deleted_at < lim))
    where team_ids && array(select id from teams where deleted_at < lim);
  delete from events where audience = 'team' and cardinality(team_ids) = 0;
  delete from teams where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from players where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from poll_votes where poll_id in (select id from polls where deleted_at < lim);
  delete from exercises where deleted_at < lim; get diagnostics k = row_count; n := n + k;
  delete from training_plans where deleted_at < lim;
  delete from join_attempts where at < now() - interval '1 day';
  for u in select id from profiles where deleted_at < lim loop
    begin
      delete from auth.users where id = u;
    exception when others then
      update profiles set first_name = 'Compte', last_name = 'supprimé', nickname = null, phone = null, deleted_snapshot = null where id = u;
      delete from player_parents where user_id = u; delete from group_members where user_id = u; delete from memberships where user_id = u;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function exercise_votes_count() from public, anon, authenticated;
revoke execute on function exercise_reported() from public, anon, authenticated;

select 'Pocket Club alpha 3.1 : mise à jour faite.' as resultat;
