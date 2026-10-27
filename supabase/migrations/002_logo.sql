-- Mon Blason · alpha 0.2 · ajout du logo du club (garde toutes les données)
alter table clubs add column if not exists logo text check (logo is null or length(logo) < 400000);
