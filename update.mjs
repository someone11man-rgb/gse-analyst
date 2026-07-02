// GSE Analyst — daily updater
//
// Pulls live trading data from the free, public, unauthenticated GSE-API
// (https://dev.kwayisi.org/apis/gse/), built and maintained independently
// by Michael Kwayisi (not affiliated with the Ghana Stock Exchange itself,
// so treat it as a best-effort community data source rather than an
// official feed).
//
// If ANTHROPIC_API_KEY is set (as a GitHub Actions secret), this script
// asks Claude to turn the raw price/volume numbers into buy/sell/hold
// signals with plain-English reasoning, grounded ONLY in the data
// provided. Without a key, it falls back to a transparent, rule-based
// heuristic — no black box either way.

import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const GSE_LIVE_URL = "https://dev.kwayisi.org/apis/gse/live";
const OUT_DIR = path.resolve("data");
const HISTORY_DIR = path.join(OUT_DIR, "history");
const LATEST_PATH = path.join(OUT_DIR, "latest.json");
const PERFORMANCE_PATH = path.join(OUT_DIR, "performance.json");

// Best-effort sector map for well-known GSE tickers. Unlisted tickers
// fall back to "Other" — extend this as you track more stocks.
const SECTORS = {
  MTNGH: "Telecom", TOTAL: "Energy", GOIL: "Energy",
  GCB: "Banking", CAL: "Banking", ACCESS: "Banking", SCB: "Banking",
  SOGEGH: "Banking", RBGH: "Banking", ADB: "Banking", FBL: "Banking",
  SIC: "Insurance", EGL: "Insurance",
  AGA: "Mining", ASG: "Mining", GOLD: "Mining",
  KASA: "Consumer Goods", UNIL: "Consumer Goods", FML: "Consumer Goods",
  EGH: "Real Estate", CPC: "Manufacturing", PBC: "Agriculture"
};
function sectorFor(ticker){ return SECTORS[ticker] || "Other"; }

async function fetchLiveData() {
  const res = await fetch(GSE_LIVE_URL);
  if (!res.ok) throw new Error(`GSE-API returned ${res.status}`);
  return res.json();
}

async function readJSONSafe(p, fallback){
  try { return JSON.parse(await readFile(p, "utf-8")); } catch { return fallback; }
}

async function loadRecentHistory(days = 5) {
  try {
    const files = (await readdir(HISTORY_DIR)).filter(f => f.endsWith(".json")).sort();
    const recent = files.slice(-days);
    const snapshots = [];
    for (const f of recent) snapshots.push(JSON.parse(await readFile(path.join(HISTORY_DIR, f), "utf-8")));
    return snapshots;
  } catch { return []; }
}

// Grades yesterday's buy/sell calls against today's actual price moves.
// This is what lets the dashboard show a real, earned accuracy number
// instead of an unverifiable confidence score.
function gradeYesterday(prevSnapshot, todayLive){
  if (!prevSnapshot || !prevSnapshot.signals) return null;
  const graded = prevSnapshot.signals.filter(s => s.signal === "buy" || s.signal === "sell");
  let correct = 0;
  let sampleSize = 0;
  for (const call of graded) {
    const today = todayLive.find(s => s.name === call.ticker);
    if (!today) continue;
    sampleSize++;
    const actualUp = today.change > 0;
    const predictedUp = call.signal === "buy";
    if (actualUp === predictedUp) correct++;
  }
  if (sampleSize === 0) return null;
  return {
    date: new Date().toISOString().slice(0, 10),
    gradedFrom: prevSnapshot.date,
    correct,
    sampleSize,
    accuracy: Math.round((correct / sampleSize) * 100)
  };
}

function heuristicSignal(stock, history) {
  const past = history.map(day => day.find(s => s.name === stock.name)).filter(Boolean);
  const sameDirection = past.filter(p => (p.change > 0 && stock.change > 0) || (p.change < 0 && stock.change < 0)).length;

  let signal = "hold";
  let confidence = 50;
  const dir = stock.change > 0 ? "up" : stock.change < 0 ? "down" : "flat";
  let reasoning = `${stock.name} moved ${dir} ${Math.abs(stock.change)}% today on ${stock.volume.toLocaleString()} shares traded.`;

  if (stock.change >= 3) {
    signal = "watch"; confidence = 55 + Math.min(sameDirection * 5, 20);
    reasoning += " A single-day gain this size is worth watching for follow-through volume before treating it as a trend.";
  } else if (stock.change <= -3) {
    signal = "watch"; confidence = 55 + Math.min(sameDirection * 5, 20);
    reasoning += " A drop this size can reflect profit-taking or a real shift in sentiment. Check for news before reacting.";
  } else if (sameDirection >= 3 && stock.change > 0) {
    signal = "buy"; confidence = 60 + sameDirection * 5;
    reasoning += ` It has also risen on ${sameDirection} of the last ${past.length} sessions, suggesting building momentum.`;
  } else if (sameDirection >= 3 && stock.change < 0) {
    signal = "sell"; confidence = 60 + sameDirection * 5;
    reasoning += ` It has also fallen on ${sameDirection} of the last ${past.length} sessions, suggesting sustained selling pressure.`;
  } else {
    reasoning += " No strong multi-day pattern yet, treat as neutral.";
  }

  return {
    ticker: stock.name, sector: sectorFor(stock.name), price: stock.price, change: stock.change, volume: stock.volume,
    signal, confidence: Math.min(confidence, 85), reasoning,
    risk: "Heuristic signal from price and volume only, not a fitted statistical model. Verify against news before acting."
  };
}

async function claudeSignal(stocks, history, apiKey) {
  const prompt = `You are GSE Analyst, reviewing today's Ghana Stock Exchange trading data.
Today's data: ${JSON.stringify(stocks)}
Recent sessions of history (same shape, array of arrays, oldest first): ${JSON.stringify(history)}

For each stock in today's data, return one object with exactly these fields:
ticker, price, change, volume, signal ("buy"|"sell"|"hold"|"watch"), confidence (integer 0-100),
reasoning (1-2 plain-English sentences citing the actual numbers provided), risk (1 short sentence).
Only use the data given above. Never invent news, catalysts, or events not present in the data.
If you are not confident, say so via a lower confidence score rather than inventing a reason.
Respond with ONLY a JSON array, no prose, no markdown fences.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
  const data = await res.json();
  const text = data.content.map(b => b.text || "").join("").trim();
  const clean = text.replace(/^```json/, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(clean);
  return parsed.map(s => ({ ...s, sector: sectorFor(s.ticker) }));
}

async function main() {
  await mkdir(HISTORY_DIR, { recursive: true });

  const live = await fetchLiveData();
  const history = await loadRecentHistory(5);
  const prevSnapshot = await readJSONSafe(LATEST_PATH, null);

  let signals;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try { signals = await claudeSignal(live, history, apiKey); }
    catch (err) {
      console.error("Claude signal generation failed, falling back to heuristic:", err.message);
      signals = live.map(s => heuristicSignal(s, history));
    }
  } else {
    signals = live.map(s => heuristicSignal(s, history));
  }

  const today = new Date().toISOString().slice(0, 10);
  const snapshot = { updatedAt: new Date().toISOString(), date: today, source: apiKey ? "claude" : "heuristic", signals };

  // Grade yesterday's calls against today's actual moves, then append
  // to the rolling performance log the dashboard reads for its
  // executive-level accuracy stat.
  const grade = gradeYesterday(prevSnapshot, live);
  if (grade) {
    const perf = await readJSONSafe(PERFORMANCE_PATH, []);
    perf.push(grade);
    await writeFile(PERFORMANCE_PATH, JSON.stringify(perf.slice(-60), null, 2));
  }

  await writeFile(LATEST_PATH, JSON.stringify(snapshot, null, 2));
  await writeFile(path.join(HISTORY_DIR, `${today}.json`), JSON.stringify(live, null, 2));

  console.log(`Updated ${signals.length} signals for ${today} (source: ${snapshot.source})${grade ? `, graded ${grade.sampleSize} prior calls at ${grade.accuracy}%` : ""}`);
}

main().catch(err => { console.error(err); process.exit(1); });
