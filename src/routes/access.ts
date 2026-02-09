import { Hono } from 'hono';
import type { Env } from '../index';
import { getToken } from './auth';

const access = new Hono<{ Bindings: Env }>();

// GET /api/access — check if authenticated user has course access
access.get('/access', async (c) => {
  const token = getToken(c);

  if (!token) {
    return c.json({ hasAccess: false, reason: 'not_authenticated' }, 401);
  }

  const session = await c.env.DB.prepare(
    'SELECT email FROM sessions WHERE token = ? AND expires_at > datetime(\'now\') LIMIT 1'
  ).bind(token).first();

  if (!session) {
    return c.json({ hasAccess: false, reason: 'invalid_session' }, 401);
  }

  const courseSlug = c.req.query('course') || 'openclaw-beginner-course';
  const email = session.email as string;

  const purchase = await c.env.DB.prepare(
    'SELECT id FROM purchases WHERE email = ? AND course_slug = ? AND status = \'completed\' LIMIT 1'
  ).bind(email, courseSlug).first();

  return c.json({
    hasAccess: !!purchase,
    email,
    course: courseSlug,
  });
});

export { access as accessRoutes };
