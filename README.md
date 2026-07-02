# GSE Analyst

A daily buy/sell/hold dashboard for the Ghana Stock Exchange. Live prices come
from the free, public [GSE-API](https://dev.kwayisi.org/apis/gse/); a script
running on a schedule turns that into signals with plain-English reasoning.

This README gets you from these files to a real, public URL you can bookmark
on your phone and send to friends. It takes about 10-15 minutes, once.

## What's inside (v3 — smart Q&A)

The "Ask" box is now backed by a real AI endpoint (`api/ask.js`), not just
keyword matching. It answers genuinely open-ended questions — "what's GCB's
dividend history", "how do I open a GSE trading account", "why did the index
drop last month" — by grounding every answer in two sources: this app's own
tracked signals, and live web search when the question goes beyond that.

**Important: this requires deploying on a platform that runs backend code —
plain GitHub Pages can't do this**, since Pages only serves static files.
[Vercel's free tier](https://vercel.com) runs both the static dashboard and
the `/api/ask` function together with zero extra setup, so it's the
recommended path from here on. GitHub Pages still works fine if you're happy
with the local-data-only fallback (the app degrades gracefully — the Ask box
just answers from tracked data instead of the full AI backend).

### Deploying to Vercel (recommended)

1. Push this project to GitHub as in Step 1 below
2. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import your `gse-analyst` repo
3. Vercel auto-detects the static site + `/api` folder — no build config needed
4. Before deploying, add an environment variable: **Settings → Environment
   Variables** → `ANTHROPIC_API_KEY` → your key from
   [console.anthropic.com](https://console.anthropic.com)
5. Deploy. You get a URL like `gse-analyst.vercel.app` — that's your real app URL, with the smart Q&A fully working
6. Keep the GitHub Actions daily updater as-is (still described below) — every time it commits fresh data, Vercel auto-redeploys with the latest numbers

Web search costs are usage-based on the Anthropic API (typically a few cents
per query) — fine for personal or small-team use; keep an eye on volume if
you share the link widely.

## What's inside (v2 — executive tier)

The frontend is now organized as proper JS classes instead of loose script,
so it's straightforward to extend:

- `GSEDataStore` — loads and indexes the daily data
- `MarketAnalytics` — computes the market health score, sector exposure, and alerts
- `Watchlist` — personal saved-stock state (via the artifact storage API)
- `AskEngine` — answers "should I buy or sell [X] today" from loaded data
- `Dashboard` — pure rendering, no business logic
- `App` — wires it all together

New capabilities on top of the daily signals:

- **Self-graded accuracy.** Every day, `scripts/update.mjs` checks yesterday's
  buy/sell calls against what the stock actually did and logs the result to
  `data/performance.json`. The dashboard shows this as a real, earned track
  record — not a confidence estimate.
- **Market health score** — a single 0-100 number blending signal balance and
  average confidence, with a plain-English read underneath.
- **Sector exposure** — buy/sell/hold breakdown by sector (Banking, Telecom,
  Mining, etc.), so you can see concentration at a glance.
- **Alerts** — automatically flags outsized single-day moves (±5%+) and the
  day's highest-conviction call.

## What's inside (v1)

## 1. Create the GitHub repo


1. Go to [github.com/new](https://github.com/new)
2. Name it something like `gse-analyst` (public or private both work, but
   public is required for the free tier of GitHub Pages)
3. Don't initialize with a README (you already have one)
4. On your computer, unzip this project, then in that folder run:

```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/gse-analyst.git
git push -u origin main
```

## 2. (Optional but recommended) Add a Claude API key

Without this, signals come from a simple, transparent rule-based heuristic
(documented in `scripts/update.mjs`). With it, Claude reasons over the same
real data every day and writes the buy/sell/hold calls and explanations.

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. In your GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**
3. Name it `ANTHROPIC_API_KEY`, paste your key, save

Costs a few cents a day at most — one short API call, once daily.

## 3. Turn on GitHub Pages

1. **Settings → Pages**
2. Under "Build and deployment", set Source to **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Save. GitHub gives you a URL like:

```
https://YOUR-USERNAME.github.io/gse-analyst/
```

**That's your app URL.** Bookmark it, share it, add it to your phone's home
screen (open it in mobile Safari/Chrome → Share → Add to Home Screen — the
`manifest.json` here makes it launch like a real app, full-screen, with an
icon).

## 4. Let the daily updater run

The workflow in `.github/workflows/daily-update.yml` runs automatically every
weekday at 16:05 GMT (shortly after the GSE closes at 15:00 GMT) and commits
fresh data. No further action needed — but two one-time checks:

1. **Settings → Actions → General → Workflow permissions** → make sure "Read
   and write permissions" is selected (needed so the workflow can commit the
   daily data back to your repo)
2. To test it immediately instead of waiting for tomorrow: go to the
   **Actions** tab → "Daily GSE update" → **Run workflow**

Give it a minute, refresh your app URL, and you should see today's real data.

## What updates automatically vs. what doesn't

| Data | Updates | How |
|---|---|---|
| Stock prices, daily change, volume | Daily, automatically | GSE-API via GitHub Actions |
| Buy/sell/hold signals + reasoning | Daily, automatically | Heuristic or Claude, from the price data above |
| Policy rate, inflation, market cap | Manually, as needed | Edit `data/macro.json` and push — these change monthly, not daily, so scripting them isn't worth the complexity |

## Honest limitations

- The GSE-API is a free community project (not run by the Ghana Stock
  Exchange itself), maintained on a best-effort basis. If it goes down or
  changes shape, the daily workflow will fail silently that day — check the
  **Actions** tab occasionally.
- Signals are directional reads on real price/volume data, not a trained
  machine-learning model, and not investment advice.
- There's no real-time intraday feed here — this is a once-daily, end-of-day
  snapshot, which fits weekly/daily decision-making better than minute-by-minute trading.

## Updating the design or logic later

- Dashboard: `index.html` (fully self-contained, no build step)
- Signal logic: `scripts/update.mjs`
- Macro figures: `data/macro.json`

Feel free to paste any of these into a chat with Claude and ask for changes —
"add a sector filter", "change the color palette", "add email alerts", etc.
