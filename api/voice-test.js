import { verifyAuth } from './_auth.js';
import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  // Authenticate
  const user = await verifyAuth(req, res);
  if (!user) return;

  const rl = rateLimit(user.id, { maxRequests: 10, windowMs: 60000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests', retryAfter: rl.retryAfter });

  const API_KEY = process.env.MINIMAX_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'MINIMAX_API_KEY not set' });

  const { action } = req.query;

  try {
    if (action === 'upload') {
      // Read raw body from request
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      // Build multipart form manually
      const boundary = '----FormBoundary' + Date.now().toString(36);
      const parts = [];
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="elmo-voice-sample.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
      const fileHeader = Buffer.from(parts[0]);
      const fileTail = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([fileHeader, buffer, fileTail]);

      const resp = await fetch('https://api.minimax.io/v1/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      const data = await resp.json();
      return res.json(data);
    }

    if (action === 'clone') {
      const { file_id, voice_id } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!file_id || !voice_id) return res.status(400).json({ error: 'file_id and voice_id required' });

      const resp = await fetch('https://api.minimax.io/v1/voice_clone', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_id: Number(file_id),
          voice_id,
          model: 'speech-2.8-hd',
          language_boost: 'English',
        }),
      });
      const data = await resp.json();
      return res.json(data);
    }

    if (action === 'synthesize') {
      const { text, voice_id } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!text || !voice_id) return res.status(400).json({ error: 'text and voice_id required' });

      const resp = await fetch('https://api.minimax.io/v1/t2a_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'speech-2.8-hd',
          text,
          stream: false,
          voice_setting: { voice_id, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
          language_boost: 'English',
          output_format: 'url',
        }),
      });
      const data = await resp.json();
      return res.json(data);
    }

    return res.status(400).json({ error: 'Invalid action. Use ?action=upload|clone|synthesize' });
  } catch (err) {
    console.error('voice-test error:', err);
    return res.status(500).json({ error: err.message });
  }
}
