-- mypocketclub · alpha 5.9.0 · mise à jour d'une base 5.7.0 ou 5.8.0, sans perte de données, relançable.
--   N° 226 · catégories du basket (décision de Gaël du 13 novembre 2026) : U17 devient U18 et U20 devient U21.
--            Équipes (catégorie, et nom automatique « U17 M » → « U18 M » ; un nom choisi par le club ne change pas),
--            tarifs par catégorie, tag d'âge des exercices (U17 → U18).
--            Les catégories du volley (M7 à M21, Seniors, Masters) sont dans l'application : rien à changer en base.
--   (N° 221 à 225 : application seulement.)
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

update teams set category = 'U18' where category = 'U17';
update teams set category = 'U21' where category = 'U20';
update teams set name = 'U18' || substr(name, 4) where name ~ '^U17( [FM])?$';
update teams set name = 'U21' || substr(name, 4) where name ~ '^U20( [FM])?$';

-- un tarif n'est renommé que si la catégorie d'arrivée n'a pas déjà son tarif (sinon il resterait deux tarifs pour la même catégorie)
update fee_grid f set category = 'U18' where f.category = 'U17'
  and not exists (select 1 from fee_grid g where g.club_id = f.club_id and g.season = f.season and g.category = 'U18');
update fee_grid f set category = 'U21' where f.category = 'U20'
  and not exists (select 1 from fee_grid g where g.club_id = f.club_id and g.season = f.season and g.category = 'U21');

update exercises set tags = array_replace(tags, 'U17', 'U18') where 'U17' = any(tags) and not 'U18' = any(tags);
update exercises set tags = array_remove(tags, 'U17') where 'U17' = any(tags);

select close_visitor_functions();
