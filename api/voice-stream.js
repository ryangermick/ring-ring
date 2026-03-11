import { verifyAuthEdge } from './_authEdge.js';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405 });
  }

  // Authenticate
  const { user, error: authError } = await verifyAuthEdge(req);
  if (authError) return authError;

  const API_KEY = process.env.MINIMAX_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'Missing MINIMAX_API_KEY' }), { status: 500 });
  }

  const { text, voice_id } = await req.json();
  if (!text || !voice_id) {
    return new Response(JSON.stringify({ error: 'text and voice_id required' }), { status: 400 });
  }

  const minimaxResp = await fetch('https://api.minimax.io/v1/t2a_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'speech-2.8-hd',
      text: String(text).slice(0, 5000),
      stream: true,
      voice_setting: {
        voice_id: voice_id,
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        format: 'mp3',
      },
    }),
  });

  if (!minimaxResp.ok) {
    const err = await minimaxResp.text();
    return new Response(JSON.stringify({ error: 'MiniMax error', detail: err }), { status: 502 });
  }

  return new Response(minimaxResp.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
}

export const config = { runtime: 'edge' };
