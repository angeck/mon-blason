-- MAJ_BETA_1_7_0.sql · mypocketclub · bêta 1.7.0 (Gaël, 23 novembre 2026)
-- À lancer sur la base de test mpc-test (Supabase › SQL Editor), après la 1.6.0 (la 1.6.1 n'avait pas de script), puis sur mpc avec l'accord de Gaël.
-- Aucun « drop » ni « delete » : rien n'est effacé. Se relance sans risque.
-- mypocketclub · bêta 1.7.0 · script idempotent (se relance sans risque)
-- n° 294 : score par sets (volley ; plus tard tennis, tennis de table) : le coach indique les sets, le score du match en découle.
-- n° 289 : un entraînement ne notifie plus à sa création (sauf s'il commence dans moins de 72 h : une notification, la première
--          seulement pour une série) ; l'encart « À répondre » arrive une semaine avant ; relance 72 h avant (inchangée) ;
--          « Faire apparaître maintenant » : l'organisateur peut pousser l'encart plus tôt (une notification par rendez-vous poussé).
--          Match, plateau, tournoi, événement : inchangés (notifiés dès la création, relance à 72 h).
-- Rien n'est effacé.

-- ---------------------------------------------------------------------
-- N° 294 · score par sets
-- ---------------------------------------------------------------------
create or replace function set_score(p_event uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e events; l jsonb; st jsonb; clean jsonb := '[]'::jsonb; sets jsonb; u uuid; w int := 0; lo int := 0; d int := 0; body text;
  us int; them int; a int; b int;
begin
  select * into e from events where id = p_event;
  if e.id is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if not can_call_roll(p_event) then raise exception 'Le score est mis par le coach de l''équipe (ou le président)'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'Score seulement pour un match, un plateau ou un tournoi'; end if;
  if e.cancelled then raise exception 'Ce rendez-vous est annulé'; end if;
  if e.starts_at > now() then raise exception 'Le score se met une fois la rencontre commencée'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 20 then raise exception 'Vingt rencontres au plus'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if length(trim(coalesce(l->>'opponent', ''))) > 80 then raise exception 'Nom de l''adversaire trop long'; end if;
    sets := '[]'::jsonb;
    if jsonb_typeof(l->'sets') = 'array' and jsonb_array_length(l->'sets') > 0 then
      -- n° 294 : les sets donnent le score du match (sets gagnés – sets perdus) ; 5 sets au plus, 0 à 99 points, pas d'égalité
      if jsonb_array_length(l->'sets') > 5 then raise exception 'Cinq sets au plus'; end if;
      us := 0; them := 0;
      for st in select * from jsonb_array_elements(l->'sets') loop
        if jsonb_typeof(st) <> 'array' or jsonb_array_length(st) <> 2 then raise exception 'Set invalide'; end if;
        a := (st->>0)::int; b := (st->>1)::int;
        if a is null or b is null or a not between 0 and 99 or b not between 0 and 99 then raise exception 'Set invalide (0 à 99 points)'; end if;
        if a = b then raise exception 'Un set ne peut pas finir à égalité'; end if;
        sets := sets || jsonb_build_array(jsonb_build_array(a, b));
        if a > b then us := us + 1; else them := them + 1; end if;
      end loop;
    else
      us := (l->>'us')::int; them := (l->>'them')::int;
      if coalesce(us, -1) not between 0 and 999 or coalesce(them, -1) not between 0 and 999 then raise exception 'Score invalide (0 à 999)'; end if;
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('opponent', trim(coalesce(l->>'opponent', '')), 'us', us, 'them', them, 'forfeit', coalesce((l->>'forfeit')::boolean, false))
                   || case when jsonb_array_length(sets) > 0 then jsonb_build_object('sets', sets) else '{}'::jsonb end);
    if us > them then w := w + 1; elsif us < them then lo := lo + 1; else d := d + 1; end if;
  end loop;
  perform set_config('pc.score', 'on', true);
  update events set scores = case when jsonb_array_length(clean) = 0 then null else clean end,
    score_by = case when jsonb_array_length(clean) = 0 then null else auth.uid() end,
    -- n° 294 : l'encart de l'Accueil dure 36 h à partir de la PREMIÈRE saisie ; une correction ne relance pas le compte
    score_at = case when jsonb_array_length(clean) = 0 then null else coalesce(case when e.scores is not null then e.score_at end, now()) end,
    score_edited = (e.scores is not null and jsonb_array_length(clean) > 0)
    where id = p_event;
  perform set_config('pc.score', 'off', true);
  if e.scores is not null then perform log_action(e.club_id, null, null, 'Score modifié', jsonb_build_object('rendez_vous', e.title, 'avant', e.scores, 'après', clean)); end if;
  -- Une seule notification « Résultat » par rendez-vous (pas à la correction)
  if jsonb_array_length(clean) > 0 and e.scores is null then
    body := case when jsonb_array_length(clean) = 1
      then (case when w = 1 then 'Victoire ' when lo = 1 then 'Défaite ' else 'Nul ' end) || (clean->0->>'us') || ' – ' || (clean->0->>'them')
           || case when clean->0->>'opponent' <> '' then ' contre ' || (clean->0->>'opponent') else '' end
      else e.type || ' · ' || w || ' victoire' || case when w > 1 then 's' else '' end || ', ' || lo || ' défaite' || case when lo > 1 then 's' else '' end
           || case when d > 0 then ', ' || d || ' nul' || case when d > 1 then 's' else '' end else '' end end;
    for u in select * from team_people(e.team_ids) where team_people is distinct from auth.uid() loop
      perform push_enqueue(u, 'Résultat · ' || coalesce((select string_agg(name, ', ') from teams where id = any(e.team_ids)), e.title), body, 'score:' || e.id, 'score:' || e.id);
    end loop;
  end if;
  return jsonb_array_length(clean);
end $$;
revoke execute on function set_score(uuid, jsonb) from public, anon;
grant execute on function set_score(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- N° 289 · entraînements : pas de notification à la création (sauf moins de 72 h avant) ; encart poussé plus tôt
-- ---------------------------------------------------------------------
alter table events add column if not exists pushed_at timestamptz;

create or replace function push_on_event_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; k text := 'evnew:' || coalesce(new.series_id::text, new.id::text); t text; b text;
  game boolean := new.type in ('Match','Plateau','Tournoi'); conv boolean := cardinality(new.convoked) > 0;
begin
  if new.cancelled or new.starts_at < now() then return null; end if;
  -- n° 289 : un entraînement à plus de 72 h ne notifie pas (l'encart arrivera une semaine avant, la relance 72 h avant)
  if new.type = 'Entraînement' and new.starts_at > now() + interval '72 hours' then return null; end if;
  -- une série (ou plusieurs entraînements créés ensemble) : une seule notification, pour le premier
  if new.series_id is not null and exists(select 1 from push_queue where dedupe_key = k) then return null; end if;
  if new.series_id is not null then
    t := 'Nouveaux entraînements';
    b := new.title || ' · chaque ' || (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from new.starts_at at time zone 'Europe/Paris')::int + 1]
         || ' à ' || to_char(new.starts_at at time zone 'Europe/Paris', 'HH24"h"MI') || ', dès le ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM')
         || ' (' || coalesce((select name from clubs where id = new.club_id), '') || ')';
  else
    t := case when game then 'Nouveau ' || lower(new.type) || ' prévu' else 'Nouveau : ' || lower(new.type) end;
    b := push_ev_line(new);
  end if;
  -- un match prévient toute l'équipe, même quand une liste de convoqués existe déjà
  for u in select * from push_event_targets(new.id, auth.uid(), false, game and new.series_id is null) loop
    perform push_enqueue(u, t, b, 'ev:' || new.id, k);
  end loop;
  -- les joueurs convoqués et leurs parents reçoivent en plus la convocation
  if game and conv and new.series_id is null then
    for u in select x from push_event_targets(new.id, auth.uid(), false, false) x
             where exists(select 1 from players p where p.id = any(new.convoked) and p.deleted_at is null
                          and (p.user_id = x or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = x))) loop
      perform push_enqueue(u, 'Convocation : ' || lower(new.type), b, 'evconv:' || new.id, 'evconv:' || new.id);
    end loop;
  end if;
  return null;
end $$;
revoke execute on function push_on_event_insert() from public, anon, authenticated;

-- « Faire apparaître maintenant » : l'encart « À répondre » arrive tout de suite, avec une notification (une fois par rendez-vous)
create or replace function event_push_now(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e events; u uuid; n int := 0;
begin
  select * into e from events where id = p_event;
  if e.id is null or not coalesce(can_manage_event(p_event) or e.created_by = auth.uid(), false) then raise exception 'Seul l''organisateur peut faire apparaître ce rendez-vous'; end if;
  if e.cancelled or e.starts_at < now() then raise exception 'Ce rendez-vous est annulé ou passé'; end if;
  if e.pushed_at is not null then return 0; end if;
  update events set pushed_at = now() where id = p_event;
  for u in select * from push_event_targets(e.id, auth.uid(), false, false) loop
    perform push_enqueue(u, 'Nouveau : ' || lower(e.type), push_ev_line(e), 'ev:' || e.id, 'evpush:' || e.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function event_push_now(uuid) from public, anon;
grant execute on function event_push_now(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- N° 292 · signaler un problème depuis un rendez-vous (matériel ou humain)
-- Bouton : coach de l'équipe, directeur technique, vice-président, président.
-- Humain : l'enfant est choisi dans la liste de l'équipe. « Enregistrer » = dans les stats, lu seulement par les personnes
-- qui lisent les stats (coach de l'équipe, président, vice-président, directeur technique : règle du n° 286).
-- Envoi : « DT et président » ou « président seul » ; le DT envoie au président ; le président n'envoie rien.
-- La notification ne contient jamais le texte ni le nom de l'enfant. Avis « Légal » à faire après (claude/60, partie 3).
-- ---------------------------------------------------------------------
create table if not exists event_reports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  event_title text not null default '',
  event_at timestamptz,
  team_ids uuid[] not null default '{}',
  kind text not null check (kind in ('materiel','humain')),
  player_id uuid references players(id) on delete set null,
  body text not null check (length(body) between 1 and 2000),
  author uuid not null,
  sent_to text check (sent_to in ('dt_president','president')),
  created_at timestamptz not null default now()
);
create index if not exists event_reports_club on event_reports(club_id, created_at desc);
alter table event_reports enable row level security; -- aucune règle de lecture directe : tout passe par les fonctions ci-dessous
revoke all on event_reports from anon, authenticated;

-- Qui voit le bouton (même règle à l'écran)
create or replace function can_report_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select can_call_roll(e.id) or is_president(e.club_id) or is_vice_president(e.club_id) or has_area(e.club_id, 'technique')
    from events e where e.id = eid), false);
$$;
-- Qui lit un signalement : les lecteurs des stats de l'équipe (n° 286) et l'auteur
create or replace function reads_event_report(r event_reports) returns boolean language sql stable security definer set search_path = public as $$
  select r.author = auth.uid() or is_president(r.club_id) or is_vice_president(r.club_id) or has_area(r.club_id, 'technique')
    or exists(select 1 from unnest(r.team_ids) t where coaches_team(t));
$$;
revoke execute on function can_report_event(uuid), reads_event_report(event_reports) from public, anon;
grant execute on function can_report_event(uuid) to authenticated;

create or replace function report_event(p_event uuid, p_kind text, p_player uuid, p_body text, p_send text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e events; rid uuid; dest text := nullif(p_send, ''); u uuid; pres boolean; dt boolean; lab text;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into e from events where id = p_event;
  if e.id is null or not can_report_event(p_event) then raise exception 'Signalement réservé au coach, au directeur technique, au vice-président et au président'; end if;
  if p_kind not in ('materiel','humain') then raise exception 'Type de problème inconnu'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Écris ce qui s''est passé'; end if;
  if p_kind = 'humain' then
    if p_player is null or not exists(select 1 from players p where p.id = p_player and p.deleted_at is null and p.team_id = any(e.team_ids)) then
      raise exception 'Choisis l''enfant dans la liste de l''équipe';
    end if;
  else p_player := null; end if;
  if dest is not null and dest not in ('dt_president','president') then raise exception 'Destinataire inconnu'; end if;
  pres := is_president(e.club_id); dt := has_area(e.club_id, 'technique');
  if pres then dest := null;                       -- le président n'envoie rien : c'est à lui de décider ensuite
  elsif dt and dest is not null then dest := 'president'; end if; -- le directeur technique envoie au président
  insert into event_reports(club_id, event_id, event_title, event_at, team_ids, kind, player_id, body, author, sent_to)
    values (e.club_id, e.id, e.title, e.starts_at, e.team_ids, p_kind, p_player, left(trim(p_body), 2000), auth.uid(), dest)
    returning id into rid;
  if dest is not null then
    lab := case p_kind when 'materiel' then 'Problème matériel signalé' else 'Problème signalé' end;
    for u in select distinct m.user_id from memberships m where m.club_id = e.club_id and m.status = 'active' and m.user_id <> auth.uid()
               and (m.role = 'president' or (dest = 'dt_president' and m.role in ('president','bureau') and 'technique' = any(areas_of(e.club_id, m.user_id)))) loop
      perform push_enqueue(u, lab, e.title || ' · ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM'), 'evrep:' || e.club_id, 'evrep:' || rid || ':' || u);
    end loop;
  end if;
  return rid;
end $$;
revoke execute on function report_event(uuid, text, uuid, text, text) from public, anon;
grant execute on function report_event(uuid, text, uuid, text, text) to authenticated;

-- Liste lue dans les stats (et par le président) : seulement les signalements que la personne a le droit de lire
create or replace function event_reports_list(p_club uuid, p_team uuid default null) returns table(id uuid, event_id uuid, event_title text, event_at timestamptz,
  team_ids uuid[], kind text, player_id uuid, player_name text, body text, author uuid, author_name text, sent_to text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.event_id, r.event_title, r.event_at, r.team_ids, r.kind, r.player_id,
    case when p.id is null then null else p.first_name || ' ' || left(coalesce(p.last_name, ''), 1) || '.' end,
    r.body, r.author, coalesce(nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''), 'Un membre du club'), r.sent_to, r.created_at
  from event_reports r left join players p on p.id = r.player_id left join profiles pr on pr.id = r.author
  where r.club_id = p_club and (p_team is null or p_team = any(r.team_ids)) and reads_event_report(r)
  order by r.created_at desc limit 200;
$$;
revoke execute on function event_reports_list(uuid, uuid) from public, anon;
grant execute on function event_reports_list(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- N° 295 · le contact du coach dans la convocation, choisi par le coach une fois pour toutes
-- Avant la 1.7.0, la convocation donnait d'office le téléphone et l'e-mail du coach. Désormais : rien par défaut ;
-- le coach coche téléphone, SMS et/ou e-mail ; sans partage, la convocation renvoie au correspondant des rencontres.
-- Équipe en entente (n° 78) : le coach venu du club partenaire apparaît de la même façon. Avis « Légal » après (claude/60).
-- ---------------------------------------------------------------------
create table if not exists coach_contacts (
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null,
  show_phone boolean not null default false,
  show_sms boolean not null default false,
  show_email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table coach_contacts enable row level security;
revoke all on coach_contacts from anon, authenticated;

create or replace function my_coach_contact(p_club uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('show_phone', coalesce(k.show_phone, false), 'show_sms', coalesce(k.show_sms, false), 'show_email', coalesce(k.show_email, false))
  from (select 1) z left join coach_contacts k on k.club_id = p_club and k.user_id = auth.uid();
$$;
create or replace function set_coach_contact(p_club uuid, p_phone boolean, p_sms boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = auth.uid() and m.role = 'coach' and m.status = 'active') then
    raise exception 'Réservé aux coachs du club';
  end if;
  insert into coach_contacts(club_id, user_id, show_phone, show_sms, show_email, updated_at)
    values (p_club, auth.uid(), coalesce(p_phone, false), coalesce(p_sms, false), coalesce(p_email, false), now())
    on conflict (club_id, user_id) do update set show_phone = excluded.show_phone, show_sms = excluded.show_sms, show_email = excluded.show_email, updated_at = now();
end $$;
revoke execute on function my_coach_contact(uuid), set_coach_contact(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function my_coach_contact(uuid), set_coach_contact(uuid, boolean, boolean, boolean) to authenticated;

create or replace function convocation_data(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events; c clubs; d date; d0 date; d1 date; dw int; ren uuid;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Rendez-vous introuvable'; end if;
  if not has_area(e.club_id, 'evenements') then raise exception 'La convocation est réservée au correspondant rencontres, au vice-président et au président'; end if;
  if e.type not in ('Match','Plateau','Tournoi') then raise exception 'La convocation vaut pour un match, un plateau ou un tournoi'; end if;
  d := (e.starts_at at time zone 'Europe/Paris')::date; dw := extract(isodow from d)::int;
  if dw >= 6 then d0 := d - (dw - 6); d1 := d0 + 1; else d0 := d; d1 := d; end if;
  select * into c from clubs where id = e.club_id;
  ren := contact_holder(c.id, 'rencontres');
  return jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'sport', c.sport, 'color1', c.color1, 'color2', c.color2, 'logo', c.logo, 'crest_bg', c.crest_bg, 'crest_outline', c.crest_outline),
    'from', d0, 'to', d1,
    'correspondent', case when ren is null then null else (select jsonb_build_object('name', x->>'name', 'phone', x->>'phone', 'email', x->>'email') from (select contact_person(c.id, ren, 'Correspondant rencontres') x) z) end,
    'sender', (select jsonb_build_object('name', trim(p.first_name || ' ' || p.last_name), 'email', u.email) from profiles p join auth.users u on u.id = p.id where p.id = auth.uid()),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'type', x.type, 'title', x.title, 'starts_at', x.starts_at, 'place', x.place, 'opponents', x.opponents, 'cancelled', x.cancelled,
        'team', (select jsonb_build_object('name', t.name, 'category', t.category, 'gender', t.gender) from teams t where t.id = any(x.team_ids) and t.deleted_at is null order by t.name limit 1),
        -- n° 295 : seulement ce que le coach a choisi de partager (rien par défaut) ; coach du club partenaire compris (n° 78)
        'coach', (select jsonb_build_object('name', p.full_name,
                    'phone', case when coalesce(k.show_phone, false) or coalesce(k.show_sms, false) then nullif(p.phone, '') end,
                    'sms_only', coalesce(k.show_sms, false) and not coalesce(k.show_phone, false),
                    'email', case when coalesce(k.show_email, false) then u.email::text end)
                  from memberships m join profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id
                  left join coach_contacts k on k.club_id = m.club_id and k.user_id = m.user_id
                  where m.role = 'coach' and m.status = 'active' and m.team_id = any(x.team_ids)
                    and (m.club_id = x.club_id or exists(select 1 from unnest(x.team_ids) tt where entente_club(tt) = m.club_id))
                  -- plusieurs coachs : d'abord celui du club, puis celui qui partage un contact
                  order by (m.club_id = x.club_id) desc, (coalesce(k.show_phone, false) or coalesce(k.show_sms, false) or coalesce(k.show_email, false)) desc, p.full_name limit 1))
        order by x.starts_at, x.title)
      from events x where x.club_id = e.club_id and x.at_home and x.type in ('Match','Plateau','Tournoi') and x.audience = 'team'
        and (x.starts_at at time zone 'Europe/Paris')::date between d0 and d1), '[]'::jsonb));
end $$;
revoke execute on function convocation_data(uuid) from public, anon;
grant execute on function convocation_data(uuid) to authenticated;

select close_visitor_functions();
