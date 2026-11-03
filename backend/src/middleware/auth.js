import { supabase } from '../config/supabase.js';
import { env } from '../config/env.js';

let cachedDevUserId = null;

async function getDevUserId() {
  if (cachedDevUserId) return cachedDevUserId;
  if (!supabase) return '00000000-0000-4000-8000-000000000001';
  try {
    const { data } = await supabase.auth.admin.listUsers();
    if (data?.users?.length > 0) {
      cachedDevUserId = data.users[0].id;
      return cachedDevUserId;
    }
  } catch (err) {
    console.warn('Failed to retrieve dev user:', err.message);
  }
  return '00000000-0000-4000-8000-000000000001';
}

export async function requireUser(req, res, next) {
  if (env.DATA_MODE === 'demo') {
    // Demo identity only. Never use this mode on a public deployment.
    req.user = { id: '00000000-0000-4000-8000-000000000001' };
    return next();
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    // In local development mode without a login screen, use the local dev user in Supabase
    if (env.NODE_ENV === 'development') {
      const devUserId = await getDevUserId();
      req.user = { id: devUserId };
      return next();
    }
    return res.status(401).json({ error: 'Missing bearer token.' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid session.' });
  req.user = { id: data.user.id };
  next();
}
