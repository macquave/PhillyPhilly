# 🏀 March Madness Pick'em — Bachelor Party Edition

Pick every NCAA Tournament game against the spread. Top picker wins bragging rights.

---

## Features

- **No registration** — just enter your name and start picking
- **Against the spread (ATS)** — picks and results graded vs. the spread
- **Live odds** — game matchups and spreads pulled automatically from The Odds API
- **Auto-scoring** — completed games are graded automatically
- **Leaderboard** — real-time standings ranked by correct ATS picks
- **Admin panel** — manually sync games or enter results (tap the 🏀 logo 5 times)

---

## Setup (5 minutes)

### Step 1 — Install Node.js

Download and install from https://nodejs.org (click the "LTS" version)

### Step 2 — Get your free API key

1. Go to https://the-odds-api.com
2. Click "Get API Key" → sign up with email
3. Copy the API key from your dashboard

### Step 3 — Configure the app

Open the `march-madness-picks` folder, then:

1. Rename `.env.example` to `.env`
2. Open `.env` and fill in:
   ```
   ODDS_API_KEY=paste_your_key_here
   ADMIN_PASSWORD=pick_a_secret_password
   ```

### Step 4 — Install dependencies

Open a terminal in the `march-madness-picks` folder and run:
```
npm install
```

### Step 5 — Start the app

```
npm start
```

The app will be running at http://localhost:3000

---

## Deploy Online (share with the group)

The easiest free host is **Railway**:

1. Push this folder to a GitHub repo (github.com → New repository → upload files)
2. Go to https://railway.app and sign up with GitHub
3. Click **"New Project" → "Deploy from GitHub repo"** → select your repo
4. In the Railway dashboard, click your service → **"Variables"** → add:
   - `ODDS_API_KEY` = your key
   - `ADMIN_PASSWORD` = your secret password
5. Railway will give you a URL like `https://your-app.up.railway.app` — share that with the group!

> **Note for Railway:** Add `DB_PATH=/data/picks.db` as a variable and set up a Volume
> mounted at `/data` so the database persists between deployments.
> (Settings → Volumes → Add Volume → mount path `/data`)

---

## Admin Panel

**Access:** Tap the 🏀 logo in the app header **5 times quickly**, or go to `yourapp.com/#admin`

The admin panel lets you:
- **Sync games & scores** — manually trigger a pull from The Odds API
- **Enter results manually** — if a game result doesn't auto-update
- **Add games manually** — if a game isn't showing up from the API

---

## How Scoring Works (ATS)

A pick is **correct** if your chosen team covers the spread:

| Scenario | Home spread | Home wins? | Home covers? |
|---|---|---|---|
| Home favored, wins big | -5.5 | 70–60 | ✅ Yes (wins by 10 > 5.5) |
| Home favored, wins barely | -5.5 | 65–62 | ❌ No (wins by 3 < 5.5) |
| Home favored, loses | -5.5 | 60–65 | ❌ No |
| Away underdog, loses close | +5.5 | 65–62 | ✅ Yes (loses by 3 < 5.5) |
| Push (exact spread) | -5.5 | 65.5–60 | — Push (no winner) |

**Picks lock** the moment a game's scheduled tip-off time arrives.

---

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (file-based, zero config)
- **Odds:** [The Odds API](https://the-odds-api.com) — free tier, 500 req/month
- **Frontend:** Vanilla HTML/CSS/JS (no build step, works on any phone)

