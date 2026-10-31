# Génère supabase/IMPORT_EXOS_GAEL.sql depuis donnees/exercices-gael.json
import json, re, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(f'{R}/donnees/exercices-gael.json'))
CAT = {'Échauffement': 'Échauffement', 'Opposition / match': 'Jeu', 'Espaces': 'Tactique'}
q = lambda s: "'" + (s or '').replace("'", "''") + "'"
rows, ids = [], {e['id'] for e in d['exercices']}
for e in d['exercices']:
    desc, src = e['description'], ''
    m = re.search(r"\n*Vidéo d'origine : (\S+)", desc)
    if m: src, desc = m.group(1), desc[:m.start()].rstrip()
    cat = 'Retour au calme' if e['nom'].startswith('Retour au calme') else CAT.get(e['theme'], 'Technique')
    rows.append(f"({q(e['id'])}, {q(e['nom'])}, {q(cat)}, {e['duree_min']}, {q(desc)}, {q('adapte' if src else 'perso')}, {q(src)})")
names = {e['nom'].lower(): e['id'] for e in d['exercices']}
names.update({'passe + pivot': 'passe-pivot-evolutif', 'double pas evo': 'double-pas-evolutif'})  # anciens noms
plans = []
for p in d['seances']:
    items = []
    for b in p['blocs']:
        k = b['exercice'] if b['exercice'] in ids else names.get(b['nom'].lower())
        items.append([k, b['nom'], b['duree_min']])
    dd = p['date'].split('-'); plans.append(f"({q('Séance U8-U9 du ' + dd[2] + '/' + dd[1] + '/' + dd[0])}, {q(json.dumps(items, ensure_ascii=False))}::jsonb)")
sql = f"""-- Import des exercices et séances de Gaël (appli U8-U9 Boissy) dans « Ma banque » (privée).
-- Relançable sans risque : ce qui existe déjà (même titre, même auteur) n'est pas recopié.
-- Les vidéos de l'ancienne appli ne sont pas copiées (la banque 3.1 n'a pas de champ vidéo).
do $$
declare
  u uuid; c uuid; x record; n_ex int := 0; n_pl int := 0; it jsonb; j jsonb; xid uuid; t text;
begin
  select id into u from auth.users where lower(email) = 'raveneau.gael@yahoo.fr';
  if u is null then raise exception 'Compte raveneau.gael@yahoo.fr introuvable : crée d''abord ton compte dans l''application.'; end if;
  select m.club_id into c from memberships m where m.user_id = u and m.status = 'active'
    and m.role in ('coach','president','bureau') order by (m.role = 'coach') desc, m.created_at limit 1;
  if c is null then raise exception 'Tu n''es coach ni membre du bureau d''aucun club : rejoins ton club avant l''import.'; end if;
  -- on agit au nom de Gaël, pour que les règles de la base s'appliquent normalement
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.uid', u::text, true);
  create temp table _ex(k text, title text, cat text, dur int, descr text, orig text, src text, nid uuid) on commit drop;
  insert into _ex(k, title, cat, dur, descr, orig, src) values
  {(',' + chr(10) + '  ').join(rows)};
  for x in select * from _ex loop
    select id into xid from exercises where created_by = u and club_id = c and title = x.title and deleted_at is null limit 1;
    if xid is null then
      insert into exercises(club_id, sport, title, category, duration_min, level, description, sharing, origin, source)
      values (c, 'Basket-ball', x.title, x.cat, x.dur, 'U8-U9', x.descr, 'me', x.orig, x.src) returning id into xid;
      n_ex := n_ex + 1;
    end if;
    update _ex set nid = xid where k = x.k;
  end loop;
  for t, j in select * from (values
  {(',' + chr(10) + '  ').join(plans)}) v(t, j) loop
    continue when exists(select 1 from training_plans where created_by = u and club_id = c and title = t and deleted_at is null);
    it := '[]'::jsonb;
    for x in select e.*, b.value->>1 as bn, (b.value->>2)::int as bm from jsonb_array_elements(j) with ordinality b left join _ex e on e.k = b.value->>0 order by b.ordinality loop
      it := it || jsonb_build_array(jsonb_build_object('exercise_id', x.nid, 'title', coalesce(x.title, x.bn), 'category', coalesce(x.cat, 'Technique'),
            'minutes', x.bm, 'sport', 'Basket-ball', 'description', coalesce(x.descr, ''), 'diagram', '[]'::jsonb));
    end loop;
    insert into training_plans(club_id, title, items) values (c, t, it);
    n_pl := n_pl + 1;
  end loop;
  raise notice 'Import terminé : % exercice(s) et % séance(s) ajoutés dans Ma banque.', n_ex, n_pl;
end $$;
"""
open(f'{R}/supabase/IMPORT_EXOS_GAEL.sql', 'w').write(sql)
print(len(rows), len(plans))
