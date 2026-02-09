import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../index';

const auth = new Hono<{ Bindings: Env }>();

function generateId(): string {
  return crypto.randomUUID();
}

function generateCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

async function generateToken(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /auth/send-code
auth.post('/send-code', async (c) => {
  const { email } = await c.req.json<{ email: string }>();

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const code = generateCode();
  const id = generateId();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  // Invalidate old codes for this email
  await c.env.DB.prepare(
    'UPDATE auth_codes SET used = 1 WHERE email = ? AND used = 0'
  ).bind(normalizedEmail).run();

  // Insert new code
  await c.env.DB.prepare(
    'INSERT INTO auth_codes (id, email, code, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(id, normalizedEmail, code, expiresAt).run();

  // Send email via Resend (will fail gracefully if key not set)
  try {
    if (c.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'TK100X Academy <academy@tk100x.com>',
          to: normalizedEmail,
          subject: `Your login code: ${code}`,
          html: `
            <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="color: #1e1b4b;">Your login code</h2>
              <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #7c3aed; margin: 24px 0;">${code}</p>
              <p style="color: #64748b;">This code expires in 10 minutes.</p>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 40px;">TK100X GmbH, Graz, Austria</p>
            </div>
          `,
        }),
      });
    } else {
      console.log(`[DEV] Auth code for ${normalizedEmail}: ${code}`);
    }
  } catch (err) {
    console.error('Failed to send email:', err);
  }

  return c.json({ ok: true, message: 'Code sent' });
});

// POST /auth/verify-code
auth.post('/verify-code', async (c) => {
  const { email, code } = await c.req.json<{ email: string; code: string }>();

  if (!email || !code) {
    return c.json({ error: 'Email and code required' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const result = await c.env.DB.prepare(
    'SELECT * FROM auth_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime(\'now\') ORDER BY created_at DESC LIMIT 1'
  ).bind(normalizedEmail, code).first();

  if (!result) {
    return c.json({ error: 'Invalid or expired code' }, 401);
  }

  // Mark code as used
  await c.env.DB.prepare(
    'UPDATE auth_codes SET used = 1 WHERE id = ?'
  ).bind(result.id).run();

  // Create session
  const token = await generateToken();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  await c.env.DB.prepare(
    'INSERT INTO sessions (id, email, token, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(sessionId, normalizedEmail, token, expiresAt).run();

  // Set cookie
  setCookie(c, 'session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  return c.json({ ok: true, email: normalizedEmail });
});

// GET /auth/session
auth.get('/session', async (c) => {
  const token = getCookie(c, 'session');

  if (!token) {
    return c.json({ authenticated: false }, 401);
  }

  const session = await c.env.DB.prepare(
    'SELECT * FROM sessions WHERE token = ? AND expires_at > datetime(\'now\') LIMIT 1'
  ).bind(token).first();

  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  return c.json({ authenticated: true, email: session.email });
});

// POST /auth/logout
auth.post('/logout', async (c) => {
  const token = getCookie(c, 'session');

  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    deleteCookie(c, 'session', { path: '/' });
  }

  return c.json({ ok: true });
});

export { auth as authRoutes };
