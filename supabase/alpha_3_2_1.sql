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
  using (bucket_id = 'exercise-videos' and can_see_exercise(exercise_of_path(name)));
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
