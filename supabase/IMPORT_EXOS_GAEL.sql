-- Import des exercices et séances de Gaël (appli U8-U9 Boissy) dans « Ma banque » (privée).
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
  ('contact-dribble-arriere', 'Contact + dribble arrière', 'Technique', 10, 'Par 2 en face à face (env. 4 m), 1 ballon chacun.
• 10 dribbles rapides sur place.
• On avance en dribblant et on vient taper la main du copain.
• 3 dribbles en marche arrière : dribble de protection, corps et bras en opposition, ballon protégé derrière.
Et ainsi de suite.', 'adapte', 'https://www.facebook.com/share/v/19VbwH24Q4/'),
  ('double-pas-evolutif', 'Double pas évolutif', 'Technique', 15, 'Lay-up main droite, côté droit du panier. Un disque « 0 » au sol marque le dernier appui pied gauche (celui du dernier dribble).

1. Double pas arrêté : pied gauche sur le 0, ballon en main, puis droite-gauche et lay-up.
2. Idem avec un dribble sur place avant le droite-gauche.
3. Départ à 3 pas : on part en dribble en marchant pour que le pied gauche tombe sur le 0, puis droite-gauche.
4. Départ à 6 m en courant : idem.
5. Sans disque.

Rythme à faire dire : « 0 - 1 - 2 - lay-up » (gauche - droite - gauche).
On ne passe à l''étape suivante que si le rythme est acquis.', 'perso', ''),
  ('dribble-feu-tricolore', 'Feu tricolore (dribble sur place)', 'Technique', 5, 'Chaque enfant a son ballon et reste dans sa zone. Le coach annonce la couleur :
• VERT : dribble normal (la balle monte à la taille).
• ORANGE : dribble bas et rapide (hauteur de genou).
• ROUGE : arrêt, ballon tenu à deux mains contre la poitrine.

Niveau 1 : seulement la main forte, avec le bout des doigts, en regardant le coach.
Niveau 2 : alterner main forte et main faible, puis changement de main devant soi, en regardant devant.', 'perso', ''),
  ('dribble-la-traversee', 'La traversée (dribble en déplacement)', 'Technique', 7, 'Aller d''une ligne à l''autre en dribblant, avec des plots espacés comme obstacles. Regard levé, ballon au bout des doigts, ballon loin des plots (du côté opposé).

Niveau 1 : en marchant, un plot sur deux, main forte.
Niveau 2 : en courant, slalom entre les plots, changement de main à chaque plot.

Matériel : 5 plots par couloir, 1 ballon par enfant.', 'perso', ''),
  ('dribble-relais-aller-retour', 'Relais en dribble', 'Technique', 7, 'Équipes de 4 à 5 par panier : aller-retour en dribble autour d''un plot, puis le suivant part. Un seul coureur à la fois, les autres attendent derrière la ligne, et le suivant part quand le coureur est revenu.

Niveau 1 : parcours court, main forte.
Niveau 2 : parcours long, main faible à l''aller, main forte au retour.
Pour finir, on peut ajouter un lay-up simple.

Matériel : 1 plot par équipe, 1 ballon par équipe.', 'perso', ''),
  ('dribble-retour-calme-stop', 'Retour au calme : dribble et stop en deux temps', 'Retour au calme', 3, 'Tous les enfants dribblent dans la zone sans toucher personne. Au signal « stop », ils s''arrêtent en deux temps (1 … 2), genoux fléchis, ballon tenu à deux mains, regard levé.

Niveau 1 : dribble lent, main forte.
Niveau 2 : dribble plus vite, en alternant les mains.', 'perso', ''),
  ('dribble-stop-go-double-pas', 'Dribble stop & go + reverse + double pas', 'Technique', 10, 'Départ ligne de fond côté droit, 3 plots en ligne le long du côté, 1 plot dans le rond central, 1 plot à gauche.
• Dribble main droite vers chaque plot : arrêt, dribbles rapides gauche-droite, accélération (3 fois).
• Rond central : reverse.
• Retour vers le panier par le centre, direction le plot de gauche, puis double pas.
Le suivant part quand le précédent passe le 2e plot.', 'adapte', 'https://www.facebook.com/share/r/151QDjkyhEs/'),
  ('dribble-suis-le-chef', 'Suis le chef (protection du ballon)', 'Technique', 8, 'Par deux : le chef dribble librement dans la zone, le suiveur l''imite en restant derrière. On change de rôle au signal.

Protection du ballon : le chef garde son corps entre le ballon et le suiveur. Le suiveur ne fait que suivre et n''essaie jamais de voler le ballon.

Astuce : associer un enfant à l''aise avec un moins à l''aise, qui progresse en copiant sans pression.
Niveau 1 : chef qui va lentement, main forte.
Niveau 2 : chef rapide, changements de direction et de main.

Matériel : 4 plots pour délimiter chaque zone, 1 ballon par enfant.', 'perso', ''),
  ('epervier-mtwwhvv', 'EPERVIER', 'Échauffement', 10, 'Choisir un des enfants les plus introvertis', 'perso', ''),
  ('espaces-horloge-demarquage', 'L''horloge (se démarquer)', 'Tactique', 10, 'Objectif : se placer là où le porteur peut passer (jamais caché derrière le défenseur).

Groupes de 3 : 1 passeur au centre, 1 réceptionneur, 1 défenseur. 8 pastilles en cercle à 3-4 m autour du passeur.

1. Le coach donne le ballon au passeur, le défenseur vient vite sur lui, bras tendus sans contact. Le réceptionneur file sur une pastille du côté libre, mains en avant + « Oui ! ». Il reçoit, rend tout de suite et change de pastille (« je rends et je bouge »).
2. Évolution : le défenseur se place sur la ligne de passe (entre passeur et réceptionneur) ; le réceptionneur doit changer de côté vite.

Le passeur a le droit de pivoter.
Rotation des 3 rôles toutes les 30 s.
Matériel : 8 pastilles et 1 ballon par groupe.', 'perso', ''),
  ('match-4v4-jnvcspk', 'MATCH 4V4', 'Jeu', 20, '', 'perso', ''),
  ('pac-man-demi-terrain-sncooyq', 'PAC MAN demi terrain', 'Échauffement', 10, '', 'perso', ''),
  ('pac-man-grand-terrain-cstnbuj', 'PAC MAN grand terrain', 'Échauffement', 10, '', 'perso', ''),
  ('passe-coupe-inverse-g3mjtxp', 'PASSE + COUPE INVERSE', 'Technique', 10, '', 'perso', ''),
  ('passe-et-suit-a-3', 'Passe et suit à 3', 'Technique', 10, 'Groupes de 3 sur une même ligne (gauche – milieu – droite), environ 3 à 4 m entre chaque enfant. Passes à deux mains poitrine.

V1 : 1 ballon par groupe
• Celui du milieu a le ballon : il fait une passe à celui de droite et prend sa place.
• Celui de droite dribble vers celui de gauche, lui fait la passe et prend sa place.
• Celui de gauche, avec le ballon, se place au milieu, et on recommence : passe à droite, on prend sa place, et ainsi de suite.

V2 : 3 ballons par groupe (1 ballon chacun)
• Seul celui du milieu se déplace. Il passe à celui de droite et récupère en même temps la passe que celui-ci lui fait.
• Il dribble, fait le tour de celui de droite, puis va vers celui de gauche.
• Avec celui de gauche, même enchaînement : passes croisées, dribble, tour, retour vers le milieu. Et ainsi de suite pendant 30 secondes.
• Au bout de 30 secondes, on tourne : un autre enfant devient celui du milieu.

Consignes : mains en cible, on regarde le receveur avant de passer, ballon protégé pendant le dribble.

Matériel : 1 ballon (V1) ou 3 ballons (V2) et 3 plots par groupe de 3.', 'perso', ''),
  ('passe-pivot-evolutif', 'Passe + pivot évolutif', 'Technique', 15, '1. Face à face à 3 m : passe à terre (rebond aux 2/3).
2. Idem à 5 m.
3. En file : 1 part en dribble, arrêt pieds joints dans les 2 cerceaux, pivot sur un pied, passe à terre à 2 qui fait le même parcours ; 1 revient en fin de file.
4. Idem, 1 défend un peu sur 2 au départ du dribble.
5. Idem avec un départ en dribble gauche-droite.
Matériel : 2 cerceaux par atelier, 1 ballon pour 2.', 'perso', ''),
  ('passe-triangle-a-4', 'Le triangle à 4', 'Technique', 10, 'Objectif : passer AVANT que le défenseur arrive, du côté libre.

Groupes de 4 : 3 passeurs en triangle (4 à 5 m), 1 défenseur au centre sur un plot.

1. Le défenseur part du plot vers le porteur, qui regarde où il arrive et passe du côté libre. Après chaque passe, le défenseur retouche le plot avant de repartir.
2. Sans plot : le défenseur enchaîne directement, il faut décider plus vite.

Règles : passes à 2 mains (poitrine ou à terre), jamais en cloche. Le défenseur gêne mais ne prend pas le ballon ; il marque 1 point s''il touche le porteur avant la passe.
Rotation : nouveau défenseur toutes les 30 s ou après 2 touches.
Réglage : trop dur → agrandir le triangle ou garder le plot ; trop facile → enlever le plot.
Matériel : 1 ballon, 1 plot par groupe.', 'perso', ''),
  ('relais-slalom-tir-double-pas', 'Relais slalom : tir / double pas', 'Technique', 10, 'Mise en place : 2 colonnes derrière la ligne de départ, 4 plots en slalom devant chaque colonne, 1 ballon par colonne.

• Colonne de gauche : slalom en dribble, arrêt sur la zone de tir, tir.
• Colonne de droite : slalom en dribble, puis double pas (appuis 1-2, on lâche le ballon en haut).
• Chacun récupère son rebond, revient en dribble par l''extérieur et donne le ballon au suivant, puis va en fin de colonne.

Au bout de 5 min : les colonnes changent de côté, chacun fait les deux.

Matériel : 8 plots, 2 ballons (+1 de réserve).
Si le double pas coince : tir en course près du panier sans exiger les 2 appuis, ou enlever les 2 derniers plots pour plus d''élan.', 'perso', ''),
  ('remise-en-jeux-digqg23', 'REMISE EN JEUX', 'Tactique', 10, '', 'perso', ''),
  ('tour-de-plots-face-panier', 'Tour de plots face au panier', 'Technique', 10, '3 colonnes sur la ligne de fond, 3 plots par colonne sur la longueur.
• Départ en dribble vers le 1er plot.
• Tour complet du plot en restant toujours face au panier adverse : la partie qui redescend se fait en marche arrière.
• On repart vers le plot suivant, et ainsi de suite jusqu''à la ligne de fond.
La vague suivante part quand la précédente a passé le 1er plot.', 'perso', '');
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
  ('Séance U8-U9 du 28/09/2026', '[["pac-man-grand-terrain-cstnbuj", "PAC MAN grand terrain", 10], ["passe-pivot-evolutif", "PASSE + PIVOT", 10], ["double-pas-evolutif", "DOUBLE PAS EVO", 10], ["pac-man-demi-terrain-sncooyq", "PAC MAN demi terrain", 10]]'::jsonb),
  ('Séance U8-U9 du 03/10/2026', '[["epervier-mtwwhvv", "EPERVIER", 10], ["passe-pivot-evolutif", "Passe + pivot évolutif", 15], ["double-pas-evolutif", "Double pas évolutif", 15], ["relais-slalom-tir-double-pas", "Relais slalom : tir / double pas", 10], ["tour-de-plots-face-panier", "Tour de plots face au panier", 10], ["dribble-stop-go-double-pas", "Dribble stop & go + reverse + double pas", 10], ["match-4v4-jnvcspk", "MATCH 4V4", 20]]'::jsonb),
  ('Séance U8-U9 du 09/10/2026', '[["dribble-feu-tricolore", "Feu tricolore (dribble sur place)", 5], ["contact-dribble-arriere", "Contact + dribble arrière", 10], ["dribble-la-traversee", "La traversée (dribble en déplacement)", 7], ["dribble-relais-aller-retour", "Relais en dribble", 7], ["passe-pivot-evolutif", "Passe + pivot évolutif", 15], ["passe-triangle-a-4", "Le triangle à 4", 10], ["espaces-horloge-demarquage", "L''horloge (se démarquer)", 10], ["match-4v4-jnvcspk", "MATCH 4V4", 20]]'::jsonb),
  ('Séance U8-U9 du 17/10/2026', '[["passe-et-suit-a-3", "Passe et suit à 3", 10], ["dribble-feu-tricolore", "Feu tricolore (dribble sur place)", 5], ["dribble-relais-aller-retour", "Relais en dribble", 7], ["passe-triangle-a-4", "Le triangle à 4", 10], ["passe-pivot-evolutif", "Passe + pivot évolutif", 15], ["double-pas-evolutif", "Double pas évolutif", 15], ["remise-en-jeux-digqg23", "REMISE EN JEUX", 10], ["match-4v4-jnvcspk", "MATCH 4V4", 20]]'::jsonb)) v(t, j) loop
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
