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

// ── Security headers ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com"],
      scriptSrcAttr:  ["'unsafe-inline'"],   // allows onclick= handlers
      styleSrc:       ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:        ["'self'", "fonts.gstatic.com"],
      connectSrc:     ["'self'", "https://*.supabase.co", "https://api.groq.com"],
      imgSrc:         ["'self'", "data:"],
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
  const apiKey = process.env.GROQ_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GROQ_KEY not configured on server.' });
  }

  try {
    const { messages, max_tokens } = req.body;

    // Groq uses the OpenAI-compatible chat completions format
    const groqBody = {
      model:       'llama-3.3-70b-versatile',   // fast, capable Groq model
      messages,                                   // same format as OpenAI / Anthropic
      max_tokens:  Math.min(max_tokens || 1000, 4000),
      temperature: 0.3,
    };

    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await upstream.json();

    // Normalise to the shape the frontend expects:
    // Anthropic: data.content[0].text
    // We'll return the same envelope so the frontend needs no changes.
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message?.content || '';
      return res.json({ content: [{ type: 'text', text }] });
    }

    // Pass through errors from Groq as-is
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
