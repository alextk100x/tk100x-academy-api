import { Hono } from 'hono';
import type { Env } from '../index';

const webhooks = new Hono<{ Bindings: Env }>();

// POST /webhooks/stripe
webhooks.post('/stripe', async (c) => {
  const body = await c.req.text();

  // TODO: Verify Stripe signature when webhook secret is configured
  // For now, parse and process

  try {
    const event = JSON.parse(body);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = (session.customer_details?.email || session.customer_email)?.toLowerCase()?.trim();
        const courseSlug = session.metadata?.course_slug || 'openclaw-beginner-course';

        if (!email) {
          console.error('No email in checkout session:', session.id);
          break;
        }

        // Check if purchase already exists (idempotency)
        const existing = await c.env.DB.prepare(
          'SELECT id FROM purchases WHERE stripe_session_id = ? LIMIT 1'
        ).bind(session.id).first();

        if (existing) {
          console.log('Purchase already recorded for session:', session.id);
          break;
        }

        // Record the purchase
        const purchaseId = crypto.randomUUID();
        await c.env.DB.prepare(
          'INSERT INTO purchases (id, email, stripe_session_id, stripe_customer_id, amount, currency, course_slug) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          purchaseId,
          email,
          session.id,
          session.customer || null,
          session.amount_total || 9900,
          session.currency || 'eur',
          courseSlug
        ).run();

        console.log(`Purchase recorded: ${email} → ${courseSlug}`);

        // Send welcome email with login code
        await sendWelcomeEmail(c.env, email, courseSlug);

        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return c.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

async function sendWelcomeEmail(env: Env, email: string, courseSlug: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[DEV] Would send welcome email to ${email}`);
    return;
  }

  // Generate a login code so user can access immediately
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const codeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h for welcome code

  // Invalidate old codes
  await env.DB.prepare(
    'UPDATE auth_codes SET used = 1 WHERE email = ? AND used = 0'
  ).bind(email).run();

  // Insert new code
  await env.DB.prepare(
    'INSERT INTO auth_codes (id, email, code, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(codeId, email, code, expiresAt).run();

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TK100X Academy <support@tk100x.com>',
        reply_to: 'support@tk100x.com',
        to: email,
        subject: '🎉 Welcome to the OpenClaw Beginner Course!',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #1e1b4b; font-size: 24px;">Welcome to TK100X Academy! 🎉</h1>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">
              Thank you for purchasing the <strong>OpenClaw Beginner Course</strong>. 
              You now have lifetime access to all 10 modules.
            </p>

            <p style="color: #374151; font-size: 16px; line-height: 1.6;">
              To access your course, log in at <a href="https://academy.tk100x.com/login" style="color: #7c3aed;">academy.tk100x.com</a> with this email address.
            </p>

            <p style="color: #374151; font-size: 16px; line-height: 1.6;">
              Your one-time login code:
            </p>
            
            <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #7c3aed; margin: 24px 0; text-align: center;">${code}</p>
            
            <p style="color: #6b7280; font-size: 14px;">This code expires in 24 hours. You can always request a new one on the login page.</p>

            <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
              <a href="https://academy.tk100x.com/login" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 32px; border-radius: 999px; text-decoration: none; font-weight: 600;">Go to your course →</a>
            </div>

            <p style="color: #94a3b8; font-size: 12px; margin-top: 40px;">
              TK100X GmbH, Graz, Austria<br/>
              If you have any questions, reply to this email.
            </p>
          </div>
        `,
      }),
    });
    console.log(`Welcome email sent to ${email}`);
  } catch (err) {
    console.error('Failed to send welcome email:', err);
  }
}

export { webhooks as webhookRoutes };
