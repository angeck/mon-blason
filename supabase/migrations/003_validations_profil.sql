-- Mon Blason · alpha 0.3 · pseudo, règles de validation, demandes en direct (garde toutes les données)
alter table profiles add column if not exists nickname text;

-- Qui peut valider ou retirer une adhésion :
-- président : tout ; bureau : joueurs, parents, coachs, supporteurs ; coach : joueurs et parents de son équipe.
create or replace function can_validate(mid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from memberships t
    join memberships me on me.club_id = t.club_id and me.user_id = auth.uid() and me.status = 'active'
    where t.id = mid and t.user_id <> auth.uid() and (
      me.role = 'president'
      or (me.role = 'bureau' and t.role in ('joueur','parent','coach','supporteur'))
      or (me.role = 'coach' and t.role in ('joueur','parent') and t.team_id is not null and t.team_id = me.team_id)));
$$;

create or replace function validate_membership(mid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_validate(mid) then raise exception 'Vous ne pouvez pas valider cette demande'; end if;
  update memberships set status = 'active' where id = mid;
end $$;

drop policy if exists "adhésions validées par l'encadrement" on memberships;
drop policy if exists "adhésion quittée par soi ou retirée par l'encadrement" on memberships;
drop policy if exists "adhésion quittée par soi ou retirée selon les droits" on memberships;
create policy "adhésion quittée par soi ou retirée selon les droits" on memberships for delete using (user_id = auth.uid() or can_validate(id));

do $$ begin
  alter publication supabase_realtime add table memberships;
exception when duplicate_object then null; end $$;
