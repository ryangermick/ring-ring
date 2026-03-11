// api/_auth.js — Verifies Supabase JWT on every request
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function verifyAuth(req, res) {
  if (!supabaseServiceKey) {
    res.status(500).json({ error: 'Server auth not configured' });
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return null;
  }

  const token = authHeader.slice(7);

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return null;
    }

    return user;
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
    return null;
  }
}
