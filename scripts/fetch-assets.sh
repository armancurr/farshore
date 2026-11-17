#!/bin/bash
# Downloads the free (CC0) asset packs the game's models are built from into
# assets-src/, then unpacks them. Build with: node scripts/build-assets.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DL="$ROOT/assets-src/.zips"
mkdir -p "$DL"
UA="Mozilla/5.0"

# A free itch.io download: ask for the download page, then each upload's signed URL.
itch() {
  local user=$1 game=$2 out=$3 jar
  jar=$(mktemp)
  local page token dl
  page=$(curl -s -c "$jar" -b "$jar" -A "$UA" "https://$user.itch.io/$game")
  token=$(grep -o 'name="csrf_token" value="[^"]*' <<<"$page" | head -1 | sed 's/.*value="//')
  dl=$(curl -s -c "$jar" -b "$jar" -A "$UA" -X POST --form-string "csrf_token=$token" \
    "https://$user.itch.io/$game/download_url" | python3 -I -c 'import sys,json;print(json.load(sys.stdin)["url"])')
  page=$(curl -s -c "$jar" -b "$jar" -A "$UA" "$dl")
  token=$(grep -o 'name="csrf_token" value="[^"]*' <<<"$page" | head -1 | sed 's/.*value="//')
  local id
  id=$(grep -o 'data-upload_id="[0-9]*"' <<<"$page" | head -1 | grep -o '[0-9]*')
  local url
  url=$(curl -s -c "$jar" -b "$jar" -A "$UA" -X POST --form-string "csrf_token=$token" \
    "https://$user.itch.io/$game/file/$id?source=game_download" | python3 -I -c 'import sys,json;print(json.load(sys.stdin)["url"])')
  curl -sL -A "$UA" "$url" -o "$DL/$out.zip"
  rm -f "$jar"
}

# A Kenney download: the page names the pack, and a signed link serves it.
kenney() {
  local pack=$1 out=$2 jar id url
  jar=$(mktemp)
  id=$(curl -s -c "$jar" -b "$jar" -A "$UA" "https://kenney.nl/assets/$pack" | grep -o "data-download-id='[^']*" | head -1 | cut -d"'" -f2)
  url=$(curl -s -c "$jar" -b "$jar" -A "$UA" -H "Referer: https://kenney.nl/assets/$pack" \
    "https://kenney.nl/download-link/$id" | python3 -I -c 'import sys,json;print(json.load(sys.stdin)["url"])')
  curl -sL -c "$jar" -b "$jar" -A "$UA" -H "Referer: https://kenney.nl/assets/$pack" "$url" -o "$DL/$out.zip"
  rm -f "$jar"
}

itch kaylousberg kaykit-forest kaykit-forest
itch kaylousberg kaykit-adventurers kaykit-adventurers
itch kaylousberg kaykit-skeletons kaykit-skeletons
itch kaylousberg kaykit-character-animations kaykit-character-animations
itch kaylousberg fantasy-weapons-bits fantasy-weapons-bits
itch kaylousberg rpg-tools-bits rpg-tools-bits
itch quaternius universal-animation-library ual
kenney watercraft-kit k-watercraft-kit
kenney pirate-kit k-pirate-kit
kenney car-kit k-car-kit
kenney survival-kit k-survival-kit
kenney fantasy-town-kit k-fantasy-town-kit

for z in "$DL"/*.zip; do
  name=$(basename "$z" .zip)
  rm -rf "${ROOT:?}/assets-src/$name"
  mkdir -p "$ROOT/assets-src/$name"
  unzip -q -o "$z" -d "$ROOT/assets-src/$name"
done
echo "Unpacked into assets-src/"
