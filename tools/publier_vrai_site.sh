#!/bin/sh
# N° 220 · copie l'application de ce dépôt (site de TEST) vers le dépôt du vrai site (mypocketclub.fr), en un seul commit par version.
# Usage : sh tools/publier_vrai_site.sh /chemin/du/depot-vrai-site
# - copie seulement les fichiers de l'application (pas supabase/, tests/, tools/, donnees/) ;
# - remet les icônes et le manifeste du vrai site (dossier vrai-site/ : logo bleu, nom « mypocketclub ») ;
# - n'apporte jamais l'historique de ce dépôt ; le commit porte seulement le numéro de version.
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
DST=${1:?"donner le chemin du dépôt du vrai site"}
[ -d "$DST/.git" ] || { echo "STOP : $DST n'est pas un dépôt git"; exit 1; }
[ "$(cd "$DST" && pwd)" != "$SRC" ] || { echo "STOP : la destination est ce dépôt de test"; exit 1; }
# vider la destination (sauf .git et CNAME), puis copier
find "$DST" -mindepth 1 -maxdepth 1 ! -name .git ! -name CNAME -exec rm -rf {} +
(cd "$SRC" && tar cf - --exclude=.git --exclude=./supabase --exclude=./tests --exclude=./tools --exclude=./donnees \
   --exclude=./vrai-site --exclude=./README.md .) | (cd "$DST" && tar xf -)
cp "$SRC"/vrai-site/* "$DST"/
echo "mypocketclub.fr" > "$DST/CNAME"
printf '# mypocketclub\n\nTout ton club dans ta poche · https://mypocketclub.fr\n\nCopyright (c) 2026 Gaël Raveneau. Tous droits réservés (voir LICENSE).\n' > "$DST/README.md"
# garde-fous : rien de test ne doit partir
if grep -rIl "SIMU_\|PROFILS_DE_TEST" "$DST" --exclude-dir=.git >/dev/null 2>&1; then echo "ATTENTION : mention de test trouvée"; fi
V=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/version.json")
cd "$DST" && git add -A && git commit -q -m "mypocketclub $V" && echo "Prêt : commit « mypocketclub $V » (reste : git push)"
