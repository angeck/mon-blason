-- MAJ_ALPHA_5_5_0.sql · mypocketclub · justificatif d'adhésion pour un comité d'entreprise (n° 164) · à lancer une fois dans Supabase > SQL Editor > Run (après la 5.4.0).
-- Sans perte de données, relançable sans risque. L'onboarding et la FAQ n'ont besoin d'aucun script. Rien à redéployer.

-- mypocketclub · alpha 5.5.0 · mise à jour d'une base 5.4.0, sans perte de données, relançable.
--   N° 164 · justificatif d'adhésion (pour un comité d'entreprise) : délivré par le président ou la trésorerie, pour les
--   versements réellement notés dans le club ; chaque justificatif délivré est inscrit au journal du président.
--   (L'onboarding de la 5.5.0 n'a besoin d'aucun script : sa progression est gardée dans les métadonnées du compte.)
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

create or replace function membership_attestation(p_player uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl players; c clubs; t teams; paid numeric; pays jsonb; fn text; me text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into pl from players where id = p_player and deleted_at is null;
  if pl.id is null then raise exception 'Fiche introuvable'; end if;
  if not (is_president(pl.club_id) or has_area(pl.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if pl.from_partner then raise exception 'Ce joueur est licencié dans le club partenaire'; end if;
  select coalesce(sum(amount), 0), coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_at', paid_at, 'method', method) order by paid_at), '[]'::jsonb)
    into paid, pays from player_payments where player_id = pl.id;
  if paid <= 0 then raise exception 'Aucun versement noté pour ce joueur : pas de justificatif possible'; end if;
  select * into c from clubs where id = pl.club_id;
  select * into t from teams where id = pl.team_id;
  fn := case when is_president(pl.club_id) then 'Président' else 'Trésorier' end;
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'Le responsable du club') into me from profiles where id = auth.uid();
  perform log_action(pl.club_id, null, pl.id, 'justificatif d''adhésion délivré', jsonb_build_object('montant', paid));
  return jsonb_build_object('club', c.name, 'city', c.city, 'sport', c.sport, 'first_name', pl.first_name, 'last_name', pl.last_name,
    'birth_date', pl.birth_date, 'team', coalesce(t.name, ''), 'season', coalesce(t.season, season_label(now())), 'paid', paid, 'payments', pays,
    'signer', me, 'signer_role', fn);
end $$;
revoke execute on function membership_attestation(uuid) from public, anon;
grant execute on function membership_attestation(uuid) to authenticated;

select close_visitor_functions();

select 'mypocketclub alpha 5.5.0 installée' as resultat;
