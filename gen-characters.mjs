import { readFileSync, writeFileSync } from 'fs';

const API_KEY = 'AIzaSyCZOFmD4PYFONfrIJSnTb8lwPPc9s2dX-0';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${API_KEY}`;

// Extract base64 from style-ref.js
const styleRefFile = readFileSync('/Users/cherryrock/.openclaw/workspace/ring-ring/src/data/style-ref.js', 'utf8');
const match = styleRefFile.match(/STYLE_REF_B64\s*=\s*"([^"]+)"/);
if (!match) { console.error('Could not extract STYLE_REF_B64'); process.exit(1); }
const STYLE_REF_B64 = match[1];

const characters = [
  { file: 'lego-spaceman.png', prompt: 'A classic 1980s LEGO Space astronaut minifigure with a blue spacesuit, cracked helmet visor, big smile, and LEGO hands. Watercolor cartoon illustration, soft paint textures, bold black outlines, friendly rounded proportions, portrait upper body centered, pure white background.' },
  { file: 'lego-pirate.png', prompt: 'A classic LEGO pirate captain minifigure with a big red beard, eye patch, hook hand, black pirate hat with skull and crossbones, red coat. Watercolor cartoon illustration, soft paint textures, bold black outlines, friendly rounded proportions, portrait upper body centered, pure white background.' },
  { file: 'lego-knight.png', prompt: 'A classic LEGO Castle knight minifigure in gray armor with yellow castle crest on chest, helmet with visor up showing friendly face, holding sword and shield. Watercolor cartoon illustration, soft paint textures, bold black outlines, friendly rounded proportions, portrait upper body centered, pure white background.' },
  { file: 'lego-cop.png', prompt: 'A classic LEGO City police officer minifigure in dark blue uniform with badge, police cap, big friendly permanent smile, holding walkie-talkie. Watercolor cartoon illustration, soft paint textures, bold black outlines, friendly rounded proportions, portrait upper body centered, pure white background.' },
  { file: 'lego-firefighter.png', prompt: 'A classic LEGO City firefighter minifigure with red helmet, yellow firefighter coat, big friendly smile, holding oversized axe. Watercolor cartoon illustration, soft paint textures, bold black outlines, friendly rounded proportions, portrait upper body centered, pure white background.' },
  { file: 'lego-construction.png', prompt: 'A classic LEGO construction worker minifigure with orange hard hat, orange safety vest over blue shirt, big friendly smile, holding wrench. Watercolor cartoon illustration, soft paint textures, bold black outlines, friendly rounded proportions, portrait upper body centered, pure white background.' },
];

const OUT_DIR = '/Users/cherryrock/.openclaw/workspace/ring-ring/public/characters';

async function generate(char) {
  console.log(`Generating ${char.file}...`);
  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: STYLE_REF_B64 } },
        { text: `Using the style of the reference image above, generate: ${char.prompt}` }
      ]
    }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`FAILED ${char.file}: ${res.status} ${err}`);
    return false;
  }

  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData);
  if (!imgPart) {
    console.error(`FAILED ${char.file}: No image in response. Parts:`, parts.map(p => Object.keys(p)));
    return false;
  }

  const buf = Buffer.from(imgPart.inlineData.data, 'base64');
  writeFileSync(`${OUT_DIR}/${char.file}`, buf);
  console.log(`SUCCESS ${char.file} (${(buf.length/1024).toFixed(0)}KB)`);
  return true;
}

async function main() {
  const results = {};
  for (const char of characters) {
    results[char.file] = await generate(char);
    // Small delay between requests
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('\n=== RESULTS ===');
  for (const [file, ok] of Object.entries(results)) {
    console.log(`${ok ? '✅' : '❌'} ${file}`);
  }
}

main();
