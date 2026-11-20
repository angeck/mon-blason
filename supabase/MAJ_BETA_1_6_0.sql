-- MAJ_BETA_1_6_0.sql · mypocketclub · bêta 1.6.0 (Gaël, 20 novembre 2026)
-- À lancer sur la base de test mpc-test (Supabase › SQL Editor), après la 1.5.1. Il contient un « drop policy »
-- (la règle de lecture des équipes, remplacée aussitôt par la même règle élargie aux ententes) : Supabase demande de confirmer, c'est normal.
-- mypocketclub · bêta 1.6.0 · script idempotent (se relance sans risque)
-- n° 78 : équipe en entente affichée dans les DEUX clubs (règle de Gaël du 12 novembre) :
--   - une fois l'entente acceptée, les membres du club partenaire voient l'équipe, ses rendez-vous d'équipe et y répondent ;
--   - on rejoint l'équipe depuis le club partenaire (coach, joueur, parent) : l'adhésion reste dans SON club, la fiche du joueur aussi ;
--   - le coach du club partenaire a les mêmes droits que celui du club porteur (appel, rendez-vous de l'équipe, effectif) ;
--   - un rendez-vous de club (AG, fête…) ne va qu'aux comptes du club qui l'organise (rien ne change pour eux) ;
--   - le bureau du club porteur voit les fiches de toute l'équipe ; celui du club partenaire ne voit que les siennes ;
--   - pas de groupe de messages entre les deux clubs (rien ne change pour les groupes).
-- Rien n'est effacé. Avis « Légal » et texte « Ententes » de « Vos données » à valider par Gaël avant le vrai site.

-- ---------- outils ----------
-- Club partenaire d'une équipe en entente acceptée (sinon null)
create or replace function entente_club(t uuid) returns uuid language sql stable security definer set search_path = public as $$
  select partner_club_id from teams where id = t and deleted_at is null and partner_state = 'acceptee';
$$;
-- L'équipe sert-elle dans ce club ? (son équipe, ou une équipe d'un autre club en entente acceptée avec lui)
create or replace function team_in_club(t uuid, c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and c is not null and exists(select 1 from teams x where x.id = t and x.deleted_at is null
    and (x.club_id = c or (x.partner_state = 'acceptee' and x.partner_club_id = c)));
$$;
-- La personne est-elle membre du club partenaire d'une de ces équipes ?
create or replace function entente_member_any(ts uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from unnest(coalesce(ts, '{}')) t where is_member(entente_club(t)));
$$;
revoke execute on function entente_club(uuid), team_in_club(uuid, uuid), entente_member_any(uuid[]) from public, anon;
grant execute on function entente_club(uuid), team_in_club(uuid, uuid), entente_member_any(uuid[]) to authenticated;

-- ---------- l'équipe se lit dans les deux clubs ----------
drop policy if exists "équipes lisibles par les membres" on teams;
create policy "équipes lisibles par les membres" on teams for select using (deleted_at is null and (
  (is_member(club_id) and (state <> 'Fantôme' or is_board(club_id) or coaches_team(id)))
  or (partner_state = 'acceptee' and is_member(partner_club_id) and (state <> 'Fantôme' or is_board(partner_club_id) or coaches_team(id)))));

-- Liste des équipes d'un club (écran Club, onglet Équipe) : les équipes en entente acceptée y figurent aussi
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
    from teams t where t.deleted_at is null and (t.club_id = p_club or (t.partner_state = 'acceptee' and t.partner_club_id = p_club))
      and (t.state <> 'Fantôme' or is_board(p_club) or coaches_team(t.id))
    order by t.name;
end $$;

-- Nom de l'autre club de chaque équipe en entente acceptée (pastille « Entente · Boissy Basket 91 » dans les deux clubs)
create or replace function entente_names(p_club uuid) returns table(team_id uuid, other_club text, host boolean)
language sql stable security definer set search_path = public as $$
  select t.id, case when t.club_id = p_club then coalesce(nullif(t.partner_name, ''), p.name) else h.name end, t.club_id = p_club
  from teams t join clubs h on h.id = t.club_id left join clubs p on p.id = t.partner_club_id
  where is_member(p_club) and t.deleted_at is null and t.partner_state = 'acceptee' and (t.club_id = p_club or t.partner_club_id = p_club);
$$;
revoke execute on function entente_names(uuid) from public, anon;
grant execute on function entente_names(uuid) to authenticated;

-- ---------- rejoindre l'équipe depuis le club partenaire ----------
create or replace function join_club(p_code text, p_role text, p_team uuid, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; auto boolean;
begin
  perform check_join_rate();
  select id into cid from clubs where join_code = upper(trim(p_code));
  if cid is null then insert into join_attempts(user_id) values (auth.uid()); return null; end if;
  if exists(select 1 from profiles where id = auth.uid() and deleted_at is not null) then raise exception 'Ton compte est en cours de suppression'; end if;
  if p_role not in ('bureau','coach','joueur','parent','supporteur') then raise exception 'Rôle invalide'; end if;
  if p_team is not null and not team_in_club(p_team, cid) then raise exception 'Équipe inconnue'; end if;
  if p_role = 'parent' and coalesce(trim(p_child_first), '') = '' then raise exception 'Indique le prénom de l''enfant'; end if;
  auto := p_role = 'supporteur' or is_president(cid);
  insert into memberships(club_id, user_id, role, team_id, child_first, child_last, status)
    values (cid, auth.uid(), p_role, p_team, nullif(nice_first(p_child_first), ''), nullif(nice_last(p_child_last), ''), 'pending') returning id into mid;
  if auto then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

-- Validation : la fiche du joueur reste dans le club de l'adhésion, avec l'équipe en entente
create or replace function activate_membership(mid uuid, p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships; pid uuid; fn text; ln text;
begin
  select * into m from memberships where id = mid;
  if m.id is null then raise exception 'Demande introuvable'; end if;
  if p_team is not null and not team_in_club(p_team, m.club_id) then raise exception 'Équipe inconnue dans ce club'; end if;
  m.team_id := coalesce(p_team, m.team_id);
  pid := p_player;
  if pid is not null and not exists(select 1 from players where id = pid and club_id = m.club_id and deleted_at is null) then raise exception 'Fiche joueur inconnue'; end if;
  if pid is null and m.role in ('parent','joueur') then
    if m.role = 'parent' then
      fn := coalesce(nullif(trim(m.child_first), ''), 'Enfant');
      ln := coalesce(trim(m.child_last), '');
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id is null and p.deleted_at is null
        and norm_name(p.first_name) = norm_name(fn) and norm_name(p.last_name) = norm_name(ln)
        and (m.team_id is null or p.team_id = m.team_id or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = m.team_id))
        order by p.created_at limit 1;
    else
      select first_name, last_name into fn, ln from profiles where id = m.user_id;
      select p.id into pid from players p where p.club_id = m.club_id and p.user_id = m.user_id and p.deleted_at is null limit 1;
    end if;
    if pid is null then
      insert into players(club_id, team_id, user_id, first_name, last_name, created_by)
        values (m.club_id, m.team_id, case when m.role = 'joueur' then m.user_id end, coalesce(nullif(fn, ''), 'Joueur'), coalesce(ln, ''), auth.uid()) returning id into pid;
      insert into player_admin(player_id) values (pid) on conflict do nothing;
    end if;
  end if;
  if m.role = 'parent' and pid is not null then insert into player_parents values (pid, m.user_id) on conflict do nothing; end if;
  if m.role = 'joueur' and pid is not null then
    perform set_config('pc.link', 'on', true);
    update players set user_id = m.user_id where id = pid and user_id is null;
    perform set_config('pc.link', 'off', true);
  end if;
  update memberships set status = 'active', team_id = m.team_id, player_id = pid,
    child_first = case when pid is not null then null else child_first end,
    child_last = case when pid is not null then null else child_last end
    where id = mid;
end $$;
revoke execute on function activate_membership(uuid, uuid, uuid) from public, anon, authenticated;

-- Écran « Rejoindre » : les équipes en entente acceptée se choisissent aussi depuis le club partenaire
create or replace function teams_for_code(p_code text) returns table(id uuid, name text, club_name text)
language plpgsql security definer set search_path = public as $$
begin
  perform check_join_rate();
  if not exists(select 1 from clubs where join_code = upper(trim(p_code))) then
    insert into join_attempts(user_id) values (auth.uid());
    return;
  end if;
  return query select t.id, t.name, c.name from clubs c
    left join teams t on (t.club_id = c.id or (t.partner_state = 'acceptee' and t.partner_club_id = c.id)) and t.state = 'Visible' and t.deleted_at is null
    where c.join_code = upper(trim(p_code)) order by t.name;
end $$;

create or replace function public_club(p_club uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform check_search_rate();
  select jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'postal_code', c.postal_code, 'sport', c.sport, 'logo', c.logo,
      'crest_bg', c.crest_bg, 'color1', c.color1, 'crest_outline', c.crest_outline,
      'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'gender', t.gender, 'slots', t.slots) order by t.name)
                         from teams t where (t.club_id = c.id or (t.partner_state = 'acceptee' and t.partner_club_id = c.id)) and t.state = 'Visible' and t.deleted_at is null), '[]'::jsonb))
    into r from clubs c where c.id = p_club and c.public_listed;
  return r;
end $$;

-- ---------- fiches des joueurs ----------
-- Le bureau du club porteur voit les fiches de toute l'équipe (joueurs du club partenaire compris) ;
-- le bureau du club partenaire ne voit que les fiches de son club (règle d'avant). Les coachs des deux clubs : toute l'équipe.
create or replace function can_see_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and x.deleted_at is null and (
    x.user_id = auth.uid() or is_parent_of(x.id) or is_board(x.club_id) or coaches_team(x.team_id)
    or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))
    or exists(select 1 from teams t where t.id = x.team_id and t.club_id <> x.club_id and t.partner_state = 'acceptee'
              and t.partner_club_id = x.club_id and is_board(t.club_id))));
$$;

-- ---------- rendez-vous de l'équipe : vus et répondus depuis le club partenaire ----------
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and (
    (is_member(e.club_id) and (
      e.created_by = auth.uid() or is_board(e.club_id)
      or (e.audience = 'club' and (e.with_supporters or has_real_role(e.club_id, auth.uid())))
      or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team_regular(t)))
      or (e.audience = 'team' and reinforcement_invited(e.id))
      or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
      or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
      or (e.audience = 'people' and auth.uid() = any(e.people))
      or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and auth.uid() = any(a.people))))
    -- n° 78 : club partenaire d'une équipe en entente, pour les rendez-vous de cette équipe seulement
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where is_member(entente_club(t)) and (
          in_team_regular(t) or is_board(entente_club(t))
          or (e.type in ('Match','Plateau','Tournoi') and follows_any(array[t])))))));
$$;

-- Création des rendez-vous (seule la première vérification change)
create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  rf uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'reinforcement_players', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  -- n° 78 : le coach du club partenaire crée les rendez-vous de l'équipe en entente (enregistrés au club porteur)
  if auth.uid() is null or not (is_member(c) or (aud = 'team' and entente_member_any(ts))) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home, duration_min, all_day, with_supporters,
                     reinforcements, reinforcement_players)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true),
           case when coalesce((p->>'all_day')::boolean, false) then null else nullif(p->>'duration_min', '')::int end, coalesce((p->>'all_day')::boolean, false),
           case when aud = 'club' then coalesce((p->>'with_supporters')::boolean, false) else true end,
           coalesce(nullif(p->>'reinforcements', ''), 'aucun'), rf
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Un adulte du club partenaire répond pour lui-même (le reste de respond_event ne change pas)
create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid() and deleted_at is null)) then
      raise exception 'Ce joueur n''est pas relié à ton compte';
    end if;
    if cardinality(e.convoked) > 0 and not p_player = any(e.convoked) then raise exception 'Ce joueur n''est pas convoqué à ce rendez-vous'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if not has_real_role(e.club_id, auth.uid()) and not (e.audience = 'people' and auth.uid() = any(e.people))
       and not exists(select 1 from unnest(e.team_ids) t where has_real_role(entente_club(t), auth.uid())) then
      raise exception 'Un supporteur n''a pas de réponse à donner (ou ta demande attend la validation du club)';
    end if;
    if e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
       and not exists(select 1 from memberships where team_id = any(e.team_ids) and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and deleted_at is null and team_id = any(e.team_ids)) then
      raise exception 'Tu encadres cette équipe : pas de réponse pour toi-même';
    end if;
    if e.audience = 'team' and e.type in ('Entraînement','Match','Plateau','Tournoi') and not exists(select 1 from unnest(e.team_ids) t where in_team(t)) then
      raise exception 'Ce rendez-vous concerne une équipe dont tu ne fais pas partie';
    end if;
    if cardinality(e.convoked) > 0 and not exists(select 1 from players x where x.user_id = auth.uid() and x.id = any(e.convoked)) then
      raise exception 'Tu n''es pas convoqué à ce rendez-vous';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- Notifications d'un rendez-vous : les comptes du club partenaire de l'équipe sont aussi prévenus
create or replace function push_event_targets(eid uuid, actor uuid, important boolean, everyone boolean) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; c uuid; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into e from events where id = eid; if e.id is null then return; end if;
  for u, c in select distinct on (m.user_id) m.user_id, m.club_id from memberships m join push_subscriptions s on s.user_id = m.user_id
           where m.status = 'active' and m.user_id is distinct from actor
             and (m.club_id = e.club_id or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where entente_club(t) = m.club_id)))
           order by m.user_id, (m.club_id = e.club_id) desc loop
    perform push_as(u);
    if sees_event(eid)
       and (has_real_role(c, u) or e.audience = 'club' or (e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids)) or u = any(e.people))
       and (not exists(select 1 from event_hidden h where h.event_id = eid and h.user_id = u)
            or (important and exists(select 1 from event_responses r where r.event_id = eid and r.answer = 'oui'
                  and (r.user_id = u or exists(select 1 from player_parents pp where pp.player_id = r.player_id and pp.user_id = u)))))
       and (everyone or cardinality(e.convoked) = 0 or is_board(e.club_id) or coaches_any(e.team_ids) or e.created_by = u
            or exists(select 1 from players p where p.id = any(e.convoked) and p.deleted_at is null
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))
            or not exists(select 1 from players p where p.deleted_at is null
                      and (p.club_id = e.club_id or entente_club(p.team_id) = p.club_id)
                      and (p.team_id = any(e.team_ids) or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = any(e.team_ids)))
                      and (p.user_id = u or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = u)))) then
      return next u;
    end if;
  end loop;
  perform push_restore(sub0, uid0);
end $$;
revoke execute on function push_event_targets(uuid, uuid, boolean, boolean) from public, anon, authenticated;

-- Ajouter des joueurs (seules l'équipe acceptée et la colonne « Club » changent)
create or replace function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid; pname text; cur_team uuid; cur_state text;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  -- n° 78 : le coach du club partenaire ajoute les joueurs de SON club dans l'équipe en entente (fiches gardées dans son club)
  if p_team is not null and not team_in_club(p_team, p_club) then raise exception 'Équipe inconnue'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Liste trop longue (300 lignes au plus)'; end if;
  select case when partner_state <> 'aucune' then nullif(lower(trim(partner_name)), '') end into pname from teams where id = p_team;
  if exists(select 1 from teams where id = p_team and club_id <> p_club) then pname := null; end if; -- import depuis le club partenaire : ce sont ses joueurs
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid, email text, phone text, club text) loop
    if coalesce(r.action, 'create') = 'skip' or coalesce(trim(r.first_name), '') = '' then continue; end if;
    r.email := nullif(lower(trim(coalesce(r.email, ''))), ''); if r.email is not null and r.email not like '%@%' then r.email := null; end if;
    r.phone := nullif(trim(coalesce(r.phone, '')), '');
    if r.action in ('link', 'complete', 'addteam') then
      select x.team_id, t.state into cur_team, cur_state from players x left join teams t on t.id = x.team_id
        where x.id = r.existing and x.club_id = p_club and x.deleted_at is null;
      if not found then continue; end if;
      update players set birth_date = coalesce(birth_date, r.birth_date), parent_email = coalesce(parent_email, r.email), parent_phone = coalesce(parent_phone, r.phone) where id = r.existing;
      if coalesce(trim(r.licence), '') <> '' then
        insert into player_admin(player_id, licence_number) values (r.existing, trim(r.licence))
          on conflict (player_id) do update set licence_number = coalesce(nullif(player_admin.licence_number, ''), excluded.licence_number);
      end if;
      if r.action = 'link' and p_team is not null and cur_team is distinct from p_team then
        if cur_team is null or cur_state = 'Archivée' then
          update players set team_id = p_team where id = r.existing;
          perform log_action(p_club, null, r.existing, 'fiche reliée à la nouvelle équipe par un import', '{}'::jsonb);
        else
          insert into player_teams values (r.existing, p_team) on conflict do nothing;
        end if;
      elsif r.action = 'addteam' and p_team is not null then
        insert into player_teams values (r.existing, p_team) on conflict do nothing;
      end if;
      n := n + 1; continue;
    end if;
    insert into players(club_id, team_id, first_name, last_name, birth_date, parent_email, parent_phone, created_by, from_partner)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, r.email, r.phone, auth.uid(),
              pname is not null and lower(trim(coalesce(r.club, ''))) = pname) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

-- L'entente se règle au club porteur : le coach venu du club partenaire ne la modifie pas
create or replace function set_team_partner(p_team uuid, p_club uuid, p_name text, p_contact jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare t teams; st text; u uuid;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null then raise exception 'Équipe introuvable'; end if;
  -- n° 78 : l'entente se règle au club porteur (le coach du club partenaire ne la change pas)
  if not ((coaches_team(p_team) and exists(select 1 from memberships m where m.team_id = p_team and m.user_id = auth.uid() and m.club_id = t.club_id and m.role = 'coach' and m.status = 'active'))
          or has_area(t.club_id, 'technique') or is_president(t.club_id)) then raise exception 'Réservé au coach de l''équipe, à la Technique et au président'; end if;
  if p_club = t.club_id then raise exception 'Choisis un autre club que le tien'; end if;
  if p_club is not null then
    if not exists(select 1 from clubs where id = p_club) then raise exception 'Club introuvable'; end if;
    st := 'demandee';
  elsif length(trim(coalesce(p_name, ''))) > 0 then
    if length(trim(p_name)) > 80 then raise exception 'Nom du club trop long'; end if;
    st := 'invitee';
  else st := 'aucune'; end if;
  perform set_config('pc.partner', 'on', true);
  update teams set partner_club_id = p_club,
    partner_name = case when st = 'aucune' then '' when p_club is not null then coalesce((select name from clubs where id = p_club), '') else trim(p_name) end,
    partner_contact = case when st = 'invitee' then jsonb_build_object('name', left(coalesce(p_contact->>'name', ''), 80), 'email', left(coalesce(p_contact->>'email', ''), 120), 'phone', left(coalesce(p_contact->>'phone', ''), 30)) else null end,
    partner_state = st
    where id = p_team;
  perform set_config('pc.partner', 'off', true);
  if st = 'aucune' then update players set from_partner = false where team_id = p_team and from_partner; end if;
  perform log_action(t.club_id, null, null, case st when 'aucune' then 'Entente retirée' when 'demandee' then 'Entente demandée' else 'Entente : club invité' end,
    jsonb_build_object('équipe', t.name, 'club', case when p_club is not null then (select name from clubs where id = p_club) else trim(coalesce(p_name, '')) end));
  if st = 'demandee' then
    for u in select distinct m.user_id from memberships m where m.club_id = p_club and m.status = 'active' and m.role in ('president','bureau') and 'technique' = any(areas_of(p_club, m.user_id)) loop
      perform push_enqueue(u, 'Entente à valider', (select name from clubs where id = t.club_id) || ' propose l''équipe ' || t.name || ' en entente avec votre club', 'entente:' || t.id, 'entente:' || t.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    end loop;
  end if;
  return st;
end $$;

select close_visitor_functions();
