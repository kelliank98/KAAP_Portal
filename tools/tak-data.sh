#!/usr/bin/env bash
# KAAP Inkoop-radar – tak "data" klaarzetten  v1.0
# Zoekopdrachten (profiles.json) en resultaten (results.json) staan sinds ophaler v1.17 op een eigen tak "data", niet
# op main. Zo zet de ophaler geen commits meer op main en hoeft de gebruiker in GitHub Desktop niet steeds Pull origin
# te doen (wens gebruiker 09-10-2026). Bestaat de tak nog niet, dan maakt dit script hem één keer aan met de bestanden
# zoals ze nu op main staan, zodat er niets verloren gaat. Bestaat hij al, dan doet het niets.
#
# Gebruik (in de workflow, vanuit de map van main):  bash tools/tak-data.sh [remote]
set -euo pipefail
remote="${1:-origin}"
if git ls-remote --exit-code --heads "$remote" data >/dev/null 2>&1; then
  echo "Tak data bestaat al."
  exit 0
fi
regels=""
for f in profiles.json results.json; do
  [ -f "$f" ] || continue
  regels="${regels}100644 blob $(git hash-object -w "$f")"$'\t'"${f}"$'\n'
done
if [ -z "$regels" ]; then echo "Geen profiles.json of results.json om de tak data mee te beginnen." >&2; exit 1; fi
boom=$(printf '%s' "$regels" | git mktree)
export GIT_AUTHOR_NAME=inkoop-radar GIT_AUTHOR_EMAIL=inkoop-radar@users.noreply.github.com
export GIT_COMMITTER_NAME=inkoop-radar GIT_COMMITTER_EMAIL=inkoop-radar@users.noreply.github.com
commit=$(git commit-tree "$boom" -m "Tak data: zoekopdrachten en resultaten van de Inkoop Radar")
git push --quiet "$remote" "$commit:refs/heads/data"
echo "Tak data aangemaakt met: $(printf '%s' "$regels" | cut -f2 | tr '\n' ' ')"
