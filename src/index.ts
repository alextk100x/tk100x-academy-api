import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { webhookRoutes } from './routes/webhooks';
import { accessRoutes } from './routes/access';
import { progressRoutes } from './routes/progress';

export type Env = {
  DB: D1Database;
  CORS_ORIGIN: string;
  RESEND_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: [c.env.CORS_ORIGIN, 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'tk100x-academy-api' }));

// Routes
app.route('/auth', authRoutes);
app.route('/webhooks', webhookRoutes);
app.route('/api', accessRoutes);
app.route('/api', progressRoutes);

export default app;
