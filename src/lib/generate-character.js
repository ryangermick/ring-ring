const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export async function generateCharacter(description) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are helping create a character for a kids' voice-call app where children talk to fictional characters.

Given this description: "${description}"

Generate a complete character profile as JSON with these fields:
- name: The character's name
- description: A short one-line description (e.g. "Police pup who leads the team")
- greeting: What they say when they pick up the phone (fun, in-character, 1-2 sentences)
- systemPrompt: Instructions for the AI to roleplay as this character during a voice call with a young child. Include their personality, catchphrases, and speaking style. End with "Keep responses short — 1-3 sentences."
- voiceName: Pick the most appropriate voice from these options:
  - "Puck" (male, youthful/energetic)
  - "Fenrir" (male, confident/warm)
  - "Charon" (male, deep/commanding)
  - "Orus" (male, dignified/calm)
  - "Aoede" (female, cheerful/bright)
  - "Kore" (female, elegant/warm)
- franchise: Pick the best fit: "paw-patrol", "marvel", "disney", or "custom"

Respond with ONLY valid JSON, no markdown or explanation.`
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        }
      })
    }
  );

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from AI');

  return JSON.parse(text);
}
