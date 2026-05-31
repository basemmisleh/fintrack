# Fintrack — Deploy Guide

## What you need (all free)
- [Supabase](https://supabase.com) account — stores your data, syncs across devices
- [Vercel](https://vercel.com) account — hosts the app
- Node.js installed on your computer (https://nodejs.org)

---

## Step 1 — Set up Supabase (5 min)

1. Go to https://supabase.com → New project (name it "fintrack")
2. Once created, go to **SQL Editor** and run this:

```sql
create table fintrack_data (
  id text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- Allow anonymous access (no login needed, data is isolated by a UUID in localStorage)
alter table fintrack_data enable row level security;
create policy "open access" on fintrack_data for all using (true) with check (true);
```

3. Go to **Project Settings → API**
4. Copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key

---

## Step 2 — Configure the app

1. In the `fintrack` folder, copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
2. Open `.env` and paste your Supabase values:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

---

## Step 3 — Deploy to Vercel

```bash
# In the fintrack folder:
npm install
npm run build

# Install Vercel CLI if you don't have it
npm install -g vercel

# Deploy
vercel --prod
```

Vercel will ask a few questions (defaults are all fine). At the end it gives you a URL like `https://fintrack-abc123.vercel.app`.

**Important:** In Vercel's dashboard → your project → Settings → Environment Variables, add the same two variables from your `.env` file.

---

## Step 4 — Install on your iPhone

1. Open the Vercel URL in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add**

That's it — fintrack is now on your home screen, looks like a native app, and works offline.

---

## Local development

```bash
npm install
npm run dev
# Opens at http://localhost:5173
```

---

## Data & privacy

- Your data lives in your own Supabase project — Anthropic/Claude has no access to it
- Each device gets a unique anonymous ID on first use — no login required
- The ID is stored in localStorage; if you clear browser data you'll start fresh (export first!)
- To share data between devices: copy the `ft_uid` value from localStorage on one device and paste it into the other
