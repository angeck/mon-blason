# Mon Blason · alpha

*Mon club, mes couleurs.* Application web installable (PWA) pour les clubs sportifs : agenda avec réponses « Je viens / Je ne viens pas », groupes d'échange (messages en direct, sondages), équipes et membres.

- Données : Supabase (base PostgreSQL, comptes, temps réel), protégées par des règles d'accès (RLS) dans `supabase/schema.sql`.
- Interface : HTML, CSS et JavaScript, sans étape de compilation. Hébergement : GitHub Pages.

## Mise en route

1. **Base** : Supabase → SQL Editor → coller `supabase/schema.sql` → *Run*.
2. **Comptes** : Supabase → Authentication → Sign In / Providers → Email : désactiver *Confirm email* pendant l'alpha.
3. **Adresse** : Supabase → Authentication → URL Configuration → *Site URL* = `https://angeck.github.io/mon-blason/`.
4. **Mise en ligne** : GitHub → Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
5. Sur le téléphone : ouvrir l'adresse, puis « Ajouter à l'écran d'accueil ».

## Ce que fait l'alpha

- Créer un compte, créer un club (le créateur en est président) ou le rejoindre avec un code à 6 caractères.
- Supporteur : accès immédiat. Parent de joueur, joueur, coach, bureau : validés par le président, le bureau ou un coach.
- Équipes, membres, demandes à valider, retrait d'un membre.
- Agenda : entraînement, match, plateau, tournoi, événement ; réponses en direct.
- Groupes d'échange créés par tout membre, avec invitations, messages en direct, sondages (Présent / Absent / Je ne sais pas), notifications coupables.
- Bouton « Actualiser », application ouverte même hors connexion (dernières données chargées).
