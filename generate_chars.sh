#!/bin/bash
set -e
cd /Users/cherryrock/.openclaw/workspace/ring-ring/public/characters
SCRIPT="uv run /opt/homebrew/lib/node_modules/openclaw/skills/nano-banana-pro/scripts/generate_image.py"
STYLE="vibrant colors, kid-friendly, circular avatar style, white background, Pixar-inspired 3D render"

generate() {
  local name="$1"
  local file="$2"
  echo "Generating $name..."
  $SCRIPT --prompt "Friendly cartoon portrait of $name, $STYLE" --filename "$file" --resolution 1K || echo "FAILED: $name"
}

# Paw Patrol
generate "Chase the police pup German Shepherd from Paw Patrol" "chase.png"
generate "Marshall the fire pup Dalmatian from Paw Patrol" "marshall.png"
generate "Skye the aviation pup Cockapoo from Paw Patrol" "skye.png"
generate "Rubble the construction pup English Bulldog from Paw Patrol" "rubble.png"
generate "Rocky the recycling pup mixed breed from Paw Patrol" "rocky.png"
generate "Zuma the water rescue pup Chocolate Lab from Paw Patrol" "zuma.png"

# Marvel
generate "Spider-Man the Marvel superhero" "spiderman.png"
generate "Iron Man the Marvel superhero" "ironman.png"
generate "Captain America the Marvel superhero" "captain-america.png"
generate "Black Panther the Marvel superhero" "black-panther.png"
generate "Thor the Marvel superhero" "thor.png"
generate "Hulk the Marvel superhero" "hulk.png"

# Disney
generate "Elsa from Frozen" "elsa.png"
generate "Moana the Disney princess" "moana.png"
generate "Buzz Lightyear from Toy Story" "buzz.png"
generate "Woody the cowboy from Toy Story" "woody.png"
generate "Simba from The Lion King" "simba.png"
generate "Stitch from Lilo and Stitch" "stitch.png"

echo "DONE generating all characters"
