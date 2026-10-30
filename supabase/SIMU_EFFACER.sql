-- Pocket Club · efface toute la simulation « gros club » (comptes fictifs, équipes, fiches, rendez-vous, groupes, et tes profils de test).
-- Les vraies données du club ne sont pas touchées. À coller dans Supabase → SQL Editor → Run.
do $$ begin
  if to_regprocedure('simu.effacer()') is not null then raise notice '%', simu.effacer();
  else raise notice 'Aucune simulation installée.'; end if;
end $$;
