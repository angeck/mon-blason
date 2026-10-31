-- MAJ_ALPHA_3_2_4.sql · Pocket Club · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.2).
-- Contient la 3.2.1 (vidéos des exercices) et la 3.2.4 (séries, retrait de la fonction événements et buvette), sans effacer de données. Peut être relancé sans risque.

-- =====================================================================
-- Alpha 3.2.1 · vidéos des exercices (stockage privé Supabase, vignette dans la liste)
-- Relançable sans risque.
-- =====================================================================
alter table exercises add column if not exists video_path text not null default '';
alter table exercises add column if not exists poster_path text not null default '';
do $$ begin
  alter table exercises add constraint exercises_video_len check (length(video_path) <= 200 and length(poster_path) <= 200);
exception when duplicate_object then null; end $$;

-- Espace de stockage privé : un dossier par exercice (<id de l'exercice>/video.mp4 et poster.jpg), 50 Mo par fichier
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', false, 52428800, array['video/mp4','video/quicktime','video/webm','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function exercise_of_path(p text) returns uuid language sql immutable as $$
  select case when split_part(p, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p, '/', 1)::uuid end;
$$;
-- Lecture : qui voit l'exercice voit sa vidéo ; ajout, remplacement, retrait : l'auteur seulement
drop policy if exists "video d'exercice lisible" on storage.objects;
create policy "video d'exercice lisible" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos' and (can_see_exercise(exercise_of_path(name))
         or exists(select 1 from exercises e where e.video_path = name and can_see_exercise(e.id))));
drop policy if exists "video d'exercice ajoutee par l'auteur" on storage.objects;
create policy "video d'exercice ajoutee par l'auteur" on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-videos' and exists(select 1 from exercises e where e.id = exercise_of_path(name) and e.created_by = auth.uid() and e.deleted_at is null));
drop policy if exists "video d'exercice remplacee par l'auteur" on storage.objects;
create policy "video d'exercice remplacee par l'auteur" on storage.objects for update to authenticated
  using (bucket_id = 'exercise-videos' and exists(select 1 from exercises e where e.id = exercise_of_path(name) and e.created_by = auth.uid()));
drop policy if exists "video d'exercice retiree par l'auteur" on storage.objects;
create policy "video d'exercice retiree par l'auteur" on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-videos' and exists(select 1 from exercises e where e.id = exercise_of_path(name) and e.created_by = auth.uid()));

-- Une nouvelle vidéo sur un exercice public repasse par la validation du bureau
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
      or (new.title, new.description, new.diagram, new.source, new.origin, new.video_path) is distinct from (old.title, old.description, old.diagram, old.source, old.origin, old.video_path) then
      new.public_state := 'pending'; new.validated_by := null; new.validated_at := null;
    else new.public_state := old.public_state;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- Pocket Club · alpha 3.2.4 (mise à jour cumulative, relançable sans risque)
-- À installer APRÈS schema.sql, alpha_3_0_1, alpha_3_0_2, alpha_3_1, alpha_3_2 et alpha_3_2_1.
--   n° 57 : reprise des entraînements sans lien de série (recopiés, importés, créés avant la 3.1)
--   Retrait de la fonction « Responsable événements et buvette » et de la rubrique « Événements et buvette »
-- =====================================================================

-- ---------------------------------------------------------------------
-- N° 57 · Rattacher à une série les entraînements identiques restés sans lien
-- Même club, mêmes équipes, même titre, même jour de la semaine, même heure (heure de Paris), même créateur ;
-- au moins deux séances. Les séances déjà liées à une série ne sont jamais touchées.
-- Relançable : une fois rattachées, les séances ne sont plus « sans lien ».
-- ---------------------------------------------------------------------
create or replace function link_unlinked_trainings() returns int
language plpgsql set search_path = public as $$
declare g record; sid uuid; n int := 0;
begin
  for g in
    select club_id, team_ids, lower(trim(title)) as k_title, min(title) as title,
           extract(dow from starts_at at time zone 'Europe/Paris')::int as wd,
           to_char(starts_at at time zone 'Europe/Paris', 'HH24:MI') as hm,
           created_by, array_agg(id) as ids,
           max((starts_at at time zone 'Europe/Paris')::date) as last_day
    from events
    where type = 'Entraînement' and series_id is null and audience = 'team'
    group by club_id, team_ids, lower(trim(title)), extract(dow from starts_at at time zone 'Europe/Paris'),
             to_char(starts_at at time zone 'Europe/Paris', 'HH24:MI'), created_by
    having count(*) >= 2
  loop
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (g.club_id, g.title, g.wd, g.hm, g.last_day, true, g.created_by) returning id into sid;
    update events set series_id = sid where id = any(g.ids) and series_id is null;
    n := n + array_length(g.ids, 1);
  end loop;
  return n;
end $$;
revoke all on function link_unlinked_trainings() from public;
do $$ begin execute 'revoke all on function link_unlinked_trainings() from anon, authenticated'; exception when undefined_object then null; end $$;

select link_unlinked_trainings();

-- ---------------------------------------------------------------------
-- Retrait de la fonction « Responsable événements et buvette »
-- Les événements et les bénévoles relèvent du Coordinateur, du vice-président et du président.
-- La rubrique (clé interne « evenements ») reste, sous le nom « Événements ».
-- Reprise sans perte d'accès : les personnes qui avaient cette fonction passent « Membre du bureau »
-- et gardent la rubrique Événements, ouverte en plus, jusqu'à ce que le président règle leur fonction.
-- ---------------------------------------------------------------------
insert into board_areas(club_id, user_id, area)
  select distinct club_id, user_id, 'evenements' from memberships
  where fonction = 'Responsable événements et buvette' and status = 'active' and role = 'bureau'
  on conflict do nothing;
update memberships set fonction = 'Membre du bureau' where fonction = 'Responsable événements et buvette';

alter table memberships drop constraint if exists memberships_fonction;
alter table memberships add constraint memberships_fonction check (fonction is null or fonction in (
  'Vice-président','Secrétaire','Secrétaire adjoint','Trésorier','Trésorier adjoint','Directeur sportif','Coordinateur',
  'Correspondant licences','Chargé de communication','Responsable sponsoring','Membre du bureau'));

create or replace function fonction_areas(f text) returns text[] language sql immutable as $$
  select case f
    when 'Vice-président' then array['tresorerie','secretariat','technique','communication','evenements']
    when 'Trésorier' then array['tresorerie'] when 'Trésorier adjoint' then array['tresorerie']
    when 'Secrétaire' then array['secretariat'] when 'Secrétaire adjoint' then array['secretariat']
    when 'Correspondant licences' then array['secretariat']
    when 'Directeur sportif' then array['technique']
    when 'Coordinateur' then array['technique','evenements']
    when 'Chargé de communication' then array['communication'] when 'Responsable sponsoring' then array['communication']
    else '{}'::text[] end;
$$;

select 'Pocket Club alpha 3.2.4 : mise à jour faite.' as resultat;
