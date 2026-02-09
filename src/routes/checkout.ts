import { Hono } from 'hono';
import type { Env } from '../index';

const checkout = new Hono<{ Bindings: Env }>();

// POST /checkout/create-session
checkout.post('/create-session', async (c) => {
  const { courseSlug, email } = await c.req.json<{
    courseSlug?: string;
    email?: string;
  }>();

  const slug = courseSlug || 'openclaw-beginner-course';

  const body: Record<string, unknown> = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'OpenClaw Beginner Course',
            description: 'Build AI agent systems that actually work. 10 modules, lifetime access.',
          },
          unit_amount: 9900, // €99.00
        },
        quantity: 1,
      },
    ],
    metadata: {
      course_slug: slug,
    },
    success_url: 'https://academy.tk100x.com/welcome?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://tk100x.com/ai-academy/openclaw-beginner-course',
    allow_promotion_codes: true,
  };

  // Pre-fill email if provided
  if (email) {
    body.customer_email = email;
  }

  // Call Stripe API directly (no SDK needed on Workers)
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeStripeBody(body),
  });

  const session = await stripeRes.json() as Record<string, unknown>;

  if (!stripeRes.ok) {
    console.error('Stripe error:', session);
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }

  return c.json({ url: session.url, sessionId: session.id });
});

// GET /checkout/session/:id — verify a completed session
checkout.get('/session/:id', async (c) => {
  const sessionId = c.req.param('id');

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
    },
  });

  const session = await stripeRes.json() as Record<string, unknown>;

  if (!stripeRes.ok) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const customerDetails = session.customer_details as Record<string, unknown> | null;

  return c.json({
    status: session.payment_status,
    email: customerDetails?.email || null,
    courseSlug: (session.metadata as Record<string, string>)?.course_slug || 'openclaw-beginner-course',
  });
});

// Helper: encode nested object to Stripe's form format
function encodeStripeBody(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeStripeBody(item as Record<string, unknown>, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      parts.push(encodeStripeBody(value as Record<string, unknown>, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}

export { checkout as checkoutRoutes };
