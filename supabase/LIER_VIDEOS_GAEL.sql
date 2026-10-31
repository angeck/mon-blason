-- Relie les vidéos déposées à la main dans Storage > exercise-videos > dossier « gael » aux exercices de Ma banque de raveneau.gael@yahoo.fr.
-- Chaque fichier va sur l'exercice du même nom (accents, majuscules et ponctuation ignorés). Relançable sans risque.
drop policy if exists "video d'exercice lisible" on storage.objects;
create policy "video d'exercice lisible" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos' and (can_see_exercise(exercise_of_path(name))
         or exists(select 1 from exercises e where e.video_path = name and can_see_exercise(e.id))));

create or replace function pc_cle(t text) returns text language sql immutable as $$
  select regexp_replace(translate(lower(t), 'àâäáãéèêëíìîïóòôöõúùûüçñœ', 'aaaaaeeeeiiiiooooouuuucno'), '[^a-z0-9]', '', 'g');
$$;

with u as (select id from auth.users where lower(email) = 'raveneau.gael@yahoo.fr'),
     f as (select name, pc_cle(regexp_replace(split_part(name, '/', 2), '\.[^.]+$', '')) as cle
           from storage.objects where bucket_id = 'exercise-videos' and name like 'gael/%')
update exercises e set video_path = f.name, poster_path = ''
from f, u
where e.created_by = u.id and e.deleted_at is null and pc_cle(e.title) = f.cle and e.video_path is distinct from f.name;

-- Résultat : chaque fichier déposé et l'exercice relié (vide = aucun exercice de ce nom)
select split_part(o.name, '/', 2) as fichier, coalesce(e.title, '⚠ aucun exercice de ce nom') as exercice
from storage.objects o left join exercises e on e.video_path = o.name
where o.bucket_id = 'exercise-videos' and o.name like 'gael/%' order by 1;
