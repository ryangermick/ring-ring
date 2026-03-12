// Serves HTML with OG meta tags for social media crawlers
// For character URLs like /gollum, /gandalf etc.
// Normal browsers get redirected to the SPA; bots get meta tags

export const config = { runtime: 'edge' };

const CHARACTERS = {
  'gandalf': { name: 'Gandalf', description: 'Wise wizard and guide of Middle-earth', franchise: 'Lord of the Rings', image: '/characters/gandalf.png' },
  'aragorn': { name: 'Aragorn', description: 'Brave ranger and rightful King', franchise: 'Lord of the Rings', image: '/characters/aragorn.png' },
  'legolas': { name: 'Legolas', description: 'Sharp-eyed elf archer of the Woodland Realm', franchise: 'Lord of the Rings', image: '/characters/legolas.png' },
  'gimli': { name: 'Gimli', description: 'Fierce and loyal dwarf warrior', franchise: 'Lord of the Rings', image: '/characters/gimli.png' },
  'samwise': { name: 'Samwise Gamgee', description: 'Loyal hobbit gardener and truest friend', franchise: 'Lord of the Rings', image: '/characters/samwise.png' },
  'gollum': { name: 'Gollum', description: 'Sneaky, silly creature obsessed with his Precious', franchise: 'Lord of the Rings', image: '/characters/gollum.png' },
  'chase': { name: 'Chase', description: 'Police pup who leads the team', franchise: 'PAW Patrol', image: '/characters/chase.png' },
  'marshall': { name: 'Marshall', description: 'Fire pup who is a bit clumsy but very brave', franchise: 'PAW Patrol', image: '/characters/marshall.png' },
  'skye': { name: 'Skye', description: 'Aviation pup who loves to fly', franchise: 'PAW Patrol', image: '/characters/skye.png' },
  'rubble': { name: 'Rubble', description: 'Construction pup who loves to dig', franchise: 'PAW Patrol', image: '/characters/rubble.png' },
  'rocky': { name: 'Rocky', description: 'Recycling pup who can fix anything', franchise: 'PAW Patrol', image: '/characters/rocky.png' },
  'zuma': { name: 'Zuma', description: 'Water rescue pup who loves the ocean', franchise: 'PAW Patrol', image: '/characters/zuma.png' },
  'spiderman': { name: 'Spider-Man', description: 'Your friendly neighborhood Spider-Man', franchise: 'Marvel', image: '/characters/spiderman.png' },
  'ironman': { name: 'Iron Man', description: 'Genius inventor in a super suit', franchise: 'Marvel', image: '/characters/ironman.png' },
  'captain-america': { name: 'Captain America', description: 'Super soldier with a heart of gold', franchise: 'Marvel', image: '/characters/captain-america.png' },
  'black-panther': { name: 'Black Panther', description: 'King of Wakanda', franchise: 'Marvel', image: '/characters/black-panther.png' },
  'thor': { name: 'Thor', description: 'God of Thunder', franchise: 'Marvel', image: '/characters/thor.png' },
  'hulk': { name: 'Hulk', description: 'The strongest Avenger', franchise: 'Marvel', image: '/characters/hulk.png' },
  'elsa': { name: 'Elsa', description: 'Queen of Arendelle with ice powers', franchise: 'Disney', image: '/characters/elsa.png' },
  'moana': { name: 'Moana', description: 'Brave voyager of the ocean', franchise: 'Disney', image: '/characters/moana.png' },
  'buzz': { name: 'Buzz Lightyear', description: 'Space Ranger from Star Command', franchise: 'Disney', image: '/characters/buzz.png' },
  'woody': { name: 'Woody', description: 'Loyal cowboy and best friend', franchise: 'Disney', image: '/characters/woody.png' },
  'simba': { name: 'Simba', description: 'The Lion King', franchise: 'Disney', image: '/characters/simba.png' },
  'jiminy-cricket': { name: 'Jiminy Cricket', description: 'Official Conscience from Pinocchio', franchise: 'Disney', image: '/characters/jiminy-cricket.png' },
  'elmo': { name: 'Elmo', description: 'Elmo loves you! Furry red friend', franchise: 'Sesame Street', image: '/characters/elmo.png' },
  'cookie-monster': { name: 'Cookie Monster', description: 'Me want cookie! Blue cookie lover', franchise: 'Sesame Street', image: '/characters/cookie-monster.png' },
  'big-bird': { name: 'Big Bird', description: 'Tall yellow friend on Sesame Street', franchise: 'Sesame Street', image: '/characters/big-bird.png' },
  'oscar': { name: 'Oscar the Grouch', description: 'Lovable grouch in a trash can', franchise: 'Sesame Street', image: '/characters/oscar.png' },
  'grover': { name: 'Grover', description: 'Lovable furry blue helper and Super Grover', franchise: 'Sesame Street', image: '/characters/grover.png' },
  'abby': { name: 'Abby Cadabby', description: 'Fairy-in-training with magical powers', franchise: 'Sesame Street', image: '/characters/abby.png' },
  'harry-potter': { name: 'Harry Potter', description: 'The Boy Who Lived', franchise: 'Hogwarts', image: '/characters/harry-potter.png' },
  'hermione': { name: 'Hermione Granger', description: 'Brightest witch of her age', franchise: 'Hogwarts', image: '/characters/hermione.png' },
  'ron': { name: 'Ron Weasley', description: 'Loyal friend and wizard chess champion', franchise: 'Hogwarts', image: '/characters/ron.png' },
  'hagrid': { name: 'Hagrid', description: 'Gentle half-giant who loves magical creatures', franchise: 'Hogwarts', image: '/characters/hagrid.png' },
  'dumbledore': { name: 'Dumbledore', description: 'Wise headmaster of Hogwarts', franchise: 'Hogwarts', image: '/characters/dumbledore.png' },
  'dobby': { name: 'Dobby', description: 'Free elf and loyal friend', franchise: 'Hogwarts', image: '/characters/dobby.png' },
  'spongebob': { name: 'SpongeBob', description: "I'm ready! Absorbent and yellow and porous", franchise: 'Bikini Bottom', image: '/characters/spongebob.png' },
  'patrick': { name: 'Patrick Star', description: 'Lovably clueless starfish', franchise: 'Bikini Bottom', image: '/characters/patrick.png' },
  'mario': { name: 'Mario', description: "It's-a me! The famous plumber hero", franchise: 'Super Mario Bros', image: '/characters/mario.png' },
  'luigi': { name: 'Luigi', description: "Mario's taller, slightly scared brother", franchise: 'Super Mario Bros', image: '/characters/luigi.png' },
  'batman': { name: 'Batman', description: 'The Dark Knight of Gotham', franchise: 'DC Comics', image: '/characters/batman.png' },
  'superman': { name: 'Superman', description: 'The Man of Steel', franchise: 'DC Comics', image: '/characters/superman.png' },
  'aang': { name: 'Aang', description: 'The last Airbender and Avatar', franchise: 'Avatar', image: '/characters/aang.png' },
  'luffy': { name: 'Luffy', description: 'Rubber pirate who will be King!', franchise: 'One Piece', image: '/characters/luffy.png' },
  'anya': { name: 'Anya Forger', description: 'Telepath who loves spy cartoons', franchise: 'Spy × Family', image: '/characters/anya.png' },
  'bowser': { name: 'Bowser', description: 'King of the Koopas (misunderstood dad)', franchise: 'Super Mario Bros', image: '/characters/bowser.png' },
};

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Discordbot|Googlebot|bingbot|Baiduspider|DuckDuckBot|Embedly|Quora|Showyoubot|outbrain|pinterest|vkShare|Slack/i;

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const ua = req.headers.get('user-agent') || '';

  const char = CHARACTERS[id];

  // If not a known character or not a bot, serve the SPA
  if (!char || !BOT_UA.test(ua)) {
    // Fetch and return the SPA index.html so the client-side router handles it
    const spaUrl = new URL('/index.html', url.origin);
    return fetch(spaUrl);
  }

  const siteUrl = 'https://rrring.app';
  const ogImage = `${siteUrl}/api/og?id=${id}`;
  const charUrl = `${siteUrl}/${id}`;
  const title = `Call ${char.name} — Ring Ring Ring`;
  const desc = `${char.description}. Start a voice call with ${char.name} from ${char.franchise} on Ring Ring Ring!`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${charUrl}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Ring Ring Ring" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${ogImage}" />

  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
</head>
<body>
  <h1>${char.name}</h1>
  <p>${char.description}</p>
  <p>From ${char.franchise}</p>
  <a href="${charUrl}">Start a voice call with ${char.name}</a>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
