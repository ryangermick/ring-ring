// Dynamic OG image generator for character share cards
// Usage: /api/og?id=gollum
// Returns a rendered PNG using @vercel/og (satori)
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// Import character data inline to avoid ESM issues
const CHARACTERS = {
  'gandalf': { name: 'Gandalf', description: 'Wise wizard and guide of Middle-earth', franchise: 'Lord of the Rings', image: '/characters/gandalf.png' },
  'aragorn': { name: 'Aragorn', description: 'Brave ranger and rightful King', franchise: 'Lord of the Rings', image: '/characters/aragorn.png' },
  'legolas': { name: 'Legolas', description: 'Sharp-eyed elf archer of the Woodland Realm', franchise: 'Lord of the Rings', image: '/characters/legolas.png' },
  'gimli': { name: 'Gimli', description: 'Fierce and loyal dwarf warrior', franchise: 'Lord of the Rings', image: '/characters/gimli.png' },
  'samwise': { name: 'Samwise Gamgee', description: 'Loyal hobbit gardener and truest friend', franchise: 'Lord of the Rings', image: '/characters/samwise.png' },
  'gollum': { name: 'Gollum', description: 'Sneaky, silly creature obsessed with his Precious', franchise: 'Lord of the Rings', image: '/characters/gollum.png' },
  'chase': { name: 'Chase', description: 'Police pup who leads the team', franchise: 'PAW Patrol', image: '/characters/chase.png' },
  'marshall': { name: 'Marshall', description: 'Fire pup who is a bit clumsy but very brave', franchise: 'PAW Patrol', image: '/characters/marshall.png' },
  'spiderman': { name: 'Spider-Man', description: 'Your friendly neighborhood Spider-Man', franchise: 'Marvel', image: '/characters/spiderman.png' },
  'elsa': { name: 'Elsa', description: 'Queen of Arendelle with ice powers', franchise: 'Disney', image: '/characters/elsa.png' },
  'elmo': { name: 'Elmo', description: 'Elmo loves you! Furry red friend', franchise: 'Sesame Street', image: '/characters/elmo.png' },
  'harry-potter': { name: 'Harry Potter', description: 'The Boy Who Lived', franchise: 'Hogwarts', image: '/characters/harry-potter.png' },
  'spongebob': { name: 'SpongeBob', description: "I'm ready! Absorbent and yellow and porous", franchise: 'Bikini Bottom', image: '/characters/spongebob.png' },
  'mario': { name: 'Mario', description: "It's-a me! The famous plumber hero", franchise: 'Super Mario Bros', image: '/characters/mario.png' },
  'batman': { name: 'Batman', description: 'The Dark Knight of Gotham', franchise: 'DC Comics', image: '/characters/batman.png' },
  'aang': { name: 'Aang', description: 'The last Airbender and Avatar', franchise: 'Avatar', image: '/characters/aang.png' },
  'luffy': { name: 'Luffy', description: 'Rubber pirate who will be King!', franchise: 'One Piece', image: '/characters/luffy.png' },
};

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const char = CHARACTERS[id];

  if (!char) {
    return new Response('Not found', { status: 404 });
  }

  const siteUrl = 'https://rrring.app';
  const imageUrl = `${siteUrl}${char.image}`;

  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #FFFBF5 0%, #FFF5E6 50%, #FEF3C7 100%)',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          padding: '60px 80px',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', alignItems: 'center', gap: '60px', width: '100%',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      width: '300px', height: '300px', flexShrink: 0,
                      borderRadius: '50%', background: 'white',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
                      overflow: 'hidden', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      border: '4px solid white',
                    },
                    children: [{
                      type: 'img',
                      props: {
                        src: imageUrl, alt: char.name,
                        style: { width: '100%', height: '100%', objectFit: 'cover' },
                      },
                    }],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', flex: 1 },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { fontSize: '56px', fontWeight: 800, color: '#1A1A2E', lineHeight: 1.1, marginBottom: '12px' },
                          children: char.name,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: { fontSize: '26px', color: '#64748b', fontWeight: 500, marginBottom: '24px', lineHeight: 1.4 },
                          children: char.description,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex', alignItems: 'center', gap: '10px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontSize: '18px', fontWeight: 600, color: '#8B5CF6',
                                  background: 'rgba(139, 92, 246, 0.08)',
                                  padding: '8px 20px', borderRadius: '100px',
                                  letterSpacing: '0.5px',
                                },
                                children: char.franchise,
                              },
                            },
                          ],
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: { marginTop: '28px', fontSize: '22px', color: '#94a3b8', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '10px' },
                          children: [
                            { type: 'div', props: { style: { fontSize: '22px' }, children: '📞' } },
                            'Start a voice call on rrring.app',
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { width: 1200, height: 630 },
  );
}
