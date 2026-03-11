// Edge runtime auth verification
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function verifyAuthEdge(req) {
  if (!supabaseServiceKey) {
    return { error: new Response(JSON.stringify({ error: 'Server auth not configured' }), { status: 500 }) };
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 }) };
  }

  const token = authHeader.slice(7);

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { error: new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 }) };
    }

    return { user };
  } catch (err) {
    return { error: new Response(JSON.stringify({ error: 'Authentication failed' }), { status: 401 }) };
  }
}
