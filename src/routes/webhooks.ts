import { Hono } from 'hono';
import type { Env } from '../index';

const webhooks = new Hono<{ Bindings: Env }>();

// POST /webhooks/stripe
webhooks.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  const body = await c.req.text();

  // TODO: Verify Stripe signature when key is available
  // const event = stripe.webhooks.constructEvent(body, signature, c.env.STRIPE_WEBHOOK_SECRET);

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  try {
    const event = JSON.parse(body);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_details?.email?.toLowerCase();
        const courseSlug = session.metadata?.course_slug || 'openclaw-beginner-course';

        if (email) {
          const id = crypto.randomUUID();
          await c.env.DB.prepare(
            'INSERT INTO purchases (id, email, stripe_session_id, stripe_customer_id, amount, currency, course_slug) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            id,
            email,
            session.id,
            session.customer || null,
            session.amount_total || 9900,
            session.currency || 'eur',
            courseSlug
          ).run();
        }
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

export { webhooks as webhookRoutes };
