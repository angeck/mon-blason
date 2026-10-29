-- MAJ_ALPHA_3_0_1.sql · Pocket Club · à lancer une fois dans Supabase > SQL Editor > Run.
-- Met à jour la base 3.0 sans effacer de données. Peut être relancé sans risque.

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

select 'Pocket Club alpha 3.0.1 : mise à jour faite.' as resultat;
