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
      scriptSrcAttr:  ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:        ["'self'", "fonts.gstatic.com"],
      connectSrc:     ["'self'", "https://*.supabase.co", "https://api.groq.com", "https://cdn.jsdelivr.net"],
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

// ── Supabase config endpoint ──
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl:  process.env.SUPABASE_URL  || '',
    supabaseAnon: process.env.SUPABASE_ANON || '',
  });
});

// ── Supabase admin client (uses service role key — never sent to browser) ──
import { createClient as createSbClient } from '@supabase/supabase-js';

function adminDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase not configured on server.');
  return createSbClient(url, key, { auth: { persistSession: false } });
}

// POST /api/classroom/create
app.post('/api/classroom/create', async (req, res) => {
  try {
    const { name, description, teacher_id } = req.body;
    if (!name || !teacher_id) return res.status(400).json({ error: 'name and teacher_id required' });
    const db = adminDb();
    const { data, error } = await db
      .from('classrooms').insert({ name, description: description || '', teacher_id })
      .select().single();
    if (error) throw error;
    return res.json({ classroom: data });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/classroom/mine?teacher_id=uuid
app.get('/api/classroom/mine', async (req, res) => {
  try {
    const { teacher_id } = req.query;
    if (!teacher_id) return res.status(400).json({ error: 'teacher_id required' });
    const db = adminDb();
    const { data, error } = await db
      .from('classrooms').select('*').eq('teacher_id', teacher_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ classrooms: data });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// POST /api/classroom/join  — student joins with a code
app.post('/api/classroom/join', async (req, res) => {
  try {
    const { code, student_id } = req.body;
    if (!code || !student_id) return res.status(400).json({ error: 'code and student_id required' });
    const db = adminDb();

    const { data: classroom, error: lookupErr } = await db
      .from('classrooms').select('id, name, code').ilike('code', code.trim()).single();
    if (lookupErr || !classroom) return res.status(404).json({ error: 'Class code not found. Double-check and try again.' });

    const { data: existing } = await db.from('enrollments').select('id')
      .eq('classroom_id', classroom.id).eq('student_id', student_id).single();
    if (existing) return res.status(409).json({ error: 'You are already enrolled in this class.' });

    const { error: enrollErr } = await db.from('enrollments').insert({ classroom_id: classroom.id, student_id });
    if (enrollErr) throw enrollErr;
    return res.json({ classroom });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/classroom/enrolled?student_id=uuid
app.get('/api/classroom/enrolled', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.status(400).json({ error: 'student_id required' });
    const db = adminDb();
    const { data, error } = await db
      .from('enrollments')
      .select('joined_at, classrooms(id, name, code, teacher_id, profiles(display_name))')
      .eq('student_id', student_id);
    if (error) throw error;
    return res.json({ enrollments: data });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/classroom/students?classroom_id=uuid
app.get('/api/classroom/students', async (req, res) => {
  try {
    const { classroom_id } = req.query;
    if (!classroom_id) return res.status(400).json({ error: 'classroom_id required' });
    const db = adminDb();
    const { data, error } = await db
      .from('enrollments')
      .select('student_id, joined_at, profiles(id, display_name)')
      .eq('classroom_id', classroom_id);
    if (error) throw error;
    return res.json({ students: data });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// POST /api/classroom/award  — teacher awards points to a student
app.post('/api/classroom/award', async (req, res) => {
  try {
    const { classroom_id, student_id, amount, reason, awarded_by } = req.body;
    if (!classroom_id || !student_id) return res.status(400).json({ error: 'classroom_id and student_id required' });
    const db = adminDb();
    const { error } = await db.from('points').insert({
      classroom_id, student_id, amount: amount || 1, reason: reason || '', awarded_by
    });
    if (error) throw error;
    return res.json({ ok: true });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/classroom/points?classroom_id=uuid
app.get('/api/classroom/points', async (req, res) => {
  try {
    const { classroom_id } = req.query;
    if (!classroom_id) return res.status(400).json({ error: 'classroom_id required' });
    const db = adminDb();
    const { data, error } = await db
      .from('points').select('student_id, amount, awarded_at').eq('classroom_id', classroom_id);
    if (error) throw error;
    return res.json({ points: data });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// ── Fallback: serve index.html for any unmatched route (SPA support) ──
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`汉语课 server running on port ${PORT}`);
});
