import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../index';

const progress = new Hono<{ Bindings: Env }>();

// Helper: get authenticated email from session cookie
async function getAuthEmail(c: any): Promise<string | null> {
  const token = getCookie(c, 'session');
  if (!token) return null;

  const session = await c.env.DB.prepare(
    "SELECT email FROM sessions WHERE token = ? AND expires_at > datetime('now') LIMIT 1"
  ).bind(token).first();

  return session ? (session.email as string) : null;
}

// GET /api/progress?course=openclaw-beginner-course
progress.get('/progress', async (c) => {
  const email = await getAuthEmail(c);
  if (!email) {
    return c.json({ error: 'not_authenticated' }, 401);
  }

  const courseSlug = c.req.query('course') || 'openclaw-beginner-course';

  const row = await c.env.DB.prepare(
    'SELECT completed_lessons, completed_modules, updated_at FROM user_progress WHERE email = ? AND course_slug = ? LIMIT 1'
  ).bind(email, courseSlug).first();

  if (!row) {
    return c.json({
      completedLessons: [],
      completedModules: [],
      updatedAt: null,
    });
  }

  return c.json({
    completedLessons: JSON.parse(row.completed_lessons as string),
    completedModules: JSON.parse(row.completed_modules as string),
    updatedAt: row.updated_at,
  });
});

// PUT /api/progress
progress.put('/progress', async (c) => {
  const email = await getAuthEmail(c);
  if (!email) {
    return c.json({ error: 'not_authenticated' }, 401);
  }

  const { completedLessons, completedModules, courseSlug } = await c.req.json<{
    completedLessons: string[];
    completedModules: string[];
    courseSlug?: string;
  }>();

  const slug = courseSlug || 'openclaw-beginner-course';
  const now = new Date().toISOString();

  // Upsert: try update first, then insert if no rows affected
  const existing = await c.env.DB.prepare(
    'SELECT id FROM user_progress WHERE email = ? AND course_slug = ? LIMIT 1'
  ).bind(email, slug).first();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE user_progress SET completed_lessons = ?, completed_modules = ?, updated_at = ? WHERE email = ? AND course_slug = ?'
    ).bind(
      JSON.stringify(completedLessons),
      JSON.stringify(completedModules),
      now,
      email,
      slug
    ).run();
  } else {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO user_progress (id, email, course_slug, completed_lessons, completed_modules, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      email,
      slug,
      JSON.stringify(completedLessons),
      JSON.stringify(completedModules),
      now
    ).run();
  }

  return c.json({ ok: true, updatedAt: now });
});

export { progress as progressRoutes };
