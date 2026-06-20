import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers (relaxed for fonts / CDN scripts the HTML needs) ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:     ["'self'", "fonts.gstatic.com"],
      connectSrc:  ["'self'", process.env.SUPABASE_URL || '*'],
      imgSrc:      ["'self'", "data:"],
    }
  }
}));

// ── CORS (allow same-origin; tighten in production by setting ALLOWED_ORIGIN) ──
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));

app.use(express.json({ limit: '1mb' }));

// ── Rate limiting on the AI proxy endpoint ──
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 20,                     // 20 AI requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment.' }
});

// ── Serve the frontend ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ──
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Anthropic proxy endpoint ──
app.post('/api/ai', aiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_KEY not configured on server.' });
  }

  try {
    const body = req.body;

    // Safety: always enforce the model and cap tokens so clients can't abuse
    body.model      = 'claude-sonnet-4-6';
    body.max_tokens = Math.min(body.max_tokens || 1000, 4000);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error('[/api/ai]', err.message);
    return res.status(502).json({ error: 'Upstream request failed: ' + err.message });
  }
});

// ── Supabase config endpoint (serves public keys to the frontend safely) ──
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl:  process.env.SUPABASE_URL  || '',
    supabaseAnon: process.env.SUPABASE_ANON || '',
  });
});

// ── Fallback: serve index.html for any unmatched route (SPA support) ──
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`汉语课 server running on port ${PORT}`);
});
