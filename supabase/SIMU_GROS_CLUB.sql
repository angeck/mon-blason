-- Pocket Club · SIMULATION « gros club » dans Boissy Basket (données 100 % fictives)
-- -----------------------------------------------------------------------------------------------
-- À coller dans Supabase → SQL Editor → Run. Relançable : une simulation déjà installée est d'abord effacée.
--
-- AVANT DE LANCER : vérifie l'adresse e-mail de TON compte Pocket Club à la toute dernière ligne.
--
-- Ce que fait ce script :
--   • ajoute à Boissy Basket (ou le crée s'il n'existe pas) 15 équipes visibles, environ 330 comptes fictifs
--     (bureau, coachs, parents, joueurs adultes, supporteurs), 180 fiches joueurs, licences et cotisations,
--     5 semaines d'entraînements, des matchs, plateaux, réunions, des groupes d'échange avec messages et sondages ;
--   • te rattache avec 4 profils : coach U9 M, joueur Loisirs, parent de Jade (U9 F) et d'Inès (U13 F) — prénoms fictifs ;
--   • installe l'animation « en direct » (messages, réponses, votes, nouveaux matchs, demandes à valider).
--
-- Commandes utiles ensuite (SQL Editor) :
--   select simu.demarrer(120);   -- anime le club pendant 120 minutes (une action environ chaque minute)
--   select simu.arreter();       -- arrête l'animation
--   select simu.rafale(10);      -- 10 actions tout de suite (si l'animation automatique n'est pas disponible)
--   select simu.effacer();       -- efface TOUTE la simulation (voir aussi SIMU_EFFACER.sql)
--
-- Tout ce qui est fictif est inscrit dans le schéma « simu » : l'effacement ne touche à rien d'autre.
-- Les comptes fictifs ont une adresse en @simulation.invalid et aucun mot de passe : personne ne peut s'y connecter.
-- -----------------------------------------------------------------------------------------------
set client_min_messages = warning;

do $$ begin
  if to_regprocedure('simu.effacer()') is not null then perform simu.effacer(); end if;
end $$;

create schema simu;
revoke all on schema simu from public;
do $$ begin execute 'revoke all on schema simu from anon, authenticated'; exception when undefined_object then null; end $$;

create table simu.objets(tbl text not null, id uuid not null, primary key (tbl, id));     -- tout ce qui est créé
create table simu.etat(k text primary key, v text);                                       -- club, Gaël, fin de l'animation
create table simu.groupes(id uuid primary key, genre text not null);                      -- type de groupe (phrases adaptées)
create table simu.journal(id bigint generated always as identity primary key, at timestamptz not null default now(), action text not null);

-- Animation automatique : extension pg_cron (gratuite sur Supabase). Si elle n'est pas disponible, simu.rafale() reste utilisable.
do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise warning 'Animation automatique indisponible (pg_cron) : active « Cron » dans Supabase → Integrations, ou utilise select simu.rafale(10);';
end $$;

-- =====================================================================
-- Petits outils
-- =====================================================================
create function simu.reg(t text, i uuid) returns uuid language sql as $$
  insert into simu.objets values (t, i) on conflict do nothing; select i;
$$;
create function simu.get(k text) returns text language sql stable as $$ select v from simu.etat where k = $1 $$;
create function simu.pick(a text[]) returns text language sql volatile as $$ select a[1 + floor(random() * cardinality(a))::int] $$;

create function simu.prenom(fille boolean) returns text language sql volatile as $$
  select case when fille then simu.pick(array['Emma','Louise','Alice','Chloé','Léa','Manon','Camille','Zoé','Lina','Mila','Rose','Anna','Lou','Julia','Sarah','Nina','Léna','Agathe','Maëlys','Romane','Clara','Juliette','Margaux','Eva','Ambre','Lucie','Salomé','Yasmine','Aya','Nour'])
              else simu.pick(array['Gabriel','Léo','Raphaël','Louis','Noah','Jules','Arthur','Adam','Lucas','Hugo','Nathan','Ethan','Tom','Sacha','Paul','Mathis','Théo','Timéo','Nolan','Maël','Enzo','Axel','Yanis','Rayan','Ibrahim','Kylian','Bastien','Antoine','Samuel','Malo']) end;
$$;
create function simu.nom() returns text language sql volatile as $$
  select simu.pick(array['Martin','Bernard','Thomas','Petit','Robert','Richard','Durand','Dubois','Moreau','Laurent','Simon','Michel','Lefebvre','Leroy','Roux','David','Bertrand','Morel','Fournier','Girard','Bonnet','Dupont','Lambert','Fontaine','Rousseau','Vincent','Muller','Lefèvre','Faure','André','Mercier','Blanc','Guérin','Boyer','Garnier','Chevalier','François','Legrand','Gauthier','Garcia','Perrin','Robin','Clément','Morin','Nicolas','Henry','Roussel','Mathieu','Gautier','Masson','Diallo','Traoré','Benali','Haddad','Nguyen','Da Silva','Pereira','Ferreira','Lopez','Martinez']);
$$;
create function simu.tel() returns text language sql volatile as $$
  select '06 ' || lpad((10 + floor(random() * 90))::text, 2, '0') || ' ' || lpad(floor(random() * 100)::text, 2, '0') || ' ' || lpad(floor(random() * 100)::text, 2, '0') || ' ' || lpad(floor(random() * 100)::text, 2, '0');
$$;

-- Compte fictif : pas de mot de passe, adresse non routable, impossible de s'y connecter
create function simu.personne(p_first text, p_last text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data,
                         created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
          'simu+' || replace(u::text, '-', '') || '@simulation.invalid', '',
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('first_name', p_first, 'last_name', p_last, 'full_name', p_first || ' ' || p_last, 'cgu_version', 'simulation'),
          now() - interval '20 days', now(), '', '', '', '');
  update profiles set phone = simu.tel() where id = u;
  return u;
end $$;

-- Adhésion active (rôle, équipe, fiche joueur)
create function simu.adhesion(c uuid, u uuid, r text, t uuid, p uuid default null, asst boolean default false) returns uuid language plpgsql as $$
declare m uuid;
begin
  select id into m from memberships where club_id = c and user_id = u and role = r and team_id is not distinct from t and player_id is not distinct from p;
  if m is not null then return m; end if;
  insert into memberships(club_id, user_id, role, team_id, player_id, assistant, status, created_at)
    values (c, u, r, t, p, asst, 'active', now() - interval '15 days') returning id into m;
  return simu.reg('memberships', m);
end $$;

-- Fiche joueur fictive
create function simu.fiche(c uuid, t uuid, fn text, ln text, naissance date, u uuid default null) returns uuid language plpgsql as $$
declare p uuid;
begin
  insert into players(club_id, team_id, user_id, first_name, last_name, birth_date, consents, created_at)
    values (c, t, u, fn, ln, naissance,
      jsonb_build_object('image', jsonb_build_object('ok', random() < 0.8, 'at', now() - interval '15 days'),
                         'rentre_seul', jsonb_build_object('ok', random() < 0.3, 'at', now() - interval '15 days')),
      now() - interval '15 days') returning id into p;
  return simu.reg('players', p);
end $$;

-- Heure de Paris → horodatage
create function simu.fictif(u uuid) returns boolean language sql stable as $$
  select exists(select 1 from auth.users where id = u and email like 'simu+%@simulation.invalid');
$$;

create function simu.paris(d date, h text) returns timestamptz language sql immutable as $$
  select (d + h::time) at time zone 'Europe/Paris';
$$;

-- =====================================================================
-- Installation du club fictif
-- =====================================================================
create function simu.installer(p_email text, p_club text) returns text language plpgsql as $$
declare
  gael uuid; club uuid; created_club boolean := false;
  t record; tid uuid; cid uuid; u uuid; u2 uuid; p uuid; g uuid; e uuid; poll uuid; n int; i int; k int; d date;
  equipes jsonb := '[
    {"n":"U7","cat":"U7","g":"Mixte","nes":[2020,2021],"jours":[3],"h":"14:00","comp":false},
    {"n":"U9 F","cat":"U9","g":"Féminine","nes":[2018,2019],"jours":[3,5],"h":"17:30","comp":false},
    {"n":"U9 M","cat":"U9","g":"Masculine","nes":[2018,2019],"jours":[3,5],"h":"18:30","comp":false},
    {"n":"U11 F","cat":"U11","g":"Féminine","nes":[2016,2017],"jours":[2,4],"h":"17:30","comp":true},
    {"n":"U11 M","cat":"U11","g":"Masculine","nes":[2016,2017],"jours":[2,4],"h":"18:30","comp":true},
    {"n":"U13 F","cat":"U13","g":"Féminine","nes":[2014,2015],"jours":[1,3],"h":"18:00","comp":true},
    {"n":"U13 M","cat":"U13","g":"Masculine","nes":[2014,2015],"jours":[1,4],"h":"18:00","comp":true},
    {"n":"U15 F","cat":"U15","g":"Féminine","nes":[2012,2013],"jours":[2,5],"h":"19:00","comp":true},
    {"n":"U15 M","cat":"U15","g":"Masculine","nes":[2012,2013],"jours":[1,4],"h":"19:00","comp":true},
    {"n":"U17 F","cat":"U17","g":"Féminine","nes":[2010,2011],"jours":[2,4],"h":"19:30","comp":true},
    {"n":"U17 M","cat":"U17","g":"Masculine","nes":[2010,2011],"jours":[1,3],"h":"19:30","comp":true},
    {"n":"U20 M","cat":"U20","g":"Masculine","nes":[2007,2009],"jours":[2,5],"h":"20:30","comp":true},
    {"n":"Seniors F","cat":"Seniors","g":"Féminine","nes":[1990,2006],"jours":[1,3],"h":"20:30","comp":true},
    {"n":"Seniors M","cat":"Seniors","g":"Masculine","nes":[1988,2006],"jours":[2,4],"h":"20:30","comp":true},
    {"n":"Loisirs","cat":"Loisirs","g":"Mixte","nes":[1972,1995],"jours":[4],"h":"20:45","comp":false}
  ]';
  jours_noms text[] := array['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  gymnases text[] := array['Gymnase du collège','Salle omnisports','Gymnase des Écoles'];
  adversaires text[] := array['Arpajon','Étréchy','Saint-Chéron','Breuillet','Égly','Bruyères-le-Châtel','Ballancourt','Itteville','Saint-Germain-lès-Arpajon','Marolles'];
  v_teams jsonb := '{}'; coach_of jsonb := '{}';
  bureau uuid[] := '{}'; coachs uuid[] := '{}'; prez uuid;
  lundi date := date_trunc('week', now() at time zone 'Europe/Paris')::date;
  jade uuid; ines uuid; loisir_gael uuid; adulte boolean; fille boolean; nom text; jd int;
begin
  -- Ton compte
  select id into gael from auth.users where lower(email) = lower(trim(p_email));
  if gael is null then raise exception 'Compte introuvable pour « % » : crée d''abord ton compte dans l''application avec cette adresse, puis relance.', p_email; end if;
  insert into simu.etat values ('gael', gael::text);

  -- Le club : Boissy Basket s'il existe, sinon créé (et effacé avec la simulation)
  select id into club from clubs where name ilike '%' || p_club || '%' order by created_at limit 1;
  if club is null then
    insert into clubs(name, city, sport, color1, color2) values ('Boissy Basket', 'Boissy-sous-Saint-Yon', 'Basket-ball', '#1D3C8F', '#F2C230') returning id into club;
    perform simu.reg('clubs', club); created_club := true;
  end if;
  insert into simu.etat values ('club', club::text);

  -- Bureau fictif (et présidente fictive si le club n'en a pas)
  -- bureau[1] (fictif) signe les rendez-vous du club : jamais un vrai membre de Boissy
  select user_id into prez from memberships where club_id = club and role = 'president' and status = 'active' limit 1;
  if prez is null then
    prez := simu.personne('Sophie', 'Marchal'); perform simu.adhesion(club, prez, 'president', null); bureau := array[prez];
  end if;
  foreach nom in array array['Nathalie|Fontaine','Olivier|Garnier','Karim|Benali','Isabelle|Morel'] loop
    u := simu.personne(split_part(nom, '|', 1), split_part(nom, '|', 2));
    perform simu.adhesion(club, u, 'bureau', null); bureau := bureau || u;
  end loop;
  insert into simu.etat values ('bureau', array_to_string(bureau, ','));
  insert into club_contacts(club_id, user_id, for_licence, for_matches, show_phone, show_email)
    values (club, bureau[2], true, false, true, true), (club, bureau[3], false, true, true, true) on conflict do nothing;

  -- Grille des tarifs (seulement si le club n'en a pas déjà une)
  if not exists(select 1 from fee_grid where club_id = club) then
    for t in select * from (values ('U7',110),('U9',140),('U11',160),('U13',170),('U15',180),('U17',190),('U20',200),('Seniors',210),('Loisirs',120)) v(c, a) loop
      insert into fee_grid(club_id, category, amount, fed_part) values (club, t.c, t.a, 45) returning id into g;
      perform simu.reg('fee_grid', g);
    end loop;
  end if;

  -- Équipes, coachs, joueurs, parents
  for t in select x from jsonb_array_elements(equipes) x loop
    -- toujours une équipe neuve (les vraies équipes du club ne sont jamais touchées) ; « (simu) » si le nom existe déjà
    nom := case when exists(select 1 from teams where club_id = club and name = t.x->>'n' and deleted_at is null) then (t.x->>'n') || ' (simu)' else t.x->>'n' end;
    begin
      insert into teams(club_id, name, category, gender, state, slots)
        values (club, nom, t.x->>'cat', t.x->>'g', 'Visible',
          (select string_agg(jours_noms[(j::int) + 1] || ' ' || replace(t.x->>'h', ':', 'h'), ' · ') from jsonb_array_elements_text(t.x->'jours') j) || ' · ' || gymnases[1 + (length(t.x->>'n') % 3)])
        returning id into tid;
      perform simu.reg('teams', tid);
    end;
    v_teams := v_teams || jsonb_build_object(t.x->>'n', tid);

    -- Coach principal : toi pour U9 M, sinon un coach fictif ; quelques assistants
    if t.x->>'n' = 'U9 M' then cid := gael;
    else
      cid := simu.personne(simu.prenom(random() < 0.4), simu.nom());
    end if;
    perform simu.adhesion(club, cid, 'coach', tid);
    coach_of := coach_of || jsonb_build_object(t.x->>'n', cid); coachs := coachs || cid;
    if t.x->>'n' in ('U9 M','U11 M','U13 F','Seniors M','U15 F') then
      u := simu.personne(simu.prenom(random() < 0.5), simu.nom());
      perform simu.adhesion(club, u, 'coach', tid, null, true); coachs := coachs || u;
    end if;

    adulte := (t.x->'nes'->>0)::int < 2010;
    n := case when t.x->>'n' = 'U7' then 10 else 12 end;
    for i in 1..n loop
      fille := case t.x->>'g' when 'Féminine' then true when 'Masculine' then false else random() < 0.5 end;
      d := make_date((t.x->'nes'->>0)::int + floor(random() * ((t.x->'nes'->>1)::int - (t.x->'nes'->>0)::int + 1))::int, 1 + floor(random() * 12)::int, 1 + floor(random() * 28)::int);
      nom := simu.nom();
      if adulte then
        u := simu.personne(simu.prenom(fille), nom);
        p := simu.fiche(club, tid, (select first_name from profiles where id = u), nom, d, u);
        perform simu.adhesion(club, u, 'joueur', tid, p);
      else
        -- un enfant sur 15 sans date de naissance (rappel au coach et au bureau)
        p := simu.fiche(club, tid, simu.prenom(fille), nom, case when random() < 0.07 then null else d end);
        if random() < 0.95 then                                  -- un parent (5 % sans compte)
          u := simu.personne(simu.prenom(random() < 0.65), nom);
          insert into player_parents values (p, u); perform simu.adhesion(club, u, 'parent', tid, p);
          if random() < 0.25 then                                -- second parent
            u2 := simu.personne(simu.prenom(random() < 0.4), nom);
            insert into player_parents values (p, u2); perform simu.adhesion(club, u2, 'parent', tid, p);
          end if;
          update players set parent_phone = (select phone from profiles where id = u) where id = p;
        else
          update players set parent_phone = simu.tel() where id = p;
        end if;
      end if;
    end loop;
  end loop;
  insert into simu.etat values ('equipes', v_teams::text), ('coachs', coach_of::text);

  -- Fratries : 8 parents ont un deuxième enfant dans une autre équipe jeune
  for u in select z.user_id from (select distinct pp.user_id from player_parents pp join players x on x.id = pp.player_id
             where pp.user_id <> gael and x.id in (select id from simu.objets where tbl = 'players')
               and x.team_id in (select (v_teams->>kk)::uuid from unnest(array['U9 M','U11 F','U13 M','U15 M']) kk)) z
           order by random() limit 8 loop
    tid := (v_teams->>simu.pick(array['U7','U11 M','U13 F','U15 F']))::uuid;
    p := simu.fiche(club, tid, simu.prenom(random() < 0.5), (select last_name from profiles where id = u), make_date(2012 + floor(random() * 8)::int, 6, 10));
    insert into player_parents values (p, u) on conflict do nothing; perform simu.adhesion(club, u, 'parent', tid, p);
  end loop;

  -- Tes profils : joueur Loisirs, parent de Jade (U9 F) et d'Inès (U13 F) — prénoms fictifs
  loisir_gael := simu.fiche(club, (v_teams->>'Loisirs')::uuid, (select first_name from profiles where id = gael), (select last_name from profiles where id = gael), null, gael);
  perform simu.adhesion(club, gael, 'joueur', (v_teams->>'Loisirs')::uuid, loisir_gael);
  jade := simu.fiche(club, (v_teams->>'U9 F')::uuid, 'Jade', (select last_name from profiles where id = gael), '2018-03-14');
  ines := simu.fiche(club, (v_teams->>'U13 F')::uuid, 'Inès', (select last_name from profiles where id = gael), '2014-05-22');
  insert into player_parents values (jade, gael), (ines, gael) on conflict do nothing;
  perform simu.adhesion(club, gael, 'parent', (v_teams->>'U9 F')::uuid, jade);
  perform simu.adhesion(club, gael, 'parent', (v_teams->>'U13 F')::uuid, ines);
  insert into simu.etat values ('enfants', jade || ',' || ines), ('loisir_gael', loisir_gael::text);

  -- Supporteurs (60), dont certains suivent une équipe
  for i in 1..60 loop
    u := simu.personne(simu.prenom(random() < 0.5), simu.nom());
    perform simu.adhesion(club, u, 'supporteur', null);
    if random() < 0.4 then
      insert into team_follows(user_id, team_id) values (u, (v_teams->>simu.pick(array['Seniors M','Seniors F','U20 M','U17 F','U15 M'])) ::uuid) on conflict do nothing;
    end if;
  end loop;

  -- Demandes en attente : 2 parents pour ton équipe U9 M, 1 coach, 1 joueur Loisirs
  for i in 1..2 loop
    nom := simu.nom(); u := simu.personne(simu.prenom(true), nom);
    insert into memberships(club_id, user_id, role, team_id, child_first, child_last, status)
      values (club, u, 'parent', (v_teams->>'U9 M')::uuid, simu.prenom(false), nom, 'pending');
  end loop;
  u := simu.personne('Mehdi', 'Haddad');
  insert into memberships(club_id, user_id, role, team_id, status) values (club, u, 'coach', (v_teams->>'U11 F')::uuid, 'pending');
  u := simu.personne('Julien', 'Roussel');
  insert into memberships(club_id, user_id, role, team_id, status) values (club, u, 'joueur', (v_teams->>'Loisirs')::uuid, 'pending');

  -- Licences et cotisations : états variés, versements pour une partie des joueurs
  perform touch_fees(club, null);
  update player_admin a set licence_state = simu.pick(array['Licencié','Licencié','Licencié','Préinscrit fédé','Préinscrit club']),
                            health_doc = random() < 0.85,
                            licence_number = case when random() < 0.7 then 'VT' || lpad(floor(random() * 1000000)::text, 6, '0') end
    from simu.objets o where o.tbl = 'players' and o.id = a.player_id;
  insert into player_payments(player_id, amount, method, paid_at)
    select a.player_id, case when random() < 0.7 then a.fee_amount else round(a.fee_amount / 2) end,
           simu.pick(array['Chèque','Virement','HelloAsso','Espèces','Pass''Sport']), now() - (random() * interval '40 days')
    from player_admin a join simu.objets o on o.tbl = 'players' and o.id = a.player_id
    where a.fee_amount > 0 and random() < 0.65;

  -- Agenda : entraînements de 2 semaines passées à 3 semaines à venir
  for t in select x from jsonb_array_elements(equipes) x loop
    tid := (v_teams->>(t.x->>'n'))::uuid;
    for k in -2..2 loop
      for jd in select (j::int) from jsonb_array_elements_text(t.x->'jours') j loop
        d := lundi + k * 7 + (jd + 6) % 7;
        insert into events(club_id, audience, team_ids, type, title, starts_at, place, created_by, created_at)
          values (club, 'team', array[tid], 'Entraînement', 'Entraînement ' || (t.x->>'n'), simu.paris(d, t.x->>'h'),
                  gymnases[1 + (length(t.x->>'n') % 3)], (coach_of->>(t.x->>'n'))::uuid, now() - interval '14 days')
          returning id into e;
        perform simu.reg('events', e);
      end loop;
    end loop;
    -- Matchs le samedi ou le dimanche (équipes en compétition), plateaux pour les petits
    for k in 0..3 loop
      d := lundi + k * 7 + case when random() < 0.6 then 5 else 6 end;
      insert into events(club_id, audience, team_ids, type, title, starts_at, place, opponents, created_by, created_at)
        values (club, 'team', array[tid],
          case when (t.x->>'comp')::boolean then 'Match' else 'Plateau' end,
          case when (t.x->>'comp')::boolean then 'Match ' || (t.x->>'n') else 'Plateau ' || (t.x->>'n') end,
          simu.paris(d, simu.pick(array['10:00','11:00','13:30','15:00','16:30','18:00'])),
          case when random() < 0.5 then gymnases[1] else 'Gymnase de ' || simu.pick(adversaires) end,
          case when (t.x->>'comp')::boolean then simu.pick(adversaires) else simu.pick(adversaires) || ', ' || simu.pick(adversaires) end,
          (coach_of->>(t.x->>'n'))::uuid, now() - interval '10 days') returning id into e;
      perform simu.reg('events', e);
    end loop;
  end loop;

  -- Rendez-vous du club
  with ins as (insert into events(club_id, audience, type, title, starts_at, place, created_by) values
    (club, 'club', 'Événement', 'Loto du club', simu.paris(lundi + 15, '19:00'), 'Salle des fêtes', bureau[1]),
    (club, 'club', 'Tournoi', 'Tournoi de Noël des jeunes', simu.paris('2026-12-19', '09:30'), 'Salle omnisports', bureau[1]),
    (club, 'club', 'Événement', 'Photo d''équipe et remise des maillots', simu.paris(lundi + 12, '10:00'), 'Gymnase du collège', bureau[3]),
    (club, 'coaches', 'Réunion', 'Réunion des coachs : plannings de décembre', simu.paris(lundi + 9, '20:30'), 'Club-house', bureau[1]),
    (club, 'board', 'Réunion', 'Réunion de bureau', simu.paris(lundi + 10, '20:30'), 'Club-house', bureau[1]),
    (club, 'board_coaches', 'Réunion', 'Point mi-saison bureau et coachs', simu.paris(lundi + 22, '20:00'), 'Club-house', bureau[1]) returning id)
  insert into simu.objets select 'events', id from ins;

  -- Réponses déjà données pour les 10 prochains jours (parents pour leurs enfants, adultes pour eux-mêmes)
  insert into event_responses(event_id, user_id, player_id, answer, updated_at)
    select distinct on (ev.id, x.id) ev.id, pp.user_id, x.id, case when random() < 0.82 then 'oui' else 'non' end, now() - random() * interval '3 days'
    from events ev join simu.objets o on o.tbl = 'events' and o.id = ev.id
    join players x on x.team_id = any(ev.team_ids) and x.user_id is null
    join player_parents pp on pp.player_id = x.id
    where ev.audience = 'team' and ev.starts_at between now() and now() + interval '10 days' and pp.user_id <> gael and random() < 0.6;
  insert into event_responses(event_id, user_id, answer, updated_at)
    select ev.id, x.user_id, case when random() < 0.8 then 'oui' else 'non' end, now() - random() * interval '3 days'
    from events ev join simu.objets o on o.tbl = 'events' and o.id = ev.id
    join players x on x.team_id = any(ev.team_ids) and x.user_id is not null
    where ev.audience = 'team' and ev.starts_at between now() and now() + interval '10 days' and x.user_id <> gael and random() < 0.6;

  -- Appels des entraînements passés (statistiques de présence)
  insert into attendance(event_id, player_id, status, marked_by, marked_at)
    select ev.id, x.id, case when r < 0.78 then 'present' when r < 0.88 then 'retard' else 'absent' end, ev.created_by, ev.starts_at + interval '10 minutes'
    from events ev join simu.objets o on o.tbl = 'events' and o.id = ev.id
    join players x on x.team_id = any(ev.team_ids) cross join lateral (select random() r) z
    where ev.type = 'Entraînement' and ev.starts_at < now() - interval '2 hours'
      and not (ev.team_ids[1] = (v_teams->>'U9 M')::uuid and ev.starts_at > now() - interval '4 days');   -- un appel à faire pour toi

  -- Groupes d'échange avec messages et sondages
  perform simu.groupe(club, 'U9 M · Parents et coachs', 'parents', gael,
    array(select gael union select m.user_id from memberships m where m.team_id = (v_teams->>'U9 M')::uuid and m.status = 'active' and m.role in ('parent','coach') and simu.fictif(m.user_id)));
  perform simu.groupe(club, 'U9 F · Parents', 'parents', (coach_of->>'U9 F')::uuid,
    array(select gael union select m.user_id from memberships m where m.team_id = (v_teams->>'U9 F')::uuid and m.status = 'active' and m.role in ('parent','coach') and simu.fictif(m.user_id)));
  perform simu.groupe(club, 'U13 F · Parents et coachs', 'parents', (coach_of->>'U13 F')::uuid,
    array(select gael union select m.user_id from memberships m where m.team_id = (v_teams->>'U13 F')::uuid and m.status = 'active' and m.role in ('parent','coach') and simu.fictif(m.user_id)));
  perform simu.groupe(club, 'Loisirs · le groupe', 'loisirs', (coach_of->>'Loisirs')::uuid,
    array(select gael union select m.user_id from memberships m where m.team_id = (v_teams->>'Loisirs')::uuid and m.status = 'active' and simu.fictif(m.user_id)));
  perform simu.groupe(club, 'Coachs du club', 'coachs', bureau[1],
    array(select distinct x from unnest(coachs || bureau[1]) x));
  perform simu.groupe(club, 'Covoiturage · Tournoi de Noël', 'covoit', bureau[3],
    array(select gael union select m.user_id from memberships m where m.team_id in ((v_teams->>'U9 F')::uuid, (v_teams->>'U13 F')::uuid, (v_teams->>'U11 F')::uuid) and m.role = 'parent' and simu.fictif(m.user_id) and random() < 0.5));

  -- Toi : messages non lus depuis hier
  update group_members set last_read_at = now() - interval '1 day' where user_id = gael and group_id in (select id from simu.groupes);

  insert into simu.journal(action) values ('installation');
  return format('Simulation installée dans « %s » : %s comptes fictifs, %s fiches joueurs, %s rendez-vous, %s groupes. Lance maintenant : select simu.demarrer(120);',
    (select name from clubs where id = club),
    (select count(*) from auth.users where email like 'simu+%@simulation.invalid'),
    (select count(*) from simu.objets where tbl = 'players'),
    (select count(*) from simu.objets where tbl = 'events'),
    (select count(*) from simu.groupes));
end $$;

-- Groupe d'échange avec historique de messages et un sondage
create function simu.phrase(genre text) returns text language sql volatile as $$
  select simu.pick(case genre
    when 'parents' then array[
      'Bonjour à tous, quelqu''un peut prendre mon fils mercredi ? Je finis tard.',
      'Merci coach pour la séance, ils sont rentrés ravis !',
      'Ma fille a oublié sa gourde au gymnase, quelqu''un l''a vue ?',
      'Je peux emmener 3 enfants samedi, il me reste de la place.',
      'On sait à quelle heure finit le plateau samedi ?',
      'Petit rappel : prévoir un goûter pour la fin de séance vendredi.',
      'Il faut des chaussures de salle obligatoirement ou des baskets propres suffisent ?',
      'Absent ce mercredi, rendez-vous chez le dentiste. Désolé !',
      'Super match ce week-end, bravo à eux 👏',
      'Les maillots sont à rendre lavés au prochain entraînement ?',
      'Je ramène les enfants du côté de la mairie après la séance si besoin.',
      'Quelqu''un a le numéro du gymnase ? Le portail était fermé.']
    when 'loisirs' then array[
      'On est combien jeudi ? J''amène les chasubles.',
      'Qui est chaud pour un verre après la séance ?',
      'Je serai en retard de 15 min jeudi, commencez sans moi.',
      'Le match amical contre Lardy, c''est toujours d''actualité ?',
      'Quelqu''un a récupéré mon sweat bleu ?',
      'Belle séance hier, on progresse 💪',
      'Je ne pourrai pas venir cette semaine, déplacement pro.']
    when 'coachs' then array[
      'Le gymnase sera fermé le 11 novembre, pensez à prévenir vos familles.',
      'Qui a la clé du local à ballons cette semaine ?',
      'Il manque 2 jeux de chasubles, si quelqu''un les a vus…',
      'Rappel : les feuilles de match sont à rendre au secrétariat.',
      'Je cherche un remplaçant pour coacher les U11 samedi matin.',
      'Formation arbitrage jeunes le mois prochain, inscriptions auprès du bureau.',
      'Pensez à faire l''appel dans l''application, ça aide pour les statistiques.']
    else array[
      'J''ai 2 places au départ de la mairie à 8h45.',
      'Quelqu''un peut prendre ma fille ? Je travaille ce samedi-là.',
      'Je propose un départ groupé du parking du gymnase à 9h.',
      'Il me reste une place, qui est intéressé ?',
      'Merci pour l''organisation, on s''inscrit pour l''aller.']
  end);
$$;

create function simu.groupe(c uuid, p_name text, p_genre text, p_creator uuid, p_members uuid[]) returns uuid language plpgsql as $$
declare g uuid; poll uuid; u uuid; i int; membres uuid[];
begin
  insert into groups(club_id, name, created_by, created_at) values (c, p_name, p_creator, now() - interval '12 days') returning id into g;
  perform simu.reg('groups', g); insert into simu.groupes values (g, p_genre);
  insert into group_members(group_id, user_id) select g, x from unnest(array_append(p_members, p_creator)) x where x is not null on conflict do nothing;
  select array_agg(user_id) into membres from group_members where group_id = g and user_id <> simu.get('gael')::uuid;
  if coalesce(cardinality(membres), 0) = 0 then return g; end if;
  for i in 1..(6 + floor(random() * 8))::int loop
    insert into messages(group_id, user_id, body, created_at)
      values (g, membres[1 + floor(random() * cardinality(membres))::int], simu.phrase(p_genre), now() - (i * interval '5 hours') - random() * interval '3 hours');
  end loop;
  insert into polls(group_id, question, created_by, created_at)
    values (g, case p_genre when 'loisirs' then 'Match amical jeudi prochain ?' when 'coachs' then 'Repas des coachs avant Noël ?'
                            when 'covoit' then 'Tu viens au tournoi de Noël ?' else 'Sortie au match de Pro B un samedi ?' end, p_creator, now() - interval '2 days')
    returning id into poll;
  perform simu.reg('polls', poll);
  insert into poll_votes(poll_id, user_id, answer)
    select poll, x, simu.pick(array['Présent','Présent','Absent','Je ne sais pas']) from unnest(membres) x where random() < 0.45 on conflict do nothing;
  return g;
end $$;

-- =====================================================================
-- Animation « en direct »
-- =====================================================================
-- Fait remonter un changement à l'écran de Gaël (l'application se recharge quand une de ses adhésions bouge)
create function simu.pousser() returns void language sql as $$
  update memberships set status = status where user_id = simu.get('gael')::uuid and club_id = simu.get('club')::uuid;
$$;

create function simu.mes_equipes() returns uuid[] language sql stable as $$
  select array_agg(distinct team_id) from memberships where user_id = simu.get('gael')::uuid and club_id = simu.get('club')::uuid and team_id is not null and status = 'active';
$$;

create function simu.tick() returns text language plpgsql as $$
declare r float := random(); g uuid; u uuid; e record; p uuid; pl record; club uuid := simu.get('club')::uuid; gael uuid := simu.get('gael')::uuid;
        bureau uuid[] := string_to_array(simu.get('bureau'), ',')::uuid[]; nom text; quoi text := 'rien'; tid uuid; mes uuid[];
begin
  if club is null then return 'Simulation non installée'; end if;
  if simu.get('fin') is not null and simu.get('fin')::timestamptz < now() then perform simu.arreter(); return 'Animation terminée'; end if;

  if r < 0.42 then                                                   -- un message dans un de tes groupes
    select sg.id, sg.genre into e from simu.groupes sg join group_members gm on gm.group_id = sg.id and gm.user_id = gael order by random() limit 1;
    if e.id is not null then
      select user_id into u from group_members where group_id = e.id and user_id <> gael order by random() limit 1;
      if u is not null then insert into messages(group_id, user_id, body) values (e.id, u, simu.phrase(e.genre)); quoi := 'message'; end if;
    end if;

  elsif r < 0.67 then                                                -- une réponse (ou un changement d'avis) à un rendez-vous de tes équipes
    select ev.* into e from events ev where ev.club_id = club and not ev.cancelled and ev.starts_at between now() and now() + interval '10 days'
      and ev.audience = 'team' and ev.team_ids && simu.mes_equipes() order by random() limit 1;
    if e.id is not null then
      select x.id, x.user_id, (select pp.user_id from player_parents pp where pp.player_id = x.id and pp.user_id <> gael limit 1) parent into pl
        from players x where x.team_id = any(e.team_ids) and x.deleted_at is null and (x.user_id is null or x.user_id <> gael) order by random() limit 1;
      if pl.user_id is not null then
        insert into event_responses(event_id, user_id, answer) values (e.id, pl.user_id, case when random() < 0.75 then 'oui' else 'non' end)
          on conflict (event_id, user_id) where player_id is null do update set answer = excluded.answer, updated_at = now();
        quoi := 'réponse';
      elsif pl.parent is not null then
        insert into event_responses(event_id, user_id, player_id, answer) values (e.id, pl.parent, pl.id, case when random() < 0.75 then 'oui' else 'non' end)
          on conflict (event_id, player_id) where player_id is not null do update set answer = excluded.answer, user_id = excluded.user_id, updated_at = now();
        quoi := 'réponse';
      end if;
    end if;

  elsif r < 0.77 then                                                -- un vote à un sondage
    select po.id, po.group_id into e from polls po join simu.groupes sg on sg.id = po.group_id where po.deleted_at is null order by random() limit 1;
    if e.id is not null then
      select gm.user_id into u from group_members gm where gm.group_id = e.group_id and gm.user_id <> gael
        and not exists(select 1 from poll_votes v where v.poll_id = e.id and v.user_id = gm.user_id) order by random() limit 1;
      if u is not null then insert into poll_votes values (e.id, u, simu.pick(array['Présent','Présent','Absent','Je ne sais pas'])); quoi := 'vote'; end if;
    end if;

  elsif r < 0.82 then                                                -- un nouveau sondage
    select sg.id into g from simu.groupes sg join group_members gm on gm.group_id = sg.id and gm.user_id = gael order by random() limit 1;
    select user_id into u from group_members where group_id = g and user_id <> gael order by random() limit 1;
    if u is not null then
      insert into polls(group_id, question, created_by) values (g, simu.pick(array['Goûter partagé vendredi ?','Qui est dispo pour tenir la table de marque samedi ?','Séance photo le 14 : vous venez ?','Repas de fin d''année, ça vous dit ?']), u)
        returning id into p;
      perform simu.reg('polls', p); quoi := 'sondage';
    end if;

  elsif r < 0.88 then                                                -- un nouveau rendez-vous (match ou plateau) pour une de tes équipes
    mes := simu.mes_equipes(); tid := mes[1 + floor(random() * cardinality(mes))::int];
    select user_id into u from memberships where team_id = tid and role = 'coach' and status = 'active' and user_id <> gael limit 1;
    insert into events(club_id, audience, team_ids, type, title, starts_at, place, opponents, created_by)
      values (club, 'team', array[tid], 'Match', 'Match amical ' || (select name from teams where id = tid),
              simu.paris((now() at time zone 'Europe/Paris')::date + 5 + floor(random() * 15)::int, simu.pick(array['10:30','14:00','16:00'])),
              'Gymnase du collège', simu.pick(array['Lardy','Étréchy','Arpajon','Breuillet']), coalesce(u, bureau[1])) returning id into p;
    perform simu.reg('events', p); perform simu.pousser(); quoi := 'nouveau rendez-vous';

  elsif r < 0.93 then                                                -- un rendez-vous déplacé ou annulé
    select ev.* into e from events ev join simu.objets o on o.tbl = 'events' and o.id = ev.id
      where ev.starts_at between now() + interval '2 days' and now() + interval '15 days' and not ev.cancelled and ev.team_ids && simu.mes_equipes()
      and ev.type <> 'Entraînement' order by random() limit 1;
    if e.id is not null then
      if random() < 0.7 then update events set starts_at = starts_at + interval '30 minutes' where id = e.id; quoi := 'rendez-vous déplacé';
      else update events set cancelled = true where id = e.id; quoi := 'rendez-vous annulé'; end if;
      perform simu.pousser();
    end if;

  else                                                               -- une nouvelle demande à valider dans ton équipe U9 M (6 au plus)
    if (select count(*) from simu.journal where action = 'demande') < 6 then
      nom := simu.nom(); u := simu.personne(simu.prenom(true), nom);
      insert into memberships(club_id, user_id, role, team_id, child_first, child_last, status)
        values (club, u, 'parent', ((simu.get('equipes'))::jsonb->>'U9 M')::uuid, simu.prenom(false), nom, 'pending');
      quoi := 'demande';
    end if;
  end if;

  if quoi <> 'rien' then insert into simu.journal(action) values (quoi); end if;
  return quoi;
end $$;

create function simu.rafale(n int default 10) returns text language plpgsql as $$
declare i int; res text[] := '{}';
begin
  for i in 1..least(greatest(n, 1), 100) loop res := res || simu.tick(); end loop;
  return array_to_string(res, ', ');
end $$;

create function simu.demarrer(p_minutes int default 120) returns text language plpgsql as $$
declare fin timestamptz := now() + make_interval(mins => least(greatest(p_minutes, 5), 600));
begin
  insert into simu.etat values ('fin', fin::text) on conflict (k) do update set v = excluded.v;
  begin perform cron.unschedule('pocket-simu'); exception when others then null; end;
  begin
    perform cron.schedule('pocket-simu', '* * * * *', 'select simu.tick()');
  exception when others then
    return 'Animation automatique indisponible : active « Cron » dans Supabase (Integrations), puis relance select simu.demarrer(120); — en attendant : select simu.rafale(10);';
  end;
  return 'Animation lancée jusqu''à ' || to_char(fin at time zone 'Europe/Paris', 'HH24"h"MI') || ' (heure de Paris), environ une action par minute.';
end $$;

create function simu.arreter() returns text language plpgsql as $$
begin
  delete from simu.etat where k = 'fin';
  begin perform cron.unschedule('pocket-simu'); exception when others then null; end;
  return 'Animation arrêtée.';
end $$;

-- Efface toute la simulation, y compris tes profils de test ; rien d'autre n'est touché
create function simu.effacer() returns text language plpgsql as $$
declare club_simu uuid; n int;
begin
  begin perform cron.unschedule('pocket-simu'); exception when others then null; end;
  select id into club_simu from simu.objets where tbl = 'clubs' limit 1;
  delete from events where id in (select id from simu.objets where tbl = 'events')
     or (audience = 'team' and team_ids <@ array(select id from simu.objets where tbl = 'teams') and cardinality(team_ids) > 0);
  delete from groups where id in (select id from simu.objets where tbl = 'groups');
  delete from memberships where id in (select id from simu.objets where tbl = 'memberships');
  delete from players where id in (select id from simu.objets where tbl = 'players');
  delete from fee_grid where id in (select id from simu.objets where tbl = 'fee_grid');
  delete from teams where id in (select id from simu.objets where tbl = 'teams');
  delete from auth.users where email like 'simu+%@simulation.invalid';
  get diagnostics n = row_count;
  if club_simu is not null then delete from clubs where id = club_simu; end if;
  drop schema simu cascade;
  return format('Simulation effacée (%s comptes fictifs supprimés).', n);
end $$;

revoke all on all functions in schema simu from public;

-- =====================================================================
-- Lancement — remplace l'adresse si ton compte Pocket Club utilise une autre adresse
-- =====================================================================
select simu.installer('raveneau.gael@yahoo.fr', 'Boissy');
