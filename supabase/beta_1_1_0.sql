-- mypocketclub · bêta 1.1.0 · mise à jour d'une base bêta 1.0.x (alpha 5.17.0), sans perte de données, relançable (n° 244).

-- ---------- n° 244 · carte d'identité du club : fédération et numéro d'affiliation ----------
-- Données du club (pas des données personnelles), lues par les membres comme le reste de la fiche du club.
-- Seuls le président et le vice-président les modifient, comme le nom, la ville et le blason (règle de la 3.10.0).
alter table clubs add column if not exists federation text not null default '' check (char_length(federation) <= 40);
alter table clubs add column if not exists affiliation text not null default '' check (char_length(affiliation) <= 30);

create or replace function clubs_guard_b110() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.federation, new.affiliation) is distinct from (old.federation, old.affiliation)
     and not (is_president(old.id) or is_vice_president(old.id)) then
    raise exception 'La fédération et le numéro d''affiliation sont réglés par le président';
  end if;
  return new;
end $$;
drop trigger if exists clubs_guard_b110 on clubs;
create trigger clubs_guard_b110 before update on clubs for each row execute function clubs_guard_b110();
revoke execute on function clubs_guard_b110() from public, anon, authenticated;

select close_visitor_functions();
