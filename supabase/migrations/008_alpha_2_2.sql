-- ---------- Alpha 2.2 ----------
-- n° 21 : la réponse d'un parent est enregistrée au nom de l'enfant (fiche joueur), une seule réponse par enfant
alter table event_responses add column if not exists player_id uuid references players(id) on delete cascade;
alter table event_responses add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if exists(select 1 from pg_constraint where conname = 'event_responses_pkey' and conrelid = 'event_responses'::regclass
            and array_length(conkey, 1) = 2) then
    alter table event_responses drop constraint event_responses_pkey;
  end if;
  if not exists(select 1 from pg_constraint where contype = 'p' and conrelid = 'event_responses'::regclass) then
    alter table event_responses add constraint event_responses_pkey primary key (id);
  end if;
end $$;
create unique index if not exists event_responses_self on event_responses(event_id, user_id) where player_id is null;
create unique index if not exists event_responses_child on event_responses(event_id, player_id) where player_id is not null;

create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid())) then raise exception 'Ce joueur n''est pas relié à votre compte'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if e.team_id is not null and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_team(e.team_id)
       and not exists(select 1 from memberships where team_id = e.team_id and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and team_id = e.team_id) then
      raise exception 'Vous encadrez cette équipe : pas de réponse pour vous-même';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- Réponses seulement par la fonction (contrôles ci-dessus)
drop policy if exists "chacun répond pour soi" on event_responses;
drop policy if exists "chacun répond pour soi s'il est invité" on event_responses;
drop policy if exists "chacun change sa réponse" on event_responses;
drop policy if exists "chacun retire sa réponse" on event_responses;

-- n° 22 : interrupteur « Tout le club » mémorisé par compte
alter table profiles add column if not exists show_all_club boolean not null default false;
grant update (show_all_club) on profiles to authenticated;
grant select (show_all_club) on profiles to authenticated;

-- n° 23 : une demande en attente ou un rôle actif identique bloque ; rien d'autre
create or replace function join_guard() returns trigger language plpgsql as $$
begin
  if new.role <> 'parent' and exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.user_id and m.role = new.role
       and m.team_id is not distinct from new.team_id and m.id <> new.id) then
    raise exception 'Vous avez déjà ce rôle ou une demande en attente pour ce rôle';
  end if;
  return new;
end $$;
drop trigger if exists join_guard on memberships;
create trigger join_guard before insert on memberships for each row execute function join_guard();

-- Débloque les demandes restées en attente qui auraient dû être accordées tout de suite (président ; bureau qui demande coach)
do $$
declare m record;
begin
  for m in select x.id from memberships x where x.status = 'pending' and (
      exists(select 1 from memberships p where p.club_id = x.club_id and p.user_id = x.user_id and p.status = 'active' and p.role = 'president')
      or (x.role = 'coach' and exists(select 1 from memberships b where b.club_id = x.club_id and b.user_id = x.user_id and b.status = 'active' and b.role = 'bureau'))) loop
    perform activate_membership(m.id, null, null);
  end loop;
end $$;

-- Correctif (tests « vie de club ») : un second parent validé sans choisir la fiche est relié à la fiche existante
-- de l'enfant (même prénom et même nom, accents et majuscules ignorés, même équipe) au lieu d'en créer une seconde.
create or replace function activate_membership(mid uuid, p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; pid uuid; fn text; ln text;
begin
  select * into m from memberships where id = mid;
  if m.id is null then raise exception 'Demande introuvable'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = m.club_id) then raise exception 'Équipe inconnue dans ce club'; end if;
  m.team_id := coalesce(p_team, m.team_id);
  pid := p_player;
  if pid is not null and not exists(select 1 from players where id = pid and club_id = m.club_id) then raise exception 'Fiche joueur inconnue'; end if;
  if pid is null and m.role in ('parent','joueur') then
    if m.role = 'parent' then
      fn := coalesce(nullif(trim(m.child_first), ''), split_part(coalesce(nullif(trim(m.child_name), ''), 'Enfant'), ' ', 1));
      ln := coalesce(nullif(trim(m.child_last), ''), trim(substr(coalesce(m.child_name, ''), length(split_part(coalesce(m.child_name, ''), ' ', 1)) + 1)));
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id is null
        and norm_name(p.first_name) = norm_name(fn) and norm_name(p.last_name) = norm_name(ln)
        and (m.team_id is null or p.team_id = m.team_id or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = m.team_id))
        order by p.created_at limit 1;
    else
      select first_name, last_name into fn, ln from profiles where id = m.user_id;
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id = m.user_id limit 1;
    end if;
    if pid is null then
      insert into players(club_id, team_id, user_id, first_name, last_name, created_by)
        values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, coalesce(nullif(fn, ''), 'Joueur'), coalesce(ln, ''), auth.uid()) returning id into pid;
      insert into player_admin(player_id) values (pid) on conflict do nothing;
    end if;
  end if;
  if m.role = 'parent' and pid is not null then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
  if m.role = 'joueur' and pid is not null then update players set user_id = m.user_id where id = pid and user_id is null; end if;
  update memberships set status = 'active', team_id = m.team_id, player_id = pid,
    child_name = case when pid is not null then null else child_name end,
    child_first = case when pid is not null then null else child_first end,
    child_last = case when pid is not null then null else child_last end
    where id = mid;
end $$;
revoke execute on function activate_membership(uuid, uuid, uuid) from public, anon, authenticated;
