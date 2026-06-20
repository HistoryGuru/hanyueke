# 汉语课 · Hànyǔ Kè

Chinese classroom management app — Node/Express backend, deployable to Render.

---

## Project Structure

```
hanyuke-server/
├── server.js          ← Express backend (API proxy + static file server)
├── package.json
├── .env.example       ← Copy to .env for local development
├── .gitignore
└── public/
    └── index.html     ← The full frontend app
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Then edit .env and fill in your keys

# 3. Run the dev server
npm run dev
# → Open http://localhost:3000
```

---

## Deploy to Render

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/hanyuke.git
git push -u origin main
```

### 2. Create a Web Service on Render
1. Go to **https://render.com** → New → Web Service
2. Connect your GitHub repo
3. Configure:
   - **Name:** `hanyuke` (or anything you like)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

### 3. Add Environment Variables
In Render → your service → **Environment**, add:

| Key | Value |
|-----|-------|
| `ANTHROPIC_KEY` | `sk-ant-...` your Anthropic API key |
| `SUPABASE_URL` | `https://your-project.supabase.co` |
| `SUPABASE_ANON` | your Supabase anon key |
| `ALLOWED_ORIGIN` | `https://hanyuke.onrender.com` (your Render URL) |

### 4. Deploy
Click **Deploy** — Render will build and start the server.
Your app will be live at `https://hanyuke.onrender.com` (or your custom domain).

---

## How the API proxy works

The frontend calls `/api/ai` (same origin — no CORS issues).  
The server adds your `ANTHROPIC_KEY` header and forwards the request to Anthropic.  
The key **never** reaches the browser.

```
Browser → POST /api/ai → server.js → Anthropic API
                          (adds sk-ant-... key)
```

---

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_KEY` | Anthropic API key (`sk-ant-...`) | Yes |
| `SUPABASE_URL` | Your Supabase project URL | Yes |
| `SUPABASE_ANON` | Supabase anonymous/public key | Yes |
| `PORT` | Server port (set automatically by Render) | No |
| `ALLOWED_ORIGIN` | CORS allowed origin | No (defaults to `*`) |
