#!/bin/bash
cd /Users/cherryrock/.openclaw/workspace/ring-ring/public/characters
SCRIPT="uv run /opt/homebrew/lib/node_modules/openclaw/skills/nano-banana-pro/scripts/generate_image.py"
STYLE="vibrant colors, kid-friendly, circular avatar style, white background, Pixar-inspired 3D render"

generate() {
  local name="$1"
  local file="$2"
  echo "Generating $name..."
  $SCRIPT --prompt "Friendly cartoon portrait of $name, $STYLE" --filename "$file" --resolution 1K || echo "FAILED: $name"
}

# Marvel - generic descriptions
generate "a friendly superhero in a red and blue spider-themed costume with web pattern" "spiderman.png"
generate "a friendly superhero in a red and gold high-tech armored suit" "ironman.png"
generate "a friendly superhero in a patriotic red white and blue suit with a star shield" "captain-america.png"
generate "a friendly superhero in a sleek black panther-themed suit" "black-panther.png"
generate "a friendly superhero viking god with long blonde hair holding a lightning hammer" "thor.png"
generate "a friendly big green muscular superhero" "hulk.png"

# Disney - generic descriptions
generate "a beautiful ice queen princess with platinum blonde braid and sparkling blue ice dress" "elsa.png"
generate "a brave Polynesian girl adventurer with long dark curly hair and ocean necklace" "moana.png"
generate "a friendly toy space ranger in a white and green spacesuit with purple accents" "buzz.png"
generate "a friendly toy cowboy with a brown hat yellow plaid shirt and pull-string" "woody.png"
generate "a cute young lion cub with golden fur and a big smile" "simba.png"
generate "a cute small blue alien creature with big ears and four arms" "stitch.png"

echo "DONE"
